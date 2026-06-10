import { qs, qsInput, toast } from '../dom/dom-utils'
import type { DocumentLoader } from '../document/load-document'
import type { ExportPayload } from '../../core/types'
import { confirmDialog } from '../dom/dialog'
import { exportBaseName } from '../../core/review-export'
import { reapplyAllMarks } from '../comments/mark-engine'
import { renderComments } from '../comments/comments'
import { replaceComments, state } from '../state/app-state'
import { translate, translatePlural } from '../i18n/i18n-browser'

/** documentLoader のみ循環を避けるため runtime 経由で受け取る (Open file 経路で kind='local' を流す) */
export interface ToolbarRuntime {
  buildExportPayload: () => ExportPayload
  commentCountLabel: () => string
  documentLoader: DocumentLoader
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
const downloadJson = (payload: ExportPayload): void => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${exportBaseName(state.docName)}.feedback.json`
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
const fallbackCopy = (text: string): void => {
  const textarea = createHiddenTextarea(text)
  document.body.appendChild(textarea)
  textarea.select()
  if (copySelectedText()) {
    toast(translate('toast.copied'))
  } else {
    toast(translate('toast.copy_failed'))
  }
  document.body.removeChild(textarea)
}

/** 確認後に全コメントを破棄。再描画まで一括で行うため UI の不整合は発生しない */
const clearAllComments = (): void => {
  replaceComments([])
  reapplyAllMarks()
  renderComments()
  toast(translate('toast.comments_discarded'))
}

// CLI 経路 (review-request) が <html data-toolbar-open-file="off"> を注入した時、
// 「特定 MD のレビュー固定文脈」フットガン (DESIGN.md §3 入力 1, §5.g) を構造的に塞ぐため
// Open file ボタンと隠し file input を tab order / DOM クエリから完全に外す。
// display:none での視覚抑制は CSS 側で並行して効くが、DOM 削除も併せて行う方が
// 信頼境界として強い (--show-open-file 未指定時に keyboard 経路で偶発的に叩かれないため)。
const isOpenFileSuppressed = (): boolean =>
  document.documentElement.dataset.toolbarOpenFile === 'off'

const removeIfPresent = (selector: string): void => {
  const el = document.querySelector(selector)
  if (el !== null) {
    el.remove()
  }
}

/** Markdown 読み込みボタンと隠し file input を接続する。CLI 経路で抑止された場合は両要素を削除する */
const wireMarkdownLoad = (runtime: ToolbarRuntime): void => {
  if (isOpenFileSuppressed()) {
    removeIfPresent('#btn-load')
    removeIfPresent('#file-md')
    return
  }
  qs('#btn-load').addEventListener('click', (): void => qsInput('#file-md').click())
  qsInput('#file-md').addEventListener('change', async (event): Promise<void> => {
    const file = fileFromChange(event)
    if (!file) {
      return
    }
    const text = await file.text()
    await runtime.documentLoader.loadDocument({ body: text, docName: file.name, kind: 'local' })
    clearFileInput(event)
  })
}

/** 現在の review state を feedback.json としてダウンロードする。本文未読込時は何も出力しない */
const wireExport = (runtime: ToolbarRuntime): void => {
  qs('#btn-export').addEventListener('click', (): void => {
    if (!state.markdown) {
      toast(translate('toast.nothing_to_export'))
      return
    }
    downloadJson(runtime.buildExportPayload())
    toast(translate('toast.exported'))
  })
}

/** feedback JSON をクリップボードへコピーする。ブラウザ拒否時は fallbackCopy に任せる */
const wireCopy = (runtime: ToolbarRuntime): void => {
  qs('#btn-copy').addEventListener('click', async (): Promise<void> => {
    if (!state.markdown) {
      toast(translate('toast.nothing_to_copy'))
      return
    }
    const text = JSON.stringify(runtime.buildExportPayload(), null, 2)
    try {
      await navigator.clipboard.writeText(text)
      toast(translate('toast.copied_with_count', { count: runtime.commentCountLabel() }))
    } catch {
      fallbackCopy(text)
    }
  })
}

/** 全コメント削除の UI 配線。破壊的操作なので confirmDialog を挟んでから state を更新する */
const wireClear = (): void => {
  qs('#btn-clear').addEventListener('click', async (): Promise<void> => {
    if (!state.comments.length) {
      toast(translate('toast.no_comments_to_clear'))
      return
    }
    const confirmed = await confirmDialog(
      translatePlural({
        baseKey: 'modal.confirm_delete_comments',
        count: state.comments.length,
      }),
      translate('modal.confirm_warn')
    )
    if (!confirmed) {
      return
    }
    clearAllComments()
  })
}

/** toolbar 上の全ボタンを一括配線する entry point */
export const wireToolbar = (runtime: ToolbarRuntime): void => {
  wireMarkdownLoad(runtime)
  wireExport(runtime)
  wireCopy(runtime)
  wireClear()
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
