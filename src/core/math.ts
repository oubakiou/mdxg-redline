// markdown 内の `$...$` (inline) / `$$...$$` (display) 数式を検出する pure module。
// CLI の `--math auto` 判定と、`core/markdown.ts` の renderer が `<span data-math>` /
// `<div data-math>` を出力する範囲を決めるために使う (DESIGN.md §12 §14 Math Rendering)。
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

const isWhitespaceBefore = (text: string, pos: number): boolean => {
  const ch = text[pos - 1]
  return ch === ' ' || ch === '\t' || ch === '\n'
}

// opening `$` の直後 (matchInline で渡される start+1 位置) が空白なら inline 数式の開始として
// 扱わない (Pandoc 風境界条件の前半、`$ x` のような開きっぱなしを抑制、§5.i)。
// **数字は弾かない**: `$2$` / `$2024$` / `$3.14$` のような数字始まり数式は正当な記法であり、
// 早期に「数字始まり禁止」を入れると正当な数式まで巻き添えになる回帰が起きる (外部レビュー
// 指摘 #4)。代わりに通貨表記 `$100 and $200` は「closing 候補の直前が ` ` (space)」で
// `findInlineEnd` が弾く構造に倒し、最小フィルタで誤検出と正当検出の両立を保つ。
// display `$$` にはこの境界条件を適用しない (display は単独行で書かれる前提で誤検出リスクが低い)。
const isInvalidInlineOpening = (text: string, after: number): boolean => {
  if (after >= text.length) {
    return true
  }
  const ch = text.charAt(after)
  return ch === ' ' || ch === '\t' || ch === '\n'
}

// inline 数式の終端 `$` 位置を返す。改行に遭遇した時点で打ち切り (-1)。
// escape された `$` は終端として扱わない。見つからなければ -1。
// closing `$` の直前が空白の場合も終端として扱わない (Pandoc 風境界条件の後半、`$100 and $200`
// のような通貨表記の closing 成立を抑制、§5.i)。
const findInlineEnd = (text: string, from: number): number => {
  let cursor = from
  while (cursor < text.length) {
    const ch = text[cursor]
    if (ch === '\n') {
      return -1
    }
    if (ch === '$' && !isEscapedDollar(text, cursor) && !isWhitespaceBefore(text, cursor)) {
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
// 開始境界の Pandoc 風判定 (opening 直後の空白を除外、数字は除外しない) も担う。
// `$100 and $200` のような通貨表記は **closing 候補の直前空白チェック (`findInlineEnd`)** で
// 弾かれる構造に倒し、`$2$` / `$2024$` のような数字始まり数式の正当検出を保つ (§5.i / Step 9)。
const matchInline = (text: string, start: number): MatchStep => {
  if (isInvalidInlineOpening(text, start + 1)) {
    return { next: start + 1, segment: null }
  }
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

  describe('scanMath: Pandoc 風境界条件 (§5.i 自然言語 $ 誤検出対策)', () => {
    it('複数の通貨表記が並んでも誤検出しない ($100 and $200)', () => {
      // 通貨ペアは closing 候補の直前が ` ` (space) で findInlineEnd が弾くため数式不成立
      expect(scanMath('Pay $100 and $200 today.')).toEqual([])
    })

    it('単独の通貨表記も closing $ が無いため認識しない', () => {
      expect(scanMath('Price is $100 here')).toEqual([])
    })

    it('opening $ の直後が空白なら inline 数式と認識しない (開きっぱなしの $)', () => {
      expect(scanMath('open $ then text $')).toEqual([])
    })

    it('closing $ の直前が空白の候補は skip し、後続の有効な closing $ で閉じる', () => {
      // `$x $ y$` で:
      //   - opening は `$x` の `$`、直後 `x` が非空白で成立
      //   - 第 1 closing 候補は ` $` の `$` だが、直前が ` ` (space) で不成立 → skip
      //   - 第 2 候補 `y$` の `$` は直前 `y` 非空白で成立
      // 結果として `$x $ y$` 全体が 1 inline として検出され、source は `x $ y`
      const segments = scanMath('hello $x $ y$ tail')
      expect(segments).toHaveLength(1)
      expect(segments[0]).toMatchObject({ source: 'x $ y', type: 'inline' })
    })

    it('有効な closing が無いケースは認識しない (`$x` で trail に `$` が無い)', () => {
      expect(scanMath('hello $x tail with no closing here')).toEqual([])
    })

    it(
      String.raw`数字始まりの正当な数式 ($2$ / $3.14$ / $2024$) は引き続き検出される (外部レビュー #4 回帰防止)`,
      () => {
        // Pandoc 仕様で opening 直後の数字は弾かれない。最小修正で「正当な数字始まり数式」を守る。
        // Step 9 初版は数字始まりも巻き込んで弾いていたため、$2$ や行列の係数 ($2024$) の
        // 数式が落ちる回帰が発生していた (外部レビュー指摘 #4)。closing 直前空白チェックだけで
        // 通貨表記は十分排除でき、数字始まり数式の正当検出を保てる
        expect(scanMath('$2$')).toHaveLength(1)
        expect(scanMath('$3.14$')).toHaveLength(1)
        expect(scanMath('$2024$')).toHaveLength(1)
        expect(scanMath('$2$').at(0)).toMatchObject({ source: '2', type: 'inline' })
        expect(scanMath('$3.14$').at(0)).toMatchObject({ source: '3.14', type: 'inline' })
      }
    )

    it(String.raw`境界条件強化後も $x^2$ / $\alpha$ / $a+b$ は数式として通る`, () => {
      expect(scanMath('$x^2$')).toHaveLength(1)
      expect(scanMath(String.raw`$\alpha$`)).toHaveLength(1)
      expect(scanMath('$a+b$')).toHaveLength(1)
    })

    it('display $$ には境界条件を適用しない ($$1+2$$ 通る)', () => {
      const segments = scanMath('$$1+2$$')
      expect(segments).toHaveLength(1)
      expect(segments[0]).toMatchObject({ source: '1+2', type: 'display' })
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

  // docs/archive/mdxg-math-rendering.archive.md §5.i「ブロック境界を跨ぐ `$` は検出対象外」を保証する。
  // scanMath の入力は marked.lexer の text token 単位で、token 境界 (paragraph / list_item /
  // blockquote / heading 等) を越えない。意図的な動作で、安全側に倒した結果として「跨ぎ `$`
  // は描画されず raw 文字として残る」。配布物の安全性 (countMath = 0 で KaTeX 注入が走らない)
  // と引き換えに、利用者は数式を同一段落内に収める / `$$...$$` で書く / `\$` でエスケープする
  // のいずれかが必要。
  describe('countMath: ブロック境界跨ぎ (§5.i 跨ぎ未対応の保証)', () => {
    it('段落境界を跨ぐ $...$ は検出されない', () => {
      const md = 'first paragraph $start\n\nnext paragraph end$ here\n'
      expect(countMath(md)).toEqual({ display: 0, inline: 0 })
    })

    it('段落境界を跨ぐ $$...$$ は検出されない', () => {
      const md = 'first paragraph $$start\n\nnext paragraph end$$ here\n'
      expect(countMath(md)).toEqual({ display: 0, inline: 0 })
    })

    it('list item 境界を跨ぐ $...$ は検出されない (各 list_item.text は独立トークン)', () => {
      const md = '- item with $start\n- next item end$ here\n'
      expect(countMath(md)).toEqual({ display: 0, inline: 0 })
    })

    it('heading と paragraph を跨ぐ $...$ は検出されない', () => {
      const md = '# Heading with $start\n\nBody paragraph end$ here\n'
      expect(countMath(md)).toEqual({ display: 0, inline: 0 })
    })

    it('blockquote と paragraph を跨ぐ $...$ は検出されない', () => {
      const md = '> quote with $start\n\nouter paragraph end$ here\n'
      expect(countMath(md)).toEqual({ display: 0, inline: 0 })
    })

    it('同一段落内で改行を跨ぐ inline $...$ は検出されない (KaTeX デフォルト準拠)', () => {
      const md = 'softbreak $start\nend$ here\n'
      expect(countMath(md)).toEqual({ display: 0, inline: 0 })
    })

    it('同一段落内で改行を跨ぐ display $$...$$ は検出される (display は改行 OK)', () => {
      const md = '$$\nx + y\n= z\n$$\n'
      expect(countMath(md)).toEqual({ display: 1, inline: 0 })
    })

    it('跨ぎパターンと正常パターンが同居しても正常側だけ集計される', () => {
      // 1 行目: 段落跨ぎ未満 (同一段落の有効な inline 1 件)
      // 2 行目以降: 段落跨ぎ (検出されない)
      const md = 'good $a$ here\n\ncross $start\n\nover end$ now\n'
      expect(countMath(md)).toEqual({ display: 0, inline: 1 })
    })
  })
}
