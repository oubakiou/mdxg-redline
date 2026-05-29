// markdown.ts の renderer.code に渡す coderenderer factory を切り出した module。
// フェンス付きコードブロックを Shiki 等の highlighter で差し替える経路、未対応言語の
// fallback、mermaid 検出 (`<pre data-mermaid="1">` 注入) を 1 つの pure 関数で組み立てる。

import { MERMAID_ATTR, MERMAID_ATTR_VALUE } from './mermaid-attrs'
import { Renderer } from 'marked'
import { escapeHtml } from './escape'

/**
 * フェンス付きコードブロックをハイライト済み HTML に変換する抽象。
 * `null` を返した場合は marked デフォルトの `<pre><code class="language-...">…</code></pre>`
 * にフォールバックする。core/markdown.ts は pure module を保つため Shiki に直接依存せず、
 * 呼び出し側 (app/shiki.ts) が adapter を作って渡す。
 */
export interface CodeHighlighter {
  highlight(code: string, rawLang: string): string | null
}

interface CodeRenderRequest {
  code: string
  escaped: boolean
  isMermaid: boolean
  lang: string
}

// renderer.code (marked デフォルト) のフォールバック用。highlighter が null を返したときに使う。
const defaultRenderer = new Renderer()

// `<pre>` 開始タグに data-mermaid="1" 属性を注入する。
// 既に data-lang 等が付いていても、先頭 `<pre` の直後に挿入することで他属性を壊さない。
// ` ```mermaid ` ブロック以外では何もせず元 HTML を返す。
const injectMermaidAttr = (html: string, isMermaid: boolean): string => {
  if (!isMermaid) {
    return html
  }
  return html.replace(/^<pre\b/u, `<pre ${MERMAID_ATTR.code}="${MERMAID_ATTR_VALUE}"`)
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

/**
 * renderer.code factory。`createRenderer` (markdown.ts 内) が `renderer.code = createCodeRenderer(highlighter)` で
 * セットする想定。`infostring` (= フェンス開始行の lang 識別子) を trim して mermaid 判定 + highlighter 試行 →
 * 失敗時 fallback。
 */
export const createCodeRenderer =
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
