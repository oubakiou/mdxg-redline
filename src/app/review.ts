// DOM エントリポイント。
// 各責務は別モジュールに切り出し済み:
//   状態 (app-state) / DOM helper (dom-utils) / mark 反映 (mark-engine) / markdown 描画 (doc-renderer) /
//   サイドバー (sidebar) / floater (floater) / コメント入力モーダル (comment-modal) /
//   ドロップダウンメニュー (menu) / toolbar (toolbar) / boot (boot)
// 本ファイルは loadFromMarkdown orchestrator と、上記モジュールを組み合わせる wiring に専念する。

import type { Comment, ExportPayload } from '../core/types'
import { activateSidebarMark, renderSidebar } from './sidebar'
import {
  buildReviewExportPayload,
  commentCountLabel as formatCommentCount,
} from '../core/review-export'
import { changeOutputFolder, writeFeedback } from './workspace'
import { closeCommentModal, wireCommentModal } from './comment-modal'
import { markFeedbackUnsaved, state } from './app-state'
import { qs, toast } from './dom-utils'
import { boot } from './boot'
import { computeDocHash } from '../core/embed'
import { createDropdownMenu } from './menu'
import { renderDoc } from './doc-renderer'
import { wireFloater } from './floater'
import { wireToolbar } from './toolbar'

/**
 * markdown 本文を取り込んで state を構築・描画・ステータス更新する中心ルーチン。
 * 永続化レイヤは workspace-handle のみ（詳細は DESIGN.md §7）。
 */
export const loadFromMarkdown = async (name: string, text: string): Promise<void> => {
  state.docName = name
  state.markdown = text
  state.docHash = await computeDocHash(text)
  state.comments = []
  markFeedbackUnsaved()
  renderDoc()
  renderSidebar()
  qs('#status').textContent = `${name} (${state.docHash}) · loaded`
}

export const buildExportPayload = (): ExportPayload => buildReviewExportPayload(state)

export const commentCountLabel = (): string => formatCommentCount(state.comments.length)

if (!import.meta.vitest) {
  wireFloater()
  wireCommentModal()

  const commentsMenu = createDropdownMenu({
    buttonId: '#btn-comments-menu',
    menuId: '#menu-comments',
  })
  const sendMenu = createDropdownMenu({
    buttonId: '#btn-send-menu',
    menuId: '#menu-send',
  })

  document.addEventListener('keydown', (event): void => {
    if (event.key === 'Escape') {
      closeCommentModal()
      commentsMenu.close()
      sendMenu.close()
    }
    if (
      event.key === 'Enter' &&
      (event.metaKey || event.ctrlKey) &&
      qs('#modal').classList.contains('open')
    ) {
      qs('#modal-save').click()
    }
  })

  // mark クリック → サイドバーカードをアクティブ化
  document.addEventListener('click', (event): void => {
    const { target } = event
    if (!(target instanceof Element)) {
      return
    }
    const mark = target.closest('mark.cmt')
    if (!(mark instanceof HTMLElement)) {
      return
    }
    activateSidebarMark(mark)
  })

  wireToolbar({
    buildExportPayload,
    commentCountLabel,
    loadFromMarkdown,
  })

  qs('#btn-send').addEventListener('click', async (): Promise<void> => writeFeedback())
  qs('#btn-change-output').addEventListener('click', async (): Promise<void> => {
    sendMenu.close()
    await changeOutputFolder()
  })

  boot({
    loadFromMarkdown,
  }).catch((): void => toast('Startup failed'))
}

const dummyCommentForTest = (id: string): Comment => ({
  blockId: '',
  comment: '',
  created: '',
  endOffset: 0,
  id,
  quote: '',
  startOffset: 0,
})

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest

  describe('commentCountLabel (state 依存)', () => {
    it('1 件のときは単数形', () => {
      const prev = state.comments
      state.comments = [dummyCommentForTest('x')]
      try {
        expect(commentCountLabel()).toBe('1 comment')
      } finally {
        state.comments = prev
      }
    })

    it('0 件のときは複数形 (i18n 非対応の既知挙動)', () => {
      const prev = state.comments
      state.comments = []
      try {
        expect(commentCountLabel()).toBe('0 comments')
      } finally {
        state.comments = prev
      }
    })

    it('2 件以上のときは複数形', () => {
      const prev = state.comments
      state.comments = [
        dummyCommentForTest('a'),
        dummyCommentForTest('b'),
        dummyCommentForTest('c'),
      ]
      try {
        expect(commentCountLabel()).toBe('3 comments')
      } finally {
        state.comments = prev
      }
    })
  })
}
