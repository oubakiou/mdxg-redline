// flat 配列 (TOC / comments など) の中で ↑↓ / Home / End によるフォーカス移動先 index を
// 計算する pure helper。pane を増やしても挙動 drift を起こさないよう 1 箇所に集約する。
// MDXG §13 [MUST] 矢印キーのフォーカス移動仕様。

export type FocusListDirection = 'down' | 'up' | 'home' | 'end'

const resolveDownIndex = (count: number, currentIndex: number): number => {
  if (currentIndex < 0) {
    return 0
  }
  return Math.min(currentIndex + 1, count - 1)
}

const resolveUpIndex = (count: number, currentIndex: number): number => {
  if (currentIndex < 0) {
    return count - 1
  }
  return Math.max(currentIndex - 1, 0)
}

/**
 * flat な focusable リストの中で現在 index に対する次の focus 先 index を返す pure 関数。
 * `currentIndex < 0` (リスト外に focus がある状態) で方向キーが押された時は、`down` なら
 * 先頭、`up` なら末尾にフォールバックする (long list で起点を選びやすくするため。
 * 過去の TOC 仕様に揃えている)。
 */
export const resolveNextFocusIndex = (
  count: number,
  currentIndex: number,
  direction: FocusListDirection
): number => {
  if (count === 0) {
    return -1
  }
  if (direction === 'home') {
    return 0
  }
  if (direction === 'end') {
    return count - 1
  }
  if (direction === 'down') {
    return resolveDownIndex(count, currentIndex)
  }
  return resolveUpIndex(count, currentIndex)
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('resolveNextFocusIndex (§13 [MUST] 矢印キーのフォーカス移動)', () => {
    it('count=0 では -1 を返す (focusable 0 件)', () => {
      expect(resolveNextFocusIndex(0, -1, 'down')).toBe(-1)
      expect(resolveNextFocusIndex(0, 0, 'home')).toBe(-1)
    })

    it("'home' は currentIndex に関わらず 0", () => {
      expect(resolveNextFocusIndex(5, 3, 'home')).toBe(0)
      expect(resolveNextFocusIndex(5, -1, 'home')).toBe(0)
    })

    it("'end' は currentIndex に関わらず末尾", () => {
      expect(resolveNextFocusIndex(5, 0, 'end')).toBe(4)
      expect(resolveNextFocusIndex(5, -1, 'end')).toBe(4)
    })

    it("'down' は +1 し末尾で clamp", () => {
      expect(resolveNextFocusIndex(5, 2, 'down')).toBe(3)
      expect(resolveNextFocusIndex(5, 4, 'down')).toBe(4)
    })

    it("'down' で currentIndex < 0 (pane 外から ↓) は先頭にフォールバック", () => {
      expect(resolveNextFocusIndex(5, -1, 'down')).toBe(0)
    })

    it("'up' は -1 し先頭で clamp", () => {
      expect(resolveNextFocusIndex(5, 2, 'up')).toBe(1)
      expect(resolveNextFocusIndex(5, 0, 'up')).toBe(0)
    })

    it("'up' で currentIndex < 0 (pane 外から ↑) は末尾にフォールバック", () => {
      expect(resolveNextFocusIndex(5, -1, 'up')).toBe(4)
    })
  })
}
