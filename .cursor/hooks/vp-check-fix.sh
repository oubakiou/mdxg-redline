#!/usr/bin/env bash
# Cursor postToolUse フック (matcher: Write): Write 後に vp check --fix を実行する。
# Composer の StrReplace も postToolUse では tool_name=Write として届く。
# 修正不可能なエラーは additional_context としてエージェントへ返す。
set -uo pipefail

strip_ansi() {
  sed $'s/\x1b\\[[0-9;]*m//g'
}

input=$(cat)
event=$(printf '%s' "$input" | jq -r '.hook_event_name // empty')
file=$(printf '%s' "$input" | jq -r '
  .file_path //
  .tool_input.file_path //
  .tool_input.path //
  empty
')

# hook 発火確認用 (delegate 検証)。CURSOR_HOOK_PROBE=1 時のみ .temp/cursor-hook-probe.log に追記。
if [ -n "${CURSOR_HOOK_PROBE:-}" ]; then
  mkdir -p .temp
  tool_name=$(printf '%s' "$input" | jq -r '.tool_name // empty')
  printf '%s event=%s tool=%s file=%s\n' "$(date -Iseconds)" "$event" "$tool_name" "$file" >> .temp/cursor-hook-probe.log
fi

if [ -z "$file" ] || [ "$file" = "null" ] || [ ! -f "$file" ]; then
  exit 0
fi

if ! out=$(vp check --fix "$file" 2>&1); then
  if [ "$event" = "postToolUse" ]; then
    printf '%s' "$out" | strip_ansi | jq -Rs '{ additional_context: ("vp check --fix failed:\n" + .) }'
  fi
fi
exit 0
