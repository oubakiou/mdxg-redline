import type { Comment, PendingSelection } from '../../core/types'
import { SKIP_TEXT_SEGMENT_SELECTOR } from '../dom/text-segment-skip-rules'
import {
  type TextSegment,
  rangeFromEndpoints,
  textRangeFromOffsets,
  textSegments,
} from '../dom/text-range'

/** 選択範囲解析結果。フローター位置決め用の rect 込み */
export interface SelectionInfo extends PendingSelection {
  rect: DOMRect
}

/** ブラウザの選択状態 (Range と Selection の組) を 1 つにまとめた中間表現 */
interface SelectionState {
  range: Range
  sel: Selection
}

/** 解決済みオフセットから DOM `Range` を組み立てる。setStart/End が失敗（境界違反等）した場合は null で握りつぶす */
export const buildDomRange = (blockEl: Element, comment: Comment): Range | null => {
  const textRange = textRangeFromOffsets(blockEl, comment.startOffset, comment.endOffset)
  if (!textRange) {
    return null
  }
  return rangeFromEndpoints(textRange)
}

// segments.find は `node === container` の参照同一性しか見ないため、両側を unknown で受ける。
// production の呼び出しでは segments: TextSegment[] / container: Node が渡るが、いずれも
// unknown のサブタイプなのでそのまま通る。テスト側は Text 互換キャストなしで identity 値を渡せる。
const textOffsetForTextNode = (
  segments: { node: unknown; start: number }[],
  container: unknown,
  offset: number
): number | null => {
  const segment = segments.find(({ node }): boolean => node === container)
  if (!segment) {
    return null
  }
  return segment.start + offset
}

// SKIP_TEXT_SEGMENT_SELECTOR は app/text-segment-skip-rules.ts に集約済み。

// blockEl 内の textSegments-skip 対象子孫のうち、`range` の中に完全に含まれるものの
// textContent 長を合算する。textSegments は要素ごと skip して segment を発行しないため、
// 要素境界経路 (`range.toString().length`) から同じ長さを引いて整合させる必要がある。
//
// upgrade 前後で textContent が変わる math (`$x$` 3 chars → KaTeX 出力数十 chars) や、
// source markdown と DOM で長さが違う footnote-ref (`[^1]` 4 chars → `1` 1 char) も
// 同じ経路で吸収される。
const skippedTextLengthInRange = (blockEl: Element, range: Range): number => {
  const skipped = blockEl.querySelectorAll<HTMLElement>(SKIP_TEXT_SEGMENT_SELECTOR)
  let total = 0
  for (const el of skipped) {
    const elRange = document.createRange()
    elRange.selectNode(el)
    // 要素全体が range の中に入っているか: range の start <= elRange.start かつ
    // elRange.end <= range の end の両方を満たす場合のみカウント。
    const startsAfterRangeStart = range.compareBoundaryPoints(Range.START_TO_START, elRange) <= 0
    const endsBeforeRangeEnd = range.compareBoundaryPoints(Range.END_TO_END, elRange) >= 0
    if (startsAfterRangeStart && endsBeforeRangeEnd) {
      total += (el.textContent ?? '').length
    }
  }
  return total
}

const textOffsetForElementBoundary = (
  blockEl: Element,
  container: Node,
  offset: number
): number | null => {
  if (!(container instanceof Element) || !blockEl.contains(container)) {
    return null
  }
  const boundedOffset = Math.max(0, Math.min(offset, container.childNodes.length))
  const range = document.createRange()
  range.selectNodeContents(blockEl)
  range.setEnd(container, boundedOffset)
  // textSegments と整合させるため、range 内の skip 対象子孫の textContent を引く。
  // textSegments は要素ごと skip するため、要素境界経路でも同じ長さを除外する必要がある。
  return range.toString().length - skippedTextLengthInRange(blockEl, range)
}

/**
 * 選択範囲の (container, offset) をブロック先頭からのテキストオフセットに変換する。
 * テキストノード直指定なら平坦化済み segments への線形探索、
 * 要素境界なら Range の boundary point として解決する。
 * segments は呼び出し側で 1 度だけ計算したものを渡し、start/end の 2 回探索で再計算しない。
 */
const textOffsetFromBlock = ({
  blockEl,
  container,
  offset,
  segments,
}: {
  blockEl: Element
  container: Node
  offset: number
  segments: TextSegment[]
}): number => {
  const fromText = textOffsetForTextNode(segments, container, offset)
  if (fromText !== null) {
    return fromText
  }
  const fromElement = textOffsetForElementBoundary(blockEl, container, offset)
  if (fromElement !== null) {
    return fromElement
  }
  return -1
}

/** ブラウザの選択状態から `Range` と Selection オブジェクトを取り出す。未選択・空白のみは無効として null を返す */
const currentSelectionRange = (): SelectionState | null => {
  const sel = globalThis.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    return null
  }
  const range = sel.getRangeAt(0)
  const text = sel.toString().trim()
  if (!text) {
    return null
  }
  return { range, sel }
}

/** Range の共通祖先を返す。テキストノード祖先の場合は親要素まで持ち上げて closest 検索に渡せる形にする */
const nodeForSelectionRange = (range: Range): Node | null => {
  const ancestor = range.commonAncestorContainer
  if (ancestor.nodeType === Node.TEXT_NODE) {
    return ancestor.parentElement
  }
  return ancestor
}

/** 選択範囲が属する最も近いコメント可能ブロック（data-block-id 付き）を返す */
const blockForSelectionRange = (range: Range): HTMLElement | null => {
  const node = nodeForSelectionRange(range)
  if (node instanceof Element) {
    const block = node.closest('[data-block-id]')
    if (block instanceof HTMLElement) {
      return block
    }
  }
  return null
}

/**
 * `block` の祖先 `<section.virtual-page>` から page index を取り出す。
 * Stacked View では全 page の section が `data-page-index` を持っており、これが
 * 新規 Comment の `pageIndex` 必須化 (§6.5) を満たすための信頼できる起点になる。
 * 祖先 section が無い / 数値化できない場合は null を返し、上位はその選択を無効扱いにする。
 */
const pageIndexForBlock = (block: HTMLElement): number | null => {
  const section = block.closest<HTMLElement>('section.virtual-page')
  if (!section) {
    return null
  }
  const raw = section.dataset.pageIndex
  if (typeof raw !== 'string') {
    return null
  }
  const parsed = Number.parseInt(raw, 10)
  if (Number.isNaN(parsed)) {
    return null
  }
  return parsed
}

/**
 * 選択範囲の両端を解決し、両端とも有効でかつ非ゼロ幅であることを確認する。
 * textSegments(block) を 1 度だけ計算して start/end 両方の解決に流用する。
 * 条件を満たさなければ null。
 */
const selectionOffsets = (
  block: Element,
  range: Range
): { endOff: number; startOff: number } | null => {
  const segments = textSegments(block)
  const startOff = textOffsetFromBlock({
    blockEl: block,
    container: range.startContainer,
    offset: range.startOffset,
    segments,
  })
  const endOff = textOffsetFromBlock({
    blockEl: block,
    container: range.endContainer,
    offset: range.endOffset,
    segments,
  })
  if (startOff < 0 || endOff < 0 || endOff <= startOff) {
    return null
  }
  return { endOff, startOff }
}

interface SelectionContext {
  block: HTMLElement
  offsets: { endOff: number; startOff: number }
  pageIndex: number
  selection: SelectionState
}

/** フローター位置決め＋コメント保存のための情報をまとめる（rect は描画用、それ以外は保存用） */
const buildSelectionInfo = (context: SelectionContext): SelectionInfo => {
  const { range, sel } = context.selection
  const { endOff, startOff } = context.offsets
  return {
    blockId: context.block.dataset.blockId || '',
    endOffset: endOff,
    pageIndex: context.pageIndex,
    quote: sel.toString(),
    rect: range.getBoundingClientRect(),
    startOffset: startOff,
  }
}

/**
 * 現在の選択範囲を解析し、フローター表示／コメント保存に必要な全情報を 1 オブジェクトで返す。
 * いずれかの段階で無効ならすべて null を返し、UI 側はフローターを隠す判定に使う。
 */
/**
 * 選択範囲の祖先からコメント可能ブロックと、その祖先 section の page index を一括解決する。
 * 片方でも解決できなければ null を返し、上位の getSelectionInfo はその選択を無効扱いにする。
 */
const resolveBlockAndPage = (range: Range): { block: HTMLElement; pageIndex: number } | null => {
  const block = blockForSelectionRange(range)
  if (!block) {
    return null
  }
  const pageIndex = pageIndexForBlock(block)
  if (pageIndex === null) {
    return null
  }
  return { block, pageIndex }
}

export const getSelectionInfo = (): SelectionInfo | null => {
  const selection = currentSelectionRange()
  if (!selection) {
    return null
  }
  const resolved = resolveBlockAndPage(selection.range)
  if (!resolved) {
    return null
  }
  const offsets = selectionOffsets(resolved.block, selection.range)
  if (!offsets) {
    return null
  }
  return buildSelectionInfo({ ...resolved, offsets, selection })
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('textOffsetForTextNode', () => {
    // segments.find は `node === container` の参照同一性しか見ないため、テストでは
    // Symbol を identity マーカーに使う (object literal だと structural equal で誤マッチする懸念を排除)。
    it('container が segments のいずれかと一致したら start + offset を返す', () => {
      const nodeA = Symbol('a')
      const nodeB = Symbol('b')
      const segments = [
        { node: nodeA, start: 0 },
        { node: nodeB, start: 5 },
      ]
      expect(textOffsetForTextNode(segments, nodeB, 3)).toBe(8)
    })

    it('container が segments に含まれない場合は null (要素境界等のフォールバック呼び出し用)', () => {
      const nodeA = Symbol('a')
      const stranger = Symbol('stranger')
      const segments = [{ node: nodeA, start: 0 }]
      expect(textOffsetForTextNode(segments, stranger, 0)).toBeNull()
    })

    it('offset 0 でも segment.start を正しく返す (boundary)', () => {
      const nodeA = Symbol('a')
      const segments = [{ node: nodeA, start: 12 }]
      expect(textOffsetForTextNode(segments, nodeA, 0)).toBe(12)
    })
  })

  // textSegments / resolveSegmentOffsets / SKIP_TEXT_SEGMENT_* の identity contract は
  // dom/text-range.ts と dom/text-segment-skip-rules.ts の in-source test 群に集約済み。
}
