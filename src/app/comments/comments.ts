import { isFeedbackDirty, replaceComments, state } from '../state/app-state'
import { qs, toast } from '../dom/dom-utils'
import type { Comment } from '../../core/types'
import { commentCardHTML } from './comment-rendering'
import { instantScrollToCenter } from '../document/scroll'
import { orderedComments } from './comment-orderer'
import { reapplyAllMarks } from './mark-engine'
import { resolveNextFocusIndex } from '../dom/focus-list'

/**
 * 別ページのコメントカードをクリックされた際に呼ばれる navigate ハンドラ。
 * comments panel は navigateToTarget を直接知らない (循環参照回避) ため、review.ts 側から注入する。
 */
let onNavigateToCommentPage: ((comment: Comment) => void) | null = null

export const configureCommentsNavigation = (handler: ((comment: Comment) => void) | null): void => {
  onNavigateToCommentPage = handler
}

/**
 * Edit ボタン押下時に呼ぶ編集モーダル起動ハンドラ。
 * comment-modal.ts は renderComments を import しているため、comments.ts → comment-modal の
 * 逆向き import を張ると循環参照になる。navigate と同じく review.ts 側から注入して回避する。
 */
let onEditComment: ((comment: Comment) => void) | null = null

export const configureCommentEdit = (handler: ((comment: Comment) => void) | null): void => {
  onEditComment = handler
}

/** mark とカード両方の active 状態を一括解除（ハイライト切り替え時の前処理） */
const clearActiveComments = (): void => {
  for (const el of document.querySelectorAll('mark.cmt.active, .cmt-card.active')) {
    el.classList.remove('active')
  }
}

const requestNavigateToCommentPage = (comment: Comment): void => {
  if (onNavigateToCommentPage !== null) {
    onNavigateToCommentPage(comment)
  }
}

const focusCommentCard = (card: HTMLElement, comment: Comment): void => {
  if (comment.pageIndex !== state.activePageIndex) {
    requestNavigateToCommentPage(comment)
    return
  }
  const mark = document.querySelector(`mark.cmt[data-comment-id="${comment.id}"]`)
  if (!mark) {
    return
  }
  clearActiveComments()
  mark.classList.add('active')
  card.classList.add('active')
  instantScrollToCenter(mark)
}

/**
 * navigateToTarget 後の DOM 再描画完了直後に呼ぶ「mark をハイライトしつつ本文を mark までスクロール」。
 * 別ページからのジャンプ経路で focusCommentCard と同等の見た目に揃える。
 */
export const focusCommentMarkAfterNavigate = (commentId: string): void => {
  const mark = document.querySelector(`mark.cmt[data-comment-id="${commentId}"]`)
  if (!(mark instanceof HTMLElement)) {
    return
  }
  clearActiveComments()
  mark.classList.add('active')
  const card = document.querySelector(`.cmt-card[data-id="${commentId}"]`)
  if (card instanceof HTMLElement) {
    card.classList.add('active')
  }
  instantScrollToCenter(mark)
}

/** コメントを 1 件削除して即座に再描画 */
const deleteComment = (comment: Comment): void => {
  replaceComments(state.comments.filter((other): boolean => other.id !== comment.id))
  reapplyAllMarks()
}

/**
 * カードのクリック動作を配線する。
 * 削除ボタン押下は stopPropagation でカードクリック（フォーカス遷移）と切り分ける必要があり、これがバグの温床になりやすいため明示的にハンドラを分けている。
 */
const requestEditComment = (comment: Comment): void => {
  if (onEditComment !== null) {
    onEditComment(comment)
  }
}

const wireCommentCard = (card: HTMLElement, comment: Comment, onDeleted: () => void): void => {
  card.tabIndex = 0
  card.addEventListener('click', (event): void => {
    const { target } = event
    if (target instanceof HTMLElement && (target.dataset.del || target.dataset.edit)) {
      return
    }
    focusCommentCard(card, comment)
  })
  card.addEventListener('keydown', (event): void => {
    if (event.key !== 'Enter') {
      return
    }
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
      return
    }
    const { target } = event
    if (target instanceof HTMLElement && target.tagName === 'BUTTON') {
      return
    }
    event.preventDefault()
    focusCommentCard(card, comment)
  })
  const editButton = card.querySelector('[data-edit]')
  if (editButton) {
    editButton.addEventListener('click', (event): void => {
      event.stopPropagation()
      requestEditComment(comment)
    })
  }
  const delButton = card.querySelector('[data-del]')
  if (delButton) {
    delButton.addEventListener('click', (event): void => {
      event.stopPropagation()
      deleteComment(comment)
      onDeleted()
      toast('Comment deleted')
    })
  }
}

const createCommentCard = (comment: Comment, onDeleted: () => void): HTMLDivElement => {
  const card = document.createElement('div')
  card.className = 'cmt-card'
  card.dataset.id = comment.id
  card.innerHTML = commentCardHTML(comment)
  wireCommentCard(card, comment, onDeleted)
  return card
}

/** コメント 0 件時の案内表示 */
const showEmptyComments = (list: HTMLElement): void => {
  list.innerHTML =
    '<div class="label" style="color: var(--ink-faint);">Select text in the file to add a review comment.</div>'
}

const COMMENT_MENU_BUTTON_IDS = ['#btn-copy', '#btn-export', '#btn-clear'] as const

const updateOutputButtonsDisabled = (empty: boolean, dirty: boolean): void => {
  qs('#btn-send').toggleAttribute('disabled', empty || !dirty)
  for (const id of COMMENT_MENU_BUTTON_IDS) {
    qs(id).toggleAttribute('disabled', empty)
  }
}

const updateCommentsHeader = (total: number): void => {
  qs('#cmt-count').textContent = String(total)
  updateOutputButtonsDisabled(total === 0, isFeedbackDirty())
}

export const renderComments = (): void => {
  const list = qs('#cmt-list')
  updateCommentsHeader(state.comments.length)
  if (state.comments.length === 0) {
    showEmptyComments(list)
    return
  }
  list.innerHTML = ''
  for (const comment of orderedComments(state.comments)) {
    list.appendChild(createCommentCard(comment, renderComments))
  }
}

const COMMENT_CARD_SELECTOR = '.cmt-card'

type NavDirection = 'up' | 'down' | 'home' | 'end'

const navDirectionFromKey = (key: string): NavDirection | null => {
  if (key === 'ArrowDown') {
    return 'down'
  }
  if (key === 'ArrowUp') {
    return 'up'
  }
  if (key === 'Home') {
    return 'home'
  }
  if (key === 'End') {
    return 'end'
  }
  return null
}

const queryCommentCards = (root: HTMLElement): readonly HTMLElement[] => [
  ...root.querySelectorAll<HTMLElement>(COMMENT_CARD_SELECTOR),
]

interface CommentsKeyDownContext {
  current: HTMLElement
  direction: NavDirection
}

const hasAnyModifier = (event: KeyboardEvent): boolean =>
  event.metaKey || event.ctrlKey || event.altKey || event.shiftKey

const resolveCurrentCommentCard = (target: EventTarget | null): HTMLElement | null => {
  if (!(target instanceof HTMLElement)) {
    return null
  }
  return target.closest<HTMLElement>(COMMENT_CARD_SELECTOR)
}

const resolveCommentsKeyDownContext = (event: KeyboardEvent): CommentsKeyDownContext | null => {
  if (hasAnyModifier(event)) {
    return null
  }
  const direction = navDirectionFromKey(event.key)
  if (direction === null) {
    return null
  }
  const current = resolveCurrentCommentCard(event.target)
  if (current === null) {
    return null
  }
  return { current, direction }
}

const onCommentsKeyDown = (root: HTMLElement, event: KeyboardEvent): void => {
  const ctx = resolveCommentsKeyDownContext(event)
  if (ctx === null) {
    return
  }
  event.preventDefault()
  const cards = queryCommentCards(root)
  const next = resolveNextFocusIndex(cards.length, cards.indexOf(ctx.current), ctx.direction)
  const targetCard = cards[next]
  if (targetCard) {
    targetCard.focus()
  }
}

/**
 * comments panel 上で ↑↓ / Home / End によりカード間を巡回する keyboard delegate。
 * page-navigation.ts の onPageNavKeyDown と同じ flat 配列巡回パターン。
 * Enter は cmt-card 個別 listener が捌くため別経路。
 */
export const wireCommentsKeyboardNav = (): void => {
  const root = document.querySelector<HTMLElement>('aside.comments')
  if (root === null) {
    return
  }
  root.addEventListener('keydown', (event): void => {
    onCommentsKeyDown(root, event)
  })
}

/**
 * `h` キー由来で comments panel に navigate する際の focus 先解決。
 *   - active な cmt-card があればそれに focus (`f` の active page-nav-link 対称)
 *   - 無ければ最初の cmt-card
 *   - カードが 1 件も無ければ aside.comments 自身に focus (空状態 hint へのアクセス保持)
 */
export const focusActiveOrFirstCommentCard = (): void => {
  const root = document.querySelector<HTMLElement>('aside.comments')
  if (root === null) {
    return
  }
  const active = root.querySelector<HTMLElement>('.cmt-card.active')
  const first = root.querySelector<HTMLElement>(COMMENT_CARD_SELECTOR)
  const target = active ?? first
  if (target) {
    target.focus()
    return
  }
  root.focus()
}

export const activateCommentsMark = (mark: HTMLElement): void => {
  const id = mark.dataset.commentId
  clearActiveComments()
  mark.classList.add('active')
  const card = document.querySelector(`.cmt-card[data-id="${id}"]`)
  if (card) {
    card.classList.add('active')
    instantScrollToCenter(card)
  }
}

const appendMarkAndCard = (doc: HTMLElement, aside: HTMLElement, commentId: string): void => {
  const mark = document.createElement('mark')
  mark.className = 'cmt'
  mark.dataset.commentId = commentId
  doc.appendChild(mark)
  const card = document.createElement('div')
  card.className = 'cmt-card'
  card.dataset.id = commentId
  aside.appendChild(card)
}

// activateCommentsMark / focusCommentMarkAfterNavigate は document をルートに querySelector するため、
// detached なツリーでは検証できない。body にぶら下げる fixture を用意する。
const setupActiveSyncFixture = (commentIds: readonly string[]): void => {
  document.body.innerHTML = ''
  const doc = document.createElement('div')
  doc.id = 'doc'
  const aside = document.createElement('aside')
  aside.className = 'comments'
  for (const id of commentIds) {
    appendMarkAndCard(doc, aside, id)
  }
  document.body.appendChild(doc)
  document.body.appendChild(aside)
}

const datasetIdFor = (element: HTMLElement): string => {
  if (element.tagName === 'MARK') {
    return element.dataset.commentId ?? ''
  }
  return element.dataset.id ?? ''
}

const queryActiveIds = (selector: string): string[] => {
  const results: string[] = []
  for (const element of document.querySelectorAll(`${selector}.active`)) {
    if (element instanceof HTMLElement) {
      results.push(datasetIdFor(element))
    }
  }
  return results
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  // commentCardHTML / orderedComments の pure テストは comment-rendering.ts /
  // comment-orderer.ts の in-source test に集約済み。本ファイルでは DOM 副作用を伴う
  // active 状態同期のテストだけを保持する。

  describe('activateCommentsMark (active 双方向同期)', () => {
    it('mark クリック → 対応 .cmt-card に .active 付与、他カードは active を剥がす', () => {
      setupActiveSyncFixture(['a', 'b'])
      // 既存の active を仕込んでおき、clearActiveComments が剥がすことを確認
      const other = document.querySelector('.cmt-card[data-id="b"]')
      if (other instanceof HTMLElement) {
        other.classList.add('active')
      }
      const targetMark = document.querySelector('mark.cmt[data-comment-id="a"]')
      if (!(targetMark instanceof HTMLElement)) {
        throw new Error('fixture missing')
      }
      activateCommentsMark(targetMark)
      expect(queryActiveIds('mark.cmt')).toEqual(['a'])
      expect(queryActiveIds('.cmt-card')).toEqual(['a'])
    })

    it('対応 .cmt-card が DOM に無くても fail-soft (mark 側だけ active 付与)', () => {
      setupActiveSyncFixture([])
      const doc = document.querySelector('#doc')
      const mark = document.createElement('mark')
      mark.className = 'cmt'
      mark.dataset.commentId = 'orphan'
      if (doc instanceof HTMLElement) {
        doc.appendChild(mark)
      }
      expect((): void => {
        activateCommentsMark(mark)
      }).not.toThrow()
      expect(mark.classList.contains('active')).toBe(true)
      expect(document.querySelector('.cmt-card.active')).toBeNull()
    })
  })

  // §13 [MUST] 矢印キーによる focus 移動のインデックス計算は H1 で共通化された
  // focus-list helper (`src/app/dom/focus-list.ts`) の in-source test に集約済み。
  // `up from no-focus` のフォールバックは過去の comments 側 `resolveNextCardIndex` では
  // 先頭だったが、TOC 仕様に揃えて末尾になった。

  describe('focusCommentMarkAfterNavigate (id 経由の active 同期)', () => {
    it('id から mark + card 両方に .active を付与する', () => {
      setupActiveSyncFixture(['x', 'y'])
      focusCommentMarkAfterNavigate('y')
      expect(queryActiveIds('mark.cmt')).toEqual(['y'])
      expect(queryActiveIds('.cmt-card')).toEqual(['y'])
    })

    it('id 対応 mark が DOM に無ければ no-op (active 状態は変化しない)', () => {
      setupActiveSyncFixture(['x'])
      const existing = document.querySelector('mark.cmt[data-comment-id="x"]')
      if (existing instanceof HTMLElement) {
        existing.classList.add('active')
      }
      focusCommentMarkAfterNavigate('nonexistent')
      expect(queryActiveIds('mark.cmt')).toEqual(['x']) // 以前の active が剥がれない
    })
  })
}
