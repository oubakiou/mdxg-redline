// スマホ (≤768px) 専用の page-scroll FAB (画面左下)。タップで 1 画面下、上下フリックでその方向に
// 1 画面スクロールする。読む面 (doc-pane) のネイティブスクロールと操作を分離する専用 affordance で、
// フリックとスクロールの競合を避けるのが狙い。

// 1 画面送りのたびに直前画面の最下部をこの比率ぶん残して文脈を繋ぐ (PageDown の慣行)。
const OVERLAP_RATIO = 0.12
// この px 未満の縦移動は tap 扱いにして click 経路 (= 下方向送り) に委ねる。
const FLICK_THRESHOLD_PX = 12
// ドラッグ中にアイコンを指へ追従させる量。生の移動量にこの係数を掛け、±ICON_MAX_PX に clamp する。
const ICON_FOLLOW_FACTOR = 0.5
const ICON_MAX_PX = 8

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
 * ドラッグ中のアイコン CSS。位置は指へ追従 (`translate`, ±ICON_MAX_PX に clamp) し、向きは上方向に
 * flick 閾値を超えたら 180deg 回転して上向きシェブロンに反転させる (「離せば上に戻る」を正直に示す)。
 * 下方向・閾値未満は下向き (tap=下送りと一致)。translate / rotate を個別プロパティに分けるのは、
 * 指を離した後の戻りで translate のみ transition させ rotate は瞬時に切り替えるため (CSS 側で
 * `transition: translate` のみ指定)。同一 transform 文字列だと戻り時に rotate も補間されてスピンする。
 */
export const iconDragStyle = (dy: number): IconDragStyle => {
  const translate = `0 ${clampIconOffset(dy)}px`
  if (dy <= -FLICK_THRESHOLD_PX) {
    return { rotate: '180deg', translate }
  }
  return { rotate: '0deg', translate }
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
let fabEl: HTMLElement | null = null
let iconEl: HTMLElement | null = null

// ドラッグ中のアイコン CSS を inline で更新する。translate / rotate を個別に書くことで、
// 戻り時に translate のみ transition させ rotate は瞬時に切り替える (戻りスピン回避、§5.u)。
const applyIconDragStyle = (dy: number): void => {
  if (!iconEl) {
    return
  }
  const style = iconDragStyle(dy)
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
  touchStartY = null
  if (touch) {
    touchStartY = touch.clientY
  }
  if (fabEl) {
    fabEl.classList.add('is-dragging')
    // 触れた時点で出現バウンス (操作前の誘い) は役目を終えるので止め、指追従 (操作中の確認) と
    // 二重に揺れないようにする。
    fabEl.classList.remove('is-hinting')
  }
}

// アイコンを指へ追従させつつ、縦移動が flick 閾値を超えてからネイティブスクロール /
// pull-to-refresh / text 選択を抑止する。閾値未満の微小ジッタ tap では preventDefault せず、
// 後続の合成 click (= tap 経路) を温存する。
const onTouchMove = (event: TouchEvent): void => {
  if (touchStartY === null) {
    return
  }
  const [touch] = event.touches
  if (!touch) {
    return
  }
  const dy = touch.clientY - touchStartY
  applyIconDragStyle(dy)
  if (Math.abs(dy) >= FLICK_THRESHOLD_PX && event.cancelable) {
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
  resetIcon()
  if (!dir) {
    return
  }
  // flick と判定したら後続の合成 click (= tap 経路) を抑止して二重スクロールを防ぐ。
  if (event.cancelable) {
    event.preventDefault()
  }
  scrollByScreen(dir)
}

const onTouchCancel = (): void => {
  touchStartY = null
  resetIcon()
}

// tap / mouse click / keyboard (Enter / Space) の共通経路。flick の touchend は preventDefault で
// click を抑止するため、ここに到達するのは tap とポインタ非タッチ操作のみ。
const onClick = (): void => {
  scrollByScreen('down')
}

const registerTouchHandlers = (btn: HTMLElement): void => {
  btn.addEventListener('touchstart', onTouchStart, { passive: true })
  btn.addEventListener('touchmove', onTouchMove, { passive: false })
  btn.addEventListener('touchend', onTouchEnd, { passive: false })
  btn.addEventListener('touchcancel', onTouchCancel, { passive: true })
}

// 出現時に一度だけ上下バウンスのヒントを再生する。display トグルでの再生を避けるため、
// wire 時に .is-hinting を付与し合計再生時間後に外す一発方式 (localStorage は使わない)。
const HINT_TOTAL_MS = 3500
const playFlickHint = (btn: HTMLElement): void => {
  btn.classList.add('is-hinting')
  globalThis.setTimeout((): void => {
    btn.classList.remove('is-hinting')
  }, HINT_TOTAL_MS)
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
  playFlickHint(btn)
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

  describe('iconDragStyle', () => {
    it('上方向に閾値超過で rotate 180deg + ±8px に clamp した translate', () => {
      // dy=-40 → -40*0.5=-20 → clamp -8 / 上向き反転
      expect(iconDragStyle(-40)).toEqual({ rotate: '180deg', translate: '0 -8px' })
    })

    it('下方向は rotate 0deg で translate のみ (clamp 適用)', () => {
      // dy=40 → 20 → clamp 8
      expect(iconDragStyle(40)).toEqual({ rotate: '0deg', translate: '0 8px' })
    })

    it('閾値未満は rotate 0deg で指へ追従 (offset = dy * 0.5)', () => {
      expect(iconDragStyle(10)).toEqual({ rotate: '0deg', translate: '0 5px' })
    })
  })

  describe('wirePageScrollButton', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
      vi.useRealTimers()
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

    it('wire 時に出現ヒント class を付与し、一定時間後に外す', () => {
      vi.useFakeTimers()
      const { btn } = setup()
      expect(btn.classList.contains('is-hinting')).toBe(true)
      vi.advanceTimersByTime(HINT_TOTAL_MS + 100)
      expect(btn.classList.contains('is-hinting')).toBe(false)
    })

    it('touchstart で出現ヒントを止める (誘い→確認の切替で二重モーションを防ぐ)', () => {
      vi.useFakeTimers()
      const { btn } = setup()
      const event = new Event('touchstart', { bubbles: true })
      Object.defineProperty(event, 'touches', { value: [{ clientY: 100 }] })
      btn.dispatchEvent(event)
      expect(btn.classList.contains('is-hinting')).toBe(false)
    })
  })
}
