// DOM エントリポイント。
// 各責務は別モジュールに切り出し済み:
//   状態 (app-state) / DOM helper (dom-utils) / mark 反映 (mark-engine) / markdown 描画 (doc-renderer) /
//   サイドバー (sidebar) / floater (floater) / コメント入力モーダル (comment-modal) /
//   ドロップダウンメニュー (menu) / toolbar (toolbar) / boot (boot)
// 本ファイルは loadFromMarkdown orchestrator と、上記モジュールを組み合わせる wiring に専念する。

import type { Comment, ExportPayload } from '../core/types'
import { activateSidebarMark, renderSidebar } from './sidebar'
import {
  buildReviewExportPayload,
  commentCountLabel as formatCommentCount,
} from '../core/review-export'
import { changeOutputFolder, writeFeedback } from './workspace'
import { closeCommentModal, wireCommentModal } from './comment-modal'
import { computeDocHash, formatLoadedStatus } from '../core/embed'
import {
  findPageBySlug,
  resolveInitialActivePageIndex,
  setActivePageIndex,
  syncHashFromActivePage,
} from './pages'
import { markFeedbackUnsaved, state } from './app-state'
import { qs, toast } from './dom-utils'
import { renderPageNavigation, wirePageNavigation } from './page-navigation'
import { boot } from './boot'
import { createDropdownMenu } from './menu'
import { initSidebarResize } from './sidebar-resize'
import { renderDoc } from './doc-renderer'
import { splitIntoPages } from '../core/page-split'
import { wireFloater } from './floater'
import { wireToolbar } from './toolbar'

/** loadFromMarkdown / navigateToPage 双方で使う「現状の state を全 view に流す」共通処理 */
const renderAll = (): void => {
  renderDoc()
  renderPageNavigation()
  renderSidebar()
}

/**
 * markdown 本文を取り込んで state を構築・描画・ステータス更新する中心ルーチン。
 * 永続化レイヤは workspace-handle のみ（詳細は DESIGN.md §7）。
 *
 * MDXG Virtual Pages 用に markdown 読み込み時点で `state.pages` を確定し、`activePageIndex` は
 * `location.hash` を参照して解決する (docs/mdxg-virtual-pages.md §10 起動シーケンス step 1c–1d)。
 * Phase 2 ではこれに加え renderPageNavigation で左サイドバー TOC を描画する。
 */
export const loadFromMarkdown = async (name: string, text: string): Promise<void> => {
  state.docName = name
  state.markdown = text
  state.docHash = await computeDocHash(text)
  state.comments = []
  state.pages = splitIntoPages(text, { docName: name })
  state.activePageIndex = resolveInitialActivePageIndex(globalThis.location.hash)
  markFeedbackUnsaved()
  renderAll()
  qs('#status').textContent = formatLoadedStatus(name, state.docHash)
}

/**
 * ページ切替の orchestrator。state.activePageIndex を切り替えて DOM の再描画と hash 同期をまとめて行う。
 * - `pushHash = true` (TOC クリック等): hash も書き換える → hashchange が同 page を再要求しても idempotent
 * - `pushHash = false` (hashchange 由来): hash は既に変更済みなので書き換えない
 * `setActivePageIndex` が false を返す (範囲外 / 同 index) ときは何もしない (重複 render 防止)。
 */
const navigateToPage = (index: number, pushHash: boolean): void => {
  if (!setActivePageIndex(index)) {
    return
  }
  if (pushHash) {
    syncHashFromActivePage()
  }
  renderDoc()
  renderPageNavigation()
  renderSidebar()
  // ページ切替時は新ページの top にスクロールする (mdxg-virtual-pages.md §13.4)。
  // 同一ページのコメント mark へのジャンプ等の特殊ケースは Phase 5 で扱う。
  const pane = document.querySelector('.doc-pane')
  if (pane instanceof HTMLElement) {
    pane.scrollTop = 0
  }
}

export const buildExportPayload = (): ExportPayload => buildReviewExportPayload(state)

export const commentCountLabel = (): string => formatCommentCount(state.comments.length)

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

  // 左サイドバー TOC のクリック → navigateToPage(idx, pushHash=true)。
  // anchor の標準クリックで location.hash も同時に更新されるが、hashchange より先に
  // 即時 navigate して active 状態の反映遅延を回避する。重複 navigation は
  // setActivePageIndex の idempotent ガードで吸収される。
  wirePageNavigation({
    onSlugClick: (slug): void => {
      const page = findPageBySlug(slug)
      if (page === null) {
        return
      }
      navigateToPage(page.index, true)
    },
  })

  // ブラウザの戻る / 進む or 直接 URL 編集経由の hash 変更を反映する。
  // pushHash=false にすることで navigateToPage 側で hash を再度書き戻さない (無限ループ防止)。
  //
  // 解決ロジックは初期ロードと同じ `resolveInitialActivePageIndex` を再利用することで、
  // 「hash が空 / 不正 / 該当 slug 不在ならページ 0」という方針を初期ロードと hashchange の
  // 両経路で一致させる (mdxg-virtual-pages.md §7.4 / pages.ts header コメント参照)。
  // 同 index への遷移は setActivePageIndex の idempotent ガードで no-op。
  globalThis.addEventListener('hashchange', (): void => {
    navigateToPage(resolveInitialActivePageIndex(globalThis.location.hash), false)
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
