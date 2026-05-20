// --- Boot: workspace > embedded -------------------------------------------

import { embeddedCommentsFromUnknown } from './feedback'
import { restoreWorkspaceHandle } from './workspace'

interface Comment {
  id: string
  quote: string
  comment: string
  blockId: string
  startOffset: number
  endOffset: number
  created: string
}

interface BootRuntime {
  loadFromMarkdown: (name: string, text: string) => Promise<void>
  reapplyAllMarks: () => void
  renderSidebar: () => void
  state: {
    comments: Comment[]
    markdown: string
  }
  toast: (msg: string) => void
}

/** 任意要素の textContent を trim して返す。null/未存在の場合は空文字（embedded フォールバックを連鎖させやすくする） */
export const elementText = (el: { textContent?: string | null } | null): string => {
  if (el && el.textContent) {
    return el.textContent.trim()
  }
  return ''
}

/** 取り込んだコメント配列を state に流し込み、再描画まで実施する */
const applyEmbeddedComments = (runtime: BootRuntime, comments: Comment[]): void => {
  runtime.state.comments = comments
  runtime.reapplyAllMarks()
  runtime.renderSidebar()
}

/**
 * 埋め込み HTML 内に同梱された feedback JSON があれば取り込む。
 * 単独ファイル配布で「ドキュメントとコメントを同梱して配る」ユースケース向けで、不正なら静かに無視する。
 */
const restoreEmbeddedFeedback = (runtime: BootRuntime, feedbackText: string): void => {
  if (!feedbackText) {
    return
  }
  try {
    const comments = embeddedCommentsFromUnknown(JSON.parse(feedbackText))
    if (comments.length > 0) {
      applyEmbeddedComments(runtime, comments)
    }
  } catch {
    // embedded feedback is optional
  }
}

/** `<script id="embedded-md">` のような埋め込み MD を起動時に読み込む。存在しなければ false */
const loadEmbeddedMarkdown = async (runtime: BootRuntime): Promise<boolean> => {
  const embedded = document.getElementById('embedded-md')
  const embeddedText = elementText(embedded)
  if (!embeddedText || !(embedded instanceof HTMLElement)) {
    return false
  }
  const name = embedded.dataset.name || 'document.md'
  await runtime.loadFromMarkdown(name, embeddedText)
  restoreEmbeddedFeedback(runtime, elementText(document.getElementById('embedded-feedback')))
  return true
}

/**
 * 起動時のロード優先順位を順に試す（詳細は DESIGN.md §9）。
 * 0. 保存済みの出力先フォルダ handle を IDB からサイレント復元（書き出し時の picker 省略用）
 * 1. 埋め込み MD（review-request CLI 配布 / 同梱配布のケース）
 */
export const boot = async (runtime: BootRuntime): Promise<void> => {
  await restoreWorkspaceHandle()
  if (await loadEmbeddedMarkdown(runtime)) {
    return
  }
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('elementText', () => {
    it('null を渡すと空文字を返す', () => {
      expect(elementText(null)).toBe('')
    })

    it('textContent を trim して返す', () => {
      expect(elementText({ textContent: '  hello\n' })).toBe('hello')
    })

    it('textContent が空ならフォールバックで空文字', () => {
      expect(elementText({ textContent: '' })).toBe('')
    })
  })
}
