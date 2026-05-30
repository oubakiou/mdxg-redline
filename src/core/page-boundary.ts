// markdown を MDXG §6 仮想ページの「生」境界配列に切り出す pure primitive。
// H1 / H2 マーカーの検出 (scanHeadings に委譲) と、暗黙の Introduction (§6.2) /
// 単一ページ正規化 (§7.5) を含む RawPage[] への変換を担う。
//
// `partitionRawPages` 経由で `page-split.ts` の orchestrator (splitIntoPages) から呼ばれる。
// 行スキャン本体は page-outline.ts、slug 解決・ancestor 計算・findPage 等は page-split.ts。
// 元 markdown と pages[*].markdown を連結した値は完全に一致する (round-trip 不変条件) を
// この層で担保している (markdown.slice ベースの切り出し)。

import { type HeadingHit, scanHeadings } from './page-outline'

/**
 * 仮想ページ 1 枚分の「生」データ。slug / 祖先 path / outline はまだ計算しない。
 *
 * `isIntroduction`: §6.2 で導入される暗黙の "Introduction" ページかどうか。暗黙 Intro は
 * markdown ソースに対応する見出しトークンを持たないので、後続 H2 ページの祖先には数えない
 * (docs/archive/mdxg-virtual-pages.archive.md §9.3)。ユーザーが実 H1 で "Introduction" と
 * 書いた場合はこのフラグは false で、通常の祖先扱いになる。
 */
export interface RawPage {
  depth: 1 | 2
  isIntroduction: boolean
  markdown: string
  sourceLineStart: number
  title: string
}

interface PageBoundaryMarker {
  depth: 1 | 2
  lineIndex: number
  title: string
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
  return {
    depth: 1,
    isIntroduction: true,
    markdown: introMd,
    sourceLineStart: 1,
    title: INTRODUCTION_TITLE,
  }
}

const buildMarkerPage = (args: MarkerSliceArgs): RawPage => ({
  depth: args.marker.depth,
  isIntroduction: false,
  markdown: sliceByLineRange(args.context, args.marker.lineIndex, args.endLine),
  sourceLineStart: args.marker.lineIndex + 1,
  title: args.marker.title,
})

// 次マーカーの lineIndex か、最終マーカーなら markdown 末尾までを取り出す。
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
  { depth: 1, isIntroduction: false, markdown, sourceLineStart: 1, title: fallbackTitle },
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

/**
 * markdown から RawPage[] を組み立てる public エントリ。
 *
 * - H1 / H2 (ATX / setext) で境界分割し、コードフェンス内見出しは境界として扱わない (§6.1)
 * - 見出し前の非空 content は "Introduction" ページとして先頭に追加 (§6.2 / §7.6)
 * - H1 / H2 が無い文書は `fallbackTitle` を title とした単一ページに正規化 (§7.5)
 *
 * 切り出した RawPage[] の markdown を連結すると元 markdown と完全に一致する (round-trip 不変条件)。
 */
export const partitionRawPages = (markdown: string, fallbackTitle: string): RawPage[] => {
  const markers = toBoundaryMarkers(scanHeadings(markdown))
  return sliceMarkdownByMarkers(markdown, markers, fallbackTitle)
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('partitionRawPages', () => {
    it('H1 / H2 で境界を分割し RawPage[] を返す', () => {
      const md = '# A\n\nbody\n\n## B\n\nmore\n'
      const pages = partitionRawPages(md, 'fallback')
      expect(pages.map((page): string => page.title)).toEqual(['A', 'B'])
      expect(pages.map((page): 1 | 2 => page.depth)).toEqual([1, 2])
    })

    it('見出し前の non-empty content を Introduction として先頭に追加する', () => {
      const md = 'prelude\n\n# A\n'
      const pages = partitionRawPages(md, 'fallback')
      expect(pages.map((page): string => page.title)).toEqual(['Introduction', 'A'])
      expect(pages[0].isIntroduction).toBe(true)
    })

    it('見出しが無い markdown は fallbackTitle 単一ページに正規化する', () => {
      const pages = partitionRawPages('plain only\n', 'snippet.md')
      expect(pages).toHaveLength(1)
      expect(pages[0].title).toBe('snippet.md')
      expect(pages[0].isIntroduction).toBe(false)
    })

    it('round-trip: pages[*].markdown を連結すると元 markdown に一致する', () => {
      const md = 'prelude\n\n# A\n\nbody A\n\n## B\n\nbody B'
      const pages = partitionRawPages(md, 'fallback')
      expect(pages.map((page): string => page.markdown).join('')).toBe(md)
    })
  })
}
