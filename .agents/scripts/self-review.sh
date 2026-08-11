#!/bin/bash
set -euo pipefail

git diff --check
npm run check
npm run test
