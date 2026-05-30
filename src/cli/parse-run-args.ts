// run モード (`<input.md|-> [output-dir]` + 各種フラグ) の引数パース。
// flag を partition する state machine と RunArgs 組み立てを担う。
// flag 定数 / value parser / 結果型は arg-spec.ts に集約。dispatch は parse-args.ts。

import {
  COMMENTS_WIDTH_FLAG,
  DOCUMENT_NAME_FLAG,
  MARKDOWN_CSS_FLAG,
  MATH_FLAG,
  MATH_FONTS_FLAG,
  type MathFontsMode,
  type MathMode,
  MERMAID_FLAG,
  type MermaidMode,
  NO_OPEN_FLAG,
  PAGE_NAV_WIDTH_FLAG,
  type ParsedArgs,
  type RunArgs,
  SHIKI_LANGS_FLAG,
  SHOW_OPEN_FILE_FLAG,
  type ShikiLangsMode,
  THEME_FLAG,
  type ThemeHint,
  isThemeHint,
  parseCommentsWidthValue,
  parseMathFontsValue,
  parseMathValue,
  parseMermaidValue,
  parsePageNavWidthValue,
  parseShikiLangsValue,
} from './arg-spec'

interface PartitionedArgs {
  documentName?: string
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
  valid: boolean
}

interface PartitionState {
  documentName: string | null
  markdownCssPath: string | null
  math: MathMode | null
  mathFonts: MathFontsMode | null
  mermaid: MermaidMode | null
  open: boolean
  pageNavWidth: number | null
  pendingDocName: boolean
  pendingMarkdownCss: boolean
  pendingMath: boolean
  pendingMathFonts: boolean
  pendingMermaid: boolean
  pendingPageNavWidth: boolean
  pendingShikiLangs: boolean
  pendingCommentsWidth: boolean
  pendingTheme: boolean
  positional: readonly string[]
  shikiLangs: ShikiLangsMode | null
  commentsWidth: number | null
  themeHint: ThemeHint | null
  showOpenFile: boolean
  valid: boolean
}

const INITIAL_PARTITION_STATE: PartitionState = {
  commentsWidth: null,
  documentName: null,
  markdownCssPath: null,
  math: null,
  mathFonts: null,
  mermaid: null,
  open: true,
  pageNavWidth: null,
  pendingCommentsWidth: false,
  pendingDocName: false,
  pendingMarkdownCss: false,
  pendingMath: false,
  pendingMathFonts: false,
  pendingMermaid: false,
  pendingPageNavWidth: false,
  pendingShikiLangs: false,
  pendingTheme: false,
  positional: [],
  shikiLangs: null,
  showOpenFile: false,
  themeHint: null,
  valid: true,
}

// 値を取らないフラグの dispatcher。
const consumeStandaloneFlag = (acc: PartitionState, token: string): PartitionState | null => {
  if (token === NO_OPEN_FLAG) {
    return { ...acc, open: false }
  }
  if (token === SHOW_OPEN_FILE_FLAG) {
    return { ...acc, showOpenFile: true }
  }
  return null
}

// 値を取るフラグ (pending* を立てるだけ) の dispatcher。フラグ追加時の max-statements を
// 避けるため、テーブル駆動で書く。各 entry は { flag, mark } で「flag に一致したら mark で
// pending* を立てた新しい state を返す」セマンティクス。
const VALUE_FLAG_TABLE: readonly {
  flag: string
  mark: (acc: PartitionState) => PartitionState
}[] = [
  { flag: DOCUMENT_NAME_FLAG, mark: (acc): PartitionState => ({ ...acc, pendingDocName: true }) },
  { flag: THEME_FLAG, mark: (acc): PartitionState => ({ ...acc, pendingTheme: true }) },
  { flag: SHIKI_LANGS_FLAG, mark: (acc): PartitionState => ({ ...acc, pendingShikiLangs: true }) },
  {
    flag: COMMENTS_WIDTH_FLAG,
    mark: (acc): PartitionState => ({ ...acc, pendingCommentsWidth: true }),
  },
  {
    flag: PAGE_NAV_WIDTH_FLAG,
    mark: (acc): PartitionState => ({ ...acc, pendingPageNavWidth: true }),
  },
  { flag: MERMAID_FLAG, mark: (acc): PartitionState => ({ ...acc, pendingMermaid: true }) },
  { flag: MATH_FLAG, mark: (acc): PartitionState => ({ ...acc, pendingMath: true }) },
  { flag: MATH_FONTS_FLAG, mark: (acc): PartitionState => ({ ...acc, pendingMathFonts: true }) },
  {
    flag: MARKDOWN_CSS_FLAG,
    mark: (acc): PartitionState => ({ ...acc, pendingMarkdownCss: true }),
  },
]

const consumeValueFlag = (acc: PartitionState, token: string): PartitionState | null => {
  const entry = VALUE_FLAG_TABLE.find((row): boolean => row.flag === token)
  if (!entry) {
    return null
  }
  return entry.mark(acc)
}

// `--` 始まりのトークンを既知フラグへ振り分け。未知フラグは invalid。
const consumeFlag = (acc: PartitionState, token: string): PartitionState => {
  const standalone = consumeStandaloneFlag(acc, token)
  if (standalone !== null) {
    return standalone
  }
  const valueFlag = consumeValueFlag(acc, token)
  if (valueFlag !== null) {
    return valueFlag
  }
  return { ...acc, valid: false }
}

type PendingFlagKey =
  | 'pendingDocName'
  | 'pendingMarkdownCss'
  | 'pendingMath'
  | 'pendingMathFonts'
  | 'pendingMermaid'
  | 'pendingPageNavWidth'
  | 'pendingShikiLangs'
  | 'pendingCommentsWidth'
  | 'pendingTheme'

// 値待ちフラグの 1 entry: 「pendingKey が立っていたら parser(token) で値検証し、apply(acc, value)
// で field と pending* を一括更新する」を表す。各 entry は独自の Value 型を持つが、テーブル格納時は
// `erasePendingValueSpec` で Value を unknown に揃えて配列化する (existential エミュレート)。
//
// 共通の前置チェック (consumePendingValue 内で実施):
//   - `--` 始まり = 値欠落 (parser を呼ぶ前に invalid)
//   - parser が null = 検証失敗 (invalid)
// markdown-css のみ `-` 単独 (stdin sentinel と衝突するパス) を parser 内で null 返しして弾く。
interface PendingValueSpec<Value> {
  apply: (acc: PartitionState, value: Value) => PartitionState
  parser: (token: string) => Value | null
  pendingKey: PendingFlagKey
}

// existential 型のエミュレート: parser / apply の Value を unknown に潰して配列格納する。
// consumePendingValue 内で parser → apply が同じ entry 内で完結するため Value は entry に閉じる。
// 消費側で unknown を再具体化しないので、unknown 化 cast は型安全性を損なわない
// (eslint の no-unsafe-type-assertion は generic 制約より narrow と判定するが、本ファクトリは
// 型情報を捨てる方向の cast なので false positive。AGENTS.md: 無効化の理由を明記)。
const erasePendingValueSpec = <Value>(spec: PendingValueSpec<Value>): PendingValueSpec<unknown> => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const erased = spec as unknown as PendingValueSpec<unknown>
  return erased
}

// parser: ThemeHint validation。`(token) => isThemeHint(token) ? token : null` を no-ternary 回避で展開。
const parseThemeHintValue = (token: string): ThemeHint | null => {
  if (!isThemeHint(token)) {
    return null
  }
  return token
}

// parser: markdown-css path validation。stdin sentinel (`-`) を弾く。
const parseMarkdownCssPathValue = (token: string): string | null => {
  if (token === '-') {
    return null
  }
  return token
}

const PENDING_VALUE_SPECS: readonly PendingValueSpec<unknown>[] = [
  erasePendingValueSpec<string>({
    apply: (acc, value): PartitionState => ({
      ...acc,
      documentName: value,
      pendingDocName: false,
    }),
    parser: (token): string => token,
    pendingKey: 'pendingDocName',
  }),
  erasePendingValueSpec<ThemeHint>({
    apply: (acc, value): PartitionState => ({
      ...acc,
      pendingTheme: false,
      themeHint: value,
    }),
    parser: parseThemeHintValue,
    pendingKey: 'pendingTheme',
  }),
  // CSV のうち未サポート識別子は parseShikiLangsValue 内で silently drop されるため、
  // `--shiki-langs mylang,xxx-fake` のような全滅入力でも invalid にはせず空 list (= none と同等) を返す。
  erasePendingValueSpec<ShikiLangsMode>({
    apply: (acc, value): PartitionState => ({
      ...acc,
      pendingShikiLangs: false,
      shikiLangs: value,
    }),
    parser: (token): ShikiLangsMode => parseShikiLangsValue(token),
    pendingKey: 'pendingShikiLangs',
  }),
  erasePendingValueSpec<number>({
    apply: (acc, value): PartitionState => ({
      ...acc,
      commentsWidth: value,
      pendingCommentsWidth: false,
    }),
    parser: parseCommentsWidthValue,
    pendingKey: 'pendingCommentsWidth',
  }),
  erasePendingValueSpec<number>({
    apply: (acc, value): PartitionState => ({
      ...acc,
      pageNavWidth: value,
      pendingPageNavWidth: false,
    }),
    parser: parsePageNavWidthValue,
    pendingKey: 'pendingPageNavWidth',
  }),
  erasePendingValueSpec<MermaidMode>({
    apply: (acc, value): PartitionState => ({
      ...acc,
      mermaid: value,
      pendingMermaid: false,
    }),
    parser: parseMermaidValue,
    pendingKey: 'pendingMermaid',
  }),
  erasePendingValueSpec<MathMode>({
    apply: (acc, value): PartitionState => ({ ...acc, math: value, pendingMath: false }),
    parser: parseMathValue,
    pendingKey: 'pendingMath',
  }),
  erasePendingValueSpec<MathFontsMode>({
    apply: (acc, value): PartitionState => ({
      ...acc,
      mathFonts: value,
      pendingMathFonts: false,
    }),
    parser: parseMathFontsValue,
    pendingKey: 'pendingMathFonts',
  }),
  // stdin (`-`) は input markdown 専用 sentinel のため、CSS path として受け入れると衝突する。
  // parser で `-` を null 返しすることで「値欠落」と同じ invalid 経路に流す。
  erasePendingValueSpec<string>({
    apply: (acc, value): PartitionState => ({
      ...acc,
      markdownCssPath: value,
      pendingMarkdownCss: false,
    }),
    parser: parseMarkdownCssPathValue,
    pendingKey: 'pendingMarkdownCss',
  }),
]

const consumePendingValue = (acc: PartitionState, token: string): PartitionState | null => {
  const spec = PENDING_VALUE_SPECS.find((row): boolean => acc[row.pendingKey])
  if (!spec) {
    return null
  }
  if (token.startsWith('--')) {
    return { ...acc, valid: false }
  }
  const value = spec.parser(token)
  if (value === null) {
    return { ...acc, valid: false }
  }
  return spec.apply(acc, value)
}

// reduce で 1 トークンずつ状態を進める。pure な関数として書くことで、ESLint の
// no-continue / no-plusplus / max-statements の制約に抵触せず、テストでも追跡しやすい。
const stepArg = (acc: PartitionState, token: string): PartitionState => {
  if (!acc.valid) {
    return acc
  }
  const pending = consumePendingValue(acc, token)
  if (pending !== null) {
    return pending
  }
  if (token.startsWith('--')) {
    return consumeFlag(acc, token)
  }
  return { ...acc, positional: [...acc.positional, token] }
}

// 結果オブジェクトに optional フィールドを後付けで追加するヘルパ。max-statements を抑えるため
// 文字列系・拡張モード系・数値系で関数を分割する。
const attachPartitionStringOptionals = (result: PartitionedArgs, state: PartitionState): void => {
  if (state.documentName !== null) {
    result.documentName = state.documentName
  }
  if (state.themeHint !== null) {
    result.themeHint = state.themeHint
  }
  if (state.shikiLangs !== null) {
    result.shikiLangs = state.shikiLangs
  }
  if (state.markdownCssPath !== null) {
    result.markdownCssPath = state.markdownCssPath
  }
}

const attachPartitionExtensionOptionals = (
  result: PartitionedArgs,
  state: PartitionState
): void => {
  if (state.mermaid !== null) {
    result.mermaid = state.mermaid
  }
  if (state.math !== null) {
    result.math = state.math
  }
  if (state.mathFonts !== null) {
    result.mathFonts = state.mathFonts
  }
}

const attachPartitionNumberOptionals = (result: PartitionedArgs, state: PartitionState): void => {
  if (state.commentsWidth !== null) {
    result.commentsWidth = state.commentsWidth
  }
  if (state.pageNavWidth !== null) {
    result.pageNavWidth = state.pageNavWidth
  }
}

const attachPartitionOptionals = (result: PartitionedArgs, state: PartitionState): void => {
  attachPartitionStringOptionals(result, state)
  attachPartitionExtensionOptionals(result, state)
  attachPartitionNumberOptionals(result, state)
}

const isPartitionValid = (state: PartitionState): boolean =>
  state.valid &&
  !state.pendingDocName &&
  !state.pendingTheme &&
  !state.pendingShikiLangs &&
  !state.pendingCommentsWidth &&
  !state.pendingPageNavWidth &&
  !state.pendingMermaid &&
  !state.pendingMath &&
  !state.pendingMathFonts &&
  !state.pendingMarkdownCss

const partitionArgs = (argv: readonly string[]): PartitionedArgs => {
  const state = argv.reduce<PartitionState>(stepArg, INITIAL_PARTITION_STATE)
  const result: PartitionedArgs = {
    open: state.open,
    positional: state.positional,
    showOpenFile: state.showOpenFile,
    valid: isPartitionValid(state),
  }
  attachPartitionOptionals(result, state)
  return result
}

// RunArgs に optional フィールドを後付け。partition と同じ理由で関数として切り出し済み。
// 文字列系と非文字列系で分割して max-statements を満たす。
const attachRunStringOptionals = (
  result: { mode: 'run' } & RunArgs,
  parts: PartitionedArgs
): void => {
  const [, outputDir] = parts.positional
  if (typeof outputDir === 'string') {
    result.outputDir = outputDir
  }
  if (typeof parts.documentName === 'string') {
    result.documentName = parts.documentName
  }
  if (typeof parts.themeHint === 'string') {
    result.themeHint = parts.themeHint
  }
  if (typeof parts.markdownCssPath === 'string') {
    result.markdownCssPath = parts.markdownCssPath
  }
}

const attachRunNonStringOptionals = (
  result: { mode: 'run' } & RunArgs,
  parts: PartitionedArgs
): void => {
  if (parts.shikiLangs) {
    result.shikiLangs = parts.shikiLangs
  }
  if (typeof parts.commentsWidth === 'number') {
    result.commentsWidth = parts.commentsWidth
  }
  if (typeof parts.pageNavWidth === 'number') {
    result.pageNavWidth = parts.pageNavWidth
  }
}

const attachRunExtensionOptionals = (
  result: { mode: 'run' } & RunArgs,
  parts: PartitionedArgs
): void => {
  if (parts.mermaid) {
    result.mermaid = parts.mermaid
  }
  if (parts.math) {
    result.math = parts.math
  }
  if (parts.mathFonts) {
    result.mathFonts = parts.mathFonts
  }
}

const attachRunOptionals = (result: { mode: 'run' } & RunArgs, parts: PartitionedArgs): void => {
  attachRunStringOptionals(result, parts)
  attachRunNonStringOptionals(result, parts)
  attachRunExtensionOptionals(result, parts)
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
  attachRunOptionals(result, parts)
  return result
}

// 位置引数 (<input.md|->, [output-dir]) と --no-open / --document-name 等を混在順序で受け付ける。
// 未知フラグ・位置引数の個数違反・値欠落は invalid。help / clean の振り分けは parse-args.ts が先に行う。
export const parseRunArgs = (argv: readonly string[]): ParsedArgs => {
  const parts = partitionArgs(argv)
  if (!parts.valid) {
    return { mode: 'invalid' }
  }
  if (parts.positional.length < 1 || parts.positional.length > 2) {
    return { mode: 'invalid' }
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
      expect(parseRunArgs(['spec.md', '--document-name'])).toEqual({ mode: 'invalid' })
    })

    it('--document-name の値位置に別フラグが来た場合は invalid', () => {
      expect(parseRunArgs(['--document-name', '--no-open', 'spec.md'])).toEqual({
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

  describe('parseRunArgs: invalid モード', () => {
    it('--no-open だけで位置引数がない場合は invalid', () => {
      expect(parseRunArgs(['--no-open'])).toEqual({ mode: 'invalid' })
    })

    it('位置引数が 3 個以上は invalid', () => {
      expect(parseRunArgs(['a.md', 'b', 'c'])).toEqual({ mode: 'invalid' })
    })

    it('未知のフラグは invalid', () => {
      expect(parseRunArgs(['--unknown', 'spec.md'])).toEqual({ mode: 'invalid' })
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
      expect(parseRunArgs(['spec.md', '--theme'])).toEqual({ mode: 'invalid' })
    })

    it('--theme の値位置に別フラグが来た場合は invalid', () => {
      expect(parseRunArgs(['--theme', '--no-open', 'spec.md'])).toEqual({ mode: 'invalid' })
    })

    it('--theme の値が許容外 (auto / 空文字 / 大文字) は invalid', () => {
      expect(parseRunArgs(['--theme', 'auto', 'spec.md'])).toEqual({ mode: 'invalid' })
      expect(parseRunArgs(['--theme', '', 'spec.md'])).toEqual({ mode: 'invalid' })
      expect(parseRunArgs(['--theme', 'Dark', 'spec.md'])).toEqual({ mode: 'invalid' })
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
      expect(parseRunArgs(['spec.md', '--shiki-langs'])).toEqual({ mode: 'invalid' })
    })

    it('--shiki-langs の値位置に別フラグが来た場合は invalid', () => {
      expect(parseRunArgs(['--shiki-langs', '--no-open', 'spec.md'])).toEqual({ mode: 'invalid' })
    })

    it('--shiki-langs 未指定時は shikiLangs が含まれない', () => {
      expect(parseRunArgs(['spec.md'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
      })
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
      expect(parseRunArgs(['spec.md', '--mermaid'])).toEqual({ mode: 'invalid' })
    })

    it('--mermaid の値位置に別フラグが来た場合は invalid', () => {
      expect(parseRunArgs(['--mermaid', '--no-open', 'spec.md'])).toEqual({ mode: 'invalid' })
    })

    it('--mermaid の値が許容外 (yes / Auto / 空文字) は invalid', () => {
      expect(parseRunArgs(['--mermaid', 'yes', 'spec.md'])).toEqual({ mode: 'invalid' })
      expect(parseRunArgs(['--mermaid', 'Auto', 'spec.md'])).toEqual({ mode: 'invalid' })
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
      expect(parseRunArgs(['spec.md', '--math'])).toEqual({ mode: 'invalid' })
    })

    it('--math の値位置に別フラグが来た場合は invalid', () => {
      expect(parseRunArgs(['--math', '--no-open', 'spec.md'])).toEqual({ mode: 'invalid' })
    })

    it('--math の値が許容外 (yes / Auto / 空文字) は invalid', () => {
      expect(parseRunArgs(['--math', 'yes', 'spec.md'])).toEqual({ mode: 'invalid' })
      expect(parseRunArgs(['--math', 'Auto', 'spec.md'])).toEqual({ mode: 'invalid' })
    })

    it('--math-fonts が末尾で値が無い場合は invalid', () => {
      expect(parseRunArgs(['spec.md', '--math-fonts'])).toEqual({ mode: 'invalid' })
    })

    it('--math-fonts の値が許容外 (full / Minimal / 空文字) は invalid', () => {
      expect(parseRunArgs(['--math-fonts', 'full', 'spec.md'])).toEqual({ mode: 'invalid' })
      expect(parseRunArgs(['--math-fonts', 'Minimal', 'spec.md'])).toEqual({ mode: 'invalid' })
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
      expect(parseRunArgs(['spec.md', '--comments-width'])).toEqual({ mode: 'invalid' })
    })

    it('--comments-width の値位置に別フラグが来た場合は invalid', () => {
      expect(parseRunArgs(['--comments-width', '--no-open', 'spec.md'])).toEqual({
        mode: 'invalid',
      })
    })

    it('--comments-width 範囲外 (279 / 641) は invalid', () => {
      expect(parseRunArgs(['--comments-width', '279', 'spec.md'])).toEqual({ mode: 'invalid' })
      expect(parseRunArgs(['--comments-width', '641', 'spec.md'])).toEqual({ mode: 'invalid' })
    })

    it('--comments-width 非数値 (auto / px 単位付き) は invalid', () => {
      expect(parseRunArgs(['--comments-width', 'auto', 'spec.md'])).toEqual({ mode: 'invalid' })
      expect(parseRunArgs(['--comments-width', '360px', 'spec.md'])).toEqual({ mode: 'invalid' })
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

  // VALUE_FLAG_TABLE と PENDING_VALUE_SPECS の対応漏れは型では検出できない (mark が
  // 立てる pending* キーと PENDING_VALUE_SPECS の key が runtime でのみ結びつく)。
  // 片方だけ追加 / 削除した場合に「値が消費されない」「未定義の pending を見に行く」
  // 等の silent な不具合になるため、両テーブルの整合性を機械的に検証する。
  describe('VALUE_FLAG_TABLE / PENDING_VALUE_SPECS 整合性', () => {
    const collectPendingKeys = (state: PartitionState): readonly PendingFlagKey[] => {
      const keys: PendingFlagKey[] = [
        'pendingDocName',
        'pendingMarkdownCss',
        'pendingMath',
        'pendingMathFonts',
        'pendingMermaid',
        'pendingPageNavWidth',
        'pendingShikiLangs',
        'pendingCommentsWidth',
        'pendingTheme',
      ]
      return keys.filter((key): boolean => state[key])
    }

    it('各 VALUE_FLAG_TABLE.mark は丁度 1 つの pending* キーを立てる', () => {
      for (const entry of VALUE_FLAG_TABLE) {
        const pendings = collectPendingKeys(entry.mark(INITIAL_PARTITION_STATE))
        expect(pendings.length, `flag=${entry.flag}`).toBe(1)
      }
    })

    it('VALUE_FLAG_TABLE が立てる全ての pending キーは PENDING_VALUE_SPECS に entry を持つ', () => {
      const handledKeys = new Set(PENDING_VALUE_SPECS.map((row): PendingFlagKey => row.pendingKey))
      for (const entry of VALUE_FLAG_TABLE) {
        const [pendingKey] = collectPendingKeys(entry.mark(INITIAL_PARTITION_STATE))
        expect(pendingKey, `flag=${entry.flag}`).toBeDefined()
        expect(handledKeys.has(pendingKey), `flag=${entry.flag}, key=${pendingKey}`).toBe(true)
      }
    })

    it('PENDING_VALUE_SPECS の全 key は VALUE_FLAG_TABLE のいずれかで立てられる (dead entry が無い)', () => {
      const reachable = new Set<PendingFlagKey>()
      for (const entry of VALUE_FLAG_TABLE) {
        for (const key of collectPendingKeys(entry.mark(INITIAL_PARTITION_STATE))) {
          reachable.add(key)
        }
      }
      for (const row of PENDING_VALUE_SPECS) {
        expect(reachable.has(row.pendingKey), `key=${row.pendingKey}`).toBe(true)
      }
    })

    it('PENDING_VALUE_SPECS の key は重複しない', () => {
      const keys = PENDING_VALUE_SPECS.map((row): PendingFlagKey => row.pendingKey)
      expect(new Set(keys).size).toBe(keys.length)
    })

    it('VALUE_FLAG_TABLE の flag は重複しない', () => {
      const flags = VALUE_FLAG_TABLE.map((row): string => row.flag)
      expect(new Set(flags).size).toBe(flags.length)
    })
  })
}
