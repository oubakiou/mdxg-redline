import {
  type OnlineAssetManifestPayload,
  buildOnlineHtml,
  extractCspContent,
} from './online-html.ts'

// Cloudflare Pages の _headers ファイルフォーマット
// (https://developers.cloudflare.com/pages/configuration/headers/) で online.html の信頼境界を
// HTTP response header 層でも強制する。docs/archive/feature-online-edition.archive.md §5.g の方針:
// - online.html / `/` (_redirects で /online.html に rewrite される) のみに allowlist 付き CSP を返す
// - 他リソース (standalone.html / embed-template.html 等が同じホスティングに置かれた場合) には
//   online 用 CSP を返さない (信頼境界の分離原則、§3.1)
// - 全リソースに基本セキュリティヘッダ (Referrer-Policy: no-referrer / X-Content-Type-Options: nosniff)
//
// CSP content は引数の onlineHtml から `<meta http-equiv="Content-Security-Policy">` を抽出するため、
// HTTP header の CSP と meta CSP は同じ source-of-truth から派生する (drift しない)。
//
// Cloudflare Pages の `_headers` 適用規則 (公式 docs:
// https://developers.cloudflare.com/pages/configuration/headers/):
// - 複数の rule にマッチした request は "inherit all rules' headers" (全 rule の header が付く)
// - 同名ヘッダが複数 rule で定義された場合は値が **カンマ結合** される
//   (例: `/static/*` の `X-Robots-Tag: nosnippet` と `/*` の `X-Robots-Tag: noindex` が
//    `X-Robots-Tag: nosnippet, noindex` として返る)
// CSP のように単一値前提のヘッダは specific path のみで指定し、`/*` には書かない。本 file の
// Referrer-Policy / X-Content-Type-Options も `/*` のみで指定し specific path で再指定しないため、
// カンマ結合の発生余地はない (specific path には additive で /* 由来の値が付く)。
//
// `_redirects` の status 200 rewrite と `_headers` の評価順:
// - 公式 docs に "redirects are applied before headers" と明記。ただし rewrite (status 200) 時に
//   `_headers` が rewrite **前** の request URL ベースで評価されるか、rewrite **後** の URL ベースか
//   は公式 docs で明示されていない。
// - 両方の可能性に対する防御として `/` と `/online.html` の両方に同じ CSP を書く。
//   rewrite 前評価なら `/` rule が当たり、rewrite 後評価なら `/online.html` rule が当たる。
//
// Cloudflare Pages の `_headers` ヘッダ値あたり上限は 2,000 文字。allowlist (env 由来) が肥大化して
// CSP 行が上限を超えると、Cloudflare が無音で truncate / 無視して CSP 全体が無効化される最悪
// ケースがある。fail-fast 防御として生成時点で行長を assertion する。
export const CLOUDFLARE_HEADER_VALUE_LIMIT = 2000

// docs/feature-online-runtime-assets.md §5.f / §5.i Item 1 で確定の path 単位 Cache-Control 分離:
// - `/online.html` / `/`  → max-age=300 (5 分、HTML cache は短寿命にして deploy 世代ずれ過渡期を最小化)
// - `/fingerprinted/*`    → max-age=31536000 immutable (hash 焼き込み済み資材、永久 cache 可)
// - `/canonical/*`        → max-age=300 (新版 deploy で内容更新される fallback、immutable は禁止)
const HTML_CACHE_CONTROL = '  Cache-Control: public, max-age=300'
const FINGERPRINTED_CACHE_CONTROL = '  Cache-Control: public, max-age=31536000, immutable'
const CANONICAL_CACHE_CONTROL = '  Cache-Control: public, max-age=300'

export const buildOnlineHeadersFile = (onlineHtml: string): string => {
  const cspContent = extractCspContent(onlineHtml)
  const cspLine = `  Content-Security-Policy: ${cspContent}`
  if (cspLine.length > CLOUDFLARE_HEADER_VALUE_LIMIT) {
    throw new Error(
      `online-headers: Content-Security-Policy 行が Cloudflare Pages の上限 ${CLOUDFLARE_HEADER_VALUE_LIMIT} 文字を超過 (${cspLine.length} chars)。allowlist (MDXG_ONLINE_CONNECT_SRC) のエントリ数を減らしてください。`
    )
  }
  return [
    '/*',
    '  Referrer-Policy: no-referrer',
    '  X-Content-Type-Options: nosniff',
    '',
    '/',
    cspLine,
    HTML_CACHE_CONTROL,
    '',
    '/online.html',
    cspLine,
    HTML_CACHE_CONTROL,
    '',
    '/fingerprinted/*',
    FINGERPRINTED_CACHE_CONTROL,
    '',
    '/canonical/*',
    CANONICAL_CACHE_CONTROL,
    '',
  ].join('\n')
}

// path 名から該当セクションの数行を切り出す test 用 helper。in-source test の statement
// 数制限 (max-statements: 10) を満たすため top-level に切り出す (production 経路では unused)。
const extractHeadersSectionForTest = (text: string, pathLine: string, span: number): string => {
  const lines = text.split('\n')
  const idx = lines.indexOf(pathLine)
  if (idx === -1) {
    return ''
  }
  return lines.slice(idx, idx + span).join('\n')
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

  const SAMPLE_ALLOWLIST = [
    'https://raw.githubusercontent.com',
    'https://gist.githubusercontent.com',
  ]

  const SAMPLE_MANIFEST: OnlineAssetManifestPayload = {
    katex: null,
    mermaid: null,
    shikiLangs: { typescript: 'fingerprinted/shiki-langs/typescript.abcd1234.json' },
  }

  const buildSampleOnlineHtml = (): string =>
    buildOnlineHtml(SAMPLE_HTML, { allowlist: SAMPLE_ALLOWLIST, manifest: SAMPLE_MANIFEST })

  describe('buildOnlineHeadersFile: 基本構造', () => {
    it('/*  /  /online.html の 3 セクションを順に持つ', () => {
      const text = buildOnlineHeadersFile(buildSampleOnlineHtml())
      const slashStarIdx = text.indexOf('/*')
      const slashIdx = text.indexOf('\n/\n')
      const onlineIdx = text.indexOf('/online.html')
      expect(slashStarIdx).toBeGreaterThanOrEqual(0)
      expect(slashIdx).toBeGreaterThan(slashStarIdx)
      expect(onlineIdx).toBeGreaterThan(slashIdx)
    })

    it('末尾改行を含む (POSIX text file 慣習)', () => {
      const text = buildOnlineHeadersFile(buildSampleOnlineHtml())
      expect(text.endsWith('\n')).toBe(true)
    })
  })

  describe('buildOnlineHeadersFile: 基本セキュリティヘッダ (/*)', () => {
    it('Referrer-Policy: no-referrer を /* に含む (Referer leak 防止、§5.f / §5.h)', () => {
      const text = buildOnlineHeadersFile(buildSampleOnlineHtml())
      expect(text).toContain('  Referrer-Policy: no-referrer')
    })

    it('X-Content-Type-Options: nosniff を /* に含む', () => {
      const text = buildOnlineHeadersFile(buildSampleOnlineHtml())
      expect(text).toContain('  X-Content-Type-Options: nosniff')
    })
  })

  describe('buildOnlineHeadersFile: CSP (/ と /online.html)', () => {
    it('/ と /online.html に同じ CSP content を返す (rewrite 元と先で挙動を揃える)', () => {
      const text = buildOnlineHeadersFile(buildSampleOnlineHtml())
      const cspMatches = [...text.matchAll(/Content-Security-Policy: (.+)/gu)]
      expect(cspMatches).toHaveLength(2)
      expect(cspMatches[0][1]).toBe(cspMatches[1][1])
    })

    it("CSP に 'self' + allowlist origins の connect-src が含まれる (single source of truth)", () => {
      const text = buildOnlineHeadersFile(buildSampleOnlineHtml())
      expect(text).toContain(
        "connect-src 'self' https://raw.githubusercontent.com https://gist.githubusercontent.com"
      )
    })

    it('online.html の meta CSP と HTTP header CSP が完全一致 (drift 検出)', () => {
      const onlineHtml = buildSampleOnlineHtml()
      const headersText = buildOnlineHeadersFile(onlineHtml)
      const metaCsp = extractCspContent(onlineHtml)
      const headerMatch = /Content-Security-Policy: (.+)/u.exec(headersText)
      expect(headerMatch).not.toBeNull()
      if (headerMatch) {
        expect(headerMatch[1]).toBe(metaCsp)
      }
    })

    it('env 由来の追加 allowlist host が CSP に展開される', () => {
      const withExtra = buildOnlineHtml(SAMPLE_HTML, {
        allowlist: [...SAMPLE_ALLOWLIST, 'https://wiki.internal'],
        manifest: SAMPLE_MANIFEST,
      })
      const text = buildOnlineHeadersFile(withExtra)
      expect(text).toContain('https://wiki.internal')
    })
  })

  describe('buildOnlineHeadersFile: Cache-Control の path 単位分離 (Phase A.2 §5.f / §5.i Item 1)', () => {
    it('/ に max-age=300 (HTML cache を短寿命化、immutable は付かない)', () => {
      const text = buildOnlineHeadersFile(buildSampleOnlineHtml())
      const section = extractHeadersSectionForTest(text, '/', 4)
      expect(section).toContain('Cache-Control: public, max-age=300')
      expect(section).not.toContain('immutable')
    })

    it('/online.html に max-age=300 (rewrite 元と先で挙動を揃える)', () => {
      const text = buildOnlineHeadersFile(buildSampleOnlineHtml())
      const section = extractHeadersSectionForTest(text, '/online.html', 4)
      expect(section).toContain('Cache-Control: public, max-age=300')
      expect(section).not.toContain('immutable')
    })

    it('/fingerprinted/* に immutable + max-age=31536000 (永久 cache)', () => {
      const text = buildOnlineHeadersFile(buildSampleOnlineHtml())
      expect(text).toContain('/fingerprinted/*')
      expect(text).toContain('Cache-Control: public, max-age=31536000, immutable')
    })

    it('/canonical/* に max-age=300 (immutable は付かない、Item 1)', () => {
      const text = buildOnlineHeadersFile(buildSampleOnlineHtml())
      const section = extractHeadersSectionForTest(text, '/canonical/*', 3)
      expect(section).toContain('Cache-Control: public, max-age=300')
      expect(section).not.toContain('immutable')
    })

    it('fingerprinted / canonical 両 section が存在する (3 段 fail-safe 成立条件)', () => {
      const text = buildOnlineHeadersFile(buildSampleOnlineHtml())
      expect(text).toContain('/fingerprinted/*')
      expect(text).toContain('/canonical/*')
    })
  })

  describe('buildOnlineHeadersFile: 入力検証', () => {
    it('CSP meta タグが無い HTML を渡すと throw', () => {
      const noCsp = SAMPLE_HTML.replace(/<meta\s+http-equiv[\s\S]*?\/>/u, '')
      expect(() => buildOnlineHeadersFile(noCsp)).toThrow(/Content-Security-Policy/u)
    })
  })

  describe('buildOnlineHeadersFile: Cloudflare Pages 2000 文字制限', () => {
    const buildOnlineHtmlWithNAllowlist = (origins: readonly string[]): string =>
      buildOnlineHtml(SAMPLE_HTML, {
        allowlist: [...SAMPLE_ALLOWLIST, ...origins],
        manifest: SAMPLE_MANIFEST,
      })

    it('CSP 行が 2000 文字以内なら正常に生成される (default allowlist)', () => {
      expect(() => buildOnlineHeadersFile(buildSampleOnlineHtml())).not.toThrow()
    })

    it('CSP 行が 2000 文字ちょうどなら通る (境界値)', () => {
      // 1 origin あたり ~40 文字。境界に近い件数を試行して 2000 文字以下に収まる構成を作る
      const padding = Array.from(
        { length: 40 },
        (_value, idx): string => `https://host${String(idx).padStart(2, '0')}.example.com`
      )
      const html = buildOnlineHtmlWithNAllowlist(padding)
      const result = buildOnlineHeadersFile(html)
      const cspLine = result.split('\n').find((line): boolean => line.includes('Content-Security'))
      expect(cspLine).toBeTruthy()
      // cspLine が undefined だと find が miss しているので、その時点で test として fail。
      // toBeTruthy で空文字も検出する。non-null assertion は型ガードとして使う。
      expect((cspLine ?? '').length).toBeLessThanOrEqual(CLOUDFLARE_HEADER_VALUE_LIMIT)
    })

    it('CSP 行が 2000 文字超なら fail-fast で throw', () => {
      // 1 origin あたり ~60 文字 × 100 件で確実に 2000 文字超
      const huge = Array.from(
        { length: 100 },
        (_value, idx): string =>
          `https://very-long-subdomain-${String(idx).padStart(3, '0')}.example-host.com`
      )
      const html = buildOnlineHtmlWithNAllowlist(huge)
      expect(() => buildOnlineHeadersFile(html)).toThrow(/2000 文字/u)
    })

    it('throw メッセージに env var 名と実 chars が含まれる (debug 容易性)', () => {
      const huge = Array.from(
        { length: 100 },
        (_value, idx): string =>
          `https://very-long-subdomain-${String(idx).padStart(3, '0')}.example-host.com`
      )
      const html = buildOnlineHtmlWithNAllowlist(huge)
      expect(() => buildOnlineHeadersFile(html)).toThrow(/MDXG_ONLINE_CONNECT_SRC/u)
      expect(() => buildOnlineHeadersFile(html)).toThrow(/chars/u)
    })
  })
}
