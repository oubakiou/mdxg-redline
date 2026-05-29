// Mermaid runtime と KaTeX runtime / CSS の inline 注入。
// CLI 経路の rewriteEmbeddedMermaid / rewriteEmbeddedKatex がここに集約される。
// embedded-md / embedded-shiki-langs の JSON encode 経路 (script-encoding.ts) とは別系統で、
// 素の JS / CSS source を <script> / <style> の中身として埋め込み、literal `</script>` /
// `</style>` を escape する。

import { escapeScriptTagInJs, escapeStyleTagInCss } from './script-encoding'

// Mermaid runtime 注入用。id="embedded-mermaid" + type="module" の両属性を lookahead で要求する。
// `dist/mermaid.mjs` の bundle 結果 (素の JS source) を中身として書き込む。
const EMBEDDED_MERMAID_RE =
  /(<script\b(?=[^>]*\bid="embedded-mermaid")(?=[^>]*\btype="module")[^>]*>)([\s\S]*?)(<\/script>)/i

// KaTeX runtime / CSS / fonts-extra CSS 注入用 (docs/archive/mdxg-math-rendering.archive.md §3.2 / §5.k / §5.l)。
// standalone build は vite.config.ts 側で同じ regex で inline するが、CLI 経路は本ファイルの
// rewriteEmbeddedKatex を使う。両者で regex を揃えることで rewrite の安定性を維持する。
const EMBEDDED_KATEX_JS_RE =
  /(<script\b(?=[^>]*\bid="embedded-katex")(?=[^>]*\btype="module")[^>]*>)([\s\S]*?)(<\/script>)/i
const EMBEDDED_KATEX_CSS_RE =
  /(<style\b(?=[^>]*\bid="embedded-katex-css")[^>]*>)([\s\S]*?)(<\/style>)/i
const EMBEDDED_KATEX_FONTS_EXTRA_CSS_RE =
  /(<style\b(?=[^>]*\bid="embedded-katex-fonts-extra-css")[^>]*>)([\s\S]*?)(<\/style>)/i

/**
 * `<script id="embedded-mermaid" type="module">` の中身を Mermaid ESM runtime で書き換える。
 * runtime は `dist/mermaid.mjs` の文字列を想定しており、bridge コード
 * (`globalThis.__mdxgMermaid = mermaid; document.dispatchEvent(...)`) は entry 側に含まれているため
 * ここでは追加しない。書き込み時に literal `</script>` を `<\/script>` に escape する。
 *
 * 戻り値の `escapedScriptCount` は CLI が stderr に「N 件 escape した」を報告する用 (運用上 0 件が
 * 普通だが、Mermaid version up でエラーメッセージ等に混入する可能性をゼロにしないため可視化する)。
 *
 * - `runtime` が空文字なら script タグの中身を空のまま残す (注入しない場合の no-op 経路)
 * - 該当タグが無ければ Error を投げる
 */
export const rewriteEmbeddedMermaid = (
  reviewHtml: string,
  runtime: string
): { escapedScriptCount: number; html: string } => {
  const match = EMBEDDED_MERMAID_RE.exec(reviewHtml)
  if (!match) {
    throw new Error('template HTML に id="embedded-mermaid" の <script> タグが見つかりません')
  }
  const [fullMatch, openingTag, , closingTag] = match
  const { count, escaped } = escapeScriptTagInJs(runtime)
  const replaced = `${openingTag}${escaped}${closingTag}`
  const html =
    reviewHtml.slice(0, match.index) + replaced + reviewHtml.slice(match.index + fullMatch.length)
  return { escapedScriptCount: count, html }
}

interface StyleBlockTarget {
  blockId: string
  re: RegExp
}

const rewriteStyleBlock = (html: string, css: string, target: StyleBlockTarget): string => {
  const match = target.re.exec(html)
  if (!match) {
    throw new Error(`template HTML に id="${target.blockId}" の <style> タグが見つかりません`)
  }
  const [fullMatch, openingTag, , closingTag] = match
  const replaced = `${openingTag}${escapeStyleTagInCss(css)}${closingTag}`
  return html.slice(0, match.index) + replaced + html.slice(match.index + fullMatch.length)
}

const rewriteKatexJs = (html: string, js: string): { escapedScriptCount: number; html: string } => {
  const match = EMBEDDED_KATEX_JS_RE.exec(html)
  if (!match) {
    throw new Error('template HTML に id="embedded-katex" の <script> タグが見つかりません')
  }
  const [fullMatch, openingTag, , closingTag] = match
  const { count, escaped } = escapeScriptTagInJs(js)
  const replaced = `${openingTag}${escaped}${closingTag}`
  const next = html.slice(0, match.index) + replaced + html.slice(match.index + fullMatch.length)
  return { escapedScriptCount: count, html: next }
}

export interface KatexRuntimeAssets {
  /** extra フォント CSS。`--math-fonts all` 指定時のみ渡す。undefined / 空文字なら no-op に近い書き換え */
  fontsExtraCss?: string
  /** KaTeX ESM runtime (`dist/katex/katex.mjs` の中身、bridge 込み) */
  js: string
  /** minimal フォントセットの CSS (`dist/katex/katex.css` の中身、9 family + 全 .katex ルール) */
  minimalCss: string
}

/**
 * `<script id="embedded-katex" type="module">` / `<style id="embedded-katex-css">` /
 * `<style id="embedded-katex-fonts-extra-css">` の 3 ブロックを KaTeX runtime / CSS で
 * 書き換える (Mermaid と完全に対称、docs/archive/mdxg-math-rendering.archive.md §3.2 / §5.l)。
 *
 * - `assets.fontsExtraCss` が undefined のとき (CLI `--math-fonts minimal` 既定) は
 *   fonts-extra ブロックには触らず空のまま残す。standalone build は vite.config.ts 側で
 *   全 family を inline する別経路を持つ
 * - 該当タグが無ければ Error を投げる
 * - `escapedScriptCount` は `js` 内の literal `</script>` 件数を返す (CLI が stderr 報告用)
 */
export const rewriteEmbeddedKatex = (
  reviewHtml: string,
  assets: KatexRuntimeAssets
): { escapedScriptCount: number; html: string } => {
  const { escapedScriptCount, html: withJs } = rewriteKatexJs(reviewHtml, assets.js)
  const withMinimal = rewriteStyleBlock(withJs, assets.minimalCss, {
    blockId: 'embedded-katex-css',
    re: EMBEDDED_KATEX_CSS_RE,
  })
  if (typeof assets.fontsExtraCss !== 'string') {
    return { escapedScriptCount, html: withMinimal }
  }
  const withExtra = rewriteStyleBlock(withMinimal, assets.fontsExtraCss, {
    blockId: 'embedded-katex-fonts-extra-css',
    re: EMBEDDED_KATEX_FONTS_EXTRA_CSS_RE,
  })
  return { escapedScriptCount, html: withExtra }
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('rewriteEmbeddedMermaid', () => {
    const baseHtml =
      '<html><body><script id="embedded-mermaid" type="module"></script></body></html>'

    it('runtime を中身として書き込み、escape 件数 0 を返す', () => {
      const runtime = 'globalThis.__mdxgMermaid = {};'
      const { escapedScriptCount, html } = rewriteEmbeddedMermaid(baseHtml, runtime)
      expect(html).toContain(`>${runtime}</script>`)
      expect(escapedScriptCount).toBe(0)
    })

    it(String.raw`runtime 中の literal </script> を <\/script> に escape する (件数を返す)`, () => {
      const runtime = 'var s = "</script>"; var t = "</SCRIPT>";'
      const { escapedScriptCount, html } = rewriteEmbeddedMermaid(baseHtml, runtime)
      expect(escapedScriptCount).toBe(2)
      const opening = html.indexOf('<script id="embedded-mermaid"')
      const tagOpenEnd = html.indexOf('>', opening) + 1
      const closing = html.indexOf('</script>', tagOpenEnd)
      const body = html.slice(tagOpenEnd, closing)
      expect(body.toLowerCase()).not.toContain('</script>')
      expect(body).toContain(String.raw`<\/script>`)
    })

    it('runtime が空文字なら中身も空のまま no-op に近い書き換えになる', () => {
      const { escapedScriptCount, html } = rewriteEmbeddedMermaid(baseHtml, '')
      expect(html).toContain('></script>')
      expect(escapedScriptCount).toBe(0)
    })

    it('embedded-mermaid タグが無いと Error を投げる', () => {
      expect(() => rewriteEmbeddedMermaid('<html></html>', 'x')).toThrow(/embedded-mermaid/)
    })

    it('type="module" が無い script タグは対象外', () => {
      const html = '<script id="embedded-mermaid"></script>'
      expect(() => rewriteEmbeddedMermaid(html, 'x')).toThrow(/embedded-mermaid/)
    })

    it('元文字列を破壊しない', () => {
      const html = baseHtml
      rewriteEmbeddedMermaid(html, 'x')
      expect(html).toBe(baseHtml)
    })
  })

  describe('rewriteEmbeddedKatex', () => {
    const baseHtml =
      '<html><body>' +
      '<script id="embedded-katex" type="module"></script>' +
      '<style id="embedded-katex-css"></style>' +
      '<style id="embedded-katex-fonts-extra-css"></style>' +
      '</body></html>'

    it('minimal セット (fontsExtraCss 未指定) で 2 ブロックだけ書き込み、extra は空のまま残す', () => {
      const assets = {
        js: 'globalThis.__mdxgKatex = {};',
        minimalCss: '.katex{color:red}',
      }
      const { escapedScriptCount, html } = rewriteEmbeddedKatex(baseHtml, assets)
      expect(escapedScriptCount).toBe(0)
      expect(html).toContain(`>${assets.js}</script>`)
      expect(html).toContain(`<style id="embedded-katex-css">${assets.minimalCss}</style>`)
      expect(html).toContain('<style id="embedded-katex-fonts-extra-css"></style>')
    })

    it('fontsExtraCss 指定で 3 ブロック全て書き込む (--math-fonts all 経路)', () => {
      const assets = {
        fontsExtraCss: '@font-face{font-family:Caligraphic}',
        js: 'globalThis.__mdxgKatex = {};',
        minimalCss: '.katex{color:red}',
      }
      const { html } = rewriteEmbeddedKatex(baseHtml, assets)
      expect(html).toContain(`>${assets.js}</script>`)
      expect(html).toContain(`<style id="embedded-katex-css">${assets.minimalCss}</style>`)
      expect(html).toContain(
        `<style id="embedded-katex-fonts-extra-css">${assets.fontsExtraCss}</style>`
      )
    })

    it(String.raw`js 内の literal </script> を <\/script> に escape して件数を返す`, () => {
      const assets = {
        js: 'var s = "</script>"; var t = "</SCRIPT>";',
        minimalCss: '',
      }
      const { escapedScriptCount, html } = rewriteEmbeddedKatex(baseHtml, assets)
      expect(escapedScriptCount).toBe(2)
      const opening = html.indexOf('<script id="embedded-katex"')
      const tagOpenEnd = html.indexOf('>', opening) + 1
      const closing = html.indexOf('</script>', tagOpenEnd)
      const body = html.slice(tagOpenEnd, closing)
      expect(body.toLowerCase()).not.toContain('</script>')
      expect(body).toContain(String.raw`<\/script>`)
    })

    it(String.raw`css 内の literal </style> を <\/style> に escape する`, () => {
      const assets = {
        js: '',
        minimalCss: '/* contains </style> in comment */ .katex { content: "</style>" }',
      }
      const { html } = rewriteEmbeddedKatex(baseHtml, assets)
      const cssOpen = html.indexOf('<style id="embedded-katex-css"')
      const cssTagOpenEnd = html.indexOf('>', cssOpen) + 1
      const cssClose = html.indexOf('</style>', cssTagOpenEnd)
      const cssBody = html.slice(cssTagOpenEnd, cssClose)
      expect(cssBody.toLowerCase()).not.toContain('</style>')
      expect(cssBody).toContain(String.raw`<\/style>`)
    })

    it('embedded-katex script タグが無いと Error を投げる', () => {
      expect(() => rewriteEmbeddedKatex('<html></html>', { js: 'x', minimalCss: '' })).toThrow(
        /embedded-katex/
      )
    })

    it('embedded-katex-css style タグが無いと Error を投げる', () => {
      const html = '<html><script id="embedded-katex" type="module"></script></html>'
      expect(() => rewriteEmbeddedKatex(html, { js: 'x', minimalCss: 'y' })).toThrow(
        /embedded-katex-css/
      )
    })

    it('fontsExtraCss 指定時に該当タグが無いと Error を投げる', () => {
      const html =
        '<html><script id="embedded-katex" type="module"></script>' +
        '<style id="embedded-katex-css"></style></html>'
      expect(() =>
        rewriteEmbeddedKatex(html, { fontsExtraCss: 'z', js: 'x', minimalCss: 'y' })
      ).toThrow(/embedded-katex-fonts-extra-css/)
    })

    it('元文字列を破壊しない', () => {
      const html = baseHtml
      rewriteEmbeddedKatex(html, { js: 'x', minimalCss: 'y' })
      expect(html).toBe(baseHtml)
    })
  })
}
