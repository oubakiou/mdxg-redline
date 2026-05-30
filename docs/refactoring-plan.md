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

> 本計画の連番（H1 / M1 / M2 / L1 / L2 / L3 など）は、過去シリーズ（`git log --grep refactor`）の同名項目とは独立。本文で過去項目を参照する場合は `過去 M1 (<commit id 短縮>)` のように接頭辞 + コミット ID を付けて世代を一意化する。

現状コードベース規模（上位 `src/` ファイル、概算）:

| ファイル                                | 行数 | 備考                                                                  |
| --------------------------------------- | ---: | --------------------------------------------------------------------- |
| `src/cli/parse-run-args.ts`             |  987 | code 約 480 + in-source test 約 500。pending boolean × 9 + 2 テーブル |
| `src/core/page-split.ts`                |  722 | code 約 357 + test 約 365。footnotes synthetic page と境界判定が同居  |
| `src/app/navigation/page-navigation.ts` |  631 |                                                                       |
| `src/app/search/search.ts`              |  593 | 状態 / DOM Range / wiring / debounce が同居                           |
| `src/core/markdown.ts`                  |  591 | renderer 整流とセキュリティ境界が同居                                 |
| `src/app/review.ts`                     |  585 | import 25 個。起動 wiring と navigation orchestration が同居          |
| `src/core/embed/html-rewrite.ts`        |  576 | `data-*` 属性置換ヘルパー 5 個が並走                                  |
| `src/app/comments/selection.ts`         |  525 | text segment / Range 構築が search / mark-engine と部分重複           |
| `src/app/comments/comments.ts`          |  507 | DOM wiring と pure ordering / string builder が同居                   |
| `src/app/renderers/mermaid.ts`          |  497 | M1 後も runtime bridge / upgrade loop が katex と 95% 重複            |
| `src/app/renderers/katex.ts`            |  459 | 同上                                                                  |

方針：

- **挙動不変なファイル移動を先**にする。リスクの高い構造変更（state 配線変更・hook 追加など）は後ろに回す
- **public API（CLI 引数仕様 / `feedback.json` スキーマ / DOM 構造）は変えない**。変える必要が出た場合は別 PR として切り出す
- **DESIGN.md と乖離する変更を入れる場合は同時に DESIGN.md を更新**する
- in-source test (`if (import.meta.vitest)`) は実装ファイルに隣接させる原則を保つ。ファイル分割時はテストも一緒に移す

## 2. 優先度: 高

### H1. (完了済み) `parse-run-args.ts` の pending state を単一 FlagDef table に統合

**状態**: **完了済み** — H1a は commit `bf774c9` (機械的抽出)、H1b は commit `67c0fc3` (FlagDef 統合) で merge。

「挙動不変なファイル移動 → 構造変更」原則に沿うため、H1 は **H1a（機械的抽出）と H1b（FlagDef 統合）の 2 PR に分割** する。H1a は 過去 H1 (f621d6c) / L1 (1bf3187) の直接の延長で純粋なファイル分割、H1b はその上で型整合の構造変更を行う。

#### H1a. flag-parser primitive を単独ファイルへ機械的抽出（挙動不変）

**対象**: `src/cli/parse-run-args.ts:49` 以降の `PartitionState` / `VALUE_FLAG_TABLE` / `PENDING_VALUE_SPECS`、および `src/cli/parse-run-args.ts:183` 付近の `unknown` cast 周辺

**現状**: 過去 L1 (1bf3187) で `consume*Value` の重複は解消したが、3 テーブル + pending boolean の構造はそのまま `parse-run-args.ts` 内に残っており、orchestrator と primitive が同居している。

**分割案**:

- `src/cli/flag-parser.ts`: 既存の `VALUE_FLAG_TABLE` / `PENDING_VALUE_SPECS` / `PartitionState` 型と現状ロジックをそのまま移動（**シグネチャ / テーブル内容は不変**）
- `parse-run-args.ts`: import 経由で primitive を利用、orchestrator 層に縮小
- in-source test も対応する単位で `flag-parser.ts` へ移動

**効果**: H1b の構造変更を行う前に diff レベルで挙動不変であることを確認できる土台が整う。

**リスク**: 低（ファイル移動のみ）

#### H1b. FlagDef による単一テーブル化と pending boolean 解消（構造変更）

**対象**: H1a 完了後の `src/cli/flag-parser.ts`

**現状**: `PartitionState` に pending boolean が 9 個並び、`VALUE_FLAG_TABLE` と `PENDING_VALUE_SPECS` の対応をテスト（isomorphism チェック）で守っているが、型では整合性が保証されていない。フラグ追加時に「2 テーブル + state field + parser」の 4 箇所更新が必要。

**分割案**:

- `flag-parser.ts`: `FlagDef<T> = { flag, key, parser, assign }` の宣言的 generics と、`pending: PendingFlag | null` を持つ minimal state machine を提供
- 2 テーブルを単一 `FlagDef[]` に統合し、`unknown` cast / lint disable を消す
- in-source test の isomorphism チェックは型で吸収できる分だけ削減

**効果**: フラグ追加時のキー漏れを型で防止。pending boolean 群の同期コストを除去。

**リスク**: 中（型設計の複雑化。ただし H1a で挙動不変の土台があり、test カバレッジが厚いため等価性は担保しやすい）

### H2. (完了済み) `review.ts` から navigation / global-keyboard / wiring を分離

**状態**: **完了済み** — commit `b0106ff` で merge。

**対象**: `src/app/review.ts:8`（import 25 個）、`src/app/review.ts:74` / `:222` / `:295` / `:380` 付近

**現状**:

- 過去 M2 (49b025b) で `setupKeyboardHandlers` / `setupHashNavigation` の呼び出し抽出は済んだが、エントリポイントには `loadFromMarkdown` 起動、ページ遷移、脚注 hash、キーボード、検索、コメント、toolbar 起動処理が依然同居
- 検索・コメント・ページナビ変更時に `review.ts` を巻き込みやすい

**分割案**（既存 9 ディレクトリ構成と整合させ、新ディレクトリは作らない）:

- `src/app/navigation/hash-navigation.ts`: 脚注 / heading hash 解決と scroll
- `src/app/navigation/navigation-orchestrator.ts`: ページ遷移と scroll-spy の同期
- `src/app/chrome/global-keyboard.ts`: WASD グローバルキーマップの登録（既存 `chrome/` 配下に置く）
- `src/app/app-wiring.ts`: 起動順の orchestrator（`bootstrap` のみ公開、`src/app/` 直下）
- `src/app/review.ts`: bootstrap 呼び出しに縮小

**効果**: エントリポイントの結合度低下。検索 / コメント / ページナビの機能追加時の影響範囲が明確化。

**リスク**: 中（起動順の不変条件を §9 起動シーケンスに沿って維持する必要がある）

### H3. (完了済み) `search.ts` を state / DOM highlight / UI wiring に分割

**状態**: **完了済み** — commit `820fe95` で merge。

**対象**: `src/app/search/search.ts:31`、match 収集 `:91`、highlight 適用 `:202`、状態更新 `:323`

**現状**: 検索状態、match 収集、DOM Range wrap、current mark 表示、debounce、button wiring が単一ファイルに同居しており、DOM を伴わない state テストが書きにくい。

**分割案**:

- `src/app/search/search-state.ts`: pure な state 遷移（current index、wrap、match list）
- `src/app/search/search-dom.ts`: DOM Range wrap、current mark 表示、cleanup
- `src/app/search/search-controller.ts`: input debounce、button wiring、state と DOM の橋渡し

**効果**: DOM を伴わない state テストを増やせ、検索性能改善や UI 変更が局所化。

**リスク**: 低（境界が明確、in-source test を移すだけ）

## 3. 優先度: 中

### M1. (完了済み) text-range / text-segment utility を集約

**状態**: **完了済み** — commit `4ed7fba` で merge。

**対象**: `src/app/comments/selection.ts` の `textSegments` / `textRangeFromOffsets`、`src/app/search/search.ts:160` 付近の Range 生成・wrap、`src/app/comments/mark-engine.ts`

**現状**: `textRangeFromOffsets` は共用されているが、Range 生成・safe wrap・segment traversal は検索側にも個別実装がある。skip rule は既に `text-segment-skip-rules.ts` に分離済みだが、利用は分散。

**分割案**:

- `src/app/dom/text-range.ts`: `rangeFromEndpoints`、`safeWrap`、`textSegments` 純粋関数を集約（既存 `dom/dom-utils.ts` 等と並べる方が自然なため `dom/` を推奨。`document/` 配下は doc-mount 系の DOM ライフサイクルに寄っているので不採用）
- `selection.ts` は Range ↔ offset 変換に専念

**効果**: コメント mark と search mark の不変条件を一箇所で担保。重複呼び出しの削減。

**リスク**: 低-中（呼び出し回数の挙動同値を要確認）

### M2. (完了済み) `comments-width.ts` / `page-nav-width.ts` の共通 resize / storage ロジック化

**状態**: **既に実装済み** — `src/app/comments/comments-width.ts` と `src/app/navigation/page-nav-width.ts` はどちらも `src/app/layout/sidebar-width.ts` の `createSidebarWidthModule` を呼ぶ薄い wrapper になっており、`clamp` / stored value / CLI hint 優先順位 / closed タブ判定は集約済み。本項目は計画起票時点で見落としていたため、以降の番号は欠番として扱う（H1-H3 / M1 / M3-M5 / L1-L3 への参照を壊さないため詰めない）。

### M3. (完了済み) mermaid / katex renderer 共通化（過去 M1 (f406601) の継続）

**状態**: **完了済み** — commit `f8b75d7` で merge。

**対象**: `src/app/renderers/mermaid.ts` (497) / `katex.ts` (459)

**現状**: 過去 M1 (f406601) で upgrade ユーティリティの共通化は済んだが、`waitForRuntime` / `readBridge` / upgrade loop / selection deferral / idle スケジューラなどの init→execute→apply pipeline が言語別に 95% 重複している。

**分割案**:

- `src/app/renderers/runtime-bridge.ts`: generics の `BRIDGE_KEY` / Ready Event 抽象
- `src/app/renderers/upgrade-orchestrator.ts`: 共通 upgrade loop
- 各 renderer は `init` / `exec` / `apply` の 3 hooks 提供のみに

**効果**: 150-200 行削減。新 renderer 追加時の boilerplate 半減。

**リスク**: 低（過去 M1 (f406601) の延長、generics は素直）

### M4. (完了済み) `comments.ts` の DOM wiring と pure logic 分離

**状態**: **完了済み** — commit `740e93b` で merge。

**対象**: `src/app/comments/comments.ts` (507)

**現状**: `commentCardHTML`（string builder, pure）、`orderedComments`（pure）、`wireCommentCard`（DOM listener）、keyboard nav が同居し、pure 部分のテストが副作用と密結合。

**分割案**:

- `src/app/comments/comment-rendering.ts`: pure string builders（`commentCardHTML` / `pageBadgeHTML` 等）
- `src/app/comments/comment-orderer.ts`: pure sort（`orderedComments`）
- `comments.ts` は DOM wiring と DI ハンドラだけ

**効果**: pure 部分のテスト独立化、過去 L3 (666942c / 969a494) narrow operation API との整合性向上。

**リスク**: 低

### M5. (完了済み) `html-rewrite.ts` の属性置換ヘルパー集約

**状態**: **完了済み** — commit `e8bd1d3` で merge。

**対象**: `src/core/embed/html-rewrite.ts` (576)、特に `EMBEDDED_MD_RE`（13）/ `EMBEDDED_SHIKI_LANGS_RE`（18）、`replaceData*` ヘルパー 5 個（`replaceDataName`:75 / `replaceDataTheme`:84 / `replaceDataCommentsWidth`:91 / `replaceDataPageNavWidth`:98 / `replaceDataToolbarOpenFile`:151）

**現状**: `data-*` 属性置換ヘルパー 5 個がほぼ同じ regex/replace パターンで並走。

**分割案**:

- `src/core/embed/html-attribute-rewriter.ts`: 汎用 attribute selector matcher/replacer
- `html-rewrite.ts` は `rewriteReviewHtml` の orchestrator に縮小

**効果**: 約 150 行削減、regex メンテコスト低下。

**リスク**: 低（regex 群は単独依存、外部仕様への影響なし）

## 4. 優先度: 低

### L1. (完了済み) `page-split.ts` 内 synthetic page 生成の切り出し

**状態**: **完了済み** — commit `e124ddd` で merge。

**対象**: `src/core/page-split.ts` (722, code 357 / test 365)

**現状**: 見出しスキャン、markdown slice、slug resolution、`appendFootnotesPage`（`footnotes.ts` 強依存）が同居し、責務境界が曖昧。

**分割案**:

- `src/core/page-boundary.ts`: 境界 primitive と slice
- `src/core/synthetic-pages/footnotes-synthetic-page.ts`: footer 専用
- `page-split.ts` は `splitIntoPages` orchestrator

**効果**: 将来の synthetic page 種別追加時の拡張点が明確化。

**リスク**: 中（§6 round-trip 不変条件テストの追従が必要）

### L2. (削除) in-source tests の選択的分離

**状態**: **不採用** — in-source test (`if (import.meta.vitest)`) を実装に隣接させる原則は維持する方針のため、選択的分離は行わない。番号は H1-H3 / M1 / M3-M5 / L1 / L3 への参照を壊さないため欠番として残す。

### L3. `markdown.ts` の renderer concern 分割

**対象**: `src/core/markdown.ts:1` 以降

**現状**: raw HTML escape、link / image allowlist、heading id、math wrapping、table wrapping、code renderer integration が同居。セキュリティ境界を担うため分割は慎重に。

**分割案**:

- `src/core/markdown-renderer/link-policy.ts` / `math-inline.ts` 等に pure helper を切り出す程度から開始
- セキュリティ境界（allowlist / escape）は `markdown.ts` に残す

**効果**: セキュリティ方針が読みやすくなる。

**リスク**: 高（XSS / リンクポリシー回帰リスク。レビュー必須）

## 5. 推奨着手順

挙動不変なファイル移動を先にし、構造変更（hook 設計・抽象化）は後ろに回す原則で並べる。ユーザー優先候補（H1 / H2 / H3）を先頭に置きつつ、各候補内では「機械的抽出 → 構造変更」の順を維持する（H1a → H1b など）。M2 は本計画起票時点で既に完了済みのため順序から除外する。

1. **H1a** — `flag-parser.ts` への機械的抽出（挙動不変、低リスク）— **完了** (`bf774c9`)
2. **H1b** — FlagDef 統合による型整合化（構造変更、中リスク）— **完了** (`67c0fc3`)
3. **H2** — `review.ts` から hash-navigation / global-keyboard 切り出し（過去 M2 (49b025b) = `setupKeyboardHandlers` / `setupHashNavigation` 抽出の継続）— **完了** (`b0106ff`)
4. **H3** — `search.ts` の `search-dom` / `search-state` 切り出し — **完了** (`820fe95`)
5. **M1** — text-range / text-segment utility 集約（H3 完了後の方が衝突が少ない）— **完了** (`4ed7fba`)
6. **M5** — `html-rewrite.ts` の属性置換ヘルパー集約（pure split、低リスク）— **完了** (`e8bd1d3`)
7. **M3** — mermaid / katex renderer 共通化（過去 M1 (f406601) の継続）— **完了** (`f8b75d7`)
8. **M4** — `comments.ts` の DOM wiring と pure logic 分離 — **完了** (`740e93b`)
9. **L1** — `page-split.ts` の synthetic page 切り出し — **完了** (`e124ddd`)
10. **L3** — `markdown.ts` の renderer concern 分割（セキュリティ境界のため最後）

## 6. 共通の進め方

- 各候補は **1 PR = 1 候補** を原則とする
- 「ファイル分割のみ」と「責務再配置を含む構造変更」を含む候補は 2 PR に分け、前半は挙動不変であることを diff で確認できる形にする（本計画では H1 を H1a / H1b に分割している）
- in-source test は実装と同じ移動先に追従させる
- 実装が終わったら **サブエージェントで独立レビューする**。特に「挙動不変」を狙う候補では、等価性・テストカバレッジの欠落・写し間違い・依存方向（循環参照）を重点的に確認させ、指摘を反映してから PR を出す
- DESIGN.md と乖離する変更は **DESIGN.md 更新を同 PR に含める**
- ビルド成果物（`dist/`）への影響は smoke check（`npm run build` 後の `dist/standalone.html` / `dist/embed-template.html` の `<script id="embedded-md">` / `<script id="embedded-shiki-langs">` 存在確認、DESIGN.md §13「CI スモークテスト指針」参照）で確認する
