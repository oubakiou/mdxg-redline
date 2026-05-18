import { Renderer, marked } from 'marked'

/** ユーザー入力テキストを innerHTML 経由で描画する際の HTML エスケープ（XSS 防止のための最小集合） */
export const escapeHTML = (str: string): string => {
  const replacements: Record<string, string> = {
    '"': '&quot;',
    '&': '&amp;',
    "'": '&#39;',
    '<': '&lt;',
    '>': '&gt;',
  }
  return str.replace(/[&<>"']/g, (ch): string => replacements[ch] || ch)
}

const rawHtmlEscapingRenderer = new Renderer()
rawHtmlEscapingRenderer.html = (html: string): string => escapeHTML(html)

/** marked で markdown を HTML に変換。raw HTML は実行されないよう文字として escape する */
export const renderMarkdown = (markdown: string): string => {
  const result = marked.parse(markdown, {
    breaks: false,
    gfm: true,
    renderer: rawHtmlEscapingRenderer,
  })
  // marked.parse は同期設定 (async: false) ではあるが型上 string | Promise<string>
  if (typeof result === 'string') {
    return result
  }
  return ''
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
    if (!lastHeading || lastHeading.level < headingDepth) {
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

const getAnchor = (anchors: Map<string, BlockAnchor>, blockId: string): BlockAnchor => {
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

  describe('escapeHTML', () => {
    it('プレーンテキストはそのまま返す', () => {
      expect(escapeHTML('plain text')).toBe('plain text')
    })

    it('HTML に意味を持つ文字を全てエスケープする', () => {
      expect(escapeHTML(`<a href="x">'&'</a>`)).toBe(
        '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;'
      )
    })
  })

  describe('renderMarkdown', () => {
    it('raw HTML is escaped instead of emitted as executable markup', () => {
      const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">')
      expect(html).not.toContain('<script>')
      expect(html).not.toContain('<img src=x')
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
      expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
    })

    it('HTML examples inside fenced code blocks remain code', () => {
      const html = renderMarkdown('```html\n<div onclick="alert(1)">x</div>\n```')
      expect(html).toContain('<pre><code class="language-html">')
      expect(html).toContain('&lt;div onclick=&quot;alert(1)&quot;&gt;x&lt;/div&gt;')
    })
  })

  describe('buildBlockAnchors', () => {
    it('連続するブロックに 1-origin の開始行を振る', () => {
      const anchors = buildBlockAnchors('# H1\n\nPara1\n\nPara2\n')
      expect(getAnchor(anchors, 'b001').sourceLine).toBe(1)
      expect(getAnchor(anchors, 'b002').sourceLine).toBe(3)
      expect(getAnchor(anchors, 'b003').sourceLine).toBe(5)
    })

    it('heading 自身のブロックの headingPath は祖先のみ（自分は含めない）', () => {
      const anchors = buildBlockAnchors('# Root\n\n## Sub\n\nBody\n')
      expect(getAnchor(anchors, 'b001').headingPath).toEqual([])
      expect(getAnchor(anchors, 'b002').headingPath).toEqual(['# Root'])
      expect(getAnchor(anchors, 'b003').headingPath).toEqual(['# Root', '## Sub'])
    })

    it('同じ深さの heading が来たら祖先を pop して差し替える', () => {
      const anchors = buildBlockAnchors('# A\n\nP1\n\n# B\n\nP2\n')
      expect(getAnchor(anchors, 'b002').headingPath).toEqual(['# A'])
      expect(getAnchor(anchors, 'b003').headingPath).toEqual([])
      expect(getAnchor(anchors, 'b004').headingPath).toEqual(['# B'])
    })

    it('浅い heading が来たら深い heading をすべて閉じる', () => {
      const anchors = buildBlockAnchors('# A\n\n## A.1\n\n### A.1.1\n\n## A.2\n\nbody\n')
      expect(getAnchor(anchors, 'b005').headingPath).toEqual(['# A', '## A.2'])
    })

    it('見出しがない markdown では headingPath が空配列になる', () => {
      const anchors = buildBlockAnchors('Para1\n\nPara2\n')
      expect(getAnchor(anchors, 'b001').headingPath).toEqual([])
      expect(getAnchor(anchors, 'b002').headingPath).toEqual([])
    })

    it('コードブロック等の複数行ブロックは raw の改行数で次の行カーソルを進める', () => {
      const anchors = buildBlockAnchors('# H1\n\n```js\nconst x=1;\nconst y=2;\n```\n\nAfter\n')
      expect(getAnchor(anchors, 'b002').sourceLine).toBe(3)
      expect(getAnchor(anchors, 'b003').sourceLine).toBe(8)
    })
  })
}
