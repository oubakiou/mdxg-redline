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
 * 戻り値は composite hash (`page__heading`) 全体で、ページ部分と見出し部分の分離は
 * `parseHashSlug` で行う。
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
 * URL fragment の `<page-slug>__<heading-slug>` (mdxg-virtual-pages.md §6.4) を分解する。
 * - `#page` → `{ pageSlug: 'page', headingSlug: null }`
 * - `#page__heading` → `{ pageSlug: 'page', headingSlug: 'heading' }`
 * - 空 / `#` のみ → `{ pageSlug: null, headingSlug: null }`
 * `__` は最初に現れる位置で 1 度だけ分割する (slug は ASCII [a-z0-9-]+ なので underscore は
 * 通常含まれないが、念のため最初の `__` のみを区切りとして扱う)。
 */
export interface ParsedHash {
  headingSlug: string | null
  pageSlug: string | null
}

const nullIfEmpty = (text: string): string | null => {
  if (text.length === 0) {
    return null
  }
  return text
}

export const parseHashSlug = (hash: string): ParsedHash => {
  const raw = slugFromHash(hash)
  if (raw === null) {
    return { headingSlug: null, pageSlug: null }
  }
  const sepIndex = raw.indexOf('__')
  if (sepIndex === -1) {
    return { headingSlug: null, pageSlug: raw }
  }
  return {
    headingSlug: nullIfEmpty(raw.slice(sepIndex + 2)),
    pageSlug: raw.slice(0, sepIndex),
  }
}

/**
 * 起動時 / loadFromMarkdown 後、`location.hash` を参照して activePageIndex を解決する。
 * hash が空 / 不正 / 不一致なら先頭ページ (index 0) を返す
 * (mdxg-virtual-pages.md §7.4: hash が空 / 不正なら activePageIndex = 0)。
 * composite hash (`page__heading`) を渡しても page 部分だけで解決する。
 */
export const resolveInitialActivePageIndex = (hash: string): number => {
  const { pageSlug } = parseHashSlug(hash)
  if (pageSlug === null) {
    return 0
  }
  const page = findPageBySlug(pageSlug)
  if (page === null) {
    return 0
  }
  return page.index
}

/**
 * navigate target を hash から組み立てる helper。composite hash の page 部分は
 * `resolveInitialActivePageIndex` と完全に一致するロジックで解決し、heading 部分はそのまま渡す
 * (見つからなくても scroll しないだけなので解決時点では検証しない)。
 */
export interface NavigateTarget {
  headingSlug: string | null
  pageIndex: number
}

export const resolveTargetFromHash = (hash: string): NavigateTarget => {
  const { headingSlug, pageSlug } = parseHashSlug(hash)
  if (pageSlug === null) {
    return { headingSlug, pageIndex: 0 }
  }
  const page = findPageBySlug(pageSlug)
  if (page === null) {
    return { headingSlug, pageIndex: 0 }
  }
  return { headingSlug, pageIndex: page.index }
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

const buildHashString = (pageSlug: string, headingSlug: string | null): string => {
  if (headingSlug === null) {
    return `#${pageSlug}`
  }
  return `#${pageSlug}__${headingSlug}`
}

/**
 * 現在 activePage の slug を `#<slug>` (heading 指定があれば `#<slug>__<heading-slug>`) で
 * `location.hash` にセットする。
 * 既に同じ hash なら何もしない (重複の history entry を作らない / 無限 hashchange を避ける)。
 */
export const syncHashFromActivePage = (headingSlug: string | null = null): void => {
  const page = state.pages[state.activePageIndex]
  if (!page) {
    return
  }
  const desiredHash = buildHashString(page.slug, headingSlug)
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
  ancestorHeadingPath: [],
  depth: 1,
  headings: [],
  index: 0,
  markdown: '',
  slug: 'page',
  sourceLineEnd: 1,
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

  describe('parseHashSlug', () => {
    it('`#page` → page だけ取り出して heading は null', () => {
      expect(parseHashSlug('#overview')).toEqual({
        headingSlug: null,
        pageSlug: 'overview',
      })
    })

    it('`#page__heading` → page と heading に分解する', () => {
      expect(parseHashSlug('#overview__section-a')).toEqual({
        headingSlug: 'section-a',
        pageSlug: 'overview',
      })
    })

    it('`#page__` (空の heading) は heading=null', () => {
      expect(parseHashSlug('#page__')).toEqual({
        headingSlug: null,
        pageSlug: 'page',
      })
    })

    it('空 / `#` のみは両方 null', () => {
      expect(parseHashSlug('')).toEqual({ headingSlug: null, pageSlug: null })
      expect(parseHashSlug('#')).toEqual({ headingSlug: null, pageSlug: null })
    })

    it('最初の `__` だけを区切りに使う (slug は本来 underscore を含まないが念のため)', () => {
      expect(parseHashSlug('#a__b__c')).toEqual({
        headingSlug: 'b__c',
        pageSlug: 'a',
      })
    })
  })

  describe('resolveTargetFromHash', () => {
    it('composite hash から page index と heading slug を解決', () => {
      state.pages = [
        dummyPage({ index: 0, slug: 'intro' }),
        dummyPage({ index: 1, slug: 'overview' }),
      ]
      expect(resolveTargetFromHash('#overview__section-b')).toEqual({
        headingSlug: 'section-b',
        pageIndex: 1,
      })
    })

    it('page slug 不一致でも heading slug は保持しページは 0 にフォールバック', () => {
      state.pages = [dummyPage({ index: 0, slug: 'intro' })]
      expect(resolveTargetFromHash('#missing__heading-x')).toEqual({
        headingSlug: 'heading-x',
        pageIndex: 0,
      })
    })

    it('hash 空なら page=0 / heading=null', () => {
      state.pages = [dummyPage({ index: 0, slug: 'a' })]
      expect(resolveTargetFromHash('')).toEqual({ headingSlug: null, pageIndex: 0 })
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
