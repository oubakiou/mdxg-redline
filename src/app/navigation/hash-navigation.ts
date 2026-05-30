// hashchange / 脚注 anchor クリックの routing。
// `#p:<slug>` 形式 (page hash) と `#footnote(-ref)?-<id>` 形式 (脚注 hash) を別系統に
// 分離し、いずれにも該当しない anchor はブラウザのデフォルト挙動に任せる。

import { isPageHash, resolveTargetFromHash } from '../document/pages'
import { navigateToTarget } from './navigation-orchestrator'

// `#footnote-<id>` / `#footnote-ref-<id>` / `#footnote-ref-<id>-<n>` のいずれかを判定する。
// hash prefix で構造的に分離することで、`#p:<slug>` 経路 (page slug) と footnote 経路を別系統に
// 切り出す (docs/mdxg-footnotes.md §3.3 / §5.j)。
const FOOTNOTE_HASH_RE = /^#footnote(-ref)?-/u

const resolveFootnotePageIndex = (el: HTMLElement): number | null => {
  const section = el.closest<HTMLElement>('section.virtual-page')
  if (section === null) {
    return null
  }
  const pageIndex = Number(section.dataset.pageIndex)
  if (!Number.isInteger(pageIndex)) {
    return null
  }
  return pageIndex
}

const focusFootnoteTarget = (el: HTMLElement, pageIndex: number): void => {
  navigateToTarget({ headingSlug: null, pageIndex }, false)
  el.scrollIntoView({ behavior: 'auto', block: 'center' })
  el.focus({ preventScroll: true })
}

/**
 * 脚注 anchor (`<a data-footnote-ref>` / `<a data-footnote-backref>`) クリック / hashchange の
 * 専用 handler。対応する DOM 要素を含む virtual-page section の `data-page-index` を読み取って
 * `navigateToTarget` 経由で page を active 化し、要素に scroll + focus する。
 * - footnote hash でなければ false (呼び出し側はそのまま次の page-hash 経路に流す)
 * - 該当 ID が DOM に無い (orphan の backref など) は false (default の anchor scroll に任せる)
 */
const handleFootnoteHash = (hash: string): boolean => {
  if (!FOOTNOTE_HASH_RE.test(hash)) {
    return false
  }
  const el = document.getElementById(hash.slice(1))
  if (el === null) {
    return false
  }
  const pageIndex = resolveFootnotePageIndex(el)
  if (pageIndex === null) {
    return false
  }
  focusFootnoteTarget(el, pageIndex)
  return true
}

/**
 * ブラウザの戻る / 進む or 直接 URL 編集経由の hash 変更を navigate に流す。
 * `#p:` で名前空間化された page hash と footnote hash の 2 経路に分岐し、いずれにも該当しない
 * 本文内 anchor (`[x](#some-heading)`) はブラウザのデフォルト anchor scroll に任せる。
 * 同一 hash での footnote 再クリックは hashchange が発火しないため、click delegate でも
 * 同経路に流す (docs/mdxg-footnotes.md §3.3)。
 */
export const setupHashNavigation = (): void => {
  globalThis.addEventListener('hashchange', (): void => {
    const { hash } = globalThis.location
    if (handleFootnoteHash(hash)) {
      return
    }
    if (!isPageHash(hash)) {
      return
    }
    navigateToTarget(resolveTargetFromHash(hash), false)
  })

  document.addEventListener('click', (event): void => {
    if (!(event.target instanceof Element)) {
      return
    }
    const link = event.target.closest<HTMLAnchorElement>(
      'a[data-footnote-ref], a[data-footnote-backref]'
    )
    if (link === null) {
      return
    }
    const href = link.getAttribute('href')
    if (href !== null) {
      handleFootnoteHash(href)
    }
  })
}
