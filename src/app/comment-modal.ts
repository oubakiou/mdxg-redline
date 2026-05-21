// コメント入力モーダルの状態管理・イベント配線・保存処理。
// floater (#floater) クリックで起動し、保留中の選択範囲 (PendingSelection) を保持したまま
// 「Save」で state.comments に追加し、関連 UI を更新する。

import type { Comment, PendingSelection } from '../core/types'
import { qs, qsInput, toast, uid } from './dom-utils'
import { parsePendingSelection } from '../core/feedback'
import { reapplyAllMarks } from './mark-engine'
import { renderSidebar } from './sidebar'
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

/** 保留中の選択範囲と本文からコメントオブジェクトを組み立てる純粋関数 */
const commentFromSelection = (selection: PendingSelection, body: string): Comment => ({
  blockId: selection.blockId,
  comment: body,
  created: new Date().toISOString(),
  endOffset: selection.endOffset,
  id: uid(),
  quote: selection.quote,
  startOffset: selection.startOffset,
})

/**
 * モーダルの「Save」ボタン押下時の処理。
 * 本文空 or 保留選択 null の場合は無視（誤コミット防止）。保存後に modal を閉じる前後で副作用を一通り回す。
 */
const saveModalComment = async (): Promise<void> => {
  const body = qsInput('#modal-input').value.trim()
  const selection = modalState.pendingSelection
  if (!body || !selection) {
    return
  }
  state.comments.push(commentFromSelection(selection, body))
  reapplyAllMarks()
  renderSidebar()
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

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest

  describe('commentFromSelection', () => {
    it('選択範囲と本文から正しいコメントを組み立てる', () => {
      const selection = {
        blockId: 'b001',
        endOffset: 20,
        quote: '引用テキスト',
        startOffset: 10,
      }
      const result = commentFromSelection(selection, 'コメント本文')
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
      const sel = { blockId: 'b', endOffset: 1, quote: 'q', startOffset: 0 }
      const first = commentFromSelection(sel, 'x')
      const second = commentFromSelection(sel, 'x')
      expect(first.id).not.toBe(second.id)
    })
  })
}
