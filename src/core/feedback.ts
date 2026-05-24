import type { Comment, PendingSelection } from './types'

/**
 * embedded-feedback / 既存 feedback.json から取り込む段階のコメント形 (pageIndex 未確定)。
 * import 時は `sourceLine` から逆引きして `pageIndex` を埋める (§9.1)。
 * sourceLine が欠損 / 範囲外なコメントは丸ごと破棄する (§6.6 invariants)。
 */
export type ImportedComment = Omit<Comment, 'pageIndex'>

/** unknown が object record としてプロパティ参照可能かを最初に狭める最小ガード */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object'

/** JSON 由来 number の NaN / Infinity を弾く。offset 計算に流す値なので有限値だけ許可する */
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/** ID や blockId のように空文字だと復元不能になる識別子向けの文字列ガード */
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0

/** JSON.parse 失敗を null に正規化し、呼び出し側が type guard だけで扱えるようにする */
const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// Comment フィールドのうち offset 系を一括検証する。max-statements を超えないよう
// isImportableComment 本体から分離する。
const hasValidOffsets = (value: Record<string, unknown>): boolean => {
  const { endOffset, startOffset } = value
  return (
    isFiniteNumber(startOffset) &&
    isFiniteNumber(endOffset) &&
    startOffset >= 0 &&
    endOffset > startOffset
  )
}

/**
 * embedded feedback / 既存 feedback.json から来る 1 コメント分の検証 (pageIndex 未確定段階)。
 * `sourceLine` は §6.6 invariant により必須で、1 以上の正整数でなければならない。
 * `pageIndex` は import 後に sourceLine から逆引きして埋めるためここでは検証しない。
 */
export const isImportableComment = (value: unknown): value is ImportedComment => {
  if (!isRecord(value)) {
    return false
  }
  const { blockId, comment, created, id, quote, sourceLine } = value
  return (
    isNonEmptyString(id) &&
    isNonEmptyString(blockId) &&
    typeof quote === 'string' &&
    typeof comment === 'string' &&
    isNonEmptyString(created) &&
    isFiniteNumber(sourceLine) &&
    sourceLine >= 1 &&
    hasValidOffsets(value)
  )
}

/** unknown 配列から有効な ImportedComment だけを取り出す。外部 JSON の壊れた要素は fail-soft で除外する */
export const commentsFromUnknown = (value: unknown): ImportedComment[] => {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter(isImportableComment)
}

/** 単一 HTML に埋め込まれた feedback から comments だけを抽出する。壊れていれば空配列扱い */
export const embeddedCommentsFromUnknown = (data: unknown): ImportedComment[] => {
  if (!isRecord(data)) {
    return []
  }
  return commentsFromUnknown(data.comments)
}

/**
 * ImportedComment の `sourceLine` を使って所属 page index を `resolvePageIndex(sourceLine)`
 * から引き、`Comment` (pageIndex 付き) に格上げする。逆引きに失敗 (該当ページ無し =
 * sourceLine が markdown 全体の範囲外) のコメントは破棄する (§6.6 / §9.1)。
 */
const tryResolveOne = (
  importedComment: ImportedComment,
  resolvePageIndex: (sourceLine: number) => number | null
): Comment | null => {
  const pageIndex = resolvePageIndex(importedComment.sourceLine)
  if (pageIndex === null) {
    return null
  }
  return { ...importedComment, pageIndex }
}

export const resolveImportedComments = (
  imported: readonly ImportedComment[],
  resolvePageIndex: (sourceLine: number) => number | null
): Comment[] => {
  const resolved: Comment[] = []
  for (const importedComment of imported) {
    const next = tryResolveOne(importedComment, resolvePageIndex)
    if (next) {
      resolved.push(next)
    }
  }
  return resolved
}

/**
 * floater の data-payload に入れた選択範囲 JSON を復元する。
 * offset が逆転・ゼロ幅・負値の場合はコメント対象として無効なので null を返す。
 */
export const parsePendingSelection = (raw: string): PendingSelection | null => {
  const parsed = parseJson(raw)
  if (!isRecord(parsed)) {
    return null
  }
  const { blockId, endOffset, quote, startOffset } = parsed
  if (
    !isNonEmptyString(blockId) ||
    !isFiniteNumber(endOffset) ||
    typeof quote !== 'string' ||
    !isFiniteNumber(startOffset) ||
    startOffset < 0 ||
    endOffset <= startOffset
  ) {
    return null
  }
  return { blockId, endOffset, quote, startOffset }
}

// テスト用の妥当な Comment fixture。各テストで一部だけ壊して type guard の境界を確認する。
// Phase 5 で sourceLine と pageIndex が必須化された。
const validCommentForTest = (): Comment => ({
  blockId: 'b001',
  comment: 'fix this',
  created: '2026-05-17T00:00:00.000Z',
  endOffset: 4,
  id: 'abc123',
  pageIndex: 0,
  quote: 'text',
  sourceLine: 1,
  startOffset: 0,
})

// テスト用 resolvePageIndex callback (sourceLine 5 だけ pageIndex 0 / それ以外は null)。
// unicorn/consistent-function-scoping ルールを満たすため module scope に置く。
const dropExceptSourceLine5 = (sourceLine: number): number | null => {
  if (sourceLine === 5) {
    return 0
  }
  return null
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('commentsFromUnknown', () => {
    it('valid comments only are retained', () => {
      const valid = validCommentForTest()
      expect(
        commentsFromUnknown([
          valid,
          { ...valid, id: '' },
          { ...valid, startOffset: '0' },
          { ...valid, endOffset: 0 },
        ])
      ).toEqual([valid])
    })

    it('non-array values become an empty list', () => {
      expect(commentsFromUnknown({ comments: [] })).toEqual([])
    })

    it('sourceLine 欠損 / 0 以下のコメントは破棄する (§6.6 invariant)', () => {
      const valid = validCommentForTest()
      const { sourceLine: _sl, ...withoutSourceLine } = valid
      expect(
        commentsFromUnknown([
          valid,
          withoutSourceLine,
          { ...valid, sourceLine: 0 },
          { ...valid, sourceLine: -1 },
          { ...valid, sourceLine: 'not a number' },
        ])
      ).toEqual([valid])
    })
  })

  describe('resolveImportedComments', () => {
    it('sourceLine から pageIndex を引いて Comment 形に格上げする', () => {
      const imported: ImportedComment[] = [
        { ...validCommentForTest(), id: 'a', sourceLine: 5 },
        { ...validCommentForTest(), id: 'b', sourceLine: 100 },
      ]
      const result = resolveImportedComments(imported, (sourceLine): number | null => {
        if (sourceLine === 5) {
          return 1
        }
        if (sourceLine === 100) {
          return 3
        }
        return null
      })
      expect(result.map((comment): [string, number] => [comment.id, comment.pageIndex])).toEqual([
        ['a', 1],
        ['b', 3],
      ])
    })

    it('resolvePageIndex が null を返すコメントは破棄する (§9.1)', () => {
      const imported: ImportedComment[] = [
        { ...validCommentForTest(), id: 'in', sourceLine: 5 },
        { ...validCommentForTest(), id: 'out', sourceLine: 999 },
      ]
      const result = resolveImportedComments(imported, dropExceptSourceLine5)
      expect(result.map((comment): string => comment.id)).toEqual(['in'])
    })
  })

  describe('parsePendingSelection', () => {
    it('parses a valid pending selection', () => {
      expect(
        parsePendingSelection(
          JSON.stringify({ blockId: 'b001', endOffset: 4, quote: 'text', startOffset: 0 })
        )
      ).toEqual({ blockId: 'b001', endOffset: 4, quote: 'text', startOffset: 0 })
    })

    it('returns null for invalid JSON or invalid offsets', () => {
      expect(parsePendingSelection('{')).toBeNull()
      expect(
        parsePendingSelection(
          JSON.stringify({ blockId: 'b001', endOffset: 0, quote: 'text', startOffset: 0 })
        )
      ).toBeNull()
    })
  })
}
