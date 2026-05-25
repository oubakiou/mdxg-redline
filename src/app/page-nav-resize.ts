// 左サイドバー (page-nav) の横幅ドラッグ・開閉の DOM 連携。
// comments-resize.ts と並列の責務分担で、純粋ロジック (clamp / snap / 状態解決) は
// page-nav-width.ts に分離してある。pointer 計算式が左右で異なる:
// - 右 panel (comments): 画面右端からの距離 (innerWidth - clientX)
// - 左 page-nav: 画面左端からの距離 (clientX)

import {
  PAGE_NAV_DEFAULT_WIDTH,
  PAGE_NAV_MAX_WIDTH,
  PAGE_NAV_MIN_WIDTH,
  type PageNavOpenState,
  type PageNavState,
  applyPageNavState,
  clampPageNavWidth,
  readPageNavCliHint,
  readStoredPageNavOpen,
  readStoredPageNavWidth,
  resolveEffectivePageNavState,
  shouldSnapPageNavToClosed,
  writeStoredPageNavOpen,
  writeStoredPageNavWidth,
} from './page-nav-width'

const MOBILE_BREAKPOINT_PX = 900

const currentState: PageNavState = {
  open: 'open',
  width: PAGE_NAV_DEFAULT_WIDTH,
}

interface DragContext {
  startWidth: number
  startX: number
}

let dragContext: DragContext | null = null
let activePointerId: number | null = null
let activeElement: HTMLElement | null = null

const isMobileView = (): boolean => globalThis.innerWidth <= MOBILE_BREAKPOINT_PX

// pointer の clientX から「新しい page-nav 幅」を求める。page-nav は画面左端にあるので
// 画面左端 (= 0) から pointerX までの距離が新しい幅になる。
const widthFromPointer = (clientX: number): number => clientX

const currentAriaValueNow = (): number => {
  if (currentState.open === 'open') {
    return currentState.width
  }
  return 0
}

const updateAriaState = (): void => {
  const handle = document.getElementById('page-nav-resize-handle')
  if (handle) {
    handle.setAttribute('aria-valuemin', String(PAGE_NAV_MIN_WIDTH))
    handle.setAttribute('aria-valuemax', String(PAGE_NAV_MAX_WIDTH))
    handle.setAttribute('aria-valuenow', String(currentAriaValueNow()))
  }
  const tab = document.getElementById('page-nav-toggle-tab')
  if (tab) {
    tab.setAttribute('aria-expanded', String(currentState.open === 'open'))
  }
}

const setOpenState = (open: PageNavOpenState): void => {
  currentState.open = open
  applyPageNavState(currentState)
  writeStoredPageNavOpen(open)
  updateAriaState()
}

const setWidth = (width: number, persist: boolean): void => {
  currentState.width = clampPageNavWidth(width)
  applyPageNavState(currentState)
  if (persist) {
    writeStoredPageNavWidth(currentState.width)
  }
  updateAriaState()
}

const ensureOpen = (): void => {
  if (currentState.open !== 'open') {
    setOpenState('open')
  }
}

interface DragStartInput {
  clientX: number
  element: HTMLElement
  pointerId: number
}

// handle (page-nav 右端) は pointerdown 時点でクリック動作の余地がないため即ドラッグ開始する。
// tab は click 専用 (onToggleClick) で drag を担わないため、開閉トグルとの混在による
// 1 回目クリック抑止 bug は構造的に塞いである (comments-resize.ts と同じ責務分担)。
const startDrag = (input: DragStartInput): void => {
  dragContext = { startWidth: currentState.width, startX: input.clientX }
  activePointerId = input.pointerId
  activeElement = input.element
  input.element.setPointerCapture(input.pointerId)
  input.element.classList.add('dragging')
  document.body.classList.add('page-nav-resizing')
}

const endDrag = (): void => {
  if (activeElement !== null && activePointerId !== null) {
    try {
      activeElement.releasePointerCapture(activePointerId)
    } catch {
      // ignore: pointer は既に release されている可能性がある
    }
    activeElement.classList.remove('dragging')
  }
  document.body.classList.remove('page-nav-resizing')
  dragContext = null
  activePointerId = null
  activeElement = null
}

const dragSnapToClosed = (): void => {
  if (currentState.open !== 'closed') {
    setOpenState('closed')
  }
}

const handleDragMove = (clientX: number): void => {
  if (dragContext === null) {
    return
  }
  const raw = widthFromPointer(clientX)
  if (shouldSnapPageNavToClosed(raw)) {
    dragSnapToClosed()
    return
  }
  ensureOpen()
  setWidth(raw, false)
}

const isPrimaryButton = (event: PointerEvent): boolean => event.button === 0

const onHandlePointerDown = (event: PointerEvent): void => {
  if (isMobileView() || !isPrimaryButton(event)) {
    return
  }
  if (!(event.currentTarget instanceof HTMLElement)) {
    return
  }
  event.preventDefault()
  startDrag({ clientX: event.clientX, element: event.currentTarget, pointerId: event.pointerId })
}

const onPointerMove = (event: PointerEvent): void => {
  if (dragContext === null || activePointerId !== event.pointerId) {
    return
  }
  handleDragMove(event.clientX)
}

const onPointerUp = (event: PointerEvent): void => {
  if (dragContext === null || activePointerId !== event.pointerId) {
    return
  }
  endDrag()
  if (currentState.open === 'open') {
    writeStoredPageNavWidth(currentState.width)
  }
}

const onPointerCancel = (event: PointerEvent): void => {
  if (activePointerId !== event.pointerId) {
    return
  }
  endDrag()
}

// タブは closed のときしか可視ではないため、動作は「closed → open に復元」のみ。
// pointerdown を扱わず click のみに集約することで、タッチ・トラックパッドで起きがちな
// 数 px のジッタが drag 昇格を誤発火させて 1 回目の click が抑止される bug を構造的に塞ぐ。
const onToggleClick = (event: MouseEvent): void => {
  if (isMobileView()) {
    return
  }
  if (currentState.open === 'closed') {
    event.preventDefault()
    setOpenState('open')
  }
}

const applyInitialState = (): void => {
  const resolved = resolveEffectivePageNavState(
    readStoredPageNavWidth(),
    readStoredPageNavOpen(),
    readPageNavCliHint()
  )
  currentState.open = resolved.open
  currentState.width = clampPageNavWidth(resolved.width)
  applyPageNavState(currentState)
  updateAriaState()
}

const wireHandle = (handle: HTMLElement): void => {
  handle.addEventListener('pointerdown', onHandlePointerDown)
  handle.addEventListener('pointermove', onPointerMove)
  handle.addEventListener('pointerup', onPointerUp)
  handle.addEventListener('pointercancel', onPointerCancel)
}

const wireToggleTab = (tab: HTMLElement): void => {
  tab.addEventListener('click', onToggleClick)
}

/**
 * 起動時に呼び出す。localStorage / CLI hint から初期 PageNavState を解決し、
 * pointer / click event を handle と toggle tab に配線する。
 */
export const initPageNavResize = (): void => {
  applyInitialState()
  const handle = document.getElementById('page-nav-resize-handle')
  if (handle !== null) {
    wireHandle(handle)
  }
  const tab = document.getElementById('page-nav-toggle-tab')
  if (tab !== null) {
    wireToggleTab(tab)
  }
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('widthFromPointer', () => {
    it('画面左端からの距離をそのまま返す', () => {
      expect(widthFromPointer(0)).toBe(0)
      expect(widthFromPointer(220)).toBe(220)
      expect(widthFromPointer(480)).toBe(480)
    })
  })
}
