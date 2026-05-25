# MDXG §14 Math Rendering 対応 設計・実装計画

DESIGN.md §12「その他の拡張候補」の「MDXG §14 Math Rendering の対応」項目を実装に落とすための設計判断と実装手順をまとめる。完了時点で本ドキュメントは DESIGN.md §12 表に「§14 Math Rendering」行を追加して「準拠」に塗り替え、本ファイルは `docs/mdxg-math-rendering.archive.md` にリネームしてアーカイブする想定（`docs/mdxg-rendering-code-block.archive.md` と同じ扱い）。

## 1. 対応スコープ

[MDXG §14 Math Rendering](./mdxg/05-extensions.md#14-math-rendering数式描画) の 5 要件を、`$...$` / `$$...$$` 文法に対して満たす。

| 要件                                                                        | 現状 | 完了条件                                                                                                                                                                                               |
| --------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [SHOULD] `$...$` で囲まれたインライン数式が周囲のテキストとインラインに描画 | 未   | review-request CLI に `--math` flag を追加し、明示指定時のみ KaTeX を `<script id="embedded-katex">` と `<style id="embedded-katex-css">` に注入。`$...$` を `<span class="katex">` として inline 描画 |
| [SHOULD] `$$...$$` で囲まれた表示数式が中央寄せのブロックとして描画         | 未   | 同上の経路で `$$...$$` を `<div class="katex-display">` として中央寄せ描画                                                                                                                             |
| [MUST] 数式描画未サポート時に生の文法を保持                                 | ✓    | `--math` 未指定時は `$...$` / `$$...$$` を marked のデフォルト挙動どおり plain text として描画する経路で満たす。回帰させない                                                                           |
| [MUST NOT] ストリップ / 隠蔽 / 文字化け                                     | ✓    | 同上。回帰させない                                                                                                                                                                                     |
| [SHOULD] 数式の描画スタイルがホストのフォントサイズと色スキームに適応       | 未   | KaTeX 既定 CSS に加えて `color: var(--ink)` / `font-size: 1em` を上書きルールとして `src/styles/markdown.css` に追加。`html.dark` 切替で `--ink` の値が変わるだけで追従                                |

追加実装（規格上は SHOULD 未満だが UX 上有用）：

- **upgrade 失敗時の plain text fallback 表示**：KaTeX のパースエラー（不正な LaTeX 構文 / 未対応コマンド）時に、元の `$...$` テキストを残したまま toast で「Math render failed」を通知する。MDXG §14 [MUST] 「数式描画がサポートされていない場合、生の文法はそのまま保持される」を「サポートされているが入力が壊れている場合」にも適用する解釈（§15 Diagram Rendering と同じパターン）
- **`\$` でのエスケープ対応**：本物のドル記号（金額表記 `$100` / 環境変数 `$PATH` 等）を数式判定から除外。`\$` を literal `$` として描画する経路を確保

スコープ外（別タスクで扱う）：

- **MathJax / サーバサイド SVG レンダリング**（§14.2 実装例のうち KaTeX 以外）：本実装は単一 HTML 配布の制約があり、KaTeX 同期 API と JS engine ベースで完結する経路が最も整合的。MathJax は async API + 遅延描画が主流で `doc-renderer.ts` の同期前提と衝突する。需要が出てから検討
- **数式へのコメント付与（粒度最小単位 = 数式全体）**：§6 アンカリングはテキスト範囲ベース。`<span class="katex">` 配下の MathML / HTML ツリーに startOffset / endOffset を貼る経路は持たない。本実装では「数式が含まれる段落 / 行に対して通常のテキストコメントを付ける」経路に倒し、数式そのものへの直接コメントは対応外とする
- **MathML 直接記法 (` ```math ` フェンス) のサポート**：MDXG §14 は `$...$` / `$$...$$` のみを規定し、` ```math ` フェンスは MAY 未満。対応するなら別タスク

## 2. リファレンス実装と差分

[vercel-labs/mdxg `apps/web`](https://github.com/vercel-labs/mdxg/tree/main/apps/web) は §14 を実装していない（数式は marked デフォルトの plain text として表示される）。本実装はリファレンス実装の先行参考が無い領域となるため、本章は「ベースラインアーキテクチャ」として既存実装と KaTeX 公式の組み合わせを記述する。

| 既存実装の構成要素                                     | 本実装の置換 / 追加                                                                                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shiki upgrade の 2 段構成（plain → highlight）         | 初期 render では `$...$` を escape したまま `<span data-math="inline">` / `<div data-math="display">` として出力し、upgrade で KaTeX HTML に置き換える同じパターン |
| `dist/shiki-langs/<lang>.json` の言語別 emit           | `dist/katex/katex.mjs` + `dist/katex/katex.css` の 2 ファイルを別 emit（`--math` opt-in でのみ HTML に注入）                                                       |
| CLI `--shiki-langs <auto\|all\|none\|<csv>>` の opt-in | CLI `--math` boolean flag を追加。`auto` 検出は採用しない（`$` 文字は通常文中での頻出のため誤検出リスクが高い）                                                    |
| `<script id="embedded-shiki-langs">` JSON 注入         | `<script id="embedded-katex" type="module">` で KaTeX ESM、`<style id="embedded-katex-css">` で CSS を注入                                                         |
| `core/markdown.ts` renderer の言語別分岐               | marked の `text` / `paragraph` トークン処理で `$...$` / `$$...$$` をスキャンし、escape したまま `<span data-math>` / `<div data-math>` として出力                  |
| Shiki upgrade フェーズ                                 | `src/app/katex.ts`（新規）の lazy upgrade フェーズで `requestIdleCallback` 後に KaTeX HTML を生成                                                                  |

リファレンス実装が §14 を実装していない理由は推測になるが、KaTeX のフォント資材 (~250 KB woff2 / 4 family) を単一 HTML に inline するコストと、`$` 文字の誤検出リスクを踏まえると、本実装の CLI opt-in 設計は妥当な選択となる。Mermaid (§15) と同じく「default ON」にはせず、配布者が明示的に必要としたときだけ載せる方針を採る。

## 3. bundle 構成と KaTeX 注入

### 3.1 配布物の構成

| ファイル                  | 内容                                                                                                                                | 配布形態             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `dist/review.html`        | 既存と同じ。KaTeX 本体 / CSS / フォントは **含まない**（`--math` 未指定時のデフォルト配布物）                                       | エンドユーザー配布物 |
| `dist/katex/katex.mjs`    | KaTeX の ESM bundle（vite で別 entry として emit、commit 対象）                                                                     | CLI が読み込む素材   |
| `dist/katex/katex.css`    | KaTeX の CSS（フォント `@font-face` は data URI に書き換え済み、commit 対象）                                                       | CLI が読み込む素材   |
| `dist/review-request.mjs` | CLI 本体。`--math` 指定時のみ `dist/katex/*` を読み、`<script id="embedded-katex">` と `<style id="embedded-katex-css">` に書き込む | 配布者向け CLI       |

`dist/review.html` のサイズは `--math` 未指定時（既定）には現行のまま変動しない。`--math` 指定時のみ +120〜180 KB gzipped 程度の増加（KaTeX JS + CSS + 4 family woff2 data URI 化分の和）。この設計により、数式を必要としないレビューフロー（仕様書 / 散文中心の文書）が肥大化を被らない。

#### フォント data URI 化の理由

KaTeX は数式描画に専用フォント（KaTeX_Main / KaTeX_Math / KaTeX_AMS / KaTeX_Size1〜4 等の 16 family）を必須とする。`@font-face src: url('KaTeX_Main-Regular.woff2')` で外部参照させると：

- `file://` 起動時にフォントが解決できず、数式の字形が壊れる
- HTTP モード起動時も CLI が個別フォントを配信する経路を持たないため同様に壊れる
- CSP `font-src` に `https:` 等を追加する必要が出る（DESIGN.md §11 信頼境界の緩和を伴う）

ビルド時に `katex/dist/fonts/*.woff2` を base64 化して `katex.css` の `url(...)` を `url(data:font/woff2;base64,...)` に書き換える。あわせて DESIGN.md §11 の CSP に `font-src data:` を 1 行追加する。これにより：

- CSP は `font-src data:` のみで動作（`'self'` / `https:` 等は不要、`data:` URI の inline フォントだけが取得対象になる）
- `font-src` ディレクティブは未指定時に `default-src 'none'` にフォールバックして deny されるため、明示的に `font-src data:` を書く必要がある（CSP Level 3 仕様）。`data:` URI による信頼境界への影響は最小で、レビュー対象 markdown から `<style>` を出力する経路は `core/markdown.ts` の renderer で禁止済みであり、新たな `data:font/...` の流通経路は存在しない
- `file://` 起動 / HTTP モード起動 / `--math` 指定で生成した HTML をネットワーク隔離環境で開いた場合、すべて同じ字形で描画される

ただし `data:` URI は base64 化で原寸 +33% のサイズ増となる。実用上必要な family を絞り込んで inline する：本実装は数式の visual fidelity を優先し、KaTeX 公式の標準フォントセット全 16 family を inline する方針（gzip 後で +80〜120 KB 程度。実測は Step 1 PoC）。

### 3.2 CLI による KaTeX 注入

`src/cli/parse-args.ts` に `--math` boolean flag を追加する。値は受け取らない（モード切替えではなく opt-in トグル、`--mermaid` と対称）。

| `--math` 状態    | 挙動                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 指定なし（既定） | KaTeX を注入しない。`$...$` / `$$...$$` ブロックは marked デフォルトの plain text として表示                                                                  |
| 指定あり         | `dist/katex/katex.mjs` を読み込み `<script id="embedded-katex" type="module">` に、`dist/katex/katex.css` を `<style id="embedded-katex-css">` に inline 注入 |

#### 注入経路

`src/core/embed.ts` の rewrite ロジックに `katexRuntime?: { js: string, css: string }` 引数を追加し、次の 2 つのブロックを書き込む：

```html
<style id="embedded-katex-css">
  /* KaTeX CSS、フォント @font-face は data:font/woff2;base64,... に書き換え済み */
</style>
<script id="embedded-katex" type="module">
  import katex from '...inline KaTeX ESM source...'
  globalThis.__mdxgKatex = katex
  document.dispatchEvent(new Event('mdxg:katex-ready'))
</script>
```

bridge global (`globalThis.__mdxgKatex`) + `mdxg:katex-ready` イベントの経路は §15 Mermaid と同じ方式で、`docs/mdxg-diagram-rendering.md` §3.2 / §5.j の論点をそのまま再利用する（重複論点として §5.h で再記述）。

エンコード規約は `embedded-md` / `embedded-shiki-langs` / `embedded-mermaid` と同じく、KaTeX ESM ソース中に `</script>` 文字列が含まれていないことをビルド時に sanity check する。

#### ブラウザ側の読み込み（bridge 方式）

`src/app/katex.ts`（新規）で起動時に `<script id="embedded-katex">` の有無を確認する。存在する場合、`type="module"` の script は HTML パース完了後に同期で実行され `globalThis.__mdxgKatex` に KaTeX インスタンスがセットされる。`upgradeMathElements` は `requestIdleCallback`（fallback: `setTimeout(..., 0)`）で paint 後に schedule され、その時点で `globalThis.__mdxgKatex` を同期で読み出して使用する。

### 3.3 配布物サイズの実測見積もり

| ケース                | review.html     | KaTeX JS 増分                | KaTeX CSS + フォント増分                            | gzipped 後の配布物 |
| --------------------- | --------------- | ---------------------------- | --------------------------------------------------- | ------------------ |
| `--math` なし（既定） | ~314 KB（現行） | 0 KB                         | 0 KB                                                | ~95 KB（現行）     |
| `--math` あり         | ~314 KB         | +280 KB raw / +75 KB gzipped | +700 KB raw（フォント data URI 含）/ +60 KB gzipped | ~230 KB            |

実測値は Step 1 PoC 完了後に確定する。`--math` 指定時に CLI が stderr へ「Math support enabled. Output HTML is ~230 KB gzipped (vs ~95 KB without --math).」を出す予定。

## 4. 実装ステップ

順序は依存関係順。各ステップ完了で in-source test と手動視覚チェックを通す。

### Step 1: ライブラリ選定の検証と PoC

- 本ドキュメントの §5 設計判断をレビュー
- KaTeX ESM build (`katex/dist/katex.mjs`) が `import()` 経由でブラウザに読み込めること、`katex.renderToString(src, { displayMode })` が同期で返ることを PoC で確認
- 配布物サイズ実測（raw / gzipped）と Step 5 の `requestIdleCallback` schedule での FCP / TTI 計測
- フォント data URI 化スクリプトの PoC：`katex/dist/fonts/*.woff2` を base64 化して `katex.css` の `url(...)` を書き換える Node script を書き、生成された CSS が正しく字形を描画することを確認
- `\href` / `\url` / `\includegraphics` 等の外部リソース系コマンドが `trust: false` 既定で escape されることを確認

成果物：§5 マッピング表が確定状態、PoC で KaTeX ESM がブラウザで動くこと、フォント data URI 化が機能すること

### Step 2: 純粋ロジック層（`src/core/math.ts` 新規）

UI / DOM / KaTeX に依存しない `$...$` / `$$...$$` の検出ロジックを pure 関数で書き、in-source test を通す。

```ts
export type MathSegment = {
  type: 'inline' | 'display'
  source: string // $ や $$ を含まない LaTeX ソース本体
  raw: string // $...$ / $$...$$ を含む原文
  start: number // テキスト全体での開始 offset (codepoint index)
  end: number
}

export function scanMath(text: string): MathSegment[]
export function countMath(markdown: string): { inline: number; display: number }
```

- `marked.lexer(markdown)` で AST を取得し、再帰 walk で `text` / `paragraph` トークンの中身をスキャン（`core/scan-fenced-langs.ts` と同じパターン）
- `$$...$$` を `$...$` より先にマッチ（display を inline より優先、降順で見る）
- `\$` でエスケープされた `$` は数式境界として扱わない（literal `$` として残す）
- コードブロック / インラインコード内の `$` は marked の AST 上で別トークンになっているため、自前で `<code>` 配下を skip する必要はない（marked 側で structural に分離される）
- 数式ソース内に `\n` を含む場合、display は許容、inline は同一行内のみ許容（KaTeX のデフォルト挙動と揃える）
- 戻り値の `MathSegment[]` は `core/markdown.ts` の renderer から escape 範囲を決めるために使う

成果物：`src/core/math.ts` + in-source test（`$x$` 単独 / `$$x$$` 単独 / 混在 / `\$` エスケープ / コードブロック内の `$` 無視 / インラインコード内の `$` 無視 / 改行を含む display / 改行を含む inline（無視される）/ ネスト `$$ $ inner $ $$` の挙動 / 空入力）

### Step 3: ビルド側 — KaTeX bundle の emit + フォント data URI 化

- `vite.review-request.config.ts` に KaTeX ESM を別 entry として emit する設定を追加（`dist/katex/katex.mjs` として書き出し、CLI bundle 自体には含めない）
- `scripts/build-katex-css.mjs`（新規）で `katex/dist/katex.min.css` を読み込み、`@font-face src: url('fonts/KaTeX_Main-Regular.woff2')` 等を `url(data:font/woff2;base64,...)` に書き換えて `dist/katex/katex.css` として出力。`vite.config.ts` の `closeBundle` フックで呼ぶ（Shiki の grammar emit と同じパターン）
- `dist/katex/` 配下は **生成物だが commit 対象**（`dist/shiki-langs/` / `dist/mermaid.mjs` と同じ配布契約。clone 直後の利用者が `npm run build` 抜きで CLI を実行できる）
- `package.json` に `katex` を `dependencies`（非 dev）として追加し、version を pin
- フォント data URI 化スクリプトは KaTeX の dist 構造に依存するため、KaTeX version up 時に動作確認するチェックを `scripts/build-katex-css.mjs` の冒頭にバージョン assert として組み込む

成果物：`dist/katex/katex.mjs` と `dist/katex/katex.css` が emit され、commit 対象になる。CSS 内の `url()` がすべて data URI に置換されている

### Step 4: CLI 側 — `--math` flag と注入

- `src/cli/parse-args.ts` に `--math` boolean flag を追加（既定 false）
- `src/cli/review-request.ts` のエントリで `--math` 指定時に `dist/katex/katex.mjs` と `dist/katex/katex.css` を読み込み（`readFileSync`）、`core/embed.ts` の `katexRuntime` 引数に渡す
- `src/core/embed.ts` に `katexRuntime?: { js: string; css: string }` 引数を追加し、`<script id="embedded-katex" type="module">` と `<style id="embedded-katex-css">` の 2 ブロックを rewrite。`katexRuntime` が undefined なら両ブロックを書かない
- HELP_TEXT 更新：`--math` の意味（`$...$` / `$$...$$` を KaTeX で描画。配布物サイズが +135 KB gzipped 程度増える）と既定値（OFF）を記述
- `countMath(markdown).inline + countMath(markdown).display === 0` のときに `--math` 指定があれば stderr へ「No math expressions found in input. Output HTML still includes KaTeX runtime (~135 KB gzipped). Consider removing --math.」を出す
- 対称に、`--math` 未指定で `countMath(markdown).inline + countMath(markdown).display > 0` のときに stderr へ「Detected N math expression(s). Use `--math` to render them.」hint を出す

成果物：CLI が `--math` 指定時に `embedded-katex` / `embedded-katex-css` を書き込めること（in-source test で `embed` 経路を検証）

### Step 5: ブラウザ側 — 初期 render と KaTeX upgrade の 2 段階構成

設計判断は §5.b の C 案（paint 後 lazy 初期化 + 各 math element 単位の upgrade、Shiki / Mermaid と同じパターン）。

#### Step 5a: 初期 render は KaTeX 非依存で即時 paint

- `src/core/markdown.ts` の marked renderer：
  - paragraph / text トークン処理時に `scanMath(text)` で `MathSegment[]` を取得
  - 検出された各セグメントについて次の 2 属性を持つ要素を出力する：
    - **textContent**: `MathSegment.raw`（`$...$` / `$$...$$` を含む原文）を `core/escape.ts` でエスケープしたもの
    - **`data-math-source` 属性**: `MathSegment.source`（`$` 区切りを除いた LaTeX 本体）を `core/escape.ts` でエスケープしたもの。upgrade 時の `katex.renderToString` への入力として使う
  - 出力例：
    - inline: `<span data-math="inline" data-math-source="x^2 + y^2">$x^2 + y^2$</span>`
    - display: `<div data-math="display" data-math-source="\frac{a}{b}">$$\frac{a}{b}$$</div>`
  - textContent に raw `$...$` を残すことで MDXG §14 [MUST] 「描画未サポート時は生の文法を保持」「ストリップ / 隠蔽してはならない」を初期 paint 時点から満たす（`--math` 未指定で配布された HTML / upgrade 失敗時のいずれでも raw `$...$` が読める）
  - `$` 区切りの除去は scan 段階で 1 回だけ実施（`MathSegment.source`）。renderer / upgrade 側で文字列処理しないことで、`$` の不一致や Unicode escape との混入を構造的に塞ぐ
  - 数式以外の部分は通常の text として連結
  - インラインコード `` `$x$` `` 内の `$` はトークン段階で分離済みのため renderer は `<code>` 経路に倒し、data-math は付かない
- `src/app/doc-renderer.ts` の初期描画パス：
  - 既存ロジックがそのまま動く。`data-math` 属性は属性として残るだけで描画には影響しない（CSS で `[data-math]` に `font-family: monospace` を当てておくと、upgrade されなかった場合に LaTeX ソースであることが分かる）

#### Step 5b: paint 後の KaTeX upgrade

- `src/app/katex.ts`（新規）：
  - `getEmbeddedKatex()` で `<script id="embedded-katex">` の有無を確認、無ければ null を返して以降の処理を skip
  - `upgradeMathElements(docEl)` を初期 render 完了後に schedule
    - `requestIdleCallback(callback, { timeout: 2000 })`（fallback: `setTimeout(callback, 0)`）で paint 後に走らせる
    - `window.getSelection().toString().length > 0` ならスキップし、`selectionchange` で空に戻ったら再試行（Shiki / Mermaid と同じパターン）
  - 実行内容：
    1. `globalThis.__mdxgKatex` を読み出して KaTeX インスタンスを取得（§3.2 bridge 方式）。未定義なら一度だけ `mdxg:katex-ready` イベントを `await`（最大 2 秒の timeout、超えたら null として skip）
    2. `docEl.querySelectorAll('[data-math]:not([data-math-applied])')` を走査
    3. 各要素について `data-math` 属性値（`'inline'` / `'display'`）から `displayMode` を決定
    4. `el.getAttribute('data-math-source')` から clean な LaTeX ソース（`$` 区切り除去済み、Step 5a で scan 結果から焼き込み済み）を取得し、`katex.renderToString(src, { displayMode, throwOnError: false, errorColor: 'inherit', trust: false, strict: 'warn' })` に渡す。textContent には raw `$...$` が残っているが、upgrade 時はこれを参照せず attribute 経由で source を取る
    5. 生成された HTML を `el.innerHTML = ...` で挿入（KaTeX 出力は内部で escape 済み、§5.h 信頼境界）
    6. `data-math-applied="1"` を要素に付けて idempotent 化
    7. upgrade 後に `cacheBlockOriginalHTML` 相当で `state.blockOriginalHTML` を再構築 → `reapplyAllMarks()`
  - パースエラー時：`katex.renderToString` は `throwOnError: false` で error 文字列を返すため throw しない。返り値が KaTeX 公式の error コンテナ class (`katex-error`) を含む場合は `data-math-failed="1"` を付け、toast で「Math render failed for N expression(s)」を表示
- KaTeX `trust: false` を必須化する理由は §5.f 信頼境界参照

成果物：

- 初回 paint は既存と同じく素早く完了（embedded-katex 読み込みは paint 後）
- paint 後 idle callback で KaTeX 描画が追加適用される
- embedded-feedback の `<mark class="cmt">` は upgrade 後も `data-math` 要素を含む段落で正しい位置に再貼付される
- 未対応構文や parse 失敗は plain text fallback + toast 通知

### Step 6: §6 アンカリングと §10 Search の維持確認

- §6 のブロックフラットテキストオフセット計算は `textContent` ベースで動く。`<span data-math="inline" data-math-source="x">$x$</span>` の textContent は upgrade 前は `$x$`、upgrade 後は KaTeX 出力（MathML / HTML テキスト）に変化する。**この textContent 変化がオフセット計算を狂わせる**ため、`selection.ts` の `textSegments` が `[data-math]` 要素に到達した時の挙動を次のとおりに統一する：
  - 子孫を walk せず、要素 1 つ = テキストセグメント 1 つとして扱う
  - 返すテキストは `data-math-source` 属性値を `data-math` 値でラップして再構成する（`'inline'` → `$<source>$` / `'display'` → `$$<source>$$`）
  - `data-math` / `data-math-source` 属性は Step 5a の初期 render 時に確定し upgrade で書き換わらないため、再構成結果も upgrade 前後で不変
  - `startOffset` / `endOffset` は upgrade 前後で不変が保証される
- §10 Search の `<mark class="search-hl">` も同様に `[data-math]` 配下を 1 単位として扱い、検索クエリが再構成された raw 文字列（`$x$` / `\frac` 等の LaTeX ソース込み）に対してマッチする挙動とする（描画された数式テキストに対する検索ではない。レビュアーが LaTeX ソースで grep する用途）
- in-source test に追加：
  - upgrade 前後で `selection.ts` の `textSegments` の出力が一致すること（再構成ロジックの不変性）
  - upgrade を 2 回呼んでも `data-math-applied` ガードで二重描画にならないこと（idempotent）
  - KaTeX パースエラー時に `data-math-failed="1"` が付き、`data-math-source` 属性が保持されること（textSegments の再構成が引き続き動く）
  - 検索クエリが LaTeX ソース（`\frac` 等）にマッチすること

成果物：既存コメント / 検索が付いた markdown を 数式含みで再読込しても §6 / §10 が壊れないこと

### Step 7: §1 Theming との連動

- KaTeX 既定 CSS は数式の color を `color` プロパティで指定し、フォントサイズは `1.21em` で親に追従。本実装は次の上書きルールを `src/styles/markdown.css` に追加：
  ```css
  #doc .katex {
    color: var(--ink);
    font-size: 1em; /* KaTeX 既定 1.21em は本文より大きいため抑える */
  }
  #doc .katex-display {
    margin: 1em 0;
    color: var(--ink);
  }
  #doc .katex-error {
    color: var(--accent-error, #d33);
    background: color-mix(in srgb, var(--accent-error, #d33) 10%, transparent);
    padding: 0 0.2em;
    border-radius: 2px;
  }
  ```
- `--ink` の値は §1 Theming の light / dark 切替で動的に変わるため、KaTeX 出力 SVG / MathML / HTML の文字色も自動追従する（CSS variable 経由）
- KaTeX 既定 CSS は背景色を持たないため、`--paper` との衝突は発生しない
- 数式中の演算子 / 記号も同じ `color: var(--ink)` で塗られる。トーンに変化を付けたい場合（演算子は弱め / 変数は強め等）は将来拡張として残す
- theme トグル時の再描画は **不要**（CSS variable 参照のため `--ink` の値変化だけで color が更新される。Mermaid と異なり SVG / MathML を再生成する必要がない）

成果物：light / dark どちらのテーマでも数式が `--ink` 配色で読み取り可能、テーマトグルで再描画なしに追従

### Step 8: DESIGN.md 反映と本ドキュメントの role 切替

- DESIGN.md §12 表に「Extensions / §14 Math Rendering」行を追加し「準拠」に塗る
- DESIGN.md §3 review-request CLI コマンド仕様に `--math` を追記
- DESIGN.md §11 セキュリティ：KaTeX `trust: false` / `strict: 'warn'` の挙動と `<script id="embedded-katex" type="module">` / `<style id="embedded-katex-css">` の信頼境界を 1 段落で追記。CSP に `font-src data:` を 1 行追加し、その理由（KaTeX フォント data URI 用、`'self'` / `https:` を緩和しない最小許可）を明記
- DESIGN.md §13 ビルドパイプライン：`dist/katex/` の出口を §13 全体像と表に追加。`scripts/build-katex-css.mjs` も §13 開発時依存に追加
- DESIGN.md §14 ファイル構成：`src/core/math.ts` / `src/app/katex.ts` / `scripts/build-katex-css.mjs` / `dist/katex/` を追加
- DESIGN.md §12「その他の拡張候補」の MDXG §14 項目を削除（実装済みになるため）
- 本ドキュメントは `docs/mdxg-math-rendering.archive.md` にリネーム

成果物：DESIGN.md 更新 + 本ドキュメントの archive

## 5. 設計判断

### a. ライブラリ選定：KaTeX（vs MathJax / SVG サーバサイド）

| 候補             | 採用 | 理由                                                                                                                                                                                  |
| ---------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **KaTeX**        | ✓    | 同期 API (`katex.renderToString`) で paint 後 idle callback 内に order なく upgrade 可能。bundle サイズが MathJax より 1/3 小さい (~280 KB JS) で単一 HTML 配布物への影響を抑えられる |
| MathJax          | ✗    | より広い LaTeX カバレッジを持つが async API + 遅延描画前提で `doc-renderer.ts` の同期前提と衝突。bundle が ~1 MB と大きく、単一 HTML 配布での影響が許容できない                       |
| サーバサイド SVG | ✗    | レビュー対象が事前に決まっていないため、CLI 実行時に全数式を SVG 化する経路が必要。実装コストが高く、`--math` 指定時のフォントレンダリングを Node 側で再現する複雑性も伴う            |

KaTeX の LaTeX カバレッジ不足（`\begin{align}` の一部 / `\newcommand` の制限等）は MDXG レビュー対象の典型用途（仕様書 / 技術解説 / 数式 1〜2 行）では支配的でない。複雑な数式が必要なケースは将来 MathJax 切替えオプション (`--math-engine mathjax`) を opt-in で追加できる経路を温存する。

### b. KaTeX 初期化のタイミング：paint 後の lazy 読み込み + 各 math element 単位の upgrade

| 候補                                                                  | 採用 | 理由                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. 起動時に同期で KaTeX 初期化 + 全数式描画                           | ✗    | KaTeX 本体 + CSS + フォント (~135 KB gzipped) の parse + 全数式の renderToString が paint 前に走り、`loading spinner` 表示時間が伸びる。embedded markdown ロード時の FCP 劣化が許容できない                                                                                  |
| B. async marked renderer の中で KaTeX 描画を await                    | ✗    | KaTeX は同期 API のため async 化のメリットがない。`doc-renderer.ts` の同期前提を崩すコストを払う動機がない                                                                                                                                                                   |
| **C. paint 後 `requestIdleCallback` で lazy 初期化 + 各要素 upgrade** | ✓    | 初期描画は plain `<span data-math>` で即時 paint。idle callback で `globalThis.__mdxgKatex`（bridge 方式、§3.2 / §5.h）から KaTeX インスタンスを取得し、各要素を KaTeX HTML に upgrade する。Shiki / Mermaid と同じパターンで、既存 paint パスを変えずに追加機能を載せられる |

C 案の論点と mitigation：

- **「LaTeX ソース → 描画済み数式のちらつき」**: 初期 paint で `[data-math]` に `font-family: monospace; opacity: 0.6` を当てて「処理中」感を視覚化し、upgrade 完了で `opacity: 1` に戻す。完全な視覚一貫性より「LaTeX ソースが見えている → 数式に化ける」流れを可視化する方向に倒す（Shiki の「色が薄く乗る」と同じ思想）
- **upgrade 中の選択操作**: Shiki / Mermaid と同じく `getSelection().toString().length > 0` でスキップし `selectionchange` で再試行
- **既存 `<mark class="cmt">` の維持**: `[data-math]` 要素は `<span>` / `<div>` 単位で independent な subtree、upgrade で innerHTML が差し替わるが要素自体は残る。`blockOriginalHTML` の再構築で対応（Shiki / Mermaid と同じ）

### c. 数式要素の DOM 配置：`<span data-math="inline">` / `<div data-math="display">`

| 候補                                                    | 採用 | 理由                                                                                                                                                                                                |
| ------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. `[data-math]` 属性付きの `<span>` / `<div>`**      | ✓    | 既存 marked AST との統合が単純（renderer フックで属性付きタグを返すだけ）。upgrade 前後で要素自体は残り、§6 アンカリングの textSegments で `data-math-source` 経由の不変オフセットを実現可能        |
| B. KaTeX 公式パターン `<span class="math math-inline">` | ✗    | KaTeX 自身が `katex` / `katex-display` クラスを upgrade 後に付与するため、初期 render 段階の class は upgrade との衝突を避ける名前にしたい。`data-math` 属性方式は KaTeX class とは独立に管理できる |
| C. `<math>` (MathML) タグで初期 render                  | ✗    | marked renderer から MathML を生成するコストが高く、KaTeX 経由の生成と二重実装になる。upgrade で innerHTML を差し替える前提なら初期 render は plain text で十分                                     |

A 案の追加考慮：

- `data-math` の値は `'inline'` / `'display'` の 2 値のみ（数値や複雑な構造を持たせない）
- `data-math-source` は Step 5a の初期 render 時に scan 結果から焼き込み（`$` 区切り除去済み）。upgrade では参照のみで書き換えない。textContent は raw `$...$` を保持し、§14 [MUST] の plain text fallback を初期 paint から成立させる
- upgrade 後に付ける `data-math-applied="1"` / `data-math-failed="1"` の組合せで状態管理（Mermaid と対称）

### d. CLI opt-in 方式：`--math` boolean（vs `--math <katex\|mathjax\|none>`）

| 候補                               | 採用 | 理由                                                                                                                                                                              |
| ---------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. `--math` boolean flag**       | ✓    | KaTeX 1 エンジンのみのサポートで mode 切替の必要がなく、boolean が最小インターフェース。将来 MathJax 切替えが必要になれば `--math-engine <katex\|mathjax>` を独立で追加すれば良い |
| B. `--math <katex\|mathjax\|none>` | ✗    | 現状は値域が 2 つしかなく、boolean flag を mode 風に書き換えただけ。将来エンジン切替えが必要になっても boolean + 別オプションの組合せで表現できる                                 |

`--mermaid` と対称な設計。将来 `--math-engine` を追加した場合：`--math --math-engine mathjax` の組合せで MathJax を使う opt-in 経路を提供できる。

### e. デフォルトは Math OFF（vs Shiki と同じ `auto`）

| 候補                   | 採用 | 理由                                                                                                                                                                                                                                                                              |
| ---------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OFF（明示 opt-in）** | ✓    | `$` は通常文中で頻出する文字（金額 / 環境変数 / 正規表現 / シェルコマンド）で、auto 検出は誤陽性リスクが高い。`$100 と $200 の差` のような文章を「数式が含まれる」と誤判定して KaTeX を注入すると、サイズ増 + `100 と 200 の差` の `$` ペアを誤って数式描画する経路が両方発生する |
| auto（スキャン）       | ✗    | scanMath が `\$` エスケープと code block / inline code 除外まで実装しても、自然言語中の `$` 単独使用（`$5` のような価格表記）を誤検出する。`--mermaid` の `mermaid` フェンスのような明示的識別子と異なり、`$...$` 文法は曖昧さを構造的に持つ                                      |
| all（常時 ON）         | ✗    | デフォルトで +135 KB gzipped + 上記の自然言語 `$` 誤検出リスクが組み合わさり、配布物全体に対する副作用が大きい                                                                                                                                                                    |

OFF を採用する代わりに、`countMath(markdown)` で 1 個以上の math パターン候補を検出した時に CLI が stderr へ hint を出す：「Detected N math expression(s). Use `--math` to render them.」これにより配布者が `--math` の存在に気づける導線を残しつつ、誤検出の責任はユーザーが明示 opt-in する経路に集約する。

### f. KaTeX 信頼境界：`trust: false` + `strict: 'warn'` 必須化

KaTeX には外部リソース系コマンド（`\href` / `\url` / `\includegraphics` 等）と、文字列を任意の HTML / CSS として扱う命令（`\htmlClass` / `\htmlStyle` / `\htmlData` 等）がある。レビュー対象 markdown が LLM 生成物で信頼できない前提（DESIGN.md §11）と整合させるため：

- `katex.renderToString(src, { trust: false, strict: 'warn', throwOnError: false, errorColor: 'inherit' })` を必須化
- `trust: false` で `\href` / `\url` 等の外部 URL を含む命令を escape 表示にする（リンクとして機能させない）
- `strict: 'warn'` で `\newcommand` 等の制限付き命令を warning として扱い、render を続行（`throw` ではない）
- `throwOnError: false` で構文エラー時に例外を投げず、`<span class="katex-error">` 経由でエラー表示
- `errorColor: 'inherit'` で error も `--ink` 配色を継承（§7 Theming）

代替案 `trust: true`（全コマンド許可）は採用しない。strict 'error' は LLM 生成数式の細かい記法ゆれで頻発 throw する可能性があり、UX を損ねる。

CSP `script-src 'self' 'unsafe-inline'` の既存許可で `<script id="embedded-katex" type="module">` が動作する。KaTeX 自身は fetch / XHR を行わないため `connect-src 'none'` の既存制約も維持される。

### g. フォント data URI 化：`font-src data:` の最小許可で `'self'` / `https:` を緩和しない

| 候補                                                                     | 採用 | 理由                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------ | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. フォントを `url(data:font/woff2;base64,...)` で inline**            | ✓    | CSP に `font-src data:` を 1 行追加するだけで動作（`'self'` / `https:` への緩和不要）。`file://` / HTTP モード / オフライン環境すべてで同じ字形が描画される。サイズ増は base64 化で +33% だが gzip 後で +60 KB 程度に収まる |
| B. フォントを `dist/katex/fonts/*.woff2` に置き `font-src 'self'` を許可 | ✗    | DESIGN.md §11 信頼境界を緩和する。`file://` 起動時に `'self'` が `file://` を許可するかブラウザ実装依存で動作が不安定。HTTP モードでも CLI が個別フォントを配信する経路を持たないため二度手間                               |
| C. フォントを bundle せず数式が崩れた字形で表示                          | ✗    | MDXG §14 [SHOULD] 「ホストのフォントサイズと色スキームに適応」を満たせない。数式描画品質が KaTeX の前提に依存するため、フォント未供給は事実上 §14 非対応と同等                                                              |

A 案の追加考慮：

- KaTeX が必須とするフォント family は 16 種類（Main / Math / AMS / Caligraphic / Fraktur / Script / SansSerif / Typewriter × Regular/Bold/Italic 等）
- 全 16 family を inline すると raw +700 KB、gzip +60 KB 程度。サブセットを絞ると珍しい数式記号（`\mathfrak` / `\mathscr`）が壊れるため、本実装は全 family inline を採用
- woff2 はすでに高圧縮済みフォーマットで gzip による追加圧縮は限定的。サイズ最適化が必要になった場合は woff2 のサブセッティング（使用 codepoint のみ抽出）で対処する余地を将来拡張に残す

### h. bridge global の命名規約：`globalThis.__mdxgKatex`（§15 Mermaid と対称）

`<script id="embedded-katex" type="module">` 内で実行する bridge コードは次の構造：

```js
import katex from '...inline KaTeX ESM...'
globalThis.__mdxgKatex = katex
document.dispatchEvent(new Event('mdxg:katex-ready'))
```

`globalThis.__mdxg<Library>` の prefix で名前空間を明示する。Mermaid (`__mdxgMermaid`) / KaTeX (`__mdxgKatex`) / 将来追加されるライブラリも同じ規約に従う。docs/mdxg-diagram-rendering.md §5.j で確定した方式をそのまま再利用する。

代替案：

- `import()` での dynamic specifier 指定 → 採用不可（`id` 属性は specifier として解決できない）
- blob URL 経由 → CSP に `blob:` 追加が必要、DESIGN.md §11 緩和を伴うため不採用

### i. `\$` エスケープと自然言語 `$` の扱い

scanMath は `\$` を数式境界として扱わない。実装：

- `$...$` パターンマッチ時、先頭 `$` の直前文字が `\` なら除外（lookbehind）
- 終端 `$` についても同様
- ただし `\\$` （バックスラッシュのエスケープ + `$`）は数式境界として扱う（`\\` で literal backslash、`$` で数式開始）

これにより `$100` のような自然言語表記は数式判定から除外されない（誤検出されたまま）が、`\$100` と明示エスケープすればユーザーが除外できる。§5.e で OFF 既定を採用しているため、自然言語の `$` が誤検出される負荷は `--math` 明示指定時のみ発生し、配布者が認識した上で原稿に `\$` エスケープを入れる責務を負う。

将来拡張：scanMath に「`$...$` の中身が valid LaTeX か簡易判定する heuristic」を入れて、明らかに数式でない `$100 と $200` パターンを除外する道もあるが、heuristic の精度トレードオフが大きく現状は採用しない。

### j. KaTeX version pin と再生成のトリガ

- `package.json` で `katex` の version を pin（caret prefix なし、exact version）
- KaTeX major version up 時：本ドキュメントの §5.f `trust` / `strict` の挙動、§5.g フォントセット、Step 5b の `renderToString` API 契約を再評価
- `dist/katex/katex.mjs` / `dist/katex/katex.css` は **生成物だが commit 対象**（`dist/shiki-langs/` / `dist/mermaid.mjs` と同じ配布契約）
- `scripts/build-katex-css.mjs` の冒頭で KaTeX version assert を入れ、想定外バージョンでは build を fail させる（フォント data URI 化スクリプトが KaTeX の dist 構造に依存するため）

## 6. テスト方針

### in-source test（新規）

- `core/math.ts`：
  - `$x$` 単独 inline 検出
  - `$$x$$` 単独 display 検出
  - 混在 `text $a$ text $$b$$ text`
  - `\$` エスケープ単独 → 数式境界として扱わない
  - `\\$x\\$` → `\\` は literal backslash、内側は数式境界として扱う
  - コードブロック ` ```\n$x$\n``` ` 内の `$` → 検出しない（marked AST 段階で別トークン）
  - インラインコード `` `$x$` `` 内の `$` → 検出しない（同上）
  - 改行を含む display `$$\nx\n$$` → 検出する
  - 改行を含む inline `$\nx\n$` → 検出しない（KaTeX デフォルト挙動と揃える）
  - ネスト `$$ $ inner $ $$` → display 1 個として検出（inner $...$ は内部の text とする）
  - 空入力 → 空配列
  - `countMath` の inline / display 件数集計

- `core/embed.ts`（既存テストに追加）：
  - `katexRuntime` 渡したときに `<script id="embedded-katex" type="module">` と `<style id="embedded-katex-css">` の 2 ブロックが書き込まれる
  - `katexRuntime` 未指定時には両ブロックが書かれない
  - `katexRuntime.js` 内に `</script>` 文字列が含まれていたら build を fail させる（sanity check）

- `cli/parse-args.ts`（既存テストに追加）：
  - `--math` flag が boolean として true / false パースされる
  - `--math` が値を取らない（`--math value` の `value` は positional として解釈される、または error）

- `app/katex.ts`：
  - `<script id="embedded-katex">` が空 / 欠落のとき `getEmbeddedKatex()` が null を返す
  - `upgradeMathElements` が 2 回呼ばれても `data-math-applied` ガードで二重描画にならない（idempotent）
  - katex renderToString が KaTeX error コンテナを返した時に `data-math-failed="1"` が付き、`data-math-source` 属性が保持される
  - 初期 render 時に `data-math-source` 属性が scan の `MathSegment.source`（`$` 除去済み）で埋まり、textContent に `MathSegment.raw` の escape 済み文字列が入る

- `app/selection.ts`（既存テストに追加）：
  - upgrade 前後で `textSegments` の出力が一致する（`[data-math]` 配下を `data-math` / `data-math-source` 属性から再構成した raw `$...$` 文字列で扱う）

- `core/markdown.ts`（既存テストに追加）：
  - `$...$` が `<span data-math="inline">` として出力される
  - `$$...$$` が `<div data-math="display">` として出力される
  - `\$` がエスケープされて plain text として出力される
  - インラインコード内の `$` は data-math 属性を付けず通常の `<code>` 経路に流れる

### 手動視覚チェックリスト

`npm run build` 後、CLI 経由で配布 HTML を生成して以下を確認：

- [ ] `node dist/review-request.mjs --math sample-with-math.md` で生成した HTML を Chromium で開き、`$x$` インライン数式が周囲のテキストとインラインに描画される
- [ ] `$$\\frac{a}{b}$$` 表示数式が中央寄せのブロックとして描画される
- [ ] 初回 paint 時には plain `$...$` LaTeX ソース（monospace + opacity 0.6）が一瞬見え、idle callback 後に KaTeX 描画に置き換わる
- [ ] OS dark で開いた時に数式の文字色が `--ink` の dark 値で表示される
- [ ] theme toggle で `system → light → dark` を循環すると数式の文字色も追従する（再描画なし）
- [ ] LaTeX 構文エラーを含む数式（`$\\unknown_command{x}$`）は KaTeX error コンテナ（赤系の `--accent-error`）で表示され、toast で「Math render failed」が出る
- [ ] エラー数式があっても他の数式は正常に描画される
- [ ] 数式を含む段落のテキストを選択 → `+ Comment` → コメント追加 → 再描画後も `<mark class="cmt">` が同じ位置に出る
- [ ] CLI を `--math` 指定なしで実行した HTML を開いた場合、`$x$` / `$$x$$` は plain text（既存挙動）で表示される
- [ ] CLI を `--math` 指定なしで math 含み markdown を渡した時、stderr に「Detected N math expression(s). Use `--math` to render them.」が出る
- [ ] CLI を `--math` 指定ありで math 0 個の markdown を渡した時、stderr に「No math expressions found in input.」が出る
- [ ] `\$100 と \$200` のようなエスケープされた `$` は literal `$` として描画され、数式判定されない
- [ ] コードブロック / インラインコード内の `$` は KaTeX upgrade されず元の文字として残る
- [ ] `dist/review.html`（`--math` なし）のサイズが既存とほぼ同じ（~95 KB gzipped）
- [ ] `--math` 指定で生成した HTML のサイズが見積もり通り（~230 KB gzipped）
- [ ] §10 Search が math 含み markdown で動作する（`\frac` 等の LaTeX ソース文字列でヒット）
- [ ] フォントの字形が `file://` 起動でも崩れない（data URI 化が機能している）

## 7. 受け入れ基準

- MDXG §14 [SHOULD] `$...$` / `$$...$$` 描画を満たす（§1 冒頭の対応スコープ表が ✓）
- MDXG §14 [MUST] 描画未サポート時の plain text fallback が回帰していない（`--math` 未指定時 / 構文エラー時）
- MDXG §14 [MUST NOT] ストリップ / 隠蔽 / 文字化けが発生しない（`--math` 未指定時は raw `$...$` がそのまま表示）
- MDXG §14 [SHOULD] ホストフォントサイズ / 色スキーム適応を満たす（`--ink` 配色追従 / フォントサイズ 1em）
- `dist/review.html` のサイズが `--math` 未指定時に **既存と変動なし**
- `--math` 指定時のサイズ増分が **gzip +150 KB 以内**
- §6 アンカリングが壊れない（既存 in-source test 全通過 + 新規追加分も通過、upgrade 前後で `textSegments` 出力一致）
- §10 Search が math 要素を含む文書でも動作する
- §1 Theming の dark 連動が数式にも適用される
- `\$` エスケープが機能し、自然言語 `$` 表記とエスケープの使い分けが可能
- DESIGN.md §12 表に「§14 Math Rendering」行が追加され「準拠」に塗られる
- DESIGN.md §12「その他の拡張候補」の MDXG §14 項目が削除されている

## 8. 想定リスクと回避策

| リスク                                                                  | 回避策                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KaTeX 本体 + フォント サイズが見積もり (~135 KB gzipped) より大きい     | Step 1 PoC で実測。+200 KB gzipped を超える場合は受け入れ基準を見直し、フォントサブセッティング（使用 codepoint のみ抽出）を検討                                                                                                                                 |
| KaTeX `import()` 動的読み込みが `file://` で動かない                    | bridge global 方式（`<script type="module">` で inline + `globalThis.__mdxgKatex`）で迂回。Mermaid と同じパターン                                                                                                                                                |
| フォント data URI 化スクリプトが KaTeX version up で壊れる              | `scripts/build-katex-css.mjs` の冒頭で KaTeX version assert を入れ、想定外バージョンでは build を fail させる                                                                                                                                                    |
| `katex.renderToString` が long-running で UI freeze する                | idle callback で実行することで初回 paint は守られる。複数数式の並列描画を避けるため `for` ループで順次処理。1 数式の renderToString は典型 1〜5ms                                                                                                                |
| 既存 `<mark class="cmt">` が upgrade で消える                           | `[data-math]` 要素を upgrade 時に innerHTML 差し替えするが、外側の段落 / 要素は触らない。`<mark>` は段落側に貼られるため `[data-math]` の upgrade 影響を受けない                                                                                                 |
| §10 Search が math 要素で意図しない挙動になる                           | upgrade 後の textContent は KaTeX 出力の MathML / HTML テキスト。検索対象を `data-math` / `data-math-source` 属性から再構成した raw `$...$` 文字列に揃える（textSegments と同じ経路）。検索ヒット時は要素全体に `search-hl` を当てる（部分的ハイライトはしない） |
| KaTeX `trust: false` でも XSS 経路が残る                                | KaTeX の最新 advisory を Step 1 でレビュー。CSP `default-src 'none'` + `connect-src 'none'` の既存防壁が二重保険として効く（KaTeX から fetch / XHR は走らない）                                                                                                  |
| KaTeX version up で API 契約が変わる                                    | `package.json` で exact pin。version up 時は本ドキュメントの §5.f / §5.g / Step 5b を再評価                                                                                                                                                                      |
| LaTeX 構文エラー時に部分描画が残る                                      | `katex.renderToString` は `throwOnError: false` で完全な error コンテナを返す。部分描画は発生せず、error コンテナだけが innerHTML に入る                                                                                                                         |
| `dist/katex/` の commit による repo サイズ増                            | 受け入れる。`dist/shiki-langs/` / `dist/mermaid.mjs` と同じく「clone 直後に `npm run build` 抜きで CLI が動く」配布契約を保つ。`katex` の version pin で頻繁な差分は出ず、~1.5 MB の追加 commit 容量は許容範囲                                                   |
| 自然言語 `$` 表記の誤検出                                               | OFF 既定 + `\$` エスケープ規約で対処。`--math` 指定時の責任はユーザーが明示 opt-in する経路に集約。将来 heuristic 判定の追加は §5.i に拡張余地として残す                                                                                                         |
| サイレント回帰（math 追加で Shiki / Mermaid / コメント / 検索が壊れる） | 既知ケースを in-source test + 手動チェックで網羅。CI で fail させる                                                                                                                                                                                              |
| `$` が複数ライブラリ間で衝突（jQuery などのレガシー global）            | 本実装は `globalThis.$` を一切触らない。bridge global は `__mdxgKatex` 名前空間で隔離される                                                                                                                                                                      |

## 9. 参考

- [MDXG §14 Math Rendering（日本語訳）](./mdxg/05-extensions.md#14-math-rendering数式描画)
- [KaTeX 公式ドキュメント](https://katex.org/) — `renderToString` / `trust` / `strict` / `throwOnError`
- [KaTeX Security Considerations](https://katex.org/docs/security.html) — `trust: false` 既定と外部リソース系コマンドの扱い
- [KaTeX Supported Functions](https://katex.org/docs/supported.html) — LaTeX カバレッジ範囲
- [DESIGN.md §12 MDXG 準拠ロードマップ・今後の拡張](./DESIGN.md#12-mdxg-準拠ロードマップ今後の拡張)
- [DESIGN.md §1 Theming](./DESIGN.md#1-theming準拠) — CSS variables 経由のテーマ追従
- [DESIGN.md §6 コメントのアンカリング](./DESIGN.md#6-コメントのアンカリング)
- [DESIGN.md §10 Search](./DESIGN.md#10-search準拠)
- [DESIGN.md §11 セキュリティとプライバシー](./DESIGN.md#11-セキュリティとプライバシー)
- [DESIGN.md §13 ビルドパイプライン](./DESIGN.md#13-ビルドパイプライン)
- [docs/mdxg-rendering-code-block.archive.md](./mdxg-rendering-code-block.archive.md) — Shiki upgrade パターン参考元
- [docs/mdxg-diagram-rendering.md](./mdxg-diagram-rendering.md) — Mermaid 設計プラン参考元（bridge global 方式 / CLI opt-in 方式）
- [docs/design-example.md](./design-example.md) — 設計ドキュメントテンプレート
