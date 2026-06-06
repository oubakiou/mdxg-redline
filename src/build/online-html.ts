import { upsertHtmlDataAttribute } from '../core/embed/html-attribute-rewriter.ts'

// standalone.html を素材にして online.html を派生させる pure 関数群。docs/feature-online-edition.md
// §3.1 / Step 3 に従い、次の 3 つの mutation のみを行う：
// 1. `<html>` に `data-mdxg-online="1"` 属性を upsert（boot.ts の経路分岐マーカー）
// 2. CSP `connect-src 'none'` → `connect-src <allowlist origins joined by space>`
// 3. `<head>` に `<script type="application/json" id="online-allowlist">[allowlist]</script>` を inject
//
// allowlist は build/online-allowlist.ts の buildOnlineAllowlist() 戻り値 (origin 形式の string[]) を
// 渡す。CSP / JSON 両方に同じ集合を展開するため drift が構造的に起きない (§3.3)。

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
// docs/feature-online-edition.md §5.g の `_headers` 生成で、HTTP response header の CSP と
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
  const newConnectSrc = `connect-src ${allowlist.join(' ')}`
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

const injectAllowlistJson = (html: string, allowlist: readonly string[]): string => {
  const json = escapeJsonForScriptTag(JSON.stringify(allowlist))
  const script = `<script type="application/json" id="online-allowlist">${json}</script>`
  // standalone.html は <head> 内に Shiki grammar / Mermaid / KaTeX runtime を inline 済みなので、
  // 単純な indexOf('</head>') は inlined script 内に偶然出現する `</head>` literal にも当たる
  // 危険がある。<body> の出現位置を上限として lastIndexOf で「real な </head>」を取る。
  const bodyIdx = html.indexOf('<body')
  if (bodyIdx === -1) {
    throw new Error('online-html: <body> タグが見つかりません')
  }
  const headCloseIdx = html.lastIndexOf('</head>', bodyIdx)
  if (headCloseIdx === -1) {
    throw new Error('online-html: <body> より前に </head> タグが見つかりません')
  }
  return `${html.slice(0, headCloseIdx)}    ${script}\n  ${html.slice(headCloseIdx)}`
}

export interface BuildOnlineHtmlOpts {
  allowlist: readonly string[]
}

export const buildOnlineHtml = (standaloneHtml: string, opts: BuildOnlineHtmlOpts): string => {
  if (opts.allowlist.length === 0) {
    throw new Error(
      'online-html: allowlist が空です。buildOnlineAllowlist の戻り値を渡してください'
    )
  }
  const withAttribute = upsertHtmlDataAttribute(standaloneHtml, 'data-mdxg-online', '1')
  const withCsp = rewriteCspConnectSrc(withAttribute, opts.allowlist)
  return injectAllowlistJson(withCsp, opts.allowlist)
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
    <title>x</title>
  </head>
  <body></body>
</html>`

  const DEFAULT_TEST_ALLOWLIST = [
    'https://raw.githubusercontent.com',
    'https://gist.githubusercontent.com',
  ]

  describe('buildOnlineHtml: html 属性', () => {
    it('<html> に data-mdxg-online="1" を upsert する', () => {
      const out = buildOnlineHtml(SAMPLE_HTML, { allowlist: DEFAULT_TEST_ALLOWLIST })
      expect(out).toContain('data-mdxg-online="1"')
    })

    it('既存の lang 属性は保持する', () => {
      const out = buildOnlineHtml(SAMPLE_HTML, { allowlist: DEFAULT_TEST_ALLOWLIST })
      expect(out).toContain('lang="ja"')
    })

    it('<html> タグが無いと throw', () => {
      expect(() => buildOnlineHtml('<body></body>', { allowlist: DEFAULT_TEST_ALLOWLIST })).toThrow(
        /<html>/u
      )
    })
  })

  describe('buildOnlineHtml: CSP connect-src 書き換え', () => {
    it("connect-src 'none' を allowlist の origin リストに置換", () => {
      const out = buildOnlineHtml(SAMPLE_HTML, { allowlist: DEFAULT_TEST_ALLOWLIST })
      expect(out).toContain(
        'connect-src https://raw.githubusercontent.com https://gist.githubusercontent.com'
      )
      expect(out).not.toContain("connect-src 'none'")
    })

    it('CSP の他ディレクティブ (default-src / script-src) は変更しない', () => {
      const out = buildOnlineHtml(SAMPLE_HTML, { allowlist: DEFAULT_TEST_ALLOWLIST })
      expect(out).toContain("default-src 'none'")
      expect(out).toContain("script-src 'self' 'unsafe-inline'")
    })

    it("CSP に connect-src 'none' が無いと throw", () => {
      const noConnect = SAMPLE_HTML.replace("connect-src 'none'; ", '')
      expect(() => buildOnlineHtml(noConnect, { allowlist: DEFAULT_TEST_ALLOWLIST })).toThrow(
        /connect-src 'none'/u
      )
    })

    it('CSP meta タグが無いと throw', () => {
      const noCsp = SAMPLE_HTML.replace(/<meta\s+http-equiv[\s\S]*?\/>/u, '')
      expect(() => buildOnlineHtml(noCsp, { allowlist: DEFAULT_TEST_ALLOWLIST })).toThrow(
        /Content-Security-Policy/u
      )
    })

    it('追加 allowlist (env 由来) も CSP に空白区切りで展開', () => {
      const out = buildOnlineHtml(SAMPLE_HTML, {
        allowlist: [...DEFAULT_TEST_ALLOWLIST, 'https://wiki.internal'],
      })
      expect(out).toContain(
        'connect-src https://raw.githubusercontent.com https://gist.githubusercontent.com https://wiki.internal'
      )
    })
  })

  describe('buildOnlineHtml: <script id="online-allowlist"> JSON inject', () => {
    it('</head> 直前に <script type="application/json" id="online-allowlist"> を inject', () => {
      const out = buildOnlineHtml(SAMPLE_HTML, { allowlist: DEFAULT_TEST_ALLOWLIST })
      const scriptIdx = out.indexOf('<script type="application/json" id="online-allowlist">')
      const headCloseIdx = out.indexOf('</head>')
      expect(scriptIdx).toBeGreaterThan(-1)
      expect(headCloseIdx).toBeGreaterThan(scriptIdx)
    })

    it('JSON payload は allowlist の origin 配列をそのまま含む', () => {
      const out = buildOnlineHtml(SAMPLE_HTML, { allowlist: DEFAULT_TEST_ALLOWLIST })
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
      const out = buildOnlineHtml(SAMPLE_HTML, { allowlist })
      const cspMatch = /connect-src ([^;'"]*)/u.exec(out)
      const jsonMatch = /id="online-allowlist">(\[.*?\])<\/script>/u.exec(out)
      expect(cspMatch).not.toBeNull()
      expect(jsonMatch).not.toBeNull()
      if (cspMatch && jsonMatch) {
        const cspHosts = cspMatch[1].trim().split(/\s+/u).toSorted()
        // JSON.parse + 型 assertion を避けるため regex で URL string 列を直接抽出する
        const jsonHosts = [...jsonMatch[1].matchAll(/"(https:\/\/[^"]+)"/gu)]
          .map((entry): string => entry[1])
          .toSorted()
        expect(cspHosts).toEqual(jsonHosts)
      }
    })

    it('</head> が無いと throw', () => {
      const noHeadClose = SAMPLE_HTML.replace('</head>', '')
      expect(() => buildOnlineHtml(noHeadClose, { allowlist: DEFAULT_TEST_ALLOWLIST })).toThrow(
        /<\/head>/u
      )
    })

    it('inline script 内の literal `</head>` には injection されない (Mermaid/KaTeX runtime 中の偶然 match を回避)', () => {
      // 実 standalone.html を再現: <head> 内に inlined runtime があり、その中に literal `</head>` を含む
      const htmlWithLiteralHeadClose = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; script-src 'self' 'unsafe-inline'" />
    <script id="embedded-runtime">var fakeMarker = "Tag: </head> inside string";</script>
    <title>x</title>
  </head>
  <body></body>
</html>`
      const out = buildOnlineHtml(htmlWithLiteralHeadClose, { allowlist: DEFAULT_TEST_ALLOWLIST })
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
      expect(() => buildOnlineHtml(noBody, { allowlist: DEFAULT_TEST_ALLOWLIST })).toThrow(
        /<body>/u
      )
    })
  })

  describe('buildOnlineHtml: 入力検証', () => {
    it('allowlist が空配列なら throw (buildOnlineAllowlist は最低 DEFAULT を返すため空は契約違反)', () => {
      expect(() => buildOnlineHtml(SAMPLE_HTML, { allowlist: [] })).toThrow(/allowlist/u)
    })
  })

  describe('extractCspContent', () => {
    it('CSP meta タグから content 文字列を抽出する', () => {
      expect(extractCspContent(SAMPLE_HTML)).toContain("connect-src 'none'")
      expect(extractCspContent(SAMPLE_HTML)).toContain("default-src 'none'")
    })

    it('online.html の allowlist 適用後 CSP も抽出できる (connect-src none 要件なし)', () => {
      const onlineHtml = buildOnlineHtml(SAMPLE_HTML, { allowlist: DEFAULT_TEST_ALLOWLIST })
      const content = extractCspContent(onlineHtml)
      expect(content).toContain(
        'connect-src https://raw.githubusercontent.com https://gist.githubusercontent.com'
      )
      expect(content).not.toContain("connect-src 'none'")
    })

    it('CSP meta タグが無いと throw', () => {
      const noCsp = SAMPLE_HTML.replace(/<meta\s+http-equiv[\s\S]*?\/>/u, '')
      expect(() => extractCspContent(noCsp)).toThrow(/Content-Security-Policy/u)
    })
  })
}
