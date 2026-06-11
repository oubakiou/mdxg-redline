// ページ遷移と scroll-spy の同期を担う navigation orchestrator。
// state.activePageIndex の切り替え、DOM 再描画、hash 同期、scroll 位置の確定を
// 1 つの API (navigateToTarget) に集約し、Stacked View の不変条件を維持する。

import type { Comment } from '../../core/types'
import type { Page } from '../../core/page-split'
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
 * 文書 mount を伴う full render。loadFromMarkdown (初期ロード / markdown 差し替え) で `#doc` を
 * 作り直すときに使う。renderDoc が DOM を再 mount するため、scroll-spy も新 DOM 上に組み直す
 * (古い observer はリーク防止のため teardown される)。
 */
export const renderAll = (): void => {
  renderDoc()
  renderPageNavigation()
  renderComments()
  setupScrollSpy()
  setupPageScrollSpy()
}

/**
 * ページ切替時の軽量 refresh。Stacked View は全ページを 1 度に描画して常駐させ、`#doc` の DOM は
 * activePageIndex に依存しない (doc-mount は全ページを描画する) ため、renderDoc による再 mount +
 * 全 Shiki / Mermaid / KaTeX 再 upgrade は不要 — active page の TOC highlight 更新だけで足りる。
 * cmt / search mark は再 mount しない限り破壊されず、scroll-spy observer も DOM 不変なら有効なまま。
 * (詳細・性能 bug の経緯は docs/archive/bug-stacked-view-pagechange-rerender.archive.md)
 */
const refreshActivePageView = (): void => {
  renderPageNavigation()
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
 * ページ切替は `refreshActivePageView` (軽量 = TOC highlight 更新のみ) を使い、renderDoc による
 * 全再 mount は行わない。`#doc` は全ページ常駐で activePageIndex に依存しないため
 * (docs/archive/bug-stacked-view-pagechange-rerender.archive.md)。文書 mount は loadFromMarkdown 側の renderAll。
 */
export const navigateToTarget = (
  target: NavigateTarget,
  pushHash: boolean,
  focusTOC = false
): void => {
  const pageChanged = setActivePageIndex(target.pageIndex)
  if (pageChanged) {
    refreshActivePageView()
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
 * Stacked View では全ページの comment mark が常時 #doc 上に存在するため、navigateToTarget で
 * activePageIndex を切り替えた直後に focusCommentMarkAfterNavigate を呼べば、対象 mark を
 * 見つけてハイライト + smoothScroll できる。
 */
export const navigateToComment = (comment: Comment): void => {
  navigateToTarget({ headingSlug: null, pageIndex: comment.pageIndex }, true)
  focusCommentMarkAfterNavigate(comment.id)
  // cmt-list は全 comment を常時描画し activePageIndex に依存しないため、ページ切替で再構築されない。
  // 同 id の card に focus を当て直すことで、TOC 側の focusNavigatedLink (§13 [SHOULD]) と同等の
  // 「navigate 後にフォーカスが残る」挙動を実現する。
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

const buildNavTestPage = (index: number, slug: string): Page => ({
  ancestorHeadingPath: [],
  depth: 1,
  headings: [],
  index,
  markdown: '',
  slug,
  sourceLineEnd: index * 2 + 2,
  sourceLineStart: index * 2 + 1,
  title: `Page ${index}`,
})

// 2 ページ分の <section.virtual-page> を #doc に mount 済みにし、再 mount 検出用の sentinel を仕込む。
const setupTwoPageFixtureForTest = (): void => {
  document.documentElement.className = ''
  document.body.innerHTML = `
    <section class="doc-pane" tabindex="-1">
      <div id="doc">
        <span id="doc-sentinel"></span>
        <section class="virtual-page" data-page-index="0" data-page-slug="p0">
          <mark class="cmt" data-comment-id="c-on-p0"></mark>
          <mark class="search-hl" data-search-index="0"></mark>
        </section>
        <section class="virtual-page" data-page-index="1" data-page-slug="p1"></section>
      </div>
    </section>
    <aside class="page-nav" id="page-nav"><div id="page-nav-list"></div></aside>
  `
  state.pages = [buildNavTestPage(0, 'p0'), buildNavTestPage(1, 'p1')]
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

  describe('navigateToTarget ページ切替は #doc を再 mount しない (bug-stacked-view-pagechange-rerender)', () => {
    beforeEach(setupTwoPageFixtureForTest)

    it('別ページ遷移で #doc 内の sentinel が破壊されない (renderDoc 非呼出)', () => {
      const sentinelBefore = document.getElementById('doc-sentinel')
      const sectionBefore = document.querySelector('section.virtual-page[data-page-slug="p0"]')
      navigateToTarget({ headingSlug: null, pageIndex: 1 }, false)
      // 再 mount (doc.innerHTML = '') が走れば sentinel / section の identity は失われる。
      expect([
        document.getElementById('doc-sentinel') === sentinelBefore,
        document.querySelector('section.virtual-page[data-page-slug="p0"]') === sectionBefore,
        state.activePageIndex,
      ]).toEqual([true, true, 1])
    })

    it('別ページ遷移で別ページ上の cmt mark / search-hl が破壊されず残る', () => {
      navigateToTarget({ headingSlug: null, pageIndex: 1 }, false)
      // 再 mount すれば p0 上の mark は消える。残存 = highlight / アンカリングがページ切替で保たれる。
      expect([
        document.querySelector('mark.cmt[data-comment-id="c-on-p0"]') !== null,
        document.querySelector('mark.search-hl[data-search-index="0"]') !== null,
      ]).toEqual([true, true])
    })

    it('別ページ遷移で TOC (page-nav-list) は active page に追従して再描画される', () => {
      navigateToTarget({ headingSlug: null, pageIndex: 1 }, false)
      const list = document.getElementById('page-nav-list')
      // renderPageNavigation が走り、TOC 本文が描画されている (active=page1)。
      expect(list instanceof HTMLElement && list.innerHTML.length > 0).toBe(true)
    })

    it('同一ページ遷移 (pageChanged false) では refresh も走らず TOC は空のまま', () => {
      navigateToTarget({ headingSlug: null, pageIndex: 0 }, false)
      const list = document.getElementById('page-nav-list')
      expect([
        document.getElementById('doc-sentinel') !== null,
        state.activePageIndex,
        list instanceof HTMLElement && list.innerHTML,
      ]).toEqual([true, 0, ''])
    })
  })
}
