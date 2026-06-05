// `<html>` 開きタグ等への `data-*` 属性 upsert (挿入 or 上書き) を担う汎用 primitive。
// 既存値の有無による分岐 (`replace` vs 末尾挿入) と、`HTML_TAG_RE` で <html> 開きタグを
// 切り出して splice する手順を集約する。html-rewrite.ts は本 primitive を組み合わせて
// 個別属性 (data-theme / data-comments-width / data-page-nav-width / data-toolbar-open-file)
// を扱う薄い public ラッパに縮小する。

import { escapeHtml } from '../escape.ts'

const HTML_TAG_RE = /<html\b[^>]*>/i

// 属性名は内部呼び出しから渡される固定文字列のみを想定 (data-* 形式)。RegExp に
// そのまま埋めても安全になるよう、英数字 + ハイフンに限定する assertion を入れる。
const VALID_ATTR_NAME_RE = /^[a-z][a-z0-9-]*$/

const assertAttrName = (attrName: string): void => {
  if (!VALID_ATTR_NAME_RE.test(attrName)) {
    throw new Error(`unsupported attribute name for rewriter: ${attrName}`)
  }
}

/**
 * 開きタグ文字列に `attrName="<escapedValue>"` を挿入 or 上書きする。
 * - 既存の `attrName="..."` があれば値を差し替え
 * - 無ければ末尾 `>` の直前にスペース付きで追加
 *
 * `escapedValue` は既に HTML 属性 escape 済み (`&quot;` / `&amp;` / `&lt;` / `&gt;` 等) である前提。
 */
export const setOrInsertAttribute = (
  openingTag: string,
  attrName: string,
  escapedValue: string
): string => {
  assertAttrName(attrName)
  const re = new RegExp(`\\b${attrName}="[^"]*"`)
  if (re.test(openingTag)) {
    return openingTag.replace(re, `${attrName}="${escapedValue}"`)
  }
  return openingTag.replace(/>$/, ` ${attrName}="${escapedValue}">`)
}

/**
 * template HTML の `<html>` 開きタグに `data-*` 属性を 1 つ upsert する。
 * 値は HTML 属性 escape を経由するため、CLI バリデーション済みでない値でも安全。
 * <html> タグが見つからなければ Error を投げる (呼び出し側が CLI エラーに変換)。
 */
export const upsertHtmlDataAttribute = (
  reviewHtml: string,
  attrName: string,
  value: string
): string => {
  const match = HTML_TAG_RE.exec(reviewHtml)
  if (!match) {
    throw new Error('template HTML に <html> タグが見つかりません')
  }
  const [tag] = match
  const newTag = setOrInsertAttribute(tag, attrName, escapeHtml(value))
  return reviewHtml.slice(0, match.index) + newTag + reviewHtml.slice(match.index + tag.length)
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('setOrInsertAttribute', () => {
    it('既存属性は値を上書きする', () => {
      const tag = '<html lang="ja" data-theme="light">'
      expect(setOrInsertAttribute(tag, 'data-theme', 'dark')).toBe(
        '<html lang="ja" data-theme="dark">'
      )
    })

    it('未存在属性は末尾 > の直前に追加する', () => {
      const tag = '<html lang="ja">'
      expect(setOrInsertAttribute(tag, 'data-theme', 'dark')).toBe(
        '<html lang="ja" data-theme="dark">'
      )
    })

    it('不正な attrName は Error', () => {
      expect(() => setOrInsertAttribute('<html>', 'data theme', 'x')).toThrow(/attribute name/)
      expect(() => setOrInsertAttribute('<html>', '1data', 'x')).toThrow(/attribute name/)
    })
  })

  describe('upsertHtmlDataAttribute', () => {
    it('属性値を HTML escape して埋め込む', () => {
      const html = '<html></html>'
      const out = upsertHtmlDataAttribute(html, 'data-name', '"&<>')
      expect(out).toContain('data-name="&quot;&amp;&lt;&gt;"')
    })

    it('<html> タグが無いと Error', () => {
      expect(() => upsertHtmlDataAttribute('<body></body>', 'data-theme', 'dark')).toThrow(/<html>/)
    })

    it('元文字列を破壊しない', () => {
      const html = '<html><body></body></html>'
      upsertHtmlDataAttribute(html, 'data-theme', 'dark')
      expect(html).toBe('<html><body></body></html>')
    })
  })
}
