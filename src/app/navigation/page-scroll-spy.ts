// Stacked View 用の page scroll-spy。
// `IntersectionObserver` で `<section.virtual-page>` を観測し、ビューポート上部に最も近い
// section の pageIndex を `state.activePageIndex` / `location.hash` / TOC active 表示に同期する。
//
// 既存の heading scroll-spy (`scroll-spy.ts`) と並列に動作する。観測対象が違う (section vs h3-h6)
// ので別 observer インスタンスを持つ。topmost 解決アルゴリズム自体は heading 用と相似。
//
// 設計判断:
// - `rootMargin: '-5% 0px -95% 0px'` で viewport の上から 5% の線を「現在位置」と定義する。
//   TOC クリック時に section top を同じ 5% の位置に揃える `alignSectionTopInPane` の挙動と
//   整合させ、navigate 直後に上半分に残った前ページが topmost と誤判定されないようにする
// - state.activePageIndex 変更時のみ TOC active 表示と hash を更新する (no-op の再描画を避ける)
// - hash 更新は `syncHashFromActivePage` 経由で、既に同じ hash なら no-op (無限 hashchange 防止)
// - 観測 → state 更新 → hashchange イベント発火 → navigateToTarget → setActivePageIndex で
//   「既に active なので no-op」となり、ループは構造的に閉じる

import { setActivePageIndex, syncHashFromActivePage } from '../document/pages'

const PAGE_SECTION_SELECTOR = 'section.virtual-page'
const DOC_PANE_SELECTOR = '.doc-pane'
const PAGE_INDEX_DATASET = 'pageIndex'

interface PageScrollSpyState {
  intersecting: Set<number>
  observer: IntersectionObserver | null
  /** scroll-spy が hash を更新した直後の slug。hashchange 由来 navigate との重複を抑止する */
  onPageActivated: ((pageIndex: number) => void) | null
}

const moduleState: PageScrollSpyState = {
  intersecting: new Set(),
  observer: null,
  onPageActivated: null,
}

/**
 * 観測中の pageIndex のうち `resolveOffsetTop` が最小値を返す index を返す
 * (= scroll コンテナ上部に最も近い section)。`resolveOffsetTop` が null の index は無視する
 * (rerender 直後の race で DOM から消えた section を想定)。pure / node 環境テスト可能。
 */
export const pickTopmostPageIndex = (
  resolveOffsetTop: (pageIndex: number) => number | null,
  intersectingIndices: ReadonlySet<number>
): number | null => {
  let topmostIndex: number | null = null
  let topmostOffset = Number.POSITIVE_INFINITY
  for (const index of intersectingIndices) {
    const offset = resolveOffsetTop(index)
    if (offset !== null && offset < topmostOffset) {
      topmostIndex = index
      topmostOffset = offset
    }
  }
  return topmostIndex
}

const pageIndexFromSection = (section: HTMLElement): number | null => {
  const raw = section.dataset[PAGE_INDEX_DATASET]
  if (typeof raw !== 'string') {
    return null
  }
  const parsed = Number.parseInt(raw, 10)
  if (Number.isNaN(parsed)) {
    return null
  }
  return parsed
}

const applyIntersectionEntry = (entry: IntersectionObserverEntry): void => {
  const { target } = entry
  if (!(target instanceof HTMLElement)) {
    return
  }
  const pageIndex = pageIndexFromSection(target)
  if (pageIndex === null) {
    return
  }
  if (entry.isIntersecting) {
    moduleState.intersecting.add(pageIndex)
    return
  }
  moduleState.intersecting.delete(pageIndex)
}

const offsetTopResolver =
  (doc: HTMLElement) =>
  (pageIndex: number): number | null => {
    const section = doc.querySelector<HTMLElement>(
      `${PAGE_SECTION_SELECTOR}[data-page-index="${pageIndex}"]`
    )
    if (section === null) {
      return null
    }
    return section.offsetTop
  }

const notifyPageActivated = (pageIndex: number): void => {
  if (moduleState.onPageActivated !== null) {
    moduleState.onPageActivated(pageIndex)
  }
}

const syncStateToTopmost = (topmostIndex: number): void => {
  const changed = setActivePageIndex(topmostIndex)
  if (!changed) {
    return
  }
  syncHashFromActivePage(null)
  notifyPageActivated(topmostIndex)
}

const handleIntersection = (doc: HTMLElement, entries: IntersectionObserverEntry[]): void => {
  for (const entry of entries) {
    applyIntersectionEntry(entry)
  }
  // 何も intersecting でない瞬間 (ページ間ジャンプ中) はハイライトを保つ
  if (moduleState.intersecting.size === 0) {
    return
  }
  const topmost = pickTopmostPageIndex(offsetTopResolver(doc), moduleState.intersecting)
  if (topmost !== null) {
    syncStateToTopmost(topmost)
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
  pane: HTMLElement
  sections: NodeListOf<HTMLElement>
}

const resolveSpyTargets = (): SpyTargets | null => {
  const doc = document.getElementById('doc')
  const pane = document.querySelector(DOC_PANE_SELECTOR)
  if (!(doc instanceof HTMLElement) || !(pane instanceof HTMLElement)) {
    return null
  }
  const sections = doc.querySelectorAll<HTMLElement>(PAGE_SECTION_SELECTOR)
  return { doc, pane, sections }
}

/**
 * 現状の DOM から page scroll-spy を組み直す。renderAll() ごとに呼ぶ前提で、
 * 古い observer は teardown してから新規に attach する。Stacked View で section が 1 件以下の
 * ケース (単一ページ文書 / 空文書) では observer を作らない (常に index 0 で固定)。
 */
export const setupPageScrollSpy = (): void => {
  teardownObserver()
  const targets = resolveSpyTargets()
  if (targets === null) {
    return
  }
  if (targets.sections.length <= 1) {
    return
  }
  moduleState.observer = new IntersectionObserver(
    (entries): void => handleIntersection(targets.doc, entries),
    {
      root: targets.pane,
      rootMargin: '-5% 0px -95% 0px',
    }
  )
  for (const section of targets.sections) {
    moduleState.observer.observe(section)
  }
}

/**
 * scroll-spy が `state.activePageIndex` を変更した直後に呼ばれるコールバックを登録する。
 * 主に「TOC active 表示の DOM 直接更新」用。renderAll を毎回叩くと doc 再描画が走り重いので、
 * scroll 起点の更新は view を最低限触る形にする。
 */
export const setOnPageActivated = (callback: ((pageIndex: number) => void) | null): void => {
  moduleState.onPageActivated = callback
}

// テスト用 resolveOffsetTop ファクトリ。fixture map を参照する pure callback を作る。
// consistent-function-scoping ルールで外スコープ要求のため module-level に置く (vitest gate 外でも
// production には影響しない静的関数)。
const buildOffsetResolver =
  (offsets: Record<number, number>) =>
  (pageIndex: number): number | null => {
    if (!(pageIndex in offsets)) {
      return null
    }
    return offsets[pageIndex]
  }

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('pickTopmostPageIndex', () => {
    it('intersecting の中で offsetTop が最小の pageIndex を返す', () => {
      const resolve = buildOffsetResolver({ 0: 100, 1: 50, 2: 200 })
      expect(pickTopmostPageIndex(resolve, new Set([0, 1, 2]))).toBe(1)
    })

    it('intersecting が空なら null', () => {
      const resolve = buildOffsetResolver({})
      expect(pickTopmostPageIndex(resolve, new Set())).toBeNull()
    })

    it('resolveOffsetTop が null を返す index は無視する (rerender 直後の race 想定)', () => {
      const resolve = buildOffsetResolver({ 0: 100 })
      expect(pickTopmostPageIndex(resolve, new Set([0, 5]))).toBe(0)
    })

    it('全て null を返すなら null', () => {
      const resolve = buildOffsetResolver({})
      expect(pickTopmostPageIndex(resolve, new Set([1, 2]))).toBeNull()
    })

    // state を参照する syncStateToTopmost / handleIntersection 系は DOM 依存 + state mutation を
    // 含むので別途 happy-dom 導入時にテスト追加 (DESIGN.md §12 拡張候補)。
  })
}
