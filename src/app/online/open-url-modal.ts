// online edition 専用の Open URL modal。data-mdxg-online ガード下でのみ wire され、
// click で modal を開き、submit で `?url=<encodeURIComponent(input)>` を location.assign で
// 同一ページに反映 + reload。reload により boot.ts の online 経路が走り fetchMarkdownFromUrl
// に流れる。CSS gating (review.css) と JS gating (本ファイルの attach 条件) の二層で
// standalone / embed-template への混入を構造的に防ぐ (§3.1)。

import { createStaticModalController, type StaticModalController } from '../dom/static-modal'
import { qs, qsInput } from '../dom/dom-utils'

const OPEN_URL_MODAL_BACKDROP_ID = 'open-url-modal-backdrop'
const OPEN_URL_MODAL_CANCEL_ID = 'open-url-modal-cancel'
const OPEN_URL_FORM_ID = 'open-url-form'
const OPEN_URL_INPUT_ID = 'open-url-input'
const OPEN_URL_ERROR_ID = 'open-url-error'
const OPEN_URL_BUTTON_ID = 'btn-open-url'

let modalController: StaticModalController | null = null
let wired = false

const getController = (): StaticModalController => {
  if (modalController === null) {
    modalController = createStaticModalController({
      backdropId: OPEN_URL_MODAL_BACKDROP_ID,
      closeButtonId: OPEN_URL_MODAL_CANCEL_ID,
      // input にフォーカスして即座にタイプ開始できるようにする (close button への
      // 既定フォーカスを上書き、static-modal の initialFocusId 経路で適用)。
      initialFocusId: OPEN_URL_INPUT_ID,
      onAfterOpen: (): void => {
        // initialFocusId で focus されたあと、既存値があれば select() で全選択。
        // focus は static-modal 側で処理済みなので、ここでは select のみ呼ぶ。
        const input = document.getElementById(OPEN_URL_INPUT_ID)
        if (input instanceof HTMLInputElement) {
          input.select()
        }
      },
    })
  }
  return modalController
}

/**
 * 同一ページ origin の URL に `?url=<encoded>` クエリを反映した文字列を返す。
 * 既存の他クエリは捨てる (`url` の単一パラメータで起動経路を表す方針、§3.2)。
 * hash は保持しない (online edition の起動時 hash navigation は別経路、§3.4)。
 *
 * `encodeURIComponent` で input 全体を encode することで、ユーザー入力 URL に `&` / `?` /
 * `#` などが含まれていても本ページのクエリと混線しない。例:
 *   input = 'https://x/file.md?token=abc'
 *   → '?url=https%3A%2F%2Fx%2Ffile.md%3Ftoken%3Dabc'
 */
export const buildReloadHref = (
  currentOrigin: string,
  currentPathname: string,
  input: string
): string => `${currentOrigin}${currentPathname}?url=${encodeURIComponent(input)}`

/** 開く API (Step 5-4 の error UI から「別 URL を試す」経由で再 open する用) */
export const openOpenUrlModal = (): void => {
  getController().open()
}

/** 閉じる API (global-keyboard.ts の Escape handler に登録する用) */
export const closeOpenUrlModal = (): void => {
  if (modalController !== null && modalController.isOpen()) {
    modalController.close()
  }
}

const showInputError = (message: string): void => {
  const el = document.getElementById(OPEN_URL_ERROR_ID)
  if (el instanceof HTMLElement) {
    el.textContent = message
    el.hidden = false
  }
}

const clearInputError = (): void => {
  const el = document.getElementById(OPEN_URL_ERROR_ID)
  if (el instanceof HTMLElement) {
    el.textContent = ''
    el.hidden = true
  }
}

const handleSubmit = (event: SubmitEvent): void => {
  event.preventDefault()
  const input = qsInput(`#${OPEN_URL_INPUT_ID}`)
  const raw = input.value.trim()
  if (raw === '') {
    showInputError('URL を入力してください')
    return
  }
  // submit 後は同一ページを reload するので、エラー表示はリセットしておく
  clearInputError()
  const href = buildReloadHref(globalThis.location.origin, globalThis.location.pathname, raw)
  globalThis.location.assign(href)
}

/**
 * data-mdxg-online ガード下でのみ event handler を attach する。standalone / embed-template
 * では呼び出しを skip することで、bundled JS 内に handler を残しつつ実行経路をゼロにする
 * (§3.1 二層 gating)。
 */
const wireFormListeners = (): void => {
  const form = document.getElementById(OPEN_URL_FORM_ID)
  if (!(form instanceof HTMLFormElement)) {
    return
  }
  form.addEventListener('submit', handleSubmit)
  const input = document.getElementById(OPEN_URL_INPUT_ID)
  if (input instanceof HTMLInputElement) {
    input.addEventListener('input', clearInputError)
  }
}

export const wireOpenUrlModal = (): void => {
  if (document.documentElement.dataset.mdxgOnline !== '1') {
    return
  }
  // idempotent guard: 二度呼びで event listener が二重 attach されないようにする
  // (本番は launchBoot の単発呼び出し前提だが、defensive に防御する)。
  if (wired) {
    return
  }
  wired = true
  const controller = getController()
  controller.wire()
  const btn = qs(`#${OPEN_URL_BUTTON_ID}`)
  btn.addEventListener('click', (): void => {
    controller.open()
  })
  wireFormListeners()
}

if (import.meta.vitest) {
  const { afterEach, describe, expect, it } = import.meta.vitest

  afterEach((): void => {
    modalController = null
    wired = false
  })

  describe('buildReloadHref', () => {
    it('単純な https URL を encodeURIComponent して ?url= に乗せる', () => {
      expect(
        buildReloadHref(
          'https://host.example',
          '/online.html',
          'https://raw.githubusercontent.com/owner/repo/main/README.md'
        )
      ).toBe(
        'https://host.example/online.html?url=https%3A%2F%2Fraw.githubusercontent.com%2Fowner%2Frepo%2Fmain%2FREADME.md'
      )
    })

    it('input に `&` / `?` / `#` を含む URL もクエリ混線せず単一 url= 値として encode', () => {
      const input = 'https://x/file.md?token=abc&v=2#section'
      const href = buildReloadHref('https://host', '/p', input)
      expect(href).toBe(
        'https://host/p?url=https%3A%2F%2Fx%2Ffile.md%3Ftoken%3Dabc%26v%3D2%23section'
      )
      // ?url= の右辺以降に追加クエリが混入しないこと
      expect(href.split('?').length).toBe(2)
    })

    it('input に非 ASCII / 空白を含んでも encodeURIComponent で安全に escape', () => {
      const input = 'https://x/日本語 spec.md'
      const href = buildReloadHref('https://host', '/p', input)
      expect(href).toContain('%E6%97%A5%E6%9C%AC%E8%AA%9E')
      expect(href).not.toContain(' ')
    })

    it('既存 pathname を保持する', () => {
      expect(buildReloadHref('https://x', '/foo/bar.html', 'https://y/z')).toBe(
        'https://x/foo/bar.html?url=https%3A%2F%2Fy%2Fz'
      )
    })
  })
}
