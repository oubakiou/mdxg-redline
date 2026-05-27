// markdown ソース上のブロック位置と祖先見出しを保持する anchor を、`marked.lexer` の
// トップレベルトークン列から組み立てる。レンダリング (markdown.ts) と export (review-export.ts)
// の双方が参照する純粋ロジックで、DOM や Node 専用 API は持たない。

import { Marked } from 'marked'
import footnote from 'marked-footnote'

// footnote 拡張は global `marked` singleton に use しない (core/markdown.ts と同じ理由:
// 共有 singleton の lexer 出力が壊れて他モジュールが silent に壊れる)。専用 instance に閉じる。
// Step 1 PoC で確定した「同一 instance で lexer / parse cross-call すると crash する」bug の
// 範囲外 (本モジュールは lexer のみ呼ぶ単方向)。
const createFootnoteAwareLexer = (): Marked => {
  const instance = new Marked()
  instance.use(footnote())
  return instance
}

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

const requireAnchor = (anchors: Map<string, BlockAnchor>, blockId: string): BlockAnchor => {
  const anchor = anchors.get(blockId)
  if (!anchor) {
    throw new Error(`Anchor not found: ${blockId}`)
  }
  return anchor
}

interface AnchorPosition {
  headingPath: string[]
  sourceLine: number
}

/**
 * lexer 出力から documentary block / footnote definition の anchor 情報を計算する。
 * - documentary: top-level token のうち `space` / `footnotes` (synthetic placeholder) / `footnote` を
 *   除いたものを文書順に並べた配列。DOM 側の `cacheBlockOriginalHTML` は section.virtual-page
 *   配下の (footnotes section を除く) 子要素を文書順に走査するため、本配列の index と DOM 順が
 *   1:1 で対応する
 * - footnoteByLabel: `footnote` token を label でひける Map。marked-footnote は DOM 上で `<li>` を
 *   **参照順**で並べる (Step 4 PoC `.temp/footnote-poc-order.mjs` で確認) ため、定義順を保つ lexer
 *   側の sourceLine とは順序が異なる。よって配列 index ではなく label で逆引きする経路を取る
 */
export interface AnchorPositionsResult {
  documentary: AnchorPosition[]
  footnoteByLabel: Map<string, AnchorPosition>
}

const popHeadingsIfNeeded = (
  headingStack: HeadingStackEntry[],
  token: { depth?: unknown; raw: string; type: string }
): void => {
  const depth = getHeadingDepth(token)
  if (typeof depth !== 'number') {
    return
  }
  popSameOrDeeperHeadings(headingStack, depth)
}

const pushHeadingIfNeeded = (
  headingStack: HeadingStackEntry[],
  token: { depth?: unknown; raw: string; type: string }
): void => {
  const depth = getHeadingDepth(token)
  if (typeof depth !== 'number') {
    return
  }
  headingStack.push({ level: depth, raw: token.raw.replace(/\n+$/, '') })
}

const snapshotHeadingPath = (headingStack: HeadingStackEntry[]): string[] =>
  headingStack.map((heading): string => heading.raw)

const recordFootnoteAnchor = (
  footnoteByLabel: Map<string, AnchorPosition>,
  token: { label?: unknown; raw: string; type: string },
  position: AnchorPosition
): void => {
  if (typeof token.label === 'string') {
    footnoteByLabel.set(token.label, position)
  }
}

interface ProcessTokenContext {
  documentary: AnchorPosition[]
  footnoteByLabel: Map<string, AnchorPosition>
  headingStack: HeadingStackEntry[]
  lineCursor: number
}

const processDocumentaryToken = (
  context: ProcessTokenContext,
  token: { depth?: unknown; raw: string; type: string }
): void => {
  popHeadingsIfNeeded(context.headingStack, token)
  context.documentary.push({
    headingPath: snapshotHeadingPath(context.headingStack),
    sourceLine: context.lineCursor,
  })
  pushHeadingIfNeeded(context.headingStack, token)
}

const processFootnoteToken = (
  context: ProcessTokenContext,
  token: { label?: unknown; raw: string; type: string }
): void => {
  recordFootnoteAnchor(context.footnoteByLabel, token, {
    headingPath: snapshotHeadingPath(context.headingStack),
    sourceLine: context.lineCursor,
  })
}

// `core/markdown.ts` の `renderer.html = escapeHtml(html)` は raw HTML を **要素ゼロのテキスト**として
// 出力する (DESIGN.md §11 信頼境界の方針)。そのため `type: 'html'` トークンは documentary anchor を
// 持つべきではなく、含めると DOM 上の要素数とズレて以降の block の `data-source-line` が滑る。
// `space` と同じく「cursor は進めるが anchor を発行しない」扱いに揃える。
//
// `def` (link reference definition `[foo]: url`) は marked v12 では独立 token として lexer 出力に
// 出ないが (paragraph 等に統合される)、marked の version up 等で type:'def' が直接出るケースが
// 復活した場合も同じく DOM 出力ゼロなので、防御的に skip 対象に入れる。
const NON_RENDERING_DOCUMENTARY_TYPES: ReadonlySet<string> = new Set(['html', 'def', 'space'])

const isNonRenderingDocumentaryToken = (token: { type: string }): boolean =>
  NON_RENDERING_DOCUMENTARY_TYPES.has(token.type)

const processSingleToken = (
  context: ProcessTokenContext,
  token: { depth?: unknown; label?: unknown; raw: string; type: string }
): void => {
  // 'footnotes' (placeholder) は文書行を消費せず anchor も持たない
  if (token.type === 'footnotes') {
    return
  }
  if (token.type === 'footnote') {
    processFootnoteToken(context, token)
  } else if (!isNonRenderingDocumentaryToken(token)) {
    processDocumentaryToken(context, token)
  }
  context.lineCursor += countNewlines(token.raw)
}

/**
 * 脚注対応版の anchor 計算。documentary block と footnote definition を分けて返す。
 * 文書由来の `type:'footnotes'` placeholder token (raw="Footnotes", 文書行を消費しない) は
 * cursor 加算からも除外する (Step 1 PoC で確定)。
 */
export const computeAnchorPositions = (markdown: string): AnchorPositionsResult => {
  const tokens = createFootnoteAwareLexer().lexer(markdown)
  const context: ProcessTokenContext = {
    documentary: [],
    footnoteByLabel: new Map(),
    headingStack: [],
    lineCursor: 1,
  }
  for (const token of tokens) {
    processSingleToken(context, token)
  }
  return { documentary: context.documentary, footnoteByLabel: context.footnoteByLabel }
}

/**
 * `cacheBlockOriginalHTML` の走査順 (section.virtual-page 配下の documentary 子要素) に対応する
 * blockId → anchor の Map を作る。footnote definition は本 Map には含めない (DOM 側で label
 * 逆引きで別経路で焼き込むため。docs/mdxg-footnotes.md §4)。
 *
 * documentary 順は `computeAnchorPositions` の documentary 配列をそのまま並べたもので、b001 から
 * 連番採番する。
 */
export const buildBlockAnchors = (markdown: string): Map<string, BlockAnchor> => {
  const { documentary } = computeAnchorPositions(markdown)
  const anchors = new Map<string, BlockAnchor>()
  for (const [index, position] of documentary.entries()) {
    anchors.set(blockIdFromIndex(index + 1), position)
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

    // `core/markdown.ts` の `renderer.html = escapeHtml(html)` は raw HTML を要素ゼロのテキストとして
    // 出力するため、`html` token を documentary anchor に含めると DOM 要素数とズレて以降の block の
    // `data-source-line` が滑る (review feedback で指摘された Step 4 の 1:1 不変条件破綻)。
    // `html` トークンは skip されるが、その raw が消費する行数だけ cursor を進める必要がある。
    it('html token (raw HTML block) は documentary anchor を発行せず、後続 block の sourceLine も乱さない', () => {
      const anchors = buildBlockAnchors('before\n\n<div>x</div>\n\nafter\n')
      // 期待: 2 個の documentary anchor のみ (before / after)、html は skip
      expect(anchors.size).toBe(2)
      expect(requireAnchor(anchors, 'b001').sourceLine).toBe(1)
      // 'before' (1) + space '\n\n' (2-3) + html '<div>x</div>\n\n' (3-5) = after は line 5
      expect(requireAnchor(anchors, 'b002').sourceLine).toBe(5)
    })

    it('html token を heading の合間に挟んでも以降の heading path / sourceLine が崩れない', () => {
      const anchors = buildBlockAnchors('# A\n\nP1\n\n<div>raw</div>\n\n## B\n\nP2\n')
      // documentary: # A (b001) / P1 (b002) / ## B (b003) / P2 (b004)、html は skip
      expect(anchors.size).toBe(4)
      expect(requireAnchor(anchors, 'b001').sourceLine).toBe(1) // # A
      expect(requireAnchor(anchors, 'b002').sourceLine).toBe(3) // P1
      expect(requireAnchor(anchors, 'b002').headingPath).toEqual(['# A'])
      // # A (1) + \n\n (2-3) + P1 (3) + \n\n (4-5) + html (5-7) + \n\n は html.raw 内 + ## B = 7
      expect(requireAnchor(anchors, 'b003').sourceLine).toBe(7) // ## B
      expect(requireAnchor(anchors, 'b003').headingPath).toEqual(['# A'])
      expect(requireAnchor(anchors, 'b004').sourceLine).toBe(9) // P2
      expect(requireAnchor(anchors, 'b004').headingPath).toEqual(['# A', '## B'])
    })
  })
}
