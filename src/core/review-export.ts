import type { Comment, ExportComment, ExportPayload } from './types'
import type { BlockAnchor } from './block-anchors'

export interface ReviewExportState {
  blockAnchors: Map<string, BlockAnchor>
  comments: Comment[]
  docHash: string | null
  docName: string | null
}

/**
 * 1 コメント分を export 用に正規化する。
 * 内部 anchor (blockId / startOffset / endOffset) は外し、blockAnchors Map から markdown 上の
 * 開始行と祖先見出しを引いて差し替える。anchor が見つからない場合は安全側に倒し、
 * sourceLine=0 / headingPath=[] とする（LLM 側は quote grep にフォールバックする想定）。
 */
const EMPTY_ANCHOR: BlockAnchor = { headingPath: [], sourceLine: 0 }

const toExportComment = (
  comment: Comment,
  blockAnchors: Map<string, BlockAnchor>
): ExportComment => {
  const anchor = blockAnchors.get(comment.blockId) ?? EMPTY_ANCHOR
  return {
    comment: comment.comment,
    created: comment.created,
    headingPath: anchor.headingPath,
    id: comment.id,
    quote: comment.quote,
    sourceLine: anchor.sourceLine,
  }
}

/**
 * エクスポート用 JSON ペイロード。
 * `comments` を明示的にプロパティ列挙してマップしているのは、内部にしかない一時フィールドが将来追加されても
 * 出力に漏れないようにするため（schema-pinning）。
 * docHash が未確定（markdown 未読込）のときに export が呼ばれることはガード済みだが、
 * 型上の null は空文字に正規化して payload を string 必須に保つ。
 */
export const buildReviewExportPayload = (state: ReviewExportState): ExportPayload => ({
  comments: state.comments.map(
    (comment): ExportComment => toExportComment(comment, state.blockAnchors)
  ),
  docHash: state.docHash ?? '',
  document: state.docName,
  exportedAt: new Date().toISOString(),
})

/**
 * Write feedback.json の dirty 判定用署名。
 * exportedAt のように毎回変動する値は含めず、docHash + comments のスナップショットを JSON 化する。
 * lastWrittenSignature と等価なら「同じ内容を再度書き出しても無意味」と判定できる。
 */
export const feedbackSignature = (state: { comments: Comment[]; docHash: string | null }): string =>
  JSON.stringify({ comments: state.comments, docHash: state.docHash })

/** ダウンロード時のファイル名ベース。docName から拡張子を除き、未設定なら 'review' を返す */
export const exportBaseName = (docName: string | null): string => {
  if (docName) {
    return docName.replace(/\.[^.]+$/, '')
  }
  return 'review'
}

/** トースト用のコメント件数ラベル。単数/複数を簡易的に切り替える（i18n 対応はしていない） */
export const commentCountLabel = (count: number): string => {
  if (count === 1) {
    return `${count} comment`
  }
  return `${count} comments`
}

const dummyCommentForTest = (id: string): Comment => ({
  blockId: '',
  comment: '',
  created: '',
  endOffset: 1,
  id,
  quote: '',
  startOffset: 0,
})

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('exportBaseName', () => {
    it('docName から拡張子を除いた名前を返す', () => {
      expect(exportBaseName('notes.md')).toBe('notes')
    })

    it('複数ドットがある場合は最後の拡張子のみ除去', () => {
      expect(exportBaseName('foo.bar.md')).toBe('foo.bar')
    })

    it('docName 未設定なら "review"', () => {
      expect(exportBaseName(null)).toBe('review')
    })
  })

  describe('commentCountLabel', () => {
    it('1 件のときは単数形', () => {
      expect(commentCountLabel(1)).toBe('1 comment')
    })

    it('0 件のときは複数形 (i18n 非対応の既知挙動)', () => {
      expect(commentCountLabel(0)).toBe('0 comments')
    })

    it('2 件以上のときは複数形', () => {
      expect(commentCountLabel(3)).toBe('3 comments')
    })
  })

  describe('buildReviewExportPayload', () => {
    it('state から export payload を構築する', () => {
      const first = dummyCommentForTest('a')
      const second = dummyCommentForTest('b')
      const result = buildReviewExportPayload({
        blockAnchors: new Map(),
        comments: [first, second],
        docHash: 'a1b2c3d4e5f6a7b8',
        docName: 'review.md',
      })

      expect(result.comments).toHaveLength(2)
      expect(result.comments[0]).toMatchObject({ headingPath: [], id: 'a', sourceLine: 0 })
      expect(result.comments[1]).toMatchObject({ headingPath: [], id: 'b', sourceLine: 0 })
      expect(result.docHash).toBe('a1b2c3d4e5f6a7b8')
      expect(result.document).toBe('review.md')
      expect(result.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })

    it('blockAnchors から headingPath と sourceLine を引いて埋める', () => {
      const comment = { ...dummyCommentForTest('c1'), blockId: 'b002' }
      const result = buildReviewExportPayload({
        blockAnchors: new Map([['b002', { headingPath: ['# Root'], sourceLine: 42 }]]),
        comments: [comment],
        docHash: 'h',
        docName: 'r.md',
      })

      expect(result.comments[0]).toMatchObject({
        headingPath: ['# Root'],
        sourceLine: 42,
      })
    })

    it('docHash が null なら空文字に正規化する', () => {
      const result = buildReviewExportPayload({
        blockAnchors: new Map(),
        comments: [],
        docHash: null,
        docName: null,
      })

      expect(result.docHash).toBe('')
    })
  })
}
