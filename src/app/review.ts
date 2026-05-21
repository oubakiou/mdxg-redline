// DOM エントリポイント。外部境界モジュールへは runtime を注入する形で渡し、循環 import を避ける。
// 状態 (app-state) / DOM helper (dom-utils) / mark 反映 (mark-engine) / markdown 描画 (doc-renderer)
// は別モジュールへ抽出済み。本ファイルは modal / menu / event の wiring と
// loadFromMarkdown orchestrator、sidebar/toolbar/workspace/boot の組み立てに専念する。

import type { Comment, ExportPayload, PendingSelection } from '../core/types'
import {
  buildReviewExportPayload,
  feedbackSignature,
  commentCountLabel as formatCommentCount,
} from '../core/review-export'
import { changeOutputFolder, configureWorkspace, writeFeedback } from './workspace'
import { hashStr, qs, qsInput, toast, uid } from './dom-utils'
import { isFeedbackDirty, markFeedbackUnsaved, markFeedbackWritten, state } from './app-state'
import { boot } from './boot'
import { createSidebar } from './sidebar'
import { getSelectionInfo } from './selection'
import { parsePendingSelection } from '../core/feedback'
import { reapplyAllMarks } from './mark-engine'
import { renderDoc } from './doc-renderer'
import { wireToolbar } from './toolbar'

// app-state / dom-utils / mark-engine の export を再公開し、
// 既存利用者 (テスト・外部 import 予定箇所) からの参照経路を維持する。
export { feedbackSignature }
export { state, isFeedbackDirty, markFeedbackWritten, markFeedbackUnsaved }
export { hashStr, qs, toast }
export { reapplyAllMarks }

type SelectionInfo = NonNullable<ReturnType<typeof getSelectionInfo>>

// --- Selection -> floater ---------------------------------------------------

/** フローターの data-payload 属性に乗せるための保存可能サブセット。rect は実行時の DOM 位置なので含めない */
const selectionFloaterPayload = (info: SelectionInfo): string =>
  JSON.stringify({
    blockId: info.blockId,
    endOffset: info.endOffset,
    quote: info.quote,
    startOffset: info.startOffset,
  })

/** 選択 rect の上に floater を中央配置する。`Math.max(8, left)` で画面左端から最低 8px のマージンを確保 */
const positionFloater = (floater: HTMLElement, rect: DOMRect): void => {
  const top = rect.top - 42
  const left = rect.left + rect.width / 2 - floater.offsetWidth / 2
  floater.style.top = `${top}px`
  floater.style.left = `${Math.max(8, left)}px`
}

/** 選択状態に応じてフローターの表示/非表示と位置を更新する。selectionchange ハンドラから呼び出される */
const updateFloaterFromSelection = (): void => {
  const info = getSelectionInfo()
  const floater = qs('#floater')
  if (!info) {
    floater.style.display = 'none'
    return
  }
  floater.style.display = 'block'
  positionFloater(floater, info.rect)
  floater.dataset.payload = selectionFloaterPayload(info)
}

/**
 * 選択変更系イベントの共通ハンドラ。
 * 10ms 遅延させているのは、mouseup/keyup 直後に Selection オブジェクトが完全に確定する前に読みに行くと
 * range が空になるブラウザ挙動を避けるため。
 */
const onSelChange = (): void => {
  setTimeout(updateFloaterFromSelection, 10)
}

if (!import.meta.vitest) {
  document.addEventListener('mouseup', onSelChange)
  document.addEventListener('keyup', onSelChange)
}

// --- Modal ------------------------------------------------------------------

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
const closeModal = (): void => {
  qs('#modal').classList.remove('open')
  modalState.pendingSelection = null
}

// --- Action menu (Comments dropdown) ----------------------------------------

/** Comments ドロップダウンを開く。aria-expanded も同期して支援技術にも状態を伝える */
const openCommentsMenu = (): void => {
  qs('#menu-comments').classList.add('open')
  qs('#btn-comments-menu').setAttribute('aria-expanded', 'true')
}

/** Comments ドロップダウンを閉じる（Esc / 外側クリック / メニュー項目クリックの後始末から共通利用） */
const closeCommentsMenu = (): void => {
  qs('#menu-comments').classList.remove('open')
  qs('#btn-comments-menu').setAttribute('aria-expanded', 'false')
}

/** Write feedback.json split button の caret ▾ menu を開く */
const openSendMenu = (): void => {
  qs('#menu-send').classList.add('open')
  qs('#btn-send-menu').setAttribute('aria-expanded', 'true')
}

/** Write feedback.json split button の caret ▾ menu を閉じる */
const closeSendMenu = (): void => {
  qs('#menu-send').classList.remove('open')
  qs('#btn-send-menu').setAttribute('aria-expanded', 'false')
}

// --- Sidebar ----------------------------------------------------------------

const sidebar = createSidebar({
  isFeedbackDirty,
  qs,
  reapplyAllMarks,
  state,
  toast,
})

export const renderSidebar = (): void => sidebar.render()

/**
 * markdown 本文を取り込んで state を構築・描画・ステータス更新する中心ルーチン。
 * 永続化レイヤは workspace-handle のみ（詳細は DESIGN.md §7）。
 */
export const loadFromMarkdown = async (name: string, text: string): Promise<void> => {
  state.docName = name
  state.markdown = text
  state.docHash = await hashStr(text)
  state.comments = []
  markFeedbackUnsaved()
  renderDoc()
  renderSidebar()
  qs('#status').textContent = `${name} (${state.docHash}) · loaded`
}

// --- Modal / Menu event listeners -------------------------------------------

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
  closeModal()
  toast('Comment added')
}

if (!import.meta.vitest) {
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
  qs('#modal-cancel').addEventListener('click', closeModal)
  qs('#modal').addEventListener('click', (event): void => {
    const { target } = event
    if (target instanceof HTMLElement && target.id === 'modal') {
      closeModal()
    }
  })
  qs('#modal-save').addEventListener('click', async (): Promise<void> => saveModalComment())
  document.addEventListener('keydown', (event): void => {
    if (event.key === 'Escape') {
      closeModal()
      closeCommentsMenu()
      closeSendMenu()
    }
    if (
      event.key === 'Enter' &&
      (event.metaKey || event.ctrlKey) &&
      qs('#modal').classList.contains('open')
    ) {
      qs('#modal-save').click()
    }
  })
  qs('#btn-comments-menu').addEventListener('click', (event): void => {
    event.stopPropagation()
    if (qs('#menu-comments').classList.contains('open')) {
      closeCommentsMenu()
    } else {
      openCommentsMenu()
    }
  })
  qs('#menu-comments').addEventListener(
    'click',
    (event): void => {
      const { target } = event
      if (target instanceof Element && target.closest('.menu-item')) {
        closeCommentsMenu()
      }
    },
    true
  )
  document.addEventListener('click', (event): void => {
    if (!qs('#menu-comments').classList.contains('open')) {
      return
    }
    const { target } = event
    if (
      target instanceof Element &&
      (target.closest('#menu-comments') || target.closest('#btn-comments-menu'))
    ) {
      return
    }
    closeCommentsMenu()
  })
}

// Click on mark → highlight sidebar
const activateMark = (mark: HTMLElement): void => sidebar.activateMark(mark)

if (!import.meta.vitest) {
  document.addEventListener('click', (event): void => {
    const { target } = event
    if (!(target instanceof Element)) {
      return
    }
    const mark = target.closest('mark.cmt')
    if (!(mark instanceof HTMLElement)) {
      return
    }
    activateMark(mark)
  })
}

// --- Toolbar actions --------------------------------------------------------

export const buildExportPayload = (): ExportPayload => buildReviewExportPayload(state)

export const commentCountLabel = (): string => formatCommentCount(state.comments.length)

if (!import.meta.vitest) {
  wireToolbar({
    buildExportPayload,
    commentCountLabel,
    loadFromMarkdown,
    qs,
    qsInput,
    reapplyAllMarks,
    renderSidebar,
    state,
    toast,
  })
}

// --- Workspace mode wiring --------------------------------------------------
// 循環 import の TDZ を避けるため、DOM 取得側からハンドラ関数のみ受け取る形で
// runtime を注入する。

configureWorkspace({
  buildExportPayload,
  commentCountLabel,
  onFeedbackWritten: (): void => {
    markFeedbackWritten()
    renderSidebar()
  },
  onOutputFolderChanged: (): void => {
    markFeedbackUnsaved()
    renderSidebar()
  },
  qs,
  state,
  toast,
})

if (!import.meta.vitest) {
  qs('#btn-send').addEventListener('click', async (): Promise<void> => writeFeedback())
  qs('#btn-send-menu').addEventListener('click', (event): void => {
    // stopPropagation しないと直下の document click が即 close してしまい menu が開かない
    event.stopPropagation()
    if (qs('#menu-send').classList.contains('open')) {
      closeSendMenu()
    } else {
      openSendMenu()
    }
  })
  qs('#btn-change-output').addEventListener('click', async (): Promise<void> => {
    closeSendMenu()
    await changeOutputFolder()
  })
  document.addEventListener('click', (event): void => {
    if (!qs('#menu-send').classList.contains('open')) {
      return
    }
    const { target } = event
    if (
      target instanceof Element &&
      (target.closest('#menu-send') || target.closest('#btn-send-menu'))
    ) {
      return
    }
    closeSendMenu()
  })
}

// --- Boot trigger -----------------------------------------------------------
// モジュール初期化時の TDZ を避けるため、トップレベルで一度だけ boot() を発火する。

if (!import.meta.vitest) {
  boot({
    loadFromMarkdown,
    markFeedbackWritten,
    reapplyAllMarks,
    renderSidebar,
    state,
    toast,
  }).catch((): void => toast('Startup failed'))
}

// テスト用のダミーコメント (id 以外は空の Comment)。
const dummyCommentForTest = (id: string): Comment => ({
  blockId: '',
  comment: '',
  created: '',
  endOffset: 0,
  id,
  quote: '',
  startOffset: 0,
})

/**
 * MARK: In-Source Testing
 * @example vp test src/review.ts
 */

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
