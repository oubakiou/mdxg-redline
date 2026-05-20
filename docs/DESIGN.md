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
| LLM がコンテンツ事前読み込みで起動できること                                        | 複数の注入経路（埋め込み・ファイル選択）                                                                      |
| フィードバックは機械可読                                                            | 位置情報を持つ安定参照を含む JSON 出力                                                                        |
| レビュー対象 markdown は信頼済みとは限らない                                        | markdown 内の raw HTML は実行せず、文字として escape 表示する                                                 |
| 開発時のみ Vite+ (vp) ツールチェーンを使用（`vite-plugin-singlefile` で 1 HTML 化） | TypeScript + 外部 CSS で開発、`vp build` で `dist/review.html` を再生成。配布時は JS / CSS とも inline される |

---

## 3. ユーザーフロー

markdown をページに入れる方法が 2 つ、フィードバックを取り出す方法が 3 つあり、自由に組み合わせ可能。

### 入力

markdown を画面に乗せる経路は 2 つ。それぞれ「誰が markdown を持ち込むか」が異なる。起動時の優先順位は §9 を参照。

#### 1. ファイル選択

`Open file` ボタンを押すと OS のファイルダイアログが開き、選んだローカル `*.md` を読み込む（実装は `toolbar.ts` の隠し `<input type="file">` 経由）。最小限の前提しかなく、すべてのモダンブラウザで動く一番素直な経路。

- **想定ユースケース**: エージェントループを組まずに、手元の 1 ファイルを単発レビューしたい場合
- **ファイル名の扱い**: 選択時のファイル名がそのまま `state.docName` となり、export 時の JSON `document` フィールド・ダウンロード時の既定ファイル名に反映される
- **再選択時の挙動**: 読み込むたびに `state.comments` は空に初期化される。過去ラウンドのコメントを引き継ぎたい場合は、エージェント側で前ラウンドの `*-feedback.json` を `<script id="embedded-feedback">` として同梱した HTML（review-request CLI 経路）で配布する（IndexedDB からの復元は origin 安定性が保証されないため廃止 / §7）
- **権限**: 一時的な読み取りのみ。File System Access API のような書き戻し権限は要求しない

#### 2. 埋め込み

配布者が HTML を共有する前に、`<script id="embedded-md" type="text/markdown">…</script>` ブロックに markdown を直接書き込んでおく方式。受け取った側は HTML をダブルクリックするだけで本文が表示される。`<script>` の `type` が module ではないため、Vite の bundle 対象から外れ、HTML 内に書いた内容がそのまま残る。

- **想定ユースケース**: クライアントへの納品物、固定文書のレビュー依頼、過去レビューのアーカイブ用スナップショット。「1 つの HTML を送れば全部入り」という配布形態を作りたい場合
- **コメントの同梱**: 任意で `<script id="embedded-feedback" type="application/json">` ブロックに既存のコメント配列を入れておくと、起動時に型ガード（`feedback.ts`）を通って取り込まれる。不正なら静かに無視される
- **エスケープ要件**: 本文中に `</script>` 文字列が現れると script タグが途中終了してしまう。配布者側で `<\/script>` の形にエスケープして埋め込む必要がある（§12 既知の制約）
- **書き換え方法**: 配布者は次の 2 つから選べる。
  - **CLI 経由（推奨）**: `node dist/review-request.mjs [--no-open] <input.md> [output-dir]` で markdown を読み込み、`<script id="embedded-md">` の中身と `data-name` 属性を書き換えた HTML を生成する。出力ファイル名は §8 の[ファイル命名規約](#ファイル命名規約)に従って `<mdFileName>-<docHash>-review.html` の形で自動決定される（`mdFileName` は入力 MD の拡張子を除いた basename、`docHash` は本文 SHA-256 の先頭 16 桁 hex）。`output-dir` を省略した場合は入力 MD と同じディレクトリに出力される。`</script>` の自動エスケープと属性エスケープも CLI 側で適用される。実装は `src/review-request.ts`（Node CLI ラッパー）+ `src/embed-core.ts`（pure ロジック）で、後者はブラウザ側からも再利用できる。**生成後、既定では OS の標準ブラウザで自動的に開く**。優先順位は `$BROWSER` 環境変数 → macOS の `open` → Windows の `cmd.exe /c start` → その他 (Linux 等) は `xdg-open`。`$BROWSER` を最優先するのは、VS Code Remote Containers / Codespaces / GitHub Actions などが `$BROWSER` を helper スクリプトに向けて設定する慣習に合わせるためで、`gh` CLI などと同じ動きになる。**VS Code Remote / Codespaces のように `$BROWSER` 経由で `file://` がホスト側ブラウザに届かない環境**（`REMOTE_CONTAINERS=true` / `CODESPACES=true` / `$BROWSER` が `vscode-server/.../helpers/browser.sh` を指す、で判定）では、`127.0.0.1` のデフォルトポート `51729` に軽量 HTTP サーバーを立てて `http://localhost:51729/...` を `$BROWSER` に渡し、ホスト側ブラウザに到達させる。デフォルトポートは環境変数 `MDXG_REDLINE_PORT` で上書きできる。デフォルト or 指定ポートが使用中ならランダムポートへ自動 fallback し、stderr に「ポート X が使用中のため Y を使います。今回は IndexedDB のサイレント復元が効かない可能性があります」と警告する。**固定ポートを採用する理由**: ブラウザ側 IndexedDB の `workspace-handle`（書き出し先フォルダ / §7）は origin（`http://localhost:<port>`）に紐づくため、ポートが毎回変わるとサイレント復元が効かない。デフォルトポート方式により、HTTP モードでも 2 回目以降の起動で同じ origin に着地し `Write feedback.json` の保存先フォルダが picker 無しで復元される（VS Code Remote / Codespaces の `forwardPorts` に固定値を書ける副次的メリットもある）。サーバーは初回リクエスト受信後 10 秒、リクエストが来なければ 60 秒で自動停止し、レスポンスに `Connection: close` を付けて keep-alive で `server.close()` がハングするのを防ぐ。配信は固定 HTML 1 ファイルのみで、リクエストパスは無視されるためパストラバーサルは構造的に発生しない。`--no-open` フラグでこの自動起動 (file パス直渡し / HTTP サーバーモード双方) を抑止できる。ヘッドレス環境などで起動コマンドが失敗しても CLI は exit 0 のまま終了し、stderr に警告を出して stdout の絶対パスから手動で開ける導線を残す
  - **手作業**: テキストエディタで `dist/review.html` を開き、`<script id="embedded-md">` ブロックの中身を直接差し替える。本文中の `</script>` を自分で `<\/script>` にエスケープする必要がある。
  - 起動 UX を `npx mdxg-redline` 一発に短縮する拡張案は §13 の `npx` 拡張候補を参照

### 出力

1. **Copy as JSON** — クリップボードへコピー、チャットへの貼り付け用（`Comments ▾` メニュー内）
2. **Export as JSON** — ファイルダウンロード、チャット添付やアーカイブ用（`Comments ▾` メニュー内）
3. **Write feedback.json** — 選んだローカルフォルダに `<mdFileName>-<docHash>-feedback.json` を書き出す（プライマリ split button、常時表示。命名規約は §8 参照）。初回押下で `showDirectoryPicker()` がフォルダ選択を求め、選んだフォルダの `FileSystemDirectoryHandle` を IndexedDB に永続化する。2 回目以降は picker 無しで同じフォルダに書き出し（HTTP モードではデフォルトポートにより origin が安定するため、別タブや再起動でも復元される）。split button の caret `▾` から `Change output folder…` で書き出し先を切り替えられる。**Chromium 系のみ**（Chrome / Edge / Arc / Brave / Opera）— Safari / Firefox では押した瞬間に「File System Access API 非対応」の説明ダイアログが出る（その場合は Export as JSON / Copy as JSON にフォールバック）

### 標準ループ（エージェント連携モード）

エージェント連携は「review-request CLI でレビュー依頼 HTML を生成 → 人間がブラウザでコメント → Write feedback.json でフォルダに書き出し → エージェントが拾う」という形に統一する。`*-review.md` の自動ポーリングは廃止（旧仕様で担っていた配布責務は review-request CLI に移譲）。

```
┌─────────────┐ review-request CLI       ┌──────────────┐
│ エージェント ├─────────────────────────►│  ブラウザ    │
│  (LLM)      │ <name>-<hash>-review.html│ (mdxg-redline)│
│             │◄─────────────────────────┤              │
└─────────────┘ <name>-<hash>-feedback.json└────────────┘
       ▲                                      │
       └────── 共有フォルダ ──────────────────┘
```

`<name>` は元 MD の拡張子を除いた basename、`<hash>` は MD 本文 SHA-256 の先頭 16 桁 hex。改訂のたびに `<hash>` だけが変わり、新旧ペアがファイル名で分離される（命名規約は §8）。

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
│    - IndexedDB（出力先フォルダハンドル 1 件のみ）              │
│    - File System Access API（feedback.json 書き出し用）         │
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

過去には `doc:<docHash>` キーでドキュメント本文＋コメントを永続化し「タブを閉じて開き直すと続きから」を提供していたが、review-request CLI の HTTP サーバーモードはポートごとに origin が分かれ（デフォルトポート方式でも衝突 fallback 時には origin が動く）、`file://` モードも Firefox / Safari ではファイル単位で origin が分離するため、復元が保証できない。さらにラウンドごとに `docHash` が変わる前提と相まって `doc:<docHash>` レコードは「使い捨ての履歴」として溜まるだけになるため、この用途は廃止した（タブを跨いだコメント保持は `Write feedback.json` で feedback.json を書き出す運用に寄せる）。

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
- **API 非対応ブラウザ**: Safari / Firefox では `Write feedback.json` 押下時に「File System Access API 非対応」の説明ダイアログが出るのみ（Export as JSON / Copy as JSON は引き続き使える）

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

過去には「IDB から最終更新ドキュメント本文も復元」「`*-review.md` ポーリング」「URL ハッシュ (`#md=<base64url>&name=<optional>`) からの読み込み」の起動ステップを持っていたが、§7 に書いたとおり origin 安定性が保証されない / review-request CLI で配布責務を移したため廃止。タブを跨いだ続きの作業は `Write feedback.json` での書き出しと、エージェント側 (CLI) の HTML 再生成に寄せる。

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

- ネットワーク通信は発生しない。すべての依存（`marked`、スタイル、フォント指定）が単一 HTML 内に inline / システムフォント参照されており、起動後の外部リクエストはゼロ
- markdown 内の raw HTML は renderer 層で escape し、`<script>` や event handler を DOM として実行しない。フェンス付きコードブロック内の HTML 例は通常どおりコードとして表示する
- embedded feedback の `comments[]` は型ガードを通し、不正なコメント要素は除外する
- markdown の内容は、ユーザーが明示的に `Export as JSON` / `Copy as JSON` / `Write feedback.json` のいずれかを押さない限りブラウザ外に出ない
- 出力先フォルダの権限は選択したディレクトリにスコープされる。ページが任意のディスクの場所にアクセスすることはない
- IndexedDB の用途は「出力先ディレクトリハンドルの保存」のみ（§7）。コメント本体や本文は IndexedDB に書かない。ハンドルは origin に紐づくため、別のパスやオリジンで開けば再ピッカーが必要になる
- ビルドパイプラインは開発者ローカルでのみ動作。配布物 `dist/review.html` 自体はビルド成果物としてリポジトリにコミットされており、エンドユーザー環境にはツールチェーンを持ち込まない

---

## 12. 既知の制約

| 制約                                                  | 備考                                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------------- |
| 原文編集でコメントが残らない                          | 仕様。新しい `docHash` は新しいセットとして扱う                            |
| ブロックをまたぐ選択は不可                            | 選択フローター自体が表示されない                                           |
| 出力先フォルダ削除でハンドルが失効                    | Write feedback.json 押下時にピッカーへ自動フォールバック                   |
| 埋め込み markdown 内の `</script>` がタグを終了させる | `<\/script>` とエスケープする必要あり                                      |
| 同時に 1 出力先フォルダのみ記憶                       | 切り替えは split button の `Change output folder…` から                    |
| HTTP モードのポート衝突時は origin が変わる           | その回だけ picker が再表示される。`MDXG_REDLINE_PORT` で代替ポートを固定可 |
| raw HTML はレンダリングされない                       | セキュリティ優先。HTML 例はコードブロックに書く                            |

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
- **review-request CLI のブラウザ起動チェーンを Linux でフルセットまで伸ばす**：現状 `buildOpenCommand` は `$BROWSER` → `xdg-open` の 2 段までで、主要 desktop 環境ではこれで通る前提。`gh` CLI 相当の `$BROWSER` → `xdg-open` → `wslview` (WSL) → `sensible-browser` → `x-www-browser` のフルチェーンに拡張すると、最小 Linux イメージや Debian/Ubuntu の特殊構成でも `xdg-open` 欠落時にフォールバックでブラウザが立ち上がる。各候補の存在判定（PATH 探索）と起動成否の判定を分けて実装する必要があり、検証コスト・テストマトリクスが増えるため現状は採用していない

---

## 14. ビルドパイプライン

エンドユーザーには単一 HTML を配布するが、開発者は TypeScript で書く。両者の橋渡しが [Vite+ (vp)](https://viteplus.dev/) ベースのビルドパイプライン。vp は Vite 8 + Rolldown + vitest を統合し、`vp build` / `vp dev` / `vp test` の単一 CLI として提供する。

### 全体像

ビルドの出口は 2 つ。エンドユーザー配布物の `dist/review.html` と、配布者向け CLI ツールの `dist/review-request.mjs`。

```
[ 開発者ローカル ]                                          [ 配布 ]

src/*.ts (TypeScript) ───────┐
                              │
src/review.css (Stylesheet) ──┤
                              │   vp build (vite.config.ts)
src/review.html (Vite エントリ) ─┼─►  vite + Rolldown   ─►  dist/review.html
                              │   + viteSingleFile         (単一 HTML、
vite.config.ts ───────────────┘                            CSS/JS inline)

src/review-request.ts (Node CLI) ──────┐
                              │   vp build --config vite.review-request.config.ts
src/embed-core.ts (pure) ─────┼─►  vite + Rolldown   ─►  dist/review-request.mjs
                              │   (SSR mode、Node ESM)     (Node 実行可能、
vite.review-request.config.ts ─────────┘                            shebang 付き)
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

**review-request CLI 用（`vite.review-request.config.ts`）**

| レイヤー        | ツール                | 役割                                                                                                                                              |
| --------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| バンドル        | Rolldown（Vite 内蔵） | `src/review-request.ts` を入口に `embed-core.ts` を 1 つの ESM (`dist/review-request.mjs`) に統合。Node 組み込みモジュール (`node:*`) は external |
| Node ターゲット | Vite SSR mode         | Node 20+ をターゲットにし、`process` / `fs/promises` / `path` / `url` 等の Node API をそのまま参照する形で出力                                    |
| shebang 保持    | Rolldown 標準挙動     | `src/review-request.ts` 冒頭の `#!/usr/bin/env node` を出力先に保持し、`chmod +x` 不要で実行可能な状態にする                                      |

ランタイム（review.html）は Vite / Rolldown を一切知らない。出力 HTML は通常の `<script>` を含むだけ。`dist/review-request.mjs` も Node 標準 ESM として直接実行できる。

### コマンド

devcontainer または `./local_setup.sh` が `npm install` で `vite-plus`（`vp`）を導入し、`vp` コマンドを利用可能にする。

```bash
# 1 回ビルド（commit 前に必ず叩く）。review.html と review-request.mjs の両方を生成する。
npm run build                  # = vp build && vp build --config vite.review-request.config.ts

# review-request CLI だけを再ビルド（review-request.ts / embed-core.ts を編集中の差分ビルド用）
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

- `review.ts`：state 依存の小さな helper とコメント生成
- `boot.ts`：起動 helper、埋め込み markdown / feedback の読み込み
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

### HTML minify 無効維持と CI スモークテスト指針

review-request CLI は `dist/review.html` の `<script id="embedded-md" type="text/markdown">` を正規表現で書き換える方式を採っているため、HTML minify を有効化して属性順や空白を変えると `embed-core.ts` の `EMBEDDED_MD_RE` (`id="embedded-md"` と `type="text/markdown"` の両方を lookahead で要求) が脆くなる。属性順の揺らぎは lookahead で吸収しているが、属性自体が削除される minify は救済できない。**HTML minify は将来も無効のまま維持する** ことで、CLI 側の保守コストを増やさずに rewrite の安定性を確保する。

将来 CI を強化する場合は、ビルド後の `dist/review.html` に **`id="embedded-md"` と `type="text/markdown"` を併せ持つ `<script>` タグが含まれていること** をスモークテストで検査するのが望ましい（embed-core の前提を守るため）。現状は in-source test が `dist/review.html` の構造を直接検査していないため、配布前の手作業確認に依存している。

### 開発者の責務

1. ソースは `src/` 配下（`*.ts` / `review.css` / `review.html`）のみを編集する
2. ビルド出力（`dist/review.html` / `dist/review-request.mjs`）は **手で編集しない**（次の `vp build` で上書きされる）
3. commit 前に `npm run build` を実行し、ソースと両方の出力をコミットする
4. 設計変更を伴う場合は本ドキュメント（§4 / §14 / §15）も更新する

### エンドユーザーの責務

なし。`dist/review.html` をブラウザで開くだけ。配布者が markdown を埋め込みたい場合は `node dist/review-request.mjs <input.md> [output-dir]` を使う（§3 入力 2 / §8 ファイル命名規約 参照）。

---

## 15. ファイル構成

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
│   ├── workspace.ts         File System Access API 連携。出力先フォルダ handle の取得・
│   │                         権限確認・IDB 永続化と `<name>-<hash>-feedback.json` の書き出し
│   │                         (writeFeedback / changeOutputFolder / restoreWorkspaceHandle)
│   ├── boot.ts              起動順序（workspace handle 復元 / embedded）
│   ├── storage.ts           IndexedDB の薄いラッパ（`workspace-handle` 永続化専用）
│   ├── dialog.ts            確認・通知モーダル
│   ├── scroll.ts            固定 duration smooth scroll
│   ├── embed-core.ts        markdown 埋め込みの pure ロジック (escape + rewrite + ファイル名規約)。
│   │                         `docHash` (SHA-256 先頭 16 桁 hex) の計算と
│   │                         `<mdFileName>-<docHash>-review.html` の名前生成も担う。
│   │                         review-request CLI と将来のブラウザ側 UI の双方から再利用可能
│   ├── review-request.ts    Node CLI (`dist/review-request.mjs` のエントリ)。embed-core を呼んで
│   │                         <input.md> から `<mdFileName>-<docHash>-review.html` を
│   │                         指定ディレクトリ (省略時は input.md と同じ場所) に生成し、
│   │                         既定で標準ブラウザを起動する shebang 付きスクリプト
│   └── types.ts             モジュール間で共有する JSON / コメント型
├── dist/                    ─── 生成物（commit 対象、編集禁止） ──────────
│   ├── review.html          ★ `npm run build` の出力。JS / CSS / npm 依存（marked）
│   │                         がすべて inline。外部依存ゼロのエンドユーザー配布物
│   └── review-request.mjs   ★ `npm run build:review-request` の出力。Node 20+ で実行可能な
│                             配布者向け review-request CLI。実行時に同ディレクトリの
│                             review.html を読み込むため両者は揃った状態で commit する
└── docs/
    └── DESIGN.md            本ドキュメント
```

ソース（`src/review.html` + `src/review.css` + `src/*.ts` + `vite.config.ts`）と出力（`dist/review.html`）はいずれも commit 対象。生成物を commit するのは、clone 直後の利用者が `vp build` を実行せずにそのままブラウザで開けるようにし、npm publish 時にも `dist/` が必ず含まれるようにするため。

### 編集ルール

- 編集対象は `src/` 配下のみ（`review.html` / `review.css` / `*.ts`）。`dist/review.html` は `vp build` で都度上書きされるため手で直さない
- ソースの編集後は `vp build` でビルドし、両ファイルを commit する
