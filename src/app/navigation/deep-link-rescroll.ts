// online edition の deep-link (`?url=...#p:<page>__<heading>`) 初期ロード時に、後追い描画で
// ターゲット上方のレイアウトが伸縮してスクロール位置がズレる問題を補正するモジュール。
//
// online 版では markdown 本文は await されてから loadFromMarkdown 内で一度スクロールされるが、
// Shiki ハイライト / Mermaid SVG / KaTeX 数式 / 寸法未指定の画像は fire-and-forget の asset-loader
// 経由で **後から** 描画される。ターゲット heading より上のこれらが確定するとレイアウトが動き、
// 初回スクロール位置がそのまま取り残されて「アンカーが効かない」ように見える。
//
// 対策: 初期 deep-link のターゲットを arm しておき、`#doc` のレイアウトシフトを契機に、ユーザーが
// 未操作のときだけターゲットへ再スクロールする。`mdxg:*-ready` 等の asset イベントを契機にしないのは、
// それらが「素材ロード完了」時点で発火し、renderer の実 DOM 変異 (Shiki は rAF×2、Mermaid / KaTeX は
// after-paint / idle) より前に来るため。代わりに「シフト後」に発火する 4 シグナルを併用する:
// ResizeObserver (`#doc` 高さ変化)、MutationObserver (`#doc` subtree の子要素変化 = `.virtual-page` の
// min-height 内に収まり高さが変わらない見出し移動も拾う)、画像 `load`、document.fonts `loadingdone`
// (DOM 変異も #doc resize も伴わない web フォント reflow)。シフト源 (Shiki / Mermaid / KaTeX / 画像 /
// web フォント) を問わず「シフト後」に補正できる。
// ユーザーが wheel / touch / key /
// pointer で操作した時点、ブラウザの戻る/進む (`popstate`) で履歴移動した時点、または一定時間経過で
// disarm し、それ以降は補正しない (ユーザーのスクロール位置 / ナビゲーションを奪わない)。

import {
  type NavigateTarget,
  isPageHash,
  replaceHashFromActivePage,
  resolveTargetFromHash,
  setActivePageIndex,
  setPassiveHashMode,
} from '../document/pages'
import type { Page } from '../../core/page-split'
import { renderPageNavigation } from './page-navigation-render'
import { scrollToTargetAfterRender } from './navigation-orchestrator'

// ユーザーの能動操作シグナル。programmatic な scrollIntoView / scrollTo はこれらの input event を
// dispatch しないため、「ユーザーが自分でスクロール / 操作を始めた」ことの曖昧さのない signal として
// 使える (自前の補正スクロールが自分自身を disarm する誤判定が起きない)。
const USER_INTENT_EVENTS = ['wheel', 'touchmove', 'keydown', 'pointerdown']

// arm から補正を続ける上限時間 (ms)。低速回線で runtime import が数秒遅れても拾えるよう長めに取る。
// この window を過ぎたら disarm し、以降のシフトは補正しない (古い deep-link の取り残しを避ける)。
const RESCROLL_WINDOW_MS = 8000

let armedTarget: NavigateTarget | null = null
let disarmTimer: ReturnType<typeof setTimeout> | null = null
let listenersAttached = false
let framePending = false
let resizeObserver: ResizeObserver | null = null
let mutationObserver: MutationObserver | null = null

const scheduleFrame = (cb: () => void): void => {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    globalThis.requestAnimationFrame(cb)
    return
  }
  globalThis.setTimeout(cb, 0)
}

const reapply = (): void => {
  if (armedTarget === null) {
    return
  }
  // page-scroll-spy はレイアウトシフト由来のスクロールでも activePageIndex を動かす
  // (page-scroll-spy.ts:104)。再スクロール前に target page へ固定し直さないと、heading 経路が
  // scrollToTargetAfterRender 内で drift 先の activePage.slug を使って heading を探し、別ページ /
  // 不在 heading に飛ぶ。setActivePageIndex は idempotent で、不一致時のみ index を戻す。
  if (setActivePageIndex(armedTarget.pageIndex)) {
    // index を戻したときは TOC active 表示も target page へ戻す。reapply は scroll-spy の
    // notifyPageActivated を通らないため (setActivePageIndex 後に scroll-spy が再発火しても
    // changed=false で early return)、ここで明示的に再描画しないと TOC が drift 先のまま残る
    // (navigateToTarget の refreshActivePageView 相当)。
    renderPageNavigation()
  }
  // pageChanged を true 固定で渡し、heading 無し deep-link (`#p:5`) でも section 先頭へ寄せ直す。
  scrollToTargetAfterRender(armedTarget, true, 'auto')
  // arm 中の scroll-spy は passive replace で `#p:<page>` を書く (heading なし)。補正で page を
  // 戻したこの時点で heading 込みの hash を replace で書き戻し、共有可能な URL を維持する。scroll-spy
  // も reapply も replace なので履歴は積み増さない。一致時は replaceHashFromActivePage 側のガードで no-op。
  replaceHashFromActivePage(armedTarget.headingSlug)
}

// 複数 ready event / 多数の画像 load が短時間に連続しても、再スクロールは 1 frame に 1 回へ束ねる。
// framePending は frame callback と disarm の両方で倒すため、stuck flag で以降の arm が無視される事故を防ぐ。
const onSignal = (): void => {
  if (armedTarget === null || framePending) {
    return
  }
  framePending = true
  scheduleFrame((): void => {
    framePending = false
    reapply()
  })
}

const disconnectObservers = (): void => {
  if (resizeObserver !== null) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (mutationObserver !== null) {
    mutationObserver.disconnect()
    mutationObserver = null
  }
}

// FontFaceSet (`document.fonts`) は古い環境 / happy-dom で不在のため、optional 型で受けて runtime
// guard を成立させる (lib.dom の型は常在前提)。
const getFontFaceSet = (): FontFaceSet | undefined => document.fonts

// web フォント読み込み完了後の reflow を拾う `loadingdone` listener を付け外しする。KaTeX 等の
// フォントが math 描画 (DOM 変異) の後に届くと、DOM を変えずに reflow して見出しが動くが、
// `.virtual-page` の min-height 内なら #doc も resize しないため observer 経路で取りこぼす。
const setFontsListener = (op: 'add' | 'remove'): void => {
  const fonts = getFontFaceSet()
  if (typeof fonts === 'undefined') {
    return
  }
  if (op === 'add') {
    // eslint-disable-next-line no-use-before-define -- onSignal は前方で定義済み (helper 順序の都合)
    fonts.addEventListener('loadingdone', onSignal)
    return
  }
  // eslint-disable-next-line no-use-before-define -- 同上
  fonts.removeEventListener('loadingdone', onSignal)
}

const detachListeners = (): void => {
  if (!listenersAttached || typeof document === 'undefined') {
    return
  }
  listenersAttached = false
  disconnectObservers()
  // eslint-disable-next-line no-use-before-define -- onSignal は本 cleanup で外す listener 参照。代入後にのみ実行され安全
  document.removeEventListener('load', onSignal, { capture: true })
  setFontsListener('remove')
  for (const ev of USER_INTENT_EVENTS) {
    // eslint-disable-next-line no-use-before-define -- disarm は本関数を呼ぶ cleanup で相互再帰。代入後にのみ実行され安全
    document.removeEventListener(ev, disarm, { capture: true })
  }
  // eslint-disable-next-line no-use-before-define -- 上と同じ相互再帰の cleanup 自己参照
  globalThis.removeEventListener('popstate', disarm)
  // eslint-disable-next-line no-use-before-define -- 同上
  globalThis.removeEventListener('hashchange', disarm)
}

const disarm = (): void => {
  armedTarget = null
  // arm 一式 (armedTarget / framePending / timer / listener / passiveHashMode) を初期状態へ戻す
  // 単一の teardown。armDeepLinkRescroll の再 arm 起点でもこれを通すことで、予約済み rAF が走る
  // 前に再 arm されても末尾 onSignal() が framePending===true で握り潰されない (古い rAF callback は
  // framePending を戻すだけで、reapply は armedTarget===null / 新 target のどちらでも安全)。
  framePending = false
  if (disarmTimer !== null) {
    globalThis.clearTimeout(disarmTimer)
    disarmTimer = null
  }
  // scroll-spy の受動的 hash 同期を通常の push に戻す (arm 中だけ replace にしていた)。
  setPassiveHashMode('push')
  detachListeners()
}

// `#doc` のレイアウトシフトを 2 種の observer で観測する。
// - ResizeObserver: `#doc` 全体の高さ変化 (min-height を超える伸縮 / web フォント reflow) を捕捉。
// - MutationObserver: `#doc` subtree の子要素変化を捕捉。`.virtual-page` には min-height
//   (ほぼ 1 画面) があり、ページ内容がその範囲に収まる間は Shiki / Mermaid / KaTeX が見出しより上を
//   描き替えても `#doc` 高さが変わらず ResizeObserver が発火しない。DOM 変異を直接見ることで、
//   同一ページ内 deep-link の見出し移動も拾う。
// 画像 load は DOM を変異させず高さも min-height 内なら変えないため、attachListeners 側の
// capture `load` listener で別途拾う。要素不在 / 非対応環境では observer を張らず arm 時の 1 度きり補正に倒す。
const observeDocShifts = (): void => {
  const doc = document.getElementById('doc')
  if (doc === null) {
    return
  }
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver((): void => onSignal())
    resizeObserver.observe(doc)
  }
  if (typeof MutationObserver !== 'undefined') {
    mutationObserver = new MutationObserver((): void => onSignal())
    mutationObserver.observe(doc, { childList: true, subtree: true })
  }
}

// arm 中だけ observer / listener を張り、disarm (ユーザー操作 / 戻る進む / window 経過 / 非対象
// ロード) で必ず外す。session 全体に observer や listener を残さず leak を避ける。
const attachListeners = (): void => {
  if (listenersAttached || typeof document === 'undefined') {
    return
  }
  listenersAttached = true
  observeDocShifts()
  // 画像 load は bubble しないため capture で拾う。min-height 内の画像読み込みは observer 経路で
  // 取りこぼすため、ここで明示的に補う。
  document.addEventListener('load', onSignal, { capture: true })
  // web フォント reflow (DOM 変異も #doc resize も伴わない) を loadingdone で拾う。
  setFontsListener('add')
  for (const ev of USER_INTENT_EVENTS) {
    document.addEventListener(ev, disarm, { capture: true, passive: true })
  }
  // 外部からのナビゲーションを user-intent として扱い disarm する:
  // - popstate: ブラウザ戻る/進む (history トラバース)。
  // - hashchange: アドレスバーでの fragment 直接編集 / 本文内 anchor リンククリック。
  // arm 中の自前 hash 書き込み (scroll-spy passive replace / reapply) は replaceState なので
  // hashchange を発火しない。よって arm 中の hashchange は外部由来に限定でき、disarm の確実な
  // シグナルになる (これを入れないと、直接編集後に画像/フォント描画で旧ターゲットへ戻されて URL も
  // 上書きされる)。
  globalThis.addEventListener('popstate', disarm)
  globalThis.addEventListener('hashchange', disarm)
}

/**
 * page 0 先頭 (heading 無し) への deep-link は補正不要 (上方にコンテンツが無くシフトの影響を
 * 受けない)。それ以外 (heading 指定 or 非先頭 page) はターゲット上方のシフトでズレうるため対象。
 */
export const isRescrollWorthyTarget = (target: NavigateTarget): boolean =>
  target.headingSlug !== null || target.pageIndex !== 0

/** 現在の `location.hash` から arm すべきターゲットを解決する。対象外なら null。 */
const resolveArmTarget = (): NavigateTarget | null => {
  const { hash } = globalThis.location
  if (!isPageHash(hash)) {
    return null
  }
  const target = resolveTargetFromHash(hash)
  if (!isRescrollWorthyTarget(target)) {
    return null
  }
  return target
}

const startDisarmTimer = (): void => {
  if (disarmTimer !== null) {
    globalThis.clearTimeout(disarmTimer)
  }
  disarmTimer = globalThis.setTimeout(disarm, RESCROLL_WINDOW_MS)
}

/**
 * 初期ロード後に呼び、現在の `location.hash` が補正対象の deep-link なら再スクロール補正を arm する。
 * page hash でない / 補正不要なターゲットなら disarm する (前文書の arm が残っていれば確実に解除)。
 * 連続文書ロードでは最新の arm で armedTarget / window timer がリセットされる。
 */
export const armDeepLinkRescroll = (): void => {
  const target = resolveArmTarget()
  // 前 arm を必ず解除してから組み直す。連続文書ロードでの再 arm でも framePending / timer /
  // listener / passiveHashMode が初期化され、ResizeObserver も現在の `#doc` へ貼り直される。
  // (`#doc` は通常 innerHTML 差し替えで identity を保つが、それに依存せず将来の要素置換にも耐える。)
  disarm()
  if (target === null) {
    return
  }
  armedTarget = target
  // arm 中は scroll-spy の受動的 hash 同期を replace にし、シフト由来の topmost 変化が履歴を
  // 積み増さないようにする (drift エントリで「戻る」が汚染されるのを根本で防ぐ)。
  setPassiveHashMode('replace')
  attachListeners()
  startDisarmTimer()
  // arm 時点で既にシフト済みの分を 1 度補正する (ResizeObserver 非対応環境でも初期ズレを直す)。
  onSignal()
}

export const isArmedForTest = (): boolean => armedTarget !== null

export const triggerReapplyForTest = (): void => {
  reapply()
}

export const resetDeepLinkRescrollForTest = (): void => {
  disarm()
}

// テスト用の最小 Page 生成。pages.ts の dummyPage と同じく module scope に置き (vite が test ブロックを
// dead-code 除去するため production bundle には残らない)、reapply の page 解決に必要な slug / index のみ
// 上書きできるようにする。
const dummyPageForTest = (overrides: Partial<Page> = {}): Page => ({
  ancestorHeadingPath: [],
  depth: 1,
  headings: [],
  index: 0,
  markdown: '',
  slug: 'page',
  sourceLineEnd: 1,
  sourceLineStart: 1,
  title: 'Page',
  ...overrides,
})

// テスト用に `<div id="doc">` を body へ追加して返す。連続ロードで `#doc` が差し替わる状況の再現に使う。
const appendDocForTest = (): HTMLElement => {
  const el = document.createElement('div')
  el.id = 'doc'
  document.body.append(el)
  return el
}

const appendElementForTest = (tag: string, id: string): HTMLElement => {
  const el = document.createElement(tag)
  el.id = id
  document.body.append(el)
  return el
}

const removeElementForTest = (id: string): void => {
  const el = document.getElementById(id)
  if (el !== null) {
    el.remove()
  }
}

// テストで hash をセット / クリアする。`location.hash =` 代入は新規 history entry を push し、push
// セマンティクスの検証 (history.length) を壊すため replaceState で揃える。なお happy-dom は hash を
// 変える replaceState でも hashchange を 1 つ async で queue するため、arm 前に flushMacrotasks で
// 流し切らないと arm 中に届いて disarm する (setHashAndArmForTest 参照)。
const setHashForTest = (hash: string): void => {
  globalThis.history.replaceState(null, '', hash)
}

const clearHashForTest = (): void => {
  globalThis.history.replaceState(null, '', globalThis.location.pathname)
}

// queue 済みの macrotask (happy-dom が遅延発火する hashchange を含む) を 1 巡分流し切る。
const flushMacrotasks = async (): Promise<void> =>
  new Promise((resolve): void => {
    globalThis.setTimeout(resolve, 0)
  })

// hash を deep-link 想定でセットし、それが queue した hashchange を arm 前に流してから arm する。
// 実環境では deep-link hash は初期 URL に既存で hashchange を出さないため、この前処理で実環境に揃える。
const setHashAndArmForTest = async (hash: string): Promise<void> => {
  setHashForTest(hash)
  await flushMacrotasks()
  armDeepLinkRescroll()
}

interface SpyLike {
  mock: { calls: unknown[][] }
}

// spy が最後に observe した要素 (第 1 引数) を取り出す。boot.ts の getFirstFetchUrl と同じ pattern。
// 呼び出し側は observe 済みを前提にするため空配列ガードは置かない。
const lastObservedTarget = (spy: SpyLike): unknown => {
  const { calls } = spy.mock
  return calls[calls.length - 1][0]
}

if (import.meta.vitest) {
  const { describe, expect, it, beforeEach, afterEach, vi } = import.meta.vitest
  const { state } = await import('../state/app-state')
  const { syncPassiveHashFromActivePage } = await import('../document/pages')

  describe('isRescrollWorthyTarget', () => {
    it('page 0 + heading 無しは補正不要 (false)', () => {
      expect(isRescrollWorthyTarget({ headingSlug: null, pageIndex: 0 })).toBe(false)
    })

    it('heading 指定があれば対象 (true)', () => {
      expect(isRescrollWorthyTarget({ headingSlug: 'heading-3', pageIndex: 0 })).toBe(true)
    })

    it('非先頭 page なら heading 無しでも対象 (true)', () => {
      expect(isRescrollWorthyTarget({ headingSlug: null, pageIndex: 5 })).toBe(true)
    })
  })

  describe('armDeepLinkRescroll', () => {
    afterEach(() => {
      resetDeepLinkRescrollForTest()
      globalThis.location.hash = ''
    })

    it('page hash でない hash では arm しない', () => {
      globalThis.location.hash = '#some-heading'
      armDeepLinkRescroll()
      expect(isArmedForTest()).toBe(false)
    })

    it('空 hash では arm しない', () => {
      globalThis.location.hash = ''
      armDeepLinkRescroll()
      expect(isArmedForTest()).toBe(false)
    })

    it('slug 解決不能かつ heading 無しの page hash は page 0 フォールバックで arm しない', () => {
      globalThis.location.hash = '#p:missing'
      armDeepLinkRescroll()
      expect(isArmedForTest()).toBe(false)
    })

    it('heading 付き page hash は (slug 不一致でも heading が残るため) arm する', () => {
      globalThis.location.hash = '#p:missing__heading-3'
      armDeepLinkRescroll()
      expect(isArmedForTest()).toBe(true)
    })

    it('popstate (戻る/進む) で disarm する', () => {
      globalThis.location.hash = '#p:missing__heading-3'
      armDeepLinkRescroll()
      expect(isArmedForTest()).toBe(true)
      globalThis.dispatchEvent(new Event('popstate'))
      expect(isArmedForTest()).toBe(false)
    })

    it('document 入力 (wheel) で disarm する', () => {
      globalThis.location.hash = '#p:missing__heading-3'
      armDeepLinkRescroll()
      expect(isArmedForTest()).toBe(true)
      document.dispatchEvent(new Event('wheel'))
      expect(isArmedForTest()).toBe(false)
    })

    it('hashchange (アドレスバー直接編集 / anchor クリック) で disarm する', () => {
      globalThis.location.hash = '#p:missing__heading-3'
      armDeepLinkRescroll()
      expect(isArmedForTest()).toBe(true)
      globalThis.dispatchEvent(new Event('hashchange'))
      expect(isArmedForTest()).toBe(false)
    })
  })

  describe('reapply: activePageIndex の再固定 (scroll-spy drift 対策)', () => {
    const savedPages = state.pages
    const savedActiveIndex = state.activePageIndex

    beforeEach(() => {
      // heading 経路の scrollToHeading は #doc を、renderPageNavigation は #page-nav-list を要求する
      // (いずれも要素不在なら no-op)。
      appendDocForTest()
      appendElementForTest('ul', 'page-nav-list')
      state.pages = [
        dummyPageForTest({ index: 0, slug: 'a' }),
        dummyPageForTest({ index: 1, slug: 'b' }),
      ]
    })

    afterEach(() => {
      resetDeepLinkRescrollForTest()
      clearHashForTest()
      state.pages = savedPages
      state.activePageIndex = savedActiveIndex
      removeElementForTest('doc')
      removeElementForTest('page-nav-list')
      // document.fonts stub を後始末 (happy-dom には本来存在しない)
      Reflect.deleteProperty(globalThis.document, 'fonts')
    })

    it('drift した activePageIndex を arm 済み target.pageIndex へ戻す', () => {
      state.activePageIndex = 1
      setHashForTest('#p:b')
      armDeepLinkRescroll()
      // scroll-spy がレイアウトシフト由来のスクロールで先頭ページへ巻き戻した状況を模す
      state.activePageIndex = 0
      triggerReapplyForTest()
      expect(state.activePageIndex).toBe(1)
    })

    it('reapply で TOC active 表示も target page へ戻す', () => {
      state.activePageIndex = 1
      setHashForTest('#p:b')
      armDeepLinkRescroll()
      // scroll-spy が drift 先 page を active にして TOC を描き直した状況を模す
      state.activePageIndex = 0
      renderPageNavigation()
      triggerReapplyForTest()
      const activeLink = document.querySelector('#page-nav-list a[aria-current="page"]')
      expect(activeLink instanceof HTMLElement && activeLink.dataset.slug).toBe('p:b')
    })

    it('#doc の DOM 変異 (min-height 内シフト相当) で MutationObserver 経由の再補正が走る', async () => {
      state.activePageIndex = 1
      await setHashAndArmForTest('#p:b')
      await new Promise((resolve): void => {
        globalThis.setTimeout(resolve, 20)
      })
      // scroll-spy が drift させた状態で、#doc 高さを変えずに子要素を足す (min-height 内シフト相当)
      state.activePageIndex = 0
      const docEl = document.getElementById('doc')
      if (docEl !== null) {
        docEl.append(document.createElement('p'))
      }
      await new Promise((resolve): void => {
        globalThis.setTimeout(resolve, 30)
      })
      expect(state.activePageIndex).toBe(1)
    })

    it('web フォント reflow (document.fonts loadingdone) で再補正が走る', async () => {
      // happy-dom に FontFaceSet は無いため EventTarget で stub する
      const fakeFonts = new EventTarget()
      Object.defineProperty(document, 'fonts', { configurable: true, value: fakeFonts })
      state.activePageIndex = 1
      await setHashAndArmForTest('#p:b')
      await new Promise((resolve): void => {
        globalThis.setTimeout(resolve, 20)
      })
      // フォント読み込み完了の reflow (DOM 変異も #doc resize も無い) を loadingdone で再現
      state.activePageIndex = 0
      fakeFonts.dispatchEvent(new Event('loadingdone'))
      await new Promise((resolve): void => {
        globalThis.setTimeout(resolve, 30)
      })
      expect(state.activePageIndex).toBe(1)
    })

    it('arm 中は scroll-spy の passive 同期も reapply も履歴を積まず、heading 込み hash を維持する', () => {
      state.activePageIndex = 1
      setHashForTest('#p:b__h3')
      const historyLenAtArm = globalThis.history.length
      armDeepLinkRescroll()
      // scroll-spy がシフトで drift 先 page を topmost と判定して passive 同期する状況を実関数で再現
      // (直接 location.hash 代入はせず、arm が replace モードに切り替えた経路を通す)。drift で hash は
      // 一旦 `#p:a` に劣化するが、reapply が heading 込み `#p:b__h3` を replace で書き戻す。
      state.activePageIndex = 0
      syncPassiveHashFromActivePage()
      triggerReapplyForTest()
      expect(state.activePageIndex).toBe(1)
      expect(globalThis.location.hash).toBe('#p:b__h3')
      // arm 全体 (scroll-spy passive replace + reapply replace) で履歴は不変。push なら drift 先
      // #p:a が「戻る」で到達可能になってしまう。
      expect(globalThis.history.length).toBe(historyLenAtArm)
    })

    it('disarm で passive 同期が push に戻る', () => {
      state.activePageIndex = 1
      setHashForTest('#p:b__h3')
      armDeepLinkRescroll()
      globalThis.dispatchEvent(new Event('popstate'))
      globalThis.location.hash = '#p:a'
      state.activePageIndex = 1
      const len0 = globalThis.history.length
      syncPassiveHashFromActivePage()
      expect(globalThis.location.hash).toBe('#p:b')
      expect(globalThis.history.length).toBe(len0 + 1)
    })
  })

  describe('連続ロード時の ResizeObserver 再接続', () => {
    const savedPages = state.pages
    const savedActiveIndex = state.activePageIndex
    // happy-dom の実 ResizeObserver の prototype を spy する (constructor は本物のまま newable に保つ)。
    // happy-dom はレイアウト変化で発火しないため、observe 対象 / disconnect 配線だけを検証する。
    let observeSpy: SpyLike = { mock: { calls: [] } }
    let disconnectSpy: SpyLike = { mock: { calls: [] } }

    beforeEach(() => {
      observeSpy = vi.spyOn(globalThis.ResizeObserver.prototype, 'observe')
      disconnectSpy = vi.spyOn(globalThis.ResizeObserver.prototype, 'disconnect')
      state.pages = [
        dummyPageForTest({ index: 0, slug: 'a' }),
        dummyPageForTest({ index: 1, slug: 'b' }),
      ]
    })

    afterEach(() => {
      resetDeepLinkRescrollForTest()
      globalThis.location.hash = ''
      vi.restoreAllMocks()
      state.pages = savedPages
      state.activePageIndex = savedActiveIndex
      const docEl = document.getElementById('doc')
      if (docEl !== null) {
        docEl.remove()
      }
    })

    it('再 arm で旧 observer を切り、差し替わった #doc を observe し直す', () => {
      const doc1 = appendDocForTest()
      state.activePageIndex = 1
      globalThis.location.hash = '#p:b__h3'
      armDeepLinkRescroll()
      expect(lastObservedTarget(observeSpy)).toBe(doc1)
      // リロードで #doc 要素自体が差し替わったケースを模す
      doc1.remove()
      const doc2 = appendDocForTest()
      armDeepLinkRescroll()
      expect(disconnectSpy.mock.calls.length).toBeGreaterThanOrEqual(1)
      expect(lastObservedTarget(observeSpy)).toBe(doc2)
    })
  })
}
