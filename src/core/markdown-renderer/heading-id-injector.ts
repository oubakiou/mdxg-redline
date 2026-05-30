// marked `renderer.heading` から呼ばれる H3–H6 への `id` 属性注入を担う pure helper。
// 文書順に並んだ slug 列 (`headingSlugs`) を消費 cursor で順に割り当てる closure factory を
// 提供する。H1 / H2 (ページ境界) には id を付けない方針 (URL fragment は `<page-slug>` で済む)。

import { escapeHtml } from '../escape'

/**
 * marked 出力の H3–H6 に `id` を注入するためのヒント。
 * `headingSlugs` は H3–H6 の出現順 (文書順) に並んだ slug 列で、page-outline の
 * `extractPageHeadings` 出力をそのまま渡せる契約 (DESIGN.md §12 §6 Virtual Pages)。
 * H1 / H2 はページ境界として scanHeadings が拾うが、本実装では active page を 1 枚ずつ
 * render する設計のためページ内に H1 / H2 はそのページ自身の見出し 1 つだけになる。
 * その見出しには id を付けない (URL fragment は `<page-slug>` で済むため別途用意しない)。
 */
export interface MarkdownRenderOptions {
  headingSlugs?: readonly string[]
}

const headingHtmlWithId = (text: string, level: number, slug: string | null): string => {
  if (slug === null) {
    return `<h${level}>${text}</h${level}>\n`
  }
  return `<h${level} id="${escapeHtml(slug)}">${text}</h${level}>\n`
}

const resolveHeadingSlugs = (options: MarkdownRenderOptions | undefined): readonly string[] => {
  if (!options) {
    return []
  }
  if (!options.headingSlugs) {
    return []
  }
  return options.headingSlugs
}

/**
 * marked `renderer.heading` 用の closure を生成する。各呼び出しで内部 cursor を進め、
 * H3–H6 のみ slugs から順に取って `id` 属性を付与する。slugs が足りなければ id 無し。
 */
export const createHeadingRenderer = (
  options: MarkdownRenderOptions | undefined
): ((text: string, level: number, raw: string) => string) => {
  const slugs = resolveHeadingSlugs(options)
  let outlineIndex = 0
  return (text: string, level: number): string => {
    if (level >= 3 && level <= 6) {
      const slug = slugs[outlineIndex] ?? null
      outlineIndex += 1
      return headingHtmlWithId(text, level, slug)
    }
    return `<h${level}>${text}</h${level}>\n`
  }
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('createHeadingRenderer', () => {
    it('H1 / H2 には id を付けない', () => {
      const render = createHeadingRenderer({ headingSlugs: ['a', 'b'] })
      expect(render('Page', 1, '')).toBe('<h1>Page</h1>\n')
      expect(render('Sub Page', 2, '')).toBe('<h2>Sub Page</h2>\n')
    })

    it('H3–H6 は slugs から順に id を割り当てる (cursor 共有)', () => {
      const render = createHeadingRenderer({ headingSlugs: ['s1', 's2'] })
      expect(render('A', 3, '')).toBe('<h3 id="s1">A</h3>\n')
      expect(render('B', 4, '')).toBe('<h4 id="s2">B</h4>\n')
    })

    it('slugs より H3–H6 が多い場合、残りは id 無しで描画する', () => {
      const render = createHeadingRenderer({ headingSlugs: ['only'] })
      expect(render('A', 3, '')).toBe('<h3 id="only">A</h3>\n')
      expect(render('B', 3, '')).toBe('<h3>B</h3>\n')
    })

    it('options 未指定なら H3–H6 にも id を付けない', () => {
      const render = createHeadingRenderer({})
      expect(render('A', 3, '')).toBe('<h3>A</h3>\n')
    })

    it('slug は HTML escape される (属性インジェクション防止)', () => {
      const render = createHeadingRenderer({ headingSlugs: ['x"onmouseover="alert(1)'] })
      const out = render('A', 3, '')
      expect(out).not.toContain('onmouseover="alert(1)"')
      expect(out).toContain('&quot;')
    })
  })
}
