# Conformance（準拠）

実装は、MDXG への準拠を以下の 2 つのレベルのいずれかで主張できる。

## MDXG Viewer

読み取り専用の実装。

[MUST] 以下をサポートする：

- テーマ適応（[セクション 1](./01-rendering.md#1-themingテーマ)）
- 構文ハイライトとコピーボタン付きコードブロック描画（[セクション 2](./01-rendering.md#2-code-block-renderingコードブロック描画)）
- タスクリスト描画（[セクション 3](./01-rendering.md#3-task-listsタスクリスト)）
- 画像描画（[セクション 4](./01-rendering.md#4-images画像)）
- テーブル描画（[セクション 5](./01-rendering.md#5-tables表)）
- H1 / H2 境界による仮想ページ（[セクション 6](./02-document-structure.md#6-virtual-pages仮想ページ)）
- ページナビゲーション（[セクション 7](./02-document-structure.md#7-page-navigationページナビゲーション)）
- ページアウトライン（[セクション 8](./02-document-structure.md#8-page-outlineページアウトライン)）
- 逐次ナビゲーション（[セクション 9](./02-document-structure.md#9-sequential-navigation逐次ナビゲーション)）
- 検索（[セクション 10](./02-document-structure.md#10-search検索)）
- キーボードナビゲーション（[セクション 13](./04-accessibility.md#13-keyboard-navigationキーボードナビゲーション)）

[MAY] MDXG Viewer はソースビュー（セクション 11.2）とモード切り替え（セクション 11.4）をサポートしてもよいが、Viewer 準拠としては必須ではない。ソース編集とドキュメントリンクは必須ではない。

## MDXG Editor

フル実装。

[MUST] MDXG Viewer のすべてに加え、以下をサポートする：

- プレビューとソース間のモード切り替え（[セクション 11.4](./03-editing.md#114-toggle-behavior切り替えの挙動)）
- 背後ドキュメントへ同期するソース編集（[セクション 11.3](./03-editing.md#113-source-editソース編集)）
- MDXG で開かれるドキュメントリンク（[セクション 12](./03-editing.md#12-document-linksドキュメントリンク)）

拡張（セクション 14–16）は SHOULD レベルで、いずれのレベルでも準拠主張には影響しないが、実装にはこれらのサポートが推奨される。
