// 左サイドバー TOC の keyboard focus 管理。
// MDXG §13 [MUST] 矢印キーのフォーカス移動 + §13 [SHOULD] navigate 後の TOC link フォーカス復帰。
// click delegation / 描画は page-navigation.ts / page-navigation-render.ts に分離している。

import { buildPageHashFragment } from '../document/pages'
import { resolveNextFocusIndex } from '../dom/focus-list'

// page-nav 配下で focusable と扱うリンクは 3 種類:
//   - a.page-nav-link: page entry 自体への遷移 (data-slug は `<page-slug>`)
//   - a.page-outline-link: active page の H3–H6 outline (data-slug は `<page-slug>__<heading-slug>`)
//   - a.page-nav-sequential-link: TOC 上部の Prev / Next row
// facade 側の click delegation でも同じ selector を使うため export している。
export const FOCUSABLE_LINK_SELECTOR =
  'a.page-nav-link, a.page-outline-link, a.page-nav-sequential-link'

export const PAGE_NAV_ROOT_ID = 'page-nav'

const queryFocusableLinks = (root: HTMLElement): HTMLAnchorElement[] => [
  ...root.querySelectorAll<HTMLAnchorElement>(FOCUSABLE_LINK_SELECTOR),
]

const directionFromKey = (key: string): 'down' | 'up' | 'home' | 'end' | null => {
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

/**
 * `links[nextIndex]` にフォーカスを移す。link は全て tabindex なし (デフォルト 0) で tab order
 * に乗っているため、tabindex の付け替えは行わず focus() のみ呼ぶ。`nextIndex` が範囲外なら
 * 何もしない (resolveNextFocusIndex が両端で clamp + 空リストで -1 を返すケースのフォールバック)。
 */
const focusLinkAtIndex = (links: readonly HTMLAnchorElement[], nextIndex: number): void => {
  const target = links[nextIndex]
  if (!target) {
    return
  }
  target.focus()
}

const buildFocusSelector = (pageSlug: string, headingSlug: string | null): string => {
  const fragment = buildPageHashFragment(pageSlug, headingSlug)
  if (headingSlug === null) {
    return `a.page-nav-link[data-slug="${CSS.escape(fragment)}"]`
  }
  return `a.page-outline-link[data-slug="${CSS.escape(fragment)}"]`
}

const focusTargetInRoot = (root: HTMLElement, target: HTMLAnchorElement): void => {
  const links = queryFocusableLinks(root)
  const index = links.indexOf(target)
  if (index === -1) {
    return
  }
  focusLinkAtIndex(links, index)
}

/**
 * navigate 後に「対象の TOC link」にフォーカスを移す。キーボード由来の Enter で navigate した時
 * 限定で呼ぶ (click 由来やスクロールスパイ由来でフォーカスを奪うと UX が崩れるため、§13 [SHOULD])。
 *
 * 対象解決ルール:
 *   - heading 指定あり: 該当 page 配下の outline link を `[data-slug]` で一致検索
 *   - heading 指定なし: active page の page-nav-link を `[data-slug]` で一致検索
 * 該当が見つからなければ何もしない (page が消えた等の race を許容)。
 */
export const focusNavigatedLink = (pageSlug: string, headingSlug: string | null): void => {
  const root = document.getElementById(PAGE_NAV_ROOT_ID)
  if (!(root instanceof HTMLElement)) {
    return
  }
  const target = root.querySelector<HTMLAnchorElement>(buildFocusSelector(pageSlug, headingSlug))
  if (target === null) {
    return
  }
  focusTargetInRoot(root, target)
}

const resolveCurrentFocusableLink = (target: EventTarget | null): HTMLAnchorElement | null => {
  if (!(target instanceof Element)) {
    return null
  }
  const link = target.closest(FOCUSABLE_LINK_SELECTOR)
  if (!(link instanceof HTMLAnchorElement)) {
    return null
  }
  return link
}

interface KeyDownContext {
  current: HTMLAnchorElement
  direction: 'down' | 'up' | 'home' | 'end'
}

const resolveKeyDownContext = (event: KeyboardEvent): KeyDownContext | null => {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
    return null
  }
  const direction = directionFromKey(event.key)
  if (direction === null) {
    return null
  }
  const current = resolveCurrentFocusableLink(event.target)
  if (current === null) {
    return null
  }
  return { current, direction }
}

/**
 * ↑/↓/Home/End で TOC 内の focusable link 群を巡回する keydown delegate。
 * link 自体は全て tab order に乗っているので Tab でも順次巡回できる (矢印キーは追加の便宜)。
 * Enter は `<a>` の標準挙動でブラウザが synthetic click を fire し既存 click delegate が拾うため
 * 別途キーハンドラを書かない (§13 [MUST])。
 */
export const onPageNavKeyDown = (root: HTMLElement, event: KeyboardEvent): void => {
  const ctx = resolveKeyDownContext(event)
  if (ctx === null) {
    return
  }
  event.preventDefault()
  const links = queryFocusableLinks(root)
  const nextIndex = resolveNextFocusIndex(links.length, links.indexOf(ctx.current), ctx.direction)
  focusLinkAtIndex(links, nextIndex)
}
