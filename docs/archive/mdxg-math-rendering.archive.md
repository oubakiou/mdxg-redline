# MDXG §14 Math Rendering 対応 設計・実装計画

DESIGN.md §12「その他の拡張候補」の「MDXG §14 Math Rendering の対応」項目を実装に落とすための設計判断と実装手順をまとめる。完了時点で本ドキュメントは DESIGN.md §12 表に「§14 Math Rendering」行を追加して「準拠」に塗り替え、本ファイルは `docs/mdxg-math-rendering.archive.md` にリネームしてアーカイブする想定（`docs/mdxg-rendering-code-block.archive.md` と同じ扱い）。

## 1. 対応スコープ

[MDXG §14 Math Rendering](./mdxg/05-extensions.md#14-math-rendering数式描画) の 5 要件を、`$...$` / `$$...$$` 文法に対して満たす。本実装は **「レビュー対象 markdown が `$...$` / `$$...$$` で数式を埋め込む前提」をスコープ宣言**として採り、自然言語中の `$` 単独使用（`$100` 等）は配布者が `\$` エスケープで対処する責務とする（§5.i）。

| 要件                                                                        | 現状 | 完了条件                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [SHOULD] `$...$` で囲まれたインライン数式が周囲のテキストとインラインに描画 | 未   | `dist/standalone.html` は build 時に KaTeX を `<script id="embedded-katex">` / `<style id="embedded-katex-css">` に inline（§5.k、フォントは `--math-fonts all` 相当の全 20 family 同梱）、CLI 経路（`embed-template.html` → `*-review.html`）は `--math <auto\|on\|off>` モードで注入判定（既定 `auto`）+ `--math-fonts <minimal\|all>` でフォント範囲を選択（既定 `minimal`、§5.g / §5.l）。`$...$` を `<span class="katex">` として inline 描画 |
| [SHOULD] `$$...$$` で囲まれた表示数式が中央寄せのブロックとして描画         | 未   | 同上の経路で `$$...$$` を `<div class="katex-display">` として中央寄せ描画                                                                                                                                                                                                                                                                                                                                                                         |
| [MUST] 数式描画未サポート時に生の文法を保持                                 | ✓    | `--math off` 時 / `auto` で 0 件時に KaTeX を注入せず、ブラウザ側 upgrade は no-op で raw `$...$` を plain text として残す経路で満たす。回帰させない                                                                                                                                                                                                                                                                                               |
| [MUST NOT] ストリップ / 隠蔽 / 文字化け                                     | ✓    | 同上。回帰させない                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| [SHOULD] 数式の描画スタイルがホストのフォントサイズと色スキームに適応       | 未   | KaTeX 既定 CSS に加えて `color: var(--ink)` / `font-size: 1em` を上書きルールとして `src/styles/markdown.css` に追加。`html.dark` 切替で `--ink` の値が変わるだけで追従                                                                                                                                                                                                                                                                            |

追加実装（規格上は SHOULD 未満だが UX 上有用）：

- **upgrade 失敗時の plain text fallback 表示**：KaTeX のパースエラー（不正な LaTeX 構文 / 未対応コマンド）時に、元の `$...$` テキストを残したまま toast で「Math render failed」を通知する。MDXG §14 [MUST] 「数式描画がサポートされていない場合、生の文法はそのまま保持される」を「サポートされているが入力が壊れている場合」にも適用する解釈（§15 Diagram Rendering と同じパターン）
- **`\$` でのエスケープ対応**：本物のドル記号（金額表記 `$100` / 環境変数 `$PATH` 等）を数式判定から除外。`\$` を literal `$` として描画する経路を確保

スコープ外（別タスクで扱う）：

- **MathJax / サーバサイド SVG レンダリング**（§14.2 実装例のうち KaTeX 以外）：本実装は単一 HTML 配布の制約があり、KaTeX 同期 API と JS engine ベースで完結する経路が最も整合的。MathJax は async API + 遅延描画が主流で `doc-renderer.ts` の同期前提と衝突する。需要が出てから検討
- **数式へのコメント付与（粒度最小単位 = 数式全体）**：§6 アンカリングはテキスト範囲ベース。`<span class="katex">` 配下の MathML / HTML ツリーに startOffset / endOffset を貼る経路は持たない。本実装では「数式が含まれる段落 / 行に対して通常のテキストコメントを付ける」経路に倒し、数式そのものへの直接コメントは対応外とする
- **MathML 直接記法 (` ```math ` フェンス) のサポート**：MDXG §14 は `$...$` / `$$...$$` のみを規定し、` ```math ` フェンスは MAY 未満。対応するなら別タスク

## 2. リファレンス実装と差分

[vercel-labs/mdxg `apps/web`](https://github.com/vercel-labs/mdxg/tree/main/apps/web) は §14 を実装していない（数式は marked デフォルトの plain text として表示される）。本実装はリファレンス実装の先行参考が無い領域となるため、本章は「ベースラインアーキテクチャ」として既存実装と KaTeX 公式の組み合わせを記述する。

| 既存実装の構成要素                               | 本実装の置換 / 追加                                                                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shiki upgrade の 2 段構成（plain → highlight）   | 初期 render では `$...$` を escape したまま `<span data-math="inline">` / `<div data-math="display">` として出力し、upgrade で KaTeX HTML に置き換える同じパターン |
| `dist/shiki-langs/<lang>.json` の言語別 emit     | `dist/katex/katex.mjs` + `dist/katex/katex.css` の 2 ファイルを別 emit（CLI / standalone build の双方が読み込む素材）                                              |
| CLI `--mermaid <auto\|on\|off>` の mode          | CLI `--math <auto\|on\|off>` mode を追加（既定 `auto`、Mermaid と対称）                                                                                            |
| `<script id="embedded-shiki-langs">` JSON 注入   | `<script id="embedded-katex" type="module">` で KaTeX ESM、`<style id="embedded-katex-css">` で CSS を注入                                                         |
| `core/markdown.ts` renderer の言語別分岐         | marked の `text` / `paragraph` トークン処理で `$...$` / `$$...$$` をスキャンし、escape したまま `<span data-math>` / `<div data-math>` として出力                  |
| Shiki upgrade フェーズ                           | `src/app/katex.ts`（新規）の lazy upgrade フェーズで `requestIdleCallback` 後に KaTeX HTML を生成                                                                  |
| Mermaid `dist/standalone.html` に default inline | KaTeX も同様に `dist/standalone.html` に build 時 inline（§5.k）                                                                                                   |

本実装は KaTeX のフォント資材 (~250 KB woff2 / 4 family) を単一 HTML に inline するコストを踏まえ、経路ごとに異なる方針を採る：`dist/standalone.html` は Shiki bundled 全言語 / Mermaid と同じく「default で全部入り」配布契約を維持し KaTeX を build 時に inline する（§5.k）。CLI 経路（`embed-template.html` → `*-review.html`）は `--math <auto|on|off>` モード（既定 `auto`）で配布物サイズを最適化する opt-in 設計とし、markdown が `$...$` / `$$...$$` を含むときだけ自動注入する。Mermaid (§15) と完全に対称の設計。

## 3. bundle 構成と KaTeX 注入

### 3.1 配布物の構成

DESIGN.md §13 で `dist/` の出口は `dist/standalone.html` / `dist/embed-template.html` / `dist/review-request.mjs` / `dist/shiki-langs/*.json` の 4 系統に分かれる。KaTeX 対応の配布物は次の構成になる：

| ファイル                           | 内容                                                                                                                                                                                                                                                                    | 配布形態                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `dist/standalone.html`             | 単独 Open file 用、Shiki bundled 全言語（約 235）inline 済み + Mermaid inline 済み + **KaTeX 本体 / CSS / 全 20 woff2 family (data URI) も build 時に inline 済み**（Shiki / Mermaid と同じ「default で全部入り」の配布契約、フォント範囲は `all` 相当、設計判断 §5.k） | エンドユーザーが直接ダブルクリック   |
| `dist/embed-template.html`         | review-request CLI が rewrite テンプレートとして読み込む素材。KaTeX 本体 / CSS / フォントは **含まない**（CLI `--math` モードに応じて動的に注入、フォント範囲は `--math-fonts` で選択）                                                                                 | CLI 経由でのみ使用、直接開く想定なし |
| `dist/katex/katex.mjs`             | KaTeX の ESM bundle（vite で別 entry として emit、`build.minify: 'esbuild'` 適用、commit 対象）。standalone build plugin と CLI の双方が読み込む素材                                                                                                                    | CLI / standalone build の入力        |
| `dist/katex/katex.css`             | KaTeX の CSS。`minimal` セット = Main / AMS / Math / Size1〜4 の **9 woff2 family** を data URI として inline 済み（commit 対象）                                                                                                                                       | CLI / standalone build の入力        |
| `dist/katex/katex-fonts-extra.css` | 追加 11 family（Caligraphic / Fraktur / Script / SansSerif / Typewriter）の `@font-face` 定義のみを data URI として inline した差分 CSS。`--math-fonts all` 指定時のみ CLI が追加注入 / standalone build は無条件に追加（§5.g / §5.l、commit 対象）                     | CLI / standalone build の入力        |
| `dist/review-request.mjs`          | CLI 本体。`--math` モードと `--math-fonts` モードに応じて `dist/katex/*` を読み、`embed-template.html` を rewrite した `*-review.html` の `<script id="embedded-katex">` / `<style id="embedded-katex-css">` / `<style id="embedded-katex-fonts-extra-css">` に書き込む | 配布者向け CLI                       |

CLI が生成する配布 HTML（`<mdFileName>-<docHash>-review.html`）のサイズは KaTeX 非注入時（`--math off` または `auto` で 0 件）には現行の `embed-template.html` ベース（~327 KB raw / ~99 KB gzipped、DESIGN.md §12 §2 Code Block Rendering 行）から変動しない。`--math on` 時 / `auto` 検出時は `--math-fonts` の値に応じて (a) `minimal`（既定）で +200 KB gzipped 前後、(b) `all` で +310 KB gzipped 前後の増加。この設計により、数式を必要としないレビューフローと、`\mathcal` / `\mathfrak` / `\mathscr` 等の珍しい記号を使わない典型的な数式フローの両方が肥大化を最小化される。

`dist/standalone.html` には KaTeX runtime を build 時に inline する（設計判断 §5.k）。Shiki bundled 全言語 / Mermaid と同じ「default で全部入り」配布契約を維持し、standalone を直接ダブルクリックで開いたユーザーも `$...$` / `$$...$$` を KaTeX 描画で受け取れる。フォント範囲は `all` 相当（全 20 family）で固定。サイズ増分は KaTeX JS + CSS + 全 family data URI 込みで gzip 約 +310 KB（現行 ~45 MB / gzip ~5.9 MB → ~46 MB / gzip ~6.3 MB 目安）。

#### フォント data URI 化の理由

KaTeX は数式描画に専用フォント（KaTeX_Main / KaTeX_Math / KaTeX_AMS / KaTeX_Size1〜4 / KaTeX_Caligraphic / KaTeX_Fraktur / KaTeX_Script / KaTeX_SansSerif / KaTeX_Typewriter の bold / italic 派生込みで全 20 woff2 family）を要求する。`@font-face src: url('KaTeX_Main-Regular.woff2')` で外部参照させると：

- `file://` 起動時にフォントが解決できず、数式の字形が壊れる
- HTTP モード起動時も CLI が個別フォントを配信する経路を持たないため同様に壊れる
- CSP `font-src` に `https:` 等を追加する必要が出る（DESIGN.md §11 信頼境界の緩和を伴う）

ビルド時に `katex/dist/fonts/*.woff2` を base64 化して `katex.css` の `url(...)` を `url(data:font/woff2;base64,...)` に書き換える。`url(*.ttf)` / `url(*.woff)` は `url(about:blank)` に潰し、`src:` リスト内の woff2 data URI に fallthrough させる（modern target は全て woff2 をサポート）。あわせて DESIGN.md §11 の CSP に `font-src data:` を 1 行追加する。これにより：

- CSP は `font-src data:` のみで動作（`'self'` / `https:` 等は不要、`data:` URI の inline フォントだけが取得対象になる）
- `font-src` ディレクティブは未指定時に `default-src 'none'` にフォールバックして deny されるため、明示的に `font-src data:` を書く必要がある（CSP Level 3 仕様）。`data:` URI による信頼境界への影響は最小で、レビュー対象 markdown から `<style>` を出力する経路は `core/markdown.ts` の renderer で禁止済みであり、新たな `data:font/...` の流通経路は存在しない
- `file://` 起動 / HTTP モード起動 / KaTeX 注入された HTML（`dist/standalone.html` の default inline 経路 / CLI `--math on` / `auto` 注入経路）をネットワーク隔離環境で開いた場合、すべて同じ字形で描画される

ただし `data:` URI は base64 化で原寸 +33% のサイズ増となる。woff2 はすでに Brotli 圧縮済みフォーマットで gzip による追加圧縮が効きにくく、woff2 全 20 family の raw ~260 KB が gzip 後もほぼそのまま乗る（Step 1 PoC 実測）。このため本実装は **`--math-fonts <minimal|all>` で family 範囲を CLI から制御する**（既定 `minimal`、§5.g / §5.l）：

- **`minimal`（既定）**: Main / AMS / Math / Size1〜4 の 9 family（raw ~150 KB）。`\mathcal` / `\mathfrak` / `\mathscr` / SansSerif / Typewriter は OS フォントへ fallback。MDXG レビュー対象の典型用途（仕様書 / 技術解説 / 一般的な数式）では支配的でない
- **`all`**: 全 20 family（raw ~260 KB）。`\mathcal` / `\mathfrak` / `\mathscr` 等の珍しい記号も完全な字形で描画

`dist/standalone.html` は配布契約「default 全部入り」を維持して `all` 相当を inline（§5.k）。

### 3.2 CLI による KaTeX 注入

`src/cli/parse-args.ts` に 2 軸の mode を追加する（`--shiki-langs` / `--mermaid` と同じ mode 型インターフェース）：

| flag                          | 既定      | 役割                                                            |
| ----------------------------- | --------- | --------------------------------------------------------------- |
| `--math <auto\|on\|off>`      | `auto`    | KaTeX runtime（JS + CSS + フォント）を注入するか                |
| `--math-fonts <minimal\|all>` | `minimal` | 注入時のフォント family 範囲（`--math off` 時は意味を持たない） |

`--math` の値ごとの挙動：

| `--math` 値    | 挙動                                                                                                                                                                                                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auto`（既定） | `countMath(markdown).inline + countMath(markdown).display > 0` のときだけ KaTeX を注入。0 件のときは注入せず配布物サイズも増えない。markdown が `$...$` / `$$...$$` を含むかどうかに配布物サイズが連動する挙動で、配布者が markdown 内容を意識せず CLI を回しても無駄な肥大化が起きない |
| `on`           | 件数に関係なく必ず KaTeX を注入。stdin 経路や将来の動的差し替えで「数式がまだ無いが後から増える」前提の配布に使う                                                                                                                                                                       |
| `off`          | KaTeX を注入しない。`$...$` / `$$...$$` は raw な markdown 文法のまま plain text として表示（MDXG §14 [MUST] 生の文法保持）。配布物サイズを最小化したい / レビュアー環境を制約したいときに使う                                                                                          |

`--math-fonts` の値ごとの挙動：

| `--math-fonts` 値 | 挙動                                                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `minimal`（既定） | `dist/katex/katex.css`（Main / AMS / Math / Size1〜4 の 9 family）のみ注入。`\mathcal` / `\mathfrak` / `\mathscr` / SansSerif / Typewriter は OS フォントへ fallback。配布物サイズの増分を抑える |
| `all`             | `dist/katex/katex.css` + `dist/katex/katex-fonts-extra.css`（追加 11 family）の両方を注入。`\mathcal` / `\mathfrak` / `\mathscr` 等の珍しい記号も完全な字形で描画                                |

`dist/standalone.html` は configurability を持たず、build 時に `all` 相当（katex.css + katex-fonts-extra.css の両方）が inline される（§5.k）。

#### 注入経路

`src/core/embed.ts` の rewrite ロジックに `katexRuntime?: { js: string; css: string; fontsExtraCss?: string }` 引数を追加し、次のブロックを書き込む：

```html
<style id="embedded-katex-css">
  /* KaTeX CSS、フォント @font-face は data:font/woff2;base64,... に書き換え済み（minimal セット） */
</style>
<!-- --math-fonts all のときだけ追加で書かれる -->
<style id="embedded-katex-fonts-extra-css">
  /* 追加 11 family の @font-face のみ、data:font/woff2;base64,... */
</style>
<script id="embedded-katex" type="module">
  import katex from '...inline KaTeX ESM source...'
  globalThis.__mdxgKatex = katex
  document.dispatchEvent(new Event('mdxg:katex-ready'))
</script>
```

bridge global (`globalThis.__mdxgKatex`) + `mdxg:katex-ready` イベントの経路は §15 Mermaid と同じ方式で、`docs/mdxg-diagram-rendering.md` §3.2 / §5.j の論点をそのまま再利用する（重複論点として §5.h で再記述）。

エンコード規約は `embedded-md` / `embedded-shiki-langs` / `embedded-mermaid` と同じく、KaTeX ESM ソース中に `</script>` 文字列が含まれていないことをビルド時に sanity check する（Step 1 PoC で KaTeX 0.16.47 では含まれないことを確認済み、version up 時は再検証）。

#### ブラウザ側の読み込み（bridge 方式）

`src/app/katex.ts`（新規）で起動時に `<script id="embedded-katex">` の有無を確認する。存在する場合、`type="module"` の script は HTML パース完了後に同期で実行され `globalThis.__mdxgKatex` に KaTeX インスタンスがセットされる。`upgradeMathElements` は `requestIdleCallback`（fallback: `setTimeout(..., 0)`）で paint 後に schedule され、その時点で `globalThis.__mdxgKatex` を同期で読み出して使用する。

### 3.3 配布物サイズの実測見積もり

CLI 生成 `*-review.html`（`embed-template.html` ベース）と `dist/standalone.html` への KaTeX 注入後のサイズ（Step 1 PoC 実測ベース、KaTeX 0.16.47、Vite esbuild minify 適用後の推定込み）：

| ケース                                                                             | 配布 HTML raw   | KaTeX JS 増分                                       | KaTeX CSS + フォント増分                                                                                   | gzipped 後の配布物    |
| ---------------------------------------------------------------------------------- | --------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------- |
| `*-review.html`: `--math off` または `auto` で 0 件（後者が既定挙動）              | ~327 KB（現行） | 0 KB                                                | 0 KB                                                                                                       | ~99 KB（現行）        |
| `*-review.html`: `--math on` / `auto` で 1 件以上 + `--math-fonts minimal`（既定） | ~327 KB         | +280 KB raw / +90 KB gzipped（minify 適用後の推定） | +210 KB raw / +110 KB gzipped（9 family woff2 を data URI 化、woff2 は Brotli 圧縮済みで gzip 効きが薄い） | ~300 KB               |
| `*-review.html`: `--math on` / `auto` で 1 件以上 + `--math-fonts all`             | ~327 KB         | +280 KB raw / +90 KB gzipped                        | +370 KB raw / +220 KB gzipped（20 family woff2 を data URI 化）                                            | ~410 KB               |
| `dist/standalone.html`: KaTeX 同梱（build 時 default、フォント `all` 相当、§5.k）  | ~45 MB（現行）  | +280 KB raw / +90 KB gzipped                        | +370 KB raw / +220 KB gzipped                                                                              | ~6.2 MB（~46 MB raw） |

実測の根拠は `.temp/katex-poc/` 配下の PoC（Step 1）。`katex.mjs` raw 601 KB → minify 推定 ~280 KB、woff2 は base64 化 +33% × Brotli 圧縮済み特性で gzip がほぼ raw を維持する点が見積もり改訂の主因。CLI 経路の `auto` 検出 / `on` 注入時に stderr へ `Detected N math expression(s). Embedding KaTeX runtime (fonts=<minimal|all>, ~+<sz> KB gzipped).` を出す。

## 4. 実装ステップ

順序は依存関係順。各ステップ完了で in-source test と手動視覚チェックを通す。

### Step 1: ライブラリ選定の検証と PoC（完了）

- ✓ 本ドキュメントの §5 設計判断をレビュー
- ✓ KaTeX ESM build (`katex/dist/katex.mjs`) が `import` 経由で読み込めること、`katex.renderToString(src, { displayMode })` が同期で返ることを Node PoC で確認（5 ケースで計 5.61ms、`.temp/katex-poc/render.mjs`）
- ✓ 配布物サイズ実測（raw / gzipped）。実測値で §3.3 表を更新（`katex.mjs` raw 601 KB / gzip 149 KB、katex.css + 全 20 woff2 family inline で raw 369 KB / gzip 264 KB、合算 raw 970 KB / gzip 413 KB）。Step 5 の `requestIdleCallback` schedule での FCP / TTI 計測は Step 5b 着手時にブラウザで実施
- ✓ フォント data URI 化スクリプトの PoC（`.temp/katex-poc/build-css.mjs`）：`katex/dist/fonts/*.woff2` を base64 化し `url(*.ttf)` / `url(*.woff)` は `url(about:blank)` に潰す Node script を書き、生成 CSS（`.temp/katex-poc/katex.inlined.css`）を確認
- ✓ `\href` / `\url` / `\includegraphics` / `\htmlClass` 等の外部リソース系コマンドが `trust: false` 既定で `<mtext>` として escape されることを確認（`<a href>` は出力されない、`.temp/katex-poc/render.mjs`）
- ✓ `katex-error` class が出る条件と best-effort 描画の境界を確認：文法エラー（unbalanced brace / unknown env / missing arg / 単独 `$`）→ `katex-error` 出力 / 未知マクロ（`\href` / `\unknown_command`）→ best-effort `<mtext>` 描画で `katex-error` は出ない。§5.b / Step 5b の判定境界に反映
- ✓ `katex.mjs` 内に literal `</script>` が含まれていないことを確認（KaTeX 0.16.47）

成果物：§3.3 / §5.b / §5.f / §5.g / §5.k / §7 マッピング表がすべて実測値ベースに更新、`.temp/katex-poc/{render,render2,build-css}.mjs` + `katex.inlined.css`、PoC スクリプトは Step 3 で `scripts/build-katex-css.mjs` の実装参考とする

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

### Step 3: ビルド側 — KaTeX bundle の emit + フォント data URI 化 + standalone への inline

- `vite.review-request.config.ts`（もしくは新規 `vite.katex.config.ts`）に KaTeX ESM を別 entry として emit する設定を追加（`dist/katex/katex.mjs` として書き出し、CLI bundle 自体には含めない）。**`build.minify: 'esbuild'` を適用** し、Step 1 PoC 実測の raw 601 KB を ~280 KB まで縮める
- `scripts/build-katex-css.mjs`（新規）で `katex/dist/katex.min.css` を読み込み、`@font-face src: url('fonts/KaTeX_<family>.woff2')` を `url(data:font/woff2;base64,...)` に書き換え、`url(*.ttf)` / `url(*.woff)` は `url(about:blank)` に潰して **2 系統の CSS** を出力する（実装参考は `.temp/katex-poc/build-css.mjs`）：
  - `dist/katex/katex.css`：**minimal セット** = Main / AMS / Math / Size1〜4 の 9 family のみ data URI inline
  - `dist/katex/katex-fonts-extra.css`：**追加 11 family** = Caligraphic / Fraktur / Script / SansSerif / Typewriter の `@font-face` ブロックのみ抜き出し、data URI inline。`--math-fonts all` 指定時 / standalone build 時のみ追加注入
  - 2 系統に分けるのは Shiki の `dist/shiki-langs/<lang>.json` を個別 emit して CLI が動的注入する方式と同じパターン
- `vite.config.ts` の `closeBundle` フックで `scripts/build-katex-css.mjs` を呼ぶ（Shiki の grammar emit と同じ流れ）
- `dist/katex/` 配下は **生成物だが commit 対象**（`dist/shiki-langs/` / `dist/mermaid.mjs` と同じ配布契約。clone 直後の利用者が `npm run build` 抜きで CLI / standalone どちらも実行できる）
- `package.json` に `katex` を `dependencies`（非 dev）として追加し、version を exact pin
- フォント data URI 化スクリプトは KaTeX の dist 構造に依存するため、KaTeX version up 時に動作確認するチェックを `scripts/build-katex-css.mjs` の冒頭にバージョン assert として組み込む
- **standalone への inline**: `vite.config.ts` の `mdxg-split-outputs` plugin（あるいは新規 `mdxg-katex-asset` plugin）が closeBundle で `dist/katex/katex.mjs` / `katex.css` / `katex-fonts-extra.css` の 3 ファイルを読み、`</script>` sanity check を施した上で `dist/standalone.html` の `<script id="embedded-katex" type="module">` / `<style id="embedded-katex-css">` / `<style id="embedded-katex-fonts-extra-css">` の 3 ブロックに inline する（standalone は `--math-fonts all` 相当固定）。CLI 経由（embed-template.html → \*-review.html）と standalone build で同じ bridge 注入規約（`globalThis.__mdxgKatex` セット + `mdxg:katex-ready` イベント）を共有するため、ブラウザ側 `src/app/katex.ts` のロジック分岐は不要

成果物：`dist/katex/katex.mjs`（minify 済み）と `dist/katex/katex.css` / `dist/katex/katex-fonts-extra.css` が emit され commit 対象になる + `dist/standalone.html` に KaTeX runtime / CSS / 全 20 family フォント data URI が inline 済み

### Step 4: CLI 側 — `--math <auto|on|off>` / `--math-fonts <minimal|all>` mode と注入

- `src/cli/parse-args.ts` に 2 つの mode を追加：
  - `--math <auto|on|off>`（既定 `auto`）— `parseMathValue` は `parseMermaidValue` と同じ pattern で実装
  - `--math-fonts <minimal|all>`（既定 `minimal`）— `parseMathFontsValue` を新規追加、未知の値はエラーで reject。`--math off` のときは無視（warning は出さず黙って ignore、Shiki の `--shiki-langs none` × csv のような組合せと同じ振る舞い）
- `src/cli/review-request.ts` のエントリで `--math` mode と `countMath(markdown).inline + countMath(markdown).display` から「注入する / しない」を解決：
  - `auto`: 件数 > 0 なら注入
  - `on`: 常に注入
  - `off`: 常に注入しない
- 注入する場合は `dist/katex/katex.mjs` と `dist/katex/katex.css` を `readFileSync` で読み込み、`--math-fonts all` のときだけ `dist/katex/katex-fonts-extra.css` も読み込む。`core/embed.ts` の `katexRuntime` 引数（`{ js, css, fontsExtraCss? }`）に渡す
- `src/core/embed.ts` に `katexRuntime?: { js: string; css: string; fontsExtraCss?: string }` 引数を追加し、`<script id="embedded-katex" type="module">` / `<style id="embedded-katex-css">` / （`fontsExtraCss` 指定時のみ）`<style id="embedded-katex-fonts-extra-css">` をそれぞれ rewrite。`katexRuntime` が undefined なら 3 ブロックすべてを書かない
- HELP_TEXT 更新：
  - `--math <auto|on|off>` の意味（auto = 自動検出、on = 常時注入、off = 注入しない）と既定値（auto）
  - `--math-fonts <minimal|all>` の意味（minimal = 9 family / +200 KB gzipped 前後、all = 20 family / +310 KB gzipped 前後）と既定値（minimal）、`\mathcal` / `\mathfrak` / `\mathscr` 等の珍しい記号が必要なら `all` を指定する旨を一文添える
- 注入判定時に CLI が stderr へ `Detected N math expression(s). Embedding KaTeX runtime (fonts=<minimal|all>, ~+<sz> KB gzipped).` と件数 / フォント範囲 / サイズ概算を報告し、配布者が気づける導線を残す（Mermaid と対称）

成果物：CLI が mode と検出結果から `embedded-katex` / `embedded-katex-css` / `embedded-katex-fonts-extra-css` 注入を決定できること（in-source test で `--math` × `--math-fonts` × 件数 0/1 の組合せを網羅検証）

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
    - display: `<span data-math="display" data-math-source="\frac{a}{b}">$$\frac{a}{b}$$</span>`（Step 9 で `<div>` から `<span>` に変更。renderer.text は marked が inline 文脈で呼ぶため `<div>` を返すと HTML5 parser が親 `<p>` を強制 close して構造が壊れる。block 表示は CSS の `display: block; margin: 1em 0; text-align: center` で再現、`src/styles/markdown.css` の `#doc [data-math="display"]`、§5.c 参照）
  - textContent に raw `$...$` を残すことで MDXG §14 [MUST] 「描画未サポート時は生の文法を保持」「ストリップ / 隠蔽してはならない」を初期 paint 時点から満たす（`--math off` 配布 / `--math auto` で 0 件時 / upgrade 失敗時のいずれでも raw `$...$` が読める）
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
  - パースエラー時の判定境界（Step 1 PoC で確定）：`katex.renderToString` は `throwOnError: false` で常に文字列を返し throw しない。返り値の挙動は 2 系統に分かれる：
    - **文法エラー**（unbalanced brace / unknown environment / missing argument / 単独 `$` 等）→ `<span class="katex-error" title="ParseError: ..." style="color:inherit">原文</span>` を返す。`includes('katex-error')` で確実に検出可能。**この経路だけ** `data-math-failed="1"` を付け、toast で「Math render failed for N expression(s)」を集約表示
    - **未知マクロ / 制限付きマクロ**（`\href` / `\url` / `\includegraphics` / `\htmlClass` / `\unknown_command` 等）→ `<mtext>\href</mtext>` のような best-effort `<mtext>` 描画を返し、`katex-error` class は出力されない。信頼境界としては OK（リンクや HTML として機能しない、§5.f）だが toast の対象外とする。`strict: 'warn'` で stderr に console warning は出るが、レビュアー UI には通知しない（仕様上の動作で、エラーではない）
- KaTeX `trust: false` を必須化する理由は §5.f 信頼境界参照

成果物：

- 初回 paint は既存と同じく素早く完了（embedded-katex 読み込みは paint 後）
- paint 後 idle callback で KaTeX 描画が追加適用される
- embedded-feedback の `<mark class="cmt">` は upgrade 後も `data-math` 要素を含む段落で正しい位置に再貼付される
- 未対応構文や parse 失敗は plain text fallback + toast 通知

### Step 6: §6 アンカリングと §10 Search の維持確認

- §6 のブロックフラットテキストオフセット計算は `textContent` ベースで動く。`<span data-math="inline" data-math-source="x">$x$</span>` の textContent は upgrade 前は `$x$`、upgrade 後は KaTeX 出力（MathML / HTML テキスト）に変化する。**この textContent 変化がオフセット計算を狂わせる**ため、`selection.ts` の `textSegments` が `[data-math]` 要素を skip 対象として扱う：
  - `SKIP_TEXT_SEGMENT_ATTR_NAMES = ['data-math']` で `hasAttribute('data-math')` の有無で skip 判定（値 `'inline'` / `'display'` は問わない）
  - 子孫を walk せず、要素自体は無視されるため周辺 text node のオフセットが upgrade 前後で完全に不変になる
  - 代償として「数式そのものへのコメント付与は対応外」（§1 で明文化）。§10 Search の LaTeX ソース検索は将来拡張に回す
- **要素境界経路の整合** (Step 9 で追加): `textOffsetForElementBoundary` も同じく `[data-math]` 子孫の textContent を `range.toString().length` から引き算する。`selection.ts` の `skippedMathTextLengthInRange` が `Range.compareBoundaryPoints` で range 内に完全に含まれる math 要素を集計し、textSegments 経路と要素境界経路でオフセット基準を揃える（外部レビュー指摘 #3 への対応）
- upgrade を 2 回呼んでも `data-math-applied` ガードで二重描画にならないこと（idempotent、Step 5b で保証）
- KaTeX パースエラー時に `data-math-failed="1"` が付き、`data-math-source` 属性が保持されること（Step 5b で保証）
- テスト環境に DOM がない (DESIGN.md §12 既知の制限) ため、Step 6 の DOM 不変条件テストは `SKIP_TEXT_SEGMENT_ATTR_NAMES` 配列の constant identity test で代替（attribute 名が `data-math` から逸脱したら fail）。実 DOM 検証は E2E build + ブラウザ手動確認に依存

成果物：既存コメント / 検索が付いた markdown を 数式含みで再読込しても §6 オフセット整合性が壊れないこと

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
- DESIGN.md §3 review-request CLI コマンド仕様に `--math <auto|on|off>` と `--math-fonts <minimal|all>` を追記（前者は既定 `auto` / auto の判定挙動とサイズ影響、後者は既定 `minimal` / 9 family vs 20 family の差とサイズ影響）
- DESIGN.md §11 セキュリティ：KaTeX `trust: false` / `strict: 'warn'` の挙動と `<script id="embedded-katex" type="module">` / `<style id="embedded-katex-css">` の信頼境界を 1 段落で追記。CSP に `font-src data:` を 1 行追加し、その理由（KaTeX フォント data URI 用、`'self'` / `https:` を緩和しない最小許可）を明記
- DESIGN.md §13 ビルドパイプライン：`dist/katex/` の出口を §13 全体像と表に追加し、`dist/standalone.html` が KaTeX runtime / CSS / フォント (data URI) を default inline で同梱すること、CLI 経路（`embed-template.html` → `*-review.html`）は `--math` モードで opt-in 注入することを併記。`scripts/build-katex-css.mjs` も §13 開発時依存に追加
- DESIGN.md §1 概要 / §13 配布物の対応表：`dist/standalone.html` の grammar inline 説明に Mermaid / KaTeX 同梱を追記（Shiki と並列の「default で全部入り」要素として扱う）
- DESIGN.md §13 末尾「ソース構成の責務境界」：`src/core/math.ts` / `src/app/katex.ts` / `scripts/build-katex-css.mjs` / `dist/katex/` を追加
- DESIGN.md §12「その他の拡張候補」の MDXG §14 項目を削除（実装済みになるため）
- 本ドキュメントは `docs/mdxg-math-rendering.archive.md` にリネーム

成果物：DESIGN.md 更新 + 本ドキュメントの archive

## 5. 設計判断

### a. ライブラリ選定：KaTeX（vs MathJax / SVG サーバサイド）

| 候補             | 採用 | 理由                                                                                                                                                                                                              |
| ---------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **KaTeX**        | ✓    | 同期 API (`katex.renderToString`) で paint 後 idle callback 内に order なく upgrade 可能。Step 1 PoC で 5 ケース計 5.61ms と十分高速。bundle サイズは raw 601 KB / minify 推定 ~280 KB で MathJax より 1/3 小さい |
| MathJax          | ✗    | より広い LaTeX カバレッジを持つが async API + 遅延描画前提で `doc-renderer.ts` の同期前提と衝突。bundle が ~1 MB と大きく、単一 HTML 配布での影響が許容できない                                                   |
| サーバサイド SVG | ✗    | レビュー対象が事前に決まっていないため、CLI 実行時に全数式を SVG 化する経路が必要。実装コストが高く、`--math` 指定時のフォントレンダリングを Node 側で再現する複雑性も伴う                                        |

KaTeX の LaTeX カバレッジ不足（`\begin{align}` の一部 / `\newcommand` の制限等）は MDXG レビュー対象の典型用途（仕様書 / 技術解説 / 数式 1〜2 行）では支配的でない。複雑な数式が必要なケースは将来 MathJax 切替えオプション (`--math-engine mathjax`) を opt-in で追加できる経路を温存する。

### b. KaTeX 初期化のタイミング：paint 後の lazy 読み込み + 各 math element 単位の upgrade

| 候補                                                                  | 採用 | 理由                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. 起動時に同期で KaTeX 初期化 + 全数式描画                           | ✗    | KaTeX 本体 + CSS + フォント（minimal で gzip ~+200 KB / all で gzip ~+310 KB、§3.3）の parse + 全数式の renderToString が paint 前に走り、`loading spinner` 表示時間が伸びる。embedded markdown ロード時の FCP 劣化が許容できない                                            |
| B. async marked renderer の中で KaTeX 描画を await                    | ✗    | KaTeX は同期 API のため async 化のメリットがない。`doc-renderer.ts` の同期前提を崩すコストを払う動機がない                                                                                                                                                                   |
| **C. paint 後 `requestIdleCallback` で lazy 初期化 + 各要素 upgrade** | ✓    | 初期描画は plain `<span data-math>` で即時 paint。idle callback で `globalThis.__mdxgKatex`（bridge 方式、§3.2 / §5.h）から KaTeX インスタンスを取得し、各要素を KaTeX HTML に upgrade する。Shiki / Mermaid と同じパターンで、既存 paint パスを変えずに追加機能を載せられる |

C 案の論点と mitigation：

- **「LaTeX ソース → 描画済み数式のちらつき」**: 初期 paint で `[data-math]` に `font-family: monospace; opacity: 0.6` を当てて「処理中」感を視覚化し、upgrade 完了で `opacity: 1` に戻す。完全な視覚一貫性より「LaTeX ソースが見えている → 数式に化ける」流れを可視化する方向に倒す（Shiki の「色が薄く乗る」と同じ思想）
- **upgrade 中の選択操作**: Shiki / Mermaid と同じく `getSelection().toString().length > 0` でスキップし `selectionchange` で再試行
- **既存 `<mark class="cmt">` の維持**: `[data-math]` 要素は `<span>` / `<div>` 単位で independent な subtree、upgrade で innerHTML が差し替わるが要素自体は残る。`blockOriginalHTML` の再構築で対応（Shiki / Mermaid と同じ）

### c. 数式要素の DOM 配置：両タイプとも `<span data-math>` で出力し、display は CSS で block 化

| 候補                                                              | 採用 | 理由                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. inline / display とも `<span data-math>` (CSS で block 化)** | ✓    | `renderer.text` は marked が paragraph / heading / list_item の inline 文脈で呼ぶため、ここで `<div>` を返すと HTML5 parser が `<p>` を強制 close して構造が壊れる (`<p>text </p><div>...</div><p> more</p>` のような分割)。block 表示は CSS の `display: block; margin: 1em 0; text-align: center` で再現でき、KaTeX upgrade 後の `.katex-display` も同じ値を当てるため整合する |
| B. inline は `<span>`、display は `<div>`                         | ✗    | Step 5a で当初採用したが上記の HTML5 parser 強制 close 問題で構造が崩れる (Step 9 / 外部レビュー指摘 #2)。`<p>` 自動 close が起きると `#doc` 直下の `data-block-id` 連番が DOM 側で増え、`block-anchors` (lexer 側) との 1:1 対応が壊れる                                                                                                                                        |
| C. `<math>` (MathML) タグで初期 render                            | ✗    | marked renderer から MathML を生成するコストが高く、KaTeX 経由の生成と二重実装になる。upgrade で innerHTML を差し替える前提なら初期 render は plain text で十分                                                                                                                                                                                                                  |
| D. KaTeX 公式パターン `<span class="math math-inline">`           | ✗    | KaTeX 自身が `katex` / `katex-display` クラスを upgrade 後に付与するため、初期 render 段階の class は upgrade との衝突を避ける名前にしたい。`data-math` 属性方式は KaTeX class とは独立に管理できる                                                                                                                                                                              |

A 案の追加考慮：

- `data-math` の値は `'inline'` / `'display'` の 2 値のみ（数値や複雑な構造を持たせない）
- `data-math-source` は Step 5a の初期 render 時に scan 結果から焼き込み（`$` 区切り除去済み）。upgrade では参照のみで書き換えない。textContent は raw `$...$` を保持し、§14 [MUST] の plain text fallback を初期 paint から成立させる
- upgrade 後に付ける `data-math-applied="1"` / `data-math-failed="1"` の組合せで状態管理（Mermaid と対称）
- display 表示は CSS `#doc [data-math="display"] { display: block; margin: 1em 0; text-align: center }` で再現。KaTeX upgrade 後は内側に出る `.katex-display` も同じ block 化を行うため二重指定だが値が同じで衝突しない

### d. CLI インターフェース：`--math <auto|on|off>` mode（vs boolean flag）

| 候補                               | 採用 | 理由                                                                                                                                                                                                                        |
| ---------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. `--math <auto\|on\|off>`**    | ✓    | 既存 `--shiki-langs <auto\|all\|none\|csv>` / `--mermaid <auto\|on\|off>` と同じ mode 型インターフェース。UX の一貫性を保ち、配布者が `auto` 既定で「数式があれば描画、無ければ最小配布物」を得られる。Mermaid と完全に対称 |
| B. `--math` boolean flag           | ✗    | 「指定 / 未指定」の 2 値で表現力が不足。boolean では `auto`（検出依存）を表せず、配布者が markdown を都度 grep して flag を付け替える運用になる                                                                             |
| C. `--math <katex\|mathjax\|none>` | ✗    | エンジン選択と注入判定を 1 軸に混ぜると将来 MathJax 追加時に意味論が壊れる。エンジン選択は将来 `--math-engine <katex\|mathjax>` を独立 flag で追加すれば良い                                                                |

将来 MathJax が追加された場合：`--math <auto|on|off>` で注入判定、`--math-engine <katex|mathjax>` でエンジン選択、を直交させる。

### e. デフォルトは `auto`（vs OFF / `on`）

| 候補                 | 採用 | 理由                                                                                                                                                                                                                                                                                                                                             |
| -------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`auto`（既定）**   | ✓    | `$...$` / `$$...$$` を含まない markdown では注入が skip され配布物サイズが現行から変わらない。含む markdown のときだけ注入され配布物サイズが連動して増える。配布者が markdown 内容を意識せず CLI を回しても無駄な肥大化が起きない。`--mermaid auto` / `--shiki-langs auto` と対称。誤検出リスクは §1 のスコープ宣言と §5.i `\$` エスケープで対処 |
| `off`（明示 opt-in） | ✗    | 数式を書いた markdown を `--math on` 抜きで配布すると raw `$...$` のまま残り、配布者が「描画されない」事故を踏みやすい。`auto` ならこの事故が構造的に消える                                                                                                                                                                                      |
| `on`（常時 ON）      | ✗    | 数式を含まない markdown でも minimal で gzip ~+200 KB / all で gzip ~+310 KB（§3.3）増える経路を既定にすると、他のレビューフロー（仕様書 / 散文中心）への影響が大きい                                                                                                                                                                            |

`auto` のリスク mitigation：

- 自然言語 `$` の誤検出（`$100 と $200` 等）は `scanMath` の Pandoc 風境界条件（opening `$` の直後が空白/数字なら除外、closing `$` の直前が空白なら除外）で **構造的に弾く**（Step 9、§5.i）。Step 5 初期は「ユーザー責務」として `\$` エスケープを必須化する方針だったが、外部レビュー指摘 #1 で「`--math auto` の趣旨と矛盾」「誤検出された `$100 and $` を KaTeX が `katex-error` で赤エラー表示」事故が指摘され、構造的除外に切り替えた。`scanMath` 自体はコードブロック / インラインコード内の `$` も marked AST 経由で除外する
- markdown を編集している途中で意図せず `$` が混入した場合、配布物サイズが突然 +200〜310 KB gzip 増える経路ができる。CLI が auto モードで注入判定時に stderr へ `Detected N math expression(s). Embedding KaTeX runtime (fonts=<minimal|all>, ~+<sz> KB gzipped).` と件数 / フォント範囲 / サイズ概算を報告し、配布者が気づける導線を残す
- 明示的に「絶対に注入したくない」配布者は `--math off` で意図表明できる

### f. KaTeX 信頼境界：`trust: false` + `strict: 'warn'` 必須化

KaTeX には外部リソース系コマンド（`\href` / `\url` / `\includegraphics` 等）と、文字列を任意の HTML / CSS として扱う命令（`\htmlClass` / `\htmlStyle` / `\htmlData` 等）がある。レビュー対象 markdown が LLM 生成物で信頼できない前提（DESIGN.md §11）と整合させるため：

- `katex.renderToString(src, { trust: false, strict: 'warn', throwOnError: false, errorColor: 'inherit' })` を必須化
- `trust: false` で `\href` / `\url` 等の外部 URL を含む命令を escape 表示にする（リンクとして機能させない）
- `strict: 'warn'` で `\newcommand` 等の制限付き命令を warning として扱い、render を続行（`throw` ではない）
- `throwOnError: false` で構文エラー時に例外を投げず、`<span class="katex-error">` 経由でエラー表示
- `errorColor: 'inherit'` で error も `--ink` 配色を継承（§7 Theming）

代替案 `trust: true`（全コマンド許可）は採用しない。strict 'error' は LLM 生成数式の細かい記法ゆれで頻発 throw する可能性があり、UX を損ねる。

CSP `script-src 'self' 'unsafe-inline'` の既存許可で `<script id="embedded-katex" type="module">` が動作する。KaTeX 自身は fetch / XHR を行わないため `connect-src 'none'` の既存制約も維持される。

**Step 1 PoC で確認した挙動**（`.temp/katex-poc/render.mjs`、KaTeX 0.16.47）：

- `\href{https://evil/}{click}` / `\url{...}` / `\includegraphics{...}` / `\htmlClass{...}{x}` はいずれも `<mtext>\href</mtext>` のような best-effort `<mtext>` 描画になり、`<a href>` や任意 HTML / class 適用は一切出力されない。`trust: false` の信頼境界は実装通り機能する
- 同時に `katex-error` class は出ない（best-effort 描画は KaTeX 内部仕様としては「正常レンダリング」扱い）。Step 5b の `data-math-failed` 判定は文法エラー時のみ反応し、未知マクロは silent best-effort になる（§5.b の判定境界明確化と整合）

### g. フォント data URI 化：`font-src data:` の最小許可で `'self'` / `https:` を緩和しない + family 範囲を CLI から制御

| 候補                                                                     | 採用 | 理由                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A. フォントを `url(data:font/woff2;base64,...)` で inline**            | ✓    | CSP に `font-src data:` を 1 行追加するだけで動作（`'self'` / `https:` への緩和不要）。`file://` / HTTP モード / オフライン環境すべてで同じ字形が描画される。サイズは Step 1 PoC 実測で全 20 family 合算 gzip ~220 KB（woff2 が Brotli 圧縮済みのため raw に近い） |
| B. フォントを `dist/katex/fonts/*.woff2` に置き `font-src 'self'` を許可 | ✗    | DESIGN.md §11 信頼境界を緩和する。`file://` 起動時に `'self'` が `file://` を許可するかブラウザ実装依存で動作が不安定。HTTP モードでも CLI が個別フォントを配信する経路を持たないため二度手間                                                                      |
| C. フォントを bundle せず数式が崩れた字形で表示                          | ✗    | MDXG §14 [SHOULD] 「ホストのフォントサイズと色スキームに適応」を満たせない。数式描画品質が KaTeX の前提に依存するため、フォント未供給は事実上 §14 非対応と同等                                                                                                     |

A 案の追加考慮：

- KaTeX 公式 dist は 20 woff2 family を提供する（Main / Math / AMS / Caligraphic / Fraktur / Script / SansSerif / Typewriter の Regular/Bold/Italic 派生 + Size1〜4）。Step 1 PoC で `katex.min.css` の `url(*.ttf)` / `url(*.woff)` は `url(about:blank)` に潰し、`url(*.woff2)` だけを data URI 化する経路で sound に動作することを確認済み（modern target は全て woff2 サポート）
- **family 範囲の CLI 制御**: woff2 が Brotli 圧縮済みフォーマットのため gzip での追加圧縮が効きにくく（実測：全 20 family raw 260 KB → gzip 220 KB）、フル inline は CLI 経路の配布物サイズに無視できない影響を与える。`--math-fonts <minimal|all>` で family 範囲を選ばせ、minimal（既定）= 9 family / +110 KB gzip、all = 20 family / +220 KB gzip にする（§5.l）
- **minimal セットの選定基準**: Main / AMS / Math / Size1〜4 の 9 family を選ぶ。MDXG レビュー対象の典型用途（仕様書 / 技術解説 / 数式 1〜2 行）の支配的記法（`\frac` / `\sum` / `\int` / `\alpha` 等のギリシャ文字 / 大型演算子 / 行列 / 角括弧）はこの 9 family で網羅できる。除外される 11 family（Caligraphic / Fraktur / Script / SansSerif / Typewriter）は `\mathcal{X}` / `\mathfrak{X}` / `\mathscr{X}` / `\mathsf{X}` / `\mathtt{X}` といった珍しい記法でのみ必要で、OS フォント fallback でも構造は読める
- woff2 サブセッティング（使用 codepoint のみ抽出）はさらにサイズを 1/3 以下に減らせる余地があるが、KaTeX が同梱する woff2 をそのまま使う前提を崩すため将来拡張に残す（実装コスト / version up 時の再生成コストとのトレードオフ）

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

### i. `\$` エスケープと自然言語 `$` の扱い（Pandoc 風境界条件）

scanMath は `\$` を数式境界として扱わず、加えて Pandoc / KaTeX auto-render が確立している境界条件を取り込む。実装：

- `$...$` パターンマッチ時、先頭 `$` の直前文字が `\` なら escape として除外（lookbehind）
- 終端 `$` についても escape 同様
- ただし `\\$` （バックスラッシュのエスケープ + `$`）は数式境界として扱う（`\\` で literal backslash、`$` で数式開始）
- **opening `$` の直後が空白なら inline 数式として扱わない**（`$ x` のような開きっぱなしを抑制、Step 9）。**数字は弾かない** — `$2$` / `$2024$` / `$3.14$` のような数字始まり数式は正当な記法で、巻き込み regression を避けるため
- **closing `$` の直前が空白なら閉じとして扱わない**（`$x ` のような開きっぱなしを抑制、Step 9）。`$100 and $200` のような通貨ペアもこの 1 条件で **closing 不成立** となり数式判定から外れる
- display `$$...$$` には境界条件を適用しない（display は単独行で書かれるのが普通で、自然言語混入のリスクが低い）

これらの最小フィルタにより、`$100 and $200 today` のような通貨表記は **エスケープなしで自動的に数式判定から除外され**、同時に `$2$` / `$2024$` のような数字始まり数式は正しく検出される。`$x^2$` / `$\alpha$` / `$a+b$` のような典型的数式も引き続き通る。

#### ブロック境界を跨ぐ `$` は検出対象外

`scanMath` の入力は **`marked.lexer` の text token 単位**であり、token 境界（paragraph / list_item / blockquote / heading 等）を越えて `$` をマッチさせない。意図的な設計で、安全側に倒した結果として「跨ぎ `$` は描画されず raw 文字として残る」「`countMath` が 0 を返すので `--math auto` で KaTeX 注入が走らない」挙動になる。

| パターン                     | 例                                  | 振る舞い                                      |
| ---------------------------- | ----------------------------------- | --------------------------------------------- |
| 同一段落・同一行 inline      | `text $x^2$ here`                   | ✓ 1 件検出（典型）                            |
| 同一段落・改行を跨ぐ inline  | `text $x^2\nfoo$ here`              | ✗ 改行で打ち切り（KaTeX デフォルト準拠）      |
| 同一段落・改行を跨ぐ display | `$$\nx^2 + y^2\n= 1\n$$`            | ✓ 1 件検出（display は改行許容）              |
| 段落境界跨ぎ                 | `text $start\n\nnew para end$`      | ✗ 0 件（marked が `paragraph` を 2 つに分離） |
| list item 跨ぎ               | `- item $start\n- item end$`        | ✗ 0 件（各 `list_item.text` が独立トークン）  |
| blockquote / heading 跨ぎ    | `# Heading $start\n\nBody end$`     | ✗ 0 件                                        |
| コード / インラインコード内  | ` ```text\n$x$\n``` ` / `` `$x$` `` | ✗ 0 件（`code` / `codespan` は walk 対象外）  |

跨ぎパターンは **配布物の安全性を損なわない**（KaTeX が `$start ... end$` を invalid LaTeX として `katex-error` で赤エラー表示する経路に乗らず、raw `$` が plain text として残るだけ）。一方でレビュー対象の利用者から見ると「数式を書いたつもりが描画されない」事故になり得るため、配布者は次のいずれかで対応する：

1. **数式を同一段落内に収める**（典型）
2. **`$$...$$` (display) として書く**（同一段落内なら改行を跨いでも検出される）
3. **意図的に literal `$` を残したい場合は `\$` エスケープ**

この挙動は `core/math.ts` の in-source test `countMath: ブロック境界跨ぎ` で 8 ケース（段落 / list item / heading / blockquote / softbreak / display 複数行 / 混在）を網羅して回帰防止する。

#### Step 9 経緯（外部レビュー反映）

- Step 5 初期: 「自然言語 `$` の責務は原稿側」として `\$` エスケープを必須とする方針 → 外部レビュー #1 で「`--math auto` の趣旨と矛盾するレベルの誤検出」「誤検出を KaTeX に渡すと `katex-error` で赤エラー混入」を指摘
- Step 9 初版: opening `$` 直後の **空白 + 数字** を弾く形で Pandoc 風境界条件を取り込み → 外部レビュー #4 で「数字始まり禁止は過剰で `$2$` / `$2024$` / `$3.14$` のような正当な数式を巻き込む回帰」を指摘
- Step 9 最終: 数字判定を削除し、最小フィルタ（opening 直後空白禁止 + closing 直前空白禁止）に縮退。これで「通貨の closing 不成立」と「数字始まり数式の正当検出」を両立

将来拡張：それでも `$x = $y$ $` のような奇妙なケース、対称的に通貨が並ぶ `$x ... y$200` のようなパターンは誤検出され得る。`$...$` の中身が valid LaTeX か簡易判定する heuristic / 「closing `$` の直後が数字なら不成立」を追加する案などがあるが、精度トレードオフを慎重に評価した上で別 step として採用判断する。`\$` エスケープは引き続きユーザーの最終手段として残す。

### j. KaTeX version pin と再生成のトリガ

- `package.json` で `katex` の version を pin（caret prefix なし、exact version）
- KaTeX major version up 時：本ドキュメントの §5.f `trust` / `strict` の挙動、§5.g フォントセット、Step 5b の `renderToString` API 契約を再評価
- `dist/katex/katex.mjs` / `dist/katex/katex.css` / `dist/katex/katex-fonts-extra.css` は **生成物だが commit 対象**（`dist/shiki-langs/` / `dist/mermaid.mjs` と同じ配布契約）
- `scripts/build-katex-css.mjs` の冒頭で KaTeX version assert を入れ、想定外バージョンでは build を fail させる（フォント data URI 化スクリプトが KaTeX の dist 構造に依存するため）

### k. `dist/standalone.html` に KaTeX を default で同梱する（フォント範囲は `all` 固定）

| 候補                                                                                                | 採用 | 理由                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. `dist/standalone.html` に Shiki / Mermaid と同じく KaTeX を default inline**（フォント `all`） | ✓    | Shiki bundled 全言語化と Mermaid 同梱と同じ「default で全部入り」配布契約を維持。standalone を直接ダブルクリックで開いたユーザーも `$...$` / `$$...$$` を KaTeX 描画で受け取れる。フォント範囲は全 20 family（`all` 相当）で `\mathcal` / `\mathfrak` / `\mathscr` 等の珍しい記号も完全に描画。Step 1 PoC 実測でサイズ増は gzip ~+310 KB（~45 MB → ~46 MB、gzip ~5.9 MB → ~6.2 MB）、Shiki 全言語化（gzip ~5.5 MB）と Mermaid 同梱（+700 KB gzip）に続く 3 番目の同梱要素として整合 |
| B. CLI 経路（`*-review.html`）のみに `--math` で opt-in 注入し standalone は外す                    | ✗    | standalone を直接開いたユーザーが `$...$` を raw な markdown 文法のまま読むことになり、CLI 経路と挙動が分岐する。「standalone は full feature」という配布契約から外れ、ユーザーが「描画されない」事故を踏みやすい                                                                                                                                                                                                                                                                   |
| C. `dist/standalone.html` 用に `--with-math` の build オプション追加                                | ✗    | build 時の分岐と派生配布物（`dist/standalone-with-math.html`）が増え、CI / リリース管理コストが線形に増える。Shiki 全言語化と同じ「default で全部入り」のシンプルな配布契約から外れる                                                                                                                                                                                                                                                                                               |

A 案の追加考慮：

- standalone はフォント範囲を `all`（全 20 family）で固定する。CLI 経路の `--math-fonts <minimal|all>`（§5.l）に対応する `dist/katex/katex-fonts-extra.css` も無条件に inline する。standalone を開くユーザーは「ファイル 1 つで完結する」期待が最も強く、`\mathcal{X}` を含む文書を開いて字形が崩れる経験を構造的に避けたい
- CLI 経路（`embed-template.html` → `*-review.html`）の `--math <auto|on|off>` / `--math-fonts <minimal|all>` は維持する（§5.d / §5.e / §5.l）。`embed-template.html` には KaTeX を default inline せず、CLI が markdown 内容と配布者の意図に応じて注入する設計のままで、配布物サイズの最小化導線を残す。「standalone は full feature default / CLI 経路は配布物サイズ最適化のため opt-in」という役割分担で整合する（Mermaid §5.l と完全に対称）
- standalone build と CLI 経路の bridge 注入規約（`<script id="embedded-katex">` + `<style id="embedded-katex-css">` + `<style id="embedded-katex-fonts-extra-css">` + `globalThis.__mdxgKatex`）は同一のため、ブラウザ側 `src/app/katex.ts` のロジック分岐は不要
- standalone build への inline は `mdxg-shiki-assets` plugin の closeBundle に倣って `mdxg-katex-asset` plugin（または既存 `mdxg-split-outputs` への統合）で 3 ブロックを埋め込む

### l. CLI フォント範囲 mode：`--math-fonts <minimal|all>`（既定 `minimal`）

| 候補                                                           | 採用 | 理由                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. `--math-fonts <minimal\|all>` mode（既定 `minimal`）**    | ✓    | `--shiki-langs` / `--mermaid` と同じ mode 型インターフェース。`--math` の注入有無とは直交した 2 軸構成で、配布者は「数式を含む文書を minimal frontset で軽く配る」「珍しい記号を使う文書を all で配る」を選べる。Step 1 PoC でサブセット側を選ぶことで gzip ~+200 KB（minimal）→ gzip ~+310 KB（all）の差が実測でき、典型用途では minimal で足りる |
| B. 全 family inline 固定（`--math-fonts` を導入しない）        | ✗    | CLI 経路の配布物サイズが gzip ~+310 KB に固定。`\mathcal` / `\mathfrak` を使わない多数派の文書まで肥大化を被る。Step 1 PoC で minimal セットでも典型用途を網羅できることが確認できたため、選択肢を残す方が利得が大きい                                                                                                                             |
| C. 各 family を個別 flag に分解（`--math-fonts ams,math,...`） | ✗    | Shiki の `--shiki-langs csv` と類似だが、KaTeX の family は数式中で組合せ的に使われるため「Math だけあれば足りる」「AMS だけあれば足りる」のような粒度切り分けが破綻しやすい。minimal の 9 family は密結合なので 1 セットとして扱う方が UX として一貫する                                                                                          |

A 案の追加考慮：

- **minimal セット = 9 family**（Step 1 PoC で確定）: KaTeX_Main / KaTeX_AMS / KaTeX_Math / KaTeX_Size1〜4 + Bold / Italic 派生。`\frac` / `\sum` / `\int` / ギリシャ文字 / 行列 / 大型演算子 / 角括弧 / `\mathbb` の典型用途を網羅
- **all セット = 20 family** = minimal + Caligraphic / Fraktur / Script / SansSerif / Typewriter の 11 family。`\mathcal{X}` / `\mathfrak{X}` / `\mathscr{X}` / `\mathsf{X}` / `\mathtt{X}` を完全な字形で描画
- **CLI 出力**: `--math-fonts all` 指定時は `dist/katex/katex.css`（minimal セット）と `dist/katex/katex-fonts-extra.css`（差分 11 family）の両方を読み、`<style id="embedded-katex-css">` と `<style id="embedded-katex-fonts-extra-css">` の 2 ブロックに rewrite。minimal 時は前者だけを書く
- **`--math off` との関係**: `--math off` のとき `--math-fonts` の値は無視される（KaTeX 自体を inline しないため）。CLI は warning を出さず黙って ignore する（Shiki の `--shiki-langs none` × csv のような組合せと同じ振る舞い）
- **`--math-fonts` 単独指定の挙動**: `--math` が auto（既定）かつ markdown が math 0 件の場合、`--math-fonts` の値に関わらず注入しない（注入判定は `--math` 軸が最終決定権を持つ）

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
  - `$$...$$` が `<span data-math="display">` として出力される（Step 9 で `<div>` から変更、§5.c）
  - `<div data-math` は出力されない（HTML5 parser の `<p>` 強制 close 回避）
  - `\$` がエスケープされて plain text として出力される
  - インラインコード内の `$` は data-math 属性を付けず通常の `<code>` 経路に流れる

- `core/math.ts`（Step 9 で追加、Pandoc 風境界条件）：
  - `Price is $100 here` のような通貨表記は数式境界として扱われない（opening `$` の直後が数字）
  - `$100 and $200` の複数通貨も同様に検出されない
  - `open $ then text` のような開きっぱなしも検出されない（opening `$` の直後が空白）
  - `$x^2$` / `$\alpha$` / `$a+b$` のような典型的数式は引き続き検出される
  - display `$$1+2$$` は境界条件を適用せず通る（display は単独行で書かれる前提）

### 手動視覚チェックリスト

`npm run build` 後、CLI 経由で配布 HTML を生成して以下を確認：

- [ ] `node dist/review-request.mjs sample-with-math.md`（`--math` 既定 auto）で生成した HTML を Chromium で開き、`$x$` インライン数式が周囲のテキストとインラインに描画される
- [ ] `$$\\frac{a}{b}$$` 表示数式が中央寄せのブロックとして描画される
- [ ] 初回 paint 時には plain `$...$` LaTeX ソース（monospace + opacity 0.6）が一瞬見え、idle callback 後に KaTeX 描画に置き換わる
- [ ] OS dark で開いた時に数式の文字色が `--ink` の dark 値で表示される
- [ ] theme toggle で `system → light → dark` を循環すると数式の文字色も追従する（再描画なし）
- [ ] LaTeX 構文エラーを含む数式（`$\\unknown_command{x}$`）は KaTeX error コンテナ（赤系の `--accent-error`）で表示され、toast で「Math render failed」が出る
- [ ] エラー数式があっても他の数式は正常に描画される
- [ ] 数式を含む段落のテキストを選択 → `+ Comment` → コメント追加 → 再描画後も `<mark class="cmt">` が同じ位置に出る
- [ ] `--math off` で実行した HTML を開いた場合、`$x$` / `$$x$$` は raw な markdown 文法のまま表示される（MDXG §14 [MUST] 生の文法保持）
- [ ] `--math auto`（既定）で math 0 件の markdown を渡した時、配布物に `embedded-katex` 注入がなくサイズが既存 `embed-template.html` の ~99 KB gzipped と等しい
- [ ] `--math auto` で math 含み markdown を渡した時、stderr に `Detected N math expression(s). Embedding KaTeX runtime (fonts=<minimal|all>, ~+<sz> KB gzipped).` が出る
- [ ] `--math on --math-fonts minimal`（既定相当）で実行した HTML のサイズが見積もり通り（~300 KB gzipped、§3.3）
- [ ] `--math on --math-fonts all` で実行した HTML のサイズが見積もり通り（~410 KB gzipped、§3.3）
- [ ] `--math-fonts minimal` 配布で `\mathfrak{X}` / `\mathscr{X}` を含む数式を開いた時、OS フォントへ fallback してもレイアウトは崩れず読める（字形は劣化する）
- [ ] `--math-fonts all` 配布で `\mathfrak{X}` / `\mathscr{X}` / `\mathcal{X}` が完全な字形で描画される
- [ ] `\$100 と \$200` のようなエスケープされた `$` は literal `$` として描画され、数式判定されない
- [ ] コードブロック / インラインコード内の `$` は KaTeX upgrade されず元の文字として残る
- [ ] §10 Search が math 含み markdown で動作する（`\frac` 等の LaTeX ソース文字列でヒット）
- [ ] フォントの字形が `file://` 起動でも崩れない（data URI 化が機能している）
- [ ] `dist/standalone.html` を直接ダブルクリックで開き、`$...$` / `$$...$$` が KaTeX 描画される（KaTeX build inline 経路の確認、§5.k）
- [ ] `dist/standalone.html` のサイズが見積もり通り（~46 MB raw / ~6.2 MB gzipped、§3.3）

## 7. 受け入れ基準

- MDXG §14 [SHOULD] `$...$` / `$$...$$` 描画を満たす（§1 冒頭の対応スコープ表が ✓）
- MDXG §14 [MUST] 描画未サポート時の plain text fallback が回帰していない（`--math off` 時 / `auto` で 0 件時 / 構文エラー時）
- MDXG §14 [MUST NOT] ストリップ / 隠蔽 / 文字化けが発生しない（`--math off` 時は raw `$...$` がそのまま表示）
- MDXG §14 [SHOULD] ホストフォントサイズ / 色スキーム適応を満たす（`--ink` 配色追従 / フォントサイズ 1em）
- CLI が生成する `*-review.html`（`embed-template.html` ベース）のサイズが `--math off` / `auto` で 0 件のときに **既存と変動なし**
- `*-review.html` の `--math on` / `auto` で 1 件以上 + `--math-fonts minimal`（既定）のときのサイズ増分が **gzip +210 KB 以内**（Step 1 PoC 実測ベース、目標 gzip ~+200 KB、§3.3）
- `*-review.html` の `--math on` / `auto` で 1 件以上 + `--math-fonts all` のときのサイズ増分が **gzip +320 KB 以内**（Step 1 PoC 実測ベース、目標 gzip ~+310 KB、§3.3）
- `dist/standalone.html` のサイズが KaTeX inline 後 **gzip +320 KB 以内**（フォント `all` 相当固定、現行 ~5.9 MB → ~6.2 MB gzip 目安、§3.1 / §5.k）
- §6 アンカリングが壊れない（既存 in-source test 全通過 + 新規追加分も通過、upgrade 前後で `textSegments` 出力一致）
- §10 Search が math 要素を含む文書でも動作する
- §1 Theming の dark 連動が数式にも適用される
- `\$` エスケープが機能し、自然言語 `$` 表記とエスケープの使い分けが可能
- DESIGN.md §12 表に「§14 Math Rendering」行が追加され「準拠」に塗られる
- DESIGN.md §12「その他の拡張候補」の MDXG §14 項目が削除されている

## 8. 想定リスクと回避策

| リスク                                                                  | 回避策                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KaTeX 本体 + フォント サイズが当初見積もり (~135 KB gzipped) より大きい | **解決済み**: Step 1 PoC で実測（`katex.mjs` raw 601 KB / gzip 149 KB、全 20 woff2 family raw 260 KB / gzip 220 KB、合算 gzip ~+413 KB）。`--math-fonts <minimal\|all>` の 2 モード化と Vite esbuild minify 適用で minimal `+200 KB` / all `+310 KB` gzip に圧縮、§3.3 / §5.g / §5.l / §7 に反映済み。さらにサイズが必要な場合は woff2 サブセッティング（使用 codepoint のみ抽出）を将来拡張に残す |
| KaTeX `import()` 動的読み込みが `file://` で動かない                    | bridge global 方式（`<script type="module">` で inline + `globalThis.__mdxgKatex`）で迂回。Mermaid と同じパターン                                                                                                                                                                                                                                                                                  |
| フォント data URI 化スクリプトが KaTeX version up で壊れる              | `scripts/build-katex-css.mjs` の冒頭で KaTeX version assert を入れ、想定外バージョンでは build を fail させる                                                                                                                                                                                                                                                                                      |
| `katex.renderToString` が long-running で UI freeze する                | idle callback で実行することで初回 paint は守られる。複数数式の並列描画を避けるため `for` ループで順次処理。1 数式の renderToString は典型 1〜5ms                                                                                                                                                                                                                                                  |
| 既存 `<mark class="cmt">` が upgrade で消える                           | `[data-math]` 要素を upgrade 時に innerHTML 差し替えするが、外側の段落 / 要素は触らない。`<mark>` は段落側に貼られるため `[data-math]` の upgrade 影響を受けない                                                                                                                                                                                                                                   |
| §10 Search が math 要素で意図しない挙動になる                           | upgrade 後の textContent は KaTeX 出力の MathML / HTML テキスト。検索対象を `data-math` / `data-math-source` 属性から再構成した raw `$...$` 文字列に揃える（textSegments と同じ経路）。検索ヒット時は要素全体に `search-hl` を当てる（部分的ハイライトはしない）                                                                                                                                   |
| KaTeX `trust: false` でも XSS 経路が残る                                | KaTeX の最新 advisory を Step 1 でレビュー。CSP `default-src 'none'` + `connect-src 'none'` の既存防壁が二重保険として効く（KaTeX から fetch / XHR は走らない）                                                                                                                                                                                                                                    |
| KaTeX version up で API 契約が変わる                                    | `package.json` で exact pin。version up 時は本ドキュメントの §5.f / §5.g / Step 5b を再評価                                                                                                                                                                                                                                                                                                        |
| LaTeX 構文エラー時に部分描画が残る                                      | `katex.renderToString` は `throwOnError: false` で完全な error コンテナを返す。部分描画は発生せず、error コンテナだけが innerHTML に入る                                                                                                                                                                                                                                                           |
| `dist/katex/` の commit による repo サイズ増                            | 受け入れる。`dist/shiki-langs/` / `dist/mermaid.mjs` と同じく「clone 直後に `npm run build` 抜きで CLI が動く」配布契約を保つ。`katex` の version pin で頻繁な差分は出ず、~1.5 MB の追加 commit 容量は許容範囲                                                                                                                                                                                     |
| 自然言語 `$` 表記の誤検出                                               | **解決済み (Step 9)**: `scanMath` の Pandoc 風境界条件（opening `$` 直後が空白/数字なら除外、closing `$` 直前が空白なら除外）で構造的に弾く。`$100 and $200 today` のような通貨表記はエスケープなしで素通りする。`$x^2$` / `$\alpha$` のような典型的数式は引き続き通る。詳細は §5.i                                                                                                                |
| サイレント回帰（math 追加で Shiki / Mermaid / コメント / 検索が壊れる） | 既知ケースを in-source test + 手動チェックで網羅。CI で fail させる                                                                                                                                                                                                                                                                                                                                |
| `$` が複数ライブラリ間で衝突（jQuery などのレガシー global）            | 本実装は `globalThis.$` を一切触らない。bridge global は `__mdxgKatex` 名前空間で隔離される                                                                                                                                                                                                                                                                                                        |

## 9. 参考

- [MDXG §14 Math Rendering（日本語訳）](./mdxg/05-extensions.md#14-math-rendering数式描画)
- [KaTeX 公式ドキュメント](https://katex.org/) — `renderToString` / `trust` / `strict` / `throwOnError`
- [KaTeX Security Considerations](https://katex.org/docs/security.html) — `trust: false` 既定と外部リソース系コマンドの扱い
- [KaTeX Supported Functions](https://katex.org/docs/supported.html) — LaTeX カバレッジ範囲
- [DESIGN.md §12 MDXG 準拠状況と設計判断](./DESIGN.md#12-mdxg-準拠状況と設計判断)
- [DESIGN.md §1 Theming](./DESIGN.md#1-theming準拠) — CSS variables 経由のテーマ追従
- [DESIGN.md §6 コメントのアンカリング](./DESIGN.md#6-コメントのアンカリング)
- [DESIGN.md §10 Search](./DESIGN.md#10-search準拠)
- [DESIGN.md §11 セキュリティとプライバシー](./DESIGN.md#11-セキュリティとプライバシー)
- [DESIGN.md §13 ビルドパイプライン](./DESIGN.md#13-ビルドパイプライン)
- [docs/mdxg-rendering-code-block.archive.md](./mdxg-rendering-code-block.archive.md) — Shiki upgrade パターン参考元
- [docs/mdxg-diagram-rendering.md](./mdxg-diagram-rendering.md) — Mermaid 設計プラン参考元（bridge global 方式 / CLI opt-in 方式）
- [docs/design-example.md](./design-example.md) — 設計ドキュメントテンプレート
