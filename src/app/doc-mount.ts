// Stacked View 用の `<section.virtual-page>` mount と、文書全体を 1 回だけ parse して
// 各 top-level block を sourceLine で所属 page に配賦する pure module。
// footnotes synthetic section は最後に orphan 救済を通してから synthetic page にハードコード配置する
// (docs/mdxg-footnotes.md §4 / §5.i)。

import { type AnchorPositionsResult, computeAnchorPositions } from '../core/block-anchors'
import { type Page, findPageIndexBySourceLine, isSyntheticPage } from '../core/page-split'
import { cacheBlocksAndBuildAnchors } from './block-cache'
import { extractFootnoteSection, renderOrphanFootnoteItems } from '../core/footnotes'
import { injectCopyButtons } from './code-copy-wrap'
import { renderMarkdown } from '../core/markdown'
import { state } from './app-state'

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

/**
 * Stacked View: 全 markdown を 1 回だけ parse し、各 top-level block を sourceLine で
 * 所属 virtual-page に配賦する (docs/mdxg-footnotes.md §4 / §5.i)。`footnote-ref-*` /
 * `footnote-*` の id 採番が単一 parse 呼び出し内でのみ一貫する marked-footnote の制約に
 * 対応するため、page 単位 parse 戦略は廃止し、footnotes の有無に関わらず全文 parse + 配賦
 * に統一する。
 *
 * footnotes synthetic section は最後に `renderOrphanFootnoteItems` 経由で orphan 救済 (MDXG
 * §16 [MUST NOT]) を適用したうえで synthetic page にハードコード配置する。
 */
const mountEmptyPageSections = (doc: HTMLElement): Map<number, HTMLElement> => {
  const sections = new Map<number, HTMLElement>()
  for (const page of state.pages) {
    const section = createEmptyPageSection(page)
    doc.appendChild(section)
    sections.set(page.index, section)
  }
  return sections
}

const populatePageSectionsFromMarkdown = (sections: ReadonlyMap<number, HTMLElement>): void => {
  const positions = computeAnchorPositions(state.markdown)
  const { documentary, footnotesSection } = parseDocFragment(
    state.markdown,
    collectAllHeadingSlugs(state.pages)
  )
  annotateBlocksWithSourceLine(documentary, positions)
  distributeDocumentaryBlocks(documentary, state.pages, sections)
  placeFootnotesSection({
    markdown: state.markdown,
    pages: state.pages,
    rawSection: footnotesSection,
    sections,
  })
}

export const mountRenderedDoc = (doc: HTMLElement, wrap: HTMLElement): void => {
  wrap.style.display = 'none'
  doc.innerHTML = ''
  const sections = mountEmptyPageSections(doc)
  populatePageSectionsFromMarkdown(sections)
  // cacheBlocksAndBuildAnchors を injectCopyButtons より先に呼び、トップレベル <pre> の場合に
  // blockId が <pre> 自身に付与されるよう順序を保つ (wrap 後だと block-id は <div> 側に移る)。
  state.blockAnchors = cacheBlocksAndBuildAnchors(doc)
  injectCopyButtons(doc)
}
