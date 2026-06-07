// Cloudflare Pages の SPA fallback (存在しないパス → index.html を 200 で返す) を
// 抑制するための 404.html を hosting target に emit する pure 関数群。 `dist/hosting/404.html`
// を置くと Pages が存在しないパスに対して **404 status + 404.html の内容** を返すように
// 切り替わる (公式 docs: https://developers.cloudflare.com/pages/configuration/serving-pages/)。
//
// 自己完結する静的 HTML として書く: 外部 fetch なし / 外部 CSS なし / 全 inline。 404
// ページ自身の favicon 取得で再度 SPA fallback が走らないよう、 src/review.html と同じ
// inline SVG favicon を埋め込む。

// 赤背景 + 白「M」の SVG favicon。 src/review.html に inline したものと bit-identical に
// 保つ (色 / グリフ / viewBox)。
const FAVICON_SVG_DATA_URI =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>" +
  "<rect width='32' height='32' fill='%23d32f2f'/>" +
  "<text x='16' y='22' font-size='20' text-anchor='middle' fill='white' " +
  "font-family='sans-serif' font-weight='bold'>M</text></svg>"

export const buildOnline404Html = (): string => `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>404 Not Found · MDXG Redline</title>
    <link rel="icon" type="image/svg+xml" href="${FAVICON_SVG_DATA_URI}" />
    <style>
      body {
        font-family:
          system-ui,
          -apple-system,
          sans-serif;
        background: #fff;
        color: #333;
        text-align: center;
        padding: 64px 16px;
        margin: 0;
      }
      .code {
        color: #d32f2f;
        font-size: 72px;
        font-weight: bold;
        line-height: 1;
      }
      .msg {
        font-size: 18px;
        margin: 16px 0 24px;
      }
      a {
        color: #d32f2f;
        text-decoration: none;
      }
      a:hover {
        text-decoration: underline;
      }
      @media (prefers-color-scheme: dark) {
        body {
          background: #1a1a1a;
          color: #ddd;
        }
      }
    </style>
  </head>
  <body>
    <div class="code">404</div>
    <div class="msg">Page Not Found</div>
    <p><a href="/">← Back to MDXG Redline</a></p>
  </body>
</html>
`

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('buildOnline404Html', () => {
    it('HTML5 doctype + html / head / body を持つ', () => {
      const html = buildOnline404Html()
      expect(html.startsWith('<!doctype html>')).toBe(true)
      expect(html).toContain('<html lang="ja">')
      expect(html).toContain('</body>')
      expect(html).toContain('</html>')
    })

    it('title に "404 Not Found" を含む (検索結果 / タブで識別可能)', () => {
      expect(buildOnline404Html()).toContain('404 Not Found')
    })

    it('inline SVG favicon を持つ (404 ページ自身の favicon GET で SPA fallback を起こさない)', () => {
      const html = buildOnline404Html()
      expect(html).toContain('rel="icon"')
      expect(html).toContain('image/svg+xml')
      expect(html).toContain('data:image/svg+xml')
    })

    it('top page (/) へのリンクを持つ (ユーザーの復帰経路)', () => {
      expect(buildOnline404Html()).toMatch(/href="\/"/u)
    })

    it('外部 fetch なし (style は inline、 script はゼロ、 外部 stylesheet なし)', () => {
      const html = buildOnline404Html()
      expect(html).not.toContain('<link rel="stylesheet"')
      expect(html).not.toContain('<script')
      expect(html).toContain('<style>')
    })

    it('呼び出しが決定論的 (同じ入力 → 同じ出力)', () => {
      expect(buildOnline404Html()).toBe(buildOnline404Html())
    })
  })
}
