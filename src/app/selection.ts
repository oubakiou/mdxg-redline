import type { Comment, PendingSelection } from '../core/types'
import { MERMAID_ATTR, MERMAID_ATTR_VALUE } from '../core/mermaid-attrs'

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
// `sr-only` は marked-footnote 1.4.0 が <section.footnotes> 冒頭に強制挿入する
// `<h2 id="footnote-label" class="sr-only">Footnotes</h2>` を textSegments から外すための
// クラス指定 (docs/mdxg-footnotes.md §3.1 / §4.3)。a11y 用 visible-hidden な合成見出しを
// コメント / 検索の対象に含めない。命名規約として `sr-only` は本実装内で footnote section
// 専用の用途しか持たないため、generic class として skip しても他経路への副作用は無い。
const SKIP_TEXT_SEGMENT_CLASSES = ['code-copy-btn', 'code-lang-label', 'sr-only']

// upgrade 済み mermaid ブロックは「ダイアグラム全体を検索 / コメント対象外にする」案 A
// (docs/mdxg-diagram-rendering.md §4 Step 6) のため、<pre[data-mermaid-applied]> と
// 兄弟の <svg[data-mermaid-svg]> 両方を skip 対象に含める。<pre> の textContent は
// 元コードをそのまま保持するが、SVG レンダリング後はその出現位置でコメントを付ける UX 価値が
// 薄く、SVG 内 textContent (Mermaid 生成のノード / arrow ラベル) も検索結果として scrollIntoView
// しづらいため一括で除外する。未 upgrade (data-mermaid="1" のみ) の <pre> は通常どおり拾われ、
// Shiki ハイライト fallback 時の検索 / コメント対象として残る。
//
// 数式 (`[data-math]`) も同じく skip 対象にする (docs/mdxg-math-rendering.archive.md §6 / Step 6)。
// 理由:
//   - upgrade 前は `<span data-math="inline">$x$</span>` の textContent が `$x$` (3 文字)
//   - upgrade 後は KaTeX 出力 (MathML + HTML span) で textContent が大きく変化
//   この変化を抱えたままだと §6 アンカリングのオフセット計算が upgrade 前後で食い違い、
//   embedded-feedback の cmt mark が貼り直し時に飛ぶ。要素ごと skip すれば textSegments の
//   出力は upgrade 前後で完全に同じになる (要素は無視され、周辺 text node の連続性も保たれる)。
// トレードオフ:
//   - 数式要素そのものに対するコメント付与は不可 (§1 の対応スコープ宣言で「数式へのコメント
//     付与は対応外」と明文化済み)
//   - §10 Search の「LaTeX ソース検索」(設計書 Step 6 §10) は将来拡張に回す
const SKIP_TEXT_SEGMENT_ATTRS: readonly { attr: string; value: string }[] = [
  { attr: MERMAID_ATTR.applied, value: MERMAID_ATTR_VALUE },
  { attr: MERMAID_ATTR.svg, value: MERMAID_ATTR_VALUE },
]

// 属性の有無だけで skip 判定する (値は問わない) 系統。`data-math` は 'inline' / 'display' の
// 2 値を取るが、いずれも skip 対象なので値マッチではなく hasAttribute で十分。
//
// `data-footnote-ref` / `data-footnote-backref` は marked-footnote 1.4.0 が脚注の参照 / backref
// `<a>` に付与する属性 (docs/mdxg-footnotes.md §3.1 / §5.e / §6 / Step 6)。
// - ref: `<sup><a id="footnote-ref-<id>" data-footnote-ref ...>N</a></sup>` の `<a>` を skip する
//   ことで `<sup>` 配下の合成 `N` 文字を textSegments から外す。DOM textContent (1 文字) と
//   source markdown (`[^<id>]` 4+ 文字) の長さ差で offset がズレる現象を構造的に防ぐ
//   (Math `[data-math]` skip と同じパターン)。raw `[^<id>]` への変換経路は将来の拡張で対応
// - backref: 合成 UI 要素 (`↩` の単一文字、source markdown には存在しない) を walk skip して
//   コメント / 検索の対象から外す
const SKIP_TEXT_SEGMENT_ATTR_NAMES: readonly string[] = [
  'data-math',
  'data-footnote-ref',
  'data-footnote-backref',
]

const shouldSkipForTextSegments = (node: Node): boolean => {
  if (!(node instanceof Element)) {
    return false
  }
  if (SKIP_TEXT_SEGMENT_CLASSES.some((cls): boolean => node.classList.contains(cls))) {
    return true
  }
  if (SKIP_TEXT_SEGMENT_ATTR_NAMES.some((attr): boolean => node.hasAttribute(attr))) {
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

// textSegments が要素ごと skip する全カテゴリを 1 つのセレクタに集約する。
// `shouldSkipForTextSegments` の判定 (SKIP_TEXT_SEGMENT_CLASSES / SKIP_TEXT_SEGMENT_ATTR_NAMES /
// SKIP_TEXT_SEGMENT_ATTRS) と 1:1 対応させ、要素境界経路の `range.toString().length` 補正から
// 漏れがないようにする (review feedback Medium 指摘: Step 6 で footnote skip を追加したが
// 補正側が math 専用のままで `<sup>1</sup>` / `<a>↩</a>` 分の長さがズレる現象への対応)。
const SKIP_TEXT_SEGMENT_SELECTOR = [
  '[data-math]',
  '[data-footnote-ref]',
  '[data-footnote-backref]',
  '.code-copy-btn',
  '.code-lang-label',
  '.sr-only',
  `[${MERMAID_ATTR.applied}="${MERMAID_ATTR_VALUE}"]`,
  `[${MERMAID_ATTR.svg}="${MERMAID_ATTR_VALUE}"]`,
].join(', ')

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

const buildBlockForTest = (html: string): HTMLElement => {
  const block = document.createElement('div')
  block.innerHTML = html
  return block
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

  // docs/mdxg-math-rendering.archive.md §6 / Step 6: [data-math] 要素は upgrade 前後で textContent が
  // 大きく変化する (raw `$x$` → KaTeX 出力の MathML+HTML)。`shouldSkipForTextSegments` が
  // `SKIP_TEXT_SEGMENT_ATTR_NAMES` 経由で `data-math` を hasAttribute で skip 対象に含めることで、
  // textSegments の出力が upgrade 前後で完全に一致し、§6 アンカリングの cmt mark 貼付経路が
  // 壊れない。DOM ベースの統合テストは現在のテスト環境 (node、DOM 未提供) では書けないため
  // (DESIGN.md §12「DOM 依存ロジックのテスト環境追加」が将来拡張として残る論点)、ここでは
  // skip 経路の存在自体は SKIP_TEXT_SEGMENT_ATTR_NAMES 配列の constant に対する identity check で
  // 担保する (production の attribute 名が `data-math` から逸脱したら本テストが落ちる)。
  describe('SKIP_TEXT_SEGMENT_ATTR_NAMES (data-math 連動契約)', () => {
    it("'data-math' を skip 対象として含む", () => {
      expect(SKIP_TEXT_SEGMENT_ATTR_NAMES).toContain('data-math')
    })
  })

  // docs/mdxg-footnotes.md §3.1 / §5.e / §6 / Step 6: marked-footnote 1.4.0 が出力する
  // `<a data-footnote-ref>` / `<a data-footnote-backref>` を `<sup>` 配下から skip することで、
  // source markdown (`[^<id>]` 4+ 文字) と DOM textContent (`1` 1 文字) の食い違いで offset が
  // ズレるのを防ぐ。backref の `↩` も合成 UI 要素として走査対象から外す。
  describe('SKIP_TEXT_SEGMENT_ATTR_NAMES (data-footnote-* 連動契約)', () => {
    it("'data-footnote-ref' を skip 対象として含む", () => {
      expect(SKIP_TEXT_SEGMENT_ATTR_NAMES).toContain('data-footnote-ref')
    })

    it("'data-footnote-backref' を skip 対象として含む", () => {
      expect(SKIP_TEXT_SEGMENT_ATTR_NAMES).toContain('data-footnote-backref')
    })
  })

  // marked-footnote 1.4.0 が `<section[data-footnotes]>` 冒頭に強制挿入する
  // `<h2 id="footnote-label" class="sr-only">Footnotes</h2>` を skip するための class 契約。
  describe('SKIP_TEXT_SEGMENT_CLASSES (sr-only 連動契約)', () => {
    it("'sr-only' を skip 対象として含む", () => {
      expect(SKIP_TEXT_SEGMENT_CLASSES).toContain('sr-only')
    })
  })

  describe('textSegments (DOM)', () => {
    it('plain text を 1 segment として返す (start=0, end=text.length)', () => {
      const block = buildBlockForTest('Hello world')
      const segments = textSegments(block)
      expect(segments).toHaveLength(1)
      expect(segments[0].start).toBe(0)
      expect(segments[0].end).toBe(11)
      expect(segments[0].node.textContent).toBe('Hello world')
    })

    it('inline 装飾をまたぐと複数 segment に分かれ、start/end が累積する', () => {
      // `abc<strong>def</strong>ghi` → "abc" / "def" / "ghi" の 3 segment
      const block = buildBlockForTest('abc<strong>def</strong>ghi')
      const segments = textSegments(block)
      expect(segments).toHaveLength(3)
      expect(segments.map((seg): [number, number] => [seg.start, seg.end])).toEqual([
        [0, 3],
        [3, 6],
        [6, 9],
      ])
    })

    it('skip class (sr-only) 配下のテキストは segment に含めない', () => {
      // marked-footnote 1.4.0 が挿入する <h2 class="sr-only">Footnotes</h2> 相当
      const block = buildBlockForTest('<h2 class="sr-only">Footnotes</h2><p>body</p>')
      const segments = textSegments(block)
      expect(segments.map((seg): string | null => seg.node.textContent)).toEqual(['body'])
    })

    it('skip class (code-copy-btn / code-lang-label) 配下を除外する', () => {
      const block = buildBlockForTest(
        '<span class="code-lang-label">typescript</span>' +
          '<pre>const x = 1</pre>' +
          '<button class="code-copy-btn"><span>Copy</span></button>'
      )
      const segments = textSegments(block)
      expect(segments.map((seg): string | null => seg.node.textContent)).toEqual(['const x = 1'])
    })

    it('skip 属性 [data-math] 配下を除外する (upgrade 前後で textContent 不変条件)', () => {
      const block = buildBlockForTest(
        'before <span data-math="inline" data-math-source="x">$x$</span> after'
      )
      const segments = textSegments(block)
      // "$x$" 部分が消える。" before " と " after " で 2 segment (前後の空白込み)
      expect(segments.map((seg): string | null => seg.node.textContent)).toEqual([
        'before ',
        ' after',
      ])
    })

    it('skip 属性 [data-footnote-ref] 配下の <sup>N</sup> 文字を除外する', () => {
      // marked-footnote 出力: <sup><a id="footnote-ref-1" data-footnote-ref href="#footnote-1">1</a></sup>
      const block = buildBlockForTest(
        'See<sup><a data-footnote-ref href="#footnote-1">1</a></sup>.'
      )
      const segments = textSegments(block)
      // <a data-footnote-ref> 配下の "1" が消える。"See" と "." だけが残る
      expect(segments.map((seg): string | null => seg.node.textContent)).toEqual(['See', '.'])
    })

    it('skip 属性 [data-footnote-backref] 配下の ↩ を除外する', () => {
      const block = buildBlockForTest('body <a data-footnote-backref href="#footnote-ref-1">↩</a>')
      const segments = textSegments(block)
      expect(segments.map((seg): string | null => seg.node.textContent)).toEqual(['body '])
    })

    it('Mermaid upgrade 済み <pre[data-mermaid-applied]> 配下を除外する', () => {
      const block = buildBlockForTest(
        'before <pre data-mermaid="1" data-mermaid-applied="1" hidden><code>graph TD</code></pre> after'
      )
      const segments = textSegments(block)
      expect(segments.map((seg): string | null => seg.node.textContent)).toEqual([
        'before ',
        ' after',
      ])
    })

    it('未 upgrade (data-mermaid="1" のみ) の <pre> は通常どおり拾う (Shiki ハイライト fallback の検索対象)', () => {
      const block = buildBlockForTest(
        'before <pre data-mermaid="1"><code>graph TD</code></pre> after'
      )
      const segments = textSegments(block)
      expect(segments.map((seg): string | null => seg.node.textContent)).toContain('graph TD')
    })
  })
}
