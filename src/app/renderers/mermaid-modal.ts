// Mermaid SVG 拡大表示 modal (docs/mdxg-diagram-rendering.md §5.j)。
// upgrade 済み SVG をクリックすると open し、Esc / 背景クリック / Close で閉じる。
// open/close / focus 復元 / backdrop click は static-modal.ts に集約済み。本ファイルは
// 固有挙動 (body 複製挿入 / pan / zoom / drag state リセット) に集中する。
//
// modal body には clicked SVG の outerHTML を複製挿入する (元 SVG は不変)。初期表示は CSS で
// モーダルいっぱいに meet フィットし、その上に CSS transform (translate + scale) による
// ホイールズーム (カーソル基点) / タッチの pinch ズーム / ドラッグ・1 本指 pan を載せる。
// ダブルクリック / 再オープンで初期表示に戻る。

import { createStaticModalController } from '../dom/static-modal'

const MERMAID_MODAL_BODY_ID = 'mermaid-modal-body'
const MERMAID_MODAL_ZOOM_IN_ID = 'mermaid-modal-zoom-in'
const MERMAID_MODAL_ZOOM_OUT_ID = 'mermaid-modal-zoom-out'

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
// タッチの pinch zoom 用に現在 body に触れている全ポインタを client 座標で保持する。
// 2 本以上で pinch、1 本で pan に振り分ける (Pointer Events で mouse/pen/touch を一元処理)。
const activePointers = new Map<number, { clientX: number; clientY: number }>()
let pinchPrevFrame: PinchFrame | null = null

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

interface PinchFrame {
  dist: number
  midX: number
  midY: number
}

// 2 本指の距離比で拡縮しつつ、midpoint 下の content 点を固定して midpoint の移動分だけ pan する (pure)。
// scale は dist 比で更新し midpoint 基点ズーム → midpoint のフレーム間移動を translate に加える。
export const computePinchTransform = (
  current: ViewTransform,
  prev: PinchFrame,
  next: PinchFrame
): ViewTransform => {
  // prev.dist が 0 (2 指がほぼ同一座標) だと比が Infinity/NaN 化し scale が破綻するため、
  // その frame は拡縮せず midpoint 移動分の pan のみ反映する。
  let ratio = 1
  if (prev.dist > 0) {
    ratio = next.dist / prev.dist
  }
  const nextScale = clampScale(current.scale * ratio)
  const zoomed = computeZoomTransform(
    current,
    { cursorX: next.midX, cursorY: next.midY },
    nextScale
  )
  return {
    scale: zoomed.scale,
    translateX: zoomed.translateX + (next.midX - prev.midX),
    translateY: zoomed.translateY + (next.midY - prev.midY),
  }
}

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

// pointerup を経由しない閉じ方 (Esc 等) で drag / pinch 中に閉じても状態が残らないよう明示リセットする。
const resetDragAndBody = (): void => {
  dragging = false
  activePointers.clear()
  pinchPrevFrame = null
  const body = document.getElementById(MERMAID_MODAL_BODY_ID)
  if (body instanceof HTMLElement) {
    body.innerHTML = ''
    body.classList.remove('dragging')
  }
}

const controller = createStaticModalController({
  backdropId: 'mermaid-modal-backdrop',
  closeButtonId: 'mermaid-modal-close',
  onAfterClose: resetDragAndBody,
})

export const isMermaidModalOpen = (): boolean => controller.isOpen()

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

const getModalBody = (): HTMLElement | null => {
  const body = document.getElementById(MERMAID_MODAL_BODY_ID)
  if (!(body instanceof HTMLElement)) {
    return null
  }
  return body
}

// 現在 active な 2 本指から pinch のフレーム (距離 / body 基準 midpoint) を作る。
const readPinchFrame = (body: HTMLElement): PinchFrame | null => {
  const pts = [...activePointers.values()]
  if (pts.length < 2) {
    return null
  }
  const rect = body.getBoundingClientRect()
  const [first, second] = pts
  return {
    dist: Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY),
    midX: (first.clientX + second.clientX) / 2 - rect.left,
    midY: (first.clientY + second.clientY) / 2 - rect.top,
  }
}

const beginPan = (event: PointerEvent, body: HTMLElement): void => {
  dragging = true
  dragLastX = event.clientX
  dragLastY = event.clientY
  body.classList.add('dragging')
}

// 2 本目が触れたら pan を止め pinch へ切り替える。baseline を今のフレームで初期化する。
const beginPinch = (body: HTMLElement): void => {
  dragging = false
  body.classList.remove('dragging')
  pinchPrevFrame = readPinchFrame(body)
}

const handlePointerDown = (event: PointerEvent): void => {
  // 主ボタン (左) のみ受け付ける。右 / 中ボタンや contextmenu では pan / pinch しない。
  if (event.button !== 0 || !isMermaidModalOpen() || getModalSvg() === null) {
    return
  }
  const body = getModalBody()
  if (body === null) {
    return
  }
  body.setPointerCapture(event.pointerId)
  activePointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY })
  if (activePointers.size >= 2) {
    beginPinch(body)
  } else {
    beginPan(event, body)
  }
}

const handlePinchMove = (body: HTMLElement): void => {
  const frame = readPinchFrame(body)
  if (frame === null) {
    return
  }
  // pinchPrevFrame があれば baseline 初期化済み。null だと前フレームが無く比を取れない。
  if (pinchPrevFrame !== null) {
    view = computePinchTransform(view, pinchPrevFrame, frame)
    applyView()
  }
  pinchPrevFrame = frame
}

const handlePanMove = (event: PointerEvent): void => {
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

const handlePointerMove = (event: PointerEvent): void => {
  if (activePointers.has(event.pointerId)) {
    activePointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY })
  }
  const body = getModalBody()
  if (activePointers.size >= 2 && body !== null) {
    handlePinchMove(body)
    return
  }
  handlePanMove(event)
}

// pinch 継続中にペア構成ポインタ (先頭 2 件) のどれかが抜けると、prev frame が別ペア基準のまま残り
// 次フレームで dist 比・midpoint 差分がジャンプする。残ったポインタで baseline を貼り直して防ぐ。
const rebasePinch = (body: HTMLElement | null): void => {
  if (body === null) {
    pinchPrevFrame = null
    return
  }
  pinchPrevFrame = readPinchFrame(body)
}

// 1 本指へ戻る: 残る指を起点に pan を継ぎ目なく再開する (translate のジャンプ防止)。
const resumePanAfterPinch = (body: HTMLElement | null): void => {
  const [remaining] = [...activePointers.values()]
  dragging = true
  dragLastX = remaining.clientX
  dragLastY = remaining.clientY
  pinchPrevFrame = null
  if (body !== null) {
    body.classList.add('dragging')
  }
}

const endAllPointers = (body: HTMLElement | null): void => {
  dragging = false
  pinchPrevFrame = null
  if (body !== null) {
    body.classList.remove('dragging')
  }
}

const handlePointerUp = (event: PointerEvent): void => {
  activePointers.delete(event.pointerId)
  const body = getModalBody()
  if (body !== null && body.hasPointerCapture(event.pointerId)) {
    body.releasePointerCapture(event.pointerId)
  }
  if (activePointers.size >= 2) {
    rebasePinch(body)
  } else if (activePointers.size === 1) {
    resumePanAfterPinch(body)
  } else {
    endAllPointers(body)
  }
}

const releaseAllCaptures = (body: HTMLElement): void => {
  for (const pointerId of activePointers.keys()) {
    if (body.hasPointerCapture(pointerId)) {
      body.releasePointerCapture(pointerId)
    }
  }
}

// pointercancel はシステムジェスチャ横取り時に複数ポインタの一部しか発火しないことがあり (実機 Safari)、
// 1 件ずつ delete すると残ったポインタで状態が宙に浮く。安全側に全ポインタを破棄して pan/pinch を終える。
const handlePointerCancel = (): void => {
  const body = getModalBody()
  if (body !== null) {
    releaseAllCaptures(body)
  }
  activePointers.clear()
  endAllPointers(body)
}

const wirePanZoom = (): void => {
  const body = document.getElementById(MERMAID_MODAL_BODY_ID)
  if (!(body instanceof HTMLElement)) {
    return
  }
  body.addEventListener('wheel', handleWheel, { passive: false })
  body.addEventListener('pointerdown', handlePointerDown)
  body.addEventListener('pointermove', handlePointerMove)
  body.addEventListener('pointerup', handlePointerUp)
  body.addEventListener('pointercancel', handlePointerCancel)
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
  fillModalBody(svg)
  resetView()
  controller.open()
}

export const closeMermaidModal = (): void => {
  controller.close()
}

/**
 * Close ボタンとバックドロップクリック / pan-zoom / zoom button の listener を attach する。
 * close ボタン + backdrop click は static-modal controller が、それ以外の固有 wiring は本関数が担当。
 * Esc キーは review.ts の global keydown handler 側で他 modal と同列に扱う。
 */
export const wireMermaidModal = (): void => {
  controller.wire()
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

  describe('computePinchTransform (2 本指 pinch)', () => {
    it('指間距離が 2 倍になると scale も 2 倍になる', () => {
      const next = computePinchTransform(
        { scale: 1, translateX: 0, translateY: 0 },
        { dist: 100, midX: 200, midY: 150 },
        { dist: 200, midX: 200, midY: 150 }
      )
      expect(next.scale).toBe(2)
    })

    it('midpoint が動くと content がそれに追従する (拡縮なし時は純粋 pan)', () => {
      const next = computePinchTransform(
        { scale: 2, translateX: 10, translateY: 20 },
        { dist: 100, midX: 100, midY: 100 },
        { dist: 100, midX: 130, midY: 90 }
      )
      expect(next.scale).toBe(2)
      expect(next.translateX).toBeCloseTo(40)
      expect(next.translateY).toBeCloseTo(10)
    })

    it('midpoint 下の content 点は拡縮後も midpoint に留まる (不変条件)', () => {
      const current = { scale: 2, translateX: 30, translateY: -10 }
      const next = computePinchTransform(
        current,
        { dist: 100, midX: 120, midY: 80 },
        { dist: 250, midX: 120, midY: 80 }
      )
      const contentX = (120 - current.translateX) / current.scale
      const contentY = (80 - current.translateY) / current.scale
      expect(next.translateX + contentX * next.scale).toBeCloseTo(120)
      expect(next.translateY + contentY * next.scale).toBeCloseTo(80)
    })

    it('prev.dist が 0 でも NaN にならず scale を維持し pan のみ反映する', () => {
      const next = computePinchTransform(
        { scale: 3, translateX: 5, translateY: 7 },
        { dist: 0, midX: 50, midY: 50 },
        { dist: 120, midX: 60, midY: 40 }
      )
      expect(next.scale).toBe(3)
      expect(Number.isNaN(next.translateX)).toBe(false)
      expect(next.translateX).toBeCloseTo(15)
      expect(next.translateY).toBeCloseTo(-3)
    })
  })
}
