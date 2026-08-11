#!/usr/bin/env bash
# devcontainer のコンテナディスクを埋める再生成可能 cache を冪等に回収する。
# 削除は固定 allowlist (~/.vscode-server/extensionsCache, ~/.npm/_cacache,
# ~/.local/share/cursor-agent/versions, ~/.codex/.tmp, および共有 mount でないと
# 証明できる場合のみ /vscode/vscode-server/extensionsCache) の direct child のうち、
# 使用中でも判定不能でもないことを検証できた entry に限定する。引数や環境変数で
# 削除 root を置換することはできない。
#
# 終了コード契約 (起動フックから無人実行されるため固定):
#   0 = 正常系 (回収成功 / no-op / safety skip を含む)
#   1 = operational failure (category の観測・列挙・du・権限昇格・削除の失敗が 1 件以上)
#   2 = 引数エラー
set -euo pipefail
export LC_ALL=C

readonly DEFAULT_THRESHOLD_PCT=90
readonly DEFAULT_MIN_FREE_BYTES=$((5 * 1024 * 1024 * 1024))
readonly TEMP_MEASURE_TIMEOUT_SECONDS=10

# extensionsCache の完成済み entry 名 (publisher.name-version[-platform])。
# lock / partial download / .trash 等はこの形式に合致しないため自然に skip される
readonly EXT_CACHE_FMT='^[A-Za-z0-9][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)+-[0-9]+\.[0-9]+(\.[0-9]+)*(-(linux|darwin|win32|alpine|web)(-(x64|arm64|armhf|ia32|x32|universal))?)?$'
# cursor-agent の世代名 (YYYY.MM.DD-<git hash>)。同一日付の複数世代は git hash 順と
# release 順が一致しないため区別せず、曖昧として全保持する
readonly CURSOR_VER_FMT='^[0-9]{4}\.[0-9]{2}\.[0-9]{2}-[0-9a-f]{7,40}$'
# process 判定は自身の grep コマンドラインにマッチしないよう、前は行頭か `/`、
# 後は空白か行末に限定する (pattern 文字列自体はこの条件を満たさない)
readonly CODEX_PROC_RE='(^|/)codex([[:space:]]|$)'
readonly CURSOR_PROC_RE='(^|/)cursor-agent([[:space:]]|$)'

usage() {
  cat >&2 <<'EOF'
usage: clean-devcontainer-disk.sh [--dry-run] [--threshold <pct>] [--min-free-bytes <bytes>]
  引数なし              無条件に掃除を実行する
  --dry-run             観測と候補の表示のみ行い、ファイルシステムを変更しない
  --threshold <pct>     / の使用率または inode 使用率が pct%% 以上、または空きが
                        下限未満のときだけ実行する (1-100、default: 90)
  --min-free-bytes <bytes>
                        絶対空き容量の下限を変更する (default: 5368709120)
  --test-root <path>    テストモード。/vscode 側の root を <path>/vscode に置き換える。
                        <path> は repository の .temp/ 自身またはその配下に限る
EOF
}

human() {
  awk -v b="$1" 'BEGIN {
    split("B KiB MiB GiB TiB", u, " "); v = b + 0; i = 1
    while (v >= 1024 && i < 5) { v /= 1024; i++ }
    if (i == 1) printf "%d%s", v, u[i]; else printf "%.1f%s", v, u[i]
  }'
}

# 表示専用。制御文字を潰して entry 名由来の出力汚染 (行注入等) を防ぐ
disp() {
  printf '%s' "$1" | tr '[:cntrl:]' '[?*]'
}

# $1 の disk 使用量を byte で出力。du 失敗時は非 0
entry_bytes() {
  local out
  out="$(du -sb -- "$1" 2>/dev/null | awk 'NR==1 {print $1}')" || return 1
  [[ "$out" =~ ^[0-9]+$ ]] || return 1
  printf '%s' "$out"
}

# NUL-safe に direct child を列挙する。find の失敗を wait で捕捉するため
# process substitution の pid を保持する ($! は直前の process substitution を指す)
enum_children() {
  local root="$1"
  local -n _ec_out="$2"
  local _ec_e
  _ec_out=()
  while IFS= read -r -d '' _ec_e; do
    _ec_out+=("$_ec_e")
  done < <(find "$root" -mindepth 1 -maxdepth 1 -print0 2>/dev/null)
  wait $! 2>/dev/null
}

# option 注入や出力解析の事故を避けるため、空白・制御文字・leading dash を持つ
# basename は形式検証とは独立に削除候補から除外する
basename_safe() {
  local b="$1"
  case "$b" in
    "" | . | .. | -*) return 1 ;;
  esac
  if [[ "$b" =~ [[:space:][:cntrl:]] ]]; then
    return 1
  fi
  return 0
}

# canonical base から root へ至る全中間 component (root 自身は除く) に symlink が
# 無いことを確認する。base より上は検証済み canonical とみなす。中間 component の
# symlink 交換は allowlist 外への脱出経路になるため guard / 削除直前検証で使う
intermediate_symlink_free() {
  local base="$1" root="$2" rel comp
  if [ "$base" = "/" ]; then
    case "$root" in
      /*) ;;
      *) return 1 ;;
    esac
    rel="${root#/}"
    comp=""
  else
    case "$root" in
      "$base"/*) ;;
      *) return 1 ;;
    esac
    rel="${root#"$base"/}"
    comp="$base"
  fi
  while [[ "$rel" == */* ]]; do
    comp="$comp/${rel%%/*}"
    rel="${rel#*/}"
    [ -L "$comp" ] && return 1
  done
  return 0
}

# 改行区切り list ($2) に $1 が含まれるか。世代名は空白を含まない形式検証済み
in_list() {
  local item="$1" x
  while IFS= read -r x; do
    [ "$x" = "$item" ] && return 0
  done <<<"$2"
  return 1
}

# 候補の identity (device:inode:type)。削除直前の再検証で、選定時と同じ entry を
# 削除すること (同名・別 inode・別 type への交換を検出すること) を確認する比較値
entry_id() {
  local id t
  id="$(stat -c '%d:%i' -- "$1" 2>/dev/null)" || return 1
  if [ -f "$1" ]; then t=f; elif [ -d "$1" ]; then t=d; else t=o; fi
  printf '%s:%s' "$id" "$t"
}

# bash の算術展開は符号付き 64bit で wrap するため、展開前に decimal 文字列の
# 表現可能範囲を検証する (wrap した巨大値を有効な閾値として受理しない)
fits_int64() {
  local v="$1"
  [[ "$v" =~ ^[0-9]+$ ]] || return 1
  v="${v#"${v%%[!0]*}"}"
  [ -z "$v" ] && return 0
  [ "${#v}" -gt 19 ] && return 1
  if [ "${#v}" -eq 19 ] && [[ "$v" > "9223372036854775807" ]]; then
    return 1
  fi
  return 0
}

# df の KiB 値は byte へ変換してから比較・表示するため、符号付き 64bit で wrap
# しない範囲であることを変換前に確認する (wrap した値は空き不足の誤判定になる)
readonly MAX_KIB=$((9223372036854775807 / 1024))
fits_kib() {
  fits_int64 "$1" || return 1
  [ "$1" -le "$MAX_KIB" ]
}

# 削除直前の再検証: 使用中判定と削除の間に process が起動したり entry・root・
# 中間 component が入れ替わったりする race を fail-safe 側に倒す。
# root は自己生成値との相互比較ではなく固定の expected と照合し、root と候補の
# device・inode・type が選定時から変わっていないことも確認する
# 0=削除可 1=safety skip 2=race で消失
revalidate_entry() {
  local root="$1" entry="$2" fmt="$3" retained="$4" expected="$5" want_id="$6"
  [ -e "$entry" ] || return 2
  [ -L "$entry" ] && return 1
  [ "${entry%/*}" = "$root" ] || return 1
  local base="${entry##*/}"
  basename_safe "$base" || return 1
  if [ -n "$fmt" ] && [[ ! "$base" =~ $fmt ]]; then
    return 1
  fi
  if [ -n "$retained" ] && in_list "$base" "$retained"; then
    return 1
  fi
  if [ -L "$root" ] || [ ! -d "$root" ]; then
    return 1
  fi
  local canon_root
  canon_root="$(realpath -- "$root" 2>/dev/null)" || return 1
  [ "$canon_root" = "$expected" ] || return 1
  intermediate_symlink_free "$RG_BASE" "$root" || return 1
  if [ "$test_mode" = "1" ]; then
    case "$canon_root" in
      "$CANON_TEMP" | "$CANON_TEMP"/*) ;;
      *) return 1 ;;
    esac
  fi
  local rid cid
  rid="$(stat -c '%d:%i' -- "$root" 2>/dev/null)" || return 1
  [ -n "$RG_ID" ] && [ "$rid" = "$RG_ID" ] || return 1
  cid="$(entry_id "$entry")" || return 1
  [ "$cid" = "$want_id" ] || return 1
  return 0
}

# allowlist root 自体の検証。root が symlink だったり canonical path が期待と
# ずれる場合 (途中の親が symlink 等) は削除範囲を証明できないので unsafe とする。
# expected は検証済み canonical base ($3) に固定 suffix を連結した値を呼び出し側が
# 作る。root 自身の realpath から生成すると symlink 経由の脱出と自己一致するため禁止。
# 結果は RG_STATUS / RG_ID / RG_BASE に返す (command substitution で受けると
# subshell になり identity を親へ返せないため)
RG_STATUS=""
RG_ID=""
RG_BASE=""
root_guard() {
  local root="$1" expected="$2" base="$3"
  RG_STATUS=""
  RG_ID=""
  RG_BASE=""
  if [ ! -e "$root" ]; then
    RG_STATUS="missing"
    return 0
  fi
  if [ -L "$root" ] || [ ! -d "$root" ]; then
    RG_STATUS="unsafe"
    return 0
  fi
  local canon
  if ! canon="$(realpath -- "$root" 2>/dev/null)"; then
    RG_STATUS="error"
    return 0
  fi
  if [ "$canon" != "$expected" ]; then
    RG_STATUS="unsafe"
    return 0
  fi
  if ! intermediate_symlink_free "$base" "$root"; then
    RG_STATUS="unsafe"
    return 0
  fi
  if ! RG_ID="$(stat -c '%d:%i' -- "$root" 2>/dev/null)"; then
    RG_STATUS="error"
    return 0
  fi
  RG_BASE="$base"
  RG_STATUS="ok"
}

# cursor retained set の削除前再確認。$1=root、$2=改行区切りの "name<TAB>dev:ino"。
# retained entry が削除・交換されていると updater の symlink や rollback を壊すため、
# 1 つでも存在・type・identity が変化していれば非 0
retained_set_intact() {
  local root="$1" ids="$2"
  local name id cur
  while IFS=$'\t' read -r name id; do
    [ -n "$name" ] || continue
    if [ -L "$root/$name" ] || [ ! -d "$root/$name" ]; then
      return 1
    fi
    cur="$(stat -c '%d:%i' -- "$root/$name" 2>/dev/null)" || return 1
    [ "$cur" = "$id" ] || return 1
  done <<<"$ids"
  return 0
}

# entry 単位の再検証を経ずに root ごと処理する経路 (npm cache clean) 用。guard から
# 実行までの間に canonical path・中間 component・identity が入れ替わっていないか測り直す
root_still_intact() {
  local root="$1" expected="$2" base="$3" want_id="$4"
  [ -L "$root" ] && return 1
  [ -d "$root" ] || return 1
  local canon rid
  canon="$(realpath -- "$root" 2>/dev/null)" || return 1
  [ "$canon" = "$expected" ] || return 1
  intermediate_symlink_free "$base" "$root" || return 1
  rid="$(stat -c '%d:%i' -- "$root" 2>/dev/null)" || return 1
  [ -n "$want_id" ] && [ "$rid" = "$want_id" ]
}

delete_entry() {
  if [ "$1" = "1" ]; then
    sudo -n rm -rf -- "$2"
  else
    rm -rf -- "$2"
  fi
}

# process listing は clear (取得成功かつ該当なし) / active (取得成功かつ該当あり) /
# unknown (取得失敗) の 3 状態。削除を許すのは clear のみ
PS_STATE="unknown"
PS_SNAPSHOT=""
refresh_ps() {
  local out
  if out="$(ps -eo comm=,args= 2>/dev/null)"; then
    PS_STATE="ok"
    PS_SNAPSHOT="$out"
  else
    PS_STATE="unknown"
    PS_SNAPSHOT=""
  fi
}

ps_match() {
  grep -qE -e "$1" <<<"$PS_SNAPSHOT"
}

ps_refs() {
  grep -qF -e "$1" <<<"$PS_SNAPSHOT"
}

print_proc_matches() {
  awk -v re="$1" '$0 ~ re {print "    process: " $0; n++; if (n >= 3) exit}' <<<"$PS_SNAPSHOT"
}

# ---------------------------------------------------------------------------
# 引数
# ---------------------------------------------------------------------------

dry_run=0
threshold_pct=""
min_free_bytes=""
test_root=""
# 空文字を「未指定」と同一視すると、test mode のつもりで production の /vscode を
# 対象にしたり、閾値を渡したつもりで無条件削除になったりするため、指定の有無を
# 値と別に持つ
test_root_given=0
threshold_given=0
min_free_given=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)
      dry_run=1
      shift
      ;;
    --threshold)
      [ $# -ge 2 ] || {
        usage
        exit 2
      }
      threshold_pct="$2"
      threshold_given=1
      shift 2
      ;;
    --min-free-bytes)
      [ $# -ge 2 ] || {
        usage
        exit 2
      }
      min_free_bytes="$2"
      min_free_given=1
      shift 2
      ;;
    --test-root)
      [ $# -ge 2 ] || {
        usage
        exit 2
      }
      test_root="$2"
      test_root_given=1
      shift 2
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

if [ "$threshold_given" = "1" ]; then
  if ! fits_int64 "$threshold_pct"; then
    printf 'error: --threshold は 1-100 の整数で指定してください: %s\n' "$(disp "$threshold_pct")" >&2
    exit 2
  fi
  threshold_pct=$((10#$threshold_pct))
  if [ "$threshold_pct" -lt 1 ] || [ "$threshold_pct" -gt 100 ]; then
    printf 'error: --threshold は 1-100 の整数で指定してください: %s\n' "$threshold_pct" >&2
    exit 2
  fi
fi
if [ "$min_free_given" = "1" ]; then
  if ! fits_int64 "$min_free_bytes"; then
    printf 'error: --min-free-bytes は表現可能な非負の整数で指定してください: %s\n' "$(disp "$min_free_bytes")" >&2
    exit 2
  fi
  min_free_bytes=$((10#$min_free_bytes))
fi

# percentage 単独では filesystem 容量に対する意味が変わるため、閾値モードは
# 使用率・inode 使用率と絶対空き容量の OR 条件にする
threshold_mode=0
if [ "$threshold_given" = "1" ] || [ "$min_free_given" = "1" ]; then
  threshold_mode=1
  : "${threshold_pct:=$DEFAULT_THRESHOLD_PCT}"
  : "${min_free_bytes:=$DEFAULT_MIN_FREE_BYTES}"
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

if [ -z "${HOME:-}" ]; then
  printf 'error: HOME が未設定のため allowlist root を構成できない\n' >&2
  exit 1
fi
CANON_HOME="$(realpath -m -- "$HOME")"

test_mode=0
VSCODE_ROOT="/vscode"
# VSCODE 側 root の検証済み canonical base。production では / 直下の固定 path、
# test mode では .temp/ 配下と検証済みの canonical test root
VSCODE_BASE="/"
CANON_TEMP=""
if [ "$test_root_given" = "1" ]; then
  if [ -z "$test_root" ]; then
    printf 'error: --test-root に空文字は指定できません\n' >&2
    exit 2
  fi
  if [ ! -d "$test_root" ]; then
    printf 'error: --test-root は既存 directory を指定してください: %s\n' "$(disp "$test_root")" >&2
    exit 2
  fi
  # 注入 root が repository の .temp/ 系に閉じることを canonical path で保証する
  # (traversal や symlink 経由の脱出を拒否する)
  if ! canon_test_root="$(realpath -m -- "$test_root" 2>/dev/null)"; then
    printf 'error: --test-root を canonical 化できません: %s\n' "$(disp "$test_root")" >&2
    exit 2
  fi
  if ! canon_temp="$(realpath -m -- "$repo_root/.temp" 2>/dev/null)"; then
    printf 'error: .temp を canonical 化できません: %s\n' "$repo_root" >&2
    exit 2
  fi
  if [ "$canon_test_root" != "$canon_temp" ] && [[ "$canon_test_root" != "$canon_temp/"* ]]; then
    printf 'error: --test-root は %s 自身またはその配下に限ります: %s\n' "$canon_temp" "$(disp "$canon_test_root")" >&2
    exit 2
  fi
  CANON_TEMP="$canon_temp"
  test_mode=1
  VSCODE_BASE="$canon_test_root"
  VSCODE_ROOT="$canon_test_root/vscode"
fi

# ---------------------------------------------------------------------------
# 観測
# ---------------------------------------------------------------------------

declare -A OBS_FSKEY OBS_STATUS FS_MEMBERS FS_REPR FS_BEF_AVAIL FS_BEF_CAP
FS_ORDER=()
ROOT_CAP_PCT=""
ROOT_AVAIL_BYTES=""
ROOT_INODE_PCT=""
VSCODE_MOUNT=""
OP_FAIL=0

observe_path() {
  local label="$1" path="$2"
  if [ ! -e "$path" ]; then
    printf '[%s] %s: 存在しない (対象外)\n' "$label" "$path"
    OBS_STATUS[$label]="missing"
    return 0
  fi
  local canon dev dp di
  if ! canon="$(realpath -m -- "$path" 2>/dev/null)"; then
    printf '[%s] %s: canonical 化失敗 (観測不能)\n' "$label" "$path"
    OBS_STATUS[$label]="failed"
    OP_FAIL=$((OP_FAIL + 1))
    return 0
  fi
  dev="$(stat -c %d -- "$path" 2>/dev/null)" || dev="?"
  if ! dp="$(df -Pk -- "$path" 2>/dev/null)" || ! di="$(df -Pi -- "$path" 2>/dev/null)"; then
    printf '[%s] %s: df 失敗 (観測不能)\n' "$label" "$path"
    OBS_STATUS[$label]="failed"
    OP_FAIL=$((OP_FAIL + 1))
    return 0
  fi
  local fs blocks used avail cap mount icap
  IFS=$'\t' read -r fs blocks used avail cap mount <<<"$(awk 'NR==2 {
    fs = ""; for (i = 1; i <= NF - 5; i++) fs = (i == 1 ? $i : fs " " $i)
    printf "%s\t%s\t%s\t%s\t%s\t%s", fs, $(NF-4), $(NF-3), $(NF-2), $(NF-1), $NF
  }' <<<"$dp")"
  icap="$(awk 'NR==2 {print $(NF-1)}' <<<"$di")"
  if ! fits_kib "$avail" || ! fits_kib "$used"; then
    printf '[%s] %s: df 出力を解釈できない (観測不能)\n' "$label" "$path"
    OBS_STATUS[$label]="failed"
    OP_FAIL=$((OP_FAIL + 1))
    return 0
  fi
  cap="${cap%\%}"
  icap="${icap%\%}"
  [[ "$cap" =~ ^[0-9]+$ ]] || cap="?"
  [[ "$icap" =~ ^[0-9]+$ ]] || icap="?"
  local avail_bytes=$((avail * 1024))
  printf '[%s] %s\n' "$label" "$path"
  printf '  canonical=%s device=%s\n' "$canon" "$dev"
  printf '  filesystem=%s mount=%s used=%s avail=%s capacity=%s%% inode_use=%s%%\n' \
    "$fs" "$mount" "$(human "$((used * 1024))")" "$(human "$avail_bytes")" "$cap" "$icap"
  local key="$fs @ $mount"
  OBS_FSKEY[$label]="$key"
  OBS_STATUS[$label]="ok"
  if [ -z "${FS_MEMBERS[$key]:-}" ]; then
    FS_ORDER+=("$key")
    FS_MEMBERS[$key]="$label"
    FS_REPR[$key]="$path"
    FS_BEF_AVAIL[$key]="$avail_bytes"
    FS_BEF_CAP[$key]="$cap"
  else
    FS_MEMBERS[$key]="${FS_MEMBERS[$key]} $label"
  fi
  case "$label" in
    /)
      ROOT_CAP_PCT="$cap"
      ROOT_AVAIL_BYTES="$avail_bytes"
      ROOT_INODE_PCT="$icap"
      ;;
    /vscode)
      VSCODE_MOUNT="$mount"
      ;;
  esac
}

printf '== clean-devcontainer-disk ==\n'
printf 'repo: %s\n' "$repo_root"
[ "$dry_run" = "1" ] && printf 'mode: dry-run (削除は実行しない)\n'
[ "$test_mode" = "1" ] && printf 'mode: test (test root: %s)\n' "$VSCODE_ROOT"

printf '== 観測 ==\n'
observe_path "/" "/"
observe_path "/vscode" "$VSCODE_ROOT"
observe_path "HOME" "$HOME"
observe_path "workspace" "$repo_root"

printf 'filesystem 同一性:\n'
for key in "${FS_ORDER[@]}"; do
  printf '  %s: %s\n' "$key" "${FS_MEMBERS[$key]}"
done

# repository 実体が host mount 上にあるかは実行時の filesystem identity でのみ判断する
if [ -n "${OBS_FSKEY[workspace]:-}" ] && [ "${OBS_FSKEY[workspace]:-}" = "${OBS_FSKEY[/]:-}" ]; then
  temp_display="$(human 0)"
  if [ -d "$repo_root/.temp" ]; then
    # .temp/ は entry 数が多いと du の全走査が長引く。報告は情報提供で掃除の可否判定には
    # 使わないため、上限を超えたら計測不能として先へ進む (無言の 0B 表示にはしない)
    if temp_bytes="$(timeout "$TEMP_MEASURE_TIMEOUT_SECONDS" du -sb -- "$repo_root/.temp" 2>/dev/null | awk 'NR==1 {print $1}')" \
      && [[ "$temp_bytes" =~ ^[0-9]+$ ]]; then
      temp_display="$(human "$temp_bytes")"
    else
      temp_display="計測不能"
    fi
  fi
  printf 'workspace は / と同一 filesystem: repository の .temp/ (%s) はコンテナディスクを圧迫し得る (手動 emergency 候補。本スクリプトの自動削除対象ではない)\n' "$temp_display"
else
  printf 'workspace は / と別 filesystem: repository の .temp/ はコンテナディスクを圧迫しない\n'
fi

# / を観測できないと閾値判定も before/after 報告も成立しないため fail-safe で中止する
if [ "${OBS_STATUS[/]:-failed}" != "ok" ]; then
  printf 'error: / を観測できないため掃除を中止する\n' >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 閾値判定
# ---------------------------------------------------------------------------

if [ "$threshold_mode" = "1" ]; then
  printf '== 閾値判定 ==\n'
  printf 'threshold: pct=%s min_free_bytes=%s (%s)\n' "$threshold_pct" "$min_free_bytes" "$(human "$min_free_bytes")"
  run_cleanup=0
  gate_reasons=""
  if [ "$ROOT_CAP_PCT" != "?" ] && [ "$ROOT_CAP_PCT" -ge "$threshold_pct" ]; then
    run_cleanup=1
    gate_reasons="capacity ${ROOT_CAP_PCT}% >= ${threshold_pct}%"
  fi
  if [ "$ROOT_AVAIL_BYTES" -lt "$min_free_bytes" ]; then
    run_cleanup=1
    gate_reasons="${gate_reasons:+$gate_reasons, }avail ${ROOT_AVAIL_BYTES} bytes < ${min_free_bytes} bytes"
  fi
  if [ "$ROOT_INODE_PCT" != "?" ] && [ "$ROOT_INODE_PCT" -ge "$threshold_pct" ]; then
    run_cleanup=1
    gate_reasons="${gate_reasons:+$gate_reasons, }inode ${ROOT_INODE_PCT}% >= ${threshold_pct}%"
  fi
  if [ "$run_cleanup" = "0" ]; then
    printf '/ は閾値未満 (capacity=%s%% avail=%s inode=%s%%) のため掃除しない\n' \
      "$ROOT_CAP_PCT" "$(human "$ROOT_AVAIL_BYTES")" "$ROOT_INODE_PCT"
    # 掃除を行わない経路でも観測の失敗は起動 hook へ返す (no-op と観測不能は別状態)
    if [ "$OP_FAIL" -gt 0 ]; then
      printf '結果: operational failure %s 件 → exit 1\n' "$OP_FAIL"
      exit 1
    fi
    exit 0
  fi
  if [ "$dry_run" = "1" ]; then
    printf '閾値超過 (%s) → dry-run のため候補表示のみ行う\n' "$gate_reasons"
  else
    printf '閾値超過 (%s) → 掃除を実行する\n' "$gate_reasons"
  fi
else
  if [ "$dry_run" = "1" ]; then
    printf '無条件モード (閾値引数なし) → dry-run のため候補表示のみ行う\n'
  else
    printf '無条件モード (引数なし) → 掃除を実行する\n'
  fi
fi

# ---------------------------------------------------------------------------
# category
# ---------------------------------------------------------------------------

CAT_ORDER=()
declare -A CAT_STATUS CAT_CAND CAT_RECL CAT_SKIP CAT_UNREC CAT_BEFORE CAT_AFTER

cat_record() {
  local id="$1"
  CAT_ORDER+=("$id")
  CAT_STATUS[$id]="$2"
  CAT_CAND[$id]="$3"
  CAT_RECL[$id]="$4"
  CAT_SKIP[$id]="$5"
  CAT_UNREC[$id]="$6"
  CAT_BEFORE[$id]="$7"
  CAT_AFTER[$id]="$8"
}

refresh_ps

# extensionsCache は directory 一括削除をしない。完成済み形式の direct child で、
# process listing が取得成功していて entry を参照する process がなく、削除直前の
# 再検証でも同じ状態の entry だけを削除する
clean_extensions_cache() {
  local id="$1" root="$2" expected="$3" shared="$4" needsudo="$5" vbase="$6"
  local cand=0 recl=0 skip=0 unrec=0 before=0 status="ok"
  printf '== category: %s ==\n' "$id"
  printf 'root: %s\n' "$root"
  root_guard "$root" "$expected" "$vbase"
  case "$RG_STATUS" in
    missing)
      printf '  no-op: root が存在しない\n'
      cat_record "$id" "no-op" 0 0 0 0 0 0
      return 0
      ;;
    unsafe)
      printf '  skip: root または中間 component が symlink、または canonical path が allowlist と一致しない\n'
      cat_record "$id" "skipped" 0 0 0 0 0 0
      return 0
      ;;
    error)
      printf '  failed: root の canonical 化に失敗\n'
      OP_FAIL=$((OP_FAIL + 1))
      cat_record "$id" "failed" 0 0 0 0 0 0
      return 0
      ;;
  esac
  if ! before="$(entry_bytes "$root")"; then
    printf '  failed: du 失敗\n'
    OP_FAIL=$((OP_FAIL + 1))
    cat_record "$id" "failed" 0 0 0 0 0 0
    return 0
  fi
  printf '  before: %s (%s bytes)\n' "$(human "$before")" "$before"
  local entries=()
  if ! enum_children "$root" entries; then
    printf '  failed: 列挙失敗\n'
    OP_FAIL=$((OP_FAIL + 1))
    cat_record "$id" "failed" 0 0 0 0 0 0
    return 0
  fi
  local candidates=()
  local candidate_sizes=()
  local candidate_ids=()
  local e base sz cid
  for e in "${entries[@]}"; do
    base="${e##*/}"
    if [ -L "$e" ]; then
      printf '  skip: %s (symlink)\n' "$(disp "$base")"
      continue
    fi
    if ! basename_safe "$base" || [[ ! "$base" =~ $EXT_CACHE_FMT ]]; then
      printf '  skip: %s (完成済み形式ではない / lock / partial)\n' "$(disp "$base")"
      continue
    fi
    if [ ! -f "$e" ]; then
      printf '  skip: %s (regular file ではない)\n' "$(disp "$base")"
      continue
    fi
    if ! sz="$(entry_bytes "$e")"; then
      printf '  failed: %s (du 失敗)\n' "$(disp "$base")"
      status="partial"
      OP_FAIL=$((OP_FAIL + 1))
      continue
    fi
    if [ "$shared" = "1" ]; then
      # 共有 volume 上では他 container が entry を使用中かどうか現在 container から
      # 証明できないため、削除はせず手動確認候補として提示するに留める
      printf '  manual-candidate: %s (%s) — 共有 /vscode volume 上のため自動削除しない\n' "$(disp "$base")" "$(human "$sz")"
      skip=$((skip + sz))
      continue
    fi
    if [ "$PS_STATE" != "ok" ]; then
      printf '  skip: %s (%s) (process listing が unknown: 非使用を証明できない)\n' "$(disp "$base")" "$(human "$sz")"
      skip=$((skip + sz))
      continue
    fi
    if ps_refs "$base"; then
      printf '  skip: %s (%s) (process が entry を参照: active)\n' "$(disp "$base")" "$(human "$sz")"
      skip=$((skip + sz))
      continue
    fi
    if ! cid="$(entry_id "$e")"; then
      printf '  failed: %s (stat 失敗)\n' "$(disp "$base")"
      status="partial"
      OP_FAIL=$((OP_FAIL + 1))
      continue
    fi
    printf '  candidate: %s (%s)\n' "$(disp "$base")" "$(human "$sz")"
    candidates+=("$e")
    candidate_sizes+=("$sz")
    candidate_ids+=("$cid")
    cand=$((cand + sz))
  done
  if [ "$dry_run" = "1" ]; then
    printf '  [dry-run] 削除は実行しない\n'
    if [ "$needsudo" = "1" ] && [ "${#candidates[@]}" -gt 0 ]; then
      printf '  [dry-run] 実行時は sudo -n による権限昇格が必要 (dry-run では sudo を呼ばない)\n'
    fi
  else
    # 権限昇格の preflight は候補確定後にだけ行う。利用不能なら category failure
    if [ "$needsudo" = "1" ] && [ "${#candidates[@]}" -gt 0 ] && ! sudo -n true 2>/dev/null; then
      printf '  failed: sudo -n が利用できない (候補 %s を回収できない)\n' "$(human "$cand")"
      OP_FAIL=$((OP_FAIL + 1))
      cat_record "$id" "failed (sudo 不可)" "$cand" 0 "$skip" "$cand" "$before" "$before"
      return 0
    fi
    local i
    for i in "${!candidates[@]}"; do
      e="${candidates[$i]}"
      sz="${candidate_sizes[$i]}"
      base="${e##*/}"
      refresh_ps
      if [ "$PS_STATE" != "ok" ]; then
        printf '  skip: %s (削除直前の process listing が unknown)\n' "$(disp "$base")"
        skip=$((skip + sz))
        continue
      fi
      if ps_refs "$base"; then
        printf '  skip: %s (削除直前に process 参照を検出)\n' "$(disp "$base")"
        skip=$((skip + sz))
        continue
      fi
      local rv=0
      revalidate_entry "$root" "$e" "$EXT_CACHE_FMT" "" "$expected" "${candidate_ids[$i]}" || rv=$?
      if [ "$rv" = "2" ]; then
        printf '  skip: %s (race で消失)\n' "$(disp "$base")"
        skip=$((skip + sz))
        continue
      fi
      if [ "$rv" != "0" ]; then
        printf '  skip: %s (削除直前の再検証に失敗)\n' "$(disp "$base")"
        skip=$((skip + sz))
        continue
      fi
      if delete_entry "$needsudo" "$e"; then
        printf '  deleted: %s (%s)\n' "$(disp "$base")" "$(human "$sz")"
        recl=$((recl + sz))
      else
        printf '  failed: %s (削除失敗)\n' "$(disp "$base")"
        unrec=$((unrec + sz))
        status="partial"
        OP_FAIL=$((OP_FAIL + 1))
      fi
    done
  fi
  if [ "$status" = "ok" ]; then
    if [ "$shared" = "1" ]; then
      status="skipped (共有 volume: 手動確認候補のみ)"
    elif [ "$skip" -gt 0 ]; then
      status="ok (safety skip あり)"
    elif [ "$cand" -eq 0 ]; then
      status="ok (候補なし)"
    fi
  fi
  cat_record "$id" "$status" "$cand" "$recl" "$skip" "$unrec" "$before" "$((before - recl))"
}

# npm cache は npm 自身が満杯で起動不能な場合に備え、npm 経路と、HOME / canonical
# path を検証した _cacache 直接削除の 2 経路を持つ。他の npm directory は対象にしない。
# 他 category と違い process gate は持たない。npm script 経由で起動されると自分の親
# npm を active と誤検出して恒常 skip になるうえ、_cacache は content-addressed で
# 削除しても次回取得で復元されるため
clean_npm_cache() {
  local id="npm-cacache"
  # root は検証済み canonical base (CANON_HOME) から構成し、literal path の中間
  # component 検証と削除対象の一致性を保つ (HOME 自体が symlink でも同じ実体を指す)
  local root="$CANON_HOME/.npm/_cacache"
  local expected="$CANON_HOME/.npm/_cacache"
  local before=0 cand=0 recl=0 skip=0 unrec=0 status="ok"
  printf '== category: %s ==\n' "$id"
  printf 'root: %s\n' "$root"
  root_guard "$root" "$expected" "$CANON_HOME"
  case "$RG_STATUS" in
    missing)
      printf '  no-op: root が存在しない\n'
      cat_record "$id" "no-op" 0 0 0 0 0 0
      return 0
      ;;
    unsafe)
      printf '  skip: root または中間 component が symlink、または canonical path が allowlist と一致しない\n'
      cat_record "$id" "skipped" 0 0 0 0 0 0
      return 0
      ;;
    error)
      printf '  failed: root の canonical 化に失敗\n'
      OP_FAIL=$((OP_FAIL + 1))
      cat_record "$id" "failed" 0 0 0 0 0 0
      return 0
      ;;
  esac
  local root_id="$RG_ID"
  if ! before="$(entry_bytes "$root")"; then
    printf '  failed: du 失敗\n'
    OP_FAIL=$((OP_FAIL + 1))
    cat_record "$id" "failed" 0 0 0 0 0 0
    return 0
  fi
  printf '  before: %s (%s bytes)\n' "$(human "$before")" "$before"
  cand="$before"
  if [ "$dry_run" = "1" ]; then
    printf '  candidate: _cacache 全体 (%s)。npm cache clean --force、失敗時は検証済み直接削除\n' "$(human "$before")"
    printf '  [dry-run] 削除は実行しない\n'
    cat_record "$id" "$([ "$before" -gt 0 ] && printf 'ok' || printf 'ok (候補なし)')" "$cand" 0 0 0 "$before" "$before"
    return 0
  fi
  # npm の cache 設定が allowlist 外を指す場合に npm 経路で掃除範囲が変わるため、
  # 設定を検証できない場合は npm 経路を使わない。経路を使う場合も削除対象を
  # --cache で固定し、検証後に npm が設定を読み直しても allowlist 外へ出られない
  # ようにする
  local npm_route_ok=0
  if command -v npm >/dev/null 2>&1; then
    local cfg cfg_canon
    if cfg="$(npm config get cache 2>/dev/null)" && [ -n "$cfg" ]; then
      if cfg_canon="$(realpath -m -- "$cfg" 2>/dev/null)"; then
        [ "$cfg_canon" = "$CANON_HOME/.npm" ] && npm_route_ok=1
      fi
    fi
  fi
  local npm_failed=0
  local npm_out=""
  if [ "$npm_route_ok" = "1" ]; then
    if ! root_still_intact "$root" "$expected" "$CANON_HOME" "$root_id"; then
      printf '  skip: 実行直前に root の canonical path / 中間 component / identity が変化した\n'
      cat_record "$id" "skipped (root 変化)" "$cand" 0 "$before" 0 "$before" "$before"
      return 0
    fi
    printf '  npm cache clean --force --cache %s を実行\n' "$CANON_HOME/.npm"
    if npm_out="$(npm cache clean --force --cache "$CANON_HOME/.npm" 2>&1)"; then
      local after=0
      if [ -e "$root" ]; then
        if ! after="$(entry_bytes "$root")"; then
          printf '  failed: npm 経路の回収後に du 失敗 (回収量を確定できない)\n'
          OP_FAIL=$((OP_FAIL + 1))
          cat_record "$id" "partial (npm 経路; after 観測失敗)" "$cand" 0 0 "$before" "$before" "$before"
          return 0
        fi
      fi
      recl=$((before > after ? before - after : 0))
      printf '  reclaimed: %s (after: %s)\n' "$(human "$recl")" "$(human "$after")"
      cat_record "$id" "ok (npm 経路)" "$cand" "$recl" 0 0 "$before" "$after"
      return 0
    fi
    npm_failed=1
    printf '  npm cache clean --force が失敗。検証済み直接削除へフォールバック\n'
    printf '%s\n' "$npm_out" | head -5 | sed 's/^/    npm: /' || true
  else
    npm_failed=1
    printf '  npm が不在または cache 設定を検証できない。検証済み直接削除へフォールバック\n'
  fi
  # npm 経路の失敗自体を operational failure として記録する (直接削除で回収できても
  # npm が起動不能な環境は異常なので呼び出し側に返す)
  OP_FAIL=$((OP_FAIL + 1))
  local entries=()
  if ! enum_children "$root" entries; then
    printf '  failed: 列挙失敗\n'
    OP_FAIL=$((OP_FAIL + 1))
    cat_record "$id" "failed" "$cand" 0 0 0 "$before" "$before"
    return 0
  fi
  local e base sz cid
  for e in "${entries[@]}"; do
    base="${e##*/}"
    if [ -L "$e" ]; then
      printf '  skip: %s (symlink)\n' "$(disp "$base")"
      continue
    fi
    if ! basename_safe "$base"; then
      printf '  skip: %s (basename が安全でない)\n' "$(disp "$base")"
      continue
    fi
    if ! sz="$(entry_bytes "$e")"; then
      printf '  failed: %s (du 失敗)\n' "$(disp "$base")"
      status="partial"
      OP_FAIL=$((OP_FAIL + 1))
      continue
    fi
    if ! cid="$(entry_id "$e")"; then
      printf '  failed: %s (stat 失敗)\n' "$(disp "$base")"
      status="partial"
      OP_FAIL=$((OP_FAIL + 1))
      continue
    fi
    local rv=0
    revalidate_entry "$root" "$e" "" "" "$expected" "$cid" || rv=$?
    if [ "$rv" = "2" ]; then
      printf '  skip: %s (race で消失)\n' "$(disp "$base")"
      skip=$((skip + sz))
      continue
    fi
    if [ "$rv" != "0" ]; then
      printf '  skip: %s (削除直前の再検証に失敗)\n' "$(disp "$base")"
      skip=$((skip + sz))
      continue
    fi
    if delete_entry 0 "$e"; then
      printf '  deleted: %s (%s)\n' "$(disp "$base")" "$(human "$sz")"
      recl=$((recl + sz))
    else
      printf '  failed: %s (削除失敗)\n' "$(disp "$base")"
      unrec=$((unrec + sz))
      status="partial"
      OP_FAIL=$((OP_FAIL + 1))
    fi
  done
  if [ "$status" = "ok" ]; then
    status="ok (fallback 直接削除; npm 経路は失敗)"
  fi
  cat_record "$id" "$status" "$cand" "$recl" "$skip" "$unrec" "$before" "$((before - recl))"
}

# cursor-agent の旧世代。process 状態が clear のときだけ、version 形式を検証して
# retained set (最大日付の全世代 + allowlist 内を指す agent symlink の target 世代)
# を固定し、それ以外を候補にする。同日世代は git hash 順と release 順が一致しない
# ため曖昧として全保持し、削除中は各削除前に retained set の identity を再確認する
clean_cursor_versions() {
  local id="cursor-agent-versions"
  local root="$CANON_HOME/.local/share/cursor-agent/versions"
  local expected="$CANON_HOME/.local/share/cursor-agent/versions"
  local before=0 cand=0 recl=0 skip=0 unrec=0 status="ok"
  printf '== category: %s ==\n' "$id"
  printf 'root: %s\n' "$root"
  root_guard "$root" "$expected" "$CANON_HOME"
  case "$RG_STATUS" in
    missing)
      printf '  no-op: root が存在しない\n'
      cat_record "$id" "no-op" 0 0 0 0 0 0
      return 0
      ;;
    unsafe)
      printf '  skip: root または中間 component が symlink、または canonical path が allowlist と一致しない\n'
      cat_record "$id" "skipped" 0 0 0 0 0 0
      return 0
      ;;
    error)
      printf '  failed: root の canonical 化に失敗\n'
      OP_FAIL=$((OP_FAIL + 1))
      cat_record "$id" "failed" 0 0 0 0 0 0
      return 0
      ;;
  esac
  if [ "$PS_STATE" != "ok" ] || ps_match "$CURSOR_PROC_RE"; then
    local reason
    if [ "$PS_STATE" != "ok" ]; then
      reason="skipped (process unknown)"
      printf '  skip: process listing が unknown (非使用を証明できない)\n'
    else
      reason="skipped (active)"
      printf '  skip: cursor-agent process が active\n'
      print_proc_matches "$CURSOR_PROC_RE"
    fi
    # 判定不能 / active でも容量診断に使えるよう、削除はせずサイズだけ測って
    # 全量 skipped に計上する
    local skipped_bytes
    if ! skipped_bytes="$(entry_bytes "$root")"; then
      printf '  failed: du 失敗\n'
      OP_FAIL=$((OP_FAIL + 1))
      cat_record "$id" "failed" 0 0 0 0 0 0
      return 0
    fi
    printf '  skipped: %s (%s bytes)\n' "$(human "$skipped_bytes")" "$skipped_bytes"
    cat_record "$id" "$reason" 0 0 "$skipped_bytes" 0 "$skipped_bytes" "$skipped_bytes"
    return 0
  fi
  printf '  process 状態: clear\n'
  if ! before="$(entry_bytes "$root")"; then
    printf '  failed: du 失敗\n'
    OP_FAIL=$((OP_FAIL + 1))
    cat_record "$id" "failed" 0 0 0 0 0 0
    return 0
  fi
  printf '  before: %s (%s bytes)\n' "$(human "$before")" "$before"
  local entries=()
  if ! enum_children "$root" entries; then
    printf '  failed: 列挙失敗\n'
    OP_FAIL=$((OP_FAIL + 1))
    cat_record "$id" "failed" 0 0 0 0 0 0
    return 0
  fi
  local valid=()
  local e base sz cid rid rn
  for e in "${entries[@]}"; do
    base="${e##*/}"
    if [ -L "$e" ]; then
      printf '  skip: %s (symlink)\n' "$(disp "$base")"
      continue
    fi
    if [ ! -d "$e" ]; then
      printf '  skip: %s (directory ではない)\n' "$(disp "$base")"
      continue
    fi
    if ! basename_safe "$base" || [[ ! "$base" =~ $CURSOR_VER_FMT ]]; then
      printf '  skip: %s (未知の version 形式)\n' "$(disp "$base")"
      continue
    fi
    valid+=("$e")
  done
  if [ "${#valid[@]}" -eq 0 ]; then
    printf '  候補なし\n'
    cat_record "$id" "ok (候補なし)" 0 0 0 0 "$before" "$before"
    return 0
  fi
  local maxdate=""
  for e in "${valid[@]}"; do
    base="${e##*/}"
    if [ -z "$maxdate" ] || [[ "${base:0:10}" > "$maxdate" ]]; then
      maxdate="${base:0:10}"
    fi
  done
  local retained_list=""
  local retained_ids=""
  for e in "${valid[@]}"; do
    base="${e##*/}"
    if [ "${base:0:10}" = "$maxdate" ]; then
      retained_list="${retained_list:+$retained_list$'\n'}$base"
      if ! rid="$(stat -c '%d:%i' -- "$e" 2>/dev/null)"; then
        printf '  failed: %s (stat 失敗)\n' "$(disp "$base")"
        OP_FAIL=$((OP_FAIL + 1))
        cat_record "$id" "failed" 0 0 0 0 "$before" "$before"
        return 0
      fi
      retained_ids="${retained_ids:+$retained_ids$'\n'}$base"$'\t'"$rid"
    fi
  done
  printf '  retained (最大日付 %s の世代は曖昧として全保持):\n' "$maxdate"
  while IFS= read -r rn; do
    printf '    %s\n' "$(disp "$rn")"
  done <<<"$retained_list"
  # updater が現在指している世代を消すと ~/.local/bin/agent が壊れるため、
  # allowlist 内を指す target の世代も保持する
  local agent_link="$HOME/.local/bin/agent"
  if [ -L "$agent_link" ]; then
    local tgt rel agen
    if tgt="$(realpath -m -- "$agent_link" 2>/dev/null)"; then
      case "$tgt" in
        "$expected/"*)
          rel="${tgt#"$expected"/}"
          agen="${rel%%/*}"
          if [[ "$agen" =~ $CURSOR_VER_FMT ]] && ! in_list "$agen" "$retained_list"; then
            retained_list="${retained_list:+$retained_list$'\n'}$agen"
            printf '  retained (agent symlink target): %s\n' "$(disp "$agen")"
            if [ -d "$root/$agen" ] && [ ! -L "$root/$agen" ]; then
              if rid="$(stat -c '%d:%i' -- "$root/$agen" 2>/dev/null)"; then
                retained_ids="${retained_ids:+$retained_ids$'\n'}$agen"$'\t'"$rid"
              fi
            fi
          fi
          ;;
      esac
    fi
  fi
  local candidates=()
  local candidate_sizes=()
  local candidate_ids=()
  for e in "${valid[@]}"; do
    base="${e##*/}"
    if in_list "$base" "$retained_list"; then
      continue
    fi
    if ! sz="$(entry_bytes "$e")"; then
      printf '  failed: %s (du 失敗)\n' "$(disp "$base")"
      status="partial"
      OP_FAIL=$((OP_FAIL + 1))
      continue
    fi
    if ! cid="$(entry_id "$e")"; then
      printf '  failed: %s (stat 失敗)\n' "$(disp "$base")"
      status="partial"
      OP_FAIL=$((OP_FAIL + 1))
      continue
    fi
    printf '  candidate: %s (%s)\n' "$(disp "$base")" "$(human "$sz")"
    candidates+=("$e")
    candidate_sizes+=("$sz")
    candidate_ids+=("$cid")
    cand=$((cand + sz))
  done
  if [ "${#candidates[@]}" -eq 0 ]; then
    printf '  旧世代なし (retained set のみ)\n'
    cat_record "$id" "ok (候補なし)" 0 0 0 0 "$before" "$before"
    return 0
  fi
  if [ "$dry_run" = "1" ]; then
    printf '  [dry-run] 削除は実行しない\n'
  else
    local i
    for i in "${!candidates[@]}"; do
      e="${candidates[$i]}"
      sz="${candidate_sizes[$i]}"
      base="${e##*/}"
      refresh_ps
      if [ "$PS_STATE" != "ok" ] || ps_match "$CURSOR_PROC_RE"; then
        printf '  skip: %s (削除直前に cursor-agent が active / unknown)\n' "$(disp "$base")"
        skip=$((skip + sz))
        continue
      fi
      if ! retained_set_intact "$root" "$retained_ids"; then
        local remaining=0 j
        for ((j = i; j < ${#candidates[@]}; j++)); do
          remaining=$((remaining + candidate_sizes[j]))
        done
        printf '  skip: retained set の存在・type・identity が変化したため残り %s 件 (%s) を skip\n' \
          "$((${#candidates[@]} - i))" "$(human "$remaining")"
        skip=$((skip + remaining))
        break
      fi
      local rv=0
      revalidate_entry "$root" "$e" "$CURSOR_VER_FMT" "$retained_list" "$expected" "${candidate_ids[$i]}" || rv=$?
      if [ "$rv" = "2" ]; then
        printf '  skip: %s (race で消失)\n' "$(disp "$base")"
        skip=$((skip + sz))
        continue
      fi
      if [ "$rv" != "0" ]; then
        printf '  skip: %s (削除直前の再検証に失敗)\n' "$(disp "$base")"
        skip=$((skip + sz))
        continue
      fi
      if delete_entry 0 "$e"; then
        printf '  deleted: %s (%s)\n' "$(disp "$base")" "$(human "$sz")"
        recl=$((recl + sz))
      else
        printf '  failed: %s (削除失敗)\n' "$(disp "$base")"
        unrec=$((unrec + sz))
        status="partial"
        OP_FAIL=$((OP_FAIL + 1))
      fi
    done
  fi
  if [ "$status" = "ok" ] && [ "$skip" -gt 0 ]; then
    status="ok (safety skip あり)"
  fi
  cat_record "$id" "$status" "$cand" "$recl" "$skip" "$unrec" "$before" "$((before - recl))"
}

# codex process が 1 つでも居ると .tmp の非使用を証明できない。openai.chatgpt
# extension 由来の codex app-server が常駐する環境では恒常 skip が正常な観測である
clean_codex_tmp() {
  local id="codex-tmp"
  local root="$CANON_HOME/.codex/.tmp"
  local expected="$CANON_HOME/.codex/.tmp"
  local before=0 cand=0 recl=0 skip=0 unrec=0 status="ok"
  printf '== category: %s ==\n' "$id"
  printf 'root: %s\n' "$root"
  root_guard "$root" "$expected" "$CANON_HOME"
  case "$RG_STATUS" in
    missing)
      printf '  no-op: root が存在しない\n'
      cat_record "$id" "no-op" 0 0 0 0 0 0
      return 0
      ;;
    unsafe)
      printf '  skip: root または中間 component が symlink、または canonical path が allowlist と一致しない\n'
      cat_record "$id" "skipped" 0 0 0 0 0 0
      return 0
      ;;
    error)
      printf '  failed: root の canonical 化に失敗\n'
      OP_FAIL=$((OP_FAIL + 1))
      cat_record "$id" "failed" 0 0 0 0 0 0
      return 0
      ;;
  esac
  if [ "$PS_STATE" != "ok" ] || ps_match "$CODEX_PROC_RE"; then
    local reason
    if [ "$PS_STATE" != "ok" ]; then
      reason="skipped (process unknown)"
      printf '  skip: process listing が unknown (非使用を証明できない)\n'
    else
      reason="skipped (active)"
      printf '  skip: codex process が active (app-server 常駐環境ではこの skip は正常)\n'
      print_proc_matches "$CODEX_PROC_RE"
    fi
    # 判定不能 / active でも容量診断に使えるよう、削除はせずサイズだけ測って
    # 全量 skipped に計上する
    local skipped_bytes
    if ! skipped_bytes="$(entry_bytes "$root")"; then
      printf '  failed: du 失敗\n'
      OP_FAIL=$((OP_FAIL + 1))
      cat_record "$id" "failed" 0 0 0 0 0 0
      return 0
    fi
    printf '  skipped: %s (%s bytes)\n' "$(human "$skipped_bytes")" "$skipped_bytes"
    cat_record "$id" "$reason" 0 0 "$skipped_bytes" 0 "$skipped_bytes" "$skipped_bytes"
    return 0
  fi
  printf '  process 状態: clear\n'
  if ! before="$(entry_bytes "$root")"; then
    printf '  failed: du 失敗\n'
    OP_FAIL=$((OP_FAIL + 1))
    cat_record "$id" "failed" 0 0 0 0 0 0
    return 0
  fi
  printf '  before: %s (%s bytes)\n' "$(human "$before")" "$before"
  local entries=()
  if ! enum_children "$root" entries; then
    printf '  failed: 列挙失敗\n'
    OP_FAIL=$((OP_FAIL + 1))
    cat_record "$id" "failed" 0 0 0 0 0 0
    return 0
  fi
  local candidates=()
  local candidate_sizes=()
  local candidate_ids=()
  local e base sz cid
  for e in "${entries[@]}"; do
    base="${e##*/}"
    if [ -L "$e" ]; then
      printf '  skip: %s (symlink)\n' "$(disp "$base")"
      continue
    fi
    if ! basename_safe "$base"; then
      printf '  skip: %s (basename が安全でない)\n' "$(disp "$base")"
      continue
    fi
    if ! sz="$(entry_bytes "$e")"; then
      printf '  failed: %s (du 失敗)\n' "$(disp "$base")"
      status="partial"
      OP_FAIL=$((OP_FAIL + 1))
      continue
    fi
    if ! cid="$(entry_id "$e")"; then
      printf '  failed: %s (stat 失敗)\n' "$(disp "$base")"
      status="partial"
      OP_FAIL=$((OP_FAIL + 1))
      continue
    fi
    printf '  candidate: %s (%s)\n' "$(disp "$base")" "$(human "$sz")"
    candidates+=("$e")
    candidate_sizes+=("$sz")
    candidate_ids+=("$cid")
    cand=$((cand + sz))
  done
  if [ "${#candidates[@]}" -eq 0 ]; then
    printf '  候補なし\n'
    cat_record "$id" "ok (候補なし)" 0 0 0 0 "$before" "$before"
    return 0
  fi
  if [ "$dry_run" = "1" ]; then
    printf '  [dry-run] 削除は実行しない\n'
  else
    local i
    for i in "${!candidates[@]}"; do
      e="${candidates[$i]}"
      sz="${candidate_sizes[$i]}"
      base="${e##*/}"
      refresh_ps
      if [ "$PS_STATE" != "ok" ] || ps_match "$CODEX_PROC_RE"; then
        printf '  skip: %s (削除直前に codex process が active / unknown)\n' "$(disp "$base")"
        skip=$((skip + sz))
        continue
      fi
      local rv=0
      revalidate_entry "$root" "$e" "" "" "$expected" "${candidate_ids[$i]}" || rv=$?
      if [ "$rv" = "2" ]; then
        printf '  skip: %s (race で消失)\n' "$(disp "$base")"
        skip=$((skip + sz))
        continue
      fi
      if [ "$rv" != "0" ]; then
        printf '  skip: %s (削除直前の再検証に失敗)\n' "$(disp "$base")"
        skip=$((skip + sz))
        continue
      fi
      if delete_entry 0 "$e"; then
        printf '  deleted: %s (%s)\n' "$(disp "$base")" "$(human "$sz")"
        recl=$((recl + sz))
      else
        printf '  failed: %s (削除失敗)\n' "$(disp "$base")"
        unrec=$((unrec + sz))
        status="partial"
        OP_FAIL=$((OP_FAIL + 1))
      fi
    done
  fi
  if [ "$status" = "ok" ] && [ "$skip" -gt 0 ]; then
    status="ok (safety skip あり)"
  fi
  cat_record "$id" "$status" "$cand" "$recl" "$skip" "$unrec" "$before" "$((before - recl))"
}

# /vscode 側 extensionsCache。共有 named volume の独立 mount 上にある場合は他
# container の liveness を証明できないため全 entry を手動確認候補に留める。
# mount でない (共有でない) と観測できた場合だけ sudo -n で削除する
clean_vscode_ext_cache() {
  local id="vscode-extensions-cache"
  local root="$VSCODE_ROOT/vscode-server/extensionsCache"
  # expected は検証済み canonical base (production の固定 /、test mode では .temp/
  # 配下と検証済みの canonical test root) と固定 suffix の連結で作る。root 自身の
  # realpath から生成すると、中間 component の symlink による脱出と自己一致する
  local expected="$VSCODE_ROOT/vscode-server/extensionsCache"
  if [ ! -e "$root" ]; then
    printf '== category: %s ==\n' "$id"
    printf 'root: %s\n' "$root"
    printf '  no-op: root が存在しない\n'
    cat_record "$id" "no-op" 0 0 0 0 0 0
    return 0
  fi
  if [ "${OBS_STATUS[/vscode]:-failed}" != "ok" ]; then
    printf '== category: %s ==\n' "$id"
    printf 'root: %s\n' "$root"
    printf '  skip: /vscode の filesystem 観測に失敗しているため共有かどうか判定できない\n'
    cat_record "$id" "skipped (観測失敗)" 0 0 0 0 0 0
    return 0
  fi
  local shared=0
  if [ "$VSCODE_MOUNT" != "/" ]; then
    shared=1
  fi
  local needsudo=0
  if [ "$shared" = "0" ]; then
    needsudo=1
  fi
  clean_extensions_cache "$id" "$root" "$expected" "$shared" "$needsudo" "$VSCODE_BASE"
}

# server bin 世代は世代数や ps 結果にかかわらず自動削除しない (共有 volume と
# private PID namespace の組み合わせでは使用中世代を判定できない)。
# dry-run / 通常実行とも世代名とサイズの手動確認候補表示のみ行う
report_server_bin() {
  local id="vscode-server-bin"
  local root="$VSCODE_ROOT/vscode-server/bin"
  local expected="$VSCODE_ROOT/vscode-server/bin"
  printf '== category: %s (手動確認のみ・自動削除しない) ==\n' "$id"
  printf 'root: %s\n' "$root"
  if [ ! -d "$root" ]; then
    printf '  no-op: root が存在しない\n'
    cat_record "$id" "no-op" 0 0 0 0 0 0
    return 0
  fi
  # 列挙だけでも注入境界の外へ出ないよう、削除 root と同じ境界検証を行う
  root_guard "$root" "$expected" "$VSCODE_BASE"
  case "$RG_STATUS" in
    unsafe)
      printf '  skip: root または中間 component が symlink、または canonical path が allowlist と一致しない\n'
      cat_record "$id" "skipped" 0 0 0 0 0 0
      return 0
      ;;
    error)
      printf '  failed: root の canonical 化に失敗\n'
      OP_FAIL=$((OP_FAIL + 1))
      cat_record "$id" "failed" 0 0 0 0 0 0
      return 0
      ;;
  esac
  local entries=()
  if ! enum_children "$root" entries; then
    printf '  failed: 列挙失敗\n'
    OP_FAIL=$((OP_FAIL + 1))
    cat_record "$id" "failed" 0 0 0 0 0 0
    return 0
  fi
  # 世代は bin/<commit>/ (旧 layout) または bin/<platform>/<commit>/ (新 layout) にある
  local found=0 e g base sz grands status="manual-only"
  local sub_found
  for e in "${entries[@]}"; do
    [ -L "$e" ] && continue
    base="${e##*/}"
    if [ -d "$e" ]; then
      grands=()
      if ! enum_children "$e" grands; then
        printf '  failed: %s (列挙失敗)\n' "$(disp "$base")"
        OP_FAIL=$((OP_FAIL + 1))
        status="manual-only (partial)"
        continue
      fi
      sub_found=0
      for g in "${grands[@]}"; do
        [ -L "$g" ] && continue
        [ -d "$g" ] || continue
        sub_found=1
        found=1
        sz="$(entry_bytes "$g" || printf '?')"
        if [ "$sz" = "?" ]; then
          printf '  failed: %s/%s (du 失敗; size 不明)\n' "$(disp "$base")" "$(disp "${g##*/}")"
          OP_FAIL=$((OP_FAIL + 1))
          status="manual-only (partial)"
        else
          printf '  manual-only: %s/%s (%s)\n' "$(disp "$base")" "$(disp "${g##*/}")" "$(human "$sz")"
        fi
      done
      if [ "$sub_found" = "0" ]; then
        found=1
        sz="$(entry_bytes "$e" || printf '?')"
        if [ "$sz" = "?" ]; then
          printf '  failed: %s (du 失敗; size 不明)\n' "$(disp "$base")"
          OP_FAIL=$((OP_FAIL + 1))
          status="manual-only (partial)"
        else
          printf '  manual-only: %s (%s)\n' "$(disp "$base")" "$(human "$sz")"
        fi
      fi
    else
      found=1
      sz="$(entry_bytes "$e" || printf '?')"
      if [ "$sz" = "?" ]; then
        printf '  failed: %s (du 失敗; size 不明)\n' "$(disp "$base")"
        OP_FAIL=$((OP_FAIL + 1))
        status="manual-only (partial)"
      else
        printf '  manual-only: %s (%s)\n' "$(disp "$base")" "$(human "$sz")"
      fi
    fi
  done
  [ "$found" = "0" ] && printf '  generation なし\n'
  printf '  ※ 削除する場合は共有 /vscode volume を使う全 container の停止を確認したうえで手動で行うこと\n'
  cat_record "$id" "$status" 0 0 0 0 0 0
}

clean_extensions_cache "home-vscode-extensions-cache" \
  "$CANON_HOME/.vscode-server/extensionsCache" \
  "$CANON_HOME/.vscode-server/extensionsCache" 0 0 "$CANON_HOME"
clean_npm_cache
clean_cursor_versions
clean_codex_tmp
clean_vscode_ext_cache
report_server_bin

# ---------------------------------------------------------------------------
# before / after と集計
# ---------------------------------------------------------------------------

printf '== filesystem before/after ==\n'
for key in "${FS_ORDER[@]}"; do
  repr="${FS_REPR[$key]}"
  if after_df="$(df -Pk -- "$repr" 2>/dev/null)"; then
    after_avail="$(awk 'NR==2 {print $(NF-2)}' <<<"$after_df")"
    after_cap="$(awk 'NR==2 {print $(NF-1)}' <<<"$after_df")"
    after_cap="${after_cap%\%}"
    if fits_kib "$after_avail"; then
      printf '  %s: avail %s → %s, capacity %s%% → %s%%\n' "$key" \
        "$(human "${FS_BEF_AVAIL[$key]}")" "$(human "$((after_avail * 1024))")" \
        "${FS_BEF_CAP[$key]}" "$after_cap"
    else
      printf '  %s: 再観測の df 出力を解釈できない\n' "$key"
      OP_FAIL=$((OP_FAIL + 1))
    fi
  else
    printf '  %s: 再観測失敗\n' "$key"
    OP_FAIL=$((OP_FAIL + 1))
  fi
done

printf '== 集計 ==\n'
printf '%s\n' 'category | status | candidates | reclaimed | skipped | unreclaimed'
for id in "${CAT_ORDER[@]}"; do
  printf '%s | %s | %s | %s | %s | %s\n' "$id" "${CAT_STATUS[$id]}" \
    "$(human "${CAT_CAND[$id]}")" "$(human "${CAT_RECL[$id]}")" \
    "$(human "${CAT_SKIP[$id]}")" "$(human "${CAT_UNREC[$id]}")"
done
if [ "$dry_run" = "1" ]; then
  printf '(dry-run のため reclaimed は常に 0。candidate が実行時の回収見込み)\n'
fi

# ---------------------------------------------------------------------------
# 掃除後も閾値超過なら警告し、自動削除対象外を含む診断へ誘導する
# ---------------------------------------------------------------------------

eff_pct="${threshold_pct:-$DEFAULT_THRESHOLD_PCT}"
eff_min="${min_free_bytes:-$DEFAULT_MIN_FREE_BYTES}"

warn_reasons=""
if root_df="$(df -Pk -- / 2>/dev/null)"; then
  post_avail="$(awk 'NR==2 {print $(NF-2)}' <<<"$root_df")"
  post_cap="$(awk 'NR==2 {print $(NF-1)}' <<<"$root_df")"
  post_cap="${post_cap%\%}"
  post_inode=""
  if root_dfi="$(df -Pi -- / 2>/dev/null)"; then
    post_inode="$(awk 'NR==2 {print $(NF-1)}' <<<"$root_dfi")"
    post_inode="${post_inode%\%}"
  fi
  fits_kib "$post_avail" || post_avail=""
  [[ "$post_cap" =~ ^[0-9]+$ ]] || post_cap=""
  if [ -n "$post_cap" ] && [ "$post_cap" -ge "$eff_pct" ]; then
    warn_reasons="capacity ${post_cap}% >= ${eff_pct}%"
  fi
  if [ -n "$post_avail" ] && [ "$((post_avail * 1024))" -lt "$eff_min" ]; then
    warn_reasons="${warn_reasons:+$warn_reasons, }avail $(human "$((post_avail * 1024))") < $(human "$eff_min")"
  fi
  if [[ "${post_inode:-}" =~ ^[0-9]+$ ]] && [ "$post_inode" -ge "$eff_pct" ]; then
    warn_reasons="${warn_reasons:+$warn_reasons, }inode ${post_inode}% >= ${eff_pct}%"
  fi
else
  printf '警告: 掃除後の / を再観測できない\n'
  OP_FAIL=$((OP_FAIL + 1))
fi

if [ -n "$warn_reasons" ]; then
  printf '警告: 掃除後も / は閾値を超過している (%s)\n' "$warn_reasons"
  printf '自動削除の対象は再生成可能な cache の一部に限定される。上記の手動確認候補 (vscode-server-bin 世代・共有 volume 上の extensionsCache entry) と、以下の host 側診断を参照すること。\n'
  cat <<'EOF'
== host 側の診断案内 (参照情報。固定容量や一律削除の指示ではない) ==
コンテナ内からは host (Docker Desktop VM) 側の使用状況を観測できない。コンテナ側の回収で解消しない場合:
  1. host で `docker system df` を実行し、image / container / local volume / build cache の現在の内訳を確認する
  2. 内訳で実際に大きい resource 種別だけを対象にする
  3. `docker system prune` は停止中 container・未使用 network・dangling image を削除する。削除対象一覧を確認し、不要な stopped resource に限定できる場合だけ別手順として実行する
  4. named volume (共有 VS Code server volume を含む) は永続データを含み得る。利用 container の停止・不要確認・必要な backup の後に限り個別に削除する
  5. Docker data を削除しても host disk が戻らない場合は、Docker Desktop の version に対応した仮想ディスク reclaim 手順を確認して実行する
EOF
fi

if [ "$OP_FAIL" -gt 0 ]; then
  printf '結果: operational failure %s 件 → exit 1\n' "$OP_FAIL"
  exit 1
fi
printf '結果: 正常終了 (exit 0)\n'
exit 0
