// review.ts エントリから呼び出される起動 wiring orchestrator。
// modal / floater / toolbar / search / 各種 nav の wiring を bootstrapReviewApp に集約し、
// 起動順 (DESIGN.md §9) を 1 箇所で把握できるようにする。
// loadFromMarkdown / buildExportPayload / commentCountLabel は review.ts (composition root)
// 側で組み立てて deps 経由で受け取る。

import type { ExportPayload } from '../core/types'
import {
  activateCommentsMark,
  setOnCommentEdit,
  setOnCommentNavigate,
  wireCommentsKeyboardNav,
} from './comments/comments'
import { changeOutputFolder, writeFeedback } from './workspace/workspace'
import {
  setOnSearchNavigate,
  reapplySearchHighlights,
  toggleSearch,
  wireSearchBar,
} from './search/search'
import { wirePageNavigation } from './navigation/page-navigation'
import { focusNavigatedLink } from './navigation/page-navigation-keyboard'
import { renderPageNavigation } from './navigation/page-navigation-render'
import {
  navigateToComment,
  navigateToTarget,
  onCompositeSlugClick,
} from './navigation/navigation-orchestrator'
import { openEditCommentModal, wireCommentModal } from './comments/comment-modal'
import { qs, toast } from './dom/dom-utils'
import { type DropdownLike, setupKeyboardHandlers } from './chrome/global-keyboard'
import { toggleHelpModal, wireHelpModal } from './chrome/help-modal'
import { boot } from './boot'
import { createDropdownMenu } from './dom/menu'
import { initCommentsResize } from './comments/comments-resize'
import { initPageNavResize } from './navigation/page-nav-resize'
import { registerPostMarksReapplied } from './comments/mark-engine'
import { setOnPageActivated } from './navigation/page-scroll-spy'
import { setupHashNavigation } from './navigation/hash-navigation'
import { state } from './state/app-state'
import { wireFloater } from './comments/floater'
import { wireFootnoteTooltip } from './document/footnote-tooltip'
import { wireMermaidModal } from './renderers/mermaid-modal'
import { wireOnlineErrorRetry } from './online/error-display'
import { wireOpenUrlModal } from './online/open-url-modal'
import { wireToolbar } from './chrome/toolbar'

interface BootstrapDeps {
  buildExportPayload: () => ExportPayload
  commentCountLabel: () => string
  loadFromMarkdown: (name: string, text: string) => Promise<void>
}

// online edition (data-mdxg-online ガード) でのみ wire される。standalone / embed-template
// では各関数が冒頭で no-op return するため副作用ゼロ (§3.1 二層 gating)。
const setupOnlineEditionUi = (): void => {
  wireOpenUrlModal()
  wireOnlineErrorRetry()
}

const wireCoreModals = (): void => {
  wireFloater()
  wireCommentModal()
  wireHelpModal()
  wireMermaidModal()
  wireFootnoteTooltip()
}

const setupModalsAndPanels = (): void => {
  initCommentsResize()
  initPageNavResize()
  wireCoreModals()
  setupOnlineEditionUi()
  setOnCommentNavigate(navigateToComment)
  setOnCommentEdit(openEditCommentModal)
  // page scroll-spy が activePageIndex を更新した直後の TOC active 表示更新。
  // renderPageNavigation は state を再読込して描き直すだけなので、scroll 中の頻発でも軽い。
  setOnPageActivated((): void => renderPageNavigation())
}

const wireMarkClickDelegate = (): void => {
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
}

// dropdown menu 2 個と keyboard / mark-click / toolbar の wiring をまとめる。
// `commentsMenu` は setupKeyboardHandlers が Escape で閉じるためだけに参照し、
// 後段からは触らないので戻り値には含めない。`sendMenu` は setupToolbarButtons が
// `--change-output` クリック時に明示的に close() する必要があるため返す。
const setupDropdownsAndKeyboard = (deps: BootstrapDeps): DropdownLike => {
  const commentsMenu = createDropdownMenu({
    buttonId: '#btn-comments-menu',
    menuId: '#menu-comments',
  })
  const sendMenu = createDropdownMenu({
    buttonId: '#btn-send-menu',
    menuId: '#menu-send',
  })
  setupKeyboardHandlers(commentsMenu, sendMenu)
  wireMarkClickDelegate()
  wireToolbar({
    buildExportPayload: deps.buildExportPayload,
    commentCountLabel: deps.commentCountLabel,
    loadFromMarkdown: deps.loadFromMarkdown,
  })
  return sendMenu
}

// search (MDXG §10) の wiring。reapply hook は mark-engine から呼ばれるため、cmt mark の
// 再貼付経路 (Shiki upgrade / renderAll / コメント追加 / 削除) を通っても search 状態が維持される。
// navigate コールバックは「current match の page に hash 更新無しで navigate」を渡す。
const setupSearchWiring = (): void => {
  // unsubscribe handle は破棄。setupSearchWiring は起動時 1 回しか呼ばれず teardown 経路が無いため。
  registerPostMarksReapplied(reapplySearchHighlights)
  setOnSearchNavigate((pageIndex: number): void => {
    navigateToTarget({ headingSlug: null, pageIndex }, false)
  })
  wireSearchBar()
  qs('#btn-search').addEventListener('click', toggleSearch)
}

const setupToolbarButtons = (sendMenu: DropdownLike): void => {
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
}

// 左サイドバー TOC / outline link / TOC 上部の Prev/Next sequential row のクリックを
// 1 つの handler に統一。anchor の標準クリックで location.hash も同時に更新されるが、
// hashchange より先に即時 navigate して active 状態の反映遅延を回避する。重複 navigation は
// setActivePageIndex の idempotent ガードで吸収される。
const setupNavigationRouting = (): void => {
  wirePageNavigation({ onSlugClick: onCompositeSlugClick })
  wireCommentsKeyboardNav()
  setupHashNavigation()
}

const launchBoot = (loadFromMarkdown: BootstrapDeps['loadFromMarkdown']): void => {
  boot({
    loadFromMarkdown,
  }).catch((): void => {
    toast('Startup failed')
    // paint 前ガード (#doc-wrap / .doc-pane を隠す class) を解除し、空状態を見せる
    document.documentElement.classList.remove('has-embedded-md')
    document.documentElement.classList.add('doc-ready')
  })
}

export const bootstrapReviewApp = (deps: BootstrapDeps): void => {
  setupModalsAndPanels()
  const sendMenu = setupDropdownsAndKeyboard(deps)
  setupSearchWiring()
  setupToolbarButtons(sendMenu)
  setupNavigationRouting()
  launchBoot(deps.loadFromMarkdown)
}
