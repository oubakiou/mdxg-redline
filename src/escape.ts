// 信頼できない文字列を innerHTML / 属性値に流し込む際の HTML エスケープ。
// 5 文字 (&, <, >, ", ') を実体参照に変換することで XSS の入口を構造的に塞ぐ。
// テキストノード / 属性値 / title 属性 / href 属性のいずれでも安全に使える最小集合。
// `&` を先頭で置換するのは、後段の `&quot;` などが二重エスケープされるのを避けるため。

const REPLACEMENTS: Record<string, string> = {
  '"': '&quot;',
  '&': '&amp;',
  "'": '&#39;',
  '<': '&lt;',
  '>': '&gt;',
}

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (ch): string => REPLACEMENTS[ch] || ch)

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('escapeHtml', () => {
    it('プレーンテキストはそのまま返す', () => {
      expect(escapeHtml('plain text')).toBe('plain text')
    })

    it('& " < > \' を実体参照に置換する', () => {
      expect(escapeHtml(`& " < > '`)).toBe('&amp; &quot; &lt; &gt; &#39;')
    })

    it('HTML に意味を持つ文字を全てエスケープする', () => {
      expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
        '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;'
      )
    })

    it('& が他のエスケープ結果を二重エスケープしないよう先に処理されている', () => {
      expect(escapeHtml('A&B"C')).toBe('A&amp;B&quot;C')
    })

    it('特殊文字を含まない値はそのまま返す', () => {
      expect(escapeHtml('spec.md')).toBe('spec.md')
    })

    it('空文字列はそのまま空文字列を返す', () => {
      expect(escapeHtml('')).toBe('')
    })

    // 単一 regex 実装の `g` フラグが消失すると先頭 1 文字しか置換されず XSS が抜けるため、
    // 同一特殊文字の複数出現を全件置換することを明示的に検証する。
    it('同じ特殊文字が複数出現しても全て置換する (regex g フラグ)', () => {
      expect(escapeHtml('&&&')).toBe('&amp;&amp;&amp;')
      expect(escapeHtml('<<<>>>')).toBe('&lt;&lt;&lt;&gt;&gt;&gt;')
    })
  })
}
