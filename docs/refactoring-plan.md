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

現状のコードベースは全体的に良く整理されている（factory pattern・table-driven 設計・`parse*/consume*/read*/write*/apply*` の命名規約が一貫）。緊急のリファクタは不要だが、以下の責務集中・対称重複が保守コストを上げている。

- 上位ファイル行数（in-source test を含む総行数）: `cli/parse-args.ts` 1481、`core/page-split.ts` 722、`app/navigation/page-navigation.ts` 631、`core/markdown.ts` 591、`app/search/search.ts` 593、`app/review.ts` 571、`app/renderers/mermaid.ts` 553。
- `parse-args.ts` は突出（本体 662 行 + in-source test 819 行）。clean / run / sanitize / table 群が同居。
- `renderers/mermaid.ts` と `renderers/katex.ts` は **コメント上も「完全に対称」と明記された左右対称重複**（`UpgradeStatus` / `UpgradeResult` / `BRIDGE_KEY` / `READY_EVENT` / `IDLE_TIMEOUT_MS` / `hasActiveSelection` / `onSelectionEnd` / `accumulateUpgradeResult`）。
- `app/review.ts` の `init()` に wiring（toolbar / search / menu / modal / keyboard / hashchange / footnote）が集中。
- `app/state/app-state.ts` の mutable `state` を多数モジュールが直接 mutate。
- in-source test は全 61 ファイル・約 834 テストで一貫採用。**「外部 test ファイルへ分離」は規約違反**なので候補から除外する。

方針：

- **挙動不変なファイル移動を先**にする。リスクの高い構造変更（state 配線変更・抽象化）は後ろに回す
- **public API（CLI 引数仕様 / `feedback.json` スキーマ / DOM 構造）は変えない**。変える必要が出たら別 PR に切り出す
- **DESIGN.md と乖離する変更を入れる場合は同時に DESIGN.md を更新**する
- in-source test (`if (import.meta.vitest)`) は実装ファイルに隣接させる原則を保つ。ファイル分割時はテストも一緒に移す

## 2. 優先度: 高

### H1. CLI 引数パーサのファイル分割 (完了)

**対象**: `src/cli/parse-args.ts:1`（本体 662 行 + test 819 行で突出）

**現状**: clean モード解析（`99-199`）、run モード解析（`201-650`）、`sanitizeMdFileName`（`652`）、および両モードの in-source test が 1 ファイルに同居している。

**分割案**:

- `src/cli/parse-clean-args.ts` — `CleanPartitionState` / `CLEAN_FLAG_TABLE` / `parseCleanArgs` とその test
- `src/cli/parse-run-args.ts` — `PartitionState` / `VALUE_FLAG_TABLE` / `PENDING_VALUE_TABLE` / `consume*Value` 群 / `buildRunArgs` / `parseRunArgs` とその test
- `src/cli/filename-sanitize.ts` — `sanitizeMdFileName` とその test
- `parse-args.ts` は `parseArgs` dispatcher（clean か run かの振り分け）と公開 re-export のみに縮小
- **DESIGN.md 更新**: DESIGN.md §13 の CLI 構成記述（`src/cli/{parse-args,input-source,open-command,serve}.ts` を列挙、`parseShikiLangsValue` の所在を `src/cli/parse-args.ts` と明記している箇所）を新ファイル構成に合わせて同 PR で更新する

**効果**: エントリの責務が「振り分け」だけになり、clean/run/sanitize を独立して読める。test も対象ファイルに追従し局所化。

**リスク**: 低（純粋なファイル移動。`parseArgs` の export 契約は不変。`vp test` の 834 テスト + `vp check` の type-check で回帰・import 書き換え漏れを検知できる）

## 3. 優先度: 中

### M1. Mermaid / KaTeX upgrade 共通処理の抽出 (完了)

**対象**: `src/app/renderers/mermaid.ts:183`（`UpgradeResult` 以降）, `src/app/renderers/katex.ts:112`

**現状**: `UpgradeStatus` / `UpgradeResult` 型、`accumulateUpgradeResult` の集計、`requestIdleCallback` fallback、選択中 defer（`hasActiveSelection` / `onSelectionEnd`）、`blockOriginalHTML` cache 連携、toast による失敗報告が両ファイルでほぼ同形に重複。コメントにも「Mermaid と完全に対称」と明記されている。

**分割案**:

- `src/app/renderers/upgrade-utils.ts` — `UpgradeStatus` / `UpgradeResult` / `accumulateUpgradeResult` / `hasActiveSelection` / `onSelectionEnd` / idle スケジューラ fallback / toast 失敗報告ヘルパを小さく抽出

**効果**: 集計・スケジューリング・失敗報告の挙動が 1 箇所に集約され、片方だけ直る差分ドリフトを防げる。

**リスク**: 中（Mermaid は async sequential、KaTeX は sync という非対称が残る。**render 本体まで無理に共通化せず**、状態集計・defer・toast のみ抽出する。過抽象化は避ける）

### M2. review.ts の wiring 分離

**対象**: `src/app/review.ts:320`（`init()` に集中）

**現状**: 初期化、キーボード、`hashchange`、footnote ハッシュ処理、toolbar / search / menu / modal の wiring がエントリに密集。

**分割案**:

- `wireGlobalKeys()` — keyboard 配線
- `wireHashNavigation()` — `hashchange` + footnote hash（`FOOTNOTE_HASH_RE` / `handleFootnoteHash` / `focusFootnoteTarget`）
- `createNavigationController()` — `navigateToTarget` / `scrollToActivePageSection` / `onCompositeSlugClick` の束ね

これにより `init()` は「依存注入と起動順序」だけに集中する。

**効果**: エントリの見通し向上。起動順序のバグを追いやすくなる。

**リスク**: 中（起動順序・クロージャ捕捉に依存する箇所がある。挙動不変であることを diff で確認しながら段階的に切る）

### M3. doc-mount の pure / DOM 副作用分離 (完了)

**対象**: `src/app/document/doc-mount.ts:1`（parse + 配賦 + footnote 配置 + state cache が近接）

**現状**: Markdown parse、sourceLine annotation、page distribution、footnote synthetic section 配置、`blockAnchors` / `blockOriginalHTML` の state cache 更新が同じ近傍にある。

**分割案**:

- `buildPageSections(markdown, pages)` 相当の純粋寄り関数を切り出し、DOM mount（`appendChild` / state cache 書き込み）と分離

**効果**: DOM fixture 依存を減らし、配賦ロジックを純粋関数として in-source test しやすくなる。

**リスク**: 中（footnote orphan 救済の順序依存に注意。配賦結果の DOM が完全一致することを確認する）

## 4. 優先度: 低

### L1. consume\*Value 群のテーブル駆動統合

**対象**: `src/cli/parse-args.ts:269-362`（H1 後は `parse-run-args.ts`）

**現状**: `consumeDocNameValue` / `consumeThemeValue` / `consumeCommentsWidthValue` など 9 個の値 consumer が、ほぼ同一パターン（`--` 始まりを弾く → `parse*Value` で検証 → null なら invalid、そうでなければ field 設定 + pending クリア）で並ぶ。

**分割案**:

- 既存の `VALUE_FLAG_TABLE` と同様に `{ parser, field, pendingField }` のテーブルで汎用 consumer に統合。約 70–80 行削減。

**効果**: フラグ追加時の同型関数の増殖を止め、検証規約を 1 箇所に集約。

**リスク**: 低〜中（H1 の後に着手する構造変更。各フラグの境界条件 test が厚いので回帰検知しやすい。H1 とは別 PR にする）

### L2. sidebar-width.ts の配置見直し (完了)

**対象**: `src/app/layout/sidebar-width.ts`（旧 `src/app/chrome/sidebar-width.ts`)

**現状**: 汎用 factory（`SidebarWidthModule`）でありながら `chrome/` 配下にあり、`navigation/` `comments/` から逆向きに import されていた。ロジック自体は良設計で重複は無い。

**実施内容**:

- `src/app/chrome/sidebar-width.ts` を `src/app/layout/sidebar-width.ts` へ移動し、依存方向を自然化（ロジックは不変）。import パスを `comments/comments-width.ts` / `navigation/page-nav-width.ts` / `chrome/sidebar-resize.ts` の 3 箇所で書き換え、DESIGN.md §13 のソース構成記述にも `layout/` カテゴリを追加。

**効果**: 依存方向の直感性向上。

**リスク**: 低（import パス書き換えのみ。LSP は自動書き換えしないため手動で書き換え、`getDiagnostics` / `vp check` で検証）

### L3. グローバル mutable state の操作 API 化

**対象**: `src/app/state/app-state.ts:18`

**現状**: 多数モジュールが `state` を直接 mutate している。全面置換は影響範囲が広く危険。

**分割案**:

- まず `loadDocumentState` / `setActivePage` / `replaceComments` のような **狭い操作関数を増やす**ところから始め、直接 mutate を段階的に置換。全面 setter 化はしない。

**効果**: 将来の回帰点を絞り、state 変更箇所を grep 可能にする。

**リスク**: 高（参照箇所が広い。1 PR で 1 操作関数ずつ導入し、挙動不変を都度確認する）

## 5. 推奨着手順

挙動不変なファイル移動を先にし、構造変更（抽象化・state 配線）は後ろに回す原則で並べる。

1. **H1**（parse-args 分割、完了）— 最も費用対効果が高い。純粋なファイル移動で、834 テスト + `vp check` で安全に確認できる
2. **L2**（sidebar-width 移動、完了）— import パス書き換えのみの低リスク移動。H1 と独立に進められる
3. **M1**（mermaid/katex upgrade-utils 抽出、完了）— 対称重複の解消。render 本体は触らず状態集計・defer・toast のみ
4. **M3**（doc-mount pure 分離、完了）— 配賦ロジックを純粋関数化してテスト容易性を上げる
5. **M2**（review.ts wiring 分離）— 起動順序に依存するため、上記でコードに慣れてから
6. **L1**（consume\*Value 統合）— H1 完了後に `parse-run-args.ts` 内の構造変更として別 PR で
7. **L3**（state 操作 API 化）— 最も影響範囲が広いので最後。1 操作関数ずつ段階導入

## 6. 共通の進め方

- 各候補は **1 PR = 1 候補** を原則とする
- 同時実施を推奨している組は同一 PR で OK
- 「ファイル分割のみ」と「責務再配置を含む構造変更」を含む候補は 2 PR に分け、前半は挙動不変であることを diff で確認できる形にする（例: H1 と L1）
- in-source test は実装と同じ移動先に追従させる
- DESIGN.md と乖離する変更は **DESIGN.md 更新を同 PR に含める**
- **各候補の最低限の検証コマンドは `vp test`（in-source tests）→ `vp check`（format / lint / type-check）の順**（README_ja.md「開発」節）。本計画はリファクタの挙動不変性を in-source test に強く依存しているため、`vp test` の green を必須ゲートとし、ファイル移動に伴う import 書き換え漏れは `vp check`（type-check）で拾う
- ビルド成果物（`dist/`）への影響は smoke check（`vp build` 後の `dist/standalone.html` / `dist/embed-template.html` の `<script id="embedded-md">` / `<script id="embedded-shiki-langs">` 存在確認、DESIGN.md §13「CI スモークテスト指針」参照）で確認する
- **`dist/` はリポジトリに commit される配布物**（DESIGN.md §11d / §13「commit 対象」、「clone 直後に `vp build` 抜きで CLI / standalone を実行できる」配布契約）。`src/` を動かす候補（H1 / M1 / M2 / M3 / L1 / L2）では、純粋なファイル移動でも `vp build` の出力が変わる可能性があるため、**生成された `dist/` を同 PR に含めてコミットする**。挙動不変なら `dist/` の diff は無いはずで、diff が出た場合は意図しない出力変化のサインとしてレビューする。`dist/` を含めない場合はその理由を PR に明記する
