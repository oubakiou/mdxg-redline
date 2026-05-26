# MDXG Redline 設計ドキュメント

このドキュメントは MDXG Redline の設計意図・構成・割り切りを記録する。仕様変更・監査・他実装との比較検討時の参照資料とする。

## 目次

1. [概要](#1-概要)
2. [制約](#2-制約)
3. [ユーザーフロー](#3-ユーザーフロー)
4. [アーキテクチャ](#4-アーキテクチャ)
5. [データモデル](#5-データモデル)
6. [コメントのアンカリング](#6-コメントのアンカリング)
7. [永続化レイヤー](#7-永続化レイヤー)
8. [ワークスペースプロトコル](#8-ワークスペースプロトコル)
9. [起動シーケンス](#9-起動シーケンス)
10. [ブラウザ互換性](#10-ブラウザ互換性)
11. [セキュリティとプライバシー](#11-セキュリティとプライバシー)
12. [MDXG 準拠ロードマップ・今後の拡張](#12-mdxg-準拠ロードマップ今後の拡張)
13. [ビルドパイプライン](#13-ビルドパイプライン)
14. [ファイル構成](#14-ファイル構成)

## 1. 概要

MDXG Redline は、レビュワー（人間）がブラウザで以下を行うためのツール：

1. markdown 文書をブラウザに読み込む
2. 任意のテキスト範囲をハイライトしてコメントを付ける
3. 結果を構造化 JSON として出力し、LLM エージェントに渡す

エンドユーザーには **単一 HTML ファイル**（`dist/standalone.html`）を配布するだけで動く。サーバー不要・別ファイル不要・追加インストール不要（※ VS Code Remote Containers / Codespaces のように `$BROWSER` 経由で `file://` がホスト側ブラウザに届かない環境でのみ、review-request CLI が一時的な軽量 HTTP サーバーを立ててブラウザに配信する。詳細 §3）。

`dist/` には **役割の異なる 2 つの HTML** が生成される（DESIGN.md §13）：

| ファイル                   | 用途                                                       | grammar inline  | 開く対象                             |
| -------------------------- | ---------------------------------------------------------- | --------------- | ------------------------------------ |
| `dist/standalone.html`     | 単独 Open file 用、エンドユーザーが直接開く                | 全 27 言語      | ユーザーが直接ダブルクリック         |
| `dist/embed-template.html` | review-request CLI が rewrite して配布 HTML を生成する素材 | なし (CLI 注入) | CLI 経由でのみ使用、直接開く想定なし |

開発時のみ TypeScript ソースと Vite ツールチェーン（`npm run build`）を使い、CSS/JS をすべて inline した単一 HTML にビルドする。エンドユーザーには TS/Vite の存在は見えない。詳細は §13。

長文を生成する LLM と、それをレビューする人間との間に立ち、「markdown をチャットに貼って、散文のフィードバックを受け取る」という曖昧なループを、**位置情報付きの構造化フィードバック成果物** に置き換えることを目的とする。

### 想定ユーザー

- LLM エージェントで文書・仕様書・記事を反復的に作成する個人
- 人間レビューを挟むエージェントパイプラインを構築する開発者
- 普通のファイルでレビュー成果物を共有するチーム

### スコープ外

- 複数ユーザーのリアルタイム共同編集
- 汎用 markdown エディタ（レンダリングは読み取り専用、ソースは改変しない）
- ソースコードの git / PR レビューの代替

---

## 2. 制約

| 制約                                                                                | 影響                                                                                                                                            |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| ブラウザのみ、バックエンドなし                                                      | 状態はすべてブラウザストレージかローカルファイル                                                                                                |
| エンドユーザーには単一 HTML ファイルとして配布                                      | CSS / JS / npm 依存（`marked`）をすべて Vite が bundle・inline。CDN 参照なしで完全オフライン動作                                                |
| `file://` と `http://localhost` の両方で動作                                        | origin が変わると IndexedDB の `workspace-handle` が分離するため、別 origin で開いた回は picker 再表示にフォールバックする（§7）                |
| LLM がコンテンツ事前読み込みで起動できること                                        | 複数の注入経路（埋め込み・ファイル選択）                                                                                                        |
| フィードバックは機械可読                                                            | 位置情報を持つ安定参照を含む JSON 出力                                                                                                          |
| レビュー対象 markdown は信頼済みとは限らない                                        | markdown 内の raw HTML は実行せず、文字として escape 表示する                                                                                   |
| 開発時のみ Vite+ (vp) ツールチェーンを使用（`vite-plugin-singlefile` で 1 HTML 化） | TypeScript + 外部 CSS で開発、`vp build` で `dist/standalone.html` と `dist/embed-template.html` を再生成。配布時は JS / CSS とも inline される |

---

## 3. ユーザーフロー

markdown をページに入れる方法が 2 つ、フィードバックを取り出す方法が 3 つあり、自由に組み合わせ可能。最も重要なユースケースは「LLM エージェントから人間へのレビュー依頼ループ」で、これを以下の標準ループとして定義する。

### 標準ループ（エージェント連携モード）

エージェント連携は「review-request CLI でレビュー依頼 HTML を生成 → 人間がブラウザでコメント → Write feedback.json でフォルダに書き出し → エージェントが拾う」という形に統一する。

```
┌─────────────┐ review-request CLI       ┌──────────────┐
│ エージェント ├─────────────────────────►│  ブラウザ    │
│  (LLM)      │ <name>-<hash>-review.html│ (MDXG Redline)│
│             │◄─────────────────────────┤              │
└─────────────┘ <name>-<hash>-feedback.json└────────────┘
       ▲                                      │
       └────── 共有フォルダ ──────────────────┘
```

`<name>` は元 MD の拡張子を除いた basename、`<hash>` は MD 本文 SHA-256 の先頭 16 桁 hex。改訂のたびに `<hash>` だけが変わり、新旧ペアがファイル名で分離される（命名規約は §8）。

### 入力

markdown を画面に乗せる経路は 2 つ。ユーザーがブラウザ上で選ぶ経路（ファイル選択）と、配布前に HTML へ事前注入しておく経路（埋め込み）。起動時の優先順位は §9 を参照。

#### 1. ファイル選択

`Open file` ボタンを押すと OS のファイルダイアログが開き、選んだローカル `*.md` を読み込む（実装は `toolbar.ts` の隠し `<input type="file">` 経由）。

- **想定ユースケース**: エージェントループを組まずに、手元の 1 ファイルを単発レビューしたい場合
- **ファイル名の扱い**: 選択時のファイル名がそのまま `state.docName` となり、export 時の JSON `document` フィールド・ダウンロード時の既定ファイル名に反映される
- **再選択時の挙動**: 読み込むたびに `state.comments` は空に初期化される。過去ラウンドのコメントを引き継ぎたい場合は、エージェント側で前ラウンドの `*-feedback.json` を `<script id="embedded-feedback">` として同梱した HTML（review-request CLI 経路）で配布する

#### 2. 埋め込み

配布者が HTML を共有する前に、`<script id="embedded-md" type="text/markdown">…</script>` ブロックに markdown を **JSON 文字列としてエンコードした状態で** 書き込んでおく方式。受け取った側は HTML をダブルクリックするだけで本文が表示される。`<script>` の `type` が module ではないため、Vite の bundle 対象から外れ、HTML 内に書いた内容がそのまま残る。

- **想定ユースケース**: LLM エージェントから人間へのレビュー依頼（最重要 / 標準ループ）、固定文書のレビュー依頼、過去レビューのアーカイブ用スナップショット
- **コメントの同梱**: HTML に `<script id="embedded-feedback" type="application/json">` ブロックを置いてコメント配列を入れておくと、起動時に型ガード（`feedback.ts`）を通って取り込まれる。不正なら静かに無視される。review-request CLI 自体は `embedded-md` のみを書き換える仕様で、`embedded-feedback` への注入は現状未対応（同梱したい場合は手作業 / 別経路で挿入する）
- **エンコード形式**: 本文は `JSON.stringify(markdown).replace(/</g, '<')` の形で書き込む（実装上は `String.raw` で `<` という 6 文字の literal を出力する）。本文中の `<` がすべて JSON Unicode escape `<` に置換されるため、HTML パーサが `</script>` を閉じタグとして誤検出する余地が構造的に無い。復元側 (`boot.ts`) は `JSON.parse` だけで生 markdown に戻せる
- **書き換え方法**: `node dist/review-request.mjs <input.md> [output-dir]` で markdown を読み込み、`<script id="embedded-md">` の中身と `data-name` 属性を書き換えた HTML を生成する。出力ファイル名は §8 のファイル命名規約に従って自動決定される。手作業での書き換えは JSON encode 規約があるためサポートしない（CLI 経由のみ）。CLI 全体の挙動（引数仕様 / 自動起動 / VS Code Remote 対応 / ポート選定）は[後述の review-request CLI 詳細](#review-request-cli-詳細)を参照

### review-request CLI 詳細

レビュー依頼 HTML の生成と既定ブラウザでの起動までを 1 コマンドで完結させる Node CLI。実装は `src/cli/` 配下 (`review-request.ts` エントリ + `parse-args` / `input-source` / `open-command` / `serve` に責務分割) と `src/core/embed.ts` (pure ロジック、ブラウザ側からも再利用)。

#### コマンド仕様

```
node dist/review-request.mjs [--no-open] [--show-open-file] [--document-name <name>] [--theme <system|light|dark>] [--shiki-langs <auto|all|none|<csv>>] [--comments-width <0|280-640>] [--page-nav-width <0|180-480>] <input.md|-> [output-dir]
```

- `<input.md>` を `-` にすると標準入力から markdown を読み込む（パイプ運用や生成エージェントからの直接渡し向け）
- `--document-name <name>` で `data-name` 属性と出力ファイル名 prefix を明示的に上書きできる（stdin 入力時のファイル名指定にも使う）
- `--theme <system|light|dark>` で生成 HTML の初期 theme ヒントを `<html data-theme>` 属性として埋め込む。受信側 inline script はこれを `localStorage` より低い優先度で参照する（ユーザーが UI でトグルした履歴があればそちらが常に優先）。未指定時は属性を付けず、`localStorage` か `prefers-color-scheme` のみで判定する（既定挙動）。詳細は §7c / §11 / §12 §1 Theming 行
- `--shiki-langs <value>` で `<script id="embedded-shiki-langs">` に注入する Shiki grammar を選ぶ。`auto`（既定）は `marked.lexer` で markdown のフェンス言語を抽出し必要分だけ注入、`all` は 27 言語全部、`none` は注入しない（全コードブロックを plain text fallback）、`<csv>` (`ts,js,py` 等) はエイリアス正規化を経て指定された正規名集合だけを注入。詳細は §12 §2 Code Block Rendering 行
- `--comments-width <value>` で生成 HTML の初期コメントパネル幅 / 開閉状態ヒントを `<html data-comments-width>` 属性として埋め込む。`0` は起動時 closed（画面右端の縦タブのみ表示）、`280–640` は open かつその幅（px 整数）。`--theme` と同じく `localStorage` より低い優先度で参照され、ユーザーが UI でリサイズ・開閉した履歴があればそちらが常に優先。未指定時は属性を付けず、`localStorage` または既定値 (360px, open) で判定する。詳細は §7c / §11 / §12 §1 Theming 行
- `--page-nav-width <value>` で生成 HTML の初期左 TOC 幅 / 開閉状態ヒントを `<html data-page-nav-width>` 属性として埋め込む。`0` は起動時 closed（画面左端の縦タブのみ表示）、`180–480` は open かつその幅（px 整数）。`--comments-width` と対称で `localStorage` より低い優先度。未指定時は属性を付けず、`localStorage` または既定値 (220px, open) で判定する
- `--no-open` で自動起動 (file パス直渡し / HTTP サーバーモード双方) を抑止
- `--show-open-file` で生成 HTML のヘッダから「Open file」ボタンを残す（**既定は hidden**）。CLI 経路は「特定 MD のレビュー固定文脈」を前提とするため、別 MD を誤って読み込んで `state.comments` を初期化する事故（§3 入力 1 「再選択時の挙動」）を構造的に防ぐ目的で、生成 HTML の `<html>` に `data-toolbar-open-file="off"` を埋め込み、ブラウザ側 `toolbar.ts` が起動時に `#btn-load` と隠し `<input id="file-md">` を DOM から `remove()` する。Comments ▾ メニュー内の Copy / Export / Write feedback.json は影響を受けず常時表示。`standalone.html`（CLI 非経由）は属性が付かないため常に表示される。CLI ヒントとしては値域 `'off'` の 1 値のみで `localStorage` には保存しない（配布物単位の固定属性）
- CLI 経由で生成された HTML の `<title>` は `MDXG Redline — <docName>` 形式に書き換えられる（ブラウザタブ・ファイル共有先で配布物を識別できるようにするため）。`standalone.html` は元の `MDXG Redline` のまま
- `output-dir` を省略すると入力 MD と同じディレクトリ（stdin 入力時は cwd）に出力

出力ファイル名は §8 ファイル命名規約に従い `<mdFileName>-<docHash>-review.html` となる。

#### ブラウザ自動起動の優先順位

生成後、既定では OS の標準ブラウザで HTML を自動的に開く。優先順位は次のとおり：

1. `$BROWSER` 環境変数
2. macOS: `open`
3. Windows: `cmd.exe /c start "" <path>`
4. その他 (Linux 等): `xdg-open`

`$BROWSER` を最優先するのは、VS Code Remote Containers / Codespaces / GitHub Actions などが `$BROWSER` を helper スクリプトに向けて設定する慣習に合わせるためで、`gh` CLI などと同じ動きになる。

#### VS Code Remote / Codespaces の HTTP モード

VS Code Remote / Codespaces のように `$BROWSER` 経由で `file://` がホスト側ブラウザに届かない環境（`REMOTE_CONTAINERS=true` / `CODESPACES=true` / `$BROWSER` が `vscode-server/.../helpers/browser.sh` を指す、で判定）では、`127.0.0.1` 上に軽量 HTTP サーバーを立てて `http://localhost:<port>/...` を `$BROWSER` に渡し、ホスト側ブラウザに到達させる。

配信は固定 HTML 1 ファイルのみで、リクエストパスは無視されるためパストラバーサルは構造的に発生しない。

#### ポート選定とフォールバック

デフォルトポートは `51729`（環境変数 `MDXG_REDLINE_PORT` で上書き可）。デフォルト or 指定ポートが使用中ならランダムポートへ自動 fallback し、stderr に「ポート X が使用中のため Y を使います。今回は IndexedDB のサイレント復元が効かない可能性があります」と警告する。

**固定ポートを採用する理由**: ブラウザ側 IndexedDB の `workspace-handle`（書き出し先フォルダ / §7）は origin（`http://localhost:<port>`）に紐づくため、ポートが毎回変わるとサイレント復元が効かない。デフォルトポート方式により、HTTP モードでも 2 回目以降の起動で同じ origin に着地し `Write feedback.json` の保存先フォルダが picker 無しで復元される（VS Code Remote / Codespaces の `forwardPorts` に固定値を書ける副次的メリットもある）。

#### 自動停止と失敗時の挙動

サーバーは初回リクエスト受信後 10 秒、リクエストが来ないまま 60 秒経過で自動停止する。レスポンスには `Connection: close` を付けて keep-alive を無効化し、`server.close()` がハングするのを防ぐ。

ヘッドレス環境などで起動コマンドが失敗しても CLI は exit 0 のまま終了し、stderr に警告を出して stdout の絶対パスから手動で開ける導線を残す。

### 出力

1. **Copy as JSON** — クリップボードへコピー、チャットへの貼り付け用（`Comments ▾` メニュー内）
2. **Export as JSON** — ファイルダウンロード、チャット添付やアーカイブ用（`Comments ▾` メニュー内）
3. **Write feedback.json** — 選んだローカルフォルダに `<mdFileName>-<docHash>-feedback.json` を書き出す（プライマリ split button、常時表示。命名規約は §8 参照）。初回押下で `showDirectoryPicker()` がフォルダ選択を求め、選んだフォルダの `FileSystemDirectoryHandle` を IndexedDB に永続化する。2 回目以降は picker 無しで同じフォルダに書き出し（HTTP モードではデフォルトポートにより origin が安定するため、別タブや再起動でも復元される）。split button の caret `▾` から `Change output folder…` で書き出し先を切り替えられる。Chromium 系のみ対応（対応状況の詳細は §10）

---

## 4. アーキテクチャ

3 層の関心事を持つ単一 HTML ドキュメント（ランタイム）。ビルド側の構成は §13 を参照。

```
┌───────────────────────────────────────────────────────────────┐
│  プレゼンテーション層 (CSS + DOM)                              │
│    - GitHub Primer 風 chrome (header / comments panel / toolbar)      │
│    - DADS (Digital Agency Design System) テーマの本文プレビュー │
│    - 本文とコメントパネルは独立スクロール                         │
│    - コメントパネル左端ドラッグでリサイズ (280–640 / closed 0)     │
│    - closed 時のみ画面右端 (scrollbar の左) に出る開閉タブ     │
│    - 選択時に出現する floater (＋ Comment)                     │
│    - コメント入力モーダル / Comments アクションメニュー        │
├───────────────────────────────────────────────────────────────┤
│  ドメインロジック (TypeScript → Vite + Rolldown で JS bundle、 │
│   CSS は src/styles/ を Vite が CSS bundle 化)                 │
│    - markdown レンダリング (marked、raw HTML は escape)         │
│    - コメントアンカリング (block id + テキストオフセット)      │
│    - 選択範囲 → Range → オフセット変換                         │
│    - 再描画後の <mark> 再適用                                  │
│    - 固定 duration smooth scroll (距離非依存)                  │
├───────────────────────────────────────────────────────────────┤
│  永続化層                                                      │
│    - IndexedDB（出力先フォルダハンドル 1 件のみ）              │
│    - File System Access API（feedback.json 書き出し用）         │
└───────────────────────────────────────────────────────────────┘
```

ランタイム外部依存：**なし**。配布物は CDN 参照を持たず、ネットワーク到達性ゼロで動作する。

bundle される npm 依存（ビルド時に `<script>` として inline）：

- **marked**（markdown → HTML）

スタイリングは `src/styles/review.css` (全体スタイル) と `src/styles/markdown.css` (markdown 描画用) の 2 ファイルに分け、レイアウト用の意味的クラスとコンポーネントクラスを自前で定義する。フォントは OS のシステムフォント（`-apple-system, BlinkMacSystemFont, 'Segoe UI', ui-monospace, …`）を参照し、Web フォントは使用しない。

開発時依存（エンドユーザーには無関係）：

- **TypeScript**（ソース言語）
- **Vite+ (vp)**（Vite 8 + Rolldown + vitest を統合した CLI ツールチェーン、グローバルに `vp` コマンドを提供）
- **vite-plugin-singlefile**（bundle 結果を単一 HTML に inline するプラグイン）
- **vitest**（in-source testing）

---

## 5. データモデル

### コメント

```ts
{
  id: string // 8 文字のランダム ID
  blockId: string // 例: "b003" — レンダリング時に付与。文書全体で連番 (document スコープ)
  pageIndex: number // 所属仮想ページの 0-origin index（state 内必須、export には含めない）
  quote: string // 選択されたテキスト原文（人間の参照用）
  comment: string // ユーザーのコメント
  startOffset: number // ブロックのフラットテキスト内の開始位置
  endOffset: number // ブロックのフラットテキスト内の終了位置
  sourceLine: number // 元 markdown 全体での 1-origin 行番号（不変、必須）
  created: string // ISO 8601
}
```

`pageIndex` と `sourceLine` は MDXG §6–§9 Virtual Pages 統合のために必須化された (mdxg-virtual-pages.archive.md §6.5 / §6.6)。`blockId` は **Stacked View 採用 (mdxg-virtual-pages.archive.md §14) に伴い、文書全体での連番 (document スコープ) に戻った** ── 全 page の `<section.virtual-page>` が常に DOM 上に並ぶため、page スコープのまま `b001` が複数 section に存在すると `querySelector` が衝突するのを構造的に避ける。`sourceLine` は元 markdown 全体での行番号を維持することで feedback.json export スキーマと後段 LLM 互換を保つ。`pageIndex` は state 内専用で export には漏らさない。新規 Comment 作成時の `pageIndex` は `selection.ts` が祖先 `<section.virtual-page>` の `data-page-index` から取得し、`PendingSelection` 経由で comment-modal に渡す。

### ドキュメント状態（メモリ内）

```ts
{
  docHash:               string | null           // SHA-256(markdown) の先頭 8 バイト（16 桁 hex）。未読込時 null
  docName:               string | null           // ファイル名。未読込時 null
  markdown:              string                  // 原文
  comments:              Comment[]
  blockOriginalHTML:     Map<blockId, string>    // 再レンダリング用の元 HTML
  blockAnchors:          Map<blockId, BlockAnchor> // markdown ソース上の開始行と祖先見出し
  lastWrittenSignature:  string | null           // Write feedback.json の dirty 判定用署名（未書き出し時 null）
  pages:                 Page[]                  // markdown 読み込み時に確定する仮想ページ列 (MDXG §6)
  activePageIndex:       number                  // 現在表示中のページ index (0-origin)
}
```

`pages` / `activePageIndex` は MDXG Virtual Pages 用 (mdxg-virtual-pages.archive.md §6 / §10)。`pages` は markdown 読み込み時に `core/page-split.ts` の `splitIntoPages` で確定し、以降 read-only。各 Page は `slug` / `sourceLineStart` / `sourceLineEnd` / `ancestorHeadingPath` / `headings` (H3–H6 outline) を持つ。`activePageIndex` は TOC / Sequential Nav / hashchange の `navigateToTarget` で切り替わる。

### 永続化レコード

ブラウザ側で永続化するのは「直近のワークスペース ディレクトリハンドル」だけ。コメント本体・本文・docHash はメモリ上 state にのみ存在し、永続化はユーザーが明示的に `Submit review` / `Export as JSON` / `Copy as JSON` を押した時点でファイル／クリップボードへ書き出す責務（DESIGN.md §7）。

| キー               | 値                                | 用途                                                            |
| ------------------ | --------------------------------- | --------------------------------------------------------------- |
| `workspace-handle` | `FileSystemDirectoryHandle`（生） | 次回起動時のサイレント再開（Chromium 系、IDB に直シリアライズ） |

### エクスポートされるフィードバック（JSON）

```jsonc
{
  "document": "spec.md", // 元 MD の basename（拡張子付き）。Workspace 連携時は対応する review.md と一致する
  "docHash": "a1b2c3d4e5f6a7b8", // SHA-256(markdown) の先頭 8 バイト hex（16 桁）
  "exportedAt": "2026-05-15T10:30:00.000Z",
  "comments": [
    {
      "id": "a1b2c3d4",
      "quote": "選択された箇所",
      "comment": "ここは X を前提にしているが定義がない",
      "created": "2026-05-15T10:28:11.000Z",
      "headingPath": ["## 3. 入力経路と出力経路", "### 3.2 ファイル選択"],
      "sourceLine": 42,
    },
  ],
}
```

Workspace 連携時、ファイル名は §8 のファイル命名規約に従って `<mdFileName>-<docHash>-feedback.json` の形で書き出される。JSON 内部の `document` / `docHash` はファイル名と冗長に見えるが、ファイルを単体で取り出した時の自己記述性のために残す。

LLM が解釈できない UI 内部 anchor（`blockId` / `startOffset` / `endOffset`）は export に含めず、markdown ソース上で位置を特定できる形に揃える。

- `headingPath` … コメントが属するブロックの祖先見出しを浅い順に並べた配列。各要素は raw markdown 形式（`## ` プレフィックス込み）。見出しがない、または最初の見出しより前のブロックの場合は `[]`
- `sourceLine` … コメントが属するトップレベルブロックの markdown ソース上の開始行（1-origin）
- `docHash` … レビュー時点の本文識別子。`shasum -a 256 <input.md> | cut -c1-16` で再計算可能（ワークスペース連携時はファイル名にも同じ値が含まれる）。並行編集を検出した場合は行番号を信頼せず、`quote` を grep して位置特定にフォールバックする

---

## 6. コメントのアンカリング

採用方式は **ブロック ID + そのブロックのフラット化テキスト上のオフセット**。再レンダリングや軽微な装飾変更で壊れない位置参照を、ソースを汚さず細粒度に保つ。

代替方式との比較：

| 方式                                 | 長所                       | 短所                                           |
| ------------------------------------ | -------------------------- | ---------------------------------------------- |
| ブロック単位コメント                 | 実装が容易                 | 粒度が粗く、特定のフレーズを指せない           |
| XPath / CSS セレクタ                 | 標準ベース                 | 再レンダリングで壊れやすい、ソース編集にも弱い |
| **ブロック ID + テキストオフセット** | 安定、細粒度、再適用に強い | 原文の編集には追随できない                     |

### 仕組み

1. `marked.parse` の後、ドキュメントコンテナの直下の各子要素に連番の `data-block-id`（`b001`, `b002`, …）を付与
2. 各ブロックの `<mark>` ラッパなしの元 `innerHTML` を `state.blockOriginalHTML` にキャッシュ
3. ユーザーが範囲選択すると、次の形に正規化：
   - `blockId`：`data-block-id` を持つ最も近い祖先
   - `startOffset` / `endOffset`：ブロックのフラットテキスト内の位置（テキストノード平坦化と Range boundary で算出）
4. ハイライトを描画するときは、各ブロックを元 HTML にリセットし、コメントを **startOffset の降順** で適用（後方を先に変更することで前方のオフセットを保持）
5. 各コメントは対象範囲を包む `<mark class="cmt" data-comment-id="…">` になる

### 複数テキストノードにまたがる範囲

インライン書式の境界をまたぐ選択（例えば `Lorem **ipsum** dolor` を「Lorem ipsum dolor」として選択）は複数のテキストノードに分かれる。範囲が単一テキストノード内なら `Range.surroundContents()`、複数ノードにまたがる場合は `extractContents` + `insertNode` でフォールバックする。ブロック境界をまたぐ選択は無視される（フローター自体が表示されない）。

### 原文編集で壊れる理由（許容している）

原文 markdown が編集されると、ブロック ID とオフセットが合わなくなる。これは許容する：

- ツールは原文に対して読み取り専用
- エージェントループは各ラウンドで原文を丸ごと差し替えるので、前バージョンのコメントは設計上破棄されるべき（`docHash` が変われば新しいコメントセットになる）

---

## 7. 永続化レイヤー

ブラウザ側の永続化は最小限。コメント本体は state にのみ存在し、ユーザーが明示的にエクスポートして初めて外部に出る。

### a. IndexedDB（ディレクトリハンドル専用）

`margin-notes` DB / `kv` ストアに `workspace-handle` キー 1 件だけを置く。`FileSystemDirectoryHandle` は JSON 化できず IndexedDB へ直シリアライズするしか手段がないため、この用途のためだけに IDB を残している。`storage.ts` は `IDB.get / set / del / open` の 4 メソッドだけを持つ薄いラッパ。

### b. File System Access API（出力先フォルダ）

`Write feedback.json` の書き出し先フォルダ用。`showDirectoryPicker()` が返す `FileSystemDirectoryHandle` 自体を IndexedDB の `workspace-handle` に保存し、次回起動時はサイレント復元する（権限再要求はしない）。

書き出し時のフロー（実装は `workspace.ts` の `writeFeedback`）：

1. メモリ上の handle が無ければピッカーを開いてフォルダを選ばせる
2. handle がある場合は `handle.queryPermission({ mode: 'readwrite' })` を呼ぶ
   - `granted` → そのまま書き出し
   - `prompt` → `requestPermission()` を呼んで再許可。`granted` なら書き出し、`denied` ならピッカーへフォールバック
   - `denied` → ピッカーへフォールバック
3. handle がディレクトリ削除などで無効化していた場合は書き出し時に例外を捕捉し、ピッカーを 1 度だけ再表示してリトライ

split button の caret `▾` から開ける `Change output folder…` メニューは、状態に関係なく常にピッカーを開いて handle を差し替える専用導線。`workspace.ts` の `changeOutputFolder` がエントリ。

### c. localStorage（theme 設定 / パネル幅・開閉状態）

UI 表示まわりの軽量な永続化のためだけに `localStorage` を使う。IndexedDB を使わないのは、FOUC 防止のため `<head>` 内 inline script が paint 前に同期で読む必要があり、IDB の非同期 API ではタイミングが間に合わないため（IDB は引き続き `workspace-handle` 1 件のみで、UI 設定は別ストアとして整理する）。`localStorage` が disable された環境（プライバシーモード等）でも inline script は `try {} catch (e) {}` で囲んでおり、失敗時は `<html data-*>` ヒント or 既定値で動作する。

保存しているキーは次の 3 件のみ。コメント本体・本文は決して `localStorage` に書かない。

| キー                          | 値                              | 用途                                                                     |
| ----------------------------- | ------------------------------- | ------------------------------------------------------------------------ |
| `mdxg-redline.theme`          | `'system' \| 'light' \| 'dark'` | theme toggle の最終選択 (UI トグル操作時のみ書き込み)                    |
| `mdxg-redline.comments-width` | `280`–`640` の整数 (px)         | 「open 状態でのコメントパネル幅」。closed 状態でも保持し、次に開く時の幅 |
| `mdxg-redline.comments-open`  | `'open' \| 'closed'`            | コメントパネルの開閉状態。snap by drag / toggle tab で書き換える         |
| `mdxg-redline.page-nav-width` | `180`–`480` の整数 (px)         | 「open 状態での左 TOC 幅」。closed 状態でも保持し、次に開く時の幅        |
| `mdxg-redline.page-nav-open`  | `'open' \| 'closed'`            | 左 TOC の開閉状態。snap by drag / toggle tab で書き換える                |

優先順位 P1 はキーごとに対称な構造で、`localStorage > <html data-*> ヒント > 既定値` の順で評価する：

- `theme`: `localStorage > <html data-theme> (CLI --theme) > prefers-color-scheme`
- `comments-width / comments-open`: `localStorage > <html data-comments-width> (CLI --comments-width) > 既定 (360px, open)`
- `page-nav-width / page-nav-open`: `localStorage > <html data-page-nav-width> (CLI --page-nav-width) > 既定 (220px, open)`

inline script は `localStorage` / `<html data-*>` の値をホワイトリストで検証し、壊れた値（旧バージョン / 他アプリの混入 / 手動編集）に対して `null` 扱いで次段にフォールスルーする（`theme.ts` の `isStoredTheme` / `comments-width.ts` の `isValidStoredWidth` / `isCommentsOpenState` と同じ判定で初期描画と後続ランタイムの挙動を揃える）。

`<html data-comments-width>` で表現できるのは「`0` = closed 起動」と「`280–640` = open 起動 + その幅」の 2 ケースのみ。「closed 起動 + 任意の復元幅」のような複合状態を CLI で指定する経路は提供しない（`localStorage` が空のときだけ CLI ヒントが効くので、その種の指定はユーザーが UI を操作した瞬間に上書きされる短命な状態にしかならないため）。

複数レビューラウンドにまたがる UI 設定の引き継ぎは `localStorage` の origin スコープに依存し、`workspace-handle` と同じく HTTP モードのデフォルトポート (`http://localhost:51729`) が確保できれば共有される。random fallback / `file://` 起動では分離されて引き継がれない（§8 「HTTP モードの origin 安定性」参照）。引き継ぎが失敗した場合は CLI ヒント / 既定値で fallback する設計のため、明示指定をしていないユーザーには違和感が出ない。

---

## 8. ワークスペースプロトコル

エージェント連携で「同じレビュー対象に対する review / feedback ペア」を機械的に対応付けるためのファイル命名規約と、ブラウザ側の書き出し責務を定める。

| ファイル                                        | 方向                | 書き手                                  | 読み手                                            |
| ----------------------------------------------- | ------------------- | --------------------------------------- | ------------------------------------------------- |
| `<folder>/<mdFileName>-<docHash>-review.html`   | エージェント → 人間 | エージェント（review-request CLI 経由） | ブラウザ（人間がダブルクリック / CLI が自動起動） |
| `<folder>/<mdFileName>-<docHash>-feedback.json` | 人間 → エージェント | ブラウザ（Write feedback.json）         | エージェント                                      |

書き出し先フォルダの場所はユーザーが任意に決めてよい（`~/reviews/` でも `./tmp/` でも）。`*-review.md` の生成・配置はエージェント側の責務で、ブラウザはそれを監視しない（review-request CLI で生成された HTML を開く想定）。

### ファイル命名規約

review-request CLI 配布フローと Write feedback.json 書き出しを通じて、すべてのレビューパッケージはこの命名規約に従う：

```
<mdFileName>-<docHash>-review.md     (エージェントが書く本文 / CLI への入力)
<mdFileName>-<docHash>-review.html   (review-request CLI が出力する配布用 HTML)
<mdFileName>-<docHash>-feedback.json (ブラウザが書き出す回収パッケージ)
```

- **`mdFileName`**: 元 MD ファイルの basename から `.md` / `.markdown` 拡張子を除いたもの。サニタイズはしない（スペース・日本語・記号もそのまま）。例：元ファイルが `仕様書 v2.md` なら `mdFileName = "仕様書 v2"`
- **`docHash`**: 元 MD 本文 UTF-8 バイト列の SHA-256 の先頭 8 バイトを hex で表現した 16 文字の文字列。`shasum -a 256 <input.md> | cut -c1-16` で再計算できる。§5 のエクスポート JSON に含まれる `docHash` と同一値で、ファイル名から取り出しても JSON 本文から取り出しても同じものが得られる（ファイル名は配置時の自己記述性、JSON は単体取り出し時の自己記述性を担う）
- **責務**: ファイル名の生成責務は書き手側にある。エージェントは `review.md` を書く前に、ブラウザは `feedback.json` を書く前に、それぞれ自身が扱っている MD 本文の SHA-256 を計算してファイル名を決める
- **拡張子で識別**: 同一の `<mdFileName>-<docHash>-` プレフィックスを共有するファイルが「同じレビュー対象に対する review / feedback ペア」となる。エージェントは `.md` を書く → 対応する `.json` を待つ → 取り込む、を `docHash` 単位で機械的に対応付けられる

これにより、Open File で別の MD を開いた状態で `Write feedback.json` を押しても、出力ファイル名は新しい MD の hash で決まるため、元の review.md に対応する feedback.json を誤って上書きすることがない（誤爆問題の構造的解消）。

### ライフサイクル

1. エージェントが `<input.md>` から `node dist/review-request.mjs <input.md> <folder>` で `<mdFileName>-<docHash>-review.html` を生成する（CLI が標準ブラウザを自動起動）
2. ブラウザが HTML を開くと、埋め込み markdown が描画される（§9 起動シーケンス参照）
3. ユーザーがインラインコメントを追加
4. ユーザーが `Write feedback.json` をクリック
   - 初回（IDB に handle 無し）: ピッカーが開き、フォルダを選ばせる → 選んだフォルダに書き出し → handle を IDB へ永続化
   - 2 回目以降（handle あり、権限 OK）: picker 無しで同じフォルダに書き出し（同一 origin で起動した場合）
   - 書き出し先ファイル名は現在の `state.docHash` から計算され、`<mdFileName>-<docHash>-feedback.json` になる
5. エージェントが対応する `feedback.json`（自身が CLI に渡した MD と同じ `mdFileName`-`docHash` プレフィックス）を読み、処理し、必要に応じて改訂版 `<input2.md>` で次ラウンドの HTML を生成 → ループ継続

### 古いファイルの扱い

ラウンドを重ねると `<name>-<hash1>-review.html`, `<name>-<hash2>-review.html`, ... と複数の配布 HTML がフォルダに残り得るが、ブラウザは何も検知・整理しない。古いファイルの整理はユーザーまたはエージェントの責務。

### 安全装置・前提

- **権限の失効**: `Write feedback.json` 押下時に `queryPermission` が `granted` 以外を返した場合、`requestPermission` で再許可を試み、拒否されたらピッカーへフォールバックする
- **ハンドル無効化**: 書き出しが例外（フォルダ削除等）で失敗した場合、ピッカーを 1 度だけ再表示してリトライし、それも失敗したら toast で通知して諦める
- **HTTP モードの origin 安定性**: review-request CLI の HTTP モードはデフォルトポート `51729`（`MDXG_REDLINE_PORT` で上書き可）で起動を試み、同一 origin (`http://localhost:51729`) を維持することで `workspace-handle` のサイレント復元を成立させる。ポートが衝突して random fallback した場合は origin が変わるため、その回だけは picker が再表示される。同じ origin 制約は `localStorage("mdxg-redline.theme")` (§7c) にも適用され、複数ラウンド間で theme 設定が引き継がれるのもデフォルトポート確保時のみ
- **API 非対応ブラウザ**: Safari / Firefox の挙動は §10 を参照

---

## 9. 起動シーケンス

ページロード時に以下の優先順チェーンを実行。出力先ハンドル復元は副作用が無く後段を阻害しないため、本文ロードのパスとは独立に走らせる。埋め込みで本文が確定した時点で終了する。

```
0. IndexedDB から workspace-handle をサイレント復元 (副作用は in-memory のみ)
   └─ 権限再要求はしない。Write feedback.json 押下時にまとめて扱う

1. 埋め込み markdown (<script id="embedded-md">)
   1a. core/page-split.ts で markdown → Page[] に分割 (MDXG §6 / mdxg-virtual-pages.archive.md §10)
   1b. activePageIndex を location.hash から resolveTargetFromHash で解決
       (hash 空 / 不正 / slug 不一致なら先頭ページ 0)
   1c. <script id="embedded-feedback"> があれば適用
       (ImportedComment[] から sourceLine 経由で pageIndex を逆引きして埋め、
        範囲外コメントは破棄、§9.1 / §6.6 invariants)
   1d. activePageIndex のページのみ doc-renderer.ts で render
       (composite hash `#<page>__<heading>` の deep link は scrollToHeadingIfPresent でスクロール)

2. 該当しなければ空状態のまま `Open file` を待つ
```

ナビゲーションのライフサイクル全体は `app/review.ts` の `navigateToTarget(target, pushHash)` が単一の orchestrator として担う。TOC / outline / Sequential Nav / hashchange / `loadFromMarkdown` すべてこの 1 関数を通り、`renderAll()` (doc / page-navigation / sequential-nav / comments / scroll-spy をまとめて再描画) を経由する。view 追加時の同期漏れを構造的に防ぐ (Phase 3 / Phase 4 のレビューで drift / 同期漏れが指摘された経緯への対応)。

---

## 10. ブラウザ互換性

| 機能                                                | 必須                       | 対応ブラウザ                                   |
| --------------------------------------------------- | -------------------------- | ---------------------------------------------- |
| 基本レンダリング、コメント、コピー / エクスポート   | 必須                       | すべてのモダンブラウザ                         |
| IndexedDB                                           | 推奨                       | すべてのモダンブラウザ                         |
| `navigator.clipboard.writeText`                     | 推奨                       | すべてのモダンブラウザ（HTTPS または file://） |
| `showDirectoryPicker` + `FileSystemDirectoryHandle` | Write feedback.json 時のみ | Chromium 系（Chrome, Edge, Arc, Brave, Opera） |

Safari と Firefox はファイル選択・埋め込み・コピー / エクスポートのフローは使えるが、**Write feedback.json は利用不可**（Export as JSON / Copy as JSON で代替）。

---

## 11. セキュリティとプライバシー

- ネットワーク通信は LLM コンテンツ起点では発生しない設計。すべての依存（`marked`、スタイル、フォント指定）が単一 HTML 内に inline / システムフォント参照されており、起動後の外部リクエストはゼロが既定。markdown 内に書かれた `![alt](https://…)` の画像取得だけは利便性優先で許可している（外部 https サーバーに対する HEAD/GET が走り得るが、`<img>` には `referrerpolicy="no-referrer"` を付与し Referer leak は塞ぐ）
- markdown 内の raw HTML は renderer 層で escape し、`<script>` や event handler を DOM として実行しない。フェンス付きコードブロック内の HTML 例は通常どおりコードとして表示する（規格にこの領域の明文規定はなく、リファレンス実装は blocklist 方式を採る。本実装が allowlist (escape all) を選んだ理由は §12「規格に明文規定がない領域での判断」参照）
- **Shiki ハイライト出力の信頼境界**: 上記 escape ポリシーの責務は「入力 markdown 内の raw HTML」に対するものであり、Shiki が `codeToHtml` で生成する HTML は MDXG Redline 自身が制御する DOM として扱う。Shiki は入力コードの `<` / `>` / `&` を実体参照化して出力し、`<script>` や event handler を出すパスは存在しないため、`<pre>` 部分を `innerHTML` 経由で挿入してよい（§12 §2 Code Block Rendering の Shiki upgrade 経路）。`<span style="--shiki-light:#…;--shiki-dark:#…">` 形式の inline style は下記 CSP `style-src 'unsafe-inline'` の許可範囲内
- **リンク・画像の URL スキーム allowlist**: 信頼できない markdown を前提に `markdown.ts` の `Renderer.link` / `Renderer.image` をオーバーライドし、許可外のスキームを `<a>` / `<img>` として描画しない。リンクは `http:` / `https:` のみ許可、画像は `https:` / `data:` のみ許可（CSP の `img-src` と一致）。**相対 URL は両方とも不許可**（`new URL(href)` が absolute parse 可能なものだけが通過する）。不許可リンクは inner HTML をそのまま出力して plain text 化、不許可画像は alt テキストを描画して画像取得そのものを抑止する。`javascript:` / `data:` リンク経由の XSS と、レビュアー追跡を意図した外部画像（相対 URL → file:// 配下の任意取得、`http:` 経由の平文 referrer）を構造的に塞ぐ
- **Content Security Policy**: 配布 HTML（`dist/standalone.html` / `dist/embed-template.html` および CLI が生成する `*-review.html`）すべてに `<meta http-equiv="Content-Security-Policy">` を埋め込み、二重保険で攻撃面を狭める。`file://` で開かれる前提のため HTTP ヘッダではなく meta で指定する。両 HTML は共通の `src/review.html` を入力に派生するため CSP も同一。内容は次のとおり：
  - `default-src 'none'` — 明示許可以外は全て deny
  - `script-src 'self' 'unsafe-inline'` — singlefile bundle した inline script のために `'unsafe-inline'`
  - `style-src 'unsafe-inline'` — singlefile bundle した inline style と、Shiki ハイライト span が出力する `<span style="--shiki-light:#…;--shiki-dark:#…">` 形式の inline style のため（§12 §2 Code Block Rendering 行）
  - `img-src https: data:` — レンダリング用に許可した画像と同じ範囲
  - `connect-src 'none'` — fetch / XHR / WebSocket / EventSource をすべて遮断（コメント本体の export はユーザー主導の `Write` / `Copy` / `Export` のみで、ネットワーク経路を使わない）
  - `base-uri 'none'` / `form-action 'none'` — base 改竄とフォーム送信を禁止
  - `frame-ancestors` は仕様上 `<meta>` 経由では無視されるため指定していない（clickjacking 対策は HTTP ヘッダ配信時の課題として残す）
- embedded feedback の `comments[]` は型ガードを通し、不正なコメント要素は除外する
- markdown の内容は、ユーザーが明示的に `Export as JSON` / `Copy as JSON` / `Write feedback.json` のいずれかを押さない限りブラウザ外に出ない
- 出力先フォルダの権限は選択したディレクトリにスコープされる。ページが任意のディスクの場所にアクセスすることはない
- IndexedDB の用途は「出力先ディレクトリハンドルの保存」のみ（§7）。コメント本体や本文は IndexedDB に書かない。ハンドルは origin に紐づくため、別のパスやオリジンで開けば再ピッカーが必要になる
- `localStorage` の用途は「UI 設定（theme / 右パネル幅・開閉状態 / 左 TOC 幅・開閉状態）の保存」のみ（§7c）。書き込んでいるキーは `mdxg-redline.theme` / `mdxg-redline.comments-width` / `mdxg-redline.comments-open` / `mdxg-redline.page-nav-width` / `mdxg-redline.page-nav-open` の 5 件のみで、コメント本体・本文・docHash は `localStorage` にも書かない。`<head>` 内 inline script が paint 前に同期 read することで FOUC を防ぎ、`<html data-theme>` / `<html data-comments-width>` / `<html data-page-nav-width>` 属性（CLI `--theme` / `--comments-width` / `--page-nav-width` ヒント / §3）と `prefers-color-scheme` / 既定値を合わせた優先順位 P1 で実 theme・幅・開閉状態を決定する。inline script は読み出した値をすべてホワイトリスト（`'system' | 'light' | 'dark'` / `280–640` / `180–480` の数値 / `'open' | 'closed'`）で検証し、壊れた値（旧バージョン / 他アプリの混入 / 手動編集）に対して `null` 扱いで次段にフォールスルーする（`theme.ts` の `isStoredTheme` / `comments-width.ts` の `isValidStoredWidth` / `page-nav-width.ts` の `isValidStoredPageNavWidth` と同じ判定で初期描画と後続ランタイムの挙動を揃える）。`localStorage` への書き込みはユーザーが UI を操作した時のみ
- ビルドパイプラインは開発者ローカルでのみ動作。配布物 (`dist/standalone.html` / `dist/embed-template.html` / `dist/review-request.mjs` / `dist/shiki-langs/*.json`) はすべてビルド成果物としてリポジトリにコミットされており、エンドユーザー環境にはツールチェーンを持ち込まない

---

## 12. MDXG 準拠ロードマップ・今後の拡張

### MDXG 準拠

MDXG Redline は **MDXG Viewer**（[Markdown Experience Guidelines (MDXG)](https://github.com/vercel-labs/mdxg) の読み取り専用レンダラ準拠レベル）を内蔵し、その上にインラインコメントと構造化フィードバック JSON 書き出しというレビュー機能を載せたツールである。Viewer の各機能は段階的に取り込み中で、現状の準拠状況は次のとおり：

下表は準拠状況のサマリ。詳細要件と本実装の挙動、リファレンス実装 (`vercel-labs/mdxg` の `packages/parser` / `apps/web`) との対比は表の下に `#### §X` 節として並べる。表セル内では markdown のリスト記法が書けず raw HTML 列挙も §11 の方針で escape されるため、詳細はセクション節に展開する形にしている。

| 分類               | MDXG セクション                                                                                       | 現状 | 要約                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------- |
| Rendering          | [§1 Theming](./mdxg/01-rendering.md#1-themingテーマ)                                                  | 準拠 | 3 状態 toggle で `prefers-color-scheme` 追従、DADS primitive から自前 dark トークン |
| Rendering          | [§2 Code Block Rendering](./mdxg/01-rendering.md#2-code-block-renderingコードブロック描画)            | 準拠 | Shiki dual theme で 27 言語ハイライト、Copy button 動的注入、`html.dark` 連動       |
| Rendering          | [§3 Task Lists](./mdxg/01-rendering.md#3-task-listsタスクリスト)                                      | 準拠 | marked GFM デフォルトで読み取り専用 checkbox を描画                                 |
| Rendering          | [§4 Images](./mdxg/01-rendering.md#4-images画像)                                                      | 部分 | URL allowlist で相対画像パスを弾く（信頼境界優先、§11）                             |
| Rendering          | [§5 Tables](./mdxg/01-rendering.md#5-tables表)                                                        | 準拠 | `<div class="table-wrap">` で水平スクロール、親レイアウトを破壊しない               |
| Document Structure | [§6 Virtual Pages](./mdxg/02-document-structure.md#6-virtual-pages仮想ページ)                         | 準拠 | core/page-split.ts で H1 / H2 境界分割 (ATX / setext / コードフェンス追跡)          |
| Document Structure | [§7 Page Navigation](./mdxg/02-document-structure.md#7-page-navigationページナビゲーション)           | 準拠 | Stacked View: 全 page を縦に並べて連続スクロール、左 TOC + page scroll-spy で追従   |
| Document Structure | [§8 Page Outline](./mdxg/02-document-structure.md#8-page-outlineページアウトライン)                   | 準拠 | active page 配下に H3–H6 inline 展開 + IntersectionObserver でスクロールスパイ      |
| Document Structure | [§9 Sequential Navigation](./mdxg/02-document-structure.md#9-sequential-navigation逐次ナビゲーション) | 準拠 | 左 TOC 上部に Prev / Next row を統合、最初 / 最後ページで該当方向を omit            |
| Document Structure | [§10 Search](./mdxg/02-document-structure.md#10-search検索)                                           | 準拠 | `/` で起動、case-insensitive substring match、`search-hl` mark で cmt mark と共存   |
| Accessibility      | [§13 Keyboard Navigation](./mdxg/04-accessibility.md#13-keyboard-navigationキーボードナビゲーション)  | 準拠 | アクセシブル名 + 左 TOC の Tab 巡回 + ↑↓/Home/End + Enter で navigate + 自動 focus  |

#### §1 Theming（準拠）

- [MUST] ホスト環境への外観適応: ✓（`<head>` inline script が `prefers-color-scheme` を初期値として参照、`subscribeSystemTheme` で `system` 状態の間は OS 変更にもリアクティブ追従）
- [SHOULD] 色をホストテーマ / OS から導出: ✓（DADS primitive から自前 semantic マッピング。dark トークンは `:root.dark` / `:where(.dark) #doc` で `--paper` / `--ink` / `--accent` / `--rule` 等を上書き、§7c）。例外として **コードブロック背景 (`--doc-code-bg`) は light / dark 共通で dark トークン (`#1e1e1e` / `#0d0d0d`) に固定する** デザイン方針を採る（IDE / Discord / Notion 等で慣行化された見え方に合わせるため）。コードブロック内のシンタックスハイライト配色も同方針で両モードとも dark 系を採用する（§12 §2 Code Block Rendering 行）
- [MUST NOT] 色をユーザー設定必須にしない: ✓（`localStorage` 未設定時の既定が `system` で OS 設定を反映）
- [MUST] ライト / ダーク両ホストテーマ対応: ✓（toolbar の 3 状態 toggle で `system → light → dark` を循環、ボタンに `aria-label` / `data-tooltip` 付与）

優先順位 P1: `localStorage('mdxg-redline.theme')` > `<html data-theme>` (CLI `--theme` ヒント / §3) > `prefers-color-scheme`。dark の primary button は `#2cac6e` × `#ffffff` が 2.77:1 で AA 不足のため文字色を `#1a1a1a` に反転 (`src/styles/review.css` 参照、Material / Tailwind dark の慣行と一致)。dark トークン値は DADS 公式 dark semantic 未公開のため primitive から自前マッピング（公開時に差し替え予定）。

**リファレンス実装 (vercel-labs/mdxg)**

- parser: 対象外（UI 層）
- web: Tailwind v4 の CSS variables を `:root`（light）/ `.dark`（dark）で切替。`app/layout.tsx` 冒頭の inline script で `localStorage("theme")` を優先しつつ初回は `prefers-color-scheme` に fallback（FOUC 防止）。`components/header.tsx` の Sun / Moon トグルが `html.dark` を切り替え。`apps/web/src/app/globals.css`

#### §2 Code Block Rendering（準拠）

- [MUST] 言語識別子付きフェンスの構文ハイライト: ✓（`shiki/core` + JS engine + 27 言語の TextMate grammar、`createHighlighterCoreSync` で同期初期化。`bash` / `shell` / `zsh` / `ts` / `js` / `py` / `yml` / `rb` 等のエイリアスは Shiki メタから自動生成した `src/core/shiki-aliases.generated.ts` で正規名に正規化）
- [MUST] 言語識別子なしブロックの等幅描画: ✓
- [MUST] 1 アクションでコピー可能なボタン: ✓（`<pre>` を `<div class="code-block-wrap">` で wrap して右上に絶対配置の Copy button。`navigator.clipboard.writeText(pre.textContent)` で 1 クリックコピー、成功時は「Copy → Copied」を 1.5 秒トグル、失敗時は toast で fallback）
- [MUST] ハイライト配色のライト / ダーク適応: ✓（Shiki dual theme `github-light` + `github-dark` を `<span style="--shiki-light:#…;--shiki-dark:#…">` 形式で出力。本実装はコードブロック背景を light / dark 共通で dark トークン (`--doc-code-bg`) に固定する設計判断のため、span 側は両モードとも `--shiki-dark` のみを CSS で採用する。dual theme の出力構造自体は将来の方針見直し時に CSS だけで切替えられるよう保持する。詳細は §1 Theming の `--doc-code-bg` 例外、および下記実装詳細）

実装詳細：

- **Shiki 初期化と適用タイミング（C 案: paint 後の lazy 初期化 + upgrade）**：初期 render では highlighter を渡さず marked の plain `<pre><code class="language-…">` を即 paint させ、`requestAnimationFrame` × 2 で paint 確実後に `createHighlighterCoreSync({ engine: createJavaScriptRegexEngine(), langs, themes: [githubLight, githubDark] })` を同期 lazy singleton 初期化。各 `<pre>` の innerHTML を Shiki 出力で差し替える upgrade フェーズで `data-shiki-applied="1"` を付けて idempotent 化する。`<pre>` 自身は残して中身だけ転写するため `data-block-id` / 親 `.code-block-wrap` / Copy button は触られない。`defaultColor: false` で inline color を CSS variable に逃がす（`src/app/shiki.ts` / `src/app/doc-renderer.ts`）
- **選択中の延期と mark 再貼付**：upgrade 実行時に `document.getSelection().toString().length > 0` ならスキップし、`selectionchange` で空に戻ったら次の rAF で再試行する（レビュアーの選択操作中に DOM 差し替えで Range が飛ぶのを構造的に避ける）。upgrade 後は `state.blockOriginalHTML` を新 innerHTML（Shiki span 入り）で焼き直してから `reapplyAllMarks()` を呼び、embedded-feedback で起動時に貼った `<mark class="cmt">` を Shiki span の上に貼り直す。§6 アンカリングは `textContent` ベースなので Shiki span 追加で値は変わらない
- **配色採用ルール**：`src/styles/markdown.css` の `#doc pre.shiki span` で `color: var(--shiki-dark)` を一律指定。light / dark セレクタを切り分けず単一ルールに統合しているのは、コードブロック背景が両モードで dark 固定だからで、light theme 側の色相を採ると暗背景に対して低コントラストになるため`--shiki-light` は不採用
- **grammar の動的注入**：build 出力は次の 2 パスに分岐する。
  - **`dist/standalone.html`**: Shiki core + JS engine + 2 テーマに加えて **27 言語の grammar すべてを事前 inline 済み**。CLI を経由せず単独で開くユーザー向けで、すべてのコードブロックがそのままハイライト表示される（DESIGN.md §13 `mdxg-split-outputs` plugin が closeBundle で grammar JSON を `<script id="embedded-shiki-langs">` に詰め込む）
  - **`dist/embed-template.html`**: Shiki core + JS engine + 2 テーマだけ inline し、grammar は 0。CLI (`review-request`) が `--shiki-langs` モードに従って markdown スキャン結果や明示指定の grammar セットを動的に注入する。grammar JSON は `dist/shiki-langs/<lang>.json` として個別 emit され、CLI と standalone build plugin の双方が読み込む素材
  - **commit 対象**: `dist/shiki-langs/<lang>.json` / `dist/standalone.html` / `dist/embed-template.html` / `dist/review-request.mjs` をすべて commit する。「clone 直後に `npm run build` 抜きで CLI / standalone どちらも実行できる」配布契約。partial clone や手動削除で grammar JSON が欠けた場合は CLI が ENOENT を捕えて「`先に npm run build を実行してください`」案内を投げる（`src/cli/review-request.ts` の `readGrammarJson`）
- **CLI オプション**：`--shiki-langs <auto|all|none|<csv>>`。既定 `auto` は `marked.lexer` で markdown 中のフェンス言語を抽出。`<csv>` は `ts,js,py` のような短縮形を受け、Shiki メタ由来のエイリアスマップで正規化（`src/cli/parse-args.ts` の `parseShikiLangsValue`）
- **27 正規名**：設計上の 28 言語のうち `bash` / `shell` は Shiki 内部で `shellscript` のエイリアスに集約されるため、ユニークな正規名は 27 個になる（エイリアスは ALIAS_TO_CANONICAL で同じ正規名にマップされる）
- **配布物サイズ**：`dist/embed-template.html` 約 315 KB / gzip 約 95 KB（実測。Shiki core + JS engine + 2 テーマ + §10 Search モジュール inline ぶん、grammar 0）。CLI 経路で grammar が `auto` 注入された後の配布 HTML は typical で +100〜300 KB、`all` で +5.2 MB raw（+1〜1.5 MB gzip）。`dist/standalone.html` は約 5.77 MB / gzip 約 1.6 MB（grammar 27 言語 inline 済み）
- **§6 アンカリングとの両立**：`doc-renderer.ts` で `cacheBlockOriginalHTML` を先に呼んで `<pre>` に blockId を付け、その後に `injectCopyButtons` で wrap する順序にすることで、blockOriginalHTML には `<pre>` の innerHTML のみが入り Copy button の textContent はフラットテキスト計算に混入しない
- **言語ラベル表示 (MDXG §2.2 実装例 / SHOULD 未満)**：`core/markdown.ts` の renderer が言語識別子付きフェンスに対し `<pre data-lang="<raw lang>">` を付与する (`infostring` をそのまま属性値とし HTML escape する)。`app/code-copy-wrap.ts` の `wrapPreWithCopyButton` が wrap 時に `<span class="code-lang-label" aria-hidden="true">` をコードブロック左上に「上に飛び出すタブ」として配置し、`normalizeLangIdentifier` で正規名にマップ (`ts` → `typescript`、`sh` → `bash`) して表示する。27 言語ホワイトリスト外の識別子は生 lang を fallback として表示する。Copy button は従来通り hover/focus 時のみ表示 (`opacity 0 → 1`) で、タブの位置とは独立。`<span>` の textContent はオフセット計算に混入させないよう `selection.ts` の `textSegments` が `.code-lang-label` 配下を skip する (既存 `.code-copy-btn` と同じパターン)。Shiki upgrade は `<pre>` 自身を残すため `data-lang` 属性は upgrade 前後で不変

**リファレンス実装 (vercel-labs/mdxg)**

- parser: `code` renderer をオーバーライドし、`options.codeRenderer` でホストへ委譲（fallback は `<pre data-lang="…"><code>…</code></pre>`）。`packages/parser/src/index.ts`
- web: Shiki で SSR ハイライト（`createHighlighter` を遅延初期化、30+ 言語、`themes: { light: github-light, dark: github-dark }` の dual theme）。コピー button は `mdxg-viewer.tsx` の useEffect で `<pre>` に動的注入し「Copy → Copied!」をトグル。`apps/web/src/lib/parser.ts` / `components/mdxg-viewer.tsx` / `globals.css` の `.copy-btn` / `.shiki`

本実装との差異：SSR ではなくブラウザ起動時に `createHighlighterCoreSync` で同期初期化。grammar 注入は 2 系統に分岐する：(1) CLI 経路では `--shiki-langs` モードに応じて `dist/embed-template.html` を rewrite した配布 HTML に必要分だけ注入、(2) 単独利用は `dist/standalone.html` が build 時に 27 言語すべてを事前 inline 済み。`dist/embed-template.html` を直接ダブルクリックで開いた場合は grammar が無いため全コードブロックが plain text fallback（CLI 専用素材として扱う）。

#### §3 Task Lists（準拠）

- [MUST] `- [ ]` を未チェック checkbox として描画: ✓（marked GFM）
- [MUST] `- [x]` をチェック済み checkbox として描画: ✓
- [MAY] checkbox のインタラクティブ / 読み取り専用: 読み取り専用（marked が `disabled` 付き `<input>` を出力）
- [MUST] リスト構造とインデントの保持: ✓

**リファレンス実装 (vercel-labs/mdxg)**

- parser: marked GFM のデフォルト挙動（拡張なし）。`packages/parser/src/index.ts`
- web: `@tailwindcss/typography` の `prose` をベースに、`globals.css` で `prose ul:has(> li > input[type=checkbox])` の list-style を解除して見栄え調整。`apps/web/src/app/globals.css`

#### §4 Images（部分）

- [MUST] インラインに描画: ✓
- [MUST] 相対画像パスをドキュメント位置基準で解決: 未対応（信頼境界の都合で URL allowlist が相対 URL を弾き、alt のみ描画。§11 参照）
- [MUST] コンテンツ幅に収まる制約: ✓（`#doc img { max-width: 100% }`）
- [MUST NOT] 水平方向にあふれない: ✓
- [MUST] alt テキスト保持 / 支援技術アクセス: ✓
- [SHOULD] ロード失敗時の alt フォールバック: 部分（不許可スキーム時は alt 描画。ネットワーク失敗時の自動切り替えは未実装）

**リファレンス実装 (vercel-labs/mdxg)**

- parser: marked デフォルト（相対 URL もそのまま `<img src>` に出力）。`sanitizeHtml` は `<script>` / `<iframe>` / `<object>` / `<embed>` / event handler / `javascript:` だけを削除し `<img>` は素通し。`packages/parser/src/index.ts`
- web: `@tailwindcss/typography` の `prose` で max-width を制御。画像キャプション用テーブルは `prose table:has(img)` の例外として `globals.css` で罫線を消す

#### §5 Tables（準拠）

- [MUST] セル罫線 / 視覚的分離: ✓（`th` / `td` に border）
- [MUST] ヘッダ行と本文行の視覚区別: ✓(`thead` 背景色 + 太字）
- [MUST] markdown の列整列指定を尊重: ✓（marked GFM が `align` を style 出力）
- [MUST] 広いテーブルの水平スクロール: ✓（`markdown.ts` の `renderer.table` オーバーライドが `<table>` を `<div class="table-wrap">` で包み、CSS 側で `overflow-x: auto` を付与）
- [MUST NOT] ページレイアウト破壊: ✓（ラッパが overflow を吸収するため、`#doc` の `max-width: 860px` を超えるテーブルでも親レイアウトを破壊しない）

**リファレンス実装 (vercel-labs/mdxg)**

- parser: marked GFM のデフォルト挙動（拡張なし）。`packages/parser/src/index.ts`
- web: `@tailwindcss/typography` の `prose` table スタイルをそのまま採用（水平スクロールは typography plugin デフォルトの `<pre>` / `<table>` overflow 任せ）

#### §6 Virtual Pages（準拠）

- [MUST] H1 / H2 境界での仮想ページ分割 (6.1): ✓（`core/page-split.ts` の `splitIntoPages` が `scanHeadings` でページ境界マーカーを集めて `markdown.slice` で chunk 化）
- [MUST] ATX / setext 両形式の見出し認識 (6.1): ✓（`core/page-outline.ts` の `scanHeadings` が ATX `# / ##` + setext `===` / `---` を `detectAtxHeading` / `detectSetextDepth` で検出）
- [MUST NOT] フェンスコード内の見出しをページ境界としない (6.1): ✓（`detectFenceOpen` / `detectFenceClose` で backtick / tilde 両方を追跡し、フェンス内の `#` を無視）
- [MUST] コードフェンスの open / close 追跡 (6.1): ✓（CommonMark §4.5: backtick fence の info string に ` を含めない / 同種文字 length 以上で close）
- [SHOULD] 見出し前コンテンツの Introduction ページ化 (6.2): ✓（`buildIntroductionPage` が最初のマーカー前の content を depth=1 / title="Introduction" の page にする）
- [SHOULD] 空 / 空白のみは Introduction を作らない (6.2): ✓（`introMd.trim().length === 0` で skip）
- [MUST] ページ深さで階層伝達 (6.3): ✓（`Page.depth: 1 | 2` を `page-navigation.ts` が `page-nav-item-depth-1` / `-depth-2` クラスで段階インデント）
- [MUST] URL セーフな一意スラッグ (6.4): ✓（`core/slugify.ts` の `slugifyOrFallback` が ASCII 限定 slug + 非 ASCII は `page-<n>` fallback）
- [MUST] 同一スラッグの曖昧性解消 (6.4): ✓（`resolveUniqueSlug` が `-2`, `-3`, ... を文書順に付与）

**実装詳細**

- **行オフセット保持**: 各 Page は `sourceLineStart` / `sourceLineEnd` (両端含む 1-origin 行) を持ち、export feedback.json の `sourceLine` と sourceLine → pageIndex 逆引きで使われる (`findPageIndexBySourceLine`)
- **祖先 H1 path**: `Page.ancestorHeadingPath` に直近 H1 の ATX 表記 (`# <Title>`) を保持し、`doc-renderer.ts` が page スコープで build した blockAnchors の `headingPath` に prepend する。これにより H2 ページ配下のコメントも export 時に H1 祖先を含む完全な headingPath になる (mdxg-virtual-pages.archive.md §9.3)
- **slug の非 ASCII fallback**: 日本語タイトル等は `page-<n>` 連番 fallback。重複時の解消は ASCII slug と同じ `-N` suffix で行う (mdxg-virtual-pages.archive.md §7.3)
- **単一ページ正規化**: H1 / H2 が一切ない markdown は `docName` を title とした 1 ページに正規化される (mdxg-virtual-pages.archive.md §7.5)
- **round-trip 不変条件**: 全ページの `markdown` を連結すると元 markdown と完全一致する。`computeLineOffsets` + `markdown.slice` で実現

**リファレンス実装 (vercel-labs/mdxg)**

- parser: `splitIntoChunks` で H1 / H2 境界分割（ATX `# / ##` + setext `=` / `-` 両対応）。最初の見出し前のコンテンツは "Introduction" ページに集約、`depth: 1 / 2` を chunk に付与。`extractHeadings` で H3–H6 抽出時はコードフェンス `inCodeFence` トラッキングで除外（注: `splitIntoChunks` 側はフェンス追跡なし）。`slugify` + 重複時 `-N` サフィックスで一意 ID。`packages/parser/src/index.ts`
- web: parser の返す `Page[]` をそのまま `MdxgViewer` に渡す

**本実装との差異**: B 案 (`splitIntoChunks` / `extractHeadings` / `slugify` 相当を内部再実装) を採用 (mdxg-virtual-pages.archive.md §5)。リファレンス `splitIntoChunks` のコードフェンス追跡欠落バグは本実装で同時修正済み (`scanHeadings` の `FenceState` 追跡で ATX / setext 両方を抑止)。

#### §7 Page Navigation（準拠）

- [MUST] 全ページをドキュメント順に閲覧: ✓（Stacked View: `app/doc-renderer.ts` が全 page を `<section class="virtual-page">` で連続描画。`app/page-navigation.ts` の `renderPageNavigation` が左サイドバー `<aside class="page-nav">` にも文書順 TOC を出力）
- [MUST] 任意ページへの移動: ✓（TOC link クリック → `wirePageNavigation` 経由で `navigateToTarget` → 該当 section に `scrollIntoView`）
- [MUST] 現在ページの視覚的識別: ✓（page scroll-spy で viewport 上部に来た section の `pageIndex` を `state.activePageIndex` に同期し、TOC entry に `aria-current="page"` と `.page-nav-item-active` (背景色 + 4 辺 accent border + 太字)）
- [MUST] 逐次移動の提供（詳細は §9）: ✓（左 TOC 上部に Prev / Next row を統合、§9 参照）

**実装詳細**

- **Stacked View**: doc-renderer は markdown 読み込み時に全 page を `<section class="virtual-page" data-page-index data-page-slug>` で 1 度に描画する。マウスホイールだけで全文を読み進められる Word 風レイアウト (mdxg-virtual-pages.archive.md §14)。blockId は document スコープ連番に戻り (§7.1 撤回)、mark-engine は全 comments を活性 mark として保持する
- **page scroll-spy**: `app/page-scroll-spy.ts` の `setupPageScrollSpy` が `IntersectionObserver` (`rootMargin: '-5% 0px -95% 0px'`) で section を観測。viewport の上から 5% の線にいる section の `pageIndex` を `state.activePageIndex` に push し、`syncHashFromActivePage` で `location.hash` を更新。`setOnPageActivated(renderPageNavigation)` で TOC active 表示も追従する。判定基準を viewport 上 5% に置くのは TOC クリック時に section top を同じ位置に揃える `alignSectionTopInPane` と整合させ、navigate 直後に上半分の前ページが topmost と誤判定されないようにするため
- **URL 同期**: `location.hash = '#<page-slug>'` の代入だけで履歴を管理。History API 不使用 (mdxg-virtual-pages.archive.md §7.4)。ブラウザ戻る / 進むで前後ページに遷移できる
- **hash 復元**: 初期ロード時 / hashchange で `resolveTargetFromHash` が page slug + heading slug を分解。hash が空 / 不正 / 不一致なら先頭ページ (index 0) にフォールバックする (§7.4)
- **navigate orchestrator**: TOC / outline / 統合 Sequential / hashchange / 初期ロードすべてが `navigateToTarget(target, pushHash)` に集約され、page 切替時は `scrollToActivePageSection` → `alignSectionTopInPane` で section top を doc-pane の上から 5% (`SECTION_TOP_RATIO = 0.05`) に揃える (instant)。判定線は `page-scroll-spy` の rootMargin と同じ位置で、navigate 直後に前ページが topmost と誤判定されないよう同期させてある
- **狭幅レスポンシブ**: `@media (max-width: 900px)` で page-nav 列を隠す (デスクトップ前提、モバイル UI は別ドキュメント)

**リファレンス実装 (vercel-labs/mdxg)**

- parser: `Page[]`（depth 1 / 2 順序保持）を提供。`packages/parser/src/index.ts`
- web: 左サイドバー `<nav>` + `<ul ref={tocListRef}>` に depth でインデントしたページ一覧を出力。`activePageIndex` をハイライト（`border-l-primary` + `bg-primary/10`）、H1 配下の H2 グループはシェブロンで折りたたみ可能。Single Page 表示 (1 ページずつ render) で Next.js Router の `pageHrefs` 経由の URL 同期、モバイル時は `vaul` Drawer に切替。`apps/web/src/components/mdxg-viewer.tsx`

**本実装との差異**: 本実装は **Stacked View 採用** (全 page を縦に並べて連続スクロール、Word 風シート)。リファレンス実装は Single Page (1 ページずつ表示)。H1 配下の H2 折りたたみ caret は本実装では未実装 (TOC は flat list + depth インデント)。Next.js Router 相当は `location.hash` 直接書き換えで代替。

#### §8 Page Outline（準拠）

- [MUST] アクティブページ内 H3–H6 のみ含める: ✓（`app/page-navigation.ts` の `renderOutlineList` が active page (= page scroll-spy で同期される `state.activePageIndex`) のみで展開、`core/page-outline.ts` の `extractPageHeadings` が H3–H6 だけ抽出）
- [MUST] 各見出しがナビゲート可能: ✓（`core/markdown.ts` の `MarkdownRenderOptions.headingSlugs` で H3–H6 に `id="<slug>"` を注入、outline link クリック → `navigateToTarget` 経由で `scroll-spy.ts` の `scrollToHeading` を instant (`auto`) で呼ぶ。navigate 全経路と挙動を揃えるため smooth は使わない）
- [SHOULD] 深さの視覚的伝達: ✓（`.page-outline-link-level-3` 〜 `-6` で段階インデント `padding-left: 32/44/56/68px`）
- [SHOULD] 現在可視の見出しを示す（スクロールスパイ）: ✓（`app/scroll-spy.ts` の `IntersectionObserver` で `rootMargin: '0px 0px -75% 0px'` のトリガゾーンに入った topmost heading に `aria-current="location"`。current 表示はテキスト色 accent + 太字のみで、page active の 4 辺枠線と competing しないよう左 border は廃止）
- [MAY] H3–H6 がない場合の非表示 / 空表示: ✓（`renderOutlineList` が空文字を返すと caller 側で outline 要素自体を出さない）

**実装詳細**

- **Stacked View での active page 追従**: page scroll-spy で `state.activePageIndex` が変わると `setOnPageActivated(renderPageNavigation)` 経由で outline 表示も自動切替される。マウスホイールでページ境界を跨ぐと TOC 配下の outline も current page のものに自動更新される
- **URL fragment 形式**: ページ内見出しへの deep link は `#<page-slug>__<heading-slug>` (区切りは `__` 二連 underscore、本実装独自規約、mdxg-virtual-pages.archive.md §6.4)。`pages.ts` の `parseHashSlug` / `resolveTargetFromHash` が page slug + heading slug に分解
- **deep link スクロール**: 初期ロード / hashchange のいずれでも `scrollToHeadingIfPresent` 1 ヘルパに集約され、即時 `setActiveHeadingImmediately` で outline link をハイライトしてから navigate 経由で instant scroll (navigate orchestrator が `auto` を渡す)
- **pure な topmost 解決**: `pickTopmostHeading` は DOM 直接依存を排し callback (`resolveOffsetTop`) ベースに、node 環境でテスト可能 (`CSS.escape` を避けて attribute selector `[id="<slug>"]` を使う)
- **observer lifecycle**: `renderAll` のたびに `setupScrollSpy` / `setupPageScrollSpy` で teardown → 新規 attach (memory リーク防止)

**リファレンス実装 (vercel-labs/mdxg)**

- parser: `Page.headings: Heading[]` で H3–H6 と一意 ID を提供（コードフェンス除外 + スラッグ重複サフィックス）。`packages/parser/src/index.ts` の `extractHeadings`
- web: 右 `<aside>` に "On this page" として出力。`h.level` で `pl-0 / pl-3 / pl-6 / pl-9` のインデント、`IntersectionObserver` でスクロールスパイし `activeHeadingId` をハイライト、`headings.length === 0` 時は非表示。モバイル時は Drawer。`apps/web/src/components/mdxg-viewer.tsx`

**本実装との差異**: 独立した右 `<aside>` ではなく、左 TOC の active page 配下に inline 展開 (mdxg-virtual-pages.archive.md §7.7 / §8.3: 3 ペイン化を避けて本文の有効幅を確保)。

#### §9 Sequential Navigation（準拠）

- [SHOULD] 前 / 次ページのタイトル可視化: ✓（`app/page-navigation.ts` の `.page-nav-sequential-title` に Prev / Next の隣接ページタイトルを表示）
- [MUST] 適用不可コントロールの hidden / disabled: ✓（最初ページでは Prev リンクを DOM から omit、最後ページでは Next を omit。単一ページ / 0 ページでは row 自体が空文字で出ない）
- [MUST] 少なくとも 1 箇所からのアクセス: ✓（左 TOC 上部の `<nav class="page-nav-sequential">` で 1 箇所充足。加えて Stacked View ではマウスホイールだけでも前後ページに到達できるため、§9 [MUST] の「逐次移動の提供」は連続スクロール側にも実態が宿る）

**実装詳細**

- **配置**: 左 TOC (`<aside class="page-nav">`) の `<ul>` 上端に Prev/Next row を `<nav class="page-nav-sequential">` として置く。flex + `margin-left: auto` で Prev=左 / Next=右 を維持し、片方欠落でも他方の位置は固定
- **本文末尾の Sequential Nav は撤去**: Stacked View で全 page が連続表示されるため、本文末尾の `.sequential-nav` (`sequential-nav.ts`) は冗長と判断して撤去 (mdxg-virtual-pages.archive.md §14)。TOC 上部に統合することで、レビュー中常に視界内にある Prev/Next タイトル表示 (§9 [SHOULD]) が確保される
- **click 経路統合**: TOC / outline / 統合 Sequential row すべてが `findClickedSlug` (`page-navigation.ts`) → `onCompositeSlugClick` → `navigateToTarget` に流れ、page 切替時は該当 section に `scrollIntoView`

**リファレンス実装 (vercel-labs/mdxg)**

- parser: 該当責務なし
- web: ツールバーの ‹ / › button（先頭 / 末尾で `disabled`、`aria-label` でタイトル明示）+ ページ末尾の "Previous / Next" タイトル付きリンクの 2 箇所からアクセス可能。`apps/web/src/components/mdxg-viewer.tsx`

**本実装との差異**: 本実装は Stacked View での連続スクロール + TOC 上部の統合 Prev/Next row。リファレンス実装はツールバー Prev/Next + ページ末尾リンクの 2 箇所構成 (Single Page 表示前提)。

#### §10 Search（準拠）

- [MUST] 検索の起動: ✓（`f` キー or toolbar 検索ボタン (`#btn-search`) で `openSearch()` を呼ぶ。`f` は `handleAffordanceKeys` の WASD dispatch table 経由で他の単独キーと同じ isEditableTarget / hasNoModifier / event.repeat ガードを通す。Cmd/Ctrl+F は触らない設計で、ユーザーは「ブラウザ標準のサイト検索」と「ドキュメント検索」を使い分けられる）
- [MUST] レンダリング後テキストへの検索: ✓（`app/search.ts` の `collectSearchMatches` が全 `<section.virtual-page>` を走査し、各 `[data-block-id]` ブロックで `textSegments` の textContent を平坦化 → `core/search.ts` の `findMatchesInText` で case-insensitive substring match）
- [MUST] 現在マッチのハイライト + スクロールイン: ✓（current match に `search-hl-current` クラスを付与、`scrollIntoView({ behavior: 'auto', block: 'center' })` で doc-pane 内を instant スクロール。本実装の他の navigate 経路 (`scrollToHeading` / `alignSectionTopInPane`) と挙動を揃え、Enter 連打での逐次検索が smooth アニメーションに追い付かず「次マッチを見失う」事象を避ける）
- [MUST] 次 / 前のマッチ移動: ✓（input 上の `Enter` / `Shift+Enter`、`#search-next` / `#search-prev` ボタンが `nextMatch` / `prevMatch` を呼ぶ。`core/search.ts` の `nextMatchIndex` / `prevMatchIndex` が末尾/先頭でループ）
- [MUST] ページ境界を跨ぐマッチ位置の保持: ✓（Stacked View で全 page の `<section>` が同時に DOM 上にあり、page 切替で `<mark class="search-hl">` が消えないよう `mark-engine.setOnMarksReapplied(reapplySearchHighlights)` で reapply 経路に hook を register。Shiki upgrade / renderAll / コメント追加 / 削除のいずれの reapply 後も search ハイライトが復元される）
- [MUST] 他ページの特定マッチへの正確な着地: ✓（`navigateToCurrentMatch` が `state.activePageIndex !== match.pageIndex` のときに `configureSearchNavigation` 経由で `navigateToTarget({ pageIndex }, false)` を呼ぶ。hash は更新しない (検索終了後 Esc で元の hash に戻れる) ）
- [SHOULD] マッチ件数の表示: ✓（`#search-count` に `formatMatchCount` の "i of N" / "N matches" / "No results" を `aria-live="polite"` で表示）
- [SHOULD] ページ境界跨ぎ時の自動ナビゲート: ✓（[MUST] の他ページ着地と同じ経路で `navigateToTarget` を呼び、page 切替後の DOM 更新 → 再貼付 → `scrollIntoView` の流れが 1 系統に統合される）

**実装詳細**

- **共存設計**: cmt mark との共存は「同じ text node 内に 2 種の `<mark>` をネストする」許容方式。`mark.cmt` は border-bottom と背景色、`mark.search-hl` は背景色 + outline で視覚分離し、両方が同時に効いている部分も読み取れる。`mark` タグは textContent に現れないため §6 anchoring の startOffset / endOffset 不変条件は破られない (textSegments は深さ優先で text node を平坦化するため、cmt mark 内の text node も拾われる)
- **オフセット計算の競合回避**: search mark の wrap 順序は同一ブロック内で `start` 降順、後ろから `<mark>` を貼り付けることで前方マッチのオフセットがズレない (mark-engine.ts の cmt mark 適用と同じパターン)
- **選択範囲 → コメント生成中の退避**: `comment-modal.ts` の `openModal` が `isSearchOpen()` を確認し、open なら `closeSearch()` を呼んでから modal を開く。検索 mark を残したまま新規 cmt mark を貼ると `range.surroundContents` が境界エラーで失敗する経路を構造的に塞ぎ、UI 上も「コメント中は検索 mark が消える」予期可能な挙動になる
- **マッチング**: case-insensitive substring (`text.toLowerCase()` と `query.toLowerCase()` を `String#indexOf` で照合)。オーバーラップは含めない (`from = match.end`)。ASCII / かな / 漢字では `lowerCase.length === original.length` が保たれるため、index は元 text 上の文字 index としてそのまま使える
- **ハイライトの寿命管理**: `setSearchQuery` / `closeSearch` のいずれも `reapplyAllMarks()` を呼んで cmt mark のみの状態にリセットし、`onMarksReapplied` で改めて search を貼り直す (matches が空なら no-op)。これにより「クエリ変更時に古いハイライトが残る」「閉じてもハイライトが消えない」事故が起きない
- **blockOriginalHTML への焼き込み防止**: `doc-renderer.ts` の `innerHTMLForOriginalCache` が clone した subtree から `mark.cmt` と `mark.search-hl` を unwrap してから innerHTML を採取する。`refreshBlockOriginalHTML` (Shiki upgrade 後の blockOriginalHTML 再構築) がこれを通すことで、検索中にページ切替や Shiki upgrade が走っても search mark が `blockOriginalHTML` に焼き込まれず、`closeSearch → reapplyAllMarks → el.innerHTML = original` でハイライトが復活する経路を構造的に塞ぐ (cmt 側にも同じ焼き込みリスクがあったため同時に対処)
- **input の autocomplete 抑止**: ブラウザの履歴サジェストが検索バー上に出るのを避けるため `autocomplete="off"` / `spellcheck="false"` を付ける (UI コンポーネントとしてのノイズ低減)
- **current match の DOM 識別**: 各 search mark には `data-search-index="<0-origin index>"` を付与し、`markCurrentSearchMark` / `scrollCurrentMarkIntoView` が `mark.search-hl[data-search-index="${currentIndex}"]` の attribute selector で current match を 1 つに絞る。document スコープで文書順に採番するため、ページ境界を跨いでも index は連続し、`nextMatchIndex` / `prevMatchIndex` の ループ計算と整合する

**リファレンス実装 (vercel-labs/mdxg)**

- parser: 該当責務なし（`Page.markdown` を提供して web 側に検索素材を渡す形）
- web: Cmd / Ctrl+F でトリガ。`globalMatches` で全 `pages` の `title + markdown` を lowercase 比較で集約、`Enter` / `Shift+Enter` で前後移動、`"N of M"` の件数表示。ページ境界跨ぎ時は自動で `navigateTo`、ハイライトは `highlightTextNodes` で text node に `<mark class="search-hl">` を挿入し `current` マッチに `scrollIntoView({ behavior: "smooth" })`。`apps/web/src/components/mdxg-viewer.tsx` / `globals.css` の `mark.search-hl`

**本実装との差異**: 起動キーはリファレンス実装の Cmd/Ctrl+F ではなく `f` 単独 (本実装は WASD ベースの左手キーマップで他のグローバルキーと同じ affordance スキーマで揃えた)。マッチ集約はリファレンス実装が `title + markdown` をソースに使うのに対し、本実装は **レンダリング済み DOM の textContent** を `textSegments` 経由で集める (cmt mark の境界・Shiki span ・Copy ボタン除外などの DOM 上の skip ルールを再利用して、検索対象を「画面に出ているテキスト」に揃える)。reapply hook を mark-engine に統合する設計は本実装独自で、Shiki upgrade / コメント追加 / 削除すべての経路で search 状態が自動復元される。

#### §13 Keyboard Navigation（準拠）

- [MUST] ページナビコントロールの矢印キー操作: ✓（`#page-nav` 配下の `keydown` handler で ↑/↓ は前後 link へ、Home/End で先頭/末尾の link へフォーカスを移動。詳細は下記）
- [MUST] Enter 等でのページ移動: ✓（`<a>` の標準挙動でブラウザが synthetic click を発火し、既存 click delegate が `navigateToTarget` を呼ぶ）
- [SHOULD] アクティブページがフォーカスを受け取る: ✓（キーボード Enter で navigate した時に `focusNavigatedLink` が対象 TOC link にフォーカスを戻す。マウスクリック / hashchange / page scroll-spy 由来ではフォーカスを動かさない、下記）
- [SHOULD] 逐次ナビゲーションのキーボードアクセス: ✓（TOC 上部の Prev / Next row も `a.page-nav-sequential-link` として focusable group に含まれ、Tab / ↑/↓ + Enter で同じ経路で動作）
- [MUST] 全インタラクティブ要素のアクセシブル名: ✓（網羅監査済み。装飾文字 `▾` / `＋` を `<span aria-hidden="true">` で覆い、`#modal` (コメント入力) に `role="dialog"` / `aria-modal="true"` / `aria-labelledby` を付与、`#modal-input` `<textarea>` に `aria-labelledby="modal-input-label"` で「Add a review comment」をアクセシブル名として束ね、コメントパネルの `.cmt-del` に `aria-label="Delete comment"` を追加。アイコン only な `#btn-theme` / `#btn-send-menu` は既存の `aria-label` で要件充足）

**実装詳細**

- **flat tab order**: 全 TOC link (`page-nav-link` / `page-outline-link` / `page-nav-sequential-link`) は `tabindex` 属性を持たない (デフォルト 0 で tab order に乗る)。Tab で TOC 内の link を順次巡回でき、もう一度 Tab で TOC を抜けて doc-pane / comments-pane へ進む。リファレンス実装 (vercel-labs/mdxg の各 `<li>` への `tabIndex={0}`) と同じ方針。WAI-ARIA APG が推奨する roving tabindex (1 tab stop に集約) は本実装では採用しない (TOC 内移動を Tab で完結させたいユーザー直感を優先し、↑/↓ 巡回は補助 hotkey として共存させる)
- **↑/↓/Home/End**: `wirePageNavigation` 内の `keydown` listener が `FOCUSABLE_LINK_SELECTOR` で集めた link 配列を DOM 順 (sequential → page-nav → outline) で巡回する。両端では index を clamp し、`preventDefault()` でブラウザのスクロールを止める。`Ctrl` / `Cmd` / `Shift` / `Alt` 修飾キー付きはスキップ
- **キーボード由来の判別**: click delegate は `MouseEvent.detail === 0` を「キーボード Enter から `<a>` がブラウザに dispatch させた synthetic click」と判定する。実マウス click は `detail >= 1` になるため誤判定しない。flag は `onSlugClick(slug, keyboardActivated)` で review.ts に伝わり、`navigateToTarget` の `focusTOC` パラメータを通って `focusNavigatedLink` に到達する
- **navigate 後の自動 focus**: `focusNavigatedLink(pageSlug, headingSlug)` が target を `[data-slug]` で一致検索し、`focusLinkAtIndex` 経由で `focus()` する。tabindex 操作は行わない (全 link が tab order に乗っているため)
- **スクロールスパイ由来は focus を動かさない**: `setOnPageActivated` callback は `renderPageNavigation` を呼ぶだけで、`focusNavigatedLink` には踏み込まない。本文を読みながらスクロールしている最中に TOC へフォーカスが奪われると UX が大きく悪化するため、明示的なキーボード navigate (Enter) 経由でのみフォーカス移動する設計判断

**affordance (キーボードナビゲーションの可視化 / 導線)**

「キーボード操作が可能であること」「TOC への入り方」が画面から自明でない問題に対し、以下 4 つの仕掛けを組み合わせている。

- **toolbar の Help (?) ボタン**: app-header 右側の theme toggle の隣に `<button id="btn-help" class="btn btn-ghost tooltipped">` を置き、クリックで `toggleHelpModal()` を呼ぶ。`aria-label="Show keyboard shortcuts"` + `data-tooltip="Keyboard shortcuts (h)"` で「`h` キーでも開ける」ことを示す。toolbar に置くのは「TOC が closed のときも常時可視であってほしい」要件を満たすため (TOC ヘッダー内に置くと closed 時に見えなくなる)
- **各 pane の keyhints**: `<span class="page-nav-keyhints">` / `<span class="doc-pane-keyhints">` / `<span class="comments-keyhints">` を各 pane に置き、`:focus-visible` のときだけ `visibility: visible` になる ephemeral な affordance。並び順は全 pane で先頭から `a w s d` (方向系 awsd) を共通化し、activate キーを持つ pane (TOC / comments) は末尾に `/ e` を追記する (doc-pane は activate 対象が無いため省略)。並びを揃えるのは、3 pane で順序が揺れると `e` と `a` を見間違える事故が起きやすいため。`:focus-within` でなく `:focus-visible` を採用するのは、マウスクリックで一瞬 trigger される flicker を避け、キーボード起因の focus のみに表示を絞るため。`aria-hidden="true"` で SR からは隠す。doc-pane / comments の keyhints は `height:0` の sticky anchor (`.doc-pane-keyhints-anchor` / `.comments-keyhints-anchor`) で包み、後続コンテンツを押し下げずにスクロール時の縦位置を上端に固定する
- **Skip to navigation link**: `<body>` 直後に `<a class="skip-link" id="skip-to-nav" href="#page-nav-list">Skip to navigation</a>` を置き、focus 時のみ画面左上に visible になる。click handler が active page-nav-link へ `focus()` を移す (href の anchor scroll では `<ul>` 自体が focusable でないため明示的に補う)。WAI-ARIA Authoring Practices の標準パターン
- **WASD ベースのグローバルキーマップ**: 左手のみで完結する操作系として、`AFFORDANCE_KEY_HANDLERS` (review.ts) で `event.code → handler` の dispatch table を組む。すべて単独キーで、ブラウザ native shortcut (Cmd+F 等) は触らない。`shouldSkipAffordanceKey` で textarea / input / contenteditable 中はスキップし、`hasNoModifier` で Ctrl/Alt/Shift/Meta 付きは無視する。`event.repeat` ガードは modal の点滅を避けるため。
  - **`a` / `d`**: 隣接 pane へ focus 移動。`detectCurrentPane()` が `document.activeElement` の祖先で `.page-nav` / `aside.comments` / `.doc-pane` を判定する。3 pane を環状 (TOC → doc → comments → TOC) と見立て、`a` で左方向、`d` で右方向に進み、両端で反対端へ wrap する (TOC で `a` → comments、comments で `d` → TOC)。両端 no-op だと「TOC で a を押しても何も起きない」反応の無さがあるため、左手だけで全 pane を一周できる回遊性を優先した。`PANE_FOCUS_LEFT` / `PANE_FOCUS_RIGHT` dispatch table で表現。何も focus してない (body) 状態は TOC fallback (左手 fallback)
  - **`w` / `s`**: pane 内アイテム間 focus 上下。TOC / comments では `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp'/'ArrowDown', bubbles: true }))` で既存の page-navigation / comments-keyboard delegate に委譲。doc-pane では `scrollBy({ top: ±40px })` で arrow key 相当の line scroll を再現
  - **`e`**: `document.activeElement.click()` で focus 中のアイテムを activate。TOC link / cmt-card / Send feedback button 等いずれもキー操作で押せる。doc-pane 自身は no-op (`.doc-pane` を明示的に skip、activate 対象が無いため)
  - **`f` / `h`**: `openSearch()` / `openHelpModal()` を起動。`event.code === 'KeyF'/'KeyH'` で判定 (`KeyboardEvent.code` は Dvorak / AZERTY 等の物理レイアウト差異に影響されない)
- pane 内 navigation のための ↑↓ / Home / End / Enter は MDXG §13 [MUST] が必須化しており、`w/s/e` とは別経路で MDXG 互換性のため引き続き動作する (TOC は page-navigation.ts の `onPageNavKeyDown` / comments は comments.ts の `onCommentsKeyDown` で実装)

**リファレンス実装 (vercel-labs/mdxg)**

- parser: 該当責務なし
- web: TOC リストの各 `<li>` に `tabIndex={0}` + `handleTocKeyDown` を付与し、↑/↓ で項目移動、←/→ で H1 配下グループの折りたたみ / 親 H1 へのフォーカス移動、Enter で `navigateTo`。`useEffect` で `activePageIndex` 変化時に当該 TOC アイテムへ自動フォーカス。アイコン only 系 button（prev / next / sidebar toggle）には `aria-label`。`apps/web/src/components/mdxg-viewer.tsx`

**本実装との差異**: tab order / 矢印キー / Enter の挙動は本実装も同方針 (flat tab order + keydown handler)。←/→ で H1 配下グループを折りたたむ挙動は本実装に H2 page 折りたたみ機能が無いため未実装。`activePageIndex` 変化時の自動フォーカスはリファレンス実装が無条件で行うのに対し、本実装は **キーボード Enter 由来のみ**に絞る (scroll-spy 由来の頻発フォーカス移動を避ける設計判断)。

### 規格に明文規定がない領域での判断

MDXG 規格 (`docs/mdxg/`) が明文化していない領域について、リファレンス実装と本実装で方針が分岐している項目を記録する。規格更新で明示規定が入った場合はそれに合わせて再評価する。

#### Markdown 内の raw HTML

- **MDXG 規格**: §1–§13 / §6 Conformance ともに raw HTML の扱いに関する明文規定なし。実装判断に委ねられている
- **リファレンス実装 (vercel-labs/mdxg)**: **blocklist 方式**。`packages/parser/src/index.ts` の `sanitizeHtml` が正規表現で `<script>` / `<iframe>` / `<object>` / `<embed>` / `<link>` タグ、`on*` event handler 属性、`javascript:` URI を削除し、それ以外 (`<ul>` / `<li>` / `<br>` / `<img>` / `<a>` / `<div>` / `<style>` 等) は素通し。MDXG ドキュメンテーションサイト (mdxg.org) のような「文書著者を信頼できる」前提で動く設計
- **本実装 (MDXG Redline)**: **escape all 方式**。`src/core/markdown.ts` の renderer が marked の `html` フックで全 raw HTML を文字エスケープし、タグとして DOM に出さない。レビュー対象 markdown は LLM 生成物が多く「文書著者を信頼できない」前提に立つため、リファレンス実装より厳格な信頼境界を採る (§11)
- **トレードオフ**: 信頼境界の安全性と引き換えに、表セル内の `・` のような GitHub Markdown 互換の生 HTML 記法は本実装では描画されず文字としてエスケープ表示される。本リポジトリ内の `docs/DESIGN.md` 等を本実装でレビューする際は、表セル内 list が崩れないよう中黒 (`・`) 区切り等で書く運用とする
- **代替案 (将来検討)**: コンテナ系タグ (`<ul>` / `<li>` / `<br>` / `<p>` 等、属性なしの構造タグ) のみ allowlist に追加すれば、属性 escape の漏れによる脆弱性を構造的に避けつつリファレンス実装に近い rendering が得られる。ただし採用するなら本実装の信頼境界の再評価が前提

### 対応外として割り切る項目

- **§4 [MUST] 相対画像パスをドキュメント位置基準で解決** — DESIGN.md §11 の URL allowlist と構造的に衝突する（信頼できない markdown を前提とするため、相対 URL を許可するとレビュアー追跡や `file://` 配下の任意取得経路が開く）。Conformance より信頼境界を優先し、現状の「相対 URL は描画せず alt のみ表示」を維持する。将来的に opt-in で Safe OFF を導入する道筋は[その他の拡張候補](#その他の拡張候補)の「相対画像パスの対応（Safe モードの無効化）」に整理してある

### その他の拡張候補

- **相対画像パスの対応（Safe モードの無効化）**：MDXG §4 [MUST]「相対画像パスをドキュメント位置基準で解決」に準拠するため、現状の Safe モード（常時 ON、§11 URL allowlist による相対 URL 拒否）を opt-out 可能にする拡張。実装には次の 3 点が必要：
  - **review-request CLI への Safe モード無効化オプション追加**：例 `--unsafe-images` を `src/cli/parse-args.ts` に追加し、明示指定時のみ Safe OFF で配布 HTML を生成する。`src/core/embed.ts` がフラグを受け取り、生成 HTML 側にフラグ（例：`<script id="embedded-md" data-safe="off">` のデータ属性、または独立した `<meta>` タグ）として書き出す。既定は Safe ON 維持（フラグ未指定なら現状の挙動）。既存配布 HTML を OS のファイラから単に開いた場合は遡って Safe OFF になることはなく、CLI で明示生成した HTML だけが Safe OFF として動作する
  - **CSP 緩和とブラウザ側 allowlist の更新**：`dist/embed-template.html` / `dist/standalone.html` の `<meta http-equiv="Content-Security-Policy">` の `img-src` に `file:` を追加（`file://` 起動時のみ有効）。ブラウザ側 `boot.ts` が埋め込み HTML の `data-safe` 属性を読み取り、`core/markdown.ts` の Safe モード状態を切り替える。Safe OFF 時は `<img>` 生成側で `new URL(href, location.href)` により相対 URL を解決し、絶対 `file:` パス（`![](/etc/passwd)` / `![](file:///…)` 等）は引き続き allowlist で弾く
  - **DevContainer / Codespaces 向けフォールバック用 HTTP サーバーでの画像配信機能の追加**：HTTP モード（`$BROWSER` が `file://` を扱えない環境）でも相対画像が解決できるよう、`src/cli/serve.ts` を拡張して元 MD と同じディレクトリ配下の画像ファイル（`*.png` / `*.jpg` / `*.gif` / `*.svg` / `*.webp` 等）を配信できるようにする。配信スコープを **元 MD のディレクトリ配下に限定** し、`..` を含むパスを正規化後にディレクトリ外を指していたら 404、シンボリックリンク先がディレクトリ外でも 404 とする（パストラバーサル対策）。リクエストパスは現状「無視して固定 HTML を返す」設計なので、画像配信を追加する場合は MIME type 判定 + パス正規化 + 配信スコープチェックを serve.ts に積む必要がある

  実装上の追加考慮：レビュー対象 markdown が信頼できない前提では、相対 URL を許可することで `<img onload>` を介した任意 file 存在確認の経路が開く（CSP で `<script>` は塞げても画像取得の成否は副作用として残る）。Safe OFF は「信頼済み markdown を手元で確認する」ユースケースに限定する旨を UI / ドキュメントに明示する必要がある

- **プロンプトインジェクション対策のマークダウンサニタイズ導入**：レビュー対象 markdown は LLM 生成物であることが多く、ChatML sigil（`<|im_start|>` 等）/ Harmony フォーマット（`<|start|>` / `<|message|>` / `<|channel|>` 等）/ HTML 風ロールタグ（`<system>` / `<developer>` / `<untrusted_content>` 等）/ 行頭ロール宣言（`human:` / `developer:` 等）/ instruction override 表現（`ignore previous instructions` / `you are now …` 等）/ 不可視 Unicode（zero-width / bidi override / tag chars / 制御文字）が紛れ込むと、`feedback.json` を読み込む後段 LLM のコンテキストで意図しない権限上書きを誘発し得る。

  [oubakiou/skills の guarded-webfetch-codex の sanitize.ts](https://github.com/oubakiou/skills/blob/main/skills/guarded-webfetch-codex/scripts/sanitize.ts) を参考に、次のサニタイズロジックを `src/core/sanitize.ts` として導入する：
  - **Unicode 層**：NFKC 正規化 + tag chars (U+E0000–U+E007F) / zero-width (U+200B–U+200F, U+2060, U+FEFF) / bidi override (U+202A–U+202E, U+2066–U+2069) / 制御文字を除去
  - **LLM マーカー層**：上記 sigil / ロールタグ / 行頭ロール宣言 / instruction override 表現を `[FILTERED:<category>]` プレースホルダに置換（カテゴリ: `chat_template` / `role_declaration` / `instruction_override`）
  - **再帰防御**：入力に既に含まれる `[FILTERED` / `[ESCAPED:` パターンを `[ESCAPED:` でラップしてから置換し、攻撃者がプレースホルダ自体を偽装する再帰注入を塞ぐ
  - **検出フラグの返却**：`suspicious_patterns`（カテゴリ別件数）/ `had_invisible_chars` / `truncated`（入力サイズ上限を超えた場合）を構造化して返す。攻撃文言そのものは件数だけに正規化し、生文字列を上位ロジックに渡さない

  統合ポイント：
  - **`src/app/boot.ts`**: 埋め込み markdown 読み込み時に sanitize を通し、結果を `state.markdown` にセット。`flags.suspicious_patterns` のカテゴリ別件数 + `had_invisible_chars` をステータスバー / toast に表示し、レビュワーに「injection 風パターンを N 件中和した」旨を可視化
  - **`src/core/review-export.ts`**: `feedback.json` の `quote` / `comment` 抽出時にも sanitize を通し、後段 LLM に渡る経路で injection が伝播するのを構造的に防ぐ
  - **`src/cli/review-request.ts`**: CLI 経由で配布 HTML を生成する段で markdown をサニタイズしてから embed（既定 ON）。技術文書として原文の sigil をそのまま表示したいケースのために `--raw-markdown` で opt-out 可能とし、その場合は HTML 側 `data-safe-markdown="off"` 属性を立て、ブラウザ起動時にステータスバーへ「Safe markdown OFF」を恒常表示する

  トレードオフ：サニタイズはレビュー対象の原文を改変するため、LLM チャットテンプレートの解説記事や ChatML 仕様書のように **意図的に sigil 文字列を含む技術文書** は `[FILTERED:chat_template]` 置換で読みづらくなる。Safe markdown OFF で原文維持に切り替えられるが、その場合は feedback.json への伝播経路が再び開くため、後段 LLM パイプラインを持つユーザーが意識的に判断する必要がある

- **MDXG §14 Math Rendering の対応**：MDXG 規格 §14 は `$...$` / `$$...$$` の数式描画を [SHOULD] とし、未対応時も生の文法を保持する [MUST] を課す。現状は marked のデフォルト挙動で `$...$` が plain text としてそのまま表示されており [MUST] は満たすが、[SHOULD] (KaTeX / MathJax 等での描画) は未対応。導入する場合は **KaTeX** の同期描画 API を採用するのが最小コスト（MathJax は遅延描画 API でレイアウト計算と相性が悪い）。実装上の追加考慮：
  - **CSP との整合**：KaTeX の CSS と数式フォント (woff2) を `dist/embed-template.html` / `dist/standalone.html` の両方に inline する必要がある。`style-src 'unsafe-inline'` は既に許可済みなので CSS は通るが、フォントは `@font-face src: url(data:...)` で data URI 化して `font-src` を増やさない構成にする。配布物サイズは KaTeX core + フォント data URI で +500–700 KB / gzip +180 KB 程度
  - **§6 アンカリングとの両立**：KaTeX は `<span class="katex">` で複雑な MathML / DOM ツリーを生成するため、textContent ベースの `startOffset` / `endOffset` 計算 (`selection.ts` の `textSegments`) は数式表記の各文字に対しては当たらない。`textSegments` 側で `.katex` 配下を `aria-hidden="true"` 子孫含めて skip し、`alt` 相当の plain text 表現 (`<annotation encoding="application/x-tex">` の中身) のみをオフセット計算に乗せる方針が現実的。これは `.code-copy-btn` / `.code-lang-label` の skip と同じパターン
  - **トレードオフ**：信頼境界の観点では KaTeX は `\href` などのコマンドで任意 URL を埋め込めるため、`trust: false` (既定) で起動して `\href` / `\url` を escape する必要がある。レビュー対象 markdown が信頼できない前提と整合する設定だが、設定漏れがあると URL allowlist (§11) を素通りする経路が開くので、KaTeX 初期化箇所を 1 関数に集約してオプションを固定化する
- **MDXG §15 Diagram Rendering の対応**：MDXG 規格 §15 は ` ```mermaid ` ブロックの視覚描画を [SHOULD] とし、未対応時は構文ハイライト付きコードブロックへのフォールバック ([MUST]) を要求する。現状は `mermaid` が Shiki 言語登録に含まれていないため plain text fallback で表示される ([MUST] は満たす)。導入する場合の主軸は **Mermaid.js** の同梱だが、配布物サイズへの影響が支配的：
  - **配布物サイズ**：Mermaid.js は SVG レンダラ + dagre / cytoscape のレイアウト計算で raw 約 2.8 MB / gzip 約 700 KB。これを inline すると `dist/embed-template.html` の総サイズが現行 315 KB から 1 MB 超へ増え、`file://` ダブルクリック起動時の初回 paint も無視できない遅延になる。`dist/standalone.html` 側は既に 5.77 MB あるため Mermaid 同梱の体感影響は相対的に小さいが、build 時の inline コストは増える。**初期 paint で plain text fallback を表示し、`requestIdleCallback` で Mermaid を lazy 読み込みして upgrade する 2 段構成** (Shiki と同じパターン) でしのぐ。grammar 同様、`dist/mermaid.mjs` を別 emit して CLI 側で opt-in (`--mermaid` フラグ) で `<script id="embedded-mermaid">` に注入する道もある
  - **信頼境界**：Mermaid は SVG / HTML を生成する過程でユーザー入力を相応に信頼する。`securityLevel: 'strict'` (sandboxed iframe で実行) または `securityLevel: 'antiscript'` (script タグ削除) を必須化し、レビュー対象が信頼できない前提を Mermaid 内部にも引き継ぐ。`html.dark` 連動は Mermaid の `theme: 'base'` + CSS variables バインドで実現する
  - **§6 アンカリングとの両立**：upgrade で `<pre>` の中身が `<svg>` に差し替わると textContent が空になり、コードブロック全体のオフセットが 0 に収束する。`<pre>` を残して `<svg>` を兄弟ノードとして挿入し、`<pre>` 自体に `hidden` を付けて視覚的には消すが textContent には残す構造で、`textSegments` から `[hidden]` 配下も拾う既存挙動を維持する。Shiki upgrade と同じ idempotent 化のために `data-mermaid-applied="1"` を付ける
- **MDXG §16 Footnotes の対応**：MDXG 規格 §16 は `[^1]` 参照と `[^1]: ...` 定義をリンク + 後方参照付きで描画することを [SHOULD] とし、未対応時も生の文法を保持する [MUST] を課す。marked GFM のデフォルトでは脚注未対応のため現状は `[^1]` が plain text で表示される ([MUST] は満たす)。導入する場合は **marked-footnote** 拡張を取り込むのが最小コスト：
  - **配布物サイズへの影響は軽微**：marked-footnote は数 KB で済み、Mermaid / KaTeX のような桁の追加コストは発生しない
  - **§6 アンカリングとの両立**：marked-footnote が生成する `<sup><a href="#fn-1">1</a></sup>` と末尾の `<section class="footnotes">` は通常の DOM として扱える。脚注参照そのものはインライン要素なので `blockId` は親段落に従い `startOffset` / `endOffset` の計算もそのまま機能する。末尾の脚注定義セクションは独立ブロックとして blockId が振られ、レビュアーが脚注本文にコメントを付けられる
  - **§9 Sequential Navigation との干渉**：脚注セクションは Stacked View で最終ページ末尾に独立して並ぶ。MDXG §16.1 「ページ末に描画」を文書末ではなく仮想ページ末で解釈する場合は `core/page-split.ts` で page 単位に脚注を分離する追加実装が必要になるが、現実的には文書末 1 箇所に集約する方が `[^foot]` 定義が複数 page に散らばっても解決経路が単純で済む
  - **`sourceLine` / `headingPath`**：脚注定義ブロックの `sourceLine` は marked.lexer のトークン位置から取れ、`headingPath` は定義箇所が属する section の祖先見出しに紐づく。export feedback.json への影響は無く、後段 LLM は通常の段落コメントと同じ形式で受け取る
- **スマートフォン向け UI の最適化**：選択ハンドル / floater 位置 / コメントパネル折りたたみなど、モバイル Safari / Chrome での操作性を前提に整える
- **型境界の共有強化**：`feedback.ts` の外部 JSON ガードと各 UI モジュールのローカル DOM 型を保ちつつ、将来は共通型の重複を減らす
- **DOM 依存ロジックのテスト環境追加**：現在の vitest セットアップは `vite.config.ts` の `test.environment` を指定しておらず node 環境で動くため、`src/app/` 配下の DOM API を使うロジック（`selection.ts` の `textSegments` / `mark-engine.ts` の `applyMarksForBlock` / `code-copy-wrap.ts` の `injectCopyButtons` / `doc-renderer.ts` の `cacheBlockOriginalHTML` 等）に in-source test を書けない状態が続いている。既存テストは Symbol を identity marker にするなど DOM を回避する書き方で凌いでいる。`happy-dom`（または `jsdom`）を dev dependency に追加し、`test.environment: 'happy-dom'` を登録すれば DOM tree 構造の不変条件に対する regression test を `app/` 配下にも貼れるようになる。順序依存（block-id 付与 → wrap 注入 → mark 再適用）のように DOM 階層の更新タイミングが絡む不変条件が複数発生してきた場合に優先度を上げる
- **差分ビュー**：連続する `<name>-<hash>-review.md` バージョン間の変更を表示
- **ネイティブなファイル変更通知**：オプションの CLI コンパニオン（30 行程度の Node WebSocket サーバーなど）で重ワークフロー時のサブ秒応答
- **review-request CLI のブラウザ起動チェーンを Linux でフルセットまで伸ばす**：現状 `buildOpenCommand` は `$BROWSER` → `xdg-open` の 2 段までで、主要 desktop 環境ではこれで通る前提。`gh` CLI 相当の `$BROWSER` → `xdg-open` → `wslview` (WSL) → `sensible-browser` → `x-www-browser` のフルチェーンに拡張すると、最小 Linux イメージや Debian/Ubuntu の特殊構成でも `xdg-open` 欠落時にフォールバックでブラウザが立ち上がる。各候補の存在判定（PATH 探索）と起動成否の判定を分けて実装する必要があり、検証コスト・テストマトリクスが増えるため現状は採用していない

---

## 13. ビルドパイプライン

エンドユーザーには単一 HTML を配布するが、開発者は TypeScript で書く。両者の橋渡しが [Vite+ (vp)](https://viteplus.dev/) ベースのビルドパイプライン。vp は Vite 8 + Rolldown + vitest を統合し、`vp build` / `vp dev` / `vp test` の単一 CLI として提供する。

### 全体像

ビルドの出口は 3 つ。エンドユーザーが直接開く配布物 `dist/standalone.html`、review-request CLI が rewrite テンプレートとして読み込む `dist/embed-template.html`、配布者向け CLI ツール `dist/review-request.mjs`。

```
[ 開発者ローカル ]                                          [ 配布 ]

src/app/*.ts + src/core/*.ts ─┐
                              │
src/styles/*.css ─────────────┤
                              │   vp build (vite.config.ts)
src/review.html (Vite エントリ) ─┼─►  vite + Rolldown   ─►  dist/embed-template.html
                              │   + viteSingleFile         (CLI rewrite テンプレート、
                              │   + mdxg-shiki-assets      grammar 注入なし最小サイズ、
                              │   + mdxg-split-outputs     ~315 KB / gzip ~95 KB)
vite.config.ts ───────────────┤
                              │                       ─►  dist/standalone.html
                              │                            (単独 Open file 用、
                              │                            27 言語 grammar inline 済み、
                              │                            ~5.7 MB / gzip ~1.6 MB)
                              │
                              │                       ─►  dist/shiki-langs/<lang>.json
                              │   (mdxg-shiki-assets       (27 言語の grammar JSON、
scripts/lib/shiki-meta.mjs ──┤    plugin が emit)         commit 対象。CLI / standalone
                              │                            の双方が読み込む素材)
                              │
                              └─► src/core/shiki-aliases.generated.ts
                                  (mdxg-shiki-assets plugin の buildStart で再生成、
                                   commit 対象、CLI / browser 双方が import)

src/cli/*.ts (Node CLI) ──────┐
                              │   vp build --config vite.review-request.config.ts
src/core/embed.ts (pure) ─────┼─►  vite + Rolldown   ─►  dist/review-request.mjs
                              │   (SSR mode、Node ESM)     (Node 実行可能、
vite.review-request.config.ts ─┘                          shebang 付き、
                                                          embed-template.html を読む)
```

**`mdxg-split-outputs` plugin**: viteSingleFile が中間出力 `dist/review.html` を生成した後、`mdxg-shiki-assets` の closeBundle で 27 言語の grammar JSON が emit され、続いて本 plugin の closeBundle が走る。役割は次の 2 点：

1. `dist/shiki-langs/*.json` を全部読んで grammar の `Record<lang, json>` を組み立て、中間出力 `dist/review.html` の `<script id="embedded-shiki-langs">` に inline → `dist/standalone.html` として書き出し
2. 中間出力 `dist/review.html` を `dist/embed-template.html` にリネーム（こちらは grammar 注入なし、CLI が `--shiki-langs` モードに応じて動的に注入する）

設計判断として `vite.standalone.config.ts` を別ファイル化する案も検討したが、独立 plugin 1 個で完結することと、grammar JSON の生成順序依存を 1 つの vite build 内で satisfied にできる利点から、同一 config 内に統合した。

**grammar の二重 inline を許容する根拠**: build 後の `dist/` 配下では grammar が 2 箇所に存在する（`dist/shiki-langs/*.json` の 27 ファイル + `dist/standalone.html` に inline された全 grammar）。DRY ではないが、両者の生成元は同じ `mdxg-shiki-assets` plugin であり、毎 build で `dist/shiki-langs/*.json` → `dist/standalone.html` の片方向 inline で再生成されるため drift は構造的に起こらない。runtime fetch で解決する案は `file://` での XHR / fetch path 制約と CSP `connect-src 'none'` 緩和を伴うため不採用、symlink 案は Windows / npm publish 互換性が落ちるため不採用。

**両 HTML の構造的不変条件**: `dist/standalone.html` と `dist/embed-template.html` は共通の `src/review.html` を入力に派生するため、`<script id="embedded-md">` / `<script id="embedded-feedback">` / `<script id="embedded-shiki-langs">` / `<meta http-equiv="Content-Security-Policy">` などの構造的タグ位置はすべて同一に保つ。standalone.html では `<script id="embedded-md">` が空のままだが、ブロック自体を残すことで `boot.ts` の起動シーケンス（§9）が両 HTML で共通経路を辿れる。standalone.html から空ブロックを削除する変更は構造分岐を生むため避ける。

### ビルドの責務分担

**standalone.html / embed-template.html 用（`vite.config.ts`）**

| レイヤー                    | ツール                 | 役割                                                                                                                                                                                                                                                                |
| --------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript 型チェック・変換 | `tsc`（vite 経由）     | TS → JS 変換、型エラー検出                                                                                                                                                                                                                                          |
| バンドル                    | Rolldown（Vite 内蔵）  | `src/app/review.ts` を入口に `app/` 配下 (boot / workspace / comments / toolbar / selection / mark-engine / doc-renderer 等) と `core/` 配下 (markdown / feedback / review-export / escape / types) + npm 依存 (`marked`) を 1 つの JS チャンクに統合               |
| HTML 処理                   | Vite                   | `<script type="module" src="./app/review.ts">` および `<link rel="stylesheet" href="./styles/*.css">`（src 内相対）を bundle 結果への参照に書き換え                                                                                                                 |
| CSS bundle                  | Vite                   | `src/styles/*.css` (review.css + markdown.css) を CSS チャンクに統合                                                                                                                                                                                                |
| inline 化                   | vite-plugin-singlefile | bundle された JS チャンク・CSS を `<script>` / `<style>` として HTML 内に inline                                                                                                                                                                                    |
| Shiki 関連資材出力          | mdxg-shiki-assets      | buildStart で `src/core/shiki-aliases.generated.ts` を再生成 (Shiki `bundledLanguagesInfo` から 27 正規名 + ALIAS_TO_CANONICAL を抽出)、closeBundle で `dist/shiki-langs/<lang>.json` (27 言語の grammar JSON) を emit。共通ロジックは `scripts/lib/shiki-meta.mjs` |
| 出力分岐                    | mdxg-split-outputs     | closeBundle で `dist/shiki-langs/*.json` 27 ファイルを読み、`<script id="embedded-shiki-langs">` に inline した `dist/standalone.html` を書き出す。中間出力 `dist/review.html` は `dist/embed-template.html` にリネーム                                             |

**review-request CLI 用（`vite.review-request.config.ts`）**

| レイヤー        | ツール                | 役割                                                                                                                                                                                                                   |
| --------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| バンドル        | Rolldown（Vite 内蔵） | `src/cli/review-request.ts` を入口に `src/cli/{parse-args,input-source,open-command,serve}.ts` と `src/core/embed.ts` を 1 つの ESM (`dist/review-request.mjs`) に統合。Node 組み込みモジュール (`node:*`) は external |
| Node ターゲット | Vite SSR mode         | Node 20+ をターゲットにし、`process` / `fs/promises` / `path` / `url` 等の Node API をそのまま参照する形で出力                                                                                                         |
| shebang 保持    | Rolldown 標準挙動     | `src/cli/review-request.ts` 冒頭の `#!/usr/bin/env node` を出力先に保持し、`chmod +x` 不要で実行可能な状態にする                                                                                                       |

ランタイム（`dist/standalone.html` / CLI が生成する `*-review.html`）は Vite / Rolldown を一切知らない。出力 HTML は通常の `<script>` を含むだけ。`dist/review-request.mjs` も Node 標準 ESM として直接実行できる。

### コマンド

devcontainer または `./local_setup.sh` が `npm install` で `vite-plus`（`vp`）を導入し、`vp` コマンドを利用可能にする。

```bash
# 1 回ビルド（commit 前に必ず叩く）。standalone.html / embed-template.html / review-request.mjs を生成する。
npm run build                  # = vp build && vp build --config vite.review-request.config.ts

# review-request CLI だけを再ビルド（cli/ や core/embed.ts を編集中の差分ビルド用）
npm run build:review-request   # = vp build --config vite.review-request.config.ts

# ファイル変更で自動再ビルド（HTML 出力側のみ）
npm run build:watch # = vp build --watch

# HMR 付き dev サーバー（編集体験を上げたい時のみ）
npm run dev         # = vp dev

# テスト実行
npm test            # = vp test
```

`npm run build` 後に `dist/standalone.html` / `dist/embed-template.html` / `dist/review-request.mjs` が再生成される。ソースと生成物の同期は人手 + 任意で pre-commit hook で担保する。`dist/review-request.mjs` は実行時に同ディレクトリの `dist/embed-template.html` を読み込むため、両者は常に揃った状態で commit する。

### テスト

主要な TypeScript ソースは in-source testing を使い、`vite.config.ts` の `test.includeSource` に登録する。`npm test`（= `vp test`）で実行される。

現在の主な対象：

- `app/review.ts`：state 依存の小さな helper とコメント生成
- `app/boot.ts`：起動 helper、埋め込み markdown / feedback の読み込み
- `app/app-state.ts`：Write feedback.json の dirty 追跡 (isFeedbackDirty / markFeedback\*)
- `app/mark-engine.ts`：state.comments のグルーピングと startOffset 降順ソート
- `app/selection.ts`：保存 offset とテキストセグメントの対応
- `app/comments.ts`：コメントカード HTML と DOM 順ソート
- `app/toolbar.ts`：ファイル選択 helper
- `app/comment-modal.ts`：保留中の選択範囲と本文から `Comment` を組み立てる純粋ヘルパ
- `app/floater.ts`：選択範囲から floater payload を作る + rect → floater 位置の計算
- `app/workspace.ts`：`feedback.json` 書き出しと filename 解決
- `app/workspace-fs.ts`：FS Access API の handle type guard / 権限確認 / IDB fail-soft
- `app/scroll.ts`：固定 duration scroll の easing
- `app/comments-width.ts`：右パネル幅・開閉状態の pure な解決ロジック（clamp / snap 判定 / `localStorage` × CLI ヒント × 既定値の優先順位 P1 解決）
- `app/comments-resize.ts`：keyboard step / `widthFromPointer` (viewport 右端からの距離) / `resolveScrollbarOffset` (要素の `offsetWidth - clientWidth` から実描画上の scrollbar 幅を取る) / `resolveViewportRightGap` (viewport 右端と box の境界差) の helper 群
- `app/page-nav-width.ts`：左 TOC 幅・開閉状態の pure な解決ロジック（comments-width.ts と対称、値域は 180–480、key は `mdxg-redline.page-nav-*`）
- `app/page-nav-resize.ts`：左 TOC の右端ハンドルのドラッグ・開閉タブの wiring（comments-resize.ts と対称、widthFromPointer は viewport 左端からの距離）
- `app/search.ts`：検索 UI モジュールの health check + `resolveInitialCurrentIndex` の境界条件
- `core/escape.ts`：5 文字 (`& < > " '`) を HTML 実体参照に置換 (XSS 防御)
- `core/search.ts`：`findMatchesInText` (case-insensitive substring / オーバーラップ非含む) / `nextMatchIndex` / `prevMatchIndex` / `formatMatchCount` の純粋ロジック
- `core/feedback.ts`：外部 JSON / pending selection の型ガード
- `core/markdown.ts`：raw HTML escape とコードブロック維持
- `core/review-export.ts`：feedback JSON payload / ファイル名 / 件数表示
- `core/block-anchors.ts`：`marked.lexer` の出力から blockId → `{ sourceLine, headingPath }` の Map を組み立てる純粋ロジック
- `core/embed.ts`：markdown を JSON 文字列にエンコード（`<` を `<` に置換）、`data-name` 属性エスケープ、`<script id="embedded-md" type="text/markdown">` の rewrite。Node CLI からもブラウザ側からも再利用できる pure module
- `cli/parse-args.ts`：CLI 引数パース (`--no-open` / `--document-name` / stdin token `-`) と出力ファイル名サニタイズ
- `cli/input-source.ts`：stdin / file 入力の解決
- `cli/open-command.ts`：OS / `$BROWSER` 別の起動コマンド構築と VS Code Remote 環境検知
- `cli/serve.ts`：`MDXG_REDLINE_PORT` 解析と fallback 警告
- `cli/review-request.ts`：CLI エントリの run 関数（引数 → embed → 書き出し → ブラウザ起動の orchestration）

### `vite-plugin-singlefile` の挙動

- emit された JS バンドル（自前コード + `marked`）と CSS は `<script>` / `<style>` として HTML 内に inline
- HTML 内に直接書かれた `<script id="embedded-md" type="text/markdown">` や `<script id="embedded-feedback" type="application/json">` は **触られない**（`type` がモジュールではないため Vite の処理対象外）
- `src/review.html` には外部 CDN への `<link>` / `<script src="https://...">` を含まない。`<head>` の `<link rel="stylesheet" href="./styles/review.css">` / `<link rel="stylesheet" href="./styles/markdown.css">` も bundle 結果に inline される
- 配布物 `dist/standalone.html` と `dist/embed-template.html` はどちらも **起動に必要なものをすべて内包し、外部依存ゼロ** で動作する

### HTML minify 無効維持と CI スモークテスト指針

review-request CLI は `dist/embed-template.html` の `<script id="embedded-md" type="text/markdown">` を正規表現で書き換える方式を採っているため、HTML minify を有効化して属性順や空白を変えると `core/embed.ts` の `EMBEDDED_MD_RE` (`id="embedded-md"` と `type="text/markdown"` の両方を lookahead で要求) が脆くなる。属性順の揺らぎは lookahead で吸収しているが、属性自体が削除される minify は救済できない。**HTML minify は将来も無効のまま維持する** ことで、CLI 側の保守コストを増やさずに rewrite の安定性を確保する。`mdxg-split-outputs` plugin が `dist/standalone.html` を生成する際も同じ `<script id="embedded-shiki-langs">` への正規表現マッチに依存するため、両 HTML 共通の不変条件としても効く。

将来 CI を強化する場合は、ビルド後の `dist/embed-template.html` と `dist/standalone.html` の両方に **`id="embedded-md"` と `type="text/markdown"` を併せ持つ `<script>` タグが含まれていること**、および `dist/standalone.html` に `<script id="embedded-shiki-langs">` が空でないこと、をスモークテストで検査するのが望ましい（`core/embed.ts` の前提と `splitOutputsPlugin` の不変条件を守るため）。現状は in-source test が dist 配下の構造を直接検査していないため、配布前の手作業確認に依存している。

### 開発者の責務

1. ソースは `src/` 配下（`cli/` / `app/` / `core/` / `styles/` / `review.html`）のみを編集する
2. ビルド出力（`dist/standalone.html` / `dist/embed-template.html` / `dist/review-request.mjs` / `dist/shiki-langs/*.json`）は **手で編集しない**（次の `vp build` で上書きされる）
3. commit 前に `npm run build` を実行し、ソースと両方の出力をコミットする
4. 設計変更を伴う場合は本ドキュメント（§4 / §13 / §14）も更新する

### エンドユーザーの責務

なし。`dist/standalone.html` をブラウザで開くだけ。配布者が markdown を埋め込みたい場合は `node dist/review-request.mjs <input.md> [output-dir]` を使う（§3 入力 2 / §8 ファイル命名規約 参照）。

---

## 14. ファイル構成

ソース（`src/`）と生成物（`dist/`）を明確に分離している。`src/` 配下を編集し、`npm run build` で `dist/standalone.html` / `dist/embed-template.html` / `dist/review-request.mjs` を再生成する。

```
mdxg-redline/
├── README.md                エンドユーザー向けの概要・インストール・使い方
├── LICENSE                  MIT
├── package.json             name / deps / scripts / files / bin (将来) /
│                             scripts.build = "vp build && vp build --config vite.review-request.config.ts"
├── tsconfig.json            TypeScript 設定 (DOM lib 追加)
├── vite.config.ts           Vite 設定 (root: 'src', outDir: '../dist', vite-plugin-singlefile,
│                             test.includeSource, fmt/lint の ignorePatterns で dist/ 除外)
├── vite.review-request.config.ts     review-request CLI 用ビルド設定 (SSR mode、Node 20+、shebang 保持、
│                             node:* を external、出力は dist/review-request.mjs)
├── .gitignore
├── src/                     ─── ソース（編集対象） ──────────────────────
│   ├── review.html          Vite エントリ HTML
│   │   ├── <head>
│   │   │   ├── <meta http-equiv="Content-Security-Policy" ...>       CSP (§11)
│   │   │   ├── <link rel="stylesheet" href="./styles/review.css">    ← Vite が bundle して inline
│   │   │   └── <link rel="stylesheet" href="./styles/markdown.css">  ← 同上
│   │   └── <body>
│   │       ├── <script id="embedded-md">                注入ポイント（markdown）
│   │       ├── <script id="embedded-feedback">          注入ポイント（JSON）
│   │       ├── <header class="app-header">              ツールバー + 状態表示
│   │       ├── <input type="file" id="file-md" hidden>  Open file 用の隠し input
│   │       ├── <main class="layout">
│   │       │   ├── <section class="doc-pane">
│   │       │   │   ├── #doc-wrap     空状態
│   │       │   │   └── #doc          レンダリング済み markdown
│   │       │   └── <aside class="comments">  コメント一覧 (Conversation)
│   │       ├── #floater                                 「＋ Comment」ボタン
│   │       ├── #modal                                   コメント入力ダイアログ
│   │       ├── #toast                                   一時的なステータス通知
│   │       └── <script type="module" src="./app/review.ts">  ← Vite が bundle して inline
│   ├── styles/              ─── スタイル ───────────────────────────────
│   │   ├── review.css       全体スタイル (toolbar / modal / comments / floater / button 等)
│   │   └── markdown.css     markdown 描画用スタイル (heading / code / blockquote 等)
│   ├── core/                ─── 環境非依存ドメインロジック (CLI / browser 双方が import) ─
│   │   ├── embed.ts         markdown 埋め込みの pure ロジック (JSON エンコード + rewrite + ファイル名規約)。
│   │   │                     `docHash` (SHA-256 先頭 16 桁 hex) の計算と
│   │   │                     `<mdFileName>-<docHash>-review.html` の名前生成も担う。
│   │   │                     review-request CLI とブラウザ側 boot.ts / loadFromMarkdown の双方から再利用
│   │   ├── escape.ts        HTML escape (`& < > " '` → 実体参照)。innerHTML / 属性値 共通
│   │   ├── feedback.ts      feedback / embedded / pending selection の型ガード
│   │   ├── markdown.ts      marked renderer。raw HTML を escape し、コードブロックは維持
│   │   ├── review-export.ts feedback JSON payload、件数表示、export ファイル名
│   │   ├── block-anchors.ts `marked.lexer` のトップレベルトークン列から
│   │   │                     blockId → { sourceLine, headingPath } の Map を作る純粋ロジック。
│   │   │                     doc-renderer (state.blockAnchors の更新) と review-export
│   │   │                     (export JSON の headingPath / sourceLine 解決) が import する
│   │   ├── slugify.ts       Page / heading slug の ASCII 限定生成 + 非 ASCII fallback +
│   │   │                     重複時 `-N` suffix。MDXG §6.4 一意性の要件を満たす純粋ロジック
│   │   ├── page-outline.ts  markdown 行 scanner (scanHeadings) と H3–H6 outline 抽出
│   │   │                     (extractPageHeadings)。コードフェンス追跡 + ATX / setext 両対応で、
│   │   │                     page-split / doc 内 outline 両方が import する pure module
│   │   ├── page-split.ts    markdown → Page[] の分割 (splitIntoPages)。Introduction page /
│   │   │                     単一ページ正規化 / round-trip 不変条件 / ancestorHeadingPath / slug 解決 /
│   │   │                     sourceLine → pageIndex 逆引き (findPageIndexBySourceLine) を含む。
│   │   │                     MDXG §6 Virtual Pages の中核 pure module
│   │   ├── scan-fenced-langs.ts  markdown 内のフェンス言語識別子を集約し Shiki 正規名集合に
│   │   │                     正規化する pure module。CLI `--shiki-langs auto` から呼ばれる
│   │   ├── search.ts        case-insensitive substring match (findMatchesInText) +
│   │   │                     next/prev/format 件数の純粋ロジック (MDXG §10 Search)
│   │   ├── shiki-aliases.generated.ts  Shiki bundledLanguagesInfo から自動生成 (commit 対象)。
│   │   │                     SHIKI_SUPPORTED_LANGS (27 正規名) + ALIAS_TO_CANONICAL を export。
│   │   │                     vite.config.ts の mdxg-shiki-assets plugin が再生成する
│   │   └── types.ts         モジュール間で共有する JSON / コメント型 (Comment は pageIndex /
│   │                         sourceLine 必須化済み、MDXG §6.5 / §6.6)
│   ├── app/                 ─── Browser DOM / API 専用 ─────────────────
│   │   ├── review.ts        DOM エントリ、event wiring、loadFromMarkdown / navigateToTarget
│   │   │                     orchestrator (TOC / outline / Sequential / hashchange を 1 経路に統合)
│   │   ├── boot.ts          起動順序（workspace handle 復元 / embedded / pageIndex 逆引き）
│   │   ├── app-state.ts     state 単一の真の源 + Write feedback.json の dirty 追跡 +
│   │   │                     state.pages / state.activePageIndex (MDXG Virtual Pages)
│   │   ├── dom-utils.ts     qs / qsInput / uid / toast
│   │   ├── mark-engine.ts   state.comments → <mark class="cmt"> の再適用エンジン (activePageIndex で
│   │   │                     フィルタして他ページの blockId 偶発衝突を構造的に塞ぐ、§7.1 / §9.4)
│   │   ├── doc-renderer.ts  markdown を HTML 化して #doc に流し込む + blockAnchors 再構築 +
│   │   │                     active page の headingSlugs / ancestorHeadingPath 反映
│   │   ├── pages.ts         findPageBySlug / parseHashSlug / resolveTargetFromHash /
│   │   │                     syncHashFromActivePage 等の URL hash ↔ page index 解決ロジック
│   │   ├── page-navigation.ts 左サイドバー TOC の renderPageNavigation + active page の H3–H6
│   │   │                     outline を inline 展開 (renderOutlineList) + click delegation
│   │   │                     (MDXG §7 Page Navigation + §8 Page Outline)
│   │   ├── sequential-nav.ts 本文末尾の Prev / Next リンク (MDXG §9 Sequential Navigation)。
│   │   │                     最初 / 最後ページで該当方向を DOM から omit
│   │   ├── scroll-spy.ts    IntersectionObserver で active page 内の H3–H6 を観測し、
│   │   │                     topmost visible に aria-current="location" を付与 (MDXG §8 [SHOULD]
│   │   │                     スクロールスパイ) + scrollToHeading で navigate 経由 instant scroll
│   │   ├── selection.ts     選択範囲 → blockId / text offsets / DOM Range
│   │   ├── comments.ts       コメント一覧、カード描画、mark / card のアクティブ状態 +
│   │   │                     this page / all 件数表示 (MDXG §9.2)
│   │   ├── toolbar.ts       Open / Export / Copy / Clear の toolbar 配線
│   │   ├── comment-modal.ts コメント入力モーダルの状態管理・保存処理・floater との配線。
│   │   │                     新規 Comment に sourceLine / pageIndex を埋める (§6.5)
│   │   ├── floater.ts       選択範囲追従の「＋ Comment」フローター
│   │   ├── menu.ts          ドロップダウンメニュー (Comments ▾ / Send ▾) 共通コントローラ
│   │   ├── dialog.ts        確認・通知モーダル
│   │   ├── help-modal.ts    キーボードショートカット help モーダル (`?` で toggle、§13 affordance)。
│   │   │                     modal HTML は static (src/review.html) で、open/close と
│   │   │                     wiring のみ担当
│   │   ├── search.ts        検索 UI / DOM 操作 (MDXG §10 Search)。public API は openSearch /
│   │   │                     closeSearch / setSearchQuery / nextMatch / prevMatch / isSearchOpen /
│   │   │                     wireSearchBar / configureSearchNavigation / reapplySearchHighlights。
│   │   │                     setSearchQuery が全 page を走査して `<mark class="search-hl">` を
│   │   │                     text node に挿入し、`setOnMarksReapplied(reapplySearchHighlights)`
│   │   │                     で reapply 経路に hook を register することで Shiki upgrade /
│   │   │                     renderAll / コメント追加・削除のいずれでも search 状態が維持される。
│   │   │                     cmt mark との視覚分離は CSS で確保、ハイライト寿命管理 / 焼き込み
│   │   │                     防止は §10 Search 詳細節と doc-renderer.ts の
│   │   │                     innerHTMLForOriginalCache 参照
│   │   ├── scroll.ts        固定 duration smooth scroll
│   │   ├── storage.ts       IndexedDB の薄いラッパ（`workspace-handle` 永続化専用）
│   │   ├── workspace.ts     File System Access API 連携の orchestrator
│   │   │                     (writeFeedback / changeOutputFolder / restoreWorkspaceHandle)
│   │   ├── workspace-fs.ts  FS Access API 型 + handle lifecycle (picker / permission / IDB)
│   │   ├── theme.ts         theme (system / light / dark) の状態解決 + localStorage / data-theme 連携
│   │   ├── comments-width.ts パネル幅・開閉状態の pure ロジック (clamp / snap / 解決 P1) +
│   │   │                     localStorage / `<html data-comments-width>` 連携
│   │   ├── comments-resize.ts コメントパネル左端ハンドルのドラッグ・開閉タブの wiring。
│   │   │                     doc-pane の `offsetWidth - clientWidth` から実描画上の scrollbar 幅
│   │   │                     + viewport 右端ギャップを合算し `--doc-scrollbar-offset` CSS 変数に
│   │   │                     流して、closed 時の開閉タブを scrollbar の左に貼り付ける
│   │   │                     (ResizeObserver で doc-pane と #doc を監視し、open/closed 切替や
│   │   │                      content load にも追従する)
│   │   ├── page-nav-width.ts 左 TOC 幅・開閉状態の pure ロジック (comments-width.ts と対称、
│   │   │                     値域 180–480 / default 220 / storage key `mdxg-redline.page-nav-*`)
│   │   ├── page-nav-resize.ts 左 TOC 右端ハンドルのドラッグ・開閉タブの wiring
│   │   │                     (comments-resize.ts と対称、widthFromPointer は viewport 左端からの距離。
│   │   │                      開閉タブは画面左端固定で scrollbar 補正なし)
│   │   └── shiki.ts         Shiki ハイライタの lazy singleton 初期化と
│   │                         `<script id="embedded-shiki-langs">` からの grammar 読み込み。
│   │                         core/markdown.ts の CodeHighlighter インターフェースを満たす
│   └── cli/                 ─── Node CLI (dist/review-request.mjs のソース) ──
│       ├── review-request.ts CLI エントリ (`dist/review-request.mjs` のエントリ)。core/embed を呼んで
│       │                     <input.md> (または stdin) から `<mdFileName>-<docHash>-review.html` を
│       │                     指定ディレクトリ (省略時は input.md と同じ場所、stdin 時は cwd) に生成し、
│       │                     既定で標準ブラウザを起動する shebang 付きスクリプト
│       ├── parse-args.ts    引数パース (`--no-open` / `--document-name` / `--theme` / `--shiki-langs` /
│       │                     `--comments-width` / `--page-nav-width` / `-h|--help` / stdin token `-`) + HELP_TEXT +
│       │                     sanitizeMdFileName + parseShikiLangsValue (auto/all/none/csv の
│       │                     ShikiLangsMode 解釈) + parseCommentsWidthValue (0 or 280–640 整数の検証) +
│       │                     parsePageNavWidthValue (0 or 180–480 整数の検証)
│       ├── input-source.ts  stdin / file 入力の解決
│       ├── open-command.ts  OS / `$BROWSER` 別のブラウザ起動コマンド + VS Code Remote 環境判定
│       └── serve.ts         `$BROWSER` が file:// を扱えない環境向け軽量 HTTP サーバー (port 51729 デフォルト)
├── dist/                    ─── 生成物（commit 対象、編集禁止） ──────────
│   ├── standalone.html      ★ `npm run build` の出力。エンドユーザーが直接開く配布物。
│   │                         JS / CSS / npm 依存 (marked, shiki core + 2 テーマ + JS engine)
│   │                         + 27 言語の Shiki grammar すべてが事前 inline 済み (~5.7 MB / gzip ~1.6 MB)。
│   │                         CLI を経由せずに全コードブロックが Shiki でハイライト表示される
│   ├── embed-template.html  ★ `npm run build` の出力。review-request CLI が rewrite テンプレートとして
│   │                         読み込む素材専用。standalone.html と JS / CSS / CSP / DOM 構造は同一だが、
│   │                         `<script id="embedded-shiki-langs">` が空で grammar 0 (~315 KB / gzip ~95 KB)。
│   │                         CLI が `--shiki-langs` モードに応じて動的に grammar を注入する想定で、
│   │                         エンドユーザーが直接開く用途は想定しない (開くと plain text fallback)
│   ├── review-request.mjs   ★ `npm run build:review-request` の出力。Node 20+ で実行可能な
│   │                         配布者向け review-request CLI。実行時に同ディレクトリの
│   │                         embed-template.html / shiki-langs/*.json を読み込むため揃った状態で commit する
│   └── shiki-langs/          ★ `vp build` の mdxg-shiki-assets plugin が emit する 27 言語の
│                             grammar JSON (commit 対象)。CLI と standalone build (mdxg-split-outputs plugin)
│                             の双方が読み込み、`<script id="embedded-shiki-langs">` に inline する
├── scripts/
│   ├── generate-shiki-aliases.mjs  単独 CLI で src/core/shiki-aliases.generated.ts を再生成。
│   │                          vite.config.ts の mdxg-shiki-assets plugin と同じロジックを使う
│   └── lib/
│       ├── shiki-meta.mjs    Shiki bundledLanguagesInfo から正規名 / ALIAS_TO_CANONICAL / grammar
│       │                     JSON を抽出する共通ロジック。CLI script と vite plugin が import
│       └── shiki-meta.d.mts  vite.config.ts (TS) からも import するための型注釈
└── docs/
    └── DESIGN.md            本ドキュメント
```

ソース（`src/review.html` + `src/styles/*.css` + `src/{cli,app,core}/*.ts` + `vite.config.ts`）と出力（`dist/standalone.html` / `dist/embed-template.html` / `dist/review-request.mjs` / `dist/shiki-langs/*.json`）はいずれも commit 対象。生成物を commit するのは、clone 直後の利用者が `vp build` を実行せずにそのままブラウザで開けるようにし、npm publish 時にも `dist/` が必ず含まれるようにするため。

### 編集ルール

- 編集対象は `src/` 配下のみ（`review.html` / `styles/*.css` / `cli/*.ts` / `app/*.ts` / `core/*.ts`）。`dist/standalone.html` / `dist/embed-template.html` / `dist/review-request.mjs` / `dist/shiki-langs/*.json` は `vp build` で都度上書きされるため手で直さない
- ソースの編集後は `vp build` でビルドし、両ファイルを commit する
