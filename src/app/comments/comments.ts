import { isFeedbackDirty, replaceComments, state } from '../state/app-state'
import { qs, toast } from '../dom/dom-utils'
import type { Comment } from '../../core/types'
import { escapeHtml } from '../../core/escape'
import { instantScrollToCenter } from '../document/scroll'
import { reapplyAllMarks } from './mark-engine'

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

/**
 * 全コメントを文書順 (pageIndex → sourceLine → startOffset) に並べたコピーを返す。
 * mark の DOM 順に依存しないため、comments panel が全ページのコメントを表示するモードでも
 * 別ページの mark が DOM 上に存在しない (mark-engine が activePageIndex でフィルタする)
 * ことに影響されずに決定論的な順序が得られる。
 */
const orderedComments = (comments: Comment[]): Comment[] =>
  [...comments].toSorted((left, right): number => {
    if (left.pageIndex !== right.pageIndex) {
      return left.pageIndex - right.pageIndex
    }
    if (left.sourceLine !== right.sourceLine) {
      return left.sourceLine - right.sourceLine
    }
    return left.startOffset - right.startOffset
  })

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

/**
 * 複数ページ文書の comments panel が全コメントを混ぜて表示する際、各カードがどのページに属するかを
 * 識別できるよう meta 行先頭にページタイトルバッジを付ける。単一ページ文書では冗長なため省く。
 */
const pageBadgeHTML = (comment: Comment): string => {
  if (state.pages.length <= 1) {
    return ''
  }
  const page = state.pages[comment.pageIndex]
  if (!page) {
    return ''
  }
  return `<span class="cmt-page-badge">${escapeHtml(page.title)}</span> · `
}

/**
 * カード 1 枚分の HTML を生成。
 * `escapeHtml` で quote / body を必ずエスケープすることが、ユーザー由来テキストを innerHTML に流す際の前提。
 */
const commentCardHTML = (comment: Comment): string => `
  <div class="cmt-quote">“${escapeHtml(comment.quote)}”</div>
  <div class="cmt-body">${escapeHtml(comment.comment)}</div>
  <div class="cmt-meta">
    <span>${pageBadgeHTML(comment)}${comment.blockId} · ${new Date(comment.created).toLocaleString()}</span>
    <span class="cmt-actions">
      <button class="cmt-edit" data-edit="${comment.id}" aria-label="Edit comment">Edit</button>
      <button class="cmt-del" data-del="${comment.id}" aria-label="Delete comment">Delete</button>
    </span>
  </div>`

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

const resolveNextCardIndex = (
  total: number,
  currentIndex: number,
  direction: NavDirection
): number => {
  if (total === 0) {
    return -1
  }
  if (direction === 'home') {
    return 0
  }
  if (direction === 'end') {
    return total - 1
  }
  let delta = -1
  if (direction === 'down') {
    delta = 1
  }
  return Math.max(0, Math.min(total - 1, currentIndex + delta))
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
  const next = resolveNextCardIndex(cards.length, cards.indexOf(ctx.current), ctx.direction)
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

const commentForTest = (id: string): Comment => ({
  blockId: 'b001',
  comment: 'body',
  created: '2026-05-17T00:00:00.000Z',
  endOffset: 4,
  id,
  pageIndex: 0,
  quote: 'text',
  sourceLine: 1,
  startOffset: 0,
})

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('commentCardHTML', () => {
    it('quote と comment を HTML エスケープして描画する', () => {
      const html = commentCardHTML({
        ...commentForTest('c1'),
        comment: '<script>alert(1)</script>',
        quote: '"quoted" & raw',
      })

      expect(html).toContain('&quot;quoted&quot; &amp; raw')
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
      expect(html).not.toContain('<script>')
    })
  })

  describe('orderedComments', () => {
    it('pageIndex → sourceLine → startOffset の順で並ぶ (DOM 非依存)', () => {
      const page0Top = { ...commentForTest('p0-top'), pageIndex: 0, sourceLine: 1, startOffset: 0 }
      const page0Bottom = {
        ...commentForTest('p0-bot'),
        pageIndex: 0,
        sourceLine: 10,
        startOffset: 0,
      }
      const page1Top = { ...commentForTest('p1-top'), pageIndex: 1, sourceLine: 3, startOffset: 0 }
      // 入力順を意図的にシャッフルしても出力は文書順に揃う
      expect(
        orderedComments([page1Top, page0Bottom, page0Top]).map((comment): string => comment.id)
      ).toEqual(['p0-top', 'p0-bot', 'p1-top'])
    })

    it('同じ sourceLine 内では startOffset 順に並ぶ', () => {
      const left = { ...commentForTest('left'), pageIndex: 0, sourceLine: 5, startOffset: 2 }
      const right = { ...commentForTest('right'), pageIndex: 0, sourceLine: 5, startOffset: 18 }
      expect(orderedComments([right, left]).map((comment): string => comment.id)).toEqual([
        'left',
        'right',
      ])
    })
  })

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
