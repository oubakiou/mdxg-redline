// --- Boot: workspace > embedded -------------------------------------------

import {
  type ImportedComment,
  embeddedCommentsFromUnknown,
  resolveImportedComments,
} from '../core/feedback'
import { markFeedbackWritten, replaceComments, state } from './state/app-state'
import { findPageIndexBySourceLine } from '../core/page-split'
import { reapplyAllMarks } from './comments/mark-engine'
import { renderComments } from './comments/comments'
import { restoreWorkspaceHandle } from './workspace/workspace'

interface BootRuntime {
  loadFromMarkdown: (name: string, text: string) => Promise<void>
}

/** 任意要素の textContent を trim して返す。null/未存在の場合は空文字（embedded フォールバックを連鎖させやすくする） */
export const elementText = (el: { textContent?: string | null } | null): string => {
  if (el && el.textContent) {
    return el.textContent.trim()
  }
  return ''
}

/**
 * import 段階の ImportedComment[] を resolveImportedComments で Comment[] に格上げし、
 * state にセットして再描画する。sourceLine が markdown 全体の範囲外なコメントは
 * resolveImportedComments 内で破棄される (§6.6 / §9.1)。
 */
const applyEmbeddedComments = (imported: readonly ImportedComment[]): void => {
  replaceComments(
    resolveImportedComments(imported, (sourceLine): number | null =>
      findPageIndexBySourceLine(state.pages, sourceLine)
    )
  )
  markFeedbackWritten()
  reapplyAllMarks()
  renderComments()
}

/**
 * 埋め込み HTML 内に同梱された feedback JSON があれば取り込む。
 * 単独ファイル配布で「ドキュメントとコメントを同梱して配る」ユースケース向けで、不正なら静かに無視する。
 */
const restoreEmbeddedFeedback = (feedbackText: string): void => {
  if (!feedbackText) {
    return
  }
  try {
    const comments = embeddedCommentsFromUnknown(JSON.parse(feedbackText))
    if (comments.length > 0) {
      applyEmbeddedComments(comments)
    }
  } catch {
    // embedded feedback is optional
  }
}

/**
 * `<script id="embedded-md">` の textContent から元の markdown を復元する。
 * CLI 側が `encodeEmbeddedMarkdown` で JSON 文字列として書き込んでいる前提で、
 * `JSON.parse` で生 markdown に戻す。docHash が CLI 側と一致するよう trim はしない。
 * 未挿入のプレースホルダ（空または空白のみ）は null。
 */
export const prepareEmbeddedMarkdown = (raw: string): string | null => {
  if (raw.trim().length === 0) {
    return null
  }
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'string') {
    throw new TypeError('embedded-md must be a JSON string')
  }
  return parsed
}

/** `<script id="embedded-md">` のような埋め込み MD を起動時に読み込む。存在しなければ false */
const loadEmbeddedMarkdown = async (runtime: BootRuntime): Promise<boolean> => {
  const embedded = document.getElementById('embedded-md')
  if (!(embedded instanceof HTMLElement)) {
    return false
  }
  const embeddedText = prepareEmbeddedMarkdown(embedded.textContent ?? '')
  if (embeddedText === null) {
    return false
  }
  const name = embedded.dataset.name || 'document.md'
  await runtime.loadFromMarkdown(name, embeddedText)
  restoreEmbeddedFeedback(elementText(document.getElementById('embedded-feedback')))
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

  describe('prepareEmbeddedMarkdown', () => {
    it('JSON 文字列を decode して元 markdown を返す', () => {
      expect(prepareEmbeddedMarkdown(JSON.stringify('# title\n'))).toBe('# title\n')
    })

    it('CLI の < 置換を含む形でも JSON.parse 経由で </script> リテラルが復元される', () => {
      const encoded = JSON.stringify('a </script> b').replace(/</g, String.raw`<`)
      expect(prepareEmbeddedMarkdown(encoded)).toBe('a </script> b')
    })

    it('空白だけの textContent は null を返す', () => {
      expect(prepareEmbeddedMarkdown('   \n\n  ')).toBeNull()
    })

    it('空文字は null を返す', () => {
      expect(prepareEmbeddedMarkdown('')).toBeNull()
    })

    it('JSON が文字列以外なら TypeError', () => {
      expect(() => prepareEmbeddedMarkdown('123')).toThrow(TypeError)
    })
  })
}
