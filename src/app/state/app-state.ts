// アプリ全体の単一状態 (state) と、Write feedback.json の dirty 追跡。
// state は import した複数モジュールから共有される mutable オブジェクトとしてエクスポートする
// (workspace.ts と同じ pattern)。

import type { BlockAnchor } from '../../core/block-anchors'
import type { Comment } from '../../core/types'
import type { Page } from '../../core/page-split'
import { feedbackSignature } from '../../core/review-export'

/**
 * アプリ全体の現在状態。レンダリング・保存・サイドバー描画はすべてこの 1 箇所を参照する単一の真の源として扱う。
 * docHash は markdown 本文の SHA-256 先頭 8 バイト hex で、保存キーや workspace 取り込みの版差分検知に用いる。
 *
 * pages / activePageIndex は MDXG §6–§9 Virtual Pages 用 (DESIGN.md §5 / §12 §6 Virtual Pages)。
 * pages は markdown 読み込み時に確定し以降 read-only、activePageIndex は UI 切替で動く。
 * Phase 1 では UI は単一スクロール維持で、`pages` は state 上に乗っているだけ。
 */
export const state: {
  activePageIndex: number
  blockAnchors: Map<string, BlockAnchor>
  blockOriginalHTML: Map<string, string>
  comments: Comment[]
  docHash: string | null
  docName: string | null
  lastWrittenSignature: string | null
  markdown: string
  pages: Page[]
} = {
  activePageIndex: 0,
  blockAnchors: new Map(),
  blockOriginalHTML: new Map(),
  comments: [],
  docHash: null,
  docName: null,
  lastWrittenSignature: null,
  markdown: '',
  pages: [],
}

/**
 * Write feedback.json の dirty 判定。state.lastWrittenSignature と現在の payload 署名を比較し、
 * 一度も書き出していない (null) または内容が変わっていれば dirty とする。
 */
export const isFeedbackDirty = (): boolean => {
  if (state.lastWrittenSignature === null) {
    return true
  }
  return state.lastWrittenSignature !== feedbackSignature(state)
}

/** writeFeedback / changeOutputFolder / boot で署名を入れ替える際の唯一の入り口 */
export const markFeedbackWritten = (): void => {
  state.lastWrittenSignature = feedbackSignature(state)
}

export const markFeedbackUnsaved = (): void => {
  state.lastWrittenSignature = null
}

export interface LoadDocumentStatePayload {
  activePageIndex: number
  docHash: string
  docName: string
  markdown: string
  pages: Page[]
}

/**
 * 新規 markdown 取り込み時の state 一括書き込み。docName / markdown / docHash / pages /
 * activePageIndex を payload から流し込み、comments は必ず空配列にリセットする。
 * 新しい本文に旧コメントを残すと §6 アンカリングが滑るため、空配列での再構築が正しい契約。
 * state 直 mutate を 1 箇所に閉じ込めるための narrow operation API (DESIGN.md §5)。
 */
export const loadDocumentState = (payload: LoadDocumentStatePayload): void => {
  state.activePageIndex = payload.activePageIndex
  state.comments = []
  state.docHash = payload.docHash
  state.docName = payload.docName
  state.markdown = payload.markdown
  state.pages = payload.pages
}

/**
 * comments 配列を一括置換する narrow operation API。embedded-feedback 取り込み・全削除・
 * 1 件削除 (filter 結果の再代入) など「コメント集合全体を差し替える」経路を 1 箇所に集約する
 * (DESIGN.md §5)。caller が渡した配列を defensive copy するため、caller 側の元配列を
 * 後から mutate しても state には伝播しない。
 */
export const replaceComments = (next: readonly Comment[]): void => {
  state.comments = [...next]
}

const makeTestComment = (id: string): Comment => ({
  blockId: 'b001',
  comment: 'c',
  created: '2026-01-01T00:00:00.000Z',
  endOffset: 1,
  id,
  pageIndex: 0,
  quote: 'q',
  sourceLine: 1,
  startOffset: 0,
})

if (import.meta.vitest) {
  const { afterEach, beforeEach, describe, expect, it } = import.meta.vitest

  // state はモジュール mutable shared object のため、各テストで lastWrittenSignature の
  // 復元を強制する。他テスト経由で混入した値を独立性のために打ち消す。
  let savedSignature: string | null = null
  beforeEach(() => {
    savedSignature = state.lastWrittenSignature
  })
  afterEach(() => {
    state.lastWrittenSignature = savedSignature
  })

  describe('isFeedbackDirty', () => {
    it('lastWrittenSignature が null なら dirty (= true)', () => {
      state.lastWrittenSignature = null
      expect(isFeedbackDirty()).toBe(true)
    })

    it('現在 state の signature と一致すれば clean (= false)', () => {
      state.lastWrittenSignature = feedbackSignature(state)
      expect(isFeedbackDirty()).toBe(false)
    })

    it('signature が異なれば dirty (= true)', () => {
      state.lastWrittenSignature = 'stale-signature'
      expect(isFeedbackDirty()).toBe(true)
    })
  })

  describe('markFeedbackWritten', () => {
    it('現在 state の signature を lastWrittenSignature にセットする', () => {
      state.lastWrittenSignature = null
      markFeedbackWritten()
      expect(state.lastWrittenSignature).toBe(feedbackSignature(state))
    })
  })

  describe('markFeedbackUnsaved', () => {
    it('lastWrittenSignature を null に戻す (Write 後に内容変更があった場合のリセット用)', () => {
      state.lastWrittenSignature = 'something'
      markFeedbackUnsaved()
      expect(state.lastWrittenSignature).toBeNull()
    })
  })

  describe('loadDocumentState', () => {
    // 各テスト後に state の文書系フィールドを初期値に戻す。app-state は module shared mutable で
    // 他テストへ漏れるため、loadDocumentState 経由の書き込みを構造的に巻き戻す。
    const SNAPSHOT: {
      activePageIndex: number
      blockAnchors: Map<string, BlockAnchor>
      blockOriginalHTML: Map<string, string>
      comments: Comment[]
      docHash: string | null
      docName: string | null
      markdown: string
      pages: Page[]
    } = {
      activePageIndex: 0,
      blockAnchors: new Map(),
      blockOriginalHTML: new Map(),
      comments: [],
      docHash: null,
      docName: null,
      markdown: '',
      pages: [],
    }
    let savedDoc: typeof SNAPSHOT = SNAPSHOT
    beforeEach(() => {
      savedDoc = {
        activePageIndex: state.activePageIndex,
        blockAnchors: state.blockAnchors,
        blockOriginalHTML: state.blockOriginalHTML,
        comments: state.comments,
        docHash: state.docHash,
        docName: state.docName,
        markdown: state.markdown,
        pages: state.pages,
      }
    })
    afterEach(() => {
      state.activePageIndex = savedDoc.activePageIndex
      state.blockAnchors = savedDoc.blockAnchors
      state.blockOriginalHTML = savedDoc.blockOriginalHTML
      state.comments = savedDoc.comments
      state.docHash = savedDoc.docHash
      state.docName = savedDoc.docName
      state.markdown = savedDoc.markdown
      state.pages = savedDoc.pages
    })

    const dummyComment: Comment = {
      blockId: 'b001',
      comment: 'old',
      created: '2026-01-01T00:00:00.000Z',
      endOffset: 5,
      id: 'cmt-old',
      pageIndex: 0,
      quote: 'hello',
      sourceLine: 1,
      startOffset: 0,
    }

    const samplePayload = {
      activePageIndex: 1,
      docHash: 'abcd1234ef567890',
      docName: 'spec.md',
      markdown: '# Hello\n',
      pages: [] as Page[],
    }

    it('payload の docName / markdown / docHash / pages / activePageIndex を state に流し込む', () => {
      loadDocumentState(samplePayload)
      expect(state.activePageIndex).toBe(1)
      expect(state.docHash).toBe('abcd1234ef567890')
      expect(state.docName).toBe('spec.md')
      expect(state.markdown).toBe('# Hello\n')
      expect(state.pages).toBe(samplePayload.pages)
    })

    it('comments は payload に含まれず常に空配列にリセットされる (§6 アンカリング不整合防止の契約)', () => {
      state.comments = [dummyComment]
      loadDocumentState(samplePayload)
      expect(state.comments).toEqual([])
    })

    it('lastWrittenSignature には触らない (dirty 判定の責務は markFeedback* 系に分離)', () => {
      state.lastWrittenSignature = 'untouched'
      loadDocumentState(samplePayload)
      expect(state.lastWrittenSignature).toBe('untouched')
    })

    it('blockAnchors / blockOriginalHTML には触らない (doc-mount 側の責務)', () => {
      const anchors = new Map([['b001', { headingPath: [], sourceLine: 1 }]])
      const original = new Map([['b001', '<p>x</p>']])
      state.blockAnchors = anchors
      state.blockOriginalHTML = original
      loadDocumentState(samplePayload)
      expect(state.blockAnchors).toBe(anchors)
      expect(state.blockOriginalHTML).toBe(original)
    })
  })

  describe('replaceComments', () => {
    let savedComments: Comment[] = []
    beforeEach(() => {
      savedComments = state.comments
    })
    afterEach(() => {
      state.comments = savedComments
    })

    it('next の内容で state.comments を置き換える', () => {
      state.comments = [makeTestComment('old')]
      replaceComments([makeTestComment('a'), makeTestComment('b')])
      expect(state.comments.map((entry): string => entry.id)).toEqual(['a', 'b'])
    })

    it('空配列で全削除', () => {
      state.comments = [makeTestComment('x')]
      replaceComments([])
      expect(state.comments).toEqual([])
    })

    it('defensive copy: 渡した配列を後から mutate しても state には伝播しない', () => {
      const source = [makeTestComment('a')]
      replaceComments(source)
      source.push(makeTestComment('b'))
      expect(state.comments.map((entry): string => entry.id)).toEqual(['a'])
    })

    it('state.comments と参照同一にならない (caller の mutate 経路で state を触れない)', () => {
      const source: Comment[] = [makeTestComment('a')]
      replaceComments(source)
      expect(state.comments).not.toBe(source)
    })
  })
}
