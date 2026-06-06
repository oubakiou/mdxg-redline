// Cloudflare Pages の _redirects フォーマットで `/` への request を `/online.html` の content
// として配信する rewrite (status 200) を生成する (docs/feature-online-edition.md §5.g):
// - URL バーは `/` のまま (302 / 301 のような URL 変更を起こさない)
// - `?url=...` 等のクエリ文字列は rewrite 先にそのまま渡される (Cloudflare Pages 仕様)
// - `/online.html` への直接アクセスも並立して動作する (rewrite の方向性が `/` → `/online.html`)
//
// 公式 docs (https://developers.cloudflare.com/pages/configuration/redirects/) に
// "Redirects execute before headers" と明記。ただし status 200 rewrite 時に `_headers` が
// rewrite 前 / 後どちらの URL で評価されるかは明示なし。online-headers.ts では両方の可能性に
// 対する防御として `/` と `/online.html` の両方に同じ CSP を書いている。
export const buildOnlineRedirectsFile = (): string => '/ /online.html 200\n'

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('buildOnlineRedirectsFile', () => {
    it('/ → /online.html の rewrite (status 200) を 1 行で返す', () => {
      expect(buildOnlineRedirectsFile()).toBe('/ /online.html 200\n')
    })

    it('末尾改行を含む (POSIX text file 慣習)', () => {
      const text = buildOnlineRedirectsFile()
      expect(text.endsWith('\n')).toBe(true)
    })

    it('rewrite 行が 1 行のみ (静的配信のみで複雑なルーティングを持たない)', () => {
      const lines = buildOnlineRedirectsFile()
        .split('\n')
        .filter((line): boolean => line.length > 0)
      expect(lines).toHaveLength(1)
    })
  })
}
