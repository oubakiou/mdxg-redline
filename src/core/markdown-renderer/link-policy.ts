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

/**
 * 同ページ内 anchor hash (`#...`) 形式の href か判定する。`#` 始まりであれば true。
 * scheme allowlist とは独立に「fragment-only」を意味し、DOM 内の `id="..."` 要素への
 * ジャンプ以外の副作用を持たない (navigation を変更しない / 外部 origin に到達しない) ため、
 * `renderer.link` で `<a href="#...">` をそのまま発行してよい安全境界として扱う。
 */
export const isHashOnlyHref = (href: string): boolean => href.startsWith('#')

/**
 * 相対パス href か判定する。`parseScheme` が null を返し (絶対 URL でない)、かつ
 * hash-only でもないものを「相対パス」とみなす。
 *
 * 用途は「URL allowlist は通らないが、相対リンクとして書かれたものだとわかる」分岐の判定。
 * 信頼境界の都合で `<a href>` としては出力しないが、視覚的にリンクであることと href 文字列を
 * tooltip で残す UX のため、`renderer.link` 側で text-only fallback (`javascript:` 等) と
 * 区別する判定として使う。
 */
export const isRelativePathHref = (href: string): boolean => {
  if (isHashOnlyHref(href)) {
    return false
  }
  return parseScheme(href) === null
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

  describe('isHashOnlyHref', () => {
    it('`#` 始まりの href を hash-only と判定する', () => {
      expect(isHashOnlyHref('#anchor')).toBe(true)
      expect(isHashOnlyHref('#1-概要')).toBe(true)
      expect(isHashOnlyHref('#')).toBe(true)
    })

    it('絶対 URL / 相対パス / 空文字は hash-only ではない', () => {
      expect(isHashOnlyHref('https://example.com#x')).toBe(false)
      expect(isHashOnlyHref('./other.md#x')).toBe(false)
      expect(isHashOnlyHref('')).toBe(false)
    })
  })

  describe('isRelativePathHref', () => {
    it('スキーム無しの相対パスを true 判定する', () => {
      expect(isRelativePathHref('./other.md')).toBe(true)
      expect(isRelativePathHref('../sibling.md')).toBe(true)
      expect(isRelativePathHref('docs/DESIGN.md')).toBe(true)
      expect(isRelativePathHref('/abs/path')).toBe(true)
    })

    it('hash-only は相対パスではない (専用判定が優先される)', () => {
      expect(isRelativePathHref('#anchor')).toBe(false)
    })

    it('絶対 URL (allowed / disallowed 問わず) は相対パスではない', () => {
      expect(isRelativePathHref('https://example.com')).toBe(false)
      expect(isRelativePathHref('http://example.com')).toBe(false)
      /* eslint-disable no-script-url */
      expect(isRelativePathHref('javascript:alert(1)')).toBe(false)
      /* eslint-enable no-script-url */
      expect(isRelativePathHref('mailto:foo@example.com')).toBe(false)
    })
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
