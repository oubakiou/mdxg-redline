// 検索件数表示の文字列生成。HTML bundle 専用 (CLI bundle には含めない)。
// `search.no_results` / `search.count_one|other` / `search.current_match` の 3 形式を切り替える。

import { translate, translatePlural } from '../i18n/i18n-browser'

/**
 * 件数表示用の文字列。null current は「件数のみ」、ヒット 0 は「No results」、
 * それ以外は「i of N」(MDXG §10 [SHOULD] の標準形式と一致)。
 */
export const formatMatchCount = (currentIndex: number | null, total: number): string => {
  if (total === 0) {
    return translate('search.no_results')
  }
  if (currentIndex === null) {
    return translatePlural({ baseKey: 'search.count', count: total, params: { total } })
  }
  return translate('search.current_match', { current: currentIndex + 1, total })
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('formatMatchCount', () => {
    it('total 0 は No results', () => {
      expect(formatMatchCount(null, 0)).toBe('No results')
      expect(formatMatchCount(0, 0)).toBe('No results')
    })

    it('current null + total 1 は単数形', () => {
      expect(formatMatchCount(null, 1)).toBe('1 match')
    })

    it('current null + total 2 以上は複数形', () => {
      expect(formatMatchCount(null, 3)).toBe('3 matches')
    })

    it('current 指定で「i of N」', () => {
      expect(formatMatchCount(0, 5)).toBe('1 of 5')
      expect(formatMatchCount(2, 5)).toBe('3 of 5')
    })
  })
}
