import type { Comment, PendingSelection } from '../core/types'

/** 選択範囲解析結果。フローター位置決め用の rect 込み */
export interface SelectionInfo extends PendingSelection {
  rect: DOMRect
}

/** ブラウザの選択状態 (Range と Selection の組) を 1 つにまとめた中間表現 */
interface SelectionState {
  range: Range
  sel: Selection
}

/** ブロック内テキストノードを平坦化した 1 区間 */
interface TextSegment {
  start: number
  end: number
  node: Text
}

/** 保存値オフセットから解決した DOM 上の両端ノード＋オフセット */
interface TextRangeEndpoints {
  startNode: Text
  startOff: number
  endNode: Text
  endOff: number
}

interface SegmentOffsets {
  endIndex: number
  endOff: number
  startIndex: number
  startOff: number
}

/** Range と両端ノードを束ねた wrap 対象 */
export interface BuiltDomRange {
  startNode: Text
  endNode: Text
  range: Range
}

/**
 * ブロック要素内のテキストノードを位置 (start, end) 付きで深さ優先で平坦化する。
 * コメントは「ブロック内テキストの先頭からのオフセット」で保存されるため、保存値と DOM ノードの突き合わせにこの一覧を使う。
 */
const textSegments = (blockEl: Element): TextSegment[] => {
  const segments: TextSegment[] = []
  const visit = (node: Node): void => {
    if (node instanceof Text) {
      const previous = segments.at(-1)
      const start = (previous && previous.end) || 0
      segments.push({
        end: start + (node.textContent || '').length,
        node,
        start,
      })
      return
    }
    for (const child of node.childNodes) {
      visit(child)
    }
  }
  visit(blockEl)
  return segments
}

const resolveSegmentOffsets = (
  segments: Pick<TextSegment, 'end' | 'start'>[],
  startOffset: number,
  endOffset: number
): SegmentOffsets | null => {
  const startIndex = segments.findIndex((segment): boolean => segment.end > startOffset)
  const endIndex = segments.findIndex((segment): boolean => segment.end >= endOffset)
  if (startIndex === -1 || endIndex === -1) {
    return null
  }
  return {
    endIndex,
    endOff: endOffset - segments[endIndex].start,
    startIndex,
    startOff: startOffset - segments[startIndex].start,
  }
}

/**
 * 保存値 (startOffset, endOffset) を DOM 上の (startNode, startOff)/(endNode, endOff) に解決する。
 * テキスト構造が変わって解決できない場合は null を返し、呼び出し側は該当 mark をスキップする（fail-soft）。
 */
const textRangeFromOffsets = (
  blockEl: Element,
  startOffset: number,
  endOffset: number
): TextRangeEndpoints | null => {
  const segments = textSegments(blockEl)
  const resolved = resolveSegmentOffsets(segments, startOffset, endOffset)
  if (!resolved) {
    return null
  }
  const start = segments[resolved.startIndex]
  const end = segments[resolved.endIndex]
  return {
    endNode: end.node,
    endOff: resolved.endOff,
    startNode: start.node,
    startOff: resolved.startOff,
  }
}

/** 解決済みオフセットから DOM `Range` を組み立てる。setStart/End が失敗（境界違反等）した場合は null で握りつぶす */
export const buildDomRange = (blockEl: Element, comment: Comment): BuiltDomRange | null => {
  const textRange = textRangeFromOffsets(blockEl, comment.startOffset, comment.endOffset)
  if (!textRange) {
    return null
  }
  const { endNode, endOff, startNode, startOff } = textRange
  const range = document.createRange()
  try {
    range.setStart(startNode, startOff)
    range.setEnd(endNode, endOff)
  } catch {
    return null
  }
  return { endNode, range, startNode }
}

const textOffsetForTextNode = (
  blockEl: Element,
  container: Node,
  offset: number
): number | null => {
  const segment = textSegments(blockEl).find(({ node }): boolean => node === container)
  if (!segment) {
    return null
  }
  return segment.start + offset
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
  return range.toString().length
}

/**
 * 選択範囲の (container, offset) をブロック先頭からのテキストオフセットに変換する。
 * テキストノード直指定なら厳密マッピング、要素境界なら Range の boundary point として解決する。
 */
const textOffsetFromBlock = (blockEl: Element, container: Node, offset: number): number => {
  const fromText = textOffsetForTextNode(blockEl, container, offset)
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

/** 選択範囲の両端を解決し、両端とも有効でかつ非ゼロ幅であることを確認する。条件を満たさなければ null */
const selectionOffsets = (
  block: Element,
  range: Range
): { endOff: number; startOff: number } | null => {
  const startOff = textOffsetFromBlock(block, range.startContainer, range.startOffset)
  const endOff = textOffsetFromBlock(block, range.endContainer, range.endOffset)
  if (startOff < 0 || endOff < 0 || endOff <= startOff) {
    return null
  }
  return { endOff, startOff }
}

/** フローター位置決め＋コメント保存のための情報をまとめる（rect は描画用、それ以外は保存用） */
const buildSelectionInfo = (
  selection: SelectionState,
  block: HTMLElement,
  offsets: { endOff: number; startOff: number }
): SelectionInfo => {
  const { range, sel } = selection
  const { endOff, startOff } = offsets
  return {
    blockId: block.dataset.blockId || '',
    endOffset: endOff,
    quote: sel.toString(),
    rect: range.getBoundingClientRect(),
    startOffset: startOff,
  }
}

/**
 * 現在の選択範囲を解析し、フローター表示／コメント保存に必要な全情報を 1 オブジェクトで返す。
 * いずれかの段階で無効ならすべて null を返し、UI 側はフローターを隠す判定に使う。
 */
export const getSelectionInfo = (): SelectionInfo | null => {
  const selection = currentSelectionRange()
  if (!selection) {
    return null
  }
  const block = blockForSelectionRange(selection.range)
  if (!block) {
    return null
  }
  const offsets = selectionOffsets(block, selection.range)
  if (!offsets) {
    return null
  }
  return buildSelectionInfo(selection, block, offsets)
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('resolveSegmentOffsets', () => {
    it('複数セグメントをまたぐ保存 offset をノード内 offset に変換する', () => {
      const segments = [
        { end: 2, start: 0 },
        { end: 5, start: 2 },
      ]
      expect(resolveSegmentOffsets(segments, 1, 4)).toEqual({
        endIndex: 1,
        endOff: 2,
        startIndex: 0,
        startOff: 1,
      })
    })

    it('終端 offset はセグメント末尾と等しい位置を有効にする', () => {
      const segments = [
        { end: 2, start: 0 },
        { end: 5, start: 2 },
      ]
      expect(resolveSegmentOffsets(segments, 0, 2)).toEqual({
        endIndex: 0,
        endOff: 2,
        startIndex: 0,
        startOff: 0,
      })
    })

    it('範囲外 offset は null', () => {
      expect(resolveSegmentOffsets([{ end: 2, start: 0 }], 5, 6)).toBeNull()
    })
  })
}
