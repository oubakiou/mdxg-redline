# MDXG §15 Diagram Rendering 対応 設計・実装計画

DESIGN.md §12「その他の拡張候補」の「MDXG §15 Diagram Rendering の対応」項目を実装に落とすための設計判断と実装手順をまとめる。完了時点で本ドキュメントは DESIGN.md §12 表に「§15 Diagram Rendering」行を追加して「準拠 / 部分」に塗り替え、本ファイルは `docs/mdxg-diagram-rendering.archive.md` にリネームしてアーカイブする想定（`docs/mdxg-rendering-code-block.archive.md` と同じ扱い）。

## 1. 対応スコープ

[MDXG §15 Diagram Rendering](./mdxg/05-extensions.md#15-diagram-renderingダイアグラム描画) の 4 要件を、`mermaid` 言語識別子のフェンス付きコードブロックに対して満たす。

| 要件                                                                                    | 現状 | 完了条件                                                                                                                                                                             |
| --------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [SHOULD] 最低限、` ```mermaid ` ブロックはサポートされる                                | 未   | review-request CLI に `--mermaid` flag を追加し、明示指定時のみ Mermaid.js を `<script id="embedded-mermaid">` に注入。配布 HTML 起動時に各 ` ```mermaid ` ブロックを SVG に upgrade |
| [MAY] その他のダイアグラム言語（`plantuml` / `d2` / `graphviz` 等）もサポートされてよい | 未   | 本タスクでは扱わない（§1 スコープ外）。`mermaid` 以外の識別子は既存の plain text fallback のまま                                                                                     |
| [MUST] 描画未サポート時の構文ハイライト付きコードブロックへのフォールバック             | ✓    | 既に CLI が `--mermaid` 未指定なら Mermaid.js を注入せず、ブラウザ側 upgrade は no-op で plain `<pre><code class="language-mermaid">` のままにする経路で満たす。回帰させない         |
| [SHOULD] 描画されたダイアグラムはホストの色スキームに適応する                           | 未   | Mermaid の `theme: 'base'` + DESIGN.md §1 Theming の CSS variables (`--ink` / `--paper` / `--rule` / `--accent`) を `themeVariables` にバインドし、`html.dark` トグルに同期更新      |

追加実装（規格上は SHOULD 未満だが UX 上有用）：

- **upgrade 失敗時の plain text fallback 表示**：Mermaid のパースエラー（不正な構文 / 未対応のダイアグラム種別）時に SVG 描画を諦め、元のコードブロックを残したまま toast で「Diagram render failed」を通知する。MDXG §15 [MUST] フォールバック条項を「描画器がサポートされていない場合」だけでなく「サポートされているが入力が壊れている場合」にも適用する解釈
- **CLI のサイズ警告**：`--mermaid` 指定時に配布 HTML サイズが現行から +X MB になることを stderr に出す。`auto` 既定との差分を可視化することで、配布者が意図せず重い HTML を配布するのを防ぐ

スコープ外（別タスクで扱う）：

- **`plantuml` / `d2` / `graphviz` のサポート**（§15 [MAY]）：Mermaid 1 言語の対応コストを実装した後で需要が出てから検討する。各言語ごとに描画エンジン（PlantUML は JVM / d2 は Go バイナリ / graphviz はネイティブ）を持ち込む必要があり、ブラウザ単一 HTML 配布の制約と衝突する。本実装の Mermaid と同じく WASM / pure JS 実装の登場待ち
- **インタラクティブなダイアグラム操作**（§15.2 実装例の zoom / pan）：レビュー対象としてのダイアグラムは「読む」用途で、編集 / 操作の UX は MDXG Editor 準拠レベルの責務。読み取り専用の Viewer 準拠としては SVG 静的描画で十分
- **ダイアグラムへの直接コメント付与**：§6 アンカリングはテキスト範囲ベースで、SVG ノードに直接 `<mark class="cmt">` を貼る経路は持たない。本実装では「コードブロック側（`<pre hidden>` で残す）の textContent を対象に通常のテキストコメントを付ける」経路に倒し、SVG への矩形選択 / ノード選択は対応外とする

## 2. リファレンス実装と差分

[vercel-labs/mdxg `apps/web`](https://github.com/vercel-labs/mdxg/tree/main/apps/web) は §15 を実装していない（Shiki ハイライトの 1 言語として `mermaid` を扱い、SVG 描画はしない）。本実装はリファレンス実装の先行参考が無い領域となるため、本章は「ベースラインアーキテクチャ」として既存実装と Mermaid.js 公式の組み合わせを記述する。

| 既存実装の構成要素                             | 本実装の置換 / 追加                                                                                   |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---- | ----------------- | ------------------------------------------------------------------------------------------------------- |
| Shiki upgrade の 2 段構成（plain → highlight） | 同じパターンを Mermaid に適用（plain `<pre>` → upgrade で `<svg>` を sibling 挿入）                   |
| `dist/shiki-langs/<lang>.json` の言語別 emit   | `dist/mermaid.mjs` を別 emit（grammar ではなくランタイム本体。`--mermaid` opt-in でのみ HTML に注入） |
| CLI `--shiki-langs <auto                       | all                                                                                                   | none | <csv>>` の opt-in | CLI `--mermaid` boolean flag を追加（`auto` 検出はしない。配布物サイズの差が大きすぎるため明示 opt-in） |
| `<script id="embedded-shiki-langs">` JSON 注入 | `<script id="embedded-mermaid" type="module">` で Mermaid.js ESM を注入                               |
| `core/markdown.ts` renderer の言語別分岐       | `mermaid` 識別子だけは Shiki ハイライト経路を skip し、plain `<pre data-mermaid="1">` で出す          |
| Shiki upgrade フェーズ                         | `src/app/mermaid.ts`（新規）の lazy upgrade フェーズで `requestIdleCallback` 後に Mermaid SVG を生成  |

リファレンス実装が §15 を実装していない理由は推測になるが、Mermaid.js のサイズ（gzip ~700 KB）が単一 HTML 配布物に与える影響を踏まえると、本実装の CLI opt-in 設計はリファレンスより慎重な選択となる。Shiki upgrade と異なり「default ON」にはせず、配布者が明示的に必要としたときだけ載せる方針を採る。

## 3. bundle 構成と Mermaid 注入

### 3.1 配布物の構成

| ファイル                  | 内容                                                                                                    | 配布形態             |
| ------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------- |
| `dist/review.html`        | 既存と同じ。Mermaid.js は **含まない**（`--mermaid` 未指定時のデフォルト配布物）                        | エンドユーザー配布物 |
| `dist/mermaid.mjs`        | Mermaid.js の ESM bundle（vite で別 entry として emit、commit 対象）                                    | CLI が読み込む素材   |
| `dist/review-request.mjs` | CLI 本体。`--mermaid` 指定時のみ `dist/mermaid.mjs` を読み、`<script id="embedded-mermaid">` に書き込む | 配布者向け CLI       |

`dist/review.html` のサイズは Mermaid 非対応時（既定）には現行のまま変動しない。`--mermaid` 指定時のみ +700 KB gzipped 程度の増加となる。この設計により、Mermaid を必要としないレビューフロー（仕様書 / 散文中心の文書）が肥大化を被らない。

### 3.2 CLI による Mermaid 注入

`src/cli/parse-args.ts` に `--mermaid` boolean flag を追加する。値は受け取らない（モード切替えではなく opt-in トグル）。

| `--mermaid` 状態 | 挙動                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| 指定なし（既定） | Mermaid.js を注入しない。` ```mermaid ` ブロックは plain text fallback で表示                        |
| 指定あり         | `dist/mermaid.mjs` を読み込み、`<script id="embedded-mermaid" type="module">` ブロックに inline 注入 |

#### 注入経路

`src/core/embed.ts` の rewrite ロジックに `mermaidRuntime?: string` 引数を追加し、`<script id="embedded-mermaid" type="module">` ブロックに ESM ソースをそのまま書き込む。エンコード規約は `embedded-md` / `embedded-shiki-langs` と同じく `</script>` の誤検出を避けるため、ESM ソース中に `</script>` 文字列が含まれていないことをビルド時に sanity check し、見つかれば build を fail させる（実用上 Mermaid 本体には含まれない見込みだが、version up で混入する経路を構造的に塞ぐ）。

#### ブラウザ側の読み込み

`src/app/mermaid.ts`（新規）で起動時に `embedded-mermaid` script タグの有無を確認し、存在すれば `import()` で動的読み込みする。読み込みは `requestIdleCallback`（fallback: `setTimeout(..., 0)`）で paint 後に schedule し、初回描画を阻害しない。

### 3.3 配布物サイズの実測見積もり

| ケース                   | review.html     | embedded-mermaid 増分         | gzipped 後の配布物 |
| ------------------------ | --------------- | ----------------------------- | ------------------ |
| `--mermaid` なし（既定） | ~314 KB（現行） | 0 KB                          | ~95 KB（現行）     |
| `--mermaid` あり         | ~314 KB         | +2.8 MB raw / +700 KB gzipped | ~795 KB            |

実測値は Step 1 PoC 完了後に確定する。`--mermaid` 指定時に CLI が stderr へ「Diagram support enabled. Output HTML is ~800 KB gzipped (vs ~95 KB without --mermaid).」を出す予定。

## 4. 実装ステップ

順序は依存関係順。各ステップ完了で in-source test と手動視覚チェックを通す。

### Step 1: ライブラリ選定の検証と PoC

- 本ドキュメントの §5 設計判断をレビュー
- Mermaid.js ESM build (`mermaid/dist/mermaid.esm.min.mjs`) が `import()` 経由でブラウザに読み込めること、`mermaid.render(id, src)` が同期 / async どちらで返るかを PoC で確認
- 配布物サイズ実測（raw / gzipped）と Step 5 の `requestIdleCallback` schedule での FCP / TTI 計測
- `theme: 'base'` + `themeVariables: { background, primaryColor, lineColor, ... }` で DESIGN.md §1 Theming の CSS variables を読み出す経路の動作確認

成果物：§5 マッピング表が確定状態、PoC で Mermaid ESM がブラウザで動くこと

### Step 2: 純粋ロジック層（`src/core/scan-mermaid.ts` 新規）

UI / DOM / Mermaid 本体に依存しないフェンススキャンを pure 関数で書き、in-source test を通す。`auto` 検出は採用しない（§5.b）が、CLI が「`--mermaid` 指定時に mermaid ブロックが 0 個なら sanity warning を出す」用途に使う。

```ts
export function scanMermaidFences(markdown: string): number
```

- `marked.lexer(markdown)` で AST を取得（`core/scan-fenced-langs.ts` と同じパターン）
- `token.type === 'code' && token.lang === 'mermaid'` の token をカウント
- 戻り値はブロック数（0 なら CLI が warning を出す）

成果物：`src/core/scan-mermaid.ts` + in-source test（mermaid ブロックなし / 1 個 / 複数 / リスト配下 / 引用配下 / コードフェンス内のフェイク `mermaid` 文字列が含まれない）

### Step 3: ビルド側 — Mermaid ESM bundle の emit

- `vite.review-request.config.ts` に Mermaid ESM を別 entry として emit する設定を追加（`dist/mermaid.mjs` として書き出し、CLI bundle 自体には含めない）
- もしくは `node_modules/mermaid/dist/mermaid.esm.min.mjs` をビルド時に `dist/mermaid.mjs` へコピーするだけの shell-less plugin で済むなら、そちらを採用（vite SSR bundle を経由しない方が将来のバージョン pin 管理が単純）
- `dist/mermaid.mjs` は **生成物だが commit 対象**（`dist/review.html` / `dist/review-request.mjs` / `dist/shiki-langs/` と同じ配布契約。clone 直後の利用者が `npm run build` 抜きで CLI を実行できる）
- `package.json` に `mermaid` を `dependencies`（非 dev）として追加し、version を pin

成果物：`dist/mermaid.mjs` が emit され、commit 対象になる

### Step 4: CLI 側 — `--mermaid` flag と注入

- `src/cli/parse-args.ts` に `--mermaid` boolean flag を追加（既定 false）
- `src/cli/review-request.ts` のエントリで `--mermaid` 指定時に `dist/mermaid.mjs` を読み込み（`readFileSync`）、`core/embed.ts` の `mermaidRuntime` 引数に渡す
- `src/core/embed.ts` に `mermaidRuntime?: string` 引数を追加し、`<script id="embedded-mermaid" type="module">` ブロックを rewrite。`mermaidRuntime` が undefined / 空文字なら script tag 自体を書かない
- HELP_TEXT 更新：`--mermaid` の意味（`mermaid` ブロックを SVG として描画。配布物サイズが +700 KB gzipped 程度増える）と既定値（OFF）を記述
- `scanMermaidFences(markdown) === 0` のときに `--mermaid` 指定があれば stderr へ「No `mermaid` fences found in input. Output HTML still includes mermaid runtime (~700 KB gzipped). Consider removing `--mermaid`.」を出す

成果物：CLI が `--mermaid` 指定時に `embedded-mermaid` を書き込めること（in-source test で `embed` 経路を検証）

### Step 5: ブラウザ側 — 初期 render と Mermaid upgrade の 2 段階構成

設計判断は §5.b の C 案（paint 後 lazy 初期化 + 各 `<pre>` 単位の upgrade、Shiki と同じパターン）。

#### Step 5a: 初期 render は Mermaid 非依存で即時 paint

- `src/core/markdown.ts` の marked renderer：
  - `code` トークンが `lang === 'mermaid'` のときは Shiki ハイライト経路を skip し、`<pre data-mermaid="1"><code class="language-mermaid">${escapedSrc}</code></pre>` を返す
  - `escapedSrc` は既存の `core/escape.ts` で HTML escape 済み
- `src/app/doc-renderer.ts` の初期描画パス：
  - 既存ロジックがそのまま動く。`data-mermaid="1"` 属性は属性として残るだけで描画には影響しない

#### Step 5b: paint 後の Mermaid upgrade

- `src/app/mermaid.ts`（新規）：
  - `getEmbeddedMermaidRuntime()` で `<script id="embedded-mermaid">` の有無を確認、無ければ null を返して以降の処理を skip
  - `upgradeMermaidFences(docEl)` を初期 render 完了後に schedule
    - `requestIdleCallback(callback, { timeout: 2000 })`（fallback: `setTimeout(callback, 0)`）で paint 後に走らせる
    - `window.getSelection().toString().length > 0` ならスキップし、`selectionchange` で空に戻ったら再試行（Shiki と同じパターン）
  - 実行内容：
    1. `import('embedded-mermaid')` 相当を `<script type="module">` の export 経由で取得（script 注入時に `window.__mermaid = mermaid` のような bridge を仕掛ける、または ESM の dynamic import で blob URL 経由）
    2. `mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: resolveThemeVariables() })`
    3. `docEl.querySelectorAll('pre[data-mermaid="1"]:not([data-mermaid-applied])')` を走査
    4. 各 `<pre>` について `<code>` の textContent をソースとして取り出し、`await mermaid.render(uniqueId, src)` で SVG を生成
    5. `<pre>` を `hidden` 属性で視覚的に隠し（textContent は残す）、生成 SVG を `<pre>` の **次の sibling として挿入**
    6. `data-mermaid-applied="1"` を `<pre>` に付けて idempotent 化
    7. upgrade 後に `cacheBlockOriginalHTML` 相当で `state.blockOriginalHTML` を再構築（`<pre>` の中身は不変だが、wrap 構造が `<pre>` + sibling SVG に変わったため）→ `reapplyAllMarks()`
  - パースエラー時：`mermaid.render` が throw する。catch して `<pre>` から `hidden` を外し、toast で「Diagram render failed for block N」を表示。`data-mermaid-failed="1"` を付けて再試行を抑止
- `resolveThemeVariables()` の中身：
  - DESIGN.md §1 Theming の CSS variables を `getComputedStyle(document.documentElement)` で読み出し、Mermaid `themeVariables` 形式にマップ
  - `--ink` → `primaryTextColor` / `--paper` → `background` / `--rule` → `lineColor` / `--accent` → `primaryColor` 等
  - `subscribeSystemTheme` の hook に登録し、theme トグル時に Mermaid を **全 SVG 再描画**（Mermaid は CSS variables を直接読まず、初期化時の値を SVG に焼き込むため、CSS だけでは追従できない）

成果物：

- 初回 paint は既存と同じく素早く完了（embedded-mermaid 読み込みは paint 後）
- paint 後 idle callback で Mermaid 描画が追加適用される
- embedded-feedback の `<mark class="cmt">` は upgrade 後も `<pre hidden>` 配下の textContent 上で正しい位置に再貼付される
- 未対応構文や parse 失敗は plain text fallback + toast 通知

### Step 6: §6 アンカリングと §10 Search の維持確認

- §6 のブロックフラットテキストオフセット計算は `textContent` ベースで動く。`<pre hidden>` は CSS で非表示でも DOM 上の text node は残り、`selection.ts` の `textSegments` は `[hidden]` を skip しない既存挙動を維持する（Shiki の `.code-copy-btn` skip と異なり、こちらは active な検索対象として残す方針）
- ただし `<pre hidden>` 上に出現するコメントマーカーは画面上では見えない（`<pre>` が `display: none` 相当）。レビュアー視点では「ダイアグラムにコメントを付ける」 → 「対応するコードブロックを表示する手段」が必要：
  - Step 6 で UI に「Source」トグルボタンを追加するか
  - もしくは `<pre>` を `hidden` でなく `position: absolute; visibility: hidden;` で text-selection 可能にして「コードを選択するとフローター経由でコメント可能」な経路を残す
  - 後者を採用する場合は §11 CSP の `style-src 'unsafe-inline'` 既存許可で済む（追加緩和不要）
- §10 Search の `<mark class="search-hl">` も同様に `<pre>` 配下に貼られる。検索ヒットがダイアグラム内で起きた場合の挙動を決める：
  - 案 A: SVG 描画後は `<pre>` を非表示にし、検索対象から外す（`textSegments` で `[data-mermaid-applied]` 配下を skip）
  - 案 B: 検索ヒット時に `<pre>` を一時的に表示してハイライト位置にスクロール
  - 採用は Step 1 PoC 後に決定（§5.f で深掘り）
- in-source test に追加：
  - mermaid upgrade 後の `<pre>` で `startOffset` / `endOffset` の計算が壊れないこと
  - upgrade を 2 回呼んでも `data-mermaid-applied` ガードで二重描画にならないこと（idempotent）
  - mermaid パースエラー時に `<pre>` が表示状態に戻り、SVG が DOM に残らないこと

成果物：既存コメント / 検索が付いた markdown を mermaid 含みで再読込しても §6 / §10 が壊れないこと

### Step 7: §1 Theming との連動

- Mermaid `themeVariables` を `resolveThemeVariables()` で DESIGN.md §1 Theming の CSS variables から構築
- theme トグル（`subscribeSystemTheme`）の hook に Mermaid 再描画を登録
  - 全 `<pre[data-mermaid-applied]>` の SVG を破棄
  - `data-mermaid-applied` を外して再 upgrade 経路に乗せる
  - upgrade の `mermaid.initialize` を新しい `themeVariables` で呼び直す
- 再描画はテーマトグル時のみで、ページスクロールや通常操作では発生しない
- light / dark 両モードで Mermaid の主要ノード（rect / line / text / arrow）が読み取り可能な配色になっているかを Step 1 PoC で確認

成果物：light / dark どちらのテーマでも mermaid ダイアグラムが配色追従し、トグルで再描画されること

### Step 8: DESIGN.md 反映と本ドキュメントの role 切替

- DESIGN.md §12 表に「Extensions / §15 Diagram Rendering」行を追加し「準拠 / 部分」に塗る（`mermaid` のみサポート、`plantuml` / `d2` / `graphviz` は未対応のため「部分」）
- DESIGN.md §3 review-request CLI コマンド仕様に `--mermaid` を追記
- DESIGN.md §11 セキュリティ：Mermaid `securityLevel: 'strict'` と `<script id="embedded-mermaid" type="module">` の信頼境界を 1 段落で追記
- DESIGN.md §13 ビルドパイプライン：`dist/mermaid.mjs` の出口を §13 全体像と表に追加
- DESIGN.md §14 ファイル構成：`src/core/scan-mermaid.ts` / `src/app/mermaid.ts` / `dist/mermaid.mjs` を追加
- DESIGN.md §12「その他の拡張候補」の MDXG §15 項目を削除（実装済みになるため）
- 本ドキュメントは `docs/mdxg-diagram-rendering.archive.md` にリネーム

成果物：DESIGN.md 更新 + 本ドキュメントの archive

## 5. 設計判断

### a. ライブラリ選定：Mermaid.js（vs PlantUML / d2 / graphviz）

| 候補           | 採用 | 理由                                                                                                                                                         |
| -------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Mermaid.js** | ✓    | pure JS / ESM で動作し、単一 HTML 配布物に inline 可能。MDXG §15 [SHOULD] が ` ```mermaid ` を最低限としているため、Mermaid 1 言語で SHOULD 要件を充足できる |
| PlantUML       | ✗    | JVM 依存 / もしくはサーバサイド SVG レンダラ。ブラウザ単一 HTML 配布の制約と衝突                                                                             |
| d2             | ✗    | Go バイナリ依存。WASM ビルドが GA でない。`§15 [MAY]` のため必須ではない                                                                                     |
| graphviz       | ✗    | viz.js (WASM) が候補だがサイズが Mermaid と同等以上で機能カバレッジが劣る                                                                                    |

Mermaid 1 言語に絞ることで実装 / テスト / メンテのコストを最小化し、§15 [SHOULD] を満たす最短経路を採る。

### b. Mermaid 初期化のタイミング：paint 後の lazy 読み込み + 各 `<pre>` 単位の upgrade

| 候補                                                                      | 採用 | 理由                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. 起動時に同期で Mermaid 初期化 + 全 SVG 描画                            | ✗    | Mermaid 本体（~700 KB gzipped）の parse + dagre レイアウト計算が paint 前に走り、`loading spinner` 表示時間が大幅に伸びる。embedded markdown ロード時の FCP 劣化が許容できない                                             |
| B. async marked renderer の中で Mermaid 描画を await                      | ✗    | renderer 全体を async 化する影響範囲が `doc-renderer.ts` / `boot.ts` の同期前提に波及。Shiki と同じく C 案で FCP を稼げるため、async 化のコストを払う動機がない                                                            |
| **C. paint 後 `requestIdleCallback` で lazy 初期化 + 各 `<pre>` upgrade** | ✓    | 初期描画は plain `<pre><code>` で即時 paint。idle callback で Mermaid 本体を `import()` で動的読み込みし、各 `<pre>` を SVG に upgrade する。Shiki upgrade と同じパターンで、既存 paint パスを変えずに追加機能を載せられる |

C 案の論点と mitigation：

- **「テキスト → SVG のちらつき」**: Mermaid SVG はサイズが大きく描画時間も Shiki より長い。idle callback のため UI は freeze しないが、ダイアグラムが出現するまでの「空白期間」がユーザーに見える。`<pre>` を non-hidden で先に見せておくことで、少なくとも「コードは読める」状態を保つ。`<pre>` の上に「Rendering diagram...」を inline 表示する案もあるが、Step 1 PoC で実時間を計測して必要性を判定
- **upgrade 中の選択操作**: Shiki と同じく `getSelection().toString().length > 0` でスキップし `selectionchange` で再試行
- **既存 `<mark class="cmt">` の維持**: `<pre>` 自体は触らず（hidden 属性のみ追加）SVG を sibling として挿入するため、`<pre>` 内の `<mark>` は壊れない。`blockOriginalHTML` の再構築は wrap 構造変化に追従させる
- **同期 vs async API**: `mermaid.render()` は Promise を返すため、`upgradeMermaidFences` は async になる。`for await` で順次 upgrade することで、複数ブロックの並列描画によるレイアウトスラッシングを避ける

### c. SVG の DOM 配置：`<pre>` を hidden で残し SVG を sibling として挿入

| 候補                                                             | 採用 | 理由                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. `<pre hidden>` + sibling `<svg>`**                          | ✓    | `<pre>` の textContent が DOM に残るため、§6 アンカリング / §10 Search / コメント機能が `<pre>` 上で従来どおり動作する。SVG は表示専用で、コメント / 検索の対象にしない |
| B. `<pre>` を SVG で置換                                         | ✗    | `<pre>` の textContent が消失し、§6 ブロックフラットテキストオフセットが 0 に収束。既存コメントが全消失する経路を作るため採用不可                                       |
| C. `<pre>` を `display: none` の親 `<div>` に wrap し SVG を兄弟 | ✗    | wrap 1 階層増えるだけで A 案と等価のメリットしかない。`hidden` 属性は CSS で `display: none` 相当 + a11y で aria-hidden 扱いになる標準動作で、追加の wrap は不要        |

A 案の追加考慮：

- `<pre hidden>` は標準で `display: none` が適用されるが、`@media print` 等で hidden を上書きされると `<pre>` が印刷出力に出てしまう。本実装では `#doc pre[hidden][data-mermaid-applied]` に `display: none !important;` を `src/styles/markdown.css` に追加して二重保険
- SVG 自体の `data-block-id` は **付けない**。コメント / 検索のアンカリング対象は `<pre>` 側に残し、SVG は表示専用とすることで、§6 / §10 のロジック変更を最小化

### d. CLI opt-in 方式：`--mermaid` boolean（vs `--diagram <mermaid|none|all>`）

| 候補                            | 採用    | 理由                                                                                                                                                              |
| ------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **A. `--mermaid` boolean flag** | ✓       | 1 言語のみのサポートで mode 切替の必要がなく、boolean が最小インターフェース。将来 plantuml / d2 を追加する時に `--plantuml` / `--d2` flag を独立で追加すれば良い |
| B. `--diagram <mermaid          | none>`  | ✗                                                                                                                                                                 | 現状は値域が 2 つしかなく、boolean flag を mode 風に書き換えただけ。将来 plantuml 等を追加するときも boolean の合成で表現できるため、mode 化のメリットが薄い |
| C. `--diagram <auto             | mermaid | all                                                                                                                                                               | none>`                                                                                                                                                       | ✗   | `auto` 検出は採用しない（§5.e）。`all` も将来 plantuml 等を追加した時に各言語のサイズが大きく異なるため、一括 opt-in は配布者に不利益 |

将来 plantuml が追加された場合：`--plantuml` flag を独立で追加し、`--mermaid` と組み合わせ可能にする。各 flag が独立 boolean のため、CLI HELP / docs / テストマトリクスが線形に増える程度で済む。

### e. デフォルトは Mermaid OFF（vs Shiki と同じ `auto`）

| 候補                   | 採用 | 理由                                                                                                                                                                                              |
| ---------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OFF（明示 opt-in）** | ✓    | Mermaid 本体は gzipped +700 KB で Shiki core + 2 テーマ（+150〜300 KB gzipped）の 2〜4 倍。Shiki と同じ `auto` 既定にすると、mermaid ブロックを 1 個含むだけで配布物が 8 倍以上になる経路ができる |
| auto（スキャン）       | ✗    | サイズ影響が大きすぎ、配布者の意図しない肥大化を招く。`auto` を採用するなら最低でも CLI が「mermaid ブロック検出時に確認プロンプトを出す」必要があり、CLI 非対話化の方針と衝突                    |
| all（常時 ON）         | ✗    | デフォルトで +700 KB は他のレビューフロー（仕様書 / 散文中心）への影響が大きすぎる                                                                                                                |

OFF を採用する代わりに、`<pre data-mermaid="1">` の textContent から `mermaid` フェンスがあることを CLI 側で検出した時に `--mermaid` 未指定なら stderr へ hint を出す：「Detected N `mermaid` block(s). Use `--mermaid` to render them as SVG.」

### f. SVG レンダリング失敗時の挙動：plain text fallback + toast

| 候補                                             | 採用 | 理由                                                                                                                                                                               |
| ------------------------------------------------ | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. plain text fallback + toast 通知**          | ✓    | MDXG §15 [MUST] フォールバック条項の解釈を「描画器がサポートしていない場合」だけでなく「サポートされているが入力が壊れている場合」にも適用。レビュアーは元のコードを読んで判断可能 |
| B. エラー SVG を埋め込む（赤枠 + "Parse error"） | ✗    | エラー SVG は元コードを隠してしまい、レビュアーが何が壊れているか判断できない。MDXG §15 [MUST] フォールバック条項の精神に反する                                                    |
| C. 何もしない（plain text のまま）               | ✗    | レビュアーが「描画されていないこと」に気づかない経路を作る。toast での 1 度の通知は最低限必要                                                                                      |

A 案の追加考慮：

- 同一 markdown 内に複数の mermaid ブロックがあり、複数が parse fail する場合は toast を集約：「Diagram render failed for N block(s)」
- `data-mermaid-failed="1"` を `<pre>` に付けて、テーマトグル時の再描画パスでも再試行を抑止（無限 toast の防止）

### g. テーマ変数の Mermaid への引き渡し：CSS variables → `themeVariables` 写像

Mermaid は CSS variables を直接読まず、初期化時の `themeVariables` オブジェクトに値を焼き込む。本実装は DESIGN.md §1 Theming の CSS variables を `getComputedStyle(document.documentElement)` で読み出して写像する：

| Mermaid `themeVariables` | DESIGN.md §1 Theming トークン |
| ------------------------ | ----------------------------- |
| `background`             | `--paper`                     |
| `primaryColor`           | `--accent`                    |
| `primaryTextColor`       | `--ink`                       |
| `lineColor`              | `--rule`                      |
| `tertiaryColor`          | `--doc-code-bg`（dark 固定）  |

写像表は `src/app/mermaid.ts` 内に定数として持ち、Mermaid version up でキー名が変わった時はテストで検出する。

theme トグル時の再描画フロー（§5.b の C 案 + theme 連動）：

1. `subscribeSystemTheme` の hook が発火
2. 全 `<pre[data-mermaid-applied]>` の sibling SVG を `remove()` し、`data-mermaid-applied` 属性を外す
3. `upgradeMermaidFences(docEl)` を再 schedule（idle callback）
4. 新しい `themeVariables` で `mermaid.initialize` を呼び、SVG を再生成

### h. 信頼境界：`securityLevel: 'strict'` + `<script id="embedded-mermaid" type="module">` の DOM 隔離

Mermaid は SVG / HTML を生成する過程で `<foreignObject>` や HTML 文字列の挿入を行うパスがあり、ユーザー入力（コードブロックの中身）を相応に信頼する。DESIGN.md §11 の「LLM 生成 markdown は信頼しない」前提と整合させるため：

- `mermaid.initialize({ securityLevel: 'strict' })` を必須化（HTML タグの sanitize、`<foreignObject>` の制限）
- 代替案 `securityLevel: 'antiscript'`（`<script>` のみ削除）は強度不足のため採用しない
- `securityLevel: 'sandbox'`（sandboxed iframe で描画）は SVG の `<a>` リンクが効かなくなる副作用があり、`'strict'` で十分

`<script id="embedded-mermaid" type="module">` で inline 注入する ESM ソース自体は、`dist/mermaid.mjs` を vite が emit したものを `<` を Unicode escape して書き込む。`embedded-md` / `embedded-shiki-langs` と同じ encode 規約（§3.2）。CSP `script-src 'self' 'unsafe-inline'` の既存許可で動作する。

### i. Mermaid version pin と再生成のトリガ

- `package.json` で `mermaid` の version を pin（caret prefix なし、exact version）
- Mermaid major version up 時：本ドキュメントの §5.g `themeVariables` 写像、§5.h `securityLevel` の挙動、§5.b `mermaid.render` の async 契約を再評価
- `dist/mermaid.mjs` は **生成物だが commit 対象**（理由は `dist/shiki-langs/` と同じ：clone 直後の利用者が `npm run build` 抜きで CLI を実行できる必要があり、`dist/` 配下に置くことで CLI bundle と一緒に配布される）
- `vite.review-request.config.ts` の emit plugin の prebuild フックで `mermaid/package.json` の version を読み出し、`dist/mermaid.mjs` の冒頭 comment に書き出す。バージョン差で挙動が変わった時の追跡用

## 6. テスト方針

### in-source test（新規）

- `core/scan-mermaid.ts`：
  - mermaid ブロックなし → 0
  - mermaid ブロック 1 個 → 1
  - mermaid ブロック複数 → N
  - リスト配下の mermaid ブロック → カウントに含む
  - 引用配下の mermaid ブロック → カウントに含む
  - ` `text ```内に書かれた`mermaid` の文字列 → カウントしない（marked.lexer が GFM 仕様で判定）
  - `Mermaid` / `MERMAID` のような大文字混入 → 小文字化マップで `mermaid` として認識
  - 空 markdown → 0

- `core/embed.ts`（既存テストに追加）：
  - `mermaidRuntime` 渡したときに `<script id="embedded-mermaid" type="module">` ブロックが書き込まれる
  - `mermaidRuntime` 未指定時には script tag 自体が書かれない
  - `mermaidRuntime` 内に `</script>` 文字列が含まれていたら build を fail させる（sanity check）

- `cli/parse-args.ts`（既存テストに追加）：
  - `--mermaid` flag が boolean として true / false パースされる
  - `--mermaid` が値を取らない（`--mermaid value` の `value` は positional として解釈される、または error）

- `app/mermaid.ts`：
  - `<script id="embedded-mermaid">` が空 / 欠落のとき `getEmbeddedMermaidRuntime()` が null を返す
  - `upgradeMermaidFences` が 2 回呼ばれても `data-mermaid-applied` ガードで二重描画にならない（idempotent）
  - mermaid.render が throw した時に `<pre>` から `hidden` が外れ、`data-mermaid-failed="1"` が付き、SVG が DOM に残らない
  - upgrade 後の `<pre>` の textContent が unchanged
  - `resolveThemeVariables()` が DESIGN.md §1 Theming の CSS variables を正しく Mermaid themeVariables 形式に写像する

- `app/doc-renderer.ts`（既存テストに追加）：
  - mermaid upgrade 後の `blockOriginalHTML` が `<pre>` + sibling SVG の wrap 構造を反映している
  - mermaid upgrade 後に `reapplyAllMarks` を呼んで `<mark class="cmt">` が `<pre>` 内に正しく再貼付される

- `core/markdown.ts`（既存テストに追加）：
  - `code` トークンが `lang === 'mermaid'` のとき Shiki ハイライト経路を skip し `data-mermaid="1"` 属性付きで出力される
  - escape 経由で `<pre><code>` の HTML タグが文字エスケープされる

### 手動視覚チェックリスト

`npm run build` 後、CLI 経由で配布 HTML を生成して以下を確認：

- [ ] `node dist/review-request.mjs --mermaid sample-with-mermaid.md` で生成した HTML を Chromium で開き、`mermaid` ブロックが SVG として描画される
- [ ] 初回 paint 時には plain `<pre>` が一瞬見え、idle callback 後に SVG に置き換わる
- [ ] OS dark で開いた時に Mermaid SVG の配色が dark テーマ追従（背景 / ノード / 線 / テキストが §1 Theming 配色）
- [ ] theme toggle で `system → light → dark` を循環すると Mermaid SVG が再描画されて配色が追従する
- [ ] mermaid 構文エラーを含むブロックは `<pre>` のまま残り、toast で「Diagram render failed」が出る
- [ ] 描画失敗ブロックがあっても他の mermaid ブロックは正常に SVG 化される
- [ ] mermaid ブロック内のテキストを選択 → `+ Comment` → コメント追加 → 再描画後も `<mark class="cmt">` が `<pre>`（hidden）内の同じ位置に出る
- [ ] CLI を `--mermaid` 指定なしで実行した HTML を開いた場合、`mermaid` ブロックは plain text fallback（既存挙動）で表示される
- [ ] CLI を `--mermaid` 指定なしで mermaid ブロック含み markdown を渡した時、stderr に「Detected N `mermaid` block(s). Use `--mermaid` to render them as SVG.」が出る
- [ ] CLI を `--mermaid` 指定ありで mermaid ブロック 0 個の markdown を渡した時、stderr に「No `mermaid` fences found in input.」が出る
- [ ] `dist/review.html`（`--mermaid` なし）のサイズが既存とほぼ同じ（~95 KB gzipped）
- [ ] `--mermaid` 指定で生成した HTML のサイズが見積もり通り（~795 KB gzipped）
- [ ] §10 Search が mermaid 含み markdown でも動作する（Step 6 案 A / B の決定に応じて挙動が変わる）
- [ ] embedded markdown 同梱 HTML をダブルクリック起動した時に Mermaid 初期化中の FOUC や jank が出ない

## 7. 受け入れ基準

- MDXG §15 [SHOULD] ` ```mermaid ` ブロックのサポートを満たす（§1 冒頭の対応スコープ表が ✓）
- MDXG §15 [MUST] 描画未サポート時の plain text fallback が回帰していない（`--mermaid` 未指定時 / 構文エラー時）
- MDXG §15 [SHOULD] ホスト色スキーム適応を満たす（light / dark トグルで Mermaid SVG が再描画）
- `dist/review.html` のサイズが `--mermaid` 未指定時に **既存と変動なし**
- `--mermaid` 指定時のサイズ増分が **gzip +800 KB 以内**
- §6 アンカリングが壊れない（既存 in-source test 全通過 + 新規追加分も通過）
- §10 Search との干渉が解決されている（Step 6 で決めた案 A / B が test と手動チェックで動く）
- §1 Theming の dark 連動が Mermaid SVG にも適用される
- DESIGN.md §12 表に「§15 Diagram Rendering」行が追加され「準拠 / 部分」に塗られる
- DESIGN.md §12「その他の拡張候補」の MDXG §15 項目が削除されている

## 8. 想定リスクと回避策

| リスク                                                                   | 回避策                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mermaid 本体サイズが見積もり (~700 KB gzipped) より大きい                | Step 1 PoC で実測。+1 MB を超える場合は受け入れ基準を見直し、SHOULD 達成より配布物軽量化を優先するなら本タスク自体を保留にする                                                                                               |
| Mermaid `import()` 動的読み込みが `file://` で動かない                   | Mermaid を `<script type="module">` で inline 注入し、グローバル `window.__mermaid` 経由で参照する迂回路。Step 1 PoC で確認                                                                                                  |
| `mermaid.render` が long-running でフレーム drop を引き起こす            | idle callback で実行することで初回 paint は守られる。複数ブロックの並列描画を避けるため `for await` で順次処理                                                                                                               |
| 既存 `<mark class="cmt">` が upgrade で消える                            | `<pre>` 自体を残し SVG を sibling で追加することで `<pre>` 内の `<mark>` は壊れない。`blockOriginalHTML` の再構築は wrap 構造の変化に追従させる                                                                              |
| §10 Search が mermaid ブロックで意図しない挙動になる                     | Step 1 PoC で挙動を確認し、Step 6 で案 A（検索対象外）/ B（一時表示）を決定。in-source test に regression ケース追加                                                                                                         |
| Mermaid `securityLevel: 'strict'` でも XSS 経路が残る                    | Mermaid の最新 advisory を Step 1 でレビュー。CSP `default-src 'none'` + `connect-src 'none'` の既存防壁が二重保険として効く（Mermaid から fetch / XHR は走らない）                                                          |
| Mermaid version up で `themeVariables` のキー名が変わる                  | 写像表を `src/app/mermaid.ts` の定数として持ち、Mermaid version を `package.json` で exact pin。version up 時は本ドキュメントの §5.g / §5.h を再評価                                                                         |
| Mermaid 構文エラー時に SVG 描画が部分的に残る                            | parse fail を `try / catch` で受け、SVG 残骸を `remove()` してから `<pre>` を表示状態に戻す。`data-mermaid-failed="1"` で再試行抑止                                                                                          |
| `dist/mermaid.mjs` の commit による repo サイズ増                        | 受け入れる。`dist/shiki-langs/` と同じく「clone 直後に `npm run build` 抜きで CLI が動く」配布契約を保つため。`mermaid` の version pin で頻繁な差分は出ず、~3 MB の追加 commit 容量は許容範囲                                |
| `<pre hidden>` が a11y で見えなくなり、コメント / 検索の対象として不適切 | `<pre hidden>` は aria-hidden 扱いだが、テキストコメント機能で必要なら `hidden` の代わりに `position: absolute; clip: rect(0 0 0 0);` 等の screen reader にも残る非表示方式に切替える余地。Step 6 で SR 動作確認時に最終判断 |
| Mermaid のグローバル副作用（`window.mermaid` への注入）が他コードと衝突  | Mermaid ESM は `import` で取得し、グローバルに公開しない。`window.__mermaid_bridge` のような名前空間 prefix 付きで使う場合も `__mdxg_mermaid` のように本実装スコープを明示                                                   |
| theme トグル時の Mermaid 全再描画でユーザー体験が止まる                  | 再描画も idle callback 経由で順次処理し、UI freeze を避ける。SVG 数が多い文書では再描画完了まで数秒かかる可能性があるが、トグル操作は頻度が低いため許容                                                                      |
| サイレント回帰（mermaid 追加で Shiki / コメント / 検索が壊れる）         | 既知ケースを in-source test + 手動チェックで網羅。CI で fail させる                                                                                                                                                          |

## 9. 参考

- [MDXG §15 Diagram Rendering（日本語訳）](./mdxg/05-extensions.md#15-diagram-renderingダイアグラム描画)
- [Mermaid 公式ドキュメント](https://mermaid.js.org/) — `mermaid.render` / `themeVariables` / `securityLevel`
- [Mermaid Security and Sanitization](https://mermaid.js.org/config/usage.html#securitylevel) — `'strict'` / `'sandbox'` / `'antiscript'` の挙動差
- [DESIGN.md §12 MDXG 準拠ロードマップ・今後の拡張](./DESIGN.md#12-mdxg-準拠ロードマップ今後の拡張)
- [DESIGN.md §1 Theming](./DESIGN.md#12-mdxg-準拠ロードマップ今後の拡張) — CSS variables 経由のテーマ写像
- [DESIGN.md §6 コメントのアンカリング](./DESIGN.md#6-コメントのアンカリング)
- [DESIGN.md §10 Search](./DESIGN.md#12-mdxg-準拠ロードマップ今後の拡張)
- [DESIGN.md §11 セキュリティとプライバシー](./DESIGN.md#11-セキュリティとプライバシー)
- [DESIGN.md §13 ビルドパイプライン](./DESIGN.md#13-ビルドパイプライン)
- [docs/mdxg-rendering-code-block.archive.md](./mdxg-rendering-code-block.archive.md) — Shiki upgrade のパターン参考元（C 案 lazy + per-block upgrade、`<script id="embedded-*">` 注入規約）
- [docs/design-example.md](./design-example.md) — 設計ドキュメントテンプレート
