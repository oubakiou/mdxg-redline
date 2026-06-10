// toolbar の Open ▾ ドロップダウンから開く Paste markdown modal。submit で textarea の
// markdown を runtime.loadFromMarkdown 経由で取り込む。Open file 経路と loadFromMarkdown を
// 共有するため、online edition の decorator (asset 再 fetch) もそのまま走る。
// CLI 経路 (review-request) は `data-toolbar-paste-markdown="off"` で wire 時に button +
// modal を DOM から削除する (DESIGN.md §3 入力 4)。

import { createStaticModalController, type StaticModalController } from '../dom/static-modal'
import { qs, qsInput } from '../dom/dom-utils'
import { translate } from '../i18n/i18n-browser'

const PASTE_MODAL_BACKDROP_ID = 'paste-markdown-modal-backdrop'
const PASTE_MODAL_CANCEL_ID = 'paste-markdown-modal-cancel'
const PASTE_FORM_ID = 'paste-markdown-form'
const PASTE_NAME_INPUT_ID = 'paste-markdown-name'
const PASTE_BODY_INPUT_ID = 'paste-markdown-input'
const PASTE_ERROR_ID = 'paste-markdown-error'
const PASTE_BUTTON_ID = 'btn-paste-markdown'
const PASTE_DEFAULT_DOC_NAME = 'pasted.md'

export interface PasteMarkdownRuntime {
  loadFromMarkdown: (name: string, text: string) => Promise<void>
}

let modalController: StaticModalController | null = null
let wired = false

const isPasteMarkdownSuppressed = (): boolean =>
  document.documentElement.dataset.toolbarPasteMarkdown === 'off'

const removeIfPresent = (selector: string): void => {
  const el = document.querySelector(selector)
  if (el !== null) {
    el.remove()
  }
}

const getController = (): StaticModalController => {
  if (modalController === null) {
    modalController = createStaticModalController({
      backdropId: PASTE_MODAL_BACKDROP_ID,
      closeButtonId: PASTE_MODAL_CANCEL_ID,
      // textarea に直接 focus して即タイプ開始 (close button 既定を上書き)。
      initialFocusId: PASTE_BODY_INPUT_ID,
    })
  }
  return modalController
}

export const closePasteMarkdownModal = (): void => {
  if (modalController !== null && modalController.isOpen()) {
    modalController.close()
  }
}

const showInputError = (message: string): void => {
  const el = document.getElementById(PASTE_ERROR_ID)
  if (el instanceof HTMLElement) {
    el.textContent = message
    el.hidden = false
  }
}

const clearInputError = (): void => {
  const el = document.getElementById(PASTE_ERROR_ID)
  if (el instanceof HTMLElement) {
    el.textContent = ''
    el.hidden = true
  }
}

/**
 * docName 入力欄が空のときは `pasted.md` を既定とする。stdin 経路の docName と
 * 同じ意図 (意味のある file 名で state.docName を埋める) で、export / status 表示が
 * 不格好にならないようにする。
 */
export const resolvePasteDocName = (raw: string): string => {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return PASTE_DEFAULT_DOC_NAME
  }
  return trimmed
}

const wireButton = (controller: StaticModalController): void => {
  qs(`#${PASTE_BUTTON_ID}`).addEventListener('click', (): void => {
    controller.open()
  })
}

// 読み込み失敗時は modal を閉じずに inline error を出し、ユーザーが本文を編集して
// 再 submit できる経路を残す。close 後の boot.catch ('Startup failed' toast) と違い、
// ドラフト編集中の文脈を維持する方が UX として親切。
const loadOrShowError = async (
  runtime: PasteMarkdownRuntime,
  docName: string,
  body: string
): Promise<boolean> => {
  try {
    await runtime.loadFromMarkdown(docName, body)
    return true
  } catch {
    showInputError(translate('modal.paste_markdown_load_failed'))
    return false
  }
}

const handleSubmit = async (
  event: SubmitEvent,
  runtime: PasteMarkdownRuntime,
  controller: StaticModalController
): Promise<void> => {
  event.preventDefault()
  const body = qsInput(`#${PASTE_BODY_INPUT_ID}`).value
  if (body.trim() === '') {
    showInputError(translate('modal.paste_markdown_empty_error'))
    return
  }
  const docName = resolvePasteDocName(qsInput(`#${PASTE_NAME_INPUT_ID}`).value)
  clearInputError()
  if (await loadOrShowError(runtime, docName, body)) {
    controller.close()
  }
}

const wireFormListeners = (
  runtime: PasteMarkdownRuntime,
  controller: StaticModalController
): void => {
  const form = document.getElementById(PASTE_FORM_ID)
  if (form instanceof HTMLFormElement) {
    form.addEventListener('submit', async (event): Promise<void> => {
      await handleSubmit(event, runtime, controller)
    })
  }
  const textarea = document.getElementById(PASTE_BODY_INPUT_ID)
  if (textarea instanceof HTMLTextAreaElement) {
    textarea.addEventListener('input', clearInputError)
  }
}

const removeSuppressedDom = (): void => {
  removeIfPresent(`#${PASTE_BUTTON_ID}`)
  removeIfPresent(`#${PASTE_MODAL_BACKDROP_ID}`)
}

export const wirePasteMarkdownModal = (runtime: PasteMarkdownRuntime): void => {
  if (isPasteMarkdownSuppressed()) {
    removeSuppressedDom()
    return
  }
  // idempotent guard: 二度呼びで event listener が二重 attach されないようにする
  // (本番は bootstrapReviewApp の単発呼び出し前提だが、defensive に防御する)。
  if (wired) {
    return
  }
  wired = true
  const controller = getController()
  controller.wire()
  wireButton(controller)
  wireFormListeners(runtime, controller)
}

if (import.meta.vitest) {
  const { afterEach, describe, expect, it } = import.meta.vitest

  afterEach((): void => {
    modalController = null
    wired = false
  })

  describe('resolvePasteDocName', () => {
    it('空文字 / 空白のみは pasted.md にフォールバックする', () => {
      expect(resolvePasteDocName('')).toBe('pasted.md')
      expect(resolvePasteDocName('   ')).toBe('pasted.md')
      expect(resolvePasteDocName('\t\n')).toBe('pasted.md')
    })

    it('前後の空白を trim して返す', () => {
      expect(resolvePasteDocName('  spec.md  ')).toBe('spec.md')
    })

    it('非空はそのまま返す (拡張子の補完はしない)', () => {
      expect(resolvePasteDocName('draft')).toBe('draft')
      expect(resolvePasteDocName('日本語 spec.md')).toBe('日本語 spec.md')
    })
  })
}
