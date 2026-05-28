// 非 Error 例外も含めた一律の文字列化。CLI 内で throw されるものは Error のことが多いが、
// JSON.parse 由来や cross-realm の Error など `instanceof Error` を満たさないケースもあるため
// String() フォールバックを持つ。

export const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('errorMessage', () => {
    it('Error インスタンスはその message を返す', () => {
      expect(errorMessage(new Error('boom'))).toBe('boom')
    })

    it('Error 以外 (文字列 / 数値 / null など) は String() でフォールバック', () => {
      expect(errorMessage('plain')).toBe('plain')
      expect(errorMessage(42)).toBe('42')
      expect(errorMessage(null)).toBe('null')
    })
  })
}
