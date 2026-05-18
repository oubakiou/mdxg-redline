import type { Comment, DocumentSnapshot, PendingSelection } from './types'

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

/**
 * 永続化・import・embedded feedback から来る 1 コメント分の検証。
 * DOM への再適用に必要な位置情報が壊れているコメントはここで落とし、他の有効コメントは残す。
 */
export const isComment = (value: unknown): value is Comment => {
  if (!isRecord(value)) {
    return false
  }
  const { blockId, comment, created, endOffset, id, quote, startOffset } = value
  return (
    isNonEmptyString(id) &&
    isNonEmptyString(blockId) &&
    typeof quote === 'string' &&
    typeof comment === 'string' &&
    isNonEmptyString(created) &&
    isFiniteNumber(startOffset) &&
    isFiniteNumber(endOffset) &&
    startOffset >= 0 &&
    endOffset > startOffset
  )
}

/** unknown 配列から有効な Comment だけを取り出す。外部 JSON の壊れた要素は fail-soft で除外する */
export const commentsFromUnknown = (value: unknown): Comment[] => {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter(isComment)
}

/** Store.get から戻る unknown が、少なくとも markdown を持つ保存済み snapshot かを見る */
const isDocumentSnapshot = (value: unknown): value is DocumentSnapshot => {
  if (!isRecord(value)) {
    return false
  }
  return typeof value.markdown === 'string'
}

/** 保存済み snapshot から comments だけを復元する。snapshot 自体が壊れていれば空配列に倒す */
export const commentsFromStored = (stored: unknown): Comment[] => {
  if (!isDocumentSnapshot(stored)) {
    return []
  }
  return commentsFromUnknown(stored.comments)
}

/** 単一 HTML に埋め込まれた feedback から comments だけを抽出する。壊れていれば空配列扱い */
export const embeddedCommentsFromUnknown = (data: unknown): Comment[] => {
  if (!isRecord(data)) {
    return []
  }
  return commentsFromUnknown(data.comments)
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
const validCommentForTest = (): Comment => ({
  blockId: 'b001',
  comment: 'fix this',
  created: '2026-05-17T00:00:00.000Z',
  endOffset: 4,
  id: 'abc123',
  quote: 'text',
  startOffset: 0,
})

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
