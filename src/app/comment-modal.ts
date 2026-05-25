// コメント入力モーダルの状態管理・イベント配線・保存処理。
// floater (#floater) クリックで起動し、保留中の選択範囲 (PendingSelection) を保持したまま
// 「Save」で state.comments に追加し、関連 UI を更新する。

import type { Comment, PendingSelection } from '../core/types'
import { qs, qsInput, toast, uid } from './dom-utils'
import { parsePendingSelection } from '../core/feedback'
import { reapplyAllMarks } from './mark-engine'
import { renderComments } from './comments'
import { state } from './app-state'

/**
 * コメント入力モーダルの状態。
 * pendingSelection に「どこに対するコメントか」の情報（blockId, offsets, quote）を保持し、
 * Save 時にこれを基準にコメントを生成する。Cancel/Esc で必ず null へ戻すこと（誤コミット防止）。
 */
const modalState: { pendingSelection: PendingSelection | null } = {
  pendingSelection: null,
}

/** 選択範囲を保留状態にセットしてモーダルを開く。focus は CSS transition 後を狙って 50ms 遅延 */
const openModal = (sel: PendingSelection): void => {
  modalState.pendingSelection = sel
  qs('#modal-quote').textContent = `“${sel.quote}”`
  qsInput('#modal-input').value = ''
  qs('#modal').classList.add('open')
  setTimeout((): void => qsInput('#modal-input').focus(), 50)
}

/** モーダルを閉じ、pendingSelection をクリアして次回開閉時の漏洩を防ぐ */
export const closeCommentModal = (): void => {
  qs('#modal').classList.remove('open')
  modalState.pendingSelection = null
}

interface CommentContext {
  /** 全 markdown の blockAnchors。`sourceLine` の元 markdown 全体 1-origin 行番号を持つ */
  blockAnchors: Map<string, { sourceLine: number }>
  /** blockAnchor 解決失敗時の sourceLine フォールバック先 (祖先 page の sourceLineStart) */
  fallbackSourceLine: number
}

/**
 * 保留中の選択範囲と本文からコメントオブジェクトを組み立てる純粋関数。
 * `pageIndex` は selection の祖先 `<section.virtual-page>` から解決済みの値を直接受け取る
 * (selection.ts の `pageIndexForBlock`、§6.5)。
 *
 * 該当 blockAnchor が無い場合は `fallbackSourceLine` (= selection 祖先 page の `sourceLineStart`)
 * にフォールバックする。§6.6 invariant `sourceLine >= 1` を保つことで、保存直後の state と
 * reload 後の `isImportableComment` 検証で挙動が一致する。通常パスでは blockAnchors と DOM
 * blockId が 1:1 なのでフォールバックは触らず、構造的不整合があった場合の防御的経路として残す。
 */
const resolveSourceLine = (blockId: string, context: CommentContext): number => {
  const anchor = context.blockAnchors.get(blockId)
  if (!anchor) {
    return context.fallbackSourceLine
  }
  return anchor.sourceLine
}

const commentFromSelection = (
  selection: PendingSelection,
  body: string,
  context: CommentContext
): Comment => ({
  blockId: selection.blockId,
  comment: body,
  created: new Date().toISOString(),
  endOffset: selection.endOffset,
  id: uid(),
  pageIndex: selection.pageIndex,
  quote: selection.quote,
  sourceLine: resolveSourceLine(selection.blockId, context),
  startOffset: selection.startOffset,
})

/**
 * モーダルの「Save」ボタン押下時の処理。
 * 本文空 or 保留選択 null の場合は無視（誤コミット防止）。保存後に modal を閉じる前後で副作用を一通り回す。
 * 新規コメントの sourceLine フォールバックは selection 祖先 page の sourceLineStart を使う
 * (§6.5 / §9.1)。
 */
const resolveSelectionPageSourceLineStart = (pageIndex: number): number => {
  const page = state.pages[pageIndex]
  if (!page) {
    return 1
  }
  return page.sourceLineStart
}

const saveModalComment = async (): Promise<void> => {
  const body = qsInput('#modal-input').value.trim()
  const selection = modalState.pendingSelection
  if (!body || !selection) {
    return
  }
  const newComment = commentFromSelection(selection, body, {
    blockAnchors: state.blockAnchors,
    fallbackSourceLine: resolveSelectionPageSourceLineStart(selection.pageIndex),
  })
  state.comments.push(newComment)
  reapplyAllMarks()
  renderComments()
  closeCommentModal()
  toast('Comment added')
}

export const wireCommentModal = (): void => {
  qs('#floater').addEventListener('mousedown', (event): void => {
    event.preventDefault()
    const floater = qs('#floater')
    const { payload } = floater.dataset
    if (!payload) {
      return
    }
    const parsed = parsePendingSelection(payload)
    if (!parsed) {
      return
    }
    openModal(parsed)
    floater.style.display = 'none'
  })
  qs('#modal-cancel').addEventListener('click', closeCommentModal)
  qs('#modal').addEventListener('click', (event): void => {
    const { target } = event
    if (target instanceof HTMLElement && target.id === 'modal') {
      closeCommentModal()
    }
  })
  qs('#modal-save').addEventListener('click', async (): Promise<void> => saveModalComment())
}

// テスト用 CommentContext / PendingSelection fixture。固有の state を持たないため module scope に置く
// (unicorn/consistent-function-scoping ルール対応)。
const dummyContext = (overrides: Partial<CommentContext> = {}): CommentContext => ({
  blockAnchors: new Map(),
  fallbackSourceLine: 1,
  ...overrides,
})

const dummySelection = (overrides: Partial<PendingSelection> = {}): PendingSelection => ({
  blockId: 'b001',
  endOffset: 1,
  pageIndex: 0,
  quote: 'q',
  startOffset: 0,
  ...overrides,
})

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest

  describe('commentFromSelection', () => {
    it('選択範囲と本文から正しいコメントを組み立てる', () => {
      const selection = dummySelection({
        blockId: 'b001',
        endOffset: 20,
        quote: '引用テキスト',
        startOffset: 10,
      })
      const result = commentFromSelection(selection, 'コメント本文', dummyContext())
      expect(result.blockId).toBe('b001')
      expect(result.startOffset).toBe(10)
      expect(result.endOffset).toBe(20)
      expect(result.quote).toBe('引用テキスト')
      expect(result.comment).toBe('コメント本文')
      expect(typeof result.id).toBe('string')
      expect(result.id.length).toBeGreaterThan(0)
      // created は ISO8601 形式のはず
      expect(result.created).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })

    it('id は呼び出しごとに異なる', () => {
      const sel = dummySelection({ blockId: 'b' })
      const first = commentFromSelection(sel, 'x', dummyContext())
      const second = commentFromSelection(sel, 'x', dummyContext())
      expect(first.id).not.toBe(second.id)
    })

    it('pageIndex は selection から取り込まれる (§6.5、Stacked View では祖先 section 由来)', () => {
      const sel = dummySelection({ pageIndex: 3 })
      const result = commentFromSelection(sel, 'x', dummyContext())
      expect(result.pageIndex).toBe(3)
    })

    it('sourceLine は blockAnchors から逆引きする (元 markdown 全体の 1-origin 維持)', () => {
      const sel = dummySelection({ blockId: 'b002' })
      const result = commentFromSelection(
        sel,
        'x',
        dummyContext({ blockAnchors: new Map([['b002', { sourceLine: 42 }]]) })
      )
      expect(result.sourceLine).toBe(42)
    })

    it('blockAnchor が見つからなければ fallbackSourceLine にフォールバック (§6.6 invariant sourceLine>=1 を維持)', () => {
      const sel = dummySelection({ blockId: 'b999' })
      const result = commentFromSelection(sel, 'x', dummyContext({ fallbackSourceLine: 42 }))
      expect(result.sourceLine).toBe(42)
    })

    it('default dummyContext のフォールバックは 1 (sourceLine >= 1 不変条件を満たす)', () => {
      const sel = dummySelection({ blockId: 'b999' })
      const result = commentFromSelection(sel, 'x', dummyContext())
      expect(result.sourceLine).toBe(1)
      expect(result.sourceLine).toBeGreaterThanOrEqual(1)
    })
  })
}
