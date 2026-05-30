// Stacked View 用の `<section.virtual-page>` mount と、文書全体を 1 回だけ parse して
// 各 top-level block を sourceLine で所属 page に配賦する pure module。
// footnotes synthetic section は最後に orphan 救済を通してから synthetic page にハードコード配置する
// (docs/mdxg-footnotes.md §4 / §5.i)。

import { type AnchorPositionsResult, computeAnchorPositions } from '../../core/block-anchors'
import { type Page, findPageIndexBySourceLine, isSyntheticPage } from '../../core/page-split'
import { cacheBlocksAndBuildAnchors } from './block-cache'
import { extractFootnoteSection, renderOrphanFootnoteItems } from '../../core/footnotes'
import { injectCopyButtons } from './code-copy-wrap'
import { renderMarkdown } from '../../core/markdown'
import { state } from '../state/app-state'

/** ドキュメントが未読込のときの表示。プレースホルダ #doc-wrap を見える状態に戻す */
export const showEmptyDocument = (doc: HTMLElement, wrap: HTMLElement): void => {
  doc.innerHTML = ''
  wrap.style.display = 'block'
}

/**
 * 空の `<section class="virtual-page">` を生成する。各 page に対応する受け皿で、後段で
 * 全文 parse 出力の top-level block を sourceLine で配賦して appendChild する。
 * dataset.pageIndex / pageSlug は scroll-spy / TOC click / selection の page 帰属解決に使う。
 */
const createEmptyPageSection = (page: Page): HTMLElement => {
  const section = document.createElement('section')
  section.className = 'virtual-page'
  section.dataset.pageIndex = String(page.index)
  section.dataset.pageSlug = page.slug
  return section
}

const collectAllHeadingSlugs = (pages: readonly Page[]): string[] =>
  pages
    .filter((page): boolean => !isSyntheticPage(page))
    .flatMap((page): string[] => page.headings.map((heading): string => heading.slug))

interface ParsedDocFragments {
  documentary: HTMLElement[]
  footnotesSection: HTMLElement | null
}

const parseDocFragment = (
  markdown: string,
  headingSlugs: readonly string[]
): ParsedDocFragments => {
  const template = document.createElement('template')
  template.innerHTML = renderMarkdown(markdown, null, { headingSlugs })
  const fragment = template.content
  const footnotesSection = extractFootnoteSection(fragment)
  // fragment.children は live HTMLCollection だが、本ループ内では子要素を移動しないので
  // 静的コピーを作らず直接 iterate して安全。移動は後続の distributeDocumentaryBlocks で行う。
  const documentary: HTMLElement[] = []
  for (const child of fragment.children) {
    if (child instanceof HTMLElement) {
      documentary.push(child)
    }
  }
  return { documentary, footnotesSection }
}

// `positions.documentary` の長さは「DOM 上に top-level Element として出てくる documentary block の
// 個数」と 1:1 で一致する前提を持つ。前提が壊れると以降の block の `data-source-line` が滑り、
// `distributeDocumentaryBlocks` が誤った page に配賦して回帰を起こす。
// `core/block-anchors.ts` の `NON_RENDERING_DOCUMENTARY_TYPES` が `html` / `def` / `space` を
// 落として保つ契約だが、marked / marked-footnote の version up や renderer override の変更で
// 壊れた場合に silently regress するのを避けるため、不一致を console.warn で観測可能にする。
const annotateBlocksWithSourceLine = (
  blocks: readonly HTMLElement[],
  positions: AnchorPositionsResult
): void => {
  if (blocks.length !== positions.documentary.length) {
    // 前提崩れの silent regress を観測可能にするための意図的な警告のため no-console を無効化する。
    /* eslint-disable-next-line no-console */
    console.warn(
      `[doc-mount] documentary anchor count mismatch: blocks=${blocks.length} positions=${positions.documentary.length}. Page distribution may be off.`
    )
  }
  const limit = Math.min(blocks.length, positions.documentary.length)
  for (let index = 0; index < limit; index += 1) {
    blocks[index].setAttribute('data-source-line', String(positions.documentary[index].sourceLine))
  }
}

const parseSourceLine = (block: HTMLElement): number => {
  const raw = block.getAttribute('data-source-line')
  if (raw === null) {
    return Number.NaN
  }
  return Number(raw)
}

const distributeDocumentaryBlocks = (
  blocks: readonly HTMLElement[],
  pages: readonly Page[],
  sections: ReadonlyMap<number, HTMLElement>
): void => {
  // 配賦先 fallback: source line が解決できなかった block は文書冒頭 page (index 0) に積む。
  // synthetic page は document 由来の sourceLine と当たらないため、ここに来ることはない。
  for (const block of blocks) {
    const pageIndex = findPageIndexBySourceLine(pages, parseSourceLine(block)) ?? 0
    const target = sections.get(pageIndex) ?? sections.get(0)
    if (target) {
      target.appendChild(block)
    }
  }
}

const resolveFootnotesTargetSection = (
  pages: readonly Page[],
  sections: ReadonlyMap<number, HTMLElement>
): HTMLElement | undefined => {
  const syntheticIndex = pages.findIndex(isSyntheticPage)
  if (syntheticIndex === -1) {
    return sections.get(0)
  }
  return sections.get(syntheticIndex)
}

interface PlaceFootnotesArgs {
  markdown: string
  pages: readonly Page[]
  rawSection: HTMLElement | null
  sections: ReadonlyMap<number, HTMLElement>
}

const placeFootnotesSection = (args: PlaceFootnotesArgs): void => {
  const finalSection = renderOrphanFootnoteItems(args.markdown, args.rawSection, document)
  if (finalSection === null) {
    return
  }
  const target = resolveFootnotesTargetSection(args.pages, args.sections)
  if (target) {
    target.appendChild(finalSection)
  }
}

const populatePageSectionsFromMarkdown = (
  markdown: string,
  pages: readonly Page[],
  sections: ReadonlyMap<number, HTMLElement>
): void => {
  const positions = computeAnchorPositions(markdown)
  const { documentary, footnotesSection } = parseDocFragment(
    markdown,
    collectAllHeadingSlugs(pages)
  )
  annotateBlocksWithSourceLine(documentary, positions)
  distributeDocumentaryBlocks(documentary, pages, sections)
  placeFootnotesSection({
    markdown,
    pages,
    rawSection: footnotesSection,
    sections,
  })
}

/**
 * Stacked View: 全 markdown を 1 回だけ parse し、各 top-level block を sourceLine で
 * 所属 virtual-page に配賦した `<section.virtual-page>` 配列を構築する
 * (docs/mdxg-footnotes.md §4 / §5.i)。`footnote-ref-*` / `footnote-*` の id 採番が単一
 * parse 呼び出し内でのみ一貫する marked-footnote の制約に対応するため、page 単位 parse
 * 戦略は採らず、footnotes の有無に関わらず全文 parse + 配賦に統一する。
 *
 * footnotes synthetic section は最後に `renderOrphanFootnoteItems` 経由で orphan 救済 (MDXG
 * §16 [MUST NOT]) を適用したうえで synthetic page にハードコード配置する。
 *
 * state / DOM tree 非依存の純粋寄り関数として切り出してあり、戻り値の `<section>` 配列を
 * 呼び元が `doc` に append する。`state.blockAnchors` / `state.blockOriginalHTML` への
 * 書き込みや `injectCopyButtons` の発火は `mountRenderedDoc` 側で行う。
 */
export const buildPageSections = (markdown: string, pages: readonly Page[]): HTMLElement[] => {
  const sections = new Map<number, HTMLElement>()
  const ordered: HTMLElement[] = []
  for (const page of pages) {
    const section = createEmptyPageSection(page)
    sections.set(page.index, section)
    ordered.push(section)
  }
  populatePageSectionsFromMarkdown(markdown, pages, sections)
  return ordered
}

export const mountRenderedDoc = (doc: HTMLElement, wrap: HTMLElement): void => {
  wrap.style.display = 'none'
  doc.innerHTML = ''
  for (const section of buildPageSections(state.markdown, state.pages)) {
    doc.appendChild(section)
  }
  // cacheBlocksAndBuildAnchors を injectCopyButtons より先に呼び、トップレベル <pre> の場合に
  // blockId が <pre> 自身に付与されるよう順序を保つ (wrap 後だと block-id は <div> 側に移る)。
  state.blockAnchors = cacheBlocksAndBuildAnchors(doc)
  injectCopyButtons(doc)
}

const buildTestPage = (
  index: number,
  slug: string,
  sourceLines: readonly [number, number]
): Page => ({
  ancestorHeadingPath: [],
  depth: 1,
  headings: [],
  index,
  markdown: '',
  slug,
  sourceLineEnd: sourceLines[1],
  sourceLineStart: sourceLines[0],
  title: 'Page',
})

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('buildPageSections (pure 配賦契約)', () => {
    it('pages と同じ index / slug を持つ <section.virtual-page> を順序通り返す', () => {
      const pages: Page[] = [buildTestPage(0, 'intro', [1, 2]), buildTestPage(1, 'body', [3, 4])]
      const sections = buildPageSections('# Intro\n\nbody text\n', pages)
      expect(sections).toHaveLength(2)
      expect(sections[0].className).toBe('virtual-page')
      expect(sections[0].dataset.pageIndex).toBe('0')
      expect(sections[0].dataset.pageSlug).toBe('intro')
      expect(sections[1].dataset.pageSlug).toBe('body')
    })

    it('戻り値の section は doc tree に未 mount で返る (caller が append 担当)', () => {
      const pages: Page[] = [buildTestPage(0, 'intro', [1, 1])]
      const [section] = buildPageSections('hello', pages)
      expect(section.isConnected).toBe(false)
      expect(section.parentNode).toBeNull()
    })

    it('top-level block が sourceLine に従って配賦される', () => {
      const pages: Page[] = [buildTestPage(0, 'a', [1, 1]), buildTestPage(1, 'b', [3, 3])]
      const sections = buildPageSections('# A\n\n# B\n', pages)
      expect(sections[0].children.length).toBeGreaterThanOrEqual(1)
      expect(sections[1].children.length).toBeGreaterThanOrEqual(1)
    })
  })
}
