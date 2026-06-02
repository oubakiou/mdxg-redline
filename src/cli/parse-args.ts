// review-request CLI の引数パース entry point。
// help / clean / run の振り分け (dispatch) だけを担い、各 mode の partition / build は
// parse-clean-args.ts / parse-run-args.ts に委譲する。flag 定数 / value parser / 結果型は
// arg-spec.ts、HELP_TEXT は help-text.ts に分離。
// ファイル名サニタイズは CLI / browser 両側で共有するため src/core/filename-sanitize.ts へ移した。

import { CLEAN_FLAG, HELP_FLAGS, type ParsedArgs } from './arg-spec'
import { parseCleanArgs } from './parse-clean-args'
import { parseRunArgs } from './parse-run-args'

export { HELP_TEXT } from './help-text'
export {
  type CleanArgsParsed,
  type MathFontsMode,
  type MathMode,
  type MermaidMode,
  type ParsedArgs,
  type RunArgs,
  type ShikiLangsMode,
  type ThemeHint,
  parseCommentsWidthValue,
  parseMathFontsValue,
  parseMathValue,
  parseMermaidValue,
  parsePageNavWidthValue,
  parseShikiLangsValue,
} from './arg-spec'

// 引数なし or -h / --help は help モード（他の引数が混じっていても help を最優先する）。
// --clean を含むなら clean モードのパースに委譲、それ以外は run モードのパースに委譲する。
export const parseArgs = (argv: readonly string[]): ParsedArgs => {
  if (argv.length === 0) {
    return { mode: 'help' }
  }
  if (argv.some((token): boolean => HELP_FLAGS.has(token))) {
    return { mode: 'help' }
  }
  if (argv.includes(CLEAN_FLAG)) {
    return parseCleanArgs(argv)
  }
  return parseRunArgs(argv)
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('parseArgs: help モード', () => {
    it('引数なしは help モード', () => {
      expect(parseArgs([])).toEqual({ mode: 'help' })
    })

    it('--help は help モード', () => {
      expect(parseArgs(['--help'])).toEqual({ mode: 'help' })
    })

    it('-h も help モード', () => {
      expect(parseArgs(['-h'])).toEqual({ mode: 'help' })
    })

    it('--help は他の引数より優先される', () => {
      expect(parseArgs(['spec.md', '--help'])).toEqual({ mode: 'help' })
      expect(parseArgs(['--clean', '/tmp/x', '--help'])).toEqual({ mode: 'help' })
    })
  })

  // dispatch の配線確認。run / clean の詳細なパース挙動は parse-run-args.ts /
  // parse-clean-args.ts の in-source test が担うため、ここでは振り分け先が正しいことだけ見る。
  describe('parseArgs: dispatch', () => {
    it('位置引数のみは run モードに振り分ける', () => {
      expect(parseArgs(['spec.md'])).toEqual({ inputPath: 'spec.md', mode: 'run', open: true })
    })

    it('--clean を含むと clean モードに振り分ける', () => {
      const parsed = parseArgs(['--clean', '/tmp/x'])
      expect(parsed.mode).toBe('clean')
      if (parsed.mode === 'clean') {
        expect(parsed.dir).toBe('/tmp/x')
      }
    })

    it('run モードの invalid は素通しする', () => {
      expect(parseArgs(['--unknown', 'spec.md'])).toEqual({ mode: 'invalid' })
    })

    it('clean モードの invalid は素通しする', () => {
      expect(parseArgs(['--clean', '/tmp/x', '--no-open'])).toEqual({ mode: 'invalid' })
    })
  })
}
