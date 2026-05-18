import type { Comment } from './types'
import { escapeHTML } from './markdown'
import { smoothScrollToCenter } from './scroll'

export interface SidebarRuntime {
  qs: (selector: string) => HTMLElement
  reapplyAllMarks: () => void
  save: () => Promise<void>
  state: {
    comments: Comment[]
  }
  toast: (msg: string) => void
}

export interface SidebarController {
  activateMark: (mark: HTMLElement) => void
  render: () => void
}

interface WireCommentCardOptions {
  card: HTMLElement
  comment: Comment
  onDeleted: () => void
  runtime: SidebarRuntime
}

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

/** サイドバーのカードクリック時：本文側の mark をハイライトしつつ画面中央へスクロールさせる */
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
 * `escapeHTML` で quote / body を必ずエスケープすることが、ユーザー由来テキストを innerHTML に流す際の前提。
 */
const commentCardHTML = (comment: Comment): string => `
  <div class="cmt-quote">“${escapeHTML(comment.quote)}”</div>
  <div class="cmt-body">${escapeHTML(comment.comment)}</div>
  <div class="cmt-meta">
    <span>${comment.blockId} · ${new Date(comment.created).toLocaleString()}</span>
    <button class="cmt-del" data-del="${comment.id}">Delete</button>
  </div>`

/** コメントを 1 件削除して即座に保存・再描画。サイドバー側は呼び出し側が再描画する */
const deleteComment = async (runtime: SidebarRuntime, comment: Comment): Promise<void> => {
  runtime.state.comments = runtime.state.comments.filter(
    (other): boolean => other.id !== comment.id
  )
  await runtime.save()
  runtime.reapplyAllMarks()
}

/**
 * カードのクリック動作を配線する。
 * 削除ボタン押下は stopPropagation でカードクリック（フォーカス遷移）と切り分ける必要があり、これがバグの温床になりやすいため明示的にハンドラを分けている。
 */
const wireCommentCard = ({ card, comment, onDeleted, runtime }: WireCommentCardOptions): void => {
  card.addEventListener('click', (event): void => {
    const { target } = event
    if (target instanceof HTMLElement && target.dataset.del) {
      return
    }
    focusCommentCard(card, comment)
  })
  const delButton = card.querySelector('[data-del]')
  if (delButton) {
    delButton.addEventListener('click', async (event): Promise<void> => {
      event.stopPropagation()
      await deleteComment(runtime, comment)
      onDeleted()
      runtime.toast('Comment deleted')
    })
  }
}

/** 完成済みカード要素（HTML 描画＋イベント配線済み）を返すファクトリ */
const createCommentCard = (
  runtime: SidebarRuntime,
  comment: Comment,
  onDeleted: () => void
): HTMLDivElement => {
  const card = document.createElement('div')
  card.className = 'cmt-card'
  card.dataset.id = comment.id
  card.innerHTML = commentCardHTML(comment)
  wireCommentCard({ card, comment, onDeleted, runtime })
  return card
}

/** コメント 0 件時の案内表示 */
const showEmptySidebar = (list: HTMLElement): void => {
  list.innerHTML =
    '<div class="label" style="color: var(--ink-faint);">Select text in the file to add a review comment.</div>'
}

export const createSidebar = (runtime: SidebarRuntime): SidebarController => {
  /** サイドバー全体を再描画。コメントの追加・削除・読み込み後に呼ぶ単一エントリポイント */
  const render = (): void => {
    const list = runtime.qs('#cmt-list')
    runtime.qs('#cmt-count').textContent = String(runtime.state.comments.length)
    if (runtime.state.comments.length === 0) {
      showEmptySidebar(list)
      return
    }
    list.innerHTML = ''
    for (const comment of orderedComments(runtime.state.comments)) {
      list.appendChild(createCommentCard(runtime, comment, render))
    }
  }

  /** 本文側 mark のクリックで対応するサイドバーカードをアクティブ化＋画面中央へスクロール */
  const activateMark = (mark: HTMLElement): void => {
    const id = mark.dataset.commentId
    clearActiveComments()
    mark.classList.add('active')
    const card = document.querySelector(`.cmt-card[data-id="${id}"]`)
    if (card) {
      card.classList.add('active')
      smoothScrollToCenter(card)
    }
  }

  return { activateMark, render }
}

const commentForTest = (id: string): Comment => ({
  blockId: 'b001',
  comment: 'body',
  created: '2026-05-17T00:00:00.000Z',
  endOffset: 4,
  id,
  quote: 'text',
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
}
