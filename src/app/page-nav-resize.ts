// 左サイドバー (page-nav) の resize handle + toggle tab を sidebar-resize.ts の factory に
// 流し込む薄い wrapper。pointer 計算 (画面左端からの距離 = clientX そのまま) と
// handle / tab の ID、body class だけが本ファイルの責務。

import {
  PAGE_NAV_DEFAULT_WIDTH,
  PAGE_NAV_MAX_WIDTH,
  PAGE_NAV_MIN_WIDTH,
  applyPageNavState,
  clampPageNavWidth,
  isPageNavOpenState,
  isValidStoredPageNavWidth,
  parsePageNavHint,
  readPageNavCliHint,
  readStoredPageNavOpen,
  readStoredPageNavWidth,
  resolveEffectivePageNavState,
  shouldSnapPageNavToClosed,
  writeStoredPageNavOpen,
  writeStoredPageNavWidth,
} from './page-nav-width'
import { createSidebarResize } from './sidebar-resize'

// pointer の clientX から「新しい page-nav 幅」を求める。page-nav は画面左端にあるので
// 画面左端 (= 0) から pointerX までの距離が新しい幅になる。
const widthFromPointer = (clientX: number): number => clientX

const controller = createSidebarResize({
  ariaValueMax: PAGE_NAV_MAX_WIDTH,
  ariaValueMin: PAGE_NAV_MIN_WIDTH,
  bodyResizingClass: 'page-nav-resizing',
  defaultWidth: PAGE_NAV_DEFAULT_WIDTH,
  handleId: 'page-nav-resize-handle',
  toggleTabId: 'page-nav-toggle-tab',
  widthFromPointer,
  widthModule: {
    applyState: applyPageNavState,
    clampWidth: clampPageNavWidth,
    isOpenState: isPageNavOpenState,
    isValidStoredWidth: isValidStoredPageNavWidth,
    parseHint: parsePageNavHint,
    readCliHint: readPageNavCliHint,
    readStoredOpen: readStoredPageNavOpen,
    readStoredWidth: readStoredPageNavWidth,
    resolveEffectiveState: resolveEffectivePageNavState,
    shouldSnapToClosed: shouldSnapPageNavToClosed,
    writeStoredOpen: writeStoredPageNavOpen,
    writeStoredWidth: writeStoredPageNavWidth,
  },
})

/**
 * 起動時に呼び出す。localStorage / CLI hint から初期 PageNavState を解決し、
 * pointer / click event を handle と toggle tab に配線する。
 */
export const initPageNavResize = (): void => {
  controller.init()
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('widthFromPointer (左端からの距離)', () => {
    it('画面左端からの距離をそのまま返す', () => {
      expect(widthFromPointer(0)).toBe(0)
      expect(widthFromPointer(220)).toBe(220)
      expect(widthFromPointer(480)).toBe(480)
    })
  })
}
