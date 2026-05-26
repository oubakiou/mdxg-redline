// markdown 入力をスキャンして ` ```mermaid ` フェンス付きコードブロックの数を返す pure module。
// CLI の `--mermaid auto` mode から呼び出され、`> 0` のときだけ Mermaid runtime を
// 配布 HTML に inject する判断に使う (docs/mdxg-diagram-rendering.md §2 / §4 Step 2)。
//
// scan-fenced-langs.ts と同じく marked.lexer ベースで実装することで、
// リスト配下 / 引用配下 / ネストフェンスを含む GFM 仕様の細部追従を marked に委譲する。
// 識別子の大小文字を区別しないのは GFM 慣習 (`Mermaid` / `MERMAID` も検出) と
// scan-fenced-langs.ts の挙動に揃えるため。

import { marked } from 'marked'

interface TokenLike {
  items?: unknown
  lang?: unknown
  tokens?: unknown
  type: string
}

const isTokenLike = (value: unknown): value is TokenLike => {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  return typeof (value as { type?: unknown }).type === 'string'
}

const isMermaidLang = (raw: unknown): boolean => {
  if (typeof raw !== 'string') {
    return false
  }
  const [head] = raw.trim().split(/\s+/u, 1)
  return typeof head === 'string' && head.toLowerCase() === 'mermaid'
}

const isMermaidCodeToken = (token: TokenLike): boolean => {
  if (token.type !== 'code') {
    return false
  }
  return isMermaidLang(token.lang)
}

const walkTokens = (tokens: unknown, counter: { value: number }): void => {
  if (!Array.isArray(tokens)) {
    return
  }
  for (const token of tokens) {
    if (isTokenLike(token)) {
      if (isMermaidCodeToken(token)) {
        counter.value += 1
      }
      walkTokens(token.tokens, counter)
      walkTokens(token.items, counter)
    }
  }
}

/**
 * markdown 全体を走査して、`mermaid` 言語識別子付きフェンスの数を返す。
 * 大小文字は区別しない (`Mermaid` / `MERMAID` も検出)。
 * インラインコードや info string 中の "mermaid" 文字列は検出しない。
 */
export const scanMermaidFences = (markdown: string): number => {
  const tokens = marked.lexer(markdown)
  const counter = { value: 0 }
  walkTokens(tokens, counter)
  return counter.value
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('scanMermaidFences: 基本検出', () => {
    it('mermaid ブロックなしは 0', () => {
      expect(scanMermaidFences('')).toBe(0)
      expect(scanMermaidFences('# Title\n\nNo diagrams here\n')).toBe(0)
      expect(scanMermaidFences('```ts\nlet x = 1\n```\n')).toBe(0)
    })

    it('mermaid ブロック 1 個を検出', () => {
      const md = '```mermaid\ngraph TD\nA-->B\n```\n'
      expect(scanMermaidFences(md)).toBe(1)
    })

    it('mermaid ブロック複数を検出', () => {
      const md = '```mermaid\ngraph TD\nA-->B\n```\n\n```mermaid\nsequenceDiagram\nA->>B: hi\n```\n'
      expect(scanMermaidFences(md)).toBe(2)
    })

    it('インラインコードは検出しない', () => {
      expect(scanMermaidFences('See `mermaid` for diagrams\n')).toBe(0)
    })

    it('プレーンテキスト中の "mermaid" 文字列は検出しない', () => {
      expect(scanMermaidFences('I use mermaid in my docs.\n')).toBe(0)
    })
  })

  describe('scanMermaidFences: 大小文字混入', () => {
    it('Mermaid / MERMAID も小文字化マップで mermaid として認識', () => {
      expect(scanMermaidFences('```Mermaid\ngraph TD\nA-->B\n```\n')).toBe(1)
      expect(scanMermaidFences('```MERMAID\ngraph TD\nA-->B\n```\n')).toBe(1)
    })

    it('info string 末尾の属性を無視して先頭の lang のみ判定', () => {
      expect(scanMermaidFences('```mermaid foo=bar\ngraph TD\nA-->B\n```\n')).toBe(1)
    })
  })

  describe('scanMermaidFences: ネスト構造', () => {
    it('リスト配下のインデント付き mermaid フェンスを検出 (GFM)', () => {
      const md = '- item\n\n  ```mermaid\n  graph TD\n  A-->B\n  ```\n'
      expect(scanMermaidFences(md)).toBe(1)
    })

    it('引用配下の mermaid フェンスを検出 (GFM)', () => {
      const md = '> quoted\n>\n> ```mermaid\n> graph TD\n> A-->B\n> ```\n'
      expect(scanMermaidFences(md)).toBe(1)
    })

    it('``` markdown ` フェンス内の mermaid は外側 markdown 1 件として扱われ 0', () => {
      // scan-fenced-langs.ts と同じ marked.lexer の挙動。外側がより多い backtick で
      // 内側 mermaid を含む code として lex されるため mermaid token は出現しない
      const md = '````markdown\n```mermaid\ngraph TD\nA-->B\n```\n````\n'
      expect(scanMermaidFences(md)).toBe(0)
    })
  })
}
