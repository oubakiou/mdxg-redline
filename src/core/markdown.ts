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

/**
 * フェンス付きコードブロックを ハイライト済み HTML に変換する抽象。
 * `null` を返した場合は marked デフォルトの `<pre><code class="language-...">…</code></pre>`
 * にフォールバックする。core/markdown.ts は pure module を保つため Shiki に直接依存せず、
 * 呼び出し側 (app/shiki.ts) が adapter を作って渡す。
 */
export interface CodeHighlighter {
  highlight(code: string, rawLang: string): string | null
}

const titleAttr = (title: string | null): string => {
  if (!title) {
    return ''
  }
  return ` title="${escapeHtml(title)}"`
}

// #doc の max-width を超える広いテーブルが親レイアウトを破壊しないよう、
// table をスクロール可能なラッパで包む (MDXG §5 [MUST] 広いテーブルの水平スクロール)。
// blockId は #doc 直下の子要素 (= このラッパ div) に付与されるが、内部 DOM ツリーは
// 通常の <table> のままなのでテキストオフセット計算とアンカリングへの影響はない。
const wrapTbody = (body: string): string => {
  if (body) {
    return `<tbody>${body}</tbody>`
  }
  return ''
}

// renderer.code (marked デフォルト) のフォールバック用。highlighter が null を返したときに使う。
const defaultRenderer = new Renderer()

/**
 * marked 出力の H3–H6 に `id` を注入するためのヒント。
 * `headingSlugs` は H3–H6 の出現順 (文書順) に並んだ slug 列で、page-outline の
 * `extractPageHeadings` 出力をそのまま渡せる契約 (mdxg-virtual-pages.archive.md §6.4)。
 * H1 / H2 はページ境界として scanHeadings が拾うが、本実装では active page を 1 枚ずつ
 * render する設計のためページ内に H1 / H2 はそのページ自身の見出し 1 つだけになる。
 * その見出しには id を付けない (URL fragment は `<page-slug>` で済むため別途用意しない)。
 */
export interface MarkdownRenderOptions {
  headingSlugs?: readonly string[]
}

const headingHtmlWithId = (text: string, level: number, slug: string | null): string => {
  if (slug === null) {
    return `<h${level}>${text}</h${level}>\n`
  }
  return `<h${level} id="${escapeHtml(slug)}">${text}</h${level}>\n`
}

const resolveHeadingSlugs = (options: MarkdownRenderOptions | undefined): readonly string[] => {
  if (!options) {
    return []
  }
  if (!options.headingSlugs) {
    return []
  }
  return options.headingSlugs
}

const createHeadingRenderer = (
  options: MarkdownRenderOptions | undefined
): ((text: string, level: number, raw: string) => string) => {
  const slugs = resolveHeadingSlugs(options)
  let outlineIndex = 0
  return (text: string, level: number): string => {
    if (level >= 3 && level <= 6) {
      const slug = slugs[outlineIndex] ?? null
      outlineIndex += 1
      return headingHtmlWithId(text, level, slug)
    }
    return `<h${level}>${text}</h${level}>\n`
  }
}

// `<pre>` 開始タグに data-mermaid="1" 属性を注入する。
// 既に data-lang 等が付いていても、先頭 `<pre` の直後に挿入することで他属性を壊さない。
// ` ```mermaid ` ブロック以外では何もせず元 HTML を返す。
const injectMermaidAttr = (html: string, isMermaid: boolean): string => {
  if (!isMermaid) {
    return html
  }
  return html.replace(/^<pre\b/u, `<pre data-mermaid="1"`)
}

interface CodeRenderRequest {
  code: string
  escaped: boolean
  isMermaid: boolean
  lang: string
}

const tryHighlight = (highlighter: CodeHighlighter, req: CodeRenderRequest): string | null => {
  const highlighted = highlighter.highlight(req.code, req.lang)
  if (highlighted === null) {
    return null
  }
  const withLang = highlighted.replace(/^<pre(\s|>)/u, `<pre data-lang="${escapeHtml(req.lang)}"$1`)
  return injectMermaidAttr(withLang, req.isMermaid)
}

const renderFallbackCode = (req: CodeRenderRequest): string => {
  const fallback = defaultRenderer.code(req.code, req.lang, req.escaped)
  if (!req.lang) {
    return fallback
  }
  const withLang = fallback.replace(/^<pre>/u, `<pre data-lang="${escapeHtml(req.lang)}">`)
  return injectMermaidAttr(withLang, req.isMermaid)
}

// renderer.code 単体だと max-statements を超えるため pure helper として外に出す。
const createCodeRenderer =
  (
    highlighter: CodeHighlighter | null | undefined
  ): ((code: string, infostring: string | undefined, escaped: boolean) => string) =>
  (code: string, infostring: string | undefined, escaped: boolean): string => {
    const lang = (infostring ?? '').trim()
    const req: CodeRenderRequest = {
      code,
      escaped,
      isMermaid: lang.toLowerCase() === 'mermaid',
      lang,
    }
    if (highlighter && lang) {
      const highlighted = tryHighlight(highlighter, req)
      if (highlighted !== null) {
        return highlighted
      }
    }
    return renderFallbackCode(req)
  }

const createRenderer = (
  highlighter: CodeHighlighter | null | undefined,
  options?: MarkdownRenderOptions
): Renderer => {
  const renderer = new Renderer()
  renderer.html = (html: string): string => escapeHtml(html)
  renderer.heading = createHeadingRenderer(options)

  // 信頼できない markdown を前提に、URL スキームを allowlist で絞る (DESIGN.md §11)。
  // 不許可リンクは <a> を出さず inner HTML をそのまま流して plain text 扱いにし、
  // 不許可画像は alt テキストを描画して画像取得を起こさない。
  renderer.link = (href: string, title: string | null, text: string): string => {
    if (!isAllowedLinkHref(href)) {
      return text
    }
    return `<a href="${escapeHtml(href)}"${titleAttr(title)} rel="noopener noreferrer" target="_blank">${text}</a>`
  }

  renderer.image = (href: string, title: string | null, text: string): string => {
    if (!isAllowedImageHref(href)) {
      return escapeHtml(text)
    }
    return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${titleAttr(title)} referrerpolicy="no-referrer">`
  }

  renderer.table = (header: string, body: string): string =>
    `<div class="table-wrap"><table>\n<thead>\n${header}</thead>\n${wrapTbody(body)}</table>\n</div>\n`

  renderer.code = createCodeRenderer(highlighter)

  return renderer
}

/**
 * marked で markdown を HTML に変換。raw HTML は実行されないよう文字として escape する。
 * `highlighter` を渡すとフェンス付きコードブロックを差し替える (null 戻り値で fallback)。
 * `options.headingSlugs` を渡すと H3–H6 に `id="<slug>"` を出現順で注入し、Page Outline の
 * URL fragment (`<page-slug>__<heading-slug>`) のスクロール先として使える (MDXG §8 / §6.4)。
 */
export const renderMarkdown = (
  markdown: string,
  highlighter?: CodeHighlighter | null,
  options?: MarkdownRenderOptions
): string => {
  const result = marked.parse(markdown, {
    breaks: false,
    gfm: true,
    renderer: createRenderer(highlighter, options),
  })
  // marked.parse は同期設定 (async: false) ではあるが型上 string | Promise<string>
  if (typeof result === 'string') {
    return result
  }
  return ''
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('renderMarkdown raw HTML and fenced code', () => {
    it('raw HTML is escaped instead of emitted as executable markup', () => {
      const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">')
      expect(html).not.toContain('<script>')
      expect(html).not.toContain('<img src=x')
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
      expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
    })

    it('HTML examples inside fenced code blocks remain code', () => {
      const html = renderMarkdown('```html\n<div onclick="alert(1)">x</div>\n```')
      expect(html).toContain('<pre data-lang="html"><code class="language-html">')
      expect(html).toContain('&lt;div onclick=&quot;alert(1)&quot;&gt;x&lt;/div&gt;')
    })

    it('言語識別子付きのフェンスは <pre data-lang="…"> が出る (MDXG §2.2 言語ラベル用フック)', () => {
      const html = renderMarkdown('```ts\nconst x = 1\n```')
      expect(html).toContain('<pre data-lang="ts"><code class="language-ts">')
    })

    it('言語識別子なしのフェンスには data-lang が付かない', () => {
      const html = renderMarkdown('```\nplain code\n```')
      expect(html).toMatch(/<pre><code>/u)
      expect(html).not.toContain('data-lang')
    })

    it('data-lang の値は HTML escape される (属性インジェクション防止)', () => {
      const html = renderMarkdown('```ts" onclick="alert(1)\nx\n```')
      expect(html).not.toContain('onclick="alert(1)"')
      expect(html).toContain('&quot;')
    })

    it('highlighter 成功時も Shiki 出力の <pre> 開始タグに data-lang が注入される', () => {
      const highlighter: CodeHighlighter = {
        highlight(code: string): string | null {
          return `<pre class="shiki" style="--shiki-dark:#fff" tabindex="0"><code>${code}</code></pre>`
        },
      }
      const html = renderMarkdown('```ts\nconst x = 1\n```', highlighter)
      expect(html).toContain('<pre data-lang="ts" class="shiki"')
    })

    it('highlighter が null を返したフェンスでも fallback で data-lang が出る', () => {
      const highlighter: CodeHighlighter = {
        highlight(): string | null {
          return null
        },
      }
      const html = renderMarkdown('```nim\ndoSomething()\n```', highlighter)
      expect(html).toContain('<pre data-lang="nim"><code class="language-nim">')
    })

    it('highlighter 成功時の data-lang も HTML escape される (属性インジェクション防止)', () => {
      const highlighter: CodeHighlighter = {
        highlight(code: string): string | null {
          return `<pre class="shiki"><code>${code}</code></pre>`
        },
      }
      const html = renderMarkdown('```ts" onclick="alert(1)\nx\n```', highlighter)
      expect(html).not.toContain('onclick="alert(1)"')
      expect(html).toContain('&quot;')
    })
  })

  describe('renderMarkdown mermaid fence attribute (MDXG §15 / data-mermaid)', () => {
    it('```mermaid フェンスは <pre data-mermaid="1"> 属性付きで出力される', () => {
      const html = renderMarkdown('```mermaid\ngraph TD\nA-->B\n```')
      expect(html).toContain('data-mermaid="1"')
      expect(html).toContain('data-lang="mermaid"')
      // Shiki ハイライト経路を skip しない (fallback 用) ため、language-mermaid クラスも残る
      expect(html).toContain('language-mermaid')
    })

    it('Mermaid / MERMAID も小文字判定で data-mermaid="1" が付く', () => {
      const lower = renderMarkdown('```Mermaid\ngraph TD\nA-->B\n```')
      const upper = renderMarkdown('```MERMAID\ngraph TD\nA-->B\n```')
      expect(lower).toContain('data-mermaid="1"')
      expect(upper).toContain('data-mermaid="1"')
    })

    it('mermaid 以外の言語 (ts / py 等) には data-mermaid 属性が付かない', () => {
      const ts = renderMarkdown('```ts\nlet x = 1\n```')
      const py = renderMarkdown('```py\nx = 1\n```')
      expect(ts).not.toContain('data-mermaid')
      expect(py).not.toContain('data-mermaid')
    })

    it('highlighter 成功時の Shiki 出力にも data-mermaid="1" が注入される', () => {
      const highlighter: CodeHighlighter = {
        highlight(code: string): string | null {
          return `<pre class="shiki" tabindex="0"><code>${code}</code></pre>`
        },
      }
      const html = renderMarkdown('```mermaid\ngraph TD\nA-->B\n```', highlighter)
      expect(html).toContain('<pre data-mermaid="1"')
      expect(html).toContain('class="shiki"')
    })
  })

  describe('renderMarkdown link allowlist', () => {
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
    /* eslint-enable no-script-url */

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
  })

  describe('renderMarkdown image allowlist', () => {
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

    /* eslint-disable no-script-url */
    it('相対 URL や javascript: の画像は <img> を出さず alt テキストだけ描画する', () => {
      const html = renderMarkdown('![diagram](./local.png)\n\n![bad](javascript:alert(1))')
      expect(html).not.toMatch(/<img\b/)
      expect(html).toContain('diagram')
      expect(html).toContain('bad')
    })
    /* eslint-enable no-script-url */
  })

  describe('renderMarkdown table rendering', () => {
    it('table は <div class="table-wrap"> でラップされ <table> 構造を保つ (MDXG §5 水平スクロール対応)', () => {
      const html = renderMarkdown('| A | B |\n|---|---|\n| 1 | 2 |\n')
      expect(html).toContain('<div class="table-wrap"><table>')
      expect(html).toContain('</table>\n</div>')
      expect(html).toContain('<thead>')
      expect(html).toContain('<tbody>')
      expect(html).toContain('<th>A</th>')
      expect(html).toContain('<td>1</td>')
    })

    it('body が空のテーブルでも <tbody> を出さない (marked デフォルト挙動を維持)', () => {
      const html = renderMarkdown('| A | B |\n|---|---|\n')
      expect(html).toContain('<div class="table-wrap"><table>')
      expect(html).not.toContain('<tbody>')
      expect(html).toContain('<th>A</th>')
    })

    // doc-renderer の cacheBlockOriginalHTML は #doc 直下の子要素を順に巡って blockId を振る。
    // table token 1 つにつきラッパ div 1 つが top-level に出ることが崩れると、blockId 連番が DOM
    // 側だけズレて block-anchors (lexer 側) と対応が壊れるため、1:1 対応を構造的に固定する。
    it('複数 table を含む markdown でも table-wrap が table token と 1:1 対応する', () => {
      const html = renderMarkdown('| A |\n|---|\n| 1 |\n\nbetween\n\n| B |\n|---|\n| 2 |\n')
      expect(html.match(/<div class="table-wrap">/g)).toHaveLength(2)
      expect(html.match(/<\/table>\n<\/div>/g)).toHaveLength(2)
    })
  })

  describe('renderMarkdown heading id injection (MDXG §8 outline anchors)', () => {
    it('headingSlugs を渡すと H3–H6 に id 属性が出現順で注入される', () => {
      const html = renderMarkdown(
        '## Page Title\n\n### Section A\n\n#### Sub A\n\n### Section B\n',
        null,
        {
          headingSlugs: ['section-a', 'sub-a', 'section-b'],
        }
      )
      expect(html).toContain('<h3 id="section-a">Section A</h3>')
      expect(html).toContain('<h4 id="sub-a">Sub A</h4>')
      expect(html).toContain('<h3 id="section-b">Section B</h3>')
    })

    it('headingSlugs 未指定なら H3–H6 に id は付かない (旧挙動互換)', () => {
      const html = renderMarkdown('### Section\n')
      expect(html).toContain('<h3>Section</h3>')
      expect(html).not.toContain('id=')
    })

    it('H1 / H2 (ページ境界見出し) には id を付けない', () => {
      const html = renderMarkdown('# Page\n\n## Sub Page\n\n### Section\n', null, {
        headingSlugs: ['section'],
      })
      expect(html).toMatch(/<h1>Page<\/h1>/)
      expect(html).toMatch(/<h2>Sub Page<\/h2>/)
      expect(html).toContain('<h3 id="section">Section</h3>')
    })

    it('headingSlugs の数が H3–H6 個数より少なくても残りは id 無しで出る', () => {
      const html = renderMarkdown('### A\n\n### B\n\n### C\n', null, { headingSlugs: ['a'] })
      expect(html).toContain('<h3 id="a">A</h3>')
      expect(html).toContain('<h3>B</h3>')
      expect(html).toContain('<h3>C</h3>')
    })

    it('slug は HTML escape される (属性インジェクション防止)', () => {
      const html = renderMarkdown('### Section\n', null, {
        headingSlugs: ['x"onmouseover="alert(1)'],
      })
      expect(html).not.toContain('onmouseover="alert(1)"')
      expect(html).toContain('&quot;')
    })
  })
}
