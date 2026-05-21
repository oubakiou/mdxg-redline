import { Renderer, marked } from 'marked'

import { escapeHtml } from './escape'

const ALLOWED_LINK_SCHEMES = new Set(['http:', 'https:'])
// http: は CSP の img-src と揃えて意図的に除外している。平文通信と外部追跡経路を構造的に塞ぐ。
const ALLOWED_IMAGE_SCHEMES = new Set(['https:', 'data:'])

/** href の scheme を取り出す。new URL は base 無しだと相対 URL でエラーになるため、それを「絶対 URL でない」シグナルとして使う */
const parseScheme = (href: string): string | null => {
  try {
    return new URL(href).protocol
  } catch {
    return null
  }
}

export const isAllowedLinkHref = (href: string): boolean => {
  const scheme = parseScheme(href)
  return scheme !== null && ALLOWED_LINK_SCHEMES.has(scheme)
}

export const isAllowedImageHref = (href: string): boolean => {
  const scheme = parseScheme(href)
  return scheme !== null && ALLOWED_IMAGE_SCHEMES.has(scheme)
}

const rawHtmlEscapingRenderer = new Renderer()
rawHtmlEscapingRenderer.html = (html: string): string => escapeHtml(html)

const titleAttr = (title: string | null): string => {
  if (!title) {
    return ''
  }
  return ` title="${escapeHtml(title)}"`
}

// 信頼できない markdown を前提に、URL スキームを allowlist で絞る (DESIGN.md §11)。
// 不許可リンクは <a> を出さず inner HTML をそのまま流して plain text 扱いにし、
// 不許可画像は alt テキストを描画して画像取得を起こさない。
rawHtmlEscapingRenderer.link = (href: string, title: string | null, text: string): string => {
  if (!isAllowedLinkHref(href)) {
    return text
  }
  return `<a href="${escapeHtml(href)}"${titleAttr(title)} rel="noopener noreferrer" target="_blank">${text}</a>`
}

rawHtmlEscapingRenderer.image = (href: string, title: string | null, text: string): string => {
  if (!isAllowedImageHref(href)) {
    return escapeHtml(text)
  }
  return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${titleAttr(title)} referrerpolicy="no-referrer">`
}

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

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

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

    it('http / https リンクは <a> として描画される', () => {
      const html = renderMarkdown('[ok](https://example.com)')
      expect(html).toContain('<a href="https://example.com"')
      expect(html).toContain('rel="noopener noreferrer"')
      expect(html).toContain('target="_blank"')
    })

    // no-script-url は実コード中の javascript: URL を禁止するルール。ここで扱うのは
    // テストデータとしての文字列リテラルなので、URL allowlist がそれを弾けることを確認する目的で
    // 局所的に無効化する。
    /* eslint-disable no-script-url */
    it('script スキームのリンクは <a> を出さず text だけ描画する', () => {
      const html = renderMarkdown('[click](javascript:alert(1))')
      expect(html).not.toMatch(/<a\b/)
      expect(html).not.toContain('javascript:')
      expect(html).toContain('click')
    })

    it('相対 URL のリンクは <a> を出さず text だけ描画する', () => {
      const html = renderMarkdown('[neighbor](./other.md)')
      expect(html).not.toMatch(/<a\b/)
      expect(html).toContain('neighbor')
    })

    it('mailto: リンクは <a> を出さない (許可スキームから外れている)', () => {
      const html = renderMarkdown('[mail](mailto:foo@example.com)')
      expect(html).not.toMatch(/<a\b/)
      expect(html).toContain('mail')
    })

    it('https: / data: の画像は <img> として描画され referrerpolicy が付く', () => {
      const httpsImg = renderMarkdown('![alt](https://example.com/a.png)')
      expect(httpsImg).toContain('<img src="https://example.com/a.png"')
      expect(httpsImg).toContain('referrerpolicy="no-referrer"')
      const dataImg = renderMarkdown('![pixel](data:image/png;base64,iVBORw0KGgo=)')
      expect(dataImg).toContain('<img src="data:image/png;base64,iVBORw0KGgo="')
      expect(dataImg).toContain('referrerpolicy="no-referrer"')
    })

    it('http: 画像は <img> を出さず alt だけ描画する (CSP img-src と揃える)', () => {
      const html = renderMarkdown('![insecure](http://example.com/a.png)')
      expect(html).not.toMatch(/<img\b/)
      expect(html).toContain('insecure')
    })

    it('相対 URL や javascript: の画像は <img> を出さず alt テキストだけ描画する', () => {
      const html = renderMarkdown('![diagram](./local.png)\n\n![bad](javascript:alert(1))')
      expect(html).not.toMatch(/<img\b/)
      expect(html).toContain('diagram')
      expect(html).toContain('bad')
    })
    /* eslint-enable no-script-url */
  })
}
