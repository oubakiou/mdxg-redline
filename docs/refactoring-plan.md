# リファクタリング計画

本ドキュメントは MDXG Redline コードベースに対するリファクタリング候補を優先度順に整理する。各項目は「挙動を変えずに保守性・拡張性を上げる」ことを目的とする。新機能追加・バグ修正とは独立して、ファイル分割・責務再配置を中心に進める。

## 目次

1. [背景と方針](#1-背景と方針)
2. [優先度: 高](#2-優先度-高)
3. [優先度: 中](#3-優先度-中)
4. [優先度: 低](#4-優先度-低)
5. [推奨着手順](#5-推奨着手順)
6. [共通の進め方](#6-共通の進め方)

## 1. 背景と方針

直近 H/M/L シリーズ（コミット `69fa276` 時点で全完了、計画書削除済み）で「巨大ファイルの責務分割」「primitive 集約」「pure / impure 分離」が一巡した。本シリーズは次の段階として、

- **左右対称な重複ロジック**（キーボード巡回 / static modal / renderer upgrade の selection guard）の共通化
- **暗黙の状態・protocol の明示化**（hash 形式、modal state、skip rule、CLI flag validator）
- **更なる責務分割**（page-navigation.ts 631 行、parse-run-args.ts 628 行、html-rewrite.ts 504 行 等）

を主眼に置く。

過去シリーズの完了項目を参照する場合は `過去 M1 (<commit id 短縮>)` のように接頭辞 + 該当コミット ID を付け、世代を一意に特定できるようにする。新規候補を起票する際は `git log --grep refactor --since=2026-05-01` で直近の完了項目を確認し、二重起票を避ける。

方針：

- **挙動不変なファイル移動を先**にする。リスクの高い構造変更（state 配線変更・hook 追加など）は後ろに回す
- **public API（CLI 引数仕様 / `feedback.json` スキーマ / DOM 構造）は変えない**。変える必要が出た場合は別 PR として切り出す
- **DESIGN.md と乖離する変更を入れる場合は同時に DESIGN.md を更新**する
- in-source test (`if (import.meta.vitest)`) は実装ファイルに隣接させる原則を保つ。ファイル分割時はテストも一緒に移す

## 2. 優先度: 高

### H1. (完了済み) 矢印キー巡回ロジックの共通化（focus-list helper 抽出）

**状態**: **完了済み** — `src/app/dom/focus-list.ts` に `resolveNextFocusIndex` を昇格し、`page-navigation.ts` / `comments.ts` 両方から import で利用。comments 側の独自 `resolveNextCardIndex` を撤去し、`up from no-focus` のフォールバック先を「先頭 → 末尾」に統一 (TOC 仕様に合わせる挙動変更を含む)。pure helper の in-source test は `focus-list.ts` 側に集約済み。

**対象**:

- `src/app/navigation/page-navigation.ts` の `resolveNextFocusIndex` (lines 241–272) — 既に pure helper 化済み
- `src/app/comments/comments.ts:179` 付近（comments pane の同等ロジックが重複）

**現状**: TOC 側は既に `resolveNextFocusIndex` という pure helper として切り出し済み (`page-navigation.ts:254`)。一方 comments 側は `resolveNextCardIndex` (`comments.ts:195`) 相当のロジックが重複しており、`currentIndex < 0`（focus 候補なし）時の fallback 挙動が **両者で実際に異なる**:

| direction | TOC (`resolveNextFocusIndex`) | comments (`resolveNextCardIndex`) |
| --------- | ----------------------------- | --------------------------------- |
| `down`    | `0` (先頭)                    | `0` (先頭、`-1 + 1` 経由)         |
| `up`      | `count - 1` (**末尾**)        | `0` (**先頭**、clamp 経由)        |
| `home`    | `0`                           | `0`                               |
| `end`     | `count - 1`                   | `count - 1`                       |

つまり統合は **挙動不変ではなく仕様統一による挙動変更を含む**。

**分割案**:

- 統一後の fallback 仕様は **TOC 側の挙動を採用**: `currentIndex < 0` で `down` なら `0` / `up` なら `count - 1` とする。理由は (a) 「focus が無い状態から ↑ を押したら末尾へ」が long list で起点を選びやすい (b) 既に JSDoc で明文化されている (c) TOC は通常 comments より項目数が多く、fallback ナビゲーションの恩恵が大きい
- `src/app/dom/focus-list.ts` に既存の `resolveNextFocusIndex` を昇格（page-navigation.ts は import に書き換え）
- comments 側の `resolveNextCardIndex` を同 helper の呼び出しに置換（**この時点で `up from no-focus` の挙動が「先頭 → 末尾」に変わる**）
- TOC は `HTMLAnchorElement[]`、comments は `HTMLElement[]` を渡せるよう型は `readonly HTMLElement[]` で受ける
- comments 側の in-source test に **新仕様の期待値** (`up from no-focus → count - 1`) を追加し、旧仕様の test (`up from no-focus → 0`) は新仕様に書き換える

**効果**: キーボード操作の仕様が 1 箇所に集約され、今後 pane が増えても挙動 drift が出にくくなる。comments.ts の見通しが改善する。「focus が無い状態で ↑」の挙動が pane 間で揃う。

**リスク**: 低〜中 — pure helper 自体は等価だが、comments の挙動が 1 ケースで変わる（`up from no-focus`）。レビュー時に「これは意図的な仕様統一」であることを明示し、リリースノートにも記載する。

### H2. (完了済み) Shiki upgrade を既存 upgrade 共通レイヤーへ寄せる

**状態**: **完了済み** — `upgrade-utils.ts` に `scheduleAfterPaint` (rAF × 2) と高階 combinator `scheduleWithSelectionGuard(scheduler, task)` を追加。`scheduleUpgradeOnIdle` は `scheduleWithSelectionGuard(scheduleIdle, run)` の thin wrapper に再構成。Shiki は独自 `hasActiveSelection` / `onSelectionEnd` を撤去し `scheduleWithSelectionGuard(scheduleAfterPaint, ...)` 経由に統一。Shiki / Mermaid / KaTeX で selection guard ロジックが 1 箇所に集約された。挙動は完全不変。

**対象**:

- `src/app/renderers/shiki-upgrade.ts:104` 付近（`hasActiveSelection` / `onSelectionEnd` を独自実装）
- `src/app/renderers/upgrade-utils.ts:28` 付近（Mermaid / KaTeX が利用する共通 helper）
- `src/app/renderers/upgrade-orchestrator.ts:63` 付近（idle scheduling / 失敗 toast / block cache refresh の集約）

**現状**: Mermaid / KaTeX は過去 M1 (`f406601`) と過去 M3 (`f8b75d7`) で upgrade-utils / upgrade-orchestrator に 「選択中 defer」「idle scheduling」「失敗 toast」「block cache refresh」を集約済みだが、Shiki だけ `hasActiveSelection` / `onSelectionEnd` の selection guard を独自実装している。

**分割案**:

- まず `upgrade-utils.ts` に `scheduleAfterPaintWithSelectionGuard(callback)` のような小さい primitive を追加（Shiki が要求する `requestAnimationFrame × 2` セマンティクスを保持）
- その上で Shiki / Mermaid / KaTeX の upgrade entry を共通形に揃える
- Mermaid / KaTeX は `requestIdleCallback`、Shiki は `requestAnimationFrame × 2` と paint タイミングが異なるため、`scheduleUpgradeOnIdle` への単純置換ではなく **scheduler を引数化** して保持する

**効果**: renderer upgrade の横断パターンが統一され、selection 中の defer 挙動の drift を防げる。Shiki / Mermaid / KaTeX の upgrade entry が同形になり読みやすくなる。

**リスク**: 中 — paint タイミングを変えると視覚的 regression（コードハイライト前後でのちらつき）が起きうるため、smoke check で確認する。

### H3. (完了済み) 静的 modal の共通 primitive 化

**状態**: **完了済み** — `src/app/dom/static-modal.ts` に `createStaticModalController({ backdropId, closeButtonId, onAfterOpen?, onAfterClose? })` を新設。help-modal.ts は toolbar button aria-pressed sync を `onAfterOpen` / `onAfterClose` に逃がし、mermaid-modal.ts は drag state reset + body clear を `onAfterClose` に逃がして controller 経由に統一。findBackdrop / lastTrigger capture & restore / open class toggle / close button focus / backdrop click が 1 箇所に集約された。挙動は完全不変。

**対象**:

- `src/app/chrome/help-modal.ts:13` 付近
- `src/app/renderers/mermaid-modal.ts:15` 付近

**現状**: `findBackdrop` 取得、open / closed class toggle、trigger element capture、close button wiring、backdrop click による close、focus restore が両 modal でコピペ重複している。

**分割案**:

- `src/app/dom/static-modal.ts` に `createStaticModalController({ backdrop, content, closeButton, onAfterOpen?, onAfterClose? })` を新設（hook 名は **`onAfterOpen` / `onAfterClose` の 2 種類で統一**。`onBefore*` は今回は提供しない）
- Help modal: toolbar button の `aria-pressed` sync を `onAfterOpen` (true 設定) / `onAfterClose` (false 設定) で扱う。aria 状態は visual な open/close 完了後に screen reader に通知されるべきなので after フックが正しい
- Mermaid modal: close 時の body clear / dragging reset / pan-zoom state 破棄を `onAfterClose` で扱う

**効果**: focus restore と backdrop click の実装差分を構造的に防げる。Mermaid modal は pan / zoom 本体に集中でき、Help modal は表示状態と toolbar button sync だけに集中できる。

**リスク**: 低〜中 — hook 設計の抽象漏れ（例: Mermaid modal 固有の wheel イベント解除タイミング）が起きると逆に複雑化するため、最初に hook を `onAfterOpen` / `onAfterClose` の 2 種類のみに絞り、必要が出てから `onBefore*` を追加する方針とする。

## 3. 優先度: 中

### M1. (完了済み) page-navigation.ts の render / event / focus 分割

**状態 (M1a)**: **完了済み** — page-navigation.ts (557 行) を `page-navigation-render.ts` (render + ViewModel + in-source test、約 360 行) と `page-navigation-keyboard.ts` (keyboard focus + `focusNavigatedLink`、約 135 行) に抽出。元 `page-navigation.ts` は facade として click delegate + `wirePageNavigation` + `findClickedSlug` のみ残し、外部 API (`renderPageNavigation` / `focusNavigatedLink` / `wirePageNavigation`) は re-export で維持。挙動は完全不変。

**状態 (M1b)**: **完了済み** — `app-wiring.ts` / `keyboard-shortcuts.ts` / `navigation-orchestrator.ts` の import を `page-navigation-render` / `page-navigation-keyboard` 直接参照に切り替え、`page-navigation.ts` から `renderPageNavigation` / `focusNavigatedLink` の re-export を撤去。本ファイルは `wirePageNavigation` のみを公開する click delegation + wiring entry に縮小。挙動完全不変。

**対象**: `src/app/navigation/page-navigation.ts` (631 行) — 28 行目以降の render 群と 206 行目以降の event handler 群

**現状**: 1 ファイル内に「TOC / outline / sequential HTML render」「click delegate」「keyboard focus management」の 3 責務が同居し、変更時の認知負荷が高い。挙動・テスト自体は安定している。

**分割案**:

- `src/app/navigation/page-navigation-render.ts`: render 系（ViewModel 変換 + HTML 文字列生成）
- `src/app/navigation/page-navigation-keyboard.ts`: キーボード focus management（H1 完了後はその focus-list helper を import して使う）
- `src/app/navigation/page-navigation.ts`: public wiring の facade に縮小（click delegate + 初期化）
- 段階分割: M1a = ファイル抽出のみ（挙動不変）、M1b = facade 再配線・export 整理

**効果**: 各ファイルが 200 行台に収まり、render 仕様変更時に keyboard 部の差分を読まずに済む。H1 の focus-list を組み込む下地になる。

**リスク**: 中 — public export を維持しないとビルドが壊れる。M1a の diff を一次 review で確認する。**着手順は H1 完了後**を推奨（共通 focus-list を先に用意した方が分割が自然になる）。

### M2. (完了済み) page-navigation の ViewModel 二段分離

**状態**: **完了済み** — `toPageItemViewModel` を `toPageItemView` (pure data: `{ isActive, depth, slug, title }`) と `toPageItemPresentational` (CSS 装飾: `{ ariaCurrentAttr, depthClass, itemClass, slug, title }`) の 2 段パイプラインに再構成。`toPageItemView` を export し pure data 層の in-source test を追加。挙動は完全不変。

**対象**: `src/app/navigation/page-navigation.ts` の `toPageItemViewModel` / `toSequentialControlsViewModel`

**現状**: ViewModel 変換と CSS class 文字列生成が密結合。ViewModel 型が「active 判定後の CSS class」までを含むため、純粋なデータ構造として再利用しづらい。

**分割案**:

- `type PageItemView = { isActive, depth, slug, title }`（pure data）
- `type PageItemPresentational = { itemClass, depthClass, ariaCurrentAttr, ... }`（CSS 装飾）
- `toPageItemViewModel` → `(view) → presentational` の 2 段パイプライン

**効果**: render 層と presentation 層の境界が明確になり、テストも pure data 層に集約できる。

**リスク**: 低 — internal helper のみ、外部 API 不変。M1 完了後に着手すると影響範囲が局所化する。

### M3. (完了済み) math scanner の protocol 化

**状態**: **完了済み** — `Scanner` 型 (`(text, start) => MatchStep | null`) と `buildSegment(args)` (slice + closeEnd + MathSegment ラップ集約) を導入し、旧 `matchDisplay` / `matchInline` を `displayScanner` / `inlineScanner` として Scanner protocol に揃える。`SCANNERS: readonly Scanner[] = [displayScanner, inlineScanner]` を順 iterate する driver で `stepAt` を書き直し、優先順位 (display → inline) は配列順序で表現。境界条件・失敗時 cursor 前進量・slice 範囲はすべて旧実装と論理一致。挙動完全不変。新記法を追加する際は Scanner を 1 つ書き SCANNERS に並べるだけで scanMath / countMath 両経路に伝搬する下地が整った。

**対象**: `src/core/math.ts` (491 行) — `scanMath` / `countMath` / `findInlineEnd` / `findDisplayEnd`

**現状**: inline / display の判定が個別関数に分散し、`scanMath`（plain text 走査）と `countMath`（marked.lexer 走査）が 2 経路で存在する。境界条件（`isEscapedDollar` / `isInvalidInlineOpening` / `isWhitespaceBefore`）は共有されているが、scanner 本体は重複している。

**分割案**:

- `type Scanner = (text: string, from: number) => MathSegment | null`
- `scanners = [displayScanner, inlineScanner]` を順に iterate する共通 driver を 1 つに集約
- marked 走査側も同じ scanner を再利用

**効果**: 数式記法を拡張する際の追加コストが下がる（scanner 追加で済む）。約 60 行削減。

**リスク**: 中 — 境界条件の優先順位（display > inline）を間違えると既存テストが破綻するため、in-source test を厚めに先行整備する。

### M4. (完了済み) hash protocol の tagged union 化

**状態**: **完了済み** — `PageHash` tagged union (`{ kind: 'page', pageSlug }` | `{ kind: 'pageHeading', pageSlug, headingSlug }`) を導入し、`parseHash(hash): PageHash | null` / `buildHash(target): string` の対称 API に置換。旧 `parseHashSlug` / `ParsedHash` interface (両 nullable 構造体) は撤去。`resolveInitialActivePageIndex` / `resolveTargetFromHash` は `parseHash` 経由で `null` を invalid case として早期 return し、heading の有無は `kind` 判別で扱う。`syncHashFromActivePage` は `buildHash` 経由に統一 (`buildHashString` を撤去し、ローカル `buildPageHash` helper で PageHash を組み立て)。`buildPageHashFragment` は `href` 用 fragment 形式 (prefix 無し) を要求する render / keyboard caller 向けに維持。in-source test は `parseHash` / `buildHash` 用に書き換え。挙動完全不変。

**対象**: `src/app/document/pages.ts` (431 行) — `buildPageHashFragment` / `parseHashSlug` / `slugFromHash` および `src/app/navigation/hash-navigation.ts`

**現状**: `page` 形式と `page__heading` composite 形式が文字列ベースで散在。`__` separator の意味が render 側（outline と page の区分）と hash parse 側（page と heading の合成）で異なる文脈に見える。

**分割案**:

- 現状の `parseHashSlug` は既に `ParsedHash` 構造体を返すが、`{pageSlug, headingSlug}` の両 nullable で「page のみ」「page + heading」「invalid」を区別している
- `type PageHash = { kind: 'page', slug } | { kind: 'page_heading', pageSlug, headingSlug }` の tagged union に置き換え
- `parseHash(hash: string): PageHash | null` / `buildHash(target: PageHash): string` の対称 API
- 呼び出し側（navigation-orchestrator / page-navigation render）は union を `switch` で exhaustive に扱う

**効果**: `switch` の exhaustiveness で枝の取りこぼしを compile-time に検出できる。将来 hash 形式を拡張（例: line anchor / block anchor）する際に union に枝を追加するだけで済み、null チェックの組み合わせ爆発を避けられる。

**リスク**: 低 — 既存テストの期待値を構造比較に書き換えれば挙動同値を担保できる。`ParsedHash` 既存使用箇所の `switch` 化が主作業。

### M5. (完了済み) parse-run-args の attach 関数 generic 化

**状態**: **完了済み** — `attachIfPresent<Target, Key>(result, key, value)` generic helper (null / undefined を `typeof === 'undefined'` で一括弾く) を 1 つ導入し、partition 側 3 関数 (`attachPartitionStringOptionals` / `ExtensionOptionals` / `NumberOptionals`) と run 側 3 関数 (`attachRunStringOptionals` / `NonStringOptionals` / `ExtensionOptionals`) を各 1 つの `attachPartitionOptionals` (9 attach) と `attachRunOptionals` (10 attach、`outputDir` は `parts.positional[1]` 経由) に集約。max-statements を満たし、新規 flag 追加時の boilerplate が 1 行に圧縮された。挙動完全不変。

**対象**: `src/cli/parse-run-args.ts` (628 行) — `attachRunStringOptionals` / `attachRunNonStringOptionals` / `attachRunExtensionOptionals` および `partitionArgs` 内の `attachPartition*` 3 関数

**現状**: 6 個の attach 関数が「条件チェック + フィールド代入」を同形に繰り返す。

**分割案**:

- `attachIfDefined<K extends keyof T, V>(result: T, key: K, value: V | undefined): void` の generic helper を 1 つ
- attach 側は field name と value getter の record を渡して reduce で処理
- 過去 H1b (`67c0fc3`) の `FlagDef[]` 統合と整合させる

**効果**: 約 30 行削減。max-statements 圧力を軽減し、新規 flag 追加時の boilerplate が減る。

**リスク**: 低 — internal のみ、CLI 引数仕様（public）は不変。

### M6. (完了済み) HTML rewrite の generic helper 化

**状態**: **完了済み** — `replaceMatchedHtmlRegion(html, regex, buildBody): string | null` private helper を新設し、3 グループ regex (opening / body / closing) を前提とする region 置換ロジックを集約。`rewriteInitialStatus` / `rewriteTitle` / `rewriteEmbeddedShikiLangs` を helper 経由に書き換え (不一致時の throw / no-op は caller 側で `?? reviewHtml` / `if null throw` の形で分岐)。`rewriteReviewHtml` は opening tag 内属性 (`data-name`) も書き換えるため plan 通り据え置き。挙動完全不変、in-source test (Error メッセージ pattern / no-op / 不破壊) すべて維持。

**対象**:

- `src/core/embed/html-rewrite.ts:38` 付近（`rewriteInitialStatus`）
- `src/core/embed/html-rewrite.ts:127` 付近（`rewriteEmbeddedShikiLangs`）
- `src/core/embed/html-rewrite.ts:160` 付近（`rewriteReviewHtml` / `rewriteTitle`）

**現状**: いずれも「regex match → opening / body / closing で置換 → slice 結合」が同型。新しい embedded block を追加するたびに同形コードを書く必要がある。

**分割案**:

- `replaceMatchedHtmlRegion(html, regex, replaceBody: (body) => string): string` の helper を抽出
- 過去 M5 (`e8bd1d3`) の属性 upsert primitive と並列で扱う
- ただし `rewriteReviewHtml` は opening tag 内の属性も書き換えるため、helper 化の対象から **除外** する（汎用化しすぎると逆に読みづらい）

**効果**: 新規 embedded block 追加時の事故減少。idempotent テストの構造を揃えやすい。

**リスク**: 中 — HTML minify 無効を前提とした正規表現に依存している。抽象化対象を `rewriteInitialStatus` / `rewriteEmbeddedShikiLangs` に限定し、`rewriteReviewHtml` は据え置く。

### M7. footnotes の Marked instance キャッシュと token pipeline 統一

**対象**: `src/core/footnotes.ts` (488 行) — `collectFootnoteTokens` 等

**現状**: footnote 処理ごとに Marked instance を都度生成しており、lexer → parse が重複呼び出しされている。orphan 検出と manual append の post-processing が footnote 専用に閉じており、類似パターンが block-anchors / synthetic-pages にも点在する。

**分割案**:

- footnote 用 Marked instance を module-level cache（singleton）化
- `(tokens, renderer) → void` の generic transformer を pipeline として抽出
- orphan detection は pure 関数 `(tokens) => Orphans` として分離

**効果**: Marked instance 生成コスト削減、循環参照リスク低減、約 40 行削減。

**リスク**: 中 — Marked singleton 共有による副作用（plugin 重複登録など）が発生しないかテストが必要。

### M8. module mutable hook の API 統一

**状態 (第 1 段)**: **完了済み** — `setOnMarksReapplied` legacy 経路を撤去。`app-wiring.ts:108` を `registerPostMarksReapplied(reapplySearchHighlights)` に置換 (unsubscribe handle は teardown 経路が無いため破棄)。`mark-engine.ts` から `legacyOnMarksReapplied` slot と `setOnMarksReapplied` export を削除し、JSDoc から legacy 互換 invariant 警告を撤去。in-source test は新 API 用に書き直し (旧 slot 固有 invariant の 2 ケース削除、describe 名と afterEach を整理)。`search-controller.ts` / `search.ts` のコメント、`DESIGN.md §10` の API 名も追従更新。第 2 段 (`configureXxx` の register 化) は別 PR。

**対象**:

- `src/app/comments/mark-engine.ts:118` 付近（`setOnMarksReapplied` legacy 経路、`registerPostMarksReapplied` は既存）
- `src/app/navigation/page-scroll-spy.ts:181` 付近（`configureXxx` 形式）
- `src/app/search/search-controller.ts:196` 付近（`configureXxx` 形式）
- `src/app/comments/comments.ts:15` 付近
- `src/app/app-wiring.ts:108` 付近（`setOnMarksReapplied(reapplySearchHighlights)` 呼び出し）

**現状**: `mark-engine.ts` では既に `registerPostMarksReapplied` が並立済みで `setOnMarksReapplied` は legacy 扱いになっているが、`app-wiring.ts:108` の呼び出し側は legacy 経路を使い続けている。一方で `page-scroll-spy.ts` / `search-controller.ts` / `comments.ts` は `configureXxx` 形式で書かれており、register / unsubscribe protocol になっていない。API 形状が 3 種類（`setXxx` / `registerXxx` / `configureXxx`）に揺れている。

**分割案**:

- **第 1 段（legacy 経路撤去、単発 PR）**: 以下 4 つを 1 PR で実施
  1. **呼び出し置換**: `app-wiring.ts:108` の `setOnMarksReapplied(reapplySearchHighlights)` を `registerPostMarksReapplied(reapplySearchHighlights)` に置換（unsubscribe は teardown が無いため握り潰し可。teardown 規約が必要なら別途検討）
  2. **legacy 実装の撤去**: `mark-engine.ts:125-137` の `legacyOnMarksReapplied` slot と `setOnMarksReapplied` export を削除
  3. **JSDoc 更新**: `mark-engine.ts:96-106` の `postMarksReappliedHooks` JSDoc から「旧 API `setOnMarksReapplied` も互換のため残してある」記述と「同一 callback を両方で登録しないこと」の invariant 警告を削除（`registerPostMarksReapplied:113-117` も同様）
  4. **契約テスト書き換え**: `mark-engine.ts:304` の `describe('registerPostMarksReapplied / setOnMarksReapplied', ...)` から `setOnMarksReapplied` を使う test を削除し、describe 名を `registerPostMarksReapplied` に。`afterEach` の `setOnMarksReapplied(null)` は `postMarksReappliedHooks.clear()` に書き換え
- **第 2 段（API 統一、別 PR）**: `page-scroll-spy.ts` / `search-controller.ts` / `comments.ts` の `configureXxx` を `registerXxx(callback): () => void` (unsubscribe 返却) に統一。1 callback 制約が必要なものだけ `setXxx` を残す

**効果**: hook 追加時の API 揺らぎを抑え、テストでの teardown が安全になる（unsubscribe で漏れ防止）。`mark-engine.ts` の互換 invariant 記述が消え JSDoc が簡素化する。

**リスク**: 中 — 第 1 段では `app-wiring.ts` 以外に `setOnMarksReapplied` 呼び出し箇所が無いか `grep` で事前確認する。第 2 段では `configureXxx` を register 化する際に「複数 register を許すか」の意味論変更が含まれるため、各 hook の callee 数を事前確認する。

### M9. (完了済み) CLI clean.ts の formatter / IO 分割

**状態**: **完了済み** — `clean.ts` (423 行) を `clean-format.ts` (pure formatter: `formatDryRun` / `formatDeleted`) と `clean-io.ts` (実 fs 統合: `defaultCleanIo` + 実 fs テスト 2 ケース) に抽出。`clean.ts` は facade として `classifyEntries` + `runClean` + 型定義を保持し、`defaultCleanIo` を re-export して外部 API (CLI 仕様) 不変。挙動完全不変。

**対象**: `src/cli/clean.ts` (423 行) — `classifyEntries` / `runClean` / formatter 群 / `defaultCleanIo` (実 fs 統合) と in-source test (4 つの describe ブロック) が同居

**現状**: pure な分類ロジック (`classifyEntries`)、副作用を持つ orchestrator (`runClean`)、stdout フォーマット (dry-run プレビュー / 削除サマリ)、実 fs 統合 (`defaultCleanIo`)、in-source test が 1 ファイルに集中している。新規 clean policy（例: keep 期間指定）を追加する際の影響範囲が読みづらい。

**分割案**:

- `src/cli/clean-format.ts`: stdout フォーマット関数群（pure）
- `src/cli/clean-io.ts`: `defaultCleanIo` 等の実 fs 統合
- `src/cli/clean.ts`: `classifyEntries` + `runClean` orchestrator (facade)

**効果**: formatter / IO / orchestrator の責務が分離し、新規 clean policy 追加時のテストが pure 層で完結する。

**リスク**: 低 — public CLI 仕様（`--clean` / `--yes` / `--keep` / `-r`）は不変。in-source test を移動先に追従させる必要がある。

### M10. mermaid SVG interaction の切り出し

**対象**: `src/app/renderers/mermaid.ts` (420 行)

**現状**: H3（static modal 共通化）と L2（renderer type guard generic 化）でカバーされない領域として、SVG click expand wiring / `parseSvg` 系処理 / theme redraw (`redrawMermaidForTheme`) / upgrade entry が同居している。

**分割案**:

- `src/app/renderers/mermaid-svg-interactions.ts`: SVG クリック展開、`parseSvg`、SVG 由来の event delegate
- `src/app/renderers/mermaid.ts`: upgrade entry + redrawMermaidForTheme（facade）

**効果**: SVG interaction が独立し、Mermaid runtime バージョン差分（SVG attribute の互換性問題）を扱う際にスコープが明確化する。

**リスク**: 低〜中 — H3 / L2 完了後に着手する方が、modal / bridge との配線が確定して分割が安定する。

## 4. 優先度: 低

### L1. comment-modal state の tagged union 化

**対象**: `src/app/comments/comment-modal.ts` (318 行) — `modalState`

**現状**: `{ pendingSelection: ... | null, editingCommentId: ... | null }` の object literal で管理され、「add vs. edit 排他」「closed」の不変条件が implicit。

**分割案**:

- `type ModalState = { kind: 'closed' } | { kind: 'add', pendingSelection } | { kind: 'edit', editingCommentId }`
- `openAdd` / `openEdit` / `close` を tagged transition として書き直す

**効果**: 排他不変条件を型で保証、`switch` の exhaustiveness で抜け検知が可能に。

**リスク**: 低 — internal state のみ、外部から見える挙動は不変。

### L2. renderer upgrade の type guard 共通化

**対象**: `src/app/renderers/mermaid.ts` / `katex.ts` の `isMermaidLike` / `isKatexLike` 等

**現状**: `RuntimeBridgeConfig` 自体は過去 M3 (`f8b75d7`) で `runtime-bridge.ts` に既に存在するが、各 renderer の type guard (`isMermaidLike` / `isKatexLike`) は依然個別実装で、required key の列挙が手書きで散在している。

**分割案**:

- `isRuntimeLike<T>(requiredKeys: readonly (keyof T)[], value: unknown): value is T` の generic helper を `runtime-bridge.ts` に追加
- 既存の `isMermaidLike` / `isKatexLike` を `isRuntimeLike` の specialization に書き換え

**効果**: 新しい runtime bridge を追加する際の type guard 実装コストが消える。required key 列挙の写し間違いを防げる。

**リスク**: 低 — 既存 `RuntimeBridgeConfig` を活用するだけで、新規 type / module は不要。

### L3. text segment skip rules の宣言的化

**対象**: `src/app/dom/text-range.ts` (314 行) + `src/app/dom/text-segment-skip-rules.ts`

**現状**: skip 条件（`code-copy-btn` / `data-math` / `code-lang-label` / `sr-only` 等）が implicit に列挙され、追加時の影響範囲が見えにくい。mark-engine.ts と search-dom.ts の両方が参照する。

**分割案**:

- `const SKIP_RULES: readonly { selector: string, reason: string }[]` の宣言テーブル化
- `shouldSkip(node, rules): boolean` で一般化
- mark-engine / search-dom 両者で同テーブルを共有

**効果**: skip 規則の追加が宣言的に行え、reason の文書化も兼ねられる。

**リスク**: 低 — selector の評価順序を保てば挙動同値。

### L4. arg-spec の Validator protocol 統一

**対象**: `src/cli/arg-spec.ts` + `src/cli/flag-parser.ts`

**現状**: `parseCommentsWidthValue` / `parseMathValue` / `parseShikiLangsValue` 等、parse 関数の戻り値型・エラー形が個別で揃っていない。type guard も混在。

**分割案**:

- `type Validator<T> = { parse: (s: string) => T | null, describe: () => string }` の protocol で統一
- FlagSpec が validator を受け取り、エラーメッセージは `describe()` から自動生成

**効果**: CLI 引数の追加コスト減少、エラーメッセージの一貫性向上。

**リスク**: 低 — internal のみ、CLI 引数仕様（public）は不変。過去 H1b (`67c0fc3`) の `FlagDef[]` と整合させる。

### L5. (見送り) CLI compose pipeline のデータ駆動化

**状態**: **見送り（現時点では非推奨）** — `src/cli/compose-review-html.ts:73` の `applyThemeHint` / `applyCommentsWidthHint` / `applyPageNavWidthHint` は同型だが、1 関数 1 オプション形式の方が型の明瞭さが高い。データ駆動化すると行数は減るが認知負荷が上がるため、本シリーズでは見送る。将来 hint オプションが 6 個以上に増えた段階で再検討する。

### L6. (見送り) in-source test fixture の共通化と test 物理分離

**状態**: **見送り（現時点では非推奨）** — `src/app/navigation/page-navigation.ts:425` や `src/app/document/pages.ts:206` 等の `dummyPage` / `dummyComment` は共通化可能だが、本プロジェクトは in-source testing を設計方針として採用しており、物理的に近い fixture の方がテスト変更時の認知コストが低い。同一ファイル内で fixture が肥大化した個別箇所のみ局所的に整理する方針とし、全体共通化は行わない。

また、`mark-engine.ts` (372 行) や `pages.ts` (431 行) のようにファイル肥大の主因が test 部である場合、**実装と test を物理分離する**（例外的に `xxx.test.ts` を許容する）選択肢も理論的にはあり得るが、in-source testing は

- 実装と仕様を 1 ファイルで往復できる（review / 修正時の context switching が減る）
- private helper を export せずにテストできる
- file move の際にテストも自動追従する

という設計利点があり、行数だけを理由に方針転換するメリットは薄い。**本シリーズでは test 物理分離を採用しない**と明示し、行数問題は実装層の責務分割（M1 / M9 / M10 等）で解消する方向で扱う。

## 5. 推奨着手順

挙動不変な共通化を先行させ、構造変更（責務分割・hook 設計）は後ろに回す。

1. **H1**（focus-list 共通化）— pure helper 昇格 + comments 側差し替えのみ、リスク最小。focus helper の最終配置（`src/app/dom/`）が確定するため M1 の分割が安定する
2. **H2**（Shiki selection guard 共通化）— `scheduleAfterPaintWithSelectionGuard` primitive 追加から段階導入
3. **H3**（static modal controller）— hook 設計を 2 種類（`onAfterOpen` / `onAfterClose`）に絞って先に固める
4. **M1**（page-navigation 分割）— H1 完了後に着手。M1a（ファイル抽出のみ）→ M1b（facade 再配線）に分割
5. **M2**（ViewModel 二段分離）— M1 完了後に局所変更として実施
6. **M8 第 1 段**（`setOnMarksReapplied` legacy 経路撤去）— 機械的置換のみ、単発 PR
7. **M9**（clean.ts 分割）— pure / IO の分離、CLI 仕様不変
8. **M3**（math scanner protocol）— in-source test 先行整備
9. **M4**（hash protocol tagged union）
10. **M5**（parse-run-args attach generic）— 過去 H1b との整合確認
11. **M6**（HTML rewrite helper）— 対象を 2 関数に限定
12. **M7**（footnotes Marked cache）
13. **M10**（mermaid SVG interaction 切り出し）— H3 / L2 完了後に着手して配線安定後に分割
14. **M8 第 2 段**（`configureXxx` の register 化）— callee 数の事前確認が必要
15. **L1〜L4** — 単発で順不同。L2 は既存 `RuntimeBridgeConfig` を活用するだけなので H2 との依存はない

## 6. 共通の進め方

- 各候補は **1 PR = 1 候補** を原則とする
- 同時実施を推奨している組（例: H2 → L2）は別 PR にし、依存順を PR 説明に明記する
- 「ファイル分割のみ」と「責務再配置を含む構造変更」を含む候補は `?a` / `?b` の 2 PR に分け、前半は挙動不変であることを diff で確認できる形にする
- in-source test は実装と同じ移動先に追従させる
- 実装が終わったら **サブエージェントで独立レビューする**。特に「挙動不変」を狙う候補では、等価性・テストカバレッジの欠落・写し間違い・依存方向（循環参照）を重点的に確認させ、指摘を反映してから PR を出す
- DESIGN.md と乖離する変更は **DESIGN.md 更新を同 PR に含める**
- ビルド成果物（`dist/`）への影響は smoke check（`vp build` 後の `dist/standalone.html` / `dist/embed-template.html` の `<script id="embedded-md">` / `<script id="embedded-shiki-langs">` 存在確認、DESIGN.md §13「CI スモークテスト指針」参照）で確認する
- 実装が PR として merge できる状態になったら、計画書本文の該当候補に **`### H?. (完了済み) <タイトル>`** のような状態マーカを付け、コミット ID を添える（例: `**状態**: **完了済み** — commit `abc1234` で merge`）
- 本計画書に含まれる候補がすべて完了（または見送りと判断）したら、**本ドキュメント自体を削除する**（履歴は `git log --grep refactor` で辿れる）
