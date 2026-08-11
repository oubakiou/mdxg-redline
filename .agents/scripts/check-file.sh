#!/bin/bash
set -uo pipefail

file="${1:-}"

if [ -z "$file" ] || [ ! -e "$file" ]; then
  exit 0
fi

npm run check:fix -- "$file"
