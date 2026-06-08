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
import { boot, isOnlineEdition } from './boot'
import {
  attachKatexReadyListener,
  hasKatexReadyListenerForTest,
  resetKatexReadyListenerForTest,
} from './renderers/katex'
import {
  attachMermaidReadyListener,
  hasMermaidReadyListenerForTest,
  resetMermaidReadyListenerForTest,
} from './renderers/mermaid'
import {
  attachShikiLangsReadyListener,
  hasShikiLangsListenerForTest,
  resetShikiLangsListenerForTest,
} from './renderers/shiki-upgrade'
import { createDropdownMenu } from './dom/menu'
import { createOnlineAssetCache, type OnlineAssetCache } from './online/asset-loader'
import { decorateLoadFromMarkdownForOnline } from './online/runtime-decorator'
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

/**
 * online edition では `loadFromMarkdown` を decorator で装飾し、toolbar (Open file) /
 * boot (?url=) / Open URL modal (reload 経由 boot) の全入力経路で同じ装飾関数を経由させる。
 * decorator が cache の世代 / AbortController を進めて asset-loader を fire-and-forget で発火する。
 * standalone / embed-template (online edition でない) では base をそのまま透過する。
 */
export const resolveBootstrapDeps = (
  deps: BootstrapDeps,
  online: boolean,
  cache?: OnlineAssetCache
): BootstrapDeps => {
  if (!online) {
    return deps
  }
  const assetCache = cache ?? createOnlineAssetCache()
  return {
    ...deps,
    loadFromMarkdown: decorateLoadFromMarkdownForOnline(deps.loadFromMarkdown, assetCache),
  }
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

// online edition で asset-loader が dynamic import で立ち上げる Shiki / Mermaid / KaTeX bridge を
// 永続 listener で pickup する。 3G/4G の数秒遅延 import や複数文書連続ロードでも upgrade を
// 取りこぼさないため (docs/feature-online-runtime-assets.md §3.3)。 standalone / embed-template
// では呼ばない (CLI 経路は runtime 既 inline で listener 不要)。
export const attachOnlineRuntimeListeners = (): void => {
  const docEl = qs('#doc')
  attachShikiLangsReadyListener(docEl)
  attachMermaidReadyListener(docEl)
  attachKatexReadyListener(docEl)
}

// in-source test 用 helper。 unicorn/consistent-function-scoping を満たすため module scope に置く。
// `import.meta.vitest` は本番ビルドで false 評価されるため、test 専用 helper も dead code として落ちる。
const installDocElForTest = (): HTMLElement => {
  const doc = document.createElement('div')
  doc.id = 'doc'
  document.body.appendChild(doc)
  return doc
}

const cleanupListenersAndDocForTest = (): void => {
  resetMermaidReadyListenerForTest()
  resetShikiLangsListenerForTest()
  resetKatexReadyListenerForTest()
  const doc = document.getElementById('doc')
  if (doc !== null) {
    doc.remove()
  }
}

interface OnlineListenerSnapshot {
  katex: boolean
  mermaid: boolean
  shiki: boolean
}

const snapshotOnlineListenersForTest = (): OnlineListenerSnapshot => ({
  katex: hasKatexReadyListenerForTest(),
  mermaid: hasMermaidReadyListenerForTest(),
  shiki: hasShikiLangsListenerForTest(),
})

export const bootstrapReviewApp = (deps: BootstrapDeps): void => {
  const online = isOnlineEdition()
  const effectiveDeps = resolveBootstrapDeps(deps, online)
  setupModalsAndPanels()
  const sendMenu = setupDropdownsAndKeyboard(effectiveDeps)
  setupSearchWiring()
  setupToolbarButtons(sendMenu)
  setupNavigationRouting()
  if (online) {
    attachOnlineRuntimeListeners()
  }
  launchBoot(effectiveDeps.loadFromMarkdown)
}

if (import.meta.vitest) {
  const { describe, expect, it, vi } = import.meta.vitest

  const makeDeps = (): BootstrapDeps => ({
    buildExportPayload: vi.fn(),
    commentCountLabel: vi.fn((): string => '0 comments'),
    loadFromMarkdown: vi.fn(async (): Promise<void> => {
      // no-op
    }),
  })

  describe('resolveBootstrapDeps', () => {
    it('online=false なら deps をそのまま返す (standalone / embed への副作用ゼロ)', () => {
      const deps = makeDeps()
      const result = resolveBootstrapDeps(deps, false)
      expect(result).toBe(deps)
      expect(result.loadFromMarkdown).toBe(deps.loadFromMarkdown)
    })

    it('online=true で loadFromMarkdown が装飾され base と別関数になる', () => {
      const deps = makeDeps()
      const result = resolveBootstrapDeps(deps, true)
      expect(result.loadFromMarkdown).not.toBe(deps.loadFromMarkdown)
    })

    it('online=true でも他フィールド (buildExportPayload / commentCountLabel) は透過', () => {
      const deps = makeDeps()
      const result = resolveBootstrapDeps(deps, true)
      expect(result.buildExportPayload).toBe(deps.buildExportPayload)
      expect(result.commentCountLabel).toBe(deps.commentCountLabel)
    })

    it('外部 cache を渡すと装飾 runtime 呼び出しで cache.generation が +1 される (decorator 経由確認)', async () => {
      const deps = makeDeps()
      const cache = createOnlineAssetCache()
      const result = resolveBootstrapDeps(deps, true, cache)
      expect(cache.generation).toBe(0)
      await result.loadFromMarkdown('doc.md', '# x\n')
      expect(cache.generation).toBe(1)
      expect(deps.loadFromMarkdown).toHaveBeenCalledWith('doc.md', '# x\n')
    })

    it('cache 省略時は新規 OnlineAssetCache が内部生成され、装飾後 base が呼ばれる', async () => {
      const deps = makeDeps()
      const result = resolveBootstrapDeps(deps, true)
      await result.loadFromMarkdown('doc.md', '# y\n')
      expect(deps.loadFromMarkdown).toHaveBeenCalledWith('doc.md', '# y\n')
    })
  })

  describe('attachOnlineRuntimeListeners (online edition gate)', () => {
    const ALL_NOT_ATTACHED: OnlineListenerSnapshot = { katex: false, mermaid: false, shiki: false }
    const ALL_ATTACHED: OnlineListenerSnapshot = { katex: true, mermaid: true, shiki: true }

    it('呼ぶと Shiki / Mermaid / KaTeX の永続 listener が 3 つ attach される (online 経路)', () => {
      cleanupListenersAndDocForTest()
      installDocElForTest()
      try {
        expect(snapshotOnlineListenersForTest()).toEqual(ALL_NOT_ATTACHED)
        attachOnlineRuntimeListeners()
        expect(snapshotOnlineListenersForTest()).toEqual(ALL_ATTACHED)
      } finally {
        cleanupListenersAndDocForTest()
      }
    })

    it('呼ばなければ listener は attach されない (CLI / standalone 経路の no-op 検証)', () => {
      cleanupListenersAndDocForTest()
      installDocElForTest()
      try {
        // bootstrapReviewApp の if (online) 分岐が false 経路を踏む状態を再現
        // (attachOnlineRuntimeListeners を呼ばない)
        expect(snapshotOnlineListenersForTest()).toEqual(ALL_NOT_ATTACHED)
      } finally {
        cleanupListenersAndDocForTest()
      }
    })
  })
}
