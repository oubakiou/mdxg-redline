// 仮想ページの選択状態と URL hash 同期を担当する pure-ish モジュール。
// DOM の再描画は呼び出し側 (review.ts) が orchestrate する責務分担にしており、
// 本モジュールは state.activePageIndex の mutation と hash <-> slug の解決のみを行う。
//
// 設計判断:
// - History API は使わず `location.hash` への代入だけで履歴を管理する (mdxg-virtual-pages.md §7.4)
// - hash が空 / 不正なら先頭ページ (index 0) にフォールバックする (mdxg-virtual-pages.md §7.4:
//   「hash が空 / 不正な場合は activePageIndex = 0」)。これにより初期ロードとブラウザ戻る /
//   進むで観測される挙動が一致する (URL = 表示状態の正準)。
// - hash の slug が `state.pages` のどれにも一致しない場合は同じく 0 にフォールバックする。
//   docHash が変わると以前の slug が失効する想定 (mdxg-virtual-pages.md §13.2) で、
//   失効リンクは「先頭ページに戻る」のが最も穏当な挙動

import type { Page } from '../core/page-split'
import { state } from './app-state'

/**
 * `state.pages` から指定 slug に一致する Page を返す。見つからなければ null。
 */
export const findPageBySlug = (slug: string): Page | null => {
  for (const page of state.pages) {
    if (page.slug === slug) {
      return page
    }
  }
  return null
}

/**
 * `location.hash` 文字列から slug を取り出す。`#foo` → `foo`、空 / `#` のみは null。
 */
export const slugFromHash = (hash: string): string | null => {
  if (!hash.startsWith('#')) {
    return null
  }
  const slug = hash.slice(1)
  if (slug.length === 0) {
    return null
  }
  return slug
}

/**
 * 起動時 / loadFromMarkdown 後、`location.hash` を参照して activePageIndex を解決する。
 * hash が空 / 不正 / 不一致なら先頭ページ (index 0) を返す
 * (mdxg-virtual-pages.md §7.4: hash が空 / 不正なら activePageIndex = 0)。
 */
export const resolveInitialActivePageIndex = (hash: string): number => {
  const slug = slugFromHash(hash)
  if (slug === null) {
    return 0
  }
  const page = findPageBySlug(slug)
  if (page === null) {
    return 0
  }
  return page.index
}

/**
 * activePageIndex を切り替える pure な mutation。
 * 既に active なページ / 範囲外 index なら false を返し、副作用を起こさない (idempotent)。
 * DOM 再描画 / hash 同期は呼び出し側が orchestrate する。
 */
export const setActivePageIndex = (index: number): boolean => {
  if (index < 0 || index >= state.pages.length) {
    return false
  }
  if (index === state.activePageIndex) {
    return false
  }
  state.activePageIndex = index
  return true
}

/**
 * 現在 activePage の slug を `#<slug>` 形式で `location.hash` にセットする。
 * 既に同じ hash なら何もしない (重複の history entry を作らない / 無限 hashchange を避ける)。
 */
export const syncHashFromActivePage = (): void => {
  const page = state.pages[state.activePageIndex]
  if (!page) {
    return
  }
  const desiredHash = `#${page.slug}`
  if (globalThis.location.hash === desiredHash) {
    return
  }
  globalThis.location.hash = desiredHash
}

// テスト用のダミー Page 生成 (overrides で必要なフィールドだけ上書きできる)。
// `if (import.meta.vitest)` 内に置くと unicorn/consistent-function-scoping に引っかかるため、
// mark-engine.ts の dummyComment と同じく module scope に置く (vite が test ブロックを
// dead-code 除去するため production bundle には残らない)。
const dummyPage = (overrides: Partial<Page> = {}): Page => ({
  depth: 1,
  headings: [],
  index: 0,
  markdown: '',
  slug: 'page',
  sourceLineStart: 1,
  title: 'Page',
  ...overrides,
})

if (import.meta.vitest) {
  const { afterEach, beforeEach, describe, expect, it } = import.meta.vitest

  // state.pages / activePageIndex はモジュール mutable shared object のため、
  // 各テストで保存・復元する (block-anchors / mark-engine の既存テストと同じ pattern)。
  let savedPages: Page[] = []
  let savedActiveIndex = 0
  beforeEach(() => {
    savedPages = state.pages
    savedActiveIndex = state.activePageIndex
  })
  afterEach(() => {
    state.pages = savedPages
    state.activePageIndex = savedActiveIndex
  })

  describe('slugFromHash', () => {
    it('`#foo` → `foo`', () => {
      expect(slugFromHash('#foo')).toBe('foo')
    })

    it('`#` 単体 / 空文字 / `foo` (prefix 無し) は null', () => {
      expect(slugFromHash('#')).toBeNull()
      expect(slugFromHash('')).toBeNull()
      expect(slugFromHash('foo')).toBeNull()
    })

    it('複数 # / underscore 含む slug もそのまま返す', () => {
      expect(slugFromHash('#page-1__section-a')).toBe('page-1__section-a')
    })
  })

  describe('findPageBySlug', () => {
    it('一致する slug の Page を返す', () => {
      state.pages = [
        dummyPage({ index: 0, slug: 'intro' }),
        dummyPage({ index: 1, slug: 'overview' }),
      ]
      const found = findPageBySlug('overview')
      expect(found).not.toBeNull()
      expect(found && found.index).toBe(1)
    })

    it('見つからなければ null', () => {
      state.pages = [dummyPage({ slug: 'intro' })]
      expect(findPageBySlug('missing')).toBeNull()
    })
  })

  describe('resolveInitialActivePageIndex', () => {
    it('hash が一致する slug を持てばその Page.index を返す', () => {
      state.pages = [
        dummyPage({ index: 0, slug: 'intro' }),
        dummyPage({ index: 1, slug: 'overview' }),
      ]
      expect(resolveInitialActivePageIndex('#overview')).toBe(1)
    })

    it('hash が空なら先頭ページ (0) にフォールバック', () => {
      state.pages = [dummyPage({ index: 0, slug: 'a' }), dummyPage({ index: 1, slug: 'b' })]
      expect(resolveInitialActivePageIndex('')).toBe(0)
    })

    it('hash slug が見つからなければ先頭ページ (0) にフォールバック', () => {
      state.pages = [dummyPage({ index: 0, slug: 'a' })]
      expect(resolveInitialActivePageIndex('#unknown')).toBe(0)
    })
  })

  describe('setActivePageIndex', () => {
    it('範囲内の別 index に切り替わると true', () => {
      state.pages = [dummyPage({ index: 0 }), dummyPage({ index: 1 })]
      state.activePageIndex = 0
      expect(setActivePageIndex(1)).toBe(true)
      expect(state.activePageIndex).toBe(1)
    })

    it('同じ index への切替は false (idempotent)', () => {
      state.pages = [dummyPage(), dummyPage({ index: 1 })]
      state.activePageIndex = 1
      expect(setActivePageIndex(1)).toBe(false)
      expect(state.activePageIndex).toBe(1)
    })

    it('範囲外 index は false', () => {
      state.pages = [dummyPage()]
      state.activePageIndex = 0
      expect(setActivePageIndex(-1)).toBe(false)
      expect(setActivePageIndex(2)).toBe(false)
      expect(state.activePageIndex).toBe(0)
    })
  })
}
