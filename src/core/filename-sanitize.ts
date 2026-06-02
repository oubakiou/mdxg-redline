// mdFileName 部分のみに対する緩めサニタイズ。レビュー画面 / data-name の表示用途
// (docName) はサニタイズしない方針なので、ここで対象にするのは出力 HTML / feedback JSON の
// ファイル名 prefix を組み立てる値のみ。CLI (review-request) と browser (workspace.ts の
// resolveFeedbackFilename) で同じ命名規約 §8 を満たすため、core (env 非依存) に置く。
// - パス区切り (/, \) → _: 出力先ディレクトリ外への書き出しを構造的に防ぐ
// - 制御文字 (U+0000–U+001F / U+007F) → _: ファイル名として不正なバイト列を防ぐ
// - ファイル名全体が空 / "." / ".." → "_": ディレクトリ自身を指してしまうのを防ぐ
// - Windows 予約名 (CON / PRN / AUX / NUL / COM1-9 / LPT1-9、拡張子付きも対象) → 末尾 "_"
// それ以外 (日本語・空白・全角記号・"&", "'", "(" ...) はそのまま保持する。
export const sanitizeMdFileName = (name: string): string => {
  const cleaned = name.replace(/\p{Cc}/gu, '_').replace(/[\\/]/g, '_')
  if (cleaned === '' || cleaned === '.' || cleaned === '..') {
    return '_'
  }
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(cleaned)) {
    return `${cleaned}_`
  }
  return cleaned
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('sanitizeMdFileName', () => {
    it('普通の英数字 mdFileName はそのまま返す', () => {
      expect(sanitizeMdFileName('spec')).toBe('spec')
      expect(sanitizeMdFileName('part-1-pre-release')).toBe('part-1-pre-release')
    })

    it('日本語・空白・記号 (&, クォート等) は保持する', () => {
      expect(sanitizeMdFileName('仕様書 v2')).toBe('仕様書 v2')
      expect(sanitizeMdFileName(`My "report" & log`)).toBe(`My "report" & log`)
    })

    it('スラッシュとバックスラッシュは _ に置換する', () => {
      expect(sanitizeMdFileName('a/b')).toBe('a_b')
      expect(sanitizeMdFileName(String.raw`a\b`)).toBe('a_b')
    })

    it('パストラバーサルを試みる名前もスラッシュが _ になるだけ', () => {
      expect(sanitizeMdFileName(String.raw`..\..\etc\passwd`)).toBe('.._.._etc_passwd')
      expect(sanitizeMdFileName('../../etc/passwd')).toBe('.._.._etc_passwd')
    })

    it('空文字 / "." / ".." は _ に置き換える', () => {
      expect(sanitizeMdFileName('')).toBe('_')
      expect(sanitizeMdFileName('.')).toBe('_')
      expect(sanitizeMdFileName('..')).toBe('_')
    })

    it('Windows 予約名 (CON / PRN / AUX / NUL / COM1-9 / LPT1-9) は末尾に _ を付ける', () => {
      expect(sanitizeMdFileName('con')).toBe('con_')
      expect(sanitizeMdFileName('CON')).toBe('CON_')
      expect(sanitizeMdFileName('PRN')).toBe('PRN_')
      expect(sanitizeMdFileName('AUX')).toBe('AUX_')
      expect(sanitizeMdFileName('NUL')).toBe('NUL_')
      expect(sanitizeMdFileName('COM1')).toBe('COM1_')
      expect(sanitizeMdFileName('LPT9')).toBe('LPT9_')
    })

    it('Windows 予約名 + ドット拡張子 (例: con.txt) も予約扱い', () => {
      expect(sanitizeMdFileName('con.txt')).toBe('con.txt_')
    })

    it('予約名に似て見えても完全一致しなければそのまま', () => {
      expect(sanitizeMdFileName('congress')).toBe('congress')
      expect(sanitizeMdFileName('COM10')).toBe('COM10')
    })

    it('制御文字 (U+0000 / U+001F / U+007F) を _ に置換する', () => {
      expect(sanitizeMdFileName('a\x00b\x1Fc\x7Fd')).toBe('a_b_c_d')
    })
  })
}
