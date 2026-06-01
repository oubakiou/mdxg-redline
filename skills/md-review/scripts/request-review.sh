#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 [--no-open] <input.md> [output-dir]" >&2
  exit 64
}

EXTRA_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --no-open)
      EXTRA_ARGS+=(--no-open)
      shift
      ;;
    -h|--help)
      usage
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "request-review.sh: unknown flag: $1" >&2
      usage
      ;;
    *)
      break
      ;;
  esac
done

[ $# -lt 1 ] && usage

INPUT="$1"
OUTPUT="${2:-}"

if [ -n "$OUTPUT" ]; then
  REVIEW_HTML="$(npx mdxg-redline "${EXTRA_ARGS[@]}" "$INPUT" "$OUTPUT" | tail -n1)"
else
  REVIEW_HTML="$(npx mdxg-redline "${EXTRA_ARGS[@]}" "$INPUT" | tail -n1)"
fi

if [ -z "$REVIEW_HTML" ]; then
  echo "request-review.sh: empty stdout from npx mdxg-redline" >&2
  exit 1
fi

FEEDBACK_JSON="${REVIEW_HTML%-review.html}-feedback.json"

echo "REVIEW_HTML=$REVIEW_HTML"
echo "FEEDBACK_JSON=$FEEDBACK_JSON"
