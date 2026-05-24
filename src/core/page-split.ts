// markdown を MDXG §6 仮想ページに分割する pure module。
// H1 / H2 境界を検出して chunk 化し、見出し前コンテンツの Introduction 正規化 (§6.2) と
// 見出しが一切無い文書を単一ページに正規化する規約 (mdxg-virtual-pages.md §7.5) を担う。
//
// 行スキャン本体は page-outline.ts の scanHeadings に集約しており、本 module はその結果から
// depth ≤ 2 のものをページ境界として取り出して markdown 範囲を切り出す部分に専念する。
// markdown 範囲の切り出しは行オフセット → 元 markdown.slice で行うため、元 markdown と
// pages[*].markdown を連結した値は完全に一致する (round-trip 不変条件)。

import { type Heading, type HeadingHit, extractPageHeadings, scanHeadings } from './page-outline'
import { resolveUniqueSlug, slugifyOrFallback } from './slugify'

/**
 * 仮想ページ 1 枚分のデータ。
 * markdown は元 markdown の連続するサブストリングで、連結すると元 markdown と一致する。
 * sourceLineStart は 1-origin で、export feedback.json の sourceLine 計算の基準にもなる。
 */
export interface Page {
  depth: 1 | 2
  headings: Heading[]
  index: number
  markdown: string
  slug: string
  sourceLineStart: number
  title: string
}

interface PageBoundaryMarker {
  depth: 1 | 2
  lineIndex: number
  title: string
}

interface RawPage {
  depth: 1 | 2
  markdown: string
  sourceLineStart: number
  title: string
}

interface SplitOptions {
  docName?: string | null
}

interface SliceContext {
  markdown: string
  offsets: number[]
}

interface MarkerSliceArgs {
  context: SliceContext
  endLine: number
  marker: PageBoundaryMarker
}

const INTRODUCTION_TITLE = 'Introduction'
const DEFAULT_FALLBACK_TITLE = 'Document'

const isBoundaryDepth = (depth: number): depth is 1 | 2 => depth === 1 || depth === 2

const toBoundaryMarkers = (hits: HeadingHit[]): PageBoundaryMarker[] => {
  const markers: PageBoundaryMarker[] = []
  for (const hit of hits) {
    if (isBoundaryDepth(hit.depth)) {
      markers.push({ depth: hit.depth, lineIndex: hit.lineIndex, title: hit.title })
    }
  }
  return markers
}

// 元 markdown 文字列の line index → byte offset の対応表を作る。
// markdown.slice(offsets[i], offsets[j]) で行 [i, j) の範囲を正確に切り出せる
// (split('\n').slice(...).join('\n') では末尾改行の境界が落ちて round-trip が壊れる)。
const computeLineOffsets = (markdown: string): number[] => {
  const offsets: number[] = [0]
  let pos = markdown.indexOf('\n')
  while (pos !== -1) {
    offsets.push(pos + 1)
    pos = markdown.indexOf('\n', pos + 1)
  }
  return offsets
}

const sliceByLineRange = (context: SliceContext, startLine: number, endLine: number): string => {
  const startOffset = context.offsets[startLine] ?? context.markdown.length
  const endOffset = context.offsets[endLine] ?? context.markdown.length
  return context.markdown.slice(startOffset, endOffset)
}

const buildIntroductionPage = (context: SliceContext, firstMarkerLine: number): RawPage | null => {
  if (firstMarkerLine === 0) {
    return null
  }
  const introMd = sliceByLineRange(context, 0, firstMarkerLine)
  // §6.2: 空 / 空白のみの pre-heading は Introduction を作らない
  if (introMd.trim().length === 0) {
    return null
  }
  return { depth: 1, markdown: introMd, sourceLineStart: 1, title: INTRODUCTION_TITLE }
}

const buildMarkerPage = (args: MarkerSliceArgs): RawPage => ({
  depth: args.marker.depth,
  markdown: sliceByLineRange(args.context, args.marker.lineIndex, args.endLine),
  sourceLineStart: args.marker.lineIndex + 1,
  title: args.marker.title,
})

// 次マーカーの lineIndex か、最終マーカーなら markdown 末尾までを取り出す。
// no-ternary / no-undefined ルールを満たすため if 文で分岐する。
const resolveEndLine = (
  markers: PageBoundaryMarker[],
  markerIndex: number,
  totalLines: number
): number => {
  if (markerIndex + 1 < markers.length) {
    return markers[markerIndex + 1].lineIndex
  }
  return totalLines
}

const pushMarkerPages = (
  pages: RawPage[],
  markers: PageBoundaryMarker[],
  context: SliceContext
): void => {
  const totalLines = context.offsets.length
  for (const [markerIndex, marker] of markers.entries()) {
    const endLine = resolveEndLine(markers, markerIndex, totalLines)
    pages.push(buildMarkerPage({ context, endLine, marker }))
  }
}

const singlePageFallback = (markdown: string, fallbackTitle: string): RawPage[] => [
  { depth: 1, markdown, sourceLineStart: 1, title: fallbackTitle },
]

const sliceMarkdownByMarkers = (
  markdown: string,
  markers: PageBoundaryMarker[],
  fallbackTitle: string
): RawPage[] => {
  if (markers.length === 0) {
    // §7.5: H1 / H2 が一切ない markdown は docName を title とした単一ページに正規化
    return singlePageFallback(markdown, fallbackTitle)
  }
  const context: SliceContext = { markdown, offsets: computeLineOffsets(markdown) }
  const pages: RawPage[] = []
  const intro = buildIntroductionPage(context, markers[0].lineIndex)
  if (intro !== null) {
    pages.push(intro)
  }
  pushMarkerPages(pages, markers, context)
  return pages
}

const finalizePage = (raw: RawPage, index: number, usedSlugs: Set<string>): Page => {
  const baseSlug = slugifyOrFallback(raw.title, `page-${index + 1}`)
  const slug = resolveUniqueSlug(baseSlug, usedSlugs)
  return {
    depth: raw.depth,
    headings: extractPageHeadings(raw.markdown),
    index,
    markdown: raw.markdown,
    slug,
    sourceLineStart: raw.sourceLineStart,
    title: raw.title,
  }
}

/**
 * markdown を仮想ページ (MDXG §6) に分割する。
 * - H1 / H2 (ATX / setext) で境界分割し、コードフェンス内見出しは境界として扱わない (§6.1)
 * - 見出し前の非空 content は "Introduction" ページとして先頭に追加 (§6.2 / §7.6)
 * - H1 / H2 が無い文書は `docName` (未指定なら "Document") を title とした単一ページに正規化 (§7.5)
 * - 各ページに slug (ASCII 限定 + fallback / -N suffix) と H3–H6 outline を埋め込む
 */
export const splitIntoPages = (markdown: string, options: SplitOptions = {}): Page[] => {
  const fallbackTitle = options.docName ?? DEFAULT_FALLBACK_TITLE
  const markers = toBoundaryMarkers(scanHeadings(markdown))
  const rawPages = sliceMarkdownByMarkers(markdown, markers, fallbackTitle)
  const usedSlugs = new Set<string>()
  return rawPages.map((raw, index): Page => finalizePage(raw, index, usedSlugs))
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('splitIntoPages: 基本分割', () => {
    it('ATX H1 / H2 でページ境界を切る', () => {
      const md = '# A\n\nbody A\n\n## B\n\nbody B\n'
      const pages = splitIntoPages(md)
      expect(pages.map((page): string => page.title)).toEqual(['A', 'B'])
      expect(pages.map((page): number => page.depth)).toEqual([1, 2])
    })

    it('Page.index は 0-origin で文書順に振られる', () => {
      const md = '# A\n\n# B\n\n# C\n'
      const pages = splitIntoPages(md)
      expect(pages.map((page): number => page.index)).toEqual([0, 1, 2])
    })

    it('sourceLineStart は 1-origin で各ページの開始行を指す', () => {
      const md = 'pre\n\n# A\n\nbody\n\n## B\n'
      const pages = splitIntoPages(md)
      expect(pages.map((page): number => page.sourceLineStart)).toEqual([1, 3, 7])
    })

    it('setext H1 / H2 でもページ境界を切る', () => {
      const md = 'Title One\n=========\n\nbody\n\nTitle Two\n---------\n\nmore\n'
      const pages = splitIntoPages(md)
      expect(pages.map((page): string => page.title)).toEqual(['Title One', 'Title Two'])
      expect(pages.map((page): number => page.depth)).toEqual([1, 2])
    })

    it('H3–H6 はページ境界にしない (outline 行き)', () => {
      const md = '# A\n\n### A.1\n\n#### A.1.1\n\n## B\n'
      const pages = splitIntoPages(md)
      expect(pages.map((page): string => page.title)).toEqual(['A', 'B'])
      expect(pages[0].headings.map((heading): string => heading.text)).toEqual(['A.1', 'A.1.1'])
    })
  })

  describe('splitIntoPages: Introduction page (§6.2)', () => {
    it('最初の見出し前に non-empty コンテンツがあれば Introduction を作る', () => {
      const md = 'prelude line\n\nmore prelude\n\n# A\n\nbody\n'
      const pages = splitIntoPages(md)
      expect(pages.map((page): string => page.title)).toEqual(['Introduction', 'A'])
      expect(pages[0].depth).toBe(1)
      expect(pages[0].sourceLineStart).toBe(1)
      expect(pages[0].slug).toBe('introduction')
    })

    it('pre-heading が空 / 空白のみなら Introduction は作らない', () => {
      const md = '\n   \n\n# A\n\nbody\n'
      const pages = splitIntoPages(md)
      expect(pages.map((page): string => page.title)).toEqual(['A'])
    })

    it('最初から # で始まる文書では Introduction を作らない', () => {
      const md = '# A\n\nbody\n'
      const pages = splitIntoPages(md)
      expect(pages.map((page): string => page.title)).toEqual(['A'])
    })
  })

  describe('splitIntoPages: 単一ページ正規化 (§7.5)', () => {
    it('H1 / H2 が無い markdown は単一ページに正規化される', () => {
      const md = 'just some paragraph.\n\n### still no H1 or H2\n'
      const pages = splitIntoPages(md, { docName: 'snippet.md' })
      expect(pages).toHaveLength(1)
      expect(pages[0].title).toBe('snippet.md')
      expect(pages[0].depth).toBe(1)
      expect(pages[0].sourceLineStart).toBe(1)
      expect(pages[0].headings).toHaveLength(1)
    })

    it('docName 未指定なら "Document" にフォールバック', () => {
      const pages = splitIntoPages('plain text\n')
      expect(pages).toHaveLength(1)
      expect(pages[0].title).toBe('Document')
    })

    it('空 markdown でも 1 ページが返る (空ページ 1 枚)', () => {
      const pages = splitIntoPages('', { docName: 'empty' })
      expect(pages).toHaveLength(1)
      expect(pages[0].markdown).toBe('')
      expect(pages[0].title).toBe('empty')
    })
  })

  describe('splitIntoPages: フェンス追跡', () => {
    it('コードフェンス内の # / ## はページ境界として扱わない', () => {
      const md = '# A\n\n```\n# inside\n## still inside\n```\n\n## B\n'
      const pages = splitIntoPages(md)
      expect(pages.map((page): string => page.title)).toEqual(['A', 'B'])
    })
  })

  describe('splitIntoPages: slug', () => {
    it('ASCII タイトルは lowercase + ハイフン形式の slug になる', () => {
      const md = '# Hello World\n\n## Step 2: Install\n'
      const pages = splitIntoPages(md)
      expect(pages.map((page): string => page.slug)).toEqual(['hello-world', 'step-2-install'])
    })

    it('同名見出しは -2, -3 で曖昧性解消される (MDXG §6.4)', () => {
      const md = '# Notes\n\n# Notes\n\n# Notes\n'
      const pages = splitIntoPages(md)
      expect(pages.map((page): string => page.slug)).toEqual(['notes', 'notes-2', 'notes-3'])
    })

    it('日本語タイトルは page-<n> 連番 fallback になる (§7.3)', () => {
      const md = '# Overview\n\n# 概要\n\n# Details\n\n# 結論\n'
      const pages = splitIntoPages(md)
      expect(pages.map((page): string => page.slug)).toEqual([
        'overview',
        'page-2',
        'details',
        'page-4',
      ])
    })
  })

  describe('splitIntoPages: round-trip 不変条件', () => {
    it('全ページの markdown を連結すると元 markdown に一致する (基本)', () => {
      const md = '# A\n\nbody A\n\n## B\n\nbody B\n'
      const pages = splitIntoPages(md)
      expect(pages.map((page): string => page.markdown).join('')).toBe(md)
    })

    it('Introduction を含む文書でも連結結果が元 markdown と一致する', () => {
      const md = 'prelude\n\n# A\n\nbody\n'
      const pages = splitIntoPages(md)
      expect(pages.map((page): string => page.markdown).join('')).toBe(md)
    })

    it('末尾に改行が無い markdown でも連結結果が一致する', () => {
      const md = '# A\n\nbody A\n\n## B\n\nbody B'
      const pages = splitIntoPages(md)
      expect(pages.map((page): string => page.markdown).join('')).toBe(md)
    })

    it('setext を含む markdown でも連結結果が一致する', () => {
      const md = '# A\n\nTitle\n=====\n\nbody\n'
      const pages = splitIntoPages(md)
      expect(pages.map((page): string => page.markdown).join('')).toBe(md)
    })

    it('sourceLineStart は単調増加する (§6.6 invariant)', () => {
      const md = 'pre\n\n# A\n\nbody\n\n## B\n\nmore\n\n## C\n'
      const pages = splitIntoPages(md)
      const starts = pages.map((page): number => page.sourceLineStart)
      const pairs = starts.slice(1).map((current, idx): [number, number] => [starts[idx], current])
      for (const [prev, current] of pairs) {
        expect(current).toBeGreaterThan(prev)
      }
    })
  })

  describe('splitIntoPages: outline 統合', () => {
    it('各ページの headings は当該ページ内の H3–H6 のみ含む', () => {
      const md = '# A\n\n### A.1\n\nbody\n\n## B\n\n### B.1\n\n#### B.1.1\n'
      const pages = splitIntoPages(md)
      expect(pages[0].headings.map((heading): string => heading.text)).toEqual(['A.1'])
      expect(pages[1].headings.map((heading): string => heading.text)).toEqual(['B.1', 'B.1.1'])
    })

    it('Heading.sourceLineOffset は page 内 0-origin オフセット (元 markdown 行ではない)', () => {
      const md = '# A\n\n### A.1\n\nbody\n\n## B\n\n### B.1\n'
      const pages = splitIntoPages(md)
      expect(pages[1].headings[0].sourceLineOffset).toBe(2)
    })
  })
}
