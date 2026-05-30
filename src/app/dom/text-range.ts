// ブロック内テキスト ↔ Range の共通 primitive。
// - textSegments: ブロック内テキストノードを位置 (start, end) 付きで平坦化
// - textRangeFromOffsets: 保存値オフセットを DOM ノード両端に解決
// - rangeFromEndpoints: 両端ノードから Range を組み立て (境界違反は null)
// - wrapRange: Range を mark 要素で包む (単一ノード / ノードまたぎ共通、失敗時 skip)
//
// `.code-copy-btn` / `.code-lang-label` / `[data-math]` 等の skip 規則は
// text-segment-skip-rules.ts に集約済み。コメント mark (selection.ts) と
// 検索 mark (search-dom.ts) の両経路がこの 1 ファイル経由で同じ不変条件を共有する。

import { shouldSkipForTextSegments } from './text-segment-skip-rules'

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

/**
 * ブロック要素内のテキストノードを位置 (start, end) 付きで深さ優先で平坦化する。
 * コメントは「ブロック内テキストの先頭からのオフセット」で保存されるため、保存値と DOM ノードの突き合わせにこの一覧を使う。
 */
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
 * テキスト構造が変わって解決できない場合は null を返し、呼び出し側は該当 mark をスキップする (fail-soft)。
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

/** endpoints から `Range` を組み立てる。setStart/End が失敗 (境界違反等) すれば null で握りつぶす */
export const rangeFromEndpoints = (endpoints: TextRangeEndpoints): Range | null => {
  const range = document.createRange()
  try {
    range.setStart(endpoints.startNode, endpoints.startOff)
    range.setEnd(endpoints.endNode, endpoints.endOff)
  } catch {
    return null
  }
  return range
}

/**
 * `range` を `mark` で wrap する。単一テキストノード内なら surroundContents、ノードをまたぐ場合は
 * extractContents + insertNode フォールバック。cmt / search mark 境界をまたぐ等で失敗するケースは skip。
 * 単一ノード判定は `range.startContainer === range.endContainer` で行う。`textRangeFromOffsets`
 * 経由で構築された Range なら startContainer は startNode (Text)、endContainer は endNode (Text) に
 * 一致するため、両端 Text ノード同一性チェックと等価になる。Element 境界 Range を渡された場合も
 * 文法的には動くが、本ファイルの primitive 内では textRangeFromOffsets → rangeFromEndpoints 経由
 * の Range のみを想定している。
 */
export const wrapRange = (range: Range, mark: HTMLElement): void => {
  try {
    if (range.startContainer === range.endContainer) {
      range.surroundContents(mark)
      return
    }
    const contents = range.extractContents()
    mark.appendChild(contents)
    range.insertNode(mark)
  } catch {
    // mark 境界を跨ぐ等で surroundContents / extractContents が失敗するケースは skip
  }
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
      expect(segments.map((seg): string | null => seg.node.textContent)).toEqual([
        'before ',
        ' after',
      ])
    })

    it('skip 属性 [data-footnote-ref] 配下の <sup>N</sup> 文字を除外する', () => {
      const block = buildBlockForTest(
        'See<sup><a data-footnote-ref href="#footnote-1">1</a></sup>.'
      )
      const segments = textSegments(block)
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

    it('未 upgrade (data-mermaid="1" のみ) の <pre> は通常どおり拾う', () => {
      const block = buildBlockForTest(
        'before <pre data-mermaid="1"><code>graph TD</code></pre> after'
      )
      const segments = textSegments(block)
      expect(segments.map((seg): string | null => seg.node.textContent)).toContain('graph TD')
    })
  })

  interface WrapTestParams {
    block: HTMLElement
    className: string
    endOffset: number
    startOffset: number
  }

  const wrapBlockOffsetsForTest = (params: WrapTestParams): HTMLElement | null => {
    const endpoints = textRangeFromOffsets(params.block, params.startOffset, params.endOffset)
    if (!endpoints) {
      return null
    }
    const range = rangeFromEndpoints(endpoints)
    if (!range) {
      return null
    }
    const mark = document.createElement('mark')
    mark.className = params.className
    wrapRange(range, mark)
    return params.block.querySelector<HTMLElement>(`mark.${params.className}`)
  }

  describe('wrapRange', () => {
    it('単一テキストノード内の Range を mark で囲む', () => {
      const block = buildBlockForTest('Hello world')
      const inserted = wrapBlockOffsetsForTest({
        block,
        className: 'test-hl',
        endOffset: 11,
        startOffset: 6,
      })
      expect(inserted instanceof HTMLElement && inserted.textContent).toBe('world')
    })

    it('範囲が解決できない (block 外の offset) と endpoints が null', () => {
      const block = buildBlockForTest('short')
      expect(textRangeFromOffsets(block, 100, 200)).toBeNull()
    })

    it('ノードをまたぐ Range は extractContents + insertNode 経路で 1 mark に集約される', () => {
      const block = buildBlockForTest('abc<strong>def</strong>ghi')
      const inserted = wrapBlockOffsetsForTest({
        block,
        className: 'cross-hl',
        endOffset: 8,
        startOffset: 1,
      })
      expect(inserted instanceof HTMLElement && inserted.textContent).toBe('bcdefgh')
      expect(block.querySelectorAll('mark.cross-hl')).toHaveLength(1)
    })
  })
}
