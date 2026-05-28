// ファイル命名規約 §8 で定義する `<mdFileName>-<docHash>-{review.html,feedback.json}` の組み立て。

/**
 * MD ファイル名から `.md` / `.markdown` 拡張子を除いた basename を返す。
 * 大文字小文字無視。拡張子が無いファイル名はそのまま返す。
 * ファイル命名規約 §8 の `mdFileName` 部分を組み立てるベース。
 */
export const stripMarkdownExt = (filename: string): string =>
  filename.replace(/\.(?:markdown|md)$/i, '')

/** ファイル命名規約 §8 に従って配布用 HTML のファイル名を組み立てる */
export const deriveReviewHtmlName = (mdFileName: string, docHash: string): string =>
  `${mdFileName}-${docHash}-review.html`

/** ファイル命名規約 §8 に従って人間→エージェント方向の JSON ファイル名を組み立てる */
export const deriveFeedbackJsonName = (mdFileName: string, docHash: string): string =>
  `${mdFileName}-${docHash}-feedback.json`

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('stripMarkdownExt', () => {
    it('.md 拡張子を除去する', () => {
      expect(stripMarkdownExt('spec.md')).toBe('spec')
    })

    it('.markdown 拡張子を除去する', () => {
      expect(stripMarkdownExt('spec.markdown')).toBe('spec')
    })

    it('大文字拡張子 (.MD / .Markdown) も除去する', () => {
      expect(stripMarkdownExt('spec.MD')).toBe('spec')
      expect(stripMarkdownExt('Notes.Markdown')).toBe('Notes')
    })

    it('拡張子が無い場合はそのまま返す', () => {
      expect(stripMarkdownExt('README')).toBe('README')
    })

    it('複数ドットがあっても最後の md/markdown 拡張子だけ除く', () => {
      expect(stripMarkdownExt('foo.bar.md')).toBe('foo.bar')
    })

    it('日本語・スペースを含むファイル名もそのまま basename として保持する', () => {
      expect(stripMarkdownExt('仕様書 v2.md')).toBe('仕様書 v2')
    })

    it('.txt のような関係ない拡張子は除去しない', () => {
      expect(stripMarkdownExt('notes.txt')).toBe('notes.txt')
    })
  })

  describe('deriveReviewHtmlName / deriveFeedbackJsonName', () => {
    it('HTML / JSON のファイル名を命名規約どおりに組み立てる', () => {
      expect(deriveReviewHtmlName('spec', 'a1b2c3d4e5f6a7b8')).toBe(
        'spec-a1b2c3d4e5f6a7b8-review.html'
      )
      expect(deriveFeedbackJsonName('spec', 'a1b2c3d4e5f6a7b8')).toBe(
        'spec-a1b2c3d4e5f6a7b8-feedback.json'
      )
    })

    it('日本語 mdFileName でもそのまま埋め込む（サニタイズしない）', () => {
      expect(deriveReviewHtmlName('仕様書 v2', 'a1b2c3d4e5f6a7b8')).toBe(
        '仕様書 v2-a1b2c3d4e5f6a7b8-review.html'
      )
    })
  })
}
