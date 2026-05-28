// Shiki grammar 注入: --shiki-langs モード解決 → grammar JSON 読み込み → embed-template.html への inline。

import type { RunArgs, ShikiLangsMode } from '../parse-args'
import { SHIKI_SUPPORTED_LANGS, type SupportedLang } from '../../core/shiki-aliases.generated'
import type { EmbedContext } from '../embed-context'
import { errorMessage } from '../error-message'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { rewriteEmbeddedShikiLangs } from '../../core/embed'
import { scanFencedLangs } from '../../core/scan-fenced-langs'

/**
 * `--shiki-langs` の指定 (未指定時は auto と同じ) から注入対象の正規名集合を決める pure 関数。
 * - auto / 未指定: markdown を scan して使用されている grammar を集める
 * - all: SHIKI_SUPPORTED_LANGS 全部
 * - none: 空 Set
 * - list: 指定された Set をそのまま使う
 */
export const resolveShikiLangSet = (
  mode: ShikiLangsMode | undefined,
  markdown: string
): Set<SupportedLang> => {
  if (!mode || mode.kind === 'auto') {
    return scanFencedLangs(markdown)
  }
  if (mode.kind === 'all') {
    return new Set<SupportedLang>(SHIKI_SUPPORTED_LANGS)
  }
  if (mode.kind === 'none') {
    return new Set<SupportedLang>()
  }
  return new Set(mode.langs)
}

// `dist/shiki-langs/` は commit 対象だが、partial clone や手動削除で欠けるケースがあるため
// Node 既定の ENOENT より親切な案内に差し替える。
const readGrammarJson = async (scriptDir: string, lang: SupportedLang): Promise<unknown> => {
  const path = resolve(scriptDir, 'shiki-langs', `${lang}.json`)
  try {
    const content = await readFile(path, 'utf8')
    return JSON.parse(content)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(
        `${path} が見つかりません。先に \`npm run build\` を実行して dist/shiki-langs/ を生成してください。`,
        { cause: error }
      )
    }
    throw error
  }
}

const loadShikiGrammars = async (
  langs: ReadonlySet<SupportedLang>,
  scriptDir: string
): Promise<Record<string, unknown>> => {
  const grammars: Record<string, unknown> = {}
  await Promise.all(
    [...langs].map(async (lang: SupportedLang): Promise<void> => {
      grammars[lang] = await readGrammarJson(scriptDir, lang)
    })
  )
  return grammars
}

export const applyShikiLangs = async (
  html: string,
  args: RunArgs,
  ctx: EmbedContext
): Promise<string> => {
  const langs = resolveShikiLangSet(args.shikiLangs, ctx.markdown)
  const grammars = await loadShikiGrammars(langs, ctx.scriptDir)
  return rewriteEmbeddedShikiLangs(html, grammars)
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('resolveShikiLangSet', () => {
    const sampleMd = '```ts\nx\n```\n\n```py\ny\n```\n'

    // 未指定 (undefined) の挙動は型で `mode: ShikiLangsMode | undefined` として受け入れ、
    // 関数本体の `!mode || mode.kind === 'auto'` で auto と同じパスに合流させている。
    // no-undefined lint 回避のためテスト側では auto 経路の一致確認のみに留める。
    it('auto は markdown スキャン結果を返す', () => {
      const set = resolveShikiLangSet({ kind: 'auto' }, sampleMd)
      expect([...set].toSorted()).toEqual(['python', 'typescript'])
    })

    it('all は SHIKI_SUPPORTED_LANGS 全体を返す', () => {
      const set = resolveShikiLangSet({ kind: 'all' }, sampleMd)
      expect(set.size).toBe(SHIKI_SUPPORTED_LANGS.length)
    })

    it('none は空 Set を返す', () => {
      const set = resolveShikiLangSet({ kind: 'none' }, sampleMd)
      expect(set.size).toBe(0)
    })

    it('list は指定された正規名集合をそのまま返す (markdown 内容に依存しない)', () => {
      const langs = new Set<SupportedLang>(['rust', 'go'])
      const set = resolveShikiLangSet({ kind: 'list', langs }, sampleMd)
      expect([...set].toSorted()).toEqual(['go', 'rust'])
    })
  })

  describe('readGrammarJson', () => {
    const nonexistentScriptDir = resolve('/this-path-should-not-exist-mdxg-redline-test')

    it('ENOENT のときは "npm run build" 案内付きの Error を投げる', async () => {
      try {
        await readGrammarJson(nonexistentScriptDir, 'typescript')
        throw new Error('expected readGrammarJson to throw')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        const message = errorMessage(error)
        expect(message).toContain('shiki-langs')
        expect(message).toContain('npm run build')
      }
    })
  })
}
