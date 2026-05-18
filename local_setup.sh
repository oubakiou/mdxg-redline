#!/bin/bash
set -euo pipefail

alias npx='npx --no-install'

# 初回は package-lock.json が無いので npm install、それ以降は npm ci でロック厳守
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

# claude コマンドのシンボリックリンクを作成
CLAUDE_BIN="$(cd "$(dirname "$0")" && pwd)/node_modules/.bin/claude"
sudo ln -sf "$CLAUDE_BIN" /usr/local/bin/claude
node node_modules/@anthropic-ai/claude-code/install.cjs

# codex コマンドのシンボリックリンクを作成
CODEX_BIN="$(cd "$(dirname "$0")" && pwd)/node_modules/.bin/codex"
sudo ln -sf "$CODEX_BIN" /usr/local/bin/codex

# .claude/settings.local.json が無ければ example からコピー
if [ ! -f .claude/settings.local.json ]; then
  cp .claude/settings.example.json .claude/settings.local.json
  echo ".claude/settings.local.json を作成しました"
fi

# CLAUDE.local.md が無ければ example からコピー
if [ ! -f CLAUDE.local.md ]; then
  cp CLAUDE.example.md CLAUDE.local.md
  echo "CLAUDE.local.md を作成しました"
fi

echo "デフォルトskillをインストールします"
gh auth login
gh skill install oubakiou/skills guarded-webfetch-codex --agent claude-code --scope project
gh skill install oubakiou/skills guarded-websearch-codex --agent claude-code --scope project

# npm にインストールされた vite-plus の vp をグローバル参照できるようにする
echo "npm 管理の vite-plus(vp) を設定します"
VP_BIN="$(cd "$(dirname "$0")" && pwd)/node_modules/.bin/vp"
sudo ln -sf "$VP_BIN" /usr/local/bin/vp

# git 設定
git config --local core.hooksPath .githooks
# Oh My Zsh が LESS=-R を設定し F フラグが欠落するため、git の pager を明示的に指定
git config --global core.pager 'less -FRX'
