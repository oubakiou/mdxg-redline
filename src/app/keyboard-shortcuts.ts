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

import { focusActiveOrFirstCommentCard } from './comments'
import { focusNavigatedLink } from './page-navigation'
import { state } from './app-state'

// `?` キー (Shift+/) や `f` / `g` などのグローバルショートカットは、textarea / input / contentEditable
// 配下にフォーカスがある間はそちらの文字入力を妨げないようスキップしたい。判定を一箇所にまとめる。
const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  if (target.isContentEditable) {
    return true
  }
  return target.tagName === 'TEXTAREA' || target.tagName === 'INPUT'
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

const focusTocPane = (): void => {
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
