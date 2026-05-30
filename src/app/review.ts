// DOM エントリポイント。
// 各責務は別モジュールに切り出し済み:
//   状態 (app-state) / DOM helper (dom-utils) / mark 反映 (mark-engine) / markdown 描画 (doc-renderer) /
//   コメントパネル (comments) / floater (floater) / コメント入力モーダル (comment-modal) /
//   ドロップダウンメニュー (menu) / toolbar (toolbar) / boot (boot)
// 本ファイルは loadFromMarkdown orchestrator と、上記モジュールを組み合わせる wiring に専念する。

import type { Comment, ExportPayload } from '../core/types'
import {
  type NavigateTarget,
  isPageHash,
  resolveTargetFromHash,
  setActivePageIndex,
  syncHashFromActivePage,
} from './document/pages'
import {
  activateCommentsMark,
  configureCommentEdit,
  configureCommentsNavigation,
  focusCommentMarkAfterNavigate,
  renderComments,
  wireCommentsKeyboardNav,
} from './comments/comments'
import { appendFootnotesPage, splitIntoPages } from '../core/page-split'
import {
  buildReviewExportPayload,
  commentCountLabel as formatCommentCount,
} from '../core/review-export'
import { changeOutputFolder, writeFeedback } from './workspace/workspace'
import { closeCommentModal, openEditCommentModal, wireCommentModal } from './comments/comment-modal'
import { closeHelpModal, openHelpModal, toggleHelpModal, wireHelpModal } from './chrome/help-modal'
import { closeMermaidModal, wireMermaidModal } from './renderers/mermaid-modal'
import { computeDocHash, formatLoadedStatus } from '../core/embed'
import { loadDocumentState, markFeedbackUnsaved, state } from './state/app-state'
import { qs, toast } from './dom/dom-utils'
import {
  activateFocusedItem,
  hasNoModifier,
  moveFocusDown,
  moveFocusLeft,
  moveFocusRight,
  moveFocusUp,
  shouldSkipAffordanceKey,
} from './navigation/keyboard-shortcuts'
import {
  closeSearch,
  configureSearchNavigation,
  isSearchOpen,
  openSearch,
  reapplySearchHighlights,
  toggleSearch,
  wireSearchBar,
} from './search/search'
import {
  focusNavigatedLink,
  renderPageNavigation,
  wirePageNavigation,
} from './navigation/page-navigation'
import { scrollToHeading, setActiveHeadingImmediately, setupScrollSpy } from './document/scroll-spy'
import { setOnPageActivated, setupPageScrollSpy } from './navigation/page-scroll-spy'
import { boot } from './boot'
import { createDropdownMenu } from './dom/menu'
import { initCommentsResize } from './comments/comments-resize'
import { initPageNavResize } from './navigation/page-nav-resize'
import { renderDoc } from './document/doc-renderer'
import { setOnMarksReapplied } from './comments/mark-engine'
import { wireFloater } from './comments/floater'
import { wireToolbar } from './chrome/toolbar'

/**
 * loadFromMarkdown / navigateToTarget 双方で使う「現状の state を全 view に流す」共通処理。
 * scroll-spy も DOM が新しくなった直後に組み直す (古い observer はリーク防止のため teardown)。
 */
const renderAll = (): void => {
  renderDoc()
  renderPageNavigation()
  renderComments()
  setupScrollSpy()
  setupPageScrollSpy()
}

/** activePage に対応する `<section.virtual-page>` を DOM から取り出す。 */
const findActivePageSection = (): HTMLElement | null => {
  const activePage = state.pages[state.activePageIndex]
  if (!activePage) {
    return null
  }
  return document.querySelector<HTMLElement>(
    `section.virtual-page[data-page-slug="${activePage.slug}"]`
  )
}

/**
 * section の上枠を pane の上から SECTION_TOP_RATIO の位置に揃える。section top を viewport top
 * にぴったり貼り付けるとページ境界の認識が弱いため、上端寄りの細い余白を確保して「次ページが
 * 始まった」感覚を与える。page-scroll-spy の rootMargin 判定線とも揃える
 * (`page-scroll-spy.ts` の `-5% 0px -95% 0px` と同じ比率)。
 */
const SECTION_TOP_RATIO = 0.05
const alignSectionTopInPane = (
  section: HTMLElement,
  pane: HTMLElement,
  behavior: ScrollBehavior
): void => {
  const sectionRect = section.getBoundingClientRect()
  const paneRect = pane.getBoundingClientRect()
  const targetScrollTop =
    pane.scrollTop + (sectionRect.top - paneRect.top) - pane.clientHeight * SECTION_TOP_RATIO
  pane.scrollTo({ behavior, top: targetScrollTop })
}

/**
 * Stacked View で、現在 activePage の `<section.virtual-page>` を doc-pane のスクロール位置に
 * 揃える。実位置の決定は `alignSectionTopInPane` に委譲する。doc-pane が無い旧経路 (テスト
 * fixture 等) では `scrollIntoView` にフォールバックする。
 *
 * 初期ロードは `auto` (instant) で呼ぶ。smooth では scroll 完了まで複数 frame かかり、その間に
 * page-scroll-spy の初回 IntersectionObserver callback が「先頭 section が intersecting」と
 * 判定して activePageIndex を 0 に巻き戻すレースが起きる。instant ならスクロール位置が同期で
 * 確定するため、observer 初回時点で正しい topmost が選ばれる。
 */
const scrollToActivePageSection = (behavior: ScrollBehavior = 'smooth'): void => {
  const section = findActivePageSection()
  if (!section) {
    return
  }
  const pane = section.closest<HTMLElement>('.doc-pane')
  if (!pane) {
    section.scrollIntoView({ behavior, block: 'start' })
    return
  }
  alignSectionTopInPane(section, pane, behavior)
}

/**
 * render 後の navigate 終端処理を共通化したヘルパ。
 * - `target.headingSlug` 指定時: 即座に outline link をハイライトしてから、page slug で絞った
 *   section 内の heading にスクロール
 * - heading 無し + ページ切替あり: page section の先頭にスクロール (TOC クリック後の page 移動)
 * - heading 無し + ページ切替なし: 何もしない (同一 page 内 navigate のスクロール位置は維持)
 *
 * Stacked View では heading id が page をまたいで衝突するため、scrollToHeading には activePage の
 * slug を渡して section を 1 つに絞る。`loadFromMarkdown` (初期ロード) と `navigateToTarget`
 * (TOC / Sequential / hashchange) の双方からこのヘルパに集約することで、page-only deep link
 * (`#page-3` 等) でも heading deep link でも一貫してスクロール位置が反映される。
 */
const scrollToTargetAfterRender = (
  target: NavigateTarget,
  pageChanged: boolean,
  behavior: ScrollBehavior
): void => {
  if (target.headingSlug !== null) {
    setActiveHeadingImmediately(target.headingSlug)
    const activePage = state.pages[state.activePageIndex]
    if (!activePage) {
      return
    }
    scrollToHeading(target.headingSlug, activePage.slug, behavior)
    return
  }
  if (pageChanged) {
    scrollToActivePageSection(behavior)
  }
}

interface LoadResult {
  docHash: string
  target: NavigateTarget
}

// loadFromMarkdown を 10 statements 以内に収めるため state 初期化部分を別関数に切り出す。
// docHash は state.docHash に書き込んだ後 caller でも `formatLoadedStatus` に渡したい一方、
// state.docHash の型が `string | null` のため TypeScript narrow を維持するには戻り値経由が手早い。
const initStateFromMarkdown = async (name: string, text: string): Promise<LoadResult> => {
  const docHash = await computeDocHash(text)
  const pages = appendFootnotesPage(splitIntoPages(text, { docName: name }), text)
  const target = resolveTargetFromHash(globalThis.location.hash)
  loadDocumentState({
    activePageIndex: target.pageIndex,
    docHash,
    docName: name,
    markdown: text,
    pages,
  })
  return { docHash, target }
}

/**
 * markdown 本文を取り込んで state を構築・描画・ステータス更新する中心ルーチン。
 * 永続化レイヤは workspace-handle のみ（詳細は DESIGN.md §7）。
 *
 * MDXG Virtual Pages 用に markdown 読み込み時点で `state.pages` を確定し、`activePageIndex` は
 * `location.hash` を参照して解決する (DESIGN.md §9 起動シーケンス step 1c–1d)。
 * 初期ロード時の deep link は render 後に `scrollToTargetAfterRender` で page section または
 * heading 位置まで反映する。`auto` (instant) を渡すことで page-scroll-spy の初回 callback と
 * 競合せず、URL hash と activePageIndex が一致したまま起動する。
 */
export const loadFromMarkdown = async (name: string, text: string): Promise<void> => {
  const { docHash, target } = await initStateFromMarkdown(name, text)
  markFeedbackUnsaved()
  renderAll()
  qs('#status').textContent = formatLoadedStatus(name, docHash)
  // 初期ロードでは `pageChanged=true` 相当 (activePageIndex は hash から復元したばかり) で、
  // page-only hash (`#page-3` 等) でも instant scroll で位置確定させる。
  scrollToTargetAfterRender(target, true, 'auto')
}

/**
 * ページ + 任意の heading への遷移 orchestrator。state.activePageIndex を切り替えて DOM 再描画と
 * hash 同期、対象 heading へのスクロールをまとめて行う。
 * - `pushHash = true` (TOC / outline / Sequential クリック): hash も書き換える
 * - `pushHash = false` (hashchange 由来): hash は既に変更済みなので書き換えない
 * - `focusTOC = true` はキーボード由来の navigate (Enter on TOC link) で立てる。対象 link に
 *   フォーカスを戻し、roving tabindex の current 位置も同時に更新する (§13 [SHOULD] フォーカス管理)。
 *   click 由来 / hashchange / scroll-spy 由来では false のままで、フォーカスを奪わない
 * - scroll 動作は `scrollToTargetAfterRender` に集約 (heading 指定 / page section / 同一 page 内
 *   no-op の 3 分岐) し、instant (`auto`) で位置遷移する
 *
 * 再描画は必ず `renderAll()` 経由にする。view 追加時の drift を構造的に防ぐ単一の真の源
 * (Phase 3 で sequential-nav 抜けが起きた回帰の再発防止)。
 */
const navigateToTarget = (target: NavigateTarget, pushHash: boolean, focusTOC = false): void => {
  const pageChanged = setActivePageIndex(target.pageIndex)
  if (pageChanged) {
    renderAll()
  }
  if (pushHash) {
    syncHashFromActivePage(target.headingSlug)
  }
  scrollToTargetAfterRender(target, pageChanged, 'auto')
  if (focusTOC) {
    const activePage = state.pages[state.activePageIndex]
    if (activePage) {
      focusNavigatedLink(activePage.slug, target.headingSlug)
    }
  }
}

// `#footnote-<id>` / `#footnote-ref-<id>` / `#footnote-ref-<id>-<n>` のいずれかを判定する。
// hash prefix で構造的に分離することで、`#p:<slug>` 経路 (page slug) と footnote 経路を別系統に
// 切り出す (docs/mdxg-footnotes.md §3.3 / §5.j)。
const FOOTNOTE_HASH_RE = /^#footnote(-ref)?-/u

const resolveFootnotePageIndex = (el: HTMLElement): number | null => {
  const section = el.closest<HTMLElement>('section.virtual-page')
  if (section === null) {
    return null
  }
  const pageIndex = Number(section.dataset.pageIndex)
  if (!Number.isInteger(pageIndex)) {
    return null
  }
  return pageIndex
}

const focusFootnoteTarget = (el: HTMLElement, pageIndex: number): void => {
  navigateToTarget({ headingSlug: null, pageIndex }, false)
  el.scrollIntoView({ behavior: 'auto', block: 'center' })
  el.focus({ preventScroll: true })
}

/**
 * 脚注 anchor (`<a data-footnote-ref>` / `<a data-footnote-backref>`) クリック / hashchange の
 * 専用 handler。対応する DOM 要素を含む virtual-page section の `data-page-index` を読み取って
 * `navigateToTarget` 経由で page を active 化し、要素に scroll + focus する。
 * - footnote hash でなければ false (呼び出し側はそのまま次の page-hash 経路に流す)
 * - 該当 ID が DOM に無い (orphan の backref など) は false (default の anchor scroll に任せる)
 */
const handleFootnoteHash = (hash: string): boolean => {
  if (!FOOTNOTE_HASH_RE.test(hash)) {
    return false
  }
  const el = document.getElementById(hash.slice(1))
  if (el === null) {
    return false
  }
  const pageIndex = resolveFootnotePageIndex(el)
  if (pageIndex === null) {
    return false
  }
  focusFootnoteTarget(el, pageIndex)
  return true
}

interface DropdownLike {
  close: () => void
}

/**
 * グローバル keydown を 1 経路に集約する。Escape (modal/menu 閉じ) → Cmd/Ctrl+Enter
 * (modal save) → WASD affordance の 3 段で dispatch する。
 * commentsMenu / sendMenu は createDropdownMenu の戻り値で、Escape 時に同時に閉じる必要があるため
 * 引数として渡す (DOM ID 経由で再取得しても良いが、close handle を直接持つ方が破綻に強い)。
 */
const setupKeyboardHandlers = (commentsMenu: DropdownLike, sendMenu: DropdownLike): void => {
  const handleEscapeKey = (): void => {
    closeCommentModal()
    closeHelpModal()
    closeMermaidModal()
    commentsMenu.close()
    sendMenu.close()
    if (isSearchOpen()) {
      closeSearch()
    }
  }
  const handleModalSaveKey = (): void => {
    if (qs('#modal').classList.contains('open')) {
      qs('#modal-save').click()
    }
  }
  // WASD ベースのキーマップ (§13)。dispatch table で event.code → handler に振り分ける。
  // すべて単独キーのため textarea / input / contenteditable に focus があるときは
  // shouldSkipAffordanceKey でスキップして文字入力を妨げない。`event.repeat` ガードは
  // 押しっぱなしによる連続発火を塞ぐ (modal の点滅対策、§13)。
  const AFFORDANCE_KEY_HANDLERS: Record<string, () => void> = {
    KeyA: moveFocusLeft,
    KeyD: moveFocusRight,
    KeyE: activateFocusedItem,
    KeyF: openSearch,
    KeyH: openHelpModal,
    KeyS: moveFocusDown,
    KeyW: moveFocusUp,
  }
  const KBD_FLASH_MS = 420
  const KBD_FLASH_KEYS: Record<string, string> = {
    KeyA: 'a',
    KeyD: 'd',
    KeyE: 'e',
    KeyS: 's',
    KeyW: 'w',
  }
  const flashKbdHints = (code: string): void => {
    const key = KBD_FLASH_KEYS[code]
    if (!key) {
      return
    }
    const targets = document.querySelectorAll<HTMLElement>(
      `.page-nav-keyhints kbd[data-key="${key}"], .doc-pane-keyhints kbd[data-key="${key}"], .comments-keyhints kbd[data-key="${key}"]`
    )
    for (const el of targets) {
      el.classList.add('kbd-active')
      globalThis.setTimeout(() => el.classList.remove('kbd-active'), KBD_FLASH_MS)
    }
  }
  const handleAffordanceKeys = (event: KeyboardEvent): void => {
    if (shouldSkipAffordanceKey(event)) {
      return
    }
    if (!hasNoModifier(event)) {
      return
    }
    const handler = AFFORDANCE_KEY_HANDLERS[event.code]
    if (handler) {
      event.preventDefault()
      flashKbdHints(event.code)
      handler()
    }
  }

  document.addEventListener('keydown', (event): void => {
    if (event.key === 'Escape') {
      handleEscapeKey()
      return
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      handleModalSaveKey()
      return
    }
    handleAffordanceKeys(event)
  })
}

/**
 * ブラウザの戻る / 進む or 直接 URL 編集経由の hash 変更を navigate に流す。
 * `#p:` で名前空間化された page hash と footnote hash の 2 経路に分岐し、いずれにも該当しない
 * 本文内 anchor (`[x](#some-heading)`) はブラウザのデフォルト anchor scroll に任せる。
 * 同一 hash での footnote 再クリックは hashchange が発火しないため、click delegate でも
 * 同経路に流す (docs/mdxg-footnotes.md §3.3)。
 */
const setupHashNavigation = (): void => {
  globalThis.addEventListener('hashchange', (): void => {
    const { hash } = globalThis.location
    if (handleFootnoteHash(hash)) {
      return
    }
    if (!isPageHash(hash)) {
      return
    }
    navigateToTarget(resolveTargetFromHash(hash), false)
  })

  document.addEventListener('click', (event): void => {
    if (!(event.target instanceof Element)) {
      return
    }
    const link = event.target.closest<HTMLAnchorElement>(
      'a[data-footnote-ref], a[data-footnote-backref]'
    )
    if (link === null) {
      return
    }
    const href = link.getAttribute('href')
    if (href !== null) {
      handleFootnoteHash(href)
    }
  })
}

export const buildExportPayload = (): ExportPayload => buildReviewExportPayload(state)

export const commentCountLabel = (): string => formatCommentCount(state.comments.length)

/**
 * TOC / outline / Sequential Nav いずれのクリックでも、anchor の `data-slug` は
 * `<page-slug>` か `<page-slug>__<heading-slug>` の composite 形式。
 * composite slug を `resolveTargetFromHash` に流すことで page index + heading slug を一度に解決し、
 * navigateToTarget に渡す。
 *
 * `keyboardActivated` は wirePageNavigation の click delegate が `MouseEvent.detail === 0` で識別した
 * 「キーボード Enter で `<a>` がブラウザに dispatch させた synthetic click」を指し、navigate 後に
 * TOC の対象 link へフォーカスを戻すかの判断に使う (§13 [SHOULD])。マウスクリックでは false の
 * ままでフォーカスを動かさず、本文側に居るユーザーの邪魔をしない。
 */
const onCompositeSlugClick = (compositeSlug: string, keyboardActivated: boolean): void => {
  navigateToTarget(resolveTargetFromHash(`#${compositeSlug}`), true, keyboardActivated)
}

/**
 * サイドバーに表示された別ページのコメントカードがクリックされた時の遷移 orchestrator。
 * navigateToTarget で activePageIndex を切り替えると renderAll が走り、mark-engine が
 * 新ページの comments を mark 化する。同じ tick で focusCommentMarkAfterNavigate を呼べば
 * 描画済みの mark を見つけてハイライト + smoothScroll できる。
 */
const navigateToComment = (comment: Comment): void => {
  navigateToTarget({ headingSlug: null, pageIndex: comment.pageIndex }, true)
  focusCommentMarkAfterNavigate(comment.id)
  // navigateToTarget → renderAll で #cmt-list が再構築され、Enter/click 時に focus を持っていた
  // 旧カードは破棄される。新カードを comment id で引き直して focus を戻すことで、TOC 側の
  // focusNavigatedLink (§13 [SHOULD]) と同等の「navigate 後にフォーカスが残る」挙動を実現する。
  const newCard = document.querySelector<HTMLElement>(`.cmt-card[data-id="${comment.id}"]`)
  if (newCard) {
    newCard.focus()
  }
}

if (!import.meta.vitest) {
  initCommentsResize()
  initPageNavResize()
  wireFloater()
  wireCommentModal()
  wireHelpModal()
  wireMermaidModal()
  configureCommentsNavigation(navigateToComment)
  configureCommentEdit(openEditCommentModal)
  // page scroll-spy が activePageIndex を更新した直後の TOC active 表示更新。
  // renderPageNavigation は state を再読込して描き直すだけなので、scroll 中の頻発でも軽い。
  setOnPageActivated((): void => renderPageNavigation())

  const commentsMenu = createDropdownMenu({
    buttonId: '#btn-comments-menu',
    menuId: '#menu-comments',
  })
  const sendMenu = createDropdownMenu({
    buttonId: '#btn-send-menu',
    menuId: '#menu-send',
  })

  setupKeyboardHandlers(commentsMenu, sendMenu)

  // mark クリック → サイドバーカードをアクティブ化
  document.addEventListener('click', (event): void => {
    const { target } = event
    if (!(target instanceof Element)) {
      return
    }
    const mark = target.closest('mark.cmt')
    if (!(mark instanceof HTMLElement)) {
      return
    }
    activateCommentsMark(mark)
  })

  wireToolbar({
    buildExportPayload,
    commentCountLabel,
    loadFromMarkdown,
  })

  // search (MDXG §10) の wiring。reapply hook は mark-engine から呼ばれるため、cmt mark の
  // 再貼付経路 (Shiki upgrade / renderAll / コメント追加 / 削除) を通っても search 状態が維持される。
  // navigate コールバックは「current match の page に hash 更新無しで navigate」を渡す。
  setOnMarksReapplied(reapplySearchHighlights)
  configureSearchNavigation((pageIndex: number): void => {
    navigateToTarget({ headingSlug: null, pageIndex }, false)
  })
  wireSearchBar()
  qs('#btn-search').addEventListener('click', toggleSearch)

  qs('#btn-help').addEventListener('click', toggleHelpModal)
  qs('#btn-send').addEventListener('click', async (): Promise<void> => writeFeedback())
  qs('#btn-change-output').addEventListener('click', async (): Promise<void> => {
    sendMenu.close()
    await changeOutputFolder()
  })

  // Skip to navigation (§13)。href="#page-nav-list" のブラウザ標準 scroll では <ul> 自体が
  // focusable ではないため、明示的に active page-nav-link へ focus() を移す。
  qs('#skip-to-nav').addEventListener('click', (event): void => {
    event.preventDefault()
    const activePage = state.pages[state.activePageIndex]
    if (activePage) {
      focusNavigatedLink(activePage.slug, null)
    }
  })

  // 左サイドバー TOC / outline link / TOC 上部の Prev/Next sequential row のクリックを
  // 1 つの handler に統一。anchor の標準クリックで location.hash も同時に更新されるが、
  // hashchange より先に即時 navigate して active 状態の反映遅延を回避する。重複 navigation は
  // setActivePageIndex の idempotent ガードで吸収される。
  wirePageNavigation({ onSlugClick: onCompositeSlugClick })
  wireCommentsKeyboardNav()

  setupHashNavigation()

  boot({
    loadFromMarkdown,
  }).catch((): void => {
    toast('Startup failed')
    // paint 前ガード (#doc-wrap / .doc-pane を隠す class) を解除し、空状態を見せる
    document.documentElement.classList.remove('has-embedded-md')
    document.documentElement.classList.add('doc-ready')
  })
}

const dummyCommentForTest = (id: string): Comment => ({
  blockId: '',
  comment: '',
  created: '',
  endOffset: 0,
  id,
  pageIndex: 0,
  quote: '',
  sourceLine: 1,
  startOffset: 0,
})

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest

  describe('commentCountLabel (state 依存)', () => {
    it('1 件のときは単数形', () => {
      const prev = state.comments
      state.comments = [dummyCommentForTest('x')]
      try {
        expect(commentCountLabel()).toBe('1 comment')
      } finally {
        state.comments = prev
      }
    })

    it('0 件のときは複数形 (i18n 非対応の既知挙動)', () => {
      const prev = state.comments
      state.comments = []
      try {
        expect(commentCountLabel()).toBe('0 comments')
      } finally {
        state.comments = prev
      }
    })

    it('2 件以上のときは複数形', () => {
      const prev = state.comments
      state.comments = [
        dummyCommentForTest('a'),
        dummyCommentForTest('b'),
        dummyCommentForTest('c'),
      ]
      try {
        expect(commentCountLabel()).toBe('3 comments')
      } finally {
        state.comments = prev
      }
    })
  })
}
