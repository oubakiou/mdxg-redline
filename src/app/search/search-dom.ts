// §10 Search の DOM 操作層。match 収集 (DOM 走査) と <mark class="search-hl"> の貼付・解除、
// count 表示・current mark 強調・scrollIntoView などブラウザに触る処理を集約する。
// state singleton は search-state.ts に分離されており、本ファイルは「state を読んで DOM に流す」
// 方向の関数を提供する。

import { type MatchRange, findMatchesInText } from '../../core/search'
import { formatMatchCount } from './format-match-count'
import {
  rangeFromEndpoints,
  textRangeFromOffsets,
  textSegments,
  wrapRange,
} from '../dom/text-range'
import { type SearchMatch, searchState } from './search-state'
import { qs } from '../dom/dom-utils'

export const SEARCH_BAR_ID = 'search-bar'
export const SEARCH_INPUT_ID = 'search-input'
export const SEARCH_COUNT_ID = 'search-count'
export const SEARCH_PREV_ID = 'search-prev'
export const SEARCH_NEXT_ID = 'search-next'
export const SEARCH_CLOSE_ID = 'search-close'
export const SEARCH_TOGGLE_BUTTON_ID = 'btn-search'
export const SEARCH_HL_CLASS = 'search-hl'
export const SEARCH_HL_CURRENT_CLASS = 'search-hl-current'

/** ブロック内 flat text (textSegments の textContent 連結) を返す */
const flatTextForBlock = (blockEl: Element): string => {
  let text = ''
  for (const segment of textSegments(blockEl)) {
    text += segment.node.textContent ?? ''
  }
  return text
}

interface BlockMatchContext {
  baseIndex: number
  blockEl: Element
  pageIndex: number
  query: string
}

const blockIdOf = (blockEl: Element): string => {
  if (blockEl instanceof HTMLElement) {
    return blockEl.dataset.blockId ?? ''
  }
  return ''
}

/** 1 ブロック分の match を収集して文書順に matchIndex を採番する */
const collectBlockMatches = (context: BlockMatchContext): SearchMatch[] => {
  const blockId = blockIdOf(context.blockEl)
  if (blockId === '') {
    return []
  }
  const flat = flatTextForBlock(context.blockEl)
  const ranges = findMatchesInText(flat, context.query)
  return ranges.map(
    (range: MatchRange, index: number): SearchMatch => ({
      blockId,
      end: range.end,
      matchIndex: context.baseIndex + index,
      pageIndex: context.pageIndex,
      start: range.start,
    })
  )
}

/** `<section.virtual-page>` の dataset.pageIndex を数値化する (parse 失敗で null) */
const pageIndexFromSection = (section: HTMLElement): number | null => {
  const raw = section.dataset.pageIndex
  if (typeof raw !== 'string') {
    return null
  }
  const parsed = Number.parseInt(raw, 10)
  if (Number.isNaN(parsed)) {
    return null
  }
  return parsed
}

/** 1 section 内の全 block を走査して match を集める */
const collectSectionMatches = (
  section: HTMLElement,
  query: string,
  baseIndex: number
): SearchMatch[] => {
  const pageIndex = pageIndexFromSection(section)
  if (pageIndex === null) {
    return []
  }
  const matches: SearchMatch[] = []
  for (const block of section.querySelectorAll<HTMLElement>('[data-block-id]')) {
    matches.push(
      ...collectBlockMatches({
        baseIndex: baseIndex + matches.length,
        blockEl: block,
        pageIndex,
        query,
      })
    )
  }
  return matches
}

/** 全 `<section.virtual-page>` を順走査してマッチを収集する */
export const collectSearchMatches = (query: string): SearchMatch[] => {
  if (query.length === 0) {
    return []
  }
  const doc = qs('#doc')
  const matches: SearchMatch[] = []
  for (const section of doc.querySelectorAll<HTMLElement>(':scope > section.virtual-page')) {
    matches.push(...collectSectionMatches(section, query, matches.length))
  }
  return matches
}

const createSearchMarkElement = (matchIndex: number): HTMLElement => {
  const mark = document.createElement('mark')
  mark.className = SEARCH_HL_CLASS
  mark.dataset.searchIndex = String(matchIndex)
  return mark
}

/** 1 マッチ分の Range を組み立てて `<mark class="search-hl">` で包む */
const wrapMatchInBlock = (blockEl: Element, match: SearchMatch): void => {
  const endpoints = textRangeFromOffsets(blockEl, match.start, match.end)
  if (!endpoints) {
    return
  }
  const range = rangeFromEndpoints(endpoints)
  if (!range) {
    return
  }
  wrapRange(range, createSearchMarkElement(match.matchIndex))
}

/** 同一ブロック内の match を start 降順で並べ、後ろから wrap してオフセットずれを防ぐ */
const applyMatchesForBlock = (blockEl: Element, blockMatches: SearchMatch[]): void => {
  const sorted = [...blockMatches].toSorted((left, right): number => right.start - left.start)
  for (const match of sorted) {
    wrapMatchInBlock(blockEl, match)
  }
}

const matchesByBlock = (matches: SearchMatch[]): Map<string, SearchMatch[]> => {
  const map = new Map<string, SearchMatch[]>()
  for (const match of matches) {
    const bucket = map.get(match.blockId)
    if (bucket) {
      bucket.push(match)
    } else {
      map.set(match.blockId, [match])
    }
  }
  return map
}

export const markCurrentSearchMark = (currentIndex: number | null): void => {
  const doc = qs('#doc')
  for (const mark of doc.querySelectorAll(`mark.${SEARCH_HL_CLASS}.${SEARCH_HL_CURRENT_CLASS}`)) {
    mark.classList.remove(SEARCH_HL_CURRENT_CLASS)
  }
  if (currentIndex === null) {
    return
  }
  const target = doc.querySelector<HTMLElement>(
    `mark.${SEARCH_HL_CLASS}[data-search-index="${currentIndex}"]`
  )
  if (target) {
    target.classList.add(SEARCH_HL_CURRENT_CLASS)
  }
}

/** 現在の searchState を DOM に貼り直す。`reapplyAllMarks` 後 (cmt mark 適用後) に呼ばれる */
export const applySearchHighlights = (): void => {
  const doc = qs('#doc')
  if (searchState.matches.length === 0) {
    return
  }
  const byBlock = matchesByBlock(searchState.matches)
  for (const [blockId, blockMatches] of byBlock) {
    const blockEl = doc.querySelector(`[data-block-id="${blockId}"]`)
    if (blockEl) {
      applyMatchesForBlock(blockEl, blockMatches)
    }
  }
  markCurrentSearchMark(searchState.currentIndex)
}

export const updateCountDisplay = (): void => {
  const countEl = document.getElementById(SEARCH_COUNT_ID)
  if (countEl) {
    countEl.textContent = formatMatchCount(searchState.currentIndex, searchState.matches.length)
  }
}

/**
 * current match を scrollIntoView する。検索 mark が描画済み (DOM に load 済み) 前提。
 *
 * `behavior: 'auto'` (instant) を使うのは、本実装の他の navigate 経路 (`scrollToHeading` /
 * `alignSectionTopInPane`) と挙動を揃え、ページ間を高速移動する逐次検索 UX (Enter 連打) で
 * smooth アニメーションが追い付かず「次マッチを見失う」事象を避けるため。
 */
export const scrollCurrentMarkIntoView = (): void => {
  if (searchState.currentIndex === null) {
    return
  }
  const target = document.querySelector<HTMLElement>(
    `mark.${SEARCH_HL_CLASS}[data-search-index="${searchState.currentIndex}"]`
  )
  if (target) {
    target.scrollIntoView({ behavior: 'auto', block: 'center' })
  }
}

export const syncSearchToggleButton = (open: boolean): void => {
  const btn = document.getElementById(SEARCH_TOGGLE_BUTTON_ID)
  if (!(btn instanceof HTMLElement)) {
    return
  }
  btn.classList.toggle('btn-active', open)
  btn.setAttribute('aria-pressed', String(open))
}

const buildSearchBlockForTest = (text: string): HTMLElement => {
  const block = document.createElement('p')
  block.setAttribute('data-block-id', 'b1')
  block.textContent = text
  return block
}

const fakeSearchMatch = (start: number, end: number, matchIndex: number): SearchMatch => ({
  blockId: 'b1',
  end,
  matchIndex,
  pageIndex: 0,
  start,
})

const searchIndexOf = (mark: Element): string => {
  if (mark instanceof HTMLElement) {
    return mark.dataset.searchIndex ?? ''
  }
  return ''
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('wrapMatchInBlock (DOM)', () => {
    it('単一テキストノード内の match を <mark class="search-hl"> で囲む', () => {
      const block = buildSearchBlockForTest('Hello world')
      wrapMatchInBlock(block, fakeSearchMatch(6, 11, 0))
      const mark = block.querySelector('mark.search-hl')
      expect(mark).not.toBeNull()
      expect(mark instanceof HTMLElement && mark.textContent).toBe('world')
      expect(mark instanceof HTMLElement && mark.dataset.searchIndex).toBe('0')
    })

    it('範囲が解決できない (block 外の offset) match は no-op で fail-soft', () => {
      const block = buildSearchBlockForTest('short')
      expect((): void => wrapMatchInBlock(block, fakeSearchMatch(100, 200, 0))).not.toThrow()
      expect(block.querySelector('mark.search-hl')).toBeNull()
    })
  })

  describe('applyMatchesForBlock (DOM)', () => {
    it('複数 match を start 降順で wrap し、前方オフセットがずれない', () => {
      const block = buildSearchBlockForTest('abcdefghij')
      // 宣言順をシャッフルしても結果は同じ (内部で start 降順 sort)
      applyMatchesForBlock(block, [fakeSearchMatch(0, 3, 0), fakeSearchMatch(6, 9, 1)])
      const marks = block.querySelectorAll('mark.search-hl')
      expect(marks).toHaveLength(2)
      const byIndex = new Map(
        [...marks].map((mark): [string, string] => [searchIndexOf(mark), mark.textContent ?? ''])
      )
      expect(byIndex.get('0')).toBe('abc')
      expect(byIndex.get('1')).toBe('ghi')
    })

    it('既存 <mark class="cmt"> と共存する (search-hl は cmt 内にも貼れる)', () => {
      const block = document.createElement('p')
      block.setAttribute('data-block-id', 'b1')
      block.innerHTML = '<mark class="cmt" data-comment-id="c1">abcdefghij</mark>'
      applyMatchesForBlock(block, [fakeSearchMatch(3, 6, 0)])
      const cmtMark = block.querySelector('mark.cmt')
      const searchMark = block.querySelector('mark.search-hl')
      expect(cmtMark).not.toBeNull()
      expect(searchMark).not.toBeNull()
      expect(searchMark instanceof HTMLElement && searchMark.textContent).toBe('def')
      expect(cmtMark instanceof HTMLElement && cmtMark.textContent).toBe('abcdefghij')
    })
  })
}
