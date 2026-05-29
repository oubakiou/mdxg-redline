// Page Outline のスクロールスパイ (MDXG §8 [SHOULD] 「現在可視の見出しは示される」)。
// `IntersectionObserver` で #doc 配下の `h3[id]`–`h6[id]` を観測し、
// ビューポート上部に最も近い見出しに対応する outline link に `aria-current="location"` を付ける
// (リファレンス実装 vercel-labs/mdxg と同じ手法、mdxg-virtual-pages.archive.md §8.3 参照)。
//
// 設計判断:
// - `rootMargin: '0px 0px -75% 0px'` でビューポート上 25% に入った見出しだけを「現在位置」扱い
//   にする。スクロール中に視認しやすい範囲を絞ることでハイライトのちらつきを抑える
// - 観測対象 0 件のページ (H3–H6 無し) では既存の aria-current を全部外すだけで終わる
// - renderAll() ごとに observer を作り直して古い参照を解放する (memory リーク防止)
// - topmost 解決の core ロジック `pickTopmostHeading` は DOM 直接依存を避けて
//   `resolveOffsetTop` callback ベースの pure 関数にし、node 環境でテスト可能にする

import { qs } from '../dom/dom-utils'

const DOC_ID = 'doc'
const DOC_PANE_SELECTOR = '.doc-pane'
const OUTLINE_LINK_SELECTOR = '.page-outline-link'
const HEADING_SELECTOR = 'h3[id], h4[id], h5[id], h6[id]'
const ARIA_CURRENT = 'aria-current'
const ARIA_CURRENT_LOCATION = 'location'

interface ScrollSpyState {
  intersecting: Set<string>
  observer: IntersectionObserver | null
}

const moduleState: ScrollSpyState = {
  intersecting: new Set(),
  observer: null,
}

const clearOutlineActive = (): void => {
  for (const link of document.querySelectorAll(`${OUTLINE_LINK_SELECTOR}[${ARIA_CURRENT}]`)) {
    link.removeAttribute(ARIA_CURRENT)
  }
}

const applyLinkAriaCurrent = (link: HTMLElement, headingSlug: string): void => {
  if (link.dataset.headingSlug === headingSlug) {
    link.setAttribute(ARIA_CURRENT, ARIA_CURRENT_LOCATION)
    return
  }
  link.removeAttribute(ARIA_CURRENT)
}

const setOutlineActiveByHeadingSlug = (headingSlug: string): void => {
  for (const link of document.querySelectorAll(OUTLINE_LINK_SELECTOR)) {
    if (link instanceof HTMLElement) {
      applyLinkAriaCurrent(link, headingSlug)
    }
  }
}

/**
 * slug を CSS selector の attribute 値として埋め込む。
 * slug は slugifyOrFallback により ASCII [a-z0-9-] のみで構成されるため、`"` 等の escape は
 * 不要だが、leading digit ("1-overview" 等) に備えて id selector (`#1-overview`) ではなく
 * attribute selector (`[id="1-overview"]`) を使う。
 * `CSS.escape` を避けることで node 環境のテストでも動作する (browser-only API 非依存)。
 */
const selectorForId = (slug: string): string => `[id="${slug}"]`

/**
 * intersecting に含まれる id のうち、`resolveOffsetTop(id)` が最小値を返す id を選ぶ
 * (= ページ上部に最も近い見出し)。`resolveOffsetTop` が null を返す id は無視する
 * (rerender 直後の race で DOM から消えた要素を想定)。
 * DOM 依存をすべて callback に逃がしているため pure / node 環境テスト可能。
 */
export const pickTopmostHeading = (
  resolveOffsetTop: (id: string) => number | null,
  intersectingIds: ReadonlySet<string>
): string | null => {
  let topmostId: string | null = null
  let topmostOffset = Number.POSITIVE_INFINITY
  for (const id of intersectingIds) {
    const offset = resolveOffsetTop(id)
    if (offset !== null && offset < topmostOffset) {
      topmostId = id
      topmostOffset = offset
    }
  }
  return topmostId
}

const offsetTopResolver =
  (doc: HTMLElement) =>
  (id: string): number | null => {
    const el = doc.querySelector<HTMLElement>(selectorForId(id))
    if (el === null) {
      return null
    }
    return el.offsetTop
  }

const applyIntersectionEntry = (entry: IntersectionObserverEntry): void => {
  const { target } = entry
  if (!(target instanceof HTMLElement) || target.id === '') {
    return
  }
  if (entry.isIntersecting) {
    moduleState.intersecting.add(target.id)
    return
  }
  moduleState.intersecting.delete(target.id)
}

const updateIntersectingSet = (entries: IntersectionObserverEntry[]): void => {
  for (const entry of entries) {
    applyIntersectionEntry(entry)
  }
}

const handleIntersection = (doc: HTMLElement, entries: IntersectionObserverEntry[]): void => {
  updateIntersectingSet(entries)
  // 何も intersecting でないなら、直前のハイライトを残す (scroll でビューポート間を
  // 一瞬空白になる時の点滅防止)。次に何か入ってきたら更新される。
  if (moduleState.intersecting.size === 0) {
    return
  }
  const topmost = pickTopmostHeading(offsetTopResolver(doc), moduleState.intersecting)
  if (topmost !== null) {
    setOutlineActiveByHeadingSlug(topmost)
  }
}

const teardownObserver = (): void => {
  if (moduleState.observer !== null) {
    moduleState.observer.disconnect()
    moduleState.observer = null
  }
  moduleState.intersecting.clear()
}

interface SpyTargets {
  doc: HTMLElement
  headings: NodeListOf<HTMLElement>
  pane: HTMLElement
}

const resolveSpyTargets = (): SpyTargets | null => {
  const doc = document.getElementById(DOC_ID)
  const pane = document.querySelector(DOC_PANE_SELECTOR)
  if (!(doc instanceof HTMLElement) || !(pane instanceof HTMLElement)) {
    return null
  }
  const headings = doc.querySelectorAll<HTMLElement>(HEADING_SELECTOR)
  return { doc, headings, pane }
}

/**
 * 現状の DOM から scroll-spy を組み直す。renderAll() ごとに呼ぶ前提で、
 * 古い observer は teardown してから新規に attach する。
 * 観測対象 (H3–H6) が 0 件のページでは observer は作らず、aria-current だけ全部クリアする。
 */
export const setupScrollSpy = (): void => {
  teardownObserver()
  const targets = resolveSpyTargets()
  if (targets === null) {
    return
  }
  if (targets.headings.length === 0) {
    clearOutlineActive()
    return
  }
  moduleState.observer = new IntersectionObserver(
    (entries): void => handleIntersection(targets.doc, entries),
    {
      root: targets.pane,
      rootMargin: '0px 0px -75% 0px',
    }
  )
  for (const heading of targets.headings) {
    moduleState.observer.observe(heading)
  }
}

/** ページ切替直後に、観測コールバックを待たず即座に該当 heading を current 扱いにする */
export const setActiveHeadingImmediately = (headingSlug: string | null): void => {
  if (headingSlug === null) {
    clearOutlineActive()
    return
  }
  setOutlineActiveByHeadingSlug(headingSlug)
}

/**
 * 指定 page の `<section class="virtual-page">` 配下にある `id="<slug>"` 要素までスクロールする
 * (MDXG §8 outline anchor)。Stacked View では全 page の H3–H6 が DOM 上に並ぶため、heading slug が
 * page をまたいで衝突する (非 ASCII fallback の `page-1` 等が複数 page で同じ値を取りうる)。
 * `pageSlug` で section を 1 つに絞ることで正しい heading にスクロールできる。
 *
 * `behavior` は `auto` (instant) と `smooth` を caller が選ぶ。初期ロードは instant にして
 * page-scroll-spy の初回 callback と競合させないようにする (review.ts の loadFromMarkdown)。
 */
export const scrollToHeading = (
  headingSlug: string,
  pageSlug: string,
  behavior: ScrollBehavior = 'smooth'
): void => {
  const doc = qs(`#${DOC_ID}`)
  const section = doc.querySelector<HTMLElement>(
    `section.virtual-page[data-page-slug="${pageSlug}"]`
  )
  if (section === null) {
    return
  }
  const target = section.querySelector<HTMLElement>(selectorForId(headingSlug))
  if (target === null) {
    return
  }
  target.scrollIntoView({ behavior, block: 'start' })
}

// テスト用 resolveOffsetTop ファクトリ。テスト本体で fixture map を参照する純関数 callback を作る。
const buildOffsetResolver =
  (offsets: Record<string, number>) =>
  (id: string): number | null => {
    if (!(id in offsets)) {
      return null
    }
    return offsets[id]
  }

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('pickTopmostHeading', () => {
    it('intersecting の中で offsetTop が最小の id を返す', () => {
      const resolve = buildOffsetResolver({ alpha: 100, bravo: 50, charlie: 200 })
      expect(pickTopmostHeading(resolve, new Set(['alpha', 'bravo', 'charlie']))).toBe('bravo')
    })

    it('intersecting が空なら null', () => {
      const resolve = buildOffsetResolver({})
      expect(pickTopmostHeading(resolve, new Set())).toBeNull()
    })

    it('resolveOffsetTop が null を返す id は無視する (rerender 直後の race 想定)', () => {
      const resolve = buildOffsetResolver({ alpha: 100 })
      expect(pickTopmostHeading(resolve, new Set(['alpha', 'missing']))).toBe('alpha')
    })

    it('全て null を返すなら null', () => {
      const resolve = buildOffsetResolver({})
      expect(pickTopmostHeading(resolve, new Set(['x1', 'y2']))).toBeNull()
    })
  })
}
