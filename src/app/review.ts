// DOM エントリポイント。
// 各責務は別モジュールに切り出し済み:
//   状態 (app-state) / DOM helper (dom-utils) / mark 反映 (mark-engine) / markdown 描画 (doc-renderer) /
//   サイドバー (sidebar) / floater (floater) / コメント入力モーダル (comment-modal) /
//   ドロップダウンメニュー (menu) / toolbar (toolbar) / boot (boot)
// 本ファイルは loadFromMarkdown orchestrator と、上記モジュールを組み合わせる wiring に専念する。

import type { Comment, ExportPayload } from '../core/types'
import {
  type NavigateTarget,
  resolveTargetFromHash,
  setActivePageIndex,
  syncHashFromActivePage,
} from './pages'
import { activateSidebarMark, renderSidebar } from './sidebar'
import {
  buildReviewExportPayload,
  commentCountLabel as formatCommentCount,
} from '../core/review-export'
import { changeOutputFolder, writeFeedback } from './workspace'
import { closeCommentModal, wireCommentModal } from './comment-modal'
import { computeDocHash, formatLoadedStatus } from '../core/embed'
import { markFeedbackUnsaved, state } from './app-state'
import { qs, toast } from './dom-utils'
import { renderPageNavigation, wirePageNavigation } from './page-navigation'
import { renderSequentialNav, wireSequentialNav } from './sequential-nav'
import { scrollToHeading, setActiveHeadingImmediately, setupScrollSpy } from './scroll-spy'
import { boot } from './boot'
import { createDropdownMenu } from './menu'
import { initSidebarResize } from './sidebar-resize'
import { renderDoc } from './doc-renderer'
import { splitIntoPages } from '../core/page-split'
import { wireFloater } from './floater'
import { wireToolbar } from './toolbar'

/**
 * loadFromMarkdown / navigateToTarget 双方で使う「現状の state を全 view に流す」共通処理。
 * scroll-spy も DOM が新しくなった直後に組み直す (古い observer はリーク防止のため teardown)。
 */
const renderAll = (): void => {
  renderDoc()
  renderPageNavigation()
  renderSequentialNav()
  renderSidebar()
  setupScrollSpy()
}

const scrollDocToTop = (): void => {
  const pane = document.querySelector('.doc-pane')
  if (pane instanceof HTMLElement) {
    pane.scrollTop = 0
  }
}

// loadFromMarkdown / navigateToTarget 両方で使う「heading slug 指定なら即時ハイライト + smooth scroll」。
// 初期ロード / 遷移後 / hashchange のいずれでも同じ振る舞いになる単一の真の源として共有する。
const scrollToHeadingIfPresent = (headingSlug: string | null): void => {
  if (headingSlug === null) {
    return
  }
  // observer 待ちにせず即座に outline link をハイライト (scroll-spy が後追いで update する)
  setActiveHeadingImmediately(headingSlug)
  scrollToHeading(headingSlug)
}

interface LoadResult {
  docHash: string
  target: NavigateTarget
}

// loadFromMarkdown を 10 statements 以内に収めるため state 初期化部分を別関数に切り出す。
// docHash は state.docHash に書き込んだ後 caller でも `formatLoadedStatus` に渡したい一方、
// state.docHash の型が `string | null` のため TypeScript narrow を維持するには戻り値経由が手早い。
const initStateFromMarkdown = async (name: string, text: string): Promise<LoadResult> => {
  state.docName = name
  state.markdown = text
  const docHash = await computeDocHash(text)
  state.docHash = docHash
  state.comments = []
  state.pages = splitIntoPages(text, { docName: name })
  const target = resolveTargetFromHash(globalThis.location.hash)
  state.activePageIndex = target.pageIndex
  return { docHash, target }
}

/**
 * markdown 本文を取り込んで state を構築・描画・ステータス更新する中心ルーチン。
 * 永続化レイヤは workspace-handle のみ（詳細は DESIGN.md §7）。
 *
 * MDXG Virtual Pages 用に markdown 読み込み時点で `state.pages` を確定し、`activePageIndex` は
 * `location.hash` を参照して解決する (docs/mdxg-virtual-pages.md §10 起動シーケンス step 1c–1d)。
 * 初期ロード時の deep link `#<page>__<heading>` は render 後に `scrollToHeadingIfPresent`
 * で heading 部分まで反映する (hashchange 経路と挙動を一致させる)。
 */
export const loadFromMarkdown = async (name: string, text: string): Promise<void> => {
  const { docHash, target } = await initStateFromMarkdown(name, text)
  markFeedbackUnsaved()
  renderAll()
  qs('#status').textContent = formatLoadedStatus(name, docHash)
  scrollToHeadingIfPresent(target.headingSlug)
}

// navigateToTarget が 11 statements を超えるため、heading 指定無しの分岐を別関数に切り出す。
const handleHeadinglessTarget = (pageChanged: boolean): void => {
  if (pageChanged) {
    scrollDocToTop()
  }
}

/**
 * ページ + 任意の heading への遷移 orchestrator。state.activePageIndex を切り替えて DOM 再描画と
 * hash 同期、対象 heading へのスクロールをまとめて行う。
 * - `pushHash = true` (TOC / outline / Sequential クリック): hash も書き換える
 * - `pushHash = false` (hashchange 由来): hash は既に変更済みなので書き換えない
 * - `target.headingSlug` 指定時は render 後に該当 heading までスムーズスクロール、
 *   無指定 + ページ変更時は doc-pane を top に戻す (mdxg-virtual-pages.md §13.4)
 *
 * 再描画は必ず `renderAll()` 経由にする。view 追加時の drift を構造的に防ぐ単一の真の源
 * (Phase 3 で sequential-nav 抜けが起きた回帰の再発防止)。
 */
const navigateToTarget = (target: NavigateTarget, pushHash: boolean): void => {
  const pageChanged = setActivePageIndex(target.pageIndex)
  if (pageChanged) {
    renderAll()
  }
  if (pushHash) {
    syncHashFromActivePage(target.headingSlug)
  }
  if (target.headingSlug === null) {
    handleHeadinglessTarget(pageChanged)
    return
  }
  scrollToHeadingIfPresent(target.headingSlug)
}

export const buildExportPayload = (): ExportPayload => buildReviewExportPayload(state)

export const commentCountLabel = (): string => formatCommentCount(state.comments.length)

/**
 * TOC / outline / Sequential Nav いずれのクリックでも、anchor の `data-slug` は
 * `<page-slug>` か `<page-slug>__<heading-slug>` の composite 形式。
 * composite slug を `resolveTargetFromHash` に流すことで page index + heading slug を一度に解決し、
 * navigateToTarget に渡す。
 */
const onCompositeSlugClick = (compositeSlug: string): void => {
  navigateToTarget(resolveTargetFromHash(`#${compositeSlug}`), true)
}

if (!import.meta.vitest) {
  initSidebarResize()
  wireFloater()
  wireCommentModal()

  const commentsMenu = createDropdownMenu({
    buttonId: '#btn-comments-menu',
    menuId: '#menu-comments',
  })
  const sendMenu = createDropdownMenu({
    buttonId: '#btn-send-menu',
    menuId: '#menu-send',
  })

  document.addEventListener('keydown', (event): void => {
    if (event.key === 'Escape') {
      closeCommentModal()
      commentsMenu.close()
      sendMenu.close()
    }
    if (
      event.key === 'Enter' &&
      (event.metaKey || event.ctrlKey) &&
      qs('#modal').classList.contains('open')
    ) {
      qs('#modal-save').click()
    }
  })

  // mark クリック → サイドバーカードをアクティブ化
  document.addEventListener('click', (event): void => {
    const { target } = event
    if (!(target instanceof Element)) {
      return
    }
    const mark = target.closest('mark.cmt')
    if (!(mark instanceof HTMLElement)) {
      return
    }
    activateSidebarMark(mark)
  })

  wireToolbar({
    buildExportPayload,
    commentCountLabel,
    loadFromMarkdown,
  })

  qs('#btn-send').addEventListener('click', async (): Promise<void> => writeFeedback())
  qs('#btn-change-output').addEventListener('click', async (): Promise<void> => {
    sendMenu.close()
    await changeOutputFolder()
  })

  // 左サイドバー TOC / outline link / 本文末尾 Sequential Nav のクリックを 1 つの handler に統一。
  // anchor の標準クリックで location.hash も同時に更新されるが、hashchange より先に
  // 即時 navigate して active 状態の反映遅延を回避する。重複 navigation は
  // setActivePageIndex の idempotent ガードで吸収される。
  wirePageNavigation({ onSlugClick: onCompositeSlugClick })
  wireSequentialNav({ onSlugClick: onCompositeSlugClick })

  // ブラウザの戻る / 進む or 直接 URL 編集経由の hash 変更を反映する。
  // pushHash=false にすることで navigateToTarget 側で hash を再度書き戻さない (無限ループ防止)。
  //
  // composite hash (`#page__heading`) の場合は heading scroll も同時に解決される
  // (resolveTargetFromHash が page index + heading slug を取り出す)。
  globalThis.addEventListener('hashchange', (): void => {
    navigateToTarget(resolveTargetFromHash(globalThis.location.hash), false)
  })

  boot({
    loadFromMarkdown,
  }).catch((): void => {
    toast('Startup failed')
    // paint 前ガード (#doc-wrap / .doc-pane を隠す class) を解除し、空状態を見せる
    document.documentElement.classList.remove('has-embedded-md')
    document.documentElement.classList.add('doc-ready')
  })
}

const dummyCommentForTest = (id: string): Comment => ({
  blockId: '',
  comment: '',
  created: '',
  endOffset: 0,
  id,
  quote: '',
  startOffset: 0,
})

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest

  describe('commentCountLabel (state 依存)', () => {
    it('1 件のときは単数形', () => {
      const prev = state.comments
      state.comments = [dummyCommentForTest('x')]
      try {
        expect(commentCountLabel()).toBe('1 comment')
      } finally {
        state.comments = prev
      }
    })

    it('0 件のときは複数形 (i18n 非対応の既知挙動)', () => {
      const prev = state.comments
      state.comments = []
      try {
        expect(commentCountLabel()).toBe('0 comments')
      } finally {
        state.comments = prev
      }
    })

    it('2 件以上のときは複数形', () => {
      const prev = state.comments
      state.comments = [
        dummyCommentForTest('a'),
        dummyCommentForTest('b'),
        dummyCommentForTest('c'),
      ]
      try {
        expect(commentCountLabel()).toBe('3 comments')
      } finally {
        state.comments = prev
      }
    })
  })
}
