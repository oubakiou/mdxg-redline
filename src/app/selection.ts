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
export interface TextSegment {
  start: number
  end: number
  node: Text
}

/** 保存値オフセットから解決した DOM 上の両端ノード＋オフセット */
export interface TextRangeEndpoints {
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
 *
 * `.code-copy-btn` / `.code-lang-label` 配下は skip する: どちらも描画時の動的注入で
 * レビュー対象 markdown 由来でなく、その text node を含めると wrap の有無 (再描画前後 /
 * ネストブロック vs トップレベル) で textContent が変動しオフセットがズレるため。
 */
const SKIP_TEXT_SEGMENT_CLASSES = ['code-copy-btn', 'code-lang-label']

// upgrade 済み mermaid ブロックは「ダイアグラム全体を検索 / コメント対象外にする」案 A
// (docs/mdxg-diagram-rendering.md §4 Step 6) のため、<pre[data-mermaid-applied]> と
// 兄弟の <svg[data-mermaid-svg]> 両方を skip 対象に含める。<pre> の textContent は
// 元コードをそのまま保持するが、SVG レンダリング後はその出現位置でコメントを付ける UX 価値が
// 薄く、SVG 内 textContent (Mermaid 生成のノード / arrow ラベル) も検索結果として scrollIntoView
// しづらいため一括で除外する。未 upgrade (data-mermaid="1" のみ) の <pre> は通常どおり拾われ、
// Shiki ハイライト fallback 時の検索 / コメント対象として残る。
const SKIP_TEXT_SEGMENT_ATTRS: readonly { attr: string; value: string }[] = [
  { attr: 'data-mermaid-applied', value: '1' },
  { attr: 'data-mermaid-svg', value: '1' },
]

const shouldSkipForTextSegments = (node: Node): boolean => {
  if (!(node instanceof Element)) {
    return false
  }
  if (SKIP_TEXT_SEGMENT_CLASSES.some((cls): boolean => node.classList.contains(cls))) {
    return true
  }
  return SKIP_TEXT_SEGMENT_ATTRS.some(
    ({ attr, value }): boolean => node.getAttribute(attr) === value
  )
}

export const textSegments = (blockEl: Element): TextSegment[] => {
  const segments: TextSegment[] = []
  const visit = (node: Node): void => {
    if (shouldSkipForTextSegments(node)) {
      return
    }
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
 *
 * `app/search.ts` から match の `[start, end)` を Range に直す経路でも再利用する。
 */
export const textRangeFromOffsets = (
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
}
