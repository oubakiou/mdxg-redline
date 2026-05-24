import { isFeedbackDirty, state } from './app-state'
import { qs, toast } from './dom-utils'
import type { Comment } from '../core/types'
import { escapeHtml } from '../core/escape'
import { reapplyAllMarks } from './mark-engine'
import { smoothScrollToCenter } from './scroll'

/** mark とカード両方の active 状態を一括解除（ハイライト切り替え時の前処理） */
const clearActiveComments = (): void => {
  for (const el of document.querySelectorAll('mark.cmt.active, .cmt-card.active')) {
    el.classList.remove('active')
  }
}

/**
 * 文書中の出現順（mark 要素の DOM 順）でコメント ID → インデックスを引けるマップ。
 * サイドバーで「上から順に並べる」並び替えのキーに使う。
 */
const commentOrderMap = (): Map<string, number> => {
  const order = new Map<string, number>()
  const marks = [...document.querySelectorAll<HTMLElement>('mark.cmt')]
  for (const [index, mark] of marks.entries()) {
    const id = mark.dataset.commentId
    if (id) {
      order.set(id, index)
    }
  }
  return order
}

/**
 * コメント配列を文書出現順に並べたコピーを返す。
 * mark が DOM 上に存在しないコメント（mark 化に失敗した分）は順位 999 として末尾側に寄せる。
 */
const orderedComments = (comments: Comment[]): Comment[] => {
  const order = commentOrderMap()
  return [...comments].toSorted(
    (left, right): number => (order.get(left.id) ?? 999) - (order.get(right.id) ?? 999)
  )
}

const focusCommentCard = (card: HTMLElement, comment: Comment): void => {
  const mark = document.querySelector(`mark.cmt[data-comment-id="${comment.id}"]`)
  if (!mark) {
    return
  }
  clearActiveComments()
  mark.classList.add('active')
  card.classList.add('active')
  smoothScrollToCenter(mark)
}

/**
 * カード 1 枚分の HTML を生成。
 * `escapeHtml` で quote / body を必ずエスケープすることが、ユーザー由来テキストを innerHTML に流す際の前提。
 */
const commentCardHTML = (comment: Comment): string => `
  <div class="cmt-quote">“${escapeHtml(comment.quote)}”</div>
  <div class="cmt-body">${escapeHtml(comment.comment)}</div>
  <div class="cmt-meta">
    <span>${comment.blockId} · ${new Date(comment.created).toLocaleString()}</span>
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

/**
 * サイドバー上部の件数表示を組み立てる (Phase 5 / mdxg-virtual-pages.md §9.2)。
 * - 単一ページ文書 (pages.length <= 1): `N` 形式 (this page = all なので冗長な括弧表示は避ける)
 * - 複数ページ文書: `N / M` 形式 (N=this page, M=all)
 */
export const formatPageScopedCommentCount = (
  thisPage: number,
  total: number,
  hasMultiplePages: boolean
): string => {
  if (!hasMultiplePages) {
    return String(total)
  }
  return `${thisPage} / ${total}`
}

const commentBelongsToActivePage = (comment: Comment): boolean =>
  comment.pageIndex === state.activePageIndex

const updateSidebarHeader = (visibleCount: number, total: number): void => {
  qs('#cmt-count').textContent = formatPageScopedCommentCount(
    visibleCount,
    total,
    state.pages.length > 1
  )
  // dirty / 出力ボタンの有効化判定は「全コメント基準」で行う。export は全ページ分が対象なので
  // this page だけ空でも全体に書き出せる comments があれば Write feedback.json は押せて良い。
  updateOutputButtonsDisabled(total === 0, isFeedbackDirty())
}

export const renderSidebar = (): void => {
  const list = qs('#cmt-list')
  const visibleComments = state.comments.filter(commentBelongsToActivePage)
  updateSidebarHeader(visibleComments.length, state.comments.length)
  if (visibleComments.length === 0) {
    showEmptySidebar(list)
    return
  }
  list.innerHTML = ''
  for (const comment of orderedComments(visibleComments)) {
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
    smoothScrollToCenter(card)
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
  const { afterEach, describe, expect, it, vi } = import.meta.vitest

  afterEach(() => {
    vi.unstubAllGlobals()
  })

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
    it('本文 mark の DOM 順にコメントを並べる', () => {
      vi.stubGlobal('document', {
        querySelectorAll: () => [
          { dataset: { commentId: 'second' } },
          { dataset: { commentId: 'first' } },
        ],
      })

      const first = commentForTest('first')
      const second = commentForTest('second')
      expect(orderedComments([first, second]).map((comment): string => comment.id)).toEqual([
        'second',
        'first',
      ])
    })

    it('mark が存在しないコメントは末尾に寄せる', () => {
      vi.stubGlobal('document', {
        querySelectorAll: () => [{ dataset: { commentId: 'known' } }],
      })

      const known = commentForTest('known')
      const missing = commentForTest('missing')
      expect(orderedComments([missing, known]).map((comment): string => comment.id)).toEqual([
        'known',
        'missing',
      ])
    })
  })

  describe('formatPageScopedCommentCount (Phase 5 §9.2)', () => {
    it('単一ページ文書では全コメント数のみ表示する (this page = all で冗長)', () => {
      expect(formatPageScopedCommentCount(3, 3, false)).toBe('3')
    })

    it('複数ページ文書では this page / all 形式で表示する', () => {
      expect(formatPageScopedCommentCount(1, 5, true)).toBe('1 / 5')
      expect(formatPageScopedCommentCount(0, 5, true)).toBe('0 / 5')
    })

    it('this page と all が等しい複数ページ文書でも N / M 形式で出す (一貫性優先)', () => {
      expect(formatPageScopedCommentCount(2, 2, true)).toBe('2 / 2')
    })
  })
}
