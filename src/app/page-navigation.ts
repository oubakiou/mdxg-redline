// 左サイドバー TOC (`<aside class="page-nav">`) の描画と click 配線。
// MDXG §7 Page Navigation [MUST] の 4 要件 (全ページ閲覧 / 任意ページ移動 / 現在ページ識別 /
// 逐次移動) のうち、本モジュールは前 3 つを担う (逐次移動 = Sequential Nav は Phase 3 で別途)。
//
// クリック時の navigateTo 動作は review.ts の orchestrator に注入する形にし、本モジュールは
// 「クリックされた slug を通知する」ところまでで責務を区切る (page-nav.ts ⇔ doc-renderer.ts
// 間の循環依存を避ける)。

import type { Page } from '../core/page-split'
import { escapeHtml } from '../core/escape'
import { state } from './app-state'

const PAGE_NAV_LIST_ID = 'page-nav-list'
const PAGE_NAV_ROOT_ID = 'page-nav'

interface PageItemViewModel {
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

/** Page → TOC li 1 行分の view model に正規化する */
export const toPageItemViewModel = (page: Page, activePageIndex: number): PageItemViewModel => {
  const isActive = page.index === activePageIndex
  return {
    ariaCurrentAttr: buildAriaCurrentAttr(isActive),
    depthClass: depthToClass(page.depth),
    itemClass: buildItemClass(isActive),
    slug: page.slug,
    title: page.title,
  }
}

const renderPageItem = (vm: PageItemViewModel): string =>
  `<li class="${vm.itemClass} ${vm.depthClass}">` +
  `<a class="page-nav-link" href="#${escapeHtml(vm.slug)}" data-slug="${escapeHtml(vm.slug)}"${vm.ariaCurrentAttr}>${escapeHtml(
    vm.title
  )}</a></li>`

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
  const items = state.pages
    .map((page): string => renderPageItem(toPageItemViewModel(page, state.activePageIndex)))
    .join('')
  list.innerHTML = `<ul class="page-nav-list">${items}</ul>`
}

interface PageNavigationWiring {
  onSlugClick: (slug: string) => void
}

const findClickedSlug = (event: MouseEvent): string | null => {
  if (!(event.target instanceof Element)) {
    return null
  }
  const link = event.target.closest('a.page-nav-link')
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
 * `#page-nav` 配下のリンククリックを delegated listener で拾い、`onSlugClick(slug)` を呼ぶ。
 * 標準の anchor クリックで location.hash も同時に更新される動線なので preventDefault は呼ばず、
 * orchestrator 側は「クリック直後の state 確定 → render」を担当する。
 *
 * 修飾キー (Ctrl / Cmd / Shift / middle click) の場合はネイティブの「新規タブで開く」等を尊重し、
 * onSlugClick を呼ばずに pass-through する。
 */
export const wirePageNavigation = (wiring: PageNavigationWiring): void => {
  const root = document.getElementById(PAGE_NAV_ROOT_ID)
  if (!(root instanceof HTMLElement)) {
    return
  }
  root.addEventListener('click', (event): void => {
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

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('toPageItemViewModel', () => {
    const basePage: Page = {
      depth: 1,
      headings: [],
      index: 0,
      markdown: '',
      slug: 'intro',
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
}
