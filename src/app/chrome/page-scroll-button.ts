// スマホ (≤768px) 専用の page-scroll FAB (画面左下)。タップで 1 画面下、上下フリックでその方向に
// 1 画面 (大きなフリックで 2 画面) スクロールし、左右フリックで TOC drawer / 本文 / Comments drawer
// の 3 状態を切り替える。読む面 (doc-pane) のネイティブスクロールと操作を分離する専用 affordance で、
// フリックとスクロールの競合を避けるのが狙い。

import {
  closeMobileDrawers,
  isMobileCommentsOpen,
  isMobilePageNavOpen,
  openMobileComments,
  openMobilePageNav,
} from './mobile-footer'

// 1 画面送りのたびに直前画面の最下部をこの比率ぶん残して文脈を繋ぐ (PageDown の慣行)。
const OVERLAP_RATIO = 0.12
// この px 未満の移動は tap 扱いにして click 経路 (= 下方向送り) に委ねる。
const FLICK_THRESHOLD_PX = 12
// この px 以上の縦フリックは「大きなフリック」として 2 画面送りに増幅する。
const BIG_FLICK_THRESHOLD_PX = 64
// ドラッグ中にアイコンを指へ追従させる量。生の移動量にこの係数を掛け、±ICON_MAX_PX に clamp する。
const ICON_FOLLOW_FACTOR = 0.5
const ICON_MAX_PX = 8

type ScrollDir = 'up' | 'down'
type PanelDir = 'left' | 'right'
type PanelState = 'toc' | 'main' | 'comments'

type FlickGesture =
  | { axis: 'vertical'; dir: ScrollDir; screens: number }
  | { axis: 'horizontal'; dir: PanelDir }

/** 1 画面送り量。`clientHeight * (1 - OVERLAP_RATIO)` を四捨五入する */
export const screenStep = (clientHeight: number): number =>
  Math.round(clientHeight * (1 - OVERLAP_RATIO))

const horizontalGesture = (dx: number): FlickGesture | null => {
  if (Math.abs(dx) < FLICK_THRESHOLD_PX) {
    return null
  }
  if (dx < 0) {
    return { axis: 'horizontal', dir: 'left' }
  }
  return { axis: 'horizontal', dir: 'right' }
}

const verticalScreens = (dy: number): number => {
  if (Math.abs(dy) >= BIG_FLICK_THRESHOLD_PX) {
    return 2
  }
  return 1
}

const verticalGesture = (dy: number): FlickGesture | null => {
  if (Math.abs(dy) < FLICK_THRESHOLD_PX) {
    return null
  }
  const screens = verticalScreens(dy)
  if (dy < 0) {
    return { axis: 'vertical', dir: 'up', screens }
  }
  return { axis: 'vertical', dir: 'down', screens }
}

/**
 * touch の移動量 (end - start) を flick に判定する。支配軸 (移動量の大きい軸) で縦 / 横を決め、
 * 閾値未満は null (= tap)。縦は BIG_FLICK_THRESHOLD_PX 以上で 2 画面送りに増幅する。
 * 同値 (斜め 45°) は従来挙動 (縦スクロール) を優先する。
 */
export const resolveFlickGesture = (dx: number, dy: number): FlickGesture | null => {
  if (Math.abs(dx) > Math.abs(dy)) {
    return horizontalGesture(dx)
  }
  return verticalGesture(dy)
}

/**
 * 横フリックによるパネル遷移。[TOC | 本文 | Comments] を横並びカルーセルと見なし、指の移動方向へ
 * ビューを送る (左フリック = 右隣の Comments へ、右フリック = 左隣の TOC へ)。端では留まる。
 * TOC が提供されない文書 (`html.has-pages` 無し) では 'toc' に進まず本文へ戻るだけにする。
 */
export const nextPanelState = (
  current: PanelState,
  dir: PanelDir,
  tocAvailable: boolean
): PanelState => {
  if (dir === 'left') {
    if (current === 'toc') {
      return 'main'
    }
    return 'comments'
  }
  if (current === 'comments') {
    return 'main'
  }
  if (tocAvailable) {
    return 'toc'
  }
  return 'main'
}

const clampIconOffset = (dy: number): number => {
  const raw = dy * ICON_FOLLOW_FACTOR
  if (raw < -ICON_MAX_PX) {
    return -ICON_MAX_PX
  }
  if (raw > ICON_MAX_PX) {
    return ICON_MAX_PX
  }
  return raw
}

interface IconDragStyle {
  rotate: string
  translate: string
}

/**
 * ドラッグ中のアイコン CSS。位置は指へ追従 (`translate`, 各軸 ±ICON_MAX_PX に clamp) し、向きは
 * flick 閾値を超えた指の移動方向へシェブロンを回す (「離せばこちらへ動く」を正直に示す)。
 * 上=180deg / 左=90deg / 右=-90deg、下・閾値未満は下向き (tap=下送りと一致)。
 * translate / rotate を個別プロパティに分けるのは、指を離した後の戻りで translate のみ transition
 * させ rotate は瞬時に切り替えるため (CSS 側で `transition: translate` のみ指定)。同一 transform
 * 文字列だと戻り時に rotate も補間されてスピンする。
 */
const dragRotate = (gesture: FlickGesture | null): string => {
  if (!gesture) {
    return '0deg'
  }
  if (gesture.axis === 'horizontal') {
    if (gesture.dir === 'left') {
      return '90deg'
    }
    return '-90deg'
  }
  if (gesture.dir === 'up') {
    return '180deg'
  }
  return '0deg'
}

export const iconDragStyle = (dx: number, dy: number): IconDragStyle => {
  const translate = `${clampIconOffset(dx)}px ${clampIconOffset(dy)}px`
  return { rotate: dragRotate(resolveFlickGesture(dx, dy)), translate }
}

const getDocPane = (): HTMLElement | null => document.querySelector<HTMLElement>('.doc-pane')

const directionSign = (dir: ScrollDir): number => {
  if (dir === 'up') {
    return -1
  }
  return 1
}

const prefersReducedMotion = (): boolean =>
  globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches

const scrollBehavior = (): ScrollBehavior => {
  if (prefersReducedMotion()) {
    return 'auto'
  }
  return 'smooth'
}

const scrollByScreen = (dir: ScrollDir, screens = 1): void => {
  const pane = getDocPane()
  if (!pane) {
    return
  }
  const delta = screenStep(pane.clientHeight) * screens * directionSign(dir)
  pane.scrollBy({ behavior: scrollBehavior(), top: delta })
}

const currentPanelState = (): PanelState => {
  if (isMobilePageNavOpen()) {
    return 'toc'
  }
  if (isMobileCommentsOpen()) {
    return 'comments'
  }
  return 'main'
}

const applyPanelState = (state: PanelState, trigger: HTMLElement): void => {
  if (state === 'toc') {
    openMobilePageNav(trigger)
    return
  }
  if (state === 'comments') {
    openMobileComments(trigger)
    return
  }
  closeMobileDrawers()
}

interface TouchPoint {
  clientX: number
  clientY: number
}

let touchStart: TouchPoint | null = null
let fabEl: HTMLElement | null = null
let iconEl: HTMLElement | null = null

const switchPanelByFlick = (dir: PanelDir): void => {
  if (!fabEl) {
    return
  }
  const current = currentPanelState()
  const tocAvailable = document.documentElement.classList.contains('has-pages')
  const next = nextPanelState(current, dir, tocAvailable)
  if (next !== current) {
    applyPanelState(next, fabEl)
  }
}

// ドラッグ中のアイコン CSS を inline で更新する。translate / rotate を個別に書くことで、
// 戻り時に translate のみ transition させ rotate は瞬時に切り替える (戻りスピン回避、§5.u)。
const applyIconDragStyle = (dx: number, dy: number): void => {
  if (!iconEl) {
    return
  }
  const style = iconDragStyle(dx, dy)
  iconEl.style.translate = style.translate
  iconEl.style.rotate = style.rotate
}

// ドラッグ終了 (touchend / touchcancel) でアイコンを中立へ戻す。is-dragging を外すと CSS の
// transition が効き、translate のみ滑らかに戻る (rotate は transition 対象外なので瞬時)。
const resetIcon = (): void => {
  if (fabEl) {
    fabEl.classList.remove('is-dragging')
  }
  if (iconEl) {
    iconEl.style.translate = ''
    iconEl.style.rotate = ''
  }
}

const onTouchStart = (event: TouchEvent): void => {
  const [touch] = event.touches
  touchStart = null
  if (touch) {
    touchStart = { clientX: touch.clientX, clientY: touch.clientY }
  }
  if (fabEl) {
    fabEl.classList.add('is-dragging')
  }
}

// アイコンを指へ追従させつつ、移動が flick 閾値を超えてからネイティブスクロール /
// pull-to-refresh / text 選択を抑止する。閾値未満の微小ジッタ tap では preventDefault せず、
// 後続の合成 click (= tap 経路) を温存する。
const onTouchMove = (event: TouchEvent): void => {
  if (!touchStart) {
    return
  }
  const [touch] = event.touches
  if (!touch) {
    return
  }
  const dx = touch.clientX - touchStart.clientX
  const dy = touch.clientY - touchStart.clientY
  applyIconDragStyle(dx, dy)
  if (Math.max(Math.abs(dx), Math.abs(dy)) >= FLICK_THRESHOLD_PX && event.cancelable) {
    event.preventDefault()
  }
}

const resolveFlick = (event: TouchEvent, start: TouchPoint): FlickGesture | null => {
  const [touch] = event.changedTouches
  if (!touch) {
    return null
  }
  return resolveFlickGesture(touch.clientX - start.clientX, touch.clientY - start.clientY)
}

const performFlick = (gesture: FlickGesture): void => {
  if (gesture.axis === 'horizontal') {
    switchPanelByFlick(gesture.dir)
    return
  }
  scrollByScreen(gesture.dir, gesture.screens)
}

const onTouchEnd = (event: TouchEvent): void => {
  if (!touchStart) {
    return
  }
  const gesture = resolveFlick(event, touchStart)
  touchStart = null
  resetIcon()
  if (!gesture) {
    return
  }
  // flick と判定したら後続の合成 click (= tap 経路) を抑止して二重スクロールを防ぐ。
  if (event.cancelable) {
    event.preventDefault()
  }
  performFlick(gesture)
}

const onTouchCancel = (): void => {
  touchStart = null
  resetIcon()
}

// タップ (= 下 1 画面送り) のフィードバックとして矢印を下へ軽く突いて戻す。指追従の inline
// translate / rotate とは別系統の一発再生にするため Web Animations API を使う (CSS class の
// 付け外し + reflow による再生し直しが不要で、連打でも素直に再生される)。
const playTapNudge = (): void => {
  if (!iconEl || prefersReducedMotion()) {
    return
  }
  iconEl.animate(
    [{ translate: '0 0' }, { offset: 0.45, translate: '0 6px' }, { translate: '0 0' }],
    { duration: 240, easing: 'ease' }
  )
}

// tap / mouse click / keyboard (Enter / Space) の共通経路。flick の touchend は preventDefault で
// click を抑止するため、ここに到達するのは tap とポインタ非タッチ操作のみ。
// コア機能 (スクロール) を先に実行し、装飾のナッジは後。万一 animate が投げてもスクロールは動く。
const onClick = (): void => {
  scrollByScreen('down')
  playTapNudge()
}

const registerTouchHandlers = (btn: HTMLElement): void => {
  btn.addEventListener('touchstart', onTouchStart, { passive: true })
  btn.addEventListener('touchmove', onTouchMove, { passive: false })
  btn.addEventListener('touchend', onTouchEnd, { passive: false })
  btn.addEventListener('touchcancel', onTouchCancel, { passive: true })
}

export const wirePageScrollButton = (): void => {
  const btn = document.getElementById('btn-page-scroll')
  if (!btn || btn.dataset.wired === 'true') {
    return
  }
  btn.dataset.wired = 'true'
  fabEl = btn
  iconEl = btn.querySelector<HTMLElement>('.btn-toolbar-icon')
  registerTouchHandlers(btn)
  btn.addEventListener('click', onClick)
}

// in-source test 専用 fixture helper。production ビルドでは参照側 (if ブロック) ごと dead code として
// tree-shake される (mobile-footer.ts と同規約で module scope に置く)。
// button にアイコン (.btn-toolbar-icon) を入れないのは意図的：入れると iconEl が非 null になり、
// click テストが playTapNudge 経由で iconEl.animate を呼ぶが happy-dom は Element.animate 未実装で
// 落ちる。アイコン有りの経路を検証する場合は animate を vi.fn() でスタブすること。
const buildPaneFixture = (): HTMLElement => {
  document.body.innerHTML = `
    <main class="layout"><section class="doc-pane"></section></main>
    <button id="btn-page-scroll"></button>
  `
  const pane = document.querySelector<HTMLElement>('.doc-pane')
  if (!pane) {
    throw new Error('fixture missing .doc-pane')
  }
  // happy-dom は clientHeight=0 / scrollBy 未実装のため双方を差し替える。
  Object.defineProperty(pane, 'clientHeight', { configurable: true, value: 600 })
  return pane
}

if (import.meta.vitest) {
  const { afterEach, describe, expect, it, vi } = import.meta.vitest

  describe('screenStep', () => {
    it('clientHeight から overlap (12%) を引いた送り量を四捨五入で返す', () => {
      // 800 * 0.88 = 704 / 667 * 0.88 = 586.96 → 587
      expect([screenStep(800), screenStep(667)]).toEqual([704, 587])
    })
  })

  describe('resolveFlickGesture', () => {
    it('縦方向 (|dy| >= 12 かつ dy 支配) は up / down の 1 画面送り', () => {
      expect([resolveFlickGesture(0, -12), resolveFlickGesture(4, 40)]).toEqual([
        { axis: 'vertical', dir: 'up', screens: 1 },
        { axis: 'vertical', dir: 'down', screens: 1 },
      ])
    })

    it('縦方向 |dy| >= 64 は 2 画面送りに増幅する', () => {
      expect([resolveFlickGesture(0, -64), resolveFlickGesture(0, 100)]).toEqual([
        { axis: 'vertical', dir: 'up', screens: 2 },
        { axis: 'vertical', dir: 'down', screens: 2 },
      ])
    })

    it('横方向 (|dx| >= 12 かつ dx 支配) は left / right のパネル切替', () => {
      expect([resolveFlickGesture(-12, 0), resolveFlickGesture(40, 4)]).toEqual([
        { axis: 'horizontal', dir: 'left' },
        { axis: 'horizontal', dir: 'right' },
      ])
    })

    it('閾値未満は null (tap として click 経路に委ねる)、斜め 45° は縦を優先する', () => {
      expect([
        resolveFlickGesture(0, 0),
        resolveFlickGesture(-11, 0),
        resolveFlickGesture(0, 11),
        resolveFlickGesture(20, -20),
      ]).toEqual([null, null, null, { axis: 'vertical', dir: 'up', screens: 1 }])
    })
  })

  describe('nextPanelState', () => {
    it('左フリックで toc→main→comments、comments では留まる', () => {
      expect([
        nextPanelState('toc', 'left', true),
        nextPanelState('main', 'left', true),
        nextPanelState('comments', 'left', true),
      ]).toEqual(['main', 'comments', 'comments'])
    })

    it('右フリックで comments→main→toc、toc では留まる', () => {
      expect([
        nextPanelState('comments', 'right', true),
        nextPanelState('main', 'right', true),
        nextPanelState('toc', 'right', true),
      ]).toEqual(['main', 'toc', 'toc'])
    })

    it('TOC 未提供 (has-pages 無し) では右フリックで toc に進まない', () => {
      expect([
        nextPanelState('main', 'right', false),
        nextPanelState('comments', 'right', false),
      ]).toEqual(['main', 'main'])
    })
  })

  describe('iconDragStyle', () => {
    it('上方向に閾値超過で rotate 180deg + 各軸 ±8px に clamp した translate', () => {
      // dy=-40 → -40*0.5=-20 → clamp -8 / 上向き反転
      expect(iconDragStyle(0, -40)).toEqual({ rotate: '180deg', translate: '0px -8px' })
    })

    it('下方向は rotate 0deg で translate のみ (clamp 適用)', () => {
      // dy=40 → 20 → clamp 8
      expect(iconDragStyle(0, 40)).toEqual({ rotate: '0deg', translate: '0px 8px' })
    })

    it('横方向は左 90deg / 右 -90deg に回す', () => {
      expect([iconDragStyle(-40, 0), iconDragStyle(40, 0)]).toEqual([
        { rotate: '90deg', translate: '-8px 0px' },
        { rotate: '-90deg', translate: '8px 0px' },
      ])
    })

    it('閾値未満は rotate 0deg で指へ追従 (offset = d * 0.5)', () => {
      expect(iconDragStyle(6, 10)).toEqual({ rotate: '0deg', translate: '3px 5px' })
    })
  })

  describe('wirePageScrollButton', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
      document.body.innerHTML = ''
    })

    const setup = (): { btn: HTMLElement; scrollBy: ReturnType<typeof vi.fn> } => {
      vi.stubGlobal('matchMedia', () => ({ matches: false }))
      const pane = buildPaneFixture()
      const scrollBy = vi.fn()
      Object.defineProperty(pane, 'scrollBy', { configurable: true, value: scrollBy })
      const btn = document.getElementById('btn-page-scroll')
      if (!btn) {
        throw new Error('fixture missing #btn-page-scroll')
      }
      wirePageScrollButton()
      return { btn, scrollBy }
    }

    it('click (tap) で 1 画面下へスクロールする (top 正)', () => {
      const { btn, scrollBy } = setup()
      btn.click()
      // 600 * 0.88 = 528
      expect(scrollBy).toHaveBeenCalledWith({ behavior: 'smooth', top: 528 })
    })

    it('2 回 wire しても click handler が重複しない (dataset.wired gate)', () => {
      const { btn, scrollBy } = setup()
      wirePageScrollButton()
      btn.click()
      expect(scrollBy).toHaveBeenCalledTimes(1)
    })
  })
}
