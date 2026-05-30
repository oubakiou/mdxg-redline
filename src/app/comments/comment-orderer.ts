// comments panel が表示する Comment 列の決定論的順序付け。pure ロジックのみで DOM / state 非依存。
//
// mark の DOM 順は activePageIndex でフィルタされた subset しか持たないため、別ページの mark が
// 存在しないモードでも全コメントを文書順に並べたい場合は本関数で組み立てる。

import type { Comment } from '../../core/types'

/**
 * 全コメントを文書順 (pageIndex → sourceLine → startOffset) に並べたコピーを返す。
 * 入力配列は破壊しない。
 */
export const orderedComments = (comments: Comment[]): Comment[] =>
  [...comments].toSorted((left, right): number => {
    if (left.pageIndex !== right.pageIndex) {
      return left.pageIndex - right.pageIndex
    }
    if (left.sourceLine !== right.sourceLine) {
      return left.sourceLine - right.sourceLine
    }
    return left.startOffset - right.startOffset
  })

const commentForTest = (id: string): Comment => ({
  blockId: 'b001',
  comment: 'body',
  created: '2026-05-17T00:00:00.000Z',
  endOffset: 4,
  id,
  pageIndex: 0,
  quote: 'text',
  sourceLine: 1,
  startOffset: 0,
})

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('orderedComments', () => {
    it('pageIndex → sourceLine → startOffset の順で並ぶ (DOM 非依存)', () => {
      const page0Top = { ...commentForTest('p0-top'), pageIndex: 0, sourceLine: 1, startOffset: 0 }
      const page0Bottom = {
        ...commentForTest('p0-bot'),
        pageIndex: 0,
        sourceLine: 10,
        startOffset: 0,
      }
      const page1Top = { ...commentForTest('p1-top'), pageIndex: 1, sourceLine: 3, startOffset: 0 }
      expect(
        orderedComments([page1Top, page0Bottom, page0Top]).map((comment): string => comment.id)
      ).toEqual(['p0-top', 'p0-bot', 'p1-top'])
    })

    it('同じ sourceLine 内では startOffset 順に並ぶ', () => {
      const left = { ...commentForTest('left'), pageIndex: 0, sourceLine: 5, startOffset: 2 }
      const right = { ...commentForTest('right'), pageIndex: 0, sourceLine: 5, startOffset: 18 }
      expect(orderedComments([right, left]).map((comment): string => comment.id)).toEqual([
        'left',
        'right',
      ])
    })

    it('入力配列を破壊しない', () => {
      const input = [
        { ...commentForTest('a'), pageIndex: 1 },
        { ...commentForTest('b'), pageIndex: 0 },
      ]
      const snapshot = input.map((comment): string => comment.id)
      orderedComments(input)
      expect(input.map((comment): string => comment.id)).toEqual(snapshot)
    })
  })
}
