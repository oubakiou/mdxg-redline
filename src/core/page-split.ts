// markdown を MDXG §6 仮想ページに分割する pure module。
// H1 / H2 境界を検出して chunk 化し、見出し前コンテンツの Introduction 正規化 (§6.2) と
// 見出しが一切無い文書を単一ページに正規化する規約 (mdxg-virtual-pages.archive.md §7.5) を担う。
//
// 行スキャン本体は page-outline.ts の scanHeadings に集約しており、本 module はその結果から
// depth ≤ 2 のものをページ境界として取り出して markdown 範囲を切り出す部分に専念する。
// markdown 範囲の切り出しは行オフセット → 元 markdown.slice で行うため、元 markdown と
// pages[*].markdown を連結した値は完全に一致する (round-trip 不変条件)。

import { type Heading, type HeadingHit, extractPageHeadings, scanHeadings } from './page-outline'
import { resolveUniqueSlug, slugifyOrFallback } from './slugify'
import { countFootnoteDefinitions } from './footnotes'

/**
 * 仮想ページ 1 枚分のデータ。
 * markdown は元 markdown の連続するサブストリングで、連結すると元 markdown と一致する。
 * sourceLineStart / sourceLineEnd は 1-origin で、当該ページの markdown 内行が
 * `[sourceLineStart, sourceLineEnd]` の範囲を占める (両端含む)。export feedback.json の
 * sourceLine 計算と、sourceLine → pageIndex の逆引き範囲チェックに使う。
 *
 * ancestorHeadingPath: 当該ページの祖先見出し (浅い順、ATX 表記、自身は含めない)。
 * H1 ページ / Introduction では空配列、H2 ページでは直近の祖先 H1 を 1 要素含む。
 * doc-renderer.ts が page スコープで build した blockAnchors の headingPath にこれを
 * prepend することで、ページ境界の H1 / H2 を含む完全な祖先 path を export feedback.json に
 * 反映する (mdxg-virtual-pages.archive.md §9.3)。
 */
export interface Page {
  ancestorHeadingPath: readonly string[]
  depth: 1 | 2
  headings: Heading[]
  index: number
  markdown: string
  slug: string
  sourceLineEnd: number
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
  /**
   * §6.2 で導入される暗黙の "Introduction" ページかどうか。
   * 暗黙 Intro は markdown ソースに対応する見出しトークンを持たないので、
   * 後続 H2 ページの祖先 (ancestorHeadingPath) としては数えない (mdxg-virtual-pages.archive.md §9.3)。
   * ユーザーが実 H1 で "Introduction" と書いた場合はこのフラグは false で、通常の祖先扱いになる。
   */
  isIntroduction: boolean
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

interface FinalizeContext {
  ancestorHeadingPath: readonly string[]
  index: number
  usedSlugs: Set<string>
}

/**
 * RawPage が占有する元 markdown 行の末尾 (1-origin, 両端含む) を計算する。
 * block-anchors.ts の `lineCursor` 増分 (newline 数を sourceLine に足す) と同じ counting に
 * 揃え、当該ページ内ブロックが取り得る最大 sourceLine と一致させる。
 *
 * - 末尾改行あり / なしを `trailingDelta` で吸収
 * - 空 markdown (markdown.length === 0) は `sourceLineStart - 1` を返し、`start > end` で
 *   「行を占有しない」状態を表現する (findPageIndexBySourceLine の範囲チェックで自然に弾かれる)
 */
const trailingNewlineDelta = (markdown: string): number => {
  if (markdown.endsWith('\n')) {
    return 0
  }
  return 1
}

const computePageEndLine = (raw: RawPage): number => {
  if (raw.markdown.length === 0) {
    return raw.sourceLineStart - 1
  }
  const newlines = (raw.markdown.match(/\n/gu) || []).length
  return raw.sourceLineStart + newlines + trailingNewlineDelta(raw.markdown) - 1
}

const finalizePage = (raw: RawPage, context: FinalizeContext): Page => {
  const baseSlug = slugifyOrFallback(raw.title, `page-${context.index + 1}`)
  const slug = resolveUniqueSlug(baseSlug, context.usedSlugs)
  return {
    ancestorHeadingPath: context.ancestorHeadingPath,
    depth: raw.depth,
    headings: extractPageHeadings(raw.markdown),
    index: context.index,
    markdown: raw.markdown,
    slug,
    sourceLineEnd: computePageEndLine(raw),
    sourceLineStart: raw.sourceLineStart,
    title: raw.title,
  }
}

/**
 * 各 RawPage について「直近の祖先 H1 のタイトル」を計算し、headingPath 用の祖先配列を返す。
 *
 * - 暗黙の Introduction ページ (`isIntroduction === true`) は markdown ソースに対応する見出し
 *   トークンを持たないため、後続 H2 の祖先には数えない
 * - 実際のユーザー H1 ページが title="Introduction" の場合は通常通り祖先となる
 *   (mdxg-virtual-pages.archive.md §9.3 / §7.6)
 * - ATX 表記 (`# Title`) で再構築する。setext H1 ("Title\n===") との混在を避けるための正規化で、
 *   `block-anchors.ts` の `token.raw` 由来 headingPath と表記が一部分岐するが、後段 LLM が
 *   読みやすい統一表記として ATX に揃える方針
 */
interface AncestorState {
  mostRecentH1Title: string | null
}

const ancestorPathForH2 = (state: AncestorState): readonly string[] => {
  if (state.mostRecentH1Title === null) {
    return []
  }
  return [`# ${state.mostRecentH1Title}`]
}

const stepAncestor = (page: RawPage, state: AncestorState): readonly string[] => {
  if (page.depth === 1) {
    if (!page.isIntroduction) {
      state.mostRecentH1Title = page.title
    }
    return []
  }
  return ancestorPathForH2(state)
}

const computeAncestorHeadingPaths = (
  rawPages: readonly RawPage[]
): readonly (readonly string[])[] => {
  const state: AncestorState = { mostRecentH1Title: null }
  return rawPages.map((page): readonly string[] => stepAncestor(page, state))
}

/**
 * markdown を仮想ページ (MDXG §6) に分割する。
 * - H1 / H2 (ATX / setext) で境界分割し、コードフェンス内見出しは境界として扱わない (§6.1)
 * - 見出し前の非空 content は "Introduction" ページとして先頭に追加 (§6.2 / §7.6)
 * - H1 / H2 が無い文書は `docName` (未指定なら "Document") を title とした単一ページに正規化 (§7.5)
 * - 各ページに slug (ASCII 限定 + fallback / -N suffix)、H3–H6 outline、
 *   祖先 H1 を含む ancestorHeadingPath (§9.3) を埋め込む
 */
/**
 * 元 markdown 全体の sourceLine (1-origin) から所属 page index を逆引きする。
 * embedded-feedback / Open file 経由で読み込んだコメントに `pageIndex` を埋める用途
 * (mdxg-virtual-pages.archive.md §9.1)。
 *
 * - sourceLine < 1 → null (§6.6 invariant: sourceLine は 1 以上の正整数)
 * - pages が空 → null
 * - `sourceLineStart <= sourceLine <= sourceLineEnd` を満たす page の index を返す
 * - どの page にも収まらない (sourceLine が doc 全体の範囲を超える / 別文書由来) → null
 *   末尾ページへの吸着はせず破棄を選ぶ (mdxg-virtual-pages.archive.md §6.6 / §9.1)
 */
export const findPageIndexBySourceLine = (
  pages: readonly Page[],
  sourceLine: number
): number | null => {
  if (sourceLine < 1 || pages.length === 0) {
    return null
  }
  for (const [index, page] of pages.entries()) {
    if (sourceLine >= page.sourceLineStart && sourceLine <= page.sourceLineEnd) {
      return index
    }
  }
  return null
}

export const splitIntoPages = (markdown: string, options: SplitOptions = {}): Page[] => {
  const fallbackTitle = options.docName ?? DEFAULT_FALLBACK_TITLE
  const markers = toBoundaryMarkers(scanHeadings(markdown))
  const rawPages = sliceMarkdownByMarkers(markdown, markers, fallbackTitle)
  const ancestors = computeAncestorHeadingPaths(rawPages)
  const usedSlugs = new Set<string>()
  return rawPages.map(
    (raw, index): Page =>
      finalizePage(raw, { ancestorHeadingPath: ancestors[index], index, usedSlugs })
  )
}

// footnotes synthetic page (MDXG §16 / docs/mdxg-footnotes.md §3.2 / §5.c) の sentinel。
// round-trip 不変条件 (文書由来 page の markdown を連結すると元 markdown と一致する) を
// 持たない synthetic page を区別するため、sourceLineStart / sourceLineEnd に -1 を入れる。
// findPageIndexBySourceLine は sourceLine < 1 を early return null するため、synthetic page が
// 文書由来 sourceLine と誤マッチすることは構造的に発生しない。
const SYNTHETIC_PAGE_SOURCE_LINE = -1
const FOOTNOTES_PAGE_TITLE = 'Footnotes'
const FOOTNOTES_PAGE_SLUG_BASE = 'footnotes'

/** footnotes synthetic page 等、文書由来でない page を判定する。round-trip テストの除外に使う。 */
export const isSyntheticPage = (page: Page): boolean =>
  page.sourceLineStart === SYNTHETIC_PAGE_SOURCE_LINE

const buildFootnotesSyntheticPage = (pages: readonly Page[]): Page => {
  const usedSlugs = new Set<string>(pages.map((page): string => page.slug))
  return {
    ancestorHeadingPath: [],
    depth: 1,
    headings: [],
    index: pages.length,
    markdown: '',
    slug: resolveUniqueSlug(FOOTNOTES_PAGE_SLUG_BASE, usedSlugs),
    sourceLineEnd: SYNTHETIC_PAGE_SOURCE_LINE,
    sourceLineStart: SYNTHETIC_PAGE_SOURCE_LINE,
    title: FOOTNOTES_PAGE_TITLE,
  }
}

/**
 * markdown に脚注定義 (`[^id]: text`) が ≥1 個含まれる場合、`pages` 末尾に footnotes
 * synthetic page を append する。脚注定義が 0 個なら pages の浅いコピーを返す。
 *
 * slug は `'footnotes'` を base に文書内既存 slug と衝突しないよう `resolveUniqueSlug` で
 * 解決する (本物の H1 / H2 "Footnotes" が存在する文書では `'footnotes-2'` 等になる)。
 *
 * `appendFootnotesPage(splitIntoPages(markdown, options), markdown)` の形で
 * `state.pages` builder 経路に乗せる (docs/mdxg-footnotes.md §5.h)。
 */
export const appendFootnotesPage = (pages: readonly Page[], markdown: string): Page[] => {
  if (countFootnoteDefinitions(markdown) === 0) {
    return [...pages]
  }
  return [...pages, buildFootnotesSyntheticPage(pages)]
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

  describe('splitIntoPages: ancestorHeadingPath (§9.3)', () => {
    it('H1 ページ自身の ancestorHeadingPath は空配列', () => {
      const pages = splitIntoPages('# A\n\nbody\n')
      expect(pages[0].ancestorHeadingPath).toEqual([])
    })

    it('H2 ページの ancestor は直前の H1 を含む', () => {
      const pages = splitIntoPages('# Root\n\n## Sub\n\nbody\n')
      expect(pages[1].ancestorHeadingPath).toEqual(['# Root'])
    })

    it('H1 を挟まずに H2 ページから始まる場合は ancestor 空', () => {
      const pages = splitIntoPages('## A\n\nbody\n')
      expect(pages[0].ancestorHeadingPath).toEqual([])
    })

    it('暗黙の Introduction ページは H2 の祖先として数えない', () => {
      const pages = splitIntoPages('prelude\n\n## A\n\nbody\n')
      expect(pages.map((page): string => page.title)).toEqual(['Introduction', 'A'])
      expect(pages[0].ancestorHeadingPath).toEqual([])
      // Introduction を挟んでいるが直前に H1 が無いので H2 "A" の ancestor も空
      expect(pages[1].ancestorHeadingPath).toEqual([])
    })

    it('複数 H1 を挟むと H2 の ancestor は直近の H1 だけを指す', () => {
      const pages = splitIntoPages('# First\n\n# Second\n\n## Sub\n\nbody\n')
      expect(pages[2].ancestorHeadingPath).toEqual(['# Second'])
    })

    it('ユーザーが H1 で "Introduction" と書いた場合は通常の祖先扱いになる', () => {
      const pages = splitIntoPages('# Introduction\n\n## Sub\n\nbody\n')
      expect(pages[0].ancestorHeadingPath).toEqual([])
      expect(pages[1].ancestorHeadingPath).toEqual(['# Introduction'])
    })
  })

  describe('findPageIndexBySourceLine (Phase 5 §9.1 逆引き)', () => {
    it('各ページの [sourceLineStart, sourceLineEnd] 範囲内の sourceLine をそのページに割り当てる', () => {
      const pages = splitIntoPages('# A\n\nbody\n\n## B\n\nmore\n\n# C\n\ntail\n')
      // # A は line 1-4, ## B は line 5-8, # C は line 9-11
      expect(findPageIndexBySourceLine(pages, 1)).toBe(0)
      expect(findPageIndexBySourceLine(pages, 3)).toBe(0)
      expect(findPageIndexBySourceLine(pages, 5)).toBe(1)
      expect(findPageIndexBySourceLine(pages, 8)).toBe(1)
      expect(findPageIndexBySourceLine(pages, 9)).toBe(2)
    })

    it('Introduction を挟む場合も sourceLine 範囲で正しく割り当てる', () => {
      const pages = splitIntoPages('prelude\n\n# A\n\nbody\n')
      expect(pages.map((page): string => page.title)).toEqual(['Introduction', 'A'])
      expect(findPageIndexBySourceLine(pages, 1)).toBe(0)
      expect(findPageIndexBySourceLine(pages, 3)).toBe(1)
    })

    it('sourceLine < 1 は null (§6.6 invariant 違反)', () => {
      const pages = splitIntoPages('# A\n')
      expect(findPageIndexBySourceLine(pages, 0)).toBeNull()
      expect(findPageIndexBySourceLine(pages, -5)).toBeNull()
    })

    it('pages 空配列は null', () => {
      expect(findPageIndexBySourceLine([], 1)).toBeNull()
    })

    it('doc 全体の最終行を超える sourceLine は末尾ページへ吸着せず null (§6.6 / §9.1)', () => {
      const pages = splitIntoPages('# A\n\nbody\n')
      // # A は line 1-3 (markdown は "# A\n\nbody\n")
      expect(findPageIndexBySourceLine(pages, 4)).toBeNull()
      expect(findPageIndexBySourceLine(pages, 100)).toBeNull()
    })

    it('各ページの sourceLineEnd ぴったりは当該ページ、+1 で次ページ or null', () => {
      const pages = splitIntoPages('# A\n\nbody\n\n## B\n\ntail\n')
      // # A は line 1-4, ## B は line 5-7
      expect(findPageIndexBySourceLine(pages, 4)).toBe(0)
      expect(findPageIndexBySourceLine(pages, 5)).toBe(1)
      expect(findPageIndexBySourceLine(pages, 7)).toBe(1)
      expect(findPageIndexBySourceLine(pages, 8)).toBeNull()
    })
  })

  describe('Page.sourceLineEnd (Phase 5 fix)', () => {
    it('各ページが占有する元 markdown 行の末尾を 1-origin で持つ', () => {
      const pages = splitIntoPages('# A\n\nbody\n\n## B\n\ntail\n')
      // markdown 全体: line 1 "# A", line 2 "", line 3 "body", line 4 "", line 5 "## B", line 6 "", line 7 "tail", line 8 ""
      // Page A markdown "# A\n\nbody\n\n" は line 1-4
      expect(pages[0].sourceLineEnd).toBe(4)
      // Page B markdown "## B\n\ntail\n" は line 5-7
      expect(pages[1].sourceLineEnd).toBe(7)
    })

    it('末尾改行なし markdown でも end が正しく計算される', () => {
      const pages = splitIntoPages('# A\n\nbody')
      // line 1 "# A", line 2 "", line 3 "body"
      expect(pages[0].sourceLineEnd).toBe(3)
    })
  })

  describe('appendFootnotesPage (MDXG §16 / docs/mdxg-footnotes.md §3.2)', () => {
    it('脚注定義が無い markdown では synthetic page を追加しない (pages の浅いコピーを返す)', () => {
      const pages = splitIntoPages('# A\n\nbody\n')
      const result = appendFootnotesPage(pages, '# A\n\nbody\n')
      expect(result).toHaveLength(pages.length)
      expect(result).toEqual(pages)
      // 同一参照ではなく浅いコピーを返す (呼び出し側の mutation 防止)
      expect(result).not.toBe(pages)
    })

    it('脚注定義が ≥1 個ある markdown では footnotes synthetic page を末尾に追加する', () => {
      const markdown = '# A\n\nSee[^1].\n\n[^1]: footnote text\n'
      const pages = appendFootnotesPage(splitIntoPages(markdown), markdown)
      expect(pages).toHaveLength(2)
      const synthetic = pages[pages.length - 1]
      expect(synthetic.slug).toBe('footnotes')
      expect(synthetic.title).toBe('Footnotes')
      expect(synthetic.depth).toBe(1)
      expect(synthetic.index).toBe(1)
    })

    it('synthetic page は round-trip 不変条件を破る sentinel 値を持つ (markdown:"", sourceLine:-1)', () => {
      const markdown = '# A\n\nSee[^1].\n\n[^1]: footnote text\n'
      const pages = appendFootnotesPage(splitIntoPages(markdown), markdown)
      const synthetic = pages[pages.length - 1]
      expect(synthetic.markdown).toBe('')
      expect(synthetic.headings).toEqual([])
      expect(synthetic.ancestorHeadingPath).toEqual([])
      expect(synthetic.sourceLineStart).toBe(-1)
      expect(synthetic.sourceLineEnd).toBe(-1)
    })

    it('複数定義でも synthetic page は 1 枚 (page 単位は文書末集約)', () => {
      const markdown = 'See[^a] and [^b].\n\n[^a]: A\n[^b]: B\n'
      const pages = appendFootnotesPage(splitIntoPages(markdown), markdown)
      const syntheticCount = pages.filter(isSyntheticPage).length
      expect(syntheticCount).toBe(1)
    })

    it('本物の H1 "Footnotes" と衝突する場合は slug を `footnotes-2` に解決する', () => {
      const markdown = '# Footnotes\n\nSee[^1].\n\n[^1]: text\n'
      const pages = appendFootnotesPage(splitIntoPages(markdown), markdown)
      const synthetic = pages[pages.length - 1]
      // 文書由来の "Footnotes" 見出しが先に slug 'footnotes' を獲得しているため、
      // synthetic page は resolveUniqueSlug 経由で 'footnotes-2' になる
      expect(pages[0].slug).toBe('footnotes')
      expect(synthetic.slug).toBe('footnotes-2')
      expect(isSyntheticPage(synthetic)).toBe(true)
    })

    it('orphan のみ (本文で参照されていない定義) でも synthetic page は追加される', () => {
      const markdown = 'plain paragraph.\n\n[^orphan]: never referenced.\n'
      const pages = appendFootnotesPage(splitIntoPages(markdown), markdown)
      const synthetic = pages[pages.length - 1]
      expect(isSyntheticPage(synthetic)).toBe(true)
      expect(synthetic.slug).toBe('footnotes')
    })

    it('未定義参照 (本文に `[^x]` があるが定義無し) では synthetic page を追加しない', () => {
      const markdown = 'See [^missing] here.\n'
      const pages = appendFootnotesPage(splitIntoPages(markdown), markdown)
      expect(pages.some(isSyntheticPage)).toBe(false)
    })
  })

  describe('isSyntheticPage / findPageIndexBySourceLine の synthetic page 除外', () => {
    it('isSyntheticPage は sourceLineStart === -1 の page のみ true', () => {
      const markdown = '# A\n\nbody\n\nSee[^1].\n\n[^1]: text\n'
      const pages = appendFootnotesPage(splitIntoPages(markdown), markdown)
      expect(isSyntheticPage(pages[0])).toBe(false)
      expect(isSyntheticPage(pages[pages.length - 1])).toBe(true)
    })

    it('findPageIndexBySourceLine は synthetic page を sourceLine 範囲で誤マッチしない', () => {
      const markdown = '# A\n\nbody\n\nSee[^1].\n\n[^1]: text\n'
      const pages = appendFootnotesPage(splitIntoPages(markdown), markdown)
      // 文書由来の sourceLine 1 / 3 はそれぞれ page 0 にマッチ
      expect(findPageIndexBySourceLine(pages, 1)).toBe(0)
      expect(findPageIndexBySourceLine(pages, 3)).toBe(0)
      // synthetic page は -1 sentinel なので、文書由来 sourceLine では決して当たらない
      expect(findPageIndexBySourceLine(pages, 100)).toBeNull()
      // sourceLine < 1 の early-return は変わらず null
      expect(findPageIndexBySourceLine(pages, -1)).toBeNull()
      expect(findPageIndexBySourceLine(pages, 0)).toBeNull()
    })
  })

  describe('round-trip 不変条件 (synthetic page の除外)', () => {
    it('文書由来 page (isSyntheticPage === false) のみ連結すると元 markdown と一致する', () => {
      const markdown = '# A\n\nbody[^1].\n\n[^1]: footnote\n'
      const pages = appendFootnotesPage(splitIntoPages(markdown), markdown)
      const documentaryPages = pages.filter((page): boolean => !isSyntheticPage(page))
      const reconstructed = documentaryPages.map((page): string => page.markdown).join('')
      expect(reconstructed).toBe(markdown)
    })
  })
}
