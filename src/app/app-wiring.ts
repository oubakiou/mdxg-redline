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
  setupCommentsI18n,
  wireCommentsKeyboardNav,
} from './comments/comments'
import { changeOutputFolder, writeFeedback } from './workspace/workspace'
import {
  setOnSearchNavigate,
  reapplySearchHighlights,
  toggleSearch,
  wireSearchBar,
} from './search/search'
import { setupSearchI18n } from './search/search-dom'
import { wirePageNavigation } from './navigation/page-navigation'
import { focusNavigatedLink } from './navigation/page-navigation-keyboard'
import { renderPageNavigation, setupPageNavI18n } from './navigation/page-navigation-render'
import {
  navigateToComment,
  navigateToTarget,
  onCompositeSlugClick,
} from './navigation/navigation-orchestrator'
import { openEditCommentModal, wireCommentModal } from './comments/comment-modal'
import { qs, toast } from './dom/dom-utils'
import { type DropdownLike, setupKeyboardHandlers } from './chrome/global-keyboard'
import { toggleHelpModal, wireHelpModal } from './chrome/help-modal'
import { wireSettingsModal } from './chrome/settings-modal'
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
import { createDocumentLoader, type DocumentLoader } from './document/load-document'
import { decorateLoadFromMarkdownForOnline } from './online/runtime-decorator'
import {
  I18N_PENDING_CLASS,
  applyI18nDataset,
  initLangFromBrowser,
  translate,
} from './i18n/i18n-browser'
import { setupPasteMarkdownModalI18n, wirePasteMarkdownModal } from './chrome/paste-markdown-modal'
import { initCommentsResize } from './comments/comments-resize'
import { initPageNavResize } from './navigation/page-nav-resize'
import { registerPostMarksReapplied } from './comments/mark-engine'
import { setOnPageActivated } from './navigation/page-scroll-spy'
import { setupHashNavigation } from './navigation/hash-navigation'
import { state } from './state/app-state'
import { wireFloater } from './comments/floater'
import { wireFootnoteTooltip } from './document/footnote-tooltip'
import { wireMermaidModal } from './renderers/mermaid-modal'
import { setupOnlineSourceI18n } from './online/source-display'
import { setupOnlineErrorI18n, wireOnlineErrorRetry } from './online/error-display'
import { wireOpenUrlModal } from './online/open-url-modal'
import { wireToolbar } from './chrome/toolbar'
import { wireMobileFooter } from './chrome/mobile-footer'
import { wirePageScrollButton } from './chrome/page-scroll-button'

interface BootstrapDeps {
  buildExportPayload: () => ExportPayload
  commentCountLabel: () => string
  loadFromMarkdown: (name: string, text: string) => Promise<void>
}

/**
 * `loadFromMarkdown` (online decorator 適用済み) を `createDocumentLoader` で wrap した
 * `documentLoader` を伴う deps。各 callsite (boot / paste / Open file) は
 * `documentLoader.loadDocument({kind, ...})` 経由で文書をロードし、`registerOnDocumentLoad`
 * 経由で登録された hook (source 表示の切替等) が自動発火する (DESIGN.md §14.6 文書ライフサイクル hook)。
 */
export interface ResolvedBootstrapDeps extends BootstrapDeps {
  documentLoader: DocumentLoader
}

/**
 * online edition では `loadFromMarkdown` を decorator で装飾し、toolbar (Open file) /
 * boot (?url=) / Open URL modal (reload 経由 boot) の全入力経路で同じ装飾関数を経由させる。
 * decorator が cache の世代 / AbortController を進めて asset-loader を fire-and-forget で発火する。
 * standalone / embed-template (online edition でない) では base をそのまま透過する。
 * 装飾後の loadFromMarkdown を `createDocumentLoader` で wrap し、hook 経路を一緒に組み立てる。
 */
export const resolveBootstrapDeps = (
  deps: BootstrapDeps,
  online: boolean,
  cache?: OnlineAssetCache
): ResolvedBootstrapDeps => {
  let { loadFromMarkdown } = deps
  if (online) {
    const assetCache = cache ?? createOnlineAssetCache()
    loadFromMarkdown = decorateLoadFromMarkdownForOnline(deps.loadFromMarkdown, assetCache)
  }
  return {
    ...deps,
    documentLoader: createDocumentLoader(loadFromMarkdown),
    loadFromMarkdown,
  }
}

// online edition (data-mdxg-online ガード) でのみ wire される。standalone / embed-template
// では各関数が冒頭で no-op return するため副作用ゼロ (§3.1 二層 gating)。
// setupOnlineSourceI18n は data-mdxg-online ガードを内部 show 経路に持たせており、setup 自体は
// 副作用ゼロ。standalone / embed では loadDocument({kind:'local'}) のみ流れるので clearOnlineSource
// 経路に倒れ、`#online-source` は標準で非表示のまま。
const setupOnlineEditionUi = (deps: ResolvedBootstrapDeps): void => {
  wireOpenUrlModal()
  wireOnlineErrorRetry()
  setupOnlineSourceI18n({ registerOnDocumentLoad: deps.documentLoader.registerOnDocumentLoad })
  setupOnlineErrorI18n()
}

const wireCoreModals = (): void => {
  wireFloater()
  wireCommentModal()
  wireHelpModal()
  wireSettingsModal()
  wireMermaidModal()
  wireFootnoteTooltip()
}

const setupModalsAndPanels = (deps: ResolvedBootstrapDeps): void => {
  initCommentsResize()
  initPageNavResize()
  wireCoreModals()
  setupOnlineEditionUi(deps)
  setupPageNavI18n()
  setupCommentsI18n()
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

// mobile (≤768px) 専用 chrome の wiring。footer バーと、画面左下の page-scroll FAB をまとめる。
const wireMobileChrome = (): void => {
  wireMobileFooter()
  wirePageScrollButton()
}

// dropdown menu 3 個と keyboard / mark-click / toolbar の wiring をまとめる。
// `commentsMenu` / `openMenu` は setupKeyboardHandlers が Escape で閉じるためだけに参照し、
// 後段からは触らないので戻り値には含めない。`sendMenu` は setupToolbarButtons が
// `--change-output` クリック時に明示的に close() する必要があるため返す。
const setupDropdownsAndKeyboard = (deps: ResolvedBootstrapDeps): DropdownLike => {
  const commentsMenu = createDropdownMenu({
    buttonId: '#btn-comments-menu',
    menuId: '#menu-comments',
  })
  const sendMenu = createDropdownMenu({
    buttonId: '#btn-send-menu',
    menuId: '#menu-send',
  })
  const openMenu = createDropdownMenu({
    buttonId: '#btn-open-menu',
    menuId: '#menu-open',
  })
  setupKeyboardHandlers(commentsMenu, sendMenu, openMenu)
  wireMarkClickDelegate()
  wireToolbar({
    buildExportPayload: deps.buildExportPayload,
    commentCountLabel: deps.commentCountLabel,
    documentLoader: deps.documentLoader,
  })
  wireMobileChrome()
  wirePasteMarkdownModal({ documentLoader: deps.documentLoader })
  // setup の bootstrap 順序は他 4 モジュール (setupOnlineSourceI18n / setupOnlineErrorI18n /
  // setupPageNavI18n / setupSearchI18n) と同じく app-wiring.ts 側で直接呼び、grep 可読性を揃える。
  // paste-markdown が CLI から抑制された場合でも、setup は subscribeLangChange 1 件のみで
  // renderCurrentError は要素不在に fail-soft (currentErrorKey === null で no-op) のため無害。
  setupPasteMarkdownModalI18n()
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
  setupSearchI18n()
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

const launchBoot = (documentLoader: DocumentLoader): void => {
  boot({
    documentLoader,
  }).catch((): void => {
    toast(translate('toast.startup_failed'))
    // paint 前ガード (#doc-wrap / .doc-pane を隠す class) を解除し、空状態を見せる
    document.documentElement.classList.remove('has-embedded-md')
    document.documentElement.classList.add('doc-ready')
  })
}

// online edition で asset-loader が dynamic import で立ち上げる Shiki / Mermaid / KaTeX bridge を
// 永続 listener で pickup する。 3G/4G の数秒遅延 import や複数文書連続ロードでも upgrade を
// 取りこぼさないため (docs/archive/feature-online-runtime-assets.archive.md §3.3)。 standalone / embed-template
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

/**
 * i18n の paint 後 bootstrap (DESIGN.md §14.6)。
 *   1. head inline script で立てた lang / `<html lang>` を module-local state に再同期する
 *      (initLangFromBrowser)。head 側は <html lang> しか触らないため、ここで currentLang を確定。
 *   2. applyI18nDataset(document) で静的 markup の textContent / 属性 / CSS custom property を翻訳。
 *   3. i18n-pending class を解除して body の visibility を戻す (head の 3 秒タイムアウト fallback
 *      よりも早く外れるのが正常経路)。
 *
 * 動的 UI モジュールの setupXxxI18n() (`subscribeLangChange` 登録) は setupChromeAndNavigation
 * 経由で別途呼び出される。順序として initLangFromBrowser で currentLang を確定してから setup が
 * 走るよう、bootstrapReviewApp の中で bootstrapI18n → setupChromeAndNavigation の順を維持する。
 *
 * 例外が出ても残りの bootstrap (modal / boot 等) が走るよう、launchBoot より先に同期完了させる。
 */
export const bootstrapI18n = (): void => {
  initLangFromBrowser()
  applyI18nDataset(document)
  document.documentElement.classList.remove(I18N_PENDING_CLASS)
}

// modal / panel / dropdown / search / toolbar / navigation の wiring を集約する。
// bootstrapReviewApp の max-statements (10) 制約を満たすために 1 関数にまとめている。
// 順序は dropdown / search / toolbar / navigation の依存関係 (sendMenu 受け渡し) を維持。
const setupChromeAndNavigation = (deps: ResolvedBootstrapDeps): void => {
  setupModalsAndPanels(deps)
  const sendMenu = setupDropdownsAndKeyboard(deps)
  setupSearchWiring()
  setupToolbarButtons(sendMenu)
  setupNavigationRouting()
}

export const bootstrapReviewApp = (deps: BootstrapDeps): void => {
  bootstrapI18n()
  const online = isOnlineEdition()
  const effectiveDeps = resolveBootstrapDeps(deps, online)
  setupChromeAndNavigation(effectiveDeps)
  if (online) {
    attachOnlineRuntimeListeners()
  }
  launchBoot(effectiveDeps.documentLoader)
}

if (import.meta.vitest) {
  const { afterEach, beforeEach, describe, expect, it, vi } = import.meta.vitest

  const makeDeps = (): BootstrapDeps => ({
    buildExportPayload: vi.fn(),
    commentCountLabel: vi.fn((): string => '0 comments'),
    loadFromMarkdown: vi.fn(async (): Promise<void> => {
      // no-op
    }),
  })

  describe('bootstrapI18n', () => {
    // bootstrapI18n は launchBoot より先に同期完了する必要がある (paint 後 FOUC 解除の責任を持つ)。
    // 本 test は (1) i18n-pending class が必ず外れる (2) data-i18n 要素が翻訳される
    // (3) 連続呼び出しで例外を投げない (idempotent) の 3 不変条件を固定する。
    // bootstrapI18n は i18n-browser.ts の module-local currentLang と document の lang / class /
    // style / body innerHTML を mutate する。test 間で state がリークしないよう before/after で
    // 明示 reset する (vitest の file isolation は cross-test mutation を防がないため)。
    const resetBootstrapI18nState = (): void => {
      try {
        localStorage.removeItem('mdxg-redline.lang')
      } catch {
        // ignore (private mode 等)
      }
      document.documentElement.classList.remove(I18N_PENDING_CLASS)
      document.documentElement.removeAttribute('lang')
      document.documentElement.style.removeProperty('--ui-loading-text')
      document.body.innerHTML = ''
    }

    beforeEach(resetBootstrapI18nState)
    afterEach(resetBootstrapI18nState)

    it('i18n-pending class を解除する', () => {
      document.documentElement.classList.add(I18N_PENDING_CLASS)
      bootstrapI18n()
      expect(document.documentElement.classList.contains(I18N_PENDING_CLASS)).toBe(false)
    })

    it('static markup の data-i18n を翻訳する', () => {
      document.body.innerHTML = '<span data-i18n="toolbar.open"></span>'
      bootstrapI18n()
      // happy-dom の navigator.language は 'en-US' なので en 辞書が引かれる。
      const span = document.querySelector('span')
      if (!span) {
        throw new Error('span fixture missing')
      }
      expect(span.textContent).toBe('Open')
    })

    it('2 回呼んでも例外を投げない (idempotent)', () => {
      document.documentElement.classList.add(I18N_PENDING_CLASS)
      bootstrapI18n()
      expect(document.documentElement.classList.contains(I18N_PENDING_CLASS)).toBe(false)
      // 2 回目: 既に解除済みでも no-op で throw しない。再度 class を立てた状態でも解除される。
      document.documentElement.classList.add(I18N_PENDING_CLASS)
      expect((): void => bootstrapI18n()).not.toThrow()
      expect(document.documentElement.classList.contains(I18N_PENDING_CLASS)).toBe(false)
    })
  })

  describe('resolveBootstrapDeps', () => {
    it('online=false なら loadFromMarkdown は装飾されず透過する (standalone / embed への副作用ゼロ)', () => {
      const deps = makeDeps()
      const result = resolveBootstrapDeps(deps, false)
      expect(result.loadFromMarkdown).toBe(deps.loadFromMarkdown)
      expect(result.documentLoader).toBeDefined()
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
