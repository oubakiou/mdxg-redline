# MDXG §2 Code Block Rendering 対応 設計・実装計画

DESIGN.md §12 の優先順序 1「§2 コピー button + シンタックスハイライト」に対応するための設計判断と実装手順をまとめる。完了時点で本ドキュメントは DESIGN.md §12 表の「§2 Code Block Rendering = 準拠」に置換され、本ファイルはアーカイブされる想定（`docs/mdxg-rendering-theming-design.archive.md` と同じ扱い）。

## 1. 対応スコープ

MDXG [§2 Code Block Rendering](./mdxg/01-rendering.md#2-code-block-renderingコードブロック描画) の 4 要件をすべて満たす。

| 要件                                                                                              | 現状 | 完了条件                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [MUST] 言語識別子を持つフェンス付きコードブロックは、言語に適した構文ハイライトとともに描画される | 未   | Shiki でトークンベースのハイライトを適用。識別子は Shiki 由来のエイリアスマップで正規化（`ts→typescript` / `js→javascript` / `sh→bash` / `yml→yaml` / `py→python` 等）。未対応言語は plain text fallback |
| [MUST] 言語識別子を持たないコードブロックも等幅プリフォーマット描画                               | ✓    | 既に `<pre><code>` で描画済み、回帰させない                                                                                                                                                              |
| [MUST] 1 アクションでコピー可能な「Copy」ボタンを各ブロックに提供                                 | 未   | `<pre>` 外側のラッパ要素に絶対配置した button から `navigator.clipboard.writeText` を呼ぶ                                                                                                                |
| [MUST] 構文ハイライト配色がホストの light / dark に適応する（§1 Theming 連動）                    | 未   | Shiki dual theme (`github-light` + `github-dark`) を `<html>.dark` 切替で CSS variables 経由で適用                                                                                                       |

スコープ外（別タスクで扱う）：

- §1 Theming で導入済みの `--doc-code-bg` / `--doc-code-rule` / `--doc-code-ink` トークン定義（既に DADS primitive ベースで dark 対応済み）
- 言語ラベル表示（MDXG §2.2 「コピーボタンと並べて表示される言語ラベル」は実装例 / SHOULD 未満であり、本タスクでは扱わない。`<pre data-lang="…">` 属性は出力に残し将来拡張で UI 追加可能にする）
- インラインコード `` `code` `` のハイライト（フェンス付きブロックのみが §2 [MUST] スコープ）

## 2. リファレンス実装と差分

[vercel-labs/mdxg `apps/web`](https://github.com/vercel-labs/mdxg/tree/main/apps/web) のコードブロック描画は次の 4 要素で構成される：

1. **Shiki dual theme で SSR ハイライト** — `apps/web/src/lib/parser.ts` で `createHighlighter` を遅延初期化、30+ 言語、`themes: { light: github-light, dark: github-dark }` の dual theme
2. **`html.dark` 切替で CSS variable 経由のテーマ追従** — Shiki が `<span style="--shiki-light:#…;--shiki-dark:#…">` を出力し、`html.dark` 配下の CSS ルールで dark 側の variable を採用
3. **`mdxg-viewer.tsx` の useEffect でコピー button を動的注入** — `<pre>` を queryAll して button を append、「Copy → Copied!」をトグル
4. **`globals.css` の `.copy-btn` / `.shiki` クラス** — 配色とレイアウト

MDXG Redline は React / Next.js / SSR を使わず、配布物は単一 HTML で完結する必要があるため、上記を次のとおりブラウザランタイムで完結する形に書き直す：

| リファレンス実装                                  | MDXG Redline での置換                                                                                                                  |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| SSR 時の `createHighlighter` 呼び出し             | ブラウザ起動時の lazy `createHighlighterCoreSync`（`shiki/core` + `shiki/engine/javascript`）。FOUC を避けるため初回描画前に同期初期化 |
| Tailwind `prose` ベースの styling                 | 既存 `src/styles/markdown.css` の `pre` / `code` ルールに Shiki 出力を流す（`code .line` 等の Shiki クラス用ルールを追加）             |
| `mdxg-viewer.tsx` の useEffect で button 動的注入 | `src/app/doc-renderer.ts` の再描画フックに injectCopyButtons を追加し、`<pre>` ごとに外側ラッパを生成して button を absolute 配置      |
| `globals.css` の `.copy-btn`                      | `src/styles/review.css` に `.code-copy-btn` クラスを追加（既存 `.btn` 系トークンを再利用、§1 Theming dark に追従）                     |
| 30+ 言語の grammar を SSR 時に bundle             | review-request CLI で markdown をスキャンし、必要な grammar JSON だけを `<script id="embedded-shiki-langs">` に埋め込む（§3）          |

リファレンス実装は SSR 前提で全言語 bundle のコストを問題にしていないが、MDXG Redline は単一 HTML 配布物のサイズが UX に直結するため、**CLI 経由で言語サブセットを動的注入する** 設計を採用する。詳細は §3。

## 3. bundle 構成と言語サブセット動的注入

### 3.1 配布物の構成

| ファイル                       | 内容                                                                                                                 | 配布形態             |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `dist/review.html`             | Shiki core + JS engine + 2 テーマ (`github-light` / `github-dark`) を inline。grammar は **含まない**                | エンドユーザー配布物 |
| `dist/shiki-langs/<lang>.json` | 各言語の grammar JSON（Shiki 内部表現）。27 言語ぶん個別ファイル（commit 対象）                                      | CLI が読み込む素材   |
| `dist/review-request.mjs`      | CLI 本体。markdown をスキャンして必要な grammar を `<script id="embedded-shiki-langs">` に埋め込み、配布 HTML を生成 | 配布者向け CLI       |

`dist/review.html` のサイズ増分は **Shiki core + JS engine + 2 テーマぶんのみ**（実測は実装後、見積もりは raw +500 KB〜1 MB / gzipped +150〜300 KB）。grammar が同梱されないため、CLI を介さずダブルクリックで開いた `dist/review.html` は **コードブロックを plain text fallback として描画する**（既存挙動と同等）。

### 3.2 CLI による言語注入

`src/cli/parse-args.ts` に `--shiki-langs <mode>` オプションを追加する。受け付ける値：

| `--shiki-langs` 値  | 挙動                                                                                                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auto`（既定）      | 入力 markdown をスキャンしてフェンスで指定された言語を集合化し、該当 grammar だけを embedded-shiki-langs に注入                                                                                          |
| `all`               | 全 28 言語の grammar を注入（最大サイズの配布物）                                                                                                                                                        |
| `<lang1>,<lang2>,…` | カンマ区切りで明示指定した言語だけを注入（エイリアスも受け付け、`ts,js,py` のような短縮形は §5.j の正規化マップで正規名に展開される）。`auto` 検出を上書きしたい / `auto` の検出漏れを補いたい場合に使用 |
| `none`              | grammar を注入しない（全コードブロックを plain text fallback）。ハイライト不要な軽量レビュー用                                                                                                           |

#### 言語スキャンの仕様

`src/core/scan-fenced-langs.ts`（新規）を pure module として実装する：

- 入力: markdown 文字列
- 出力: 検出された言語の **正規名** の集合 (`Set<SupportedLang>`)
- ロジック: `marked.lexer(markdown)` でトークン列を取得し、再帰的に walk して `token.type === 'code'` の `token.lang` を集める。インデント付きフェンス（リスト配下 / 引用配下）やネストフェンスの判定は marked が GFM 仕様に沿って処理済み。自前 regex で行頭フェンスをスキャンする方式は採用しない（取りこぼしリスクと仕様追従コストを避けるため、§5.k 参照）
- 抽出した識別子は §5.j のエイリアスマップで正規名に正規化（`ts → typescript` / `js → javascript` / `sh → bash` / `yml → yaml` / `py → python` 等）
- 正規化後に 28 言語ホワイトリストに含まれない識別子は無視（plain text fallback）

`marked.lexer` は既に `src/core/block-anchors.ts` が使っており、CLI bundle にも marked が含まれている前提（依存追加なし）。

スキャン結果と Shiki 同梱言語の積集合を取り、該当する `dist/shiki-langs/<lang>.json` を読み込んで JSON 文字列として連結する。

#### 注入経路

`src/core/embed.ts` の rewrite ロジックに `shikiLangs?: Record<string, unknown>` 引数を追加し、`<script id="embedded-shiki-langs" type="application/json">` ブロックに以下の形式で埋め込む：

```html
<script id="embedded-shiki-langs" type="application/json">
  {"javascript": {...grammar...}, "typescript": {...grammar...}, ...}
</script>
```

エンコード規約は `embedded-md` と同じく `JSON.stringify(...).replace(/</g, '\\u003c')` で `<` を Unicode escape し、`</script>` 誤検出を構造的に避ける。

#### ブラウザ側の読み込み

`src/app/shiki.ts`（新規）で起動時に `embedded-shiki-langs` を `JSON.parse` し、`createHighlighterCoreSync({ langs: [...parsed の grammar...], themes: [...] })` で Shiki インスタンスを初期化する。`embedded-shiki-langs` が存在しない / 空オブジェクトの場合は `langs: []` で初期化し、全コードブロックを plain text fallback として描画する。

#### 同梱言語リスト（28 言語）

リファレンス実装が採用する 28 言語をそのまま採用：`javascript` / `typescript` / `python` / `bash` / `json` / `html` / `css` / `markdown` / `yaml` / `toml` / `rust` / `go` / `java` / `c` / `cpp` / `ruby` / `php` / `sql` / `shell` / `diff` / `jsx` / `tsx` / `xml` / `swift` / `kotlin` / `scala` / `zig` / `lua`。

各言語の正規名と Shiki が認める **エイリアス**（`ts` / `js` / `sh` / `yml` / `py` / `rb` 等）は Shiki の `bundledLanguagesInfo` メタデータから抽出して `src/core/shiki-aliases.generated.ts` に生成する（詳細は §5.j）。`scanFencedLangs` も CLI `--shiki-langs=<csv>` も同じマップを通すため、`ts` / `typescript` どちらでも同じ grammar が注入される。

将来 28 言語に追加する場合は `vite.config.ts` の grammar emit リストに 1 行追加するだけで済む（ホワイトリストとエイリアスマップは Shiki メタから自動再生成される）。

### 3.3 CLI 経由の典型サイズ見積もり

| ケース                                 | review.html   | embedded-shiki-langs 増分  | gzipped 後の配布物 |
| -------------------------------------- | ------------- | -------------------------- | ------------------ |
| 仕様書（言語なし）`--shiki-langs=auto` | ~500 KB〜1 MB | 0 KB                       | ~150〜300 KB       |
| コードレビュー（3 言語）`auto`         | ~500 KB〜1 MB | +100〜300 KB（言語による） | ~250〜500 KB       |
| 全部入り `--shiki-langs=all`           | ~500 KB〜1 MB | +3〜5 MB                   | ~1.5 MB            |
| 無効化 `--shiki-langs=none`            | ~500 KB〜1 MB | 0 KB                       | ~150〜300 KB       |

実測値は実装後に確定する。CLI 既定 (`auto`) は仕様書系で `+0 KB`、コード混入レビューで `+100〜300 KB` 程度に収まる想定。

## 4. 実装ステップ

順序は依存関係順。各ステップ完了で in-source test と手動視覚チェックを通す。

### Step 1: 設計判断の確定とライブラリ選定の検証

- 本ドキュメントの §5 設計判断をレビュー
- `shiki/core` + `shiki/engine/javascript` + 個別 grammar の組み合わせが `createHighlighterCoreSync` で同期初期化できることをローカルで PoC（同期 API が無い場合は §5.b の Option B / Option C にフォールバック）
- 28 言語の grammar JSON サイズと gzipped 後のサイズを実測

成果物：§5 マッピング表が確定状態、PoC で同期初期化が動くこと

### Step 2: 純粋ロジック層（`src/core/scan-fenced-langs.ts` 新規）

UI / DOM / Shiki に依存しないフェンススキャンを pure 関数で書き、in-source test を通す。Step 3 で生成する `shiki-aliases.generated.ts` に依存するため、Step 3 完了後に着手するか、暫定で Map をハードコードして書き始めて Step 3 完了時点で import に差し替える。

```ts
import { ALIAS_TO_CANONICAL, SHIKI_SUPPORTED_LANGS } from './shiki-aliases.generated'

export type SupportedLang = (typeof SHIKI_SUPPORTED_LANGS)[number]

// markdown → 正規化済み正規名集合
export function scanFencedLangs(markdown: string): Set<SupportedLang>

// 単一識別子の正規化（CLI --shiki-langs=<csv> からも再利用）
export function normalizeLangIdentifier(raw: string): SupportedLang | null
```

- `marked.lexer(markdown)` で AST を取得し、再帰 walk で `token.type === 'code'` の `token.lang` を収集（GFM のインデント / 引用 / リスト配下 / ネストフェンスは marked が処理済み）
- 各識別子を `normalizeLangIdentifier` に通し、エイリアス → 正規名 → ホワイトリストフィルタを経て Set に追加
- 識別子は小文字化してからマップ参照（GFM 慣習で `JS` / `Python` のような大文字混入を許容）
- 未サポート言語は Set に含めない（呼び出し側で plain fallback）

成果物：`src/core/scan-fenced-langs.ts` + in-source test（言語あり / なし / 混在 / インデント付きフェンス / 引用配下フェンス / リスト配下フェンス / ネストフェンス除外 / エイリアス正規化 / 大文字混入 / 未サポート無視 / 空 markdown）

### Step 3: ビルド側 — grammar JSON の個別 emit + エイリアスマップ生成

- `vite.config.ts` に `dist/shiki-langs/<lang>.json` を emit する rollup plugin を追加（`shiki/langs/<lang>` を import → JSON として書き出し）
- 同じ plugin の prebuild フックで Shiki の `bundledLanguagesInfo` を読み、28 言語の `{ id, aliases }` から `{ alias → canonicalLang }` マップを構築し、`src/core/shiki-aliases.generated.ts` に書き出す。出力内容は次の 3 つ：
  - `SHIKI_SUPPORTED_LANGS`: 28 個の正規名 `as const` 配列
  - `ALIAS_TO_CANONICAL`: `Record<string, SupportedLang>` のエイリアスマップ（正規名自身も含む、`{ js: 'javascript', javascript: 'javascript', ts: 'typescript', typescript: 'typescript', ... }`）
  - 生成元 Shiki バージョンの comment header（バージョン差で挙動が変わった時の追跡用）
- `vite.review-request.config.ts` 側の external 設定を維持（CLI bundle に Shiki grammar は含めない、生成済み `shiki-aliases.generated.ts` のみ bundle）
- `src/core/shiki-aliases.generated.ts` は **生成物だが commit 対象**（CI 不在環境でも `npm run build` を介さず CLI / browser 両方が import できるよう）
- `npm run build` 後に `dist/shiki-langs/` が 28 ファイル、`src/core/shiki-aliases.generated.ts` が再生成されていることを確認

成果物：`vite.config.ts` 更新、`dist/shiki-langs/<lang>.json` 28 ファイル、`src/core/shiki-aliases.generated.ts`

### Step 4: CLI 側 — `--shiki-langs` オプションと grammar 注入

- `src/cli/parse-args.ts` に `--shiki-langs <mode>` を追加（`auto` 既定、`all` / `none` / `<csv>` を受け付け、不正値は exit 1 + stderr）
- `src/cli/review-request.ts` のエントリで scan + grammar 読み込み + embed 呼び出しを orchestrate
- `src/core/embed.ts` に `shikiLangs?: Record<string, unknown>` 引数を追加し、`<script id="embedded-shiki-langs" type="application/json">` を rewrite
- HELP_TEXT 更新：`--shiki-langs <auto|all|none|<csv>>` の意味と既定値を記述

成果物：CLI が markdown をスキャンして必要 grammar を埋め込めること（in-source test で `scanFencedLangs` 経路と `embed` 経路の両方を検証）

### Step 5: ブラウザ側 — 初期 render と Shiki upgrade の 2 段階構成

設計判断は §5.b の C 案（paint 後 lazy 初期化 + 各 `<pre>` 単位の upgrade）。Step 5a / 5b に分けて段階的に積む。

#### Step 5a: 初期 render は highlighter なしで即時 paint

- `src/app/shiki.ts`（新規）：
  - `getOrCreateHighlighter()` で lazy singleton 初期化（同期 API `createHighlighterCoreSync` を内部で使う）
  - `embedded-shiki-langs` が空 / 欠落なら null を返し、呼び出し側で plain fallback
  - 27 言語ホワイトリスト外の grammar が含まれていたら無視（CLI 出力の壊れ対策）
  - `highlightFenceWithShiki(highlighter, code, rawLang)` 単一フェンス用ヘルパ（`defaultColor: false` で span 側に CSS variable のみ書かせる）
- `src/core/markdown.ts` の marked renderer：
  - `CodeHighlighter` インターフェースを保持し、引数が `null | undefined` の場合は marked デフォルトの `<pre><code class="language-…">` 出力に倒す
  - 初期 render では呼び出し側が `null` を渡し、Shiki に触れずに plain HTML を即返す
- `src/app/doc-renderer.ts` の初期描画パス：
  - `renderMarkdown(state.markdown, null)` を同期で呼ぶ
  - `cacheBlockOriginalHTML` → `injectCopyButtons` → `buildBlockAnchors` → `reapplyAllMarks` まで従来どおり同期で完了させる
  - この時点で `loading spinner` を外して paint させる（spinner 表示時間は Shiki 初期化 cost ぶん短縮される）

#### Step 5b: paint 後の Shiki upgrade

- 同じ `doc-renderer.ts` に `upgradeFencesWithShiki(docEl)` を追加し、初期 render 完了後に schedule する
  - `requestAnimationFrame` × 2 で paint 確実後に実行（次フレームに 2 回 yield することで初回 paint を確実に完了させてから走る）
  - `window.getSelection().toString().length > 0` ならスキップし、`selectionchange` イベントで空に戻ったら次の rAF で再試行
- 実行内容：
  - `getOrCreateHighlighter()` を呼んで Shiki インスタンスを取得（null なら全コードブロックは plain text fallback で確定し、何もせず終了）
  - `docEl.querySelectorAll('pre > code[class*="language-"]')` で各フェンスを走査
  - 各 `<code>` の class から lang 識別子を取得し、`highlightFenceWithShiki(...)` で Shiki HTML を得る
  - Shiki HTML を `<template>.innerHTML` でパースして中の `<pre>` を取り出し、**元の `<pre>` の innerHTML を Shiki `<pre>` の innerHTML で上書き**、加えて Shiki が付ける class（`shiki` / `shiki-themes ...`）と `style` / `tabindex` 属性を転写
  - 元の `<pre>` 自体は残すため、`data-block-id` / 親 `.code-block-wrap` / Copy button は触らない（idempotent 化のために `data-shiki-applied="1"` を付ける）
- upgrade 後の cleanup：
  - `cacheBlockOriginalHTML` 相当のロジックで `state.blockOriginalHTML` を **新しい innerHTML（Shiki span 入り）で再構築**
  - `reapplyAllMarks()` を再呼び出し（embedded-feedback で起動時に貼った `<mark class="cmt">` を Shiki span の上に貼り直す）
- Shiki の出力 HTML には `<span style="...">` が含まれるが、CSP `style-src 'unsafe-inline'` で許可済み（§11）

成果物：

- 初回 paint は marked plain で素早く完了（embedded markdown ロードの spinner 表示時間が短縮される）
- paint 後 1-2 フレームで Shiki ハイライトが追加適用される
- embedded-feedback の `<mark class="cmt">` は upgrade 後も正しい位置に再貼付される
- 未対応言語は plain text fallback（upgrade フェーズで `highlightFenceWithShiki` が null を返して skip）

### Step 6: コピー button の動的注入

- `src/app/doc-renderer.ts` の `renderMarkdown` 後フックに `injectCopyButtons(docEl)` を追加：
  - `docEl.querySelectorAll('pre')` で全 `<pre>` を取得
  - 既にラップ済み（親が `.code-block-wrap` クラスを持つ）ならスキップ
  - そうでなければ `<div class="code-block-wrap">` で `<pre>` を wrap し、button を sibling として append
- button の構造：
  ```html
  <div class="code-block-wrap">
    <pre class="shiki ...">…</pre>
    <button type="button" class="code-copy-btn" aria-label="Copy code">
      <span aria-hidden="true">Copy</span>
    </button>
  </div>
  ```
- click ハンドラ：
  - `navigator.clipboard.writeText(preEl.textContent ?? '')` を呼ぶ
  - 成功時: button のラベルを「Copied」に 1.5 秒トグル
  - 失敗時: 既存 `toast` で「Copy failed」を表示（HTTPS / `file://` 以外で clipboard API が disable される環境向け）
- `src/styles/review.css` に `.code-block-wrap` / `.code-copy-btn` を追加：
  - ラッパ: `position: relative`
  - button: `position: absolute; top: 8px; right: 8px;`、既存 `.btn` 系トークンを再利用し dark 対応を継承

成果物：全 `<pre>` の右上に Copy button が出現し、1 クリックでコードがクリップボードに入ること

### Step 7: §1 Theming との連動（コードブロック背景は両モードで dark 固定）

- 設計方針：**コードブロック背景は light / dark 共通で dark トークン (`--doc-code-bg`) に固定する**（DESIGN.md §1 Theming の `--doc-code-bg` 例外。IDE / Discord / Notion 等の慣行に揃える）。これに合わせてシンタックスハイライト配色も両モードで `--shiki-dark` のみを採用し、`--shiki-light` は CSS 側で不採用とする
- `src/styles/markdown.css` に Shiki 用ルールを追加：
  ```css
  #doc pre.shiki {
    background: var(--doc-code-bg);
    color: var(--doc-code-ink);
  }
  /* 背景が両モードで dark 固定のため、light/dark を切り分けず --shiki-dark のみ採用 */
  :where(#doc) pre.shiki span {
    color: var(--shiki-dark);
  }
  ```
  `:where()` で詳細度ゼロにしているのは §1 Theming と同じカスタマイズ容易性の方針
- Shiki への `defaultColor: false` で span 側に直接 `color: #...` が書かれないため、CSS variable 参照のみで上書きが完結し `!important` は不要
- dual theme の出力構造 (`--shiki-light` / `--shiki-dark` 両併存) は将来「light モードでコードブロック背景を明色化する」方針に切替えた時に CSS だけで対応できるよう温存する
- `<html>.dark` クラスの変化は `subscribeSystemTheme` で検知済みだが、本ルールは light/dark どちらでも同じ値を採用するためトグル時の再描画は発生しない

成果物：light / dark どちらのテーマでもコードブロックが dark 背景 + dark 系ハイライトで一貫描画される

### Step 8: §6 アンカリングと C 案 upgrade 順序の維持確認

- §6 のブロックフラットテキストオフセット計算は `range.startContainer.textContent` ベースで動くため、Shiki が `<pre><code>` 内に `<span>` 階層を追加しても **計算結果は不変**
- ただしコピー button のテキスト「Copy」が `<pre>` の `textContent` に混入するのを構造的に避ける必要があるため、button を **`<pre>` の外側ラッパに置く**（§5.c）。`selection.ts` の `textSegments` は既に `.code-copy-btn` 配下を skip する設計なので、ハイライト適用前後で計算結果が一致する
- C 案 upgrade 後の mark 再適用順序の検証：
  - 初期 render → mark 適用済みの状態（embedded-feedback 経路）から upgrade を走らせ、`<pre>` 内の `<mark class="cmt">` が一度消えた後に正しい位置で復元されること
  - `blockOriginalHTML` が Shiki span 入りの新 innerHTML に上書きされたあと、`reapplyAllMarks` が新 HTML を起点に mark を貼ること（古い plain `<pre>` HTML を保持していないこと）
  - upgrade 中に選択操作を始めた場合に upgrade が後送りされ、選択を解除した瞬間に upgrade が完了すること
- in-source test に追加：
  - `<pre>` 内に Shiki span が入っている状態でも `startOffset` / `endOffset` の計算が壊れないこと（`core/block-anchors.ts` / `app/selection.ts` に 1 ケース）
  - `doc-renderer.upgradeFencesWithShiki` 適用後の `blockOriginalHTML` が Shiki span 入りで再構築されること（`app/doc-renderer.ts` に 1 ケース）
  - upgrade を 2 回呼んでも `data-shiki-applied="1"` ガードで二重適用にならないこと（idempotent）

成果物：既存コメントが付いた markdown を再読込しても `<mark class="cmt">` が正しい位置に再適用されること、upgrade 前後で Range / Selection の整合性が保たれること

### Step 9: DESIGN.md 反映と本ドキュメントの role 切替

- DESIGN.md §12 表の「§2 Code Block Rendering」行を「準拠」に書き換え
- DESIGN.md §3 review-request CLI コマンド仕様に `--shiki-langs <auto|all|none|<csv>>` を追記
- DESIGN.md §11 セキュリティ: Shiki 出力 HTML を `innerHTML` で挿入する経路と CSP `style-src 'unsafe-inline'` の根拠に「Shiki ハイライト span の inline style 用」を 1 行追記
- DESIGN.md §13 ビルドパイプライン: `dist/shiki-langs/` の出口を §13 全体像と表に追加
- DESIGN.md §14 ファイル構成: `src/core/scan-fenced-langs.ts` / `src/app/shiki.ts` / `dist/shiki-langs/` を追加
- 本ドキュメントは `.archive.md` リネームで残す（§1 Theming と同じ扱い）

成果物：DESIGN.md 更新 + 本ドキュメントの archive

## 5. 設計判断

### a. ライブラリ選定：Shiki（vs Prism / highlight.js）

| 候補         | 採用 | 理由                                                                                                                                                                  |
| ------------ | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Shiki**    | ✓    | TextMate grammar ベースで VS Code と同等のハイライト品質。dual theme が CSS variables 経由でテーマ切替可能。リファレンス実装と同一ライブラリで挙動差異が少ない        |
| Prism        | ✗    | regex ベースで複雑な構文（TSX 内 JSX 内 template literal 等）の品質が落ちる。dark / light は CSS の 2 ファイル切替で MDXG Redline の `:where(.dark)` 方針と相性が悪い |
| highlight.js | ✗    | 自動言語検出が魅力的だが、bundle サイズ削減のためには言語明示が前提で結局メリットが小さい。テーマ切替は Prism と同様の問題                                            |

dual theme の出力形式（同じ `<span>` に light / dark 両方の色を CSS variable として持たせる）は **CSS だけで切替可能** で、JS 側の再描画が不要。`html.dark` 切替時の反応性が最も良い。

### b. Shiki 初期化のタイミング：paint 後の lazy singleton + 各 `<pre>` 単位の upgrade

| 候補                                                                | 採用 | 理由                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. `createHighlighterCoreSync` で同期初期化                         | ✗    | 実装は最も単純で順序問題が起きないが、Shiki 初期化（27 言語 grammar の parse + JS engine 構築 + 2 テーマ ロード）が paint 前に同期で走るため、`loading spinner` 表示時間 = Shiki 初期化 cost ぶん延びる。embedded markdown ロード時に体感できる FCP 劣化が出る                                                                                                                   |
| B. `createHighlighter` (async) + marked のラップ                    | ✗    | renderer 全体を async にすると `doc-renderer.ts` / `boot.ts` の同期前提が崩れ、再描画フックの順序保証が複雑になる。FCP を稼ぐ目的は C 案で達成できるため、renderer 自体を async 化するコストを払う動機がない                                                                                                                                                                     |
| **C. 同期 API を paint 後に lazy 呼び出し + 各 `<pre>` を upgrade** | ✓    | 初期描画は `highlighter = null` で marked の `<pre><code class="language-X">` を即座に出して FCP を稼ぐ。`requestAnimationFrame` 2 回（= paint 確実）の後に `createHighlighterCoreSync` を初期化し、各 `<pre>` の innerHTML を Shiki 出力で差し替えて upgrade する。`<pre>` 自身は残すため `data-block-id` / wrap / Copy button はそのまま、ハイライトだけが後付けで載る形になる |

C 案の論点と mitigation：

- **「ハイライト無 → 有のちらつき」**: コードブロック背景は §1 Theming の `--doc-code-bg` 例外で両モードとも dark 固定なので、plain `<pre>` も Shiki `<pre>` も背景は同色。差分は文字色（dark ink → syntax 色）のみで、視覚的には「色が薄く乗る」程度の変化に収まる
- **選択中の DOM 差し替えで Range が消える**: upgrade 実行時に `window.getSelection().toString().length > 0` ならスキップし、`selectionchange` で空に戻ったら次の rAF で再試行する。レビュアーが選択操作中はハイライト適用を後送りする
- **既存 `<mark class="cmt">` の消失**: embedded-feedback で起動時に mark を付けたあとに upgrade が走ると、`<pre>` 内の `<mark>` は innerHTML 差し替えで消える。upgrade 後に `state.blockOriginalHTML` を **新しい innerHTML（Shiki span 入り）で再構築** してから `reapplyAllMarks()` を呼び直すことで、mark を Shiki span の上にもう一度貼り直す。`mark-engine` の再適用は blockOriginalHTML を innerHTML に書き戻す既存ループに乗るため、追加で順序保証ロジックを書かない
- **§6 アンカリングの維持**: ブロックフラットテキストのオフセット計算は `textContent` ベースで動くため、Shiki span の追加で値は変わらない（既存設計と同じ）

`createHighlighterCoreSync` の前提：grammar JSON が **オブジェクトとして既に同期で渡せる状態** であること。`embedded-shiki-langs` を `JSON.parse` する段で同期に取得できるため成立する。WASM engine ではなく **JS engine** (`shiki/engine/javascript`) を採用することで WASM 非同期初期化も回避する。C 案でも同期 API を採用するのは、paint 後の単一フレーム内で 27 言語 grammar の parse まで完了させた方が、async/await 連鎖による追加 microtask hop を避けられて単純だからである。

### c. コピー button の DOM 配置：`<pre>` の外側ラッパに absolute 配置

| 候補                                                      | 採用 | 理由                                                                                                                                                                                                 |
| --------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. `<pre>` を `<div class="code-block-wrap">` で wrap** | ✓    | button が `<pre>` の `textContent` に混入しないため、§6 のブロックフラットテキストオフセット計算が壊れない。コピー時に `preEl.textContent` をそのまま渡せばよく、button ラベル除外の特殊ロジック不要 |
| B. `<pre>` の内側に button を子要素として挿入             | ✗    | `<pre>` の `textContent` に「Copy」が混入し、§6 の startOffset / endOffset が壊れる。除外ロジックを毎回挟む必要があり、コメント選択フローが脆くなる                                                  |
| C. button を別レイヤ（`<body>` 直下）にして座標追従       | ✗    | スクロール / リサイズ / サイドバー幅変更で追従が複雑化し、メリットがない                                                                                                                             |

A 案は `injectCopyButtons` が `<pre>` の親を確認して未 wrap なら wrap する idempotent 設計にすれば、再描画でも重複生成しない。

### d. テーマ切替方式：Shiki dual theme 出力を保持しつつ CSS 側で dark のみ採用

Shiki の dual theme は出力 `<span>` の `style` 属性に `--shiki-light: #...; --shiki-dark: #...;` の両方を埋め込む。MDXG Redline は **コードブロック背景を light / dark 共通で dark に固定する** デザイン方針（DESIGN.md §1 Theming の `--doc-code-bg` 例外）を採るため、CSS 側では light/dark セレクタを切り分けず `:where(#doc) pre.shiki span { color: var(--shiki-dark); }` の単一ルールで `--shiki-dark` のみを採用する。

dual theme の出力構造自体は温存する。理由：

- 将来「light モードではコードブロック背景も明色化する」方針に切替える可能性が残る場合、CSS ルールだけで `:where(:not(.dark)) #doc pre.shiki span { color: var(--shiki-light); }` を追加すれば対応できる（再描画不要）
- Shiki single theme への変更は CSS 側の変更だけでは戻せず、`shiki.ts` の初期化を書き換える必要があるため可逆性が低い

`defaultColor: false` を Shiki に渡すことで、`color: #...` が直接 inline で書かれず CSS variable 経由になる。これにより：

- CSS 側で `!important` 無しに色を上書きできる
- DOM 再構築不要（テーマ方針を将来切替えても CSS だけで済む）
- Shiki インスタンスは light / dark で 1 つだけ（メモリ・初期化コストが半減）

### e. CLI 既定値は `auto`：オプトインなしで最小サイズ

`--shiki-langs` 未指定時の既定挙動：

| 候補                  | 採用 | 理由                                                                                                          |
| --------------------- | ---- | ------------------------------------------------------------------------------------------------------------- |
| **auto（スキャン）**  | ✓    | 配布物サイズが最小化される（仕様書系で 0 KB、コード混入で 100〜300 KB）。配布者が何も考えなくても最適化が効く |
| all（全 28 言語注入） | ✗    | デフォルトで +3〜5 MB は配布物が重すぎる。「とにかく動く」より「最小配布」を優先                              |
| none                  | ✗    | デフォルトでハイライトが消えるのは MDXG §2 [MUST] 要件に反する                                                |

`auto` の検出漏れ（fence 内 fence やコメント内コードなど）が問題になる場合は `--shiki-langs=<csv>` で明示指定すれば良い。

### f. 未対応言語の扱い：plain text fallback、警告は出さない

CLI スキャン時に 28 言語ホワイトリスト外の識別子が見つかった場合：

- **CLI**: 警告 stderr を出さず、単に注入対象から外す（既存 markdown は変更しない）
- **ブラウザ**: 未対応言語のフェンスは marked デフォルトの `<pre><code class="language-…">` で描画（plain text）

警告を出さない理由：MDXG レビュー対象は LLM 生成物で、フェンス言語識別子が日本語混入や typo を含むケースが多い。stderr に毎回出ると CLI の出力が冗長化し、ユーザーが本質的なエラーを見落とす。将来 `--strict-langs` のような opt-in で警告するオプションを追加する余地は残す。

### g. コピー成功フィードバック：button ラベルの 1.5 秒トグル（toast を出さない）

| 候補                              | 採用 | 理由                                                                                            |
| --------------------------------- | ---- | ----------------------------------------------------------------------------------------------- |
| **button ラベル「Copied」トグル** | ✓    | リファレンス実装と同じ。クリックした button の上で完結し、視線移動なし                          |
| toast 通知                        | ✗    | コピーは頻繁な操作で、毎回 toast が出ると煩わしい。toast は失敗時のフォールバックとしてのみ使用 |
| 何も出さない                      | ✗    | フィードバックなしだとユーザーがコピー成功を確信できず、もう一度クリックする                    |

失敗時（HTTPS / `file://` 以外で `navigator.clipboard.writeText` が拒否される等）は toast で「Copy failed. Select the text manually.」を表示。

### h. Shiki 出力の信頼境界：grammar は Shiki が生成、innerHTML 挿入を許容

Shiki が `codeToHtml` で生成する HTML は **Shiki 自身がエスケープした安全な出力** で、入力コードの `<` / `>` / `&` は実体参照化される。インラインで `<script>` や event handler が出力される経路は存在しない。

したがって `<pre>` 部分は `innerHTML` 経由で挿入してよい。MDXG Redline 既存の §11 raw HTML escape ポリシー（「LLM 生成 markdown は信頼しない」）と矛盾しないのは、escape の責務が **入力 markdown の raw HTML** に対するもので、Shiki 出力は **MDXG Redline 自身が制御する DOM** だからである。

CSP `style-src 'unsafe-inline'` は §1 Theming 導入時に既に許可済みで、Shiki が `<span style="color:...">` を出力する経路もこの許可範囲内で動作する。

### i. embedded-shiki-langs のエンコード規約：embedded-md と同じ `<` 置換方式

`<script id="embedded-shiki-langs" type="application/json">…</script>` に grammar JSON を埋め込む際、内容に `</script>` を含む可能性を構造的に塞ぐ。

`JSON.stringify(grammars).replace(/</g, '\\u003c')` で `<` を Unicode escape し、HTML パーサが `</script>` を閉じタグとして誤検出しないようにする。復元側は `JSON.parse` だけで grammar オブジェクトに戻る。

これは既存 `embedded-md` のエンコード規約と同じパターンで、`src/core/embed.ts` に共通 helper を切り出して両方から再利用する。

### j. 言語エイリアスの正規化：Shiki メタデータから自動生成

`ts` / `js` / `sh` / `yml` / `py` / `rb` などの短縮形は GFM の事実上の慣習で、LLM 生成 markdown でも頻出する。これらを正規化せず 28 個の「正規名」だけを比較すると、`auto` スキャンで grammar が注入されず、ハイライト付き識別子が plain fallback に落ちて MDXG §2 [MUST] を実質満たせなくなる。

| 候補                                                 | 採用 | 理由                                                                                                                                                                                                                                      |
| ---------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Shiki メタから自動生成（generated.ts）**        | ✓    | Shiki が各言語の `aliases: string[]` をメタとして持っているため、ビルド時に `bundledLanguagesInfo` を読めば 1 箇所で全エイリアスが揃う。同梱言語を増減した時にもメタ抽出だけでマップが追従し、手動メンテのドリフトが起きない              |
| B. 手動マップ（頻出のみ）                            | ✗    | `ts` / `js` 等の主要分は覆えるが、Shiki が追加でサポートするエイリアス（`shellscript → bash`、`cs → csharp` 等）を漏らす。Shiki version up に追従できない                                                                                 |
| C. 識別子をそのまま Shiki に渡し、Shiki に解決させる | ✗    | Shiki 側で解決はされるが、`scanFencedLangs` / CLI `--shiki-langs=<csv>` の段で「どの grammar JSON を注入するか」を決められない（注入は CLI ビルド時の決定で、解決は browser 側の Shiki インスタンス）。注入経路と解決経路の責務が分裂する |

採用は **A 案**。`src/core/shiki-aliases.generated.ts` をビルド時に再生成し、`SHIKI_SUPPORTED_LANGS` 配列と `ALIAS_TO_CANONICAL` マップを export する。

- **生成元**: `shiki/dist/langs-bundle-all.mjs` 等の `bundledLanguagesInfo` から、`SHIKI_SUPPORTED_LANGS` に含まれる 28 言語ぶんの `{ id, aliases }` を抽出
- **マップ内容例**:
  ```ts
  export const ALIAS_TO_CANONICAL: Record<string, SupportedLang> = {
    js: 'javascript',
    javascript: 'javascript',
    ts: 'typescript',
    typescript: 'typescript',
    py: 'python',
    python: 'python',
    sh: 'bash',
    bash: 'bash',
    shellscript: 'bash',
    yml: 'yaml',
    yaml: 'yaml',
    rb: 'ruby',
    ruby: 'ruby',
    // …
  }
  ```
- **正規名同士の衝突**（同じエイリアスが複数言語に紐づく場合）: Shiki 内部で priority を持っているため、`bundledLanguagesInfo` の順序で先勝ち。28 言語スコープ内では実用上の衝突はない見込み（PoC で確認）
- **commit 対象**: 生成物だが `src/` 配下に置き commit する。理由は CI 不在環境（手元の `vp build` だけで完結する開発フロー）でも CLI / browser 両方が import できる必要があり、`dist/` 配下に置くと CLI bundle 経路が複雑化するため
- **再生成のトリガ**: Shiki version up 時 / 同梱言語の増減時。`vite.config.ts` の grammar emit plugin の prebuild フックで毎ビルド再生成し、diff が出たら commit する運用

CLI `--shiki-langs=<csv>` も同じ `ALIAS_TO_CANONICAL` を通すため、`ts,js,py` のような短縮形指定で正規名 grammar が注入される。

### k. スキャン方式：marked.lexer ベース（自前 regex を採用しない）

`auto` スキャンの方式比較：

| 候補                           | 採用 | 理由                                                                                                                                                                                                                                                       |
| ------------------------------ | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. `marked.lexer` AST walk** | ✓    | GFM のインデント付きフェンス（リスト配下 / 引用配下）/ ネストフェンスの判定が marked 側で完結する。CLI bundle に marked は既に含まれており（`src/core/markdown.ts` / `src/core/block-anchors.ts` が依存）追加コストゼロ。`block-anchors.ts` と同じパターン |
| B. 自前 regex（行頭フェンス）  | ✗    | 行頭 ```/`~~~` だけだとリスト配下 / 引用配下のフェンスを取りこぼし、`auto` 既定でサイレントに ハイライト消失する。GFM 仕様の細部追従コストが将来恒久的に発生する                                                                                           |
| C. 自前 regex（拡張版）        | ✗    | 任意の先頭空白 / `>` quote prefix を許容するなど regex を膨らませる方向。最終的には marked と同等の処理を再実装することになり、車輪の再発明                                                                                                                |

A 案の懸念は marked のバージョン差で挙動が変わる可能性だが、これは既に `core/markdown.ts` の renderer で抱えている依存リスクと同じスコープで、追加リスクにならない。

## 6. テスト方針

### in-source test（新規）

- `core/scan-fenced-langs.ts`：
  - `marked.lexer` 経路でのフェンス検出（` ` ```/`~~~` の両方）
  - インデント付きフェンス検出（リスト配下: `- item\n  ` ```ts \n…）
  - 引用配下フェンス検出（`> ` ```js \n…）
  - リスト + 引用の二重ネスト
  - ネストされたフェンス（` `markdown `内の` `js `）が marked 仕様に従って正しく扱われる
  - エイリアス正規化（`ts → typescript` / `js → javascript` / `sh → bash` / `yml → yaml` / `py → python` / `rb → ruby` / `shellscript → bash`）
  - 大文字混入の小文字化（`JS` / `Python` / `TypeScript` → 正規名）
  - 28 言語ホワイトリストフィルタ（未サポート識別子を除外、エイリアスも未サポートなら除外）
  - 言語識別子なし / 空 markdown / 言語識別子のみで本文空
  - `normalizeLangIdentifier` 単独テスト（CLI csv パースで再利用される正規化単体）

- `core/shiki-aliases.generated.ts`（生成物の sanity check）：
  - 28 個の正規名がすべて `SHIKI_SUPPORTED_LANGS` に含まれる
  - 主要エイリアス（`ts` / `js` / `py` / `sh` / `yml` / `rb`）が `ALIAS_TO_CANONICAL` に存在し、正しい正規名にマップされる
  - 正規名自身もマップに含まれる（`javascript → javascript`）

- `core/embed.ts`：
  - `shikiLangs` 渡したときに `<script id="embedded-shiki-langs">` ブロックが書き込まれる
  - `shikiLangs` 未指定時には `<script id="embedded-shiki-langs">` ブロックが付かない（空ブロックを書くか、ブロック自体を書かないかは実装判断、テストで明確化）
  - 値の `<` が `<` にエスケープされる
  - 不正値（プロトタイプ汚染、シンボリック参照）が型ガードで弾かれる

- `cli/parse-args.ts`：
  - `--shiki-langs auto` / `all` / `none` / `js,ts,python` がパースされる
  - `--shiki-langs ts,js,py,sh,yml,rb` がエイリアス正規化を経由して正規名集合になる（`{typescript, javascript, python, bash, yaml, ruby}`）
  - `--shiki-langs typescript,ts` のように正規名 + エイリアス重複指定で重複排除される
  - `--shiki-langs nim,brainfuck` のように未サポート言語のみ指定で空集合になり、`none` と同等の動作になる（exit 1 ではなく warn 程度、または `none` フォールバック。実装時に決める）
  - `--shiki-langs invalid-mode-keyword` のような **モード名と紛らわしいが言語識別子としても無効** な値の扱いを決め、テストで明確化（`auto` / `all` / `none` 以外のモードキーワードは csv として解釈する方針）
  - `--shiki-langs` 未指定時は `auto` 既定

- `app/shiki.ts`：
  - `embedded-shiki-langs` が空 / 欠落のとき `getOrCreateHighlighter()` が null を返す
  - 28 言語ホワイトリスト外の grammar は無視される

- `core/markdown.ts`：
  - highlighter が null のときコードブロックは plain text fallback
  - highlighter ありで未対応言語のフェンスも plain text fallback
  - highlighter ありで対応言語のフェンスは Shiki の HTML が inline される
  - インラインコード `` `code` `` はハイライトされない（フェンスのみ対象）

- `app/doc-renderer.ts`（既存テストに追加）：
  - `injectCopyButtons` が idempotent（2 回呼んでも button が重複しない）
  - wrap 後の構造が `<div class="code-block-wrap"><pre>…</pre><button>…</button></div>`
  - `<pre>` の `textContent` に「Copy」が含まれない

### 手動視覚チェックリスト

`npm run build` 後、CLI 経由で配布 HTML を生成して以下を確認：

- [ ] `node dist/review-request.mjs sample.md` で生成した HTML を Chromium で開き、JavaScript / TypeScript のフェンスが Shiki ハイライト付きで描画される
- [ ] 同 HTML を OS dark で開いた時に Shiki ハイライトが github-dark で表示される
- [ ] toggle で `system → light` した時、Shiki ハイライトが github-light に切り替わる（DOM 再構築なし）
- [ ] 各 `<pre>` の右上に Copy button が出現する
- [ ] button をクリックして「Copy → Copied」が 1.5 秒トグル、クリップボードに `<pre>` の textContent だけが入る（「Copy」ラベル文字列が混入しない）
- [ ] コード内でテキスト選択 → `+ Comment` → コメント追加 → 再描画後も `<mark class="cmt">` が同じ位置に出る
- [ ] 未対応言語（例: ` `nim ```）が plain text として描画される
- [ ] CLI を介さず `dist/review.html` を直接ダブルクリックで開いた場合、全コードブロックが plain text fallback（既存挙動と同等）
- [ ] `--shiki-langs=all` で生成した HTML のサイズが見積もり通り（~1.5 MB gzipped）
- [ ] `--shiki-langs=none` で生成した HTML が `auto` と同じサイズ（grammar 注入なし）
- [ ] `--shiki-langs=js,ts` で明示指定した言語だけが注入される（正規名に正規化）
- [ ] エイリアス識別子（` `ts `/` `py ` / ` `sh `/` `yml `）のフェンスが `auto` でハイライト付きで描画される
- [ ] インデント付きフェンス（リスト配下・引用配下）の言語識別子も `auto` で正しく注入対象になる
- [ ] `dist/review.html` の Shiki core + 2 テーマ ぶんのサイズ増分が見積もり通り（+150〜300 KB gzipped）
- [ ] Embedded markdown 同梱 HTML をダブルクリック起動した時に FOUC が出ない（Shiki 初期化が paint 前に完了）

## 7. 受け入れ基準

- MDXG §2 の 4 要件をすべて満たす（§1 冒頭の対応スコープ表が全て ✓）
- 既存の plain text 描画から視覚回帰がない（言語識別子なしブロックは既存と同等の見た目）
- `dist/review.html` のサイズ増分が **+300 KB gzipped 以内**（Shiki core + 2 テーマぶんのみ）
- `auto` 既定での典型配布物（仕様書系）のサイズ増分が **+0 KB**
- §6 アンカリングが壊れない（既存 in-source test が全て通過 + 新規追加分も通過）
- §1 Theming の dark 連動が DOM 再構築なしで動く
- **エイリアス短縮形（`ts` / `js` / `py` / `sh` / `yml` / `rb` 等）が `auto` で正規名に正規化され、grammar が注入されて Shiki ハイライト付きで描画される**
- **インデント付きフェンス（リスト配下・引用配下）の言語識別子も `auto` の検出対象になる**
- DESIGN.md §12 表の「§2 Code Block Rendering」が「準拠」に書き換わる

## 8. 想定リスクと回避策

| リスク                                                                             | 回避策                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createHighlighterCoreSync` が想定どおり同期初期化できない（Shiki API 変更）       | Step 1 の PoC で検証。同期 API がなければ §5.b の Option B (async + 初期描画ブロッキング) にフォールバック。`boot.ts` を async 化し、Shiki 初期化を待ってから `loadFromMarkdown` を呼ぶ                                                                                                                                                                                 |
| grammar JSON のサイズが見積もりより大きい                                          | Step 1 で 28 言語ぶん実測。CLI 既定 `auto` で典型ケースが影響を受けないため、`all` ケースの数字が見積もりからずれても致命的ではない                                                                                                                                                                                                                                     |
| `<pre>` の dark 背景 (`--doc-code-bg = #0d0d0d`) と Shiki github-dark の背景の差異 | §1 Theming で導入済みの `--doc-code-bg` を Shiki ハイライト span の親に適用、span 自体の背景は透明にする CSS で吸収。Shiki `--shiki-dark-bg` を採用しないことで `--doc-code-bg` の値が優先される                                                                                                                                                                        |
| `injectCopyButtons` の wrap が既存コメント `<mark class="cmt">` を壊す             | `<mark>` 再適用は `<pre>` 内部の構造に対して行われ、`<pre>` を外側で wrap しても `<pre>.textContent` は変わらない。`mark-engine` のテストに「Shiki ハイライト後 + ラッパ追加後でも `<mark>` 適用が動く」ケースを追加                                                                                                                                                    |
| 27 言語以上を同梱した CLI 経由配布物が gzipped 1.5 MB を超える                     | 実測後に grammar 圧縮率を確認。1.5 MB を大きく超える場合は「サブセット推奨」を CLI HELP に明記し、ユーザーに `--shiki-langs=<csv>` を促す                                                                                                                                                                                                                               |
| Shiki dual theme の `--shiki-light` / `--shiki-dark` CSS variable が将来仕様変更   | Shiki major version を pin。変更時は本ドキュメントの §5.d を再評価                                                                                                                                                                                                                                                                                                      |
| 未対応言語識別子が大量に検出されて `auto` でも肥大化                               | 28 言語ホワイトリストフィルタが構造的に防ぐ（未対応は注入対象から外れる）                                                                                                                                                                                                                                                                                               |
| `dist/shiki-langs/` の存在で `dist/` の commit 差分が大量化                        | 受け入れる。`dist/shiki-langs/` も `dist/review.html` / `dist/review-request.mjs` と同じく commit 対象とすることで、「clone 直後に `npm run build` 抜きで CLI が動く」という配布契約を保つ。Shiki version pin により頻繁な差分は出ず、~6 MB の追加 commit 容量は許容範囲。フェールセーフとして CLI 側で grammar JSON 欠落時の ENOENT → "npm run build" 案内エラーも残す |
| `clipboard.writeText` が `file://` で動かない（一部ブラウザ）                      | フォールバックとして toast「Copy failed. Select the text manually.」を表示。`document.execCommand('copy')` 経由のフォールバックは deprecated のため採用しない                                                                                                                                                                                                           |
| Shiki 初期化失敗時にコードブロックが全部消える                                     | `getOrCreateHighlighter` を try / catch で囲み、失敗時は null を返し plain text fallback。失敗時 toast「Syntax highlighting disabled.」を表示                                                                                                                                                                                                                           |
| Shiki の `bundledLanguagesInfo` 形式が将来変更される（§5.j のエイリアス自動生成）  | `vite.config.ts` の grammar emit plugin の prebuild フックで型エラー化させて検出。生成失敗時は ビルド全体を落とすことで silent な regression を防ぐ。`shiki-aliases.generated.ts` の生成元 Shiki バージョンを comment header に書き出し、追跡可能にしておく                                                                                                             |
| `marked.lexer` のバージョン差でフェンス検出が壊れる（§5.k）                        | marked は既に `core/markdown.ts` / `core/block-anchors.ts` で依存しており、同じ範囲のリスク。`scan-fenced-langs.ts` の in-source test に GFM 構文の代表ケース（インデント / 引用 / ネスト）を網羅しておくことで marked update 時の回帰を即検知                                                                                                                          |
| エイリアス未対応のため `auto` でハイライトが消える（フィードバック High 起因）     | §5.j のエイリアス正規化を Step 2 / Step 3 で必ず実装。受け入れ基準に「`ts` / `js` / `py` / `sh` / `yml` / `rb` 短縮形が `auto` で正しく注入される」ことを明示                                                                                                                                                                                                           |

## 9. 参考

- [MDXG §2 Code Block Rendering（日本語訳）](./mdxg/01-rendering.md#2-code-block-renderingコードブロック描画)
- [vercel-labs/mdxg リファレンス実装](https://github.com/vercel-labs/mdxg)
- [Shiki ドキュメント](https://shiki.style/) — `createHighlighterCoreSync` / dual theme / `shiki/engine/javascript`
- [DESIGN.md §12 MDXG 準拠ロードマップ](./DESIGN.md#12-mdxg-準拠ロードマップ今後の拡張)
- [DESIGN.md §6 コメントのアンカリング](./DESIGN.md#6-コメントのアンカリング)
- [DESIGN.md §11 セキュリティとプライバシー](./DESIGN.md#11-セキュリティとプライバシー)
- [DESIGN.md §13 ビルドパイプライン](./DESIGN.md#13-ビルドパイプライン)
- [docs/mdxg-rendering-theming-design.archive.md](./mdxg-rendering-theming-design.archive.md) — §1 Theming の完了済み設計プラン（本ドキュメントのフォーマット参考元）
