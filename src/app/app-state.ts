// アプリ全体の単一状態 (state) と、Write feedback.json の dirty 追跡。
// state は import した複数モジュールから共有される mutable オブジェクトとしてエクスポートする
// (workspace.ts と同じ pattern)。

import type { BlockAnchor } from '../core/block-anchors'
import type { Comment } from '../core/types'
import { feedbackSignature } from '../core/review-export'

/**
 * アプリ全体の現在状態。レンダリング・保存・サイドバー描画はすべてこの 1 箇所を参照する単一の真の源として扱う。
 * docHash は markdown 本文の SHA-256 先頭 8 バイト hex で、保存キーや workspace 取り込みの版差分検知に用いる。
 */
export const state: {
  blockAnchors: Map<string, BlockAnchor>
  blockOriginalHTML: Map<string, string>
  comments: Comment[]
  docHash: string | null
  docName: string | null
  lastWrittenSignature: string | null
  markdown: string
} = {
  blockAnchors: new Map(),
  blockOriginalHTML: new Map(),
  comments: [],
  docHash: null,
  docName: null,
  lastWrittenSignature: null,
  markdown: '',
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
}
