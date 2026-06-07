// build pipeline が `<script type="application/json" id="online-asset-manifest">` に inline
// する asset manifest を parse する pure module。fingerprinted パス (hash 付き、
// `Cache-Control: immutable` 対象) と canonical パス (no-hash、404 retry 先) の 2 軸を解決する。
//
// manifest が欠落 / 壊れている場合は EMPTY_MANIFEST を返し、resolve 系関数が canonical
// パスに fail-safe する。これにより、manifest 注入が未実装の状態や、古い HTML cache + 古い
// manifest + 新 deploy の 3 段ずれ世代でも canonical 経路で動作を保てる。

import { SHIKI_SUPPORTED_LANGS, type SupportedLang } from './shiki-aliases.generated'

const SHIKI_SUPPORTED_LANGS_SET = new Set<string>(SHIKI_SUPPORTED_LANGS)

export interface KatexAssetPaths {
  css: string
  fontsExtraCss: string
  js: string
}

export interface OnlineAssetManifest {
  katex: KatexAssetPaths | null
  mermaid: string | null
  shikiLangs: Readonly<Partial<Record<SupportedLang, string>>>
}

export const EMPTY_MANIFEST: OnlineAssetManifest = Object.freeze({
  katex: null,
  mermaid: null,
  shikiLangs: Object.freeze({} as Readonly<Partial<Record<SupportedLang, string>>>),
})

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0

const parseShikiLangs = (raw: unknown): Readonly<Partial<Record<SupportedLang, string>>> => {
  if (!isPlainObject(raw)) {
    return {}
  }
  const out: Partial<Record<SupportedLang, string>> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (SHIKI_SUPPORTED_LANGS_SET.has(key) && isNonEmptyString(value)) {
      // ホワイトリスト判定 + string 判定済みなので key は SupportedLang として安全。
      // narrow を引数で受けるパターンに変えると型推論経路が増えて読み辛いため、ここだけ局所的に
      // assertion を許容する。
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      out[key as SupportedLang] = value
    }
  }
  return out
}

const parseKatex = (raw: unknown): KatexAssetPaths | null => {
  if (!isPlainObject(raw)) {
    return null
  }
  const { js } = raw
  const { css } = raw
  const { fontsExtraCss } = raw
  if (!isNonEmptyString(js) || !isNonEmptyString(css) || !isNonEmptyString(fontsExtraCss)) {
    return null
  }
  return { css, fontsExtraCss, js }
}

const parseMermaid = (raw: unknown): string | null => {
  if (isNonEmptyString(raw)) {
    return raw
  }
  return null
}

// 破損 manifest を検出した時に console.warn を 1 度だけ出すための module-level flag。
// build pipeline 未完成期の空文字 / 要素不在は warn 対象外で、明示的に「壊れた payload」
// (parse 失敗 / 非 object) のときだけ警告を 1 回出す。
let warnedMalformedManifest = false

const warnMalformedManifestOnce = (): void => {
  if (warnedMalformedManifest) {
    return
  }
  warnedMalformedManifest = true
  /* eslint-disable-next-line no-console */
  console.warn('mdxg: online-asset-manifest is malformed; falling back to canonical asset paths.')
}

/** test 用に malformed warn flag を reset する */
export const resetManifestWarnFlagForTest = (): void => {
  warnedMalformedManifest = false
}

/**
 * `<script id="online-asset-manifest">` の JSON 文字列を OnlineAssetManifest に parse する。
 * JSON 不正 / 型ガード失敗時は EMPTY_MANIFEST を返す fail-safe + console.warn を 1 度だけ出す。
 * 空文字入力は manifest 未注入の正常状態として扱い、warn しない。
 */
export const parseOnlineAssetManifest = (json: string): OnlineAssetManifest => {
  if (json.trim().length === 0) {
    return EMPTY_MANIFEST
  }
  const parsed = ((): unknown => {
    try {
      return JSON.parse(json)
    } catch {
      return null
    }
  })()
  if (!isPlainObject(parsed)) {
    warnMalformedManifestOnce()
    return EMPTY_MANIFEST
  }
  return {
    katex: parseKatex(parsed.katex),
    mermaid: parseMermaid(parsed.mermaid),
    shikiLangs: parseShikiLangs(parsed.shikiLangs),
  }
}

/** Shiki grammar の canonical (no-hash) パス。fingerprinted 404 時の retry 先。 */
export const resolveCanonicalShikiLangPath = (lang: SupportedLang): string =>
  `canonical/shiki-langs/${lang}.json`

/** Mermaid runtime の canonical (no-hash) パス。import() reject 時の retry 先。 */
export const resolveCanonicalMermaidPath = (): string => 'canonical/mermaid.mjs'

/** KaTeX の canonical (no-hash) パス群。JS は import() reject 時、CSS は 404 時の retry 先。 */
export const resolveCanonicalKatexPaths = (): KatexAssetPaths => ({
  css: 'canonical/katex/katex.css',
  fontsExtraCss: 'canonical/katex/katex-fonts-extra.css',
  js: 'canonical/katex/katex.mjs',
})

/**
 * manifest 内の fingerprinted パスを優先し、欠落時は canonical パスに fail-safe。
 * loader は本関数の戻り値を `new URL(path, baseUrl)` で resolve して fetch する。
 */
export const resolveShikiLangPath = (manifest: OnlineAssetManifest, lang: SupportedLang): string =>
  manifest.shikiLangs[lang] ?? resolveCanonicalShikiLangPath(lang)

export const resolveMermaidPath = (manifest: OnlineAssetManifest): string =>
  manifest.mermaid ?? resolveCanonicalMermaidPath()

export const resolveKatexPaths = (manifest: OnlineAssetManifest): KatexAssetPaths =>
  manifest.katex ?? resolveCanonicalKatexPaths()

const ASSET_MANIFEST_ELEMENT_ID = 'online-asset-manifest'

/**
 * `<script id="online-asset-manifest">` の textContent を DOM から読み出し parse する。
 * SSR / 非 online 経路 (要素欠落) では EMPTY_MANIFEST を返す。
 */
export const readOnlineAssetManifestFromDom = (): OnlineAssetManifest => {
  if (typeof document === 'undefined') {
    return EMPTY_MANIFEST
  }
  const el = document.getElementById(ASSET_MANIFEST_ELEMENT_ID)
  if (!(el instanceof HTMLElement)) {
    return EMPTY_MANIFEST
  }
  return parseOnlineAssetManifest(el.textContent ?? '')
}

if (import.meta.vitest) {
  const { afterEach, beforeEach, describe, expect, it, vi } = import.meta.vitest

  describe('parseOnlineAssetManifest: 空 / 不正入力', () => {
    it('空文字列は EMPTY_MANIFEST を返す', () => {
      const manifest = parseOnlineAssetManifest('')
      expect(manifest.mermaid).toBeNull()
      expect(manifest.katex).toBeNull()
      expect(Object.keys(manifest.shikiLangs)).toEqual([])
    })

    it('不正 JSON は EMPTY_MANIFEST を返す (throw しない)', () => {
      const manifest = parseOnlineAssetManifest('not-json')
      expect(manifest.mermaid).toBeNull()
      expect(manifest.katex).toBeNull()
    })

    it('JSON が object でない (array / null) なら EMPTY_MANIFEST', () => {
      expect(parseOnlineAssetManifest('[]').mermaid).toBeNull()
      expect(parseOnlineAssetManifest('null').mermaid).toBeNull()
      expect(parseOnlineAssetManifest('"string"').mermaid).toBeNull()
    })
  })

  describe('parseOnlineAssetManifest: shikiLangs', () => {
    it('ホワイトリスト言語のみを取り込み、未対応 lang は drop する', () => {
      const json = JSON.stringify({
        shikiLangs: {
          fakelang: 'fingerprinted/shiki-langs/fakelang.abc.json',
          typescript: 'fingerprinted/shiki-langs/typescript.abc.json',
        },
      })
      const manifest = parseOnlineAssetManifest(json)
      expect(manifest.shikiLangs).toEqual({
        typescript: 'fingerprinted/shiki-langs/typescript.abc.json',
      })
    })

    it('value が string でないエントリは drop する', () => {
      const json = JSON.stringify({
        shikiLangs: { javascript: 123, typescript: 'fingerprinted/x.json' },
      })
      const manifest = parseOnlineAssetManifest(json)
      expect(manifest.shikiLangs).toEqual({ typescript: 'fingerprinted/x.json' })
    })

    it('shikiLangs が欠落しても他フィールドは parse される', () => {
      const json = JSON.stringify({ mermaid: 'fingerprinted/mermaid.x.mjs' })
      const manifest = parseOnlineAssetManifest(json)
      expect(manifest.shikiLangs).toEqual({})
      expect(manifest.mermaid).toBe('fingerprinted/mermaid.x.mjs')
    })
  })

  describe('parseOnlineAssetManifest: katex / mermaid', () => {
    it('mermaid: string 以外は null', () => {
      expect(parseOnlineAssetManifest(JSON.stringify({ mermaid: 123 })).mermaid).toBeNull()
      expect(parseOnlineAssetManifest(JSON.stringify({ mermaid: '' })).mermaid).toBeNull()
      expect(parseOnlineAssetManifest(JSON.stringify({ mermaid: 'fp/m.mjs' })).mermaid).toBe(
        'fp/m.mjs'
      )
    })

    it('katex: js / css / fontsExtraCss の 3 つすべて非空 string で初めて受理', () => {
      const full = parseOnlineAssetManifest(
        JSON.stringify({
          katex: { css: 'fp/k.css', fontsExtraCss: 'fp/k-extra.css', js: 'fp/k.mjs' },
        })
      )
      expect(full.katex).toEqual({
        css: 'fp/k.css',
        fontsExtraCss: 'fp/k-extra.css',
        js: 'fp/k.mjs',
      })
    })

    it('katex: いずれか欠落で null', () => {
      const partial = parseOnlineAssetManifest(
        JSON.stringify({ katex: { css: 'fp/k.css', js: 'fp/k.mjs' } })
      )
      expect(partial.katex).toBeNull()
    })
  })

  describe('resolve* fail-safe', () => {
    it('resolveShikiLangPath: manifest に hash 付きが居ればそれを返す', () => {
      const manifest = parseOnlineAssetManifest(
        JSON.stringify({ shikiLangs: { typescript: 'fp/shiki-langs/typescript.abc.json' } })
      )
      expect(resolveShikiLangPath(manifest, 'typescript')).toBe(
        'fp/shiki-langs/typescript.abc.json'
      )
    })

    it('resolveShikiLangPath: manifest 欠落時は canonical パスに fallback', () => {
      expect(resolveShikiLangPath(EMPTY_MANIFEST, 'typescript')).toBe(
        'canonical/shiki-langs/typescript.json'
      )
    })

    it('resolveMermaidPath: manifest 欠落時は canonical/mermaid.mjs', () => {
      expect(resolveMermaidPath(EMPTY_MANIFEST)).toBe('canonical/mermaid.mjs')
    })

    it('resolveKatexPaths: manifest 欠落時は canonical 3 ファイル', () => {
      const paths = resolveKatexPaths(EMPTY_MANIFEST)
      expect(paths.js).toBe('canonical/katex/katex.mjs')
      expect(paths.css).toBe('canonical/katex/katex.css')
      expect(paths.fontsExtraCss).toBe('canonical/katex/katex-fonts-extra.css')
    })

    it('canonical パス helpers は固定値を返す (build 設定の single source of truth)', () => {
      expect(resolveCanonicalShikiLangPath('python')).toBe('canonical/shiki-langs/python.json')
      expect(resolveCanonicalMermaidPath()).toBe('canonical/mermaid.mjs')
      expect(resolveCanonicalKatexPaths().js).toBe('canonical/katex/katex.mjs')
    })
  })

  describe('readOnlineAssetManifestFromDom', () => {
    it('script 要素が無いと EMPTY_MANIFEST を返す', () => {
      const manifest = readOnlineAssetManifestFromDom()
      expect(manifest.mermaid).toBeNull()
      expect(Object.keys(manifest.shikiLangs)).toEqual([])
    })

    it('script 要素から parse + 不正値時は EMPTY_MANIFEST に fallback', () => {
      const el = document.createElement('script')
      el.id = 'online-asset-manifest'
      el.type = 'application/json'
      el.textContent = JSON.stringify({
        mermaid: 'fingerprinted/mermaid.abc.mjs',
        shikiLangs: { typescript: 'fingerprinted/shiki-langs/typescript.abc.json' },
      })
      document.body.appendChild(el)
      try {
        const manifest = readOnlineAssetManifestFromDom()
        expect(manifest.mermaid).toBe('fingerprinted/mermaid.abc.mjs')
        expect(manifest.shikiLangs.typescript).toBe('fingerprinted/shiki-langs/typescript.abc.json')
      } finally {
        el.remove()
      }
    })

    it('script 要素の content が壊れていても throw せず EMPTY_MANIFEST', () => {
      const el = document.createElement('script')
      el.id = 'online-asset-manifest'
      el.textContent = 'broken json'
      document.body.appendChild(el)
      try {
        const manifest = readOnlineAssetManifestFromDom()
        expect(manifest.mermaid).toBeNull()
      } finally {
        el.remove()
      }
    })
  })

  describe('parseOnlineAssetManifest: malformed warn', () => {
    beforeEach((): void => {
      resetManifestWarnFlagForTest()
    })
    afterEach((): void => {
      resetManifestWarnFlagForTest()
      vi.unstubAllGlobals()
    })

    it('JSON parse 失敗で console.warn を 1 度だけ出す', () => {
      const warnSpy = vi.fn()
      vi.stubGlobal('console', { warn: warnSpy })
      parseOnlineAssetManifest('not-json')
      parseOnlineAssetManifest('still-not-json')
      expect(warnSpy).toHaveBeenCalledTimes(1)
    })

    it('JSON parse 成功 + 非 object でも console.warn を 1 度だけ', () => {
      const warnSpy = vi.fn()
      vi.stubGlobal('console', { warn: warnSpy })
      parseOnlineAssetManifest('[]')
      parseOnlineAssetManifest('null')
      expect(warnSpy).toHaveBeenCalledTimes(1)
    })

    it('空文字 / 正常 JSON では warn しない', () => {
      const warnSpy = vi.fn()
      vi.stubGlobal('console', { warn: warnSpy })
      parseOnlineAssetManifest('')
      parseOnlineAssetManifest(JSON.stringify({ shikiLangs: {} }))
      expect(warnSpy).not.toHaveBeenCalled()
    })
  })
}
