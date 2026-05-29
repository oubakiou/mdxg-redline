// §10 Search の pure ロジック。DOM 依存を持たず、case-insensitive substring match と
// current match のループ選択 / 件数表示文字列を提供する。app/search/search.ts が DOM 反映を担う。
//
// 設計判断:
// - `text.toLowerCase()` ベースの substring match を採用。ASCII / かな / カタカナ / 漢字 /
//   `prefers-color-scheme` 等の実用ケースで `text.toLowerCase().length === text.length` が
//   成り立つため、index は元 text 上の文字 index としてそのまま使える。`ß → ss` のような
//   長さが変わる locale-specific 変換が混ざる単語は仕様上同位置として扱えないが、本ツールの
//   レビュー対象 (日本語仕様書 / 英語コメント / コード) では発生しない前提で割り切る
// - 空 query は常に空配列 (UI 側で「クエリ無し → ハイライト消去」と整合させる)
// - オーバーラップマッチは含めない (`aaaa` を `aa` で検索 → 2 件、4 件ではない)。逐次移動と
//   ハイライト描画で「同じテキストに 2 重 mark」が起きないことを構造的に保つ
// - Unicode サロゲートペアを 1 文字としては扱わない (UTF-16 code unit ベース)。surrogate pair で
//   検索クエリが切れる病的ケースは UI 側で起きにくいので簡素な実装に倒す
// - 件数表示は「No results / N results / i of N」の 3 形式に正規化し、CSS i18n / 翻訳の
//   合流点を 1 関数に集約する

/** 1 マッチ。`[start, end)` の半開区間で `text` 上の 0-origin index を指す */
export interface MatchRange {
  end: number
  start: number
}

/** `haystack` を文書順に走査して non-overlapping match を全列挙する内部ループ */
const collectNonOverlappingMatches = (haystack: string, needle: string): MatchRange[] => {
  const matches: MatchRange[] = []
  let from = 0
  while (from <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, from)
    if (idx === -1) {
      break
    }
    matches.push({ end: idx + needle.length, start: idx })
    from = idx + needle.length
  }
  return matches
}

/**
 * `text` から `query` の case-insensitive substring match を全列挙する。
 * 空 query / 空 text は空配列。オーバーラップは含めない (`from = match.end` でループ)。
 */
export const findMatchesInText = (text: string, query: string): MatchRange[] => {
  if (query.length === 0 || text.length === 0) {
    return []
  }
  return collectNonOverlappingMatches(text.toLowerCase(), query.toLowerCase())
}

/**
 * 「次のマッチ」index を返す。末尾でループする。
 * `matchCount === 0` のときだけ null を返し、それ以外は 0 始まりの index を返す
 * (currentIndex が null の場合は 0 から始める = 検索バーに初めて入力した直後の挙動)。
 */
export const nextMatchIndex = (currentIndex: number | null, matchCount: number): number | null => {
  if (matchCount === 0) {
    return null
  }
  if (currentIndex === null) {
    return 0
  }
  return (currentIndex + 1) % matchCount
}

/**
 * 「前のマッチ」index を返す。先頭でループする。
 * `matchCount === 0` のとき null、`currentIndex` が null のときは末尾 (matchCount - 1) から始める。
 */
export const prevMatchIndex = (currentIndex: number | null, matchCount: number): number | null => {
  if (matchCount === 0) {
    return null
  }
  if (currentIndex === null) {
    return matchCount - 1
  }
  return (currentIndex - 1 + matchCount) % matchCount
}

/**
 * 件数表示用の文字列。null current は「件数のみ」、ヒット 0 は「No results」、
 * それ以外は「i of N」(MDXG §10 [SHOULD] の標準形式と一致)。
 */
export const formatMatchCount = (currentIndex: number | null, total: number): string => {
  if (total === 0) {
    return 'No results'
  }
  if (currentIndex === null) {
    if (total === 1) {
      return '1 match'
    }
    return `${total} matches`
  }
  return `${currentIndex + 1} of ${total}`
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('findMatchesInText', () => {
    it('case-insensitive で 1 文字以上のクエリにマッチする', () => {
      expect(findMatchesInText('The Quick Brown Fox', 'quick')).toEqual([{ end: 9, start: 4 }])
    })

    it('オーバーラップは含めない (aaaa を aa で検索 → 2 件)', () => {
      expect(findMatchesInText('aaaa', 'aa')).toEqual([
        { end: 2, start: 0 },
        { end: 4, start: 2 },
      ])
    })

    it('複数マッチを文書順に返す', () => {
      expect(findMatchesInText('foo bar foo baz foo', 'foo')).toEqual([
        { end: 3, start: 0 },
        { end: 11, start: 8 },
        { end: 19, start: 16 },
      ])
    })

    it('空クエリは空配列', () => {
      expect(findMatchesInText('hello', '')).toEqual([])
    })

    it('空 text は空配列', () => {
      expect(findMatchesInText('', 'foo')).toEqual([])
    })

    it('未ヒットは空配列', () => {
      expect(findMatchesInText('hello world', 'xyz')).toEqual([])
    })

    it('日本語の case 同一文字 (大文字 / 小文字概念無し) でもマッチする', () => {
      expect(findMatchesInText('検索バー実装', '検索')).toEqual([{ end: 2, start: 0 }])
    })

    it('クエリが text 末尾と一致する境界ケース', () => {
      expect(findMatchesInText('hello world', 'world')).toEqual([{ end: 11, start: 6 }])
    })

    it('text === query の完全一致は 1 件', () => {
      expect(findMatchesInText('foo', 'foo')).toEqual([{ end: 3, start: 0 }])
    })

    it('クエリが text より長ければ空配列', () => {
      expect(findMatchesInText('hi', 'hello')).toEqual([])
    })
  })

  describe('nextMatchIndex', () => {
    it('current null + 件数あり → 0', () => {
      expect(nextMatchIndex(null, 5)).toBe(0)
    })

    it('末尾でループして 0 に戻る', () => {
      expect(nextMatchIndex(4, 5)).toBe(0)
    })

    it('途中の current は +1', () => {
      expect(nextMatchIndex(2, 5)).toBe(3)
    })

    it('件数 0 は null', () => {
      expect(nextMatchIndex(null, 0)).toBeNull()
      expect(nextMatchIndex(0, 0)).toBeNull()
    })

    it('件数 1 は常に 0', () => {
      expect(nextMatchIndex(null, 1)).toBe(0)
      expect(nextMatchIndex(0, 1)).toBe(0)
    })
  })

  describe('prevMatchIndex', () => {
    it('current null + 件数あり → 末尾 (matchCount - 1)', () => {
      expect(prevMatchIndex(null, 5)).toBe(4)
    })

    it('先頭でループして末尾に戻る', () => {
      expect(prevMatchIndex(0, 5)).toBe(4)
    })

    it('途中の current は -1', () => {
      expect(prevMatchIndex(2, 5)).toBe(1)
    })

    it('件数 0 は null', () => {
      expect(prevMatchIndex(null, 0)).toBeNull()
      expect(prevMatchIndex(0, 0)).toBeNull()
    })

    it('件数 1 は常に 0', () => {
      expect(prevMatchIndex(null, 1)).toBe(0)
      expect(prevMatchIndex(0, 1)).toBe(0)
    })
  })

  describe('formatMatchCount', () => {
    it('total 0 は No results', () => {
      expect(formatMatchCount(null, 0)).toBe('No results')
      expect(formatMatchCount(0, 0)).toBe('No results')
    })

    it('current null + 件数 N (>1) は N matches', () => {
      expect(formatMatchCount(null, 5)).toBe('5 matches')
    })

    it('current null + 件数 1 は 1 match (単数形)', () => {
      expect(formatMatchCount(null, 1)).toBe('1 match')
    })

    it('current あり → 1-origin index で i of N', () => {
      expect(formatMatchCount(0, 5)).toBe('1 of 5')
      expect(formatMatchCount(4, 5)).toBe('5 of 5')
    })
  })
}
