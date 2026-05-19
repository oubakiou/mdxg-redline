# mdxg-redline 設計ドキュメント

このドキュメントは `mdxg-redline` の設計意図・構成・割り切りを記録する。仕様変更・監査・他実装との比較検討時の参照資料とする。

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
12. [既知の制約](#12-既知の制約)
13. [MDXG 準拠ロードマップ・今後の拡張](#13-mdxg-準拠ロードマップ今後の拡張)
14. [ビルドパイプライン](#14-ビルドパイプライン)
15. [ファイル構成](#15-ファイル構成)

## 1. 概要

`mdxg-redline` は、レビュワー（人間）がブラウザで以下を行うためのツール：

1. markdown 文書をブラウザに読み込む
2. 任意のテキスト範囲をハイライトしてコメントを付ける
3. 結果を構造化 JSON として出力し、LLM エージェントに渡す

エンドユーザーには **単一 HTML ファイル**（`dist/review.html`）を配布するだけで動く。サーバー不要・別ファイル不要・追加インストール不要。

開発時のみ TypeScript ソースと Vite ツールチェーン（`npm run build`）を使い、CSS/JS をすべて inline した単一 HTML にビルドする。エンドユーザーには TS/Vite の存在は見えない。詳細は §14。

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

| 制約                                                                                | 影響                                                                                                          |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| ブラウザのみ、バックエンドなし                                                      | 状態はすべてブラウザストレージかローカルファイル                                                              |
| エンドユーザーには単一 HTML ファイルとして配布                                      | CSS / JS / npm 依存（`marked`）をすべて Vite が bundle・inline。CDN 参照なしで完全オフライン動作              |
| `file://` と各種 `https://` の両方で動作                                            | ストレージ層が透過的にフォールバック                                                                          |
| LLM がコンテンツ事前読み込みで起動できること                                        | 複数の注入経路（埋め込み・URL ハッシュ・ファイル監視）。URL ハッシュは Base64URL を推奨                       |
| フィードバックは機械可読                                                            | 位置情報を持つ安定参照を含む JSON 出力                                                                        |
| レビュー対象 markdown は信頼済みとは限らない                                        | markdown 内の raw HTML は実行せず、文字として escape 表示する                                                 |
| 開発時のみ Vite+ (vp) ツールチェーンを使用（`vite-plugin-singlefile` で 1 HTML 化） | TypeScript + 外部 CSS で開発、`vp build` で `dist/review.html` を再生成。配布時は JS / CSS とも inline される |

---

## 3. ユーザーフロー

markdown をページに入れる方法が 4 つ、フィードバックを取り出す方法が 3 つあり、自由に組み合わせ可能。

### 入力

markdown を画面に乗せる経路は 4 つ。それぞれ「誰が markdown を持ち込むか」と「ループに必要なブラウザ機能」が異なる。起動時の優先順位は §9 を参照。

#### 1. ファイル選択

`Open file` ボタンを押すと OS のファイルダイアログが開き、選んだローカル `*.md` を読み込む（実装は `toolbar.ts` の隠し `<input type="file">` 経由）。最小限の前提しかなく、すべてのモダンブラウザで動く一番素直な経路。

- **想定ユースケース**: エージェントループを組まずに、手元の 1 ファイルを単発レビューしたい場合
- **ファイル名の扱い**: 選択時のファイル名がそのまま `state.docName` となり、export 時の JSON `document` フィールド・ダウンロード時の既定ファイル名に反映される
- **再選択時の挙動**: 同じ内容（同一 `docHash`）であれば IndexedDB に残っている過去のコメントが復元される。本文が 1 文字でも変われば別 `docHash` となり、コメントは前バージョンの下に保存されたまま画面には出ない（§6 のアンカリング契約による）
- **権限**: 一時的な読み取りのみ。File System Access API のような書き戻し権限は要求しない

#### 2. 埋め込み

配布者が HTML を共有する前に、`<script id="embedded-md" type="text/markdown">…</script>` ブロックに markdown を直接書き込んでおく方式。受け取った側は HTML をダブルクリックするだけで本文が表示される。`<script>` の `type` が module ではないため、Vite の bundle 対象から外れ、HTML 内に書いた内容がそのまま残る。

- **想定ユースケース**: クライアントへの納品物、固定文書のレビュー依頼、過去レビューのアーカイブ用スナップショット。「1 つの HTML を送れば全部入り」という配布形態を作りたい場合
- **コメントの同梱**: 任意で `<script id="embedded-feedback" type="application/json">` ブロックに既存のコメント配列を入れておくと、起動時に型ガード（`feedback.ts`）を通って取り込まれる。不正なら静かに無視される
- **エスケープ要件**: 本文中に `</script>` 文字列が現れると script タグが途中終了してしまう。配布者側で `<\/script>` の形にエスケープして埋め込む必要がある（§12 既知の制約）
- **書き換え方法**: 配布者は次の 2 つから選べる。
  - **CLI 経由（推奨）**: `node dist/embed.mjs <input.md> [output-dir]` で markdown を読み込み、`<script id="embedded-md">` の中身と `data-name` 属性を書き換えた HTML を生成する。出力ファイル名は §8 の[ファイル命名規約](#ファイル命名規約)に従って `<mdFileName>-<docHash>-review.html` の形で自動決定される（`mdFileName` は入力 MD の拡張子を除いた basename、`docHash` は本文 SHA-256 の先頭 16 桁 hex）。`output-dir` を省略した場合は入力 MD と同じディレクトリに出力される。`</script>` の自動エスケープと属性エスケープも CLI 側で適用される。実装は `src/embed.ts`（Node CLI ラッパー）+ `src/embed-core.ts`（pure ロジック）で、後者はブラウザ側からも再利用できる
  - **手作業**: テキストエディタで `dist/review.html` を開き、`<script id="embedded-md">` ブロックの中身を直接差し替える。本文中の `</script>` を自分で `<\/script>` にエスケープする必要がある。ファイル名はワークスペース連携と併用する場合に限り §8 の規約に従うこと
  - 起動 UX を `npx mdxg-redline` 一発に短縮する拡張案は §13 の `npx` 拡張候補を参照

#### 3. URL ハッシュ

URL の `#md=<base64url>&name=<optional>` 部分に markdown を Base64URL エンコードして乗せる方式。チャット・メール・チケットなどに 1 本の URL として貼って共有できる。

- **想定ユースケース**: 中程度までの文書のレビュー依頼を URL 一発で投げたい時。共通の `dist/review.html` を社内 https に置いてランディング URL として配るパターンも成立する
- **プライバシー**: URL のフラグメント（`#` 以降）は HTTP 仕様上サーバーに送信されないため、`https://` でホスティングしていても markdown 本文はサーバー側ログ・プロキシ・CDN に残らない（共有先のチャットサービスにはもちろん本文が渡る点には注意）
- **エンコーディング**: 生の markdown は `#` / `&` / `%` などが URL を壊すため、Base64URL（`+` → `-`、`/` → `_`、padding 省略）で包む。デコードは `atob` → `Uint8Array` → `TextDecoder('utf-8')` の経路で行い、廃止された `escape` / `unescape` を経由しないため日本語含む UTF-8 も安全に復元できる
- **サイズ制限**: ブラウザによって URL 長の上限が異なり、実用上は 8 KB 程度が安全圏。それを超える文書では埋め込み方式かワークスペース監視に切り替える
- **ファイル名**: `&name=spec.md` を併記すると `state.docName` に反映される。省略時は `shared.md`

#### 4. ワークスペース監視

ユーザーが選んだローカルディレクトリをブラウザが 2 秒間隔（`WS.POLL_MS`）でポーリングし、`*-<hash>-review.md` パターンに一致するファイルのうち最新のものを検知すると自動でロード、`Submit review` で同じディレクトリに対応する `<mdFileName>-<docHash>-feedback.json` を書き戻す方式。エージェント ↔ 人間のフィードバックループを「ファイルの読み書き」だけで成立させる中核経路。ファイル名規約の詳細は §8 を参照。

- **想定ユースケース**: LLM エージェントが `<name>-<hash>-review.md` を生成 → 人間がインラインコメント → エージェントが対応する `<name>-<hash>-feedback.json` を取り込み → 改訂版 `<name>-<新hash>-review.md` を再生成、という反復ループ。プロトコル詳細は §8
- **必要 API**: `showDirectoryPicker` と `FileSystemDirectoryHandle`。**Chromium 系のみ**（Chrome / Edge / Arc / Brave / Opera）。Safari / Firefox では押した瞬間に「File System Access API 非対応」を伝える説明ダイアログが出る。ボタン自体は常時表示しており、`disabled` にもしない（非対応ブラウザの利用者にも機能の存在を知ってもらうための発見性優先の設計）。一方で `Submit review` ボタンはワークスペース接続中のみ出現する
- **永続化**: 一度選択したディレクトリのハンドルは IndexedDB に直接シリアライズして保存（JSON にできないオブジェクトを IDB が扱える性質を利用）。次回読み込み時はサイレント再開する。ブラウザ再起動などで権限が失効すると `Reconnect · フォルダ名` ボタンが現れ、ユーザー操作で再取得
- **未送信作業の保護**: 現バージョンにコメントが付いている状態で別の `docHash` を持つ `*-review.md` が現れると、確認ダイアログでロード可否を問う。同じハッシュを一度拒否したら、別ハッシュに変わるまで再確認しない（§8 安全装置）
- **多重起動の防止**: ポーリングは開始時に必ず一度 stop してから start し直し、複数タイマーが走らないようにしている

### 出力

1. **Copy as JSON** — クリップボードへコピー、チャットへの貼り付け用（`Comments ▾` メニュー内）
2. **Export as JSON** — ファイルダウンロード、チャット添付やアーカイブ用（`Comments ▾` メニュー内）
3. **Submit review** — 監視中のワークスペースに `<mdFileName>-<docHash>-feedback.json` を書き込む（プライマリボタン、Watch folder 接続中のみ表示。命名規約は §8 参照）

### 標準ループ（ワークスペースモード）

```
┌─────────────┐ <name>-<hash>-review.md  ┌──────────────┐
│ エージェント ├─────────────────────────►│  ブラウザ    │
│  (LLM)      │                          │ (mdxg-redline)│
│             │◄─────────────────────────┤              │
└─────────────┘ <name>-<hash>-feedback.json └────────────┘
       ▲                                      │
       └────── 共有ワークスペース ────────────┘
```

`<name>` は元 MD の拡張子を除いた basename、`<hash>` は MD 本文 SHA-256 の先頭 16 桁 hex。同じ `<name>` で本文を改訂するたびに `<hash>` だけが変わり、新旧ペアがファイル名で分離される。

---

## 4. アーキテクチャ

3 層の関心事を持つ単一 HTML ドキュメント（ランタイム）。ビルド側の構成は §14 を参照。

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
│   CSS は src/review.css を Vite が CSS bundle 化)              │
│    - markdown レンダリング (marked、raw HTML は escape)         │
│    - コメントアンカリング (block id + テキストオフセット)      │
│    - 選択範囲 → Range → オフセット変換                         │
│    - 再描画後の <mark> 再適用                                  │
│    - 固定 duration smooth scroll (距離非依存)                  │
├───────────────────────────────────────────────────────────────┤
│  永続化層                                                      │
│    - Store (IndexedDB ベース)                                  │
│    - Workspace (File System Access API)                       │
└───────────────────────────────────────────────────────────────┘
```

ランタイム外部依存：**なし**。配布物は CDN 参照を持たず、ネットワーク到達性ゼロで動作する。

bundle される npm 依存（ビルド時に `<script>` として inline）：

- **marked**（markdown → HTML）

スタイリングは `src/review.css` に集約し、レイアウト用の意味的クラスとコンポーネントクラスを自前で定義する。フォントは OS のシステムフォント（`-apple-system, BlinkMacSystemFont, 'Segoe UI', ui-monospace, …`）を参照し、Web フォントは使用しない。

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
  docHash:           string             // SHA-256(markdown) の先頭 8 バイト（16 桁 hex）
  docName:           string             // ファイル名または "review.md"
  markdown:          string             // 原文
  comments:          Comment[]
  blockOriginalHTML: Map<blockId, string>  // 再レンダリング用の元 HTML
}
```

### 永続化レコード（ドキュメントごと）

ストレージキー `doc:<docHash>` の下に保存：

```ts
{
  name:     string
  markdown: string
  comments: Comment[]
  updated:  string  // ISO 8601
}
```

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

2 つの永続化メカニズムを優先順で使い分け：

### a. IndexedDB

`Store` 抽象がブラウザ標準の IndexedDB（`margin-notes` DB、`kv` ストア）を使う。`doc:<hash>` レコードと `workspace-handle` の両方を同じキースペースに格納する。`file://` でも各種 `https://` でも同じように動作する。

### b. File System Access API（ワークスペースモード）

ファイル監視プロトコル用。`showDirectoryPicker()` が返す `FileSystemDirectoryHandle` 自体を IndexedDB に保存（JSON と違い、ハンドルは IDB に直接シリアライズ可能）。再読み込み時：

1. ハンドルを取得
2. `handle.queryPermission({ mode: 'readwrite' })` で権限を確認
3. `granted` → ポーリングを静かに再開
4. `prompt` → ツールバーに `Reconnect · フォルダ名` と表示、ユーザー操作を待って再要求

---

## 8. ワークスペースプロトコル

ワークスペースモード時の、ブラウザとエージェント間の契約：

| ファイル                                           | 方向                | 書き手              | 読み手                           |
| -------------------------------------------------- | ------------------- | ------------------- | -------------------------------- |
| `<workspace>/<mdFileName>-<docHash>-review.md`     | エージェント → 人間 | エージェント        | ブラウザ（2 秒ごとにポーリング） |
| `<workspace>/<mdFileName>-<docHash>-feedback.json` | 人間 → エージェント | ブラウザ（Send 時） | エージェント                     |

ワークスペースディレクトリの場所はユーザーが任意に決めてよい。例えば `~/reviews/` でも `./tmp/` でも構わない。

### ファイル命名規約

ワークスペース連携・embed CLI 配布フローを通じて、すべてのレビューパッケージはこの命名規約に従う：

```
<mdFileName>-<docHash>-review.md     (エージェントが書く本文)
<mdFileName>-<docHash>-review.html   (embed CLI が出力する配布用 HTML)
<mdFileName>-<docHash>-feedback.json (ブラウザが書き出す回収パッケージ)
```

- **`mdFileName`**: 元 MD ファイルの basename から `.md` / `.markdown` 拡張子を除いたもの。サニタイズはしない（スペース・日本語・記号もそのまま）。例：元ファイルが `仕様書 v2.md` なら `mdFileName = "仕様書 v2"`
- **`docHash`**: 元 MD 本文 UTF-8 バイト列の SHA-256 の先頭 8 バイトを hex で表現した 16 文字の文字列。`shasum -a 256 <input.md> | cut -c1-16` で再計算できる。§5 のエクスポート JSON に含まれる `docHash` と同一値で、ファイル名から取り出しても JSON 本文から取り出しても同じものが得られる（ファイル名は配置時の自己記述性、JSON は単体取り出し時の自己記述性を担う）
- **責務**: ファイル名の生成責務は書き手側にある。エージェントは `review.md` を書く前に、ブラウザは `feedback.json` を書く前に、それぞれ自身が扱っている MD 本文の SHA-256 を計算してファイル名を決める
- **拡張子で識別**: 同一の `<mdFileName>-<docHash>-` プレフィックスを共有するファイルが「同じレビュー対象に対する review / feedback ペア」となる。エージェントは `.md` を書く → 対応する `.json` を待つ → 取り込む、を `docHash` 単位で機械的に対応付けられる

これにより、Open File で別の MD を開いた状態で `Submit review` を押しても、出力ファイル名は新しい MD の hash で決まるため、元の review.md に対応する feedback.json を誤って上書きすることがない（誤爆問題の構造的解消）。

### ライフサイクル

1. ユーザーが `Watch folder` でワークスペースディレクトリを選択（一度きりの操作、永続化される）
2. ブラウザが `*-review.md` パターンのファイルを 2 秒間隔でポーリング
3. エージェントが `<mdFileName>-<docHash>-review.md` を書き込む
4. ブラウザがディレクトリ内の `*-review.md` 群から最新のものを検出（mtime ベース）。`docHash` が前回採用したものと異なれば新しいドキュメントとしてレンダリング。**古いコメントは画面から消える**（前の `docHash` の下に保存はされ続けるが、画面には出ない）
5. ユーザーがインラインコメントを追加
6. ユーザーが `Submit review` をクリック → 同じ `mdFileName` と現在の `state.docHash` で `<mdFileName>-<docHash>-feedback.json` が書き込まれる
7. エージェントが対応する `feedback.json`（自身が書いた `review.md` と同じ `mdFileName`-`docHash` プレフィックスのもの）を読み、処理し、必要に応じて改訂版 `<mdFileName>-<新docHash>-review.md` を書く → ループ継続

### 古いファイルの扱い

- ラウンドを重ねると `<name>-<hash1>-review.md`, `<name>-<hash2>-review.md`, ... と複数のファイルが Watch folder に残り得る。ブラウザは常に mtime 最新のものを採用するだけで、古いファイルの削除は行わない（書き込み副作用は最小に保つ）
- 古いファイルの整理はユーザーまたはエージェントの責務。エージェントが書いた `review.md` を取り込み済みで feedback も回収済みなら、エージェントがクリーンアップしてもよい

### 安全装置

- **未送信作業の保護**：現在のバージョンにコメントが付いている状態で新しい `*-review.md` が現れると、確認ダイアログで読み込むか確認。同じ `docHash` を一度拒否した場合は再確認せず、別 hash に変わった時だけ再確認
- **初回ロードはスキップ**：初回の `wsLastHash === null` ではこのチェックを通過
- **権限の失効**：ポーリングで `NotAllowedError` が出た場合、監視ループを停止し、UI を「Reconnect」状態へ戻す
- **ファイル未存在**：ディレクトリに `*-review.md` が一つもなければ静かに待機、ループは継続
- **複数候補の同 mtime**：複数の `*-review.md` が完全に同一 mtime の場合はファイル名昇順で安定化（再現性のため）

### 設定値

定数は一箇所にまとまっている：

```ts
const WS = {
  INPUT_PATTERN: /-([0-9a-f]{16})-review\.md$/, // ファイル名から hash を抽出する
  OUTPUT_SUFFIX: '-feedback.json', // 書き出し時は <mdFileName>-<docHash> に連結
  POLL_MS: 2000,
}
```

---

## 9. 起動シーケンス

ページロード時に以下の優先順チェーンを実行。ワークスペース復元は先に試すが、`*-review.md` の読み込みはポーリングで遅延することがあるため、それだけでは後続の入力経路を止めない。埋め込み・URL hash・既存 state・直近セッション復元のいずれかで本文が確定した時点で終了する。

```
1. IndexedDB から過去のワークスペースハンドルをサイレント復元
   └─ 権限が残っていればポーリング開始
      └─ ディレクトリ内に `*-review.md` が存在すれば
         最新の mtime のものを最初のポーリングでロード

2. 埋め込み markdown (<script id="embedded-md">)
   └─ ロード。<script id="embedded-feedback"> があれば併せて適用

3. URL ハッシュ (#md=<base64url>&name=<optional>)
   └─ デコードしてロード

4. ステップ 1 でワークスペースが何かロード済みならここで終了

5. Store から最終更新のドキュメントを復元
   └─ 「タブを閉じて再度開く」用途

6. 空状態を表示してファイル選択を待つ
```

---

## 10. ブラウザ互換性

| 機能                                                | 必須                     | 対応ブラウザ                                   |
| --------------------------------------------------- | ------------------------ | ---------------------------------------------- |
| 基本レンダリング、コメント、コピー / エクスポート   | 必須                     | すべてのモダンブラウザ                         |
| IndexedDB                                           | 推奨                     | すべてのモダンブラウザ                         |
| `navigator.clipboard.writeText`                     | 推奨                     | すべてのモダンブラウザ（HTTPS または file://） |
| `showDirectoryPicker` + `FileSystemDirectoryHandle` | ワークスペースモードのみ | Chromium 系（Chrome, Edge, Arc, Brave, Opera） |

Safari と Firefox はファイル選択・埋め込み・URL ハッシュ・コピー / エクスポートのフローは使えるが、**ワークスペースモードは利用不可**。

---

## 11. セキュリティとプライバシー

- ネットワーク通信は発生しない。すべての依存（`marked`、スタイル、フォント指定）が単一 HTML 内に inline / システムフォント参照されており、起動後の外部リクエストはゼロ
- markdown 内の raw HTML は renderer 層で escape し、`<script>` や event handler を DOM として実行しない。フェンス付きコードブロック内の HTML 例は通常どおりコードとして表示する
- embedded feedback の `comments[]` は型ガードを通し、不正なコメント要素は除外する
- markdown の内容は、ユーザーが明示的に `Export as JSON` / `Copy as JSON` / `Submit review` のいずれかを押さない限りブラウザ外に出ない
- ワークスペース権限は選択したディレクトリにスコープされる。ページが任意のディスクの場所にアクセスすることはない
- IndexedDB はオリジン単位。別のパスやオリジンで開けば新しい状態になる
- ビルドパイプラインは開発者ローカルでのみ動作。配布物 `dist/review.html` 自体はビルド成果物としてリポジトリにコミットされており、エンドユーザー環境にはツールチェーンを持ち込まない

---

## 12. 既知の制約

| 制約                                                  | 備考                                                |
| ----------------------------------------------------- | --------------------------------------------------- |
| 原文編集でコメントが残らない                          | 仕様。新しい `docHash` は新しいセットとして扱う     |
| ブロックをまたぐ選択は不可                            | 選択フローター自体が表示されない                    |
| 2 秒のポーリング                                      | ブラウザにファイル監視 API がないためのトレードオフ |
| ディレクトリ削除で監視ハンドルが失効                  | 再度フォルダ選択が必要                              |
| 埋め込み markdown 内の `</script>` がタグを終了させる | `<\/script>` とエスケープする必要あり               |
| 同時に 1 ワークスペースのみ                           | 切り替えるには再接続                                |
| raw HTML はレンダリングされない                       | セキュリティ優先。HTML 例はコードブロックに書く     |

---

## 13. MDXG 準拠ロードマップ・今後の拡張

### MDXG 準拠

[Markdown Experience Guidelines (MDXG)](https://github.com/vercel-labs/mdxg) のレビュワー観点機能を段階的に取り込む。現状の準拠状況：

| MDXG セクション          | 必須レベル    | 現状                                                |
| ------------------------ | ------------- | --------------------------------------------------- |
| §1 Theming               | MUST (Viewer) | 部分（DADS テーマ。host theme 追従は未実装）        |
| §2 Code Block Rendering  | MUST (Viewer) | 部分（コピー button・シンタックスハイライト未実装） |
| §3 Task Lists            | MUST (Viewer) | marked デフォルト                                   |
| §4 Images / §5 Tables    | MUST (Viewer) | marked デフォルト                                   |
| §6 Virtual Pages         | MUST (Viewer) | 未対応（コメントモデルとの統合設計が必要）          |
| §7 Page Navigation       | MUST (Viewer) | 未対応                                              |
| §8 Page Outline          | MUST (Viewer) | 未対応                                              |
| §9 Sequential Navigation | MUST (Viewer) | 未対応                                              |
| §10 Search               | MUST (Viewer) | 未対応                                              |
| §13 Keyboard Navigation  | MUST (Viewer) | 部分                                                |

優先順序：

1. **§2 コピー button + シンタックスハイライト** — 既存 renderer の差し替えで対応可能
2. **§1 host theme adaptation** — `prefers-color-scheme` 対応とトークン整理
3. **§13 キーボードナビゲーション補強**
4. **§6 / §7 / §8 / §9 Virtual Pages 系** — UI モデルの根本見直し。インラインコメントとの統合設計が前提
5. **§10 Search** — Virtual Pages 統合後

### その他の拡張候補

- **型境界の共有強化**：`feedback.ts` の外部 JSON ガードと各 UI モジュールのローカル DOM 型を保ちつつ、将来は共通型の重複を減らす
- **複数ブロック選択への対応**：ブロック境界をまたぐコメント（ブロックごとに切り出して各部分を包む）
- **コメントのスレッド化**：返信、解決済み状態
- **注釈付き markdown エクスポート**：JSON より散文を好むエージェント向けに、本文中に `> 💬` 形式で埋め込む代替出力
- **差分ビュー**：連続する `<name>-<hash>-review.md` バージョン間の変更を表示
- **UI からファイル名を設定**：コード定数ではなく
- **ネイティブなファイル変更通知**：オプションの CLI コンパニオン（30 行程度の Node WebSocket サーバーなど）で重ワークフロー時のサブ秒応答
- **`npx` でブラウザ自動起動 (`file://` 直接オープン方式)**：起動 UX を `npx mdxg-redline` 一発に短縮する。バックエンド不要・依存最小の構成として `file://` 直接オープンを採用する。詳細計画は `docs/NPX_CLI_PLAN.md` を参照
  - **Phase 1（実装済み）**：埋め込みコアは `src/embed-core.ts`（pure）+ `src/embed.ts`（Node CLI）として実装され、`dist/embed.mjs` に SSR ビルドされる。`node dist/embed.mjs <input.md> [output-dir]` で markdown を埋め込んだ HTML を生成する。出力ファイル名は §8 のファイル命名規約に従って `<mdFileName>-<docHash>-review.html` に自動決定される
  - **Phase 2（未実装）**：`package.json` に `bin: { "mdxg-redline": "dist/embed.mjs" }` を追加して `npx mdxg-redline` で実行可能にする。一時 HTML を `os.tmpdir()/mdxg-redline/` に生成し、`open` パッケージなしで `execFile('open' | 'xdg-open' | cmd start)` でブラウザを起動する。`--print-temp-path` / `--document-name` / stdin 入力なども追加（詳細は NPX_CLI_PLAN.md §6）
  - **配布物への影響**：`dist/embed.mjs` の追加のみで、配布物 `dist/review.html` 側には影響しない

---

## 14. ビルドパイプライン

エンドユーザーには単一 HTML を配布するが、開発者は TypeScript で書く。両者の橋渡しが [Vite+ (vp)](https://viteplus.dev/) ベースのビルドパイプライン。vp は Vite 8 + Rolldown + vitest を統合し、`vp build` / `vp dev` / `vp test` の単一 CLI として提供する。

### 全体像

ビルドの出口は 2 つ。エンドユーザー配布物の `dist/review.html` と、配布者向け CLI ツールの `dist/embed.mjs`。

```
[ 開発者ローカル ]                                          [ 配布 ]

src/*.ts (TypeScript) ───────┐
                              │
src/review.css (Stylesheet) ──┤
                              │   vp build (vite.config.ts)
src/review.html (Vite エントリ) ─┼─►  vite + Rolldown   ─►  dist/review.html
                              │   + viteSingleFile         (単一 HTML、
vite.config.ts ───────────────┘                            CSS/JS inline)

src/embed.ts (Node CLI) ──────┐
                              │   vp build --config vite.embed.config.ts
src/embed-core.ts (pure) ─────┼─►  vite + Rolldown   ─►  dist/embed.mjs
                              │   (SSR mode、Node ESM)     (Node 実行可能、
vite.embed.config.ts ─────────┘                            shebang 付き)
```

### ビルドの責務分担

**review.html 用（`vite.config.ts`）**

| レイヤー                    | ツール                 | 役割                                                                                                                                                                                         |
| --------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript 型チェック・変換 | `tsc`（vite 経由）     | TS → JS 変換、型エラー検出                                                                                                                                                                   |
| バンドル                    | Rolldown（Vite 内蔵）  | `src/review.ts` を入口に `boot` / `workspace` / `markdown` / `feedback` / `selection` / `sidebar` / `toolbar` / `review-export` 等のグラフ + npm 依存（`marked`）を 1 つの JS チャンクに統合 |
| HTML 処理                   | Vite                   | `<script type="module" src="./review.ts">` および `<link rel="stylesheet" href="./review.css">`（src 内相対）を bundle 結果への参照に書き換え                                                |
| CSS bundle                  | Vite                   | `src/review.css` を CSS チャンクに統合                                                                                                                                                       |
| inline 化                   | vite-plugin-singlefile | bundle された JS チャンク・CSS を `<script>` / `<style>` として HTML 内に inline                                                                                                             |

**embed CLI 用（`vite.embed.config.ts`）**

| レイヤー        | ツール                | 役割                                                                                                                            |
| --------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| バンドル        | Rolldown（Vite 内蔵） | `src/embed.ts` を入口に `embed-core.ts` を 1 つの ESM (`dist/embed.mjs`) に統合。Node 組み込みモジュール (`node:*`) は external |
| Node ターゲット | Vite SSR mode         | Node 20+ をターゲットにし、`process` / `fs/promises` / `path` / `url` 等の Node API をそのまま参照する形で出力                  |
| shebang 保持    | Rolldown 標準挙動     | `src/embed.ts` 冒頭の `#!/usr/bin/env node` を出力先に保持し、`chmod +x` 不要で実行可能な状態にする                             |

ランタイム（review.html）は Vite / Rolldown を一切知らない。出力 HTML は通常の `<script>` を含むだけ。`dist/embed.mjs` も Node 標準 ESM として直接実行できる。

### コマンド

devcontainer または `./local_setup.sh` が `npm install` で `vite-plus`（`vp`）を導入し、`vp` コマンドを利用可能にする。

```bash
# 1 回ビルド（commit 前に必ず叩く）。review.html と embed.mjs の両方を生成する。
npm run build       # = vp build && vp build --config vite.embed.config.ts

# embed CLI だけを再ビルド（embed.ts / embed-core.ts を編集中の差分ビルド用）
npm run build:embed # = vp build --config vite.embed.config.ts

# ファイル変更で自動再ビルド（review.html 側のみ）
npm run build:watch # = vp build --watch

# HMR 付き dev サーバー（編集体験を上げたい時のみ）
npm run dev         # = vp dev

# テスト実行
npm test            # = vp test
```

`npm run build` 後に `dist/review.html` と `dist/embed.mjs` の両方が再生成される。ソースと生成物の同期は人手 + 任意で pre-commit hook で担保する。`dist/embed.mjs` は実行時に同ディレクトリの `dist/review.html` を読み込むため、両者は常に揃った状態で commit する。

### テスト

主要な TypeScript ソースは in-source testing を使い、`vite.config.ts` の `test.includeSource` に登録する。`npm test`（= `vp test`）で実行される。

現在の主な対象：

- `review.ts`：state 依存の小さな helper とコメント生成
- `boot.ts`：起動 helper、Base64URL 復号、URL hash 読み込み
- `feedback.ts`：外部 JSON / pending selection の型ガード
- `markdown.ts`：raw HTML escape とコードブロック維持
- `review-export.ts`：feedback JSON payload / ファイル名 / 件数表示
- `selection.ts`：保存 offset とテキストセグメントの対応
- `sidebar.ts`：コメントカード HTML と DOM 順ソート
- `toolbar.ts`：ファイル選択 helper
- `workspace.ts`：reload 確認、polling 多重防止、`feedback.json` 書き出し
- `scroll.ts`：固定 duration scroll の easing
- `embed-core.ts`：`</script>` エスケープ、`data-name` 属性エスケープ、`<script id="embedded-md" type="text/markdown">` の rewrite。Node CLI からもブラウザ側からも再利用できる pure module

### `vite-plugin-singlefile` の挙動

- emit された JS バンドル（自前コード + `marked`）と CSS は `<script>` / `<style>` として HTML 内に inline
- HTML 内に直接書かれた `<script id="embedded-md" type="text/markdown">` や `<script id="embedded-feedback" type="application/json">` は **触られない**（`type` がモジュールではないため Vite の処理対象外）
- `src/review.html` には外部 CDN への `<link>` / `<script src="https://...">` を含まない。`<head>` の `<link rel="stylesheet" href="./review.css">` も bundle 結果に inline される
- 配布物 `dist/review.html` は **起動に必要なものをすべて内包し、外部依存ゼロ** で動作する

### 開発者の責務

1. ソースは `src/` 配下（`*.ts` / `review.css` / `review.html`）のみを編集する
2. ビルド出力（`dist/review.html` / `dist/embed.mjs`）は **手で編集しない**（次の `vp build` で上書きされる）
3. commit 前に `npm run build` を実行し、ソースと両方の出力をコミットする
4. 設計変更を伴う場合は本ドキュメント（§4 / §14 / §15）も更新する

### エンドユーザーの責務

なし。`dist/review.html` をブラウザで開くだけ。配布者が markdown を埋め込みたい場合は `node dist/embed.mjs <input.md> [output-dir]` を使う（§3 入力 2 / §8 ファイル命名規約 参照）。

---

## 15. ファイル構成

ソース（`src/`）と生成物（`dist/`）を明確に分離している。`src/` 配下を編集し、`npm run build` で `dist/review.html` と `dist/embed.mjs` の両方を再生成する。

```
mdxg-redline/
├── README.md                エンドユーザー向けの概要・インストール・使い方
├── LICENSE                  MIT
├── package.json             name / deps / scripts / files / bin (将来) /
│                             scripts.build = "vp build && vp build --config vite.embed.config.ts"
├── tsconfig.json            TypeScript 設定 (DOM lib 追加)
├── vite.config.ts           Vite 設定 (root: 'src', outDir: '../dist', vite-plugin-singlefile,
│                             test.includeSource, fmt/lint の ignorePatterns で dist/ 除外)
├── vite.embed.config.ts     embed CLI 用ビルド設定 (SSR mode、Node 20+、shebang 保持、
│                             node:* を external、出力は dist/embed.mjs)
├── .gitignore
├── src/                     ─── ソース（編集対象） ──────────────────────
│   ├── review.html          Vite エントリ HTML
│   │   ├── <head>
│   │   │   └── <link rel="stylesheet" href="./review.css">  ← Vite が bundle して inline
│   │   └── <body>
│   │       ├── <script id="embedded-md">         注入ポイント（markdown）
│   │       ├── <script id="embedded-feedback">   注入ポイント（JSON）
│   │       ├── <header>                          ツールバー + 状態表示
│   │       ├── <main>
│   │       │   ├── #doc-wrap     空状態
│   │       │   ├── #doc          レンダリング済み markdown
│   │       │   └── aside.sidebar コメント一覧 (Conversation)
│   │       ├── #floater                          「＋ Comment」ボタン
│   │       ├── #modal                            コメント入力ダイアログ
│   │       ├── #toast                            一時的なステータス通知
│   │       └── <script type="module" src="./review.ts">  ← Vite が bundle して inline
│   ├── review.css           スタイル定義
│   ├── review.ts            DOM エントリ、state、文書描画、モーダル、各モジュール配線
│   ├── markdown.ts          marked renderer。raw HTML を escape し、コードブロックは維持
│   ├── feedback.ts          feedback / embedded / pending selection の型ガード
│   ├── selection.ts         選択範囲 → blockId / text offsets / DOM Range
│   ├── sidebar.ts           コメント一覧、カード描画、mark / card のアクティブ状態
│   ├── toolbar.ts           Open / Export / Copy / Clear の toolbar 配線
│   ├── review-export.ts     feedback JSON payload、件数表示、export ファイル名
│   ├── workspace.ts         File System Access API 連携、`*-review.md` ポーリング、
│   │                         `<name>-<hash>-feedback.json` 書き出し
│   ├── boot.ts              起動順序（workspace / embedded / URL hash / restore）
│   ├── storage.ts           Store / IndexedDB 抽象
│   ├── dialog.ts            確認・通知モーダル
│   ├── scroll.ts            固定 duration smooth scroll
│   ├── embed-core.ts        embed CLI の pure ロジック (escape + rewrite + ファイル名規約)。
│   │                         `docHash` (SHA-256 先頭 16 桁 hex) の計算と
│   │                         `<mdFileName>-<docHash>-review.html` の名前生成も担う。
│   │                         Node / browser 両対応で、将来クライアントサイドからも再利用可能
│   ├── embed.ts             Node CLI (`dist/embed.mjs` のエントリ)。embed-core を呼んで
│   │                         <input.md> から `<mdFileName>-<docHash>-review.html` を
│   │                         指定ディレクトリ (省略時は input.md と同じ場所) に生成する
│   │                         shebang 付きスクリプト
│   └── types.ts             モジュール間で共有する JSON / コメント型
├── dist/                    ─── 生成物（commit 対象、編集禁止） ──────────
│   ├── review.html          ★ `npm run build` の出力。JS / CSS / npm 依存（marked）
│   │                         がすべて inline。外部依存ゼロのエンドユーザー配布物
│   └── embed.mjs            ★ `npm run build:embed` の出力。Node 20+ で実行可能な
│                             配布者向け埋め込み CLI。実行時に同ディレクトリの
│                             review.html を読み込むため両者は揃った状態で commit する
└── docs/
    ├── DESIGN.md            本ドキュメント
    └── NPX_CLI_PLAN.md      `npx mdxg-redline` 化に向けた計画書。Phase 1 (embedding core) は
                              dist/embed.mjs として実装済み
```

ソース（`src/review.html` + `src/review.css` + `src/*.ts` + `vite.config.ts`）と出力（`dist/review.html`）はいずれも commit 対象。生成物を commit するのは、clone 直後の利用者が `vp build` を実行せずにそのままブラウザで開けるようにし、npm publish 時にも `dist/` が必ず含まれるようにするため。

### 編集ルール

- 編集対象は `src/` 配下のみ（`review.html` / `review.css` / `*.ts`）。`dist/review.html` は `vp build` で都度上書きされるため手で直さない
- ソースの編集後は `vp build` でビルドし、両ファイルを commit する
