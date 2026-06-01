// marked `renderer.heading` から呼ばれる H1–H6 への `id` 属性注入を担う pure helper。
// H3–H6 は page-outline 由来の ASCII slug (`headingSlugs`) を消費 cursor で順に割り当て、
// `<page-slug>__<heading-slug>` URL fragment の解決経路 (`scroll-spy.scrollToHeading`) と
// 互換性を保つ。H1 / H2 (ページ境界見出し) には GitHub 互換 slug (CJK 保持) を marked の
// `raw` 引数 (TextRenderer 経由で inline 装飾を剥がしたプレーンテキスト) から計算して id を
// 付与し、`<a href="#1-概要">` のような自己ページ内 anchor リンクのジャンプ先として機能させる。
//
// 同 id が複数 heading で衝突した場合 (同 markdown 内の同一 text、別 page) は `getElementById`
// が最初の要素を返す GitHub と同じ「先勝ち」挙動を許容する。

import { escapeHtml } from '../escape'
import { slugifyGithubCompatible } from '../slugify'

/**
 * marked 出力の見出しに `id` を注入するためのヒント。
 * `headingSlugs` は H3–H6 の出現順 (文書順) に並んだ slug 列で、page-outline の
 * `extractPageHeadings` 出力をそのまま渡せる契約 (DESIGN.md §12 §6 Virtual Pages)。
 * H1 / H2 は heading text から GitHub 互換 slug を計算して id を付与する。
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

const resolveHeadingSlugs = (options?: MarkdownRenderOptions): readonly string[] => {
  if (!options) {
    return []
  }
  if (!options.headingSlugs) {
    return []
  }
  return options.headingSlugs
}

// marked v12 の `renderer.heading` 引数は `text` が inline parse 済み HTML (`<strong>...</strong>` 等)、
// `raw` が TextRenderer 経由で inline 装飾 (link / strong / em / code / image alt 等) を剥がした
// プレーンテキスト。元の markdown ソース文字列そのものではない点に注意。id 用 slug は raw から
// 計算することで `<strong>` 等の HTML タグ混入を避ける。raw が空文字なら slug も空文字になり null 化される。
const githubSlugOrNull = (raw: string): string | null => {
  const slug = slugifyGithubCompatible(raw)
  if (slug.length === 0) {
    return null
  }
  return slug
}

/**
 * marked `renderer.heading` 用の closure を生成する。
 * - H1 / H2: heading text から GitHub 互換 slug を計算して id 属性に付与
 * - H3-H6: `headingSlugs` cursor から ASCII slug を順に取って id 属性に付与
 */
export const createHeadingRenderer = (
  options?: MarkdownRenderOptions
): ((text: string, level: number, raw: string) => string) => {
  const slugs = resolveHeadingSlugs(options)
  let outlineIndex = 0
  return (text: string, level: number, raw: string): string => {
    if (level === 1 || level === 2) {
      return headingHtmlWithId(text, level, githubSlugOrNull(raw))
    }
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
    it('H1 / H2 は raw (装飾剥がし後のプレーンテキスト) から GitHub 互換 slug を計算して id 付与する', () => {
      const render = createHeadingRenderer({ headingSlugs: [] })
      expect(render('Overview', 1, 'Overview')).toBe('<h1 id="overview">Overview</h1>\n')
      expect(render('1. 概要', 2, '1. 概要')).toBe('<h2 id="1-概要">1. 概要</h2>\n')
    })

    it('H1 / H2 で slug が空文字 (記号のみ等) になる場合は id を付けない', () => {
      const render = createHeadingRenderer({ headingSlugs: [] })
      expect(render('!!!', 1, '!!!')).toBe('<h1>!!!</h1>\n')
      expect(render('---', 2, '---')).toBe('<h2>---</h2>\n')
    })

    it('H3–H6 は slugs から順に id を割り当てる (cursor 共有)', () => {
      const render = createHeadingRenderer({ headingSlugs: ['s1', 's2'] })
      expect(render('A', 3, 'A')).toBe('<h3 id="s1">A</h3>\n')
      expect(render('B', 4, 'B')).toBe('<h4 id="s2">B</h4>\n')
    })

    it('slugs より H3–H6 が多い場合、残りは id 無しで描画する', () => {
      const render = createHeadingRenderer({ headingSlugs: ['only'] })
      expect(render('A', 3, 'A')).toBe('<h3 id="only">A</h3>\n')
      expect(render('B', 3, 'B')).toBe('<h3>B</h3>\n')
    })

    it('options 未指定でも H1 / H2 には GitHub 互換 slug の id が付く', () => {
      const render = createHeadingRenderer()
      expect(render('Top', 1, 'Top')).toBe('<h1 id="top">Top</h1>\n')
    })

    it('options 未指定なら H3–H6 には id を付けない (cursor が空)', () => {
      const render = createHeadingRenderer({})
      expect(render('A', 3, 'A')).toBe('<h3>A</h3>\n')
    })

    it('H3-H6 の slug は HTML escape される (属性インジェクション防止)', () => {
      const render = createHeadingRenderer({ headingSlugs: ['x"onmouseover="alert(1)'] })
      const out = render('A', 3, 'A')
      expect(out).not.toContain('onmouseover="alert(1)"')
      expect(out).toContain('&quot;')
    })

    it('H1 / H2 の slug 計算は raw を採用し text の HTML 装飾を避ける', () => {
      const render = createHeadingRenderer({ headingSlugs: [] })
      // text には inline parse 済み HTML、raw には TextRenderer 経由の装飾剥がしテキストが渡る
      expect(render('<strong>Bold</strong>', 1, 'Bold')).toBe(
        '<h1 id="bold"><strong>Bold</strong></h1>\n'
      )
    })
  })
}
