// Mermaid SVG 拡大表示 modal (docs/mdxg-diagram-rendering.md §5.j)。
// upgrade 済み SVG をクリックすると open し、Esc / 背景クリック / Close で閉じる。
// help-modal.ts と同じ「`open` クラス toggle + フォーカス復元」パターンで実装する。
//
// modal body には clicked SVG の outerHTML を複製挿入する (元 SVG は不変)。拡縮は CSS のみ
// (`max-width: 90vw; max-height: 90vh`) で zoom / pan ジェスチャは持たない (§1 scope 外)。

const MERMAID_MODAL_BACKDROP_ID = 'mermaid-modal-backdrop'
const MERMAID_MODAL_BODY_ID = 'mermaid-modal-body'
const MERMAID_MODAL_CLOSE_ID = 'mermaid-modal-close'

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
  // upgrade 時に元 SVG へ inline で付けた `cursor: zoom-in` 等が outerHTML 経由で複製に
  // 残るため、モーダル内ではそれ以上ズーム先が無いことを示すため inline cursor を消す。
  // CSS class より inline style が優先されるため JS 側で剥がす必要がある。
  const cloned = body.querySelector('svg')
  if (cloned instanceof SVGElement) {
    cloned.style.removeProperty('cursor')
  }
}

export const openMermaidModal = (svg: SVGSVGElement): void => {
  const backdrop = findBackdrop()
  if (backdrop === null) {
    return
  }
  captureTrigger(backdrop)
  fillModalBody(svg)
  backdrop.classList.add('open')
  const closeBtn = document.getElementById(MERMAID_MODAL_CLOSE_ID)
  if (closeBtn instanceof HTMLElement) {
    closeBtn.focus()
  }
}

export const closeMermaidModal = (): void => {
  const backdrop = findBackdrop()
  if (backdrop === null) {
    return
  }
  backdrop.classList.remove('open')
  const body = document.getElementById(MERMAID_MODAL_BODY_ID)
  if (body instanceof HTMLElement) {
    body.innerHTML = ''
  }
  if (lastTrigger !== null) {
    lastTrigger.focus()
    lastTrigger = null
  }
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
}
