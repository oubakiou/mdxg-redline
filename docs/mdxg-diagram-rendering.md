# MDXG §15 Diagram Rendering 対応 設計・実装計画

DESIGN.md §12「その他の拡張候補」の「MDXG §15 Diagram Rendering の対応」項目を実装に落とすための設計判断と実装手順をまとめる。完了時点で本ドキュメントは DESIGN.md §12 表に「§15 Diagram Rendering」行を追加して「準拠 / 部分」に塗り替え、本ファイルは `docs/mdxg-diagram-rendering.archive.md` にリネームしてアーカイブする想定（`docs/mdxg-rendering-code-block.archive.md` と同じ扱い）。

## 1. 対応スコープ

[MDXG §15 Diagram Rendering](./mdxg/05-extensions.md#15-diagram-renderingダイアグラム描画) の 4 要件を、`mermaid` 言語識別子のフェンス付きコードブロックに対して満たす。

| 要件                                                                                    | 現状 | 完了条件                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [SHOULD] 最低限、` ```mermaid ` ブロックはサポートされる                                | 未   | review-request CLI に `--mermaid <auto\|on\|off>` mode を追加し（既定 `auto`）、注入判定が true のときに Mermaid.js を `<script id="embedded-mermaid">` に注入。配布 HTML 起動時に各 ` ```mermaid ` ブロックを SVG に upgrade |
| [MAY] その他のダイアグラム言語（`plantuml` / `d2` / `graphviz` 等）もサポートされてよい | 未   | 本タスクでは扱わない（§1 スコープ外）。`mermaid` 以外の識別子は既存の Shiki ハイライト経路に乗ったまま                                                                                                                        |
| [MUST] 描画未サポート時の構文ハイライト付きコードブロックへのフォールバック             | ✓    | `--mermaid off` 時 / `auto` で 0 件時に Mermaid.js を注入せず、ブラウザ側 upgrade は no-op で Shiki ハイライト済みの `<pre><code class="language-mermaid">` のままにする経路で満たす。回帰させない                            |
| [SHOULD] 描画されたダイアグラムはホストの色スキームに適応する                           | 未   | Mermaid の `theme: 'base'` + DESIGN.md §1 Theming の CSS variables (`--ink` / `--paper` / `--rule` / `--accent`) を `themeVariables` にバインドし、`html.dark` トグルに同期更新                                               |

追加実装（規格上は SHOULD 未満だが UX 上有用）：

- **upgrade 失敗時の plain text fallback 表示**：Mermaid のパースエラー（不正な構文 / 未対応のダイアグラム種別）時に SVG 描画を諦め、元のコードブロックを残したまま toast で「Diagram render failed」を通知する。MDXG §15 [MUST] フォールバック条項を「描画器がサポートされていない場合」だけでなく「サポートされているが入力が壊れている場合」にも適用する解釈
- **クリックでモーダル拡大表示**：レンダリング済み SVG をクリックすると中央に拡大表示するモーダルを開き、`Esc` / 背景クリック / Close ボタンで閉じる。本文ペインの幅制約（`#doc max-width: 860px`）に収まらない複雑なダイアグラムでも全体を確認できるようにする。モーダル内では SVG をビューポート余白いっぱいに `max-width` / `max-height` で拡縮表示する（zoom / pan ジェスチャは含まない、下記スコープ外）。実装は既存 `app/help-modal.ts` のパターン（`open` クラス toggle + Esc/バックドロップ閉じる）を踏襲

スコープ外（別タスクで扱う）：

- **`plantuml` / `d2` / `graphviz` のサポート**（§15 [MAY]）：Mermaid 1 言語の対応コストを実装した後で需要が出てから検討する。各言語ごとに描画エンジン（PlantUML は JVM / d2 は Go バイナリ / graphviz はネイティブ）を持ち込む必要があり、ブラウザ単一 HTML 配布の制約と衝突する。本実装の Mermaid と同じく WASM / pure JS 実装の登場待ち
- **モーダル内 zoom / pan ジェスチャ**（§15.2 実装例の zoom / pan）：上記モーダル拡大表示はビューポート余白いっぱいまでの単純な拡縮までを担う。wheel zoom / drag pan / pinch zoom はレビュー UX として優先度が低く、実装すると panzoom ライブラリの追加（数十 KB）と SVG イベント周りの整合（コメント / 検索との競合）が必要になるため別タスク
- **ダイアグラムへの直接コメント付与**：§6 アンカリングはテキスト範囲ベースで、SVG ノードに直接 `<mark class="cmt">` を貼る経路は持たない。本実装では「コードブロック側（`<pre hidden>` で残す）の textContent を対象に通常のテキストコメントを付ける」経路に倒し、SVG への矩形選択 / ノード選択は対応外とする

## 2. リファレンス実装と差分

[vercel-labs/mdxg `apps/web`](https://github.com/vercel-labs/mdxg/tree/main/apps/web) は §15 を実装していない（Shiki ハイライトの 1 言語として `mermaid` を扱い、SVG 描画はしない）。本実装はリファレンス実装の先行参考が無い領域となるため、本章は「ベースラインアーキテクチャ」として既存実装と Mermaid.js 公式の組み合わせを記述する。

| 既存実装の構成要素                                   | 本実装の置換 / 追加                                                                                       |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Shiki upgrade の 2 段構成（plain → highlight）       | 同じパターンを Mermaid に適用（plain `<pre>` → upgrade で `<svg>` を sibling 挿入）                       |
| `dist/shiki-langs/<lang>.json` の言語別 emit         | `dist/mermaid.mjs` を別 emit（grammar ではなくランタイム本体。CLI mode に応じて HTML に注入）             |
| CLI `--shiki-langs <auto\|all\|none\|<csv>>` の mode | CLI `--mermaid <auto\|on\|off>` を追加。既定 `auto` で markdown 内に `mermaid` ブロックがあるときだけ注入 |
| `<script id="embedded-shiki-langs">` JSON 注入       | `<script id="embedded-mermaid" type="module">` で Mermaid.js ESM を注入                                   |
| `core/markdown.ts` renderer の言語別分岐             | `mermaid` 識別子だけは Shiki ハイライト経路を skip し、plain `<pre data-mermaid="1">` で出す              |
| Shiki upgrade フェーズ                               | `src/app/mermaid.ts`（新規）の lazy upgrade フェーズで `requestIdleCallback` 後に Mermaid SVG を生成      |

リファレンス実装が §15 を実装していない理由は推測になるが、Mermaid.js のサイズ（gzip ~700 KB）が単一 HTML 配布物に与える影響を踏まえると、本実装の CLI opt-in 設計はリファレンスより慎重な選択となる。Shiki upgrade と異なり「default ON」にはせず、配布者が明示的に必要としたときだけ載せる方針を採る。

## 3. bundle 構成と Mermaid 注入

### 3.1 配布物の構成

DESIGN.md §13 で `dist/` の出口は `dist/standalone.html` / `dist/embed-template.html` / `dist/review-request.mjs` / `dist/shiki-langs/*.json` の 4 系統に分かれる（旧 `dist/review.html` は廃止、コミット `3b6cc34` 周辺の split-outputs 化以降は中間出力としてのみ存在）。Mermaid 対応の配布物は次の構成になる：

| ファイル                   | 内容                                                                                                                                                                                    | 配布形態                             |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `dist/standalone.html`     | 単独 Open file 用、Shiki bundled 全言語（約 235）inline 済み。Mermaid.js は **含まない**（CLI 経路ではないため `--mermaid` 注入対象外）。` ```mermaid ` ブロックは Shiki ハイライト維持 | エンドユーザーが直接ダブルクリック   |
| `dist/embed-template.html` | review-request CLI が rewrite テンプレートとして読み込む素材。Mermaid.js は **含まない**（`--mermaid` 未指定時のデフォルト配布物）                                                      | CLI 経由でのみ使用、直接開く想定なし |
| `dist/mermaid.mjs`         | Mermaid.js の ESM bundle（vite で別 entry として emit、commit 対象）                                                                                                                    | CLI が読み込む素材                   |
| `dist/review-request.mjs`  | CLI 本体。`--mermaid` 指定時のみ `dist/mermaid.mjs` を読み、`embed-template.html` を rewrite した `*-review.html` の `<script id="embedded-mermaid">` に書き込む                        | 配布者向け CLI                       |

CLI が生成する配布 HTML（`<mdFileName>-<docHash>-review.html`）のサイズは Mermaid 非対応時（既定）には現行の `embed-template.html` ベース（~327 KB raw / ~99 KB gzipped、DESIGN.md §12 §2 Code Block Rendering 行）から変動しない。`--mermaid` 指定時のみ +700 KB gzipped 程度の増加となる。この設計により、Mermaid を必要としないレビューフロー（仕様書 / 散文中心の文書）が肥大化を被らない。

**`dist/standalone.html` への Mermaid 同梱は本タスクでは行わない**（設計判断 §5.l）。Shiki と異なり Mermaid runtime は CLI opt-in 専用で、standalone を直接ダブルクリックするユーザーは ` ```mermaid ` ブロックを Shiki ハイライト済みコードブロックとして読む（MDXG §15 [MUST] フォールバックは満たす）。理由：standalone は既に Shiki bundled 全言語 inline で ~45 MB / gzip ~5.9 MB と肥大化しており、Mermaid を更に +2.8 MB raw 載せると build 時間と `file://` 起動時のパース時間が無視できなくなる。standalone から SVG 描画を望むユースケースが顕在化した時点で再評価する。

### 3.2 CLI による Mermaid 注入

`src/cli/parse-args.ts` に `--mermaid <auto|on|off>` mode を追加する（`--shiki-langs` と同じ mode 型インターフェース）。既定は `auto`。

| `--mermaid` 値 | 挙動                                                                                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auto`（既定） | `scanMermaidFences(markdown) > 0` のときだけ Mermaid.js を注入。0 件のときは注入せず配布物サイズも増えない。`mermaid` ブロックを含む markdown だけ自動で重い配布物になる対称な既定挙動               |
| `on`           | 件数に関係なく必ず Mermaid.js を注入。stdin 経路や将来の動的差し替えで「mermaid ブロックがまだ無いが後から増える」前提の配布に使う                                                                   |
| `off`          | Mermaid.js を注入しない。` ```mermaid ` ブロックは Shiki ハイライト済みコードブロックのまま表示（MDXG §15 [MUST] フォールバック）。配布物サイズを最小化したい / レビュアー環境を制約したいときに使う |

#### 注入経路

`src/core/embed.ts` の rewrite ロジックに `mermaidRuntime?: string` 引数を追加し、`<script id="embedded-mermaid" type="module">` ブロックに次のラップを付けた ESM ソースを書き込む：

```html
<script id="embedded-mermaid" type="module">
  import mermaid from '...inline Mermaid ESM source...'
  globalThis.__mdxgMermaid = mermaid
  document.dispatchEvent(new Event('mdxg:mermaid-ready'))
</script>
```

実態としては、`dist/mermaid.mjs` の中身を読み出し、末尾に `globalThis.__mdxgMermaid = mermaid;` と `document.dispatchEvent(...)` の 2 行を追記して inline 注入する（Mermaid ESM が default export している `mermaid` を bridge global にセットし、ロード完了イベントを発火させる）。

エンコード規約は `embedded-md` / `embedded-shiki-langs` と同じく `</script>` の誤検出を避けるため、ESM ソース中の `</script>` 文字列を CLI 注入時に `<\/script>` へ escape する（既存 `core/embed.ts` で markdown を JSON 経由で `<` 化するのと同じ思想だが、ESM は素の JS source なので escape 文字列の埋め込みになる）。Mermaid 本体は version up でエラーメッセージ等に `</script>` を含むパスが混入する可能性がゼロではないため、build を fail させず必ず通せる経路を用意する。escape 件数は CLI が stderr に件数だけ出して可視化する。

#### ブラウザ側の読み込み（bridge 方式）

`src/app/mermaid.ts`（新規）で起動時に `<script id="embedded-mermaid">` の有無を確認する。存在する場合、`type="module"` の script は HTML パース完了後に同期で実行され `globalThis.__mdxgMermaid` に Mermaid インスタンスがセットされる。`upgradeMermaidFences` は `requestIdleCallback`（fallback: `setTimeout(..., 0)`）で paint 後に schedule され、その時点で `globalThis.__mdxgMermaid` を同期で読み出して使用する。

bridge 方式を採用する理由は §5.j 参照。`import('embedded-mermaid')` のような module specifier 経由の動的 import は採用しない（id 属性は specifier として解決できないため）。blob URL 経由の dynamic import 案も検討したが、CSP `script-src 'self' 'unsafe-inline'` に `blob:` を追加する必要が生じ、DESIGN.md §11 信頼境界の緩和を伴うため採用しない。

### 3.3 配布物サイズの実測見積もり

CLI が生成する `*-review.html`（`embed-template.html` ベース、~327 KB raw / ~99 KB gzipped）に対する Mermaid 注入後のサイズ見積もり：

| ケース                                                                     | 配布 HTML raw                         | embedded-mermaid 増分         | gzipped 後の配布物 |
| -------------------------------------------------------------------------- | ------------------------------------- | ----------------------------- | ------------------ |
| `--mermaid off` または `auto` で `mermaid` ブロック 0 件（後者が既定挙動） | ~327 KB（現行 `embed-template.html`） | 0 KB                          | ~99 KB（現行）     |
| `--mermaid on` または `auto` で `mermaid` ブロック 1 件以上                | ~327 KB                               | +2.8 MB raw / +700 KB gzipped | ~800 KB            |

`dist/standalone.html` は §3.1 の通り Mermaid 注入対象外のため本表の影響を受けず、~45 MB raw / ~5.9 MB gzipped（現行）のまま変動しない。

実測値は Step 1 PoC 完了後に確定する。

## 4. 実装ステップ

順序は依存関係順。各ステップ完了で in-source test と手動視覚チェックを通す。

### Step 1: ライブラリ選定の検証と PoC

- 本ドキュメントの §5 設計判断をレビュー
- Mermaid.js ESM build (`mermaid/dist/mermaid.esm.min.mjs`) が `import()` 経由でブラウザに読み込めること、`mermaid.render(id, src)` が同期 / async どちらで返るかを PoC で確認
- Mermaid ESM が **単一ファイルで完結し追加 bundle 不要で動くか**（内部 import 文を持たないか）を確認。持つ場合は §4 Step 3 で「単純コピー」案を捨て vite SSR bundle 経路に倒す判断材料にする
- `mermaid.initialize` を **複数回呼び出した時の冪等性**（内部 cache 衝突 / 残留 SVG style 等の副作用が出ないか）を確認。theme トグル時の全 SVG 再描画パス（§5.b / §5.g）の前提
- 配布物サイズ実測（raw / gzipped）と Step 5 の `requestIdleCallback` schedule での FCP / TTI 計測
- `theme: 'base'` + `themeVariables: { background, primaryColor, lineColor, ... }` で DESIGN.md §1 Theming の CSS variables を読み出す経路の動作確認
- §6 アンカリング / §10 Search との両立で残している **Step 6 案 A（検索対象外）/ 案 B（一時表示）どちらに倒すか** を、Mermaid SVG の textContent が `<pre hidden>` 側と重複するかなど実 DOM 構造を見て決定する

成果物：§5 マッピング表が確定状態、PoC で Mermaid ESM がブラウザで動くこと、Step 6 案 A/B が確定

### Step 2: 純粋ロジック層（`src/core/scan-mermaid.ts` 新規）

UI / DOM / Mermaid 本体に依存しないフェンススキャンを pure 関数で書き、in-source test を通す。CLI の `--mermaid auto` mode が「mermaid ブロック 0 件のとき注入を skip する」判定の中核として使う（`--shiki-langs auto` の `scanFencedLangs` と同じ責務）。

```ts
export function scanMermaidFences(markdown: string): number
```

- `marked.lexer(markdown)` で AST を取得（`core/scan-fenced-langs.ts` と同じパターン）
- `token.type === 'code' && token.lang?.toLowerCase() === 'mermaid'` の token をカウント。識別子の大小文字を区別せず、GFM 慣習および `core/scan-fenced-langs.ts` の既存パターン（`JS` / `Python` 等の大文字混入を許容）と揃える
- 戻り値はブロック数（auto mode の判定に使う）

成果物：`src/core/scan-mermaid.ts` + in-source test（mermaid ブロックなし / 1 個 / 複数 / リスト配下 / 引用配下 / コードフェンス内のフェイク `mermaid` 文字列が含まれない）

### Step 3: ビルド側 — Mermaid ESM bundle の emit

- `vite.review-request.config.ts` に Mermaid ESM を別 entry として emit する設定を追加（`dist/mermaid.mjs` として書き出し、CLI bundle 自体には含めない）
- もしくは `node_modules/mermaid/dist/mermaid.esm.min.mjs` をビルド時に `dist/mermaid.mjs` へコピーするだけの shell-less plugin で済むなら、そちらを採用（vite SSR bundle を経由しない方が将来のバージョン pin 管理が単純）
- `dist/mermaid.mjs` は **生成物だが commit 対象**（`dist/standalone.html` / `dist/embed-template.html` / `dist/review-request.mjs` / `dist/shiki-langs/` と同じ配布契約。clone 直後の利用者が `npm run build` 抜きで CLI を実行できる）
- `package.json` に `mermaid` を `dependencies`（非 dev）として追加し、version を pin

成果物：`dist/mermaid.mjs` が emit され、commit 対象になる

### Step 4: CLI 側 — `--mermaid <auto|on|off>` mode と注入

- `src/cli/parse-args.ts` に `--mermaid <auto|on|off>` mode を追加（既定 `auto`）。`parseMermaidValue` は `parseShikiLangsValue` と同じ pattern で実装し、未知の値はエラーで reject
- `src/cli/review-request.ts` のエントリで mode と `scanMermaidFences(markdown)` から「注入する / しない」を解決：
  - `auto`: `scanMermaidFences > 0` なら注入
  - `on`: 常に注入
  - `off`: 常に注入しない
- 注入する場合は `dist/mermaid.mjs` を読み込み（`readFileSync`）、`</script>` を `<\/script>` に escape してから `core/embed.ts` の `mermaidRuntime` 引数に渡す。escape 件数を stderr に件数のみ報告
- `src/core/embed.ts` に `mermaidRuntime?: string` 引数を追加し、`<script id="embedded-mermaid" type="module">` ブロックを rewrite。`mermaidRuntime` が undefined / 空文字なら script tag 自体を書かない
- HELP_TEXT 更新：`--mermaid <auto|on|off>` の意味（auto = 自動検出、on = 常時注入、off = 注入しない。注入時の配布物サイズが +700 KB gzipped 程度増える）と既定値（auto）を記述

成果物：CLI が mode と検出結果から `embedded-mermaid` 注入を決定できること（in-source test で auto / on / off × 0件 / 1件 の組み合わせを検証）

### Step 5: ブラウザ側 — 初期 render と Mermaid upgrade の 2 段階構成

設計判断は §5.b の C 案（paint 後 lazy 初期化 + 各 `<pre>` 単位の upgrade、Shiki と同じパターン）。

#### Step 5a: 初期 render は Mermaid 非依存で即時 paint

- `src/core/markdown.ts` の marked renderer：
  - `code` トークンが `lang?.toLowerCase() === 'mermaid'` のとき、現行と同じく `<pre><code class="language-mermaid">` 経路（Shiki ハイライト対象。`src/core/shiki-aliases.generated.ts` に `mermaid` / `mmd` が登録済みのため、コミット `3b6cc34` の Shiki bundled 全言語化以降は自動でハイライトされる）に加えて、識別用に `data-mermaid="1"` 属性を `<pre>` に付与する（大小文字を区別しない、Step 2 と同じ判定ロジック）
  - Shiki ハイライト経路は **skip しない**：`--mermaid off` 時 / Mermaid runtime 未注入時にもブラウザ側で何もしなければ Shiki ハイライト済みのコードブロックが残り、MDXG §15 [MUST] のフォールバック要件（構文ハイライト付きコードブロック）を構造的に満たす
  - `escapedSrc` は既存の `core/escape.ts` で HTML escape 済み（Shiki upgrade 経路と共通）
- `src/app/shiki.ts` の upgrade 側：
  - `pre[data-mermaid="1"]` も **通常通り Shiki upgrade 対象に含める**。renderer 側でも skip しないため、Mermaid runtime 非注入時のフォールバックは Shiki ハイライト済みコードブロックになる（MDXG §15 [MUST] の構文ハイライト要件を構造的に満たす）。Mermaid upgrade が後段で走ると `<pre>` を `hidden` にして SVG を sibling 挿入するため、Shiki span は `<pre hidden>` 配下に温存され視覚的には消える
- `src/app/code-copy-wrap.ts` の `injectCopyButtons`：
  - `pre[data-mermaid="1"]` を Copy button 注入対象から除外（Mermaid runtime 注入時は upgrade 後 `<pre hidden>` になり Copy button が UI として意味を持たないため）。runtime 未注入時の Shiki ハイライトのみ表示パスでも Copy ボタンは省く（ダイアグラム DSL のコードをコピーする UX 価値が低いため）
- `src/app/doc-renderer.ts` の初期描画パス：
  - 既存ロジックがそのまま動く。`data-mermaid="1"` 属性は属性として残るだけで描画には影響しない

#### Step 5b: paint 後の Mermaid upgrade

- `src/app/mermaid.ts`（新規）：
  - `getEmbeddedMermaidRuntime()` で `<script id="embedded-mermaid">` の有無を確認、無ければ null を返して以降の処理を skip
  - `upgradeMermaidFences(docEl)` を初期 render 完了後に schedule
    - `requestIdleCallback(callback, { timeout: 2000 })`（fallback: `setTimeout(callback, 0)`）で paint 後に走らせる
    - `window.getSelection().toString().length > 0` ならスキップし、`selectionchange` で空に戻ったら再試行（Shiki と同じパターン）
  - 実行内容：
    1. `globalThis.__mdxgMermaid` を読み出して Mermaid インスタンスを取得（§3.2 bridge 方式）。未定義なら一度だけ `mdxg:mermaid-ready` イベントを `await`（最大 2 秒の timeout、超えたら null として skip）して再試行
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
- 未対応構文や parse 失敗は Shiki ハイライト済みコードブロックを残したまま toast 通知

### Step 6: §6 アンカリングと §10 Search の維持確認

- §6 のブロックフラットテキストオフセット計算は `textContent` ベースで動く。`<pre hidden>` は CSS で非表示でも DOM 上の text node は残り、`selection.ts` の `textSegments` は `[hidden]` を skip しない既存挙動を維持する（Shiki の `.code-copy-btn` skip と異なり、こちらは active な検索対象として残す方針）
- ただし `<pre hidden>` 上に出現するコメントマーカーは画面上では見えない（`<pre>` が `display: none` 相当）。レビュアー視点では「ダイアグラムにコメントを付ける」 → 「対応するコードブロックを表示する手段」が必要：
  - Step 6 で UI に「Source」トグルボタンを追加するか
  - もしくは `<pre>` を `hidden` でなく `position: absolute; visibility: hidden;` で text-selection 可能にして「コードを選択するとフローター経由でコメント可能」な経路を残す
  - 後者を採用する場合は §11 CSP の `style-src 'unsafe-inline'` 既存許可で済む（追加緩和不要）
- §10 Search の `<mark class="search-hl">` も同様に `<pre>` 配下に貼られる。検索ヒットがダイアグラム内で起きた場合の挙動を決める：
  - 案 A: SVG 描画後は `<pre>` を非表示にし、検索対象から外す（`textSegments` で `[data-mermaid-applied]` 配下を skip）
  - 案 B: 検索ヒット時に `<pre>` を一時的に表示してハイライト位置にスクロール
  - 採用は Step 1 PoC 後に決定（テスト方針との接続は §6 / §7 受け入れ基準を参照）
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

### Step 7b: SVG クリックでモーダル拡大表示

設計判断は §5.j。

- `src/review.html` に `#mermaid-modal` を static で配置（`#modal` / `#help-modal` と同じ規約、`role="dialog"` / `aria-modal="true"` / `aria-labelledby`）
- `src/app/mermaid-modal.ts`（新規）：`openMermaidModal(sourceSvg)` / `closeMermaidModal()` を export
  - open 時：clicked SVG を `outerHTML` 経由で modal body に複製挿入、modal に `open` クラスを付ける
  - close 経路：Esc キー（既存 `handleEscapeKey` に統合）/ 背景クリック / Close ボタン
  - body 内の複製 SVG は CSS のみで `max-width: 90vw; max-height: 90vh` 拡縮
- `src/app/mermaid.ts` の upgrade 後フェーズで、SVG に `data-mermaid-expandable="1"` / `role="button"` / `tabindex="0"` / `aria-label="Expand diagram"` / `cursor: zoom-in` を付与し、click handler を wire
- click handler：selection が空でないとき / SVG 内 `<a>` クリック時は open に転送しない（既存 `<a>` の挙動を優先）

成果物：upgrade 済み SVG をクリックするとモーダルが open し、Esc / 背景 / Close で close する。SVG 上のテキスト選択や内部リンクは妨げられない

### Step 8: DESIGN.md 反映と本ドキュメントの role 切替

- DESIGN.md §12 表に「Extensions / §15 Diagram Rendering」行を追加し「準拠 / 部分」に塗る（`mermaid` のみサポート、`plantuml` / `d2` / `graphviz` は未対応のため「部分」）
- DESIGN.md §3 review-request CLI コマンド仕様に `--mermaid <auto|on|off>` を追記（既定 `auto`、auto の判定挙動とサイズ影響）
- DESIGN.md §11 セキュリティ：Mermaid `securityLevel: 'strict'` と `<script id="embedded-mermaid" type="module">` の信頼境界、CSP 変更が不要であることを 1 段落で追記
- DESIGN.md §13 ビルドパイプライン：`dist/mermaid.mjs` の出口を §13 全体像と表に追加（`dist/shiki-langs/` は default で配布物に含まれるが、`dist/mermaid.mjs` は CLI が opt-in で注入する素材である点を注釈）
- DESIGN.md §13 末尾「ソース構成の責務境界」：`src/core/scan-mermaid.ts` / `src/app/mermaid.ts` / `src/app/mermaid-modal.ts` / `dist/mermaid.mjs` を追加（コミット `b5e3cbd` で §14 ファイル構成は §13 末尾の責務境界節に統合済みのため、新規ファイル列挙はそこへ追記する）
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
- **却下案 D. `queueMicrotask` / `Promise.resolve().then` で初回 paint 直後の microtask に置く**: idle callback ほど後ろに倒さない代わりに、layout / style 計算と同じ frame に乗ってしまい結局 FCP に寄与しない。`requestIdleCallback` は Safari 未サポートだが `setTimeout(..., 0)` の fallback で常に最低 1 frame 後ろに倒せるため、microtask 案より C 案が優位。`requestIdleCallback` polyfill は採用しない（fallback で十分機能）

### c. SVG の DOM 配置：`<pre>` を hidden で残し SVG を sibling として挿入

| 候補                                                             | 採用 | 理由                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. `<pre hidden>` + sibling `<svg>`**                          | ✓    | `<pre>` の textContent が DOM に残るため、§6 アンカリング / §10 Search / コメント機能が `<pre>` 上で従来どおり動作する。SVG は表示専用で、コメント / 検索の対象にしない |
| B. `<pre>` を SVG で置換                                         | ✗    | `<pre>` の textContent が消失し、§6 ブロックフラットテキストオフセットが 0 に収束。既存コメントが全消失する経路を作るため採用不可                                       |
| C. `<pre>` を `display: none` の親 `<div>` に wrap し SVG を兄弟 | ✗    | wrap 1 階層増えるだけで A 案と等価のメリットしかない。`hidden` 属性は CSS で `display: none` 相当 + a11y で aria-hidden 扱いになる標準動作で、追加の wrap は不要        |

A 案の追加考慮：

- `<pre hidden>` は標準で `display: none` が適用されるが、`@media print` 等で hidden を上書きされると `<pre>` が印刷出力に出てしまう。本実装では `#doc pre[hidden][data-mermaid-applied]` に `display: none !important;` を `src/styles/markdown.css` に追加して二重保険
- 印刷時の挙動：`@media print` では「SVG sibling は出す / `<pre hidden>` は隠す」を維持する（紙面で `<pre>` のソースが二重に出ると冗長）。SVG 自体は `print-color-adjust: exact` を当てて theme トグル時の配色を維持
- SVG 自体の `data-block-id` は **付けない**。コメント / 検索のアンカリング対象は `<pre>` 側に残し、SVG は表示専用とすることで、§6 / §10 のロジック変更を最小化。selection が SVG 上で発生したときは祖先方向に `data-block-id` が見つからないため `floater` も出ない（明示的に「ダイアグラムへの直接コメント付与」を §1 scope 外として倒した結論と整合）
- **却下案 D. `<details>` で折りたたみ**: `<pre>` を `<details><summary>Source</summary><pre>...</pre></details>` で wrap して開閉可能にする案。print 時に summary だけ出せる利点はあるが、§6 アンカリング上 `<pre>` の祖先側に `<details>` が増えると blockId 解決ロジック（祖先方向の `[data-block-id]` 探索）が変わるため見送り。クリック拡大は §5.j のモーダル拡大表示で別途解決

### d. CLI インターフェース：`--mermaid <auto|on|off>` mode（vs boolean flag）

| 候補                                | 採用 | 理由                                                                                                                                                                                |
| ----------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. `--mermaid <auto\|on\|off>`**  | ✓    | 既存 `--shiki-langs <auto\|all\|none\|csv>` と同じ mode 型インターフェース。UX の一貫性を保ち、配布者が `auto` 既定で「mermaid ブロックがあれば描画、無ければ最小配布物」を得られる |
| B. `--mermaid` boolean flag         | ✗    | 「指定 / 未指定」の 2 値で表現力が不足。boolean では `auto`（検出依存）を表せず、配布者が markdown を都度 grep して flag を付け替える運用になる                                     |
| C. `--diagram <mermaid\|all\|none>` | ✗    | 将来 plantuml 等を追加した時に各言語のサイズが大きく異なるため、一括 opt-in は配布者に不利益。1 言語 1 flag の方が独立に opt-in できて将来性が高い                                  |

将来 plantuml が追加された場合：`--plantuml <auto|on|off>` flag を独立で追加し、`--mermaid` と組み合わせ可能にする。各 flag が独立 mode のため、CLI HELP / docs / テストマトリクスが線形に増える程度で済む。

### e. デフォルトは `auto`（vs `off`）

| 候補                 | 採用 | 理由                                                                                                                                                                                                                               |
| -------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`auto`（既定）**   | ✓    | `mermaid` ブロックを含まない markdown では注入が skip され配布物サイズが現行から変わらない。含む markdown だけ自動で重い配布物になる対称な既定挙動で、配布者が markdown 内容を意識せずに CLI を回せる。`--shiki-langs auto` と同じ |
| `off`（明示 opt-in） | ✗    | Mermaid ブロックを書いた markdown を `--mermaid on` 抜きで配布すると Shiki ハイライト済みコードブロックとして残るだけで SVG にならず、配布者が「描画されない」事故を踏みやすい。`auto` ならこの事故が構造的に消える                |
| `on`（常時 ON）      | ✗    | mermaid ブロックを含まない markdown でも +700 KB 増える経路を既定にすると、他のレビューフロー（仕様書 / 散文中心）への影響が大きい                                                                                                 |

`auto` のリスク mitigation：

- markdown を編集している途中で意図せず mermaid ブロックが混入した場合、配布物サイズが突然 +700 KB 増える経路ができる。CLI が auto モードで注入判定時に stderr へ「Detected N mermaid block(s). Embedding mermaid runtime (+700 KB gzipped).」と件数だけ報告し、配布者が気づける導線を残す
- 明示的に「絶対に注入したくない」配布者は `--mermaid off` で意図表明できる

### f. SVG レンダリング失敗時の挙動：Shiki ハイライト済みコードブロック維持 + toast

| 候補                                                       | 採用 | 理由                                                                                                                                                                                                                          |
| ---------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Shiki ハイライト済みコードブロック維持 + toast 通知** | ✓    | MDXG §15 [MUST] フォールバック条項の解釈を「描画器がサポートしていない場合」だけでなく「サポートされているが入力が壊れている場合」にも適用。Shiki 全言語化により `mermaid` ブロックは既に構文ハイライトされており、これを残す |
| B. エラー SVG を埋め込む（赤枠 + "Parse error"）           | ✗    | エラー SVG は元コードを隠してしまい、レビュアーが何が壊れているか判断できない。MDXG §15 [MUST] フォールバック条項の精神に反する                                                                                               |
| C. 何もしない（コードブロックのまま、通知なし）            | ✗    | レビュアーが「描画されていないこと」に気づかない経路を作る。toast での 1 度の通知は最低限必要                                                                                                                                 |

A 案の追加考慮：

- 同一 markdown 内に複数の mermaid ブロックがあり、複数が parse fail する場合は toast を集約：「Diagram render failed for N block(s)」。`for await` で順次 upgrade するため fail 発生順に toast を出すと連発するので、**upgrade pass 全体の完了後にまとめて 1 件だけ出す**（`failedCount` を pass 内で累積し、pass 終了時に `failedCount > 0` なら 1 度だけ toast 表示）
- `data-mermaid-failed="1"` を `<pre>` に付けて、テーマトグル時の再描画パスでも再試行を抑止（無限 toast の防止）。再試行はページ再読み込み（markdown 再 load）でのみ起こる前提を明示する

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

`<script id="embedded-mermaid" type="module">` で inline 注入する ESM ソース自体は、`dist/mermaid.mjs` を vite が emit したものを CLI 注入時に `</script>` → `<\/script>` へ escape して書き込む（§3.2）。`embedded-md` は markdown を JSON 経由で `<` 化する規約だが、ESM は素の JS source なので JS source 内で同等の文字列分割 escape を用いる。CSP `script-src 'self' 'unsafe-inline'` の既存許可で動作し、変更不要。

### i. Mermaid version pin と再生成のトリガ

- `package.json` で `mermaid` の version を pin（caret prefix なし、exact version）
- Mermaid major version up 時：本ドキュメントの §5.g `themeVariables` 写像、§5.h `securityLevel` の挙動、§5.b `mermaid.render` の async 契約を再評価
- `dist/mermaid.mjs` は **生成物だが commit 対象**（理由は `dist/shiki-langs/` と同じ：clone 直後の利用者が `npm run build` 抜きで CLI を実行できる必要があり、`dist/` 配下に置くことで CLI bundle と一緒に配布される）
- `vite.review-request.config.ts` の emit plugin の prebuild フックで `mermaid/package.json` の version を読み出し、`dist/mermaid.mjs` の冒頭 comment に書き出す。バージョン差で挙動が変わった時の追跡用

### j. SVG クリック時のモーダル拡大表示

| 候補                                              | 採用 | 理由                                                                                                                                                                                                                          |
| ------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. クリックで中央モーダル open / Esc で close** | ✓    | `#doc max-width: 860px` に収まらない複雑なダイアグラムでもビューポート余白いっぱいで全体を確認できる。既存 `app/help-modal.ts` のパターンを踏襲することで modal HTML / open-close wiring / Esc 統合の実装コストが線形に収まる |
| B. zoom / pan ジェスチャ付きビューア              | ✗    | panzoom ライブラリ追加で配布物サイズが増え、SVG イベント周りの整合（コメント / 検索との競合）が複雑化。レビュー UX としてのコスト対効果が薄い（§1 scope 外）                                                                  |
| C. SVG を data URI で別タブ / 別ウィンドウに開く  | ✗    | レビュー文脈と分離して作業負荷が増える。`<a target="_blank">` の clickjacking / referrer leak も追加考慮が必要                                                                                                                |

A 案の実装ポイント：

- `app/mermaid.ts` の upgrade 後に SVG sibling に `data-mermaid-expandable="1"` 属性 + `cursor: zoom-in` を付与。`<button>` で wrap はせず（SVG 全体に click handler を `<svg>` 上で wire する）、a11y のため `role="button"` / `tabindex="0"` / `aria-label="Expand diagram"` を SVG に追加
- 新規 `app/mermaid-modal.ts`（または `help-modal.ts` 横の小モジュール）が `#mermaid-modal` の open/close を担当：
  - open 時：clicked SVG の `outerHTML` を modal 内 `<div class="mermaid-modal-body">` に複製挿入。元 SVG は触らない（双方向 binding なし）
  - 拡縮は CSS のみ（`max-width: 90vw; max-height: 90vh; width: auto; height: auto`）。zoom / pan ジェスチャは持たない
  - close 経路：Esc キー / 背景クリック / Close ボタン（既存 `handleEscapeKey` に統合）
- modal HTML は `src/review.html` に static で置く（`help-modal` と同じ規約）
- selection 中（`getSelection().toString().length > 0`）はクリックを open に転送しない（テキスト選択操作中の誤発火を避ける）
- SVG 内に `<a>` リンクが含まれる場合（Mermaid `click` directive）：`<a>` クリックは propagation で modal open より優先（リンクが効くべき）。modal open は `<a>` が無い領域のクリックでのみ発火

### k. bridge global 名の統一

ブラウザ側で Mermaid インスタンスを受け取る global 名は **`globalThis.__mdxgMermaid`** で統一する（camelCase / underscore prefix 2 つで「内部使用」を明示）。本ドキュメント / 実装 / テストの全箇所で同じ名前を使い、`__mdxg_mermaid` / `__mdxgMermaid_bridge` のような揺れは作らない。

採用理由：

- `__mdxg` prefix で本実装スコープを明示し、他コードとの global 衝突を構造的に避ける
- `mdxg` 内では `mermaid` のみが当面の bridge 対象で、複数 bridge を suffix で識別する必要がない
- camelCase は本実装の TypeScript / JavaScript identifier 規約と整合（`subscribeSystemTheme` / `getEmbeddedMermaidRuntime` 等）

### l. `dist/standalone.html` への Mermaid 同梱を見送る

| 候補                                                                    | 採用 | 理由                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. CLI 経路（`*-review.html`）のみに `--mermaid` で opt-in 注入**     | ✓    | CLI を通すユースケースは「特定 MD のレビュー固定文脈」で配布者が markdown 内容を制御している（DESIGN.md §3 「--show-open-file」の責務境界と同じ思想）。Mermaid runtime のサイズ影響（+700 KB gzipped）と build / 起動コストを「実際に mermaid ブロックを含む配布」だけに局所化できる。standalone は MDXG §15 [MUST] フォールバック（Shiki ハイライト）で要件充足                                  |
| B. `dist/standalone.html` にも Shiki と同じく Mermaid を default inline | ✗    | standalone は既に Shiki bundled 全言語 inline で ~45 MB raw / ~5.9 MB gzipped と肥大化しており、+2.8 MB raw / +700 KB gzipped を更に積むと `file://` ダブルクリック起動時のパース時間が無視できない（特に Mermaid は internal で dagre / cytoscape をロードする）。standalone を直接開くユースケースで mermaid SVG 描画が強く必要、というユーザー要望はまだ顕在化していないため、コスト先行になる |
| C. `dist/standalone.html` 用に `--with-mermaid` の build オプション追加 | ✗    | build 時の分岐が増え、commit 対象配布物の数も増える（`dist/standalone-with-mermaid.html` のような派生）。CI / リリース管理コストが線形に増えるため、Shiki 全言語化と同じ「default で全部入り」のシンプルな配布契約から外れる                                                                                                                                                                      |

A 案の追加考慮：

- standalone を直接ダブルクリックで開いたユーザーは ` ```mermaid ` ブロックを Shiki ハイライト済みコードブロックとして読む。視覚的にダイアグラム化されないことに気づける導線として、`<pre[data-mermaid="1"]>` に「Mermaid runtime not loaded」相当の hint badge を出す案もあるが、本タスクでは見送り（CLI 経由フローのドキュメント追記で代替）
- 将来 standalone への Mermaid 同梱が必要になった時の追加経路は、`mdxg-shiki-assets` plugin の closeBundle に倣って `mdxg-mermaid-asset` plugin を追加し `<script id="embedded-mermaid">` を standalone build 時に inline する形で開ける（本タスクの bridge 注入規約と同一なので、ブラウザ側ロジックは追加不要）

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
  - `mermaidRuntime` 内に `</script>` 文字列が含まれていれば `<\/script>` に escape されて書き込まれる（build は fail させない）
  - escape 件数が返り値 / 副作用で取得でき、CLI 側で stderr 報告に使える

- `cli/parse-args.ts`（既存テストに追加）：
  - `--mermaid auto` / `on` / `off` が `MermaidMode` として正しくパースされる
  - `--mermaid` が値なしで渡されたとき / 未知の値（`--mermaid yes` 等）でエラー
  - mode 未指定時の既定値が `auto`
- `cli/review-request.ts`（既存テストに追加）：
  - mode × `scanMermaidFences` の組み合わせ（`auto`×0 / `auto`×1 / `on`×0 / `on`×1 / `off`×0 / `off`×1）で「注入する / しない」が期待通り解決される

- `app/mermaid.ts`：
  - `<script id="embedded-mermaid">` が空 / 欠落のとき `getEmbeddedMermaidRuntime()` が null を返す
  - `upgradeMermaidFences` が 2 回呼ばれても `data-mermaid-applied` ガードで二重描画にならない（idempotent）
  - mermaid.render が throw した時に `<pre>` から `hidden` が外れ、`data-mermaid-failed="1"` が付き、SVG が DOM に残らない
  - 同 pass 内で複数ブロックが fail したとき toast が **1 回だけ集約** されて発火する（pass 完了後の発火タイミング）
  - upgrade 後の `<pre>` の textContent が unchanged
  - `resolveThemeVariables()` が DESIGN.md §1 Theming の CSS variables を正しく Mermaid themeVariables 形式に写像する
  - theme トグル経路：全 `<pre[data-mermaid-applied]>` の `data-mermaid-applied` が外れ SVG sibling が remove され、再 upgrade 後に新 themeVariables の SVG が再生成される（idempotent な再描画 contract）

- `app/mermaid-modal.ts`（新規）：
  - 拡大可能 SVG クリックで modal が open し、複製 SVG が body に挿入される（元 SVG は不変）
  - Esc / 背景クリック / Close ボタンで close する
  - selection 中（`getSelection().toString().length > 0`）のクリックでは open しない
  - SVG 内 `<a>` をクリックしたときは modal open より `<a>` 既定挙動が優先される

- `app/shiki.ts`（既存テストに追加）：
  - `pre[data-mermaid="1"]` を upgrade 対象から除外（query selector で `:not([data-mermaid])` が効く）

- `app/code-copy-wrap.ts`（既存テストに追加）：
  - `pre[data-mermaid="1"]` には Copy button が注入されない

- `app/doc-renderer.ts`（既存テストに追加）：
  - mermaid upgrade 後の `blockOriginalHTML` が `<pre>` + sibling SVG の wrap 構造を反映している
  - mermaid upgrade 後に `reapplyAllMarks` を呼んで `<mark class="cmt">` が `<pre>` 内に正しく再貼付される

- `core/markdown.ts`（既存テストに追加）：
  - `code` トークンが `lang?.toLowerCase() === 'mermaid'` のとき Shiki ハイライト経路を skip し `data-mermaid="1"` 属性付きで出力される（`Mermaid` / `MERMAID` のような大文字混入も同じ経路に乗ること）
  - escape 経由で `<pre><code>` の HTML タグが文字エスケープされる

### 手動視覚チェックリスト

`npm run build` 後、CLI 経由で配布 HTML を生成して以下を確認：

- [ ] `node dist/review-request.mjs sample-with-mermaid.md`（auto 既定）で生成した HTML を Chromium で開き、`mermaid` ブロックが SVG として描画される
- [ ] 初回 paint 時には plain `<pre>` が一瞬見え、idle callback 後に SVG に置き換わる
- [ ] OS dark で開いた時に Mermaid SVG の配色が dark テーマ追従（背景 / ノード / 線 / テキストが §1 Theming 配色）
- [ ] theme toggle で `system → light → dark` を循環すると Mermaid SVG が再描画されて配色が追従する
- [ ] mermaid 構文エラーを含むブロックは `<pre>` のまま残り、toast で「Diagram render failed」が出る（複数 fail でも 1 件に集約される）
- [ ] 描画失敗ブロックがあっても他の mermaid ブロックは正常に SVG 化される
- [ ] mermaid ブロック内のテキストを選択 → `+ Comment` → コメント追加 → 再描画後も `<mark class="cmt">` が `<pre>`（hidden）内の同じ位置に出る
- [ ] 描画済み SVG をクリックすると中央にモーダルで拡大表示され、Esc / 背景クリック / Close ボタンで閉じる
- [ ] SVG 上でテキスト選択中はクリックしても modal が open しない
- [ ] `--mermaid off` で実行した HTML を開いた場合、`mermaid` ブロックは Shiki ハイライト済みコードブロック（既存挙動）として表示される
- [ ] `--mermaid auto`（既定）で mermaid ブロック 0 件の markdown を渡した時、配布物に `embedded-mermaid` 注入がなく サイズが既存 `embed-template.html` の ~99 KB gzipped と等しい
- [ ] `--mermaid auto` で mermaid ブロック含み markdown を渡した時、stderr に「Detected N mermaid block(s). Embedding mermaid runtime (+700 KB gzipped).」が出る
- [ ] `--mermaid on` で実行した HTML のサイズが見積もり通り（~800 KB gzipped）
- [ ] §10 Search が mermaid 含み markdown でも動作する（Step 6 案 A / B の決定に応じて挙動が変わる）
- [ ] embedded markdown 同梱 HTML をダブルクリック起動した時に Mermaid 初期化中の FOUC や jank が出ない
- [ ] 印刷プレビューで SVG sibling は出力され、`<pre hidden>` のソースは出力されない

## 7. 受け入れ基準

- MDXG §15 [SHOULD] ` ```mermaid ` ブロックのサポートを満たす（§1 冒頭の対応スコープ表が ✓）
- MDXG §15 [MUST] 描画未サポート時のフォールバック（Shiki ハイライト済みコードブロック）が回帰していない（`--mermaid off` 時 / `auto` で 0 件時 / 構文エラー時）
- MDXG §15 [SHOULD] ホスト色スキーム適応を満たす（light / dark トグルで Mermaid SVG が再描画）
- CLI が生成する `*-review.html`（`embed-template.html` ベース）のサイズが `--mermaid off` / `auto` で 0 件のときに **既存と変動なし**。`dist/standalone.html` のサイズも本タスクでは変動させない（§3.1 設計判断）
- `--mermaid on` / `auto` で 1 件以上のときのサイズ増分が **gzip +800 KB 以内**
- §6 アンカリングが壊れない（既存 in-source test 全通過 + 新規追加分も通過）
- §10 Search との干渉が解決されている（Step 6 で決めた案 A / B が test と手動チェックで動く）
- §1 Theming の dark 連動が Mermaid SVG にも適用される
- SVG クリックでモーダル拡大表示が動作する（Esc / 背景クリック / Close ボタンで閉じる）
- DESIGN.md §12 表に「§15 Diagram Rendering」行が追加され「準拠 / 部分」に塗られる
- DESIGN.md §12「その他の拡張候補」の MDXG §15 項目が削除されている

## 8. 想定リスクと回避策

| リスク                                                                   | 回避策                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mermaid 本体サイズが見積もり (~700 KB gzipped) より大きい                | Step 1 PoC で実測。+1 MB を超える場合は受け入れ基準を見直し、SHOULD 達成より配布物軽量化を優先するなら本タスク自体を保留にする                                                                                               |
| Mermaid `import()` 動的読み込みが `file://` で動かない                   | Mermaid を `<script id="embedded-mermaid" type="module">` で inline 注入し、`globalThis.__mdxgMermaid` 経由で参照する bridge 方式（§5.k）。Step 1 PoC で確認                                                                 |
| `mermaid.render` が long-running でフレーム drop を引き起こす            | idle callback で実行することで初回 paint は守られる。複数ブロックの並列描画を避けるため `for await` で順次処理                                                                                                               |
| 既存 `<mark class="cmt">` が upgrade で消える                            | `<pre>` 自体を残し SVG を sibling で追加することで `<pre>` 内の `<mark>` は壊れない。`blockOriginalHTML` の再構築は wrap 構造の変化に追従させる                                                                              |
| §10 Search が mermaid ブロックで意図しない挙動になる                     | Step 1 PoC で挙動を確認し、Step 6 で案 A（検索対象外）/ B（一時表示）を決定。in-source test に regression ケース追加                                                                                                         |
| Mermaid `securityLevel: 'strict'` でも XSS 経路が残る                    | Mermaid の最新 advisory を Step 1 でレビュー。CSP `default-src 'none'` + `connect-src 'none'` の既存防壁が二重保険として効く（Mermaid から fetch / XHR は走らない）                                                          |
| Mermaid version up で `themeVariables` のキー名が変わる                  | 写像表を `src/app/mermaid.ts` の定数として持ち、Mermaid version を `package.json` で exact pin。version up 時は本ドキュメントの §5.g / §5.h を再評価                                                                         |
| Mermaid 構文エラー時に SVG 描画が部分的に残る                            | parse fail を `try / catch` で受け、SVG 残骸を `remove()` してから `<pre>` を表示状態に戻す。`data-mermaid-failed="1"` で再試行抑止                                                                                          |
| `dist/mermaid.mjs` の commit による repo サイズ増                        | 受け入れる。`dist/shiki-langs/` と同じく「clone 直後に `npm run build` 抜きで CLI が動く」配布契約を保つため。`mermaid` の version pin で頻繁な差分は出ず、~3 MB の追加 commit 容量は許容範囲                                |
| `<pre hidden>` が a11y で見えなくなり、コメント / 検索の対象として不適切 | `<pre hidden>` は aria-hidden 扱いだが、テキストコメント機能で必要なら `hidden` の代わりに `position: absolute; clip: rect(0 0 0 0);` 等の screen reader にも残る非表示方式に切替える余地。Step 6 で SR 動作確認時に最終判断 |
| Mermaid のグローバル副作用（`window.mermaid` への注入）が他コードと衝突  | bridge global は §5.k で定めた `globalThis.__mdxgMermaid` のみを使用。Mermaid 本体が触る `window.mermaid` は本実装側からは参照しない                                                                                         |
| theme トグル時の Mermaid 全再描画でユーザー体験が止まる                  | 再描画も idle callback 経由で順次処理し、UI freeze を避ける。SVG 数が多い文書では再描画完了まで数秒かかる可能性があるが、トグル操作は頻度が低いため許容                                                                      |
| サイレント回帰（mermaid 追加で Shiki / コメント / 検索が壊れる）         | 既知ケースを in-source test + 手動チェックで網羅。CI で fail させる                                                                                                                                                          |

## 9. 参考

- [MDXG §15 Diagram Rendering（日本語訳）](./mdxg/05-extensions.md#15-diagram-renderingダイアグラム描画)
- [Mermaid 公式ドキュメント](https://mermaid.js.org/) — `mermaid.render` / `themeVariables` / `securityLevel`
- [Mermaid Security and Sanitization](https://mermaid.js.org/config/usage.html#securitylevel) — `'strict'` / `'sandbox'` / `'antiscript'` の挙動差
- [DESIGN.md §12 MDXG 準拠ロードマップ・今後の拡張](./DESIGN.md#12-mdxg-準拠ロードマップ今後の拡張)
- [DESIGN.md §1 Theming](./DESIGN.md#1-theming準拠) — CSS variables 経由のテーマ写像
- [DESIGN.md §6 コメントのアンカリング](./DESIGN.md#6-コメントのアンカリング)
- [DESIGN.md §10 Search](./DESIGN.md#10-search準拠)
- [DESIGN.md §11 セキュリティとプライバシー](./DESIGN.md#11-セキュリティとプライバシー)
- [DESIGN.md §13 ビルドパイプライン](./DESIGN.md#13-ビルドパイプライン)
- [docs/mdxg-rendering-code-block.archive.md](./mdxg-rendering-code-block.archive.md) — Shiki upgrade のパターン参考元（C 案 lazy + per-block upgrade、`<script id="embedded-*">` 注入規約）
- [docs/design-example.md](./design-example.md) — 設計ドキュメントテンプレート
