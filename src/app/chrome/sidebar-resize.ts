// 左右サイドバーの resize handle と toggle tab を 1 つの factory にまとめた共通実装。
// pointer 計算式 (右 = innerWidth - clientX、左 = clientX) と DOM ID (handle / tab) /
// body class (comments-resizing / page-nav-resizing) だけが異なる pair なので、config に
// 抽出して同じ logic を共有する。pure logic (clamp / snap / 状態解決) は sidebar-width.ts
// の SidebarWidthModule で共通化済み。
// 個別 wrapper (comments-resize.ts / page-nav-resize.ts) は config を流し込んで init を提供する。

import type { SidebarOpenState, SidebarState, SidebarWidthModule } from '../layout/sidebar-width'

const MOBILE_BREAKPOINT_PX = 900

export interface SidebarResizeConfig {
  ariaValueMax: number
  ariaValueMin: number
  /** drag 中に <body> に付ける class (例: 'comments-resizing') */
  bodyResizingClass: string
  defaultWidth: number
  handleId: string
  /** 状態変化 (open/closed/width) のたびに呼ばれる任意 callback (例: scrollbar offset 再測定) */
  onAfterStateChange?: () => void
  toggleTabId: string
  /** pointer clientX から「新しい幅」を計算する。左右で式が異なる */
  widthFromPointer: (clientX: number) => number
  widthModule: SidebarWidthModule
}

export interface SidebarResizeController {
  applyInitialState: () => void
  init: () => void
}

const isMobileView = (): boolean => globalThis.innerWidth <= MOBILE_BREAKPOINT_PX

const isPrimaryButton = (event: PointerEvent): boolean => event.button === 0

interface DragContext {
  startWidth: number
  startX: number
}

interface DragStartInput {
  clientX: number
  element: HTMLElement
  pointerId: number
}

interface SessionState {
  activeElement: HTMLElement | null
  activePointerId: number | null
  dragContext: DragContext | null
}

// factory は wiring 用の inner 関数を 13 個以上組み立てるため、max-statements (既定 10) を
// 超える。各 inner 関数自体は短く、責務単位で外に出すと state / config の引き渡しが冗長に
// なるため factory 全体でルールを緩める (sidebar-width.ts と同じ規約)。
// eslint-disable-next-line max-statements
export const createSidebarResize = (config: SidebarResizeConfig): SidebarResizeController => {
  const currentState: SidebarState = {
    open: 'open',
    width: config.defaultWidth,
  }
  const session: SessionState = {
    activeElement: null,
    activePointerId: null,
    dragContext: null,
  }

  const currentAriaValueNow = (): number => {
    if (currentState.open === 'open') {
      return currentState.width
    }
    return 0
  }

  const updateAriaState = (): void => {
    const handle = document.getElementById(config.handleId)
    if (handle) {
      handle.setAttribute('aria-valuemin', String(config.ariaValueMin))
      handle.setAttribute('aria-valuemax', String(config.ariaValueMax))
      handle.setAttribute('aria-valuenow', String(currentAriaValueNow()))
    }
    const tab = document.getElementById(config.toggleTabId)
    if (tab) {
      tab.setAttribute('aria-expanded', String(currentState.open === 'open'))
    }
  }

  const afterStateChange = (): void => {
    if (typeof config.onAfterStateChange === 'function') {
      config.onAfterStateChange()
    }
  }

  const setOpenState = (open: SidebarOpenState): void => {
    currentState.open = open
    config.widthModule.applyState(currentState)
    config.widthModule.writeStoredOpen(open)
    updateAriaState()
    afterStateChange()
  }

  const setWidth = (width: number, persist: boolean): void => {
    currentState.width = config.widthModule.clampWidth(width)
    config.widthModule.applyState(currentState)
    if (persist) {
      config.widthModule.writeStoredWidth(currentState.width)
    }
    updateAriaState()
    afterStateChange()
  }

  const ensureOpen = (): void => {
    if (currentState.open !== 'open') {
      setOpenState('open')
    }
  }

  const startDrag = (input: DragStartInput): void => {
    session.dragContext = { startWidth: currentState.width, startX: input.clientX }
    session.activePointerId = input.pointerId
    session.activeElement = input.element
    input.element.setPointerCapture(input.pointerId)
    input.element.classList.add('dragging')
    document.body.classList.add(config.bodyResizingClass)
  }

  const endDrag = (): void => {
    if (session.activeElement !== null && session.activePointerId !== null) {
      try {
        session.activeElement.releasePointerCapture(session.activePointerId)
      } catch {
        // ignore: pointer は既に release されている可能性がある
      }
      session.activeElement.classList.remove('dragging')
    }
    document.body.classList.remove(config.bodyResizingClass)
    session.dragContext = null
    session.activePointerId = null
    session.activeElement = null
  }

  const dragSnapToClosed = (): void => {
    if (currentState.open !== 'closed') {
      setOpenState('closed')
    }
  }

  const handleDragMove = (clientX: number): void => {
    if (session.dragContext === null) {
      return
    }
    const raw = config.widthFromPointer(clientX)
    if (config.widthModule.shouldSnapToClosed(raw)) {
      dragSnapToClosed()
      return
    }
    ensureOpen()
    setWidth(raw, false)
  }

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
    if (session.dragContext === null || session.activePointerId !== event.pointerId) {
      return
    }
    handleDragMove(event.clientX)
  }

  const onPointerUp = (event: PointerEvent): void => {
    if (session.dragContext === null || session.activePointerId !== event.pointerId) {
      return
    }
    endDrag()
    if (currentState.open === 'open') {
      config.widthModule.writeStoredWidth(currentState.width)
    }
  }

  const onPointerCancel = (event: PointerEvent): void => {
    if (session.activePointerId !== event.pointerId) {
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
    const resolved = config.widthModule.resolveEffectiveState(
      config.widthModule.readStoredWidth(),
      config.widthModule.readStoredOpen(),
      config.widthModule.readCliHint()
    )
    currentState.open = resolved.open
    currentState.width = config.widthModule.clampWidth(resolved.width)
    config.widthModule.applyState(currentState)
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

  const init = (): void => {
    applyInitialState()
    const handle = document.getElementById(config.handleId)
    if (handle !== null) {
      wireHandle(handle)
    }
    const tab = document.getElementById(config.toggleTabId)
    if (tab !== null) {
      wireToggleTab(tab)
    }
  }

  return { applyInitialState, init }
}
