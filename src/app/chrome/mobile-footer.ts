// スマホ (≤768px) 専用 footer バーと drawer 開閉の wiring。
// 設計の全体像と各判断は docs/feature-mobile-layout.md §3 / §4 Step 3 / §5.j〜§5.s を参照。
//
// drawer 開閉状態は <html> の mobile-*-open class で表現し、既存 *-closed (desktop grid 列幅) と
// 直交させる (§5.e)。背面 scroll lock は <body> の mobile-drawer-open + CSS が担う (§5.h)。
// 「開いた drawer 以外は常に inert」invariant は applyMobileInertState() に一元化する (§5.j-4)。

import { addOnCommentActivate } from '../comments/comments'

const MOBILE_MEDIA = '(max-width: 768px)'

// happy-dom はレイアウト計算をしないため、focusable 判定は static-modal.ts:133-140 と同じ
// 「要素が selector に match」基準を共有する。Tab trap 用に DOM 順の focusable 列挙だけ行えばよく、
// inert 配下は browser が :focusable から外す。
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

// drawer open 中に inert + aria-hidden を付与する背面 3 要素 (§5.j A 案)。.skip-link を含めないと
// DOM 先頭の focusable anchor が Tab 巡回に残り、焦点が drawer + footer 外へ抜ける。
const BACKGROUND_INERT_SELECTORS = ['.skip-link', '.app-header', '.doc-pane']

interface CloseOpts {
  restoreFocus?: boolean
}

// 切替時 (TOC→Comment) の close で focus を戻すと新 trigger の保存先がずれる (§5.j-2)。
// open 関数の冒頭で trigger を保存し、切替時の close は restoreFocus:false で focus を動かさない。
let lastTrigger: HTMLElement | null = null
let tabTrapListener: ((event: KeyboardEvent) => void) | null = null

const getPageNav = (): HTMLElement | null => document.getElementById('page-nav')
const getComments = (): HTMLElement | null => document.querySelector<HTMLElement>('.comments')
const getDocPane = (): HTMLElement | null => document.querySelector<HTMLElement>('.doc-pane')
const getFooter = (): HTMLElement | null => document.querySelector<HTMLElement>('.mobile-footer')
const getBackdrop = (): HTMLElement | null => document.getElementById('mobile-drawer-backdrop')
const getBtnToc = (): HTMLElement | null => document.getElementById('btn-mobile-toc')
const getBtnSearch = (): HTMLElement | null => document.getElementById('btn-mobile-search')
const getBtnComments = (): HTMLElement | null => document.getElementById('btn-mobile-comments')

export const isMobilePageNavOpen = (): boolean =>
  document.documentElement.classList.contains('mobile-page-nav-open')

export const isMobileCommentsOpen = (): boolean =>
  document.documentElement.classList.contains('mobile-comments-open')

export const isMobileDrawerOpen = (): boolean => isMobilePageNavOpen() || isMobileCommentsOpen()

const isMobileViewport = (): boolean => globalThis.matchMedia(MOBILE_MEDIA).matches

const activeHtmlElement = (): HTMLElement | null => {
  const active = document.activeElement
  if (active instanceof HTMLElement) {
    return active
  }
  return null
}

const setAria = (el: HTMLElement | null, name: string, value: string): void => {
  if (el) {
    el.setAttribute(name, value)
  }
}

const addClick = (el: HTMLElement | null, handler: (event: Event) => void): void => {
  if (el) {
    el.addEventListener('click', handler)
  }
}

const clickById = (id: string): void => {
  const el = document.getElementById(id)
  if (el) {
    el.click()
  }
}

const getFocusableElements = (root: HTMLElement): HTMLElement[] => [
  ...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
]

const toggleInert = (el: HTMLElement, on: boolean): void => {
  if (on) {
    el.setAttribute('inert', '')
    el.setAttribute('aria-hidden', 'true')
  } else {
    el.removeAttribute('inert')
    el.removeAttribute('aria-hidden')
  }
}

const removeDrawerInert = (drawer: HTMLElement | null): void => {
  if (drawer) {
    toggleInert(drawer, false)
  }
}

const setDrawerClosedInert = (drawer: HTMLElement | null, open: boolean): void => {
  if (drawer) {
    toggleInert(drawer, !open)
  }
}

// 「mobile かつ閉じた drawer」のみ inert を付ける単一責任 helper (§5.j-4)。
// desktop ブランチで両 drawer から確実に除去することで、desktop 進入時に残留 inert で
// 左右パネルが操作不能になる旧バグを根本回避する。
const applyMobileInertState = (): void => {
  const pageNav = getPageNav()
  const comments = getComments()
  if (!isMobileViewport()) {
    removeDrawerInert(pageNav)
    removeDrawerInert(comments)
    return
  }
  setDrawerClosedInert(pageNav, isMobilePageNavOpen())
  setDrawerClosedInert(comments, isMobileCommentsOpen())
}

const setBackgroundInert = (on: boolean): void => {
  for (const selector of BACKGROUND_INERT_SELECTORS) {
    const el = document.querySelector<HTMLElement>(selector)
    if (el) {
      toggleInert(el, on)
    }
  }
}

const focusFirstInDrawer = (drawer: HTMLElement | null): void => {
  if (!drawer) {
    return
  }
  const [first] = getFocusableElements(drawer)
  if (first) {
    first.focus()
  }
}

const getOpenDrawerElement = (): HTMLElement | null => {
  if (isMobilePageNavOpen()) {
    return getPageNav()
  }
  if (isMobileCommentsOpen()) {
    return getComments()
  }
  return null
}

interface OverlayTabContext {
  first: HTMLElement
  last: HTMLElement
  current: HTMLElement | null
  inside: boolean
  goingBackward: boolean
}

const buildOverlayTabContext = (
  event: KeyboardEvent,
  focusables: HTMLElement[]
): OverlayTabContext | null => {
  const [first] = focusables
  const last = focusables.at(-1)
  if (!first || !last) {
    return null
  }
  const current = activeHtmlElement()
  return {
    current,
    first,
    goingBackward: event.shiftKey,
    inside: current !== null && focusables.includes(current),
    last,
  }
}

// focus が drawer + footer 集合の外 (削除直後の <body> / modal close 後の .doc-pane 退避など) に
// ある場合は先頭へ救出する。単純な first/last 比較だけだと集合外から Tab で外へ抜ける (§5.j-5)。
const pickOverlayTabTarget = (ctx: OverlayTabContext): HTMLElement | null => {
  if (!ctx.inside) {
    return ctx.first
  }
  if (ctx.goingBackward && ctx.current === ctx.first) {
    return ctx.last
  }
  if (!ctx.goingBackward && ctx.current === ctx.last) {
    return ctx.first
  }
  return null
}

const wrapTabFocus = (event: KeyboardEvent, focusables: HTMLElement[]): void => {
  const ctx = buildOverlayTabContext(event, focusables)
  if (!ctx) {
    return
  }
  const target = pickOverlayTabTarget(ctx)
  if (target) {
    event.preventDefault()
    target.focus()
  }
}

// DOM 順は drawer → footer。focus を drawer 末尾 ↔ footer 先頭 / footer 末尾 ↔ drawer 先頭で wrap する。
const handleTabInMobileOverlay = (event: KeyboardEvent): void => {
  if (event.key !== 'Tab' || !isMobileDrawerOpen()) {
    return
  }
  const drawer = getOpenDrawerElement()
  const footer = getFooter()
  if (!drawer || !footer) {
    return
  }
  wrapTabFocus(event, [...getFocusableElements(drawer), ...getFocusableElements(footer)])
}

const registerTabTrap = (): void => {
  if (tabTrapListener) {
    return
  }
  tabTrapListener = handleTabInMobileOverlay
  document.addEventListener('keydown', tabTrapListener, true)
}

const unregisterTabTrap = (): void => {
  if (!tabTrapListener) {
    return
  }
  document.removeEventListener('keydown', tabTrapListener, true)
  tabTrapListener = null
}

// mobile overlay は drawer (左/右) または search-bar のいずれか 1 つだけ open (§5.m)。
// search-bar の close は wireSearch 経路 (#btn-search.click) に集約して二重実行を避ける。
const closeSearchBarIfOpen = (): void => {
  const bar = document.getElementById('search-bar')
  if (bar && bar.classList.contains('open')) {
    clickById('btn-search')
  }
}

const enterDrawerCommon = (openClass: string): void => {
  document.documentElement.classList.add(openClass)
  document.body.classList.add('mobile-drawer-open')
  setBackgroundInert(true)
  applyMobileInertState()
}

const leaveDrawerCommon = (openClass: string, oppositeOpen: () => boolean): void => {
  document.documentElement.classList.remove(openClass)
  if (!oppositeOpen()) {
    document.body.classList.remove('mobile-drawer-open')
  }
  setBackgroundInert(false)
  applyMobileInertState()
  unregisterTabTrap()
}

const restoreLastTrigger = (opts: CloseOpts): void => {
  if ((opts.restoreFocus ?? true) && lastTrigger) {
    lastTrigger.focus()
  }
}

export const closeMobilePageNav = (opts: CloseOpts = {}): void => {
  leaveDrawerCommon('mobile-page-nav-open', isMobileCommentsOpen)
  setAria(getBtnToc(), 'aria-expanded', 'false')
  restoreLastTrigger(opts)
}

export const closeMobileComments = (opts: CloseOpts = {}): void => {
  leaveDrawerCommon('mobile-comments-open', isMobilePageNavOpen)
  setAria(getBtnComments(), 'aria-expanded', 'false')
  restoreLastTrigger(opts)
}

export const closeMobileDrawers = (opts: CloseOpts = {}): void => {
  closeMobilePageNav(opts)
  closeMobileComments(opts)
}

export const openMobilePageNav = (trigger: HTMLElement): void => {
  lastTrigger = trigger
  if (isMobileCommentsOpen()) {
    closeMobileComments({ restoreFocus: false })
  }
  closeSearchBarIfOpen()
  enterDrawerCommon('mobile-page-nav-open')
  setAria(getBtnToc(), 'aria-expanded', 'true')
  focusFirstInDrawer(getPageNav())
  registerTabTrap()
}

export const openMobileComments = (trigger: HTMLElement): void => {
  lastTrigger = trigger
  if (isMobilePageNavOpen()) {
    closeMobilePageNav({ restoreFocus: false })
  }
  closeSearchBarIfOpen()
  enterDrawerCommon('mobile-comments-open')
  setAria(getBtnComments(), 'aria-expanded', 'true')
  focusFirstInDrawer(getComments())
  registerTabTrap()
}

const handleTocClick = (event: Event): void => {
  if (isMobilePageNavOpen()) {
    closeMobilePageNav()
    return
  }
  const trigger = event.currentTarget
  if (trigger instanceof HTMLElement) {
    openMobilePageNav(trigger)
  }
}

const handleCommentsClick = (event: Event): void => {
  if (isMobileCommentsOpen()) {
    closeMobileComments()
    return
  }
  const trigger = event.currentTarget
  if (trigger instanceof HTMLElement) {
    openMobileComments(trigger)
  }
}

const handleSearchClick = (): void => {
  closeMobileDrawers({ restoreFocus: false })
  clickById('btn-search')
}

const wireFooterButtons = (): void => {
  addClick(getBtnToc(), handleTocClick)
  addClick(getBtnComments(), handleCommentsClick)
  addClick(getBtnSearch(), handleSearchClick)
}

// #btn-mobile-search の aria-pressed は .search-bar.open を MutationObserver で監視して sync する。
// click 毎 toggle 近似だと f キー / Esc 経由の状態変化で sync が外れる (§3.3 / §5.d)。
const syncMobileSearchPressed = (): void => {
  const bar = document.getElementById('search-bar')
  const btn = getBtnSearch()
  if (!bar || !btn) {
    return
  }
  btn.setAttribute('aria-pressed', String(bar.classList.contains('open')))
}

const observeSearchBar = (): void => {
  const bar = document.getElementById('search-bar')
  if (!bar) {
    return
  }
  new MutationObserver(syncMobileSearchPressed).observe(bar, {
    attributeFilter: ['class'],
    attributes: true,
  })
  syncMobileSearchPressed()
}

// Comments drawer 内の .cmt-edit click は Edit modal を開く。drawer Tab trap と modal Tab trap の
// 衝突を避けるため、capture phase で先取りして drawer を閉じてから bubble phase の modal open に渡す
// (§5.s)。.cmt-del は即時削除なので対象外。focus 復元は comment-modal.ts の契約 (Step 5c) が担う。
const handleDrawerEditClick = (event: Event): void => {
  if (!isMobileCommentsOpen()) {
    return
  }
  const { target } = event
  if (target instanceof HTMLElement && target.closest('.cmt-edit, [data-edit]')) {
    closeMobileComments({ restoreFocus: true })
  }
}

const wireDrawerEditModalAutoClose = (): void => {
  const comments = getComments()
  if (comments) {
    comments.addEventListener('click', handleDrawerEditClick, true)
  }
}

const willBeHiddenOnMobileEntry = (el: HTMLElement): boolean =>
  el.closest('.page-nav, .comments') !== null ||
  el.closest('#btn-search, #btn-help, #status, #online-source') !== null ||
  el.closest('.page-nav-toggle-tab, .comments-toggle-tab') !== null

const willBeHiddenOnDesktopEntry = (el: HTMLElement): boolean => {
  // .page-scroll-fab は mobile 専用で desktop 進入時に display:none になる focusable button。
  // focus が乗ったまま breakpoint を跨ぐと不可視要素に取り残されるため hide 対象に含める (§5.j-3)。
  if (el.closest('.mobile-footer, .mobile-drawer-backdrop, .page-scroll-fab')) {
    return true
  }
  const root = document.documentElement
  if (root.classList.contains('comments-closed') && el.closest('.comments')) {
    return true
  }
  return root.classList.contains('page-nav-closed') && el.closest('.page-nav') !== null
}

const willBeHiddenAfterSwitch = (el: HTMLElement, toMobile: boolean): boolean => {
  if (toMobile) {
    return willBeHiddenOnMobileEntry(el)
  }
  return willBeHiddenOnDesktopEntry(el)
}

// breakpoint 切替後に hidden / inert になる要素に focus が残ると keyboard 操作不能になるため
// .doc-pane へ退避する (§5.j-3)。resize 元の active 要素は desktop で意味を持つとは限らないので
// restoreFocus はしない。
const escapeFocusBeforeBreakpointSwitch = (toMobile: boolean): void => {
  const active = activeHtmlElement()
  if (!active || active === document.body) {
    return
  }
  if (willBeHiddenAfterSwitch(active, toMobile)) {
    const docPane = getDocPane()
    if (docPane) {
      docPane.focus({ preventScroll: true })
    }
  }
}

const onBreakpointChange = (toMobile: boolean): void => {
  escapeFocusBeforeBreakpointSwitch(toMobile)
  closeMobileDrawers({ restoreFocus: false })
  applyMobileInertState()
}

// change event の matches は MQL.matches と一致するため、event を読まず MQL を直接参照する
// (in-source test が MediaQueryListEvent を構築せず matches を差し替えて発火できるようにするため)。
const wireBreakpointListener = (): void => {
  const mql = globalThis.matchMedia(MOBILE_MEDIA)
  mql.addEventListener('change', () => {
    onBreakpointChange(mql.matches)
  })
}

const focusDocPane = (): void => {
  const docPane = getDocPane()
  if (docPane) {
    docPane.focus({ preventScroll: true })
  }
}

// comment activation (同一/別ページ問わず) で comments drawer を自動 close し本文側へ focus を退避する
// (§5.r)。desktop / drawer 閉時は no-op。register は idempotent な wireMobileFooter 内で 1 回だけ走る。
const registerMobileCommentActivate = (): void => {
  addOnCommentActivate((): void => {
    if (!isMobileCommentsOpen()) {
      return
    }
    closeMobileComments({ restoreFocus: false })
    focusDocPane()
  })
}

const attachMobileFooterListeners = (): void => {
  wireFooterButtons()
  addClick(getBackdrop(), () => closeMobileDrawers())
  observeSearchBar()
  wireDrawerEditModalAutoClose()
  registerMobileCommentActivate()
  wireBreakpointListener()
  applyMobileInertState()
}

// idempotent gate は footer の dataset.wired で持つ。module-level boolean にすると in-source test が
// fixture を作り直すたびに再 wire できなくなるため、DOM ノード単位で判定する (§4 Step 3)。
export const wireMobileFooter = (): void => {
  const footer = getFooter()
  if (!footer || footer.dataset.wired === 'true') {
    return
  }
  footer.dataset.wired = 'true'
  attachMobileFooterListeners()
}

// in-source test 専用の純粋 helper 群。import.meta.vitest が false 評価される本番ビルドでは
// 参照側 (if ブロック) ごと dead code として tree-shake される (asset-loader.ts:1193 と同規約)。
const TEST_FIXTURE = `
  <a class="skip-link" id="skip-to-nav" href="#page-nav-list">skip</a>
  <header class="app-header">
    <button id="btn-search">s</button>
    <button id="btn-help">h</button>
    <span id="status">st</span>
    <span id="online-source">os</span>
  </header>
  <div class="search-bar" id="search-bar"><input id="search-input" /></div>
  <main class="layout">
    <aside class="page-nav" id="page-nav" tabindex="-1">
      <div id="page-nav-list"><a class="page-nav-link" href="#a">A</a></div>
    </aside>
    <section class="doc-pane" tabindex="-1"></section>
    <aside class="comments" tabindex="-1">
      <div id="cmt-list">
        <button id="btn-write">write</button>
        <div class="cmt-card" data-id="c1">
          <button class="cmt-edit" data-edit="c1">edit</button>
          <button class="cmt-del" data-del="c1">del</button>
        </div>
      </div>
    </aside>
  </main>
  <footer class="mobile-footer" role="group">
    <button id="btn-mobile-toc" aria-expanded="false" aria-controls="page-nav-list">t</button>
    <button id="btn-mobile-search" aria-pressed="false">s</button>
    <button id="btn-mobile-comments" aria-expanded="false" aria-controls="cmt-list">c</button>
  </footer>
  <button class="page-nav-toggle-tab" id="page-nav-toggle-tab">‹</button>
  <button class="comments-toggle-tab" id="comments-toggle-tab">›</button>
  <button class="page-scroll-fab" id="btn-page-scroll">v</button>
  <div class="mobile-drawer-backdrop" id="mobile-drawer-backdrop"></div>
`

const buildTestFixture = (): void => {
  document.documentElement.className = ''
  document.body.className = ''
  document.body.innerHTML = TEST_FIXTURE
}

const elById = (id: string): HTMLElement => {
  const node = document.getElementById(id)
  if (!node) {
    throw new Error(`fixture missing #${id}`)
  }
  return node
}

const elBySel = (selector: string): HTMLElement => {
  const node = document.querySelector<HTMLElement>(selector)
  if (!node) {
    throw new Error(`fixture missing ${selector}`)
  }
  return node
}

const dispatchTab = (shiftKey = false): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: 'Tab',
    shiftKey,
  })
  document.dispatchEvent(event)
  return event
}

const flushMutations = async (): Promise<void> =>
  new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0)
  })

const hasInertAndHidden = (el: HTMLElement): boolean =>
  el.hasAttribute('inert') && el.getAttribute('aria-hidden') === 'true'

interface FakeMql {
  matches: boolean
  listeners: (() => void)[]
  addEventListener: (type: string, cb: () => void) => void
  removeEventListener: (type: string, cb: () => void) => void
}

// happy-dom の matchMedia を差し替え、change listener を捕捉して任意に発火できるようにする。
// wire 側は () => onBreakpointChange(mql.matches) を登録するので、matches を書き換えてから
// listener を引数なしで呼べば resize が再現できる。
const makeFakeMql = (matches: boolean): FakeMql => {
  const listeners: (() => void)[] = []
  return {
    addEventListener: (_type: string, cb: () => void): void => {
      listeners.push(cb)
    },
    listeners,
    matches,
    removeEventListener: (_type: string, cb: () => void): void => {
      const idx = listeners.indexOf(cb)
      if (idx !== -1) {
        listeners.splice(idx, 1)
      }
    },
  }
}

if (import.meta.vitest) {
  const { afterEach, beforeEach, describe, expect, it, vi } = import.meta.vitest

  let fakeMql: FakeMql = makeFakeMql(false)

  const installMatchMedia = (matches: boolean): void => {
    fakeMql = makeFakeMql(matches)
    vi.stubGlobal('matchMedia', () => fakeMql)
  }

  const fireBreakpointChange = (matches: boolean): void => {
    fakeMql.matches = matches
    for (const cb of fakeMql.listeners) {
      cb()
    }
  }

  const wireForTest = (matches: boolean): void => {
    installMatchMedia(matches)
    wireMobileFooter()
  }

  const cleanup = (): void => {
    closeMobileDrawers({ restoreFocus: false })
    vi.unstubAllGlobals()
    document.documentElement.className = ''
    document.body.className = ''
    document.body.innerHTML = ''
  }

  beforeEach(buildTestFixture)
  afterEach(cleanup)

  describe('drawer 開閉 (footer ボタン / mutually exclusive)', () => {
    it('TOC ボタン click で mobile-page-nav-open が付き、再 click で外れる', () => {
      wireForTest(true)
      elById('btn-mobile-toc').click()
      expect(isMobilePageNavOpen()).toBe(true)
      elById('btn-mobile-toc').click()
      expect(isMobilePageNavOpen()).toBe(false)
    })

    it('Comment ボタン click で mobile-comments-open が付き、再 click で外れる', () => {
      wireForTest(true)
      elById('btn-mobile-comments').click()
      expect(isMobileCommentsOpen()).toBe(true)
      elById('btn-mobile-comments').click()
      expect(isMobileCommentsOpen()).toBe(false)
    })

    it('TOC 開中に Comment click で TOC が閉じ Comment が開く (§5.j)', () => {
      wireForTest(true)
      elById('btn-mobile-toc').click()
      elById('btn-mobile-comments').click()
      expect([isMobilePageNavOpen(), isMobileCommentsOpen()]).toEqual([false, true])
    })

    it('drawer open 中の body に mobile-drawer-open が付き、close で外れる', () => {
      wireForTest(true)
      elById('btn-mobile-toc').click()
      expect(document.body.classList.contains('mobile-drawer-open')).toBe(true)
      closeMobileDrawers()
      expect(document.body.classList.contains('mobile-drawer-open')).toBe(false)
    })
  })

  describe('lastTrigger / focus 復元 (§5.j-2)', () => {
    it('切替時 (TOC→Comment) は close 後 focus が Comment ボタンに戻る (旧 TOC ではない)', () => {
      wireForTest(true)
      elById('btn-mobile-toc').click()
      elById('btn-mobile-comments').click()
      closeMobileComments()
      expect(document.activeElement).toBe(elById('btn-mobile-comments'))
    })

    it('restoreFocus:false では focus が trigger に戻らない', () => {
      wireForTest(true)
      openMobilePageNav(elById('btn-mobile-toc'))
      closeMobilePageNav({ restoreFocus: false })
      expect(document.activeElement).not.toBe(elById('btn-mobile-toc'))
    })

    it('restoreFocus:true (default) では focus が trigger に戻る', () => {
      wireForTest(true)
      openMobilePageNav(elById('btn-mobile-toc'))
      closeMobilePageNav()
      expect(document.activeElement).toBe(elById('btn-mobile-toc'))
    })
  })

  describe('backdrop / search 委譲・相互排他 (§5.m)', () => {
    it('backdrop click で全 drawer が閉じる', () => {
      wireForTest(true)
      elById('btn-mobile-toc').click()
      elById('mobile-drawer-backdrop').click()
      expect(isMobileDrawerOpen()).toBe(false)
    })

    it('footer Search click は drawer を先に閉じてから #btn-search.click() を委譲する', () => {
      wireForTest(true)
      let openAtClick = true
      elById('btn-search').addEventListener('click', () => {
        openAtClick = isMobilePageNavOpen()
      })
      elById('btn-mobile-toc').click()
      elById('btn-mobile-search').click()
      expect([isMobilePageNavOpen(), openAtClick]).toEqual([false, false])
    })

    it('search-bar open 中に TOC click で search-bar が閉じ drawer が開く (§5.m 逆方向)', () => {
      wireForTest(true)
      elById('btn-search').addEventListener('click', () => {
        elById('search-bar').classList.toggle('open')
      })
      elById('search-bar').classList.add('open')
      elById('btn-mobile-toc').click()
      expect([elById('search-bar').classList.contains('open'), isMobilePageNavOpen()]).toEqual([
        false,
        true,
      ])
    })
  })

  describe('aria sync (§3.3 / §5.q)', () => {
    it('drawer open/close で aria-expanded が true/false に sync する', () => {
      wireForTest(true)
      elById('btn-mobile-toc').click()
      expect(elById('btn-mobile-toc').getAttribute('aria-expanded')).toBe('true')
      closeMobilePageNav()
      expect(elById('btn-mobile-toc').getAttribute('aria-expanded')).toBe('false')
    })

    it('aria-controls が drawer DOM の id (page-nav-list / cmt-list) を指す', () => {
      wireForTest(true)
      expect(elById('btn-mobile-toc').getAttribute('aria-controls')).toBe('page-nav-list')
      expect(elById('btn-mobile-comments').getAttribute('aria-controls')).toBe('cmt-list')
    })

    it('.search-bar.open の class 変化で aria-pressed が MutationObserver 経由で sync する', async () => {
      wireForTest(true)
      elById('search-bar').classList.add('open')
      await flushMutations()
      expect(elById('btn-mobile-search').getAttribute('aria-pressed')).toBe('true')
      elById('search-bar').classList.remove('open')
      await flushMutations()
      expect(elById('btn-mobile-search').getAttribute('aria-pressed')).toBe('false')
    })
  })

  describe('inert 単一責任管理 (§5.j-4)', () => {
    it('mobile 起動時の wire で両 drawer に inert + aria-hidden が付く', () => {
      wireForTest(true)
      expect([
        hasInertAndHidden(elById('page-nav')),
        hasInertAndHidden(elBySel('.comments')),
      ]).toEqual([true, true])
    })

    it('desktop 起動時の wire では両 drawer から inert が除去される', () => {
      wireForTest(false)
      expect([
        elById('page-nav').hasAttribute('inert'),
        elBySel('.comments').hasAttribute('inert'),
      ]).toEqual([false, false])
    })

    it('page-nav open 中は page-nav から inert が外れ comments には付く', () => {
      wireForTest(true)
      elById('btn-mobile-toc').click()
      expect([
        elById('page-nav').hasAttribute('inert'),
        hasInertAndHidden(elBySel('.comments')),
      ]).toEqual([false, true])
    })
  })

  describe('matchMedia change での state cleanup (§5.j-3)', () => {
    it('desktop 進入 (matches:false) で drawer / inert / open class がすべて除去される', () => {
      wireForTest(true)
      elById('btn-mobile-toc').click()
      fireBreakpointChange(false)
      expect([
        isMobileDrawerOpen(),
        document.body.classList.contains('mobile-drawer-open'),
        elBySel('.doc-pane').hasAttribute('inert'),
        elById('page-nav').hasAttribute('inert'),
      ]).toEqual([false, false, false, false])
    })

    it('mobile 進入 (matches:true) で両 drawer に inert + aria-hidden が付く', () => {
      wireForTest(false)
      fireBreakpointChange(true)
      expect([
        hasInertAndHidden(elById('page-nav')),
        hasInertAndHidden(elBySel('.comments')),
      ]).toEqual([true, true])
    })

    it('desktop で hidden になる mobile-footer に focus があると desktop 進入で .doc-pane に退避する', () => {
      wireForTest(true)
      elById('btn-mobile-search').focus()
      fireBreakpointChange(false)
      expect(document.activeElement).toBe(elBySel('.doc-pane'))
    })

    it('mobile で hidden になる header ボタンに focus があると mobile 進入で .doc-pane に退避する', () => {
      wireForTest(false)
      elById('btn-search').focus()
      fireBreakpointChange(true)
      expect(document.activeElement).toBe(elBySel('.doc-pane'))
    })

    it('desktop で hidden になる page-scroll FAB に focus があると desktop 進入で .doc-pane に退避する', () => {
      wireForTest(true)
      elById('btn-page-scroll').focus()
      fireBreakpointChange(false)
      expect(document.activeElement).toBe(elBySel('.doc-pane'))
    })
  })

  describe('背面 inert / Tab trap (§5.j / §5.j-5)', () => {
    it('open で背面 3 要素に inert + aria-hidden が付き main/footer/drawer には付かない', () => {
      wireForTest(true)
      elById('btn-mobile-toc').click()
      const bg = ['.skip-link', '.app-header', '.doc-pane'].map((sel) =>
        hasInertAndHidden(elBySel(sel))
      )
      const safe = [
        elBySel('.layout').hasAttribute('inert'),
        elBySel('.mobile-footer').hasAttribute('inert'),
      ]
      expect([bg, safe]).toEqual([
        [true, true, true],
        [false, false],
      ])
    })

    it('close で背面 3 要素から inert が除去される', () => {
      wireForTest(true)
      elById('btn-mobile-toc').click()
      closeMobilePageNav()
      const bg = ['.skip-link', '.app-header', '.doc-pane'].map((sel) =>
        elBySel(sel).hasAttribute('inert')
      )
      expect(bg).toEqual([false, false, false])
    })

    it('open 直後に drawer 内先頭 focusable に focus が移る', () => {
      wireForTest(true)
      elById('btn-mobile-toc').click()
      expect(document.activeElement).toBe(elBySel('.page-nav-link'))
    })

    it('footer 末尾から Tab で drawer 先頭へ wrap する', () => {
      wireForTest(true)
      elById('btn-mobile-toc').click()
      elById('btn-mobile-comments').focus()
      const event = dispatchTab()
      expect([event.defaultPrevented, document.activeElement]).toEqual([
        true,
        elBySel('.page-nav-link'),
      ])
    })

    it('集合外 (.doc-pane) に focus があるとき Tab で drawer 先頭へ救出する', () => {
      wireForTest(true)
      elById('btn-mobile-toc').click()
      elBySel('.doc-pane').focus()
      dispatchTab()
      expect(document.activeElement).toBe(elBySel('.page-nav-link'))
    })

    it('close で Tab trap が解除される (Tab が preventDefault されない)', () => {
      wireForTest(true)
      elById('btn-mobile-toc').click()
      closeMobilePageNav()
      expect(dispatchTab().defaultPrevented).toBe(false)
    })
  })

  describe('idempotent / backdrop / edit auto-close (§5.l / §5.s)', () => {
    it('wireMobileFooter を 2 回呼んでも click handler が重複しない', () => {
      wireForTest(true)
      wireMobileFooter()
      elById('btn-mobile-toc').click()
      expect(isMobilePageNavOpen()).toBe(true)
    })

    it('JS は backdrop の hidden 属性 / style.display に触らない', () => {
      wireForTest(true)
      elById('btn-mobile-toc').click()
      closeMobileDrawers()
      const backdrop = elById('mobile-drawer-backdrop')
      expect([backdrop.hasAttribute('hidden'), backdrop.style.display]).toEqual([false, ''])
    })

    it('Comments drawer 内 .cmt-edit click は drawer を自動 close する', () => {
      wireForTest(true)
      elById('btn-mobile-comments').click()
      elBySel('.cmt-edit').click()
      expect(isMobileCommentsOpen()).toBe(false)
    })

    it('.cmt-del click は drawer 自動 close 対象外 (即時削除 UX で drawer 残し)', () => {
      wireForTest(true)
      elById('btn-mobile-comments').click()
      elBySel('.cmt-del').click()
      expect(isMobileCommentsOpen()).toBe(true)
    })
  })
}
