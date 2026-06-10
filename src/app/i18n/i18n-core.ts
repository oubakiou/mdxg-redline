// i18n の純粋ロジック層 (Node / ブラウザ共通)。
// 副作用ゼロで in-source test できる粒度に保つ。設計判断は docs/feature-ui-i18n.md §3.2 / §3.4 を参照。

export type Lang = 'en' | 'ja'

export type PluralBaseKey =
  | 'comments.count_label'
  | 'toast.render_failed'
  | 'modal.confirm_delete_comments'
  | 'search.count'

// POSIX 通り LC_ALL > LC_MESSAGES > LANG の 3 段。空文字 / 未設定は「未設定」として skip。
const ENV_PRECEDENCE = ['LC_ALL', 'LC_MESSAGES', 'LANG'] as const

const JA_LOCALE_RE = /^ja(_|-|$)/i

const isJapaneseLocale = (raw: string): boolean => JA_LOCALE_RE.test(raw)

const langFromLocaleString = (raw: string): Lang => {
  if (isJapaneseLocale(raw)) {
    return 'ja'
  }
  return 'en'
}

export const detectLangFromEnv = (env: {
  LC_ALL?: string
  LC_MESSAGES?: string
  LANG?: string
}): Lang => {
  for (const key of ENV_PRECEDENCE) {
    const raw = env[key]
    if (typeof raw === 'string' && raw !== '') {
      return langFromLocaleString(raw)
    }
  }
  return 'en'
}

export const detectLangFromNavigator = (language: string | null): Lang => {
  if (typeof language !== 'string') {
    return 'en'
  }
  const trimmed = language.trim()
  if (trimmed === '') {
    return 'en'
  }
  return langFromLocaleString(trimmed)
}

const isLang = (value: unknown): value is Lang => value === 'en' || value === 'ja'

const normalizeNavigatorInput = (raw: string | null | undefined): string | null => {
  if (typeof raw === 'string') {
    return raw
  }
  return null
}

export const resolveInitialLang = (input: {
  storage?: string | null
  navigatorLanguage?: string | null
}): Lang => {
  if (isLang(input.storage)) {
    return input.storage
  }
  return detectLangFromNavigator(normalizeNavigatorInput(input.navigatorLanguage))
}

const PLACEHOLDER_RE = /\{(\w+)\}/g

type TranslateParams = Readonly<Record<string, string | number>>

const formatTemplate = (template: string, params?: TranslateParams): string => {
  if (!params) {
    return template
  }
  return template.replace(PLACEHOLDER_RE, (whole, name: string) => {
    if (!Object.hasOwn(params, name)) {
      return whole
    }
    const value = params[name]
    if (typeof value !== 'string' && typeof value !== 'number') {
      return whole
    }
    return String(value)
  })
}

// 辞書は Record<string, string> として扱う。型安全性は wrapper (i18n-browser / cli/i18n) 側で
// MessageKey / CliMessageKey に絞り込んで保証する。core 層では `as K` の unsafe assertion を避ける。
export type MessageDict = Readonly<Record<string, string>>

export const translate = (dict: MessageDict, key: string, params?: TranslateParams): string => {
  const template = dict[key]
  // 未知の key は key 文字列をそのまま返す。dev 時の検出を容易にする。
  if (typeof template !== 'string') {
    return key
  }
  return formatTemplate(template, params)
}

type PluralSuffix = '_zero' | '_one' | '_other'

const selectPluralSuffix = (count: number): PluralSuffix => {
  if (count === 0) {
    return '_zero'
  }
  if (count === 1) {
    return '_one'
  }
  return '_other'
}

export interface TranslatePluralOptions {
  baseKey: PluralBaseKey
  count: number
  params?: TranslateParams
}

export const translatePlural = (dict: MessageDict, options: TranslatePluralOptions): string => {
  const { baseKey, count, params } = options
  const suffix = selectPluralSuffix(count)
  const candidate = `${baseKey}${suffix}`
  const fallback = `${baseKey}_other`
  let key = fallback
  if (typeof dict[candidate] === 'string') {
    key = candidate
  }
  // count は judgement 値と表示値の整合のため後勝ちにする。caller の params に同名 `count` が
  // 渡されても count: 3 で判定して "99 comments" になるような不整合は許容しない。
  const merged: Record<string, string | number> = { ...params, count }
  return translate(dict, key, merged)
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  // describe を分割しているのは max-statements (10) を満たすため。

  describe('detectLangFromEnv: 単一 env', () => {
    it('LANG=ja_JP.UTF-8 → ja', () => {
      expect(detectLangFromEnv({ LANG: 'ja_JP.UTF-8' })).toBe('ja')
    })

    it('LANG=en_US.UTF-8 → en', () => {
      expect(detectLangFromEnv({ LANG: 'en_US.UTF-8' })).toBe('en')
    })

    it('LANG=C / POSIX → en', () => {
      expect(detectLangFromEnv({ LANG: 'C' })).toBe('en')
      expect(detectLangFromEnv({ LANG: 'POSIX' })).toBe('en')
    })

    it('LANG=ja-JP (ハイフン区切り) → ja', () => {
      expect(detectLangFromEnv({ LANG: 'ja-JP' })).toBe('ja')
    })

    it('全未設定 → en', () => {
      expect(detectLangFromEnv({})).toBe('en')
    })
  })

  describe('detectLangFromEnv: POSIX 3 段優先順位', () => {
    it('LC_ALL が LANG を override', () => {
      expect(detectLangFromEnv({ LANG: 'en_US.UTF-8', LC_ALL: 'ja_JP.UTF-8' })).toBe('ja')
    })

    it('LC_MESSAGES が LANG を override', () => {
      expect(detectLangFromEnv({ LANG: 'en_US.UTF-8', LC_MESSAGES: 'ja_JP.UTF-8' })).toBe('ja')
    })

    it('LC_ALL が全てを override', () => {
      expect(
        detectLangFromEnv({
          LANG: 'ja_JP.UTF-8',
          LC_ALL: 'en_US.UTF-8',
          LC_MESSAGES: 'ja_JP.UTF-8',
        })
      ).toBe('en')
    })
  })

  describe('detectLangFromEnv: 空文字 skip', () => {
    it('LC_ALL="" → LC_MESSAGES へ fallback', () => {
      expect(
        detectLangFromEnv({ LANG: 'en_US.UTF-8', LC_ALL: '', LC_MESSAGES: 'ja_JP.UTF-8' })
      ).toBe('ja')
    })

    it('LC_ALL="" / LC_MESSAGES="" → LANG へ fallback', () => {
      expect(detectLangFromEnv({ LANG: 'ja_JP.UTF-8', LC_ALL: '', LC_MESSAGES: '' })).toBe('ja')
    })

    it('全空文字 → 最終 fallback en', () => {
      expect(detectLangFromEnv({ LANG: '', LC_ALL: '', LC_MESSAGES: '' })).toBe('en')
    })
  })

  describe('detectLangFromNavigator: ja 系', () => {
    it('ja → ja', () => {
      expect(detectLangFromNavigator('ja')).toBe('ja')
    })

    it('ja-JP → ja', () => {
      expect(detectLangFromNavigator('ja-JP')).toBe('ja')
    })

    it('ja-Hira-JP → ja', () => {
      expect(detectLangFromNavigator('ja-Hira-JP')).toBe('ja')
    })

    it('大文字 JA-JP (大小無視) → ja', () => {
      expect(detectLangFromNavigator('JA-JP')).toBe('ja')
    })

    it('空白付き " ja " → ja (trim 後にマッチ)', () => {
      expect(detectLangFromNavigator(' ja ')).toBe('ja')
    })
  })

  describe('detectLangFromNavigator: 非 ja 系', () => {
    it('en-US → en', () => {
      expect(detectLangFromNavigator('en-US')).toBe('en')
    })

    it('fr → en', () => {
      expect(detectLangFromNavigator('fr')).toBe('en')
    })

    it('zh-CN / ko-KR → en', () => {
      expect(detectLangFromNavigator('zh-CN')).toBe('en')
      expect(detectLangFromNavigator('ko-KR')).toBe('en')
    })

    it('空文字 → en', () => {
      expect(detectLangFromNavigator('')).toBe('en')
    })

    it('null → en', () => {
      expect(detectLangFromNavigator(null)).toBe('en')
    })
  })

  describe('resolveInitialLang', () => {
    it('storage 優先 (ja) > navigator (en)', () => {
      expect(resolveInitialLang({ navigatorLanguage: 'en-US', storage: 'ja' })).toBe('ja')
    })

    it('storage 優先 (en) > navigator (ja)', () => {
      expect(resolveInitialLang({ navigatorLanguage: 'ja-JP', storage: 'en' })).toBe('en')
    })

    it('storage null → navigator fallback', () => {
      expect(resolveInitialLang({ navigatorLanguage: 'ja-JP', storage: null })).toBe('ja')
      expect(resolveInitialLang({ navigatorLanguage: 'en-US', storage: null })).toBe('en')
    })

    it('storage 不正値 / 空文字 → navigator fallback', () => {
      expect(resolveInitialLang({ navigatorLanguage: 'ja-JP', storage: 'fr' })).toBe('ja')
      expect(resolveInitialLang({ navigatorLanguage: 'ja-JP', storage: '' })).toBe('ja')
    })

    it('両方 null / 未指定 → en', () => {
      expect(resolveInitialLang({ navigatorLanguage: null, storage: null })).toBe('en')
      expect(resolveInitialLang({})).toBe('en')
    })
  })

  describe('translate: 基本', () => {
    const dict = {
      multi: '{first} and {second}',
      simple: 'Hello',
      withCount: '{count} items',
      withName: 'Hello, {name}!',
    } as const

    it('既知 key を返す', () => {
      expect(translate(dict, 'simple')).toBe('Hello')
    })

    it('未知 key は key 文字列を返す', () => {
      expect(translate(dict, 'unknown')).toBe('unknown')
    })

    it('placeholder を展開 (文字列)', () => {
      expect(translate(dict, 'withName', { name: 'world' })).toBe('Hello, world!')
    })

    it('placeholder を展開 (数値)', () => {
      expect(translate(dict, 'withCount', { count: 3 })).toBe('3 items')
    })

    it('複数 placeholder', () => {
      expect(translate(dict, 'multi', { first: '1', second: '2' })).toBe('1 and 2')
    })

    it('参照されない placeholder は残す (silent fail せず気付かせる)', () => {
      expect(translate(dict, 'multi', { first: '1' })).toBe('1 and {second}')
    })

    it('余分な params は無視', () => {
      expect(translate(dict, 'simple', { extra: 'x' })).toBe('Hello')
    })
  })

  describe('translatePlural', () => {
    const dict = {
      'comments.count_label_one': '{count} comment',
      'comments.count_label_other': '{count} comments',
      'comments.count_label_zero': '{count} comments',
      'search.count_one': '{total} match',
      'search.count_other': '{total} matches',
      'toast.render_failed_one': 'Failed to render {count} block',
      'toast.render_failed_other': 'Failed to render {count} blocks',
    } as const

    it('count=0 → _zero', () => {
      expect(translatePlural(dict, { baseKey: 'comments.count_label', count: 0 })).toBe(
        '0 comments'
      )
    })

    it('count=1 → _one', () => {
      expect(translatePlural(dict, { baseKey: 'comments.count_label', count: 1 })).toBe('1 comment')
    })

    it('count=3 → _other', () => {
      expect(translatePlural(dict, { baseKey: 'comments.count_label', count: 3 })).toBe(
        '3 comments'
      )
    })

    it('_zero 不在で count=0 → _other に fall back (toast.render_failed)', () => {
      expect(translatePlural(dict, { baseKey: 'toast.render_failed', count: 0 })).toBe(
        'Failed to render 0 blocks'
      )
    })

    it('追加 params で {total} placeholder に流す', () => {
      expect(
        translatePlural(dict, { baseKey: 'search.count', count: 1, params: { total: 1 } })
      ).toBe('1 match')
      expect(
        translatePlural(dict, { baseKey: 'search.count', count: 5, params: { total: 5 } })
      ).toBe('5 matches')
    })

    it('caller params の count は判定値で上書きされる (judgement / 表示の整合)', () => {
      expect(
        translatePlural(dict, { baseKey: 'comments.count_label', count: 3, params: { count: 99 } })
      ).toBe('3 comments')
    })
  })
}
