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
gh skill install . md-review --from-local --agent claude-code --scope project --force
gh skill install anthropics/skills skill-creator --agent claude-code --scope project
gh skill install oubakiou/skills guarded-webfetch-codex --agent claude-code --scope project
gh skill install oubakiou/skills guarded-websearch-codex --agent claude-code --scope project

# python3はskill-creator 同梱の Python スクリプト (eval-viewer 等) を実行するために必要
# bubblewrapはCodexに必要
sudo apt-get update -qq && sudo apt-get install -y -qq python3 libpython3-stdlib bubblewrap > /dev/null 2>&1

# npm にインストールされた vite-plus の vp をグローバル参照できるようにする
echo "npm 管理の vite-plus(vp) を設定します"
VP_BIN="$(cd "$(dirname "$0")" && pwd)/node_modules/.bin/vp"
if [ ! -x "$VP_BIN" ]; then
  echo "vp が見つかりません。npm install に失敗している可能性があります: $VP_BIN"
  exit 1
fi
sudo ln -sf "$VP_BIN" /usr/local/bin/vp

# typescript-lsp plugin から typescript-language-server を参照できるようにする
TS_LSP_BIN="$(cd "$(dirname "$0")" && pwd)/node_modules/.bin/typescript-language-server"
if [ ! -x "$TS_LSP_BIN" ]; then
  echo "typescript-language-server が見つかりません: $TS_LSP_BIN"
  exit 1
fi
sudo ln -sf "$TS_LSP_BIN" /usr/local/bin/typescript-language-server

# git 設定
git config --local core.hooksPath .githooks
# Oh My Zsh が LESS=-R を設定し F フラグが欠落するため、git の pager を明示的に指定
git config --global core.pager 'less -FRX'
