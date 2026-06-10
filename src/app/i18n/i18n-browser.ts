// i18n のブラウザ副作用層。<html lang> / localStorage / DOM 反映を扱う。
// 純粋ロジックは i18n-core.ts に分離されており、本ファイルは Node では import できない
// (document / localStorage / navigator への依存)。設計判断は docs/feature-ui-i18n.md §3.1 / §3.5 を参照。

import {
  type Lang,
  type MessageDict,
  type TranslatePluralOptions,
  resolveInitialLang,
  translate as translateCore,
  translatePlural as translatePluralCore,
} from './i18n-core'
import { type MessageKey, messagesEn } from './messages.en'
import { messagesJa } from './messages.ja'

export const LANG_STORAGE_KEY = 'mdxg-redline.lang'

// FOUC 回避用 class。head inline script で付与され、applyI18nDataset 完了後に解除される。
export const I18N_PENDING_CLASS = 'i18n-pending'

// CSS 疑似要素 (`::before` / `::after` の content) 用の custom property マッピング。
// CSS 側は `content: var(--ui-loading-text, 'Loading…')` 形式で参照する。
// 値は CSS string リテラル形式 (single quote で囲む) で setProperty に渡す。
const CSS_PSEUDO_BINDINGS: readonly { property: string; key: MessageKey }[] = [
  { key: 'empty.loading_text', property: '--ui-loading-text' },
]

type LangListener = (lang: Lang) => void

type TranslateParams = Readonly<Record<string, string | number>>

const DICTS: Record<Lang, MessageDict> = {
  en: messagesEn,
  ja: messagesJa,
}

let currentLang: Lang = 'en'
const listeners: LangListener[] = []

const isLang = (value: unknown): value is Lang => value === 'en' || value === 'ja'

const currentDict = (): MessageDict => DICTS[currentLang]

export const getLang = (): Lang => currentLang

export const readStoredLang = (): Lang | null => {
  try {
    const raw = localStorage.getItem(LANG_STORAGE_KEY)
    if (isLang(raw)) {
      return raw
    }
    return null
  } catch {
    return null
  }
}

// 内部 try/catch で localStorage 例外を握りつぶす (Private モード / Quota / SecurityError)。
// 副作用最後に呼ばれる前提だが二重防御として関数自体も throw しない契約にする。
export const writeStoredLang = (value: Lang): void => {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, value)
  } catch {
    // ignore
  }
}

export const nextStoredLang = (current: Lang): Lang => {
  if (current === 'en') {
    return 'ja'
  }
  return 'en'
}

const readNavigatorLanguage = (): string | null => {
  if (typeof navigator === 'undefined') {
    return null
  }
  const raw = navigator.language
  if (typeof raw === 'string') {
    return raw
  }
  return null
}

// bootstrap で呼ぶ初期化 API (state 確定 + <html lang> 再同期)。
// head script の setTimeout fallback で lang="en" に戻されたケース (module 遅延成功) でも
// DOM と state が整合するよう、<html lang> を再同期する。
// localStorage 書き込みや subscriber 通知は伴わない軽量初期化。
export const initLangFromBrowser = (): Lang => {
  const storage = readStoredLang()
  const navigatorLanguage = readNavigatorLanguage()
  const lang = resolveInitialLang({ navigatorLanguage, storage })
  currentLang = lang
  document.documentElement.lang = lang
  return lang
}

const I18N_SELECTORS = [
  '[data-i18n]',
  '[data-i18n-aria-label]',
  '[data-i18n-placeholder]',
  '[data-i18n-title]',
  '[data-i18n-data-tooltip]',
] as const

// 全 i18n 属性を一括 query → JS 側で #doc 配下フィルタを実施する。
// `:not(#doc *)` CSS は happy-dom / 一部古い browser で不安定 (`* :not(#a *)` 系の解釈差) のため、
// `closest('#doc')` でアンカリング保護領域を判定する方式に統一して環境依存を排除する。
const I18N_BASE_SELECTOR = I18N_SELECTORS.join(', ')
const DOC_PROTECTED_ROOT_ID = 'doc'

// `#doc` 配下に置いても安全な構造的例外: `[data-footnote-backref]` は text-segment-skip-rules.ts:44
// で既にアンカリング skip 対象。aria-label のみ翻訳 (textContent (↩) は不変)。
const isFootnoteBackrefException = (el: Element): boolean =>
  el.hasAttribute('data-footnote-backref') && el.hasAttribute('data-i18n-aria-label')

const isInsideDocProtectedRoot = (el: Element): boolean =>
  el.closest(`#${DOC_PROTECTED_ROOT_ID}`) !== null

const shouldTranslate = (el: Element): boolean => {
  if (!isInsideDocProtectedRoot(el)) {
    return true
  }
  return isFootnoteBackrefException(el)
}

const isPlainTranslateParams = (value: unknown): value is TranslateParams => {
  if (value === null || typeof value !== 'object') {
    return false
  }
  for (const entry of Object.values(value)) {
    if (typeof entry !== 'string' && typeof entry !== 'number') {
      return false
    }
  }
  return true
}

const parseI18nParams = (raw: string | undefined): TranslateParams | null => {
  if (typeof raw !== 'string' || raw === '') {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isPlainTranslateParams(parsed)) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

const translateForDataset = (key: string, params: TranslateParams | null): string => {
  if (params === null) {
    return translateCore(currentDict(), key)
  }
  return translateCore(currentDict(), key, params)
}

const applyTextContent = (
  el: HTMLElement,
  key: string | undefined,
  params: TranslateParams | null
): void => {
  if (typeof key !== 'string') {
    return
  }
  if (import.meta.env.DEV && el.children.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[i18n] data-i18n="${key}" on non-leaf element (children=${el.children.length}). Wrap text in a leaf <span data-i18n="..."> instead.`,
      el
    )
  }
  el.textContent = translateForDataset(key, params)
}

const ATTR_BINDINGS: readonly { datasetKey: string; attribute: string }[] = [
  { attribute: 'aria-label', datasetKey: 'i18nAriaLabel' },
  { attribute: 'placeholder', datasetKey: 'i18nPlaceholder' },
  { attribute: 'title', datasetKey: 'i18nTitle' },
  { attribute: 'data-tooltip', datasetKey: 'i18nDataTooltip' },
]

const applyAttributeBindings = (
  el: HTMLElement,
  dataset: DOMStringMap,
  params: TranslateParams | null
): void => {
  for (const { attribute, datasetKey } of ATTR_BINDINGS) {
    const key = dataset[datasetKey]
    if (typeof key === 'string') {
      el.setAttribute(attribute, translateForDataset(key, params))
    }
  }
}

const applyToElement = (el: HTMLElement): void => {
  const { dataset } = el
  const params = parseI18nParams(dataset.i18nParams)
  // #doc 配下の構造的例外 (footnote backref 等) では、data-i18n が誤って付いていても
  // textContent 置換を skip する。アンカリングは textContent シーケンスベースで計算されるため
  // (DESIGN.md §6)、構造的例外でも本文 textContent を書き換えると不変条件が壊れる。
  // attribute のみ翻訳することでアンカリング保護を二重に担保する。
  if (!isInsideDocProtectedRoot(el)) {
    applyTextContent(el, dataset.i18n, params)
  }
  applyAttributeBindings(el, dataset, params)
}

const collectTargets = (root: Document | Element): Element[] => {
  const targets: Element[] = []
  // root 自身が i18n 属性を持つ場合も対象に含める (querySelectorAll は子孫のみ)。
  if (root instanceof Element && root.matches(I18N_BASE_SELECTOR) && shouldTranslate(root)) {
    targets.push(root)
  }
  for (const el of root.querySelectorAll(I18N_BASE_SELECTOR)) {
    if (shouldTranslate(el)) {
      targets.push(el)
    }
  }
  return targets
}

const applyCssPseudoBindings = (): void => {
  const dict = currentDict()
  const { style } = document.documentElement
  for (const { key, property } of CSS_PSEUDO_BINDINGS) {
    const value = translateCore(dict, key)
    style.setProperty(property, `'${value}'`)
  }
}

export const applyI18nDataset = (root: Document | Element): void => {
  for (const target of collectTargets(root)) {
    if (target instanceof HTMLElement) {
      applyToElement(target)
    }
  }
  // CSS 疑似要素用の custom property も更新 (`::before` の content 等)。
  // Document を root にした初期描画 / setLang 経由の再描画で常に走らせる。
  if (root === document) {
    applyCssPseudoBindings()
  }
}

// 副作用順序: state → DOM 反映 → 通知 → 永続化 (最後)。
// localStorage 失敗 (Private モード / Quota / SecurityError) で writeStoredLang が
// throw しても、それより前の DOM 反映と subscriber 通知は完了済みになる。
export const setLang = (lang: Lang): void => {
  currentLang = lang
  document.documentElement.lang = lang
  applyI18nDataset(document)
  // 反復中に listener 内から unsubscribe() を呼ばれても次の listener がスキップされないよう
  // 配列をスナップショットしてから反復する。
  const snapshot = [...listeners]
  for (const listener of snapshot) {
    listener(lang)
  }
  writeStoredLang(lang)
}

export const subscribeLangChange = (listener: LangListener): (() => void) => {
  listeners.push(listener)
  return (): void => {
    const idx = listeners.indexOf(listener)
    if (idx !== -1) {
      listeners.splice(idx, 1)
    }
  }
}

export const translate = (key: MessageKey, params?: TranslateParams): string =>
  translateCore(currentDict(), key, params)

export const translatePlural = (options: TranslatePluralOptions): string =>
  translatePluralCore(currentDict(), options)

if (import.meta.vitest) {
  const { afterEach, beforeEach, describe, expect, it } = import.meta.vitest

  const resetState = (): void => {
    currentLang = 'en'
    listeners.length = 0
    try {
      localStorage.removeItem(LANG_STORAGE_KEY)
    } catch {
      // ignore
    }
    document.documentElement.removeAttribute('lang')
    document.documentElement.style.removeProperty('--ui-loading-text')
    document.body.innerHTML = ''
  }

  // test 専用 helper のため import.meta.vitest block 内に置く。
  // eslint-disable-next-line unicorn/consistent-function-scoping
  const querySpan = (selector = 'span'): HTMLElement => {
    const el = document.querySelector<HTMLElement>(selector)
    if (!el) {
      throw new Error(`fixture missing: ${selector}`)
    }
    return el
  }

  beforeEach(resetState)
  afterEach(resetState)

  describe('readStoredLang / writeStoredLang', () => {
    it('en/ja を read-after-write できる', () => {
      writeStoredLang('ja')
      expect(readStoredLang()).toBe('ja')
      writeStoredLang('en')
      expect(readStoredLang()).toBe('en')
    })

    it('未保存は null', () => {
      expect(readStoredLang()).toBe(null)
    })

    it('不正値が入っていても null', () => {
      localStorage.setItem(LANG_STORAGE_KEY, 'fr')
      expect(readStoredLang()).toBe(null)
    })
  })

  describe('nextStoredLang', () => {
    it('en → ja → en の循環', () => {
      expect(nextStoredLang('en')).toBe('ja')
      expect(nextStoredLang('ja')).toBe('en')
    })
  })

  describe('initLangFromBrowser', () => {
    it('localStorage 値があれば優先', () => {
      writeStoredLang('ja')
      expect(initLangFromBrowser()).toBe('ja')
      expect(document.documentElement.lang).toBe('ja')
      expect(getLang()).toBe('ja')
    })

    it('localStorage がなければ navigator.language fallback (happy-dom の language は en)', () => {
      expect(initLangFromBrowser()).toBe('en')
      expect(document.documentElement.lang).toBe('en')
    })

    it('subscribers は通知されない (軽量初期化)', () => {
      let called = 0
      subscribeLangChange(() => {
        called += 1
      })
      initLangFromBrowser()
      expect(called).toBe(0)
    })
  })

  describe('setLang: 状態反映と順序', () => {
    it('state / <html lang> / DOM を全て更新', () => {
      document.body.innerHTML = '<span data-i18n="toolbar.open"></span>'
      setLang('ja')
      expect(getLang()).toBe('ja')
      expect(document.documentElement.lang).toBe('ja')
      expect(querySpan().textContent).toBe('開く')
    })

    it('localStorage に永続化', () => {
      setLang('ja')
      expect(readStoredLang()).toBe('ja')
    })

    it('subscribers が新 lang を受け取る', () => {
      const received: Lang[] = []
      subscribeLangChange((lang) => received.push(lang))
      setLang('ja')
      setLang('en')
      expect(received).toEqual(['ja', 'en'])
    })

    it('反復中の unsubscribe で B / C が今回の呼び出しでも走る', () => {
      const called: string[] = []
      let unsubA: (() => void) | null = null
      unsubA = subscribeLangChange(() => {
        called.push('a')
        if (unsubA !== null) {
          unsubA()
        }
      })
      subscribeLangChange(() => called.push('b'))
      subscribeLangChange(() => called.push('c'))
      setLang('ja')
      expect(called).toEqual(['a', 'b', 'c'])
      setLang('en')
      expect(called).toEqual(['a', 'b', 'c', 'b', 'c'])
    })
  })

  describe('applyI18nDataset: textContent', () => {
    it('data-i18n で textContent を翻訳', () => {
      document.body.innerHTML = '<span data-i18n="toolbar.open"></span>'
      setLang('ja')
      expect(querySpan().textContent).toBe('開く')
    })

    it('#doc 配下の要素は翻訳されない', () => {
      document.body.innerHTML =
        '<div id="doc"><span data-i18n="toolbar.open">untouched</span></div>'
      setLang('ja')
      expect(querySpan('#doc span').textContent).toBe('untouched')
    })

    it('#doc 配下でも data-footnote-backref + data-i18n-aria-label は aria 翻訳が走る', () => {
      document.body.innerHTML =
        '<div id="doc"><a data-footnote-backref data-i18n-aria-label="footnote.backref_aria" data-i18n-params=\'{"label":"1"}\'>↩</a></div>'
      setLang('ja')
      const anchor = querySpan('#doc a')
      expect(anchor.getAttribute('aria-label')).toBe('参照 1 に戻る')
      // textContent は不変 (↩ のまま) でアンカリングを壊さない
      expect(anchor.textContent).toBe('↩')
    })

    it('regression: #doc 配下の構造的例外要素に data-i18n が誤って付いても textContent は不変', () => {
      // footnote backref に開発ミスで data-i18n が混入したケース。
      // shouldTranslate で要素自体は包含されても、applyToElement の isInsideDocProtectedRoot
      // ガードで textContent 置換は skip され、attribute のみ翻訳される。
      document.body.innerHTML =
        '<div id="doc"><a data-footnote-backref data-i18n="toolbar.open" data-i18n-aria-label="footnote.backref_aria" data-i18n-params=\'{"label":"1"}\'>↩</a></div>'
      setLang('ja')
      const anchor = querySpan('#doc a')
      // aria-label は翻訳される
      expect(anchor.getAttribute('aria-label')).toBe('参照 1 に戻る')
      // textContent は不変 (data-i18n="toolbar.open" は無視される)
      expect(anchor.textContent).toBe('↩')
    })

    it('root 自身が SELECTOR にマッチする場合も翻訳対象に含める', () => {
      document.body.innerHTML = '<span id="status" data-i18n="toolbar.status_no_file"></span>'
      const status = document.getElementById('status')
      if (!status) {
        throw new Error('status fixture missing')
      }
      applyI18nDataset(status)
      expect(status.textContent).toBe('No file')
    })
  })

  describe('applyI18nDataset: 属性とパラメータ', () => {
    it('aria-label / placeholder / title / data-tooltip 各属性を翻訳', () => {
      document.body.innerHTML =
        '<input data-i18n-aria-label="toolbar.search_aria" data-i18n-placeholder="toolbar.search_placeholder" data-i18n-title="toolbar.search_tooltip" data-i18n-data-tooltip="toolbar.kbd_help_tooltip" />'
      setLang('en')
      const input = querySpan('input')
      expect(input.getAttribute('aria-label')).toBe('Search the document')
      expect(input.getAttribute('placeholder')).toBe('Find in document')
      expect(input.getAttribute('title')).toBe('Search (f)')
      expect(input.getAttribute('data-tooltip')).toBe('Keyboard shortcuts (h)')
    })

    it('data-i18n-params で placeholder を展開', () => {
      document.body.innerHTML =
        '<span data-i18n="toolbar.status_loaded" data-i18n-params=\'{"docName":"spec","docHash":"abc"}\'></span>'
      setLang('en')
      expect(querySpan().textContent).toBe('spec (abc) · loaded')
    })

    it('data-i18n-params の JSON parse 失敗は params なし扱い', () => {
      document.body.innerHTML =
        '<span data-i18n="toolbar.status_loaded" data-i18n-params="not-json"></span>'
      setLang('en')
      // placeholder が展開されないため raw のままになる
      expect(querySpan().textContent).toBe('{docName} ({docHash}) · loaded')
    })
  })

  describe('CSS 疑似要素 binding', () => {
    it('--ui-loading-text を setProperty で更新', () => {
      setLang('en')
      expect(document.documentElement.style.getPropertyValue('--ui-loading-text')).toBe(
        "'Loading…'"
      )
      setLang('ja')
      expect(document.documentElement.style.getPropertyValue('--ui-loading-text')).toBe(
        "'読み込み中…'"
      )
    })
  })

  describe('subscribeLangChange', () => {
    it('同一 listener を 2 回登録すると 2 回呼ばれる (dedupe しない契約)', () => {
      let count = 0
      const listener = (): void => {
        count += 1
      }
      subscribeLangChange(listener)
      subscribeLangChange(listener)
      setLang('ja')
      expect(count).toBe(2)
    })

    it('unsubscribe を 2 回呼んでも例外を投げない', () => {
      let called = 0
      const unsub = subscribeLangChange(() => {
        called += 1
      })
      unsub()
      expect(() => unsub()).not.toThrow()
      expect(called).toBe(0)
    })
  })

  describe('translate / translatePlural wrapper', () => {
    it('現在の lang の辞書を引く', () => {
      setLang('en')
      expect(translate('toolbar.open')).toBe('Open')
      setLang('ja')
      expect(translate('toolbar.open')).toBe('開く')
    })

    it('translatePlural は現在の lang で複数形分岐', () => {
      setLang('en')
      expect(translatePlural({ baseKey: 'comments.count_label', count: 1 })).toBe('1 comment')
      expect(translatePlural({ baseKey: 'comments.count_label', count: 3 })).toBe('3 comments')
      setLang('ja')
      expect(translatePlural({ baseKey: 'comments.count_label', count: 1 })).toBe('1 件のコメント')
    })
  })
}
