// online edition 専用の Open URL modal。data-mdxg-online ガード下でのみ wire され、
// click で modal を開き、submit で `?url=<encodeURIComponent(input)>` を location.assign で
// 同一ページに反映 + reload。reload により boot.ts の online 経路が走り fetchMarkdownFromUrl
// に流れる。CSS gating (review.css) と JS gating (本ファイルの attach 条件) の二層で
// standalone / embed-template への混入を構造的に防ぐ (§3.1)。

import { createStaticModalController, type StaticModalController } from '../dom/static-modal'
import { qs, qsInput } from '../dom/dom-utils'
import { resolveOnlineAllowlistFromJson } from '../../core/online-allowlist-config'
import { REWRITTEN_INPUT_HOSTS } from '../../core/online-url-normalize'
import { translate } from '../i18n/i18n-browser'

const OPEN_URL_MODAL_BACKDROP_ID = 'open-url-modal-backdrop'
const OPEN_URL_MODAL_CANCEL_ID = 'open-url-modal-cancel'
const OPEN_URL_FORM_ID = 'open-url-form'
const OPEN_URL_INPUT_ID = 'open-url-input'
const OPEN_URL_ERROR_ID = 'open-url-error'
const OPEN_URL_BUTTON_ID = 'btn-open-url'
const OPEN_URL_HELP_ALLOWLIST_ID = 'open-url-help-allowlist'
const ONLINE_ALLOWLIST_SCRIPT_ID = 'online-allowlist'

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
    showInputError(translate('online.error.empty_url_input'))
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

const readAllowlistJsonText = (): string => {
  const el = document.getElementById(ONLINE_ALLOWLIST_SCRIPT_ID)
  if (el === null) {
    return ''
  }
  return el.textContent ?? ''
}

/**
 * allowlist origin (`https://host[:port]`) を modal の説明文に出すための表示用形式に整える。
 * scheme は固定 (`https only`) が既に lead 文に明示されているため、host[:port] だけに落とす。
 * 不正な origin (`new URL` 失敗) は最小 fallback として文字列のまま通す。
 */
export const formatAllowlistEntriesForHelp = (allowlist: readonly string[]): readonly string[] =>
  allowlist.map((origin): string => {
    try {
      const parsed = new URL(origin)
      if (parsed.port === '') {
        return parsed.hostname
      }
      return `${parsed.hostname}:${parsed.port}`
    } catch {
      return origin
    }
  })

const formatRewrittenInputHostEntries = (): readonly string[] =>
  REWRITTEN_INPUT_HOSTS.map(({ input, target }): string =>
    translate('online.help.url_rewritten', { input, target })
  )

/**
 * `<script id="online-allowlist">` JSON を読んで、Open URL modal の help block に並べる
 * 表示行を組み立てる pure 関数。実 allowlist (build 時 `MDXG_ONLINE_CONNECT_SRC` で拡張可、
 * §11.b) を head に、`REWRITTEN_INPUT_HOSTS` (`online-url-normalize.ts` の single source) を
 * tail に並べる。fail-safe は `resolveOnlineAllowlistFromJson` が DEFAULT を返す経路で吸収。
 */
export const buildHelpEntriesFromAllowlistJson = (jsonText: string): readonly string[] => [
  ...formatAllowlistEntriesForHelp(resolveOnlineAllowlistFromJson(jsonText)),
  ...formatRewrittenInputHostEntries(),
]

const injectAllowlistIntoHelp = (): void => {
  const list = document.getElementById(OPEN_URL_HELP_ALLOWLIST_ID)
  if (!(list instanceof HTMLUListElement)) {
    return
  }
  const entries = buildHelpEntriesFromAllowlistJson(readAllowlistJsonText())
  list.replaceChildren(
    ...entries.map((entry): HTMLLIElement => {
      const li = document.createElement('li')
      li.textContent = entry
      return li
    })
  )
}

const wireOpenButton = (controller: StaticModalController): void => {
  const btn = qs(`#${OPEN_URL_BUTTON_ID}`)
  btn.addEventListener('click', (): void => {
    controller.open()
  })
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
  wireOpenButton(controller)
  wireFormListeners()
  injectAllowlistIntoHelp()
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

  describe('buildHelpEntriesFromAllowlistJson', () => {
    it('既定 allowlist + REWRITTEN_INPUT_HOSTS の順で並ぶ', () => {
      const json = '["https://raw.githubusercontent.com","https://gist.githubusercontent.com"]'
      expect([...buildHelpEntriesFromAllowlistJson(json)]).toEqual([
        'raw.githubusercontent.com',
        'gist.githubusercontent.com',
        'github.com (rewritten to raw.githubusercontent.com)',
        'gist.github.com (rewritten to gist.githubusercontent.com)',
      ])
    })

    it('env で拡張された allowlist host が head に追加され、rewritten host は常に tail に並ぶ', () => {
      const json =
        '["https://raw.githubusercontent.com","https://gist.githubusercontent.com","https://wiki.internal"]'
      expect([...buildHelpEntriesFromAllowlistJson(json)]).toEqual([
        'raw.githubusercontent.com',
        'gist.githubusercontent.com',
        'wiki.internal',
        'github.com (rewritten to raw.githubusercontent.com)',
        'gist.github.com (rewritten to gist.githubusercontent.com)',
      ])
    })

    it('JSON 壊れは DEFAULT allowlist に fail-safe で倒れ、rewritten host は引き続き表示', () => {
      expect([...buildHelpEntriesFromAllowlistJson('not json')]).toEqual([
        'raw.githubusercontent.com',
        'gist.githubusercontent.com',
        'github.com (rewritten to raw.githubusercontent.com)',
        'gist.github.com (rewritten to gist.githubusercontent.com)',
      ])
    })
  })

  describe('formatAllowlistEntriesForHelp', () => {
    it('既定 origin から host だけ取り出す (scheme 重複表示を避ける)', () => {
      expect(
        formatAllowlistEntriesForHelp([
          'https://raw.githubusercontent.com',
          'https://gist.githubusercontent.com',
        ])
      ).toEqual(['raw.githubusercontent.com', 'gist.githubusercontent.com'])
    })

    it('non-default port は host:port で残す (自前ホスティング向け)', () => {
      expect(formatAllowlistEntriesForHelp(['https://wiki.internal:8443'])).toEqual([
        'wiki.internal:8443',
      ])
    })

    it('parse 不能な origin はそのまま fallback で通す', () => {
      expect(formatAllowlistEntriesForHelp(['not a url'])).toEqual(['not a url'])
    })

    it('大文字 host は URL 正規化で lowercase になる', () => {
      expect(formatAllowlistEntriesForHelp(['https://RAW.GitHubUserContent.com'])).toEqual([
        'raw.githubusercontent.com',
      ])
    })
  })
}
