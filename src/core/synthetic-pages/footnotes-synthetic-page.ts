// footnotes synthetic page (MDXG §16 / docs/mdxg-footnotes.md §3.2 / §5.c) の生成 + 判定。
// 文書由来 page の round-trip 不変条件 (markdown 連結が元と一致) を破る sentinel page を、
// pages 末尾に append する。
//
// page-split.ts (splitIntoPages の orchestrator) から `appendFootnotesPage(splitIntoPages(md), md)`
// の形で呼ばれる。Page 型は core/page-split に定義されており、ここでは type-only import で
// 循環参照を避けつつ参照する。
//
// in-source test は本ファイルに置かず、page-split.ts 側の統合テスト
// (`appendFootnotesPage (MDXG §16 / docs/mdxg-footnotes.md §3.2)` describe 等) に集約する。
// `splitIntoPages` 経路と組み合わせた挙動 (slug 衝突解決 / synthetic sentinel / findPageIndex
// との連携) を統合点で 1 度に検証するため。

import type { Page } from '../page-split'
import { countFootnoteDefinitions } from '../footnotes'
import { resolveUniqueSlug } from '../slugify'

// 文書由来でない synthetic page を区別するための sentinel 値。findPageIndexBySourceLine は
// sourceLine < 1 を early return null するため、synthetic page が文書由来 sourceLine と
// 誤マッチすることは構造的に発生しない。
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
 */
export const appendFootnotesPage = (pages: readonly Page[], markdown: string): Page[] => {
  if (countFootnoteDefinitions(markdown) === 0) {
    return [...pages]
  }
  return [...pages, buildFootnotesSyntheticPage(pages)]
}
