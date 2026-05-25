// state.comments を DOM 上の <mark class="cmt"> 群に反映する内部エンジン。
// コメントの追加/削除/再描画のたびに「キャッシュ済み原 HTML へ戻す → 全 mark 再生成」
// というラウンドトリップを取り、差分管理を避けて単純化している。

import type { Comment } from '../core/types'
import { buildDomRange } from './selection'
import { injectCopyButtons } from './code-copy-wrap'
import { qs } from './dom-utils'
import { state } from './app-state'

interface MarkableRange {
  endNode: Text
  range: Range
  startNode: Text
}

/**
 * 指定 Range を `<mark class="cmt">` で囲む。
 * 単一テキストノード内なら surroundContents、ノードまたぎなら extractContents+insertNode で対応する。
 * surroundContents は要素境界をまたぐと例外を投げるため try/catch でフォールバック扱いにする（その mark のみスキップ）。
 */
const wrapRangeWithMark = (domRange: MarkableRange, commentId: string): void => {
  const { endNode, range, startNode } = domRange
  const mark = document.createElement('mark')
  mark.className = 'cmt'
  mark.dataset.commentId = commentId
  try {
    if (startNode === endNode) {
      range.surroundContents(mark)
    } else {
      const contents = range.extractContents()
      mark.appendChild(contents)
      range.insertNode(mark)
    }
  } catch {
    // Fallback: skip this mark if range crosses element boundaries awkwardly
  }
}

/** 1 件のコメントに対応する mark を該当ブロック上に貼る。Range 構築失敗時は何もしない（fail-soft） */
const applyMark = (blockEl: Element, comment: Comment): void => {
  const built = buildDomRange(blockEl, comment)
  if (!built) {
    return
  }
  wrapRangeWithMark(built, comment.id)
}

const pushIntoBucket = (byBlock: Map<string, Comment[]>, comment: Comment): void => {
  const bucket = byBlock.get(comment.blockId)
  if (bucket) {
    bucket.push(comment)
    return
  }
  byBlock.set(comment.blockId, [comment])
}

/**
 * state.comments を blockId キーでグルーピングする。
 *
 * blockId は文書全体で連番付与される (document スコープ) ので、page によるフィルタは行わない。
 * Stacked View では全 page の DOM に対して該当 blockId の mark を貼る。Single Page 描画でも
 * DOM 上に該当 blockId が無いコメントは applyMarksForBlock の `querySelector → null` で
 * 自然に fail-soft され、見える形で表示されない。
 */
const commentsGroupedByBlock = (): Map<string, Comment[]> => {
  const byBlock = new Map<string, Comment[]>()
  for (const comment of state.comments) {
    pushIntoBucket(byBlock, comment)
  }
  return byBlock
}

/**
 * 同一ブロック内のコメントを startOffset の降順で並べる。
 * 後ろから mark を貼ることで、前方への挿入による以降のオフセットずれを回避する。
 */
const sortedBlockComments = (byBlock: Map<string, Comment[]>, blockId: string): Comment[] =>
  [...(byBlock.get(blockId) || [])].toSorted(
    (left, right): number => right.startOffset - left.startOffset
  )

/**
 * ブロック内 HTML を原状復帰してから、そのブロックに紐づく全コメントの mark を貼り直す。
 *
 * mark 適用 **後** に `injectCopyButtons(el)` を呼んで `<pre>` の wrap を再構築する。
 * blockOriginalHTML には wrap される前の innerHTML がキャッシュされており、巻き戻しで
 * `<div class="code-block-wrap">` と Copy button が消えるため、復元が必要 (ネストされた
 * `<pre>` のみ顕在化する。トップレベル `<pre>` は `<pre>` 自身が blockId 持ちで wrap の
 * 外側に居るので巻き戻しの影響を受けない)。textSegments は `.code-copy-btn` 配下を
 * skip するため、wrap 復元はオフセット計算に影響しない。
 */
const applyMarksForBlock = ({
  blockId,
  byBlock,
  doc,
  original,
}: {
  blockId: string
  byBlock: Map<string, Comment[]>
  doc: Element
  original: string
}): void => {
  const el = doc.querySelector(`[data-block-id="${blockId}"]`)
  if (!el) {
    return
  }
  el.innerHTML = original
  for (const comment of sortedBlockComments(byBlock, blockId)) {
    applyMark(el, comment)
  }
  if (el instanceof HTMLElement) {
    injectCopyButtons(el)
  }
}

/**
 * `reapplyAllMarks` の末尾で呼ばれる callback。search.ts が search-hl の再貼付を register する。
 * cmt mark を貼り直すたびに search ハイライトを上書き再構築する経路を構造的に揃え、
 * Shiki upgrade / renderAll / コメント追加 / 削除のいずれの reapply 経路でも search が維持される。
 *
 * Wire は `setOnMarksReapplied` で 1 つだけ。空 callback の登録解除は null を渡せばよい。
 */
let onMarksReapplied: (() => void) | null = null
export const setOnMarksReapplied = (callback: (() => void) | null): void => {
  onMarksReapplied = callback
}

/**
 * すべてのブロックに対して mark を貼り直す。
 * コメントの追加・削除があるたび「キャッシュ済み原 HTML へ戻す → 全 mark 再生成」というラウンドトリップを取り、
 * 差分管理を避けて単純化している（コメント件数は実用上それほど多くならない想定）。
 */
export const reapplyAllMarks = (): void => {
  const doc = qs('#doc')
  const byBlock = commentsGroupedByBlock()
  for (const [bid, original] of state.blockOriginalHTML) {
    applyMarksForBlock({ blockId: bid, byBlock, doc, original })
  }
  if (onMarksReapplied !== null) {
    onMarksReapplied()
  }
}

// テスト用のダミーコメント生成 (overrides で必要なフィールドだけ上書きできる)。
// Phase 5 で sourceLine / pageIndex が必須化されたため default 値を入れる。
const dummyComment = (overrides: Partial<Comment> = {}): Comment => ({
  blockId: 'b001',
  comment: '',
  created: '',
  endOffset: 0,
  id: 'x',
  pageIndex: 0,
  quote: '',
  sourceLine: 1,
  startOffset: 0,
  ...overrides,
})

if (import.meta.vitest) {
  const { afterEach, beforeEach, describe, expect, it } = import.meta.vitest

  let savedComments: Comment[] = []
  beforeEach(() => {
    savedComments = state.comments
  })
  afterEach(() => {
    state.comments = savedComments
  })

  describe('sortedBlockComments', () => {
    it('startOffset 降順で並べる (後ろから mark 適用するための前提)', () => {
      const byBlock = new Map<string, Comment[]>([
        [
          'b1',
          [
            dummyComment({ id: 'mid', startOffset: 5 }),
            dummyComment({ id: 'last', startOffset: 10 }),
            dummyComment({ id: 'first', startOffset: 0 }),
          ],
        ],
      ])
      expect(sortedBlockComments(byBlock, 'b1').map((comment): string => comment.id)).toEqual([
        'last',
        'mid',
        'first',
      ])
    })

    it('存在しない blockId は空配列を返す', () => {
      expect(sortedBlockComments(new Map(), 'nonexistent')).toEqual([])
    })

    // toSorted ベースなので元配列を破壊しないことを明示的に検証する。
    // mutate する .sort() に差し戻されるリグレッションを防ぐ。
    it('元の byBlock 配列を破壊しない (toSorted 利用の保証)', () => {
      const original = [
        dummyComment({ id: 'a', startOffset: 5 }),
        dummyComment({ id: 'b', startOffset: 10 }),
      ]
      const byBlock = new Map<string, Comment[]>([['b1', original]])
      sortedBlockComments(byBlock, 'b1')
      expect(original.map((comment): string => comment.id)).toEqual(['a', 'b'])
    })
  })

  describe('commentsGroupedByBlock', () => {
    it('同じ blockId のコメントを 1 つの bucket にまとめ、宣言順を保つ', () => {
      state.comments = [
        dummyComment({ blockId: 'b1', id: 'a' }),
        dummyComment({ blockId: 'b2', id: 'b' }),
        dummyComment({ blockId: 'b1', id: 'c' }),
      ]
      const grouped = commentsGroupedByBlock()
      expect((grouped.get('b1') ?? []).map((comment): string => comment.id)).toEqual(['a', 'c'])
      expect((grouped.get('b2') ?? []).map((comment): string => comment.id)).toEqual(['b'])
    })
  })
}
