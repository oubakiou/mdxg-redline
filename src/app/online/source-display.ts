// online edition で fetch に成功した際、status bar 領域の #online-source span に
// "Source: <url>" を `<a rel="noreferrer noopener" referrerpolicy="no-referrer" target="_blank">`
// として表示する。3 属性すべてを必須にすることで、Source link クリック時に Referer ヘッダで
// 現在のページ URL (`?url=<fetched-url>` を含む) が click 先サーバに漏れる経路を構造的に塞ぐ
// (§5.f / §5.h Referer leak 対策)。
//
// CSS gating (review.css の `.toolbar-source` セレクタ) と JS gating (本関数の data-mdxg-online
// 判定) の二層で standalone / embed-template への混入を防ぐ (§3.1)。

import { escapeHtml } from '../../core/escape'

const SOURCE_ELEMENT_ID = 'online-source'
const SOURCE_LINK_REL = 'noreferrer noopener'
const SOURCE_LINK_REFERRER_POLICY = 'no-referrer'
const SOURCE_LINK_TARGET = '_blank'

const isHttpsUrl = (url: string): boolean => {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * `<a>` タグの HTML 文字列を組み立てる pure 関数。href と表示テキストは escapeHtml で
 * XSS 対策を施す。3 属性 (rel / referrerpolicy / target) は定数から固定で書き出すので
 * 呼び出し側で省略 / 順番違いが発生しない (§5.f / §6 source-display test の構造的不変条件)。
 *
 * defense-in-depth: 公開 API として export しているため、caller の検証漏れに備えて
 * https:// 以外の scheme (`javascript:` 等) は link 化せず escape 済みの inert text にする。
 * 正常経路 (boot.ts:tryFetchAndLoad → showOnlineSource) では `validateOnlineUrl` を通った
 * https URL のみが渡るため到達しないが、二段防御として残す (§5.f / §11)。
 */
export const buildSourceLinkHtml = (url: string): string => {
  const safeUrl = escapeHtml(url)
  if (!isHttpsUrl(url)) {
    return `Source: ${safeUrl}`
  }
  return (
    `Source: <a class="toolbar-source-link" href="${safeUrl}"` +
    ` rel="${SOURCE_LINK_REL}" referrerpolicy="${SOURCE_LINK_REFERRER_POLICY}"` +
    ` target="${SOURCE_LINK_TARGET}">${safeUrl}</a>`
  )
}

/**
 * fetch 成功時に呼び出し、#online-source span に Source link を inject + visible 化する。
 * data-mdxg-online ガード下でのみ動作 (standalone / embed-template では JS gating で skip)。
 */
export const showOnlineSource = (url: string): void => {
  if (document.documentElement.dataset.mdxgOnline !== '1') {
    return
  }
  const el = document.getElementById(SOURCE_ELEMENT_ID)
  if (!(el instanceof HTMLElement)) {
    return
  }
  // innerHTML を使うのは link 1 つだけ書き出す pure 関数経由なので XSS 経路は escapeHtml で
  // 塞がれている。createElement で組むより maintainability が高い (3 属性が文字列固定)。
  el.innerHTML = buildSourceLinkHtml(url)
  el.hidden = false
}

/** fetch 失敗時 / 起動時 / リセット時に source 表示を消す */
export const clearOnlineSource = (): void => {
  const el = document.getElementById(SOURCE_ELEMENT_ID)
  if (!(el instanceof HTMLElement)) {
    return
  }
  el.textContent = ''
  el.hidden = true
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('buildSourceLinkHtml', () => {
    it('3 属性 (rel="noreferrer noopener" / referrerpolicy="no-referrer" / target="_blank") をすべて含む', () => {
      const html = buildSourceLinkHtml('https://example.com/x.md')
      expect(html).toContain('rel="noreferrer noopener"')
      expect(html).toContain('referrerpolicy="no-referrer"')
      expect(html).toContain('target="_blank"')
    })

    it('href と表示テキストに URL を埋め込む', () => {
      const html = buildSourceLinkHtml(
        'https://raw.githubusercontent.com/owner/repo/main/README.md'
      )
      expect(html).toContain('href="https://raw.githubusercontent.com/owner/repo/main/README.md"')
      expect(html).toContain('>https://raw.githubusercontent.com/owner/repo/main/README.md<')
    })

    it('XSS payload (`<script>` / `"` / `&`) を escapeHtml で実体参照化', () => {
      const malicious = 'https://x.com/"><script>alert(1)</script>?q=&y'
      const html = buildSourceLinkHtml(malicious)
      // 危険な構造文字 (`<` `>` `"` `&`) は実体参照化されるので script タグとしては inert
      expect(html).not.toContain('<script>')
      expect(html).not.toContain('"><')
      expect(html).toContain('&lt;script&gt;')
      expect(html).toContain('&quot;')
      expect(html).toContain('&amp;')
    })

    it('"Source: " prefix を含む', () => {
      expect(buildSourceLinkHtml('https://x')).toMatch(/^Source: <a/u)
    })

    it('https:// 以外 (javascript: / http: / file: / 不正 URL) は link 化せず inert text に倒す (defense-in-depth)', () => {
      // 公開 API として export しているため caller の検証漏れに備える。test 入力に
      // `javascript:` literal を含むため no-script-url を局所的に disable する。
      /* eslint-disable no-script-url */
      expect(buildSourceLinkHtml('javascript:alert(1)')).not.toContain('<a ')
      expect(buildSourceLinkHtml('javascript:alert(1)')).toContain('javascript:alert(1)')
      expect(buildSourceLinkHtml('http://x.com/y')).not.toContain('<a ')
      expect(buildSourceLinkHtml('file:///etc/passwd')).not.toContain('<a ')
      expect(buildSourceLinkHtml('not a url')).not.toContain('<a ')
      // escape は引き続き効く (alert(1) は plain text として残るが <script> や " は実体参照化)
      expect(buildSourceLinkHtml('javascript:"<x>')).toContain('&lt;x&gt;')
      expect(buildSourceLinkHtml('javascript:"<x>')).toContain('&quot;')
      /* eslint-enable no-script-url */
    })
  })
}
