// 左サイドバー TOC (`<aside class="page-nav">`) の render 層。
// ViewModel 変換と HTML 文字列生成、`renderPageNavigation` (DOM への流し込み) を担う。
// MDXG §7 Page Navigation [MUST] + §8 Page Outline + §9 Sequential Navigation 由来の
// 描画責務をここに集約し、click delegation / keyboard focus は page-navigation*.ts に分離している。

import type { Heading } from '../../core/page-outline'
import type { Page } from '../../core/page-split'
import { buildPageHashFragment } from '../document/pages'
import { escapeHtml } from '../../core/escape'
import { state } from '../state/app-state'
import { translate } from '../i18n/i18n-browser'

interface SequentialControlsViewModel {
  next: Page | null
  prev: Page | null
}

/**
 * activePageIndex の前後ページを Page | null として取り出す。最初 / 最後ページではそれぞれ
 * null になり、render 側で omit する判断に使う (MDXG §9.1 [MUST]: 適用できないコントロールは
 * hidden 派)。
 */
export const toSequentialControlsViewModel = (
  pages: readonly Page[],
  activePageIndex: number
): SequentialControlsViewModel => {
  const prev = pages[activePageIndex - 1]
  const next = pages[activePageIndex + 1]
  return {
    next: next ?? null,
    prev: prev ?? null,
  }
}

const renderSequentialPrev = (page: Page | null): string => {
  if (page === null) {
    return ''
  }
  const fragment = escapeHtml(buildPageHashFragment(page.slug))
  const label = escapeHtml(translate('page_nav.prev_button'))
  return (
    `<a class="page-nav-sequential-link page-nav-sequential-prev" href="#${fragment}" data-slug="${fragment}" rel="prev">` +
    `<span class="page-nav-sequential-direction" aria-hidden="true">${label}</span>` +
    `<span class="page-nav-sequential-title">${escapeHtml(page.title)}</span>` +
    `</a>`
  )
}

const renderSequentialNext = (page: Page | null): string => {
  if (page === null) {
    return ''
  }
  const fragment = escapeHtml(buildPageHashFragment(page.slug))
  const label = escapeHtml(translate('page_nav.next_button'))
  return (
    `<a class="page-nav-sequential-link page-nav-sequential-next" href="#${fragment}" data-slug="${fragment}" rel="next">` +
    `<span class="page-nav-sequential-direction" aria-hidden="true">${label}</span>` +
    `<span class="page-nav-sequential-title">${escapeHtml(page.title)}</span>` +
    `</a>`
  )
}

/**
 * TOC 上部に置く Prev/Next row の HTML を組み立てる。prev / next 両方 null (空 / 単一ページ) なら
 * 空文字を返し、caller 側で row 自体を出さない。
 */
export const buildSequentialControlsHtml = (viewModel: SequentialControlsViewModel): string => {
  if (viewModel.prev === null && viewModel.next === null) {
    return ''
  }
  const navLabel = escapeHtml(translate('page_nav.sequential_nav_aria'))
  return `<nav class="page-nav-sequential" aria-label="${navLabel}">${renderSequentialPrev(
    viewModel.prev
  )}${renderSequentialNext(viewModel.next)}</nav>`
}

const PAGE_NAV_LIST_ID = 'page-nav-list'

// pure data 層: presentational に依存しない Page の View 表現。
// active 判定 (`isActive`) と originate field (`depth` / `slug` / `title`) のみを持つため、
// テストや別 presentation (例: A11y tree / debug view) の出発点としても再利用しやすい。
interface PageItemView {
  isActive: boolean
  depth: 1 | 2
  slug: string
  title: string
}

// presentational 層: CSS class 文字列・ARIA 属性文字列など、HTML 出力直前の装飾値。
// pure data 層との分離により「class 命名規約の変更」を 1 関数 (`toPageItemPresentational`)
// に閉じ込められる。
interface PageItemPresentational {
  ariaCurrentAttr: string
  depthClass: string
  itemClass: string
  slug: string
  title: string
}

const depthToClass = (depth: 1 | 2): string => {
  if (depth === 1) {
    return 'page-nav-item-depth-1'
  }
  return 'page-nav-item-depth-2'
}

const buildItemClass = (isActive: boolean): string => {
  if (isActive) {
    return 'page-nav-item page-nav-item-active'
  }
  return 'page-nav-item'
}

const buildAriaCurrentAttr = (isActive: boolean): string => {
  if (isActive) {
    return ' aria-current="page"'
  }
  return ''
}

/** Page → pure data 層の View に正規化する (CSS 装飾を含まない)。 */
export const toPageItemView = (page: Page, activePageIndex: number): PageItemView => ({
  depth: page.depth,
  isActive: page.index === activePageIndex,
  slug: page.slug,
  title: page.title,
})

/** pure data 層の View → CSS 装飾付き presentational に変換する。 */
const toPageItemPresentational = (view: PageItemView): PageItemPresentational => ({
  ariaCurrentAttr: buildAriaCurrentAttr(view.isActive),
  depthClass: depthToClass(view.depth),
  itemClass: buildItemClass(view.isActive),
  slug: view.slug,
  title: view.title,
})

/**
 * Page → TOC li 1 行分の presentational ViewModel に正規化する。
 * 内部では `toPageItemView` (pure) → `toPageItemPresentational` (CSS 装飾) の 2 段パイプライン。
 */
export const toPageItemViewModel = (page: Page, activePageIndex: number): PageItemPresentational =>
  toPageItemPresentational(toPageItemView(page, activePageIndex))

const renderOutlineHeading = (pageSlug: string, heading: Heading): string => {
  const fragment = escapeHtml(buildPageHashFragment(pageSlug, heading.slug))
  const levelClass = `page-outline-link-level-${heading.level}`
  return (
    `<li class="page-outline-item">` +
    `<a class="page-outline-link ${levelClass}" href="#${fragment}" data-slug="${fragment}" data-heading-slug="${escapeHtml(heading.slug)}">${escapeHtml(heading.text)}</a>` +
    `</li>`
  )
}

/**
 * active page の H3–H6 outline を `<ul>` として描画する。
 * H3–H6 が無いページでは空文字を返し、caller 側で outline 自体を出さない (MDXG §8 [MAY])。
 */
export const renderOutlineList = (page: Page): string => {
  if (page.headings.length === 0) {
    return ''
  }
  const items = page.headings
    .map((heading): string => renderOutlineHeading(page.slug, heading))
    .join('')
  return `<ul class="page-outline-list">${items}</ul>`
}

const renderPageItem = (vm: PageItemPresentational, outlineHtml: string): string => {
  const fragment = escapeHtml(buildPageHashFragment(vm.slug))
  return (
    `<li class="${vm.itemClass} ${vm.depthClass}">` +
    `<a class="page-nav-link" href="#${fragment}" data-slug="${fragment}"${vm.ariaCurrentAttr}>${escapeHtml(vm.title)}</a>${
      outlineHtml
    }</li>`
  )
}

// outline は active page のみ展開 (DESIGN.md §12 §8 Page Outline inline 展開方針)。
// no-ternary を満たすため if 文で分岐する。
const resolveOutlineHtml = (page: Page, activePageIndex: number): string => {
  if (page.index !== activePageIndex) {
    return ''
  }
  return renderOutlineList(page)
}

const renderPageWithOutline = (page: Page, activePageIndex: number): string => {
  const vm = toPageItemViewModel(page, activePageIndex)
  return renderPageItem(vm, resolveOutlineHtml(page, activePageIndex))
}

const buildPageNavBodyHtml = (pages: readonly Page[], activePageIndex: number): string => {
  const sequentialHtml = buildSequentialControlsHtml(
    toSequentialControlsViewModel(pages, activePageIndex)
  )
  const items = pages.map((page): string => renderPageWithOutline(page, activePageIndex)).join('')
  return `${sequentialHtml}<ul class="page-nav-list">${items}</ul>`
}

/**
 * `state.pages` を TOC として描画する。`html.has-pages` クラスを toggle して
 * 「ページ未確定時は page-nav 列を消す」CSS layout を切り替える (styles/review.css 側で `:root.has-pages` を分岐)。
 */
export const renderPageNavigation = (): void => {
  const root = document.documentElement
  const list = document.getElementById(PAGE_NAV_LIST_ID)
  root.classList.toggle('has-pages', state.pages.length > 0)
  if (!(list instanceof HTMLElement)) {
    return
  }
  if (state.pages.length === 0) {
    list.innerHTML = ''
    return
  }
  list.innerHTML = buildPageNavBodyHtml(state.pages, state.activePageIndex)
}

// テスト用 fixture。consistent-function-scoping ルールで module-level に置く
// (vitest gate 外でも参照されない静的関数。production には影響しない)。
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

  describe('toPageItemView (pure data 層)', () => {
    const basePage: Page = {
      ancestorHeadingPath: [],
      depth: 1,
      headings: [],
      index: 2,
      markdown: '',
      slug: 'pure',
      sourceLineEnd: 1,
      sourceLineStart: 1,
      title: 'Pure',
    }

    it('active 判定 / depth / slug / title を CSS 装飾なしで返す', () => {
      expect(toPageItemView(basePage, 2)).toEqual({
        depth: 1,
        isActive: true,
        slug: 'pure',
        title: 'Pure',
      })
    })

    it('activePageIndex が違えば isActive=false', () => {
      const view = toPageItemView(basePage, 5)
      expect(view.isActive).toBe(false)
    })
  })

  describe('toPageItemViewModel', () => {
    const basePage: Page = {
      ancestorHeadingPath: [],
      depth: 1,
      headings: [],
      index: 0,
      markdown: '',
      slug: 'intro',
      sourceLineEnd: 1,
      sourceLineStart: 1,
      title: 'Intro',
    }

    it('depth 1 → page-nav-item-depth-1', () => {
      const vm = toPageItemViewModel(basePage, 5)
      expect(vm.depthClass).toBe('page-nav-item-depth-1')
    })

    it('depth 2 → page-nav-item-depth-2', () => {
      const vm = toPageItemViewModel({ ...basePage, depth: 2 }, 5)
      expect(vm.depthClass).toBe('page-nav-item-depth-2')
    })

    it('active page には aria-current="page" と active class を付ける', () => {
      const vm = toPageItemViewModel(basePage, 0)
      expect(vm.ariaCurrentAttr).toBe(' aria-current="page"')
      expect(vm.itemClass).toContain('page-nav-item-active')
    })

    it('非 active page は aria-current 無し / active class 無し', () => {
      const vm = toPageItemViewModel(basePage, 1)
      expect(vm.ariaCurrentAttr).toBe('')
      expect(vm.itemClass).toBe('page-nav-item')
    })
  })

  describe('renderOutlineList (Phase 4 §8.3 inline outline)', () => {
    const basePage: Page = {
      ancestorHeadingPath: [],
      depth: 1,
      headings: [],
      index: 0,
      markdown: '',
      slug: 'overview',
      sourceLineEnd: 1,
      sourceLineStart: 1,
      title: 'Overview',
    }

    it('H3–H6 が無いページでは空文字を返す (MDXG §8 [MAY] 非表示の根拠)', () => {
      expect(renderOutlineList(basePage)).toBe('')
    })

    it('H3 を含むページは <ul class="page-outline-list"> を返す', () => {
      const html = renderOutlineList({
        ...basePage,
        headings: [
          { level: 3, slug: 'intro', sourceLineOffset: 2, text: 'Intro' },
          { level: 4, slug: 'detail', sourceLineOffset: 4, text: 'Detail' },
        ],
      })
      expect(html).toContain('<ul class="page-outline-list">')
      expect(html).toContain('page-outline-link-level-3')
      expect(html).toContain('page-outline-link-level-4')
    })

    it('outline link の href / data-slug は p: prefix + composite (`p:<page>__<heading>`) 形式', () => {
      const html = renderOutlineList({
        ...basePage,
        headings: [{ level: 3, slug: 'intro', sourceLineOffset: 2, text: 'Intro' }],
      })
      expect(html).toContain('href="#p:overview__intro"')
      expect(html).toContain('data-slug="p:overview__intro"')
      expect(html).toContain('data-heading-slug="intro"')
    })

    it('heading text に含まれる < / & / " は HTML escape される', () => {
      const html = renderOutlineList({
        ...basePage,
        headings: [{ level: 3, slug: 'safe', sourceLineOffset: 0, text: 'a & b <x>' }],
      })
      expect(html).toContain('a &amp; b &lt;x&gt;')
      expect(html).not.toContain('<x>')
    })
  })

  describe('toSequentialControlsViewModel (MDXG §9 統合)', () => {
    it('中間ページでは前後どちらも返す', () => {
      const pages = [
        dummyPage({ index: 0, slug: 'a', title: 'A' }),
        dummyPage({ index: 1, slug: 'b', title: 'B' }),
        dummyPage({ index: 2, slug: 'c', title: 'C' }),
      ]
      const vm = toSequentialControlsViewModel(pages, 1)
      expect(vm.prev && vm.prev.title).toBe('A')
      expect(vm.next && vm.next.title).toBe('C')
    })

    it('最初ページでは prev が null (§9.1 [MUST] Prev hidden の根拠)', () => {
      const pages = [dummyPage({ index: 0, slug: 'a' }), dummyPage({ index: 1, slug: 'b' })]
      const vm = toSequentialControlsViewModel(pages, 0)
      expect(vm.prev).toBeNull()
      expect(vm.next).not.toBeNull()
    })

    it('最後ページでは next が null (§9.1 [MUST] Next hidden の根拠)', () => {
      const pages = [dummyPage({ index: 0, slug: 'a' }), dummyPage({ index: 1, slug: 'b' })]
      const vm = toSequentialControlsViewModel(pages, 1)
      expect(vm.prev).not.toBeNull()
      expect(vm.next).toBeNull()
    })

    it('単一ページでは prev / next 両方 null', () => {
      const vm = toSequentialControlsViewModel([dummyPage({ index: 0, slug: 'a' })], 0)
      expect(vm.prev).toBeNull()
      expect(vm.next).toBeNull()
    })
  })

  describe('buildSequentialControlsHtml (MDXG §9 統合)', () => {
    it('prev / next 両方ある場合は両方のリンクと nav 要素を含む (href は p: prefix)', () => {
      const html = buildSequentialControlsHtml({
        next: dummyPage({ slug: 'next-page', title: 'Next Page' }),
        prev: dummyPage({ slug: 'prev-page', title: 'Prev Page' }),
      })
      expect(html).toContain('<nav class="page-nav-sequential"')
      expect(html).toContain('href="#p:prev-page"')
      expect(html).toContain('href="#p:next-page"')
      expect(html).toContain('page-nav-sequential-prev')
      expect(html).toContain('page-nav-sequential-next')
    })

    it('片方のみのときはそのリンクだけ出る', () => {
      const html = buildSequentialControlsHtml({
        next: null,
        prev: dummyPage({ slug: 'prev', title: 'Prev' }),
      })
      expect(html).toContain('page-nav-sequential-prev')
      expect(html).not.toContain('page-nav-sequential-next')
    })

    it('両方 null なら空文字 (row 自体を出さない)', () => {
      expect(buildSequentialControlsHtml({ next: null, prev: null })).toBe('')
    })

    it('title / slug は HTML escape される (属性インジェクション防止)', () => {
      const html = buildSequentialControlsHtml({
        next: null,
        prev: dummyPage({ slug: 'a"onmouseover="alert(1)', title: 'A & B <x>' }),
      })
      expect(html).toContain('A &amp; B &lt;x&gt;')
      expect(html).not.toContain('onmouseover="alert(1)"')
      expect(html).toContain('&quot;')
    })
  })
}
