// link / image href の scheme allowlist 判定。値の定義と判定関数のみを担う pure module。
// 実際の enforcement (renderer.link / renderer.image でリンクを出さずに plain text にフォールバック
// する判断) は markdown.ts (信頼境界) 側で行う。本ファイルを修正する PR は DESIGN.md §11 への
// 影響を必ず確認すること。

const ALLOWED_LINK_SCHEMES = new Set(['http:', 'https:'])
// http: は CSP の img-src と揃えて意図的に除外している。平文通信と外部追跡経路を構造的に塞ぐ。
const ALLOWED_IMAGE_SCHEMES = new Set(['https:', 'data:'])

/** href の scheme を取り出す。new URL は base 無しだと相対 URL でエラーになるため、それを「絶対 URL でない」シグナルとして使う */
const parseScheme = (href: string): string | null => {
  try {
    return new URL(href).protocol
  } catch {
    return null
  }
}

export const isAllowedLinkHref = (href: string): boolean => {
  const scheme = parseScheme(href)
  return scheme !== null && ALLOWED_LINK_SCHEMES.has(scheme)
}

export const isAllowedImageHref = (href: string): boolean => {
  const scheme = parseScheme(href)
  return scheme !== null && ALLOWED_IMAGE_SCHEMES.has(scheme)
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('isAllowedLinkHref', () => {
    it('http:// と https:// を許可する', () => {
      expect(isAllowedLinkHref('http://example.com')).toBe(true)
      expect(isAllowedLinkHref('https://example.com')).toBe(true)
    })

    it('相対 URL は不許可 (parseScheme が null)', () => {
      expect(isAllowedLinkHref('./other.md')).toBe(false)
      expect(isAllowedLinkHref('/abs/path')).toBe(false)
      expect(isAllowedLinkHref('#anchor')).toBe(false)
    })

    /* eslint-disable no-script-url */
    it('javascript: / data: / mailto: は不許可', () => {
      expect(isAllowedLinkHref('javascript:alert(1)')).toBe(false)
      expect(isAllowedLinkHref('data:text/html,<script>')).toBe(false)
      expect(isAllowedLinkHref('mailto:foo@example.com')).toBe(false)
    })
    /* eslint-enable no-script-url */
  })

  describe('isAllowedImageHref', () => {
    it('https: と data: を許可する (CSP img-src 整合)', () => {
      expect(isAllowedImageHref('https://example.com/x.png')).toBe(true)
      expect(isAllowedImageHref('data:image/png;base64,iVBORw0KGgo=')).toBe(true)
    })

    it('http: は image では不許可 (平文画像経路を塞ぐ)', () => {
      expect(isAllowedImageHref('http://example.com/x.png')).toBe(false)
    })

    /* eslint-disable no-script-url */
    it('相対 URL / javascript: は不許可', () => {
      expect(isAllowedImageHref('./local.png')).toBe(false)
      expect(isAllowedImageHref('javascript:alert(1)')).toBe(false)
    })
    /* eslint-enable no-script-url */
  })
}
