import { upsertHtmlDataAttribute } from '../core/embed/html-attribute-rewriter.ts'

// standalone.html を素材にして online.html を派生させる pure 関数群。docs/feature-online-runtime-assets.md
// Phase A.2 / docs/archive/feature-online-edition.archive.md §3.1 に従い、次の 5 つの mutation を行う：
// 1. `<html>` に `data-mdxg-online="1"` 属性を upsert（boot.ts の経路分岐マーカー）
// 2. CSP `connect-src 'none'` → `connect-src 'self' <allowlist origins joined by space>`
//    ('self' は同一オリジン同梱資材 (fingerprinted/* / canonical/*) への runtime fetch 用、§3.4 / §5.g)
// 3. `<head>` に `<script type="application/json" id="online-allowlist">[allowlist]</script>` を inject
// 4. `<head>` に `<script type="application/json" id="online-asset-manifest">{...}</script>` を inject
//    (asset-loader が起動時 1 度 parse して fingerprinted パスを解決、§3.2)
// 5. `<script id="embedded-shiki-langs">` の textContent を空 `{}` に上書き
//    (grammar は runtime fetch するため build 時 inline を不要にし、~45 MB 削減、§3.1)
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
  const withAllowlist = injectAllowlistJson(withEmptyShiki, opts.allowlist)
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
    it("connect-src 'none' を 'self' + allowlist origins に置換 (Phase A.2 §5.g)", () => {
      const out = buildOnlineHtml(SAMPLE_HTML, buildOpts())
      expect(out).toContain(
        "connect-src 'self' https://raw.githubusercontent.com https://gist.githubusercontent.com"
      )
      expect(out).not.toContain("connect-src 'none'")
    })

    it("'self' は allowlist origins の前に prepend される (Phase A.2 §5.g)", () => {
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

  describe('buildOnlineHtml: <script id="online-asset-manifest"> JSON inject (Phase A.2 §3.2)', () => {
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

  describe('buildOnlineHtml: embedded-shiki-langs 空 {} 置換 (Phase A.2 §3.1)', () => {
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
}
