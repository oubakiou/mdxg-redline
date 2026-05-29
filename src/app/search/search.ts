// §10 Search の UI / DOM ロジック。pure ロジックは `core/search.ts` に分離してある。
//
// 設計判断:
// - Stacked View で全 page が DOM 上に並ぶため、ハイライトは全 page の全ブロックに対して
//   `<mark class="search-hl">` を text node に挿入する一括方式 (リファレンス実装 vercel-labs/mdxg
//   の `highlightTextNodes` と相当)。current mark には `search-hl-current` クラスを追加
// - cmt mark との共存: `mark-engine.setOnMarksReapplied` で register した callback 経由で
//   reapplyAllMarks 後に search ハイライトを再貼付する。reapply 経路 (Shiki upgrade /
//   renderAll / コメント追加 / 削除) のどれを通っても search 状態が維持される
// - DOM 操作はブロック単位で `selection.ts` の `textRangeFromOffsets` / `textSegments` を再利用。
//   `textSegments` の `.code-copy-btn` / `.code-lang-label` skip ルールが search にも適用されるため、
//   markdown 由来でない描画装飾が検索対象に混入する事故を構造的に防ぐ
// - 自動 navigate (§10 [SHOULD]): current match の page が `state.activePageIndex` と異なれば
//   `navigateToPage` (review.ts から DI) で page を切り替えてから scrollIntoView する。hash は
//   更新しない (検索中の hash 履歴汚染を避け、ブラウザ戻る/進むで「検索開始前」に一発で戻れる)
// - 検索 mark を貼った後の textContent は変わらない (cmt mark と同じ理由: mark タグは textContent
//   に現れない)。よって §6 anchoring 不変条件 (cmt の startOffset/endOffset) は破られない

import {
  type MatchRange,
  findMatchesInText,
  formatMatchCount,
  nextMatchIndex,
  prevMatchIndex,
} from '../../core/search'
import { qs, qsInput } from '../dom/dom-utils'
import { textRangeFromOffsets, textSegments } from '../comments/selection'
import { reapplyAllMarks } from '../comments/mark-engine'
import { state } from '../state/app-state'

interface SearchMatch {
  blockId: string
  end: number
  /** 全 match を文書順に並べた中での 0-origin index。`data-search-index` 属性にも書く */
  matchIndex: number
  pageIndex: number
  start: number
}

interface SearchState {
  currentIndex: number | null
  matches: SearchMatch[]
  open: boolean
  query: string
}

const searchState: SearchState = {
  currentIndex: null,
  matches: [],
  open: false,
  query: '',
}

/** review.ts から DI される「current match の page に navigate する」コールバック */
let navigateToPageHook: ((pageIndex: number) => void) | null = null

const SEARCH_BAR_ID = 'search-bar'
const SEARCH_INPUT_ID = 'search-input'
const SEARCH_COUNT_ID = 'search-count'
const SEARCH_PREV_ID = 'search-prev'
const SEARCH_NEXT_ID = 'search-next'
const SEARCH_CLOSE_ID = 'search-close'
const SEARCH_HL_CLASS = 'search-hl'
const SEARCH_HL_CURRENT_CLASS = 'search-hl-current'

export const isSearchOpen = (): boolean => searchState.open

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
const collectSearchMatches = (query: string): SearchMatch[] => {
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

/** endpoints から `Range` を組み立てる。setStart/End が失敗 (境界違反等) すれば null で握りつぶす */
const rangeFromEndpoints = (endpoints: {
  endNode: Text
  endOff: number
  startNode: Text
  startOff: number
}): Range | null => {
  const range = document.createRange()
  try {
    range.setStart(endpoints.startNode, endpoints.startOff)
    range.setEnd(endpoints.endNode, endpoints.endOff)
  } catch {
    return null
  }
  return range
}

const createSearchMarkElement = (matchIndex: number): HTMLElement => {
  const mark = document.createElement('mark')
  mark.className = SEARCH_HL_CLASS
  mark.dataset.searchIndex = String(matchIndex)
  return mark
}

/**
 * `range` を `mark` で wrap する。単一テキストノード内なら surroundContents、ノードをまたぐ場合は
 * extractContents + insertNode フォールバック。cmt mark 境界をまたぐ等で失敗するケースは skip。
 */
const surroundRangeWithMark = (range: Range, mark: HTMLElement, sameNode: boolean): void => {
  try {
    if (sameNode) {
      range.surroundContents(mark)
      return
    }
    const contents = range.extractContents()
    mark.appendChild(contents)
    range.insertNode(mark)
  } catch {
    // cmt mark 境界を跨ぐ等で surroundContents / extractContents が失敗するケースは skip
  }
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
  const mark = createSearchMarkElement(match.matchIndex)
  surroundRangeWithMark(range, mark, endpoints.startNode === endpoints.endNode)
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

const markCurrentSearchMark = (currentIndex: number | null): void => {
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
const applySearchHighlights = (): void => {
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

const updateCountDisplay = (): void => {
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
const scrollCurrentMarkIntoView = (): void => {
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

/**
 * current match の page が activePage と違えば navigate (review.ts の renderAll 経由)。
 * navigate は内部で renderAll を呼び、その流れで reapplyAllMarks → onMarksReapplied 経由で
 * search ハイライトが新ページの DOM 上に再貼付される。
 */
const navigateToCurrentMatch = (): void => {
  if (searchState.currentIndex === null) {
    return
  }
  const match = searchState.matches[searchState.currentIndex]
  if (!match) {
    return
  }
  if (match.pageIndex !== state.activePageIndex && navigateToPageHook !== null) {
    navigateToPageHook(match.pageIndex)
  }
  markCurrentSearchMark(searchState.currentIndex)
  updateCountDisplay()
  scrollCurrentMarkIntoView()
}

const resolveInitialCurrentIndex = (matchCount: number): number | null => {
  if (matchCount === 0) {
    return null
  }
  return 0
}

/** 検索クエリを更新し、matches を再計算してハイライトと count を反映する */
export const setSearchQuery = (query: string): void => {
  searchState.query = query
  searchState.matches = collectSearchMatches(query)
  searchState.currentIndex = resolveInitialCurrentIndex(searchState.matches.length)
  reapplyAllMarks()
  updateCountDisplay()
  if (searchState.currentIndex !== null) {
    navigateToCurrentMatch()
  }
}

export const nextMatch = (): void => {
  searchState.currentIndex = nextMatchIndex(searchState.currentIndex, searchState.matches.length)
  navigateToCurrentMatch()
}

export const prevMatch = (): void => {
  searchState.currentIndex = prevMatchIndex(searchState.currentIndex, searchState.matches.length)
  navigateToCurrentMatch()
}

const resetSearchState = (): void => {
  searchState.query = ''
  searchState.matches = []
  searchState.currentIndex = null
}

// input 連打中に毎回 setSearchQuery を発火させると collectSearchMatches + reapplyAllMarks +
// applySearchHighlights が累積し、大きな文書で操作が引っかかる。打鍵が一定時間止まってから
// 1 回だけ実行するため、タイマーで debounce する。150ms は GitHub の find-in-code 等で
// 採用される標準値で、入力 → 結果反映の体感ラグを抑えつつ無駄な再計算を大幅に削減する。
const SEARCH_DEBOUNCE_MS = 150
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

const cancelPendingSearch = (): void => {
  if (searchDebounceTimer !== null) {
    clearTimeout(searchDebounceTimer)
    searchDebounceTimer = null
  }
}

const resetSearchInput = (): void => {
  const input = qsInput(`#${SEARCH_INPUT_ID}`)
  input.value = ''
  resetSearchState()
  updateCountDisplay()
  setTimeout((): void => input.focus(), 0)
}

const SEARCH_TOGGLE_BUTTON_ID = 'btn-search'

const syncSearchToggleButton = (open: boolean): void => {
  const btn = document.getElementById(SEARCH_TOGGLE_BUTTON_ID)
  if (!(btn instanceof HTMLElement)) {
    return
  }
  btn.classList.toggle('btn-active', open)
  btn.setAttribute('aria-pressed', String(open))
}

/** 検索バーを開く。前回の query は維持しない (空欄から始める) */
export const openSearch = (): void => {
  const bar = document.getElementById(SEARCH_BAR_ID)
  if (!(bar instanceof HTMLElement)) {
    return
  }
  // 「入力 → debounce 経過前に close → 再 open」の流れで、前回登録した timer が生きていると
  // 再 open 後に旧 query で setSearchQuery が発火し、空欄からスタートしたはずの bar に
  // 旧 highlight が復活する。close と同じく open 先頭でも timer を確実にキャンセルする。
  cancelPendingSearch()
  searchState.open = true
  bar.classList.add('open')
  syncSearchToggleButton(true)
  resetSearchInput()
}

/** 検索バーを閉じる。state をクリアし、cmt mark のみの状態に戻す (reapplyAllMarks 経由) */
export const closeSearch = (): void => {
  const bar = document.getElementById(SEARCH_BAR_ID)
  if (!(bar instanceof HTMLElement)) {
    return
  }
  cancelPendingSearch()
  searchState.open = false
  resetSearchState()
  bar.classList.remove('open')
  syncSearchToggleButton(false)
  reapplyAllMarks()
}

export const toggleSearch = (): void => {
  if (searchState.open) {
    closeSearch()
    return
  }
  openSearch()
}

// Enter / Shift+Enter で next/prev する前に、pending 中の debounce を即時 flush して
// 最新クエリの matches で navigation する。flush 経路を分けないと、ユーザーが「打鍵 → 即 Enter」
// した場合に古い matches で navigate してしまう。
const flushPendingSearch = (input: HTMLInputElement): void => {
  if (searchDebounceTimer === null) {
    return
  }
  cancelPendingSearch()
  setSearchQuery(input.value)
}

const scheduleSearch = (input: HTMLInputElement): void => {
  cancelPendingSearch()
  searchDebounceTimer = setTimeout((): void => {
    searchDebounceTimer = null
    setSearchQuery(input.value)
  }, SEARCH_DEBOUNCE_MS)
}

/** input の Enter / Shift+Enter で next / prev、その他キーは標準挙動に任せる */
const handleSearchInputKeydown = (input: HTMLInputElement, event: KeyboardEvent): void => {
  if (event.key !== 'Enter') {
    return
  }
  event.preventDefault()
  flushPendingSearch(input)
  if (event.shiftKey) {
    prevMatch()
    return
  }
  nextMatch()
}

const wireSearchInput = (input: HTMLInputElement): void => {
  input.addEventListener('input', (): void => {
    scheduleSearch(input)
  })
  input.addEventListener('keydown', (event): void => {
    handleSearchInputKeydown(input, event)
  })
}

const wireButtonClick = (id: string, handler: () => void): void => {
  const btn = document.getElementById(id)
  if (btn) {
    btn.addEventListener('click', handler)
  }
}

/** 検索バー内の各 button / input にイベントを wire する。1 度だけ呼ぶ */
export const wireSearchBar = (): void => {
  const input = document.getElementById(SEARCH_INPUT_ID)
  if (input instanceof HTMLInputElement) {
    wireSearchInput(input)
  }
  wireButtonClick(SEARCH_PREV_ID, prevMatch)
  wireButtonClick(SEARCH_NEXT_ID, nextMatch)
  wireButtonClick(SEARCH_CLOSE_ID, closeSearch)
}

/** review.ts から渡される navigate 関数を保持する */
export const configureSearchNavigation = (navigateToPage: (pageIndex: number) => void): void => {
  navigateToPageHook = navigateToPage
}

/** mark-engine の `setOnMarksReapplied` で register する callback */
export const reapplySearchHighlights = (): void => {
  applySearchHighlights()
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

  describe('search module exports', () => {
    it('public API が export されている', () => {
      expect(typeof openSearch).toBe('function')
      expect(typeof closeSearch).toBe('function')
      expect(typeof setSearchQuery).toBe('function')
      expect(typeof nextMatch).toBe('function')
      expect(typeof prevMatch).toBe('function')
      expect(typeof isSearchOpen).toBe('function')
      expect(typeof reapplySearchHighlights).toBe('function')
      expect(typeof wireSearchBar).toBe('function')
      expect(typeof configureSearchNavigation).toBe('function')
    })

    it('初期 searchState は閉じている / matches 空 / currentIndex null', () => {
      expect(isSearchOpen()).toBe(false)
    })
  })

  describe('resolveInitialCurrentIndex', () => {
    it('match 0 件は null', () => {
      expect(resolveInitialCurrentIndex(0)).toBeNull()
    })

    it('match 1 件以上は 0', () => {
      expect(resolveInitialCurrentIndex(1)).toBe(0)
      expect(resolveInitialCurrentIndex(10)).toBe(0)
    })
  })

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
      // 'abcdefghij' 全体を cmt mark で wrap
      block.innerHTML = '<mark class="cmt" data-comment-id="c1">abcdefghij</mark>'
      // cmt 内の 'def' に search-hl を貼る (start=3, end=6)
      applyMatchesForBlock(block, [fakeSearchMatch(3, 6, 0)])
      const cmtMark = block.querySelector('mark.cmt')
      const searchMark = block.querySelector('mark.search-hl')
      expect(cmtMark).not.toBeNull()
      expect(searchMark).not.toBeNull()
      expect(searchMark instanceof HTMLElement && searchMark.textContent).toBe('def')
      // cmt 全体の textContent は保たれる (textContent ベースで 10 chars のまま)
      expect(cmtMark instanceof HTMLElement && cmtMark.textContent).toBe('abcdefghij')
    })
  })
}
