# リファクタリング計画

本ドキュメントは MDXG Redline コードベースに対するリファクタリング候補を優先度順に整理したもの。各項目は「挙動を変えずに保守性・拡張性を上げる」ことを目的とする。新機能追加・バグ修正とは独立して、ファイル分割・責務再配置を中心に進める。

## 目次

1. [背景と方針](#1-背景と方針)
2. [優先度: 高](#2-優先度-高)
3. [優先度: 中](#3-優先度-中)
4. [優先度: 低](#4-優先度-低)
5. [推奨着手順](#5-推奨着手順)
6. [共通の進め方](#6-共通の進め方)

## 1. 背景と方針

総 TypeScript 約 19,000 行のうち、上位 11 ファイルが 500 行超え。`src/cli/parse-args.ts` (1676 行) / `src/core/embed.ts` (1043 行) / `src/app/doc-renderer.ts` (632 行) など、責務が混在し変更時の差分が広がりやすい箇所が複数ある。また `comments-width.ts` / `page-nav-width.ts` のように左右対称な実装の重複も顕在化している。

方針：

- **挙動不変なファイル移動を先**にする。リスクの高い構造変更（state 配線変更・hook 追加など）は後ろに回す
- **public API（CLI 引数仕様 / `feedback.json` スキーマ / DOM 構造）は変えない**。変える必要が出た場合は別 PR として切り出す
- **DESIGN.md と乖離する変更を入れる場合は同時に DESIGN.md を更新**する（特に H6 / H2 周辺）
- in-source test (`if (import.meta.vitest)`) は実装ファイルに隣接させる原則を保つ。ファイル分割時はテストも一緒に移す

## 2. 優先度: 高

### H1. CLI runtime injection を `review-request.ts` から分離

**対象**: `src/cli/review-request.ts:252` / `:350` / `:383`

**現状**: エントリ専用に薄く保つコメントがあるが、実際は Shiki grammar 読み込み・Mermaid 判定・KaTeX asset 読み込み・stderr report・HTML compose も持つ。

**分割案**:

- `src/cli/assets/shiki.ts`
- `src/cli/assets/mermaid.ts`
- `src/cli/assets/katex.ts`
- `src/cli/compose-review-html.ts`

**効果**: asset ごとの未生成エラー / stderr report を局所化、`composeReviewHtml` の直列 pipeline が読みやすくなる。Mermaid / KaTeX の将来更新時に CLI エントリを触らずに済む。

**リスク**: 低。ファイル移動中心で外部挙動は変わらない。

### H2. `embed.ts` の HTML rewrite 責務を分割

**対象**: `src/core/embed.ts:253` / `:318` / `:439`

**現状**: docHash・ファイル名・JSON script encoding・HTML 属性 upsert・Shiki/Mermaid/KaTeX 注入・初期 status/title rewrite・in-source test が同居。変更理由が異なる処理が 1 ファイルに集まっており、機能追加時の差分が広がりやすい。

**分割案**:

- `src/core/embed/hash.ts`: `computeDocHash`
- `src/core/embed/names.ts`: `stripMarkdownExt` / `deriveReviewHtmlName` / `deriveFeedbackJsonName`
- `src/core/embed/script-encoding.ts`: `encodeEmbeddedMarkdown` / `encodeEmbeddedShikiLangs`
- `src/core/embed/html-rewrite.ts`: 汎用 script/style/title/html attr rewrite
- `src/core/embed/runtime-assets.ts`: Mermaid / KaTeX runtime 注入

**効果**: CLI 側の asset 注入変更とブラウザ側 docHash/filename 変更を分離できる。`</script>` / `</style>` escape のテスト範囲を狭くできる。今後 runtime asset が増えても embed.ts が肥大化しにくい。

**リスク**: 低（同時に [L2](#l2-embedts-の-regex-一元化) も実施可）。

### H3. `doc-renderer.ts` をレンダリング段階ごとに分離

**対象**: `src/app/doc-renderer.ts:385` / `:541` / `:547`

**現状**: markdown 全文 parse / virtual page section mount / footnotes section 配置 / block anchor / original HTML cache / copy button 注入 / Shiki post-paint upgrade / Mermaid / KaTeX upgrade scheduling を一括で持つ。

**分割案**:

- `src/app/doc-mount.ts`: section 作成、block 配賦、footnotes 配置
- `src/app/block-cache.ts`: `cacheBlocksAndBuildAnchors` / `refreshBlockOriginalHTML`
- `src/app/shiki-upgrade.ts`: Shiki upgrade 関連
- `src/app/doc-renderer.ts`: 上記を呼ぶ orchestration のみ

**効果**: footnote / page split / Shiki の変更が同じファイルに集中しなくなる。DOM anchoring の不変条件をテストしやすくなる。post-paint upgrade 追加時の影響範囲が小さくなる。

**リスク**: 中。DOM 経路の回帰テスト必須（happy-dom テストと手動 smoke）。

### H4. 左右パネル幅モジュールの共通化

**対象**: `src/app/comments-width.ts` + `src/app/page-nav-width.ts`

**現状**: 値域（280–640 vs 180–480）・storage key・default 値（360 vs 220）だけが異なり、95% が同一の `parseXxxHint()` / `resolveEffectiveXxxState()` / `clampXxxWidth()` などを 2 ファイルで重複している。DESIGN.md §7c では「並列保持」とされる。

**分割案**: Generics を活用した単一ファイル `src/app/sidebar-width.ts<"comments" | "nav">` に統合。setter / getter の型安全性を保ったまま約 200 行削減。storage key や値域は const オブジェクトで外部化。

**効果**: 並列して保守する負担がなくなる。`localStorage` キーや CLI ヒント仕様の追加が 1 箇所で済む。

**リスク**: 低。`comments-resize.ts` / `page-nav-resize.ts` の import パスのみ変更、動作不変。

### H5. `parse-args.ts` を「仕様テーブル + generic parser」に寄せる

**対象**: `src/cli/parse-args.ts:439` / `:780` / `:877`

**現状**: lint 制約に合わせて状態機械が細かく分割されているが、`pendingX` / `consumeXValue` / `attachXOptionals` が増殖。新しい CLI option を追加すると同種の変更を複数箇所に入れる必要がある。

**分割案**:

- `src/cli/arg-spec.ts`: flag 名、value parser、target field、repeatability を宣言
- `src/cli/parse-clean-args.ts`: cleanup mode 専用
- `src/cli/parse-run-args.ts`: run mode 専用
- `src/cli/help-text.ts`: `HELP_TEXT`

**効果**: option 追加時の編集箇所を減らせる。`pending*` の人手同期ミスを減らせる。help text と parser の乖離も検出しやすくなる。

**リスク**: 中。既存テストが多い。安全に進めるなら「外部挙動を一切変えずファイル分割」→「spec table 化」の 2 段階で行う。

### H6. `escapeStyleTagInCss` の重複排除（**却下**: build chain 制約で集約不可）

**対象**: `src/core/embed.ts` + `src/build/inline-markdown-css.ts` + `vite.config.ts` の `inlineCssBlock`

**当初の現状認識**: DESIGN.md §11.a は「3 箇所に独立に存在、build chain 依存ゼロ要件のため重複許容」と記述しているが、共通モジュール化しても build chain 依存は増えないように見えた（`src/build/` 配下に切り出せばよい）。

**当初の分割案**: `src/build/css-escape.ts` を新規作成し 3 箇所が参照。

**実機検証で判明した却下理由**:

実際に `src/build/css-escape.ts` を作って `inline-markdown-css.ts` から import する形を試した結果、`vite.config.ts` のロード時に以下のエラーで失敗する：

```
Failed to load configuration file. /workspaces/mdxg-redline/vite.config.ts
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  '/workspaces/mdxg-redline/src/build/css-escape'
  imported from /workspaces/mdxg-redline/src/build/inline-markdown-css.ts
```

`vite.config.ts` は vite-plus の loader で TypeScript として直接 Node に load され、Node ESM の解決規則で拡張子なしの相対 import を解決できない（`inline-markdown-css.ts` 冒頭のコメントが既にこれを記述）。`escape.ts` のような既存依存と同じ制約が `css-escape.ts` にも適用される。

つまり DESIGN.md §11.a の「3 経路の依存ゼロ要件」は正しい認識で、本実装で集約は構造的に不可能。3 箇所の重複は build chain 制約に由来する必要悪として維持する。

**結論**: 当初優先度「高」だったが、検証結果に基づき却下。DESIGN.md §11.a の記述はそのまま維持する。

## 3. 優先度: 中

### M1. `review.ts` からキーボード操作と起動 wiring を切り出す

**対象**: `src/app/review.ts:93` / `:366`

**現状**: orchestrator として妥当だが、WASD キーマップ・modal/menu escape・hash navigation・footnote hash・toolbar/search/help wiring まで持っている。UI 入力が増えるほど中心ファイルが重くなる。

**分割案**:

- `src/app/keyboard-shortcuts.ts`: pane focus / WASD / escape / cmd-enter
- `src/app/navigation-controller.ts`: `navigateToTarget` / hashchange / footnote hash
- `src/app/app-wiring.ts`: 起動時の event listener 登録

**効果**: navigation の回帰テストを DOM 起動全体から切り離せる。キーボード操作の変更が load/render 経路に混ざらない。`review.ts` を「public API + boot」に近づけられる。

**リスク**: 中。WASD / hashchange 経路のリグレッション要監視。

### M2. `selection.ts` の skip ルールを共有モジュール化

**対象**: `src/app/selection.ts:57` / `:115` + `src/app/search.ts:148`

**現状**: 検索は selection.ts の `textSegments` を再利用していて設計は良い。ただし skip 対象が Mermaid / math / footnote / copy button などに拡張されており、選択・検索・mark 再適用の共通 invariant になっている。

**分割案**:

- `src/app/text-segments.ts`: `textSegments` / `textRangeFromOffsets`
- `src/app/text-segment-skip-rules.ts`: skip class / attr / selector
- `src/app/selection.ts`: browser selection から `PendingSelection` を作る処理に集中

**効果**: 検索・コメント・mark の共通テキストモデルが明確になる。Mermaid / KaTeX / footnote の追加制約を selection UI から切り離せる。

**リスク**: 中。`textSegments` は §6 アンカリング不変条件の中核。差し替え前後でテキスト平坦化結果が完全一致することを確認する必要がある。

### M3. `comments-resize` / `page-nav-resize` の handler 共通化

**対象**: `src/app/comments-resize.ts` + `src/app/page-nav-resize.ts`

**現状**: pointer 計算（`innerWidth - clientX` vs `clientX`）と handle ID の差分を除き、`startDrag()` / `onPointerMove()` / `onPointerUp()` がほぼ同一。計算式が 2 箇所にあるとバグ修正時に片方を見落とす。

**分割案**: `generic-sidebar-resize-handler<T extends "comments" | "nav">()` factory で logic 統一。pointer 計算と要素セレクタのみを closure で差分化。

**効果**: H4 と同時施行で相乗効果。約 150 行削減。

**リスク**: 中。event 配線テスト必須。

### M4. `review.ts` の upgrade hook を統一

**対象**: `src/app/review.ts:220-226`

**現状**: `renderAll()` が `renderDoc()` / `renderPageNavigation()` / `renderComments()` / `setupScrollSpy()` / `setupPageScrollSpy()` を一括呼び出し。Shiki upgrade / mark 再貼付 / search reapply が `renderAll()` → `reapplyAllMarks()` の経路に統合されており、`setOnMarksReapplied` hook で search を register する設計は完成しているが、新しい upgrade 経路追加時の入り口が不明確。

**分割案**: `setupUpgradeHook(phase: "shiki" | "katex" | "mermaid", callback)` で統一。

**効果**: 将来の upgrade phase 追加時の同期漏れを構造的に防げる。

**リスク**: 中。

## 4. 優先度: 低

### L1. `markdown.ts` の renderer closure 分割

**対象**: `src/core/markdown.ts:154-282`

**現状**: `createCodeRenderer()` / `createRenderer()` が多重 closure + 長い関数。code highlight / math segment / heading slug 生成のいずれも renderer 内で分岐。中核 logic は pure（副作用なし）だが、nested scope が深く引数追跡が煩雑。

**分割案**: renderer 生成ロジックを `src/core/markdown-renderer.ts` に抽出し、各 render 担当タイプ（code / text / heading）を責務ごとに関数化。inline test density は維持。

**効果**: 可読性向上。

**リスク**: 中。回帰テスト必須。

### L2. `embed.ts` の regex 一元化

**対象**: `src/core/embed.ts:71-126`

**現状**: `EMBEDDED_MD_RE` / `EMBEDDED_SHIKI_LANGS_RE` / `EMBEDDED_MERMAID_RE` / `EMBEDDED_MD_META_RE` が同じ目的（template の `<script>` / `<meta>` タグを検出）だが個別定義。各 regex の lookahead comment が冗長。

**分割案**: `const EmbeddedScriptPattern = { md, shikiLangs, mermaid, meta }` object でグループ化し注釈を共通化。

**効果**: 可読性向上。

**リスク**: 低。H2 と同時に実施するのが効率的。

## 5. 推奨着手順

挙動不変なファイル移動を先にし、構造変更（hook 設計・抽象化）は後ろに回す原則で並べる：

1. **H1（CLI asset 分離）** — エントリ薄化、PR が読みやすく回帰リスクが小さい
2. **H2（embed.ts 分割）** + **L2（regex 一元化）** を同時 — core 層の整理
3. **H3（doc-renderer 分割）** — DOM 周りのテスト体制を整えてから
4. **H4 + M3 同時** — 左右パネル統合の相乗効果
5. **H5（parse-args）** — 「分割のみ」→「spec table 化」の 2 段階で
6. **M1, M2, M4** — app 層の整理。上記で安定した hook 設計の上で
7. **L1** — pure logic だが回帰リスクがあるため最後
8. **H6** — いつでも実施可（DESIGN.md §11.a 更新もセット）

## 6. 共通の進め方

- 各候補は **1 PR = 1 候補** を原則とする。H1〜H6 / M1〜M4 / L1〜L2 でそれぞれ独立した PR
- 同時実施を推奨している組（H2+L2 / H4+M3）は同一 PR で OK
- 「ファイル分割のみ」と「責務再配置を含む構造変更」を含む候補（H5 / M2 など）は 2 PR に分け、前半は挙動不変であることを diff で確認できる形にする
- in-source test は実装と同じ移動先に追従させる
- DESIGN.md と乖離する変更（H6、H2 で embed.ts 周りの記述が古くなる場合など）は **DESIGN.md 更新を同 PR に含める**
- ビルド成果物（`dist/`）への影響は smoke check（`npm run build` 後の `dist/standalone.html` / `dist/embed-template.html` の `<script id="embedded-md">` / `<script id="embedded-shiki-langs">` 存在確認、DESIGN.md §13「CI スモークテスト指針」参照）で確認する
