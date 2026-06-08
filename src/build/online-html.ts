import { upsertHtmlDataAttribute } from '../core/embed/html-attribute-rewriter.ts'

// standalone.html を素材にして online.html を派生させる pure 関数群。
// docs/feature-online-runtime-assets.md / docs/archive/feature-online-edition.archive.md §3.1 に従い、
// 次の 6 つの mutation を行う：
// 1. `<html>` に `data-mdxg-online="1"` 属性を upsert（boot.ts の経路分岐マーカー）
// 2. CSP `connect-src 'none'` → `connect-src 'self' <allowlist origins joined by space>`
//    ('self' は同一オリジン同梱資材 (fingerprinted/* / canonical/*) への runtime fetch 用、§3.4 / §5.g)
// 3. `<head>` に `<script type="application/json" id="online-allowlist">[allowlist]</script>` を inject
// 4. `<head>` に `<script type="application/json" id="online-asset-manifest">{...}</script>` を inject
//    (asset-loader が起動時 1 度 parse して fingerprinted パスを解決、§3.2)
// 5. `<script id="embedded-shiki-langs">` の textContent を空 `{}` に上書き
//    (grammar は runtime fetch するため build 時 inline を不要にし、~45 MB 削減、§3.1)
// 6. `<script id="embedded-mermaid">` の textContent を空に上書き
//    (Mermaid runtime は同一オリジン dynamic import するため build 時 inline を不要にし、~3 MB 削減)
//
// allowlist は build/online-allowlist.ts の buildOnlineAllowlist() 戻り値 (origin 形式の string[]) を
// 渡す。CSP / JSON 両方に同じ集合を展開するため drift が構造的に起きない (§3.3)。
// manifest は build pipeline が grammar JSON の content hash から組み立てる
// (vite.config.ts splitOutputsPlugin.closeBundle 内で emitGrammarJsonFiles の戻り値を直接受け取る)。

export interface OnlineAssetManifestPayload {
  katex: { css: string; fontsExtraCss: string; js: string } | null
  mermaid: string | null
  shikiLangs: Readonly<Record<string, string>>
}

// CSP content は src/review.html の固定パターン (double quote) を前提。content 値内には
// `'none'` / `'unsafe-inline'` 等の single quote が含まれるため、enclosing quote は double
// quote 固定で受け、内側は `[^"]` で逃がす。
const CSP_META_RE = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*\/?>/iu

const CONNECT_SRC_NONE = "connect-src 'none'"

const findCspContent = (html: string): { match: RegExpExecArray; content: string } => {
  const match = CSP_META_RE.exec(html)
  if (!match) {
    throw new Error(
      'online-html: standalone.html に <meta http-equiv="Content-Security-Policy"> タグが見つかりません'
    )
  }
  const [, content] = match
  if (!content.includes(CONNECT_SRC_NONE)) {
    throw new Error(
      `online-html: CSP meta tag に "${CONNECT_SRC_NONE}" が見つかりません (実値: ${content})`
    )
  }
  return { content, match }
}

// 既存 build 済み HTML (例: dist/online.html) から CSP meta タグの content を抽出する。
// docs/archive/feature-online-edition.archive.md §5.g の `_headers` 生成で、HTTP response header の CSP と
// `<meta>` CSP を drift させない single source of truth として使う。
// `connect-src 'none'` literal の require は外す: online.html では allowlist 適用後の値が入っている。
export const extractCspContent = (html: string): string => {
  const match = CSP_META_RE.exec(html)
  if (!match) {
    throw new Error(
      'extractCspContent: <meta http-equiv="Content-Security-Policy"> タグが見つかりません'
    )
  }
  const [, content] = match
  return content
}

const rewriteCspConnectSrc = (html: string, allowlist: readonly string[]): string => {
  const { match, content } = findCspContent(html)
  const [fullTag] = match
  // 'self' は同一オリジン同梱資材 (fingerprinted/* / canonical/*) への runtime fetch 用。
  // CSP Level 3 仕様で `connect-src` は `fetch()` を評価対象とする。docs/feature-online-runtime-assets.md
  // §5.g で確定: allowlist origins の前に prepend し、_headers / meta の single source of truth を維持。
  const newConnectSrc = `connect-src 'self' ${allowlist.join(' ')}`
  const newContent = content.replace(CONNECT_SRC_NONE, newConnectSrc)
  const newTag = fullTag.replace(content, newContent)
  return html.slice(0, match.index) + newTag + html.slice(match.index + fullTag.length)
}

// JSON payload の `<` を `<` (6 文字 literal: backslash + u003C) に escape して
// `</script>` 誤検出を防ぐ。vite.config.ts の inlineGrammarsIntoHtml と同じ規約 (DESIGN.md §13)。
//
// ⚠️ 落とし穴: `String.raw\`<\`` 形式は TypeScript lexer が `<` を `<` (1 文字) に
// 先に解決してしまい、`String.raw` が raw 形式を保持する余地が無くなって replace が no-op になる
// (vite.config.ts:153-156 のコメント参照、過去同じ罠に踏んだ実バグあり)。普通の string literal
// `'\\u003C'` (escaped backslash) で書いて lexer の Unicode escape 解決を回避する。
const ESCAPED_LT = String.raw`\u003C`

export const escapeJsonForScriptTag = (json: string): string => json.replace(/</g, ESCAPED_LT)

// inlined script 内に偶然出現する `</head>` literal を避け、`<body>` 出現位置を上限とした
// lastIndexOf で「real な </head>」位置を返す。複数 script 注入で共用する pure helper。
const findRealHeadCloseIndex = (html: string): number => {
  const bodyIdx = html.indexOf('<body')
  if (bodyIdx === -1) {
    throw new Error('online-html: <body> タグが見つかりません')
  }
  const headCloseIdx = html.lastIndexOf('</head>', bodyIdx)
  if (headCloseIdx === -1) {
    throw new Error('online-html: <body> より前に </head> タグが見つかりません')
  }
  return headCloseIdx
}

const injectAllowlistJson = (html: string, allowlist: readonly string[]): string => {
  const json = escapeJsonForScriptTag(JSON.stringify(allowlist))
  const script = `<script type="application/json" id="online-allowlist">${json}</script>`
  const headCloseIdx = findRealHeadCloseIndex(html)
  return `${html.slice(0, headCloseIdx)}    ${script}\n  ${html.slice(headCloseIdx)}`
}

const injectAssetManifestJson = (html: string, manifest: OnlineAssetManifestPayload): string => {
  const json = escapeJsonForScriptTag(JSON.stringify(manifest))
  const script = `<script type="application/json" id="online-asset-manifest">${json}</script>`
  const headCloseIdx = findRealHeadCloseIndex(html)
  return `${html.slice(0, headCloseIdx)}    ${script}\n  ${html.slice(headCloseIdx)}`
}

// `<script id="embedded-shiki-langs">` の textContent を空 `{}` に置換する。standalone (素材) は
// 全 grammar inline 済みで巨大 (~45 MB) だが、online edition は runtime fetch で取得するため
// 不要。viewer 側 (src/app/renderers/shiki.ts) は空 `{}` を許容して fallback 動作する。
//
// ⚠️ `[\s\S]*?` 非貪欲量子化を使った 1 発正規表現は ~45 MB 入力で
// V8 の RegExp engine がスタック溢れを起こす (RangeError: Maximum call stack size exceeded)。
// open タグだけを短い regex で探し、その後の `</script>` を `indexOf` で線形に取る 2 段戦略にする。
const EMBEDDED_SHIKI_LANGS_OPEN_RE =
  /<script\b(?=[^>]*\bid="embedded-shiki-langs")(?=[^>]*\btype="application\/json")[^>]*>/iu

const emptyShikiLangsBlock = (html: string): string => {
  const openMatch = EMBEDDED_SHIKI_LANGS_OPEN_RE.exec(html)
  if (!openMatch) {
    throw new Error(
      'online-html: standalone.html に id="embedded-shiki-langs" の <script> タグが見つかりません'
    )
  }
  const openEnd = openMatch.index + openMatch[0].length
  const closeIdx = html.indexOf('</script>', openEnd)
  if (closeIdx === -1) {
    throw new Error(
      'online-html: id="embedded-shiki-langs" の <script> 開始タグに対応する </script> が見つかりません'
    )
  }
  return `${html.slice(0, openEnd)}{}${html.slice(closeIdx)}`
}

// `<script id="embedded-mermaid">` の textContent を空に置換する。standalone (素材) は
// Mermaid runtime (~3 MB) を inline 済みだが、online edition は asset-loader が manifest 経由で
// dynamic import するため不要。空 textContent は asset-loader の sentinel 注入で gate 通過させる。
//
// `dist/mermaid.mjs` が build 時に未生成だと standalone にも Mermaid block が空のまま残るため、
// open tag は素材契約として常に存在することを要求し fail-fast する (Shiki と対称)。
const EMBEDDED_MERMAID_OPEN_RE =
  /<script\b(?=[^>]*\bid="embedded-mermaid")(?=[^>]*\btype="module")[^>]*>/iu

const emptyMermaidBlock = (html: string): string => {
  const openMatch = EMBEDDED_MERMAID_OPEN_RE.exec(html)
  if (!openMatch) {
    throw new Error(
      'online-html: standalone.html に id="embedded-mermaid" の <script> タグが見つかりません'
    )
  }
  const openEnd = openMatch.index + openMatch[0].length
  const closeIdx = html.indexOf('</script>', openEnd)
  if (closeIdx === -1) {
    throw new Error(
      'online-html: id="embedded-mermaid" の <script> 開始タグに対応する </script> が見つかりません'
    )
  }
  return `${html.slice(0, openEnd)}${html.slice(closeIdx)}`
}

// `<script id="embedded-katex">` / `<style id="embedded-katex-css">` /
// `<style id="embedded-katex-fonts-extra-css">` の 3 block を空に置換する。
// standalone は KaTeX 3 ファイル inline 済みだが、 online edition は asset-loader が
// manifest 経由で dynamic import + fetch するため不要。 Mermaid と完全に対称な fail-fast。
const EMBEDDED_KATEX_JS_OPEN_RE =
  /<script\b(?=[^>]*\bid="embedded-katex")(?=[^>]*\btype="module")[^>]*>/iu
const EMBEDDED_KATEX_CSS_OPEN_RE = /<style\b(?=[^>]*\bid="embedded-katex-css")[^>]*>/iu
const EMBEDDED_KATEX_FONTS_EXTRA_CSS_OPEN_RE =
  /<style\b(?=[^>]*\bid="embedded-katex-fonts-extra-css")[^>]*>/iu

interface EmptyBlockSpec {
  blockId: string
  closeTag: string
  openRe: RegExp
}

const emptyBlockByRe = (html: string, spec: EmptyBlockSpec): string => {
  const openMatch = spec.openRe.exec(html)
  if (!openMatch) {
    throw new Error(
      `online-html: standalone.html に id="${spec.blockId}" の ${spec.closeTag.replace(/[</>]/g, '')} タグが見つかりません`
    )
  }
  const openEnd = openMatch.index + openMatch[0].length
  const closeIdx = html.indexOf(spec.closeTag, openEnd)
  if (closeIdx === -1) {
    throw new Error(
      `online-html: id="${spec.blockId}" の開始タグに対応する ${spec.closeTag} が見つかりません`
    )
  }
  return `${html.slice(0, openEnd)}${html.slice(closeIdx)}`
}

const emptyKatexJsBlock = (html: string): string =>
  emptyBlockByRe(html, {
    blockId: 'embedded-katex',
    closeTag: '</script>',
    openRe: EMBEDDED_KATEX_JS_OPEN_RE,
  })

const emptyKatexCssBlock = (html: string): string =>
  emptyBlockByRe(html, {
    blockId: 'embedded-katex-css',
    closeTag: '</style>',
    openRe: EMBEDDED_KATEX_CSS_OPEN_RE,
  })

const emptyKatexFontsExtraCssBlock = (html: string): string =>
  emptyBlockByRe(html, {
    blockId: 'embedded-katex-fonts-extra-css',
    closeTag: '</style>',
    openRe: EMBEDDED_KATEX_FONTS_EXTRA_CSS_OPEN_RE,
  })

// KaTeX 3 block (JS / CSS / fontsExtraCss) を 1 関数で空化する compose helper。
// buildOnlineHtml の statement 数 (max-statements 10) を超えないため pipeline を圧縮する用途。
const emptyAllKatexBlocks = (html: string): string =>
  emptyKatexFontsExtraCssBlock(emptyKatexCssBlock(emptyKatexJsBlock(html)))

export interface BuildOnlineHtmlOpts {
  allowlist: readonly string[]
  manifest: OnlineAssetManifestPayload
}

export const buildOnlineHtml = (standaloneHtml: string, opts: BuildOnlineHtmlOpts): string => {
  if (opts.allowlist.length === 0) {
    throw new Error(
      'online-html: allowlist が空です。buildOnlineAllowlist の戻り値を渡してください'
    )
  }
  const withAttribute = upsertHtmlDataAttribute(standaloneHtml, 'data-mdxg-online', '1')
  const withCsp = rewriteCspConnectSrc(withAttribute, opts.allowlist)
  const withEmptyShiki = emptyShikiLangsBlock(withCsp)
  const withEmptyMermaid = emptyMermaidBlock(withEmptyShiki)
  const withEmptyKatex = emptyAllKatexBlocks(withEmptyMermaid)
  const withAllowlist = injectAllowlistJson(withEmptyKatex, opts.allowlist)
  return injectAssetManifestJson(withAllowlist, opts.manifest)
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  const SAMPLE_HTML = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; connect-src 'none'; script-src 'self' 'unsafe-inline'"
    />
    <script type="application/json" id="embedded-shiki-langs">{"typescript":[{"name":"typescript","scopeName":"source.ts"}]}</script>
    <script type="module" id="embedded-mermaid">/* mermaid runtime placeholder */ globalThis.__mdxgMermaid = {};</script>
    <script type="module" id="embedded-katex">/* katex runtime placeholder */ globalThis.__mdxgKatex = {};</script>
    <style id="embedded-katex-css">/* katex css placeholder */ .katex { font: 1em sans-serif; }</style>
    <style id="embedded-katex-fonts-extra-css">/* katex fonts-extra placeholder */ @font-face { font-family: x; }</style>
    <title>x</title>
  </head>
  <body></body>
</html>`

  const DEFAULT_TEST_ALLOWLIST = [
    'https://raw.githubusercontent.com',
    'https://gist.githubusercontent.com',
  ]

  const SAMPLE_MANIFEST: OnlineAssetManifestPayload = {
    katex: null,
    mermaid: null,
    shikiLangs: { typescript: 'fingerprinted/shiki-langs/typescript.abcd1234.json' },
  }

  const buildOpts = (overrides?: Partial<BuildOnlineHtmlOpts>): BuildOnlineHtmlOpts => ({
    allowlist: DEFAULT_TEST_ALLOWLIST,
    manifest: SAMPLE_MANIFEST,
    ...overrides,
  })

  describe('buildOnlineHtml: html 属性', () => {
    it('<html> に data-mdxg-online="1" を upsert する', () => {
      const out = buildOnlineHtml(SAMPLE_HTML, buildOpts())
      expect(out).toContain('data-mdxg-online="1"')
    })

    it('既存の lang 属性は保持する', () => {
      const out = buildOnlineHtml(SAMPLE_HTML, buildOpts())
      expect(out).toContain('lang="ja"')
    })

    it('<html> タグが無いと throw', () => {
      expect(() => buildOnlineHtml('<body></body>', buildOpts())).toThrow(/<html>/u)
    })
  })

  describe('buildOnlineHtml: CSP connect-src 書き換え', () => {
    it("connect-src 'none' を 'self' + allowlist origins に置換 (§5.g)", () => {
      const out = buildOnlineHtml(SAMPLE_HTML, buildOpts())
      expect(out).toContain(
        "connect-src 'self' https://raw.githubusercontent.com https://gist.githubusercontent.com"
      )
      expect(out).not.toContain("connect-src 'none'")
    })

    it("'self' は allowlist origins の前に prepend される (§5.g)", () => {
      const out = buildOnlineHtml(SAMPLE_HTML, buildOpts())
      const cspMatch = /connect-src ([^;"]*)/u.exec(out)
      expect(cspMatch).not.toBeNull()
      if (cspMatch) {
        const tokens = cspMatch[1].trim().split(/\s+/u)
        expect(tokens[0]).toBe("'self'")
        expect(tokens.slice(1)).toEqual([...DEFAULT_TEST_ALLOWLIST])
      }
    })

    it('CSP の他ディレクティブ (default-src / script-src) は変更しない', () => {
      const out = buildOnlineHtml(SAMPLE_HTML, buildOpts())
      expect(out).toContain("default-src 'none'")
      expect(out).toContain("script-src 'self' 'unsafe-inline'")
    })

    it("CSP に connect-src 'none' が無いと throw", () => {
      const noConnect = SAMPLE_HTML.replace("connect-src 'none'; ", '')
      expect(() => buildOnlineHtml(noConnect, buildOpts())).toThrow(/connect-src 'none'/u)
    })

    it('CSP meta タグが無いと throw', () => {
      const noCsp = SAMPLE_HTML.replace(/<meta\s+http-equiv[\s\S]*?\/>/u, '')
      expect(() => buildOnlineHtml(noCsp, buildOpts())).toThrow(/Content-Security-Policy/u)
    })

    it('追加 allowlist (env 由来) も CSP に空白区切りで展開', () => {
      const out = buildOnlineHtml(
        SAMPLE_HTML,
        buildOpts({ allowlist: [...DEFAULT_TEST_ALLOWLIST, 'https://wiki.internal'] })
      )
      expect(out).toContain(
        "connect-src 'self' https://raw.githubusercontent.com https://gist.githubusercontent.com https://wiki.internal"
      )
    })
  })

  describe('buildOnlineHtml: <script id="online-allowlist"> JSON inject', () => {
    it('</head> 直前に <script type="application/json" id="online-allowlist"> を inject', () => {
      const out = buildOnlineHtml(SAMPLE_HTML, buildOpts())
      const scriptIdx = out.indexOf('<script type="application/json" id="online-allowlist">')
      const headCloseIdx = out.indexOf('</head>')
      expect(scriptIdx).toBeGreaterThan(-1)
      expect(headCloseIdx).toBeGreaterThan(scriptIdx)
    })

    it('JSON payload は allowlist の origin 配列をそのまま含む', () => {
      const out = buildOnlineHtml(SAMPLE_HTML, buildOpts())
      const expected = JSON.stringify(DEFAULT_TEST_ALLOWLIST)
      expect(out).toContain(expected)
    })

    it('escapeJsonForScriptTag: `<` を 6 文字 literal `\u003C` に置換 (no-op 回帰防止)', () => {
      // 過去 `String.raw`<`` (lexer が `\u003C` を `<` に先解決) で no-op バグを踏んだ回帰防止。
      // 1 文字の `<` ではなく 6 文字 (backslash + u003C) の literal が出力されることを assert。
      expect(escapeJsonForScriptTag('a<b>c')).toBe(String.raw`a\u003Cb>c`)
      expect(escapeJsonForScriptTag('</script>')).toBe(String.raw`\u003C/script>`)
      expect(escapeJsonForScriptTag('no special')).toBe('no special')
      // 6 文字 literal であることを長さで二重確認 (1 文字 `<` への退化を検出)
      expect(escapeJsonForScriptTag('<').length).toBe(6)
    })

    it('CSP と JSON config の host 集合が完全一致 (drift 検出)', () => {
      const allowlist = ['https://raw.githubusercontent.com', 'https://example.internal']
      const out = buildOnlineHtml(SAMPLE_HTML, buildOpts({ allowlist }))
      const cspMatch = /connect-src ([^;"]*)/u.exec(out)
      const jsonMatch = /id="online-allowlist">(\[.*?\])<\/script>/u.exec(out)
      expect(cspMatch).not.toBeNull()
      expect(jsonMatch).not.toBeNull()
      if (cspMatch && jsonMatch) {
        // 'self' は CSP keyword で JSON allowlist の集合外。drift 検出時は除外して比較する。
        const cspHosts = cspMatch[1]
          .trim()
          .split(/\s+/u)
          .filter((token): boolean => token !== "'self'")
          .toSorted()
        // JSON.parse + 型 assertion を避けるため regex で URL string 列を直接抽出する
        const jsonHosts = [...jsonMatch[1].matchAll(/"(https:\/\/[^"]+)"/gu)]
          .map((entry): string => entry[1])
          .toSorted()
        expect(cspHosts).toEqual(jsonHosts)
      }
    })

    it('</head> が無いと throw', () => {
      const noHeadClose = SAMPLE_HTML.replace('</head>', '')
      expect(() => buildOnlineHtml(noHeadClose, buildOpts())).toThrow(/<\/head>/u)
    })

    it('inline script 内の literal `</head>` には injection されない (Mermaid/KaTeX runtime 中の偶然 match を回避)', () => {
      // 実 standalone.html を再現: <head> 内に inlined runtime があり、その中に literal `</head>` を含む
      const htmlWithLiteralHeadClose = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; script-src 'self' 'unsafe-inline'" />
    <script type="application/json" id="embedded-shiki-langs">{"typescript":[{"name":"typescript","scopeName":"source.ts"}]}</script>
    <script type="module" id="embedded-mermaid">/* mermaid placeholder */</script>
    <script type="module" id="embedded-katex">/* katex placeholder */</script>
    <style id="embedded-katex-css">/* katex css placeholder */</style>
    <style id="embedded-katex-fonts-extra-css">/* katex fonts-extra placeholder */</style>
    <script id="embedded-runtime">var fakeMarker = "Tag: </head> inside string";</script>
    <title>x</title>
  </head>
  <body></body>
</html>`
      const out = buildOnlineHtml(htmlWithLiteralHeadClose, buildOpts())
      const scriptIdx = out.indexOf('<script type="application/json" id="online-allowlist">')
      const realHeadCloseIdx = out.indexOf('</head>\n  <body>')
      expect(scriptIdx).toBeGreaterThan(-1)
      // injection 位置は real </head> の直前 (literal `</head>` を含む runtime block の後)
      expect(scriptIdx).toBeLessThan(realHeadCloseIdx)
      // 内側の literal `</head>` の直後ではない (= runtime 内に script が割り込んでいない)
      const literalHeadIdx = out.indexOf('Tag: </head>')
      expect(scriptIdx).toBeGreaterThan(literalHeadIdx)
    })

    it('<body> が無いと throw', () => {
      const noBody = SAMPLE_HTML.replace('<body></body>', '')
      expect(() => buildOnlineHtml(noBody, buildOpts())).toThrow(/<body>/u)
    })
  })

  describe('buildOnlineHtml: <script id="online-asset-manifest"> JSON inject (§3.2)', () => {
    it('</head> 直前に <script type="application/json" id="online-asset-manifest"> を inject', () => {
      const out = buildOnlineHtml(SAMPLE_HTML, buildOpts())
      const scriptIdx = out.indexOf('<script type="application/json" id="online-asset-manifest">')
      const headCloseIdx = out.indexOf('</head>')
      expect(scriptIdx).toBeGreaterThan(-1)
      expect(headCloseIdx).toBeGreaterThan(scriptIdx)
    })

    it('JSON payload は manifest を JSON.stringify でそのまま含む', () => {
      const out = buildOnlineHtml(SAMPLE_HTML, buildOpts())
      expect(out).toContain(JSON.stringify(SAMPLE_MANIFEST))
    })

    it('shikiLangs entry の hash 付きパスが payload に展開される', () => {
      const out = buildOnlineHtml(SAMPLE_HTML, buildOpts())
      expect(out).toContain('fingerprinted/shiki-langs/typescript.abcd1234.json')
    })

    it('mermaid / katex が null でも valid な JSON object が inject される', () => {
      const out = buildOnlineHtml(SAMPLE_HTML, buildOpts())
      // null フィールドが落ちずに残る (parser 側の安全な fail-safe を成立させる)
      expect(out).toContain('"mermaid":null')
      expect(out).toContain('"katex":null')
    })
  })

  describe('buildOnlineHtml: embedded-shiki-langs 空 {} 置換 (§3.1)', () => {
    it('<script id="embedded-shiki-langs"> の textContent を {} に置換する', () => {
      const out = buildOnlineHtml(SAMPLE_HTML, buildOpts())
      const match = /id="embedded-shiki-langs"[^>]*>([\s\S]*?)<\/script>/u.exec(out)
      expect(match).not.toBeNull()
      if (match) {
        expect(match[1]).toBe('{}')
      }
    })

    it('元の typescript grammar payload は残らない', () => {
      const out = buildOnlineHtml(SAMPLE_HTML, buildOpts())
      expect(out).not.toContain('"scopeName":"source.ts"')
    })

    it('embedded-shiki-langs block が無いと throw (素材契約違反の fail-fast)', () => {
      const noShiki = SAMPLE_HTML.replace(
        /<script type="application\/json" id="embedded-shiki-langs">[\s\S]*?<\/script>/u,
        ''
      )
      expect(() => buildOnlineHtml(noShiki, buildOpts())).toThrow(/embedded-shiki-langs/u)
    })
  })

  describe('buildOnlineHtml: embedded-mermaid 空置換', () => {
    it('<script id="embedded-mermaid"> の textContent を空に置換する', () => {
      const out = buildOnlineHtml(SAMPLE_HTML, buildOpts())
      const match = /id="embedded-mermaid"[^>]*>([\s\S]*?)<\/script>/u.exec(out)
      expect(match).not.toBeNull()
      if (match) {
        expect(match[1]).toBe('')
      }
    })

    it('元の Mermaid runtime placeholder は残らない (size 削減効果の verify)', () => {
      const out = buildOnlineHtml(SAMPLE_HTML, buildOpts())
      expect(out).not.toContain('mermaid runtime placeholder')
      expect(out).not.toContain('__mdxgMermaid = {}')
    })

    it('embedded-mermaid block が無いと throw (素材契約違反の fail-fast)', () => {
      const noMermaid = SAMPLE_HTML.replace(
        /<script type="module" id="embedded-mermaid">[\s\S]*?<\/script>/u,
        ''
      )
      expect(() => buildOnlineHtml(noMermaid, buildOpts())).toThrow(/embedded-mermaid/u)
    })
  })

  describe('buildOnlineHtml: embedded-katex 3 block 空置換', () => {
    it('<script id="embedded-katex"> の textContent を空に置換する', () => {
      const out = buildOnlineHtml(SAMPLE_HTML, buildOpts())
      const match = /id="embedded-katex"[^>]*>([\s\S]*?)<\/script>/u.exec(out)
      expect(match).not.toBeNull()
      if (match) {
        expect(match[1]).toBe('')
      }
    })

    it('<style id="embedded-katex-css"> / fonts-extra-css の textContent を空に置換する', () => {
      const out = buildOnlineHtml(SAMPLE_HTML, buildOpts())
      const cssMatch = /id="embedded-katex-css"[^>]*>([\s\S]*?)<\/style>/u.exec(out)
      const fontsExtraMatch = /id="embedded-katex-fonts-extra-css"[^>]*>([\s\S]*?)<\/style>/u.exec(
        out
      )
      expect(cssMatch).not.toBeNull()
      expect(fontsExtraMatch).not.toBeNull()
      if (cssMatch) {
        expect(cssMatch[1]).toBe('')
      }
      if (fontsExtraMatch) {
        expect(fontsExtraMatch[1]).toBe('')
      }
    })

    it('元の KaTeX runtime / CSS placeholder は残らない (size 削減効果)', () => {
      const out = buildOnlineHtml(SAMPLE_HTML, buildOpts())
      expect(out).not.toContain('katex runtime placeholder')
      expect(out).not.toContain('__mdxgKatex = {}')
      expect(out).not.toContain('katex css placeholder')
      expect(out).not.toContain('katex fonts-extra placeholder')
    })

    it('embedded-katex JS block が無いと throw (素材契約違反の fail-fast)', () => {
      const noKatexJs = SAMPLE_HTML.replace(
        /<script type="module" id="embedded-katex">[\s\S]*?<\/script>/u,
        ''
      )
      expect(() => buildOnlineHtml(noKatexJs, buildOpts())).toThrow(/embedded-katex/u)
    })

    it('embedded-katex-css block が無いと throw', () => {
      const noKatexCss = SAMPLE_HTML.replace(
        /<style id="embedded-katex-css">[\s\S]*?<\/style>/u,
        ''
      )
      expect(() => buildOnlineHtml(noKatexCss, buildOpts())).toThrow(/embedded-katex-css/u)
    })

    it('embedded-katex-fonts-extra-css block が無いと throw', () => {
      const noFontsExtra = SAMPLE_HTML.replace(
        /<style id="embedded-katex-fonts-extra-css">[\s\S]*?<\/style>/u,
        ''
      )
      expect(() => buildOnlineHtml(noFontsExtra, buildOpts())).toThrow(
        /embedded-katex-fonts-extra-css/u
      )
    })

    it('空化後も <script type="module" id="embedded-katex"> 開始タグ自体は残る (asset-loader sentinel 注入の前提)', () => {
      const out = buildOnlineHtml(SAMPLE_HTML, buildOpts())
      // sentinel 注入は document.getElementById('embedded-katex') が HTMLElement を返すことが前提のため、
      // 開始タグが残っていなければ runtime が gate を通過できない
      expect(out).toMatch(/<script\s[^>]*\btype="module"[^>]*\bid="embedded-katex">/u)
    })

    it('空化後も <style id="embedded-katex-css"> / fonts-extra-css 開始タグ自体は残る', () => {
      const out = buildOnlineHtml(SAMPLE_HTML, buildOpts())
      expect(out).toMatch(/<style\s[^>]*\bid="embedded-katex-css">/u)
      expect(out).toMatch(/<style\s[^>]*\bid="embedded-katex-fonts-extra-css">/u)
    })
  })

  describe('buildOnlineHtml: 入力検証', () => {
    it('allowlist が空配列なら throw (buildOnlineAllowlist は最低 DEFAULT を返すため空は契約違反)', () => {
      expect(() =>
        buildOnlineHtml(SAMPLE_HTML, { allowlist: [], manifest: SAMPLE_MANIFEST })
      ).toThrow(/allowlist/u)
    })
  })

  describe('extractCspContent', () => {
    it('CSP meta タグから content 文字列を抽出する', () => {
      expect(extractCspContent(SAMPLE_HTML)).toContain("connect-src 'none'")
      expect(extractCspContent(SAMPLE_HTML)).toContain("default-src 'none'")
    })

    it("online.html の allowlist 適用後 CSP も抽出できる (connect-src 'self' + origins)", () => {
      const onlineHtml = buildOnlineHtml(SAMPLE_HTML, buildOpts())
      const content = extractCspContent(onlineHtml)
      expect(content).toContain(
        "connect-src 'self' https://raw.githubusercontent.com https://gist.githubusercontent.com"
      )
      expect(content).not.toContain("connect-src 'none'")
    })

    it('CSP meta タグが無いと throw', () => {
      const noCsp = SAMPLE_HTML.replace(/<meta\s+http-equiv[\s\S]*?\/>/u, '')
      expect(() => extractCspContent(noCsp)).toThrow(/Content-Security-Policy/u)
    })
  })

  // src/review.html の実 CSP を読んで構造的不変条件を検証する drift 防止 test
  // (docs/archive/bug-csp-font-src-missing.archive.md §6 を構造化)。 buildOnlineHtml は
  // src/review.html → dist/standalone.html → dist/hosting/index.html の派生経路で CSP を
  // そのまま継承するため、 src の CSP に必要 directive が揃っていれば全配布物に反映される。
  describe('src/review.html CSP 構造的不変条件 (drift guard)', () => {
    const REQUIRED_DIRECTIVES: readonly string[] = [
      "default-src 'none'", // 全 directive の fallback 締切
      "style-src 'unsafe-inline'", // inline style (review.css / 404 page 用)
      'img-src https: data:', // 外部画像 + inline SVG favicon (data URI)
      'font-src data:', // KaTeX woff2 inline (data URI) - 本 test の主眼
      "connect-src 'none'", // standalone は外部 fetch ゼロ (online は派生時に置換)
      "script-src 'self' 'unsafe-inline'", // self ESM + inline bootstrap
      "base-uri 'none'", // <base> 注入による fetch 経路 hijack 防止
      "form-action 'none'", // <form action> 経路の漏出防止
    ]

    const readReviewHtmlCsp = async (): Promise<string> => {
      const fs = await import('node:fs/promises')
      const path = await import('node:path')
      const url = await import('node:url')
      const thisDir = path.dirname(url.fileURLToPath(import.meta.url))
      const reviewHtmlPath = path.resolve(thisDir, '..', 'review.html')
      const reviewHtml = await fs.readFile(reviewHtmlPath, 'utf8')
      return extractCspContent(reviewHtml)
    }

    it('src/review.html の CSP に必須 directive が全て含まれる', async () => {
      const cspContent = await readReviewHtmlCsp()
      for (const directive of REQUIRED_DIRECTIVES) {
        expect(cspContent).toContain(directive)
      }
    })

    it('font-src data: を含む (KaTeX woff2 inline の遮断回帰防止)', async () => {
      const cspContent = await readReviewHtmlCsp()
      expect(cspContent).toContain('font-src data:')
    })
  })
}
