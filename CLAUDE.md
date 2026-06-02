@AGENTS.md
@CLAUDE.local.md

- ユーザーに確認する場合はAskUserQuestion toolを利用して選択肢を提示する
- TypeScript のコード調査・変更検証には Claude Code の `LSP` deferred tool を活用する。初回利用時は `ToolSearch query="select:LSP"` で schema を読み込んでから呼び出す。シンボルの定義 / 参照解決（`goToDefinition` / `findReferences` 等）と、変更後の型エラー・未解決 import の単一ファイル確認（`getDiagnostics`）を組み合わせる。ただし `getDiagnostics` は指定ファイル中心で全走査ではないため、横断的な最終確認は `vp check` を併用する。ファイル移動に伴う import パスの自動書き換えは行われないので、書き換えは別途行い `getDiagnostics` / `vp check` で検証する
