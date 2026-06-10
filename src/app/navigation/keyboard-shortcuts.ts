// review.ts から WASD ベースのキーマップと、affordance キー (focus / activate / arrow scroll) /
// 入力編集中ガードを切り出した module (DESIGN.md §13)。
//
// 公開シンボル:
// - shouldSkipAffordanceKey / hasNoModifier: keydown listener が affordance スキップ判定に使う
// - moveFocusLeft / moveFocusRight / moveFocusUp / moveFocusDown / activateFocusedItem:
//   WASD + Enter 相当の動作実体。review.ts の AFFORDANCE_KEY_HANDLERS dispatch から呼ばれる
//
// 内部 helper (isEditableTarget / detectCurrentPane / focusXxxPane / dispatchArrow* / scrollDocPane)
// は外部から見える必要がないため non-export のままにする。

import type { Page } from '../../core/page-split'
import { focusActiveOrFirstCommentCard } from '../comments/comments'
import { focusNavigatedLink } from './page-navigation-keyboard'
import { state } from '../state/app-state'

// `?` キー (Shift+/) や `f` / `g` などのグローバルショートカットは、textarea / input / contentEditable
// 配下にフォーカスがある間はそちらの文字入力を妨げないようスキップしたい。判定を一箇所にまとめる。
// SELECT も含めるのは <select> の typeahead (option の先頭文字を押して候補絞り込み) を奪わないため。
const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  if (target.isContentEditable) {
    return true
  }
  return target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.tagName === 'SELECT'
}

export const hasNoModifier = (event: KeyboardEvent): boolean =>
  !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey

// affordance ショートカット (`f` / `g` / `?`) を無視すべきケースをまとめた共通ガード。
//   - event.repeat: 押しっぱなしによる連続発火 (modal の点滅対策)
//   - isEditableTarget: textarea / input / contenteditable 中の文字入力を妨げない
export const shouldSkipAffordanceKey = (event: KeyboardEvent): boolean =>
  event.repeat || isEditableTarget(event.target)

type PaneId = 'comments' | 'doc' | 'toc'

const detectCurrentPane = (): PaneId | null => {
  const active = document.activeElement
  if (!(active instanceof Element)) {
    return null
  }
  if (active.closest('.page-nav')) {
    return 'toc'
  }
  if (active.closest('aside.comments')) {
    return 'comments'
  }
  if (active.closest('.doc-pane')) {
    return 'doc'
  }
  return null
}

// active page 内で scroll-spy が現在地と判定したサブ見出し (aria-current="location")。
const queryActiveOutlineLink = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('#page-nav-list a.page-outline-link[aria-current="location"]')

const focusActivePageOrFirstLink = (): void => {
  const activePage = state.pages[state.activePageIndex]
  if (activePage) {
    focusNavigatedLink(activePage.slug, null)
    return
  }
  const firstLink = document.querySelector<HTMLElement>(`#page-nav-list a`)
  if (firstLink) {
    firstLink.focus()
  }
}

const focusTocPane = (): void => {
  // 現在地サブ見出しがあれば、大見出しより粒度の細かいそこへ focus を戻す (読書位置に近い候補を優先)。
  const activeOutlineLink = queryActiveOutlineLink()
  if (activeOutlineLink) {
    activeOutlineLink.focus()
    return
  }
  focusActivePageOrFirstLink()
}

const focusDocPane = (): void => {
  const pane = document.querySelector<HTMLElement>('.doc-pane')
  if (pane) {
    pane.focus()
  }
}

const focusCommentsPane = (): void => {
  focusActiveOrFirstCommentCard()
}

// 3 pane を環状 (TOC → doc → comments → TOC → ...) と見立て、a/d で端から反対端へ wrap する。
// 両端 no-op だと「TOC で a を押しても何も起きない」反応の無さがあるため、左手だけでパネルを
// 一周できる回遊性を優先する。null (どこも focus してない初期状態) は左手 fallback として TOC へ。
const PANE_FOCUS_LEFT: Record<PaneId, () => void> = {
  comments: focusDocPane,
  doc: focusTocPane,
  toc: focusCommentsPane,
}
const PANE_FOCUS_RIGHT: Record<PaneId, () => void> = {
  comments: focusTocPane,
  doc: focusCommentsPane,
  toc: focusDocPane,
}

const resolvePaneFocusHandler = (
  current: PaneId | null,
  table: Record<PaneId, () => void>
): (() => void) => {
  if (current === null) {
    return focusTocPane
  }
  return table[current]
}

export const moveFocusLeft = (): void => {
  resolvePaneFocusHandler(detectCurrentPane(), PANE_FOCUS_LEFT)()
}

export const moveFocusRight = (): void => {
  resolvePaneFocusHandler(detectCurrentPane(), PANE_FOCUS_RIGHT)()
}

const DOC_LINE_SCROLL_PX = 40

const dispatchArrowOnActiveElement = (key: 'ArrowDown' | 'ArrowUp'): void => {
  const target = document.activeElement
  if (!(target instanceof Element)) {
    return
  }
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }))
}

const scrollDocPane = (delta: number): void => {
  const pane = document.querySelector<HTMLElement>('.doc-pane')
  if (pane) {
    pane.scrollBy({ top: delta })
  }
}

export const moveFocusUp = (): void => {
  const current = detectCurrentPane()
  if (current === 'doc') {
    scrollDocPane(-DOC_LINE_SCROLL_PX)
    return
  }
  if (current === 'toc' || current === 'comments') {
    dispatchArrowOnActiveElement('ArrowUp')
  }
}

export const moveFocusDown = (): void => {
  const current = detectCurrentPane()
  if (current === 'doc') {
    scrollDocPane(DOC_LINE_SCROLL_PX)
    return
  }
  if (current === 'toc' || current === 'comments') {
    dispatchArrowOnActiveElement('ArrowDown')
  }
}

export const activateFocusedItem = (): void => {
  const target = document.activeElement
  if (!(target instanceof HTMLElement)) {
    return
  }
  // doc-pane 自身には activate 対象が無いので no-op
  if (target.matches('.doc-pane')) {
    return
  }
  target.click()
}

const dummyPage = (overrides: Partial<Page> = {}): Page => ({
  ancestorHeadingPath: [],
  depth: 1,
  headings: [],
  index: 0,
  markdown: '',
  slug: 'p0',
  sourceLineEnd: 1,
  sourceLineStart: 1,
  title: 'P0',
  ...overrides,
})

const PAGE_NAV_LINK_HTML =
  '<a class="page-nav-link" href="#p:p0" data-slug="p:p0" aria-current="page">P0</a>'
const OUTLINE_LINK_HTML =
  '<ul class="page-outline-list"><li><a class="page-outline-link" href="#p:p0__h" data-slug="p:p0__h" aria-current="location">Sub</a></li></ul>'

const buildNavFixture = (outline: string): void => {
  document.body.innerHTML = `<aside class="page-nav" id="page-nav"><div id="page-nav-list"><ul><li class="page-nav-item page-nav-item-active">${PAGE_NAV_LINK_HTML}${outline}</li></ul></div></aside>`
}

const activeElementHasClass = (className: string): boolean => {
  const active = document.activeElement
  return active instanceof HTMLElement && active.classList.contains(className)
}

// event.target は readonly のため、テストで KeyboardEvent に target を埋め込むには defineProperty が要る。
const keydownOnTarget = (target: EventTarget, repeat = false): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: 'd', repeat })
  Object.defineProperty(event, 'target', { configurable: true, value: target })
  return event
}

if (import.meta.vitest) {
  const { beforeEach, describe, expect, it } = import.meta.vitest

  describe('shouldSkipAffordanceKey: 編集中要素ガード', () => {
    it('TEXTAREA / INPUT / SELECT 上では true (native typeahead や文字入力を奪わない)', () => {
      const textarea = document.createElement('textarea')
      const input = document.createElement('input')
      const select = document.createElement('select')
      expect(shouldSkipAffordanceKey(keydownOnTarget(textarea))).toBe(true)
      expect(shouldSkipAffordanceKey(keydownOnTarget(input))).toBe(true)
      expect(shouldSkipAffordanceKey(keydownOnTarget(select))).toBe(true)
    })

    it('contentEditable 上では true', () => {
      const div = document.createElement('div')
      div.contentEditable = 'true'
      expect(shouldSkipAffordanceKey(keydownOnTarget(div))).toBe(true)
    })

    it('通常の button では false', () => {
      const button = document.createElement('button')
      expect(shouldSkipAffordanceKey(keydownOnTarget(button))).toBe(false)
    })

    it('event.repeat=true なら editable でなくとも true (押しっぱなし対策)', () => {
      const button = document.createElement('button')
      expect(shouldSkipAffordanceKey(keydownOnTarget(button, true))).toBe(true)
    })
  })

  describe('focusTocPane', () => {
    beforeEach(() => {
      state.pages = [dummyPage()]
      state.activePageIndex = 0
    })

    it('現在地サブ見出し (aria-current="location") があればそこへ focus する', () => {
      buildNavFixture(OUTLINE_LINK_HTML)
      focusTocPane()
      expect(activeElementHasClass('page-outline-link')).toBe(true)
    })

    it('現在地サブ見出しが無ければ active page の大見出し (page-nav-link) へ focus する', () => {
      buildNavFixture('')
      focusTocPane()
      expect(activeElementHasClass('page-nav-link')).toBe(true)
    })

    it('active page が無い場合は先頭リンクへ focus する', () => {
      state.pages = []
      buildNavFixture('')
      focusTocPane()
      expect(activeElementHasClass('page-nav-link')).toBe(true)
    })
  })
}
