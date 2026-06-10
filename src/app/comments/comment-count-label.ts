// コメント件数のラベル生成。HTML bundle 専用 (CLI bundle には含めない)。
// translatePlural 経由で `comments.count_label_zero/one/other` を引く。

import { translatePlural } from '../i18n/i18n-browser'

export const commentCountLabel = (count: number): string =>
  translatePlural({ baseKey: 'comments.count_label', count })

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('commentCountLabel', () => {
    it('1 件のときは _one (単数形)', () => {
      expect(commentCountLabel(1)).toBe('1 comment')
    })

    it('0 件のときは _zero', () => {
      expect(commentCountLabel(0)).toBe('0 comments')
    })

    it('複数のときは _other', () => {
      expect(commentCountLabel(3)).toBe('3 comments')
    })
  })
}
