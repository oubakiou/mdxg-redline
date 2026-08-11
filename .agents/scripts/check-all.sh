#!/bin/bash
set -euo pipefail

# build は dist だけでなく src/core/shiki-aliases.generated.ts (lint / test 対象のソース) も
# 再生成するため、後続の check / test がその最新状態を検証できるよう最初に走らせる
npm run build
npm run check
npm run test
