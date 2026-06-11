// ページ遷移と scroll-spy の同期を担う navigation orchestrator。
// state.activePageIndex の切り替え、DOM 再描画、hash 同期、scroll 位置の確定を
// 1 つの API (navigateToTarget) に集約し、Stacked View の不変条件を維持する。

import type { Comment } from '../../core/types'
import {
  type NavigateTarget,
  resolveTargetFromHash,
  setActivePageIndex,
  syncHashFromActivePage,
} from '../document/pages'
import { closeMobilePageNav, isMobilePageNavOpen } from '../chrome/mobile-footer'
import { focusCommentMarkAfterNavigate, renderComments } from '../comments/comments'
import { focusNavigatedLink } from './page-navigation-keyboard'
import { renderPageNavigation } from './page-navigation-render'
import {
  scrollToHeading,
  setActiveHeadingImmediately,
  setupScrollSpy,
} from '../document/scroll-spy'
import { renderDoc } from '../document/doc-renderer'
import { setupPageScrollSpy } from './page-scroll-spy'
import { state } from '../state/app-state'

/**
 * loadFromMarkdown / navigateToTarget 双方で使う「現状の state を全 view に流す」共通処理。
 * scroll-spy も DOM が新しくなった直後に組み直す (古い observer はリーク防止のため teardown)。
 */
export const renderAll = (): void => {
  renderDoc()
  renderPageNavigation()
  renderComments()
  setupScrollSpy()
  setupPageScrollSpy()
}

/** activePage に対応する `<section.virtual-page>` を DOM から取り出す。 */
const findActivePageSection = (): HTMLElement | null => {
  const activePage = state.pages[state.activePageIndex]
  if (!activePage) {
    return null
  }
  return document.querySelector<HTMLElement>(
    `section.virtual-page[data-page-slug="${activePage.slug}"]`
  )
}

/**
 * section の上枠を pane の上から SECTION_TOP_RATIO の位置に揃える。section top を viewport top
 * にぴったり貼り付けるとページ境界の認識が弱いため、上端寄りの細い余白を確保して「次ページが
 * 始まった」感覚を与える。page-scroll-spy の rootMargin 判定線とも揃える
 * (`page-scroll-spy.ts` の `-5% 0px -95% 0px` と同じ比率)。
 */
const SECTION_TOP_RATIO = 0.05
const alignSectionTopInPane = (
  section: HTMLElement,
  pane: HTMLElement,
  behavior: ScrollBehavior
): void => {
  const sectionRect = section.getBoundingClientRect()
  const paneRect = pane.getBoundingClientRect()
  const targetScrollTop =
    pane.scrollTop + (sectionRect.top - paneRect.top) - pane.clientHeight * SECTION_TOP_RATIO
  pane.scrollTo({ behavior, top: targetScrollTop })
}

/**
 * Stacked View で、現在 activePage の `<section.virtual-page>` を doc-pane のスクロール位置に
 * 揃える。実位置の決定は `alignSectionTopInPane` に委譲する。doc-pane が無い旧経路 (テスト
 * fixture 等) では `scrollIntoView` にフォールバックする。
 *
 * 初期ロードは `auto` (instant) で呼ぶ。smooth では scroll 完了まで複数 frame かかり、その間に
 * page-scroll-spy の初回 IntersectionObserver callback が「先頭 section が intersecting」と
 * 判定して activePageIndex を 0 に巻き戻すレースが起きる。instant ならスクロール位置が同期で
 * 確定するため、observer 初回時点で正しい topmost が選ばれる。
 */
const scrollToActivePageSection = (behavior: ScrollBehavior): void => {
  const section = findActivePageSection()
  if (!section) {
    return
  }
  const pane = section.closest<HTMLElement>('.doc-pane')
  if (!pane) {
    section.scrollIntoView({ behavior, block: 'start' })
    return
  }
  alignSectionTopInPane(section, pane, behavior)
}

/**
 * render 後の navigate 終端処理を共通化したヘルパ。
 * - `target.headingSlug` 指定時: 即座に outline link をハイライトしてから、page slug で絞った
 *   section 内の heading にスクロール
 * - heading 無し + ページ切替あり: page section の先頭にスクロール (TOC クリック後の page 移動)
 * - heading 無し + ページ切替なし: 何もしない (同一 page 内 navigate のスクロール位置は維持)
 *
 * Stacked View では heading id が page をまたいで衝突するため、scrollToHeading には activePage の
 * slug を渡して section を 1 つに絞る。`loadFromMarkdown` (初期ロード) と `navigateToTarget`
 * (TOC / Sequential / hashchange) の双方からこのヘルパに集約することで、page-only deep link
 * (`#page-3` 等) でも heading deep link でも一貫してスクロール位置が反映される。
 */
export const scrollToTargetAfterRender = (
  target: NavigateTarget,
  pageChanged: boolean,
  behavior: ScrollBehavior
): void => {
  if (target.headingSlug !== null) {
    setActiveHeadingImmediately(target.headingSlug)
    const activePage = state.pages[state.activePageIndex]
    if (!activePage) {
      return
    }
    scrollToHeading(target.headingSlug, activePage.slug, behavior)
    return
  }
  if (pageChanged) {
    scrollToActivePageSection(behavior)
  }
}

/**
 * ページ + 任意の heading への遷移 orchestrator。state.activePageIndex を切り替えて DOM 再描画と
 * hash 同期、対象 heading へのスクロールをまとめて行う。
 * - `pushHash = true` (TOC / outline / Sequential クリック): hash も書き換える
 * - `pushHash = false` (hashchange 由来): hash は既に変更済みなので書き換えない
 * - `focusTOC = true` はキーボード由来の navigate (Enter on TOC link) で立てる。対象 link に
 *   フォーカスを戻し、roving tabindex の current 位置も同時に更新する (§13 [SHOULD] フォーカス管理)。
 *   click 由来 / hashchange / scroll-spy 由来では false のままで、フォーカスを奪わない
 * - scroll 動作は `scrollToTargetAfterRender` に集約 (heading 指定 / page section / 同一 page 内
 *   no-op の 3 分岐) し、instant (`auto`) で位置遷移する
 *
 * 再描画は必ず `renderAll()` 経由にする。view 追加時の drift を構造的に防ぐ単一の真の源。
 */
export const navigateToTarget = (
  target: NavigateTarget,
  pushHash: boolean,
  focusTOC = false
): void => {
  const pageChanged = setActivePageIndex(target.pageIndex)
  if (pageChanged) {
    renderAll()
  }
  if (pushHash) {
    syncHashFromActivePage(target.headingSlug)
  }
  scrollToTargetAfterRender(target, pageChanged, 'auto')
  if (focusTOC) {
    const activePage = state.pages[state.activePageIndex]
    if (activePage) {
      focusNavigatedLink(activePage.slug, target.headingSlug)
    }
  }
}

/**
 * TOC / outline / Sequential Nav いずれのクリックでも、anchor の `data-slug` は
 * `<page-slug>` か `<page-slug>__<heading-slug>` の composite 形式。
 * composite slug を `resolveTargetFromHash` に流すことで page index + heading slug を一度に解決し、
 * navigateToTarget に渡す。
 *
 * `keyboardActivated` は wirePageNavigation の click delegate が `MouseEvent.detail === 0` で識別した
 * 「キーボード Enter で `<a>` がブラウザに dispatch させた synthetic click」を指し、navigate 後に
 * TOC の対象 link へフォーカスを戻すかの判断に使う (§13 [SHOULD])。マウスクリックでは false の
 * ままでフォーカスを動かさず、本文側に居るユーザーの邪魔をしない。
 */
export const onCompositeSlugClick = (compositeSlug: string, keyboardActivated: boolean): void => {
  const mobileDrawerOpen = isMobilePageNavOpen()
  // mobile drawer 経路では navigateToTarget 第 3 引数 (focusTOC) を false 強制し、close 後に inert に
  // なる TOC link への focusNavigatedLink 競合を構造的に回避する (§5.r)。desktop は無変更。
  navigateToTarget(
    resolveTargetFromHash(`#${compositeSlug}`),
    true,
    !mobileDrawerOpen && keyboardActivated
  )
  if (mobileDrawerOpen) {
    closeMobilePageNav({ restoreFocus: false })
    const docPane = document.querySelector<HTMLElement>('.doc-pane')
    if (docPane) {
      docPane.focus({ preventScroll: true })
    }
  }
}

/**
 * サイドバーに表示された別ページのコメントカードがクリックされた時の遷移 orchestrator。
 * navigateToTarget で activePageIndex を切り替えると renderAll が走り、mark-engine が
 * 新ページの comments を mark 化する。同じ tick で focusCommentMarkAfterNavigate を呼べば
 * 描画済みの mark を見つけてハイライト + smoothScroll できる。
 */
export const navigateToComment = (comment: Comment): void => {
  navigateToTarget({ headingSlug: null, pageIndex: comment.pageIndex }, true)
  focusCommentMarkAfterNavigate(comment.id)
  // navigateToTarget → renderAll で #cmt-list が再構築され、Enter/click 時に focus を持っていた
  // 旧カードは破棄される。新カードを comment id で引き直して focus を戻すことで、TOC 側の
  // focusNavigatedLink (§13 [SHOULD]) と同等の「navigate 後にフォーカスが残る」挙動を実現する。
  const newCard = document.querySelector<HTMLElement>(`.cmt-card[data-id="${comment.id}"]`)
  if (newCard) {
    newCard.focus()
  }
}

const setupNavFixtureForTest = (): void => {
  document.documentElement.className = ''
  document.body.innerHTML = `
    <section class="doc-pane" tabindex="-1"></section>
    <aside class="page-nav" id="page-nav"></aside>
  `
  // pages 空 + activePageIndex 0 で setActivePageIndex(0) は範囲外 false となり renderAll を回避する。
  state.pages = []
  state.activePageIndex = 0
}

if (import.meta.vitest) {
  const { afterEach, beforeEach, describe, expect, it } = import.meta.vitest

  beforeEach(setupNavFixtureForTest)
  afterEach((): void => {
    document.documentElement.className = ''
    document.body.innerHTML = ''
  })

  describe('onCompositeSlugClick mobile 分岐 (§5.r)', () => {
    it('mobile drawer open 時は drawer を閉じ .doc-pane に focus を退避する', () => {
      document.documentElement.classList.add('mobile-page-nav-open')
      onCompositeSlugClick('missing-slug', true)
      expect([isMobilePageNavOpen(), document.activeElement]).toEqual([
        false,
        document.querySelector('.doc-pane'),
      ])
    })

    it('desktop (drawer 閉) では drawer を閉じず .doc-pane に focus を移さない', () => {
      onCompositeSlugClick('missing-slug', true)
      const focusedDocPane = document.activeElement === document.querySelector('.doc-pane')
      expect([isMobilePageNavOpen(), focusedDocPane]).toEqual([false, false])
    })
  })
}
