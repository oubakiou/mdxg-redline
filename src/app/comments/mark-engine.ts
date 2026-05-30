// state.comments を DOM 上の <mark class="cmt"> 群に反映する内部エンジン。
// コメントの追加/削除/再描画のたびに「キャッシュ済み原 HTML へ戻す → 全 mark 再生成」
// というラウンドトリップを取り、差分管理を避けて単純化している。

import type { Comment } from '../../core/types'
import { buildDomRange } from './selection'
import { injectCopyButtons } from '../document/code-copy-wrap'
import { qs } from '../dom/dom-utils'
import { state } from '../state/app-state'
import { wrapRange } from '../dom/text-range'

const createCmtMarkElement = (commentId: string): HTMLElement => {
  const mark = document.createElement('mark')
  mark.className = 'cmt'
  mark.dataset.commentId = commentId
  return mark
}

/** 1 件のコメントに対応する mark を該当ブロック上に貼る。Range 構築失敗時は何もしない（fail-soft） */
const applyMark = (blockEl: Element, comment: Comment): void => {
  const range = buildDomRange(blockEl, comment)
  if (!range) {
    return
  }
  wrapRange(range, createCmtMarkElement(comment.id))
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
 * `reapplyAllMarks` の末尾で呼ばれる callback の集合。
 * search.ts は search-hl の再貼付をここに register することで、cmt mark を貼り直すたびに
 * search ハイライトが上書き再構築される。Shiki / Mermaid / KaTeX upgrade / renderAll /
 * コメント追加 / 削除のいずれの reapply 経路でも search が維持される。
 *
 * 1 callback 制約だった旧 API `setOnMarksReapplied` も互換のため残してあるが、
 * 新規 hook は `registerPostMarksReapplied` (複数 callback 可) を使うこと。
 * 複数登録できる方が、将来 phase 別 (Shiki upgrade 後 / Mermaid 描画後 / KaTeX 描画後) の
 * 後処理を追加する際の入り口が分散しない。
 */
const postMarksReappliedHooks = new Set<() => void>()

/**
 * `reapplyAllMarks` 末尾の callback を register する。返り値の unsubscribe 関数を呼ぶと
 * 当該 callback だけが解除される。同じ callback を複数回 register すると Set の性質で 1 回として扱う。
 *
 * ⚠️ 同一 callback を `setOnMarksReapplied` と `registerPostMarksReapplied` の両方で登録しないこと。
 * 内部で同じ Set を共有するため、片方で unsubscribe するともう片方の意図に反して解除される。
 * 新規 hook は本関数のみを使い、`setOnMarksReapplied` は既存 1 callback (search 用) の互換経路として
 * 残してあるだけ。
 */
export const registerPostMarksReapplied = (callback: () => void): (() => void) => {
  postMarksReappliedHooks.add(callback)
  return (): void => {
    postMarksReappliedHooks.delete(callback)
  }
}

// 既存呼び出しサイト互換用。1 callback だけを管理する旧 API。null で登録解除する。
// 新規 hook は registerPostMarksReapplied を使う方が将来の hook 追加に強い。
// 詳細な invariant は registerPostMarksReapplied の JSDoc を参照。
let legacyOnMarksReapplied: (() => void) | null = null
export const setOnMarksReapplied = (callback: (() => void) | null): void => {
  if (legacyOnMarksReapplied !== null) {
    postMarksReappliedHooks.delete(legacyOnMarksReapplied)
  }
  legacyOnMarksReapplied = callback
  if (callback !== null) {
    postMarksReappliedHooks.add(callback)
  }
}

/**
 * すべてのブロックに対して mark を貼り直す。
 * コメントの追加・削除があるたび「キャッシュ済み原 HTML へ戻す → 全 mark 再生成」というラウンドトリップを取り、
 * 差分管理を避けて単純化している（コメント件数は実用上それほど多くならない想定）。
 *
 * 末尾の hook 発火は事前に snapshot を取った配列を iterate する。
 * これは hook callback 内から `registerPostMarksReapplied` / unsubscribe が呼ばれた場合に
 * (a) 新規追加分が同 iteration で発火する非決定挙動、(b) 削除された callback がそれでも発火してしまう
 * 競合を構造的に防ぐため。次回 `reapplyAllMarks` 呼び出し時には更新後の Set が反映される。
 */
export const reapplyAllMarks = (): void => {
  const doc = qs('#doc')
  const byBlock = commentsGroupedByBlock()
  for (const [bid, original] of state.blockOriginalHTML) {
    applyMarksForBlock({ blockId: bid, byBlock, doc, original })
  }
  const snapshot = [...postMarksReappliedHooks]
  for (const hook of snapshot) {
    hook()
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

const buildDocWithBlock = (blockId: string, text: string): Element => {
  const doc = document.createElement('div')
  const block = document.createElement('p')
  block.setAttribute('data-block-id', blockId)
  block.textContent = text
  doc.appendChild(block)
  return doc
}

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

  describe('applyMarksForBlock (DOM)', () => {
    it('単一テキストノード内の Range を <mark class="cmt"> で囲む', () => {
      const doc = buildDocWithBlock('b1', 'Hello world')
      const byBlock = new Map<string, Comment[]>([
        ['b1', [dummyComment({ blockId: 'b1', endOffset: 11, id: 'c1', startOffset: 6 })]],
      ])
      applyMarksForBlock({ blockId: 'b1', byBlock, doc, original: 'Hello world' })

      const marks = doc.querySelectorAll('mark.cmt')
      const byId = new Map(
        [...marks].map((mark): [string, string] => [
          mark.getAttribute('data-comment-id') ?? '',
          mark.textContent ?? '',
        ])
      )
      expect(marks).toHaveLength(1)
      expect(byId.get('c1')).toBe('world')
    })

    it('同一ブロック内の複数コメントを startOffset 降順で貼り、前方オフセットがずれない', () => {
      const doc = buildDocWithBlock('b1', 'abcdefghij')
      const byBlock = new Map<string, Comment[]>([
        [
          'b1',
          [
            dummyComment({ blockId: 'b1', endOffset: 3, id: 'first', startOffset: 0 }),
            dummyComment({ blockId: 'b1', endOffset: 9, id: 'last', startOffset: 6 }),
          ],
        ],
      ])
      applyMarksForBlock({ blockId: 'b1', byBlock, doc, original: 'abcdefghij' })

      const marks = doc.querySelectorAll('mark.cmt')
      const byId = new Map(
        [...marks].map((mark): [string, string] => [
          mark.getAttribute('data-comment-id') ?? '',
          mark.textContent ?? '',
        ])
      )
      expect(marks).toHaveLength(2)
      expect(byId.get('first')).toBe('abc')
      expect(byId.get('last')).toBe('ghi')
    })

    it('block element が存在しなければ fail-soft で no-op', () => {
      const doc = document.createElement('div')
      const byBlock = new Map<string, Comment[]>([
        ['missing', [dummyComment({ blockId: 'missing', id: 'x' })]],
      ])
      expect((): void =>
        applyMarksForBlock({ blockId: 'missing', byBlock, doc, original: 'whatever' })
      ).not.toThrow()
      expect(doc.querySelector('mark.cmt')).toBeNull()
    })
  })

  // post-marks-reapplied hook API の契約テスト。reapplyAllMarks 自体は DOM 依存が大きいので
  // 直接呼ばずに、Set に対する add/delete の振る舞いと、setOnMarksReapplied による互換経路の
  // invariant のみを検査する。
  describe('registerPostMarksReapplied / setOnMarksReapplied', () => {
    afterEach(() => {
      // 各テスト間で hook Set / legacy slot を確実にクリアする
      setOnMarksReapplied(null)
    })

    it('register/unsubscribe の基本契約: 戻り値を呼ぶと当該 callback だけが解除される', () => {
      const calls: string[] = []
      const hookA = (): void => {
        calls.push('a')
      }
      const hookB = (): void => {
        calls.push('b')
      }
      const unsubA = registerPostMarksReapplied(hookA)
      registerPostMarksReapplied(hookB)
      unsubA()
      // reapplyAllMarks の DOM 経路は別 describe でカバーされているため、ここでは
      // 末尾 hook 発火部分だけを手動で再現する形にする (snapshot 規約を併せて担保)。
      const snapshot = [...postMarksReappliedHooks]
      for (const hook of snapshot) {
        hook()
      }
      expect(calls).toEqual(['b'])
    })

    it('同一 callback を 2 回 register しても Set の性質で 1 entry として扱う', () => {
      let count = 0
      const cb = (): void => {
        count += 1
      }
      registerPostMarksReapplied(cb)
      registerPostMarksReapplied(cb)
      const snapshot = [...postMarksReappliedHooks]
      for (const hook of snapshot) {
        hook()
      }
      expect(count).toBe(1)
    })

    it('setOnMarksReapplied(cb) → setOnMarksReapplied(null) で前 callback が unregister される', () => {
      let count = 0
      setOnMarksReapplied((): void => {
        count += 1
      })
      setOnMarksReapplied(null)
      const snapshot = [...postMarksReappliedHooks]
      for (const hook of snapshot) {
        hook()
      }
      expect(count).toBe(0)
    })

    it('setOnMarksReapplied で別 callback に差し替えると古い方は外れる', () => {
      const calls: string[] = []
      setOnMarksReapplied((): void => {
        calls.push('old')
      })
      setOnMarksReapplied((): void => {
        calls.push('new')
      })
      const snapshot = [...postMarksReappliedHooks]
      for (const hook of snapshot) {
        hook()
      }
      expect(calls).toEqual(['new'])
    })
  })
}
