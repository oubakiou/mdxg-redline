#!/bin/bash
# PostToolUse フック: Edit/Write 後に vp check --fix を実行し、
# 修正不可能なエラーがあれば additionalContext として Claude にフィードバックする
set -uo pipefail

file=$(jq -r '.tool_input.file_path')
[ -z "$file" ] && exit 0

if ! out=$(vp check --fix "$file" 2>&1); then
  printf '%s' "$out" | jq -Rs '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: ("vp check --fix failed:\n" + .)
    }
  }'
fi
exit 0
