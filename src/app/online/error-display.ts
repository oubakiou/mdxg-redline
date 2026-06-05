// online edition の fetch 失敗時に、消える toast ではなく持続的な inline error message を
// `<div id="empty-state-online-error">` に表示する。「別 URL を試す」ボタンで Open URL modal を
// 再 open する経路を提供し、ユーザーが状況を理解して別アクションに移れる UX を実現する
// (§5.d エラーカテゴリ / Step 5 成果物)。
//
// data-mdxg-online ガード下のみ動作。standalone / embed-template では JS gating で skip し、
// CSS gating (review.css の .online-edition-only セレクタ) と二層で混入を防ぐ (§3.1)。

import { openOpenUrlModal } from './open-url-modal'

const EMPTY_STATE_DEFAULT_ID = 'empty-state-default'
const EMPTY_STATE_ERROR_ID = 'empty-state-online-error'
const ERROR_MESSAGE_ID = 'online-error-message'
const ERROR_RETRY_BUTTON_ID = 'online-error-retry'

const isOnlineEdition = (): boolean => document.documentElement.dataset.mdxgOnline === '1'

const toggleDefaultEmptyState = (hidden: boolean): void => {
  const el = document.getElementById(EMPTY_STATE_DEFAULT_ID)
  if (el instanceof HTMLElement) {
    el.hidden = hidden
  }
}

/**
 * fetch 失敗時に呼ぶ。default の empty state を隠し、error empty state を表示する。
 * メッセージは boot.ts の formatFetchFailureMessage 戻り値をそのまま表示。
 */
export const showOnlineError = (message: string): void => {
  if (!isOnlineEdition()) {
    return
  }
  const errorEl = document.getElementById(EMPTY_STATE_ERROR_ID)
  const messageEl = document.getElementById(ERROR_MESSAGE_ID)
  if (!(errorEl instanceof HTMLElement) || !(messageEl instanceof HTMLElement)) {
    return
  }
  messageEl.textContent = message
  errorEl.hidden = false
  toggleDefaultEmptyState(true)
}

/** error 状態を解除 (fetch retry 成功時や Open URL modal を開いた時に呼ぶ) */
export const clearOnlineError = (): void => {
  const errorEl = document.getElementById(EMPTY_STATE_ERROR_ID)
  if (errorEl instanceof HTMLElement) {
    errorEl.hidden = true
  }
  toggleDefaultEmptyState(false)
}

/**
 * 「別 URL を試す」ボタンに Open URL modal を再 open する handler を attach する。
 * data-mdxg-online ガード下のみ wire (standalone / embed-template では skip)。
 */
export const wireOnlineErrorRetry = (): void => {
  if (!isOnlineEdition()) {
    return
  }
  const btn = document.getElementById(ERROR_RETRY_BUTTON_ID)
  if (!(btn instanceof HTMLButtonElement)) {
    return
  }
  btn.addEventListener('click', (): void => {
    openOpenUrlModal()
  })
}

if (import.meta.vitest) {
  const { afterEach, describe, expect, it } = import.meta.vitest

  // vitest 専用 helper のため、unicorn は module 外移動を勧めるが
  // import.meta.vitest ガード内に閉じ込めて production bundle から落とす方針を優先する
  // eslint-disable-next-line unicorn/consistent-function-scoping
  const createDiv = (id: string): HTMLElement => {
    const el = document.createElement('div')
    el.id = id
    return el
  }
  const setupDom = (): { errorEl: HTMLElement; defaultEl: HTMLElement; messageEl: HTMLElement } => {
    document.body.innerHTML = ''
    const defaultEl = createDiv(EMPTY_STATE_DEFAULT_ID)
    const errorEl = createDiv(EMPTY_STATE_ERROR_ID)
    errorEl.hidden = true
    const messageEl = createDiv(ERROR_MESSAGE_ID)
    errorEl.appendChild(messageEl)
    document.body.append(defaultEl, errorEl)
    return { defaultEl, errorEl, messageEl }
  }

  afterEach((): void => {
    document.body.innerHTML = ''
    delete document.documentElement.dataset.mdxgOnline
  })

  describe('showOnlineError / clearOnlineError', () => {
    it('online edition で showOnlineError すると default を隠し error を visible に', () => {
      document.documentElement.dataset.mdxgOnline = '1'
      const { errorEl, defaultEl, messageEl } = setupDom()
      showOnlineError('404 not found')
      expect(errorEl.hidden).toBe(false)
      expect(defaultEl.hidden).toBe(true)
      expect(messageEl.textContent).toBe('404 not found')
    })

    it('clearOnlineError で逆: default visible / error hidden に戻す', () => {
      document.documentElement.dataset.mdxgOnline = '1'
      const { errorEl, defaultEl } = setupDom()
      showOnlineError('timeout')
      clearOnlineError()
      expect(errorEl.hidden).toBe(true)
      expect(defaultEl.hidden).toBe(false)
    })

    it('data-mdxg-online なしでは showOnlineError は no-op (JS gating §3.1)', () => {
      const { errorEl, defaultEl, messageEl } = setupDom()
      showOnlineError('hostile error')
      expect(errorEl.hidden).toBe(true)
      expect(defaultEl.hidden).toBe(false)
      expect(messageEl.textContent).toBe('')
    })

    it('DOM 要素が無くても throw しない (fail-soft)', () => {
      document.documentElement.dataset.mdxgOnline = '1'
      document.body.innerHTML = ''
      expect((): void => {
        showOnlineError('any')
        clearOnlineError()
      }).not.toThrow()
    })
  })
}
