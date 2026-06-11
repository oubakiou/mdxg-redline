# スマートフォン向け review.html レイアウト 設計・実装計画

[![MKDN](https://img.shields.io/badge/MKDN-review-red?style=for-the-badge)](https://mkdn.review/?url=https%3A%2F%2Fraw.githubusercontent.com%2Foubakiou%2Fmdxg-redline%2Frefs%2Fheads%2Fmain%2Fdocs%2Ffeature-mobile-layout.md#p:page-1)

DESIGN.md §12 「その他の拡張候補」の「スマートフォン向け UI の最適化」項目に対応するための設計判断と実装手順をまとめる。完了時点で本ドキュメントは DESIGN.md §12 の同項目から削除され、§4 アーキテクチャ / §10 ブラウザ互換性に「モバイルレイアウト」節として転記され、本ファイルは `docs/archive/feature-mobile-layout.archive.md` にアーカイブされる想定。

## 1. 対応スコープ

スマートフォン (iOS Safari / Android Chrome、概ね幅 ≤ 768px) で review.html を片手・親指圏で扱えるようにする。既存のデスクトップ / タブレットレイアウトには回帰を出さない。

| 要件                                                                                                                                                                                 | 現状 | 完了条件                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [MUST] ヘッダを常時表示し、`Open ▾` と `⚙ Settings` のみ配置                                                                                                                         | 未   | iPhone SE (375×667) 〜 iPhone 14 Pro (393×852) で `#status` / `#online-source` / `#btn-search` / `#btn-help` が見えない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| [MUST] 画面下端にフッターを常時表示し、`TOC` / `Comment` / `Search` の 3 ボタンを並べる                                                                                              | 未   | `position: fixed; bottom: 0` で本文スクロール中も viewport 下端に張り付き、iOS safe-area inset を尊重する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| [MUST] フッター 3 ボタンが drawer / search-bar を toggle する                                                                                                                        | 未   | TOC ボタン → 左 drawer / Comment ボタン → 右 drawer / Search ボタン → 既存 `.search-bar` toggle が動く                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [MUST] drawer は backdrop / Esc / 同ボタン再押下で閉じる                                                                                                                             | 未   | いずれの経路でも `<html>` の drawer-open class が外れ、focus が trigger 要素に戻る                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| [MUST] mobile overlay (drawer / search-bar) は同時 open しない                                                                                                                       | 未   | drawer 開中に Search を押すと drawer が閉じ、 search-bar 開中に TOC / Comment を押すと search-bar が閉じる（§5.m）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| [MUST] mobile で本文 `.doc-pane` が縦スクロールできる                                                                                                                                | 未   | 768px ブロックで `body > main.layout > section.doc-pane { overflow-y: auto; min-height: 0 }` + `body > main.layout { flex: 1; min-height: 0 }` を明示再宣言（既存 900px の子結合子つき高 specificity 規則 `body > main.layout > section { overflow-y: visible }` / `body > main.layout { flex: none }` を同等以上の specificity で打ち消す。 flat な `.doc-pane` では負ける。 §5.h / §8）                                                                                                                                                                                                                                                                                                                                    |
| [MUST] mobile→desktop へ resize した時に drawer / inert / open class がリセットされる                                                                                                | 未   | drawer 開状態で viewport 幅が 768px を超えると `matchMedia('(max-width: 768px)')` change handler が `closeMobileDrawers({ restoreFocus: false })` を呼び、 JS が付けた DOM 属性 / class がすべて除去される（§5.j-3）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| [MUST] breakpoint 切替時に hidden / inert になる要素から focus が退避される                                                                                                          | 未   | matchMedia change の両ブランチで `escapeFocusBeforeBreakpointSwitch(toMobile)` + `willBeHiddenAfterSwitch(el, toMobile)` で **切替後に hide される全要素** を判定して `.doc-pane` に退避：mobile 進入時は `.page-nav` / `.comments` / `#btn-search` / `#btn-help` / `#status` / `#online-source` / `.page-nav-toggle-tab` / `.comments-toggle-tab` (768px ブロックで `display: none`)、 desktop 進入時は `.mobile-footer` / `.mobile-drawer-backdrop` (グローバル hide) + `*-closed` 状態の `.page-nav` / `.comments` (grid 列幅 0)（§5.j-3）                                                                                                                                                                                |
| [MUST] drawer 内の navigation (TOC link / page-outline link / page-nav-sequential link / comment カード本体 click / Enter) で drawer が自動 close し focus が `.doc-pane` に退避する | 未   | TOC は `onCompositeSlugClick` (`navigation-orchestrator.ts:165`) 内に mobile 分岐を追加して全経路網羅。 Comments は **既存 `setOnCommentNavigate` (単一代入で別ページ判定時のみ発火) ではなく**、 新規 `addOnCommentActivate(handler)` registry を `comments.ts` に追加し `focusCommentCard()` 内から fire することで同一/別ページ問わず activation を拾う。 `closeMobileXxx({ restoreFocus: false })` + `.doc-pane.focus({preventScroll: true})` で退避、 mobile 経路では `navigateToTarget` の **第 3 引数 (`focusTOC`)** を `mobileDrawerOpen ? false : keyboardActivated` で渡し `focusNavigatedLink` (`navigation-orchestrator.ts:146-151`) をスキップして inert TOC link への focus 競合を回避（§5.r）                 |
| [MUST] Comments drawer 内 `.cmt-edit` click 時に drawer が先に close され、 modal close で footer Comment button に focus 復元される                                                 | 未   | capture phase delegation で `.cmt-edit` (`data-edit` 属性) click を先取り、 `closeMobileComments({ restoreFocus: true })` で footer Comment button に focus を戻してから bubble phase で既存 modal が open される。 `comment-modal.ts` の **共通 helper `showModalWithBody` (`l.40`)** に `lastTrigger` 保存 + `pendingFocusTimer` 管理を追加、 `closeCommentModal` で `clearTimeout` + **`restoreFocusAfterClose(lastTrigger)` で 3 段階フォールバック** ((a) `isConnected` 確認 → (b) 同一 comment id の新 Edit ボタン → (c) matchMedia 判定で mobile footer Comment button or `.doc-pane`) で復元 (§4 Step 5c、 50ms timer 競合は §4 Step 5b と同 pattern)。 `.cmt-del` は即時削除のため drawer 自動 close 対象外（§5.s） |
| [MUST] desktop / 既存 ≤900px タブレットレイアウトに視覚回帰を起こさない                                                                                                              | ✓    | Chrome DevTools の `1920×1080` / `1024×768` / `800×600` の 3 preset で本タスク前後の `dist/standalone.html` を開いて差分が無い（toolbar / sidebar / `.search-bar` / floater / toast / modal の全配置が pixel 同等）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| [SHOULD] drawer open 中は背面を `inert` で操作不能化 + 閉じた drawer も `inert` で除外 + Tab は drawer + mobile-footer 内に循環                                                      | 未   | (a) 背面 3 要素 `.skip-link` / `.app-header` / `.doc-pane` に `inert` 付与、 (b) 閉じた drawer は §5.j-4 の `applyMobileInertState()` で Tab / AT tree から除外、 (c) drawer open 直後に drawer 内先頭要素へ focus 移動 + Tab key handler で drawer 末尾 ↔ footer 先頭 / footer 末尾 ↔ drawer 先頭 を wrap (§5.j-5)、 footer 末尾から Tab しても browser chrome に脱出しない、 screen reader も背面を読まない (詳細は §5.j / §5.j-4 / §5.j-5)                                                                                                                                                                                                                                                                                |
| [SHOULD] drawer 内部の縦スクロールは保持される                                                                                                                                       | 未   | drawer open 中も drawer 自身は `overflow-y: auto` で縦スクロール可能。 背面 `.doc-pane` のみ touch / wheel scroll を抑止 (§5.h)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| [SHOULD] iOS Safari の URL bar 表示・非表示 (動的 viewport) でフッター位置が崩れない                                                                                                 | 未   | `height: 100dvh` + `viewport-fit=cover` で追従                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| [SHOULD] safe-area inset (top / bottom / left / right) が UI 全体で一貫反映され、 drawer 内の既存 padding も保持される                                                               | 未   | header の `padding-top` / footer の `padding-bottom` / drawer / backdrop / `.layout` の各オフセットが `--mobile-header-height` / `--mobile-footer-height` 変数で共通化、 drawer 内側 padding は既存値 + inset で加算 (§5.k / §8 で `box-sizing: border-box` 統一)                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| [SHOULD] tooltips (`.tooltipped::after`) は mobile で hide（タッチでは hover が無意味）                                                                                              | 未   | 768px ブロック内で `.tooltipped::after, .tooltipped::before { display: none }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| [SHOULD] `prefers-reduced-motion: reduce` 環境で drawer transition を短縮                                                                                                            | 未   | 該当環境で `transition-duration: 0s` (slide-in 無し、 即時切替)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

追加実装（規格上は SHOULD 未満だが UX 上有用）：

- footer 各ボタンの ARIA state attribute を **対象 widget の semantic に合わせて使い分け**（§5.q）：
  - TOC / Comment ボタン (drawer = collapsible panel) は **`aria-expanded`** + `aria-controls="page-nav-list"` / `aria-controls="cmt-list"` で開閉状態と制御対象を AT に伝達 (既存 `.page-nav-toggle-tab` / `.comments-toggle-tab` review.html l.664-688 と同じ規約)
  - Search ボタン (search-bar = toggle command) は **`aria-pressed`** のまま (既存 `#btn-search` と整合)、 MutationObserver で `.search-bar.open` を監視し `f` キー / Esc 経由の状態変化にも追従（§5.d）
- `:root:not(.has-pages) #btn-mobile-toc { display: none }`：**文書未読込時** は TOC ボタンを無効化 (`has-pages` は `src/app/navigation/page-navigation-render.ts:209` で page が 1 件以上構築されたタイミングで付与される flag。 単一ページ文書でも `has-pages` が付くため、 「ページ分割が無い文書 = 単一 H1 のみ」で hide したい要件は本タスクのスコープ外、 将来必要なら `data-page-count` 等の attribute 追加を別タスクで対応する、§8)

スコープ外（別タスクで扱う）：

- **floater (`#floater`) の位置調整 / 選択ハンドル制御**：DESIGN.md §12 の同項目に列挙されているが、 fixed footer / drawer の合意ができた段階で別 Step / 別タスクで扱う
- **モバイル特化の TOC 折りたたみ・コメントカード密度調整**：本タスクは「主要 chrome の配置」までを射程にし、 drawer 内部 UI のスマホ向け密度最適化は次フェーズに回す
- **landscape orientation 専用レイアウト**：portrait と同一規則 (`max-width: 768px`) で扱い、 landscape 特化のメディアクエリは作らない。 iPhone SE / iPhone 6/7/8 landscape (667×375) のように **幅が 768px 以下に収まる** 機種は landscape でも drawer モデルになる。 一方 iPhone 12 mini landscape (812×375) / iPhone 13 mini landscape (812×375) / iPhone 14 Pro Max landscape (932×430) のような **landscape 幅が 769-900px に収まる** 機種は **既存タブレット (vertical-stack) モデル** (TOC 非表示・comments 縦積み、 既存 `@media (max-width: 900px)` 適用域、§3.1 表) になる。 iPad mini landscape (1024×768) / iPad landscape (1180×820) のように **901px 以上の機種** は desktop モデルに戻る
- **mobile での Help モーダル動線**：toolbar の `#btn-help` を CSS で hide するため、 mobile でタッチ操作だけでは Help (キーボードショートカット一覧) を開けない。 BlueTooth キーボード接続時の `h` キーは引き続き動作する。 mobile 向け Help は本質的に「キーボード操作の説明」なので、 タッチ専用環境では存在しなくても害は少ないと判断 (専用 footer overflow メニューは将来検討)
- **RTL レイアウト**：drawer の slide 方向 (`translateX(-100%)` / `translateX(100%)`) は `dir=ltr` 前提で固定。 本実装の i18n 辞書 (`messages.en.ts` / `messages.ja.ts`) は LTR 言語のみ収録のため、 RTL は現状の i18n スコープ外。 将来 RTL 言語追加時に同時対応
- **PWA / `display-mode: standalone`**：本実装は配布物 HTML として動作することを前提に設計され、 ホーム画面追加 (A2HS) / manifest による PWA 化は提供していない。 PWA 起動時の status bar / safe-area 挙動は対象外
- **`.cmt-del` 即時削除後の focus 消失対処**：`.cmt-del` の click handler は `deleteComment` (`comments.ts:82`、 内部は `replaceComments` + `reapplyAllMarks`) の後に `onDeleted()` (= `renderComments`、 `comments.ts:132`) を呼んで cmt-list を再描画するため、 削除された card 内の focus が消失する。 既存 desktop でも同じ問題で本タスク前から存在。 §5.s 採用案 B では `.cmt-del` を drawer 自動 close 対象から外す方針のため対処も外す。 将来別タスクで `restoreFocusAfterClose` 相当の helper を `deleteComment` 後に呼ぶことで desktop / mobile 双方を改善する道筋を残す

## 2. ベースラインアーキテクチャ

リファレンス実装は存在しない（mdxg-redline 独自の chrome）。代わりに現状の chrome 構成を起点とし、 mobile 用の上書き層を 1 つ重ねる差分設計とする。

現状の chrome を 4 層に分解する：

1. **skip-link**（`src/review.html:240-244`、 `.skip-link` / `#skip-to-nav`） — DOM 先頭の visually-hidden focusable anchor。 Tab で最初に visible になりキーボードユーザーがナビゲーションにジャンプできる
2. **toolbar / header**（`src/review.html:247-404`、`.app-header` / `.toolbar-actions`） — 入力経路 (Open ▾) / status / 検索 / help / settings ボタンを並べる horizontal flex
3. **layout (3 列 grid)**（`src/review.html:466` `<main class="layout">`、`src/styles/review.css:114-145`） — `--page-nav-width` / `--comments-width` の CSS 変数で左右 sidebar の幅を制御。 `.doc-pane` はデフォルトで `overflow-y: auto` のスクロールコンテナ。 既存 `.page-nav { padding: 24px 16px }` / `.comments { padding: 56px 24px 32px }` で内側に余白を持つ
4. **search-bar**（`src/review.html:406-462`、`.search-bar`） — `f` キー / `#btn-search` で `.open` class を toggle する sticky bar (既存 z-index 未指定、 `header` 直下に流し込みで static stacking)
5. **toggle tabs**（`src/review.html:660-688`、`.page-nav-toggle-tab` / `.comments-toggle-tab`） — sidebar が closed の時だけ viewport 端に出る縦タブ

mobile 上書きは次の 1 対 1 写像で書ける：

| 既存要素                                        | mobile 時の置換                                                                                                                                                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.skip-link`                                    | desktop と同一動作。 drawer open 中は `inert` 付与で Tab 巡回から外す（drawer + mobile-footer に閉じるため）                                                                                                          |
| `.toolbar-actions` の 5 ボタン                  | `Open ▾` / `⚙ Settings` 以外を `display: none`（HTML は mutate せず CSS のみで分岐）                                                                                                                                  |
| `.app-header`                                   | `box-sizing: border-box; height: var(--mobile-header-height); padding` を一括再定義（§5.k / §8）                                                                                                                      |
| `.layout` の 3 列 grid                          | `grid-template-columns: minmax(0, 1fr)` で 1 列、 padding-bottom で footer 退避                                                                                                                                       |
| `.doc-pane` (section)                           | `body > main.layout > section.doc-pane { overflow-y: auto; min-height: 0 }` で再宣言（既存 900px の高 specificity な `visible` を同等以上で打ち消し、 §1 MUST / §5.h）                                                |
| `.page-nav` / `.comments` (grid 列)             | `position: fixed; transform: translateX(±100%)` で off-screen 化、 `<html>` の drawer-open class で slide-in。 既存 padding (`24px 16px` / `56px 24px 32px`) は維持し、 該当側だけ landscape inset を `calc()` で加算 |
| `.page-nav-toggle-tab` / `.comments-toggle-tab` | `display: none`（縦タブの代わりに footer ボタンが drawer trigger になる）                                                                                                                                             |
| toolbar の `#btn-search`                        | `display: none`（footer の `#btn-mobile-search` が `#btn-search` の click を委譲して toggle）                                                                                                                         |
| `.tooltipped::after`                            | `display: none`（タッチでは hover による tooltip 表示が機能しない）                                                                                                                                                   |

新規要素として `<footer class="mobile-footer">` と `<div class="mobile-drawer-backdrop">` の 2 つを review.html に追加する。既存 DOM の構造は変更しない（CSS layer での切り替えに統一する）。 配布物としては `dist/standalone.html` / `dist/embed-template.html` / online edition (`src/build/online-html.ts` 経由の rewrite 結果) の 3 経路すべてに同一 DOM が inline される (online-html.ts は CSP / embedded-\* 属性のみ rewrite し、 footer / backdrop ノードは保存される、 Step 6 で実機確認)。

## 3. 設計の中核要素

### 3.1 ブレークポイントとレイヤリング

新規 `@media (max-width: 768px)` を `src/styles/review.css` の既存 900px ブロック（l.1874-1920）の直後に追加する。 768px ブロックは「900px ブロックの差分上書き」として書き、 同一 specificity で後勝ちさせる（`!important` を使わない）。

| メディアクエリ                     | 想定対象       | 主要挙動                                                                           |
| ---------------------------------- | -------------- | ---------------------------------------------------------------------------------- |
| デフォルト (≥ 901px)               | desktop        | 3 列 grid / 左右 sidebar 開閉可能 / toggle tab で復元                              |
| `@media (max-width: 900px)` (既存) | タブレット狭幅 | body を vertical-stack、 `.page-nav` は hide、 `.comments` は本文下に縦積み        |
| `@media (max-width: 768px)` (新規) | スマホ         | fixed header + fixed footer + drawer、 sidebar は off-screen 化して JS で slide-in |

768-900px の中間域は既存の vertical-stack 挙動を維持する（タブレット端末でも TOC は隠れるが、 fixed footer / drawer モデルには切り替わらない）。

**cascade 上書きの不変条件**：既存 900px ブロックは複数の規則を **無条件で** 適用するため、 768px ブロック側で **明示的に再宣言** して打ち消す必要がある。 ただし **打ち消しセレクタは 900px 側と同じ specificity 以上で書く** ことが必須で、 単純に「後置きで後勝ち」には頼れない（specificity が異なると cascade は順序を無視して高 specificity 側が勝つ）。 900px ブロックは一部の規則を **子結合子つきの高 specificity セレクタ** (`body > main.layout` (0,0,1,2) / `body > main.layout > section` (0,0,1,3)) で書いているため、 flat なクラスセレクタ (`.doc-pane` (0,0,1,0) 等) では打ち消せない点に注意：

- `.page-nav { display: block; position: fixed; ... }`（900px の `.page-nav { display: none }` (0,0,1,0) と **同一 specificity**、 後置きで後勝ち）
- `.comments { display: block; position: fixed; border-top: none; border-left: ...; ... }`（900px の `.comments { border-top: ...; border-left: none }` (0,0,1,0) と同一 specificity、 後勝ち）
- `body > main.layout { flex: 1; min-height: 0 }`（900px の `body > main.layout { flex: none }` (0,0,1,2) を **同一 specificity で打ち消す**。 desktop 基底値 `review.css:103-105` に戻す。 flat な `.layout { flex: 1 }` (0,0,1,0) では負けるため必ず子結合子つきで書く。 これを忘れると main がコンテンツ高に膨らみ `body { overflow: hidden }` でクリップされ本文末尾に到達不能になる）
- `body > main.layout > section.doc-pane { overflow-y: auto; min-height: 0 }`（900px の `body > main.layout > section { overflow-y: visible }` (0,0,1,3) を **section.doc-pane で specificity を 1 つ上回って打ち消す**。 flat な `.doc-pane` (0,0,1,0) では負ける。 flex item の shrink を許してスクロールコンテナを成立させる）
- `body > main.layout > aside.page-nav, body > main.layout > aside.comments { overflow-y: auto }`（900px の `body > main.layout > aside.* { overflow-y: visible }` (0,0,1,3) を **同一 specificity で打ち消す**。 §1 SHOULD「drawer 内部の縦スクロール保持」が成立する。 flat な `.page-nav, .comments { overflow-y: auto }` (0,0,1,0) では負ける）
- `:root.comments-closed .comments, :root.page-nav-closed .page-nav { display: block }`（既存 `*-closed` (`.layout grid-template-columns` を 0 にする desktop 用 negative class、 (0,0,2,0)) と同一 specificity で打ち消す）

### 3.2 mobile-footer の DOM とプロトコル

```html
<footer
  class="mobile-footer"
  role="group"
  aria-label="Mobile actions"
  data-i18n-aria-label="mobile.footer_label"
>
  <button
    class="btn btn-ghost"
    id="btn-mobile-toc"
    aria-label="Show table of contents"
    aria-expanded="false"
    aria-controls="page-nav-list"
    data-i18n-aria-label="mobile.toc_aria"
  >
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><!-- three-bars-16 --></svg>
  </button>
  <button
    class="btn btn-ghost"
    id="btn-mobile-search"
    aria-label="Search the document"
    aria-pressed="false"
    data-i18n-aria-label="mobile.search_aria"
  >
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><!-- search-16 --></svg>
  </button>
  <button
    class="btn btn-ghost"
    id="btn-mobile-comments"
    aria-label="Show review comments"
    aria-expanded="false"
    aria-controls="cmt-list"
    data-i18n-aria-label="mobile.comments_aria"
  >
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      <!-- comment-discussion-16 -->
    </svg>
  </button>
</footer>
<div class="mobile-drawer-backdrop" id="mobile-drawer-backdrop"></div>
```

`<footer>` には **`role="group"` を明示的に付与** する。 `<footer>` が `<main>` の sibling + `<body>` 直下に配置されると HTML5 spec で implicit landmark role `contentinfo` を獲得するが、 `contentinfo` は WAI-ARIA 1.2 で「親文書に関する情報 (著作権 / publisher info 等) を含む landmark」と定義されており、 mobile-footer の「操作コマンド群」用途には意味的に不適切。 `role="group"` で上書きして grouping (関連 UI コマンドのまとまり) を明示する (§5.n)。 `role="group"` は composite widget ではないため `role="toolbar"` のような roving tabindex / 矢印キーパターンは要求されず、 3 ボタンを個別 Tab 巡回する標準挙動が維持される。

`mobile-drawer-backdrop` には **HTML の `hidden` 属性を付けない**。 表示制御は author CSS に完全集約する (`hidden` 属性は UA stylesheet `[hidden] { display: none }` で specificity (0,0,1,0) と低く、 author CSS の `.mobile-drawer-backdrop { display: ... }` で容易に上書きされてしまい二重管理になる、§5.l 参照)。

SVG path は [GitHub Primer Octicons](https://github.com/primer/octicons) の `three-bars-16.svg` / `search-16.svg` / `comment-discussion-16.svg` から `<path>` をそのまま inline する（既存 `#btn-search` / `#btn-help` / `#btn-settings` の inline 化方式と同一、 `viewBox="0 0 16 16"` + `fill="currentColor"` 規約）。

drawer 開閉のプロトコルは `<html>` の class で表現し、 既存の `comments-closed` / `page-nav-closed` 系（desktop の grid 列幅制御）と直交した独立 namespace とする：

| `<html>` class              | 意味                         | CSS 効果                                                                                                                                                               |
| --------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mobile-page-nav-open`      | 左 drawer (TOC) が open      | `.page-nav { transform: translateX(0) }` + backdrop の `display: block`                                                                                                |
| `mobile-comments-open`      | 右 drawer (Comments) が open | `.comments { transform: translateX(0) }` + backdrop の `display: block`                                                                                                |
| `mobile-drawer-open` (body) | いずれかの drawer が open    | `body { overflow: hidden; overscroll-behavior: contain }` + `.doc-pane { touch-action: none; overflow-y: hidden }` で背面 scroll lock (touch / wheel 双方を抑止、§5.h) |

drawer 同時 open は禁止（mutually exclusive、§5.j）。 さらに **drawer と search-bar も同時 open は禁止**（§5.m）。 TOC 開中に Comment ボタンを押すと TOC が閉じてから Comment が開き、 drawer 開中に Search ボタンを押すと drawer が閉じてから search-bar が開く。 加えて **viewport 幅が 768px を超えた瞬間に drawer が自動 close され、 JS が付けた DOM 属性 / class がすべて除去される**（§5.j-3）。

### 3.3 Search ボタンの接続方式

footer の `#btn-mobile-search` は **既存 `#btn-search` の `click()` を委譲する** 設計にする：

```ts
document.getElementById('btn-mobile-search')?.addEventListener('click', () => {
  // drawer が open なら先に閉じる (§5.m mobile overlay 相互排他)
  closeMobileDrawers({ restoreFocus: false })
  document.getElementById('btn-search')?.click()
})
```

これで search-bar の open/close、`f` キーとの整合性が 既存の `wireSearch` 経路 (`src/app/search/search.ts`) に集約され、 二重実行や状態ずれが構造的に発生しなくなる。 CSS で `#btn-search` を hide していても `HTMLElement.click()` は display と無関係に発火するため委譲は機能する。

`#btn-mobile-search` 自身の `aria-pressed` は、 `.search-bar` の `.open` class を **MutationObserver で監視して sync** する（`f` キー / Esc / 既存 `#btn-search` 経由の状態変化にも追従）。 単純な click 毎 toggle 近似だと `f` キーや Esc 経由の閉操作で sync が外れる、§5.d 参照。

### 3.4 safe-area / 動的 viewport の各オフセット共通変数化 + drawer 内側 padding の加算

header / footer の実効高さは safe-area inset を含めると端末ごとに変わる (iPhone 14 Pro Max では top 47px / bottom 34px、 iPhone SE では 0px)。 各 UI 部品 (footer / header / drawer / backdrop / `.layout` の padding) で固定値 `56px` を独立に書くと不整合が発生する (footer 実効高さ 90px に対し `.layout padding-bottom: 56px` だと本文末尾 34px が footer 裏に隠れる) ため、 CSS custom property で **1 か所に集約** する：

```css
:root {
  --mobile-header-height: calc(65px + env(safe-area-inset-top));
  --mobile-footer-height: calc(56px + env(safe-area-inset-bottom));
  --mobile-safe-left: env(safe-area-inset-left);
  --mobile-safe-right: env(safe-area-inset-right);
}
```

これを `@media (max-width: 768px)` 内のすべての位置指定 selector で共有する。 さらに `.app-header` / `.mobile-footer` には **`box-sizing: border-box`** を当て、 `height` で宣言した外寸の中に padding を取り込む。 これで safe-area inset の二重加算 (content-box の場合 height + padding-bottom + border で実寸が膨らむ) を防ぐ（§5.k）：

| 部品                      | 主要プロパティ                                                                                                                                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.app-header`             | `box-sizing: border-box; height: var(--mobile-header-height); padding: calc(16px + env(safe-area-inset-top)) calc(24px + var(--mobile-safe-right)) 16px calc(24px + var(--mobile-safe-left))`（既存 `padding: 16px 24px` を加算式で維持、 portrait でも左右 24px / 上下 16px が消えない、 §5.k） |
| `.mobile-footer`          | `box-sizing: border-box; height: var(--mobile-footer-height); padding: 0 var(--mobile-safe-right) env(safe-area-inset-bottom) var(--mobile-safe-left)`（border-box で外寸 = `--mobile-footer-height`、 内側コンテンツ高さは 56px - border-top）                                                  |
| `.layout`                 | `padding-bottom: var(--mobile-footer-height)` (本文末尾が footer 裏に隠れない)                                                                                                                                                                                                                   |
| `.doc-pane`               | `body > main.layout > section.doc-pane { overflow-y: auto; min-height: 0 }` + `body > main.layout { flex: 1; min-height: 0 }` (スクロールコンテナ成立、 子結合子つきで 900px の高 specificity を打ち消す、 §3.1 / §5.h)                                                                          |
| `.page-nav` (左 drawer)   | `top: var(--mobile-header-height); bottom: var(--mobile-footer-height); padding-left: calc(16px + var(--mobile-safe-left))` (既存 `padding: 24px 16px` の左 16px を維持しつつ landscape inset を加算、 §5.k)                                                                                     |
| `.comments` (右 drawer)   | `top: var(--mobile-header-height); bottom: var(--mobile-footer-height); padding-right: calc(24px + var(--mobile-safe-right))` (既存 `padding: 56px 24px 32px` の右 24px を維持しつつ landscape inset を加算)                                                                                     |
| `.mobile-drawer-backdrop` | `top: var(--mobile-header-height); bottom: var(--mobile-footer-height); left: 0; right: 0` (背景色だけなので左右 inset 不要)                                                                                                                                                                     |

landscape 時の左右 inset (`env(safe-area-inset-left/right)`) は notch / Dynamic Island 領域を避ける目的で footer / header / drawer (該当側のみ) の `padding` に反映する。 drawer 自身は viewport 端まで張り付かせる（背景 / border が画面端まで届く方が視覚的に綺麗）が、 内側 content は **既存 padding 値 + inset の `calc()`** でインデントする。 既存 `.page-nav { padding: 24px 16px }` / `.comments { padding: 56px 24px 32px }` の左 16px / 右 24px を 768px ブロックで個別 `padding-left` / `padding-right` で再定義すると後勝ち cascade で既存値が消えてしまうため、 必ず加算式にする（§5.k 採用案 D）。

### 3.5 mobile-footer のサイズ・パフォーマンス見積もり

| 項目                                                   | 増分の見積もり (gzip 後)                                  |
| ------------------------------------------------------ | --------------------------------------------------------- |
| `mobile-footer.ts` 新規 (約 250-300 行 TypeScript)     | < 1.5 KB                                                  |
| `review.html` (footer / backdrop / viewport meta 追加) | < 0.5 KB                                                  |
| `review.css` (`@media (max-width: 768px)` ブロック)    | < 2 KB                                                    |
| i18n キー 4 つ × 2 言語                                | < 0.25 KB                                                 |
| **合計**                                               | **+ 4 KB 前後**（standalone.html サイズに対し誤差レベル） |

実測コマンド（実行時は素のまま入力）：`gzip -c dist/standalone.html` の出力を `wc -c` でカウントして本タスク前後の値を比較し、 `+ 5 KB` を超える場合は §8 のサイズ超過リスクで列挙した対策を検討する。

ランタイム性能への影響は無視できる：drawer の open/close は単一 transition、 backdrop は単一 DOM 要素、 affordance キー抑制は `isMobileDrawerOpen()` の `<html>` class 参照 1 回。 matchMedia change handler も `<html>` class 操作 1 回のみ。

## 4. 実装ステップ

順序は依存関係順。各 Step 完了で `vp check --fix` / `vp test` を通し、 Step 2 / Step 6 で手動視覚チェック (Chrome DevTools mobile preset) を行う。

**公開仕様の同期は各 Step に分散する**：本タスクは CLI オプションや配布物ファイル名規約には影響しないが、 `viewport-fit=cover` の追加は HTML 配布物の公開仕様 (embed / online いずれも継承) に該当する。 Step 2 で `viewport-fit=cover` 追加と同 commit で DESIGN.md §10 を 1 行更新、 Step 6 で CSS 完了と同 commit で DESIGN.md §4 にモバイルレイアウト節を追記、 Step 7 で README_ja.md / README.md にモバイル操作節を追加する。 Step 8 はテンプレ通り最終整理（§12 表行の差分確認と archive 化のユーザー確認）に縮める。

### Step 1: (完了済み) i18n キーの追加

**状態**: **完了済み** — commit `94f2c2d`

- `src/app/i18n/messages.en.ts` / `messages.ja.ts` に `mobile.*` namespace を新設
- 追加キー：
  - `mobile.toc_aria` / `mobile.comments_aria` / `mobile.search_aria`（footer 3 ボタン用 aria-label）
  - `mobile.footer_label`（`<footer role="group">` の aria-label、 関連 UI コマンドの grouping ラベル。 en: "Mobile actions" / ja: "モバイル操作"。 implicit `contentinfo` を `role="group"` で上書き、 `role="toolbar"` は採用しない、§5.n）
- 既存の `toolbar.search_aria` / `page_nav.toggle_panel_aria` / `comments.toggle_panel_aria` は流用しない（mobile drawer trigger と desktop 縦タブで意味が異なるため、 文言を別系統で管理可能にしておく）
- キーの対称性は現状 `messages.ja.ts` の `satisfies Record<MessageKey, string>` で **型レベル**で担保されており、 両言語のキー数一致 / Set 一致を検証する **既存ランタイム test は無い**（i18n の in-source test は textContent / attribute 翻訳 / lang 切替などの挙動検証が中心）。 そこに **`Set(Object.keys(en)) ≡ Set(Object.keys(ja))` の symmetric_difference assertion** を新規追加する（型担保に加えてランタイムでも `mobile.*` の片側追加漏れを検出できるようにするため）

成果物：`src/app/i18n/messages.en.ts` / `messages.ja.ts` の 2 ファイル更新、 既存 i18n in-source test が pass、 新規 Set 一致 test が pass

### Step 2: (完了済み) review.html への footer / backdrop / viewport meta 追加 + footer hide skeleton CSS

**状態**: **完了済み** — commit `c2c7aa4`

- `<main class="layout">` の直後に `<footer class="mobile-footer">`（3 ボタン + Octicons SVG inline）
- `<div id="toast">` 近辺に `<div class="mobile-drawer-backdrop" id="mobile-drawer-backdrop">` (**`hidden` 属性は付けない**、 表示制御は author CSS に集約、§3.2 / §5.l)
- `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">` に変更（iOS safe-area inset を受け取るため）
- 既存ヘッダ・search-bar・toggle tabs の HTML は mutate しない
- **デスクトップでの視覚崩れを防ぐため**、 `src/styles/review.css` のグローバル領域（media query 外）に `.mobile-footer, .mobile-drawer-backdrop { display: none }` を先に追加する。 768px ブロックは Step 6 で footer を `display: flex` に、 backdrop は `:root.mobile-page-nav-open .mobile-drawer-backdrop, :root.mobile-comments-open .mobile-drawer-backdrop { display: block }` で drawer 開時のみ表示する
- 同 commit で DESIGN.md §10 ブラウザ互換性表に「iOS Safari / Android Chrome (≤ 768px) でフッターバー + drawer モデル」の 1 行を追加（公開仕様の同期）

成果物：`src/review.html` / `src/styles/review.css` (hide skeleton のみ) / `docs/DESIGN.md` の更新。 desktop / 既存 900px タブレット域に視覚回帰なし。

### Step 3: (完了済み) `src/app/chrome/mobile-footer.ts` 新規 + in-source test

**状態**: **完了済み** — commit `8fc0e0d`

純粋ロジックと DOM 操作を 1 ファイルで持つ薄いモジュール。 export 関数（**trigger は引数で受け取り、 close は focus 復元をオプション化** して切替時の lastTrigger 取り違えを防ぐ、§5.j-2）：

```ts
export function wireMobileFooter(): void
export function openMobilePageNav(trigger: HTMLElement): void
export function openMobileComments(trigger: HTMLElement): void
export function closeMobilePageNav(opts?: { restoreFocus?: boolean }): void
export function closeMobileComments(opts?: { restoreFocus?: boolean }): void
export function closeMobileDrawers(opts?: { restoreFocus?: boolean }): void
export function isMobileDrawerOpen(): boolean
```

実装要点：

- `wireMobileFooter()` 内で各 footer ボタンの click handler を登録：
  ```ts
  btnMobileToc.addEventListener('click', (ev) => {
    if (isMobilePageNavOpen()) {
      closeMobilePageNav() // 同ボタン再押下で close、 focus 復元あり
      return
    }
    openMobilePageNav(ev.currentTarget as HTMLElement)
  })
  ```
- **`applyMobileInertState()` helper を定義**（§5.j-4：drawer の inert / aria-hidden の単一責任管理）：
  ```ts
  function applyMobileInertState(): void {
    const isMobile = window.matchMedia('(max-width: 768px)').matches
    if (!isMobile) {
      // desktop: 両 drawer から inert / aria-hidden 除去 (mobile の残留状態をクリーンアップ)
      pageNav.removeAttribute('inert')
      pageNav.removeAttribute('aria-hidden')
      comments.removeAttribute('inert')
      comments.removeAttribute('aria-hidden')
      return
    }
    // mobile: 各 drawer の open 状態を見て付与 / 除去を二項分岐
    // (else 分岐で removeAttribute を確実に呼ばないと、 初期化時付与の inert が open 後も残留する)
    if (isMobilePageNavOpen()) {
      pageNav.removeAttribute('inert')
      pageNav.removeAttribute('aria-hidden')
    } else {
      pageNav.setAttribute('inert', '')
      pageNav.setAttribute('aria-hidden', 'true')
    }
    if (isMobileCommentsOpen()) {
      comments.removeAttribute('inert')
      comments.removeAttribute('aria-hidden')
    } else {
      comments.setAttribute('inert', '')
      comments.setAttribute('aria-hidden', 'true')
    }
  }
  ```
- **`wireMobileFooter()` 内で `window.matchMedia('(max-width: 768px)').addEventListener('change', ...)` を登録**：
  - `matches === true` (mobile 進入): `closeMobileDrawers({ restoreFocus: false })` (通常 desktop 上で drawer は閉じているため no-op、 万一開いてれば安全に close) → `applyMobileInertState()` で両 drawer に inert + aria-hidden 付与
  - `matches === false` (desktop 進入): `closeMobileDrawers({ restoreFocus: false })` で背面 3 要素から inert / aria-hidden 除去 + `<html>` の `mobile-*-open` / `<body>` の `mobile-drawer-open` 除去 → `applyMobileInertState()` の desktop ブランチが両 drawer から inert / aria-hidden を除去
  - idempotent 性保証のため `dataset.wired` flag で多重登録防止 (§5.j-3)
- **`wireMobileFooter()` 初期化時 (関数末尾) に `applyMobileInertState()` を 1 回呼ぶ**（§5.j-4：起動時の matchMedia.matches に応じて、 mobile なら両 drawer に inert + aria-hidden 付与、 desktop なら両 drawer から inert / aria-hidden を明示的に除去 (mobile 残留状態のクリーンアップ動作)）
- `openMobilePageNav(trigger)` の実装順序（§5.j-2 切替時 focus 取り違え対策）：
  1. **最初に `lastTrigger = trigger`** で新 trigger を保存（`document.activeElement` を見ない）
  2. 反対 drawer が open なら `closeMobileComments({ restoreFocus: false })` で focus 復元なしで close
  3. search-bar が open なら `#btn-search.click()` で close（§5.m mobile overlay 相互排他）
  4. `<html>` に `mobile-page-nav-open` 追加 + `body` に `mobile-drawer-open` 追加
  5. **背面 3 要素 (`.skip-link`, `.app-header`, `.doc-pane`) に `inert` + `aria-hidden="true"` 付与**（§5.j A 案、 `.skip-link` を含めて Tab 巡回が drawer 外へ脱出しないようにする。 反対 drawer (`.comments`) は §5.j-4 invariant に従い `applyMobileInertState()` が管理）
  6. **`applyMobileInertState()` を呼ぶ**（mobile ブランチで if-else 二項分岐：開いた `.page-nav` から inert / aria-hidden を除去、 閉じたままの `.comments` には付与継続。 desktop ブランチに来た場合は両 drawer から属性を除去するクリーンアップ動作）
  7. drawer 自身と mobile-footer は操作可能に残す（§5.j A 案）
  8. 該当 footer ボタンの ARIA state attribute を true に：TOC/Comment は `aria-expanded="true"`、 Search 経路は既存 `#btn-search` の click 委譲で `aria-pressed` が MutationObserver 経由 sync（§5.q / §3.3）
  9. **drawer 内の先頭 focusable element に focus を移す**（§5.j-5：`getFocusableElements(.page-nav)[0]?.focus()`。 DOM 順で drawer は footer より前にあるため、 footer ボタンに focus が残ったままだと通常 Tab で drawer 内に到達できない。 open 直後に明示的に focus を移すことで Tab 巡回が drawer 内から始まる）
  10. **Tab key 循環 trap を `document` に登録**（§5.j-5：drawer 末尾から Tab → mobile-footer 先頭、 footer 末尾から Tab → drawer 先頭、 同様に Shift+Tab で逆方向 wrap。 close 時に listener 解除）
- `closeMobilePageNav({ restoreFocus = true })`：
  1. `<html>` から `mobile-page-nav-open` 除去
  2. 他 drawer が open でなければ `body` から `mobile-drawer-open` 除去
  3. **背面 3 要素 (`.skip-link` / `.app-header` / `.doc-pane`) から `inert` / `aria-hidden` を除去**（反対 drawer は §5.j-4 invariant により別管理、 ここでは触らない）
  4. **`applyMobileInertState()` を呼ぶ**（mobile なら閉じた `.page-nav` に inert + aria-hidden 再付与、 desktop なら両 drawer から除去。 §5.j-3 / §5.j-4 の単一責任管理）
  5. 該当 footer ボタンの ARIA state attribute を false に：TOC/Comment は `aria-expanded="false"`、 Search 経路は `wireSearch` 側で search-bar が close されるのを MutationObserver が拾って `aria-pressed="false"` に sync（§5.q / §3.3）
  6. **Tab key 循環 trap listener を `document` から解除**（§5.j-5：drawer 閉時は Tab を通常巡回に戻す）
  7. `restoreFocus === true` のときだけ `lastTrigger?.focus()`
- backdrop の `display` 制御は CSS だけで完結 (JS は `<html>` class の add/remove のみ、 `hidden` 属性 / `style.display` には触らない、§5.l)
- 相互排他は §5.j (drawer 同士) と §5.m (drawer ↔ search-bar) の二重制約
- **`wireDrawerEditModalAutoClose()` を呼ぶ**（§5.s：`.comments` の click capture phase delegation で `.cmt-edit` (`data-edit` 属性) click を先取り、 `closeMobileComments({ restoreFocus: true })` で footer に focus 戻してから bubble phase で既存 Edit modal が open する。 `.cmt-del` は即時削除のため対象外）
- **navigation 経路の drawer 自動 close は §4 Step 5c で扱う**：TOC は `onCompositeSlugClick` 内 mobile 分岐 + `focusTOC` gate、 Comments は新規 `addOnCommentActivate(handler)` registry (`focusCommentCard` 内 fire) に mobile handler を register（§5.r：DOM selector ではなく activation hook で同一/別ページ全経路を一元的に拾う）
- `wireMobileFooter()` は idempotent（2 回呼んでも click handler / matchMedia listener / Edit modal trigger listener が重複しない、 `dataset.wired` フラグで gate）
- `.search-bar.open` を MutationObserver で監視し、 `#btn-mobile-search` の `aria-pressed` を sync する（§3.3）

in-source vitest ケース：

- TOC ボタン click で `mobile-page-nav-open` が付き、再 click で外れる
- TOC 開中に Comment click → TOC が閉じ Comment が開く（mutually exclusive、 §5.j）
- **切替時の lastTrigger 取り違え防止**：TOC 開中に Comment click → close 後の `lastTrigger` が Comment ボタンであり旧 TOC ボタンではないこと（§5.j-2）
- **`closeMobileXxx({ restoreFocus: false })` で focus が `lastTrigger` に戻らないこと**
- **`closeMobileXxx({ restoreFocus: true })` (default) で focus が `lastTrigger` に戻ること**
- backdrop click で `closeMobileDrawers` が全 drawer を閉じる
- footer Search ボタン click が drawer を先に閉じてから `#btn-search.click()` を委譲する（§5.m）
- search-bar open 中に TOC ボタン click で search-bar が閉じて drawer が開く（§5.m 逆方向）
- `.search-bar` の `.open` class 操作で `#btn-mobile-search` の `aria-pressed` が sync する（MutationObserver、 `f` キー / Esc 経由の状態変化に追従）
- **drawer open/close で `#btn-mobile-toc` / `#btn-mobile-comments` の `aria-expanded` が true / false に sync する**（§5.q：TOC/Comment は drawer の collapsible state を `aria-expanded` で表現、 既存 toggle tab 規約と整合）
- **`#btn-mobile-toc` の `aria-controls="page-nav-list"` / `#btn-mobile-comments` の `aria-controls="cmt-list"` が DOM 上に存在する**（HTML markup 検証、 `aria-controls` の値が drawer DOM の id と一致、 §5.q）
- **`window.matchMedia('(max-width: 768px)')` の change event で `matches: false` が来た時、 drawer / inert / open class がすべて除去される**（§5.j-3、 matchMedia mock を使って resize シナリオ検証）
- `wireMobileFooter` を 2 回呼んでも click handler / matchMedia listener が重複しない（idempotent）
- drawer open 中の `body` に `mobile-drawer-open` class が付き、close で外れる
- drawer open 中に **背面 3 要素 (`.skip-link` / `.app-header` / `.doc-pane`) に `inert` + `aria-hidden="true"` が付く**、 close で外れる (`<main>` / drawer 自身 / mobile-footer には付かないことの assertion、§5.j)
- **`wireMobileFooter()` 初期化時 (mobile 起動) に `applyMobileInertState()` が両 drawer (`.page-nav` / `.comments`) に `inert` + `aria-hidden="true"` を付与**（§5.j-4：全閉状態でも閉じた drawer が Tab / AT tree に残らない invariant）
- **`wireMobileFooter()` 初期化時 (desktop 起動) は `applyMobileInertState()` の desktop ブランチが両 drawer から inert / aria-hidden を明示的に除去する**（§5.j-4：mobile 残留状態のクリーンアップ動作で desktop で左右パネル操作が壊れない、 `removeAttribute` の spy で確認）
- **drawer open で開いた drawer から `inert` / `aria-hidden` が外れ、 close で再付与される (mobile)**（§5.j-4：「開いた drawer 以外は常に inert」の invariant）
- **backdrop の `hidden` 属性 / `style.display` を JS が触らないことの assertion**（CSS だけで制御されている保証、§5.l）

成果物：`src/app/chrome/mobile-footer.ts` + in-source test。 まだ wire は呼ばれないので runtime には影響しない。

### Step 4: (完了済み) `app-wiring.ts` で wire + 手動視覚チェック

**状態**: **完了済み** — commit `6557b93`（wire 配線 + `vp check` / `vp test` 通過。Chrome DevTools mobile preset の手動視覚チェックは実行環境の都合で未実施のため、CSS が揃う Step 6 の手動チェックにまとめて回す）

- `src/app/app-wiring.ts` の chrome 初期化フェーズで `wireMobileFooter()` を呼ぶ（`wireToolbar` の隣）
- Step 2 で footer hide skeleton CSS を入れているため、 desktop preset では footer / backdrop は引き続き hide される
- Chrome DevTools で iPhone SE / iPhone 14 Pro preset を切り、 footer ボタンの DOM が runtime にバインドされる確認（drawer は CSS が未適用なのでまだ視覚的には機能しない）

成果物：mobile-footer が runtime に組み込まれる。 desktop に視覚回帰なし、 mobile はまだ未完成だが Step 6 で完成する。

### Step 5: (完了済み) `global-keyboard.ts` の Esc / affordance キー抑制

**状態**: **完了済み** — commit `d21da6d`

- `src/app/chrome/global-keyboard.ts` の Escape handler 分岐に `closeMobileDrawers()` を追加（modal close より先に呼ぶ）
- affordance キー (`a` / `w` / `s` / `d` / `e` / `f` / `h`) の抑制条件に `isMobileDrawerOpen()` を OR で追加 — drawer open 中は背面操作を suppress
- 既存抑制条件 (`isAnyModalOpen()` 等) と並列に `isMobileDrawerOpen()` を OR で追加（mobile drawer は modal-backdrop class を持たないので `isAnyModalOpen` に拾われない、§5.j 参照）
- in-source test で `Escape` keydown が `closeMobileDrawers` を呼ぶことを確認、 affordance キーが drawer open 中に suppress されることを確認

**実装時の乖離**：計画では `isMobileDrawerOpen()` を `keyboard-shortcuts.ts` の `shouldSkipAffordanceKey()` に追加すると記述していたが、実コードでは `isAnyModalOpen()` は `shouldSkipAffordanceKey` ではなく `global-keyboard.ts` の `handleAffordanceKeys` の suppress 条件（`shouldSkipAffordanceKey(event) || !hasNoModifier(event) || isAnyModalOpen()`）に存在する。そのため「`isAnyModalOpen()` と並列に OR」という意図に忠実に、`global-keyboard.ts:handleAffordanceKeys` の同条件へ `|| isMobileDrawerOpen()` を追加した（`shouldSkipAffordanceKey` は editable target / repeat ガード専用のまま据え置き）。`keyboard-shortcuts.ts` は無変更。

成果物：キーボード接続時のスマホ / タブレットで drawer が Esc で閉じる。 affordance キーが drawer 背面で意図せず発火しない。

### Step 5b: (完了済み) `search-controller.ts` の focus timer 管理修正

**状態**: **完了済み** — commit `ccfce89`

`src/app/search/search-controller.ts` の focus 予約は `openSearch()` (`l.98`) が呼ぶ `resetSearchInput()` (`l.89`) 内の `setTimeout(() => input.focus(), 0)` (`l.94`) で行われる。 一方 `closeSearch()` (`l.114`) は `cancelPendingSearch()` (`l.106` の debounce timer cancel) を呼ぶが **focus timer は別管理で cancel されない**。 §5.m の mobile overlay 相互排他 (Search → drawer 切替) でこの timer 競合が顕在化する：

1. ユーザが Search 押下 → `openSearch()` → `resetSearchInput()` が `setTimeout` で input.focus() を予約 (delay 0)
2. ユーザが直後に TOC 押下 → `closeMobileDrawers({restoreFocus:false})` から `#btn-search.click()` 経由で `closeSearch()` (timer 残ったまま)
3. `openMobilePageNav` で drawer 開く、 `.page-nav` 内に focus
4. setTimeout タイマー発火 → **`input.focus()` が drawer 開後の非表示 input に focus を奪う**

修正内容：

- `resetSearchInput()` の `setTimeout` の return 値 (timer ID) を module-level 変数 `pendingFocusTimer` に保存（focus 予約はここで行われるため、 `openSearch` 直下ではなく `resetSearchInput` を修正する）
- `closeSearch()` の冒頭で `pendingFocusTimer !== null` なら `clearTimeout(pendingFocusTimer)` で cancel、 `pendingFocusTimer = null` にリセット（既存 `cancelPendingSearch()` の debounce timer cancel とは別系統）
- setTimeout callback の中でも `pendingFocusTimer = null` にリセット (二重 cancel 防止)
- in-source test：
  - `openSearch()` 直後 (timer pending 中) に `closeSearch()` を呼ぶと timer が cancel される (`clearTimeout` の spy で確認)
  - `openSearch()` → `closeSearch()` → 別 element に focus → setTimeout delay 経過後も focus が input に戻らない (vi.useFakeTimers で時刻を進めて確認)

成果物：`src/app/search/search-controller.ts` 更新 + in-source test。 mobile overlay 相互排他 (§5.m) で focus 競合が発生しない。 desktop 経路 (`f` キー → Esc → 別 button focus) も同じ修正で安全になる。

### Step 5c: (完了済み) `navigation-orchestrator.ts` mobile 分岐 + `comments.ts` activation registry 追加 + `comment-modal.ts` の focus 復元契約 + 50ms timer 管理

**状態**: **完了済み** — commit `f51eb73`

TOC 側の `src/app/navigation/navigation-orchestrator.ts` の `onCompositeSlugClick` (`l.165`) は **TOC 全経路 (`.page-nav-link` / `.page-outline-link` / `.page-nav-sequential-link` の click + Enter キー) の単一 entry point** なので、 内部に mobile 分岐 + `focusTOC` gate を追加する。

Comments 側の既存 `setOnCommentNavigate` (`comments.ts:20-22`) は **単一変数代入 (registry / chain ではない)** で、 review.ts (composition root) が `navigateToTarget` を 1 件 register する用途。 さらに `requestNavigateToCommentPage` (`comments.ts:42`) は **`focusCommentCard()` 内の別ページ判定時のみ発火** し、 同一ページの comment カード click / Enter は `focusCommentCard()` 内で直接処理される。 そのため `setOnCommentNavigate` を再登録すると既存 navigation が失われ、 かつ同一ページ経路を拾えない (2 重に間違い)。

→ Comments 側は新規 `addOnCommentActivate(handler)` registry (Set) を `comments.ts` に追加し、 `focusCommentCard()` の **各分岐の return 前** (別ページ `requestNavigateToCommentPage` 後 / 同一ページ mark 不在 early return 前 / 同一ページ scroll 完了後) で fire することで同一/別ページ / mark 不在問わず activation を register handler に通知する設計に切替。

加えて `comment-modal.ts` には現状：

- focus 復元処理が無い (`closeCommentModal` は modal-input.value reset のみ、 `comment-modal.ts:72`)
- 共通 helper `showModalWithBody` (`l.40-48`) が `setTimeout(() => qsInput('#modal-input').focus(), 50)` で **50ms 後の input focus を予約**、 cancel する経路がない

→ `showModalWithBody` (`openEditCommentModal` と private `openModal` 両経路が経由する共通 helper) に `lastTrigger` 保存 + `pendingFocusTimer` 管理を追加、 `closeCommentModal` で `clearTimeout` + focus 復元する契約を §4 Step 5b の search-controller と同 pattern で導入する。

修正内容：

**(1) `navigation-orchestrator.ts`**：

`onCompositeSlugClick(compositeSlug, keyboardActivated)` 内に `focusTOC` という local 変数は存在しない。 `focusTOC` は `navigateToTarget(target, pushHash, focusTOC = false)` (`l.133-136`) の **第 3 引数**で、 `onCompositeSlugClick` から `keyboardActivated` をそのまま渡している (`l.166`)。 mobile drawer 経路で `focusTOC` の復元を抑止するには **第 3 引数を `false` 強制で呼ぶ** 形に修正する：

```ts
export const onCompositeSlugClick = (compositeSlug: string, keyboardActivated: boolean): void => {
  const mobileDrawerOpen = isMobilePageNavOpen()
  navigateToTarget(
    resolveTargetFromHash(`#${compositeSlug}`),
    true,
    mobileDrawerOpen ? false : keyboardActivated // mobile では focusTOC を false 強制 (第 3 引数)
  )
  if (mobileDrawerOpen) {
    closeMobilePageNav({ restoreFocus: false })
    document.querySelector<HTMLElement>('.doc-pane')?.focus({ preventScroll: true })
  }
}
```

これで mobile drawer 経路では `navigateToTarget` 内の `focusNavigatedLink` 呼出 (`l.146-151`) がスキップされ、 inert TOC link への focus 競合を構造的に回避。 desktop 既存挙動 (`keyboardActivated` がそのまま `focusTOC` に渡る) は無変更。

**(2) `comments.ts`**：

既存 `setOnCommentNavigate` (`comments.ts:20-22`) は **単一変数 `onNavigateToCommentPage` への代入** であり registry / chain ではないため、 wireMobileFooter から再登録すると review.ts (composition root) が注入した既存 `navigateToTarget` 経路が失われる。 さらに `requestNavigateToCommentPage` (`l.42`) は `focusCommentCard` (`l.48-61`) 内の **別ページ判定 (`comment.pageIndex !== state.activePageIndex`) 時のみ発火** し、 同一ページの comment カード click / Enter キーは `focusCommentCard` 内で直接処理されるため callback 経由しない。

→ 既存 `setOnCommentNavigate` は触らず、 **`focusCommentCard()` 内から常に呼ばれる activation registry を新規追加**：

- `comments.ts` に新規 export：
  ```ts
  // chain 対応の registry (Set) で複数 handler を register 可能、 既存 setOn* の単一代入問題を避ける
  const onCommentActivateHandlers = new Set<(comment: Comment) => void>()
  export const addOnCommentActivate = (handler: (comment: Comment) => void): (() => void) => {
    onCommentActivateHandlers.add(handler)
    return () => onCommentActivateHandlers.delete(handler) // unregister 関数を返す
  }
  const fireCommentActivate = (comment: Comment): void => {
    for (const handler of onCommentActivateHandlers) handler(comment)
  }
  ```
- `focusCommentCard()` の **末尾** (同一ページ処理 / 別ページ `requestNavigateToCommentPage` 経由の `navigateToComment` 完了後) で `fireCommentActivate(comment)` を呼ぶ → mobile handler の `.doc-pane.focus()` を最後に走らせ、 別ページ経路で `navigateToComment` (`navigation-orchestrator.ts:175-185`) の `newCard.focus()` を **上書き** することで mobile では最終的に `.doc-pane` に focus が残る (同一ページ経路は scroll + mark active 後に fire)
- `mobile-footer.ts` 経由で composition root (`review.ts`) が mobile drawer handler を register：
  ```ts
  addOnCommentActivate((comment) => {
    if (!isMobileCommentsOpen()) return // desktop は no-op
    closeMobileComments({ restoreFocus: false })
    document.querySelector<HTMLElement>('.doc-pane')?.focus({ preventScroll: true })
  })
  ```

**(3) `comment-modal.ts`**：

`comment-modal.ts` には focus 復元処理が無く、 加えて `showModalWithBody` (`l.40-48`、 共通 helper) が `setTimeout(() => qsInput('#modal-input').focus(), 50)` で **50ms 後の input.focus() を予約** する。 open 直後に Esc / Cancel すると、 footer に focus 復元した後で timer が発火し非表示 input に focus が奪われる (§4 Step 5b の `search-controller.ts` と全く同じ問題)。

→ 共通 helper `showModalWithBody` に focus 復元契約 + pendingFocusTimer 管理を追加：

```ts
// module-level
let lastTrigger: HTMLElement | null = null
let pendingFocusTimer: ReturnType<typeof setTimeout> | null = null

const showModalWithBody = (quote: string, body: string): void => {
  if (isSearchOpen()) closeSearch()
  // 新規：activeElement を lastTrigger に保存 (openModal / openEditCommentModal 両経路で機能)
  lastTrigger = document.activeElement as HTMLElement | null
  qs('#modal-quote').textContent = `“${quote}”`
  qsInput('#modal-input').value = body
  qs('#modal').classList.add('open')
  // 新規：timer ID を保存して cancel 可能に
  pendingFocusTimer = setTimeout((): void => {
    qsInput('#modal-input').focus()
    pendingFocusTimer = null
  }, 50)
}

export const closeCommentModal = (): void => {
  // 新規：modal が実際 open でない場合は no-op (Escape の連続押下 / drawer・search・menu の
  // Escape 経路で `global-keyboard.ts:56` の `closeAllModalsForEscape` が無条件で
  // closeCommentModal() を呼ぶため、 modal closed 状態で `restoreFocusAfterClose(null)` まで
  // 進んで focus が `.doc-pane` / footer に奪われる回帰を構造的に防ぐ)
  if (modalState.current.kind === 'closed') {
    return
  }
  // 既存：pending timer を cancel (focus が input に奪われるのを防ぐ)
  if (pendingFocusTimer !== null) {
    clearTimeout(pendingFocusTimer)
    pendingFocusTimer = null
  }
  qs('#modal').classList.remove('open')
  modalState.current = { kind: 'closed' }
  // 既存処理...
  // 新規：focus 復元 + isConnected + visibility フォールバック
  // `saveEditedComment` (l.142-149) は `renderComments()` で cmt-list を再描画してから本関数を呼ぶ
  // ため、 lastTrigger (= 旧 Edit ボタン) が DOM から detach されている。 isConnected + 表示状態を
  // 確認し、 同一 comment id の新 Edit ボタンや footer Comment button に fallback する。
  const trigger = lastTrigger
  lastTrigger = null
  restoreFocusAfterClose(trigger)
}

// isConnected と祖先の display / visibility / inert を確認するだけでは不十分：
// `#floater` の `mousedown` handler が `event.preventDefault()` で focus 移動を抑止する
// (`comment-modal.ts:179`) ため、 modal open 直前の `document.activeElement` は floater ではなく
// `<body>` 等の元の active element になる。 `<body>` は祖先 chain では visible だが、
// HTML spec で focusable element ではないため、 element 自身が focusable selector に match するかを
// 最初に確認する必要がある。
//
// FOCUSABLE_SELECTOR は既存 `static-modal.ts:133-140` の規約と統一 (一貫した focus 判定基準)。
// happy-dom はレイアウト計算を行わず `getBoundingClientRect()` / `offsetParent` を実装しないため、
// size / layout 依存の判定 (旧 size 判定) は使わない (`static-modal.ts:132` の規約と同じ)。
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const isFocusable = (el: HTMLElement | null): boolean => {
  if (!el || !el.isConnected) return false
  // 要素自身が focusable element か確認 (`<body>` / `<div>` 等は除外)
  if (!el.matches(FOCUSABLE_SELECTOR)) return false
  // 祖先 chain で display / visibility / inert を辿る (祖先伝播の確認)
  let current: HTMLElement | null = el
  while (current) {
    if (current.hasAttribute('inert')) return false
    const style = window.getComputedStyle(current)
    if (style.display === 'none') return false
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false
    current = current.parentElement
  }
  return true
}

const restoreFocusAfterClose = (trigger: HTMLElement | null): void => {
  if (isFocusable(trigger)) {
    trigger!.focus({ preventScroll: true })
    return
  }
  // trigger が re-render で detach / hide / `<body>` 等の非 focusable の場合、 同一 comment id の新 Edit ボタンへ
  const commentId = trigger?.closest('.cmt-card')?.getAttribute('data-id')
  if (commentId) {
    const newEditBtn = document.querySelector<HTMLElement>(
      `.cmt-card[data-id="${commentId}"] .cmt-edit`
    )
    if (isFocusable(newEditBtn)) {
      newEditBtn!.focus({ preventScroll: true })
      return
    }
  }
  // 最終フォールバック：mobile なら footer Comment button、 desktop なら doc-pane
  // `:not([hidden])` だけでは CSS `display: none` の `.mobile-footer` 配下の button も一致してしまう
  // (`[hidden]` attribute selector は HTML hidden 属性のみが対象、 CSS display は見ない)。
  // matchMedia で mobile 状態を判定して分岐する。
  const isMobile = window.matchMedia('(max-width: 768px)').matches
  const fallback = isMobile ? document.querySelector<HTMLElement>('#btn-mobile-comments') : null
  ;(fallback ?? document.querySelector<HTMLElement>('.doc-pane'))?.focus({
    preventScroll: true,
  })
}
```

`openEditCommentModal` (Edit 経路、 `l.65`) と private `openModal` (新規追加経路、 `l.58`) はいずれも `showModalWithBody` を呼ぶため、 共通 helper に契約を置くことで両経路で focus 復元 + timer cancel が成立。 加えて `saveEditedComment` 経路 (`renderComments() → closeCommentModal` で `lastTrigger` が detach される) でも isConnected フォールバックで focus が消失しない。

in-source test：

- `onCompositeSlugClick`：mobile drawer open 状態で呼ぶと `navigateToTarget` の第 3 引数が `false` 強制で渡される (`navigateToTarget` の spy で第 3 引数を assert)、 `closeMobilePageNav` + `.doc-pane.focus()` が呼ばれること
- `addOnCommentActivate` registry：複数 handler を register でき、 unregister 関数が機能する (chain 性の保証)
- `focusCommentCard` 呼出時に register 済み handler すべてが fire される (同一ページ / 別ページ両方のシナリオで)
- mobile drawer open 状態で `focusCommentCard(comment)` (同一ページの comment) → mobile handler が `closeMobileComments` + `.doc-pane.focus()` を呼ぶこと
- `showModalWithBody` 呼出で `lastTrigger = document.activeElement` が保存されること、 `closeCommentModal` で `lastTrigger.focus({preventScroll: true})` + `lastTrigger = null` リセットが走ること (`focus` の spy 確認)
- `showModalWithBody` 直後 (50ms 経過前) に `closeCommentModal` を呼ぶと `clearTimeout` が呼ばれ、 vi.useFakeTimers で 50ms 進めても #modal-input に focus が戻らないこと (§4 Step 5b と同 pattern)
- desktop の Edit modal open → save / cancel で trigger button に focus が戻る regression test

成果物：`src/app/navigation/navigation-orchestrator.ts` / `src/app/comments/comments.ts` (`addOnCommentActivate` 追加、 `focusCommentCard` 内発火) / `src/app/comments/comment-modal.ts` (`showModalWithBody` に lastTrigger 保存 + timer 管理、 `closeCommentModal` に focus 復元 + timer cancel) 更新 + in-source test。 全 comment activation 経路 (同一/別ページ問わず) で mobile drawer 自動 close + focus 退避、 Edit/新規追加 modal Cancel で footer に focus 復元、 50ms timer 競合も解消される。

**実装時の補足**：

- `onCompositeSlugClick` の `navigateToTarget` 第 3 引数は no-ternary lint 制約のため `mobileDrawerOpen ? false : keyboardActivated` ではなく `!mobileDrawerOpen && keyboardActivated` の boolean 式で表現した（結果は同値）。
- `mobile handler の register` は `mobile-footer.ts` の `wireMobileFooter()` 内 (`attachMobileFooterListeners` 経由) で `addOnCommentActivate` を呼ぶ形にした。`isMobileCommentsOpen` / `closeMobileComments` は同モジュール内のため composition root を介さず直接利用できる。
- `isFocusable` は max-statements (10) 制約のため `isHiddenByStyle` / `isHiddenByAncestors` に分割した（ロジックは計画と同値）。`isFocusable` は private のため、§6 の boundary 列挙を個別 unit test にはせず、`closeCommentModal` の観測可能な復元挙動 (trigger focusable → 戻る / detach → 同 id 新 Edit ボタン / `<body>` → desktop は `.doc-pane` / mobile は footer Comment button) で網羅検証した。
- `onCompositeSlugClick` の in-source test は `navigateToTarget` が同一モジュール内のため spy で第 3 引数を直接 assert する代わりに、`state.pages` 空 (= `setActivePageIndex(0)` が範囲外 false で renderAll を回避) の fixture で「mobile 時に drawer close + `.doc-pane` focus / desktop 時に no-op」の観測可能挙動を検証した。
- comment activation registry のテスト (`comments.ts`) は `renderComments` + card click 経由で private `focusCommentCard` を起動し、同一ページ + mark / mark 不在 / 別ページの 3 分岐すべてで handler 発火を検証した。別ページテストは `setOnCommentNavigate` をスタブ化するため、実 `navigateToComment` の `newCard.focus()` を mobile handler の `.doc-pane.focus()` が上書きする **fire 順序 invariant** は自動テストでは守られない（comments.ts に orchestrator を import すると comments↔orchestrator の循環 import を招くため）。この順序検証は §6 手動チェックリスト「別ページ comment → drawer 自動 close → `.doc-pane` 退避」に委ねる。

### Step 6: (完了済み) `review.css` に `@media (max-width: 768px)` ブロック追加 + 手動視覚チェック + DESIGN.md §4 更新

**状態**: **完了済み** — commit `8352b0e`（768px ブロック + reduced-motion 合成クエリ実装、DESIGN.md §4 追記、gzip 増分 +3.72KB を実測で確認 (受け入れ基準 +5KB 以内)、`vp check` / `vp test` 通過。**Chrome DevTools mobile preset / iOS Safari 実機の手動視覚チェック (本文 §6 のチェックリスト全項目) は headless 実行環境の都合で未実施**。CSS specificity / 既存値維持 / selector 整合 / source 順 / 回帰防止はサブエージェントで静的検証済みだが、`.doc-pane` の縦スクロール成立・safe-area inset 反映・drawer slide-in・横スクロール非発生などの視覚挙動は実機 / DevTools での確認が別途必要)

- Step 2 で追加した hide skeleton はそのまま残し、 既存 900px ブロックの直後（l.1920 直後）に 768px ブロックを追加
- まず `:root` に CSS custom property を定義 (§3.4)：

  ```css
  :root {
    --mobile-header-height: calc(65px + env(safe-area-inset-top));
    --mobile-footer-height: calc(56px + env(safe-area-inset-bottom));
    --mobile-safe-left: env(safe-area-inset-left);
    --mobile-safe-right: env(safe-area-inset-right);
  }
  ```

- 主要 selector（`@media (max-width: 768px)` 内）：
  - `body { display: flex; overflow: hidden; height: 100vh; height: 100dvh; overscroll-behavior: contain }`（二段宣言で `dvh` 未対応ブラウザ fallback、 `overscroll-behavior: contain` で iOS momentum scroll の連鎖を断つ）
  - `body.mobile-drawer-open { overflow: hidden }`（追加 lock、 drawer 閉時の通常スクロールには影響しない）
  - `body.mobile-drawer-open > main.layout > section.doc-pane { touch-action: none; overflow-y: hidden }`（**背面の `.doc-pane` のみ** タッチ操作と wheel scroll を抑制。 `touch-action: none` は touch pan / zoom 用、 `overflow-y: hidden` は wheel event (マウスホイール / トラックパッド) 用の defence in depth。 drawer 自身の `overflow-y: auto` は触らないので機能を保持、§5.h。 子結合子つきで書くのは 900px の高 specificity 規則を上回るため）
  - `.layout { grid-template-columns: minmax(0, 1fr); padding-bottom: var(--mobile-footer-height) }`
  - `body > main.layout { flex: 1; min-height: 0 }`（**900px ブロックの `body > main.layout { flex: none }` (0,0,1,2) を同一 specificity で打ち消す**。 desktop 基底値 `review.css:103-105` に戻し、 main を 100dvh 内に収める。 これを怠ると main がコンテンツ高に膨らみ `body { overflow: hidden }` でクリップされ本文末尾に到達不能、§1 MUST / §5.h）
  - `body > main.layout > section.doc-pane { overflow-y: auto; min-height: 0 }`（**900px ブロックの `body > main.layout > section { overflow-y: visible }` (0,0,1,3) を `section.doc-pane` で 1 つ上回って打ち消す**。 flat な `.doc-pane` (0,0,1,0) では specificity 負けする。 flex item の shrink を許してスクロールコンテナ成立、§1 MUST / §5.h）
  - `.app-header { box-sizing: border-box; height: var(--mobile-header-height); padding: calc(16px + env(safe-area-inset-top)) calc(24px + var(--mobile-safe-right)) 16px calc(24px + var(--mobile-safe-left)) }`（既存 `padding: 16px 24px` を加算式で維持、 portrait でも左右 24px / 上下 16px が消えず、 landscape では notch 側のみ inset 加算、§5.k）
  - `.app-header #status, .app-header #online-source, .app-header #btn-search, .app-header #btn-help { display: none }`
  - `.page-nav, .comments { position: fixed; top: var(--mobile-header-height); bottom: var(--mobile-footer-height); width: min(86vw, 360px); z-index: 60; transition: transform .2s ease; display: block; border-top: none }`（`position` / `display` / `border-top` 等は 900px の flat 規則 (0,0,1,0) と同一 specificity で後勝ち）
  - `body > main.layout > aside.page-nav, body > main.layout > aside.comments { overflow-y: auto }`（**900px の `body > main.layout > aside.* { overflow-y: visible }` (0,0,1,3) を同一 specificity で打ち消す**。 `position: fixed` でも DOM 上は `main.layout` の子のままなので子結合子セレクタに引き続き match する。 flat な `.page-nav, .comments { overflow-y: auto }` (0,0,1,0) では specificity 負けして drawer 内部スクロールが効かない、 §1 SHOULD「drawer 内部の縦スクロール保持」/ §5.h）
  - **`.page-nav { left: 0; transform: translateX(-100%); border-right: 1px solid var(--rule); padding-left: calc(16px + var(--mobile-safe-left)) }`**（既存 `padding: 24px 16px` の左 16px を維持しつつ landscape inset を加算、 §5.k 採用案 D）
  - **`.comments { right: 0; transform: translateX(100%); border-left: 1px solid var(--rule); padding-right: calc(24px + var(--mobile-safe-right)) }`**（既存 `padding: 56px 24px 32px` の右 24px を維持しつつ landscape inset を加算）
  - `:root.mobile-page-nav-open .page-nav { transform: translateX(0) }` / `:root.mobile-comments-open .comments { transform: translateX(0) }`
  - `:root.comments-closed .comments, :root.page-nav-closed .page-nav { display: block }`（mobile では `*-closed` を打ち消す）
  - `.mobile-drawer-backdrop { position: fixed; top: var(--mobile-header-height); bottom: var(--mobile-footer-height); left: 0; right: 0; background: rgba(31, 35, 40, 0.5); z-index: 55 }`（display は Step 2 のグローバル `display: none` のまま、 `:root.mobile-X-open` で `display: block` に切替）
  - `:root.mobile-page-nav-open .mobile-drawer-backdrop, :root.mobile-comments-open .mobile-drawer-backdrop { display: block }`
  - `.mobile-footer { box-sizing: border-box; position: fixed; left: 0; right: 0; bottom: 0; height: var(--mobile-footer-height); padding: 0 var(--mobile-safe-right) env(safe-area-inset-bottom) var(--mobile-safe-left); z-index: 70; display: flex; justify-content: space-around; align-items: center; background: var(--paper-edge); border-top: 1px solid var(--rule) }`（`box-sizing: border-box` で外寸 = `--mobile-footer-height`、 padding-bottom の二重加算を防ぐ、§5.k）
  - `.page-nav-toggle-tab, .comments-toggle-tab, .comments-resize-handle, .page-nav-resize-handle, [data-block-id]:hover::before, .tooltipped::after, .tooltipped::before { display: none }`
  - `:root:not(.has-pages) #btn-mobile-toc { display: none }`
  - `.search-bar.open { z-index: 80 }`（footer 70 の上に重ねる。 既存 `.search-bar` は z-index 未指定なので 80 で確実に上に来る）
  - **mobile-search-bar の compact 化 (§5.p)**：既存 `.search-bar` (review.css l.1108-1150) は内部要素合計が `padding 48 + gap 32 + input min-width 200 + count min-width 80 + 3 ボタン ~90 = ~450px` で iPhone SE (375px) 幅を超えて横スクロールするため、 mobile では以下を再定義：
    - `.search-bar { padding: 8px 12px; gap: 6px }`（左右 padding 24→12、 gap 8→6）
    - `.search-input { box-sizing: border-box; min-width: 0; min-height: 44px; font-size: 16px }`（min-width 200→0 で flex:1 が残り領域を伸縮。 **`min-height: 44px`** で WCAG 2.5.5 / Apple HIG 推奨の 44px tap target を確保。 加えて **`font-size: 16px`** で iOS Safari の input フォーカス時 viewport auto-zoom を抑止。 既存 14px ではフォーカス時に画面が自動拡大されて UX が分断される）
    - `.search-count { min-width: 0; font-size: 11px; flex-shrink: 0 }`（80→0、 font 12→11px、 件数表示は残しつつ最小幅で）
    - `.search-action { box-sizing: border-box; min-width: 44px; min-height: 44px; padding: 4px 6px; flex-shrink: 0 }`（**`min-width/min-height: 44px`** で 3 操作ボタン (`↑` / `↓` / `×`) の tap target を §5.o footer 3 ボタンと同水準の 44×44 に確保。 `box-sizing: border-box` で既存 `.search-action` の content-box 計算 (outer ~24px) を上書き）
    - 結果として 375px 内訳：左右 padding 24 + gap 24 + count compact ~30 + 3 ボタン 44×3 = 132 = 210px、 残り **input 領域 = 165px** で収まる (mobile UI 標準 ~150px と同等で実用十分)
    - search-bar 行高は button 44 + 上下 padding 8×2 + border 1 ≈ **約 61px** に伸びる (旧 desktop ~30px から +31px)。 mobile では tap target 確保のトレードオフとして許容
  - **mobile-footer ボタンの styling と tap target (§5.o)**：
    - `.mobile-footer .btn { box-sizing: border-box; min-height: 44px; min-width: 44px; padding: 12px; line-height: 1 }`（WCAG 2.5.5 / Apple HIG 推奨の 44×44 CSS pixel タップ target を確保。 既存 `.btn` は `box-sizing` 未指定 = `content-box` のため `border-box` を明示しないと outer = `min-height + padding + border = 44 + 24 + 2 = 70px` で footer 内側 55px から overflow する。 `line-height: 1` は既存 `.btn` の `line-height: 20px` が content size に効くのを抑制し icon 16px のみが content として計算されるようにする）
    - `.mobile-footer .btn-ghost:hover { background: color-mix(in srgb, var(--accent) 8%, transparent) }`（既存 `.btn-ghost:hover` は `var(--paper-edge)` で footer 背景と同色になり hover が visual に消えるため、 mobile では accent 8% に上書き）
    - `.mobile-footer .btn-ghost[aria-pressed="true"], .mobile-footer .btn-ghost[aria-expanded="true"] { color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); border-color: color-mix(in srgb, var(--accent) 35%, transparent) }`（既存 `.btn-active` (l.950-955) と同じ色で drawer / search-bar の open 状態を visual 表現。 TOC/Comment は `aria-expanded`、 Search は `aria-pressed` の OR selector で両方を拾う、§5.o / §5.q）
    - `.mobile-footer .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }`（**既存 review.css に `.btn:focus-visible` 規則は無く** UA stylesheet の default focus ring に依存している現状。 mobile では自前 outline を明示し、 keyboard focus 可視性を保証する。 共通 `.btn:focus-visible` 規則の追加は本タスクのスコープ外、 desktop は既存挙動のまま）
- **768px ブロックの後**に `@media (max-width: 768px) and (prefers-reduced-motion: reduce) { .page-nav, .comments { transition-duration: 0s } }` の合成 media query を追加（既存 reduced-motion ブロック l.1813 は 768px ブロックより前にあり、 768px の `transition: transform .2s ease` で `transition-duration: 0s` が後勝ち cascade で上書きされてしまうため、 mobile 用に別 media query で確実に上書き、§5.i）
- 手動視覚チェック（Chrome DevTools mobile preset）：
  - footer が viewport 下端に張り付く
  - safe-area inset が反映されている (iPhone 14 Pro preset で footer 外寸が `56 + 34 = 90px`、 内側コンテンツ高さ 56px、 layout padding-bottom / drawer bottom も同期)
  - header 外寸が `65 + 47 = 112px` (iPhone 14 Pro notch)、 内側 toolbar (`.btn` 32px) が overflow せず縦中央寄せで表示される
  - `.doc-pane` が縦スクロールできる (long markdown で確認、 §1 MUST)
  - TOC / Comment drawer の slide-in アニメーション
  - drawer 内部を縦スクロールできる (TOC の長いリスト / Comments の cmt-list で内部 scroll が機能)
  - drawer 内側 padding が portrait で既存値 (左 drawer 16px / 右 drawer 24px) を維持される (§5.k 採用案 D)。 landscape の左右 notch inset 加算は **iPhone では drawer モデル対象機種 (SE / 6/7/8 系) に notch がなく、 notch を持つ機種 (12 Pro / 14 Pro Max 等) は landscape で 768px 超えてタブレット (vertical-stack) モデルか desktop モデルに切替** で drawer 自身が表示されないため実機検証経路が存在しない。 Chrome DevTools の Custom viewport (例 760×400) で 768px 直下の狭幅 landscape を再現し、 `calc(16px + var(--mobile-safe-left))` 等の式が DOM 上ロードされていることのみ確認する
  - search-bar が drawer / footer に被らない
  - drawer 開中に Search ボタン → drawer が閉じて search-bar が開く（§5.m）
  - search-bar 開中に TOC ボタン → search-bar が閉じて drawer が開く（§5.m 逆方向）
  - **mobile で drawer 開状態から DevTools で viewport を desktop (1920×1080) に切り替え → drawer が自動 close、 `.app-header` / `.doc-pane` / `.comments` が `inert` 残留せず操作可能に戻る**（§5.j-3 / §1 MUST）
  - desktop preset (1920×1080) / 既存 900px タブレット域 (800×600) に回帰がない
  - `dist/embed-template.html` を `file://` で直接開いても footer / backdrop DOM が inline されている（CLI 経路の配布物）
  - online edition (`dist/hosting/index.html`) でも mobile preset で同じ挙動になる
- gzip サイズ実測：本タスク前後の `dist/standalone.html` を gzip 圧縮してバイト数を比較し、 受け入れ基準（§7）の `+ 5 KB 以内` を確認。 コマンド例：`gzip -c dist/standalone.html` の出力を `wc -c` でカウント（markdown table セルに pipe を直接書けないため §8 のリスク表内では言い換えて記載）
- 同 commit で DESIGN.md §4 アーキテクチャの末尾に「モバイルレイアウト (≤ 768px)」サブ節を追加（fixed header + fixed footer + drawer の 3 行サマリ、公開仕様の同期）

成果物：mobile 完成形が UI 上で確認できる。 DESIGN.md §4 にモバイルレイアウト節が追加される。

### Step 7: (未着手) README_ja.md / README.md にモバイル操作節を追加

- 「キーボードショートカット」節の隣に「モバイル操作」節を 1 段落で追加：「Open / Settings は header / TOC / Comment / Search は footer から操作」「drawer は backdrop / Esc / 同ボタン再押下で閉じる」「mobile では Help は BlueTooth キーボード `h` キーからのみ開ける」
- スクリーンショット 1 枚を `docs/` 配下に置く（任意、画像規約に従う）

成果物：公開仕様 (README) が現実装と整合。

### Step 8: (未着手) DESIGN.md 反映と本ドキュメントの role 切替

Step 2 / Step 6 で DESIGN.md §10 / §4 を都度更新済みなので、 本 Step は最終整理に縮める：

- DESIGN.md §12「その他の拡張候補」内の **未対応サブ項目を別の追跡項目として残してから** 「スマートフォン向け UI の最適化」項目を整理：
  - **本タスクで完了した項目** (header / footer / drawer / search-bar の主要 chrome 配置、 callback hook 経由の navigation 自動 close、 Edit modal trigger の drawer 自動 close、 comment-modal.ts focus 復元契約、 navigation-orchestrator.ts focusTOC 第 3 引数化、 search-controller.ts focus timer 管理、 breakpoint 切替時 focus 退避、 など) を旧項目から削除
  - **未対応として §1 スコープ外に明示した項目** は同 §12 内の別の追跡項目 (新規追加 or 既存「その他の拡張候補」内の別行) に移してから削除する：
    - `#floater` の位置調整 / 選択ハンドル制御 (§1 スコープ外)
    - `.cmt-del` 即時削除後の focus 消失対処 (将来 `restoreFocusAfterClose` 相当を `deleteComment` に追加して desktop / mobile 双方を改善する道筋、 §1 スコープ外)
    - mobile での Help モーダル動線 (タッチ専用環境で `#btn-help` hide、 §1 スコープ外)
    - RTL レイアウト (将来 RTL i18n 追加時に対応、 §1 スコープ外)
    - PWA / `display-mode: standalone` (§1 スコープ外)
    - 単一ページ文書で TOC を hide する `data-page-count` attribute 追加 (§1 追加実装で未対応、 §8 リスク表参照)
    - landscape の左右 safe-area inset 検証経路の Custom viewport (現状は予防的設計のみ、 §1 スコープ外)
- §1 / §3 / §5 の本ドキュメント内記述と DESIGN.md §4 / §10 の追記内容に矛盾が無いことを最終確認
- 本ドキュメントを `docs/archive/feature-mobile-layout.archive.md` にリネーム（ユーザー確認後、 別 commit に分離して revert 可能にする）

成果物：DESIGN.md §12 表の対象行が「完了した項目は削除 + 未対応サブ項目は別追跡項目として残る」形に整理される + 本ドキュメントの archive 化（ユーザー確認後）。

## 5. 設計判断

### a. ブレークポイント (mobile 判定幅)

| 候補                                      | 採用 | 理由                                                                                                                                                                             |
| ----------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. `≤ 600px`（スマホ専用）                | ✗    | 600-768px の小型タブレット / 縦持ち時に drawer モデルにならず中途半端。Bootstrap 系の `sm` 定義 (576px) と紛らわしい                                                             |
| **B. `≤ 768px`（スマホ + 小タブレット）** | ✓    | 一般的な「mobile」境界。iPhone 14 Pro Max portrait (430×932) / iPad mini portrait (768×1024) の双方を mobile レイアウト対象に取り込める。既存 900px ブロックとは独立に追加できる |
| C. `≤ 900px` (既存と統合)                 | ✗    | 既存の vertical-stack 挙動を消すことになり、 タブレット域 (769-900px) の現状ユーザー体験を破壊する                                                                               |

採用案 B の論点：

- 既存 900px ブロックは「タブレット狭幅向け縦積み」として残し、 768px ブロックは「スマホ専用 drawer モデル」として **後勝ち cascade** で上書きする。 specificity を揃えるため `!important` は使わない
- iPad mini portrait (768×1024) は drawer モデルになるが、 landscape (1024×768) ではデスクトップに戻る
- **iPhone は portrait のみが drawer モデル、 landscape は機種ごとに分岐**：iPhone SE landscape (667×375) のように **landscape 幅が 768px 以下** に収まる機種は drawer モデルを維持。 iPhone 14 Pro Max landscape (932×430) や iPhone 13 mini landscape (812×375) のような **landscape 幅が 769-900px の範囲** に入る機種は既存 `@media (max-width: 900px)` ブロックが適用されるため **既存タブレット (vertical-stack) モデル** に切替 (§3.1 表、§1 スコープ外で明示)。 901px 以上の機種のみ desktop モデルに戻る
- **CSS だけで切り替わる前提だと JS state が DOM に残るリスク**：drawer 開状態で resize が起きると `<html>` の `mobile-*-open` / `<body>` の `mobile-drawer-open` / `inert` / `aria-hidden` が残り、 desktop で UI 操作不能になる。 §5.j-3 で matchMedia change handler を追加し、 desktop 移行時に強制 close する

### b. ヘッダ簡略化方式

| 候補                                                     | 採用 | 理由                                                                                           |
| -------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------- |
| A. mobile 用に header の HTML を別途用意し JS で出し分け | ✗    | DOM 二重化で aria-label / i18n / event wiring がすべて二重になる。SSR が無い本実装で利得が無い |
| B. 既存ボタンに `mobile-hidden` class を付与             | ✗    | HTML の mutation が必要。既存 `data-i18n-*` 属性との衝突可能性が増える                         |
| **C. CSS で `display: none` のみ**                       | ✓    | HTML を mutate せず i18n / wiring 経路は無変更。 mobile / desktop 切替は CSS 媒体クエリ任せ    |

採用案 C の論点：

- `display: none` された `#btn-search` も `HTMLElement.click()` で発火するため、 footer Search ボタンからの click 委譲が機能する（§3.3）
- `#status` / `#online-source` は mobile では情報量が少なく、 Settings モーダル内 / Open ▾ メニュー内に同等情報があるため省略しても支障無し
- `#btn-help` は hide するが `h` キーは生きているため、 BlueTooth キーボード接続時の Help アクセスは維持される（タッチ専用環境では Help が開けない、§1 スコープ外で明示）

### c. drawer 実装方式

| 候補                                                          | 採用 | 理由                                                                                                                                                                                                                 |
| ------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. `<dialog>` element (`HTMLDialogElement.showModal`)         | ✗    | 既存 sidebar の DOM 構造（resize handle / cmt-list の sticky header）を `<dialog>` 配下に移すと既存 CSS / wiring が壊れる。 `<dialog>` 標準の focus trap も既存 modal 規約 (`modal-backdrop` + 自前 trap) と分岐する |
| **B. sidebar 流用 + `position: fixed` + `transform`**         | ✓    | 既存の `.page-nav` / `.comments` aside element と CSS 規則をそのまま流用できる。`<html>` class 1 つで slide-in 制御                                                                                                  |
| C. inline 展開（既存 900px ブロックの vertical-stack を維持） | ✗    | TOC が画面外に追いやられて見つけにくい。 本タスクの「親指圏で操作」目標に反する                                                                                                                                      |

採用案 B の論点と mitigation：

- **drawer 同時 open の禁止**：UI 上 2 つ同時に開けると backdrop の z-index 整合が複雑になる。 open 関数の冒頭で「もう一方が open ならまず close」する mutually exclusive 制約を入れる（§5.j）
- **drawer ↔ search-bar の相互排他**：drawer 開中に search-bar を開くと background 操作が制御不能になるため、 mobile overlay は全体で単一表示とする（§5.m）
- **mobile↔desktop 切替時の state cleanup**：CSS 媒体クエリだけでは JS が付けた DOM 属性 / class が残る。 matchMedia change handler で強制 close（§5.j-3）
- **既存 900px ブロックの `display: none` 打ち消し**：768px ブロック内で `.page-nav, .comments { display: block }` を再宣言し、 後勝ち cascade で 900px の `display: none` を覆う。 さらに `:root.comments-closed .comments, :root.page-nav-closed .page-nav { display: block }` で desktop 用 closed 状態の影響も打ち消す（§3.1）
- **背面 scroll lock**：`body` には `overflow: hidden` + `overscroll-behavior: contain` のみ。 `.doc-pane` には `touch-action: none` + `overflow-y: hidden` の二重指定で touch / wheel 双方を抑止 (§5.h 採用案 C、 body に `touch-action: none` を当てると drawer 自身の縦スクロールも潰れる、 `touch-action` 単独では wheel event が漏れる)

### d. Search ボタンの接続方式

| 候補                                                             | 採用 | 理由                                                                                                                                  |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------- |
| A. footer Search → `search-controller` の `open()` を直接 import | ✗    | 将来 `wireSearch` が aria-pressed sync / focus 管理 / analytics tagging などを追加した時に同期漏れリスクが構造的に発生する            |
| **B. footer Search → `#btn-search.click()` を委譲**              | ✓    | search-bar の open/close / 既存 `f` キー経路と完全に同経路に集約される。 footer 自身の `aria-pressed` sync は MutationObserver で補完 |
| C. footer Search が search-bar を独自に open/close               | ✗    | 既存 `f` キー / `#btn-search` との状態ずれが発生する。 二経路の同期処理が必要になる                                                   |

採用案 B の論点：

- `#btn-search` は CSS で `display: none` だが `HTMLElement.click()` は DOM 上の存在のみで発火する（visibility / display 非依存）
- `#btn-mobile-search` 自身の `aria-pressed` は MutationObserver で `.search-bar.open` を監視して sync する（§3.3）
- footer Search click 時には drawer を先に `closeMobileDrawers({ restoreFocus: false })` で閉じてから委譲する（§5.m）

### e. drawer の `<html>` class 命名

| 候補                                                     | 採用 | 理由                                                                                                                |
| -------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------- |
| A. 既存 `comments-closed` / `page-nav-closed` の反転利用 | ✗    | 既存 class は desktop で grid 列幅 0 を意味する。 意味の衝突が発生する                                              |
| **B. `mobile-page-nav-open` / `mobile-comments-open`**   | ✓    | 新 namespace で意味の衝突を避け、 既存 `*-closed` と直交する。 positive class（open 時のみ付与）で CSS 規則数も最小 |
| C. `<html data-mobile-drawer="page-nav">` 等 data 属性   | ✗    | class より selector が冗長（`[data-mobile-drawer="page-nav"]`）。 既存 chrome の class 中心の規約と外れる           |

採用案 B の論点：

- `mobile-*-open` は drawer が open の時だけ付与され、 close 時に削除される positive class
- `body.mobile-drawer-open` は両 drawer 共通の「いずれか open」状態で、 scroll lock 用
- 既存 `*-closed` は desktop で grid `0px` を意味する negative class。 mobile では 1 列 grid なので機能停止し、 drawer transform が支配する

### f. fixed footer の挙動

| 候補                                                             | 採用 | 理由                                                                                           |
| ---------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------- |
| A. `position: sticky` で本文末尾に追従                           | ✗    | 短い文書では footer が表示されず、 親指圏での操作性が低下                                      |
| **B. `position: fixed` で常時 viewport 下端**                    | ✓    | スクロール位置に依存せず常時操作可能。 親指圏に近い viewport 下端固定                          |
| C. `position: fixed` + 下スクロール時 hide / 上スクロール時 show | ✗    | hide-on-scroll 実装が複雑で iOS の momentum scroll と相性が悪い。 タップ目標の表示状態が不安定 |

採用案 B の論点：

- iOS Safari の URL bar 表示・非表示で viewport 高さが変わるが、 `position: fixed; bottom: 0` は常に viewport 底辺に張り付くため問題なし
- iOS safe-area inset (`env(safe-area-inset-bottom)`) を `padding-bottom` で受けて、 ホームインジケータと重ならないようにする
- `<meta name="viewport" content="..., viewport-fit=cover">` が必須（無いと safe-area inset が 0 になる）

### g. i18n キー命名

| 候補                                                                                               | 採用 | 理由                                                                                                 |
| -------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------- |
| A. 既存 `toolbar.search_aria` / `page_nav.toggle_panel_aria` / `comments.toggle_panel_aria` を流用 | ✗    | mobile drawer trigger と desktop 縦タブで文脈 / 文言を独立に調整したい場面が将来発生する可能性が高い |
| **B. `mobile.*` namespace 新設**                                                                   | ✓    | 既存 namespace と直交し、 mobile 固有の文言を独立に管理できる                                        |
| C. `toolbar.mobile_*` のように既存 namespace に prefix 追加                                        | ✗    | toolbar namespace の意味（header toolbar 内のボタン）と混ざる                                        |

採用案 B の論点：

- 追加キー：`mobile.toc_aria` / `mobile.comments_aria` / `mobile.search_aria`（footer 3 ボタン用 aria-label）、 `mobile.footer_label`（`<footer role="group">` の aria-label、§3.2 / §5.n）
- tooltip 系は mobile では `.tooltipped::after` を hide するため不要
- 既存 `comments.toggle_panel_aria` / `page_nav.toggle_panel_aria` は desktop の縦タブ用のまま据え置き

### h. 背面 scroll lock 方式 + `.doc-pane` のスクロールコンテナ成立

| 候補                                                                                                                    | 採用 | 理由                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. `body { overflow: hidden }` のみ                                                                                     | ✗    | iOS Safari で `overflow: hidden` だけでは momentum scroll が止まらない。 慣性スクロール途中で drawer を開いた場合に背面が動く                                                                                                                                                                                                                                    |
| B. `body { overflow: hidden; touch-action: none }` の二条件                                                             | ✗    | **touch-action は祖先 → 子孫の effective touch-action として AND される (W3C Pointer Events)**。 body に `none` を当てると drawer 自身の縦スクロール (`overflow-y: auto`) もタッチで操作不能になる                                                                                                                                                               |
| **C. body の overflow + `.doc-pane` の touch-action + `.doc-pane` の overflow-y: hidden + body の overscroll-behavior** | ✓    | 背面 (`.doc-pane`) のみ touch / wheel を抑止、 drawer (`.page-nav` / `.comments`) は触らないので drawer 内部の縦スクロールが保持される。 `touch-action: none` (touch 用) + `overflow-y: hidden` (wheel 用) の二重防御で BlueTooth マウス / トラックパッド接続環境でも背面 scroll を確実に止める。 `overscroll-behavior: contain` で momentum scroll の連鎖も断つ |
| D. `body { position: fixed; top: -<scrollY>px }` で scroll 位置を直接固定                                               | ✗    | drawer close 時に scroll 位置を復元する必要があり、 復元ロジックの境界条件 (resize / virtual keyboard 表示) が多い。 minimum 実装には不向き                                                                                                                                                                                                                      |

採用案 C の詳細：

```css
@media (max-width: 768px) {
  body {
    overscroll-behavior: contain;
  } /* momentum scroll の祖先連鎖を断つ */
  /* 900px の `body > main.layout { flex: none }` (0,0,1,2) / `body > main.layout > section
     { overflow-y: visible }` (0,0,1,3) を同等以上の specificity で打ち消す。
     flat な `.layout` / `.doc-pane` (0,0,1,0) では負けてスクロールコンテナが成立しない。 */
  body > main.layout {
    flex: 1;
    min-height: 0;
  } /* main を 100dvh 内に収め、 doc-pane の shrink scroll を許す (基底 review.css:103-105 に戻す) */
  body > main.layout > section.doc-pane {
    overflow-y: auto;
    min-height: 0;
  } /* スクロールコンテナ成立 (既存 900px の visible を section.doc-pane で 1 つ上回って打ち消し) */
  body.mobile-drawer-open {
    overflow: hidden;
  } /* drawer 開時のみ background scroll を止める */
  body.mobile-drawer-open > main.layout > section.doc-pane {
    touch-action: none; /* touch pan / zoom を抑制 */
    overflow-y: hidden; /* wheel event (マウスホイール / トラックパッド) も抑制、 defence in depth */
  }
}
```

採用案 C の論点：

- `.doc-pane` のスクロールコンテナ成立が前提：既存 900px ブロックの `body > main.layout > section { overflow-y: visible }` (0,0,1,3) と `body > main.layout { flex: none }` (0,0,1,2) を 768px で打ち消さないと、 mobile で本文が縦スクロールできない。 **打ち消しは同等以上の specificity が必須**（`body > main.layout > section.doc-pane` (0,0,1,4) / `body > main.layout` (0,0,1,2) で書く。 flat な `.doc-pane` (0,0,1,0) では specificity 負けして `overflow-y: visible` が勝ち続ける）。 `min-height: 0` は flex item の shrink を許す (`min-height: auto` だと content size に張り付いて scroll が出ない)
- drawer 内部の縦スクロール (`.page-nav` / `.comments`) は **scroll-lock 側では触らない** → タッチで通常通り操作可能。 ただし drawer も 900px の `body > main.layout > aside.* { overflow-y: visible }` (0,0,1,3) を継承するため、 §3.1 / §4 Step 6 で `body > main.layout > aside.page-nav, body > main.layout > aside.comments { overflow-y: auto }` を **同一 specificity で再宣言** して drawer 内部スクロールを成立させる（flat な `.page-nav, .comments { overflow-y: auto }` では specificity 負けする）
- 背面の `.doc-pane` のみに `touch-action: none` を当てるため (`body.mobile-drawer-open > main.layout > section.doc-pane`)、 effective touch-action の AND 計算で drawer / footer / header は影響を受けない
- **`touch-action: none` だけでは wheel event (マウスホイール / トラックパッド) を抑止できない**：W3C Pointer Events Level 3 の `touch-action` 仕様は **touch input (pan / pinch zoom) のみ** を制御対象とし、 wheel event は対象外。 iPad keyboard / BlueTooth マウス接続環境や iPadOS の trackpad 機能で背面 `.doc-pane` が wheel scroll してしまう問題が発生する。 同時に `overflow-y: hidden` も付与して **scroll container を物理的に scroll 不能にする** (defence in depth)。 `inert` 属性 (§5.j) も併用しているが、 WHATWG HTML spec の「user input events を ignore」の wheel への適用は browser implementation 依存で保証されないため、 `overflow-y: hidden` で確実に止める
- `overflow-y: hidden` 付与時の scrollTop 保持：Chrome / Safari 共に `overflow-y: hidden` を当てた瞬間に scrollTop は保持される (強制 0 にリセットされない)。 drawer close 時に `overflow-y: auto` に戻せば scroll 位置はそのまま復元
- 背面 scroll 位置は drawer 開閉で保持される（`body` の scrollTop は変わらない、 case D のような位置復元は不要）

### i. motion 制御 (`prefers-reduced-motion`)

| 候補                                                                        | 採用 | 理由                                                                                                         |
| --------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------ |
| A. すべての環境で `transition: transform .2s ease`                          | ✗    | OS 設定で motion 抑制を選んでいるユーザーに対しアクセシビリティ違反 (WCAG 2.3.3 Animation from Interactions) |
| **B. `prefers-reduced-motion: reduce` で `transition-duration: 0s` に短縮** | ✓    | 既存 review.css l.1813 の `@media (prefers-reduced-motion: reduce)` ブロックと同規約で集約可能               |
| C. transition 自体を無効化 (常に instant)                                   | ✗    | 通常環境での「どちらから開いたか」の視覚 affordance が消える                                                 |

採用案 B の論点：

- **既存 reduced-motion ブロックは 768px ブロックの前にあるため cascade で上書きされる**：review.css l.1813 の既存 `@media (prefers-reduced-motion: reduce)` ブロック内に `.page-nav, .comments { transition-duration: 0s }` を追記しても、 **その後に置かれる 768px ブロック**の `.page-nav, .comments { transition: transform .2s ease }` (transition shorthand は duration を含む) が同等 specificity の後勝ち cascade で `transition-duration: 0s` を上書きしてしまう
- **解決策**：**768px ブロックの後**に `@media (max-width: 768px) and (prefers-reduced-motion: reduce) { .page-nav, .comments { transition-duration: 0s } }` の合成 media query を追加する。 既存 reduced-motion ブロック (l.1813) は据え置きで desktop 規約と整合、 mobile は別 media query で確実に上書き
- `transition-property: transform` ではなく `transition-duration: 0s` で「duration だけ短縮、 property は維持」が WCAG 推奨

### j. focus 抑制経路 (modal 扱い / inert 対象 / RTL / PWA / 切替時 focus / mobile↔desktop cleanup)

drawer は「modal-backdrop class を持たない」「ただし背面操作は完全に suppress したい」という中間的な存在で、 既存 modal とは別経路で扱う。 さらに focus trap は「厳密な drawer 内 trap」よりも「drawer + mobile-footer (drawer の close trigger) を操作可能、 残りは inert」とした方が UX 上自然（同じ footer ボタン再押下で drawer を閉じる動線が tab keyboard でも維持される）：

| 論点                                         | 採用方針                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| mobile drawer を `isAnyModalOpen` に含めるか | **含めない**（modal-backdrop class を持たない別経路として扱う）。 affordance キー / Esc 抑制は `isAnyModalOpen() \|\| isMobileDrawerOpen()` の OR で並列に追加する                                                                                                                                                                                                                                                                                                                           |
| `inert` の付与対象 (drawer open 中の背面)    | **`.skip-link` / `.app-header` / `.doc-pane`** の 3 要素 (open/close の手順で動的に切替)。 `.skip-link` (`#skip-to-nav`) を含めないと DOM 先頭の focusable anchor が常時 Tab 巡回に乗り、 drawer + mobile-footer 内に焦点が閉じない。 反対 drawer (`.page-nav` / `.comments`) は §5.j-4 invariant により `applyMobileInertState()` で別管理 (open/close 関数では触らない)。 drawer 自身と mobile-footer は操作可能に残す。 §1 SHOULD「Tab 焦点が drawer + mobile-footer に閉じる」が完了条件 |
| `aria-hidden="true"` の併用                  | `inert` を付ける同じ 3 要素に `aria-hidden="true"` も併用。 close 時にどちらも除去。 screen reader が背面を読み上げない。 drawer 自身の `aria-hidden` は §5.j-4 の `applyMobileInertState()` 経由                                                                                                                                                                                                                                                                                            |
| RTL レイアウト対応                           | 現状の i18n 辞書が LTR 言語のみのため対象外（§1 スコープ外）。 将来 RTL 言語追加時に `translateX` の方向反転と `border-left` / `border-right` / `padding-left` / `padding-right` の左右切替を同時対応                                                                                                                                                                                                                                                                                        |
| PWA / `display-mode: standalone`             | 配布物 HTML 想定のためスコープ外（§1 スコープ外）                                                                                                                                                                                                                                                                                                                                                                                                                                            |

#### j-2. 切替時の focus 復元先取り違え対策

drawer 切替 (TOC 開中に Comment ボタン click) のシーケンス（**素朴な実装の失敗例**）：

1. ユーザーが Comment ボタン click (event target = Comment ボタン)
2. `openMobileComments()` 冒頭で「TOC が open なら close」
3. `closeMobilePageNav()` 内で `lastTrigger.focus()` → 旧 TOC ボタンに focus が移る → `document.activeElement` = 旧 TOC ボタン
4. その後 `lastTrigger = document.activeElement` で **旧 TOC ボタンが新 lastTrigger に保存される**
5. Comment 閉じる時に Comment ボタンではなく TOC ボタンに focus が戻る → UX が壊れる

**採用方針**：

- `openMobilePageNav(trigger: HTMLElement)` のように **trigger を引数で受け取り、 関数冒頭で `lastTrigger = trigger` を最初に保存**（`document.activeElement` を見ない）
- close 関数を `closeMobileXxx(opts?: { restoreFocus?: boolean })` に署名変更。 切替時は `{ restoreFocus: false }` で focus 復元なしで close
- これで「切替時の close は focus を移動させない」「最終的な close は trigger に focus が戻る」の両立

#### j-3. mobile↔desktop 切替時の state cleanup

drawer 開状態で window resize → viewport 幅が 768px を超えると、 768px ブロックの CSS (`position: fixed` / `display: block` 等) は媒体クエリ外れで効かなくなる。 一方で **JS が付けた DOM 属性 / class はそのまま残る**：

- `<html>` の `mobile-page-nav-open` / `mobile-comments-open`
- `<body>` の `mobile-drawer-open`
- `.skip-link` / `.app-header` / `.doc-pane` の `inert` + `aria-hidden="true"` (背面 3 要素、 open/close の手順で動的に切替)
- 両 drawer の `inert` + `aria-hidden="true"` (§5.j-4 invariant、 `applyMobileInertState()` 経由)
- footer ボタンの ARIA state attribute を sync：TOC/Comment は `aria-expanded="true"`、 Search は既存 `#btn-search` 経由で `aria-pressed` を MutationObserver sync（§5.q）

結果として desktop モードで `.app-header` / `.doc-pane` / `.comments` が `inert` のまま残り、 **ユーザーが UI を一切触れない**「壊れた」状態になる。 さらに `aria-hidden` も残るため screen reader にも背面が読まれない。

**採用方針**：

- `wireMobileFooter()` 内で `window.matchMedia('(max-width: 768px)')` を取得し、 `change` event を購読
- **切替前に `escapeFocusBeforeBreakpointSwitch(toMobile)` で focus を退避**（切替後に hidden / inert になる要素に focus が残るのを防ぐ、 詳細は下記 helper）：

  ```ts
  // 切替後に hidden / inert になる要素を判定。 mobile/desktop 各々で CSS hide される要素が異なる
  // ため、 768px ブロックの実際の `display: none` selector / 768-900px の vertical-stack 規則 /
  // `*-closed` 状態の grid 列幅 0 規則をすべて考慮する。
  function willBeHiddenAfterSwitch(el: HTMLElement, toMobile: boolean): boolean {
    if (toMobile) {
      // mobile 進入時に hide される要素:
      // (a) drawer 自身 (`applyMobileInertState` で両 drawer に inert 付与)
      // (b) header 内の hidden buttons (768px ブロックの `display: none` 規則)
      // (c) toggle tabs (768px ブロックの `display: none` 規則)
      if (el.closest('.page-nav, .comments')) return true
      if (el.closest('#btn-search, #btn-help, #status, #online-source')) return true
      if (el.closest('.page-nav-toggle-tab, .comments-toggle-tab')) return true
      return false
    }
    // desktop 進入時に hide される要素:
    // (a) mobile-footer / backdrop (グローバル `display: none` 規則)
    // (b) `*-closed` 状態で drawer が grid 列幅 0 (`:root.comments-closed .comments` 等)
    if (el.closest('.mobile-footer, .mobile-drawer-backdrop')) return true
    const root = document.documentElement
    if (root.classList.contains('comments-closed') && el.closest('.comments')) return true
    if (root.classList.contains('page-nav-closed') && el.closest('.page-nav')) return true
    return false
  }

  function escapeFocusBeforeBreakpointSwitch(toMobile: boolean): void {
    const active = document.activeElement as HTMLElement | null
    if (!active || active === document.body) return
    if (willBeHiddenAfterSwitch(active, toMobile)) {
      document.querySelector<HTMLElement>('.doc-pane')?.focus({ preventScroll: true })
    }
  }
  ```

- listener は **両ブランチを明示的に分岐**：
  - `matches === true` (mobile 進入)：`escapeFocusBeforeBreakpointSwitch(true)` で焦点退避 → `closeMobileDrawers({ restoreFocus: false })` で念のため drawer を閉じる (desktop 上で drawer は通常閉じているため no-op、 万一開いてれば安全に close) → `applyMobileInertState()` で両 drawer に inert + aria-hidden 付与
  - `matches === false` (desktop 進入)：`escapeFocusBeforeBreakpointSwitch(false)` で焦点退避 → `closeMobileDrawers({ restoreFocus: false })` で背面 3 要素から inert / aria-hidden 除去 + `<html>` の `mobile-*-open` / `<body>` の `mobile-drawer-open` 除去 → `applyMobileInertState()` が desktop ブランチで両 drawer から inert / aria-hidden を除去
- `restoreFocus: false` を選ぶのは resize 元の active 要素が viewport 上で意味を持つとは限らず、 desktop で意図しない focus 移動を引き起こすため
- `wireMobileFooter()` は idempotent なので、 `dataset.wired` flag で多重 listener 登録を防ぐ
- **`closeMobileDrawers()` 自体は inert の付与 / 除去判断を持たず、 `applyMobileInertState()` に一任** することで「閉じる → 再付与」設計が desktop 進入時に意図せず inert を残してしまう旧バグを根本回避する (§5.j-4 の単一責任管理)
- in-source test で matchMedia の mock を使い両ブランチを検証：「`matches: false` (desktop 進入) で `closeMobileDrawers` + `applyMobileInertState()` で DOM 属性 / class がすべて除去される」「`matches: true` (mobile 進入) で両 drawer に inert + aria-hidden が付く」

#### j-4. 閉じた drawer の Tab / AT tree 除外

§4 Step 6 で `.page-nav, .comments { display: block }` を 768px ブロックで再宣言し、 `transform: translateX(±100%)` で visual を画面外に飛ばす設計を採用 (§5.c)。 しかし transform は **visual transform のみ** で、 DOM 上は `display: block` + visible のままなので：

- 閉じた drawer 内のリンク / ボタンが **Tab 順序に残る** → キーボードユーザは Tab で「見えない」drawer 内 element に focus できてしまう
- 閉じた drawer の `<button>` / `<a>` を **AT (screen reader) が読み上げる** → 「Show TOC」「Add review comment」等が文脈外に読まれる

§5.j A 案では「drawer open 中に反対 drawer に `inert` + `aria-hidden`」までしか定義していないため、 **全 drawer 閉状態では両 drawer とも inert なし** → 上記の問題が発生する (WCAG 2.4.3 Focus Order / 1.3.1 Info and Relationships 違反)。

採用方針：

drawer の inert / aria-hidden は **`applyMobileInertState()` という単一責任 helper に一元化**：

```ts
function applyMobileInertState(): void {
  const isMobile = window.matchMedia('(max-width: 768px)').matches
  if (!isMobile) {
    // desktop: 両 drawer から inert / aria-hidden 除去 (mobile の残留状態をクリーンアップ)
    pageNav.removeAttribute('inert')
    pageNav.removeAttribute('aria-hidden')
    comments.removeAttribute('inert')
    comments.removeAttribute('aria-hidden')
    return
  }
  // mobile: 各 drawer の open 状態を見て付与 / 除去を二項分岐
  // (else 分岐で removeAttribute を確実に呼ばないと、 初期化時付与の inert が open 後も残留する)
  if (isMobilePageNavOpen()) {
    pageNav.removeAttribute('inert')
    pageNav.removeAttribute('aria-hidden')
  } else {
    pageNav.setAttribute('inert', '')
    pageNav.setAttribute('aria-hidden', 'true')
  }
  if (isMobileCommentsOpen()) {
    comments.removeAttribute('inert')
    comments.removeAttribute('aria-hidden')
  } else {
    comments.setAttribute('inert', '')
    comments.setAttribute('aria-hidden', 'true')
  }
}
```

呼び出しタイミング：

- **`wireMobileFooter()` 初期化時 (関数末尾)**: 1 回呼ぶ。 mobile 起動なら両 drawer に inert + aria-hidden 付与、 desktop 起動なら両 drawer から inert / aria-hidden を明示的に除去 (mobile 残留状態のクリーンアップ動作)
- **`openMobileXxx()` の手順 6**: mobile ブランチで開いた drawer から inert / aria-hidden を除去、 反対 drawer (閉) に付与継続。 desktop ブランチでは両 drawer から属性を除去
- **`closeMobileXxx()` の手順 4**: mobile ブランチで閉じた drawer に inert / aria-hidden を再付与。 desktop ブランチでは両 drawer から属性を除去
- **`matchMedia change` listener の両ブランチ**: §5.j-3 の通り、 mobile 進入 / desktop 進入で適切に切替 (両ブランチとも `applyMobileInertState()` を経由するため、 desktop 進入時の両 drawer 属性除去が確実に走る)

これで「mobile かつ閉じた drawer」のみ inert が付く invariant が成立。 desktop 起動時は initial 状態でも matchMedia change 後でも desktop ブランチで両 drawer に inert が付与されず、 desktop パネル操作が壊れることはない。

代替案 (`.page-nav, .comments { visibility: hidden }` で CSS のみで制御) も検討したが、 transform transition との連動 (close 時に visibility を `.2s` 後に hidden に遅延させる) が必要で、 既存 §5.j の inert 管理パターンと一貫しないため不採用。

#### j-5. drawer + mobile-footer の Tab 循環 trap

DOM 順序は `.skip-link` → `<header>` → `<main>` (内部に `.doc-pane` → `.page-nav` → `.comments`) → `<footer class="mobile-footer">` の順。 footer 内 TOC ボタンから drawer を開いても **focus は trigger button (footer 内) に残ったまま** で、 通常の Tab は DOM 順を後ろに進むため：

- footer 内の TOC → Search → Comment を巡回
- footer 末尾の Comment ボタンから Tab → **背面 3 要素 + 反対 drawer (inert) を飛ばして browser chrome (URL bar 等) に脱出** → drawer 内の link / button には到達できない

§5.j A 案の「厳密な Tab trap を採用しない」前提では §1 SHOULD「Tab 焦点が drawer + mobile-footer に閉じる」が機能しないため、 **drawer + mobile-footer の合成 focus trap** を追加する：

採用方針：

```ts
// open 時に呼ぶ helper
function focusFirstInDrawer(drawer: HTMLElement): void {
  const focusables = getFocusableElements(drawer)
  focusables[0]?.focus()
}

// Tab key 循環 trap (drawer open 中だけ document に登録)
function handleTabInMobileOverlay(event: KeyboardEvent): void {
  if (event.key !== 'Tab' || !isMobileDrawerOpen()) return
  const drawer = getOpenDrawerElement() // .page-nav or .comments
  const footer = document.querySelector('.mobile-footer')!
  // DOM 順は drawer → footer なので focusables も drawer 先 / footer 後
  const focusables = [...getFocusableElements(drawer), ...getFocusableElements(footer)]
  if (focusables.length === 0) return
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const current = document.activeElement as HTMLElement | null
  // 救出ロジック：現在の focus が drawer + footer 集合の外 (e.g. comment 削除直後の `<body>`、
  // modal close 直後の `.doc-pane` 退避後など) → 先頭に救出してから wrap 判定に進む。
  // 単に first/last の比較だけだと `<body>` から Tab → DOM 順で drawer 外に出てしまう問題を防ぐ。
  if (!current || !focusables.includes(current)) {
    event.preventDefault()
    first.focus()
    return
  }
  if (event.shiftKey && current === first) {
    event.preventDefault()
    last.focus() // drawer 先頭 → footer 末尾へ wrap
  } else if (!event.shiftKey && current === last) {
    event.preventDefault()
    first.focus() // footer 末尾 → drawer 先頭へ wrap
  }
}
```

呼び出しタイミング：

- `openMobileXxx()` 手順 9: **drawer 内先頭要素へ focus 移動** (`.page-nav` なら最初の `.page-nav-link`、 `.comments` なら最初の interactive 要素)
- `openMobileXxx()` 手順 10: `document.addEventListener('keydown', handleTabInMobileOverlay, true)` を登録 (capture phase で先取り)、 同じ listener 参照を module 変数に保存して close 時に除去
- `closeMobileXxx()` 手順 6: `document.removeEventListener('keydown', handleTabInMobileOverlay, true)` で解除 (drawer 閉時は Tab を通常巡回に戻す)
- listener の多重登録防止：`dataset.tabTrapWired` flag or 単一の module-level reference で gate

採用方針の論点：

- **focusable element の収集**：`getFocusableElements(root)` は `tabindex >= 0` + 標準 focusable (`<a href>` / `<button>` / `<input>` 等) を DOM 順で返すユーティリティ。 `inert` 配下は自動的に除外される (browser が `:focusable` から外す)
- **capture phase 登録**：`useCapture: true` で footer / drawer 内のボタン自身の Tab 処理より先に handler が走る。 footer 内に Tab handler を持つ既存要素がない場合は bubble phase でも問題ないが、 将来の競合防止で capture を採用
- **close 時の listener 除去**：listener が drawer 閉後も残ると、 desktop に切り替わった後も `isMobileDrawerOpen()` で gate されるため害は無いが、 idempotent な resource cleanup として close で除去
- **`focusFirstInDrawer` の対象**：`.page-nav` の場合は最初の `.page-nav-link` が typically 先頭、 `.comments` の場合は `Write feedback.json` ボタンか cmt-list 先頭の comment-item が先頭になる (`getFocusableElements` の DOM 順で自然に決まる)
- **trigger button への focus は移さない**：close 時に `lastTrigger?.focus()` で trigger に戻すのは既存設計通り。 open 時は drawer 内先頭に明示移動することで「open 直後の Tab が drawer 内から始まる」UX が成立

#### 採用方針の論点

- 厳密な Tab trap (drawer 内のみ Tab 巡回 + footer も inert) を採用すると、 close 動線は backdrop click / Esc / drawer 内に追加した close ボタンに限定される。 mobile で close ボタンを drawer 内に追加するのは UX 上冗長（footer 同ボタン再押下が自然）。 そのため drawer + footer 操作可の A 案を採用
- `<main>` 全体に `inert` を当てると drawer (`<main>` 配下) 自身も操作不能になるため、 inert 対象は `<main>` ではなく `.doc-pane` + 反対 drawer のように **drawer の隣接 sibling 単位** で指定する
- `.skip-link` (`#skip-to-nav`) は `<main>` の sibling として DOM 先頭にあり、 inert 対象に含めないと footer 末尾から Tab で `.skip-link` に巡回して drawer 外に焦点が抜ける
- modal 経路の `isAnyModalOpen` に drawer を含めない理由は「drawer は modal とは違って `Esc` で閉じる対象を切り分けたい」（modal は backdrop click が close、 drawer も backdrop click が close だが、 同時開放禁止やキー抑制の責務範囲を分けて管理したい）

### k. safe-area / 動的 viewport の各オフセット共通変数化 + box-sizing 統一 + drawer 内側 padding の加算

| 候補                                                                                        | 採用 | 理由                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A. 各部品に固定値 `56px` を直接書く                                                         | ✗    | safe-area inset (iPhone 14 Pro Max bottom 34px) を含めた実効高さに不整合が発生。 本文末尾 / drawer 末尾が footer 裏に隠れる                                                                      |
| B. CSS variable で共通化 + `box-sizing: content-box` (default) のまま padding-bottom も追加 | ✗    | content-box では `height + padding-bottom + border` で実寸が膨らみ、 footer 実寸 = `56 + 2×inset + 1`。 `--mobile-footer-height` 参照側と整合しない                                              |
| C. CSS variable で共通化 + `box-sizing: border-box` で `height` 内に padding を取り込む     | ✗    | drawer の `padding-left` / `padding-right` を 768px ブロックで単独宣言すると、 既存 `.page-nav { padding: 24px 16px }` / `.comments { padding: 56px 24px 32px }` の左 16px / 右 24px が消える    |
| **D. C + drawer 内側 padding は `calc(既存値 + inset)` で加算**                             | ✓    | header / footer は box-sizing で外寸を共通変数に揃え、 drawer は既存 padding を維持しつつ landscape inset だけ加算。 既存 padding 値が portrait で消えず、 landscape では notch 側のみインデント |

採用案 D の論点：

- `:root { --mobile-header-height: calc(65px + env(safe-area-inset-top)); --mobile-footer-height: calc(56px + env(safe-area-inset-bottom)) }` を 768px ブロックの先頭 (内側) で定義
- **header 素朴値 65px の根拠**：既存 `.btn` (review.css l.860-877) の実効高さは line-height 20px + padding 5px×2 + border 1px×2 = **32px**。 mobile header の内側コンテンツ領域 = `65 - 16 - 16 - 1(border-bottom) = 32px` でジャストフィット。 素朴値を 56px のままにすると内側 23px となり `.btn` が 9px overflow して header 外にはみ出す。 既存 desktop の outer 高さ計算 (`padding 16+16 + .btn 32 + border 1 = 65px`) と整合させる意味でも 65px が筋
- footer 素朴値 56px は新規要素で既存挙動がなく、 内側コンテンツ高さ = `56 - 0 - 0 - 1 = 55px` で `.btn` 32px が余裕で収まる (上下に約 11px ずつ余白)。 footer の高さは header と独立に最小値 56px で維持
- `.app-header { box-sizing: border-box; height: var(--mobile-header-height); padding: calc(16px + env(safe-area-inset-top)) calc(24px + var(--mobile-safe-right)) 16px calc(24px + var(--mobile-safe-left)) }` で既存 `padding: 16px 24px` (review.css l.776) を加算式で維持しつつ、 外寸を `--mobile-header-height` と一致させる。 単独 `padding-left/right` 再定義だと portrait 時に既存 24px が消えるため必ず加算式
- `.mobile-footer { box-sizing: border-box; height: var(--mobile-footer-height); padding: 0 var(--mobile-safe-right) env(safe-area-inset-bottom) var(--mobile-safe-left) }` で同様に footer 外寸を一致
- **drawer は既存 padding を保持して左右だけ加算**：`.page-nav { padding-left: calc(16px + var(--mobile-safe-left)) }`、 `.comments { padding-right: calc(24px + var(--mobile-safe-right)) }`。 16 / 24 は実装時に review.css l.151 / l.592 の現行値を再確認して合わせる（数値変更があれば本書も追従）
- 768px ブロック内で参照する部品：`.layout` の `padding-bottom`、 drawer の `top` / `bottom`、 backdrop の `top` / `bottom`、 footer の `height`、 header の `height`
- landscape の左右 inset は **footer / header の `padding-left/right`** + **drawer 内側 content の `padding-left` 加算 (左 drawer) / `padding-right` 加算 (右 drawer)** で反映（drawer 自身は viewport 端まで張り付かせる、 背景 / border が画面端まで届く方が視覚的に綺麗。 backdrop は背景色だけなので inset 不要）
- `100vh` / `100dvh` の二段宣言は採用案 D と独立に有効（footer は `position: fixed; bottom: 0` で常に viewport 底辺、 body の高さ規定は dvh 二段で受ける）

### l. backdrop の表示制御 (`hidden` 属性 vs author CSS)

| 候補                                                                      | 採用 | 理由                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A. HTML markup に `hidden` 属性 + author CSS で `display: block` を上書き | ✗    | UA stylesheet の `[hidden] { display: none }` は specificity (0,0,1,0) と低く、 author CSS の `.mobile-drawer-backdrop { display: block }` (同等 specificity 後勝ち) や `:root.mobile-X-open ...` (specificity (0,0,2,0)) で容易に上書きされる。 `hidden` 属性に依存すると author CSS の規則を変えた瞬間に backdrop が常時表示される回帰を起こす |
| **B. `hidden` 属性なし、 author CSS 完全集約**                            | ✓    | グローバル `display: none` + 768px の `:root.mobile-X-open .mobile-drawer-backdrop { display: block }` で cascade が一意。 JS は `<html>` class の add/remove のみ、 backdrop の `hidden` / `style.display` には触らない                                                                                                                         |
| C. `style="display: none"` を JS で操作                                   | ✗    | inline style は specificity (1,0,0,0) で author CSS を上書きするが、 JS 側で表示制御の責務が分散する。 `<html>` class での宣言的制御と二重管理になる                                                                                                                                                                                             |

採用案 B の論点：

- HTML markup から `hidden` 属性は削除する（§3.2 の DOM 例参照）
- JS (`mobile-footer.ts`) は `<html>` class (`mobile-page-nav-open` / `mobile-comments-open`) と `body` class (`mobile-drawer-open`) と `inert` / `aria-hidden` の付け外しのみを行う
- backdrop の `display` 制御は完全に CSS：
  - グローバル領域 (Step 2): `.mobile-drawer-backdrop { display: none }`
  - 768px 内 drawer 開時: `:root.mobile-page-nav-open .mobile-drawer-backdrop, :root.mobile-comments-open .mobile-drawer-backdrop { display: block }`
- in-source test で「JS が backdrop の `hidden` 属性 / `style.display` に触らない」ことを assertion し、 将来の回帰を防ぐ

### m. drawer ↔ search-bar の相互排他 (mobile overlay の単一表示)

`.search-bar.open` は z-index 80 で drawer (60) / footer (70) より上に出るため、 drawer 開中に Search を押すと search-bar が drawer の上に重なって表示される。 さらに `.search-bar` は §5.j の inert 対象 (背面 3 要素 + §5.j-4 の閉じた drawer) に入っていないため Tab で侵入可能 → §1 SHOULD「Tab 焦点が drawer + mobile-footer に閉じる」と矛盾する。

| 候補                                      | 採用 | 理由                                                                                                                                                                            |
| ----------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. search-bar も inert 対象に含める       | ✗    | search-bar 開中に drawer が開けない方が UX 上自然 (overlay スタックが深くなる)。 単に「同時 open しない」契約にした方がシンプル                                                 |
| **B. drawer ↔ search-bar の相互排他制約** | ✓    | mobile overlay を「drawer (左/右) または search-bar、 ただしいずれか 1 つだけ open」の単一表示モデルに統一。 §5.j drawer 同士の mutually exclusive と同パターンで責務がシンプル |
| C. search-bar を drawer の中に移動        | ✗    | search-bar の既存 DOM 配置 / wireSearch との結合を破壊する                                                                                                                      |

採用案 B の実装：

- `openMobilePageNav(trigger)` / `openMobileComments(trigger)` の冒頭で：
  ```ts
  if (document.querySelector('.search-bar.open')) {
    document.getElementById('btn-search')?.click() // wireSearch 経路で close
  }
  ```
- `#btn-mobile-search` の click handler 冒頭で：
  ```ts
  closeMobileDrawers({ restoreFocus: false }) // drawer を先に閉じる
  document.getElementById('btn-search')?.click()
  ```
- `f` キーで search-bar を開く経路 (`global-keyboard.ts`) でも drawer open 中の `f` キーは §5.j affordance キー抑制で抑制されるため、 drawer 開中に `f` キーで search-bar が開くことはない（drawer を閉じてから `f` キー）

採用案 B の論点：

- footer 側の sync (`#btn-mobile-search` の aria-pressed) は §3.3 の MutationObserver で `.search-bar.open` を監視しているため、 search-bar が close されると footer の aria-pressed も自動的に false に戻る
- search-bar 開中に footer の TOC / Comment ボタンを押すと drawer が開く前に search-bar が close される (上記 open 関数冒頭の close 処理)。 search-bar の close は `wireSearch` 経路に集約されているため二重実行リスクなし
- **search-controller の focus timer 競合**：focus 予約は `openSearch()` (`src/app/search/search-controller.ts:98`) が呼ぶ `resetSearchInput()` (`l.89`) 内の `setTimeout(() => input.focus(), 0)` (`l.94`) で行われるが、 `closeSearch()` (`l.114`) は debounce timer (`cancelPendingSearch()`) しか cancel せず focus timer を cancel しない。 mobile overlay 相互排他で Search → drawer 即切替を行うと、 drawer 開いた直後に setTimeout コールバックが発火して **drawer 開後の非表示 input に focus が奪われる** バグが顕在化する。 §4 Step 5b で search-controller に focus timer 管理 (`resetSearchInput` 内で timer ID を保存、 `closeSearch` 内で `clearTimeout`) を追加して根本対処する。 mobile-footer.ts 側だけでは解決できない (timer は search-controller の closure 内)

### n. footer の ARIA role 選定 (`role="group"` 採用 / `role="toolbar"` 見送り / implicit `contentinfo` 上書き)

mobile-footer は 3 ボタン (TOC / Search / Comment) を並べる UI コマンド領域。 ARIA role の選定で次の 2 つの問題を同時に解消する必要がある：

1. **`role="toolbar"` の keyboard pattern**：WAI-ARIA APG の toolbar pattern は **Tab で 1 tabstop / 矢印キーで内部移動 / roving tabindex** を要求する composite widget pattern。 `role="toolbar"` を主張すると AT (screen reader / keyboard nav users) はこの挙動を期待するため、 独自に「3 ボタンすべて Tab 巡回」する設計は仕様違反で AT ユーザーを混乱させる
2. **`<footer>` の implicit landmark `contentinfo`**：HTML5 spec で `<footer>` が `<main>` の sibling + `<body>` 直下に配置されると implicit landmark role `contentinfo` を獲得する。 WAI-ARIA 1.2 の `contentinfo` 定義は「親文書に関する情報 (著作権 / publisher info 等) を含む landmark」で、 mobile-footer の「操作コマンド群」用途には意味的に不適切。 さらに 1 ページに `contentinfo` は 1 つだけが推奨

| 候補                                                                                              | 採用 | 理由                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A. `<footer role="toolbar">` + roving tabindex + 矢印キー / Home / End を mobile-footer.ts に実装 | ✗    | 50-100 行の追加実装。 footer 3 ボタン (TOC / Search / Comment) は互いに関連性の薄い独立コマンドで、 toolbar の「同じ機能群」用途に合わない。 既存 `.toolbar-actions` も role なしのため独自 pattern を導入する根拠が薄い                                                 |
| B. `<footer>` のまま role 属性なし (implicit `contentinfo` のまま)                                | ✗    | `contentinfo` は文書情報 landmark で操作コマンド群と意味的にずれる。 加えて 1 ページに 1 つだけ推奨の landmark を消費する                                                                                                                                                |
| **C. `<footer role="group" aria-label="Mobile actions">` で implicit `contentinfo` を上書き**     | ✓    | `role="group"` で WAI-ARIA の「関連 UI コマンドの grouping」として正しく semantic 表明。 composite widget ではないため roving tabindex / 矢印キーパターンは要求されず、 3 ボタンが個別 Tab 巡回する標準挙動が維持される。 `<footer>` element は HTML semantic として維持 |
| D. `<div role="group" aria-label="Mobile actions">` (HTML element を `<div>` に変更)              | ✗    | `<header class="app-header">` が sectioning element として使われている対称性を崩す。 `<footer>` element の HTML semantic (page-level の操作領域) を捨てる根拠が薄い                                                                                                      |
| E. `<nav>` element で implicit `navigation` landmark にする                                       | ✗    | 3 ボタンのうち Search は「overlay の開閉コマンド」で navigation でない (TOC / Comment drawer は navigation 寄りだが、 Search を含む全体を navigation と呼ぶのは誤り)                                                                                                     |

採用案 C の論点：

- `role="group"` は WAI-ARIA 1.2 で「ページサマリ / 目次に含めない関連 UI オブジェクトのまとまり」と定義され、 form グループ (radio buttons / checkboxes) や関連ボタン群に適切。 mobile-footer の 3 ボタンは「mobile 操作領域の関連コマンド」として明確に合致
- `<footer>` element の HTML semantic を維持しつつ、 `role="group"` で implicit `contentinfo` を **上書き** する (ARIA role override は HTML5 + ARIA で許容される。 ただし `<main>` / `<nav>` 等 sectioning element の role override は禁止規則があるため、 `<footer>` は許容範囲を要確認 → `<footer>` は ARIA 1.2 / HTML in ARIA で role override 可能と定義されている)
- composite widget ではないので keyboard pattern (Tab / 矢印) は問わない → §5.j の Tab 巡回設計 (drawer + mobile-footer 3 ボタンに閉じる) とそのまま整合
- 既存 review.html の `.toolbar-actions` (header 内のボタン群、 review.html l.281) も `role` なしで個別 Tab 巡回するシンプル設計。 mobile-footer も同等の Tab 挙動を維持 (group role は keyboard pattern を要求しない)
- i18n キー名 `mobile.footer_label` は group ラベルとして機能 (landmark ではなく grouping のラベル、 意味のズレなし)
- 将来 footer ボタンが 5 個以上に増え、 かつ「関連性の高い機能群」になった場合は `role="toolbar"` (案 A) を再検討する

### o. mobile-footer ボタンの styling と tap target

footer 3 ボタンはアイコンのみの `<button>` で、 CSS class / style を指定しないとブラウザ既定の小さい button が表示される。 WCAG 2.5.5 Target Size (AAA) / WCAG 2.5.8 Target Size (Minimum、 AA) / Apple HIG / Material Design はいずれも **最低 44×44 CSS pixel のタップ target** を推奨。 加えて drawer / search-bar の open 状態を visual に伝える toggle pressed 表現も必要。

| 候補                                                                            | 採用 | 理由                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. `.mobile-footer button` selector で mobile 専用スタイルを完全自前定義        | ✗    | 既存 `.btn` / `.btn-ghost` の hover / focus-visible / border-radius / disabled 規約と二重管理になる。 desktop 改修時の追従漏れリスク                                                                                             |
| **B. 既存 `.btn.btn-ghost` を流用 + mobile 用 min-height / hover 色のみ上書き** | ✓    | 既存 toolbar ボタン (`#btn-search` / `#btn-help` / `#btn-settings`) と同じ pattern。 焦点 / disabled / border-radius は既存規約のまま、 mobile 固有の調整 (44×44 / hover 色 / aria-pressed 色) のみ追記。 desktop 改修も自動追従 |
| C. 新規 `.btn-mobile-icon` class を作って完全分離                               | ✗    | 既存 `.btn-ghost` との差が小さく、 命名 / メンテ負担が増える。 mobile 専用 selector で十分                                                                                                                                       |

採用案 B の実装：

```css
@media (max-width: 768px) {
  .mobile-footer .btn {
    box-sizing: border-box; /* 既存 .btn は box-sizing 未指定 = content-box、 明示しないと outer 70px に膨らむ */
    min-height: 44px;
    min-width: 44px;
    padding: 12px;
    line-height: 1; /* 既存 .btn の line-height: 20px が content size を 20→44 に押し上げるのを抑制、 icon 16px のみが content として効く */
  }
  .mobile-footer .btn-ghost:hover {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .mobile-footer .btn-ghost[aria-pressed='true'],
  .mobile-footer .btn-ghost[aria-expanded='true'] {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    border-color: color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .mobile-footer .btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
}
```

採用案 B の論点：

- **`box-sizing: border-box` の必須化**：既存 `.btn` (review.css l.860-877) は `box-sizing` 未指定で default `content-box`。 `min-height: 44px` + `padding: 12px` + `border: 1px` の組み合わせで content-box 計算では outer = `44 + 24 + 2 = 70px` となり footer 内側 55px から 15px overflow する。 `border-box` 明示で outer 44px に固定 (内側 content area = 44 - 24 - 2 = 18px、 icon 16px が center align で収まる)
- **`line-height: 1` の理由**：既存 `.btn { line-height: 20px }` のままだと content size が 20px ベースになり、 box-sizing: border-box でも content + padding + border = `20 + 24 + 2 = 46px` で `min-height: 44px` が機能せず実寸が 46px になる。 `line-height: 1` で text line-height を抑制し icon 16px が content size を決めるようにすれば、 `min-height: 44px` が `max(16 + 24 + 2, 44) = 44` で機能する
- **タップ target**：上記の border-box + line-height 1 で outer 44×44 が確定。 WCAG 2.5.5 / 2.5.8 / Apple HIG / Material Design 推奨値を満たす
- **hover 色の差別化**：既存 `.btn-ghost:hover { background: var(--paper-edge) }` (review.css l.942-946) は mobile footer 背景 (`var(--paper-edge)`) と同色で visual に消える → `color-mix` で accent 8% の半透明背景に上書き
- **ARIA state attribute = toggle / expanded 状態**：既存 desktop の `#btn-search` / `#btn-help` は JS が `.btn-active` class と `aria-pressed` 属性を **両方同期** する方式 (review.css l.947-955 のコメント参照)。 mobile-footer は **`aria-pressed` (Search) / `aria-expanded` (TOC/Comment) の attribute selector を OR で拾う** 方式で色付け、 `mobile-footer.ts` の JS 量を減らす。 既存 desktop 規約 (`.btn-active` class 同期) は据え置きで mobile と独立に動作。 ARIA state の使い分け根拠は §5.q (drawer は `aria-expanded`、 search-bar は `aria-pressed`)
- **`:focus-visible` の自前明示**：既存 review.css に **`.btn:focus-visible` 規則は無く** UA stylesheet の default focus ring に依存している現状。 UA focus ring は OS / ブラウザによって見た目が異なり、 keyboard nav 可視性が一定しない。 mobile では `outline: 2px solid var(--accent); outline-offset: 2px` を明示し、 footer 内側余白 (上下 5.5px) に収まる範囲で focus ring を保証。 共通 `.btn:focus-visible` 規則の追加は本タスクのスコープ外として将来 desktop 改修時の別タスクで扱う
- 将来既存 `.btn-ghost` の hover 色 / disabled 色 / border-radius を改修する場合、 mobile footer も自動追従 (上書きは `box-sizing` / `line-height` / `min-height` / `padding` / `hover` / `aria-pressed` / `aria-expanded` / `focus-visible` のみ)

### p. mobile-search-bar の compact 化

既存 `.search-bar` (review.css l.1108-1150) は desktop の広い toolbar 領域を前提に設計されており、 内部要素の最小幅合計が iPhone SE (375px) を超えて横スクロールを発生させる。

既存合計寸法：

| 要素                       | 既存値                          | 寄与幅     |
| -------------------------- | ------------------------------- | ---------- |
| `.search-bar` 左右 padding | `padding: 8px 24px`             | 48px       |
| 内部 gap (5 要素間)        | `gap: 8px` × 4                  | 32px       |
| `.search-input`            | `min-width: 200px` + border 2px | 202px      |
| `.search-count`            | `min-width: 80px`               | 80px       |
| `.search-action` 3 ボタン  | `padding: 4px 8px` × 3          | ~90px      |
| **合計**                   |                                 | **~450px** |

iPhone SE (375px) を **75px 超過** し、 viewport を横スクロールせざるを得ない → drawer / footer のレイアウト整合性が崩れる。

| 候補                                                                   | 採用 | 理由                                                                                                                             |
| ---------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------- |
| A. mobile では `.search-bar` 全体を `overflow-x: auto` で許容          | ✗    | 横スクロールしながら検索操作するのは UX 上不快、 input focus 時の viewport 自動スクロールと相性が悪い                            |
| **B. mobile 用に内部要素の min-width / padding / gap / font を縮める** | ✓    | flex layout で自然に viewport 幅に収まる。 input は flex:1 で残り領域を伸縮、 count / 3 ボタンは flex-shrink: 0 で固定サイズ維持 |
| C. `.search-count` を mobile では `display: none`                      | ✗    | 件数表示 ("3/27") は検索 UX 上重要な情報、 compact 化 (font-size 11px + min-width 0) で残せる場合は残す方が筋                    |
| D. drawer のように `position: fixed` で modal 化                       | ✗    | 既存 sticky 配置を破壊して全画面 overlay にすると `f` キー / Esc 経路の挙動も再設計が必要、 minimum 実装の範囲を超える           |

採用案 B の実装：

```css
@media (max-width: 768px) {
  .search-bar {
    padding: 8px 12px; /* 左右 24→12 */
    gap: 6px; /* 8→6 */
  }
  .search-input {
    box-sizing: border-box; /* 既存 .search-input は box-sizing 未指定 → border-box 明示 */
    min-width: 0; /* 200→0、 flex:1 が残り領域を伸縮 */
    min-height: 44px; /* WCAG 2.5.5 / Apple HIG 推奨の 44px tap target */
    font-size: 16px; /* 14→16: iOS Safari の input フォーカス時 viewport auto-zoom 抑止 */
  }
  .search-count {
    min-width: 0; /* 80→0 */
    font-size: 11px; /* 12→11 */
    flex-shrink: 0;
  }
  .search-action {
    box-sizing: border-box; /* 既存 outer ~24px の content-box を上書き */
    min-width: 44px; /* WCAG 2.5.5 / Apple HIG 推奨の 44px tap target、 §5.o footer 3 ボタンと同水準 */
    min-height: 44px;
    padding: 4px 6px; /* 左右 8→6 */
    flex-shrink: 0;
  }
}
```

採用案 B の論点：

- **375px 内訳**：左右 padding 24 + gap 24 (6×4) + count compact ~30 + 3 ボタン **44×3 = 132** = 210px、 残り **input 領域 = 165px** で `min-width: 0` の input が flex:1 で埋める (mobile UI 標準の検索 input 幅 ~150px と同等で実用十分)
- **3 操作ボタンの tap target**：既存 `.search-action { padding: 4px 8px }` (review.css l.1146-1150) は font-size 14 + padding + border で outer ~24×26px、 WCAG 2.5.5 / Apple HIG 推奨 44×44 を満たさない。 `box-sizing: border-box` + `min-width/min-height: 44px` で 44×44 に拡張。 §5.o footer 3 ボタンと同水準を確保
- **search-bar 行高の増加**：button 44 + 上下 padding 8×2 + border 1 ≈ **約 61px** (旧 desktop ~30px から +31px)。 mobile では tap target 確保のトレードオフとして許容、 viewport 上端の sticky 配置なので背面本文との overlap 増は問題なし
- **`flex-shrink: 0` の役割**：count / 3 ボタンは縮まないので、 input だけが残り領域を伸縮する。 input は文字入力中に拡大表示する OS 機能との整合も保たれる
- **件数表示の維持**：`.search-count` は font-size を 11px に縮めて min-width 0 にすれば「3/27」程度のテキストは描画できる。 完全 hide (案 C) は UX 上の損失が大きい。 count は static text (interactive でない) のため tap target 規約対象外で 44px 化は不要
- **既存 desktop は影響なし**：768px ブロック内なので desktop の `.search-bar` (200px min-width + 24px padding + 24px button 等) はそのまま機能
- **search-bar の close button 等の clipping**：`overflow: hidden` を使わず flex layout に任せるので、 viewport 端で要素が切れることはない (内部要素合計が viewport 内に収まる)
- **iOS Safari の input auto-zoom 回避**：iOS Safari は `<input>` の `font-size` が 16px 未満だとフォーカス時に viewport を自動拡大する (Apple Developer Forums で広く知られた挙動)。 既存 `.search-input { font-size: 14px }` (review.css l.1126) のままだと mobile で input タップ毎に画面がズームインし UX が分断される。 mobile で `font-size: 16px` に上書きして抑止する。 `<meta name="viewport" content="user-scalable=no">` での viewport ズーム全体禁止は WCAG 1.4.4 Resize Text 違反になるため採用しない。 font-size 14→16 で input の inner 高さが約 2px 増えるが、 `min-height: 44px` でその差は吸収される

### q. footer ボタンの ARIA state attribute 使い分け (`aria-expanded` vs `aria-pressed`)

footer 3 ボタンが制御する 3 つの widget は semantic が異なる：

- **TOC drawer (`.page-nav`) / Comment drawer (`.comments`)**：collapsible panel (開閉する側面パネル)
- **search-bar (`.search-bar`)**：toggle command (検索 UI の表示 on/off)

WAI-ARIA 仕様での state attribute の使い分け：

- **`aria-expanded`**：disclosure widget / collapsible panel / accordion / drawer 等、 「開閉する subordinate content」を制御する場合に使う。 加えて `aria-controls` で制御対象 element の id を関連付ける
- **`aria-pressed`**：toggle button (bold ボタンのように「押された on 状態」を保つ命令型 button) に使う。 開閉する subordinate content の概念がない

| 候補                                                                          | 採用 | 理由                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A. 3 ボタンすべて `aria-pressed` で統一                                       | ✗    | drawer は collapsible panel なので `aria-pressed` は semantic に誤り。 AT ユーザーが「toggle button」と「panel opener」を区別できない                                                                                                                  |
| **B. drawer は `aria-expanded` + `aria-controls`、 search は `aria-pressed`** | ✓    | WAI-ARIA semantic に正確。 既存 `.page-nav-toggle-tab` / `.comments-toggle-tab` (review.html l.664-688) も `aria-expanded` + `aria-controls` を採用しており規約と整合。 search は既存 `#btn-search` の `aria-pressed` を維持して `wireSearch` 経路統一 |
| C. 3 ボタンすべて `aria-expanded` で統一                                      | ✗    | search-bar は subordinate content として drawer ほど明確ではなく、 既存 `#btn-search` も `aria-pressed` を採用。 全体統一のために既存規約を破壊する根拠が薄い                                                                                          |

採用案 B の論点：

- **TOC/Comment の DOM 属性**：
  - `#btn-mobile-toc`：`aria-expanded="false"` + `aria-controls="page-nav-list"` (drawer 内の `<ul id="page-nav-list">` を指す)
  - `#btn-mobile-comments`：`aria-expanded="false"` + `aria-controls="cmt-list"` (drawer 内の `<div id="cmt-list">` を指す)
- **Search の DOM 属性**：`#btn-mobile-search`：`aria-pressed="false"` (既存 `#btn-search` と同様)
- **JS sync**：
  - drawer open/close で `aria-expanded` を直接 toggle (`mobile-footer.ts` 内、 `<html>` class 操作と同タイミング)
  - search は `wireSearch` 経路に委譲済み、 `aria-pressed` は `.search-bar.open` を MutationObserver で監視して sync (§3.3)
- **CSS selector**：`.mobile-footer .btn-ghost[aria-pressed='true'], .mobile-footer .btn-ghost[aria-expanded='true']` の OR で両方を accent 色 で表現 (§5.o)
- **AT ユーザーへの読み上げ**：
  - TOC ボタンに focus → 「Show table of contents, collapsed (or expanded), button, controls page-nav-list」と AT が読む (drawer 開閉状態 + 制御対象が明確)
  - Search ボタンに focus → 「Search the document, toggle button, not pressed (or pressed)」と AT が読む (toggle 状態)
- **既存 `.page-nav-toggle-tab` / `.comments-toggle-tab` との対称性**：両者ともに `aria-expanded` + `aria-controls` 規約 (review.html l.669-670, l.683-684)、 mobile-footer の TOC/Comment も同じ semantic に揃える

### r. drawer 内 navigation 経路での自動 close (TOC は既存 hook / Comments は新規 registry 追加)

TOC drawer 内 / Comments drawer 内の navigation activation で背面 `.doc-pane` の対応ブロックへスクロールするが、 drawer が開いたままだと遷移先が drawer に隠れて UX 不良。 さらにキーボード由来の navigate では既存処理が **遷移後 inert になった TOC link に focus を戻す** ため、 競合する。

navigation 経路は DOM selector ベース (`.page-nav-link` 等) で網羅するより、 既存 / 新規 callback hook 経由で一元的に扱うほうが堅牢：

- **TOC 側**：`onCompositeSlugClick(compositeSlug, keyboardActivated)` (`src/app/navigation/navigation-orchestrator.ts:165`) が `.page-nav-link` / `.page-outline-link` / `.page-nav-sequential-link` を含む **全 TOC 遷移経路の単一 entry point**。 内部に mobile 分岐を追加
- **Comments 側**：既存 `setOnCommentNavigate` (`comments.ts:20-22`) は **単一変数代入** で chain ではなく、 review.ts (composition root) が `navigateToTarget` を 1 件 register する用途。 さらに `requestNavigateToCommentPage` (`comments.ts:42`) は `focusCommentCard()` (`l.48-61`) 内の **別ページ判定時のみ発火** し、 **同一ページの comment カード click / Enter キーは `focusCommentCard()` 内で直接処理されるため callback 経由しない**。 → 既存 `setOnCommentNavigate` は触らず、 新規 `addOnCommentActivate(handler)` registry (Set) を追加して `focusCommentCard()` の **各分岐の return 前** (別ページ navigation 後 / 同一ページ mark 不在 early return 前 / 同一ページ scroll 完了後) で fire することで同一/別ページ / mark 不在問わず activation を拾う

| 候補                                                                                                                                    | 採用 | 理由                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A. drawer 内 DOM selector 列挙 (`.page-nav-link` / `.cmt-quote` 等) で delegation                                                       | ✗    | `.page-outline-link` / `.page-nav-sequential-link` / comment カード本体 click / Enter キー等の経路を網羅できない                                                                                                                           |
| B. 既存 `setOnCommentNavigate` を再 register して chain なし上書き                                                                      | ✗    | 単一変数代入のため review.ts が注入した既存 `navigateToTarget` が失われる。 また別ページ判定時のみ発火で同一ページ経路を拾えない                                                                                                           |
| **C. TOC は `onCompositeSlugClick` に mobile 分岐追加、 Comments は新規 `addOnCommentActivate` registry を `focusCommentCard` で fire** | ✓    | TOC は既存 entry point に mobile 分岐を追加。 Comments は新規 Set registry で chain 対応 + 既存 `setOnCommentNavigate` を保持 + `focusCommentCard` 冒頭発火で同一/別ページ両方を拾う。 `focusTOC` gate と `.doc-pane` 退避を統一的に扱える |

採用案 C の実装：

`navigation-orchestrator.ts` 側 (TOC)：

```ts
// `focusTOC` は onCompositeSlugClick の local 変数ではなく、 navigateToTarget の第 3 引数 (l.133-136)。
// mobile drawer 経路では keyboardActivated を false 強制で渡すことで `focusNavigatedLink` (l.146-151) をスキップする。
export const onCompositeSlugClick = (compositeSlug: string, keyboardActivated: boolean): void => {
  const mobileDrawerOpen = isMobilePageNavOpen()
  navigateToTarget(
    resolveTargetFromHash(`#${compositeSlug}`),
    true,
    mobileDrawerOpen ? false : keyboardActivated // 第 3 引数 focusTOC を mobile 経路では false 強制
  )
  if (mobileDrawerOpen) {
    closeMobilePageNav({ restoreFocus: false })
    document.querySelector<HTMLElement>('.doc-pane')?.focus({ preventScroll: true })
  }
  // desktop 既存挙動 (keyboardActivated がそのまま第 3 引数に渡る) は無変更
}
```

`comments.ts` 側 (Comments)：

```ts
// 新規追加：activation registry (Set で chain 対応)
const onCommentActivateHandlers = new Set<(comment: Comment) => void>()
export const addOnCommentActivate = (handler: (comment: Comment) => void): (() => void) => {
  onCommentActivateHandlers.add(handler)
  return () => onCommentActivateHandlers.delete(handler) // unregister 関数を返す
}
const fireCommentActivate = (comment: Comment): void => {
  for (const handler of onCommentActivateHandlers) handler(comment)
}

// `focusCommentCard` の **各分岐の return 前** で fire (3 経路すべて: 別ページ navigation 後 /
// 同一ページ mark 不在 early return 前 / 同一ページ scroll 完了後)。
// 冒頭で fire すると別ページ経路の navigateToComment が後で newCard.focus() (l.183) を呼んで
// mobile handler の `.doc-pane.focus()` を上書きしてしまうため、 fire は各処理後に行う。
const focusCommentCard = (card: HTMLElement, comment: Comment): void => {
  if (comment.pageIndex !== state.activePageIndex) {
    requestNavigateToCommentPage(comment) // 既存：別ページ遷移 (navigateToComment が newCard.focus() を呼ぶ)
    fireCommentActivate(comment) // 新規：navigation 完了後に fire → mobile handler が newCard.focus を上書きして .doc-pane に退避
    return
  }
  const mark = document.querySelector(`mark.cmt[data-comment-id="${comment.id}"]`)
  if (!mark) {
    // mark が見つからない孤立 comment (アンカリング失敗) でも drawer を閉じる通知は必要
    fireCommentActivate(comment) // 新規：mark 不在 early return の前に fire
    return
  }
  // 既存：同一ページの mark active + card active + instantScrollToCenter
  clearActiveComments()
  mark.classList.add('active')
  card.classList.add('active')
  instantScrollToCenter(mark)
  fireCommentActivate(comment) // 新規：同一ページ処理後に fire (drawer close + .doc-pane.focus)
}
```

`mobile-footer.ts` 側 (composition root)：

```ts
addOnCommentActivate((comment) => {
  if (!isMobileCommentsOpen()) return // desktop は no-op
  closeMobileComments({ restoreFocus: false })
  document.querySelector<HTMLElement>('.doc-pane')?.focus({ preventScroll: true })
})
```

採用案 C の論点：

- **全 navigation 経路の網羅**：TOC は `onCompositeSlugClick` が `.page-nav-link` / `.page-outline-link` / `.page-nav-sequential-link` の click + Enter キーすべての単一 entry point。 Comments は `focusCommentCard` 冒頭の `fireCommentActivate` で同一ページ (`focusCommentCard` 内直接処理) / 別ページ (`requestNavigateToCommentPage` 経由) 両経路の activation を拾う → DOM selector 列挙の漏れリスクを構造的に排除
- **`addOnCommentActivate` は Set registry**：既存 `setOnCommentNavigate` (単一代入) と直交した新 API。 chain で複数 handler を register 可能、 unregister 関数を返すことで idempotent 性も担保 (wireMobileFooter 2 回呼びでも重複しない)
- **`navigateToTarget` 第 3 引数 (focusTOC) を mobile 経路で false 強制**：`onCompositeSlugClick` 内に `focusTOC` という local 変数は存在せず、 `navigateToTarget(target, pushHash, focusTOC = false)` (`l.133-136`) の **第 3 引数** として渡される。 mobile drawer 経路では `mobileDrawerOpen ? false : keyboardActivated` のように第 3 引数を `false` 強制で呼び、 `navigateToTarget` 内の `focusNavigatedLink` (`l.146-151`) をスキップする。 これで inert TOC link への focus 競合を構造的に回避。 desktop 既存挙動 (`keyboardActivated` がそのまま第 3 引数に渡る) は無変更
- **`.doc-pane.focus({preventScroll: true})` の理由**：mobile では navigation 完了時に scroll が自動で `.doc-pane` 内の対応位置へ移動するため、 `preventScroll: true` で「focus 移動だけ」を行い既存 scroll を上書きしない
- **`restoreFocus: false` の補強**：close 関数で `lastTrigger` (footer trigger button) に focus を戻すと、 navigation 完了後 footer に focus が残り「遷移先を見る」ユーザ意図と矛盾する → `.doc-pane.focus()` で本文側に退避するのが UX 上自然
- **既存 callback hook の改修**：`navigation-orchestrator.ts` の `onCompositeSlugClick` に mobile 分岐 + `comments.ts` に `addOnCommentActivate` registry 追加 + `focusCommentCard` 冒頭で fire は §4 Step 5c で扱う。 mobile handler の register は `mobile-footer.ts` 経由 (composition root)

### s. Comments drawer 内 Edit modal trigger の drawer 自動 close + comment-modal.ts に focus 復元契約追加

Comments drawer 内には Edit / Delete 2 種類の button があるが、 既存実装の動作は異なる (`src/app/comments/comments.ts:131` / `comment-rendering.ts:45-46`)：

- **`.cmt-edit`** (`data-edit` 属性)：comment 編集 modal を開く (`comment-modal.ts` 経由)
- **`.cmt-del`** (`data-del` 属性)：`deleteComment(comment)` を直接呼んで **即時削除** (modal 開かない)

さらに **`comment-modal.ts` には `lastTrigger` / `activeElement` 保存 → close 時 focus 復元の処理が存在しない** (`setTimeout(() => qsInput('#modal-input').focus(), 50)` で input に focus するだけ、 §4 Step 5b の search-controller と同様の問題)。 そのため §5.s 旧設計の「既存 modal が footer button を保存・復元する」前提は成立しない。

| 候補                                                                                                                                                       | 採用 | 理由                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. `.cmt-edit` も `.cmt-del` も drawer 閉じず modal/即時削除を許す                                                                                         | ✗    | Edit modal の Tab trap が drawer Tab trap (§5.j-5) と衝突して focus 巡回が予測不能になる                                                                                                                                                                |
| **B. `.cmt-edit` だけ drawer 自動 close + comment-modal.ts に focus 復元契約を追加、 `.cmt-del` は drawer 残し (削除後 focus 制御は本タスクのスコープ外)** | ✓    | Edit/Delete それぞれの実態に合わせた経路。 Edit modal の Tab trap 衝突は drawer 自動 close で解消、 Delete は即時削除 UX (連続削除シナリオ) のため drawer 残し。 削除後の focus 消失は既存 desktop でも同じ問題なので別タスクとして §1 スコープ外に明示 |
| C. `.cmt-edit` も `.cmt-del` も drawer 自動 close + 削除後 focus 制御を本タスクで実装                                                                      | ✗    | Delete 経路の drawer close は連続削除 UX を阻害 (毎回 drawer を開き直す必要)。 削除後 focus 制御の責任範囲が拡大して本タスクのスコープが膨らむ                                                                                                          |

採用案 B の実装：

**(1) `.cmt-edit` 経路** — Edit modal trigger を capture phase で先取り、 drawer close 後 modal open：

```ts
function wireDrawerEditModalAutoClose(): void {
  const comments = document.querySelector<HTMLElement>('.comments')
  comments?.addEventListener(
    'click',
    (ev) => {
      if (!isMobileCommentsOpen()) return
      const target = ev.target as HTMLElement
      // Edit modal trigger を識別 (`.cmt-edit` / `data-edit` 属性、 comment-rendering.ts:45)
      if (target.closest('.cmt-edit, [data-edit]')) {
        // restoreFocus: true で footer Comment button に focus を戻す
        // comment-modal.ts は §4 Step 5c の改修後、 lastTrigger = document.activeElement を保存
        // → modal close 時 footer Comment button に focus 復元される
        closeMobileComments({ restoreFocus: true })
        // stopPropagation はしない → bubble phase で既存 modal handler が click を受け modal open
      }
    },
    true // useCapture: true
  )
}
```

**(2) `.cmt-del` 経路** — 即時削除なので modal trigger としては扱わない：

- delete はトーストでフィードバックする UX が既存実装 (`comments.ts:82` `deleteComment`)
- drawer 内 cmt-list は削除後 `onDeleted()` (= `renderComments`、 `comments.ts:132`) で再 render される → 削除直後の `document.activeElement` が消失した card 内にあった場合、 browser が `<body>` に focus を fallback
- mobile では drawer 開きっぱなしで cmt-list が更新される (delete 後ユーザは別 comment を続けて操作可能)
- **`.cmt-del` 経路では drawer 自動 close は行わない**（削除 → 次の操作 → 別 comment 削除/編集 の連続 UX を維持）
- 削除後 focus 消失の問題は本タスクのスコープ外（既存 desktop でも同じ問題、 別タスク扱い）

**(3) `comment-modal.ts` の共通 helper `showModalWithBody` に focus 復元 + timer 管理を追加** — `comment-modal.ts` には現状 (a) `lastTrigger` 保存・復元処理が無い、 (b) `showModalWithBody` (`l.40-48`、 共通 helper) が `setTimeout(() => qsInput('#modal-input').focus(), 50)` で **50ms 後の input focus を予約** し cancel する経路がない、 という 2 つの欠落がある。 open 直後に Esc/Cancel すると、 footer に focus 復元した後で timer 発火 → 非表示 input に focus が奪われる (§4 Step 5b の `search-controller.ts` と全く同じ問題)。 さらに modal を開く関数は `openEditCommentModal` (Edit、 `l.65`) と private `openModal` (新規追加、 `l.58`) の 2 種類あり、 私の旧設計の `openCommentModal(comment)` は **存在しない関数名**。 両経路が経由する共通 helper `showModalWithBody` に契約を置くのが正解：

```ts
// comment-modal.ts module level
let lastTrigger: HTMLElement | null = null
let pendingFocusTimer: ReturnType<typeof setTimeout> | null = null

// 共通 helper (openEditCommentModal と openModal の両方が呼ぶ、 l.40-48)
const showModalWithBody = (quote: string, body: string): void => {
  if (isSearchOpen()) closeSearch()
  // 新規：activeElement を lastTrigger に保存 (両 open 経路で機能)
  lastTrigger = document.activeElement as HTMLElement | null
  qs('#modal-quote').textContent = `“${quote}”`
  qsInput('#modal-input').value = body
  qs('#modal').classList.add('open')
  // 新規：timer ID を保存して cancel 可能に
  pendingFocusTimer = setTimeout((): void => {
    qsInput('#modal-input').focus()
    pendingFocusTimer = null
  }, 50)
}

export const closeCommentModal = (): void => {
  // 新規：modal が実際 open でない場合は no-op (Escape の連続 / drawer・search・menu の Escape 経路で
  // `global-keyboard.ts:56` の `closeAllModalsForEscape` が無条件で closeCommentModal() を呼ぶため、
  // modal closed 状態で `restoreFocusAfterClose(null)` まで進んで focus が `.doc-pane` / footer に奪われる
  // 回帰を構造的に防ぐ)
  if (modalState.current.kind === 'closed') {
    return
  }
  // 既存：pending timer を cancel (input への focus 奪取を防ぐ)
  if (pendingFocusTimer !== null) {
    clearTimeout(pendingFocusTimer)
    pendingFocusTimer = null
  }
  qs('#modal').classList.remove('open')
  modalState.current = { kind: 'closed' }
  // 既存処理...
  // 新規：focus 復元 + isFocusable フォールバック (§4 Step 5c と統一)
  // `saveEditedComment` (l.142-149) は `renderComments()` で cmt-list を再描画してから本関数を
  // 呼ぶため、 lastTrigger (= 旧 Edit ボタン) が DOM から detach されている。 isFocusable
  // (isConnected + display / visibility / size チェック) で確認し、 同一 comment id の新 Edit ボタンや
  // mobile footer Comment button (mobile 時のみ) / .doc-pane に fallback する。
  const trigger = lastTrigger
  lastTrigger = null
  restoreFocusAfterClose(trigger)
}

// isConnected と祖先の display / visibility / inert を確認するだけでは不十分：
// `#floater` の `mousedown` handler が `event.preventDefault()` で focus 移動を抑止する
// (`comment-modal.ts:179`) ため、 modal open 直前の `document.activeElement` は floater ではなく
// `<body>` 等の元の active element になる。 `<body>` は祖先 chain では visible だが、
// HTML spec で focusable element ではないため、 element 自身が focusable selector に match するかを
// 最初に確認する必要がある。
//
// FOCUSABLE_SELECTOR は既存 `static-modal.ts:133-140` の規約と統一 (一貫した focus 判定基準)。
// happy-dom はレイアウト計算を行わず `getBoundingClientRect()` / `offsetParent` を実装しないため、
// size / layout 依存の判定 (旧 size 判定) は使わない (`static-modal.ts:132` の規約と同じ)。
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const isFocusable = (el: HTMLElement | null): boolean => {
  if (!el || !el.isConnected) return false
  // 要素自身が focusable element か確認 (`<body>` / `<div>` 等は除外)
  if (!el.matches(FOCUSABLE_SELECTOR)) return false
  // 祖先 chain で display / visibility / inert を辿る (祖先伝播の確認)
  let current: HTMLElement | null = el
  while (current) {
    if (current.hasAttribute('inert')) return false
    const style = window.getComputedStyle(current)
    if (style.display === 'none') return false
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false
    current = current.parentElement
  }
  return true
}

const restoreFocusAfterClose = (trigger: HTMLElement | null): void => {
  if (isFocusable(trigger)) {
    trigger!.focus({ preventScroll: true })
    return
  }
  // (a) 同一 comment id の新 Edit ボタンへ
  const commentId = trigger?.closest('.cmt-card')?.getAttribute('data-id')
  if (commentId) {
    const newEditBtn = document.querySelector<HTMLElement>(
      `.cmt-card[data-id="${commentId}"] .cmt-edit`
    )
    if (isFocusable(newEditBtn)) {
      newEditBtn!.focus({ preventScroll: true })
      return
    }
  }
  // (b) 最終フォールバック：matchMedia で mobile 判定し、 mobile なら footer Comment button、
  // desktop なら .doc-pane (`:not([hidden])` だけでは CSS `display: none` の footer 配下の button も
  // 一致してしまうため matchMedia で明示分岐する)
  const isMobile = window.matchMedia('(max-width: 768px)').matches
  const fallback = isMobile ? document.querySelector<HTMLElement>('#btn-mobile-comments') : null
  ;(fallback ?? document.querySelector<HTMLElement>('.doc-pane'))?.focus({
    preventScroll: true,
  })
}
```

採用案 B の論点：

- **`showModalWithBody` 共通 helper に契約を置く根拠**：`openEditCommentModal` (Edit、 `l.65`) と private `openModal` (新規追加、 `l.58`) の両経路が `showModalWithBody` を経由 (`l.40-48`)。 共通 helper に契約を置くことで両経路で `lastTrigger` 保存 + timer 予約が成立する。 旧設計の `openCommentModal(comment)` は **存在しない関数名** だったため修正
- **`pendingFocusTimer` 管理の必須性**：既存 `setTimeout(() => qsInput('#modal-input').focus(), 50)` は cancel されないため、 open 直後に Esc/Cancel で `closeCommentModal` を呼んでも 50ms 後に input に focus が戻る。 `showModalWithBody` で timer ID を保存、 `closeCommentModal` で `clearTimeout` する pattern は §4 Step 5b の `search-controller.ts` と完全に同じ
- **`lastTrigger.isConnected` フォールバック**：`saveEditedComment` (`comment-modal.ts:142-149`) は `renderComments()` で cmt-list を再描画してから `closeCommentModal()` を呼ぶ。 lastTrigger (= 旧 Edit ボタン) は DOM から detach されているため `focus()` が silently fail する。 `restoreFocusAfterClose` ヘルパで (a) `isConnected` 確認、 (b) 同一 comment id の新 Edit ボタンへフォールバック、 (c) 最終フォールバックで mobile footer Comment button or `.doc-pane` への退避 を 3 段階で実施
- **`.cmt-edit` selector の根拠**：`comment-rendering.ts:45` で `<button class="cmt-edit" data-edit="${comment.id}">` と定義。 capture phase で `closest('.cmt-edit, [data-edit]')` の両方を見て identify
- **`.cmt-del` 経路を drawer 自動 close 対象から外す根拠**：即時削除 UX は「複数 comment を連続削除する」シナリオで drawer 開きっぱなしの方が自然 (毎回 footer Comment 押下で drawer を開き直す UX は冗長)。 削除後 focus 消失は既存 desktop でも同じ問題 (削除された card に focus が残る) で、 本タスクは Edit modal trigger 経路に絞る → §1 スコープ外に「Delete 後 focus 消失の対処」を明示し、 将来別タスクで `restoreFocusAfterClose` 相当の helper を `deleteComment` に追加することで desktop / mobile 双方を改善する道筋を残す
- **capture phase 登録 + `stopPropagation` しない**：bubble phase で既存 modal handler が click を受け modal open する経路を破壊しないため
- **modal close 後の drawer 再 open は行わない**：minimum 実装では footer Comment 再押下に任せる
- **desktop 既存挙動への副作用**：Edit modal を閉じた後 trigger button (drawer 内 `.cmt-edit`) に focus が戻る点は desktop でも改善 (規約準拠) で副作用なし。 新規追加 modal も `lastTrigger` (例えば floater の Comment ボタン) に focus 復元される

## 6. テスト方針

### in-source test（新規）

- `src/app/chrome/mobile-footer.ts`：
  - TOC ボタン click で `<html>` に `mobile-page-nav-open` が付き、再 click で外れる
  - Comment ボタン click で同様（`mobile-comments-open`）
  - TOC 開中に Comment click → TOC が閉じ Comment が開く（mutually exclusive、 §5.j）
  - **切替時の lastTrigger 取り違え防止**：TOC 開中に Comment click → close 後の `lastTrigger` が Comment ボタンであり旧 TOC ボタンではないこと（§5.j-2）
  - **`closeMobileXxx({ restoreFocus: false })` で focus が `lastTrigger` に戻らないこと**
  - **`closeMobileXxx({ restoreFocus: true })` (default) で focus が `lastTrigger` に戻ること**
  - backdrop click で `closeMobileDrawers` が全 drawer を閉じる
  - footer Search ボタン click が drawer を先に閉じてから `#btn-search.click()` を委譲する（§5.m）
  - search-bar open 中に TOC ボタン click で search-bar が閉じて drawer が開く（§5.m 逆方向）
  - `.search-bar` の `.open` class 操作で `#btn-mobile-search` の `aria-pressed` が sync する（MutationObserver、 `f` キー / Esc 経由の状態変化に追従）
  - **matchMedia change で desktop 側に切り替わると drawer が強制 close + 両 drawer から inert / aria-hidden が除去される**：`window.matchMedia('(max-width: 768px)')` を mock し、 change event で `matches: false` を発火 → `closeMobileDrawers({ restoreFocus: false })` + `applyMobileInertState()` の desktop ブランチで drawer / 背面 3 要素 inert / `mobile-*-open` class / `mobile-drawer-open` class + **両 drawer の inert / aria-hidden** がすべて除去される（§5.j-3）
  - **matchMedia change で mobile 側に進入した時 (`matches: true`) は両 drawer に inert + aria-hidden が付く**：change event で `matches: true` を発火 → `closeMobileDrawers({ restoreFocus: false })` (drawer 開いてれば close、 通常 desktop 上で drawer は閉じているため no-op) + `applyMobileInertState()` の mobile ブランチで両 drawer に inert + aria-hidden 付与（§5.j-3 / §5.j-4）
  - **`applyMobileInertState()` の単体テスト**：mobile 起動 (matches: true) で両 drawer に inert + aria-hidden 付与、 desktop 起動 (matches: false) で両 drawer から除去、 `.page-nav` open 中なら `.page-nav` には付与せず `.comments` のみに付与、 を mock で個別検証
  - `wireMobileFooter` を 2 回呼んでも click handler / matchMedia listener が重複しない（idempotent）
  - drawer open 中の `body` に `mobile-drawer-open` class が付き、close で外れる
  - drawer open 中に **背面 3 要素 (`.skip-link` / `.app-header` / `.doc-pane`) に `inert` + `aria-hidden="true"` が付く、 close で外れる** (`<main>` / drawer 自身 / mobile-footer には付かないことの assertion、§5.j)
  - **drawer 自身の `inert` は `applyMobileInertState()` が管理**：mobile では閉じた drawer に inert、 開いた drawer から除去、 desktop では両 drawer から除去 (§5.j-4)
  - **drawer open 直後に drawer 内先頭 focusable element に focus が移る**（§5.j-5：`.page-nav` open なら最初の `.page-nav-link`、 `.comments` open なら最初の interactive 要素、 `document.activeElement` で確認）
  - **drawer open 中に Tab key 循環 trap が成立**：drawer 末尾の focusable → Tab → footer 先頭ボタン、 footer 末尾 → Tab → drawer 先頭、 同様に Shift+Tab で逆方向 wrap (§5.j-5、 `KeyboardEvent({key:'Tab'})` を mock で発火し focus 遷移を assert)
  - **drawer open 中に focus が drawer + footer 集合の外 (`<body>`、 `.doc-pane`、 `.skip-link` 等) にある状態で Tab を発火すると、 trap が `event.preventDefault()` + 先頭 focusable に救出する** (§5.j-5、 `comment-delete → activeElement = body` 後の Tab、 `.doc-pane` に focus 退避後の Tab で `document.activeElement === drawer 内先頭` を assert)
  - **drawer close で Tab trap listener が `document` から除去される**（§5.j-5、 `removeEventListener` の spy で確認）
  - **`onCompositeSlugClick` を mobile drawer open 状態で呼ぶと `focusTOC = false` で keyboard 復元が抑止され、 `closeMobilePageNav` + `.doc-pane.focus({preventScroll: true})` が走る**（§5.r / §4 Step 5c、 `focusTOC` flag / `closeMobilePageNav` / `docPane.focus` の spy 確認、 desktop シナリオ (mobile drawer closed) では既存 `focusTOC` 復元 が走ることの regression）
  - **`addOnCommentActivate` registry に register した handler が `focusCommentCard` 呼出で発火する** (同一/別ページ問わず)、 unregister 関数で外せる (§5.r / §4 Step 5c、 chain registry の chain 性 / idempotent 性検証)
  - **mobile drawer open 状態で `focusCommentCard(comment)` (同一ページ) → 既存 scroll / mark active 完了後に mobile handler が走り、 最終 `document.activeElement === .doc-pane`** (§5.r、 spy ではなく実 activeElement で検証)
  - **mobile drawer open 状態で `focusCommentCard(otherPageComment)` (別ページ) → `requestNavigateToCommentPage` → `navigateToComment` が `newCard.focus()` (`navigation-orchestrator.ts:183`) で新カードに focus → その後 mobile handler が `.doc-pane.focus({preventScroll: true})` で上書きして最終 `document.activeElement === .doc-pane`** (§5.r 採用案 C 末尾 fire 順序、 `fireCommentActivate` を `focusCommentCard` 末尾に置く根拠の検証)
  - **mobile drawer open 状態で `focusCommentCard(orphanComment)` (同一ページだが対応する `mark.cmt` 要素が存在しない孤立 comment、 `comments.ts:53` の `if (!mark) return` で早期 return される経路) でも、 early return の直前で `fireCommentActivate` が呼ばれ、 mobile handler が `closeMobileComments` + `.doc-pane.focus()` を走らせて最終 `document.activeElement === .doc-pane`** (§5.r 採用案 C、 全 3 分岐で fire される invariant の境界検証)
  - desktop は no-op で `setOnCommentNavigate` 経路 (別ページ navigate) は無変更を regression test (mobile drawer closed 状態では `addOnCommentActivate` handler が早期 return)
  - **Comments drawer 内の `.cmt-edit` (`data-edit` 属性) click で capture phase delegation が drawer を先に close し、 focus が footer Comment button に移ってから bubble phase で Edit modal trigger が走る**（§5.s、 event の capture/bubble phase 順序と focus 遷移の検証）
  - **`.cmt-del` click は drawer 自動 close 対象外**（§5.s、 即時削除 UX で drawer 残しを維持、 capture phase handler が `.cmt-del` を識別しないことの境界 test）
  - **`showModalWithBody` 呼出 (両 open 経路 = `openEditCommentModal` / private `openModal`) で `lastTrigger = document.activeElement` が保存される**（§4 Step 5c の comment-modal.ts 改修検証、 spy ではなく実際の `document.activeElement` で end-to-end 検証）
  - **`closeCommentModal` は `modalState.current.kind === 'closed'` 状態では no-op になる**：drawer open 中に Escape を押す / search-bar open 中に Escape を押す / menu open 中に Escape を押すシナリオで `global-keyboard.ts:56` の `closeAllModalsForEscape` が `closeCommentModal()` を呼んでも `restoreFocusAfterClose` まで進まないこと (drawer 操作中の Escape で `document.activeElement` が `.doc-pane` / footer に奪われない regression、 mock で Escape を発火して focus 不変を assert)
  - **`closeCommentModal` で `lastTrigger` が isFocusable のとき focus が戻る**（footer Comment button → `.cmt-edit` → `openEditCommentModal` → Cancel で `document.activeElement === footerCommentButton` を assert）
  - **`saveEditedComment` シナリオで `renderComments()` 後に `lastTrigger` が detach されても `restoreFocusAfterClose` のフォールバックで focus が復元される**：(a) 同一 comment id の新 Edit ボタン (`.cmt-card[data-id="X"] .cmt-edit`) が存在し isFocusable なら `document.activeElement === newEditButton`、 (b) 新ボタンも無ければ mobile では `document.activeElement === #btn-mobile-comments`、 desktop では `document.activeElement === .doc-pane` (`document.activeElement` で実値検証)
  - **新規追加経路 `openModal` (floater 起動) は `#floater` の `mousedown` で `event.preventDefault()` が呼ばれる (`comment-modal.ts:179`) ため、 modal open 直前の `document.activeElement` は floater ではなく `<body>` 等**：`isFocusable(body) === false` (FOCUSABLE_SELECTOR に match しないため) で trigger フォールバックされ、 `document.activeElement` は `.doc-pane` (desktop) または `#btn-mobile-comments` (mobile) になる (`saveNewComment` 経由で実 activeElement を assert)
  - **`isFocusable` ヘルパの境界条件** (happy-dom はレイアウト計算を行わず `getBoundingClientRect` / `offsetParent` が常に 0 / null を返すため、 size / layout 依存の判定は使わない、 `static-modal.ts:132` の規約と同じ)：
    - **要素自身が focusable element か** (`static-modal.ts:133-140` の FOCUSABLE_SELECTOR 規約と統一)：
      - (a) `isConnected: false` で false
      - (b) **`<body>` で false** (FOCUSABLE_SELECTOR に match しない、 lastTrigger が `<body>` のシナリオで重要)
      - (c) **`<div>` (tabindex なし) で false**
      - (d) `<button disabled>` / `<input disabled>` で false (`:not([disabled])` で除外)
      - (e) `<div tabindex="-1">` で false (`[tabindex]:not([tabindex="-1"])` で除外)
      - (f) `<div tabindex="0">` で true、 `<button>` / `<a href>` で true
    - **祖先 chain の display / visibility / inert 確認** (祖先伝播)：
      - (g) `element.style.display = 'none'` で false
      - (h) `element.style.visibility = 'hidden'` で false
      - (i) 祖先の `display: none` で false (e.g. `.mobile-footer { display:none }` 配下の `#btn-mobile-comments`)
      - (j) 祖先の `visibility: hidden` で false
      - (k) 祖先または自身の `inert` 属性で false (inert は仕様で祖先伝播)
    - (l) 上記いずれにも該当しない通常の visible button で true (inline style で各条件を mock した element を jsdom で作成して unit test)
  - **`isFocusable` の happy-dom 互換性 regression**：通常状態の `<button>` (style 未設定) で `isFocusable === true` を assert (`getBoundingClientRect.width === 0` でも false にならない、 happy-dom 環境で誤判定しない invariant の検証)
  - **`showModalWithBody` 直後 (50ms 経過前) に `closeCommentModal` を呼ぶと `clearTimeout` で `pendingFocusTimer` が cancel される**、 vi.useFakeTimers で 50ms 進めても `#modal-input.focus()` が走らないこと (§4 Step 5c / §4 Step 5b と同 pattern)
  - **matchMedia change 時に `escapeFocusBeforeBreakpointSwitch(toMobile)` + `willBeHiddenAfterSwitch(el, toMobile)` で切替後 hide される全要素から focus が退避される** (§5.j-3、 `document.activeElement` で実値検証)：
    - **mobile 進入時** (`matches: true`)：(a) `.page-nav` / `.comments` 内 focus → `.doc-pane` 退避 (旧テスト)、 (b) **`#btn-search` / `#btn-help` / `#status` / `#online-source` 内 focus → `.doc-pane` 退避** (768px ブロック `display: none`)、 (c) **`.page-nav-toggle-tab` / `.comments-toggle-tab` 内 focus → `.doc-pane` 退避** (768px ブロック `display: none`)、 (d) `.doc-pane` 等の継続表示要素内 focus は退避しないこと (false positive 防止)
    - **desktop 進入時** (`matches: false`)：(e) `.mobile-footer` / `.mobile-drawer-backdrop` 内 focus → `.doc-pane` 退避 (旧テスト)、 (f) **`<html class="comments-closed">` 状態で `.comments` 内 focus → `.doc-pane` 退避** (grid 列幅 0)、 (g) **`<html class="page-nav-closed">` 状態で `.page-nav` 内 focus → `.doc-pane` 退避**、 (h) `*-closed` class が付いていない状態の drawer 内 focus は退避しないこと (false positive 防止)
  - **`willBeHiddenAfterSwitch` ヘルパの境界条件**：上記 (a)〜(h) を 1 つずつ単体で検証 (mock element に `closest` 対象 selector を持たせて jsdom で assert)
  - **backdrop の `hidden` 属性 / `style.display` を JS が触らないことの assertion**（CSS だけで制御されている保証、§5.l）

- `src/app/chrome/global-keyboard.ts`（既存テストに追加）：
  - mobile drawer open 中の Escape で `closeMobileDrawers` が呼ばれる
  - mobile drawer open 中の affordance キー (`a` / `w` / `s` / `d` / `e` / `f` / `h`) が suppress される
  - `isAnyModalOpen() || isMobileDrawerOpen()` の OR 経路が成立することの assertion（modal-backdrop は持たないが drawer open 中も suppress される）

- `src/app/i18n/messages.en.ts` / `messages.ja.ts`（i18n in-source test に新規追加。 既存はキー数一致 / Set 一致を検証する **ランタイム test を持たず** 型レベルの `satisfies Record<MessageKey, string>` で担保）：
  - 翻訳キー総数が両言語で一致（`mobile.*` 4 キーの差分追加：footer 3 ボタン + `<footer role="group">` の group ラベル）
  - **`Set(Object.keys(en)) ≡ Set(Object.keys(ja))` の symmetric_difference assertion**（counts 一致でも片方に追加し忘れた場合に検出するため）

- `src/app/search/search-controller.ts`（既存テストに追加、 §4 Step 5b）：
  - **`openSearch()` 直後 (timer pending 中) に `closeSearch()` を呼ぶと setTimeout が cancel される** (`clearTimeout` の spy 確認、 §5.m)
  - **`openSearch()` → `closeSearch()` → 別 element に focus → vi.useFakeTimers で delay 経過後も focus が input に戻らない** (mobile overlay 相互排他で Search → drawer 即切替シナリオの再現)
  - 既存 `f` キー → Esc → 別 button focus の desktop シナリオも同じ修正で安全 (regression test)

### 手動視覚チェックリスト

`npm run build` 後、 次の配布物 / preset を組み合わせて確認：

| 配布物                                     | preset                                                   | 確認内容                                                                                                                                                                                                                              |
| ------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dist/standalone.html`                     | iPhone SE (375×667)                                      | footer 3 ボタンが viewport 下端に張り付く、 tap で drawer 開閉                                                                                                                                                                        |
| `dist/standalone.html`                     | iPhone 14 Pro (393×852)                                  | safe-area inset 反映（header 外寸 `65 + 47 = 112px`、 footer 外寸 `56 + 34 = 90px`、 `.layout padding-bottom` も追従）                                                                                                                |
| `dist/standalone.html`                     | iPhone SE landscape (667×375)                            | landscape でも drawer モデルになる (幅 667 < 768)                                                                                                                                                                                     |
| `dist/standalone.html`                     | iPhone 14 Pro Max landscape (932×430)                    | landscape 幅 932 が 769-900px の範囲を超えるため **desktop モデル** (toolbar / sidebar / `.search-bar` 全表示)                                                                                                                        |
| `dist/standalone.html`                     | iPhone 12 Pro landscape (844×390)                        | landscape 幅 844 が 769-900px の範囲のため既存 **タブレット (vertical-stack) モデル** (`.page-nav` 非表示・`.comments` 縦積み、 §3.1 既存 `@media (max-width: 900px)` 適用)                                                           |
| `dist/standalone.html`                     | iPhone 12 mini landscape (812×375)                       | landscape 幅 812 が 769-900px の範囲のため既存 **タブレット (vertical-stack) モデル** (同上、 768 直上の中間値検証)                                                                                                                   |
| `dist/standalone.html`                     | Custom viewport (760×400)                                | 768 直下の狭幅 landscape で drawer モデルが発動し、 左右 inset の `calc()` 加算式が DOM 上反映される (DevTools の safe-area emulation は限定的なため「`--mobile-safe-left/right` の式が CSS にロードされている」レベルの確認に留める) |
| `dist/standalone.html`                     | iPad mini portrait (768×1024)                            | drawer モデルに切り替わる                                                                                                                                                                                                             |
| `dist/standalone.html`                     | iPad mini landscape (1024×768)                           | desktop モデルに戻る（drawer モデルにならない）                                                                                                                                                                                       |
| `dist/standalone.html`                     | desktop (1920×1080)                                      | footer / backdrop が hide され、 左右 sidebar / toolbar 全ボタンが従来通り見える                                                                                                                                                      |
| `dist/standalone.html`                     | tablet (800×600)                                         | 既存 900px ブロックの vertical-stack 挙動が維持される（drawer モデルにならない）                                                                                                                                                      |
| `dist/embed-template.html`                 | iPhone SE                                                | review-request CLI 経路の HTML でも footer / backdrop DOM が inline されている                                                                                                                                                        |
| `dist/hosting/index.html` (online edition) | iPhone SE                                                | online-html.ts の rewrite 経路でも footer / backdrop が破壊されていない                                                                                                                                                               |
| `dist/standalone.html`                     | DevTools の "Emulate CSS prefers-reduced-motion: reduce" | drawer の transition が即時切替になる                                                                                                                                                                                                 |

加えて以下の挙動を切替確認：

- [ ] **本文 `.doc-pane` が縦スクロールできる**（long markdown で確認、 §1 MUST / §5.h）
- [ ] TOC ボタン → 左 drawer slide-in、 backdrop で背面が暗くなる、 backdrop click で閉じる
- [ ] Comment ボタン → 右 drawer slide-in、 同様に backdrop / Esc / 同ボタン再押下で閉じる
- [ ] drawer open 中に **背面の本文 (`.doc-pane`) はタッチでも wheel (マウスホイール / iPadOS trackpad / BlueTooth マウス) でもスクロールしない、 ただし drawer 自身 (`.page-nav` / `.comments`) は内部縦スクロール可能**（§5.h 採用案 C の検証、 `touch-action: none` + `overflow-y: hidden` の二重防御）
- [ ] drawer open 中に背面 3 要素 (`.skip-link` / `.app-header` / `.doc-pane`) + 閉じた反対 drawer が `inert` で操作不能になっている（tab 順序が drawer + mobile-footer に循環、 footer 末尾から Tab で drawer 先頭に wrap、 §5.j / §5.j-4 / §5.j-5）
- [ ] BlueTooth キーボード接続で TOC ボタン押下 → drawer open → **focus が drawer 内先頭要素に移る** → Tab を連打して drawer + mobile-footer を循環、 browser chrome (URL bar) に脱出しない (§5.j-5)
- [ ] drawer close → Tab 通常巡回に戻る (footer trigger button から Tab → 通常 DOM 順で進む、 trap が解除されている、 §5.j-5)
- [ ] TOC drawer 内の page link をタップ → drawer 自動 close → 背面 `.doc-pane` の対応見出しにスクロールしている (§5.r)
- [ ] Comments drawer 内の comment quote をタップ → drawer 自動 close → 背面の対応 block にスクロール、 Edit button をタップ → drawer 自動 close + comment 編集 modal が開く、 modal Cancel で footer Comment button に focus 復元 (§5.r / §5.s)
- [ ] mobile で drawer 内のリンクに focus がある状態で DevTools の viewport を 1920×1080 に切替 → focus が `.doc-pane` に移動 (`.page-nav` / `.comments` の inert 状態に focus が残らない、§5.j-3)
- [ ] desktop で `.mobile-footer` (hide されていても DOM 上は存在) や `.mobile-drawer-backdrop` 領域に focus を作為的に置いて viewport を 375×667 に切替 → focus が `.doc-pane` に退避 (§5.j-3)
- [ ] mobile で全 drawer 閉状態でも `.page-nav` / `.comments` 内のリンク / button が Tab 巡回に含まれず、 AT が「Show TOC」「Add review comment」を読み上げない (§5.j-4 / `applyMobileInertState()` の検証)
- [ ] desktop preset (1920×1080) で `.page-nav` / `.comments` が **inert 属性を持たず通常操作できる** (mobile 起動から resize で desktop に入った場合も、 直接 desktop 起動した場合も、 `applyMobileInertState()` の desktop ブランチが残留 inert を除去 / 付与しない、 §5.j-3 / §5.j-4)
- [ ] **切替時 (TOC → Comment) で Comment ボタンに focus が戻る** (旧 TOC ボタンではない、 §5.j-2)
- [ ] **mobile→desktop resize 時の state cleanup**：iPhone preset で drawer 開状態 → DevTools で viewport を 1920×1080 に切り替え → drawer が自動 close、 `.app-header` / `.doc-pane` / `.comments` の `inert` / `aria-hidden` が除去され、 通常 desktop 操作に戻れる（§5.j-3 / §1 MUST）
- [ ] **drawer 開中に Search ボタン → drawer が閉じて search-bar が開く**（§5.m）
- [ ] **search-bar 開中に TOC / Comment ボタン → search-bar が閉じて drawer が開く**（§5.m 逆方向）
- [ ] Search ボタン → search-bar が footer / drawer に被らず表示される、 `f` キー / Esc / `#btn-search` 経由の状態変化で footer の aria-pressed が sync する
- [ ] dark / light モード切替で footer / drawer 配色が破綻しない（`var(--paper-edge)` / `var(--rule)` の CSS variable 利用）
- [ ] `--comments-width 0` / `--page-nav-width 0` を CLI 経路で指定した review HTML を mobile で開き、 drawer が正しく開閉する（`comments-closed` / `page-nav-closed` 状態の打ち消しが効いている）
- [ ] iPhone 14 Pro preset で footer / drawer / `.layout` padding-bottom の bottom inset がすべて `--mobile-footer-height` で同期 (本文末尾 / drawer 末尾が footer 裏に隠れない)
- [ ] iPhone 14 Pro preset で header 外寸が `--mobile-header-height` と一致し、 drawer top が header 下端と隙間なく接する
- [ ] **portrait の drawer 内側 padding が既存値 (左 drawer 16px / 右 drawer 24px) を維持**（landscape では notch 側のみ inset 加算でインデント）
- [ ] **footer 3 ボタンのタップ target が 44×44 CSS pixel 以上** (DevTools の "Computed" タブで `width` / `height` を確認、 §5.o)
- [ ] **footer ボタンの hover 状態** が footer 背景 (`var(--paper-edge)`) と区別できる accent 系背景で visual に確認できる (BlueTooth マウス / iPad ペアリング時の hover シナリオ)
- [ ] **footer ボタンの focus-visible 状態** が mobile 専用 outline (`outline: 2px solid var(--accent); outline-offset: 2px`) で visible (Tab キーで focus → outline 表示、 既存 review.css に `.btn:focus-visible` 規則が無いため自前明示が必須、 §5.o)
- [ ] **mobile (iPhone SE 375×667 preset) で search-bar を開いた時、 内部要素 (input / count / 3 ボタン) が viewport 幅に収まり横スクロールが発生しない**（375px 内訳：fixed 210 + input 165、 §5.p）
- [ ] **search-bar の 3 操作ボタン (`↑` / `↓` / `×`) と input の tap target が 44×44 CSS pixel 以上**（DevTools の "Computed" タブで `width` / `height` を確認、 §5.o footer 3 ボタンと同水準、 §5.p）
- [ ] **iOS Safari 実機 (or BrowserStack) で search-input にフォーカスした時、 viewport が自動拡大しない**（`.search-input { font-size: 16px }` の auto-zoom 抑止の検証、 §5.p）。 DevTools mobile emulation では再現できないため実機 / BrowserStack 必須
- [ ] **footer ボタンの toggle 表現** が accent 色で表現される：TOC/Comment は drawer 開時に `aria-expanded="true"` で accent、 Search は search-bar 開時に `aria-pressed="true"` (`#btn-search` 経由) で accent (§5.o / §5.q)
- [ ] **TOC/Comment ボタンの `aria-controls`** が drawer DOM の id (`page-nav-list` / `cmt-list`) と対応している (AT が「TOC ボタンが page-nav-list を制御」と読み上げる、 §5.q)
- [ ] **footer ボタンの素の状態** が `<button>` ブラウザ既定スタイルではなく、 transparent background + 既存 `.btn-ghost` の border-radius / cursor 規約に従う

加えて gzip サイズ実測：

- [ ] `gzip -c dist/standalone.html` の出力を `wc -c` でカウントして、 本タスク前から **+ 5 KB 以内**
- [ ] `dist/embed-template.html` も同様にカウントして同等の増分

## 7. 受け入れ基準

- §1 の対応スコープ表の MUST / SHOULD 行がすべて ✓
- 既存挙動の視覚回帰なし — Chrome DevTools の `1920×1080` / `1024×768` / `800×600` preset で本タスク前後の `dist/standalone.html` を開いて差分が無い（toolbar / sidebar / `.search-bar` / floater / toast / modal の全配置が pixel 同等）
- standalone.html / online edition の gzip サイズ増分が **+ 5 KB 以内**（`gzip -c dist/standalone.html` の出力を `wc -c` でカウントして実測）
- 既存 in-source test 全通過 + 新規 `mobile-footer.ts` テストが pass + `global-keyboard.ts` の OR 経路 test が pass + i18n の symmetric_difference test が pass + 「JS が backdrop の `hidden` 属性 / `style.display` に触らない」assertion が pass + drawer ↔ search-bar 相互排他 test が pass + 切替時 lastTrigger test が pass + matchMedia change で desktop 移行時の強制 close test が pass
- DESIGN.md §12 から「スマートフォン向け UI の最適化」項目が削除され、§4 / §10 にモバイルレイアウト節が追加される（§4 は Step 6 / §10 は Step 2 で都度追加済み）
- README_ja.md / README.md に「モバイル操作」節が追加される
- iOS Safari（実機 or BrowserStack）で safe-area inset が反映され、 ホームインジケータと footer が重ならず、 本文末尾 / drawer 末尾も footer 裏に隠れない（`--mobile-footer-height` 共通化 + `box-sizing: border-box` の効果検証、 §5.k）
- mobile で本文 `.doc-pane` がタッチで縦スクロール可能（§1 MUST、 §5.h C 案の検証）
- mobile→desktop resize で drawer / inert / open class が自動除去される（§1 MUST、 §5.j-3 の検証）
- drawer 内側 padding が portrait で既存値（左 16px / 右 24px）を維持し、 landscape では notch 側のみ inset 加算（§5.k 採用案 D の検証）
- `prefers-reduced-motion: reduce` 環境で drawer の transition が 0s になる（DevTools の Emulate で確認）
- drawer 内部の縦スクロールが mobile でタッチ操作可能（`.page-nav` の長い TOC / `.comments` の cmt-list を実機で確認）

## 8. 想定リスクと回避策

| リスク                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 回避策                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iOS Safari の `100dvh` 非対応バージョンで viewport 高さがずれる                                                                                                                                                                                                                                                                                                                                                                                                                                   | `height: 100vh; height: 100dvh` の二段宣言で fallback。 `100vh` の URL bar 隠れ問題は受容（footer 自体は `position: fixed` で底辺固定）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| iOS safe-area inset (`env()`) が反映されない                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `<meta name="viewport" ...viewport-fit=cover>` を必ず指定（Step 2）。 review.html の viewport meta 既存値に追加する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| safe-area inset を footer 単独で見ているため本文 / drawer 末尾が footer 裏に隠れる                                                                                                                                                                                                                                                                                                                                                                                                                | `--mobile-header-height` / `--mobile-footer-height` を共通変数化（§3.4 / §5.k）。 footer / drawer / backdrop / layout / header の各オフセットが同じ式を参照する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| footer の safe-area 二重加算 (height + padding-bottom + border で実寸 = `56 + 2×inset + 1`)                                                                                                                                                                                                                                                                                                                                                                                                       | `.mobile-footer { box-sizing: border-box; height: var(--mobile-footer-height); padding-bottom: env(safe-area-inset-bottom) }`。 border-box で外寸 = `--mobile-footer-height` に固定（§5.k 採用案 D）                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| header 実寸と `--mobile-header-height` 不一致 (既存 padding が部分上書きされ高さがずれる) / 既存左右 24px / 上下 16px が portrait で消える                                                                                                                                                                                                                                                                                                                                                        | `.app-header { box-sizing: border-box; height: var(--mobile-header-height); padding: calc(16px + env(safe-area-inset-top)) calc(24px + var(--mobile-safe-right)) 16px calc(24px + var(--mobile-safe-left)) }` で既存 `padding: 16px 24px` (review.css l.776) を加算式で維持しつつ外寸を変数値と一致させる（§5.k）                                                                                                                                                                                                                                                                                                                                                     |
| header 素朴値 56px だと `.btn` (32px) + 上下 padding (16+16) + border 1px = 65px が outer から overflow                                                                                                                                                                                                                                                                                                                                                                                           | `--mobile-header-height` の素朴値を **65px** に上げる (`calc(65px + env(safe-area-inset-top))`)。 内側コンテンツ領域 = `65 - 16 - 16 - 1 = 32px` で `.btn` がジャストフィット。 drawer の `top` / backdrop の `top` も変数経由で 9px 自動下降（§5.k 採用案 D 論点）                                                                                                                                                                                                                                                                                                                                                                                                   |
| `<footer>` の `aria-label` が英語ハードコード                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `aria-label="Mobile actions" data-i18n-aria-label="mobile.footer_label"` に変更し i18n キー `mobile.footer_label` を追加。 `role="group"` のラベルとして機能（§3.2 / §4 Step 1 / §5.g / §5.n）                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `role="toolbar"` の WAI-ARIA pattern (Tab で 1 tabstop / 矢印で内部移動 / roving tabindex) が未実装で AT ユーザーを混乱させる                                                                                                                                                                                                                                                                                                                                                                     | **`role="toolbar"` を採用しない**。 代わりに `role="group"` で「関連 UI コマンドのまとまり」として semantic 表明。 composite widget ではないので roving tabindex / 矢印キーパターン不要、 3 ボタンを個別 Tab 巡回する標準挙動を維持（§5.n / §3.2）                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `<footer>` が `<main>` の sibling + `<body>` 直下配置で implicit landmark `contentinfo` を獲得 → `contentinfo` は文書情報 landmark で操作コマンド群には意味的に不適切 (加えて 1 ページに 1 つだけ推奨の landmark を消費)                                                                                                                                                                                                                                                                          | `<footer role="group">` で implicit `contentinfo` を **上書き**。 `role="group"` で grouping を明示し、 AT が「モバイル操作のまとまり」として正しく解釈する。 `<footer>` element の HTML semantic は維持（§3.2 / §5.n 採用案 C）                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| footer 3 ボタンが class / CSS 未指定でブラウザ既定の小さい button になり、 タップ target が WCAG 2.5.5 / 2.5.8 / Apple HIG / Material Design 推奨値 (44×44 CSS pixel) を満たさない                                                                                                                                                                                                                                                                                                                | footer 3 ボタンに `class="btn btn-ghost"` を付与 + 768px ブロックで `.mobile-footer .btn { box-sizing: border-box; min-height: 44px; min-width: 44px; padding: 12px; line-height: 1 }` を上書き（§5.o / §3.2）                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 既存 `.btn` は `box-sizing` 未指定 = `content-box` のため、 `min-height: 44px` + `padding: 12px` + `border: 1px` で outer = **70px** になり footer 内側 55px から 15px overflow                                                                                                                                                                                                                                                                                                                   | `.mobile-footer .btn` に **`box-sizing: border-box`** を明示し outer を 44px に固定 (内側 content area = 44 - 24 - 2 = 18px、 icon 16px が center align で収まる)。 `line-height: 1` も併用して既存 `.btn` の line-height: 20px が content size を押し上げるのを抑制（§5.o 採用案 B）                                                                                                                                                                                                                                                                                                                                                                                 |
| 既存 review.css に `.btn:focus-visible` 規則が無く、 UA stylesheet default focus ring に依存                                                                                                                                                                                                                                                                                                                                                                                                      | mobile では `.mobile-footer .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }` を明示。 共通 `.btn:focus-visible` 規則の追加は本タスクのスコープ外として将来 desktop 改修時の別タスクで扱う（§5.o）                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 既存 `.btn-ghost:hover { background: var(--paper-edge) }` が mobile footer 背景と同色になり hover state が visual に消える                                                                                                                                                                                                                                                                                                                                                                        | 768px ブロックで `.mobile-footer .btn-ghost:hover { background: color-mix(in srgb, var(--accent) 8%, transparent) }` に上書き（§5.o）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| footer ボタンの toggle 状態 (drawer / search-bar 開時) が visual に表現されない                                                                                                                                                                                                                                                                                                                                                                                                                   | `.mobile-footer .btn-ghost[aria-pressed="true"], .mobile-footer .btn-ghost[aria-expanded="true"]` の OR selector で既存 `.btn-active` (l.950-955) と同じ accent 色 (color + background + border) を当てる。 TOC/Comment は `aria-expanded`、 Search は `aria-pressed` の使い分けに対応（§5.o / §5.q）                                                                                                                                                                                                                                                                                                                                                                 |
| drawer の開閉に `aria-pressed` を誤用 → WAI-ARIA semantic 違反 (`aria-pressed` は toggle button、 collapsible panel は `aria-expanded` が正しい) で AT ユーザーに意図が伝わらない                                                                                                                                                                                                                                                                                                                 | TOC/Comment は **`aria-expanded` + `aria-controls`** で制御対象 (drawer DOM の id) を明示し既存 `.page-nav-toggle-tab` / `.comments-toggle-tab` (review.html l.664-688) と同じ規約に揃える。 Search は既存 `#btn-search` の `aria-pressed` 設計に合わせて維持（§5.q / §3.2）                                                                                                                                                                                                                                                                                                                                                                                          |
| 閉じた drawer (`.page-nav` / `.comments`) が `display: block` + `transform: translateX(±100%)` で DOM 上は visible / focusable のまま → 全閉状態でも Tab 順序に残り、 AT が「Show TOC」「Add review comment」を文脈外に読み上げる (WCAG 2.4.3 / 1.3.1 違反)                                                                                                                                                                                                                                       | **mobile 起動時に限り**、 `wireMobileFooter()` 初期化時に `applyMobileInertState()` 経由で両 drawer に `inert` + `aria-hidden="true"` を付与 (全閉状態が初期状態)。 `openMobileXxx()` / `closeMobileXxx()` / matchMedia change の各経路で同じ helper を呼び、 「開いた drawer 以外は常に inert」の invariant を mobile ブランチで二項分岐により維持。 desktop ブランチでは両 drawer から属性を除去するため desktop 起動 / 進入時に左右パネル操作が壊れない（§5.j-4）                                                                                                                                                                                                  |
| 既存 review.css `@media (prefers-reduced-motion: reduce)` (l.1813) は **768px ブロックの前** にあり、 768px の `transition: transform .2s ease` が cascade で `transition-duration: 0s` を後勝ち上書き → reduced-motion ユーザに transition が効いてしまう                                                                                                                                                                                                                                        | **768px ブロックの後**に `@media (max-width: 768px) and (prefers-reduced-motion: reduce) { .page-nav, .comments { transition-duration: 0s } }` の合成 media query を追加。 既存 reduced-motion ブロックは据え置きで desktop 規約と整合（§5.i / §4 Step 6）                                                                                                                                                                                                                                                                                                                                                                                                            |
| Search → drawer 即切替で setTimeout focus 競合 → `resetSearchInput()` (`openSearch` 経由) の `setTimeout(input.focus(), 0)` が drawer 開放後に発火し非表示 input に focus を奪う                                                                                                                                                                                                                                                                                                                  | `src/app/search/search-controller.ts` の `resetSearchInput()` で timer ID を module-level 変数に保存、 `closeSearch()` で `clearTimeout` で cancel + リセット（既存 `cancelPendingSearch()` の debounce timer cancel とは別系統）。 §4 Step 5b で対処。 mobile-footer.ts 側だけでは解決できない (timer は search-controller の closure 内、§5.m)                                                                                                                                                                                                                                                                                                                      |
| footer 3 ボタン (SVG only) に `aria-label` 属性がなく `data-i18n-aria-label` のみ → JS i18n 初期化前に accessible name が空                                                                                                                                                                                                                                                                                                                                                                       | 既存 `#btn-search` (review.html l.336) 等と同じ併記パターンを採用し、 各 footer ボタンに **英語 fallback の `aria-label`** を付与：`aria-label="Show table of contents"` / `aria-label="Search the document"` / `aria-label="Show review comments"`。 i18n 適用後は `data-i18n-aria-label` 経由で該当言語に上書きされる（§3.2）                                                                                                                                                                                                                                                                                                                                       |
| landscape の左右 safe-area inset 検証経路が存在しない (iPhone の drawer モデル機種は notch なし、 notch 機種は landscape 幅 768px 超え)                                                                                                                                                                                                                                                                                                                                                           | `calc(16px + var(--mobile-safe-left))` 等の加算式は portrait で 0 加算なので無害。 将来の Android Foldable / カスタムデバイスへの予防的設計と位置付ける。 検証は Chrome DevTools Custom viewport (760×400 等) で「式が DOM 上ロードされている」レベルに留める（§6 / §5.k 採用案 D）                                                                                                                                                                                                                                                                                                                                                                                   |
| mobile で `.doc-pane` がスクロールコンテナにならず本文が縦スクロール不能                                                                                                                                                                                                                                                                                                                                                                                                                          | 768px ブロックで `body > main.layout > section.doc-pane { overflow-y: auto; min-height: 0 }` を明示再宣言（既存 900px の `body > main.layout > section { overflow-y: visible }` (0,0,1,3) を打ち消し、 flex item の shrink を許す、 §1 MUST / §5.h）                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **900px の打ち消しを flat なクラスセレクタで書くと specificity 負けして縦スクロールが成立しない**：900px ブロックは `body > main.layout { flex: none }` (0,0,1,2) / `body > main.layout > section { overflow-y: visible }` (0,0,1,3) と **子結合子つき高 specificity** で書かれており、 flat な `.doc-pane` / `.layout` (0,0,1,0) では後置きしても勝てない (cascade は specificity 差を順序より優先)                                                                                              | 768px の打ち消しを **同等以上の specificity** で書く：`body > main.layout { flex: 1; min-height: 0 }` で main を 100dvh 内に収め、 `body > main.layout > section.doc-pane { overflow-y: auto }` (0,0,1,4) / `body > main.layout > aside.page-nav, body > main.layout > aside.comments { overflow-y: auto }` (0,0,1,3) で本文・drawer のスクロールを成立させる。 `flex: none` の打ち消し漏れは main がコンテンツ高に膨らみ `body { overflow: hidden }` でクリップされ本文末尾に到達不能になる。 in-source test (happy-dom) では layout 計算をしないため検出不能で、 §6 手動視覚チェック「本文が縦スクロールできる」が唯一の検出ゲートになる（§3.1 / §5.h / §6 Step 6） |
| **mobile→desktop resize で drawer / inert / open class が DOM に残り desktop UI が操作不能になる**                                                                                                                                                                                                                                                                                                                                                                                                | `wireMobileFooter()` で `window.matchMedia('(max-width: 768px)').addEventListener('change', ...)` を登録し、 desktop 移行時 (`matches: false`) に `closeMobileDrawers({ restoreFocus: false })` + `applyMobileInertState()` の desktop ブランチで両 drawer / 背面 3 要素から inert / aria-hidden を除去（§5.j-3 / §1 MUST）                                                                                                                                                                                                                                                                                                                                           |
| **drawer の inert を無条件に初期化時付与すると desktop 起動で左右パネルが操作不能、 `closeMobileDrawers()` で drawer に inert を再付与すると desktop 進入時の「すべて除去」が成立しない**                                                                                                                                                                                                                                                                                                         | inert の付与 / 除去判断を `applyMobileInertState()` 単一責任 helper に一元化し、 `matchMedia.matches` で **mobile 限定処理として明示分岐**：mobile ブランチでは各 drawer の open 状態を見て **開いた drawer から `removeAttribute('inert')` で除去 / 閉じた drawer に `setAttribute('inert', '')` で付与の二項分岐** (if-else)、 desktop ブランチでは両 drawer から無条件除去。 `closeMobileXxx` / `wireMobileFooter` 初期化 / matchMedia change の各経路で同じ helper を呼ぶ（§5.j-4）                                                                                                                                                                               |
| **`applyMobileInertState()` の mobile ブランチで `else` 分岐が抜けると、 初期化時付与の inert が open 後も残留して drawer が操作不能になる**                                                                                                                                                                                                                                                                                                                                                      | mobile ブランチは「閉じてれば付与」ではなく **「開いていれば除去、 閉じていれば付与」の if-else 二項分岐** で実装する。 `else` がない実装は open class が付いても drawer が inert のままになる致命バグを生む（§5.j-4 採用方針の TypeScript 実装例参照）                                                                                                                                                                                                                                                                                                                                                                                                               |
| **drawer open 後も focus が footer trigger button に残り、 通常 Tab では drawer 内 (DOM 順で footer より前) に到達できず browser chrome に脱出する** → §1 SHOULD「Tab 焦点が drawer + mobile-footer に閉じる」が機能しない                                                                                                                                                                                                                                                                        | (a) `openMobileXxx()` 末尾で drawer 内先頭 focusable element に明示的に `.focus()` を呼ぶ、 (b) Tab key 循環 trap (`handleTabInMobileOverlay`) を `document` に capture phase で登録し drawer 末尾 ↔ footer 先頭 / footer 末尾 ↔ drawer 先頭 を wrap、 close 時に listener 解除（§5.j-5）                                                                                                                                                                                                                                                                                                                                                                             |
| **`has-pages` flag は `page-navigation-render.ts:209` で page が 1 件以上構築されたタイミングで付与されるため、 単一ページ文書 (= ページ分割が無い文書) でも flag が付く** → `:root:not(.has-pages) #btn-mobile-toc { display: none }` で「ページ分割が無い文書では TOC 隠す」要件が機能しない                                                                                                                                                                                                    | 要件を **「文書未読込時に TOC ボタンを無効化」** に修正 (`has-pages` の既存意味と整合)。 「単一ページ文書で TOC を hide」要件は本タスクのスコープ外、 将来必要なら `page-navigation-render.ts` に `data-page-count` 等の attribute 追加を別タスクで対応（§1 追加実装 / §4 Step 6）                                                                                                                                                                                                                                                                                                                                                                                    |
| **DOM selector ベースの navigation 自動 close では `.page-outline-link` / `.page-nav-sequential-link` / comment カード本体 click / Enter キー等の遷移経路が網羅できない**                                                                                                                                                                                                                                                                                                                         | TOC は `onCompositeSlugClick` (`navigation-orchestrator.ts:165`) 内 mobile 分岐で全 TOC 経路を網羅、 Comments は新規 `addOnCommentActivate(handler)` registry (Set) を `comments.ts` に追加し `focusCommentCard()` の **各分岐の return 前** で fire することで同一/別ページ / mark 不在問わず activation を拾う（§5.r / §4 Step 5c）                                                                                                                                                                                                                                                                                                                                 |
| **既存 `setOnCommentNavigate` (`comments.ts:20-22`) は単一変数代入で chain ではないため、 mobile-footer から再 register すると review.ts 注入の既存 `navigateToTarget` が失われる + 別ページ判定時のみ発火で同一ページ click / Enter を拾えない**                                                                                                                                                                                                                                                 | 既存 `setOnCommentNavigate` は触らず、 新規 `addOnCommentActivate(handler)` Set registry を `comments.ts` に追加。 `focusCommentCard()` の **各分岐の return 前** で `fireCommentActivate(comment)` を呼ぶことで同一/別ページ / mark 不在問わず全 activation 経路を拾える。 chain 対応 + unregister 関数返却で idempotent 性も担保（§5.r / §4 Step 5c）                                                                                                                                                                                                                                                                                                               |
| **mobile drawer 経路で既存 `focusTOC` 復元 (`navigation-orchestrator.ts:125`) が close 後 inert になった TOC link に focus を戻し競合する**                                                                                                                                                                                                                                                                                                                                                       | `onCompositeSlugClick` 内に `focusTOC` という local 変数は存在せず (l.165-167)、 `navigateToTarget(target, pushHash, focusTOC = false)` の **第 3 引数** として渡される (l.133-136)。 mobile 経路では `navigateToTarget(target, true, mobileDrawerOpen ? false : keyboardActivated)` で **第 3 引数を `false` 強制** することで `focusNavigatedLink` (l.146-151) をスキップ、 inert TOC link への focus 競合を構造的に回避。 desktop 既存挙動は `keyboardActivated` がそのまま第 3 引数に渡るため無変更（§5.r / §4 Step 5c）                                                                                                                                          |
| **私の旧設計で `focusTOC = false` を `onCompositeSlugClick` の local scope に代入する書き方は scope エラーでコンパイル不可**                                                                                                                                                                                                                                                                                                                                                                      | `focusTOC` は `navigateToTarget` の引数名であり `onCompositeSlugClick` には存在しない。 `navigateToTarget(..., mobileDrawerOpen ? false : keyboardActivated)` のように **引数渡しで制御** する形式に修正（§5.r / §4 Step 5c）                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **`saveEditedComment` (`comment-modal.ts:142-149`) は `renderComments()` で cmt-list を再描画してから `closeCommentModal()` を呼ぶため、 `lastTrigger` (= 旧 Edit ボタン) が DOM detach され `focus()` が silently fail する**                                                                                                                                                                                                                                                                    | `closeCommentModal` で `lastTrigger.isConnected` を確認し、 detach なら **`restoreFocusAfterClose` のフォールバック** で 3 段階の focus 復元：(a) 同一 comment id の新 Edit ボタン (`.cmt-card[data-id="X"] .cmt-edit`) を `data-id` から再取得、 (b) 新ボタンも無ければ mobile では `#btn-mobile-comments`、 desktop では `.doc-pane` に退避。 in-source test は `focus()` spy ではなく `document.activeElement` で実値検証する（§4 Step 5c / §5.s）                                                                                                                                                                                                                 |
| **`.cmt-del` 即時削除後の focus 消失問題**：候補表で B 案 (`.cmt-del` drawer 残し) を「focus 消失で ✗」、 採用案を C にしていたが、 採用案 C の実装も実は drawer 残し + focus 消失を別タスク扱いにしていた矛盾                                                                                                                                                                                                                                                                                    | 採用案を **B 相当** (`.cmt-edit` のみ drawer 自動 close、 `.cmt-del` は drawer 残し) に正規化し、 削除後 focus 消失の対処を §1 スコープ外に明示。 「将来別タスクで `restoreFocusAfterClose` 相当の helper を `deleteComment` 後に呼ぶ」道筋を §1 / §5.s 採用案 B 論点に残すことで、 desktop / mobile 双方を将来統一改善する余地を維持（§5.s / §1 スコープ外）                                                                                                                                                                                                                                                                                                         |
| **Comments drawer 内 `.cmt-edit` click で Edit modal を開くと、 drawer Tab trap と modal Tab trap が衝突し focus 巡回が予測不能に。 modal close で focus 復元処理が無く invariant 崩壊**                                                                                                                                                                                                                                                                                                          | `wireDrawerEditModalAutoClose()` で `.comments` に **capture phase** delegation handler を登録、 `.cmt-edit` (`data-edit` 属性) click を先取りして `closeMobileComments({ restoreFocus: true })` で footer Comment button に focus を戻す → bubble phase で既存 modal handler が走り Edit modal が open。 加えて `comment-modal.ts` の **共通 helper `showModalWithBody`** に `lastTrigger` 保存 + close 時 focus 復元の契約を追加 (§4 Step 5c) して modal close で footer に focus 復元される（§5.s / §4 Step 3 / Step 5c）                                                                                                                                          |
| **私の旧設計が `.cmt-edit-btn` / `.cmt-delete-btn` を selector としていたが、 実際は `.cmt-edit` / `.cmt-del` (`comment-rendering.ts:45-46`)**                                                                                                                                                                                                                                                                                                                                                    | selector を `.cmt-edit` (`data-edit` 属性) に修正。 `.cmt-del` は即時削除 (`comments.ts:131` `deleteComment(comment)` → `comments.ts:132` `onDeleted()` で cmt-list 再 render) で modal を開かないため drawer 自動 close 対象から外す。 削除後の cmt-list 再 render で focus 消失は既存 desktop と同じ別問題（§5.s）                                                                                                                                                                                                                                                                                                                                                  |
| **`comment-modal.ts` に `lastTrigger` 保存 + close 時 focus 復元処理が存在しない (`setTimeout(qsInput('#modal-input').focus(), 50)` のみ) → mobile drawer 経路で「既存 modal が footer button を保存・復元する」前提が成立しない**                                                                                                                                                                                                                                                                | `comment-modal.ts` の **共通 helper `showModalWithBody` (`l.40-48`、 `openEditCommentModal` / private `openModal` 両経路が経由)** 冒頭で `lastTrigger = document.activeElement` を保存、 `closeCommentModal` で `clearTimeout` + **`restoreFocusAfterClose(lastTrigger)` の 3 段階フォールバック** ((a) `isConnected` 確認 → (b) 同一 comment id の新 Edit ボタン → (c) matchMedia 判定で mobile footer Comment button or `.doc-pane`) で復元 + `lastTrigger = null` リセット。 search-controller.ts (§4 Step 5b) と同 pattern + `saveEditedComment` の renderComments 後 detach 対応。 desktop 既存挙動も改善され副作用なし（§4 Step 5c / §5.s）                     |
| **別ページ comment 遷移時に `navigateToComment` (`navigation-orchestrator.ts:175-185`) が末尾で `newCard.focus()` (l.183) を呼ぶため、 `fireCommentActivate` を `focusCommentCard` 冒頭で発火すると mobile handler の `.doc-pane.focus()` が `newCard.focus()` で上書きされて mobile drawer 経路の SHOULD が崩れる**                                                                                                                                                                              | `fireCommentActivate` を `focusCommentCard` の **各分岐の return 前** (別ページ `navigateToComment` 完了後 / 同一ページ mark 不在 early return 前 / 同一ページ scroll 完了後) で呼ぶ。 これで mobile handler が最後に走り、 `newCard.focus()` を上書きして最終 `document.activeElement === .doc-pane` に。 in-source test は別ページシナリオで実 `document.activeElement` を検証（§5.r / §4 Step 5c）                                                                                                                                                                                                                                                                 |
| **同一ページの comment で `mark` 要素が見つからない (アンカリング失敗による孤立 comment、`comments.ts:53` の `if (!mark) return`) と、 既存の早期 return で `fireCommentActivate` が呼ばれず、 mobile drawer が閉じない**                                                                                                                                                                                                                                                                         | `focusCommentCard` の mark 不在 early return の **直前** にも `fireCommentActivate(comment)` を入れる。 これで mark が無くても drawer 自動 close + `.doc-pane.focus()` の通知が走り、 UX が一貫する。 mark 不在シナリオの in-source test を追加して退化を防ぐ（§5.r / §4 Step 5c）                                                                                                                                                                                                                                                                                                                                                                                    |
| **既存 `global-keyboard.ts:56` の Escape 処理は modal の開閉状態に関係なく `closeCommentModal()` を呼ぶため、 drawer / 検索 / menu を Escape で閉じただけでも `restoreFocusAfterClose(null)` まで進んで `.doc-pane` / `#btn-mobile-comments` に focus が奪われる**                                                                                                                                                                                                                                | `closeCommentModal` 冒頭で `modalState.current.kind === 'closed'` チェック → no-op で早期 return する guard を追加。 drawer / search / menu の Escape 経路では modal は元々 closed のため `restoreFocusAfterClose` まで到達しない。 in-source test で「drawer open + Escape」「search open + Escape」シナリオでの focus 不変を regression として検証（§4 Step 5c / §5.s）                                                                                                                                                                                                                                                                                             |
| **`#floater` は modal open 直後に `display: none` になる (DOM 接続は維持) ため、 `isConnected` だけでは focusable 判定にならず、 hidden な floater に focus を戻す試みが入る (focus は不可視要素には当たらず暗黙の fallback もないので意図不明な挙動になる)**                                                                                                                                                                                                                                     | `isFocusable(el)` ヘルパ ((a) `isConnected`、 (b) 要素自身が `FOCUSABLE_SELECTOR` (`static-modal.ts:133-140` と統一: `a[href]` / `button:not([disabled])` / `input:not([disabled])` / `select:not([disabled])` / `textarea:not([disabled])` / `[tabindex]:not([tabindex="-1"])`) に match、 (c) 祖先 chain を辿って `display: none` / `visibility: hidden / collapse` / `inert` 属性を確認) を `restoreFocusAfterClose` の trigger / 新 Edit ボタン両判定で使用。 `#floater` のように hide された要素には focus を戻さず、 fallback chain で mobile footer Comment button or `.doc-pane` に退避（§4 Step 5c / §5.s）                                                  |
| **`#floater` の `mousedown` handler は `event.preventDefault()` で focus 移動を抑止する (`comment-modal.ts:179`) ため、 新規追加 modal open 直前の `document.activeElement` は floater ではなく `<body>` 等の元の active element になる。 `<body>` は祖先 chain では visible だが HTML spec で focusable element ではないため、 可視性 / disabled / inert のみの判定では `isFocusable(body) === true` と誤判定して `body.focus()` が呼ばれる (no-op になるが期待する fallback chain に進まない)** | `isFocusable` の冒頭で **要素自身が `FOCUSABLE_SELECTOR` に match するか** を確認 (`static-modal.ts:133-140` の規約と統一)。 `<body>` / `<div>` (tabindex なし) / `<div tabindex="-1">` は match しないため false → fallback chain で同一 comment id の新 Edit ボタン → mobile footer Comment button / `.doc-pane` に退避。 in-source test で `<body>` lastTrigger シナリオを regression test として `document.activeElement === .doc-pane` / `#btn-mobile-comments` を実値検証（§4 Step 5c / §5.s）                                                                                                                                                                  |
| **happy-dom はレイアウト計算を行わず `getBoundingClientRect()` / `offsetParent` が常に 0 / null を返すため、 size 依存の focusable 判定はテスト環境で **通常状態のボタンも非 focusable** と誤判定し、 `restoreFocusAfterClose` のフォールバックで desktop Edit Cancel すら `.doc-pane` 退避される**                                                                                                                                                                                               | `isFocusable` の判定から `getBoundingClientRect` を除外し、 既存 `static-modal.ts:132` の規約 (offsetParent 未実装) と同じく **祖先 chain の `display` / `visibility` / `inert` と要素の `disabled` 属性** のみで判定する。 size 判定なしでも `#floater`の `display: none` は捕捉されるため必要十分（§4 Step 5c / §5.s）                                                                                                                                                                                                                                                                                                                                              |
| **Tab trap (`handleTabInMobileOverlay`) は `current === first \|\| current === last` の比較のみで wrap するため、 `.cmt-del` 即時削除後に `activeElement === <body>` になった状態で Tab を押すと trap が反応せず drawer + footer 外に Tab 順序が抜ける** → §1 SHOULD「drawer + mobile-footer 内に循環」が崩れる                                                                                                                                                                                   | `handleTabInMobileOverlay` 冒頭で `focusables.includes(current)` を確認し、 集合外なら `event.preventDefault()` + 先頭 focusable に救出する分岐を追加。 削除直後・modal close 後の `.doc-pane` 退避後など、 Tab trap の比較条件に該当しないシナリオでも drawer + footer 内に focus が戻る（§5.j-5 / §1 SHOULD）                                                                                                                                                                                                                                                                                                                                                       |
| **breakpoint 切替時に focus が hidden / inert になる要素に残り keyboard 操作不能になる**：旧 `escapeFocusBeforeBreakpointSwitch` は drawer / mobile-footer / backdrop しか判定対象にしておらず、 mobile 進入時の hidden header buttons (`#btn-search` / `#btn-help` / `#status` / `#online-source`) / toggle tabs (`.page-nav-toggle-tab` / `.comments-toggle-tab`) や、 desktop 進入時の `*-closed` 状態の drawer (grid 列幅 0) を見落として focus が hidden 要素に残る                          | matchMedia change の両ブランチで `escapeFocusBeforeBreakpointSwitch(toMobile)` を `closeMobileDrawers` の前に呼ぶ。 判定は **`willBeHiddenAfterSwitch` ヘルパに集約**：mobile 進入時は `.page-nav` / `.comments` / `#btn-search` / `#btn-help` / `#status` / `#online-source` / `.page-nav-toggle-tab` / `.comments-toggle-tab`、 desktop 進入時は `.mobile-footer` / `.mobile-drawer-backdrop` + `:root.comments-closed .comments` / `:root.page-nav-closed .page-nav` を判定対象に。 該当時は `.doc-pane.focus({preventScroll: true})` で退避（§5.j-3 / §1 MUST）                                                                                                   |
| **`.skip-link` が inert 対象外で footer 末尾から Tab で drawer 外へ脱出**                                                                                                                                                                                                                                                                                                                                                                                                                         | `inert` 対象を `.skip-link` (`#skip-to-nav`) を含む 3 要素 (`.skip-link` / `.app-header` / `.doc-pane`) に拡張（§5.j A 案、§1 SHOULD）。 close 時に確実に除去                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| drawer 開中に search-bar が同時 open し背面操作が制御不能になる                                                                                                                                                                                                                                                                                                                                                                                                                                   | drawer open 関数の冒頭で search-bar が open なら `#btn-search.click()` で閉じる、 footer Search の click 委譲時に drawer を先に閉じる（§5.m）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| drawer 切替時に旧 trigger の close で focus が戻り、 新 trigger の保存先がずれる                                                                                                                                                                                                                                                                                                                                                                                                                  | `openMobileXxx(trigger)` の冒頭で `lastTrigger = trigger` を最初に保存。 切替時の close は `closeMobileXxx({ restoreFocus: false })` で focus を移動させない（§5.j-2）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **drawer の `padding-left` / `padding-right` 単独宣言で既存 padding (左 16px / 右 24px) が消える**                                                                                                                                                                                                                                                                                                                                                                                                | `calc(16px + var(--mobile-safe-left))` / `calc(24px + var(--mobile-safe-right))` の加算式で既存値を維持しつつ landscape inset を加算（§5.k 採用案 D）。 実装時は review.css l.151 / l.592 の現行値を再確認                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| landscape の左右 safe-area inset が drawer 内側 content に反映されず notch にかかる                                                                                                                                                                                                                                                                                                                                                                                                               | 上記の加算式で `--mobile-safe-left/right` を加算（portrait では 0 で既存値そのまま、 landscape で notch 側のみインデント）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `body { touch-action: none }` を当てると drawer 自身の縦スクロールもタッチで潰れる                                                                                                                                                                                                                                                                                                                                                                                                                | `body` には `overflow: hidden` + `overscroll-behavior: contain` のみ。 `.doc-pane` だけに `touch-action: none` を当てる（§5.h 採用案 C、 effective touch-action の AND 計算で drawer は影響を受けない）                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `touch-action: none` だけでは wheel event (マウスホイール / iPadOS trackpad / BlueTooth マウス) を抑止できず、 drawer open 中も背面 `.doc-pane` が wheel scroll する (W3C Pointer Events Level 3 の `touch-action` は touch input のみ制御、 wheel は対象外)                                                                                                                                                                                                                                      | `.doc-pane` に `touch-action: none` と **`overflow-y: hidden` を二重指定** (defence in depth)。 `overflow-y: hidden` で scroll container を物理的に scroll 不能にする。 `inert` 属性の user input events ignore は wheel への適用が browser implementation 依存で保証されないため、 `overflow-y: hidden` で確実に止める。 drawer close 時に `overflow-y: auto` に戻せば scroll 位置はそのまま復元 (Chrome / Safari の scrollTop 保持挙動)（§5.h 採用案 C）                                                                                                                                                                                                            |
| backdrop の `[hidden]` 属性が author CSS の `display: block` で無効化され常時表示になる                                                                                                                                                                                                                                                                                                                                                                                                           | HTML markup から `hidden` 属性は削除。 表示制御は author CSS のグローバル `display: none` + 768px の `:root.mobile-X-open ... { display: block }` で完全集約（§3.2 / §5.l）。 JS は backdrop の `hidden` / `style.display` に触らない                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `inert` を `<main>` 全体に当てると drawer 自身も操作不能になる                                                                                                                                                                                                                                                                                                                                                                                                                                    | `inert` は背面 3 要素 (**`.skip-link` / `.app-header` / `.doc-pane`**) に open/close 手順で動的付与 + drawer 自身は §5.j-4 の `applyMobileInertState()` で別管理 (mobile 限定)。 drawer 自身と mobile-footer は操作可能に残す（§5.j A 案）                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 既存 900px ブロックの `.page-nav { display: none }` / `.comments { border-top: ... }` を打ち消し忘れ                                                                                                                                                                                                                                                                                                                                                                                              | 768px ブロック内で `.page-nav, .comments { display: block; border-top: none }` を明示的に再宣言（§3.1 / §5.c）。 cascade 後勝ちのため 768px ブロックは必ず 900px ブロックの **直後** に置く                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 既存 `comments-closed` / `page-nav-closed` 状態でリサイズ → mobile に入ると drawer が表示されない                                                                                                                                                                                                                                                                                                                                                                                                 | 768px ブロック内で `:root.comments-closed .comments, :root.page-nav-closed .page-nav { display: block }` を再宣言して打ち消す                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 既存 `f` キー / `h` キー（Help） が drawer 背面で発火                                                                                                                                                                                                                                                                                                                                                                                                                                             | `global-keyboard.ts` の affordance 抑制条件に `isMobileDrawerOpen()` を OR で追加（Step 5）。 mobile drawer は modal-backdrop class を持たないので `isAnyModalOpen` に拾われない、 並列 OR で並べる（§5.j）                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| footer Search ボタンの aria-pressed が `f` キー / Esc 経路で sync しない                                                                                                                                                                                                                                                                                                                                                                                                                          | MutationObserver で `.search-bar.open` を監視して sync する（§3.3 / §5.d）。 click 毎 toggle 近似は採用しない（sync 漏れリスク）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| footer / drawer の z-index が既存 modal / toast / search-bar と衝突                                                                                                                                                                                                                                                                                                                                                                                                                               | layer 整理：search-bar (80、 新規宣言、 既存は未指定 = 0) > footer (70) > drawer (60) > backdrop (55) > 既存 modal-backdrop (100、既存値)。 modal 開中は drawer も背後                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| mobile での `.tooltipped::after` がタップで残留表示される                                                                                                                                                                                                                                                                                                                                                                                                                                         | 768px ブロック内で `.tooltipped::after, .tooltipped::before { display: none }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 既存 900px ブロックと specificity が等しいため cascade 順序に依存                                                                                                                                                                                                                                                                                                                                                                                                                                 | 768px ブロックを 900px ブロックの **直後** に置き、 後勝ち cascade で上書き。 `!important` は使わない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `dist/embed-template.html` / online edition の rewrite で footer / backdrop が破壊される                                                                                                                                                                                                                                                                                                                                                                                                          | `src/build/online-html.ts` の rewrite 対象は CSP / embedded-\* 属性のみで footer / backdrop ノードに触れない設計だが、 Step 6 で 3 配布物すべて mobile preset で確認（§6 配布物 × preset の表）                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `prefers-reduced-motion: reduce` 環境で transition が無視されアクセシビリティ違反                                                                                                                                                                                                                                                                                                                                                                                                                 | **768px ブロックの後**に `@media (max-width: 768px) and (prefers-reduced-motion: reduce) { .page-nav, .comments { transition-duration: 0s } }` の合成 media query を追加。 既存 reduced-motion ブロック (review.css l.1813) は 768px ブロックの前にあり後勝ち cascade で上書きされるため、 mobile 用は別 media query で確実に override する（§5.i / §4 Step 6）                                                                                                                                                                                                                                                                                                       |
| Step 2-5 の中間状態で desktop に視覚崩れが出る                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Step 2 で `.mobile-footer, .mobile-drawer-backdrop { display: none }` の hide skeleton CSS を先に追加。 Step 6 の 768px ブロックで `display: flex` / drawer 開時の `display: block` に切替（§4 Step 2）                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 自動生成物（standalone.html）のサイズが見積もりを大幅超過                                                                                                                                                                                                                                                                                                                                                                                                                                         | Step 6 完了時点で `gzip -c dist/standalone.html` の出力を `wc -c` でカウントして実測し、 §3.5 の見積もり / §7 受け入れ基準と比較                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `var(--bg)` のような実在しない CSS variable を参照して `transparent` 解決される                                                                                                                                                                                                                                                                                                                                                                                                                   | 768px ブロックで使う CSS variable は実在の `--paper` / `--paper-edge` / `--ink` / `--rule` / `--accent` のみ。 footer 背景は `var(--paper-edge)`、 border は `var(--rule)`（§4 Step 6）                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| landscape の例として 932×430 を「768px 以下」と誤記、 さらに 769-900px の機種 (iPhone 12 mini landscape 812×375 / 12 Pro landscape 844×390 / 13 mini landscape 812×375 等) を「desktop モデル」と誤記 (実際は既存 `@media (max-width: 900px)` 適用域でタブレット vertical-stack モデル)                                                                                                                                                                                                           | 正しい区分は §3.1 表に従う：(a) **≤768px** = drawer モデル (例：iPhone SE landscape 667×375)、 (b) **769-900px** = 既存 **タブレット (vertical-stack) モデル** (`.page-nav` 非表示・`.comments` 縦積み、 例：iPhone 12/13 mini landscape 812×375 / 12 Pro landscape 844×390 / 14 Pro Max landscape 932×430)、 (c) **≥901px** = desktop モデル (例：iPad mini landscape 1024×768 / iPad landscape 1180×820)。 §6 手動チェック preset 表の期待結果も §3.1 と整合（§1 スコープ外 / §5.a 採用案 B 論点 / §3.1）                                                                                                                                                           |
| 既存 `.search-bar` の内部要素合計 (~450px: padding 48 + gap 32 + input min-width 200 + count min-width 80 + 3 ボタン ~90) が iPhone SE (375px) 幅を 75px 超過して横スクロールが発生                                                                                                                                                                                                                                                                                                               | 768px ブロックで mobile 用 compact 化：`.search-bar { padding: 8px 12px; gap: 6px }` / `.search-input { box-sizing: border-box; min-width: 0; min-height: 44px; font-size: 16px }` / `.search-count { min-width: 0; font-size: 11px; flex-shrink: 0 }` / `.search-action { box-sizing: border-box; min-width: 44px; min-height: 44px; padding: 4px 6px; flex-shrink: 0 }` で 375px (fixed 210 + input 165) に収まる（§5.p / §4 Step 6）                                                                                                                                                                                                                               |
| search-bar の 3 操作ボタン (`.search-action`) が既存 padding 4px 8px + font-size 14 + border で outer ~24×26px、 WCAG 2.5.5 / Apple HIG 推奨 44×44 を満たさず mobile タップ操作で誤タップが発生                                                                                                                                                                                                                                                                                                   | 768px ブロックで `.search-action { box-sizing: border-box; min-width: 44px; min-height: 44px }` に拡張。 同じく `.search-input { box-sizing: border-box; min-height: 44px }` で input も 44px tap target を確保。 §5.o footer 3 ボタンと同水準（§5.p）                                                                                                                                                                                                                                                                                                                                                                                                                |
| iOS Safari は `<input>` の `font-size` が 16px 未満の時、 フォーカス時に viewport を自動拡大する → mobile で検索 input タップ毎に画面がズームインし UX が分断される                                                                                                                                                                                                                                                                                                                               | 768px ブロックで `.search-input { font-size: 16px }` に上書き (既存 14px)。 `<meta name="viewport" content="user-scalable=no">` での viewport ズーム全体禁止は WCAG 1.4.4 Resize Text 違反のため採用しない（§5.p / §4 Step 6）                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## 9. 参考

- [DESIGN.md §4 アーキテクチャ](./DESIGN.md#4-アーキテクチャ) — chrome / レイアウト / 永続化の 3 層構成
- [DESIGN.md §10 ブラウザ互換性](./DESIGN.md#10-ブラウザ互換性) — モバイルブラウザの File System Access API 制約
- [DESIGN.md §12 MDXG 準拠ロードマップ・今後の拡張](./DESIGN.md#12-mdxg-準拠ロードマップ今後の拡張) — 「その他の拡張候補」の「スマートフォン向け UI の最適化」項目
- [DESIGN.md §13 ビルドパイプライン](./DESIGN.md#13-ビルドパイプライン) — `vp build` / `npm run build` の出口と inline 化、 online edition rewrite
- [DESIGN.md §14 UI 国際化](./DESIGN.md#14-ui-国際化) — i18n キー命名規約と `data-i18n-*` 属性経由の DOM 更新
- [docs/archive/mdxg-virtual-pages.archive.md](./archive/mdxg-virtual-pages.archive.md) — 既存 `@media (max-width: 900px)` ブロック（vertical-stack 化）の導入経緯、 `.doc-pane` の `overflow-y: visible` 設定
- [docs/archive/feature-ui-i18n.archive.md](./archive/feature-ui-i18n.archive.md) — i18n キー追加の規約と test pattern
- [docs/archive/feature-online-runtime-assets.archive.md](./archive/feature-online-runtime-assets.archive.md) — online edition rewrite の設計（footer / backdrop DOM が保存される根拠）
- [W3C Pointer Events Level 3 — touch-action](https://www.w3.org/TR/pointerevents3/#the-touch-action-css-property) — effective touch-action の AND 計算根拠（§5.h）
- [WHATWG HTML — hidden attribute](https://html.spec.whatwg.org/multipage/interaction.html#the-hidden-attribute) — UA stylesheet で `[hidden] { display: none }` 適用、 author CSS で上書き可能（§5.l）
- [MDN: CSS box-sizing](https://developer.mozilla.org/en-US/docs/Web/CSS/box-sizing) — `border-box` で `height` 内に padding を取り込む（§5.k）
- [MDN: MediaQueryList](https://developer.mozilla.org/en-US/docs/Web/API/MediaQueryList) — `matchMedia('(max-width: 768px)').addEventListener('change', ...)` の購読パターン（§5.j-3）
- [MDN: HTMLElement.inert](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/inert) — inert 属性による Tab 巡回 / interactive 抑制（§5.j）
- [MDN: Visual Viewport API](https://developer.mozilla.org/en-US/docs/Web/API/Visual_Viewport_API) — iOS Safari の動的 viewport
- [WebKit: Designing Websites for iPhone X](https://webkit.org/blog/7929/designing-websites-for-iphone-x/) — `viewport-fit=cover` と `env(safe-area-inset-*)`
- [GitHub Primer Octicons](https://github.com/primer/octicons) — footer ボタン用 SVG icon（`three-bars-16.svg` / `search-16.svg` / `comment-discussion-16.svg`）
- [WCAG 2.3.3 Animation from Interactions](https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions.html) — `prefers-reduced-motion: reduce` 対応の根拠
