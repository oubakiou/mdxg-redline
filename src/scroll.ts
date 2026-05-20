// --- Smooth scroll ----------------------------------------------------------
// 対象要素を最も近いスクロール可能祖先の縦中央へ、距離に依らず固定時間で
// アニメーションする。近距離・遠距離のジャンプ体感を揃えるための設計。

/** スクロールアニメーションの所要時間。固定値にしているのは距離によらず体感を揃えるため */
const SCROLL_DURATION_MS = 350

/** 渡されたノードから親方向に登り、overflow が auto/scroll かつスクロール余地がある最初の祖先を返す */
const findScrollableAncestorFrom = (node: Element | null): Element => {
  if (!node) {
    return document.scrollingElement || document.documentElement
  }
  const oy = getComputedStyle(node).overflowY
  if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) {
    return node
  }
  return findScrollableAncestorFrom(node.parentElement)
}

/** 対象要素自身を除外して、スクロール対象となる祖先を探すラッパー */
const findScrollableAncestor = (el: Element): Element =>
  findScrollableAncestorFrom(el.parentElement)

// ease-in-out cubic — duration 全体に対して滑らかに加減速する
const easeInOutCubic = (progress: number): number => {
  if (progress < 0.5) {
    return 4 * progress * progress * progress
  }
  return 1 - (-2 * progress + 2) ** 3 / 2
}

/**
 * 開始位置・終端位置・スクロールコンテナを 1 度の getBoundingClientRect 計算で確定する。
 * 終端は scrollHeight - clientHeight に clamp して、行き過ぎ・負方向への暴走を防ぐ。
 */
const computeScrollPlan = (target: Element): { end: number; scroller: Element; start: number } => {
  const scroller = findScrollableAncestor(target)
  const sRect = scroller.getBoundingClientRect()
  const tRect = target.getBoundingClientRect()
  const delta = tRect.top + tRect.height / 2 - (sRect.top + sRect.height / 2)
  const start = scroller.scrollTop
  const max = scroller.scrollHeight - scroller.clientHeight
  const end = Math.max(0, Math.min(start + delta, max))
  return { end, scroller, start }
}

/**
 * 対象要素をスクロールコンテナの中央へ固定時間でスムーズスクロールする。
 * 1px 未満の差ならアニメーションを発火しない（reapply 後の安定状態でもブレないように）。
 */
export const smoothScrollToCenter = (
  target: Element,
  duration: number = SCROLL_DURATION_MS
): void => {
  const { end, scroller, start } = computeScrollPlan(target)
  if (Math.abs(end - start) < 1) {
    return
  }
  const t0 = performance.now()
  const step = (now: number): void => {
    const progress = Math.min((now - t0) / duration, 1)
    scroller.scrollTop = start + (end - start) * easeInOutCubic(progress)
    if (progress < 1) {
      requestAnimationFrame(step)
    }
  }
  requestAnimationFrame(step)
}

/**
 * MARK: In-Source Testing
 * @example vp test src/scroll.ts
 */

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest

  describe('easeInOutCubic', () => {
    it('0 を渡すと 0 を返す', () => {
      expect(easeInOutCubic(0)).toBe(0)
    })

    it('1 を渡すと 1 を返す', () => {
      expect(easeInOutCubic(1)).toBe(1)
    })

    it('0.5 を渡すと 0.5 を返す (中点で対称)', () => {
      expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 10)
    })

    it('進行率に対して単調増加する', () => {
      const samples = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].map(easeInOutCubic)
      for (let index = 1; index < samples.length; index += 1) {
        expect(samples[index]).toBeGreaterThanOrEqual(samples[index - 1])
      }
    })
  })
}
