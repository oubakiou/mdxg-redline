// ブラウザ側 Shiki ハイライタの lazy singleton 初期化。
// docs/mdxg-rendering-code-block.md §3.2 / §5.b に従い、`<script id="embedded-shiki-langs">` から
// CLI が事前注入した grammar JSON を JSON.parse → createHighlighterCoreSync で同期初期化する。
// grammar が無い / 解析失敗時は null を返し、呼び出し側で plain text fallback に倒す。

// fmt が `type` 修飾子付き specifier を先頭に並べ替える挙動と lint の sort-imports
// (identifier 文字列順) がこのファイルでは衝突するため、ファイル全体で無効化する。
/* eslint-disable sort-imports */

import { SHIKI_SUPPORTED_LANGS } from '../core/shiki-aliases.generated'
import { type HighlighterCore, createHighlighterCoreSync } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { normalizeLangIdentifier } from '../core/scan-fenced-langs'
import githubDark from '@shikijs/themes/github-dark'
import githubLight from '@shikijs/themes/github-light'
import type { LanguageRegistration } from '@shikijs/types'

const SHIKI_SUPPORTED_LANGS_SET = new Set<string>(SHIKI_SUPPORTED_LANGS)

// HighlighterCore は成功 / null は失敗または「埋め込み無し」。
// 未初期化 (false) と「初期化済み・結果は null」(null) を区別するため 3 値で表現する。
let cachedHighlighter: HighlighterCore | null | false = false

const tryParseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readEmbeddedShikiLangs = (): Record<string, unknown> => {
  const el = document.getElementById('embedded-shiki-langs')
  if (!(el instanceof HTMLElement)) {
    return {}
  }
  const text = el.textContent ?? ''
  if (text.trim() === '') {
    return {}
  }
  const parsed = tryParseJson(text)
  if (!isPlainObject(parsed)) {
    return {}
  }
  return parsed
}

// grammar JSON の各エントリは LanguageRegistration[] 形式の array。
// 28 言語ホワイトリストに含まれない key、または値が array でないエントリは silently drop する
// (壊れた embedded-shiki-langs に対して highlighter 初期化全体が失敗しないように)。
const collectValidGrammarLists = (grammars: Record<string, unknown>): LanguageRegistration[][] => {
  const langs: LanguageRegistration[][] = []
  for (const [key, value] of Object.entries(grammars)) {
    if (SHIKI_SUPPORTED_LANGS_SET.has(key) && Array.isArray(value)) {
      // Array.isArray() でランタイム検証済み。要素の TextMate grammar 構造は CLI が emit する
      // dist/shiki-langs/<lang>.json の信頼境界内にあるので、内部 shape は Shiki 側に委ねる。
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      langs.push(value as LanguageRegistration[])
    }
  }
  return langs
}

const initHighlighter = (): HighlighterCore | null => {
  const grammars = readEmbeddedShikiLangs()
  const langs = collectValidGrammarLists(grammars)
  if (langs.length === 0) {
    return null
  }
  try {
    return createHighlighterCoreSync({
      engine: createJavaScriptRegexEngine(),
      langs,
      themes: [githubLight, githubDark],
    })
  } catch {
    return null
  }
}

/**
 * Shiki ハイライタを lazy singleton で取得する。`<script id="embedded-shiki-langs">` が
 * 空 / 欠落 / 解析失敗のときは null を返し、呼び出し側が plain text fallback を選ぶ。
 * 初期化結果は `cachedHighlighter` に保存し、2 回目以降は同期返却する。
 */
export const getOrCreateHighlighter = (): HighlighterCore | null => {
  if (cachedHighlighter !== false) {
    return cachedHighlighter
  }
  cachedHighlighter = initHighlighter()
  return cachedHighlighter
}

/**
 * 単一フェンスを Shiki で HTML 文字列化する。highlighter が null のとき、または
 * lang 識別子が未対応 / loadedLanguages 外のときは null を返し、呼び出し側で plain fallback。
 * defaultColor: false で `<span style="--shiki-light/--shiki-dark">` の dual theme を出力させ、
 * `html.dark` 切替を CSS variable で吸収できる形にする。
 */
export const highlightFenceWithShiki = (
  highlighter: HighlighterCore,
  code: string,
  rawLang: string
): string | null => {
  const canonical = normalizeLangIdentifier(rawLang)
  if (canonical === null) {
    return null
  }
  if (!highlighter.getLoadedLanguages().includes(canonical)) {
    return null
  }
  return highlighter.codeToHtml(code, {
    defaultColor: false,
    lang: canonical,
    themes: { dark: 'github-dark', light: 'github-light' },
  })
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('Shiki integration sanity', () => {
    it('SHIKI_SUPPORTED_LANGS_SET にすべての正規名が含まれる', () => {
      for (const lang of SHIKI_SUPPORTED_LANGS) {
        expect(SHIKI_SUPPORTED_LANGS_SET.has(lang)).toBe(true)
      }
    })

    it('collectValidGrammarLists はホワイトリスト外を除外する', () => {
      const fixture: Record<string, unknown> = {
        nim: [{ scope: 'source.nim' }],
        'not-a-list': 'string-value',
        typescript: [{ scope: 'source.ts' }],
      }
      const out = collectValidGrammarLists(fixture)
      expect(out).toHaveLength(1)
      expect(out[0]).toEqual([{ scope: 'source.ts' }])
    })

    it('isPlainObject は array と primitives を除外する', () => {
      expect(isPlainObject({})).toBe(true)
      expect(isPlainObject({ key: 1 })).toBe(true)
      expect(isPlainObject([])).toBe(false)
      expect(isPlainObject(null)).toBe(false)
      expect(isPlainObject('str')).toBe(false)
      expect(isPlainObject(123)).toBe(false)
    })

    it('tryParseJson は JSON parse 例外を null で吸収する', () => {
      expect(tryParseJson('{"value":1}')).toEqual({ value: 1 })
      expect(tryParseJson('not-json')).toBeNull()
    })
  })
}
