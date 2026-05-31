// 左サイドバー TOC (`<aside class="page-nav">`) の click delegation + wiring entry。
// render は page-navigation-render.ts、keyboard focus は page-navigation-keyboard.ts に分離し、
// 本ファイルは wirePageNavigation のみを公開する。
//
// クリック時の navigateTo 動作は review.ts の orchestrator に注入する形にし、本モジュールは
// 「クリックされた slug を通知する」ところまでで責務を区切る (page-nav.ts ⇔ doc-renderer.ts
// 間の循環依存を避ける)。outline link の data-slug は `<page-slug>__<heading-slug>` 形式の
// composite slug で、orchestrator 側で parseHash → navigateToTarget に渡される。

import {
  FOCUSABLE_LINK_SELECTOR,
  PAGE_NAV_ROOT_ID,
  onPageNavKeyDown,
} from './page-navigation-keyboard'

interface PageNavigationWiring {
  /**
   * `keyboardActivated=true` は `MouseEvent.detail === 0` で識別したキーボード由来の Enter (`<a>`
   * 標準挙動でブラウザが synthetic click を fire する) を指す。caller は navigate 後に TOC の
   * 該当 link へフォーカスを戻すかの判断にこれを使う (§13 [SHOULD] フォーカス管理)。
   */
  onSlugClick: (slug: string, keyboardActivated: boolean) => void
}

// click delegated handler が拾うリンクは FOCUSABLE_LINK_SELECTOR の 3 種類。全て data-slug を持ち、
// callback には composite slug 形式で渡すため共通化できる。outline を selector に含めないと、
// 同一 hash クリック時 (= 既に active な heading の outline link をもう一度押した時) に
// hashchange が発火せず即時 navigate も走らないため反応無しになる。
const findClickedSlug = (event: MouseEvent): string | null => {
  if (!(event.target instanceof Element)) {
    return null
  }
  const link = event.target.closest(FOCUSABLE_LINK_SELECTOR)
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
 * `#page-nav` 配下のリンククリックを delegated listener で拾い、`onSlugClick(slug, keyboardActivated)`
 * を呼ぶ。通常クリック時は `event.preventDefault()` でブラウザのデフォルト anchor 遷移を抑止する。
 * `href="#p:overview"` に対してブラウザは `id="p:overview"` 要素を探しに行くが、Stacked View では
 * heading id (`<h4 id="1">` 等) が page slug と短絡的に一致する事故が起きうるため
 * (`#1` → `id="1"` を持つ別 page 配下の見出しにジャンプ)、page slug を `p:` で名前空間化したのと
 * 二重防御として preventDefault も入れる。URL hash の更新は `navigateToTarget` 側で
 * `syncHashFromActivePage` 経由で行う。
 *
 * 修飾キー (Ctrl / Cmd / Shift / middle click) の場合はネイティブの「新規タブで開く」等を尊重し、
 * preventDefault せず onSlugClick も呼ばずに pass-through する。
 *
 * keydown handler は ↑/↓/Home/End で TOC 内の focusable link 群を巡回する (§13 [MUST] 矢印キー)。
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
    event.preventDefault()
    // synthetic click from keyboard Enter on <a> sets detail=0; real mouse clicks set detail>=1.
    const keyboardActivated = event.detail === 0
    wiring.onSlugClick(slug, keyboardActivated)
  })
  root.addEventListener('keydown', (event): void => {
    onPageNavKeyDown(root, event)
  })
}
