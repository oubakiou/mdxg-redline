// Mermaid SVG 拡大表示 modal (docs/mdxg-diagram-rendering.md §5.j)。
// upgrade 済み SVG をクリックすると open し、Esc / 背景クリック / Close で閉じる。
// help-modal.ts と同じ「`open` クラス toggle + フォーカス復元」パターンで実装する。
//
// modal body には clicked SVG の outerHTML を複製挿入する (元 SVG は不変)。初期表示は CSS で
// モーダルいっぱいに meet フィットし、その上に CSS transform (translate + scale) による
// ホイールズーム (カーソル基点) とドラッグ pan を載せる。ダブルクリック / 再オープンで初期表示に戻る。

const MERMAID_MODAL_BACKDROP_ID = 'mermaid-modal-backdrop'
const MERMAID_MODAL_BODY_ID = 'mermaid-modal-body'
const MERMAID_MODAL_CLOSE_ID = 'mermaid-modal-close'
const MERMAID_MODAL_ZOOM_IN_ID = 'mermaid-modal-zoom-in'
const MERMAID_MODAL_ZOOM_OUT_ID = 'mermaid-modal-zoom-out'

let lastTrigger: HTMLElement | null = null

const findBackdrop = (): HTMLElement | null => {
  const element = document.getElementById(MERMAID_MODAL_BACKDROP_ID)
  if (!(element instanceof HTMLElement)) {
    return null
  }
  return element
}

export const isMermaidModalOpen = (): boolean => {
  const backdrop = findBackdrop()
  if (backdrop === null) {
    return false
  }
  return backdrop.classList.contains('open')
}

const captureTrigger = (backdrop: HTMLElement): void => {
  if (isMermaidModalOpen()) {
    return
  }
  const active = document.activeElement
  if (active instanceof HTMLElement && !backdrop.contains(active)) {
    lastTrigger = active
  }
}

const fillModalBody = (svg: SVGSVGElement): void => {
  const body = document.getElementById(MERMAID_MODAL_BODY_ID)
  if (!(body instanceof HTMLElement)) {
    return
  }
  body.innerHTML = svg.outerHTML
  // outerHTML 経由で複製に残る 2 つの inline style を剥がす。CSS class より inline style が
  // 優先されるため JS 側で消す必要がある:
  //   - cursor: upgrade 時に付けた `zoom-in`。モーダル内はズーム先が無いので通常カーソルに戻す。
  //   - max-width: Mermaid が描画時に焼き込む `<自然幅>px`。残すと stylesheet の拡大指定
  //     (width/height 100%) を上書きして図が自然サイズ止まりになり、モーダルでも文字が拡大しない。
  const cloned = body.querySelector('svg')
  if (cloned instanceof SVGElement) {
    cloned.style.removeProperty('cursor')
    cloned.style.removeProperty('max-width')
  }
}

const SCALE_MIN = 0.5
const SCALE_MAX = 10
const ZOOM_STEP = 1.1

interface ViewTransform {
  scale: number
  translateX: number
  translateY: number
}

let view: ViewTransform = { scale: 1, translateX: 0, translateY: 0 }
let dragging = false
let dragLastX = 0
let dragLastY = 0

export const clampScale = (value: number): number => Math.min(SCALE_MAX, Math.max(SCALE_MIN, value))

// カーソル下の content 座標を固定したまま nextScale へ拡縮する translate を返す (pure)。
// 不変条件: 新 translate + (cursor 下 content 座標) * nextScale === cursor 座標。
export const computeZoomTransform = (
  current: ViewTransform,
  cursor: { cursorX: number; cursorY: number },
  nextScale: number
): ViewTransform => ({
  scale: nextScale,
  translateX: cursor.cursorX - ((cursor.cursorX - current.translateX) / current.scale) * nextScale,
  translateY: cursor.cursorY - ((cursor.cursorY - current.translateY) / current.scale) * nextScale,
})

const getModalSvg = (): SVGElement | null => {
  const body = document.getElementById(MERMAID_MODAL_BODY_ID)
  if (!(body instanceof HTMLElement)) {
    return null
  }
  const svg = body.querySelector('svg')
  if (!(svg instanceof SVGElement)) {
    return null
  }
  return svg
}

const applyView = (): void => {
  const svg = getModalSvg()
  if (svg === null) {
    return
  }
  svg.style.transformOrigin = '0 0'
  svg.style.transform = `translate(${view.translateX}px, ${view.translateY}px) scale(${view.scale})`
}

const resetView = (): void => {
  view = { scale: 1, translateX: 0, translateY: 0 }
  applyView()
}

const handleWheel = (event: WheelEvent): void => {
  const body = document.getElementById(MERMAID_MODAL_BODY_ID)
  if (!isMermaidModalOpen() || !(body instanceof HTMLElement)) {
    return
  }
  event.preventDefault()
  const rect = body.getBoundingClientRect()
  const nextScale = clampScale(view.scale * ZOOM_STEP ** Math.sign(-event.deltaY))
  view = computeZoomTransform(
    view,
    { cursorX: event.clientX - rect.left, cursorY: event.clientY - rect.top },
    nextScale
  )
  applyView()
}

const handlePointerDown = (event: PointerEvent): void => {
  // 主ボタン (左) のみ pan を開始する。右 / 中ボタンや contextmenu では pan しない。
  if (event.button !== 0 || !isMermaidModalOpen() || getModalSvg() === null) {
    return
  }
  dragging = true
  dragLastX = event.clientX
  dragLastY = event.clientY
  const body = document.getElementById(MERMAID_MODAL_BODY_ID)
  if (body instanceof HTMLElement) {
    body.setPointerCapture(event.pointerId)
    body.classList.add('dragging')
  }
}

const handlePointerMove = (event: PointerEvent): void => {
  if (!dragging) {
    return
  }
  view = {
    scale: view.scale,
    translateX: view.translateX + (event.clientX - dragLastX),
    translateY: view.translateY + (event.clientY - dragLastY),
  }
  dragLastX = event.clientX
  dragLastY = event.clientY
  applyView()
}

const endDrag = (event: PointerEvent): void => {
  if (!dragging) {
    return
  }
  dragging = false
  const body = document.getElementById(MERMAID_MODAL_BODY_ID)
  if (body instanceof HTMLElement) {
    if (body.hasPointerCapture(event.pointerId)) {
      body.releasePointerCapture(event.pointerId)
    }
    body.classList.remove('dragging')
  }
}

const wirePanZoom = (): void => {
  const body = document.getElementById(MERMAID_MODAL_BODY_ID)
  if (!(body instanceof HTMLElement)) {
    return
  }
  body.addEventListener('wheel', handleWheel, { passive: false })
  body.addEventListener('pointerdown', handlePointerDown)
  body.addEventListener('pointermove', handlePointerMove)
  body.addEventListener('pointerup', endDrag)
  body.addEventListener('pointercancel', endDrag)
  body.addEventListener('dblclick', resetView)
}

const ZOOM_BUTTON_STEP = 1.25

// ボタンズームはカーソル位置が無いため body 中央を基点に拡縮する。
const zoomFromButton = (factor: number): void => {
  const body = document.getElementById(MERMAID_MODAL_BODY_ID)
  if (!(body instanceof HTMLElement)) {
    return
  }
  const rect = body.getBoundingClientRect()
  const nextScale = clampScale(view.scale * factor)
  view = computeZoomTransform(
    view,
    { cursorX: rect.width / 2, cursorY: rect.height / 2 },
    nextScale
  )
  applyView()
}

const wireZoomButtons = (): void => {
  const zoomIn = document.getElementById(MERMAID_MODAL_ZOOM_IN_ID)
  if (zoomIn instanceof HTMLElement) {
    zoomIn.addEventListener('click', (): void => {
      zoomFromButton(ZOOM_BUTTON_STEP)
    })
  }
  const zoomOut = document.getElementById(MERMAID_MODAL_ZOOM_OUT_ID)
  if (zoomOut instanceof HTMLElement) {
    zoomOut.addEventListener('click', (): void => {
      zoomFromButton(1 / ZOOM_BUTTON_STEP)
    })
  }
}

export const openMermaidModal = (svg: SVGSVGElement): void => {
  const backdrop = findBackdrop()
  if (backdrop === null) {
    return
  }
  captureTrigger(backdrop)
  fillModalBody(svg)
  resetView()
  backdrop.classList.add('open')
  const closeBtn = document.getElementById(MERMAID_MODAL_CLOSE_ID)
  if (closeBtn instanceof HTMLElement) {
    closeBtn.focus()
  }
}

const restoreTriggerFocus = (): void => {
  if (lastTrigger !== null) {
    lastTrigger.focus()
    lastTrigger = null
  }
}

export const closeMermaidModal = (): void => {
  const backdrop = findBackdrop()
  if (backdrop === null) {
    return
  }
  backdrop.classList.remove('open')
  // pointerup を経由しない閉じ方 (Esc 等) で drag 中に閉じても状態が残らないよう明示リセットする。
  dragging = false
  const body = document.getElementById(MERMAID_MODAL_BODY_ID)
  if (body instanceof HTMLElement) {
    body.innerHTML = ''
    body.classList.remove('dragging')
  }
  restoreTriggerFocus()
}

/**
 * Close ボタンとバックドロップクリックで modal を閉じる listener を attach する。
 * Esc キーは review.ts の global keydown handler 側で他 modal と同列に扱う。
 */
export const wireMermaidModal = (): void => {
  const backdrop = findBackdrop()
  if (backdrop === null) {
    return
  }
  const closeBtn = document.getElementById(MERMAID_MODAL_CLOSE_ID)
  if (closeBtn instanceof HTMLElement) {
    closeBtn.addEventListener('click', closeMermaidModal)
  }
  backdrop.addEventListener('click', (event): void => {
    if (event.target === backdrop) {
      closeMermaidModal()
    }
  })
  wirePanZoom()
  wireZoomButtons()
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('clampScale', () => {
    it('範囲内はそのまま返す', () => {
      expect(clampScale(1)).toBe(1)
      expect(clampScale(3.5)).toBe(3.5)
    })

    it('下限 0.5 / 上限 10 にクランプする', () => {
      expect(clampScale(0.1)).toBe(0.5)
      expect(clampScale(50)).toBe(10)
    })
  })

  describe('computeZoomTransform (カーソル基点ズーム)', () => {
    it('nextScale を view に反映する', () => {
      const next = computeZoomTransform(
        { scale: 1, translateX: 0, translateY: 0 },
        { cursorX: 100, cursorY: 50 },
        2
      )
      expect(next.scale).toBe(2)
    })

    it('カーソル下の content 点が拡縮後も同じ画面座標に留まる (不変条件)', () => {
      const current = { scale: 2, translateX: 30, translateY: -10 }
      const cursorX = 120
      const cursorY = 80
      const next = computeZoomTransform(current, { cursorX, cursorY }, 5)
      const contentX = (cursorX - current.translateX) / current.scale
      const contentY = (cursorY - current.translateY) / current.scale
      expect(next.translateX + contentX * next.scale).toBeCloseTo(cursorX)
      expect(next.translateY + contentY * next.scale).toBeCloseTo(cursorY)
    })
  })
}
