// `<style id="markdown-css">` の中身をユーザー指定 CSS で書き換える pure 関数。
// CLI 経路 (src/core/embed.ts の rewriteEmbeddedMarkdownCss) と build 時 inline
// (vite.config.ts の markdownCssInlinePlugin) の両方が同じ実装を共有し、同じ in-source
// test 群で挙動を担保するための共通モジュール。
//
// 依存をゼロに保つ理由: vite.config.ts は vite-plus の loader で TypeScript として
// 直接 Node に load される。embed.ts 経由で import すると transitive な相対 import
// (`./escape` 等) が拡張子なしのまま残り Node ESM が解決できないため、build chain から
// import 可能なファイルは依存ゼロで完結させる。

// 本文プレビュー用 markdown CSS の `<style>` タグ識別。他の embedded-* タグ
// (例: embedded-shiki-langs) は複数属性の lookahead (type="..." 等) で説明文中の
// literal を弾く設計だが、<style> には付与できる属性が乏しいため別アプローチを採る:
// HTML コメント `<!-- ... -->` 範囲を同サイズの空白で mask した文字列上で regex match し、
// 得た index で元 HTML を slice する。これにより、コメント中に literal
// `<style id="markdown-css">` を書いてしまっても誤マッチで HTML を破壊しなくなる。
const MARKDOWN_CSS_RE = /(<style\b(?=[^>]*\bid="markdown-css")[^>]*>)([\s\S]*?)(<\/style>)/i

const maskHtmlComments = (html: string): string =>
  html.replace(/<!--[\s\S]*?-->/g, (match: string): string => ' '.repeat(match.length))

// CSS source 中の literal `</style>` を `<\/style>` に escape する。HTML パーサが
// ユーザー CSS 中の文字列を style タグの閉じとして誤検出するのを構造的に防ぐ。
// CSS の文法上 `</style>` が規則として現れることはまずないが、コメントや content: 値に
// 書ける余地が残るため塞いでおく。
const escapeStyleTagInCss = (cssSource: string): string =>
  cssSource.replace(/<\/style>/gi, String.raw`<\/style>`)

/**
 * `<style id="markdown-css">` の中身を `css` で書き換えた新しい HTML 文字列を返す。
 * 元文字列は変更しない。該当 `<style>` タグが無ければ Error を投げる
 * (呼び出し側が CLI / build エラーに変換)。
 */
export const inlineMarkdownCssIntoHtml = (html: string, css: string): string => {
  const masked = maskHtmlComments(html)
  const match = MARKDOWN_CSS_RE.exec(masked)
  if (!match) {
    throw new Error('template HTML に id="markdown-css" の <style> タグが見つかりません')
  }
  const [fullMatch, openingTag, , closingTag] = match
  const replaced = `${openingTag}${escapeStyleTagInCss(css)}${closingTag}`
  return html.slice(0, match.index) + replaced + html.slice(match.index + fullMatch.length)
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('inlineMarkdownCssIntoHtml', () => {
    const baseHtml =
      '<html><head><style id="markdown-css">/* default */</style></head><body></body></html>'

    it('style タグの中身をユーザー CSS で置き換える', () => {
      const out = inlineMarkdownCssIntoHtml(baseHtml, '#doc { color: red; }')
      expect(out).toContain('<style id="markdown-css">#doc { color: red; }</style>')
      expect(out).not.toContain('/* default */')
    })

    it(String.raw`CSS 内の literal </style> を <\/style> に escape する`, () => {
      const css = '/* contains </style> in comment */ #doc { content: "</style>"; }'
      const out = inlineMarkdownCssIntoHtml(baseHtml, css)
      // 元 baseHtml の </style> 閉じタグ 1 件のみが literal として残り、CSS 中の 2 件は escape される
      const literalClose = out.match(/<\/style>/gi) ?? []
      expect(literalClose.length).toBe(1)
      expect(out).toContain(String.raw`<\/style>`)
    })

    it('markdown-css タグが無いと Error を投げる', () => {
      expect(() => inlineMarkdownCssIntoHtml('<html></html>', '')).toThrow(/markdown-css/)
    })

    it('元文字列を破壊しない', () => {
      const html = baseHtml
      inlineMarkdownCssIntoHtml(html, '#doc { color: blue; }')
      expect(html).toBe(baseHtml)
    })

    it('空 CSS でも置換できる (中身を空にする)', () => {
      const out = inlineMarkdownCssIntoHtml(baseHtml, '')
      expect(out).toContain('<style id="markdown-css"></style>')
    })

    it('HTML コメント中の literal <style id="markdown-css"> を無視する (誤マッチ回帰防止)', () => {
      const html =
        '<html><head><!-- explains <style id="markdown-css"> with literal --><style id="markdown-css">/* default */</style></head></html>'
      const out = inlineMarkdownCssIntoHtml(html, '#doc { color: red; }')
      expect(out).toContain('<!-- explains <style id="markdown-css"> with literal -->')
      expect(out).toContain('<style id="markdown-css">#doc { color: red; }</style>')
      expect(out).not.toContain('/* default */')
    })

    it('コメントのみで実タグが無いと Error を投げる', () => {
      const html = '<html><head><!-- <style id="markdown-css">x</style> --></head></html>'
      expect(() => inlineMarkdownCssIntoHtml(html, '')).toThrow(/markdown-css/)
    })

    it('複数行 HTML コメント中の literal も無視する', () => {
      const html =
        '<html><head><!--\n  注意:\n  <style id="markdown-css">...</style> を書くと過去バグ再発\n--><style id="markdown-css">/* default */</style></head></html>'
      const out = inlineMarkdownCssIntoHtml(html, '#doc { font-size: 16px; }')
      expect(out).toContain('過去バグ再発')
      expect(out).toContain('<style id="markdown-css">#doc { font-size: 16px; }</style>')
    })

    it('実タグの内容も <style id="markdown-css"> literal を含めて完全置換される', () => {
      // 旧 default CSS にコメント中 literal が含まれていた場合の挙動を保証する
      const html =
        '<html><head><style id="markdown-css">/* old: <style id="markdown-css"> */</style></head></html>'
      const out = inlineMarkdownCssIntoHtml(html, '#doc { color: green; }')
      expect(out).toContain('<style id="markdown-css">#doc { color: green; }</style>')
      expect(out).not.toContain('/* old:')
    })
  })
}
