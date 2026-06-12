// スマホ (≤768px) 専用の page-scroll FAB (画面左下)。タップで 1 画面下、上下フリックでその方向に
// 1 画面スクロールする。読む面 (doc-pane) のネイティブスクロールと操作を分離する専用 affordance で、
// フリックとスクロールの競合を避けるのが狙い。

// 1 画面送りのたびに直前画面の最下部をこの比率ぶん残して文脈を繋ぐ (PageDown の慣行)。
const OVERLAP_RATIO = 0.12
// この px 未満の縦移動は tap 扱いにして click 経路 (= 下方向送り) に委ねる。
const FLICK_THRESHOLD_PX = 12

type ScrollDir = 'up' | 'down'

/** 1 画面送り量。`clientHeight * (1 - OVERLAP_RATIO)` を四捨五入する */
export const screenStep = (clientHeight: number): number =>
  Math.round(clientHeight * (1 - OVERLAP_RATIO))

/** touch の縦移動量 (endY - startY) を flick 方向に判定する。閾値未満は null (= tap) */
export const flickDirection = (dy: number): ScrollDir | null => {
  if (dy <= -FLICK_THRESHOLD_PX) {
    return 'up'
  }
  if (dy >= FLICK_THRESHOLD_PX) {
    return 'down'
  }
  return null
}

const getDocPane = (): HTMLElement | null => document.querySelector<HTMLElement>('.doc-pane')

const directionSign = (dir: ScrollDir): number => {
  if (dir === 'up') {
    return -1
  }
  return 1
}

const scrollBehavior = (): ScrollBehavior => {
  if (globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return 'auto'
  }
  return 'smooth'
}

const scrollByScreen = (dir: ScrollDir): void => {
  const pane = getDocPane()
  if (!pane) {
    return
  }
  const delta = screenStep(pane.clientHeight) * directionSign(dir)
  pane.scrollBy({ behavior: scrollBehavior(), top: delta })
}

let touchStartY: number | null = null

const onTouchStart = (event: TouchEvent): void => {
  const [touch] = event.touches
  touchStartY = null
  if (touch) {
    touchStartY = touch.clientY
  }
}

// 縦移動が flick 閾値を超えてからネイティブスクロール / pull-to-refresh / text 選択を抑止する。
// 閾値未満の微小ジッタを伴う tap では preventDefault せず、後続の合成 click (= tap 経路) を温存する。
const onTouchMove = (event: TouchEvent): void => {
  if (touchStartY === null) {
    return
  }
  const [touch] = event.touches
  if (!touch || Math.abs(touch.clientY - touchStartY) < FLICK_THRESHOLD_PX) {
    return
  }
  if (event.cancelable) {
    event.preventDefault()
  }
}

const resolveFlickDir = (event: TouchEvent, startY: number): ScrollDir | null => {
  const [touch] = event.changedTouches
  if (!touch) {
    return null
  }
  return flickDirection(touch.clientY - startY)
}

const onTouchEnd = (event: TouchEvent): void => {
  if (touchStartY === null) {
    return
  }
  const dir = resolveFlickDir(event, touchStartY)
  touchStartY = null
  if (!dir) {
    return
  }
  // flick と判定したら後続の合成 click (= tap 経路) を抑止して二重スクロールを防ぐ。
  if (event.cancelable) {
    event.preventDefault()
  }
  scrollByScreen(dir)
}

// tap / mouse click / keyboard (Enter / Space) の共通経路。flick の touchend は preventDefault で
// click を抑止するため、ここに到達するのは tap とポインタ非タッチ操作のみ。
const onClick = (): void => {
  scrollByScreen('down')
}

export const wirePageScrollButton = (): void => {
  const btn = document.getElementById('btn-page-scroll')
  if (!btn || btn.dataset.wired === 'true') {
    return
  }
  btn.dataset.wired = 'true'
  btn.addEventListener('touchstart', onTouchStart, { passive: true })
  btn.addEventListener('touchmove', onTouchMove, { passive: false })
  btn.addEventListener('touchend', onTouchEnd, { passive: false })
  btn.addEventListener('click', onClick)
}

// in-source test 専用 fixture helper。production ビルドでは参照側 (if ブロック) ごと dead code として
// tree-shake される (mobile-footer.ts と同規約で module scope に置く)。
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

  describe('flickDirection', () => {
    it('上方向 (dy <= -12) は up、下方向 (dy >= 12) は down', () => {
      expect([flickDirection(-12), flickDirection(-40), flickDirection(12)]).toEqual([
        'up',
        'up',
        'down',
      ])
    })

    it('閾値未満は null (tap として click 経路に委ねる)', () => {
      expect([flickDirection(0), flickDirection(-11), flickDirection(11)]).toEqual([
        null,
        null,
        null,
      ])
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
