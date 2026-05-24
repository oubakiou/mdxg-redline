import { isFeedbackDirty, state } from './app-state'
import { qs, toast } from './dom-utils'
import type { Comment } from '../core/types'
import { escapeHtml } from '../core/escape'
import { instantScrollToCenter } from './scroll'
import { reapplyAllMarks } from './mark-engine'

/**
 * 別ページのコメントカードをクリックされた際に呼ばれる navigate ハンドラ。
 * sidebar は navigateToTarget を直接知らない (循環参照回避) ため、review.ts 側から注入する。
 */
let onNavigateToCommentPage: ((comment: Comment) => void) | null = null

export const configureSidebarCommentNavigation = (
  handler: ((comment: Comment) => void) | null
): void => {
  onNavigateToCommentPage = handler
}

/** mark とカード両方の active 状態を一括解除（ハイライト切り替え時の前処理） */
const clearActiveComments = (): void => {
  for (const el of document.querySelectorAll('mark.cmt.active, .cmt-card.active')) {
    el.classList.remove('active')
  }
}

/**
 * 全コメントを文書順 (pageIndex → sourceLine → startOffset) に並べたコピーを返す。
 * mark の DOM 順に依存しないため、サイドバーが全ページのコメントを表示するモードでも
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
 * 複数ページ文書のサイドバーが全コメントを混ぜて表示する際、各カードがどのページに属するかを
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
    <button class="cmt-del" data-del="${comment.id}" aria-label="Delete comment">Delete</button>
  </div>`

/** コメントを 1 件削除して即座に再描画 */
const deleteComment = (comment: Comment): void => {
  state.comments = state.comments.filter((other): boolean => other.id !== comment.id)
  reapplyAllMarks()
}

/**
 * カードのクリック動作を配線する。
 * 削除ボタン押下は stopPropagation でカードクリック（フォーカス遷移）と切り分ける必要があり、これがバグの温床になりやすいため明示的にハンドラを分けている。
 */
const wireCommentCard = (card: HTMLElement, comment: Comment, onDeleted: () => void): void => {
  card.addEventListener('click', (event): void => {
    const { target } = event
    if (target instanceof HTMLElement && target.dataset.del) {
      return
    }
    focusCommentCard(card, comment)
  })
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
const showEmptySidebar = (list: HTMLElement): void => {
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

const updateSidebarHeader = (total: number): void => {
  qs('#cmt-count').textContent = String(total)
  updateOutputButtonsDisabled(total === 0, isFeedbackDirty())
}

export const renderSidebar = (): void => {
  const list = qs('#cmt-list')
  updateSidebarHeader(state.comments.length)
  if (state.comments.length === 0) {
    showEmptySidebar(list)
    return
  }
  list.innerHTML = ''
  for (const comment of orderedComments(state.comments)) {
    list.appendChild(createCommentCard(comment, renderSidebar))
  }
}

export const activateSidebarMark = (mark: HTMLElement): void => {
  const id = mark.dataset.commentId
  clearActiveComments()
  mark.classList.add('active')
  const card = document.querySelector(`.cmt-card[data-id="${id}"]`)
  if (card) {
    card.classList.add('active')
    instantScrollToCenter(card)
  }
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
}
