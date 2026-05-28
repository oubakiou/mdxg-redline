// 右パネル (comments) の resize handle + toggle tab を sidebar-resize.ts の factory に
// 流し込む薄い wrapper。pointer 計算 (画面右端からの距離) と handle / tab の ID、body class、
// scrollbar offset 観察 (右パネル固有) だけが本ファイルの責務。

import {
  COMMENTS_DEFAULT_WIDTH,
  COMMENTS_MAX_WIDTH,
  COMMENTS_MIN_WIDTH,
  applyCommentsState,
  clampCommentsWidth,
  isCommentsOpenState,
  isValidStoredCommentsWidth,
  parseCommentsHint,
  readCommentsCliHint,
  readStoredCommentsOpen,
  readStoredCommentsWidth,
  resolveEffectiveCommentsState,
  shouldSnapCommentsToClosed,
  writeStoredCommentsOpen,
  writeStoredCommentsWidth,
} from './comments-width'
import { createSidebarResize } from './sidebar-resize'

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

const controller = createSidebarResize({
  ariaValueMax: COMMENTS_MAX_WIDTH,
  ariaValueMin: COMMENTS_MIN_WIDTH,
  bodyResizingClass: 'comments-resizing',
  defaultWidth: COMMENTS_DEFAULT_WIDTH,
  handleId: 'comments-resize-handle',
  onAfterStateChange: updateDocScrollbarOffset,
  toggleTabId: 'comments-toggle-tab',
  widthFromPointer,
  widthModule: {
    applyState: applyCommentsState,
    clampWidth: clampCommentsWidth,
    isOpenState: isCommentsOpenState,
    isValidStoredWidth: isValidStoredCommentsWidth,
    parseHint: parseCommentsHint,
    readCliHint: readCommentsCliHint,
    readStoredOpen: readStoredCommentsOpen,
    readStoredWidth: readStoredCommentsWidth,
    resolveEffectiveState: resolveEffectiveCommentsState,
    shouldSnapToClosed: shouldSnapCommentsToClosed,
    writeStoredOpen: writeStoredCommentsOpen,
    writeStoredWidth: writeStoredCommentsWidth,
  },
})

/**
 * 起動時に呼び出す。localStorage / CLI hint から初期 CommentsState を解決し、
 * pointer / click event を handle と toggle tab に配線する。
 */
export const initCommentsResize = (): void => {
  controller.init()
  updateDocScrollbarOffset()
  observeDocPaneScrollbar()
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('widthFromPointer (右端からの距離)', () => {
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
