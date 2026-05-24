# MDXG Virtual Pages 系 設計ドキュメント

DESIGN.md §12 優先順序 1「§6 / §7 / §8 / §9 Virtual Pages 系」に対応する設計の整理。MDXG 規格 §6 Virtual Pages / §7 Page Navigation / §8 Page Outline / §9 Sequential Navigation への準拠を、MDXG Redline 既存のインラインコメント機能・信頼境界・blockId アンカリングと両立させる形で導入することを目的とする。

本文 §1–§11 は設計確定事項として扱う。実装手順・フェーズ分割は付録 A (non-normative) に分離し、実装時の再調整余地を残す。本書で対象外と明記した範囲（§10 Search、モバイル UI、§13 残りキーボード操作）は別ドキュメントで扱う。

## 目次

1. [背景と目的](#1-背景と目的)
2. [スコープ](#2-スコープ)
3. [MDXG 要件サマリ](#3-mdxg-要件サマリ)
4. [既存実装との整合制約](#4-既存実装との整合制約)
5. [採用アプローチ（B 案 = 再実装）](#5-採用アプローチb-案--再実装)
6. [データモデル](#6-データモデル)
7. [重要な意思決定](#7-重要な意思決定)
8. [UI 構成](#8-ui-構成)
9. [インラインコメントとの統合](#9-インラインコメントとの統合)
10. [起動シーケンスへの影響](#10-起動シーケンスへの影響)
11. [feedback.json 互換性](#11-feedbackjson-互換性)
12. [対応外として割り切る項目](#12-対応外として割り切る項目)
13. [Open Questions](#13-open-questions)
14. [付録 A. 実装フェーズ提案 (non-normative)](#付録-a-実装フェーズ提案-non-normative)

---

## 1. 背景と目的

現状の MDXG Redline は全 markdown を単一の縦スクロールビューに描画する。短い文書（数 K〜数十 K）のレビューには十分だが、MDXG の規定する以下の体験は得られない：

- H1 / H2 で区切られた「ページ」単位の閲覧
- ページ一覧からの任意ジャンプ・現在位置の視認
- ページ内見出し (H3–H6) のアウトラインとスクロールスパイ
- 前 / 次ページへの逐次移動

MDXG 規格 §6–§9 の準拠を達成しつつ、本ツール固有の価値（インラインコメント + 構造化 feedback.json）を損なわない形で導入する。

## 2. スコープ

### 含むもの

- MDXG §6 Virtual Pages（ページ境界分割 / 見出し前コンテンツ / 深さ / スラッグ）
- MDXG §7 Page Navigation（全ページ閲覧 / 任意ページ移動 / 現在ページ識別 / 逐次移動の存在）
- MDXG §8 Page Outline（H3–H6 ナビゲート / スクロールスパイ）
- MDXG §9 Sequential Navigation（前 / 次ページの UI 配置）
- インラインコメント / blockId アンカリング / feedback.json との整合方針

### 含まないもの（別ドキュメント / 別フェーズ）

- MDXG §10 Search（DESIGN.md §12 優先順序 3）
- MDXG §13 残りのキーボード操作（DESIGN.md §12 優先順序 2 後段、ページモデル成立後）
- モバイル UI 最適化（DESIGN.md §12 その他の拡張候補）
- review-request CLI への `--initial-page` 等のオプション追加

---

## 3. MDXG 要件サマリ

詳細条文は `docs/mdxg/02-document-structure.md` を参照。本書では設計判断に必要な粒度で要約する。

### §6 Virtual Pages

| 条項 | 要件                                                | 設計含意                                           |
| ---- | --------------------------------------------------- | -------------------------------------------------- |
| 6.1  | [MUST] H1 / H2 でページ境界                         | パーサが H1 / H2 を検出し markdown を chunk 分割   |
| 6.1  | [MUST] ATX / setext 両形式                          | `#` / `##` と `===` / `---` 下線の両方を認識       |
| 6.1  | [MUST NOT] フェンスコード内の見出しは境界としない   | コードフェンス open / close を追跡しながらスキャン |
| 6.2  | [SHOULD] 見出し前コンテンツを Introduction ページ化 | 空 / 空白のみなら作らない                          |
| 6.3  | [MUST] H1 = 深さ 1、H2 = 深さ 2                     | TOC でインデント / 折りたたみに使用                |
| 6.4  | [MUST] URL セーフな一意スラッグ                     | 重複時は `-2` 等のサフィックスで解消               |

### §7 Page Navigation

| 条項 | 要件                                            |
| ---- | ----------------------------------------------- |
|      | [MUST] すべてのページを深さ階層が可視な形で閲覧 |
|      | [MUST] 任意ページへ移動                         |
|      | [MUST] 現在ページの視覚的 / 文脈的識別          |
|      | [MUST] 逐次移動（詳細は §9）                    |

### §8 Page Outline

| 条項 | 要件                                         |
| ---- | -------------------------------------------- |
|      | [MUST] アクティブページ内の H3–H6 のみを含む |
|      | [MUST] 各見出しがナビゲート可能              |
|      | [SHOULD] 深さの視覚的伝達                    |
|      | [SHOULD] スクロールスパイ                    |
|      | [MAY] H3–H6 が無いページは outline 非表示    |

### §9 Sequential Navigation

| 条項 | 要件                                            |
| ---- | ----------------------------------------------- |
|      | [SHOULD] 前 / 次ページのタイトル可視            |
|      | [MUST] 適用不可コントロールの hidden / disabled |
|      | [MUST] 少なくとも 1 箇所からのアクセス          |

---

## 4. 既存実装との整合制約

Virtual Pages 系の導入は単独機能の追加ではなく、本ツール固有の以下の不変条件と衝突しないことが前提：

### 4.1 blockId アンカリング (DESIGN.md §6)

- コメントは `blockId + startOffset/endOffset` でアンカリングされる
- 現状の `blockId` はドキュメント全体で連番（`b001`, `b002`, ...）
- 再描画後に `<mark class="cmt">` を再貼付する `mark-engine.ts` は blockId をキーに動く

**含意**: ページ切替で DOM を入れ替える場合、blockId の意味が page スコープに閉じるか、document スコープのまま維持されるかを明示的に決める必要がある（§7.1 参照）。

### 4.2 信頼境界 (DESIGN.md §11)

- レビュー対象 markdown は LLM 生成物が多く「信頼できない」前提
- URL allowlist で相対 URL を弾く（§4 部分準拠の理由）
- raw HTML は escape all 方式

**含意**: リファレンス実装 `vercel-labs/mdxg` の parser をフル採用すると、`sanitizeHtml` の blocklist 方針 / 相対 URL 素通し / `<script>` 注入経路と本実装の信頼境界が衝突する。**parser を直接 import せず、`splitIntoChunks` / `extractHeadings` / `slugify` 相当を本リポジトリ内に再実装する B 案を採る**（DESIGN.md §12 優先順序の項目 1 で既に方針確定済み）。

### 4.3 feedback.json 互換性 (DESIGN.md §5)

- `comments[]` の `headingPath` / `sourceLine` / `docHash` が export 仕様
- `sourceLine` は **元 markdown 全体での 1-origin 行番号**
- 後段 LLM パイプラインがこのスキーマに依存している可能性がある

**含意**: ページ分割を導入しても、export JSON の `sourceLine` はページ内 line ではなく元 markdown 全体での line を維持する（§11 で詳述）。

### 4.4 レイアウト (DESIGN.md §4)

- 現状は `<header>` + 2 ペイン (`<section class="doc-pane">` + `<aside class="sidebar">`(Conversation))
- 本文とサイドバーは独立スクロール

**含意**: Page Navigation 用の TOC をどこに置くか（左サイドバー追加 / header 内ドロップダウン / モーダル）で 2 ペイン or 3 ペイン化が決まる（§8 で詳述）。

### 4.5 CSP (DESIGN.md §11)

- `connect-src 'none'` で fetch / XHR 全遮断
- `script-src 'self' 'unsafe-inline'`、`style-src 'unsafe-inline'`

**含意**: ページ間遷移を SPA 的に行う場合も外部 fetch は発生しない（同一 HTML 内で DOM を切り替えるだけ）。URL 同期は `location.hash` の書き換えのみで完結し、CSP 違反を起こさない。

---

## 5. 採用アプローチ（B 案 = 再実装）

DESIGN.md §12 優先順序で既に決定済みの方針を改めて明文化する。

### 5.1 採用しない方針（A 案）

`vercel-labs/mdxg` の `@mdxg/parser` を npm 依存として直接採用する案。理由により採用しない：

1. parser の `sanitizeHtml` は blocklist 方式で、本実装の escape all 方針と衝突する
2. parser は marked への renderer フックを前提とした構造で、本実装の `core/markdown.ts` で既にカスタム renderer を持っているため、レイヤが重複する
3. `splitIntoChunks` にはコードフェンス追跡漏れバグがあり（フェンス内の `#` を見出しとして誤検出する）、再実装の際に修正できる

### 5.2 採用する方針（B 案）

`splitIntoChunks` / `extractHeadings` / `slugify` 相当のロジックを本リポジトリ内に **pure module として再実装する**。

新規ファイル候補：

- `src/core/page-split.ts` … markdown を `Page[]` に分割する純粋ロジック（コードフェンス追跡 + ATX / setext 両対応 + Introduction page）
- `src/core/page-outline.ts` … 1 ページ分の markdown から H3–H6 見出しと slug を抽出
- `src/core/slugify.ts` … タイトル → URL セーフ ID 変換 + 重複時のサフィックス解消

これらは `core/` 配下の純粋ロジックとして実装し、`marked.lexer` の出力を利用する（既に `block-anchors.ts` でも採用しているパターン）。in-source test を貼って regression を担保する。

### 5.3 ブラウザ層 (`app/`) の責務

- `app/pages.ts` … `Page[]` をメモリに保持し、`activePageIndex` を管理。ページ切替時の DOM 入れ替えと hash 同期
- `app/page-navigation.ts` … 左サイドバー TOC の描画と event wiring
- `app/page-outline.ts` … TOC 内に展開する outline 部分の描画 + スクロールスパイ
- `app/sequential-nav.ts` … ページ末尾の前 / 次リンク
- `app/doc-renderer.ts` … 単一ページ render の入口を `Page` 単位に変更

---

## 6. データモデル

### 6.1 Page 型（新規）

```ts
type Page = {
  index: number // 0-origin、ドキュメント順
  depth: 1 | 2 // H1 = 1, H2 = 2, Introduction も 1 として扱う
  title: string // 見出しテキスト（Introduction は固定文字列）
  slug: string // URL セーフな一意 ID（重複時はサフィックス付き）
  markdown: string // このページに属する markdown 断片
  sourceLineStart: number // 元 markdown 全体での開始行（1-origin、export の sourceLine 計算に使う）
  headings: Heading[] // H3–H6 の outline 用見出し（ページ内の文書順）
}

type Heading = {
  level: 3 | 4 | 5 | 6
  text: string
  slug: string // ページ内一意（URL fragment は `<page-slug>__<heading-slug>` で表現）
  sourceLineOffset: number // ページ markdown 内の 0-origin 行オフセット（スクロール位置計算用）
}
```

### 6.2 state 拡張

DESIGN.md §5「ドキュメント状態」への追加項目：

```ts
{
  // 既存
  docHash: string | null
  docName: string | null
  markdown: string
  comments: Comment[]
  blockOriginalHTML: Map<blockId, string>
  blockAnchors: Map<blockId, BlockAnchor>
  lastWrittenSignature: string | null

  // Virtual Pages 系で追加
  pages: Page[]              // markdown 読み込み時に確定、以後 read-only
  activePageIndex: number    // 現在表示中のページ index
}
```

### 6.3 blockId の意味 (§7.1 で詳述)

`blockId` は **page スコープで連番付与する** (`b001`, `b002`, ...)。document スコープ案との対比は §7.1 を参照。

### 6.4 URL fragment 表現

- ページのみ: `#<page-slug>`
- ページ内見出し: `#<page-slug>__<heading-slug>` （区切りは `__` 二連 underscore で衝突回避。MDXG 規格に明文規定はなく、本実装が独自に採る形式）

### 6.5 Comment 型 (拡張)

DESIGN.md §5 の `Comment` に、内部 state 用フィールドとして `pageIndex` を必須追加する：

```ts
{
  id: string // 8 文字のランダム ID
  blockId: string // 例: "b003" — page スコープで連番（§7.1）
  pageIndex: number // 所属ページの 0-origin index（state 内で必須、export には含めない）
  quote: string
  comment: string
  startOffset: number
  endOffset: number
  created: string // ISO 8601
  sourceLine: number // 元 markdown 全体での 1-origin 行番号（必須 invariant、§6.6 参照）
}
```

- **export 時**: `pageIndex` は feedback.json に **含めない**（外部スキーマの後方互換維持、§11）
- **import 時**: embedded-feedback / Open file 経由で読み込んだ既存 feedback.json には `pageIndex` が含まれないため、`sourceLine` から逆引きして埋める（§9.1 参照）。`sourceLine` も欠損していた場合は当該コメントを破棄する（壊れたデータを内部に取り込まない）
- **新規作成時**: `state.activePageIndex` を直接代入

この設計により、`blockId` の一意性は `(pageIndex, blockId)` の組で保証され、ページ切替・mark 再適用・floater 制御の各経路が `sourceLine` 逆引きに依存せず、page index 直引きで動く。

### 6.6 不変条件 (invariants)

設計上必須となる前提条件を明示する。これらは type guard / runtime check で担保する：

- **`Comment.sourceLine` は必須**: 1-origin の正の整数。欠損したコメントは feedback.json import 時に破棄する。新規作成時は `block-anchors.ts` 経由で `Page.sourceLineStart` + ブロック内行オフセットから算出
- **`Comment.pageIndex` は必須**: `0 <= pageIndex < state.pages.length`。範囲外は破棄
- **`Page.sourceLineStart` は単調増加**: `pages[i].sourceLineStart < pages[i+1].sourceLineStart`。`core/page-split.ts` の test invariant とする
- **`blockId` は `(pageIndex, blockId)` 組で一意**: page スコープ内で `b001` から連番

---

## 7. 重要な意思決定

### 7.1 blockId は page スコープに閉じる

**決定**: blockId はページ単位で `b001` から付番する。document スコープでの連番にはしない。

**理由**:

- ページを跨ぐ範囲選択をブラウザの Selection API で許可すると、現状の floater / コメント生成フローがそのまま動いてしまい、結果として「複数ページに分かれた markdown 上に 1 つのコメント」を作成できてしまう
- このコメントは後段 LLM への feedback.json では `headingPath` / `sourceLine` が 1 つしか持てず情報が落ちる
- MDXG §6 のページモデルは「ページ = レビュー / ナビゲーションの単位」であり、コメント単位もそれに揃えるのが整合的

**含意**:

- ページ境界を跨ぐ Range を Selection API が返してきた場合、floater を表示しない（既存の「ブロック境界を跨ぐ選択は無視」の page 版）
- 別ページのコメントは現在ページの DOM には存在せず、ページ切替時に再 render される
- `state.comments` 自体は全ページ分を保持し続け、page 切替で `mark-engine.ts` の再描画対象が絞られる
- blockId 一意性は `(pageIndex, blockId)` の組で保証する（§6.5 / §6.6）

**代替案（不採用）**: document スコープ blockId のままにし、ページ境界跨ぎコメントを許可する。シンプルだが、コメントの blockId がどのページにも属さない宙吊り状態になり、ページ切替 UX と矛盾する。

### 7.2 sourceLine は元 markdown 全体の line 番号を維持する

**決定**: feedback.json の `sourceLine` は **元 markdown 全体での 1-origin 行番号**を維持する。ページ分割後のページ内 line 番号には変更しない。

**理由**:

- 既存 feedback.json スキーマとの互換性（DESIGN.md §5）
- 後段 LLM / エージェントが元 markdown ファイルを開いて該当行に直接ジャンプできる
- `docHash` で元 markdown と feedback.json の対応が取れるため、line 番号も元 markdown 基準が自然

**含意**:

- `Page.sourceLineStart` を保持し、ページ内の相対 line 番号 + `sourceLineStart - 1` で元 markdown の line を復元する
- `core/block-anchors.ts` は引き続き `marked.lexer` の token から `sourceLine` を引くが、page 分割の前後で値が変わらないよう注意する

### 7.3 スラッグ生成: ASCII 範囲のみで URL セーフ化、非 ASCII は連番フォールバック

**決定**: タイトルから slug を生成する際、ASCII 英数字 + ハイフンのみ残す。非 ASCII（日本語等）はパーセントエンコードせず、その見出し index を使った `page-<index>` 形式の連番フォールバックを採る。

**理由**:

- 日本語タイトルを `%E6%97%A5%E6%9C%AC%E8%AA%9E` のように encode すると URL bar 上で可読性が著しく低下する
- かといって生の日本語を hash に置くと、ブラウザ間の挙動差・コピー時の挙動差が大きい
- レビュー対象は LLM 生成 markdown が多く、見出しに連番や英字を含むケースが大半。日本語のみのタイトルは少数派
- リファレンス実装の `slugify` は ASCII 前提で書かれており、日本語入力時の挙動は実質定義されていない

**重複時の解消**: 同一 slug が衝突したら `-2`, `-3`, ... のサフィックスを文書順に付与する（MDXG §6.4 [MUST]）。

**含意**:

- 日本語のみで構成された見出しは `page-3`, `page-7` のような連番 slug になり、URL からの可読性は失われる
- これは「URL 安定性」と「URL 可読性」のトレードオフで、安定性を優先した結果
- 将来的に `decodeURIComponent` 経由で日本語 hash も扱う方針に切り替える余地は残す（その場合は URL 同期側のみの変更で済む）

### 7.4 URL 同期は `location.hash` のみ。History API は使わない

**決定**: ページ切替時の URL 同期は `location.hash = '#' + page.slug` の書き換えのみで行う。`history.pushState` / `replaceState` は使わない。

**理由**:

- `file://` プロトコル下で History API の挙動はブラウザ依存（特に `pushState` の URL 制約）が大きい
- `hashchange` イベントだけで page 切替を駆動でき、State 管理が単純化される
- ブラウザの履歴記録は `location.hash = ...` の代入によって標準的に行われるため、追加 API は不要

**含意**:

- `location.hash = ...` への代入は多くのブラウザで履歴エントリとして積まれるため、**ブラウザの戻る / 進むボタンで前ページ / 次ページに戻る挙動が得られる**。これは肯定的な副作用として許容する
- 履歴を意図的に抑制したい場合は `history.replaceState({}, '', '#' + slug)` を使う必要があるが、本設計では採用しない（戻る挙動を残すため）
- `file://` 下では `pushState` の URL 制約や History API 自体の挙動差が大きいため、`hashchange` 一本化で挙動を統一する
- 初期表示時の hash 復元は `boot.ts` で `location.hash` を読んで該当 slug の page を `activePageIndex` に設定する
- hash が空 / 不正な場合は `activePageIndex = 0`（Introduction or 最初の H1 / H2 page）

### 7.5 H1 / H2 が一切ない markdown は「単一ページ文書」として扱う

**決定**: markdown 全体に H1 / H2 見出しが 1 つも存在しない場合、ドキュメント全体を `depth: 1, title: docName, slug: 'page-1'` の 1 ページとして扱う。

**理由**:

- MDXG §6.2 は「最初の見出しの前のコンテンツ」を Introduction とすると規定しているが、見出しが全く無い場合の挙動は明文化されていない
- レビュー対象として「短い断片を 1 つのドキュメントとして渡す」ユースケースが想定される（LLM 生成の単一節 markdown 等）
- 「ページが 0 個」という状態は UI 上扱いに困るため、1 ページに正規化する

**含意**:

- TOC には 1 項目だけ表示される
- Page Outline は H3–H6 があれば通常通り描画
- Sequential Navigation の前 / 次ボタンは両方 `hidden`

### 7.6 Introduction ページの title は固定文字列 "Introduction"

**決定**: 見出し前コンテンツから生成される暗黙ページのタイトルは英語 "Introduction" 固定とする。i18n しない。

**理由**:

- MDXG 規格 §6.2 が "Introduction" という英語固定の例示を出しており、規格準拠を最短で達成できる
- 本ツール全体で i18n を導入していない（toolbar / modal 等すべて英語）
- 後段 LLM への feedback.json で `headingPath` の祖先見出しは markdown 原文ベースで構築されるため、Introduction ページのコメントは `headingPath: []` で表現される（既存仕様と一致、§9.3 参照）

### 7.7 Page Outline は左サイドバー TOC 内に展開する

**決定**: §8 Page Outline は新規 3 つ目のペインを作らず、左サイドバー TOC の現在ページ配下に H3–H6 を inline 展開する形で実装する。

**理由**:

- レビュー画面の主役は「本文 + Conversation」の 2 ペイン構成で、3 ペインに拡大すると本文の有効幅が大きく減る
- Page Outline は「現在ページに H3–H6 がある場合のみ」表示される条件付き要素で、常駐ペインにする要件性は薄い
- MDXG §8.2 の実装例にも「右サイドバーの On this page リスト」と「目次ドロップダウン」が並列で挙がっており、独立ペインは規格上の要請ではない
- リファレンス実装 `mdxg-viewer.tsx` も TOC 配下にページ内見出しを展開する配置で、参考実装と一致する

**代替案（不採用、§12 対応外）**: 本文上部 sticky ドロップダウン / 本文右上 floating panel。実装単純さを優先して採用しない。

---

## 8. UI 構成

### 8.1 レイアウト全体図

```
┌────────────────────────────────────────────────────────────────────┐
│ <header class="app-header">  toolbar / theme / Comments ▾ / Send ▾ │
├──────────────────┬───────────────────────────────┬─────────────────┤
│ <aside class=    │ <section class="doc-pane">    │ <aside class=   │
│  "page-nav">     │                               │  "sidebar">     │
│                  │  ┌─────────────────────────┐  │                 │
│ Pages (TOC)      │  │ <article id="doc">      │  │ Conversation    │
│  ▾ Introduction  │  │                         │  │  (コメント一覧)  │
│  ▾ § 1. 概要     │  │  現在ページの markdown   │  │                 │
│    § 1.1 ...     │  │                         │  │                 │
│    § 1.2 ...     │  │                         │  │                 │
│  ▾ § 2. 制約     │  │                         │  │                 │
│                  │  └─────────────────────────┘  │                 │
│ (現在ページの    │                               │                 │
│  H3–H6 outline   │  ┌─────────────────────────┐  │                 │
│  は §7.7 で      │  │ ‹ Prev: 前ページ title  │  │                 │
│  この TOC 配下に │  │       Next: 次 title ›  │  │                 │
│  inline 展開)    │  └─────────────────────────┘  │                 │
└──────────────────┴───────────────────────────────┴─────────────────┘
```

### 8.2 左サイドバー (Page Navigation, §7)

- `<aside class="page-nav">` を `<main class="layout">` の左端に追加
- ページ一覧を `<ul>` で出力、`Page.depth === 2` は左 padding でインデント
- 現在ページに `aria-current="page"` + 視覚的ハイライト（背景色 + 左 border accent）
- H1 配下に H2 が複数ある場合、H1 ノードは展開 / 折りたたみ可能（caret アイコン）
- 折りたたみ状態自体は永続化しない（毎回展開状態で起動）
- クリック → `app/pages.ts` の `navigateTo(slug)` を呼ぶ → `activePageIndex` 更新 → `location.hash` 更新 → `doc-renderer` 再 render

### 8.3 Page Outline (§8)

§7.7 の決定に従い、左サイドバー TOC の現在ページ配下に H3–H6 を inline 展開する形で実装する。

- 現在ページを TOC で選択中の状態で、その配下に H3–H6 のリストが折りたたまれずに見える
- H3 / H4 / H5 / H6 はレベルに応じた左 padding でインデントし、視覚的に深さを伝える（MDXG §8 [SHOULD]）
- 各見出しはクリックでページ内アンカーへスムーズスクロール
- 該当ページに H3–H6 が存在しない場合は outline 部分自体を出さない（MDXG §8 [MAY]）
- TOC が縦に長くなる懸念は許容する（俯瞰性低下 vs 実装単純さで実装単純さを採る）

スクロールスパイは `IntersectionObserver` で各 H3–H6 の DOM 要素を観測し、ビューポート上部から最も近い見出しに `aria-current="location"` を付与する（リファレンス実装と同じ手法、MDXG §8 [SHOULD]）。

本文上部 sticky ドロップダウン / 本文右上 floating panel 形式は採用しない（§12 参照）。

### 8.4 Sequential Navigation (§9)

- 本文末尾（`<article id="doc">` の直下、最終ブロックの後）に `<nav class="sequential-nav">` を置く
- 左に「‹ Prev: <prev page title>」、右に「Next: <next page title> ›」
- 最初のページでは Prev を `hidden`、最後のページでは Next を `hidden`（MDXG §9.1 [MUST]）
- キーボードショートカット（左右矢印キーでページ遷移）は **本書のスコープ外** （DESIGN.md §12 優先順序の項目 2 = §13 残りで対応）。Sequential Nav 自体は本書で UI 配置まで決め、キーボード操作は後続で追加する分業

### 8.5 toolbar への追加事項

現状の toolbar はファイル操作とコメント操作のみ。Virtual Pages 系では toolbar への追加は最小限に留める：

- toolbar に Page Navigation 用ボタンは追加しない（左サイドバーで足りる）
- toolbar に Page Outline 用ドロップダウンも追加しない（§8.3 で確定）

---

## 9. インラインコメントとの統合

### 9.1 コメントの page 帰属

すべてのコメントは内部 state で `Comment.pageIndex`（§6.5）を必須に保持する。新規作成時は `state.activePageIndex` を直接代入し、import 時は `sourceLine` から逆引きして決定する。

**逆引きが必要なケース**:

- embedded-feedback (`<script id="embedded-feedback">`) からの読み込み
- Open file 経由で既存の feedback.json を併用するシナリオ（現状は読み込み経路なしだが、将来的拡張余地として留めておく）

**逆引きロジック**:

- `Comment.sourceLine` を、Page 配列の `Page.sourceLineStart` と次ページの `sourceLineStart - 1` の範囲と突き合わせて所属 page を決定
- 解決した結果を `Comment.pageIndex` に格納し、以後は逆引きに依存しない
- 範囲計算は `state.pages` 確定時に 1 回だけ行う
- `sourceLine` が欠損 / 範囲外なコメントは破棄する（§6.6 invariants）

**page 別の絞り込み表示用キャッシュ**:

- `commentsByPage: Map<pageIndex, Comment[]>` を `state.comments` 更新時に再構築
- このキャッシュは `pageIndex` を直接見て group by するだけで、`sourceLine` 逆引きは経由しない
- ページ切替時の `mark-engine.ts` 再描画もこのキャッシュを使う

### 9.2 ページ切替時の Conversation サイドバー

右サイドバーの Conversation には **2 つのモードを設ける**：

- **Current page only モード**（既定）: 現在ページに属するコメントのみ表示
- **All pages モード**: 全コメントを表示、各カードに所属ページ slug をバッジ表示

切替は Conversation の上部に小さな toggle button を置く。All pages モードは実装優先度低（付録 A.5 参照）。

別ページのコメントを Current page only モードで完全に隠すと、レビュアーが「総コメント数」を見失う可能性があるため、サイドバー上部に **`N comments (this page) / M comments (all)` のような件数表示** を常時出す。

### 9.3 export 時の headingPath / sourceLine

`feedback.json` 出力は元 markdown 全体に対する位置参照を維持する（§7.2 / §11）。Virtual Pages 導入による変更：

- `headingPath` は従来通り、ページ境界を構成する H1 / H2 も含む祖先見出しの配列
  - 例: ページ「§ 3. 入力経路」の中の `### 3.2 ファイル選択` 配下のコメントは、`headingPath = ["# Spec", "## 3. 入力経路", "### 3.2 ファイル選択"]` のような形
- `sourceLine` は元 markdown 全体での 1-origin 行番号（不変）
- Introduction ページ内のコメントは祖先見出しが無いため `headingPath: []`（既存仕様と一致）
- `pageIndex` は export に含めない（§6.5 / §11）

### 9.4 マーク再適用 (`mark-engine.ts`) への影響

ページ切替時に `doc-renderer.ts` が現在ページの markdown のみを render し、`mark-engine.ts` が `commentsByPage.get(activePageIndex)` 分だけ `<mark class="cmt">` を貼る。他ページの blockOriginalHTML はキャッシュから破棄せず保持する（ページ切替で再 render を高速化）。

### 9.5 floater のページ境界判定

選択範囲が現在ページ内に収まる場合のみ floater を表示する。現在ページの DOM 外（左サイドバー TOC / 右サイドバー Conversation）に選択が伸びた場合は既存の `selection.ts` の祖先 blockId 探索で自然に弾かれる。

---

## 10. 起動シーケンスへの影響

DESIGN.md §9 への加筆を以下の通り行う：

```
0. IndexedDB から workspace-handle をサイレント復元
1. 埋め込み markdown (<script id="embedded-md">) をロード
   1a. core/page-split.ts で markdown → Page[] に分割
   1b. 各 Page の H3–H6 を core/page-outline.ts で抽出
   1c. state.pages = Page[], state.activePageIndex = 0 を初期化
   1d. location.hash があれば該当 slug を解決し activePageIndex を上書き
   1e. <script id="embedded-feedback"> があれば適用
       (各コメントは sourceLine から pageIndex を逆引きして埋める、§9.1)
   1f. activePageIndex のページのみ doc-renderer.ts で render
2. 該当しなければ空状態のまま `Open file` を待つ
```

Open file 経由でも同じく 1a–1f を経由する。

---

## 11. feedback.json 互換性

§7.2 / §6.5 で決定した通り、export JSON のスキーマは Virtual Pages 導入前後で **完全互換**を維持する：

- `document` / `docHash` / `exportedAt` は不変
- `comments[].id` / `quote` / `comment` / `created` / `headingPath` / `sourceLine` も不変
- `pageIndex` / ページ slug / `activePageIndex` 等の内部 / UI 状態は export に含めない（LLM が解釈できる位置参照のみ残す方針 = DESIGN.md §5 の方針継続）

これにより、既存の後段 LLM パイプラインは feedback.json のスキーマ変更なしで Virtual Pages 対応版の MDXG Redline を受け入れられる。

---

## 12. 対応外として割り切る項目

- **本文 sticky ドロップダウン / floating panel 形式の Page Outline**: §8.3 の決定により左サイドバー内展開で確定。将来 UX 再検証で切替が必要になった場合は別ドキュメントで扱う
- **モバイル UI**: タッチ操作 / vaul Drawer 相当 / 狭幅レイアウトは別ドキュメントで扱う。本書はデスクトップ前提
- **キーボードショートカット (Cmd+K / 矢印キー)**: DESIGN.md §12 優先順序の項目 2 で扱う。本書は UI 配置と aria 属性まで
- **検索 (§10)**: DESIGN.md §12 優先順序の項目 3 で別ドキュメント。検索ハイライト用 `<mark>` とコメント用 `<mark>` の共存設計は本書スコープ外
- **review-request CLI 拡張**: 初期表示ページを指定する `--initial-page` 等は将来検討
- **ページ単位の差分ビュー**: 別ラウンドの review.html 間で page 単位の diff を見る機能。DESIGN.md §12 「差分ビュー」拡張候補に既出
- **印刷 / PDF 出力**: 全ページを 1 ファイルに結合した印刷用ビューは別課題
- **History API による履歴抑制**: §7.4 で `location.hash` 一本化を確定。`replaceState` での履歴抑制は採用しない

---

## 13. Open Questions

実装着手前に追加で詰めるべき論点。確定したものは順次本文に取り込む。

### 13.1 Conversation サイドバーの幅と TOC 追加後のレイアウト

3 ペイン化により本文有効幅が縮む。CSS で 3 ペインの幅配分（例: 左 220px / 中央 flex / 右 320px）を決める必要がある。狭幅時の TOC 折りたたみは UI 実装着手時に UX 検証して決定。

### 13.2 ページ slug 重複と docHash の関係

同じ markdown を別ラウンドで読み込んだ際、見出し変更でスラッグが変わると以前生成した URL hash が無効化される。`docHash` が変われば別ドキュメントとして扱うのが本ツールの設計（DESIGN.md §6）であり、hash も失効するのが整合的。明示的な「古い hash → 新しい slug への移行」は実装しない方針で良いか確認が必要。

### 13.3 setext 見出し（`===` / `---`）の検出範囲

MDXG §6.1 は ATX / setext 両形式を [MUST] とする。setext は直前行に空でないテキストが必要で、コードフェンス内では無効。`core/page-split.ts` の正規表現または lexer 統合の判定をどちらにするかをパーサ実装時に決定。

### 13.4 ページ切替時のスクロール位置

ページ切替時は新ページの top にスクロールするのが基本だが、コメント sidebar からのジャンプ（別ページのコメントカードをクリック）では該当 `<mark>` までスクロールする必要がある。`app/scroll.ts` の固定 duration scroll を再利用し、page 切替直後の `requestAnimationFrame` で scroll を発火する流れで実装可能かをコメント統合フェーズで検証。

### 13.5 リファレンス実装の `splitIntoChunks` バグ修正の差分検証

リファレンス実装にあるコードフェンス追跡漏れバグ（フェンス内 `#` を見出し検出）を本実装では最初から修正して実装する。リファレンス実装と分割結果が異なる入力例を test fixture として残し、意図的な差分であることを明示する。

---

## 付録 A. 実装フェーズ提案 (non-normative)

本付録は実装の進め方の提案であり、設計確定事項ではない。本文 §1–§11 が確定事項、本付録は実装時に状況に応じて再調整してよい。記載のフェーズ分割や粒度は強制ではなく、実装者が進捗・依存関係を踏まえて変更できる。

機能を一度に入れず、各フェーズで動作確認可能な単位に分割する想定。各フェーズで `npm test` の in-source test と、`dist/review.html` を直接開いた手動 smoke test を通す。

### A.1 Phase 1: パーサと単一ページ render (準備)

- `core/page-split.ts` + `core/page-outline.ts` + `core/slugify.ts` 実装と in-source test
- `state.pages` / `state.activePageIndex` を導入、ただし UI は変更せず「全ページの markdown を結合して描画」する経路を残す
- ページ分割のロジックだけ先行で投入し、既存挙動への regression を出さない

### A.2 Phase 2: 左サイドバー TOC + ページ切替 (UI 骨格)

- `<aside class="page-nav">` を追加、`Page[]` を TOC として描画
- クリックで `activePageIndex` 切替、現在ページのみ render
- `location.hash` 同期、初期表示時の hash 復元
- 現在ページの視覚的ハイライト（`aria-current="page"`）

この Phase 完了時点では §7 全体の準拠は **未達**（[MUST] 逐次移動が A.3 待ち）。Page Navigation の UI 骨格が動作する状態を作るところまで。

### A.3 Phase 3: Sequential Navigation (§7 全体準拠)

- 本文末尾に Prev / Next リンク追加（§9）
- 最初 / 最後のページで該当ボタンを `hidden`
- **この Phase 完了時点で初めて MDXG §7 全体が [MUST] 全項目準拠となる**（全ページ閲覧 / 任意ページ移動 / 現在ページ識別 / 逐次移動の 4 つが揃う）

### A.4 Phase 4: Page Outline (§8)

- §8.3 で確定した形式（左サイドバー TOC の現在ページ配下に H3–H6 を inline 展開）で実装
- `IntersectionObserver` でスクロールスパイ
- H3–H6 が無いページでは outline 部分を非表示

### A.5 Phase 5: コメント統合の細部 (本書 §9)

- `commentsByPage` の page index ベース group by 実装
- Conversation サイドバーの件数表示（Current page / All pages）
- All pages モード切替（オプション、優先度低）
- ページ境界跨ぎ選択時の floater 抑制テスト

### A.6 Phase 完了基準

各 Phase 終了時に以下を満たす：

- in-source test がすべて green
- `dist/review.html` を直接 file:// で開いて、Phase で導入した UI が動作
- 既存の feedback.json export / Write feedback.json が regression なし
- DESIGN.md §12 の準拠表を更新（部分 → 準拠）
