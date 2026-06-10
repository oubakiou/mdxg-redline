// Comment 1 件分のカード HTML 文字列を組み立てる pure builder 群。
// ユーザー由来テキスト (quote / body / page title) は必ず escapeHtml を通すことが、
// innerHTML への書き戻し経路の信頼境界。DOM 操作・event 配線は comments.ts 側の責務。
//
// state.pages の参照は「pageBadgeHTML が複数ページ文書だけバッジを出す」要件のため避けられず、
// pure な関数ではないが副作用 (mutation / DOM 操作) は無く決定論的。

import type { Comment } from '../../core/types'
import type { Page } from '../../core/page-split'
import { escapeHtml } from '../../core/escape'
import { state } from '../state/app-state'
import { translate } from '../i18n/i18n-browser'

/**
 * 複数ページ文書の comments panel が全コメントを混ぜて表示する際、各カードがどのページに属するかを
 * 識別できるよう meta 行先頭にページタイトルバッジを付ける。単一ページ文書では冗長なため空文字を返す。
 */
export const pageBadgeHTML = (comment: Comment): string => {
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
 * カード 1 枚分の HTML を生成。`escapeHtml` で quote / body を必ずエスケープすることが、
 * ユーザー由来テキストを innerHTML に流す際の前提。
 */
export const commentCardHTML = (comment: Comment): string => {
  // 辞書値を innerHTML 経由に流す前に escapeHtml で防御層を 1 段はさむ (§11 信頼境界)。
  const editAriaLabel = escapeHtml(translate('comments.action_edit_aria'))
  const editLabel = escapeHtml(translate('comments.action_edit'))
  const deleteAriaLabel = escapeHtml(translate('comments.action_delete_aria'))
  const deleteLabel = escapeHtml(translate('comments.action_delete'))
  return `
  <div class="cmt-quote">“${escapeHtml(comment.quote)}”</div>
  <div class="cmt-body">${escapeHtml(comment.comment)}</div>
  <div class="cmt-meta">
    <span>${pageBadgeHTML(comment)}${comment.blockId} · ${new Date(comment.created).toLocaleString()}</span>
    <span class="cmt-actions">
      <button class="cmt-edit" data-edit="${comment.id}" aria-label="${editAriaLabel}">${editLabel}</button>
      <button class="cmt-del" data-del="${comment.id}" aria-label="${deleteAriaLabel}">${deleteLabel}</button>
    </span>
  </div>`
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

const buildPageForTest = (index: number, title: string): Page => ({
  ancestorHeadingPath: [],
  depth: 1,
  headings: [],
  index,
  markdown: '',
  slug: `page-${index}`,
  sourceLineEnd: 1,
  sourceLineStart: 1,
  title,
})

const withStatePages = <Result>(pages: Page[], body: () => Result): Result => {
  const prev = state.pages
  state.pages = pages
  try {
    return body()
  } finally {
    state.pages = prev
  }
}

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

  describe('pageBadgeHTML', () => {
    it('単一ページ文書では空文字 (バッジを出さない)', () => {
      withStatePages([buildPageForTest(0, 'Only Page')], (): void => {
        expect(pageBadgeHTML(commentForTest('c1'))).toBe('')
      })
    })

    it('複数ページ文書では cmt-page-badge span を返す', () => {
      withStatePages([buildPageForTest(0, 'Intro'), buildPageForTest(1, 'Body')], (): void => {
        const badge = pageBadgeHTML({ ...commentForTest('c1'), pageIndex: 1 })
        expect(badge).toContain('<span class="cmt-page-badge">Body</span>')
        expect(badge.endsWith(' · ')).toBe(true)
      })
    })

    it('ページタイトルを HTML エスケープする (XSS 防御)', () => {
      withStatePages(
        [buildPageForTest(0, 'Intro'), buildPageForTest(1, '<img src=x onerror=1> & "quoted"')],
        (): void => {
          const badge = pageBadgeHTML({ ...commentForTest('c1'), pageIndex: 1 })
          expect(badge).toContain('&lt;img src=x onerror=1&gt; &amp; &quot;quoted&quot;')
          expect(badge).not.toContain('<img')
        }
      )
    })

    it('pageIndex が範囲外なら空文字 (fail-soft)', () => {
      withStatePages([buildPageForTest(0, 'P0'), buildPageForTest(1, 'P1')], (): void => {
        expect(pageBadgeHTML({ ...commentForTest('c1'), pageIndex: 99 })).toBe('')
      })
    })
  })
}
