// markdown 本文 SHA-256 のうち先頭 8 バイトを 16 文字 hex で返す。
// ファイル命名規約 §8 の docHash 部分と、Workspace 差分検知に使う。
// CLI とブラウザの双方が同じ関数を呼ぶことで docHash が一致することを保証する。

/**
 * markdown 本文の SHA-256 を計算し、先頭 8 バイトを 16 文字の hex 文字列で返す。
 * docHash としてファイル命名規約 (`<mdFileName>-<docHash>-...`) や
 * Workspace の差分検知に使う。CLI とブラウザの双方からこの関数を直接呼ぶことで、
 * docHash の計算結果がプロセスを跨いで一致することを保証する。
 */
export const computeDocHash = async (markdown: string): Promise<string> => {
  const buf = new TextEncoder().encode(markdown)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(hash)]
    .slice(0, 8)
    .map((byte): string => byte.toString(16).padStart(2, '0'))
    .join('')
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('computeDocHash', () => {
    it('同じ markdown は同じ hash を返す（決定性）', async () => {
      const first = await computeDocHash('# hello\n')
      const second = await computeDocHash('# hello\n')
      expect(first).toBe(second)
    })

    it('内容が 1 文字でも変われば異なる hash になる', async () => {
      const first = await computeDocHash('# hello\n')
      const second = await computeDocHash('# hellp\n')
      expect(first).not.toBe(second)
    })

    it('長さ 16 の小文字 hex 文字列を返す', async () => {
      const hash = await computeDocHash('arbitrary content')
      expect(hash).toMatch(/^[0-9a-f]{16}$/)
    })

    it('日本語・絵文字を含む UTF-8 でも安定して計算できる', async () => {
      const first = await computeDocHash('仕様書 🚀\n')
      const second = await computeDocHash('仕様書 🚀\n')
      expect(first).toBe(second)
      expect(first).toMatch(/^[0-9a-f]{16}$/)
    })
  })
}
