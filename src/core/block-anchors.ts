// markdown ソース上のブロック位置と祖先見出しを保持する anchor を、`marked.lexer` の
// トップレベルトークン列から組み立てる。レンダリング (markdown.ts) と export (review-export.ts)
// の双方が参照する純粋ロジックで、DOM や Node 専用 API は持たない。

import { marked } from 'marked'

/**
 * markdown ソース上のブロック位置と祖先見出しを保持する anchor。
 * sourceLine は 1-origin の行番号。headingPath は raw 形式（`## Title` を含む）の祖先見出しを浅い順に並べる。
 * heading 自体のブロックの headingPath は祖先のみ（その heading 自身は含めない）。
 */
export interface BlockAnchor {
  headingPath: string[]
  sourceLine: number
}

interface HeadingStackEntry {
  level: number
  raw: string
}

const countNewlines = (text: string): number => (text.match(/\n/g) || []).length

const blockIdFromIndex = (index: number): string => `b${String(index).padStart(3, '0')}`

const getHeadingDepth = (token: { depth?: unknown; type: string }): number | null => {
  if (token.type !== 'heading') {
    return null
  }
  if (typeof token.depth !== 'number') {
    return null
  }
  return token.depth
}

const popSameOrDeeperHeadings = (headingStack: HeadingStackEntry[], headingDepth: number): void => {
  while (headingStack.length > 0) {
    const lastHeading = headingStack[headingStack.length - 1]
    if (lastHeading.level < headingDepth) {
      return
    }
    headingStack.pop()
  }
}

const addTokenAnchor = ({
  anchors,
  blockIndex,
  headingStack,
  lineCursor,
  token,
}: {
  anchors: Map<string, BlockAnchor>
  blockIndex: number
  headingStack: HeadingStackEntry[]
  lineCursor: number
  token: { raw: string; type: string; depth?: unknown }
}): number => {
  const nextBlockIndex = blockIndex + 1
  const blockId = blockIdFromIndex(nextBlockIndex)
  const headingDepth = getHeadingDepth(token)

  if (typeof headingDepth === 'number') {
    popSameOrDeeperHeadings(headingStack, headingDepth)
  }

  anchors.set(blockId, {
    headingPath: headingStack.map((heading): string => heading.raw),
    sourceLine: lineCursor,
  })

  if (typeof headingDepth === 'number') {
    headingStack.push({ level: headingDepth, raw: token.raw.replace(/\n+$/, '') })
  }

  return nextBlockIndex
}

const requireAnchor = (anchors: Map<string, BlockAnchor>, blockId: string): BlockAnchor => {
  const anchor = anchors.get(blockId)
  if (!anchor) {
    throw new Error(`Anchor not found: ${blockId}`)
  }
  return anchor
}

/**
 * `marked.lexer` のトップレベルトークンを走査して、blockId → { sourceLine, headingPath } の Map を作る。
 * `space` トークンは DOM 上のブロックに対応しないため blockIndex を進めずに行カーソルだけ進める。
 * 連番採番は `cacheBlockOriginalHTML` が DOM 側で行うものと揃える前提（lexer の top-level token のうち space 以外）。
 */
export const buildBlockAnchors = (markdown: string): Map<string, BlockAnchor> => {
  const tokens = marked.lexer(markdown)
  const anchors = new Map<string, BlockAnchor>()
  const headingStack: HeadingStackEntry[] = []
  let lineCursor = 1
  let blockIndex = 0

  for (const token of tokens) {
    if (token.type !== 'space') {
      blockIndex = addTokenAnchor({ anchors, blockIndex, headingStack, lineCursor, token })
    }
    lineCursor += countNewlines(token.raw)
  }

  return anchors
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('buildBlockAnchors', () => {
    it('連続するブロックに 1-origin の開始行を振る', () => {
      const anchors = buildBlockAnchors('# H1\n\nPara1\n\nPara2\n')
      expect(requireAnchor(anchors, 'b001').sourceLine).toBe(1)
      expect(requireAnchor(anchors, 'b002').sourceLine).toBe(3)
      expect(requireAnchor(anchors, 'b003').sourceLine).toBe(5)
    })

    it('heading 自身のブロックの headingPath は祖先のみ（自分は含めない）', () => {
      const anchors = buildBlockAnchors('# Root\n\n## Sub\n\nBody\n')
      expect(requireAnchor(anchors, 'b001').headingPath).toEqual([])
      expect(requireAnchor(anchors, 'b002').headingPath).toEqual(['# Root'])
      expect(requireAnchor(anchors, 'b003').headingPath).toEqual(['# Root', '## Sub'])
    })

    it('同じ深さの heading が来たら祖先を pop して差し替える', () => {
      const anchors = buildBlockAnchors('# A\n\nP1\n\n# B\n\nP2\n')
      expect(requireAnchor(anchors, 'b002').headingPath).toEqual(['# A'])
      expect(requireAnchor(anchors, 'b003').headingPath).toEqual([])
      expect(requireAnchor(anchors, 'b004').headingPath).toEqual(['# B'])
    })

    it('浅い heading が来たら深い heading をすべて閉じる', () => {
      const anchors = buildBlockAnchors('# A\n\n## A.1\n\n### A.1.1\n\n## A.2\n\nbody\n')
      expect(requireAnchor(anchors, 'b005').headingPath).toEqual(['# A', '## A.2'])
    })

    it('見出しがない markdown では headingPath が空配列になる', () => {
      const anchors = buildBlockAnchors('Para1\n\nPara2\n')
      expect(requireAnchor(anchors, 'b001').headingPath).toEqual([])
      expect(requireAnchor(anchors, 'b002').headingPath).toEqual([])
    })

    it('コードブロック等の複数行ブロックは raw の改行数で次の行カーソルを進める', () => {
      const anchors = buildBlockAnchors('# H1\n\n```js\nconst x=1;\nconst y=2;\n```\n\nAfter\n')
      expect(requireAnchor(anchors, 'b002').sourceLine).toBe(3)
      expect(requireAnchor(anchors, 'b003').sourceLine).toBe(8)
    })

    // markdown.ts の renderer.table が <table> を <div class="table-wrap"> で包む変更を入れても、
    // lexer 側の table token カウントは 1 のままで、その後ろのブロックの blockId 番号・sourceLine が
    // ズレないことを構造的に担保する (mark-engine がブロック内テキストに mark を貼る前提)。
    it('table ブロックを挟んでも後続ブロックの blockId 連番と sourceLine が乱れない', () => {
      const anchors = buildBlockAnchors(
        '# H1\n\nPara\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nAfter\n'
      )
      expect(requireAnchor(anchors, 'b001').sourceLine).toBe(1)
      expect(requireAnchor(anchors, 'b002').sourceLine).toBe(3)
      expect(requireAnchor(anchors, 'b003').sourceLine).toBe(5)
      expect(requireAnchor(anchors, 'b003').headingPath).toEqual(['# H1'])
      expect(requireAnchor(anchors, 'b004').sourceLine).toBe(9)
      expect(requireAnchor(anchors, 'b004').headingPath).toEqual(['# H1'])
    })
  })
}
