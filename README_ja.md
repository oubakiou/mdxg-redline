# mdxg-redline

[![English](https://img.shields.io/badge/Language-English-lightgrey?style=for-the-badge)](./README.md)
[![日本語](https://img.shields.io/badge/言語-日本語-blue?style=for-the-badge)](./README_ja.md)

**MDXG に準拠した markdown レビューツール — 単一 HTML ファイルだけで動作し、レビューコメントを構造化 JSON として書き出して LLM エージェントに引き渡す。**

> [vercel-labs/mdxg](https://github.com/vercel-labs/mdxg) のサードパーティ実装です。規格としての MDXG に準拠しますが、Vercel Labs / 本家リポジトリとは無関係です。

`mdxg-redline` は、LLM エージェントが人間レビュワーから「長文 markdown に対するフィードバック」を **散文の感想ではなく位置情報付きの構造化 JSON** として受け取るためのブラウザツールです。LLM エージェントと人間レビュワーの間に立ち、「markdown を貼って、散文のフィードバックを受け取る」という曖昧なループを、**機械可読なフィードバック成果物** に置き換えます。

エンドユーザーには **単一 HTML ファイル**（`review.html`）を配布するだけで動きます。サーバー不要・追加インストール不要・ネットワーク通信ゼロ。

## 特徴

- **位置情報付きインラインコメント**: 任意のテキスト範囲を選択してコメントを残し、`headingPath` と `sourceLine` で位置を特定できる JSON を出力
- **単一 HTML 配布**: `marked` を含む全依存を inline、CDN 参照なし
- **3 つの受け渡し経路**: Workspace 監視 / 埋め込み HTML / URL ハッシュ
- **読み取り専用**: 原文 markdown を改変しない

## 使い方

### 入手

以下のいずれかで `review.html` を入手します:

- **ダウンロード**: GitHub Releases から `review.html` を直接ダウンロード（インストール不要）
- **npm**: `npm install mdxg-redline` で取得し `node_modules/mdxg-redline/dist/review.html` を使用

### 最短ルート

`review.html` をブラウザで開き、`Open file` で markdown を読み込み、選択 → `＋ Comment` でコメント → `Comments ▾ → Copy as JSON` で書き戻し。

### Workspace 監視（推奨、Chromium 系のみ）

エージェントとレビュワーが同一マシンで複数往復するワークフロー用。

1. 任意のワークスペースディレクトリに `review.md` を配置
2. ブラウザで `review.html` を開き `Watch folder` でディレクトリを選択
3. レビュワーがコメントを記入し `Submit review` をクリック
4. 同じディレクトリに `feedback.json` が書き出される
5. エージェントが `feedback.json` を読み、改訂版 `review.md` を書き戻すループ

詳細は [docs/DESIGN.md](docs/DESIGN.md) を参照。

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

[Markdown Experience Guidelines (MDXG)](https://github.com/vercel-labs/mdxg) は現在プレビュー版で、仕様は今後変更される可能性があります。本ツールではレビュワー観点機能を段階的に取り込み中です。現状の準拠状況と今後のロードマップは [docs/DESIGN.md §13](docs/DESIGN.md) を参照。

## 開発

ビルドツールは [Vite+ (vp)](https://viteplus.dev/) を使用します。devcontainer / `local_setup.sh` がインストールを担当するので、ローカル開発時はそれらを利用するのが最短です。

```bash
npm install
npm run build       # = vp build       dist/review.html を生成
npm run build:watch # = vp build --watch ファイル変更で自動再ビルド
npm run dev         # = vp dev          HMR 付き dev サーバー
npm test            # = vp test         in-source tests を実行
```

vp 単体を手動インストールする場合は [公式手順](https://viteplus.dev/guide/#install-vp) を参照。

## ライセンス

MIT
