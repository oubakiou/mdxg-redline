// markdown 内の `$...$` (inline) / `$$...$$` (display) 数式を検出する pure module。
// CLI の `--math auto` 判定と、`core/markdown.ts` の renderer が `<span data-math>` /
// `<div data-math>` を出力する範囲を決めるために使う (docs/mdxg-math-rendering.md §1 / §5.i)。
//
// scanMath は plain text に対するスキャナで、与えられた文字列中の数式範囲を返す。
// countMath は marked.lexer で markdown 全体を走査し、`code` / `codespan` トークンを
// 除いた text トークンに対して scanMath を適用して件数を集計する。code 配下の `$` を
// 自前で skip しなくて済むのは marked が structural に別トークンへ分離するため
// (scan-mermaid.ts / scan-fenced-langs.ts と同じパターン)。
//
// `\$` は数式境界として扱わない (literal `$` として残す)。判定は直前の連続バックスラッシュ数の
// 偶奇で行うため `\\$` (literal backslash + `$`) は数式境界として扱う (§5.i)。
// `$...$` (inline) は同一行内のみ許容、`$$...$$` (display) は改行を許容する
// (KaTeX のデフォルト挙動に揃える、§1 対応スコープ表 / Step 2 設計)。

import { marked } from 'marked'

export type MathType = 'display' | 'inline'

export interface MathSegment {
  end: number
  raw: string
  source: string
  start: number
  type: MathType
}

export interface MathCounts {
  display: number
  inline: number
}

interface TokenLike {
  items?: unknown
  raw?: unknown
  text?: unknown
  tokens?: unknown
  type: string
}

const isTokenLike = (value: unknown): value is TokenLike => {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  return typeof (value as { type?: unknown }).type === 'string'
}

// `pos` 位置の `$` がバックスラッシュでエスケープされているか判定する。
// 直前の連続バックスラッシュ数が奇数なら escape されていると見なす。
const isEscapedDollar = (text: string, pos: number): boolean => {
  let backslashes = 0
  let cursor = pos - 1
  while (cursor >= 0 && text[cursor] === '\\') {
    backslashes += 1
    cursor -= 1
  }
  return backslashes % 2 === 1
}

// display 数式の終端 `$$` 位置を返す。escape された `$$` は終端として扱わない。
// 見つからなければ -1。
const findDisplayEnd = (text: string, from: number): number => {
  let cursor = from
  while (cursor < text.length - 1) {
    if (text[cursor] === '$' && text[cursor + 1] === '$' && !isEscapedDollar(text, cursor)) {
      return cursor
    }
    cursor += 1
  }
  return -1
}

// inline 数式の終端 `$` 位置を返す。改行に遭遇した時点で打ち切り (-1)。
// escape された `$` は終端として扱わない。見つからなければ -1。
const findInlineEnd = (text: string, from: number): number => {
  let cursor = from
  while (cursor < text.length) {
    const ch = text[cursor]
    if (ch === '\n') {
      return -1
    }
    if (ch === '$' && !isEscapedDollar(text, cursor)) {
      return cursor
    }
    cursor += 1
  }
  return -1
}

interface MatchStep {
  // segment を見つけたとき push、見つからずに進む場合は null
  next: number
  segment: MathSegment | null
}

// `$$` 直後位置から display 終端を探し、見つかれば MathSegment と新カーソル位置を返す。
// 見つからない場合は `$$` 2 文字ぶん進めて plain text として残す。
const matchDisplay = (text: string, start: number): MatchStep => {
  const endPos = findDisplayEnd(text, start + 2)
  if (endPos === -1) {
    return { next: start + 2, segment: null }
  }
  const closeEnd = endPos + 2
  const segment: MathSegment = {
    end: closeEnd,
    raw: text.slice(start, closeEnd),
    source: text.slice(start + 2, endPos),
    start,
    type: 'display',
  }
  return { next: closeEnd, segment }
}

// `$` 直後位置から inline 終端を探し、見つかれば MathSegment と新カーソル位置を返す。
// 見つからない場合は `$` 1 文字ぶん進めて plain text として残す。
const matchInline = (text: string, start: number): MatchStep => {
  const endPos = findInlineEnd(text, start + 1)
  if (endPos === -1) {
    return { next: start + 1, segment: null }
  }
  const closeEnd = endPos + 1
  const segment: MathSegment = {
    end: closeEnd,
    raw: text.slice(start, closeEnd),
    source: text.slice(start + 1, endPos),
    start,
    type: 'inline',
  }
  return { next: closeEnd, segment }
}

const stepAt = (text: string, cursor: number): MatchStep => {
  if (text[cursor] !== '$' || isEscapedDollar(text, cursor)) {
    return { next: cursor + 1, segment: null }
  }
  // display $$...$$ を inline より先に判定
  if (text[cursor + 1] === '$') {
    return matchDisplay(text, cursor)
  }
  return matchInline(text, cursor)
}

/**
 * `$...$` (inline) / `$$...$$` (display) 数式を 1 つの plain text 入力から検出する。
 * 結果は `start` 昇順、display を inline より先に判定する (`$$...$$` を `$...$` 2 個と
 * 誤解釈しない)。`MathSegment.source` は `$` 区切りを除去した LaTeX 本体で、
 * 後段の renderer / upgrade はこれを `katex.renderToString` に直接渡せる。
 */
export const scanMath = (text: string): MathSegment[] => {
  const segments: MathSegment[] = []
  let cursor = 0
  while (cursor < text.length) {
    const step = stepAt(text, cursor)
    if (step.segment !== null) {
      segments.push(step.segment)
    }
    cursor = step.next
  }
  return segments
}

const tokenRawText = (token: TokenLike): string => {
  // text トークンは `.raw` に元の markdown 断片を持つ。`.text` は inline 装飾を剥がした
  // テキストで、`$` を含むケースは raw 側と同じだが安全策として raw を優先する。
  if (typeof token.raw === 'string') {
    return token.raw
  }
  if (typeof token.text === 'string') {
    return token.text
  }
  return ''
}

const addSegmentsToCounts = (segments: MathSegment[], counts: MathCounts): void => {
  for (const segment of segments) {
    if (segment.type === 'inline') {
      counts.inline += 1
    } else {
      counts.display += 1
    }
  }
}

// code / codespan 配下の `$` は数式境界として扱わないため walk せず skip
const isWalkableToken = (token: TokenLike): boolean =>
  token.type !== 'code' && token.type !== 'codespan'

const accumulateMathCounts = (tokens: unknown, counts: MathCounts): void => {
  if (!Array.isArray(tokens)) {
    return
  }
  for (const token of tokens) {
    if (isTokenLike(token) && isWalkableToken(token)) {
      if (token.type === 'text') {
        // marked は text トークンの内側にも同一内容の `tokens` を持たせる (escape / emphasis
        // 含む inline parse の結果)。raw を 1 回 scan したら内側へは再帰しない (重複防止)
        addSegmentsToCounts(scanMath(tokenRawText(token)), counts)
      } else {
        accumulateMathCounts(token.tokens, counts)
        accumulateMathCounts(token.items, counts)
      }
    }
  }
}

/**
 * markdown 全体から `$...$` / `$$...$$` の件数を inline / display 別に集計する。
 * code / codespan 配下の `$` は marked AST 上で別トークンに分離されているため自動的に除外される。
 * CLI の `--math auto` 注入判定 (`countMath(md).inline + countMath(md).display > 0`) で使う。
 */
export const countMath = (markdown: string): MathCounts => {
  const tokens = marked.lexer(markdown)
  const counts: MathCounts = { display: 0, inline: 0 }
  accumulateMathCounts(tokens, counts)
  return counts
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('scanMath: 基本検出', () => {
    it('空入力は空配列', () => {
      expect(scanMath('')).toEqual([])
    })

    it('$x$ 単独 inline を検出', () => {
      const segments = scanMath('$x$')
      expect(segments).toEqual([{ end: 3, raw: '$x$', source: 'x', start: 0, type: 'inline' }])
    })

    it('$$x$$ 単独 display を検出', () => {
      const segments = scanMath('$$x$$')
      expect(segments).toEqual([{ end: 5, raw: '$$x$$', source: 'x', start: 0, type: 'display' }])
    })

    it('inline / display 混在を文書順に検出', () => {
      const segments = scanMath('text $a$ text $$b$$ text')
      expect(segments).toHaveLength(2)
      expect(segments[0]).toMatchObject({ source: 'a', type: 'inline' })
      expect(segments[1]).toMatchObject({ source: 'b', type: 'display' })
    })

    it('source / raw / start / end の境界が一貫する', () => {
      const text = String.raw`pre $\frac{a}{b}$ post`
      const [seg] = scanMath(text)
      expect(seg).toBeDefined()
      expect(text.slice(seg.start, seg.end)).toBe(seg.raw)
      expect(seg.raw).toBe(String.raw`$\frac{a}{b}$`)
      expect(seg.source).toBe(String.raw`\frac{a}{b}`)
    })
  })

  describe('scanMath: エスケープ', () => {
    it(String.raw`\$ 単独は数式境界として扱わない`, () => {
      expect(scanMath(String.raw`price \$100 and \$200`)).toEqual([])
    })

    it(String.raw`\\$ は数式境界として扱う (literal backslash + $)`, () => {
      // 入力: `\\$x\\$` (4 chars: \, \, $, x, \, \, $)
      const text = String.raw`\\$x\\$`
      const segments = scanMath(text)
      expect(segments).toHaveLength(1)
      expect(segments[0].type).toBe('inline')
      expect(segments[0].source).toBe(String.raw`x\\`)
    })

    it(String.raw`display 終端の \$$ も escape として扱う`, () => {
      // `$$x\$$y$$` は最初の \$$ は単独 escape ではなく `\$`+`$`、後者の $$ が終端
      const text = String.raw`$$x\$$y$$`
      const segments = scanMath(text)
      expect(segments).toHaveLength(1)
      expect(segments[0].type).toBe('display')
    })
  })

  describe('scanMath: 改行の扱い', () => {
    it('inline は改行を含めない (KaTeX デフォルト)', () => {
      expect(scanMath('$a\nb$')).toEqual([])
    })

    it('display は改行を許容', () => {
      const segments = scanMath('$$\nx\n$$')
      expect(segments).toHaveLength(1)
      expect(segments[0].type).toBe('display')
      expect(segments[0].source).toBe('\nx\n')
    })
  })

  describe('scanMath: 終端なし / 不正パターン', () => {
    it('終端 $ が無い inline は無視', () => {
      expect(scanMath('$unclosed')).toEqual([])
    })

    it('終端 $$ が無い display は無視', () => {
      expect(scanMath('$$unclosed')).toEqual([])
    })

    it('$$$$ (空 display) は ParseError 候補だが scanner は構造的に display 1 個を返す', () => {
      const segments = scanMath('$$$$')
      expect(segments).toHaveLength(1)
      expect(segments[0]).toMatchObject({ source: '', type: 'display' })
    })
  })

  describe('scanMath: ネスト挙動', () => {
    it('$$ $ inner $ $$ は display 1 個として扱う (内側 $ は source の一部)', () => {
      const segments = scanMath('$$ $ inner $ $$')
      expect(segments).toHaveLength(1)
      expect(segments[0]).toMatchObject({ source: ' $ inner $ ', type: 'display' })
    })

    it('連続する inline は独立して検出される', () => {
      const segments = scanMath('$a$ and $b$')
      expect(segments).toHaveLength(2)
      expect(segments.map((seg) => seg.source)).toEqual(['a', 'b'])
    })
  })

  describe('countMath: marked.lexer 統合', () => {
    it('inline / display 件数を集計する', () => {
      const md = 'intro text\n\n$a$ and $$b$$ and $c$\n'
      const counts = countMath(md)
      expect(counts).toEqual({ display: 1, inline: 2 })
    })

    it('コードブロック内の $ は数えない', () => {
      const md = '```ts\nconst price = "$100"\nconst formula = "$x$"\n```\n'
      expect(countMath(md)).toEqual({ display: 0, inline: 0 })
    })

    it('インラインコード内の $ は数えない', () => {
      const md = 'inline code `$x$` should not count\n'
      expect(countMath(md)).toEqual({ display: 0, inline: 0 })
    })

    it('数式と通常テキストが混在しても正確に集計', () => {
      const md = 'text\n\n`$ignored$` and $real$ here\n\n```\n$also_ignored$\n```\n\n$$display$$\n'
      expect(countMath(md)).toEqual({ display: 1, inline: 1 })
    })

    it('数式が 1 つも無い markdown は 0 件', () => {
      expect(countMath('')).toEqual({ display: 0, inline: 0 })
      expect(countMath('# Title\n\nNo math here.\n')).toEqual({ display: 0, inline: 0 })
    })

    it('リスト配下の数式も検出する (marked AST の walk が機能)', () => {
      const md = '- item with $math$ inside\n- another $expr$\n'
      expect(countMath(md)).toEqual({ display: 0, inline: 2 })
    })

    it(String.raw`\$ エスケープは数えない`, () => {
      const md = 'Cost is \\$100 and \\$200, totalling \\$300.\n'
      expect(countMath(md)).toEqual({ display: 0, inline: 0 })
    })
  })
}
