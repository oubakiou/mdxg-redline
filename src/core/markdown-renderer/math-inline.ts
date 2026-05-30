// marked `renderer.text` から呼ばれる inline 数式置換の pure helper。
// `$...$` / `$$...$$` を escape 済みインラインテキスト中から検出し、`<span data-math="inline">` /
// `<span data-math="display">` で包む (docs/archive/mdxg-math-rendering.archive.md §5.a / Step 5a)。
//
// 重要 (markdown.ts 側の renderer 配線も参照):
// - marked v12 の `renderer.text` は inline parser が escape 済みの text を渡してくる。
//   `<` などの記号は `&lt;` に変換されており、`$` だけは escape されないため scanMath が
//   そのまま動く。`MathSegment.source` も escape 済み text の slice なので、属性値・
//   textContent ともに HTML 安全な状態で書き出せる
// - `data-math-source` 属性値には `$` 区切りを除去済みの clean LaTeX (`MathSegment.source`)
//   が入る。Step 5b の upgrade は `getAttribute('data-math-source')` で値を取得して
//   `katex.renderToString` に渡す経路を取り、textContent (raw `$...$`) は §14 [MUST] の
//   plain text fallback として残す
// - `<span>` で出力する理由: `renderer.text` は marked が paragraph / heading / list_item の
//   inline 文脈で呼ぶため、ここで block element (`<div>`) を返すと HTML5 parser が `<p>` を
//   強制 close して構造が壊れる (`<p>text <div>...</div> more</p>` → `<p>text </p><div>...</div>
//   <p> more</p>`)。display 数式の見た目 (中央寄せ + 余白) は CSS の `display: block; margin;
//   text-align: center` で再現する (`src/styles/markdown.css` の `#doc [data-math="display"]`)。
//   KaTeX upgrade 後は `.katex-display` クラスも同じ block 化を行うため CSS 上書きと整合する。

import { type MathSegment, scanMath } from '../math'

// `data-math-source` 属性値用の最小 escape。marked が inline parser 段階で `<` / `>` / `&` /
// `"` を実体参照化済みなので、ここで `escapeHtml` を再適用すると二重 escape され、後段の
// `getAttribute('data-math-source')` が clean な LaTeX を返さなくなる。属性値として安全に
// 書けるのに足りる「literal `"` を `&quot;` に潰す」だけに絞る (`&quot;` は再変換されない)。
const escapeMathSourceAttr = (source: string): string => source.replace(/"/g, '&quot;')

const formatMathSegment = (segment: MathSegment, rawContent: string): string => {
  const sourceAttr = escapeMathSourceAttr(segment.source)
  return `<span data-math="${segment.type}" data-math-source="${sourceAttr}">${rawContent}</span>`
}

const collectMathParts = (text: string, segments: readonly MathSegment[]): string[] => {
  const parts: string[] = []
  let cursor = 0
  for (const segment of segments) {
    if (segment.start > cursor) {
      parts.push(text.slice(cursor, segment.start))
    }
    parts.push(formatMathSegment(segment, text.slice(segment.start, segment.end)))
    cursor = segment.end
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor))
  }
  return parts
}

/**
 * marked の `renderer.text` ハンドラとして使う。inline parser が escape 済み text を渡してくる
 * 前提で、`$...$` / `$$...$$` のみ `<span data-math>` に置換した文字列を返す。
 * 数式が無ければ入力 text をそのまま返す (no-op)。
 */
export const renderMathInTextRun = (text: string): string => {
  const segments = scanMath(text)
  if (segments.length === 0) {
    return text
  }
  return collectMathParts(text, segments).join('')
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('renderMathInTextRun', () => {
    it('数式が無い text は入力をそのまま返す', () => {
      expect(renderMathInTextRun('plain text')).toBe('plain text')
    })

    it('$...$ を <span data-math="inline"> で囲む', () => {
      expect(renderMathInTextRun('try $x^2$ here')).toBe(
        'try <span data-math="inline" data-math-source="x^2">$x^2$</span> here'
      )
    })

    it('$$...$$ を <span data-math="display"> で囲む (block 化は CSS 側)', () => {
      expect(renderMathInTextRun('$$a$$')).toBe(
        '<span data-math="display" data-math-source="a">$$a$$</span>'
      )
    })

    it('source 中の literal " は &quot; に escape する (属性インジェクション防止)', () => {
      const out = renderMathInTextRun('$a"b$')
      expect(out).toContain('data-math-source="a&quot;b"')
      expect(out).not.toContain('data-math-source="a"b"')
    })
  })
}
