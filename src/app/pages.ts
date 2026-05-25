// 仮想ページの選択状態と URL hash 同期を担当する pure-ish モジュール。
// DOM の再描画は呼び出し側 (review.ts) が orchestrate する責務分担にしており、
// 本モジュールは state.activePageIndex の mutation と hash <-> slug の解決のみを行う。
//
// 設計判断:
// - History API は使わず `location.hash` への代入だけで履歴を管理する (mdxg-virtual-pages.archive.md §7.4)
// - hash が空 / 不正なら先頭ページ (index 0) にフォールバックする (mdxg-virtual-pages.archive.md §7.4:
//   「hash が空 / 不正な場合は activePageIndex = 0」)。これにより初期ロードとブラウザ戻る /
//   進むで観測される挙動が一致する (URL = 表示状態の正準)。
// - hash の slug が `state.pages` のどれにも一致しない場合は同じく 0 にフォールバックする。
//   docHash が変わると以前の slug が失効する想定 (mdxg-virtual-pages.archive.md §13.2) で、
//   失効リンクは「先頭ページに戻る」のが最も穏当な挙動

import type { Page } from '../core/page-split'
import { state } from './app-state'

/**
 * page slug 専用の hash prefix。`#p:<pageSlug>` の形で名前空間化することで、heading id
 * (markdown 内の `## 1.` 等から派生する `id="1"` 等) と URL fragment が衝突するのを防ぐ。
 *
 * Stacked View は全 page の section と全 H3–H6 を同じ doc 内に並べるため、ブラウザの
 * デフォルト anchor scroll (`href="#1"` → `id="1"` 要素にジャンプ) が走ると意図しない
 * heading に飛ぶ事故が起きうる。click 側の `preventDefault` (page-navigation.ts) と組で
 * 多重防御する。
 */
const PAGE_HASH_PREFIX = 'p:'

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
 * `location.hash` 文字列から「prefix 剥がし後の slug 部分」を取り出す。
 * - `#p:foo` → `foo`
 * - `#foo` (prefix 無し) / `#` 単体 / 空文字 → null
 *
 * 戻り値は composite hash (`page__heading`) 全体で、ページ部分と見出し部分の分離は
 * `parseHashSlug` で行う。
 */
export const slugFromHash = (hash: string): string | null => {
  if (!hash.startsWith('#')) {
    return null
  }
  const raw = hash.slice(1)
  if (!raw.startsWith(PAGE_HASH_PREFIX)) {
    return null
  }
  const stripped = raw.slice(PAGE_HASH_PREFIX.length)
  if (stripped.length === 0) {
    return null
  }
  return stripped
}

/**
 * page-navigation や Sequential row の `href` / `data-slug` に乗せる fragment 文字列を組み立てる
 * (先頭 `#` 抜き)。caller 側は `href="#${buildPageHashFragment(...)}"` の形で埋め込む。
 */
export const buildPageHashFragment = (
  pageSlug: string,
  headingSlug: string | null = null
): string => {
  if (headingSlug === null) {
    return `${PAGE_HASH_PREFIX}${pageSlug}`
  }
  return `${PAGE_HASH_PREFIX}${pageSlug}__${headingSlug}`
}

/**
 * `hash` が page-navigation 用の名前空間化された hash (`#p:...`) かを判定する。
 *
 * 本文内 markdown anchor (`[x](#some-heading)`) のクリックや手動 hash 編集で発火する
 * prefix なし hash は、ブラウザのデフォルト anchor scroll で当該 id 要素にジャンプするだけで
 * 十分なので、`navigateToTarget` には流さない (流すと `pageIndex: 0` フォールバックで意図せず
 * 先頭ページに飛ぶ UX 回帰になる)。
 *
 * 空 hash (`""` / `"#"`) も「page hash ではない」扱いで、hashchange 時の navigate からは外す。
 * 初期ロード時の hash 解決は `resolveTargetFromHash` / `resolveInitialActivePageIndex` が
 * 直接ハンドルする (空なら page 0 フォールバック)。
 */
export const isPageHash = (hash: string): boolean => hash.startsWith(`#${PAGE_HASH_PREFIX}`)

/**
 * URL fragment の `<page-slug>__<heading-slug>` (mdxg-virtual-pages.archive.md §6.4) を分解する。
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
 * (mdxg-virtual-pages.archive.md §7.4: hash が空 / 不正なら activePageIndex = 0)。
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

const buildHashString = (pageSlug: string, headingSlug: string | null): string =>
  `#${buildPageHashFragment(pageSlug, headingSlug)}`

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
    it('`#p:foo` → `foo` (prefix 剥がし)', () => {
      expect(slugFromHash('#p:foo')).toBe('foo')
    })

    it('`#foo` (prefix 無し) は null (page hash として無効)', () => {
      expect(slugFromHash('#foo')).toBeNull()
    })

    it('`#` 単体 / 空文字 / `p:foo` (`#` 無し) は null', () => {
      expect(slugFromHash('#')).toBeNull()
      expect(slugFromHash('')).toBeNull()
      expect(slugFromHash('p:foo')).toBeNull()
    })

    it('`#p:` (prefix 直後が空) は null', () => {
      expect(slugFromHash('#p:')).toBeNull()
    })

    it('prefix 剥がし後の slug 内の underscore は維持する (composite hash 用)', () => {
      expect(slugFromHash('#p:page-1__section-a')).toBe('page-1__section-a')
    })
  })

  describe('parseHashSlug', () => {
    it('`#p:page` → page だけ取り出して heading は null', () => {
      expect(parseHashSlug('#p:overview')).toEqual({
        headingSlug: null,
        pageSlug: 'overview',
      })
    })

    it('`#p:page__heading` → page と heading に分解する', () => {
      expect(parseHashSlug('#p:overview__section-a')).toEqual({
        headingSlug: 'section-a',
        pageSlug: 'overview',
      })
    })

    it('`#p:page__` (空の heading) は heading=null', () => {
      expect(parseHashSlug('#p:page__')).toEqual({
        headingSlug: null,
        pageSlug: 'page',
      })
    })

    it('`#overview` (prefix 無し) は両方 null (heading id 衝突回避)', () => {
      expect(parseHashSlug('#overview')).toEqual({ headingSlug: null, pageSlug: null })
    })

    it('空 / `#` のみは両方 null', () => {
      expect(parseHashSlug('')).toEqual({ headingSlug: null, pageSlug: null })
      expect(parseHashSlug('#')).toEqual({ headingSlug: null, pageSlug: null })
    })

    it('最初の `__` だけを区切りに使う (slug は本来 underscore を含まないが念のため)', () => {
      expect(parseHashSlug('#p:a__b__c')).toEqual({
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
      expect(resolveTargetFromHash('#p:overview__section-b')).toEqual({
        headingSlug: 'section-b',
        pageIndex: 1,
      })
    })

    it('page slug 不一致でも heading slug は保持しページは 0 にフォールバック', () => {
      state.pages = [dummyPage({ index: 0, slug: 'intro' })]
      expect(resolveTargetFromHash('#p:missing__heading-x')).toEqual({
        headingSlug: 'heading-x',
        pageIndex: 0,
      })
    })

    it('prefix 無し hash も page=0 にフォールバック (heading は heading-id 経由でブラウザが扱う想定)', () => {
      state.pages = [dummyPage({ index: 0, slug: 'a' })]
      expect(resolveTargetFromHash('#legacy')).toEqual({ headingSlug: null, pageIndex: 0 })
    })

    it('hash 空なら page=0 / heading=null', () => {
      state.pages = [dummyPage({ index: 0, slug: 'a' })]
      expect(resolveTargetFromHash('')).toEqual({ headingSlug: null, pageIndex: 0 })
    })
  })

  describe('buildPageHashFragment', () => {
    it('heading 指定なしは prefix + page slug', () => {
      expect(buildPageHashFragment('overview')).toBe('p:overview')
    })

    it('heading 指定ありは __ 区切りの composite fragment', () => {
      expect(buildPageHashFragment('overview', 'section-a')).toBe('p:overview__section-a')
    })

    it('null を明示的に渡しても heading 指定なしと同じ', () => {
      expect(buildPageHashFragment('a', null)).toBe('p:a')
    })
  })

  describe('isPageHash', () => {
    it('`#p:` で始まる hash は true', () => {
      expect(isPageHash('#p:overview')).toBe(true)
      expect(isPageHash('#p:overview__section-a')).toBe(true)
    })

    it('prefix 無し hash は false (本文内 markdown anchor 等は navigate しない)', () => {
      expect(isPageHash('#overview')).toBe(false)
      expect(isPageHash('#1')).toBe(false)
      expect(isPageHash('#some-heading')).toBe(false)
    })

    it('空 / `#` 単体は false (hashchange での navigate からも外す)', () => {
      expect(isPageHash('')).toBe(false)
      expect(isPageHash('#')).toBe(false)
    })

    it('prefix が中途半端な値も false', () => {
      expect(isPageHash('#p')).toBe(false)
      expect(isPageHash('p:foo')).toBe(false)
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
      expect(resolveInitialActivePageIndex('#p:overview')).toBe(1)
    })

    it('hash が空なら先頭ページ (0) にフォールバック', () => {
      state.pages = [dummyPage({ index: 0, slug: 'a' }), dummyPage({ index: 1, slug: 'b' })]
      expect(resolveInitialActivePageIndex('')).toBe(0)
    })

    it('hash slug が見つからなければ先頭ページ (0) にフォールバック', () => {
      state.pages = [dummyPage({ index: 0, slug: 'a' })]
      expect(resolveInitialActivePageIndex('#p:unknown')).toBe(0)
    })

    it('prefix 無し hash も先頭ページ (0) にフォールバック', () => {
      state.pages = [dummyPage({ index: 0, slug: 'a' })]
      expect(resolveInitialActivePageIndex('#legacy')).toBe(0)
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
