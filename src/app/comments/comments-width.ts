// 右パネル (comments) 幅の薄い wrapper。pure logic と localStorage / DOM 副作用は
// src/app/sidebar-width.ts の共通 factory に集約されており、本ファイルは comments 固有の
// 値域 / storage key / DOM ヒント名を config に流し込み、個別の named export を提供する。
// 設計判断・優先順位 P1 は DESIGN.md §7c。

import {
  type SidebarHint,
  type SidebarOpenState,
  type SidebarState,
  createSidebarWidthModule,
} from '../chrome/sidebar-width'

export type CommentsOpenState = SidebarOpenState
export type CommentsState = SidebarState
export type CommentsHint = SidebarHint

export const COMMENTS_MIN_WIDTH = 280
export const COMMENTS_MAX_WIDTH = 640
export const COMMENTS_DEFAULT_WIDTH = 360
/** これ未満までドラッグされたら snap で closed にする閾値 (= COMMENTS_MIN_WIDTH と同値) */
export const COMMENTS_SNAP_THRESHOLD = COMMENTS_MIN_WIDTH

const commentsModule = createSidebarWidthModule({
  closedClassName: 'comments-closed',
  cssVarName: '--comments-width',
  dataAttrName: 'data-comments-width',
  defaultWidth: COMMENTS_DEFAULT_WIDTH,
  maxWidth: COMMENTS_MAX_WIDTH,
  minWidth: COMMENTS_MIN_WIDTH,
  openStorageKey: 'mdxg-redline.comments-open',
  widthStorageKey: 'mdxg-redline.comments-width',
})

export const isCommentsOpenState = commentsModule.isOpenState
export const isValidStoredCommentsWidth = commentsModule.isValidStoredWidth
export const clampCommentsWidth = commentsModule.clampWidth
export const shouldSnapCommentsToClosed = commentsModule.shouldSnapToClosed
export const parseCommentsHint = commentsModule.parseHint
export const resolveEffectiveCommentsState = commentsModule.resolveEffectiveState
export const readStoredCommentsWidth = commentsModule.readStoredWidth
export const writeStoredCommentsWidth = commentsModule.writeStoredWidth
export const readStoredCommentsOpen = commentsModule.readStoredOpen
export const writeStoredCommentsOpen = commentsModule.writeStoredOpen
export const readCommentsCliHint = commentsModule.readCliHint
export const applyCommentsState = commentsModule.applyState

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  // factory の振る舞いは sidebar-width.ts に集約されているため、本ファイルでは
  // comments 固有の値域 (280-640, default 360) と CommentsHint パースの境界だけを smoke check する。

  describe('clampCommentsWidth (280-640 / default 360)', () => {
    it('範囲内はそのまま (整数化)', () => {
      expect(clampCommentsWidth(360)).toBe(360)
      expect(clampCommentsWidth(360.6)).toBe(361)
    })

    it('下限未満は 280 にクランプ', () => {
      expect(clampCommentsWidth(0)).toBe(280)
      expect(clampCommentsWidth(279)).toBe(280)
    })

    it('上限超過は 640 にクランプ', () => {
      expect(clampCommentsWidth(641)).toBe(640)
      expect(clampCommentsWidth(10_000)).toBe(640)
    })

    it('非有限値は default (360) を返す', () => {
      expect(clampCommentsWidth(Number.NaN)).toBe(360)
    })
  })

  describe('shouldSnapCommentsToClosed (閾値 280)', () => {
    it('280 未満は true', () => {
      expect(shouldSnapCommentsToClosed(279.9)).toBe(true)
    })
    it('280 以上は false', () => {
      expect(shouldSnapCommentsToClosed(280)).toBe(false)
    })
  })

  describe('parseCommentsHint', () => {
    it('"0" は closed (width: null)', () => {
      expect(parseCommentsHint('0')).toEqual({ open: 'closed', width: null })
    })

    it('280-640 の数値は open (その幅)', () => {
      expect(parseCommentsHint('280')).toEqual({ open: 'open', width: 280 })
      expect(parseCommentsHint('640')).toEqual({ open: 'open', width: 640 })
    })

    it('範囲外 / 非数値は null', () => {
      expect(parseCommentsHint('279')).toBeNull()
      expect(parseCommentsHint('641')).toBeNull()
      expect(parseCommentsHint('auto')).toBeNull()
    })
  })

  describe('isValidStoredCommentsWidth', () => {
    it('280-640 の整数は true', () => {
      expect(isValidStoredCommentsWidth(280)).toBe(true)
      expect(isValidStoredCommentsWidth(640)).toBe(true)
    })

    it('範囲外は false', () => {
      expect(isValidStoredCommentsWidth(279)).toBe(false)
      expect(isValidStoredCommentsWidth(641)).toBe(false)
    })
  })
}
