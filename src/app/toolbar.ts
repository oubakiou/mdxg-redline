import type { Comment, ExportPayload } from '../core/types'
import { confirmDialog } from './dialog'
import { exportBaseName } from '../core/review-export'

/** 循環 import を避けるため、必要な副作用は runtime として注入で受け取る */
export interface ToolbarRuntime {
  buildExportPayload: () => ExportPayload
  commentCountLabel: () => string
  loadFromMarkdown: (name: string, text: string) => Promise<void>
  qs: (selector: string) => HTMLElement
  qsInput: (selector: string) => HTMLInputElement | HTMLTextAreaElement
  renderSidebar: () => void
  reapplyAllMarks: () => void
  state: {
    comments: Comment[]
    docName: string | null
    markdown: string
  }
  toast: (msg: string) => void
}

/** FileList は配列ではないため、テストしやすい ArrayLike 境界で先頭 File だけ取り出す */
const firstFileFromList = (files: ArrayLike<File> | null | undefined): File | null => {
  if (!files || files.length === 0) {
    return null
  }
  return files[0] || null
}

/** input[type=file] の change イベントから 1 つ目のファイルを取り出す共通処理 */
const fileFromChange = (event: Event): File | null => {
  const input = event.currentTarget
  if (!(input instanceof HTMLInputElement) || !input.files) {
    return null
  }
  return firstFileFromList(input.files)
}

/** 同じファイルを続けて選んでも change が再発火するよう、処理後に input value を空へ戻す */
const clearFileInput = (event: Event): void => {
  const input = event.currentTarget
  if (input instanceof HTMLInputElement) {
    input.value = ''
  }
}

/** Blob を一時 URL 化してアンカークリックで即ダウンロードする定石。URL は即 revoke してリークを防ぐ */
const downloadJson = (runtime: ToolbarRuntime, payload: ExportPayload): void => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${exportBaseName(runtime.state.docName)}.feedback.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

/** 画面外に textarea を作る。document.execCommand('copy') は選択範囲が必要だが、見せたくないため位置を画面外にする */
const createHiddenTextarea = (text: string): HTMLTextAreaElement => {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  return textarea
}

/**
 * レガシー API `execCommand('copy')` の薄いラッパー（成功/失敗を boolean に正規化）。
 * `execCommand` は標準的に非推奨だが、`navigator.clipboard` が利用不可な環境向けのフォールバックとして残す。
 */
const copySelectedText = (): boolean => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    return document.execCommand('copy')
  } catch {
    return false
  }
}

/**
 * `navigator.clipboard` が使えない／拒否された場合の代替コピー経路。
 * 一時 textarea + execCommand('copy') という古典手法を使うが、これ無しでは安全コンテキスト外ブラウザで完全に動かなくなる。
 */
const fallbackCopy = (runtime: ToolbarRuntime, text: string): void => {
  const textarea = createHiddenTextarea(text)
  document.body.appendChild(textarea)
  textarea.select()
  if (copySelectedText()) {
    runtime.toast('Copied')
  } else {
    runtime.toast('Copy failed')
  }
  document.body.removeChild(textarea)
}

/** 確認後に全コメントを破棄。再描画まで一括で行うため UI の不整合は発生しない */
const clearAllComments = (runtime: ToolbarRuntime): void => {
  runtime.state.comments = []
  runtime.reapplyAllMarks()
  runtime.renderSidebar()
  runtime.toast('Comments discarded')
}

/** Markdown 読み込みボタンと隠し file input を接続する */
const wireMarkdownLoad = (runtime: ToolbarRuntime): void => {
  runtime.qs('#btn-load').addEventListener('click', (): void => runtime.qsInput('#file-md').click())
  runtime.qsInput('#file-md').addEventListener('change', async (event): Promise<void> => {
    const file = fileFromChange(event)
    if (!file) {
      return
    }
    const text = await file.text()
    await runtime.loadFromMarkdown(file.name, text)
    clearFileInput(event)
  })
}

/** 現在の review state を feedback.json としてダウンロードする。本文未読込時は何も出力しない */
const wireExport = (runtime: ToolbarRuntime): void => {
  runtime.qs('#btn-export').addEventListener('click', (): void => {
    if (!runtime.state.markdown) {
      runtime.toast('Nothing to export')
      return
    }
    downloadJson(runtime, runtime.buildExportPayload())
    runtime.toast('Exported')
  })
}

/** feedback JSON をクリップボードへコピーする。ブラウザ拒否時は fallbackCopy に任せる */
const wireCopy = (runtime: ToolbarRuntime): void => {
  runtime.qs('#btn-copy').addEventListener('click', async (): Promise<void> => {
    if (!runtime.state.markdown) {
      runtime.toast('Nothing to copy')
      return
    }
    const text = JSON.stringify(runtime.buildExportPayload(), null, 2)
    try {
      await navigator.clipboard.writeText(text)
      runtime.toast(`Copied · ${runtime.commentCountLabel()}`)
    } catch {
      fallbackCopy(runtime, text)
    }
  })
}

/** 全コメント削除の UI 配線。破壊的操作なので confirmDialog を挟んでから state を更新する */
const wireClear = (runtime: ToolbarRuntime): void => {
  runtime.qs('#btn-clear').addEventListener('click', async (): Promise<void> => {
    if (!runtime.state.comments.length) {
      runtime.toast('No comments to clear')
      return
    }
    const confirmed = await confirmDialog(
      `Delete all ${runtime.state.comments.length} comments?`,
      'This cannot be undone.'
    )
    if (!confirmed) {
      return
    }
    clearAllComments(runtime)
  })
}

/** toolbar 上の全ボタンを一括配線する entry point */
export const wireToolbar = (runtime: ToolbarRuntime): void => {
  wireMarkdownLoad(runtime)
  wireExport(runtime)
  wireCopy(runtime)
  wireClear(runtime)
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('firstFileFromList', () => {
    it('先頭の File を返す', () => {
      const file = new File(['# Review'], 'review.md', { type: 'text/markdown' })
      expect(firstFileFromList([file])).toBe(file)
    })

    it('空なら null', () => {
      expect(firstFileFromList([])).toBeNull()
      expect(firstFileFromList(null)).toBeNull()
    })
  })
}
