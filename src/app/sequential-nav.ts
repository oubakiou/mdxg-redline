// 本文末尾の前 / 次ページリンク (MDXG §9 Sequential Navigation)。
// 最初のページでは Prev を、最後のページでは Next を DOM から省略する
// (§9.1 [MUST]: 適用できないコントロールは hidden or disabled。本実装は hidden 派)。
//
// page-navigation.ts と同じく、click は slug 通知に絞って review.ts の orchestrator に委ねる。

import type { Page } from '../core/page-split'
import { escapeHtml } from '../core/escape'
import { state } from './app-state'

const SEQUENTIAL_NAV_ID = 'sequential-nav'

interface SequentialNavViewModel {
  next: Page | null
  prev: Page | null
}

/**
 * activePageIndex の前後ページを Page | null として取り出す。
 * 最初 / 最後ページではそれぞれ null になり、render 側で omit する判断に使う。
 */
export const toSequentialNavViewModel = (
  pages: readonly Page[],
  activePageIndex: number
): SequentialNavViewModel => {
  const prev = pages[activePageIndex - 1]
  const next = pages[activePageIndex + 1]
  return {
    next: next ?? null,
    prev: prev ?? null,
  }
}

const renderPrevLink = (page: Page | null): string => {
  if (page === null) {
    return ''
  }
  return (
    `<a class="sequential-nav-link sequential-nav-prev" href="#${escapeHtml(page.slug)}" data-slug="${escapeHtml(page.slug)}" rel="prev">` +
    `<span class="sequential-nav-direction" aria-hidden="true">‹ Prev</span>` +
    `<span class="sequential-nav-title">${escapeHtml(page.title)}</span>` +
    `</a>`
  )
}

const renderNextLink = (page: Page | null): string => {
  if (page === null) {
    return ''
  }
  return (
    `<a class="sequential-nav-link sequential-nav-next" href="#${escapeHtml(page.slug)}" data-slug="${escapeHtml(page.slug)}" rel="next">` +
    `<span class="sequential-nav-direction" aria-hidden="true">Next ›</span>` +
    `<span class="sequential-nav-title">${escapeHtml(page.title)}</span>` +
    `</a>`
  )
}

/**
 * Sequential Nav の HTML 文字列を組み立てる pure 関数 (テスト容易化のため renderSequentialNav とは別出し)。
 * prev / next 両方 null (state.pages 空 / 単一ページ) なら空文字を返す。
 */
export const buildSequentialNavHtml = (viewModel: SequentialNavViewModel): string => {
  if (viewModel.prev === null && viewModel.next === null) {
    return ''
  }
  return renderPrevLink(viewModel.prev) + renderNextLink(viewModel.next)
}

const writeSequentialNavHtml = (nav: HTMLElement, html: string): void => {
  if (html === '') {
    nav.innerHTML = ''
    nav.hidden = true
    return
  }
  nav.hidden = false
  nav.innerHTML = html
}

/**
 * #sequential-nav の innerHTML を current state から書き直す。
 * - state.pages が空 or 単一ページのときは nav 全体を `hidden` 属性で隠す
 * - prev / next の片方しかない場合は片方だけが描画される
 */
export const renderSequentialNav = (): void => {
  const nav = document.getElementById(SEQUENTIAL_NAV_ID)
  if (!(nav instanceof HTMLElement)) {
    return
  }
  const viewModel = toSequentialNavViewModel(state.pages, state.activePageIndex)
  writeSequentialNavHtml(nav, buildSequentialNavHtml(viewModel))
}

interface SequentialNavWiring {
  onSlugClick: (slug: string) => void
}

const findClickedSlug = (event: MouseEvent): string | null => {
  if (!(event.target instanceof Element)) {
    return null
  }
  const link = event.target.closest('a.sequential-nav-link')
  if (!(link instanceof HTMLAnchorElement)) {
    return null
  }
  const { slug } = link.dataset
  if (!slug) {
    return null
  }
  return slug
}

/**
 * #sequential-nav 内のクリックを delegated listener で拾う。
 * 修飾キー / middle click はネイティブ動作 (新規タブ等) を尊重して pass-through する
 * (page-navigation.ts と同じ pattern)。
 */
export const wireSequentialNav = (wiring: SequentialNavWiring): void => {
  const nav = document.getElementById(SEQUENTIAL_NAV_ID)
  if (!(nav instanceof HTMLElement)) {
    return
  }
  nav.addEventListener('click', (event): void => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
      return
    }
    const slug = findClickedSlug(event)
    if (slug === null) {
      return
    }
    wiring.onSlugClick(slug)
  })
}

// テスト用ダミー Page (in-source test 内でも outer scope に置く既存 pattern)
const dummyPage = (overrides: Partial<Page> = {}): Page => ({
  ancestorHeadingPath: [],
  depth: 1,
  headings: [],
  index: 0,
  markdown: '',
  slug: 'page',
  sourceLineEnd: 1,
  sourceLineStart: 1,
  title: 'Page',
  ...overrides,
})

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('toSequentialNavViewModel', () => {
    it('中間ページでは前後どちらも返す', () => {
      const pages = [
        dummyPage({ index: 0, slug: 'a', title: 'A' }),
        dummyPage({ index: 1, slug: 'b', title: 'B' }),
        dummyPage({ index: 2, slug: 'c', title: 'C' }),
      ]
      const vm = toSequentialNavViewModel(pages, 1)
      expect(vm.prev && vm.prev.title).toBe('A')
      expect(vm.next && vm.next.title).toBe('C')
    })

    it('最初ページでは prev が null (§9.1 [MUST] Prev hidden の根拠)', () => {
      const pages = [dummyPage({ index: 0, slug: 'a' }), dummyPage({ index: 1, slug: 'b' })]
      const vm = toSequentialNavViewModel(pages, 0)
      expect(vm.prev).toBeNull()
      expect(vm.next).not.toBeNull()
    })

    it('最後ページでは next が null (§9.1 [MUST] Next hidden の根拠)', () => {
      const pages = [dummyPage({ index: 0, slug: 'a' }), dummyPage({ index: 1, slug: 'b' })]
      const vm = toSequentialNavViewModel(pages, 1)
      expect(vm.prev).not.toBeNull()
      expect(vm.next).toBeNull()
    })

    it('単一ページでは prev / next 両方 null', () => {
      const pages = [dummyPage({ index: 0, slug: 'a' })]
      const vm = toSequentialNavViewModel(pages, 0)
      expect(vm.prev).toBeNull()
      expect(vm.next).toBeNull()
    })

    it('空 pages では prev / next 両方 null', () => {
      const vm = toSequentialNavViewModel([], 0)
      expect(vm.prev).toBeNull()
      expect(vm.next).toBeNull()
    })
  })

  describe('buildSequentialNavHtml', () => {
    it('prev / next 両方ある場合は両方のリンクが含まれる', () => {
      const html = buildSequentialNavHtml({
        next: dummyPage({ slug: 'next-page', title: 'Next Page' }),
        prev: dummyPage({ slug: 'prev-page', title: 'Prev Page' }),
      })
      expect(html).toContain('href="#prev-page"')
      expect(html).toContain('href="#next-page"')
      expect(html).toContain('>Prev Page<')
      expect(html).toContain('>Next Page<')
      expect(html).toContain('sequential-nav-prev')
      expect(html).toContain('sequential-nav-next')
    })

    it('prev のみのときは Prev リンクだけ出る', () => {
      const html = buildSequentialNavHtml({
        next: null,
        prev: dummyPage({ slug: 'prev', title: 'Prev' }),
      })
      expect(html).toContain('sequential-nav-prev')
      expect(html).not.toContain('sequential-nav-next')
    })

    it('next のみのときは Next リンクだけ出る', () => {
      const html = buildSequentialNavHtml({
        next: dummyPage({ slug: 'next', title: 'Next' }),
        prev: null,
      })
      expect(html).toContain('sequential-nav-next')
      expect(html).not.toContain('sequential-nav-prev')
    })

    it('両方 null なら空文字 (nav 全体を隠す根拠)', () => {
      expect(buildSequentialNavHtml({ next: null, prev: null })).toBe('')
    })

    it('title に含まれる " / & / < は HTML escape される', () => {
      const html = buildSequentialNavHtml({
        next: null,
        prev: dummyPage({ slug: 'safe-slug', title: 'A & B "x" <y>' }),
      })
      expect(html).toContain('A &amp; B &quot;x&quot; &lt;y&gt;')
      expect(html).not.toContain('A & B "x" <y>')
    })

    it('slug 自体も escape される (属性インジェクション防止)', () => {
      const html = buildSequentialNavHtml({
        next: null,
        prev: dummyPage({ slug: 'a"onmouseover="alert(1)', title: 'X' }),
      })
      expect(html).not.toContain('onmouseover="alert(1)"')
      expect(html).toContain('&quot;')
    })
  })
}
