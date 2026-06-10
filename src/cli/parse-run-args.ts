// run モード (`<input.md|-> [output-dir]` + 各種フラグ) の引数パース。
// state machine primitive は flag-parser.ts に切り出し、本ファイルは
// reduce orchestrator と PartitionedArgs / RunArgs への詰め替えのみを担う。

import type {
  MathFontsMode,
  MathMode,
  MermaidMode,
  ParsedArgs,
  RunArgs,
  ShikiLangsMode,
  ThemeHint,
} from './arg-spec'
import {
  INITIAL_PARTITION_STATE,
  type PartitionState,
  finalizePartitionState,
  isPartitionValid,
  stepArg,
} from './flag-parser'
import { translateCli } from './i18n'

interface PartitionedArgs {
  documentName?: string
  /** flag-parser が組み立てた失敗 context。invalid 経路でのみ stderr に出す。 */
  error?: string
  markdownCssPath?: string
  math?: MathMode
  mathFonts?: MathFontsMode
  mermaid?: MermaidMode
  open: boolean
  pageNavWidth?: number
  positional: readonly string[]
  shikiLangs?: ShikiLangsMode
  commentsWidth?: number
  themeHint?: ThemeHint
  showOpenFile: boolean
  showPasteMarkdown: boolean
  valid: boolean
}

// optional フィールドを「定義されていれば代入」する generic helper。`null` (partition state 側で
// 未指定を表す) と `undefined` (run 側 PartitionedArgs で未指定を表す) を一括で弾く。
const attachIfPresent = <Target, Key extends keyof Target>(
  result: Target,
  key: Key,
  value: Target[Key] | null | undefined
): void => {
  if (value === null || typeof value === 'undefined') {
    return
  }
  result[key] = value
}

const attachPartitionOptionals = (result: PartitionedArgs, state: PartitionState): void => {
  attachIfPresent(result, 'documentName', state.documentName)
  attachIfPresent(result, 'themeHint', state.themeHint)
  attachIfPresent(result, 'shikiLangs', state.shikiLangs)
  attachIfPresent(result, 'markdownCssPath', state.markdownCssPath)
  attachIfPresent(result, 'mermaid', state.mermaid)
  attachIfPresent(result, 'math', state.math)
  attachIfPresent(result, 'mathFonts', state.mathFonts)
  attachIfPresent(result, 'commentsWidth', state.commentsWidth)
  attachIfPresent(result, 'pageNavWidth', state.pageNavWidth)
}

const partitionArgs = (argv: readonly string[]): PartitionedArgs => {
  const state = finalizePartitionState(
    argv.reduce<PartitionState>(stepArg, INITIAL_PARTITION_STATE)
  )
  const result: PartitionedArgs = {
    open: state.open,
    positional: state.positional,
    showOpenFile: state.showOpenFile,
    showPasteMarkdown: state.showPasteMarkdown,
    valid: isPartitionValid(state),
  }
  if (state.error !== null) {
    result.error = state.error
  }
  attachPartitionOptionals(result, state)
  return result
}

const attachRunOptionals = (result: { mode: 'run' } & RunArgs, parts: PartitionedArgs): void => {
  attachIfPresent(result, 'outputDir', parts.positional[1])
  attachIfPresent(result, 'documentName', parts.documentName)
  attachIfPresent(result, 'themeHint', parts.themeHint)
  attachIfPresent(result, 'markdownCssPath', parts.markdownCssPath)
  attachIfPresent(result, 'shikiLangs', parts.shikiLangs)
  attachIfPresent(result, 'commentsWidth', parts.commentsWidth)
  attachIfPresent(result, 'pageNavWidth', parts.pageNavWidth)
  attachIfPresent(result, 'mermaid', parts.mermaid)
  attachIfPresent(result, 'math', parts.math)
  attachIfPresent(result, 'mathFonts', parts.mathFonts)
}

const buildRunArgs = (parts: PartitionedArgs): { mode: 'run' } & RunArgs => {
  const [inputPath] = parts.positional
  const result: { mode: 'run' } & RunArgs = {
    inputPath,
    mode: 'run',
    open: parts.open,
  }
  if (parts.showOpenFile) {
    result.showOpenFile = true
  }
  if (parts.showPasteMarkdown) {
    result.showPasteMarkdown = true
  }
  attachRunOptionals(result, parts)
  return result
}

const invalid = (error?: string): ParsedArgs => {
  if (typeof error === 'undefined') {
    return { mode: 'invalid' }
  }
  return { error, mode: 'invalid' }
}

const formatPositionalError = (count: number): string => {
  if (count === 0) {
    return translateCli('cli.error.missing_input_markdown')
  }
  return translateCli('cli.error.too_many_positional_args', { count })
}

// 位置引数 (<input.md|->, [output-dir]) と --no-open / --document-name 等を混在順序で受け付ける。
// 未知フラグ・位置引数の個数違反・値欠落は invalid。help / clean の振り分けは parse-args.ts が先に行う。
export const parseRunArgs = (argv: readonly string[]): ParsedArgs => {
  const parts = partitionArgs(argv)
  if (!parts.valid) {
    return invalid(parts.error)
  }
  if (parts.positional.length < 1 || parts.positional.length > 2) {
    return invalid(formatPositionalError(parts.positional.length))
  }
  return buildRunArgs(parts)
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  // describe 内の `it` 数が ESLint の max-statements (10) を超えないよう、
  // 期待モード単位で sub-describe に分割している。判別共用体の `mode` フィールドを
  // expected に含めることで run / invalid の取り違えを防ぐ。`toEqual` は欠落
  // プロパティ (outputDir / documentName) を `undefined` と同一視するため、未指定ケースは
  // expected から省略している。
  describe('parseRunArgs: run モード', () => {
    it('input.md 単独で run モード / open=true / outputDir 未指定を返す', () => {
      expect(parseRunArgs(['spec.md'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
      })
    })

    it('input.md と output-dir で run モードを返す', () => {
      expect(parseRunArgs(['spec.md', '/tmp/out'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
        outputDir: '/tmp/out',
      })
    })

    it('--no-open フラグで open=false になる', () => {
      expect(parseRunArgs(['--no-open', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: false,
      })
    })

    it('--no-open が引数の後ろに来ても認識する', () => {
      expect(parseRunArgs(['spec.md', '--no-open'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: false,
      })
    })

    it('--no-open が位置引数の間に来ても認識する', () => {
      expect(parseRunArgs(['spec.md', '--no-open', '/tmp/out'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: false,
        outputDir: '/tmp/out',
      })
    })

    it('input が `-` の場合は stdin token として run モードを返す', () => {
      expect(parseRunArgs(['-'])).toEqual({
        inputPath: '-',
        mode: 'run',
        open: true,
      })
    })
  })

  describe('parseRunArgs: --document-name', () => {
    it('--document-name で docName を上書きできる', () => {
      expect(parseRunArgs(['--document-name', 'override.md', 'spec.md'])).toEqual({
        documentName: 'override.md',
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
      })
    })

    it('--document-name と --no-open / output-dir を組み合わせられる', () => {
      expect(parseRunArgs(['--no-open', '--document-name', 'a.md', 'spec.md', '/tmp/out'])).toEqual(
        {
          documentName: 'a.md',
          inputPath: 'spec.md',
          mode: 'run',
          open: false,
          outputDir: '/tmp/out',
        }
      )
    })

    it('--document-name が末尾にあって値が無い場合は invalid', () => {
      expect(parseRunArgs(['spec.md', '--document-name'])).toMatchObject({ mode: 'invalid' })
    })

    it('--document-name の値位置に別フラグが来た場合は invalid', () => {
      expect(parseRunArgs(['--document-name', '--no-open', 'spec.md'])).toMatchObject({
        mode: 'invalid',
      })
    })
  })

  describe('parseRunArgs: --show-open-file', () => {
    it('--show-open-file 指定で showOpenFile=true を返す', () => {
      expect(parseRunArgs(['--show-open-file', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
        showOpenFile: true,
      })
    })

    it('--show-open-file 未指定では showOpenFile を含まない (= 既定 hidden)', () => {
      const result = parseRunArgs(['spec.md'])
      expect(result).toEqual({ inputPath: 'spec.md', mode: 'run', open: true })
      if (result.mode === 'run') {
        expect(result.showOpenFile).toBeUndefined()
      }
    })

    it('--show-open-file は --no-open / output-dir と組み合わせられる', () => {
      expect(parseRunArgs(['--no-open', '--show-open-file', 'spec.md', '/tmp/out'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: false,
        outputDir: '/tmp/out',
        showOpenFile: true,
      })
    })
  })

  describe('parseRunArgs: --show-paste-markdown', () => {
    it('--show-paste-markdown 指定で showPasteMarkdown=true を返す', () => {
      expect(parseRunArgs(['--show-paste-markdown', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
        showPasteMarkdown: true,
      })
    })

    it('--show-paste-markdown 未指定では showPasteMarkdown を含まない (= 既定 hidden)', () => {
      const result = parseRunArgs(['spec.md'])
      expect(result).toEqual({ inputPath: 'spec.md', mode: 'run', open: true })
      if (result.mode === 'run') {
        expect(result.showPasteMarkdown).toBeUndefined()
      }
    })

    it('--show-open-file と --show-paste-markdown は同時指定できる', () => {
      expect(parseRunArgs(['--show-open-file', '--show-paste-markdown', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
        showOpenFile: true,
        showPasteMarkdown: true,
      })
    })
  })

  describe('parseRunArgs: invalid モード', () => {
    it('--no-open だけで位置引数がない場合は invalid', () => {
      expect(parseRunArgs(['--no-open'])).toMatchObject({ mode: 'invalid' })
    })

    it('位置引数が 3 個以上は invalid', () => {
      expect(parseRunArgs(['a.md', 'b', 'c'])).toMatchObject({ mode: 'invalid' })
    })

    it('未知のフラグは invalid', () => {
      expect(parseRunArgs(['--unknown', 'spec.md'])).toMatchObject({ mode: 'invalid' })
    })
  })

  describe('parseRunArgs: --theme', () => {
    it('--theme system / light / dark がパースされる', () => {
      expect(parseRunArgs(['--theme', 'system', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
        themeHint: 'system',
      })
      expect(parseRunArgs(['--theme', 'light', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
        themeHint: 'light',
      })
      expect(parseRunArgs(['--theme', 'dark', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
        themeHint: 'dark',
      })
    })

    it('--theme が末尾にあって値が無い場合は invalid', () => {
      expect(parseRunArgs(['spec.md', '--theme'])).toMatchObject({ mode: 'invalid' })
    })

    it('--theme の値位置に別フラグが来た場合は invalid', () => {
      expect(parseRunArgs(['--theme', '--no-open', 'spec.md'])).toMatchObject({ mode: 'invalid' })
    })

    it('--theme の値が許容外 (auto / 空文字 / 大文字) は invalid', () => {
      expect(parseRunArgs(['--theme', 'auto', 'spec.md'])).toMatchObject({ mode: 'invalid' })
      expect(parseRunArgs(['--theme', '', 'spec.md'])).toMatchObject({ mode: 'invalid' })
      expect(parseRunArgs(['--theme', 'Dark', 'spec.md'])).toMatchObject({ mode: 'invalid' })
    })

    it('--theme 未指定時は themeHint が含まれない (data-theme 属性は付かない)', () => {
      expect(parseRunArgs(['spec.md'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
      })
    })

    it('--theme と他のフラグ・位置引数の組み合わせも認識する', () => {
      expect(
        parseRunArgs([
          '--no-open',
          '--theme',
          'dark',
          '--document-name',
          'override.md',
          'spec.md',
          '/tmp/out',
        ])
      ).toEqual({
        documentName: 'override.md',
        inputPath: 'spec.md',
        mode: 'run',
        open: false,
        outputDir: '/tmp/out',
        themeHint: 'dark',
      })
    })
  })

  describe('parseRunArgs: --shiki-langs', () => {
    it('--shiki-langs auto / all / none が認識される', () => {
      expect(parseRunArgs(['--shiki-langs', 'auto', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
        shikiLangs: { kind: 'auto' },
      })
      expect(parseRunArgs(['--shiki-langs', 'all', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
        shikiLangs: { kind: 'all' },
      })
      expect(parseRunArgs(['--shiki-langs', 'none', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
        shikiLangs: { kind: 'none' },
      })
    })

    it('--shiki-langs ts,js が list として認識される (エイリアス正規化)', () => {
      const parsed = parseRunArgs(['--shiki-langs', 'ts,js', 'spec.md'])
      expect(parsed.mode).toBe('run')
      if (parsed.mode === 'run' && parsed.shikiLangs && parsed.shikiLangs.kind === 'list') {
        expect([...parsed.shikiLangs.langs].toSorted()).toEqual(['javascript', 'typescript'])
      }
    })

    it('--shiki-langs が末尾にあって値が無い場合は invalid', () => {
      expect(parseRunArgs(['spec.md', '--shiki-langs'])).toMatchObject({ mode: 'invalid' })
    })

    it('--shiki-langs の値位置に別フラグが来た場合は invalid', () => {
      expect(parseRunArgs(['--shiki-langs', '--no-open', 'spec.md'])).toMatchObject({
        mode: 'invalid',
      })
    })

    it('--shiki-langs 未指定時は shikiLangs が含まれない', () => {
      expect(parseRunArgs(['spec.md'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
      })
    })

    // arg-spec.ts の parseShikiLangsValue は仕様上 null を返さず、未サポート言語のみの入力でも
    // 空 list (= none と等価) を成功として返す。他 value flag (e.g. --theme) では invalid に
    // 落ちるところを silent-drop に降格する設計上の非対称性を regression として固定する。
    it('--shiki-langs に未サポート識別子のみを渡しても silent-drop で run モード扱い', () => {
      expect(parseRunArgs(['--shiki-langs', 'mylang,xxx-fake', 'spec.md'])).toMatchObject({
        inputPath: 'spec.md',
        mode: 'run',
        shikiLangs: { kind: 'list' },
      })
      const parsed = parseRunArgs(['--shiki-langs', 'mylang,xxx-fake', 'spec.md'])
      if (parsed.mode === 'run' && parsed.shikiLangs && parsed.shikiLangs.kind === 'list') {
        expect(parsed.shikiLangs.langs.size).toBe(0)
      }
    })
  })

  describe('parseRunArgs: --mermaid', () => {
    it('--mermaid auto / on / off が認識される', () => {
      expect(parseRunArgs(['--mermaid', 'auto', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        mermaid: 'auto',
        mode: 'run',
        open: true,
      })
      expect(parseRunArgs(['--mermaid', 'on', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        mermaid: 'on',
        mode: 'run',
        open: true,
      })
      expect(parseRunArgs(['--mermaid', 'off', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        mermaid: 'off',
        mode: 'run',
        open: true,
      })
    })

    it('--mermaid が末尾にあって値が無い場合は invalid', () => {
      expect(parseRunArgs(['spec.md', '--mermaid'])).toMatchObject({ mode: 'invalid' })
    })

    it('--mermaid の値位置に別フラグが来た場合は invalid', () => {
      expect(parseRunArgs(['--mermaid', '--no-open', 'spec.md'])).toMatchObject({ mode: 'invalid' })
    })

    it('--mermaid の値が許容外 (yes / Auto / 空文字) は invalid', () => {
      expect(parseRunArgs(['--mermaid', 'yes', 'spec.md'])).toMatchObject({ mode: 'invalid' })
      expect(parseRunArgs(['--mermaid', 'Auto', 'spec.md'])).toMatchObject({ mode: 'invalid' })
    })

    it('--mermaid 未指定時は mermaid が含まれない (CLI 側で auto 既定として解釈)', () => {
      expect(parseRunArgs(['spec.md'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
      })
    })
  })

  describe('parseRunArgs: --math / --math-fonts', () => {
    it('--math auto / on / off が認識される', () => {
      expect(parseRunArgs(['--math', 'auto', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        math: 'auto',
        mode: 'run',
        open: true,
      })
      expect(parseRunArgs(['--math', 'on', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        math: 'on',
        mode: 'run',
        open: true,
      })
      expect(parseRunArgs(['--math', 'off', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        math: 'off',
        mode: 'run',
        open: true,
      })
    })

    it('--math-fonts minimal / all が認識される', () => {
      expect(parseRunArgs(['--math-fonts', 'minimal', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        mathFonts: 'minimal',
        mode: 'run',
        open: true,
      })
      expect(parseRunArgs(['--math-fonts', 'all', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        mathFonts: 'all',
        mode: 'run',
        open: true,
      })
    })

    it('--math と --math-fonts は組み合わせて指定できる', () => {
      expect(parseRunArgs(['--math', 'on', '--math-fonts', 'all', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        math: 'on',
        mathFonts: 'all',
        mode: 'run',
        open: true,
      })
    })

    it('--math が末尾で値が無い場合は invalid', () => {
      expect(parseRunArgs(['spec.md', '--math'])).toMatchObject({ mode: 'invalid' })
    })

    it('--math の値位置に別フラグが来た場合は invalid', () => {
      expect(parseRunArgs(['--math', '--no-open', 'spec.md'])).toMatchObject({ mode: 'invalid' })
    })

    it('--math の値が許容外 (yes / Auto / 空文字) は invalid', () => {
      expect(parseRunArgs(['--math', 'yes', 'spec.md'])).toMatchObject({ mode: 'invalid' })
      expect(parseRunArgs(['--math', 'Auto', 'spec.md'])).toMatchObject({ mode: 'invalid' })
    })

    it('--math-fonts が末尾で値が無い場合は invalid', () => {
      expect(parseRunArgs(['spec.md', '--math-fonts'])).toMatchObject({ mode: 'invalid' })
    })

    it('--math-fonts の値が許容外 (full / Minimal / 空文字) は invalid', () => {
      expect(parseRunArgs(['--math-fonts', 'full', 'spec.md'])).toMatchObject({ mode: 'invalid' })
      expect(parseRunArgs(['--math-fonts', 'Minimal', 'spec.md'])).toMatchObject({
        mode: 'invalid',
      })
    })

    it('--math / --math-fonts 未指定時は対応プロパティを含まない', () => {
      expect(parseRunArgs(['spec.md'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
      })
    })
  })

  describe('parseRunArgs: --comments-width', () => {
    it('--comments-width 0 は closed 指定として認識される', () => {
      expect(parseRunArgs(['--comments-width', '0', 'spec.md'])).toEqual({
        commentsWidth: 0,
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
      })
    })

    it('--comments-width 320 は open + 幅 320 として認識される', () => {
      expect(parseRunArgs(['--comments-width', '320', 'spec.md'])).toEqual({
        commentsWidth: 320,
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
      })
    })

    it('--comments-width 640 (上限) も valid', () => {
      expect(parseRunArgs(['--comments-width', '640', 'spec.md'])).toEqual({
        commentsWidth: 640,
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
      })
    })

    it('--comments-width が末尾にあって値が無い場合は invalid', () => {
      expect(parseRunArgs(['spec.md', '--comments-width'])).toMatchObject({ mode: 'invalid' })
    })

    it('--comments-width の値位置に別フラグが来た場合は invalid', () => {
      expect(parseRunArgs(['--comments-width', '--no-open', 'spec.md'])).toMatchObject({
        mode: 'invalid',
      })
    })

    it('--comments-width 範囲外 (279 / 641) は invalid', () => {
      expect(parseRunArgs(['--comments-width', '279', 'spec.md'])).toMatchObject({
        mode: 'invalid',
      })
      expect(parseRunArgs(['--comments-width', '641', 'spec.md'])).toMatchObject({
        mode: 'invalid',
      })
    })

    it('--comments-width 非数値 (auto / px 単位付き) は invalid', () => {
      expect(parseRunArgs(['--comments-width', 'auto', 'spec.md'])).toMatchObject({
        mode: 'invalid',
      })
      expect(parseRunArgs(['--comments-width', '360px', 'spec.md'])).toMatchObject({
        mode: 'invalid',
      })
    })

    it('--comments-width 未指定時は commentsWidth が含まれない', () => {
      expect(parseRunArgs(['spec.md'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
      })
    })

    it('--comments-width と他のフラグの組み合わせも認識する', () => {
      expect(
        parseRunArgs([
          '--no-open',
          '--comments-width',
          '480',
          '--theme',
          'dark',
          'spec.md',
          '/tmp/out',
        ])
      ).toEqual({
        commentsWidth: 480,
        inputPath: 'spec.md',
        mode: 'run',
        open: false,
        outputDir: '/tmp/out',
        themeHint: 'dark',
      })
    })
  })

  describe('parseRunArgs: invalid arguments の error メッセージ', () => {
    // どの flag・どの token・どの期待値で失敗したかを 1 行で伝えられるよう、各分岐の
    // 代表ケースで error 文字列をスナップショット的に検証する。stderr に出る詳細部分の
    // contract test。
    it('範囲外の --comments-width はどの値が invalid かと期待範囲を含む', () => {
      expect(parseRunArgs(['--comments-width', '200', 'spec.md'])).toEqual({
        error:
          "--comments-width: invalid value '200' (expected 0 (closed) or 280-640 (open width in px, integer))",
        mode: 'invalid',
      })
    })

    it('範囲外の --page-nav-width は flag 名と期待範囲を含む', () => {
      expect(parseRunArgs(['--page-nav-width', '999', 'spec.md'])).toEqual({
        error:
          "--page-nav-width: invalid value '999' (expected 0 (closed) or 180-480 (open width in px, integer))",
        mode: 'invalid',
      })
    })

    it('未知の --theme 値は期待される enum を含む', () => {
      expect(parseRunArgs(['--theme', 'midnight', 'spec.md'])).toEqual({
        error: "--theme: invalid value 'midnight' (expected system, light, or dark)",
        mode: 'invalid',
      })
    })

    it('--theme 末尾で値欠落は missing value メッセージになる', () => {
      expect(parseRunArgs(['spec.md', '--theme'])).toEqual({
        error: '--theme: missing value (expected system, light, or dark)',
        mode: 'invalid',
      })
    })

    it('値位置に別フラグが来た時も missing value メッセージになる', () => {
      expect(parseRunArgs(['--theme', '--no-open', 'spec.md'])).toEqual({
        error: '--theme: missing value (expected system, light, or dark)',
        mode: 'invalid',
      })
    })

    it('未知 flag は unknown option を含む', () => {
      expect(parseRunArgs(['--unknown', 'spec.md'])).toEqual({
        error: 'unknown option: --unknown',
        mode: 'invalid',
      })
    })

    it('位置引数 0 個は missing input を含む', () => {
      expect(parseRunArgs(['--no-open'])).toEqual({
        error: 'missing input markdown (expected <input.md|-> [output-dir])',
        mode: 'invalid',
      })
    })

    it('位置引数 3 個以上は too many positional を含む', () => {
      expect(parseRunArgs(['a.md', 'b', 'c'])).toEqual({
        error: 'too many positional arguments: 3 (expected at most 2: <input.md|-> [output-dir])',
        mode: 'invalid',
      })
    })
  })
}
