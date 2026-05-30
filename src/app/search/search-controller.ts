// §10 Search の UI controller。state (search-state) と DOM (search-dom) の橋渡しを担い、
// 入力 debounce、Enter による next/prev、開閉トグル、navigate hook の DI 配線を行う。

import { nextMatchIndex, prevMatchIndex } from '../../core/search'
import { resolveInitialCurrentIndex, searchState } from './search-state'
import {
  SEARCH_BAR_ID,
  SEARCH_CLOSE_ID,
  SEARCH_INPUT_ID,
  SEARCH_NEXT_ID,
  SEARCH_PREV_ID,
  applySearchHighlights,
  collectSearchMatches,
  markCurrentSearchMark,
  scrollCurrentMarkIntoView,
  syncSearchToggleButton,
  updateCountDisplay,
} from './search-dom'
import { qsInput } from '../dom/dom-utils'
import { reapplyAllMarks } from '../comments/mark-engine'
import { state } from '../state/app-state'

/** review.ts (composition root) から DI される「current match の page に navigate する」コールバック */
let navigateToPageHook: ((pageIndex: number) => void) | null = null

/**
 * current match の page が activePage と違えば navigate。
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
