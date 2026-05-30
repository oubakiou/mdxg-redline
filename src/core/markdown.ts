import { Marked, Renderer } from 'marked'
import { type CodeHighlighter, createCodeRenderer } from './markdown-code-renderer'
import footnote from 'marked-footnote'

import { type MathSegment, scanMath } from './math'
import { escapeHtml } from './escape'

export type { CodeHighlighter }

// 本モジュール専用の Marked instance に marked-footnote を載せる。global `marked`
// (block-anchors / scan-fenced-langs / scan-mermaid / math が共有) には use しない:
// marked-footnote は lexer 出力先頭に synthetic な type:'footnotes' placeholder token を
// 必ず挿入するため、global を共有する他モジュールの top-level token 走査が黙って崩れる
// (docs/mdxg-footnotes.md §4 Step 2 / Step 1 PoC で確定)。
const markedInstance = new Marked()
markedInstance.use(footnote())

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

/**
 * marked 出力の H3–H6 に `id` を注入するためのヒント。
 * `headingSlugs` は H3–H6 の出現順 (文書順) に並んだ slug 列で、page-outline の
 * `extractPageHeadings` 出力をそのまま渡せる契約 (DESIGN.md §12 §6 Virtual Pages)。
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

// code renderer / mermaid 属性注入は core/markdown-code-renderer.ts に分離。

// `$...$` / `$$...$$` 数式を escape 済みインラインテキスト中から検出し、
// `<span data-math="inline">` / `<div data-math="display">` で包んで返す
// (docs/archive/mdxg-math-rendering.archive.md §5.a / Step 5a)。
//
// 重要:
// - marked v12 の `renderer.text` は inline parser が escape 済みの text を渡してくる。
//   `<` などの記号は `&lt;` に変換されており、`$` だけは escape されないため scanMath が
//   そのまま動く。`MathSegment.source` も escape 済み text の slice なので、属性値・
//   textContent ともに HTML 安全な状態で書き出せる
// - `data-math-source` 属性値には `$` 区切りを除去済みの clean LaTeX (`MathSegment.source`)
//   が入る。Step 5b の upgrade は `getAttribute('data-math-source')` で値を取得して
//   `katex.renderToString` に渡す経路を取り、textContent (raw `$...$`) は §14 [MUST] の
//   plain text fallback として残す
// - 装飾 (em / strong) と数式が同一テキスト内に並ぶケースは marked の inline parser が
//   別 token に分離するため、ここではただ scanMath を呼ぶだけで OK (装飾内の `$...$` は
//   装飾 token 内の text として独立に処理される)
// `data-math-source` 属性値用の最小 escape。marked が inline parser 段階で `<` / `>` / `&` /
// `"` を実体参照化済みなので、ここで `escapeHtml` を再適用すると二重 escape され、後段の
// `getAttribute('data-math-source')` が clean な LaTeX を返さなくなる。属性値として安全に
// 書けるのに足りる「literal `"` を `&quot;` に潰す」だけに絞る (`&quot;` は再変換されない)。
const escapeMathSourceAttr = (source: string): string => source.replace(/"/g, '&quot;')

// `<span>` で出力する理由: `renderer.text` は marked が paragraph / heading / list_item の
// inline 文脈で呼ぶため、ここで block element (`<div>`) を返すと HTML5 parser が `<p>` を
// 強制 close して構造が壊れる (`<p>text <div>...</div> more</p>` → `<p>text </p><div>...</div>
// <p> more</p>`)。display 数式の見た目 (中央寄せ + 余白) は CSS の `display: block; margin;
// text-align: center` で再現する (`src/styles/markdown.css` の `#doc [data-math="display"]`)。
// KaTeX upgrade 後は `.katex-display` クラスも同じ block 化を行うため CSS 上書きと整合する。
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

const renderMathInTextRun = (text: string): string => {
  const segments = scanMath(text)
  if (segments.length === 0) {
    return text
  }
  return collectMathParts(text, segments).join('')
}

const createRenderer = (
  highlighter: CodeHighlighter | null | undefined,
  options?: MarkdownRenderOptions
): Renderer => {
  const renderer = new Renderer()
  renderer.html = (html: string): string => escapeHtml(html)
  renderer.heading = createHeadingRenderer(options)
  renderer.text = renderMathInTextRun

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
  const result = markedInstance.parse(markdown, {
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

// `renderMarkdown` 出力から **単一段落のみ** の outer `<p>...</p>\n?` を 1 段剥がす。
// 中身に `</p>` を含まないことを `(?:(?!</p>)[\s\S])*` で明示することで、
// 複数段落 (`<p>a</p>\n<p>b</p>\n`) のときは match しない (= block-level HTML をそのまま返す)。
// 中身に raw `</p>` リテラルが入る可能性は本実装の `renderer.html = escapeHtml` で
// 構造的に排除済み (DESIGN.md §11)。
const SINGLE_PARAGRAPH_WRAP_RE = /^<p>((?:(?!<\/p>)[\s\S])*)<\/p>\n?$/u

/**
 * `markdown` を **inline 文脈**として安全に render する。
 * marked の `parseInline` は本実装の Renderer override (raw HTML escape / link allowlist /
 * image allowlist) を経由しないため、信頼できない markdown を inline render すると XSS の
 * 経路になる。本関数は `renderMarkdown` を通して block render し、単一段落であれば outer
 * `<p>...</p>` を剥がして inline-safe な HTML を返す経路で信頼境界を共通化する。
 *
 * 複数段落の markdown を渡した場合は剥がさず block-level HTML (`<p>...</p>\n<p>...</p>` 等)
 * をそのまま返す。呼び出し側はその場合の DOM 構造を許容する文脈でのみ使うこと。
 *
 * 用途: 未参照定義 (orphan footnote) の本文 inline render など、
 * 本文 markdown 由来コンテンツを `innerHTML` で DOM に焼き込む前段。
 */
export const renderInlineSafely = (markdown: string): string => {
  const blockHtml = renderMarkdown(markdown)
  const match = SINGLE_PARAGRAPH_WRAP_RE.exec(blockHtml)
  if (match === null) {
    return blockHtml
  }
  return match[1]
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

    // allowlist が javascript: を弾くことを確認するテストデータのため局所的に無効化する。
    /* eslint-disable no-script-url */
    it('相対 URL や javascript: の画像は <img> を出さず alt テキストだけ描画する', () => {
      const html = renderMarkdown('![diagram](./local.png)\n\n![bad](javascript:alert(1))')
      expect(html).not.toMatch(/<img\b/)
      expect(html).toContain('diagram')
      expect(html).toContain('bad')
    })
    /* eslint-enable no-script-url */
  })

  describe('renderMarkdown math segments (MDXG §14 / data-math)', () => {
    it('$x$ inline 数式は <span data-math="inline" data-math-source="…"> で出力される', () => {
      const html = renderMarkdown('Try $x^2 + y^2$ here.\n')
      expect(html).toContain(
        '<span data-math="inline" data-math-source="x^2 + y^2">$x^2 + y^2$</span>'
      )
      // raw $...$ を textContent に残し、§14 [MUST] の plain text fallback を初期 paint から成立させる
      expect(html).toContain('>$x^2 + y^2$<')
    })

    it('$$...$$ display 数式は <span data-math="display"> で出力される (block 表示は CSS で再現)', () => {
      // renderer.text は paragraph 内 inline 文脈で呼ばれるため、display も <span> で出力する。
      // <div> を返すと HTML5 parser が <p> を強制 close して構造が壊れる (§5.c / Step 9)。
      const html = renderMarkdown('$$\\frac{a}{b}$$\n')
      expect(html).toContain('<span data-math="display"')
      expect(html).toContain(String.raw`data-math-source="\frac{a}{b}"`)
      expect(html).toContain(String.raw`>$$\frac{a}{b}$$</span>`)
      // <p><div> ような不正な構造を作っていないこと
      expect(html).not.toContain('<div data-math')
    })

    it('inline と display が混在しても文書順に検出される', () => {
      const html = renderMarkdown('mixed $a$ and $$b$$ here\n')
      const inlineIdx = html.indexOf('data-math="inline"')
      const displayIdx = html.indexOf('data-math="display"')
      expect(inlineIdx).toBeGreaterThanOrEqual(0)
      expect(displayIdx).toBeGreaterThan(inlineIdx)
    })

    it('インラインコード `$x$` 内の $ は data-math に化けない', () => {
      const html = renderMarkdown('inline code `$x$` should not match\n')
      expect(html).not.toContain('data-math="inline"')
      expect(html).toContain('<code>$x$</code>')
    })

    it('フェンスコード内の $ は data-math に化けない', () => {
      const html = renderMarkdown('```ts\nconst price = "$100"\n```\n')
      expect(html).not.toContain('data-math')
    })

    it(String.raw`\$ エスケープは数式境界として扱わず literal $ として残る`, () => {
      const html = renderMarkdown('Cost is \\$100 and \\$200.\n')
      expect(html).not.toContain('data-math')
      expect(html).toContain('$100')
      expect(html).toContain('$200')
    })

    it('data-math-source の値は HTML escape される (属性インジェクション防止)', () => {
      // marked が inline parse 段階で `<` を escape するので、source に渡る時点で &lt; になる。
      // ここでは追加で属性 escape 経路を通っていることを確認する目的で `"` を混ぜる
      const html = renderMarkdown('$a"b$\n')
      expect(html).not.toContain('data-math-source="a"b"')
      expect(html).toContain('data-math-source="a&quot;b"')
    })

    it('数式が無い text run は data-math タグを 1 つも出さない', () => {
      const html = renderMarkdown('plain paragraph with no math here.\n')
      expect(html).not.toContain('data-math')
    })
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

  // renderInlineSafely は orphan 脚注本文の inline render に使われる。renderer.html (raw HTML
  // escape) / renderer.link (URL allowlist) / renderer.image (image allowlist) と同じ信頼境界を
  // 通すことが review feedback Critical 指摘への対応の本質なので、それぞれの保護が効くことを
  // pin する。
  describe('renderInlineSafely (信頼境界の共通化)', () => {
    it('単一段落 markdown では outer <p>...</p> を剥がして inline-safe HTML を返す', () => {
      expect(renderInlineSafely('see **bold** here')).toBe('see <strong>bold</strong> here')
    })

    it('raw HTML タグは文字 escape される (renderer.html 連携)', () => {
      const html = renderInlineSafely('<script>alert(1)</script>')
      expect(html).not.toContain('<script>')
      expect(html).toContain('&lt;script&gt;')
    })

    it('raw <img onerror> も文字 escape される (XSS 防止)', () => {
      const html = renderInlineSafely('text <img src=x onerror=alert(1)> more')
      expect(html).not.toMatch(/<img\b/u)
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    })

    // allowlist が javascript: を弾くことを確認するテストデータのため局所的に無効化する。
    /* eslint-disable no-script-url */
    it('javascript: リンクは <a> を出さず text だけ残る (renderer.link allowlist)', () => {
      const html = renderInlineSafely('[click](javascript:alert(1))')
      expect(html).not.toMatch(/<a\b/u)
      expect(html).not.toContain('javascript:')
      expect(html).toContain('click')
    })
    /* eslint-enable no-script-url */

    it('http: 画像は <img> を出さず alt だけ残る (renderer.image allowlist)', () => {
      const html = renderInlineSafely('![insecure](http://example.com/a.png)')
      expect(html).not.toMatch(/<img\b/u)
      expect(html).toContain('insecure')
    })

    it('複数段落 markdown では outer <p> を剥がさず block-level HTML を返す', () => {
      const html = renderInlineSafely('para a\n\npara b')
      expect(html).toContain('<p>para a</p>')
      expect(html).toContain('<p>para b</p>')
    })

    it('空文字列は空のまま (空段落 <p></p> でも内側空文字を返す)', () => {
      expect(renderInlineSafely('')).toBe('')
    })
  })
}
