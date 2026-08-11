// clean-devcontainer-disk.sh の契約テスト。vite.config.ts の includeSource は shell
// script を収集しないため、既存 scripts/*.test.ts と同様に子プロセス起動で検証する。
// PATH 先頭の fake df/ps/sudo/npm で観測値・process 状態・成否を制御する。fake rm/du は
// 失敗注入に加えて fixture 外の削除を拒否する guard を担う (実装が退行しても実 HOME・
// 実 /vscode を消さないため)。列挙・計測・削除自体は fixture 上で実コマンドを通す。
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const scriptPath = path.join(repoRoot, 'scripts', 'clean-devcontainer-disk.sh')
const tempRoot = path.join(repoRoot, '.temp')
// script は .temp/ 自身かその配下しか test root として受理しないため、fixture も
// そこへ作る。手動作業ディレクトリを巻き込まないよう専用 namespace に閉じ、
// 後片付けは onTestFinished で予約するのでテスト側には書かない
const scratchRoot = path.join(tempRoot, 'clean-devcontainer-disk-scratch')

const createScratchDir = (prefix: string): string => {
  // 登録を allocation より先に行う。順序を逆にすると、test 文脈外から呼ばれて
  // onTestFinished が throw したときに生成済み directory が残る
  const created: { dir: string | null } = { dir: null }
  onTestFinished(() => {
    if (created.dir !== null) {
      rmSync(created.dir, { force: true, recursive: true })
    }
  })
  mkdirSync(scratchRoot, { recursive: true })
  const dir = mkdtempSync(path.join(scratchRoot, `${prefix}-`))
  created.dir = dir
  return dir
}

// fake が exec する実体を PATH 経由ではなく絶対 path で固定する (fake 自身の再帰を防ぐ)
const resolveRealTool = (name: string): string => {
  for (const dir of ['/usr/bin', '/bin']) {
    const candidate = path.join(dir, name)
    if (existsSync(candidate)) {
      return candidate
    }
  }
  throw new Error(`real ${name} not found`)
}

const realRm = resolveRealTool('rm')
const realDu = resolveRealTool('du')
const realFind = resolveRealTool('find')

// df は profile (root/vscode/home/workspace) ごとの env ファイルで観測値を制御する。
// <profile>.env.<N> は N 回目の呼び出しだけを上書きする。呼び出し順は script の
// 固定シーケンス (観測 -P/-Pi → before/after -P → 警告 -P/-Pi) に依存する
const fakeDf = `#!/usr/bin/env bash
set -u
printf 'df %s\\n' "$*" >> "$FAKE_STATE/calls.log"
mode=""
target=""
for a in "$@"; do
  case "$a" in
    -Pi) mode=Pi ;;
    -Pk) mode=P ;;
    --) ;;
    -*) ;;
    *) target="$a" ;;
  esac
done
if [ -z "$mode" ]; then
  printf 'fake df: block size を固定しない呼び出し (-Pk / -Pi 以外): %s\\n' "$*" >&2
  exit 64
fi
case "$target" in
  /) profile=root ;;
  "$FAKE_VSCODE_ROOT") profile=vscode ;;
  "$HOME") profile=home ;;
  *) profile=workspace ;;
esac
state="$FAKE_STATE/df"
count_file="$state/$profile.count"
count=0
[ -f "$count_file" ] && count="$(cat "$count_file")"
count=$((count + 1))
printf '%s' "$count" > "$count_file"
FS=overlay
MOUNT=/
BLOCKS=100000000
USED=50000000
AVAIL=10485760
CAP=50
ICAP=50
FAIL=0
cfg="$state/$profile.env"
[ -f "$cfg" ] && source "$cfg"
[ -f "$cfg.$count" ] && source "$cfg.$count"
if [ "$FAIL" = "1" ]; then
  printf 'fake df: simulated failure for %s\\n' "$target" >&2
  exit 1
fi
if [ "$mode" = "Pi" ]; then
  printf 'Filesystem Inodes IUsed IFree IUse%% Mounted on\\n'
  printf '%s %s %s %s %s%% %s\\n' "$FS" 1000000 900000 100000 "$ICAP" "$MOUNT"
else
  printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n'
  printf '%s %s %s %s %s%% %s\\n' "$FS" "$BLOCKS" "$USED" "$AVAIL" "$CAP" "$MOUNT"
fi
`

// ps は呼び出しごとに ps.env → ps.env.<N> を source する。PS_RUN は削除選択と
// 削除直前再検証の間に fixture を変化させる race 注入フック
const fakePs = `#!/usr/bin/env bash
set -u
printf 'ps %s\\n' "$*" >> "$FAKE_STATE/calls.log"
state="$FAKE_STATE/ps"
count_file="$state/count"
count=0
[ -f "$count_file" ] && count="$(cat "$count_file")"
count=$((count + 1))
printf '%s' "$count" > "$count_file"
PS_MODE=clear
PS_EXTRA=""
PS_RUN=""
[ -f "$state/ps.env" ] && source "$state/ps.env"
[ -f "$state/ps.env.$count" ] && source "$state/ps.env.$count"
if [ -n "$PS_RUN" ]; then
  eval "$PS_RUN"
fi
if [ "$PS_MODE" = "fail" ]; then
  printf 'fake ps: simulated failure\\n' >&2
  exit 1
fi
printf '%s\\n' "init"
printf '%s\\n' "bash"
case "$PS_MODE" in
  active-codex) printf '%s %s\\n' "codex" "codex app-server" ;;
  active-cursor) printf '%s %s\\n' "cursor-agent" "cursor-agent serve" ;;
esac
if [ -n "$PS_EXTRA" ]; then
  printf '%s\\n' "$PS_EXTRA"
fi
exit 0
`

const fakeSudo = `#!/usr/bin/env bash
set -u
printf 'sudo %s\\n' "$*" >> "$FAKE_STATE/calls.log"
SUDO_MODE=ok
[ -f "$FAKE_STATE/sudo.env" ] && source "$FAKE_STATE/sudo.env"
if [ "$SUDO_MODE" = "fail" ]; then
  printf 'fake sudo: a password is required\\n' >&2
  exit 1
fi
[ "$1" = "-n" ] && shift
if [ "$1" = "true" ]; then
  exit 0
fi
exec "$@"
`

const fakeRm = `#!/usr/bin/env bash
set -u
printf 'rm %s\\n' "$*" >> "$FAKE_STATE/calls.log"
RM_FAIL_MATCH=""
[ -f "$FAKE_STATE/rm.env" ] && source "$FAKE_STATE/rm.env"
for a in "$@"; do
  case "$a" in
    -*) ;;
    *)
      case "$a" in
        "$FAKE_GUARD_PREFIX"/*) ;;
        *)
          printf 'fake rm: refusing to delete outside fixture: %s\\n' "$a" >&2
          exit 42
          ;;
      esac
      if [ -n "$RM_FAIL_MATCH" ]; then
        case "$a" in
          *"$RM_FAIL_MATCH"*)
            printf 'fake rm: simulated failure for %s\\n' "$a" >&2
            exit 1
            ;;
        esac
      fi
      ;;
  esac
done
exec "$REAL_RM" "$@"
`

const fakeDu = `#!/usr/bin/env bash
set -u
printf 'du %s\\n' "$*" >> "$FAKE_STATE/calls.log"
DU_FAIL_MATCH=""
DU_FIXED_MATCH=""
DU_FIXED_BYTES=""
[ -f "$FAKE_STATE/du.env" ] && source "$FAKE_STATE/du.env"
[ -f "$FAKE_STATE/du-fixed.env" ] && source "$FAKE_STATE/du-fixed.env"
if [ -n "$DU_FAIL_MATCH" ]; then
  for a in "$@"; do
    case "$a" in
      *"$DU_FAIL_MATCH"*)
        printf 'fake du: simulated failure for %s\\n' "$a" >&2
        exit 1
        ;;
    esac
  done
fi
if [ -n "$DU_FIXED_MATCH" ]; then
  for a in "$@"; do
    # fixture root も .temp/ 配下にあるため、部分一致だと fixture の実計測まで潰れる
    case "$a" in
      "$DU_FIXED_MATCH")
        if [ "$DU_FIXED_BYTES" = "fail" ]; then
          exit 1
        fi
        printf '%s\\t%s\\n' "$DU_FIXED_BYTES" "$a"
        exit 0
        ;;
    esac
  done
fi
exec "$REAL_DU" "$@"
`

// npm の cache clean は fixture HOME 配下の _cacache 削除として振る舞う。
// cache dir が fixture HOME 外なら拒否する (実 ~/.npm の保護)
const fakeNpm = `#!/usr/bin/env bash
set -u
printf 'npm %s\\n' "$*" >> "$FAKE_STATE/calls.log"
NPM_MODE=ok
NPM_RUN=""
[ -f "$FAKE_STATE/npm.env" ] && source "$FAKE_STATE/npm.env"
[ -f "$FAKE_STATE/npm-run.env" ] && source "$FAKE_STATE/npm-run.env"
case "$NPM_MODE" in
  fail)
    printf 'fake npm: cannot start (simulated ENOSPC)\\n' >&2
    exit 1
    ;;
esac
if [ "$1" = "config" ] && [ "$2" = "get" ] && [ "$3" = "cache" ]; then
  case "$NPM_MODE" in
    badconfig) printf '/outside-allowlist/npm-cache\\n' ;;
    *) printf '%s\\n' "$HOME/.npm" ;;
  esac
  if [ -n "$NPM_RUN" ]; then
    eval "$NPM_RUN"
  fi
  exit 0
fi
if [ "$1" = "cache" ] && [ "$2" = "clean" ]; then
  if [ "$NPM_MODE" = "clean-fail" ]; then
    printf 'fake npm: cache clean failed\\n' >&2
    exit 1
  fi
  cache_dir=""
  prev=""
  for a in "$@"; do
    if [ "$prev" = "--cache" ]; then
      cache_dir="$a"
    fi
    prev="$a"
  done
  case "$cache_dir" in
    "$HOME"/*) ;;
    *)
      printf 'fake npm: refusing cache dir outside fixture HOME: %s\\n' "$cache_dir" >&2
      exit 1
      ;;
  esac
  "$REAL_RM" -rf -- "$cache_dir/_cacache"
  exit 0
fi
printf 'fake npm: unexpected args: %s\\n' "$*" >&2
exit 1
`

interface DfProfileProps {
  availKb?: number
  blocksKb?: number
  cap?: number
  fail?: boolean
  fs?: string
  icap?: number
  mount?: string
  usedKb?: number
}

interface Fixture {
  binDir: string
  callsLog: string
  dir: string
  env: NodeJS.ProcessEnv
  homeDir: string
  stateDir: string
  testRoot: string
  vscodeRoot: string
}

interface PsProps {
  extra?: string
  mode?: 'active-codex' | 'active-cursor' | 'clear' | 'fail'
  run?: string
}

interface ScriptOutcome {
  status: number
  stderr: string
  stdout: string
}

interface OutcomeExpectation {
  contains?: string[]
  notContains?: string[]
  status?: number
  stderrContains?: string[]
}

const shQuote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`

const DF_PROFILE_KEYS = [
  ['fs', 'FS'],
  ['mount', 'MOUNT'],
  ['blocksKb', 'BLOCKS'],
  ['usedKb', 'USED'],
  ['availKb', 'AVAIL'],
  ['cap', 'CAP'],
  ['icap', 'ICAP'],
] as const

const dfProfileEnv = (props: DfProfileProps): string => {
  const lines: string[] = []
  for (const [prop, key] of DF_PROFILE_KEYS) {
    const value = props[prop]
    if (typeof value === 'string') {
      lines.push(`${key}=${shQuote(value)}`)
    }
    if (typeof value === 'number') {
      lines.push(`${key}=${value}`)
    }
  }
  if (props.fail === true) {
    lines.push('FAIL=1')
  }
  return `${lines.join('\n')}\n`
}

const psEnv = (props: PsProps): string => {
  const lines: string[] = []
  if (props.mode) {
    lines.push(`PS_MODE=${props.mode}`)
  }
  if (props.extra) {
    lines.push(`PS_EXTRA=${shQuote(props.extra)}`)
  }
  if (props.run) {
    lines.push(`PS_RUN=${shQuote(props.run)}`)
  }
  return `${lines.join('\n')}\n`
}

const setDfProfile = (fixture: Fixture, profile: string, props: DfProfileProps): void => {
  writeFileSync(path.join(fixture.stateDir, 'df', `${profile}.env`), dfProfileEnv(props))
}

// N 回目の df 呼び出しだけを上書きする (呼び出し順は script の固定シーケンス依存)
const setDfProfileCall = (
  fixture: Fixture,
  profile: string,
  props: DfProfileProps & { call: number }
): void => {
  writeFileSync(
    path.join(fixture.stateDir, 'df', `${profile}.env.${props.call}`),
    dfProfileEnv(props)
  )
}

const setPs = (fixture: Fixture, props: PsProps): void => {
  writeFileSync(path.join(fixture.stateDir, 'ps', 'ps.env'), psEnv(props))
}

const setPsCall = (fixture: Fixture, call: number, props: PsProps): void => {
  writeFileSync(path.join(fixture.stateDir, 'ps', `ps.env.${call}`), psEnv(props))
}

const setSudo = (fixture: Fixture, mode: 'fail' | 'ok'): void => {
  writeFileSync(path.join(fixture.stateDir, 'sudo.env'), `SUDO_MODE=${mode}\n`)
}

const setNpm = (fixture: Fixture, mode: 'badconfig' | 'clean-fail' | 'fail' | 'ok'): void => {
  writeFileSync(path.join(fixture.stateDir, 'npm.env'), `NPM_MODE=${mode}\n`)
}

// cache 設定の検証が通った後にだけ走る副作用注入 (検証と実行の間の race 再現用)
const setNpmRun = (fixture: Fixture, run: string): void => {
  writeFileSync(path.join(fixture.stateDir, 'npm-run.env'), `NPM_RUN=${shQuote(run)}\n`)
}

const setRmFail = (fixture: Fixture, match: string): void => {
  writeFileSync(path.join(fixture.stateDir, 'rm.env'), `RM_FAIL_MATCH=${shQuote(match)}\n`)
}

const setFindFail = (fixture: Fixture, match: string): void => {
  writeFileSync(path.join(fixture.stateDir, 'find.env'), `FIND_FAIL_MATCH=${shQuote(match)}\n`)
}

const setDuFail = (fixture: Fixture, match: string): void => {
  writeFileSync(path.join(fixture.stateDir, 'du.env'), `DU_FAIL_MATCH=${shQuote(match)}\n`)
}

const setDuFixed = (fixture: Fixture, match: string, bytes: 'fail' | number): void => {
  writeFileSync(
    path.join(fixture.stateDir, 'du-fixed.env'),
    `DU_FIXED_MATCH=${shQuote(match)}\nDU_FIXED_BYTES=${shQuote(String(bytes))}\n`
  )
}

// 12MiB ちょうど。human() の丸めが安定するので期待文字列を固定できる
const REPO_TEMP_FIXED_BYTES = 12 * 1024 * 1024
const REPO_TEMP_FIXED_HUMAN = '12.0MiB'

const seedFixtureDefaults = (fixture: Fixture, homeDir: string): void => {
  // 既定は / と別 filesystem (実環境の host mount と同じ構図) にし、
  // repository .temp/ の du 計測分岐を不要に踏まないようにする
  setDfProfile(fixture, 'home', { fs: 'homefs', mount: homeDir })
  setDfProfile(fixture, 'workspace', { fs: 'hostmount', mount: repoRoot })
  // --test-root は script の repo_root を差し替えないため、同一 filesystem 分岐では
  // 実 .temp/ が du の対象になる。実測に落とすと所要時間が repository の外部状態に
  // 依存するので、この path だけ実 du へ委譲せず固定値を返す
  setDuFixed(fixture, path.join(repoRoot, '.temp'), REPO_TEMP_FIXED_BYTES)
}

const fakeFind = `#!/usr/bin/env bash
set -u
printf 'find %s\\n' "$*" >> "$FAKE_STATE/calls.log"
FIND_FAIL_MATCH=""
[ -f "$FAKE_STATE/find.env" ] && source "$FAKE_STATE/find.env"
if [ -n "$FIND_FAIL_MATCH" ]; then
  for a in "$@"; do
    case "$a" in
      *"$FIND_FAIL_MATCH"*)
        printf 'fake find: simulated failure for %s\\n' "$a" >&2
        exit 1
        ;;
    esac
  done
fi
exec "$REAL_FIND" "$@"
`

const writeFakes = (binDir: string): void => {
  const fakes: Record<string, string> = {
    df: fakeDf,
    du: fakeDu,
    find: fakeFind,
    npm: fakeNpm,
    ps: fakePs,
    rm: fakeRm,
    sudo: fakeSudo,
  }
  for (const [name, body] of Object.entries(fakes)) {
    const toolPath = path.join(binDir, name)
    writeFileSync(toolPath, body)
    chmodSync(toolPath, 0o755)
  }
}

type FixtureDirs = Pick<Fixture, 'binDir' | 'homeDir' | 'stateDir' | 'testRoot'>

const makeFixtureDirs = (dir: string): FixtureDirs => {
  const binDir = path.join(dir, 'bin')
  const stateDir = path.join(dir, 'state')
  const homeDir = path.join(dir, 'home')
  const testRoot = path.join(dir, 'root')
  mkdirSync(binDir)
  mkdirSync(path.join(stateDir, 'df'), { recursive: true })
  mkdirSync(path.join(stateDir, 'ps'), { recursive: true })
  mkdirSync(homeDir)
  mkdirSync(testRoot)
  return { binDir, homeDir, stateDir, testRoot }
}

const makeFixtureEnv = (
  dirs: FixtureDirs & { vscodeRoot: string },
  guardPrefix: string
): NodeJS.ProcessEnv => ({
  ...process.env,
  FAKE_GUARD_PREFIX: guardPrefix,
  FAKE_STATE: dirs.stateDir,
  FAKE_VSCODE_ROOT: dirs.vscodeRoot,
  HOME: dirs.homeDir,
  PATH: `${dirs.binDir}${path.delimiter}${process.env.PATH ?? ''}`,
  REAL_DU: realDu,
  REAL_FIND: realFind,
  REAL_RM: realRm,
})

// HOME を fixture に差し替え、必ず --test-root を渡すことで、実 HOME・実 /vscode・
// 実 ~/.npm に script が触れる経路を fixture に閉じ込める
const makeFixture = (): Fixture => {
  const dir = realpathSync(createScratchDir('clean-devcontainer-disk-test'))
  const dirs = makeFixtureDirs(dir)
  writeFakes(dirs.binDir)
  const vscodeRoot = path.join(dirs.testRoot, 'vscode')
  const fixture: Fixture = {
    ...dirs,
    callsLog: path.join(dirs.stateDir, 'calls.log'),
    dir,
    env: makeFixtureEnv({ ...dirs, vscodeRoot }, dir),
    vscodeRoot,
  }
  seedFixtureDefaults(fixture, dirs.homeDir)
  return fixture
}

const runScriptRaw = (
  fixture: Fixture,
  args: string[],
  extraEnv: NodeJS.ProcessEnv = {}
): ScriptOutcome => {
  const result = spawnSync('bash', [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...fixture.env, ...extraEnv },
    maxBuffer: 32 * 1024 * 1024,
  })
  return { status: result.status ?? -1, stderr: result.stderr, stdout: result.stdout }
}

const runScript = (
  fixture: Fixture,
  args: string[],
  extraEnv: NodeJS.ProcessEnv = {}
): ScriptOutcome => runScriptRaw(fixture, ['--test-root', fixture.testRoot, ...args], extraEnv)

const calls = (fixture: Fixture): string[] => {
  if (!existsSync(fixture.callsLog)) {
    return []
  }
  return readFileSync(fixture.callsLog, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
}

const summaryRow = (stdout: string, categoryId: string): string[] => {
  const rowLine = stdout.split('\n').find((line) => line.startsWith(`${categoryId} | `))
  if (!rowLine) {
    throw new Error(`summary row not found: ${categoryId}\n${stdout}`)
  }
  return rowLine.split(' | ')
}

const writeSizedFile = (filePath: string, bytes: number): void => {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, Buffer.alloc(bytes, 120))
}

const extCacheDir = (fixture: Fixture): string =>
  path.join(fixture.homeDir, '.vscode-server', 'extensionsCache')

const cacacheDir = (fixture: Fixture): string => path.join(fixture.homeDir, '.npm', '_cacache')

const versionsDir = (fixture: Fixture): string =>
  path.join(fixture.homeDir, '.local', 'share', 'cursor-agent', 'versions')

const codexTmpDir = (fixture: Fixture): string => path.join(fixture.homeDir, '.codex', '.tmp')

const makeVersionGen = (fixture: Fixture, name: string): string => {
  const dir = path.join(versionsDir(fixture), name)
  writeSizedFile(path.join(dir, 'payload'), 1024)
  return dir
}

const makeVersionGens = (fixture: Fixture, names: string[]): void => {
  for (const name of names) {
    makeVersionGen(fixture, name)
  }
}

const makeVscodeExtCache = (fixture: Fixture): string => {
  const dir = path.join(fixture.vscodeRoot, 'vscode-server', 'extensionsCache')
  mkdirSync(dir, { recursive: true })
  return dir
}

const expectOutcome = (outcome: ScriptOutcome, expected: OutcomeExpectation): void => {
  if (typeof expected.status === 'number') {
    expect(outcome.status).toBe(expected.status)
  }
  for (const message of expected.contains ?? []) {
    expect(outcome.stdout).toContain(message)
  }
  for (const message of expected.notContains ?? []) {
    expect(outcome.stdout).not.toContain(message)
  }
  for (const message of expected.stderrContains ?? []) {
    expect(outcome.stderr).toContain(message)
  }
}

const expectPaths = (expectations: { exists: boolean; target: string }[]): void => {
  for (const { exists, target } of expectations) {
    expect(existsSync(target)).toBe(exists)
  }
}

const expectSymlink = (target: string): void => {
  expect(lstatSync(target).isSymbolicLink()).toBe(true)
}

const expectRow = (outcome: ScriptOutcome, categoryId: string, expected: string[]): void => {
  expect(summaryRow(outcome.stdout, categoryId)).toEqual(expected)
}

const expectRowStatuses = (outcome: ScriptOutcome, expected: Record<string, string>): void => {
  for (const [categoryId, status] of Object.entries(expected)) {
    expect(summaryRow(outcome.stdout, categoryId)[1]).toBe(status)
  }
}

// active / unknown で skip した category は実サイズを skipped 列に計上する契約
const expectRowSkippedWithSize = (
  outcome: ScriptOutcome,
  categoryId: string,
  status: string
): void => {
  const row = summaryRow(outcome.stdout, categoryId)
  expect(row[1]).toBe(status)
  expect(row[2]).toBe('0B')
  expect(row[3]).toBe('0B')
  expect(row[4]).not.toBe('0B')
  expect(row[5]).toBe('0B')
}

// du の directory 自身のサイズは fs 依存なので、category 集計の byte 値ではなく
// candidates == reclaimed && unreclaimed == 0 の関係だけを固定する
const expectRowFullyReclaimed = (
  outcome: ScriptOutcome,
  categoryId: string,
  status: string
): void => {
  const row = summaryRow(outcome.stdout, categoryId)
  expect(row[1]).toBe(status)
  expect(row[2]).toBe(row[3])
  expect(row[2]).not.toBe('0B')
  expect(row[5]).toBe('0B')
}

const expectCalls = (
  fixture: Fixture,
  expectations: { absent?: string[]; present?: string[] }
): void => {
  const log = calls(fixture)
  for (const line of expectations.present ?? []) {
    expect(log).toContain(line)
  }
  for (const prefix of expectations.absent ?? []) {
    expect(log.some((line) => line.startsWith(prefix))).toBe(false)
  }
}

const makeCodexEntryFixture = (
  rootProfile: DfProfileProps = {}
): { entry: string; fixture: Fixture } => {
  const fixture = makeFixture()
  setDfProfile(fixture, 'root', rootProfile)
  const entry = path.join(codexTmpDir(fixture), 'session-file')
  writeSizedFile(entry, 1024)
  return { entry, fixture }
}

// 完成済み形式に合致しない・basename が安全でない entry 群。改行を含む名は
// NUL-safe 列挙で 1 entry のまま扱われることの検証を兼ねる (分割されると
// c.d-2.0 が有効形式の phantom entry として現れる)
const EXT_CACHE_KEPT_ENTRIES = [
  'pub.three-3.0.lock',
  'partial.download',
  '-pub.dash-1.0',
  'pub.sp ace-1.0',
  'a.b-1.0\nc.d-2.0',
] as const

const setupExtCacheEntries = (fixture: Fixture): string => {
  const cacheDir = extCacheDir(fixture)
  writeSizedFile(path.join(cacheDir, 'pub.one-1.0'), 1024)
  writeSizedFile(path.join(cacheDir, 'pub.two-2.0.0-linux-x64'), 2048)
  for (const name of EXT_CACHE_KEPT_ENTRIES) {
    writeSizedFile(path.join(cacheDir, name), 1024)
  }
  mkdirSync(path.join(cacheDir, 'pub.dir-5.0'), { recursive: true })
  symlinkSync('pub.one-1.0', path.join(cacheDir, 'pub.link-4.0'))
  return cacheDir
}

const linkAgentTo = (fixture: Fixture, genName: string): void => {
  const agentLink = path.join(fixture.homeDir, '.local', 'bin', 'agent')
  mkdirSync(path.dirname(agentLink), { recursive: true })
  symlinkSync(path.join(versionsDir(fixture), genName, 'bin', 'cursor-agent'), agentLink)
}

const setupMixedHomeFixture = (
  fixture: Fixture
): { codexEntry: string; extEntry: string; oldGen: string } => {
  const extEntry = path.join(extCacheDir(fixture), 'pub.one-1.0')
  writeSizedFile(extEntry, 1024)
  makeVersionGens(fixture, ['2026.07.01-aaaaaaa', '2026.08.02-ccccccc'])
  const codexEntry = path.join(codexTmpDir(fixture), 'session-file')
  writeSizedFile(codexEntry, 1024)
  return { codexEntry, extEntry, oldGen: path.join(versionsDir(fixture), '2026.07.01-aaaaaaa') }
}

// cache 設定の検証を通過した後に _cacache だけを別 identity へ差し替える。削除して
// 同名で作り直すと解放直後の inode が再利用され得るため、共存させた別 directory を
// rename で入れ替えて identity の変化を確定させる
const setupCacacheRootSwap = (fixture: Fixture): string => {
  const cacache = cacacheDir(fixture)
  writeSizedFile(path.join(cacache, 'index-v5', 'entry'), 1024)
  const planted = path.join(fixture.homeDir, '.npm', '_cacache-planted')
  mkdirSync(path.join(planted, 'kept'), { recursive: true })
  const stashed = path.join(fixture.homeDir, '.npm', '_cacache-stashed')
  setNpmRun(
    fixture,
    `mv ${shQuote(cacache)} ${shQuote(stashed)} && mv ${shQuote(planted)} ${shQuote(cacache)}`
  )
  return cacache
}

const setupServerBin = (fixture: Fixture): string => {
  const binRoot = path.join(fixture.vscodeRoot, 'vscode-server', 'bin')
  writeSizedFile(path.join(binRoot, 'abc1234', 'payload'), 1024)
  writeSizedFile(path.join(binRoot, 'linux-arm64', 'def5678', 'payload'), 1024)
  return binRoot
}

const setupHomeCategories = (fixture: Fixture): string[] => {
  const extEntry = path.join(extCacheDir(fixture), 'pub.one-1.0')
  writeSizedFile(extEntry, 1024)
  const cacacheChild = path.join(cacacheDir(fixture), 'index-v5', 'entry')
  writeSizedFile(cacacheChild, 1024)
  const oldGen = makeVersionGen(fixture, '2026.07.01-aaaaaaa')
  makeVersionGen(fixture, '2026.08.02-ccccccc')
  const codexEntry = path.join(codexTmpDir(fixture), 'session-file')
  writeSizedFile(codexEntry, 1024)
  return [extEntry, cacacheChild, oldGen, codexEntry]
}

const setupVscodeCategories = (fixture: Fixture): string[] => {
  const vscodeEntry = path.join(makeVscodeExtCache(fixture), 'pub.vsix-1.0')
  writeSizedFile(vscodeEntry, 1024)
  const binGen = path.join(fixture.vscodeRoot, 'vscode-server', 'bin', 'abc1234')
  writeSizedFile(path.join(binGen, 'payload'), 1024)
  return [vscodeEntry, binGen]
}

const setupPartialDeleteFixture = (
  fixture: Fixture
): { other: string; victim: string; vscodeEntry: string } => {
  const victim = path.join(codexTmpDir(fixture), 'victim')
  const other = path.join(codexTmpDir(fixture), 'other')
  const vscodeEntry = path.join(makeVscodeExtCache(fixture), 'pub.one-1.0')
  writeSizedFile(victim, 1024)
  writeSizedFile(other, 2048)
  writeSizedFile(vscodeEntry, 1024)
  return { other, victim, vscodeEntry }
}

const setupExtAndCodex = (fixture: Fixture): { codexEntry: string; extEntry: string } => {
  const extEntry = path.join(extCacheDir(fixture), 'pub.one-1.0')
  writeSizedFile(extEntry, 1024)
  const codexEntry = path.join(codexTmpDir(fixture), 'session-file')
  writeSizedFile(codexEntry, 1024)
  return { codexEntry, extEntry }
}

const setupCacacheFallback = (fixture: Fixture): { children: string[]; strayLink: string } => {
  const indexChild = path.join(cacacheDir(fixture), 'index-v5')
  const contentChild = path.join(cacacheDir(fixture), 'content-v2')
  writeSizedFile(path.join(indexChild, 'entry'), 1024)
  writeSizedFile(path.join(contentChild, 'entry'), 2048)
  const strayLink = path.join(cacacheDir(fixture), 'stray-link')
  symlinkSync('index-v5', strayLink)
  return { children: [indexChild, contentChild], strayLink }
}

describe('閾値判定 (使用率・絶対空き容量・inode の OR)', () => {
  it('CLI 引数なしは閾値未満でも無条件に掃除する', () => {
    const { entry, fixture } = makeCodexEntryFixture()

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, {
      contains: ['無条件モード (引数なし) → 掃除を実行する'],
      status: 0,
    })
    expect(existsSync(entry)).toBe(false)
    expectRow(outcome, 'codex-tmp', ['codex-tmp', 'ok', '1.0KiB', '1.0KiB', '0B', '0B'])
  })

  it.each([
    { cap: 89, runs: false },
    { cap: 90, runs: true },
    { cap: 91, runs: true },
  ])('--threshold 90 に対し使用率 $cap% で cleanup 実行=$runs', ({ cap, runs }) => {
    const { entry, fixture } = makeCodexEntryFixture({ cap })
    const outcome = runScript(fixture, ['--threshold', '90'])
    if (runs) {
      expectOutcome(outcome, {
        contains: [
          'threshold: pct=90 min_free_bytes=5368709120 (5.0GiB)',
          `閾値超過 (capacity ${cap}% >= 90%) → 掃除を実行する`,
        ],
        status: 0,
      })
      expect(existsSync(entry)).toBe(false)
    } else {
      expectOutcome(outcome, {
        contains: [`/ は閾値未満 (capacity=${cap}% avail=10.0GiB inode=50%) のため掃除しない`],
        notContains: ['== category:'],
        status: 0,
      })
      expect(existsSync(entry)).toBe(true)
    }
  })

  it.each([
    { availKb: 5_242_879, name: '下限直前 (5GiB 未満)', runs: true },
    { availKb: 5_242_880, name: '下限一致 (ちょうど 5GiB)', runs: false },
    { availKb: 5_242_881, name: '下限直後 (5GiB 超)', runs: false },
  ])('絶対空き容量が$nameのとき cleanup 実行=$runs', ({ availKb, runs }) => {
    const { entry, fixture } = makeCodexEntryFixture({ availKb, cap: 50 })
    const outcome = runScript(fixture, ['--threshold', '90'])
    if (runs) {
      expectOutcome(outcome, {
        contains: ['閾値超過 (avail 5368708096 bytes < 5368709120 bytes) → 掃除を実行する'],
        status: 0,
      })
      expect(existsSync(entry)).toBe(false)
    } else {
      expectOutcome(outcome, {
        contains: ['/ は閾値未満'],
        notContains: ['== category:'],
        status: 0,
      })
      expect(existsSync(entry)).toBe(true)
    }
  })

  it('inode 使用率が閾値以上なら使用率・空き容量が閾値未満でも掃除する', () => {
    const { entry, fixture } = makeCodexEntryFixture({ cap: 50, icap: 90 })

    const outcome = runScript(fixture, ['--threshold', '90'])

    expectOutcome(outcome, {
      contains: ['閾値超過 (inode 90% >= 90%) → 掃除を実行する'],
      status: 0,
    })
    expect(existsSync(entry)).toBe(false)
  })

  it('--min-free-bytes 単独指定でも閾値モードになり pct 既定値 90 を併用する', () => {
    const { entry, fixture } = makeCodexEntryFixture({ availKb: 1_048_575, cap: 50 })

    const outcome = runScript(fixture, ['--min-free-bytes', '1073741824'])

    expectOutcome(outcome, {
      contains: [
        'threshold: pct=90 min_free_bytes=1073741824 (1.0GiB)',
        '閾値超過 (avail 1073740800 bytes < 1073741824 bytes) → 掃除を実行する',
      ],
      status: 0,
    })
    expect(existsSync(entry)).toBe(false)
  })

  it('int64 上限の --min-free-bytes と --threshold 100 は受理される', () => {
    const fixture = makeFixture()
    setDfProfile(fixture, 'root', { cap: 50 })

    const thresholdOutcome = runScript(fixture, ['--threshold', '100'])
    const minFreeOutcome = runScript(fixture, ['--min-free-bytes', '9223372036854775807'])

    expectOutcome(thresholdOutcome, { contains: ['/ は閾値未満'], status: 0 })
    expectOutcome(minFreeOutcome, {
      contains: ['threshold: pct=90 min_free_bytes=9223372036854775807'],
      status: 0,
    })
  })
})

describe('filesystem 観測と報告', () => {
  it('4 path が同一 filesystem の場合に 1 グループへまとめて報告する', () => {
    const fixture = makeFixture()
    mkdirSync(fixture.vscodeRoot, { recursive: true })
    setDfProfile(fixture, 'home', { fs: 'overlay', mount: '/' })
    setDfProfile(fixture, 'workspace', { fs: 'overlay', mount: '/' })

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, {
      contains: [
        '  overlay @ /: / /vscode HOME workspace',
        `workspace は / と同一 filesystem: repository の .temp/ (${REPO_TEMP_FIXED_HUMAN})`,
      ],
      status: 0,
    })
    // 実 .temp/ を走査していれば固定値にはならない (所要時間が repository 状態に依存する)
    expect(
      calls(fixture).some((call) => call === `du -sb -- ${path.join(repoRoot, '.temp')}`)
    ).toBe(true)
  })

  it('.temp/ の容量を計測できない場合は 0B ではなく計測不能と報告する', () => {
    const fixture = makeFixture()
    mkdirSync(fixture.vscodeRoot, { recursive: true })
    setDfProfile(fixture, 'home', { fs: 'overlay', mount: '/' })
    setDfProfile(fixture, 'workspace', { fs: 'overlay', mount: '/' })
    setDuFixed(fixture, path.join(repoRoot, '.temp'), 'fail')

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, {
      contains: ['workspace は / と同一 filesystem: repository の .temp/ (計測不能)'],
      status: 0,
    })
  })

  it('4 path が別 filesystem の場合に filesystem ごとへ分けて報告する', () => {
    const fixture = makeFixture()
    mkdirSync(fixture.vscodeRoot, { recursive: true })
    setDfProfile(fixture, 'vscode', { fs: '/dev/vdc', mount: '/vscode' })

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, {
      contains: [
        '  overlay @ /: /\n',
        '  /dev/vdc @ /vscode: /vscode',
        `  homefs @ ${fixture.homeDir}: HOME`,
        `  hostmount @ ${repoRoot}: workspace`,
        'workspace は / と別 filesystem: repository の .temp/ はコンテナディスクを圧迫しない',
      ],
      status: 0,
    })
  })

  it('filesystem ごとの before/after と category ごとの集計を報告する', () => {
    const { fixture } = makeCodexEntryFixture({ availKb: 10_485_760, cap: 50 })
    // 3 回目の df -P / は before/after 再観測 (観測 -P/-Pi が 1・2 回目)
    setDfProfileCall(fixture, 'root', { availKb: 11_010_048, call: 3 })

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, {
      contains: [
        '== filesystem before/after ==',
        '  overlay @ /: avail 10.0GiB → 10.5GiB, capacity 50% → 50%',
        'category | status | candidates | reclaimed | skipped | unreclaimed',
      ],
      status: 0,
    })
    expectRow(outcome, 'codex-tmp', ['codex-tmp', 'ok', '1.0KiB', '1.0KiB', '0B', '0B'])
  })

  it('掃除後も閾値超過なら警告と host 側診断案内を出す', () => {
    const { fixture } = makeCodexEntryFixture({ cap: 95 })

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, {
      contains: ['警告: 掃除後も / は閾値を超過している (capacity 95% >= 90%)', 'docker system df'],
      status: 0,
    })
  })

  it('掃除後に閾値を下回っていれば警告を出さない', () => {
    const { fixture } = makeCodexEntryFixture()

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, { notContains: ['警告'], status: 0 })
  })

  it('/vscode が存在しなくても他 category の処理を継続する', () => {
    const { entry, fixture } = makeCodexEntryFixture()

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, {
      contains: [`[/vscode] ${fixture.vscodeRoot}: 存在しない (対象外)`],
      status: 0,
    })
    expect(existsSync(entry)).toBe(false)
    expectRowStatuses(outcome, {
      'vscode-extensions-cache': 'no-op',
      'vscode-server-bin': 'no-op',
    })
  })

  it('HOME の df 失敗は operational failure (exit 1) で独立 category を継続する', () => {
    const { entry, fixture } = makeCodexEntryFixture()
    setDfProfile(fixture, 'home', { fail: true, fs: 'homefs', mount: fixture.homeDir })

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, {
      contains: [
        `[HOME] ${fixture.homeDir}: df 失敗 (観測不能)`,
        '結果: operational failure 1 件 → exit 1',
      ],
      status: 1,
    })
    expect(existsSync(entry)).toBe(false)
  })

  it('閾値未満で掃除しない場合も観測失敗は exit 1 として返す', () => {
    const fixture = makeFixture()
    setDfProfile(fixture, 'home', { fail: true, fs: 'homefs', mount: fixture.homeDir })

    const outcome = runScript(fixture, ['--threshold', '90'])

    expectOutcome(outcome, {
      contains: [
        `[HOME] ${fixture.homeDir}: df 失敗 (観測不能)`,
        '/ は閾値未満',
        '結果: operational failure 1 件 → exit 1',
      ],
      notContains: ['== category:'],
      status: 1,
    })
  })

  it('/ の df 失敗は掃除を中止して exit 1 になる', () => {
    const { entry, fixture } = makeCodexEntryFixture()
    setDfProfile(fixture, 'root', { fail: true })

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, {
      notContains: ['== category:'],
      status: 1,
      stderrContains: ['error: / を観測できないため掃除を中止する'],
    })
    expect(existsSync(entry)).toBe(true)
  })
})

describe('df 値の解釈', () => {
  it('df の KiB 値が byte 変換の上限ちょうどなら観測できる', () => {
    const fixture = makeFixture()
    setDfProfile(fixture, 'root', { availKb: 9_007_199_254_740_991 })

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, {
      notContains: ['df 出力を解釈できない (観測不能)'],
      status: 0,
    })
  })

  it('df の KiB 値が byte 変換で wrap する大きさなら観測不能として扱う', () => {
    const fixture = makeFixture()
    setDfProfile(fixture, 'root', { availKb: 9_007_199_254_740_992 })

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, {
      contains: ['df 出力を解釈できない (観測不能)'],
      status: 1,
      stderrContains: ['error: / を観測できないため掃除を中止する'],
    })
  })
})

describe('候補列挙 (extensionsCache / cursor-agent / codex-tmp)', () => {
  it('extensionsCache は完成済み entry だけを削除し lock / partial / 特殊名 / symlink / directory を保持する', () => {
    const fixture = makeFixture()
    const cacheDir = setupExtCacheEntries(fixture)

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, {
      contains: [
        'candidate: pub.one-1.0 (1.0KiB)',
        'deleted: pub.two-2.0.0-linux-x64 (2.0KiB)',
        'skip: pub.three-3.0.lock (完成済み形式ではない / lock / partial)',
        'skip: pub.link-4.0 (symlink)',
        'skip: pub.dir-5.0 (regular file ではない)',
        'skip: a.b-1.0?c.d-2.0 (完成済み形式ではない / lock / partial)',
      ],
      notContains: ['skip: c.d-2.0 '],
      status: 0,
    })
    expectPaths([
      { exists: false, target: path.join(cacheDir, 'pub.one-1.0') },
      { exists: false, target: path.join(cacheDir, 'pub.two-2.0.0-linux-x64') },
      ...[...EXT_CACHE_KEPT_ENTRIES, 'pub.dir-5.0'].map((name) => ({
        exists: true,
        target: path.join(cacheDir, name),
      })),
    ])
    expectSymlink(path.join(cacheDir, 'pub.link-4.0'))
    expectRow(outcome, 'home-vscode-extensions-cache', [
      'home-vscode-extensions-cache',
      'ok',
      '3.0KiB',
      '3.0KiB',
      '0B',
      '0B',
    ])
  })

  it('cursor-agent は最大日付の世代を全て retained set に固定し未知形式・symlink を保持する', () => {
    const fixture = makeFixture()
    makeVersionGens(fixture, [
      '2026.07.01-aaaaaaa',
      '2026.07.15-bbbbbbb',
      '2026.08.02-ccccccc',
      '2026.08.02-ddddddd',
    ])
    mkdirSync(path.join(versionsDir(fixture), 'nightly'), { recursive: true })
    symlinkSync('2026.07.01-aaaaaaa', path.join(versionsDir(fixture), '2026.05.01-fffffff'))

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, {
      contains: [
        'retained (最大日付 2026.08.02 の世代は曖昧として全保持):',
        'skip: nightly (未知の version 形式)',
      ],
      status: 0,
    })
    expectPaths([
      { exists: false, target: path.join(versionsDir(fixture), '2026.07.01-aaaaaaa') },
      { exists: false, target: path.join(versionsDir(fixture), '2026.07.15-bbbbbbb') },
      { exists: true, target: path.join(versionsDir(fixture), '2026.08.02-ccccccc') },
      { exists: true, target: path.join(versionsDir(fixture), '2026.08.02-ddddddd') },
      { exists: true, target: path.join(versionsDir(fixture), 'nightly') },
    ])
    expectSymlink(path.join(versionsDir(fixture), '2026.05.01-fffffff'))
    expectRowFullyReclaimed(outcome, 'cursor-agent-versions', 'ok')
  })

  it('agent symlink が指す世代を retained set に含める', () => {
    const fixture = makeFixture()
    makeVersionGens(fixture, ['2026.07.01-aaaaaaa', '2026.07.15-bbbbbbb', '2026.08.02-ccccccc'])
    linkAgentTo(fixture, '2026.07.01-aaaaaaa')

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, {
      contains: ['retained (agent symlink target): 2026.07.01-aaaaaaa'],
      status: 0,
    })
    expectPaths([
      { exists: true, target: path.join(versionsDir(fixture), '2026.07.01-aaaaaaa') },
      { exists: false, target: path.join(versionsDir(fixture), '2026.07.15-bbbbbbb') },
      { exists: true, target: path.join(versionsDir(fixture), '2026.08.02-ccccccc') },
    ])
  })

  it('codex process がいなければ ~/.codex/.tmp の entry を削除する', () => {
    const fixture = makeFixture()
    const fileEntry = path.join(codexTmpDir(fixture), 'session-file')
    const dirEntry = path.join(codexTmpDir(fixture), 'work-dir')
    writeSizedFile(fileEntry, 1024)
    writeSizedFile(path.join(dirEntry, 'payload'), 1024)

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, { contains: ['deleted: session-file (1.0KiB)'], status: 0 })
    expectPaths([
      { exists: false, target: fileEntry },
      { exists: false, target: dirEntry },
    ])
  })
})

describe('process 状態 (clear / active / unknown)', () => {
  it('process listing 取得失敗 (unknown) を該当なしとして扱わず実サイズを skipped に計上する', () => {
    const fixture = makeFixture()
    const { codexEntry, extEntry } = setupMixedHomeFixture(fixture)
    setPs(fixture, { mode: 'fail' })

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, {
      contains: ['skip: pub.one-1.0 (1.0KiB) (process listing が unknown: 非使用を証明できない)'],
      status: 0,
    })
    expectPaths([
      { exists: true, target: extEntry },
      { exists: true, target: codexEntry },
    ])
    expectRow(outcome, 'home-vscode-extensions-cache', [
      'home-vscode-extensions-cache',
      'ok (safety skip あり)',
      '0B',
      '0B',
      '1.0KiB',
      '0B',
    ])
    expectRowSkippedWithSize(outcome, 'cursor-agent-versions', 'skipped (process unknown)')
    expectRowSkippedWithSize(outcome, 'codex-tmp', 'skipped (process unknown)')
    expectCalls(fixture, { absent: ['rm '] })
  })

  it('codex app-server 常駐 (active) では codex-tmp を skip し他 category は処理する', () => {
    const fixture = makeFixture()
    const { codexEntry, extEntry, oldGen } = setupMixedHomeFixture(fixture)
    setPs(fixture, { mode: 'active-codex' })

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, {
      contains: ['skip: codex process が active (app-server 常駐環境ではこの skip は正常)'],
      status: 0,
    })
    expectPaths([
      { exists: true, target: codexEntry },
      { exists: false, target: extEntry },
      { exists: false, target: oldGen },
    ])
    expectRowSkippedWithSize(outcome, 'codex-tmp', 'skipped (active)')
  })

  it('cursor-agent が active なら versions を skip し codex-tmp は処理する', () => {
    const fixture = makeFixture()
    const { codexEntry, oldGen } = setupMixedHomeFixture(fixture)
    setPs(fixture, { mode: 'active-cursor' })

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, { contains: ['skip: cursor-agent process が active'], status: 0 })
    expectPaths([
      { exists: true, target: oldGen },
      { exists: false, target: codexEntry },
    ])
    expectRowSkippedWithSize(outcome, 'cursor-agent-versions', 'skipped (active)')
  })

  it('process が参照する extensionsCache entry は skip し参照されない entry は削除する', () => {
    const fixture = makeFixture()
    const referenced = path.join(extCacheDir(fixture), 'pub.one-1.0')
    const unreferenced = path.join(extCacheDir(fixture), 'pub.two-2.0')
    writeSizedFile(referenced, 1024)
    writeSizedFile(unreferenced, 2048)
    setPs(fixture, { extra: 'code --install-extension pub.one-1.0' })

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, {
      contains: ['skip: pub.one-1.0 (1.0KiB) (process が entry を参照: active)'],
      status: 0,
    })
    expectPaths([
      { exists: true, target: referenced },
      { exists: false, target: unreferenced },
    ])
    expectRow(outcome, 'home-vscode-extensions-cache', [
      'home-vscode-extensions-cache',
      'ok (safety skip あり)',
      '2.0KiB',
      '2.0KiB',
      '1.0KiB',
      '0B',
    ])
  })

  it('選択と削除の間に process 参照が現れた entry は削除直前に skip する', () => {
    const fixture = makeFixture()
    const entry = path.join(extCacheDir(fixture), 'pub.one-1.0')
    writeSizedFile(entry, 1024)
    // 1 回目の ps は全 category 共通の listing、2 回目は削除ループ内の直前再確認
    setPsCall(fixture, 2, { extra: 'code --install-extension pub.one-1.0' })

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, {
      contains: [
        'candidate: pub.one-1.0 (1.0KiB)',
        'skip: pub.one-1.0 (削除直前に process 参照を検出)',
      ],
      status: 0,
    })
    expect(existsSync(entry)).toBe(true)
    expectRow(outcome, 'home-vscode-extensions-cache', [
      'home-vscode-extensions-cache',
      'ok (safety skip あり)',
      '1.0KiB',
      '0B',
      '1.0KiB',
      '0B',
    ])
  })
})

describe('/vscode category', () => {
  it('共有 /vscode volume 上の extensionsCache は手動確認候補に留めて削除しない', () => {
    const fixture = makeFixture()
    const entry = path.join(makeVscodeExtCache(fixture), 'pub.one-1.0')
    writeSizedFile(entry, 1024)
    setDfProfile(fixture, 'vscode', { fs: '/dev/vdc', mount: '/vscode' })

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, {
      contains: [
        'manual-candidate: pub.one-1.0 (1.0KiB) — 共有 /vscode volume 上のため自動削除しない',
      ],
      status: 0,
    })
    expect(existsSync(entry)).toBe(true)
    expectRow(outcome, 'vscode-extensions-cache', [
      'vscode-extensions-cache',
      'skipped (共有 volume: 手動確認候補のみ)',
      '0B',
      '0B',
      '1.0KiB',
      '0B',
    ])
    expectCalls(fixture, { absent: ['sudo ', 'rm '] })
  })

  it('共有でない /vscode の extensionsCache は sudo -n で削除する', () => {
    const fixture = makeFixture()
    const entry = path.join(makeVscodeExtCache(fixture), 'pub.one-1.0')
    writeSizedFile(entry, 1024)

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, { status: 0 })
    expect(existsSync(entry)).toBe(false)
    expectCalls(fixture, { present: ['sudo -n true', `sudo -n rm -rf -- ${entry}`] })
    expectRow(outcome, 'vscode-extensions-cache', [
      'vscode-extensions-cache',
      'ok',
      '1.0KiB',
      '1.0KiB',
      '0B',
      '0B',
    ])
  })

  it('vscode-server/bin は dry-run で手動候補を表示し通常実行でも削除しない', () => {
    const fixture = makeFixture()
    const binRoot = setupServerBin(fixture)

    const dryRun = runScript(fixture, ['--dry-run'])
    const real = runScript(fixture, [])

    expectOutcome(dryRun, {
      contains: [
        'manual-only: abc1234 (',
        'manual-only: linux-arm64/def5678 (',
        '※ 削除する場合は共有 /vscode volume を使う全 container の停止を確認したうえで手動で行うこと',
      ],
      status: 0,
    })
    expectOutcome(real, { status: 0 })
    expectPaths([
      { exists: true, target: path.join(binRoot, 'abc1234') },
      { exists: true, target: path.join(binRoot, 'linux-arm64', 'def5678') },
    ])
    expectRow(real, 'vscode-server-bin', [
      'vscode-server-bin',
      'manual-only',
      '0B',
      '0B',
      '0B',
      '0B',
    ])
    expectCalls(fixture, { absent: ['rm '] })
  })
})

describe('test root と削除 invariant', () => {
  const rejectedTestRoots: { build: (fixture: Fixture) => string; name: string }[] = [
    { build: () => '', name: '空文字' },
    { build: () => '/', name: '/' },
    { build: () => repoRoot, name: 'repository root' },
    { build: () => path.join(tempRoot, '..', 'scripts'), name: 'traversal で .temp 外' },
    { build: (fixture) => path.join(fixture.dir, 'missing'), name: '存在しない path' },
    {
      build: (fixture) => {
        const link = path.join(fixture.dir, 'escape-link')
        symlinkSync('/tmp', link)
        return link
      },
      name: 'symlink が .temp 外へ解決される',
    },
  ]

  it.each(rejectedTestRoots)('--test-root を拒否する: $name', ({ build }) => {
    const fixture = makeFixture()

    const outcome = runScriptRaw(fixture, ['--test-root', build(fixture)])

    expectOutcome(outcome, { status: 2, stderrContains: ['error: --test-root'] })
  })

  it('test root の中間 component が symlink なら境界外を走査せず skip する', () => {
    const fixture = makeFixture()
    const elsewhere = path.join(fixture.dir, 'elsewhere')
    const escapedEntry = path.join(elsewhere, 'vscode-server', 'extensionsCache', 'pub.one-1.0')
    writeSizedFile(escapedEntry, 1024)
    symlinkSync(elsewhere, path.join(fixture.testRoot, 'vscode'))

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, {
      contains: [
        'skip: root または中間 component が symlink、または canonical path が allowlist と一致しない',
      ],
      status: 0,
    })
    expect(summaryRow(outcome.stdout, 'vscode-extensions-cache')[1]).toBe('skipped')
    expect(existsSync(escapedEntry)).toBe(true)
    expectCalls(fixture, { absent: ['rm ', 'sudo '] })
  })

  it('leading dash・空白・改行を含む basename は削除しない', () => {
    const fixture = makeFixture()
    const normal = path.join(codexTmpDir(fixture), 'normal-entry')
    writeSizedFile(normal, 1024)
    writeSizedFile(path.join(codexTmpDir(fixture), '-leading-dash'), 1024)
    writeSizedFile(path.join(codexTmpDir(fixture), 'with space'), 1024)
    writeSizedFile(path.join(codexTmpDir(fixture), 'with\nnewline'), 1024)

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, {
      contains: [
        'skip: -leading-dash (basename が安全でない)',
        'skip: with space (basename が安全でない)',
        'skip: with?newline (basename が安全でない)',
      ],
      status: 0,
    })
    expectPaths([
      { exists: false, target: normal },
      { exists: true, target: path.join(codexTmpDir(fixture), '-leading-dash') },
      { exists: true, target: path.join(codexTmpDir(fixture), 'with space') },
      { exists: true, target: path.join(codexTmpDir(fixture), 'with\nnewline') },
    ])
    expectRow(outcome, 'codex-tmp', ['codex-tmp', 'ok', '1.0KiB', '1.0KiB', '0B', '0B'])
  })

  it('削除直前の再検証で candidate の identity (inode・type) 変化を検出して skip する', () => {
    const fixture = makeFixture()
    const entry = path.join(extCacheDir(fixture), 'pub.one-1.0')
    writeSizedFile(entry, 1024)
    // 削除ループ内の直前 ps (2 回目) で file を同名 directory に入れ替える
    setPsCall(fixture, 2, {
      run: `"$REAL_RM" -rf -- ${shQuote(entry)} && mkdir ${shQuote(entry)}`,
    })

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, {
      contains: ['skip: pub.one-1.0 (削除直前の再検証に失敗)'],
      status: 0,
    })
    expect(statSync(entry).isDirectory()).toBe(true)
    expectRow(outcome, 'home-vscode-extensions-cache', [
      'home-vscode-extensions-cache',
      'ok (safety skip あり)',
      '1.0KiB',
      '0B',
      '1.0KiB',
      '0B',
    ])
  })

  it('選択と削除の間に候補が消失したら race skip になる', () => {
    const fixture = makeFixture()
    const entry = path.join(extCacheDir(fixture), 'pub.one-1.0')
    writeSizedFile(entry, 1024)
    setPsCall(fixture, 2, { run: `"$REAL_RM" -rf -- ${shQuote(entry)}` })

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, { contains: ['skip: pub.one-1.0 (race で消失)'], status: 0 })
    expect(existsSync(entry)).toBe(false)
    expectRow(outcome, 'home-vscode-extensions-cache', [
      'home-vscode-extensions-cache',
      'ok (safety skip あり)',
      '1.0KiB',
      '0B',
      '1.0KiB',
      '0B',
    ])
  })

  it('cursor の retained set が削除中に変化したら残り候補を skip する', () => {
    const fixture = makeFixture()
    const oldGen = makeVersionGen(fixture, '2026.07.01-aaaaaaa')
    const retained = makeVersionGen(fixture, '2026.08.02-ccccccc')
    setPsCall(fixture, 2, { run: `"$REAL_RM" -rf -- ${shQuote(retained)}` })

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, {
      contains: ['skip: retained set の存在・type・identity が変化したため残り 1 件 ('],
      status: 0,
    })
    expectPaths([
      { exists: true, target: oldGen },
      { exists: false, target: retained },
    ])
    expect(summaryRow(outcome.stdout, 'cursor-agent-versions')[1]).toBe('ok (safety skip あり)')
  })
})

describe('手動確認 category (vscode-server-bin)', () => {
  it('世代 directory の列挙失敗を manual-only (partial) として記録し exit 1 を返す', () => {
    const fixture = makeFixture()
    const binRoot = setupServerBin(fixture)
    setFindFail(fixture, path.join(binRoot, 'linux-arm64'))

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, {
      contains: ['failed: linux-arm64 (列挙失敗)', '結果: operational failure 1 件 → exit 1'],
      status: 1,
    })
    expect(summaryRow(outcome.stdout, 'vscode-server-bin')[1]).toBe('manual-only (partial)')
  })

  it('世代の du 失敗を manual-only (partial) として記録し exit 1 を返す', () => {
    const fixture = makeFixture()
    const binRoot = setupServerBin(fixture)
    setDuFail(fixture, path.join(binRoot, 'abc1234'))

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, {
      contains: ['failed: abc1234 (du 失敗; size 不明)', '結果: operational failure 1 件 → exit 1'],
      status: 1,
    })
    expect(summaryRow(outcome.stdout, 'vscode-server-bin')[1]).toBe('manual-only (partial)')
    expectPaths([{ exists: true, target: path.join(binRoot, 'abc1234') }])
  })
})

describe('dry-run と冪等性', () => {
  it('dry-run は候補表示のみ行い sudo / rm / npm を一切呼ばない', () => {
    const fixture = makeFixture()
    const keptTargets = [...setupHomeCategories(fixture), ...setupVscodeCategories(fixture)]

    const outcome = runScript(fixture, ['--dry-run'])

    expectOutcome(outcome, {
      contains: [
        '無条件モード (閾値引数なし) → dry-run のため候補表示のみ行う',
        '[dry-run] 実行時は sudo -n による権限昇格が必要 (dry-run では sudo を呼ばない)',
        '(dry-run のため reclaimed は常に 0。candidate が実行時の回収見込み)',
      ],
      status: 0,
    })
    expectPaths(keptTargets.map((target) => ({ exists: true, target })))
    expectCalls(fixture, { absent: ['sudo ', 'rm ', 'npm '] })
    expectRow(outcome, 'home-vscode-extensions-cache', [
      'home-vscode-extensions-cache',
      'ok',
      '1.0KiB',
      '0B',
      '0B',
      '0B',
    ])
  })

  it('連続実行で候補が空になる (冪等性)', () => {
    const fixture = makeFixture()
    setupHomeCategories(fixture)

    const first = runScript(fixture, [])
    const second = runScript(fixture, [])

    expectOutcome(first, { contains: ['deleted: pub.one-1.0 (1.0KiB)'], status: 0 })
    expect(existsSync(cacacheDir(fixture))).toBe(false)
    expectOutcome(second, {
      contains: ['結果: 正常終了 (exit 0)'],
      notContains: ['deleted:'],
      status: 0,
    })
    expectRowStatuses(second, {
      'codex-tmp': 'ok (候補なし)',
      'cursor-agent-versions': 'ok (候補なし)',
      'home-vscode-extensions-cache': 'ok (候補なし)',
      'npm-cacache': 'no-op',
    })
  })
})

describe('部分失敗と独立 category の継続', () => {
  it('何もない環境は全 category no-op で exit 0', () => {
    const fixture = makeFixture()

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, { contains: ['結果: 正常終了 (exit 0)'], status: 0 })
    expectRowStatuses(outcome, {
      'codex-tmp': 'no-op',
      'cursor-agent-versions': 'no-op',
      'home-vscode-extensions-cache': 'no-op',
      'npm-cacache': 'no-op',
      'vscode-extensions-cache': 'no-op',
      'vscode-server-bin': 'no-op',
    })
  })

  it('sudo -n 不可は vscode category のみ failed にし報告を最後まで継続して exit 1', () => {
    const fixture = makeFixture()
    const vscodeEntry = path.join(makeVscodeExtCache(fixture), 'pub.one-1.0')
    writeSizedFile(vscodeEntry, 1024)
    writeSizedFile(path.join(codexTmpDir(fixture), 'session-file'), 1024)
    setSudo(fixture, 'fail')

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, {
      contains: [
        'failed: sudo -n が利用できない (候補 1.0KiB を回収できない)',
        '== category: vscode-server-bin',
        '結果: operational failure 1 件 → exit 1',
      ],
      status: 1,
    })
    expect(existsSync(vscodeEntry)).toBe(true)
    expectRow(outcome, 'vscode-extensions-cache', [
      'vscode-extensions-cache',
      'failed (sudo 不可)',
      '1.0KiB',
      '0B',
      '0B',
      '1.0KiB',
    ])
    expect(summaryRow(outcome.stdout, 'codex-tmp')[1]).toBe('ok')
  })

  it('entry の削除失敗は partial として記録し後続 category を継続して exit 1', () => {
    const fixture = makeFixture()
    const { other, victim, vscodeEntry } = setupPartialDeleteFixture(fixture)
    setRmFail(fixture, 'victim')

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, { contains: ['failed: victim (削除失敗)'], status: 1 })
    expectPaths([
      { exists: true, target: victim },
      { exists: false, target: other },
      { exists: false, target: vscodeEntry },
    ])
    expectRow(outcome, 'codex-tmp', ['codex-tmp', 'partial', '3.0KiB', '2.0KiB', '0B', '1.0KiB'])
  })

  it('entry の du 失敗は partial として記録して exit 1', () => {
    const fixture = makeFixture()
    const bad = path.join(codexTmpDir(fixture), 'bad-entry')
    const good = path.join(codexTmpDir(fixture), 'good-entry')
    writeSizedFile(bad, 1024)
    writeSizedFile(good, 2048)
    setDuFail(fixture, 'bad-entry')

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, { contains: ['failed: bad-entry (du 失敗)'], status: 1 })
    expectPaths([
      { exists: true, target: bad },
      { exists: false, target: good },
    ])
    expectRow(outcome, 'codex-tmp', ['codex-tmp', 'partial', '2.0KiB', '2.0KiB', '0B', '0B'])
  })

  it('category root の du 失敗は category を failed にして独立 category を継続する', () => {
    const fixture = makeFixture()
    const { codexEntry, extEntry } = setupExtAndCodex(fixture)
    setDuFail(fixture, '.vscode-server/extensionsCache')

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, { status: 1 })
    expectPaths([
      { exists: true, target: extEntry },
      { exists: false, target: codexEntry },
    ])
    expectRow(outcome, 'home-vscode-extensions-cache', [
      'home-vscode-extensions-cache',
      'failed',
      '0B',
      '0B',
      '0B',
      '0B',
    ])
    expect(summaryRow(outcome.stdout, 'codex-tmp')[1]).toBe('ok')
  })
})

describe('npm cache 経路', () => {
  it('npm cache clean --force 経路で _cacache を回収する', () => {
    const fixture = makeFixture()
    writeSizedFile(path.join(cacacheDir(fixture), 'index-v5', 'entry'), 1024)
    writeSizedFile(path.join(cacacheDir(fixture), 'content-v2', 'entry'), 2048)

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, {
      contains: [`npm cache clean --force --cache ${fixture.homeDir}/.npm を実行`],
      status: 0,
    })
    expectCalls(fixture, {
      present: ['npm config get cache', `npm cache clean --force --cache ${fixture.homeDir}/.npm`],
    })
    expect(existsSync(cacacheDir(fixture))).toBe(false)
    expectRowFullyReclaimed(outcome, 'npm-cacache', 'ok (npm 経路)')
  })

  it('npm が起動不能でも検証済み _cacache 直接削除で回収し npm 経路の失敗として exit 1', () => {
    const fixture = makeFixture()
    const { children, strayLink } = setupCacacheFallback(fixture)
    setNpm(fixture, 'fail')

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, {
      contains: ['npm が不在または cache 設定を検証できない。検証済み直接削除へフォールバック'],
      status: 1,
    })
    expectPaths(children.map((child) => ({ exists: false, target: child })))
    expectSymlink(strayLink)
    expect(summaryRow(outcome.stdout, 'npm-cacache')[1]).toBe(
      'ok (fallback 直接削除; npm 経路は失敗)'
    )
    expectCalls(fixture, { absent: ['npm cache clean'], present: ['npm config get cache'] })
  })

  it('cache 設定の検証後に _cacache が別 inode へ差し替わったら npm 経路を実行しない', () => {
    const fixture = makeFixture()
    const cacache = setupCacacheRootSwap(fixture)

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, {
      contains: ['skip: 実行直前に root の canonical path / 中間 component / identity が変化した'],
      status: 0,
    })
    expectCalls(fixture, { absent: ['npm cache clean'] })
    expect(existsSync(path.join(cacache, 'kept'))).toBe(true)
    expect(summaryRow(outcome.stdout, 'npm-cacache')[1]).toBe('skipped (root 変化)')
  })

  it('npm の cache 設定が allowlist 外を指す場合は npm 経路を使わず直接削除する', () => {
    const fixture = makeFixture()
    const child = path.join(cacacheDir(fixture), 'index-v5')
    writeSizedFile(path.join(child, 'entry'), 1024)
    setNpm(fixture, 'badconfig')

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, { status: 1 })
    expectCalls(fixture, { absent: ['npm cache clean'], present: ['npm config get cache'] })
    expect(existsSync(child)).toBe(false)
  })

  it('npm cache clean --force が失敗したら直接削除へフォールバックして exit 1', () => {
    const fixture = makeFixture()
    const child = path.join(cacacheDir(fixture), 'index-v5')
    writeSizedFile(path.join(child, 'entry'), 1024)
    setNpm(fixture, 'clean-fail')

    const outcome = runScript(fixture, [])

    expectOutcome(outcome, {
      contains: ['npm cache clean --force が失敗。検証済み直接削除へフォールバック'],
      status: 1,
    })
    expect(existsSync(child)).toBe(false)
    expect(summaryRow(outcome.stdout, 'npm-cacache')[1]).toBe(
      'ok (fallback 直接削除; npm 経路は失敗)'
    )
  })
})

describe('引数・環境エラー', () => {
  const argErrorCases = [
    { args: ['--bogus'], name: '未知の引数' },
    { args: ['extra'], name: 'positional 引数' },
    { args: ['--threshold'], name: '--threshold の値なし' },
    { args: ['--threshold', 'abc'], name: '--threshold 非数値' },
    { args: ['--threshold', '0'], name: '--threshold 範囲外 (0)' },
    { args: ['--threshold', '101'], name: '--threshold 範囲外 (101)' },
    { args: ['--threshold', '9223372036854775808'], name: '--threshold int64 範囲外' },
    { args: ['--threshold', ''], name: '--threshold 空文字' },
    { args: ['--min-free-bytes'], name: '--min-free-bytes の値なし' },
    { args: ['--min-free-bytes', ''], name: '--min-free-bytes 空文字' },
    { args: ['--min-free-bytes', '-1'], name: '--min-free-bytes 負数' },
    { args: ['--min-free-bytes', '9223372036854775808'], name: '--min-free-bytes int64 範囲外' },
    { args: ['--min-free-bytes', '99999999999999999999'], name: '--min-free-bytes 20 桁' },
  ]

  it.each(argErrorCases)('引数エラーは exit 2: $name', ({ args }) => {
    const fixture = makeFixture()

    const outcome = runScript(fixture, args)

    expect(outcome.status).toBe(2)
    expect(outcome.stderr).toMatch(/^(?<kind>error|usage):/m)
  })

  it('HOME 未設定は exit 1', () => {
    const fixture = makeFixture()

    const outcome = runScript(fixture, [], { HOME: '' })

    expectOutcome(outcome, {
      status: 1,
      stderrContains: ['error: HOME が未設定のため allowlist root を構成できない'],
    })
  })
})

// local_setup.sh 全体は npm ci や対話を伴い実行できないため、wrapper 本体を
// ファイルから抽出して実行する。wrapper が削除・改変されれば抽出に失敗して検知できる
const extractLocalSetupWrapper = (): string => {
  const lines = readFileSync(path.join(repoRoot, 'local_setup.sh'), 'utf8').split('\n')
  const start = lines.indexOf('cleanup_status=0')
  const end = lines.findIndex((line, index) => index > start && line === 'fi')
  if (start === -1 || end === -1) {
    throw new Error('cleanup wrapper block not found in local_setup.sh')
  }
  return lines.slice(start, end + 1).join('\n')
}

const extractPostStartCommand = (): string => {
  const jsonc = readFileSync(path.join(repoRoot, '.devcontainer', 'devcontainer.json'), 'utf8')
  const match = /"postStartCommand"\s*:\s*"(?<command>(?:[^"\\]|\\.)*)"/.exec(jsonc)
  if (match === null) {
    throw new Error('postStartCommand not found in devcontainer.json')
  }
  const value: unknown = JSON.parse(`"${match[1]}"`)
  if (typeof value !== 'string') {
    throw new Error('postStartCommand is not a string')
  }
  return value
}

const makeWrapperFixture = (stubExit: number | null): { argsFile: string; dir: string } => {
  const dir = createScratchDir('clean-devcontainer-disk-wrapper-test')
  mkdirSync(path.join(dir, 'scripts'))
  const argsFile = path.join(dir, 'stub-args')
  if (stubExit !== null) {
    writeFileSync(
      path.join(dir, 'scripts', 'clean-devcontainer-disk.sh'),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$*" > ${shQuote(argsFile)}\nexit ${stubExit}\n`
    )
  }
  return { argsFile, dir }
}

const runWrapper = (wrapperBody: string, dir: string): ScriptOutcome => {
  const result = spawnSync('bash', ['-c', wrapperBody], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, HOME: dir },
  })
  return { status: result.status ?? -1, stderr: result.stderr, stdout: result.stdout }
}

describe('起動 hook wrapper (local_setup.sh / postStartCommand)', () => {
  const wrapperCases: { name: string; stubExit: number | null }[] = [
    { name: 'script exit 1', stubExit: 1 },
    { name: 'script exit 2', stubExit: 2 },
    { name: 'script 不在', stubExit: null },
  ]

  it.each(wrapperCases)(
    'local_setup.sh wrapper は $name を警告して wrapper 自体は exit 0',
    ({ stubExit }) => {
      const { argsFile, dir } = makeWrapperFixture(stubExit)

      const outcome = runWrapper(extractLocalSetupWrapper(), dir)

      expectOutcome(outcome, {
        status: 0,
        stderrContains: ['warning: devcontainer disk cleanup failed (exit '],
      })
      if (stubExit !== null) {
        expect(outcome.stderr).toContain(`(exit ${stubExit})`)
        expect(readFileSync(argsFile, 'utf8')).toContain('--threshold 90')
      }
    }
  )

  it('local_setup.sh は npm ci / npm install より前に cleanup wrapper を実行する', () => {
    const content = readFileSync(path.join(repoRoot, 'local_setup.sh'), 'utf8')
    const wrapperIndex = content.indexOf('cleanup_status=0')
    const npmIndex = content.search(/^\s+npm (?<cmd>ci|install)$/m)
    expect(wrapperIndex).toBeGreaterThanOrEqual(0)
    expect(npmIndex).toBeGreaterThan(wrapperIndex)
  })

  it.each(wrapperCases)(
    'postStartCommand は $name を警告して wrapper 自体は exit 0',
    ({ stubExit }) => {
      const { argsFile, dir } = makeWrapperFixture(stubExit)
      const command = extractPostStartCommand()
      for (const expected of ['cleanup_status=0', '--threshold 90']) {
        expect(command).toContain(expected)
      }

      const outcome = runWrapper(command, dir)

      expectOutcome(outcome, {
        status: 0,
        stderrContains: ['warning: devcontainer disk cleanup failed (exit '],
      })
      if (stubExit !== null) {
        expect(outcome.stderr).toContain(`(exit ${stubExit})`)
        expect(readFileSync(argsFile, 'utf8')).toContain('--threshold 90')
      }
    }
  )
})
