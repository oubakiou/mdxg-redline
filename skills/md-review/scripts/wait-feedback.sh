#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 <feedback-json-path> [timeout-seconds]" >&2
  exit 64
}

[ $# -lt 1 ] && usage

FEEDBACK="$1"
TIMEOUT="${2:-1800}"

timeout "$TIMEOUT" bash -c 'until [ -f "$1" ]; do sleep 5; done' bash "$FEEDBACK"
