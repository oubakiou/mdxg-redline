// DOM エントリポイント (src/review.html の <script type="module"> から読み込まれる)。
// 起動 wiring は app-wiring.ts (bootstrapReviewApp) に集約し、本ファイルは composition root として
// loadFromMarkdown / buildExportPayload / commentCountLabel の組み立てと bootstrap 呼び出しに専念する。

import type { Comment, ExportPayload } from '../core/types'
import { type NavigateTarget, resolveTargetFromHash } from './document/pages'
import { appendFootnotesPage, splitIntoPages } from '../core/page-split'
import {
  buildReviewExportPayload,
  commentCountLabel as formatCommentCount,
} from '../core/review-export'
import { computeDocHash, formatLoadedStatus } from '../core/embed'
import { loadDocumentState, markFeedbackUnsaved, state } from './state/app-state'
import { renderAll, scrollToTargetAfterRender } from './navigation/navigation-orchestrator'
import { bootstrapReviewApp } from './app-wiring'
import { qs } from './dom/dom-utils'

interface LoadResult {
  docHash: string
  target: NavigateTarget
}

// loadFromMarkdown を 10 statements 以内に収めるため state 初期化部分を別関数に切り出す。
// docHash は state.docHash に書き込んだ後 caller でも `formatLoadedStatus` に渡したい一方、
// state.docHash の型が `string | null` のため TypeScript narrow を維持するには戻り値経由が手早い。
const initStateFromMarkdown = async (name: string, text: string): Promise<LoadResult> => {
  const docHash = await computeDocHash(text)
  const pages = appendFootnotesPage(splitIntoPages(text, { docName: name }), text)
  const target = resolveTargetFromHash(globalThis.location.hash)
  loadDocumentState({
    activePageIndex: target.pageIndex,
    docHash,
    docName: name,
    markdown: text,
    pages,
  })
  return { docHash, target }
}

/**
 * markdown 本文を取り込んで state を構築・描画・ステータス更新する中心ルーチン。
 * 永続化レイヤは workspace-handle のみ（詳細は DESIGN.md §7）。
 *
 * MDXG Virtual Pages 用に markdown 読み込み時点で `state.pages` を確定し、`activePageIndex` は
 * `location.hash` を参照して解決する (DESIGN.md §9 起動シーケンス step 1c–1d)。
 * 初期ロード時の deep link は render 後に `scrollToTargetAfterRender` で page section または
 * heading 位置まで反映する。`auto` (instant) を渡すことで page-scroll-spy の初回 callback と
 * 競合せず、URL hash と activePageIndex が一致したまま起動する。
 */
export const loadFromMarkdown = async (name: string, text: string): Promise<void> => {
  const { docHash, target } = await initStateFromMarkdown(name, text)
  markFeedbackUnsaved()
  renderAll()
  qs('#status').textContent = formatLoadedStatus(name, docHash)
  // 初期ロードでは `pageChanged=true` 相当 (activePageIndex は hash から復元したばかり) で、
  // page-only hash (`#page-3` 等) でも instant scroll で位置確定させる。
  scrollToTargetAfterRender(target, true, 'auto')
}

export const buildExportPayload = (): ExportPayload => buildReviewExportPayload(state)

export const commentCountLabel = (): string => formatCommentCount(state.comments.length)

if (!import.meta.vitest) {
  bootstrapReviewApp({
    buildExportPayload,
    commentCountLabel,
    loadFromMarkdown,
  })
}

const dummyCommentForTest = (id: string): Comment => ({
  blockId: '',
  comment: '',
  created: '',
  endOffset: 0,
  id,
  pageIndex: 0,
  quote: '',
  sourceLine: 1,
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
