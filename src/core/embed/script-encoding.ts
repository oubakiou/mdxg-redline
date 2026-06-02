// `<script>` タグ内に JSON を埋め込むための encode と、Mermaid / KaTeX runtime 内の literal
// 閉じタグ escape を共通化した内部ユーティリティ。
//
// embedded-md / embedded-shiki-langs / embedded-feedback など複数の埋め込み経路で
// 共有する。`<` を JSON Unicode escape `<` に置換することで、HTML パーサが
// `</script>` を閉じタグとして誤検出する余地をゼロにする。
//
// ⚠️ template literal の中身は **literal バックスラッシュ + u003C** (7 バイト) で書く必要がある
// (`String.raw` は raw 形式を保持するが、ソースに Unicode escape を書くと TypeScript lexer が
// 先に 1 文字 `<` に解決してしまい raw 保持が成立せず replace が no-op になる)。同パターンを
// 使う vite.config.ts の `inlineGrammarsIntoHtml` も同じ注意が必要。

const escapeJsonForScriptTag = (jsonString: string): string =>
  jsonString.replace(/</g, String.raw`\u003C`)

/**
 * markdown 本文を `<script id="embedded-md">` に埋め込み可能な JSON 文字列にエンコードする。
 * 復元は `JSON.parse` のみで完結する。
 */
export const encodeEmbeddedMarkdown = (markdown: string): string =>
  escapeJsonForScriptTag(JSON.stringify(markdown))

/**
 * Shiki grammar の集合を `<script id="embedded-shiki-langs">` に埋め込み可能な JSON 文字列に
 * エンコードする。grammars は `{ <canonical>: LanguageRegistration[] }` 形式の plain object で、
 * 復元側 (browser) は `JSON.parse` した後 createHighlighterCoreSync の `langs` に値を渡す。
 */
export const encodeEmbeddedShikiLangs = (grammars: Record<string, unknown>): string =>
  escapeJsonForScriptTag(JSON.stringify(grammars))

/**
 * feedback payload を `<script id="embedded-feedback">` に埋め込み可能な JSON 文字列に
 * エンコードする。CLI が同じ <name>-<hash>- プレフィックスの feedback.json から読み取って
 * 注入する resume 経路で使う。`<` を Unicode escape する点は他の embedded-* と共通で、
 * 復元側 (boot.ts) は textContent を `JSON.parse` → `embeddedCommentsFromUnknown` で受ける。
 */
export const encodeEmbeddedFeedback = (payload: unknown): string =>
  escapeJsonForScriptTag(JSON.stringify(payload))

// Mermaid / KaTeX bundle 中の literal `</script>` を `<\/script>` に escape する。
// embedded-md / embedded-shiki-langs の `<` Unicode escape とは別経路 (こちらは素の JS source な
// ので JSON encode を経由できない)。Mermaid のエラーメッセージ / regex / コメントに `</script>` が
// 混入し得る可能性をゼロにしないことで build を fail させない設計 (§3.2 注入経路)。
// 戻り値で escape 件数を返し、CLI が stderr に報告する。
//
// 実運用上は no-op の二重保険: Rolldown / oxc minifier は string literal 中の `</script>` を
// `<\/script>` に自動 escape するため、`dist/mermaid.mjs` / `dist/katex/katex.mjs` 段で既に
// literal は 0 件。さらに `vite-plugin-singlefile` も inline 時に同種の escape を行う。
// この関数は (a) 上流 escape が将来の bundler 更新で壊れた場合の defensive depth、
// (b) `escapedScriptCount` 戻り値による CLI 観測経路、の 2 目的で維持する。
export const escapeScriptTagInJs = (jsSource: string): { count: number; escaped: string } => {
  let count = 0
  const escaped = jsSource.replace(/<\/script>/gi, (): string => {
    count += 1
    return String.raw`<\/script>`
  })
  return { count, escaped }
}

// CSS source の literal `</style>` を `<\/style>` に escape する (escapeScriptTagInJs と
// 同じ規約、CSS コメントや content: 値に閉じタグ文字列が混入してもパースが壊れないため)。
//
// JS 側と異なり、CSS には上流の自動 escape が無い: `vite-plugin-singlefile` の replaceCss は
// `@charset` を剥がすだけで `</style>` を escape しない (`node_modules/vite-plugin-singlefile/
// dist/esm/index.js` line 12-17 で確認)。Rolldown / oxc に相当する CSS minifier の保護も無い。
// したがって本関数は **CSS 側の唯一の防壁** として実質的に発動し得る (現 KaTeX CSS は 0 件だが
// 構造的なギャップは塞がる)。同実装が `src/build/inline-markdown-css.ts` の `escapeStyleTagInCss`
// と `vite.config.ts` の `inlineCssBlock` (build 時の standalone.html 用 KaTeX CSS inline 経路)
// にも独立に存在する。3 経路の依存ゼロ要件 (vite-plus loader の transitive import 制約) を
// 優先して DRY より重複を許容している。
export const escapeStyleTagInCss = (cssSource: string): string =>
  cssSource.replace(/<\/style>/gi, String.raw`<\/style>`)

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('encodeEmbeddedMarkdown', () => {
    it('JSON.parse で元 markdown に戻せる (round-trip)', () => {
      const md = '# hello\nworld\n'
      expect(JSON.parse(encodeEmbeddedMarkdown(md))).toBe(md)
    })

    it('encoded には raw < が一切現れない（HTML パーサが閉じタグを検出しない）', () => {
      const encoded = encodeEmbeddedMarkdown('before </script> after <div>')
      expect(encoded.includes('<')).toBe(false)
    })

    it('</script> を含む markdown も JSON.parse で完全復元される', () => {
      const md = 'before </script> after </Script> and <div>'
      expect(JSON.parse(encodeEmbeddedMarkdown(md))).toBe(md)
    })

    it('バックスラッシュ・末尾改行・絵文字も保持される (docHash 一致のため)', () => {
      const md = `${String.raw`\n \\ 仕様書 🚀`}\n`
      expect(JSON.parse(encodeEmbeddedMarkdown(md))).toBe(md)
    })
  })

  describe('encodeEmbeddedFeedback', () => {
    it('payload object を JSON.parse で完全復元できる', () => {
      const payload = {
        comments: [{ blockId: 'b001', endOffset: 4, id: 'a', quote: 'text', startOffset: 0 }],
        docHash: 'a1b2c3d4e5f6a7b8',
        document: 'spec.md',
        exportedAt: '2026-05-15T10:30:00.000Z',
      }
      expect(JSON.parse(encodeEmbeddedFeedback(payload))).toEqual(payload)
    })

    it('payload 中の literal < は Unicode escape されて raw < が一切現れない', () => {
      const payload = { comments: [{ quote: '</script><div>' }] }
      const encoded = encodeEmbeddedFeedback(payload)
      expect(encoded.includes('<')).toBe(false)
      expect(JSON.parse(encoded)).toEqual(payload)
    })
  })

  describe('encodeEmbeddedShikiLangs', () => {
    it('grammars object を JSON.parse で完全復元できる', () => {
      const grammars = {
        python: [{ name: 'py' }],
        typescript: [{ name: 'ts', scope: 'source.ts' }],
      }
      const encoded = encodeEmbeddedShikiLangs(grammars)
      expect(JSON.parse(encoded)).toEqual(grammars)
    })

    it('grammars に含まれる literal < は Unicode escape されて raw < が一切現れない', () => {
      const grammars = { html: [{ name: '<html>', pattern: '</script>' }] }
      const encoded = encodeEmbeddedShikiLangs(grammars)
      expect(encoded.includes('<')).toBe(false)
      expect(JSON.parse(encoded)).toEqual(grammars)
    })

    it('空オブジェクトは "{}" を返す', () => {
      expect(encodeEmbeddedShikiLangs({})).toBe('{}')
    })
  })
}
