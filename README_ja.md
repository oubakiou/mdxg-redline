# mdxg-redline

[![English](https://img.shields.io/badge/Language-English-lightgrey?style=for-the-badge)](./README.md)
[![日本語](https://img.shields.io/badge/言語-日本語-blue?style=for-the-badge)](./README_ja.md)

**MDXG に準拠した markdown レビューツール — 単一 HTML ファイルだけで動作し、レビューコメントを構造化 JSON として書き出して LLM エージェントに引き渡す。**

> [vercel-labs/mdxg](https://github.com/vercel-labs/mdxg) のサードパーティ実装です。規格としての MDXG に準拠しますが、Vercel Labs / 本家リポジトリとは無関係です。

`mdxg-redline` は、LLM エージェントが人間レビュワーから「長文 markdown に対するフィードバック」を **散文の感想ではなく位置情報付きの構造化 JSON** として受け取るためのブラウザツールです。LLM エージェントと人間レビュワーの間に立ち、「markdown を貼って、散文のフィードバックを受け取る」という曖昧なループを、**機械可読なフィードバック成果物** に置き換えます。

エンドユーザーには **単一 HTML ファイル**（`review.html`）を配布するだけで動きます。サーバー不要・追加インストール不要・ LLM コンテンツ起点での外部通信ゼロ。

## 特徴

- **位置情報付きインラインコメント**: 任意のテキスト範囲を選択してコメントを残し、`headingPath` と `sourceLine` で位置を特定できる JSON を出力
- **単一 HTML 配布**: `marked` を含む全依存を inline、CDN 参照なし
- **2 つの入力経路**: HTML への事前注入（埋め込み） / ブラウザでのファイル選択
- **読み取り専用**: 原文 markdown を改変しない

## 使い方

### 入手

以下のいずれかで `review.html` を入手します:

- **ダウンロード**: GitHub Releases から `review.html` を直接ダウンロード（インストール不要）
- **npm**: `npm install mdxg-redline` で取得し `node_modules/mdxg-redline/dist/review.html` を使用

### 最短ルート

`review.html` をブラウザで開き、`Open file` で markdown を読み込み、選択 → `＋ Comment` でコメント → `Comments ▾ → Copy as JSON` で書き戻し。

### `npx mdxg-redline` でレビュー依頼用 HTML を生成して開く

LLM エージェントから人間にレビューを依頼する場合や、手元の markdown 1 ファイルを単発レビューしたい場合に、同梱 CLI で markdown を埋め込んだ HTML を生成してそのままブラウザで開けます。

```bash
npx mdxg-redline <input.md>                       # input.md と同じディレクトリに書き、ブラウザを起動
npx mdxg-redline <input.md> ./reviews             # ./reviews に書き出す
npx mdxg-redline --no-open <input.md>             # 生成のみ、ブラウザは起動しない
cat spec.md | npx mdxg-redline - --document-name spec.md   # stdin から markdown を読み込む
npx mdxg-redline --help                           # 使い方ヘルプを表示
```

- 出力ファイル名は `<入力 MD basename>-<docHash>-review.html` で自動決定（`output-dir` 省略時は入力と同じディレクトリ、stdin 入力時は cwd）
- `--document-name <name>` で docName（`data-name` 属性 / 出力ファイル名 prefix）を上書きできる。stdin 入力時に意味のあるファイル名を付けたい場合に推奨
- 生成後、既定で `$BROWSER` → `open` / `xdg-open` / `cmd.exe /c start` の優先順で標準ブラウザを開く
- VS Code Remote Containers / Codespaces を検知した場合のみ、`127.0.0.1` のデフォルトポート `51729` に軽量 HTTP サーバーを立ててホスト側ブラウザに転送する（`MDXG_REDLINE_PORT` で上書き可）。`file://` がホストから見えない環境向けの fallback。衝突時はランダムポートへ fallback して stderr に警告を出すが、**ランダムポートは `forwardPorts: "auto"` 設定でないとホスト側ブラウザから到達できない可能性がある**ため、空きが確定しているポートを `MDXG_REDLINE_PORT` で固定するか、`devcontainer.json` の `forwardPorts` に登録するのが推奨
- `--no-open` で自動起動を抑止。stdout には常に生成パスが出るので CI / エージェントから拾える
- 動作要件は Node.js 20+（`package.json` の `engines.node`）

詳細・エスケープ仕様・命名規約は [docs/DESIGN.md §3 ユーザーフロー](docs/DESIGN.md#3-ユーザーフロー) と [§8 ワークスペースプロトコル](docs/DESIGN.md#8-ワークスペースプロトコル) を参照。

### LLM エージェントとレビュワーの標準ループ（Chromium 系推奨）

エージェントとレビュワーが同一マシンで複数往復するワークフロー用。

1. エージェントが `npx mdxg-redline <input.md> <folder>` で `<mdFileName>-<docHash>-review.html` をワークスペースフォルダに生成する（`mdFileName` は元 MD basename から `.md` / `.markdown` 拡張子を除いたもの、`docHash` は本文 SHA-256 の先頭 16 桁 hex）
2. CLI が標準ブラウザで HTML を自動起動。レビュワーがコメントを記入する
3. サイドバーの `Write feedback.json` ボタン（split button）をクリック。初回は出力先フォルダを picker で選択し、IndexedDB に永続化。2 回目以降は picker 無しで同じフォルダに書き出される
4. 同じフォルダに `<mdFileName>-<docHash>-feedback.json` が書き出される（元 review.html と同じ `<mdFileName>` / `<docHash>` を共有するため対応関係が機械的に決まる）
5. エージェントが対応する feedback.json を読み、改訂版を `npx mdxg-redline <input2.md> <folder>` で次ラウンドの HTML を生成 → ループ継続

`Write feedback.json` は File System Access API を使うため Chromium 系（Chrome / Edge / Arc / Brave / Opera）のみ対応。Safari / Firefox では代替として `Comments ▾ → Export as JSON` でダウンロード、または `Copy as JSON` でクリップボード経由のフィードバック授受になる。

ファイル命名規約と詳細フローは [docs/DESIGN.md §8 ワークスペースプロトコル](docs/DESIGN.md#8-ワークスペースプロトコル) を参照。

## 出力 JSON

```jsonc
{
  "document": "spec.md",
  "docHash": "a1b2c3d4e5f6a7b8",
  "exportedAt": "2026-05-15T10:30:00.000Z",
  "comments": [
    {
      "id": "a1b2c3d4",
      "quote": "選択された箇所",
      "comment": "ここはXを前提にしているが定義がない",
      "created": "2026-05-15T10:28:11.000Z",
      "headingPath": ["## 3. 入力経路と出力経路"],
      "sourceLine": 42,
    },
  ],
}
```

## MDXG 準拠状況

[Markdown Experience Guidelines (MDXG)](https://github.com/vercel-labs/mdxg) は現在プレビュー版で、仕様は今後変更される可能性があります。本ツールではレビュワー観点機能を段階的に取り込み中です。

| MDXG セクション          | 必須レベル    | 現状                                                |
| ------------------------ | ------------- | --------------------------------------------------- |
| §1 Theming               | MUST (Viewer) | 部分（DADS テーマ。host theme 追従は未実装）        |
| §2 Code Block Rendering  | MUST (Viewer) | 部分（コピー button・シンタックスハイライト未実装） |
| §3 Task Lists            | MUST (Viewer) | marked デフォルトで対応                             |
| §4 Images / §5 Tables    | MUST (Viewer) | marked デフォルトで対応                             |
| §6 Virtual Pages         | MUST (Viewer) | 未対応（コメントモデルとの統合設計が必要）          |
| §7 Page Navigation       | MUST (Viewer) | 未対応                                              |
| §8 Page Outline          | MUST (Viewer) | 未対応                                              |
| §9 Sequential Navigation | MUST (Viewer) | 未対応                                              |
| §10 Search               | MUST (Viewer) | 未対応                                              |
| §13 Keyboard Navigation  | MUST (Viewer) | 部分対応                                            |

今後のロードマップは [docs/DESIGN.md §12 MDXG 準拠ロードマップ・今後の拡張](docs/DESIGN.md#12-mdxg-準拠ロードマップ今後の拡張) を参照。

## 開発

ビルドツールは [Vite+ (vp)](https://viteplus.dev/) を使用し、npm の devDependency（`vite-plus`）として導入しています。devcontainer / `local_setup.sh` がセットアップを担当するので、ローカル開発時はそれらを利用するのが最短です。

```bash
npm ci
npm run build                # dist/review.html (配布用 HTML) と dist/review-request.mjs (レビュー依頼 CLI) を生成
npm run build:review-request # = vp build --config vite.review-request.config.ts  review-request CLI のみ差分ビルド
npm run build:watch          # = vp build --watch  ファイル変更で review.html を自動再ビルド
npm run dev                  # = vp dev           HMR 付き dev サーバー
npm test                     # = vp test          in-source tests を実行
```

`npm ci` で `vite-plus` 由来の `vp` がローカルに導入されます。

## ライセンス

MIT
