// online edition で fetch に成功した際、status bar 領域の #online-source span に
// "Source: <url>" を `<a rel="noreferrer noopener" referrerpolicy="no-referrer" target="_blank">`
// として表示する。3 属性すべてを必須にすることで、Source link クリック時に Referer ヘッダで
// 現在のページ URL (`?url=<fetched-url>` を含む) が click 先サーバに漏れる経路を構造的に塞ぐ
// (§5.f / §5.h Referer leak 対策)。
//
// CSS gating (review.css の `.toolbar-source` セレクタ) と JS gating (本関数の data-mdxg-online
// 判定) の二層で standalone / embed-template への混入を防ぐ (§3.1)。
//
// DOM 構築は `createElement` / `appendChild` / `textContent` 経由で行い innerHTML を使わない。
// 辞書値 (`translate('online.label.source')`) を textContent 経路で挿入する信頼境界
// (DESIGN.md §11) を守るため。
//
// 文書切替・言語切替の追従は 4 関数パターン (`setup` / `show` / `clear` / `teardown`、
// DESIGN.md §14.6) で行う。`setup*` は bootstrap で 1 度だけ呼ばれ `subscribeLangChange`
// (lang toggle) と `registerOnDocumentLoad` (文書切替) の 2 経路を購読する。

import type { DocumentLoader, Unsubscribe } from '../document/load-document'
import { subscribeLangChange, translate } from '../i18n/i18n-browser'

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
 * `#online-source` の中身を DOM API で組み立てる pure-ish 関数。defense-in-depth として
 * https:// 以外 (javascript: 等) は link 化せず textContent のみで挿入する。
 *
 * 辞書値 `translate('online.label.source')` (例: `Source: ` / `出典: `) は textContent 経路で
 * 安全に挿入される (innerHTML 非経由)。`docs/feature-ui-i18n.md §11` の信頼境界方針に従う。
 */
const buildAnchor = (url: string): HTMLAnchorElement => {
  const link = document.createElement('a')
  link.className = 'toolbar-source-link'
  link.href = url
  link.rel = SOURCE_LINK_REL
  link.referrerPolicy = SOURCE_LINK_REFERRER_POLICY
  link.target = SOURCE_LINK_TARGET
  link.textContent = url
  return link
}

export const buildSourceLinkElement = (url: string): HTMLSpanElement => {
  const wrapper = document.createElement('span')
  wrapper.appendChild(document.createTextNode(translate('online.label.source')))
  if (isHttpsUrl(url)) {
    wrapper.appendChild(buildAnchor(url))
  } else {
    wrapper.appendChild(document.createTextNode(url))
  }
  return wrapper
}

// 文書切替購読の Unsubscribe / lang 購読 Unsubscribe / 現在表示中の URL を module-local 保持。
// teardown で全 subscription を解除 + state を null + DOM を初期化 (test fixture / HMR 対応)。
let currentSourceUrl: string | null = null
let langSubscription: Unsubscribe | null = null
let docSubscription: Unsubscribe | null = null

const renderCurrentSource = (): void => {
  const el = document.getElementById(SOURCE_ELEMENT_ID)
  if (!(el instanceof HTMLElement)) {
    return
  }
  if (currentSourceUrl === null) {
    el.replaceChildren()
    el.hidden = true
    return
  }
  el.replaceChildren(buildSourceLinkElement(currentSourceUrl))
  el.hidden = false
}

/**
 * fetch 成功時に呼び出し、#online-source span に Source link を inject + visible 化する。
 * data-mdxg-online ガード下でのみ動作 (standalone / embed-template では JS gating で skip)。
 */
export const showOnlineSource = (url: string): void => {
  if (document.documentElement.dataset.mdxgOnline !== '1') {
    return
  }
  currentSourceUrl = url
  renderCurrentSource()
}

/** fetch 失敗時 / 起動時 / リセット時 / ローカル文書ロード時に source 表示を消す */
export const clearOnlineSource = (): void => {
  currentSourceUrl = null
  const el = document.getElementById(SOURCE_ELEMENT_ID)
  if (!(el instanceof HTMLElement)) {
    return
  }
  el.replaceChildren()
  el.hidden = true
}

interface SetupOnlineSourceDeps {
  registerOnDocumentLoad: DocumentLoader['registerOnDocumentLoad']
}

/**
 * bootstrap で 1 回だけ呼び、`subscribeLangChange` と `registerOnDocumentLoad` を 1 度ずつ
 * 購読する (idempotent guard で二重購読を防ぐ)。文書切替時に `loadDocument({kind})` 経由の
 * hook が source.kind を見て自動的に show/clear する。
 */
export const setupOnlineSourceI18n = (deps: SetupOnlineSourceDeps): void => {
  if (langSubscription !== null) {
    return
  }
  langSubscription = subscribeLangChange((): void => {
    renderCurrentSource()
  })
  docSubscription = deps.registerOnDocumentLoad((source): void => {
    if (source.kind === 'online') {
      showOnlineSource(source.url)
    } else {
      clearOnlineSource()
    }
  })
}

/**
 * test fixture / HMR / 将来の SPA 風文書切替で古い loader への登録残留を防ぐため、全 subscription
 * を解除 + state を null + DOM を初期化。2 回連続で呼んでも例外を投げない (idempotent)。
 */
const clearSourceDom = (): void => {
  const el = document.getElementById(SOURCE_ELEMENT_ID)
  if (el instanceof HTMLElement) {
    el.replaceChildren()
    el.hidden = true
  }
}

export const teardownOnlineSourceI18n = (): void => {
  if (langSubscription !== null) {
    langSubscription()
    langSubscription = null
  }
  if (docSubscription !== null) {
    docSubscription()
    docSubscription = null
  }
  currentSourceUrl = null
  clearSourceDom()
}

if (import.meta.vitest) {
  const { afterEach, beforeEach, describe, expect, it } = import.meta.vitest

  const setupSourceDom = (): HTMLElement => {
    const el = document.createElement('span')
    el.id = SOURCE_ELEMENT_ID
    el.hidden = true
    document.body.append(el)
    return el
  }

  const cleanupSourceDom = (): void => {
    teardownOnlineSourceI18n()
    delete document.documentElement.dataset.mdxgOnline
    const el = document.getElementById(SOURCE_ELEMENT_ID)
    if (el !== null) {
      el.remove()
    }
  }

  beforeEach(setupSourceDom)
  afterEach(cleanupSourceDom)

  describe('buildSourceLinkElement', () => {
    it('https URL では <a> を生成し、rel / referrerpolicy / target を 3 属性必須で付ける', () => {
      const wrapper = buildSourceLinkElement('https://example.com/x.md')
      const link = wrapper.querySelector('a')
      if (link === null) {
        throw new Error('link missing')
      }
      expect(link.rel).toBe(SOURCE_LINK_REL)
      expect(link.referrerPolicy).toBe(SOURCE_LINK_REFERRER_POLICY)
      expect(link.target).toBe(SOURCE_LINK_TARGET)
    })

    it('https URL は href / textContent に挿入され、innerHTML には流れない (DOM API 経由)', () => {
      const wrapper = buildSourceLinkElement(
        'https://raw.githubusercontent.com/owner/repo/main/README.md'
      )
      const link = wrapper.querySelector('a')
      if (link === null) {
        throw new Error('link missing')
      }
      expect(link.getAttribute('href')).toBe(
        'https://raw.githubusercontent.com/owner/repo/main/README.md'
      )
      expect(link.textContent).toBe('https://raw.githubusercontent.com/owner/repo/main/README.md')
    })

    it('XSS payload は textContent / setAttribute 経由で挿入され、innerHTML として実行されない', () => {
      const malicious = 'https://x.com/"><script>alert(1)</script>?q=&y'
      const wrapper = buildSourceLinkElement(malicious)
      const link = wrapper.querySelector('a')
      if (link === null) {
        throw new Error('link missing')
      }
      // textContent / href setter は DOM API 経由のため、href 属性値 / link.textContent は raw
      // 文字列を保持する一方、<script> 子要素として実体化しない (parser が解釈経路を取らない)。
      // innerHTML 文字列は jsdom / happy-dom 実装差があるため、子 collection で判定する。
      expect(link.textContent).toBe(malicious)
      expect(wrapper.querySelector('script')).toBeNull()
    })

    it('en では "Source: " prefix が textContent 経路で挿入される', () => {
      const wrapper = buildSourceLinkElement('https://x')
      // 先頭の TextNode は 'Source: '
      const { firstChild } = wrapper
      if (firstChild === null) {
        throw new Error('first child missing')
      }
      expect(firstChild.textContent).toBe('Source: ')
    })

    it('https 以外 (javascript: / http: / file:) は link 化せず inert text に倒す', () => {
      /* eslint-disable no-script-url */
      for (const url of [
        'javascript:alert(1)',
        'http://x.com/y',
        'file:///etc/passwd',
        'not a url',
      ]) {
        const wrapper = buildSourceLinkElement(url)
        expect(wrapper.querySelector('a')).toBeNull()
        expect(wrapper.textContent).toContain(url)
      }
      /* eslint-enable no-script-url */
    })
  })

  describe('showOnlineSource / clearOnlineSource', () => {
    it('online edition で showOnlineSource すると #online-source が visible + link 注入', () => {
      document.documentElement.dataset.mdxgOnline = '1'
      showOnlineSource('https://example.com/x.md')
      const el = document.getElementById(SOURCE_ELEMENT_ID)
      if (!(el instanceof HTMLElement)) {
        throw new Error('source el missing')
      }
      expect(el.hidden).toBe(false)
      expect(el.querySelector('a')).not.toBeNull()
    })

    it('clearOnlineSource で hidden + 空に戻る', () => {
      document.documentElement.dataset.mdxgOnline = '1'
      showOnlineSource('https://example.com/x.md')
      clearOnlineSource()
      const el = document.getElementById(SOURCE_ELEMENT_ID)
      if (!(el instanceof HTMLElement)) {
        throw new Error('source el missing')
      }
      expect(el.hidden).toBe(true)
      expect(el.querySelector('a')).toBeNull()
    })

    it('data-mdxg-online なしでは showOnlineSource は no-op (JS gating §3.1)', () => {
      showOnlineSource('https://example.com/x.md')
      const el = document.getElementById(SOURCE_ELEMENT_ID)
      if (!(el instanceof HTMLElement)) {
        throw new Error('source el missing')
      }
      expect(el.hidden).toBe(true)
      expect(el.querySelector('a')).toBeNull()
    })
  })
}
