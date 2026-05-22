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

エンドユーザーには **単一 HTML ファイル**（`dist/review.html`）を配布するだけで動く。サーバー不要・別ファイル不要・追加インストール不要（※ VS Code Remote Containers / Codespaces のように `$BROWSER` 経由で `file://` がホスト側ブラウザに届かない環境でのみ、review-request CLI が一時的な軽量 HTTP サーバーを立ててブラウザに配信する。詳細 §3）。

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

| 制約                                                                                | 影響                                                                                                                             |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| ブラウザのみ、バックエンドなし                                                      | 状態はすべてブラウザストレージかローカルファイル                                                                                 |
| エンドユーザーには単一 HTML ファイルとして配布                                      | CSS / JS / npm 依存（`marked`）をすべて Vite が bundle・inline。CDN 参照なしで完全オフライン動作                                 |
| `file://` と `http://localhost` の両方で動作                                        | origin が変わると IndexedDB の `workspace-handle` が分離するため、別 origin で開いた回は picker 再表示にフォールバックする（§7） |
| LLM がコンテンツ事前読み込みで起動できること                                        | 複数の注入経路（埋め込み・ファイル選択）                                                                                         |
| フィードバックは機械可読                                                            | 位置情報を持つ安定参照を含む JSON 出力                                                                                           |
| レビュー対象 markdown は信頼済みとは限らない                                        | markdown 内の raw HTML は実行せず、文字として escape 表示する                                                                    |
| 開発時のみ Vite+ (vp) ツールチェーンを使用（`vite-plugin-singlefile` で 1 HTML 化） | TypeScript + 外部 CSS で開発、`vp build` で `dist/review.html` を再生成。配布時は JS / CSS とも inline される                    |

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
node dist/review-request.mjs [--no-open] [--document-name <name>] <input.md|-> [output-dir]
```

- `<input.md>` を `-` にすると標準入力から markdown を読み込む（パイプ運用や生成エージェントからの直接渡し向け）
- `--document-name <name>` で `data-name` 属性と出力ファイル名 prefix を明示的に上書きできる（stdin 入力時のファイル名指定にも使う）
- `--no-open` で自動起動 (file パス直渡し / HTTP サーバーモード双方) を抑止
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
│    - GitHub Primer 風 chrome (header / sidebar / toolbar)      │
│    - DADS (Digital Agency Design System) テーマの本文プレビュー │
│    - 本文とサイドバーは独立スクロール                         │
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
  blockId: string // 例: "b003" — レンダリング時に付与
  quote: string // 選択されたテキスト原文（人間の参照用）
  comment: string // ユーザーのコメント
  startOffset: number // ブロックのフラットテキスト内の開始位置
  endOffset: number // ブロックのフラットテキスト内の終了位置
  created: string // ISO 8601
}
```

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
}
```

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
- **HTTP モードの origin 安定性**: review-request CLI の HTTP モードはデフォルトポート `51729`（`MDXG_REDLINE_PORT` で上書き可）で起動を試み、同一 origin (`http://localhost:51729`) を維持することで `workspace-handle` のサイレント復元を成立させる。ポートが衝突して random fallback した場合は origin が変わるため、その回だけは picker が再表示される
- **API 非対応ブラウザ**: Safari / Firefox の挙動は §10 を参照

---

## 9. 起動シーケンス

ページロード時に以下の優先順チェーンを実行。出力先ハンドル復元は副作用が無く後段を阻害しないため、本文ロードのパスとは独立に走らせる。埋め込みで本文が確定した時点で終了する。

```
0. IndexedDB から workspace-handle をサイレント復元 (副作用は in-memory のみ)
   └─ 権限再要求はしない。Write feedback.json 押下時にまとめて扱う

1. 埋め込み markdown (<script id="embedded-md">)
   └─ ロード。<script id="embedded-feedback"> があれば併せて適用

2. 該当しなければ空状態のまま `Open file` を待つ
```

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
- markdown 内の raw HTML は renderer 層で escape し、`<script>` や event handler を DOM として実行しない。フェンス付きコードブロック内の HTML 例は通常どおりコードとして表示する
- **リンク・画像の URL スキーム allowlist**: 信頼できない markdown を前提に `markdown.ts` の `Renderer.link` / `Renderer.image` をオーバーライドし、許可外のスキームを `<a>` / `<img>` として描画しない。リンクは `http:` / `https:` のみ許可、画像は `https:` / `data:` のみ許可（CSP の `img-src` と一致）。**相対 URL は両方とも不許可**（`new URL(href)` が absolute parse 可能なものだけが通過する）。不許可リンクは inner HTML をそのまま出力して plain text 化、不許可画像は alt テキストを描画して画像取得そのものを抑止する。`javascript:` / `data:` リンク経由の XSS と、レビュアー追跡を意図した外部画像（相対 URL → file:// 配下の任意取得、`http:` 経由の平文 referrer）を構造的に塞ぐ
- **Content Security Policy**: `dist/review.html` に `<meta http-equiv="Content-Security-Policy">` を埋め込み、二重保険で攻撃面を狭める。`file://` で開かれる前提のため HTTP ヘッダではなく meta で指定する。内容は次のとおり：
  - `default-src 'none'` — 明示許可以外は全て deny
  - `script-src 'self' 'unsafe-inline'` — singlefile bundle した inline script のために `'unsafe-inline'`
  - `style-src 'unsafe-inline'` — singlefile bundle した inline style のため
  - `img-src https: data:` — レンダリング用に許可した画像と同じ範囲
  - `connect-src 'none'` — fetch / XHR / WebSocket / EventSource をすべて遮断（コメント本体の export はユーザー主導の `Write` / `Copy` / `Export` のみで、ネットワーク経路を使わない）
  - `base-uri 'none'` / `form-action 'none'` — base 改竄とフォーム送信を禁止
  - `frame-ancestors` は仕様上 `<meta>` 経由では無視されるため指定していない（clickjacking 対策は HTTP ヘッダ配信時の課題として残す）
- embedded feedback の `comments[]` は型ガードを通し、不正なコメント要素は除外する
- markdown の内容は、ユーザーが明示的に `Export as JSON` / `Copy as JSON` / `Write feedback.json` のいずれかを押さない限りブラウザ外に出ない
- 出力先フォルダの権限は選択したディレクトリにスコープされる。ページが任意のディスクの場所にアクセスすることはない
- IndexedDB の用途は「出力先ディレクトリハンドルの保存」のみ（§7）。コメント本体や本文は IndexedDB に書かない。ハンドルは origin に紐づくため、別のパスやオリジンで開けば再ピッカーが必要になる
- ビルドパイプラインは開発者ローカルでのみ動作。配布物 `dist/review.html` 自体はビルド成果物としてリポジトリにコミットされており、エンドユーザー環境にはツールチェーンを持ち込まない

---

## 12. MDXG 準拠ロードマップ・今後の拡張

### MDXG 準拠

MDXG Redline は **MDXG Viewer**（[Markdown Experience Guidelines (MDXG)](https://github.com/vercel-labs/mdxg) の読み取り専用レンダラ準拠レベル）を内蔵し、その上にインラインコメントと構造化フィードバック JSON 書き出しというレビュー機能を載せたツールである。Viewer の各機能は段階的に取り込み中で、現状の準拠状況は次のとおり：

表の最右列「リファレンス実装 (vercel-labs/mdxg)」は対岸の参考実装 (`packages/parser` / `apps/web`) がどう実装しているかを記述する列であり、本実装 (MDXG Redline) の説明ではない。本実装の挙動・採用方針は「詳細」列を参照すること。

| 分類               | MDXG セクション                                                                                       | 現状   | 詳細                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | リファレンス実装 (vercel-labs/mdxg)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rendering          | [§1 Theming](./mdxg/01-rendering.md#1-themingテーマ)                                                  | 部分   | <ul><li>[MUST] ホスト環境への外観適応: 未対応（DADS テーマ固定で `prefers-color-scheme` 未参照）</li><li>[SHOULD] 色をホストテーマ / OS から導出: 未対応</li><li>[MUST NOT] 色をユーザー設定必須にしない: ✓（既定で配色済み）</li><li>[MUST] ライト / ダーク両ホストテーマ対応: 未対応（ライト固定）</li></ul>                                                                                                                                                                                                                                                                                  | <ul><li>parser: 対象外（UI 層）</li><li>web: Tailwind v4 の CSS variables を `:root`（light）/ `.dark`（dark）で切替。`app/layout.tsx` 冒頭の inline script で `localStorage("theme")` を優先しつつ初回は `prefers-color-scheme` に fallback（FOUC 防止）。`components/header.tsx` の Sun/Moon トグルが `html.dark` を切り替え。`apps/web/src/app/globals.css`</li></ul>                                                                                                                                                                                      |
| Rendering          | [§2 Code Block Rendering](./mdxg/01-rendering.md#2-code-block-renderingコードブロック描画)            | 部分   | <ul><li>[MUST] 言語識別子付きフェンスの構文ハイライト: 未対応（marked デフォルトの `<code class="language-…">` 出力のみ）</li><li>[MUST] 言語識別子なしブロックの等幅描画: ✓</li><li>[MUST] 1 アクションでコピー可能なボタン: 未対応</li><li>[MUST] ハイライト配色のライト / ダーク適応: 未対応（`pre` 背景は `#1e1e1e` 固定）</li></ul>                                                                                                                                                                                                                                                        | <ul><li>parser: `code` renderer をオーバーライドし、`options.codeRenderer` でホストへ委譲（fallback は `<pre data-lang="…"><code>…</code></pre>`）。`packages/parser/src/index.ts`</li><li>web: Shiki で SSR ハイライト（`createHighlighter` を遅延初期化、30+ 言語、`themes: { light: github-light, dark: github-dark }` の dual theme）。コピー button は `mdxg-viewer.tsx` の useEffect で `<pre>` に動的注入し「Copy → Copied!」をトグル。`apps/web/src/lib/parser.ts` / `components/mdxg-viewer.tsx` / `globals.css` の `.copy-btn` / `.shiki`</li></ul> |
| Rendering          | [§3 Task Lists](./mdxg/01-rendering.md#3-task-listsタスクリスト)                                      | 準拠   | <ul><li>[MUST] `- [ ]` を未チェック checkbox として描画: ✓（marked GFM）</li><li>[MUST] `- [x]` をチェック済み checkbox として描画: ✓</li><li>[MAY] checkbox のインタラクティブ / 読み取り専用: 読み取り専用（marked が `disabled` 付き `<input>` を出力）</li><li>[MUST] リスト構造とインデントの保持: ✓</li></ul>                                                                                                                                                                                                                                                                             | <ul><li>parser: marked GFM のデフォルト挙動（拡張なし）。`packages/parser/src/index.ts`</li><li>web: `@tailwindcss/typography` の `prose` をベースに、`globals.css` で `prose ul:has(> li > input[type=checkbox])` の list-style を解除して見栄え調整。`apps/web/src/app/globals.css`</li></ul>                                                                                                                                                                                                                                                               |
| Rendering          | [§4 Images](./mdxg/01-rendering.md#4-images画像)                                                      | 部分   | <ul><li>[MUST] インラインに描画: ✓</li><li>[MUST] 相対画像パスをドキュメント位置基準で解決: 未対応（信頼境界の都合で URL allowlist が相対 URL を弾き、alt のみ描画。DESIGN.md §11 参照）</li><li>[MUST] コンテンツ幅に収まる制約: ✓（`#doc img { max-width: 100% }`）</li><li>[MUST NOT] 水平方向にあふれない: ✓</li><li>[MUST] alt テキスト保持 / 支援技術アクセス: ✓</li><li>[SHOULD] ロード失敗時の alt フォールバック: 部分（不許可スキーム時は alt 描画。ネットワーク失敗時の自動切り替えは未実装）</li></ul>                                                                              | <ul><li>parser: marked デフォルト（相対 URL もそのまま `<img src>` に出力）。`sanitizeHtml` は `<script>` / `<iframe>` / `<object>` / `<embed>` / event handler / `javascript:` だけを削除し `<img>` は素通し。`packages/parser/src/index.ts`</li><li>web: `@tailwindcss/typography` の `prose` で max-width を制御。画像キャプション用テーブルは `prose table:has(img)` の例外として `globals.css` で罫線を消す</li></ul>                                                                                                                                    |
| Rendering          | [§5 Tables](./mdxg/01-rendering.md#5-tables表)                                                        | 準拠   | <ul><li>[MUST] セル罫線 / 視覚的分離: ✓（`th` / `td` に border）</li><li>[MUST] ヘッダ行と本文行の視覚区別: ✓（`thead` 背景色 + 太字）</li><li>[MUST] markdown の列整列指定を尊重: ✓（marked GFM が `align` を style 出力）</li><li>[MUST] 広いテーブルの水平スクロール: ✓（`markdown.ts` の `renderer.table` オーバーライドが `<table>` を `<div class="table-wrap">` で包み、CSS 側で `overflow-x: auto` を付与）</li><li>[MUST NOT] ページレイアウト破壊: ✓（ラッパが overflow を吸収するため、`#doc` の `max-width: 860px` を超えるテーブルでも親レイアウトを破壊しない）</li></ul>         | <ul><li>parser: marked GFM のデフォルト挙動（拡張なし）。`packages/parser/src/index.ts`</li><li>web: `@tailwindcss/typography` の `prose` table スタイルをそのまま採用（水平スクロールは typography plugin デフォルトの `<pre>` / `<table>` overflow 任せ）</li></ul>                                                                                                                                                                                                                                                                                         |
| Document Structure | [§6 Virtual Pages](./mdxg/02-document-structure.md#6-virtual-pages仮想ページ)                         | 未対応 | <ul><li>[MUST] H1 / H2 境界での仮想ページ分割 (6.1): 未対応</li><li>[MUST] ATX / setext 両形式の見出し認識 (6.1): 未対応</li><li>[MUST NOT] フェンスコード内の見出しをページ境界としない (6.1): 未対応</li><li>[MUST] コードフェンスの open / close 追跡 (6.1): 未対応</li><li>[SHOULD] 見出し前コンテンツの Introduction ページ化 (6.2): 未対応</li><li>[SHOULD] 空 / 空白のみは Introduction を作らない (6.2): 未対応</li><li>[MUST] ページ深さで階層伝達 (6.3): 未対応</li><li>[MUST] URL セーフな一意スラッグ (6.4): 未対応</li><li>[MUST] 同一スラッグの曖昧性解消 (6.4): 未対応</li></ul> | <ul><li>parser: `splitIntoChunks` で H1 / H2 境界分割（ATX `# / ##` + setext `=` / `-` 両対応）。最初の見出し前のコンテンツは "Introduction" ページに集約、`depth: 1 / 2` を chunk に付与。`extractHeadings` で H3–H6 抽出時はコードフェンス `inCodeFence` トラッキングで除外（注: `splitIntoChunks` 側はフェンス追跡なし）。`slugify` + 重複時 `-N` サフィックスで一意 ID。`packages/parser/src/index.ts`</li><li>web: parser の返す `Page[]` をそのまま `MdxgViewer` に渡す</li></ul>                                                                       |
| Document Structure | [§7 Page Navigation](./mdxg/02-document-structure.md#7-page-navigationページナビゲーション)           | 未対応 | <ul><li>[MUST] 全ページをドキュメント順に閲覧: 未対応</li><li>[MUST] 任意ページへの移動: 未対応</li><li>[MUST] 現在ページの視覚的識別: 未対応</li><li>[MUST] 逐次移動の提供（詳細は §9）: 未対応</li></ul>                                                                                                                                                                                                                                                                                                                                                                                      | <ul><li>parser: `Page[]`（depth 1 / 2 順序保持）を提供。`packages/parser/src/index.ts`</li><li>web: 左サイドバー `<nav>` + `<ul ref={tocListRef}>` に depth でインデントしたページ一覧を出力。`activePageIndex` をハイライト（`border-l-primary` + `bg-primary/10`）、H1 配下の H2 グループはシェブロンで折りたたみ可能。Next.js Router で `pageHrefs` 経由の URL 同期、モバイル時は `vaul` Drawer に切替。`apps/web/src/components/mdxg-viewer.tsx`</li></ul>                                                                                                |
| Document Structure | [§8 Page Outline](./mdxg/02-document-structure.md#8-page-outlineページアウトライン)                   | 未対応 | <ul><li>[MUST] アクティブページ内 H3–H6 のみ含める: 未対応</li><li>[MUST] 各見出しがナビゲート可能: 未対応</li><li>[SHOULD] 深さの視覚的伝達: 未対応</li><li>[SHOULD] 現在可視の見出しを示す（スクロールスパイ）: 未対応</li><li>[MAY] H3–H6 がない場合の非表示 / 空表示: 未対応</li></ul>                                                                                                                                                                                                                                                                                                      | <ul><li>parser: `Page.headings: Heading[]` で H3–H6 と一意 ID を提供（コードフェンス除外 + スラッグ重複サフィックス）。`packages/parser/src/index.ts` の `extractHeadings`</li><li>web: 右 `<aside>` に "On this page" として出力。`h.level` で `pl-0 / pl-3 / pl-6 / pl-9` のインデント、`IntersectionObserver` でスクロールスパイし `activeHeadingId` をハイライト、`headings.length === 0` 時は非表示。モバイル時は Drawer。`apps/web/src/components/mdxg-viewer.tsx`</li></ul>                                                                            |
| Document Structure | [§9 Sequential Navigation](./mdxg/02-document-structure.md#9-sequential-navigation逐次ナビゲーション) | 未対応 | <ul><li>[SHOULD] 前 / 次ページのタイトル可視化: 未対応</li><li>[MUST] 適用不可コントロールの hidden / disabled: 未対応</li><li>[MUST] 少なくとも 1 箇所からのアクセス: 未対応</li></ul>                                                                                                                                                                                                                                                                                                                                                                                                         | <ul><li>parser: 該当責務なし</li><li>web: ツールバーの ‹ / › button（先頭 / 末尾で `disabled`、`aria-label` でタイトル明示）+ ページ末尾の "Previous / Next" タイトル付きリンクの 2 箇所からアクセス可能。`apps/web/src/components/mdxg-viewer.tsx`</li></ul>                                                                                                                                                                                                                                                                                                 |
| Document Structure | [§10 Search](./mdxg/02-document-structure.md#10-search検索)                                           | 未対応 | <ul><li>[MUST] 検索の起動: 未対応</li><li>[MUST] レンダリング後テキストへの検索: 未対応</li><li>[MUST] 現在マッチのハイライト + スクロールイン: 未対応</li><li>[MUST] 次 / 前のマッチ移動: 未対応</li><li>[MUST] ページ境界を跨ぐマッチ位置の保持: 未対応</li><li>[MUST] 他ページの特定マッチへの正確な着地: 未対応</li><li>[SHOULD] マッチ件数の表示: 未対応</li><li>[SHOULD] ページ境界跨ぎ時の自動ナビゲート: 未対応</li></ul>                                                                                                                                                               | <ul><li>parser: 該当責務なし（`Page.markdown` を提供して web 側に検索素材を渡す形）</li><li>web: Cmd / Ctrl+F でトリガ。`globalMatches` で全 `pages` の `title + markdown` を lowercase 比較で集約、`Enter` / `Shift+Enter` で前後移動、`"N of M"` の件数表示。ページ境界跨ぎ時は自動で `navigateTo`、ハイライトは `highlightTextNodes` で text node に `<mark class="search-hl">` を挿入し `current` マッチに `scrollIntoView({ behavior: "smooth" })`。`apps/web/src/components/mdxg-viewer.tsx` / `globals.css` の `mark.search-hl`</li></ul>              |
| Accessibility      | [§13 Keyboard Navigation](./mdxg/04-accessibility.md#13-keyboard-navigationキーボードナビゲーション)  | 部分   | <ul><li>[MUST] ページナビコントロールの矢印キー操作: 未対応（ページ概念なし）</li><li>[MUST] Enter 等でのページ移動: 未対応</li><li>[SHOULD] アクティブページがフォーカスを受け取る: 未対応</li><li>[SHOULD] 逐次ナビゲーションのキーボードアクセス: 未対応</li><li>[MUST] 全インタラクティブ要素のアクセシブル名: 部分（split button / Comments ▾ には `aria-label` / `role`、可視テキスト持ち button は要件充足。全要素の網羅監査は未実施）</li></ul>                                                                                                                                         | <ul><li>parser: 該当責務なし</li><li>web: TOC リストの各 `<li>` に `tabIndex={0}` + `handleTocKeyDown` を付与し、↑/↓ で項目移動、←/→ で H1 配下グループの折りたたみ / 親 H1 へのフォーカス移動、Enter で `navigateTo`。`useEffect` で `activePageIndex` 変化時に当該 TOC アイテムへ自動フォーカス。アイコン only 系 button（prev / next / sidebar toggle）には `aria-label`。`apps/web/src/components/mdxg-viewer.tsx`</li></ul>                                                                                                                              |

優先順序：

1. **§1 host theme adaptation** — `prefers-color-scheme` 対応とトークン整理。リファレンス実装 (apps/web) は CSS variables を `:root`（light）/ `.dark`（dark）で切替 + `app/layout.tsx` 冒頭の inline script で FOUC 防止 + Sun/Moon トグル button + `localStorage("theme")` で永続化、というパターンを採用しており、MDXG Redline でも同パターンが流用可能。DADS テーマトークンを CSS variables 化し、`.dark` セレクタで上書きするのが移行最小コスト
2. **§13 アクセシブル名の網羅監査** — 全インタラクティブ要素に可視テキストまたは `aria-label` を確認・付与（ページ概念に非依存で先行可能）
3. **§2 コピー button + シンタックスハイライト** — Shiki をリファレンス実装と同じ構成（`themes: { light: github-light, dark: github-dark }` の dual theme + リファレンス実装が採用する 28 言語: `javascript` / `typescript` / `python` / `bash` / `json` / `html` / `css` / `markdown` / `yaml` / `toml` / `rust` / `go` / `java` / `c` / `cpp` / `ruby` / `php` / `sql` / `shell` / `diff` / `jsx` / `tsx` / `xml` / `swift` / `kotlin` / `scala` / `zig` / `lua`）で採用する。bundle 戦略は `shiki/core` + `shiki/engine/javascript` + 言語の個別 import で Rolldown の tree-shake に乗せる（Oniguruma WASM engine は WASM 込みで更に重くなるため JS engine を採用）。**想定バンドル増分は raw +3〜5 MB / gzipped +1〜1.5 MB** で、`dist/review.html` のサイズは現状 70 KB から **約 5 MB / 1.5 MB gzipped に拡大する**（実測値は導入後ビルドで確定）。`core/markdown.ts` の marked renderer の `code` を Shiki 呼び出しに差し替え、§1 host theme adaptation 完了後の `html.dark` 切替に追従させる。コピー button は React 非依存で、レンダリング後の `<pre>` に DOM 操作で動的注入する（リファレンス実装の useEffect 相当ロジックを `doc-renderer.ts` の再描画フックに移植）。配布物サイズが問題になる場合は[その他の拡張候補](#その他の拡張候補)の「review-request CLI による Shiki 言語サブセット動的注入」で必要分だけに絞る
4. **§6 / §7 / §8 / §9 Virtual Pages 系** — UI モデルの根本見直し。インラインコメントとの統合設計が前提。@mdxg/parser をフル採用すると §11 URL allowlist / §4 相対 URL ポリシー / blockId アンカリングと衝突するため、**`splitIntoChunks` / `extractHeadings` / `slugify` のロジックを参考に MDXG Redline 内へ再実装する B 案** を推奨（リファレンス実装の `splitIntoChunks` 側に存在するコードフェンス追跡欠落バグも、再実装の段階で修正できる）。コメントの blockId は page 単位に閉じ込め、page 境界跨ぎの選択は不許可、という方針で整理する必要がある。UI 側の左サイドバー / 折りたたみ / Next.js Router 相当の URL 同期はリファレンス実装の `mdxg-viewer.tsx` がそのまま設計の下敷きになる
5. **§13 残り（ページナビ矢印 / Enter / フォーカス受け取り / 逐次ナビのキーボード操作）** — §6–§9 のページモデル成立後。リファレンス実装の `handleTocKeyDown`（↑↓ で項目移動 / ←→ で H1 配下の折りたたみ・親へフォーカス / Enter で navigate / `activePageIndex` 変化時の自動 focus）がそのまま参考になる
6. **§10 Search** — Virtual Pages 統合後。リファレンス実装は `globalMatches` で全ページから集約 → `highlightTextNodes` で text node に `<mark class="search-hl">` を挿入する方式。MDXG Redline は既にコメントの `<mark class="cmt">` が DOM に常駐するため、**検索ハイライト用 `<mark>` とコメントハイライト用 `<mark>` の共存設計**（クラス分離 + 既存 blockId オフセット再計算との競合回避 + 選択範囲 → コメント生成フロー中の検索 mark 退避）が前提条件として追加で必要

### 対応外として割り切る項目

- **§4 [MUST] 相対画像パスをドキュメント位置基準で解決** — DESIGN.md §11 の URL allowlist と構造的に衝突する（信頼できない markdown を前提とするため、相対 URL を許可するとレビュアー追跡や `file://` 配下の任意取得経路が開く）。Conformance より信頼境界を優先し、現状の「相対 URL は描画せず alt のみ表示」を維持する。将来的に opt-in で Safe OFF を導入する道筋は[その他の拡張候補](#その他の拡張候補)の「相対画像パスの対応（Safe モードの無効化）」に整理してある

### その他の拡張候補

- **相対画像パスの対応（Safe モードの無効化）**：MDXG §4 [MUST]「相対画像パスをドキュメント位置基準で解決」に準拠するため、現状の Safe モード（常時 ON、§11 URL allowlist による相対 URL 拒否）を opt-out 可能にする拡張。実装には次の 3 点が必要：
  - **review-request CLI への Safe モード無効化オプション追加**：例 `--unsafe-images` を `src/cli/parse-args.ts` に追加し、明示指定時のみ Safe OFF で配布 HTML を生成する。`src/core/embed.ts` がフラグを受け取り、生成 HTML 側にフラグ（例：`<script id="embedded-md" data-safe="off">` のデータ属性、または独立した `<meta>` タグ）として書き出す。既定は Safe ON 維持（フラグ未指定なら現状の挙動）。既存配布 HTML を OS のファイラから単に開いた場合は遡って Safe OFF になることはなく、CLI で明示生成した HTML だけが Safe OFF として動作する
  - **CSP 緩和とブラウザ側 allowlist の更新**：`dist/review.html` の `<meta http-equiv="Content-Security-Policy">` の `img-src` に `file:` を追加（`file://` 起動時のみ有効）。ブラウザ側 `boot.ts` が埋め込み HTML の `data-safe` 属性を読み取り、`core/markdown.ts` の Safe モード状態を切り替える。Safe OFF 時は `<img>` 生成側で `new URL(href, location.href)` により相対 URL を解決し、絶対 `file:` パス（`![](/etc/passwd)` / `![](file:///…)` 等）は引き続き allowlist で弾く
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

- **スマートフォン向け UI の最適化**：選択ハンドル / floater 位置 / サイドバー折りたたみなど、モバイル Safari / Chrome での操作性を前提に整える
- **型境界の共有強化**：`feedback.ts` の外部 JSON ガードと各 UI モジュールのローカル DOM 型を保ちつつ、将来は共通型の重複を減らす
- **差分ビュー**：連続する `<name>-<hash>-review.md` バージョン間の変更を表示
- **ネイティブなファイル変更通知**：オプションの CLI コンパニオン（30 行程度の Node WebSocket サーバーなど）で重ワークフロー時のサブ秒応答
- **review-request CLI のブラウザ起動チェーンを Linux でフルセットまで伸ばす**：現状 `buildOpenCommand` は `$BROWSER` → `xdg-open` の 2 段までで、主要 desktop 環境ではこれで通る前提。`gh` CLI 相当の `$BROWSER` → `xdg-open` → `wslview` (WSL) → `sensible-browser` → `x-www-browser` のフルチェーンに拡張すると、最小 Linux イメージや Debian/Ubuntu の特殊構成でも `xdg-open` 欠落時にフォールバックでブラウザが立ち上がる。各候補の存在判定（PATH 探索）と起動成否の判定を分けて実装する必要があり、検証コスト・テストマトリクスが増えるため現状は採用していない
- **review-request CLI による Shiki 言語サブセット動的注入**：MDXG §2 シンタックスハイライト導入後の配布物サイズ（raw +3〜5 MB / gzipped +1〜1.5 MB）を、レビュー対象 markdown で実際に使われている言語だけに絞ることで圧縮する拡張。実装方針：
  1. **ビルド成果物の 2 分割**：`dist/review.html` には Shiki core + JS engine + 2 テーマだけを inline し、28 言語の grammar JSON は `dist/shiki-langs/<lang>.json` として個別ファイルに分離出力する（vite.config.ts の chunking 設定 + 各 grammar を JSON として emit）
  2. **CLI 側の言語スキャン**：`src/cli/review-request.ts` が `<input.md>` を ` ```(\w+)` パターンでスキャンし、出現言語の集合を抽出する。`src/core/embed.ts` の rewrite ロジックに渡し、該当 grammar の JSON を `<script id="embedded-shiki-langs" type="application/json">` として配布 HTML に embedded-md と同じ手法で埋め込む
  3. **ブラウザ側の Shiki 初期化変更**：`doc-renderer.ts`（または新設の `app/shiki.ts`）の `createHighlighter` 呼び出しを「embedded-shiki-langs から grammar を読み込む」モードに変更。未収録言語のフェンスは `<pre><code>…</code></pre>` の plain text として fallback 描画

  これにより、典型的なレビュー（仕様書 / 提案書で 1〜3 言語のみ使用）では bundle 増分が **数 MB から数 100 KB レベル に縮小**する見込み（実測は実装後）。代償として `dist/` 配下のアーティファクトが「`review.html` + `shiki-langs/`」の 2 構成になり、`review.html` を CLI を介さず直接ダブルクリックした場合は言語 grammar が未注入のためコードブロックは plain text 描画にフォールバックする（既定の使い方は review-request CLI 経由の配布なので実害は小さい）。CLI 経由でない単発用途のために、全 28 言語を bundle 済みの heavyweight `dist/review-full.html` を併存させる選択肢もある

---

## 13. ビルドパイプライン

エンドユーザーには単一 HTML を配布するが、開発者は TypeScript で書く。両者の橋渡しが [Vite+ (vp)](https://viteplus.dev/) ベースのビルドパイプライン。vp は Vite 8 + Rolldown + vitest を統合し、`vp build` / `vp dev` / `vp test` の単一 CLI として提供する。

### 全体像

ビルドの出口は 2 つ。エンドユーザー配布物の `dist/review.html` と、配布者向け CLI ツールの `dist/review-request.mjs`。

```
[ 開発者ローカル ]                                          [ 配布 ]

src/app/*.ts + src/core/*.ts ─┐
                              │
src/styles/*.css ─────────────┤
                              │   vp build (vite.config.ts)
src/review.html (Vite エントリ) ─┼─►  vite + Rolldown   ─►  dist/review.html
                              │   + viteSingleFile         (単一 HTML、
vite.config.ts ───────────────┘                            CSS/JS inline)

src/cli/*.ts (Node CLI) ──────┐
                              │   vp build --config vite.review-request.config.ts
src/core/embed.ts (pure) ─────┼─►  vite + Rolldown   ─►  dist/review-request.mjs
                              │   (SSR mode、Node ESM)     (Node 実行可能、
vite.review-request.config.ts ─┘                          shebang 付き)
```

### ビルドの責務分担

**review.html 用（`vite.config.ts`）**

| レイヤー                    | ツール                 | 役割                                                                                                                                                                                                                                                 |
| --------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript 型チェック・変換 | `tsc`（vite 経由）     | TS → JS 変換、型エラー検出                                                                                                                                                                                                                           |
| バンドル                    | Rolldown（Vite 内蔵）  | `src/app/review.ts` を入口に `app/` 配下 (boot / workspace / sidebar / toolbar / selection / mark-engine / doc-renderer 等) と `core/` 配下 (markdown / feedback / review-export / escape / types) + npm 依存 (`marked`) を 1 つの JS チャンクに統合 |
| HTML 処理                   | Vite                   | `<script type="module" src="./app/review.ts">` および `<link rel="stylesheet" href="./styles/*.css">`（src 内相対）を bundle 結果への参照に書き換え                                                                                                  |
| CSS bundle                  | Vite                   | `src/styles/*.css` (review.css + markdown.css) を CSS チャンクに統合                                                                                                                                                                                 |
| inline 化                   | vite-plugin-singlefile | bundle された JS チャンク・CSS を `<script>` / `<style>` として HTML 内に inline                                                                                                                                                                     |

**review-request CLI 用（`vite.review-request.config.ts`）**

| レイヤー        | ツール                | 役割                                                                                                                                                                                                                   |
| --------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| バンドル        | Rolldown（Vite 内蔵） | `src/cli/review-request.ts` を入口に `src/cli/{parse-args,input-source,open-command,serve}.ts` と `src/core/embed.ts` を 1 つの ESM (`dist/review-request.mjs`) に統合。Node 組み込みモジュール (`node:*`) は external |
| Node ターゲット | Vite SSR mode         | Node 20+ をターゲットにし、`process` / `fs/promises` / `path` / `url` 等の Node API をそのまま参照する形で出力                                                                                                         |
| shebang 保持    | Rolldown 標準挙動     | `src/cli/review-request.ts` 冒頭の `#!/usr/bin/env node` を出力先に保持し、`chmod +x` 不要で実行可能な状態にする                                                                                                       |

ランタイム（review.html）は Vite / Rolldown を一切知らない。出力 HTML は通常の `<script>` を含むだけ。`dist/review-request.mjs` も Node 標準 ESM として直接実行できる。

### コマンド

devcontainer または `./local_setup.sh` が `npm install` で `vite-plus`（`vp`）を導入し、`vp` コマンドを利用可能にする。

```bash
# 1 回ビルド（commit 前に必ず叩く）。review.html と review-request.mjs の両方を生成する。
npm run build                  # = vp build && vp build --config vite.review-request.config.ts

# review-request CLI だけを再ビルド（cli/ や core/embed.ts を編集中の差分ビルド用）
npm run build:review-request   # = vp build --config vite.review-request.config.ts

# ファイル変更で自動再ビルド（review.html 側のみ）
npm run build:watch # = vp build --watch

# HMR 付き dev サーバー（編集体験を上げたい時のみ）
npm run dev         # = vp dev

# テスト実行
npm test            # = vp test
```

`npm run build` 後に `dist/review.html` と `dist/review-request.mjs` の両方が再生成される。ソースと生成物の同期は人手 + 任意で pre-commit hook で担保する。`dist/review-request.mjs` は実行時に同ディレクトリの `dist/review.html` を読み込むため、両者は常に揃った状態で commit する。

### テスト

主要な TypeScript ソースは in-source testing を使い、`vite.config.ts` の `test.includeSource` に登録する。`npm test`（= `vp test`）で実行される。

現在の主な対象：

- `app/review.ts`：state 依存の小さな helper とコメント生成
- `app/boot.ts`：起動 helper、埋め込み markdown / feedback の読み込み
- `app/app-state.ts`：Write feedback.json の dirty 追跡 (isFeedbackDirty / markFeedback\*)
- `app/mark-engine.ts`：state.comments のグルーピングと startOffset 降順ソート
- `app/selection.ts`：保存 offset とテキストセグメントの対応
- `app/sidebar.ts`：コメントカード HTML と DOM 順ソート
- `app/toolbar.ts`：ファイル選択 helper
- `app/comment-modal.ts`：保留中の選択範囲と本文から `Comment` を組み立てる純粋ヘルパ
- `app/floater.ts`：選択範囲から floater payload を作る + rect → floater 位置の計算
- `app/workspace.ts`：`feedback.json` 書き出しと filename 解決
- `app/workspace-fs.ts`：FS Access API の handle type guard / 権限確認 / IDB fail-soft
- `app/scroll.ts`：固定 duration scroll の easing
- `core/escape.ts`：5 文字 (`& < > " '`) を HTML 実体参照に置換 (XSS 防御)
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
- 配布物 `dist/review.html` は **起動に必要なものをすべて内包し、外部依存ゼロ** で動作する

### HTML minify 無効維持と CI スモークテスト指針

review-request CLI は `dist/review.html` の `<script id="embedded-md" type="text/markdown">` を正規表現で書き換える方式を採っているため、HTML minify を有効化して属性順や空白を変えると `core/embed.ts` の `EMBEDDED_MD_RE` (`id="embedded-md"` と `type="text/markdown"` の両方を lookahead で要求) が脆くなる。属性順の揺らぎは lookahead で吸収しているが、属性自体が削除される minify は救済できない。**HTML minify は将来も無効のまま維持する** ことで、CLI 側の保守コストを増やさずに rewrite の安定性を確保する。

将来 CI を強化する場合は、ビルド後の `dist/review.html` に **`id="embedded-md"` と `type="text/markdown"` を併せ持つ `<script>` タグが含まれていること** をスモークテストで検査するのが望ましい（`core/embed.ts` の前提を守るため）。現状は in-source test が `dist/review.html` の構造を直接検査していないため、配布前の手作業確認に依存している。

### 開発者の責務

1. ソースは `src/` 配下（`cli/` / `app/` / `core/` / `styles/` / `review.html`）のみを編集する
2. ビルド出力（`dist/review.html` / `dist/review-request.mjs`）は **手で編集しない**（次の `vp build` で上書きされる）
3. commit 前に `npm run build` を実行し、ソースと両方の出力をコミットする
4. 設計変更を伴う場合は本ドキュメント（§4 / §13 / §14）も更新する

### エンドユーザーの責務

なし。`dist/review.html` をブラウザで開くだけ。配布者が markdown を埋め込みたい場合は `node dist/review-request.mjs <input.md> [output-dir]` を使う（§3 入力 2 / §8 ファイル命名規約 参照）。

---

## 14. ファイル構成

ソース（`src/`）と生成物（`dist/`）を明確に分離している。`src/` 配下を編集し、`npm run build` で `dist/review.html` と `dist/review-request.mjs` の両方を再生成する。

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
│   │       │   └── <aside class="sidebar">  コメント一覧 (Conversation)
│   │       ├── #floater                                 「＋ Comment」ボタン
│   │       ├── #modal                                   コメント入力ダイアログ
│   │       ├── #toast                                   一時的なステータス通知
│   │       └── <script type="module" src="./app/review.ts">  ← Vite が bundle して inline
│   ├── styles/              ─── スタイル ───────────────────────────────
│   │   ├── review.css       全体スタイル (toolbar / modal / sidebar / floater / button 等)
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
│   │   └── types.ts         モジュール間で共有する JSON / コメント型
│   ├── app/                 ─── Browser DOM / API 専用 ─────────────────
│   │   ├── review.ts        DOM エントリ、event wiring、loadFromMarkdown orchestrator
│   │   ├── boot.ts          起動順序（workspace handle 復元 / embedded）
│   │   ├── app-state.ts     state 単一の真の源 + Write feedback.json の dirty 追跡
│   │   ├── dom-utils.ts     qs / qsInput / uid / toast
│   │   ├── mark-engine.ts   state.comments → <mark class="cmt"> の再適用エンジン
│   │   ├── doc-renderer.ts  markdown を HTML 化して #doc に流し込む + blockAnchors 再構築
│   │   ├── selection.ts     選択範囲 → blockId / text offsets / DOM Range
│   │   ├── sidebar.ts       コメント一覧、カード描画、mark / card のアクティブ状態
│   │   ├── toolbar.ts       Open / Export / Copy / Clear の toolbar 配線
│   │   ├── comment-modal.ts コメント入力モーダルの状態管理・保存処理・floater との配線
│   │   ├── floater.ts       選択範囲追従の「＋ Comment」フローター
│   │   ├── menu.ts          ドロップダウンメニュー (Comments ▾ / Send ▾) 共通コントローラ
│   │   ├── dialog.ts        確認・通知モーダル
│   │   ├── scroll.ts        固定 duration smooth scroll
│   │   ├── storage.ts       IndexedDB の薄いラッパ（`workspace-handle` 永続化専用）
│   │   ├── workspace.ts     File System Access API 連携の orchestrator
│   │   │                     (writeFeedback / changeOutputFolder / restoreWorkspaceHandle)
│   │   └── workspace-fs.ts  FS Access API 型 + handle lifecycle (picker / permission / IDB)
│   └── cli/                 ─── Node CLI (dist/review-request.mjs のソース) ──
│       ├── review-request.ts CLI エントリ (`dist/review-request.mjs` のエントリ)。core/embed を呼んで
│       │                     <input.md> (または stdin) から `<mdFileName>-<docHash>-review.html` を
│       │                     指定ディレクトリ (省略時は input.md と同じ場所、stdin 時は cwd) に生成し、
│       │                     既定で標準ブラウザを起動する shebang 付きスクリプト
│       ├── parse-args.ts    引数パース (`--no-open` / `--document-name` / `-h|--help` / stdin token `-`) +
│       │                     HELP_TEXT + sanitizeMdFileName
│       ├── input-source.ts  stdin / file 入力の解決
│       ├── open-command.ts  OS / `$BROWSER` 別のブラウザ起動コマンド + VS Code Remote 環境判定
│       └── serve.ts         `$BROWSER` が file:// を扱えない環境向け軽量 HTTP サーバー (port 51729 デフォルト)
├── dist/                    ─── 生成物（commit 対象、編集禁止） ──────────
│   ├── review.html          ★ `npm run build` の出力。JS / CSS / npm 依存（marked）
│   │                         がすべて inline。外部依存ゼロのエンドユーザー配布物
│   └── review-request.mjs   ★ `npm run build:review-request` の出力。Node 20+ で実行可能な
│                             配布者向け review-request CLI。実行時に同ディレクトリの
│                             review.html を読み込むため両者は揃った状態で commit する
└── docs/
    └── DESIGN.md            本ドキュメント
```

ソース（`src/review.html` + `src/styles/*.css` + `src/{cli,app,core}/*.ts` + `vite.config.ts`）と出力（`dist/review.html`）はいずれも commit 対象。生成物を commit するのは、clone 直後の利用者が `vp build` を実行せずにそのままブラウザで開けるようにし、npm publish 時にも `dist/` が必ず含まれるようにするため。

### 編集ルール

- 編集対象は `src/` 配下のみ（`review.html` / `styles/*.css` / `cli/*.ts` / `app/*.ts` / `core/*.ts`）。`dist/review.html` および `dist/review-request.mjs` は `vp build` で都度上書きされるため手で直さない
- ソースの編集後は `vp build` でビルドし、両ファイルを commit する
