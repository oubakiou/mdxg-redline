// KaTeX runtime 注入: --math モード判定 → js / css / フォント asset 読み込み → embed-template.html への inline + stderr 報告。
// Mermaid と完全に対称な配布契約 (docs/mdxg-math-rendering.archive.md §3.2)。

import type { MathFontsMode, MathMode, RunArgs } from '../parse-args'
import type { EmbedContext } from '../embed-context'
import { countMath } from '../../core/math'
import process from 'node:process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { rewriteEmbeddedKatex } from '../../core/embed'

/**
 * `--math` mode と markdown 内容から KaTeX runtime を注入すべきか判定する pure 関数
 * (Mermaid と完全に対称、docs/mdxg-math-rendering.archive.md §3.2 / §5.e)。
 * - mode 未指定 / `auto`: countMath で inline + display > 0 のときのみ true
 * - `on`: 常に true
 * - `off`: 常に false
 */
export const shouldInjectKatex = (mode: MathMode | undefined, markdown: string): boolean => {
  if (mode === 'off') {
    return false
  }
  if (mode === 'on') {
    return true
  }
  const counts = countMath(markdown)
  return counts.inline + counts.display > 0
}

const readKatexAsset = async (path: string): Promise<string> => {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(
        `${path} が見つかりません。先に \`npm run build\` を実行して dist/katex/ を生成してください。`,
        { cause: error }
      )
    }
    throw error
  }
}

interface KatexAssetsPayload {
  fontsExtraCss?: string
  js: string
  minimalCss: string
  sizeHintGzip: string
}

// minimal / all で stderr 報告のサイズ概算を切り替えるためのプレースホルダ
// (docs/mdxg-math-rendering.archive.md §3.3 実測値ベース)。
const MATH_SIZE_HINT: Readonly<Record<MathFontsMode, string>> = {
  all: '+~340 KB',
  minimal: '+~250 KB',
}

const readKatexAssets = async (
  scriptDir: string,
  fontsMode: MathFontsMode
): Promise<KatexAssetsPayload> => {
  const [js, minimalCss] = await Promise.all([
    readKatexAsset(resolve(scriptDir, 'katex', 'katex.mjs')),
    readKatexAsset(resolve(scriptDir, 'katex', 'katex.css')),
  ])
  const sizeHintGzip = MATH_SIZE_HINT[fontsMode]
  if (fontsMode === 'minimal') {
    return { js, minimalCss, sizeHintGzip }
  }
  const fontsExtraCss = await readKatexAsset(resolve(scriptDir, 'katex', 'katex-fonts-extra.css'))
  return { fontsExtraCss, js, minimalCss, sizeHintGzip }
}

interface KatexInjectionReport {
  escapedScriptCount: number
  fontsMode: MathFontsMode
  markdown: string
  sizeHintGzip: string
}

const reportKatexInjection = (report: KatexInjectionReport): void => {
  const counts = countMath(report.markdown)
  const total = counts.inline + counts.display
  process.stderr.write(
    `Detected ${total} math expression(s). Embedding KaTeX runtime (fonts=${report.fontsMode}, ${report.sizeHintGzip} gzipped).\n`
  )
  if (report.escapedScriptCount > 0) {
    process.stderr.write(
      `(escaped ${report.escapedScriptCount} literal </script> in KaTeX runtime)\n`
    )
  }
}

export const applyKatex = async (
  html: string,
  args: RunArgs,
  ctx: EmbedContext
): Promise<string> => {
  if (!shouldInjectKatex(args.math, ctx.markdown)) {
    return html
  }
  const fontsMode: MathFontsMode = args.mathFonts ?? 'minimal'
  const assets = await readKatexAssets(ctx.scriptDir, fontsMode)
  const { escapedScriptCount, html: rewritten } = rewriteEmbeddedKatex(html, {
    fontsExtraCss: assets.fontsExtraCss,
    js: assets.js,
    minimalCss: assets.minimalCss,
  })
  reportKatexInjection({
    escapedScriptCount,
    fontsMode,
    markdown: ctx.markdown,
    sizeHintGzip: assets.sizeHintGzip,
  })
  return rewritten
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('shouldInjectKatex: auto / 未指定', () => {
    const mdWithMath = 'Try $x^2 + y^2 = z^2$ here.\n'
    const mdWithDisplay = '$$\\frac{a}{b}$$\n'
    const mdNoMath = '# Hello\n\nplain text only\n'
    const mdEscaped = 'Cost is \\$100 and \\$200.\n'

    it('auto × inline 数式 1+ 件 → true', () => {
      expect(shouldInjectKatex('auto', mdWithMath)).toBe(true)
    })

    it('auto × display 数式 1+ 件 → true', () => {
      expect(shouldInjectKatex('auto', mdWithDisplay)).toBe(true)
    })

    it('auto × 0 件 → false', () => {
      expect(shouldInjectKatex('auto', mdNoMath)).toBe(false)
    })

    it(String.raw`auto × \$ エスケープのみ → false (literal $ は数式境界として扱わない)`, () => {
      expect(shouldInjectKatex('auto', mdEscaped)).toBe(false)
    })

    it('未指定 (undefined) は auto と同じ挙動', () => {
      // 引数未指定 (undefined) 時の既定挙動を検証するテストのため no-undefined を無効化する。
      /* eslint-disable no-undefined */
      expect(shouldInjectKatex(undefined, mdWithMath)).toBe(true)
      expect(shouldInjectKatex(undefined, mdNoMath)).toBe(false)
      /* eslint-enable no-undefined */
    })
  })

  describe('shouldInjectKatex: on / off', () => {
    const mdWithMath = 'Try $x^2 + y^2 = z^2$ here.\n'
    const mdNoMath = '# Hello\n\nplain text only\n'

    it('on は markdown 内容に関係なく true', () => {
      expect(shouldInjectKatex('on', mdWithMath)).toBe(true)
      expect(shouldInjectKatex('on', mdNoMath)).toBe(true)
    })

    it('off は markdown 内容に関係なく false', () => {
      expect(shouldInjectKatex('off', mdWithMath)).toBe(false)
      expect(shouldInjectKatex('off', mdNoMath)).toBe(false)
    })
  })
}
