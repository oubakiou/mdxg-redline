// 左サイドバー (page-nav) 幅の薄い wrapper。pure logic と localStorage / DOM 副作用は
// src/app/sidebar-width.ts の共通 factory に集約されており、本ファイルは page-nav 固有の
// 値域 / storage key / DOM ヒント名を config に流し込み、個別の named export を提供する。
// 設計判断・優先順位 P1 は DESIGN.md §7c / mdxg-virtual-pages.archive.md §13.1 (a)。

import {
  type SidebarHint,
  type SidebarOpenState,
  type SidebarState,
  createSidebarWidthModule,
} from './sidebar-width'

export type PageNavOpenState = SidebarOpenState
export type PageNavState = SidebarState
export type PageNavHint = SidebarHint

export const PAGE_NAV_MIN_WIDTH = 180
export const PAGE_NAV_MAX_WIDTH = 480
export const PAGE_NAV_DEFAULT_WIDTH = 220
/** これ未満までドラッグされたら snap で closed にする閾値 (= PAGE_NAV_MIN_WIDTH と同値) */
export const PAGE_NAV_SNAP_THRESHOLD = PAGE_NAV_MIN_WIDTH

const pageNavModule = createSidebarWidthModule({
  closedClassName: 'page-nav-closed',
  cssVarName: '--page-nav-width',
  dataAttrName: 'data-page-nav-width',
  defaultWidth: PAGE_NAV_DEFAULT_WIDTH,
  maxWidth: PAGE_NAV_MAX_WIDTH,
  minWidth: PAGE_NAV_MIN_WIDTH,
  openStorageKey: 'mdxg-redline.page-nav-open',
  widthStorageKey: 'mdxg-redline.page-nav-width',
})

export const isPageNavOpenState = pageNavModule.isOpenState
export const isValidStoredPageNavWidth = pageNavModule.isValidStoredWidth
export const clampPageNavWidth = pageNavModule.clampWidth
export const shouldSnapPageNavToClosed = pageNavModule.shouldSnapToClosed
export const parsePageNavHint = pageNavModule.parseHint
export const resolveEffectivePageNavState = pageNavModule.resolveEffectiveState
export const readStoredPageNavWidth = pageNavModule.readStoredWidth
export const writeStoredPageNavWidth = pageNavModule.writeStoredWidth
export const readStoredPageNavOpen = pageNavModule.readStoredOpen
export const writeStoredPageNavOpen = pageNavModule.writeStoredOpen
export const readPageNavCliHint = pageNavModule.readCliHint
export const applyPageNavState = pageNavModule.applyState

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  // factory の振る舞いは sidebar-width.ts に集約されているため、本ファイルでは
  // page-nav 固有の値域 (180-480, default 220) と PageNavHint パースの境界だけを smoke check する。

  describe('clampPageNavWidth (180-480 / default 220)', () => {
    it('範囲内はそのまま (整数化)', () => {
      expect(clampPageNavWidth(220)).toBe(220)
      expect(clampPageNavWidth(220.6)).toBe(221)
    })

    it('下限未満は 180 にクランプ', () => {
      expect(clampPageNavWidth(0)).toBe(180)
      expect(clampPageNavWidth(179)).toBe(180)
    })

    it('上限超過は 480 にクランプ', () => {
      expect(clampPageNavWidth(481)).toBe(480)
      expect(clampPageNavWidth(10_000)).toBe(480)
    })

    it('非有限値は default (220) を返す', () => {
      expect(clampPageNavWidth(Number.NaN)).toBe(220)
    })
  })

  describe('shouldSnapPageNavToClosed (閾値 180)', () => {
    it('180 未満は true', () => {
      expect(shouldSnapPageNavToClosed(179.9)).toBe(true)
    })
    it('180 以上は false', () => {
      expect(shouldSnapPageNavToClosed(180)).toBe(false)
    })
  })

  describe('parsePageNavHint', () => {
    it('"0" は closed (width: null)', () => {
      expect(parsePageNavHint('0')).toEqual({ open: 'closed', width: null })
    })

    it('180-480 の数値は open (その幅)', () => {
      expect(parsePageNavHint('180')).toEqual({ open: 'open', width: 180 })
      expect(parsePageNavHint('480')).toEqual({ open: 'open', width: 480 })
    })

    it('範囲外 / 非数値は null', () => {
      expect(parsePageNavHint('179')).toBeNull()
      expect(parsePageNavHint('481')).toBeNull()
      expect(parsePageNavHint('auto')).toBeNull()
    })
  })

  describe('isValidStoredPageNavWidth', () => {
    it('180-480 の整数は true', () => {
      expect(isValidStoredPageNavWidth(180)).toBe(true)
      expect(isValidStoredPageNavWidth(480)).toBe(true)
    })

    it('範囲外は false', () => {
      expect(isValidStoredPageNavWidth(179)).toBe(false)
      expect(isValidStoredPageNavWidth(481)).toBe(false)
    })
  })
}
