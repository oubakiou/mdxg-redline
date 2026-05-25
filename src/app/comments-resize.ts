// コメントパネル (右サイドバー) の横幅ドラッグ・開閉の DOM 連携。
// 純粋ロジック (clamp / snap 判定 / 状態解決) は comments-width.ts に分離してあり、
// 本ファイルは pointer / click event の wiring と localStorage / DOM への副作用に専念する。

import {
  COMMENTS_DEFAULT_WIDTH,
  COMMENTS_MAX_WIDTH,
  COMMENTS_MIN_WIDTH,
  type CommentsOpenState,
  type CommentsState,
  applyCommentsState,
  clampCommentsWidth,
  readCommentsCliHint,
  readStoredCommentsOpen,
  readStoredCommentsWidth,
  resolveEffectiveCommentsState,
  shouldSnapCommentsToClosed,
  writeStoredCommentsOpen,
  writeStoredCommentsWidth,
} from './comments-width'

// max-width: 900px と同じ閾値。CSS media query と振る舞いを揃え、ドラッグ操作自体を
// no-op にする (CSS 側で handle / toggle tab は display:none 済みだが、念のため pointer
// event を無視して JS 副作用を発生させない)。
const MOBILE_BREAKPOINT_PX = 900
// pointerup までに動いた距離がこれ未満なら「クリック」として扱う (toggle tab のクリック復元)。
const CLICK_DRAG_THRESHOLD_PX = 4

// module-level state. open=true のときの幅と open/closed フラグを別々に保持し、
// closed 時も「次に開いた時の幅」を覚えておく (UX 要件)。
const currentState: CommentsState = {
  open: 'open',
  width: COMMENTS_DEFAULT_WIDTH,
}

interface DragContext {
  startWidth: number
  startX: number
}

let dragContext: DragContext | null = null
let activePointerId: number | null = null
let activeElement: HTMLElement | null = null
// pointermove で閾値超えて本格ドラッグに昇格したか。tab の場合は pointerdown 時点では
// クリックかドラッグか不明なので false で開始し、移動が閾値を超えた瞬間に true へ昇格する。
// handle (panel 左端) の場合は pointerdown で即 true にする。
// eslint-disable-next-line prefer-const -- promotion / 終了でフラグを書き換えるため
let dragPromoted = false
// ドラッグ昇格直後の click event を 1 度だけ抑止するフラグ。setPointerCapture でも click が
// 発火する環境があるため、明示的に消費する。
// eslint-disable-next-line prefer-const -- promote / click で書き換えるため
let suppressNextClick = false

const isMobileView = (): boolean => globalThis.innerWidth <= MOBILE_BREAKPOINT_PX

/**
 * 要素の `offsetWidth - clientWidth` から実描画上の vertical scrollbar 幅を求める純関数。
 * - scrollbar が表示されているとき: その実幅 (Linux/Windows Chrome ≈ 15–17px, overlay 環境では 0)
 * - 表示されていないとき: 0
 *
 * probe div で「OS 標準幅」を測る方式は、実際の `.doc-pane` の scrollbar 幅と環境差で
 * ズレ得る (テーマ設定 / OverlayScrollbars / ブラウザの scrollbar-width: thin など) ため、
 * 実描画上の差分を直接見る方式に統一する。`scrollHeight > clientHeight` ベースの判定が
 * 表示状態変化を取りこぼすケースも、box の差分なら同じ計算で吸収できる。
 */
export const resolveScrollbarOffset = (box: { clientWidth: number; offsetWidth: number }): number =>
  Math.max(0, box.offsetWidth - box.clientWidth)

export const resolveViewportRightGap = (boxRight: number, viewportWidth: number): number =>
  Math.max(0, viewportWidth - boxRight)

// doc-pane の実描画上 scrollbar 幅を --doc-scrollbar-offset にセットする。
// toggle tab を「scrollbar の左 / scrollbar 無し時は画面右端」に配置するための CSS 変数
// (review.css の .comments-toggle-tab が参照)。
const updateDocScrollbarOffset = (): void => {
  const docPane = document.querySelector<HTMLElement>('.doc-pane')
  if (docPane === null) {
    document.documentElement.style.setProperty('--doc-scrollbar-offset', '0px')
    return
  }
  const scrollbarOffset = resolveScrollbarOffset(docPane)
  const rightGap = resolveViewportRightGap(
    docPane.getBoundingClientRect().right,
    globalThis.innerWidth
  )
  const offset = scrollbarOffset + rightGap
  document.documentElement.style.setProperty('--doc-scrollbar-offset', `${offset}px`)
}

// content load / window resize / panel 開閉のいずれでも scrollbar の有無が変わるため、
// 2 種類の観察を組み合わせる:
//  - #doc (markdown 描画先) を観察 → loadFromMarkdown 後の content 増加で発火
//    (.doc-pane 自身は overflow:auto で box size が中身の成長で変わらず、それだけだと
//     初回の rendering 後 scrollbar が出ても検知できない)
//  - .doc-pane を観察 → window resize / panel 開閉による doc-pane の幅変化で発火
const observeDocPaneScrollbar = (): void => {
  const docPane = document.querySelector<HTMLElement>('.doc-pane')
  if (docPane === null) {
    return
  }
  const observer = new ResizeObserver(updateDocScrollbarOffset)
  observer.observe(docPane)
  const doc = document.getElementById('doc')
  if (doc !== null) {
    observer.observe(doc)
  }
}

// pointer の clientX から「新しいパネル幅」を求める。panel は画面右端にあるので
// viewport 右端から pointerX までの距離が新しい幅になる。
const widthFromPointer = (clientX: number): number => globalThis.innerWidth - clientX

const currentAriaValueNow = (): number => {
  if (currentState.open === 'open') {
    return currentState.width
  }
  return 0
}

const updateAriaState = (): void => {
  const handle = document.getElementById('comments-resize-handle')
  if (handle) {
    handle.setAttribute('aria-valuemin', String(COMMENTS_MIN_WIDTH))
    handle.setAttribute('aria-valuemax', String(COMMENTS_MAX_WIDTH))
    handle.setAttribute('aria-valuenow', String(currentAriaValueNow()))
  }
  const tab = document.getElementById('comments-toggle-tab')
  if (tab) {
    // タブは closed 状態のときだけ可視。aria-expanded のみ状態同期して、screen reader に
    // 「open 状態なら表示要素は隠れている」ことを伝える。
    tab.setAttribute('aria-expanded', String(currentState.open === 'open'))
  }
}

const setOpenState = (open: CommentsOpenState): void => {
  currentState.open = open
  applyCommentsState(currentState)
  writeStoredCommentsOpen(open)
  updateAriaState()
  // open/closed の切替で doc-pane の幅 (= scrollbar の有無 / 描画位置) が即時に変わるので、
  // ResizeObserver の発火を待たず明示更新してオフセットの取りこぼしを防ぐ。
  updateDocScrollbarOffset()
}

const setWidth = (width: number, persist: boolean): void => {
  currentState.width = clampCommentsWidth(width)
  applyCommentsState(currentState)
  if (persist) {
    writeStoredCommentsWidth(currentState.width)
  }
  updateAriaState()
  // panel 幅変化で doc-pane の幅も変わり、scrollbar の有無や位置が変動し得る。
  updateDocScrollbarOffset()
}

// closed 状態にあるとき open に戻す。stored width が次回開く幅として保持されている。
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

// pointer の追跡だけ開始する (setPointerCapture / dragging クラスは付けない)。
// 後続の pointermove が閾値を超えたら promoteToFullDrag で本格ドラッグへ昇格する。
const beginDragTracking = (input: DragStartInput): void => {
  dragContext = { startWidth: currentState.width, startX: input.clientX }
  activePointerId = input.pointerId
  activeElement = input.element
  dragPromoted = false
}

// 本格ドラッグへ昇格。setPointerCapture で pointer を確保し、dragging クラスを付ける。
// 同時に suppressNextClick を立て、ドラッグ後の click が toggle を引き起こさないようにする。
const promoteToFullDrag = (): void => {
  if (activeElement === null || activePointerId === null) {
    return
  }
  activeElement.setPointerCapture(activePointerId)
  activeElement.classList.add('dragging')
  document.body.classList.add('comments-resizing')
  dragPromoted = true
  suppressNextClick = true
}

// handle (panel 左端) は pointerdown 時点でクリック動作の余地がないため即昇格する。
const startDrag = (input: DragStartInput): void => {
  beginDragTracking(input)
  promoteToFullDrag()
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
  document.body.classList.remove('comments-resizing')
  dragContext = null
  activePointerId = null
  activeElement = null
  dragPromoted = false
}

// ドラッグ中で 240px 未満まで縮められた場合の snap 処理。closed に遷移するが、
// localStorage 側の width は変更しない (次に開いた時に元の幅で復元するため)。
const dragSnapToClosed = (): void => {
  if (currentState.open !== 'closed') {
    setOpenState('closed')
  }
}

// ドラッグ中の幅更新。snap 判定 (240px 未満 → closed) を含む。
// localStorage への width 書き込みは pointerup でまとめて行う。
const handleDragMove = (clientX: number): void => {
  if (dragContext === null) {
    return
  }
  const raw = widthFromPointer(clientX)
  if (shouldSnapCommentsToClosed(raw)) {
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

// toggle tab を pointer down した瞬間はまだクリックかドラッグか不明なため、追跡のみ開始する。
// preventDefault を呼ばないことで button の click event を残し、トグル動作はそちらに任せる。
// pointermove で閾値を超えて初めて promoteToFullDrag で本格ドラッグに昇格し、その時に
// suppressNextClick が立って click 側でのトグルが 1 度だけ抑止される。
const onTogglePointerDown = (event: PointerEvent): void => {
  if (isMobileView() || !isPrimaryButton(event)) {
    return
  }
  if (!(event.currentTarget instanceof HTMLElement)) {
    return
  }
  beginDragTracking({
    clientX: event.clientX,
    element: event.currentTarget,
    pointerId: event.pointerId,
  })
}

const onPointerMove = (event: PointerEvent): void => {
  if (dragContext === null || activePointerId !== event.pointerId) {
    return
  }
  if (!dragPromoted) {
    const moved = Math.abs(event.clientX - dragContext.startX)
    if (moved < CLICK_DRAG_THRESHOLD_PX) {
      return
    }
    promoteToFullDrag()
  }
  handleDragMove(event.clientX)
}

const onPointerUp = (event: PointerEvent): void => {
  if (dragContext === null || activePointerId !== event.pointerId) {
    return
  }
  const wasPromoted = dragPromoted
  endDrag()
  if (wasPromoted && currentState.open === 'open') {
    writeStoredCommentsWidth(currentState.width)
  }
  // wasPromoted = false (= 閾値未満) の場合は後続の click event が toggleOpen を担当する。
}

const onPointerCancel = (event: PointerEvent): void => {
  if (activePointerId !== event.pointerId) {
    return
  }
  endDrag()
}

// クリック動作はすべてこの click event ハンドラに集約。pointer 由来のクリックも
// button のデフォルト click (Space / Enter) も同じパスで処理する。
// タブは closed のときしか可視ではないため、動作は「closed → open に復元」のみ。
// ドラッグ昇格 (promoteToFullDrag) 後に発火する click は suppressNextClick で 1 度だけ弾く。
const onToggleClick = (event: MouseEvent): void => {
  if (isMobileView()) {
    return
  }
  if (suppressNextClick) {
    suppressNextClick = false
    return
  }
  event.preventDefault()
  if (currentState.open === 'closed') {
    setOpenState('open')
  }
}

const applyInitialState = (): void => {
  const resolved = resolveEffectiveCommentsState(
    readStoredCommentsWidth(),
    readStoredCommentsOpen(),
    readCommentsCliHint()
  )
  currentState.open = resolved.open
  currentState.width = clampCommentsWidth(resolved.width)
  applyCommentsState(currentState)
  updateAriaState()
}

const wireHandle = (handle: HTMLElement): void => {
  handle.addEventListener('pointerdown', onHandlePointerDown)
  handle.addEventListener('pointermove', onPointerMove)
  handle.addEventListener('pointerup', onPointerUp)
  handle.addEventListener('pointercancel', onPointerCancel)
}

const wireToggleTab = (tab: HTMLElement): void => {
  tab.addEventListener('pointerdown', onTogglePointerDown)
  tab.addEventListener('pointermove', onPointerMove)
  tab.addEventListener('pointerup', onPointerUp)
  tab.addEventListener('pointercancel', onPointerCancel)
  tab.addEventListener('click', onToggleClick)
}

/**
 * 起動時に呼び出す。localStorage / CLI hint から初期 CommentsState を解決し、
 * pointer / click event を handle と toggle tab に配線する。
 */
export const initCommentsResize = (): void => {
  applyInitialState()
  updateDocScrollbarOffset()
  observeDocPaneScrollbar()
  const handle = document.getElementById('comments-resize-handle')
  if (handle !== null) {
    wireHandle(handle)
  }
  const tab = document.getElementById('comments-toggle-tab')
  if (tab !== null) {
    wireToggleTab(tab)
  }
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('widthFromPointer', () => {
    it('viewport 右端からの距離を返す', () => {
      const originalInnerWidth = globalThis.innerWidth
      Object.defineProperty(globalThis, 'innerWidth', {
        configurable: true,
        value: 1280,
      })
      try {
        expect(widthFromPointer(800)).toBe(480)
        expect(widthFromPointer(640)).toBe(640)
        expect(widthFromPointer(1280)).toBe(0)
      } finally {
        Object.defineProperty(globalThis, 'innerWidth', {
          configurable: true,
          value: originalInnerWidth,
        })
      }
    })
  })

  describe('resolveScrollbarOffset', () => {
    it('offsetWidth と clientWidth の差分を返す (scrollbar あり)', () => {
      expect(resolveScrollbarOffset({ clientWidth: 783, offsetWidth: 800 })).toBe(17)
      expect(resolveScrollbarOffset({ clientWidth: 985, offsetWidth: 1000 })).toBe(15)
    })

    it('差分が 0 のときは 0 を返す (scrollbar 無し / overlay 環境)', () => {
      expect(resolveScrollbarOffset({ clientWidth: 800, offsetWidth: 800 })).toBe(0)
    })

    it('負の差分は 0 にクランプする (Math.max 防御)', () => {
      expect(resolveScrollbarOffset({ clientWidth: 1000, offsetWidth: 800 })).toBe(0)
    })
  })

  describe('resolveViewportRightGap', () => {
    it('viewport 右端までの隙間を返す', () => {
      expect(resolveViewportRightGap(1272, 1280)).toBe(8)
      expect(resolveViewportRightGap(1264, 1280)).toBe(16)
    })

    it('隙間がないときは 0', () => {
      expect(resolveViewportRightGap(1280, 1280)).toBe(0)
    })

    it('負の差分は 0 にクランプする (Math.max 防御)', () => {
      expect(resolveViewportRightGap(1290, 1280)).toBe(0)
    })
  })
}
