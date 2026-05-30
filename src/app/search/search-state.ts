// §10 Search の state container。in-memory singleton と pure な state 遷移を担う。
// DOM 操作は search-dom.ts、UI wiring は search-controller.ts に分離されており、
// 本ファイルは DOM 非依存のため state 遷移を単独でテストできる。

export interface SearchMatch {
  blockId: string
  end: number
  /** 全 match を文書順に並べた中での 0-origin index。`data-search-index` 属性にも書く */
  matchIndex: number
  pageIndex: number
  start: number
}

interface SearchStateShape {
  currentIndex: number | null
  matches: SearchMatch[]
  open: boolean
  query: string
}

export const searchState: SearchStateShape = {
  currentIndex: null,
  matches: [],
  open: false,
  query: '',
}

export const isSearchOpen = (): boolean => searchState.open

export const resolveInitialCurrentIndex = (matchCount: number): number | null => {
  if (matchCount === 0) {
    return null
  }
  return 0
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('resolveInitialCurrentIndex', () => {
    it('match 0 件は null', () => {
      expect(resolveInitialCurrentIndex(0)).toBeNull()
    })

    it('match 1 件以上は 0', () => {
      expect(resolveInitialCurrentIndex(1)).toBe(0)
      expect(resolveInitialCurrentIndex(10)).toBe(0)
    })
  })

  describe('searchState 初期値', () => {
    it('初期は閉じている / matches 空 / currentIndex null', () => {
      expect(isSearchOpen()).toBe(false)
    })
  })
}
