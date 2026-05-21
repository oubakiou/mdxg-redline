// review-request CLI の引数パースと、出力ファイル名 prefix のサニタイズ。
// help テキストも CLI 表示用の単一定数としてここに集約する。

const NO_OPEN_FLAG = '--no-open'
const HELP_FLAGS = new Set(['--help', '-h'])
const DOCUMENT_NAME_FLAG = '--document-name'

export const HELP_TEXT = `Usage: mdxg-redline [options] <input.md|-> [output-dir]

Generate a review-request HTML with the markdown embedded and open it in
your default browser.

Arguments:
  <input.md>             Path to a markdown file. Pass \`-\` to read from stdin.
  [output-dir]           Output directory. Defaults to the input file's
                         directory; for stdin input, defaults to the current
                         working directory. Output filename is auto-derived
                         as <mdFileName>-<docHash>-review.html.

Options:
  --document-name <name> Override the document name used for the data-name
                         attribute and the output filename prefix. Useful
                         with stdin input.
  --no-open              Generate the HTML but do not launch a browser.
  -h, --help             Print this help and exit. Takes precedence over all
                         other arguments and flags when present.

Examples:
  mdxg-redline spec.md
  mdxg-redline spec.md ./reviews
  mdxg-redline --no-open spec.md
  cat spec.md | mdxg-redline - --document-name spec.md
`

export interface RunArgs {
  documentName?: string
  inputPath: string
  open: boolean
  outputDir?: string
}

export type ParsedArgs = { mode: 'help' } | { mode: 'invalid' } | ({ mode: 'run' } & RunArgs)

interface PartitionedArgs {
  documentName?: string
  open: boolean
  positional: readonly string[]
  valid: boolean
}

interface PartitionState {
  documentName: string | null
  open: boolean
  pendingDocName: boolean
  positional: readonly string[]
  valid: boolean
}

const INITIAL_PARTITION_STATE: PartitionState = {
  documentName: null,
  open: true,
  pendingDocName: false,
  positional: [],
  valid: true,
}

// --document-name の値位置で受け取った token を処理する。次に来た token が別フラグなら
// 値欠落として invalid 扱い、それ以外は文字列値として保存する。
const consumeDocNameValue = (acc: PartitionState, token: string): PartitionState => {
  if (token.startsWith('--')) {
    return { ...acc, valid: false }
  }
  return { ...acc, documentName: token, pendingDocName: false }
}

// `--` 始まりのトークンを既知フラグへ振り分け。未知フラグは invalid。
const consumeFlag = (acc: PartitionState, token: string): PartitionState => {
  if (token === NO_OPEN_FLAG) {
    return { ...acc, open: false }
  }
  if (token === DOCUMENT_NAME_FLAG) {
    return { ...acc, pendingDocName: true }
  }
  return { ...acc, valid: false }
}

// reduce で 1 トークンずつ状態を進める。pure な関数として書くことで、ESLint の
// no-continue / no-plusplus / max-statements の制約に抵触せず、テストでも追跡しやすい。
const stepArg = (acc: PartitionState, token: string): PartitionState => {
  if (!acc.valid) {
    return acc
  }
  if (acc.pendingDocName) {
    return consumeDocNameValue(acc, token)
  }
  if (token.startsWith('--')) {
    return consumeFlag(acc, token)
  }
  return { ...acc, positional: [...acc.positional, token] }
}

const partitionArgs = (argv: readonly string[]): PartitionedArgs => {
  const state = argv.reduce<PartitionState>(stepArg, INITIAL_PARTITION_STATE)
  const valid = state.valid && !state.pendingDocName
  const result: PartitionedArgs = {
    open: state.open,
    positional: state.positional,
    valid,
  }
  if (state.documentName !== null) {
    result.documentName = state.documentName
  }
  return result
}

const buildRunArgs = (parts: PartitionedArgs): { mode: 'run' } & RunArgs => {
  const [inputPath, outputDir] = parts.positional
  const result: { mode: 'run' } & RunArgs = {
    inputPath,
    mode: 'run',
    open: parts.open,
  }
  if (typeof outputDir === 'string') {
    result.outputDir = outputDir
  }
  if (typeof parts.documentName === 'string') {
    result.documentName = parts.documentName
  }
  return result
}

// 位置引数 (<input.md|->, [output-dir]) と --no-open / --document-name / -h / --help を
// 混在順序で受け付ける。引数なし or -h / --help は help モード（他の引数が混じっていても
// help を最優先する）。未知フラグ・位置引数の個数違反・--document-name の値欠落は invalid。
export const parseArgs = (argv: readonly string[]): ParsedArgs => {
  if (argv.length === 0) {
    return { mode: 'help' }
  }
  if (argv.some((token): boolean => HELP_FLAGS.has(token))) {
    return { mode: 'help' }
  }
  const parts = partitionArgs(argv)
  if (!parts.valid) {
    return { mode: 'invalid' }
  }
  if (parts.positional.length < 1 || parts.positional.length > 2) {
    return { mode: 'invalid' }
  }
  return buildRunArgs(parts)
}

// mdFileName 部分のみに対する緩めサニタイズ。レビュー画面 / data-name の表示用途
// (docName) はサニタイズしない方針なので、ここで対象にするのは出力 HTML の
// ファイル名 prefix を組み立てる値のみ。
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

  // describe 内の `it` 数が ESLint の max-statements (10) を超えないよう、
  // 期待モード単位で sub-describe に分割している。判別共用体の `mode` フィールドを
  // expected に含めることで run / help / invalid の取り違えを防ぐ。`toEqual` は欠落
  // プロパティ (outputDir / documentName) を `undefined` と同一視するため、未指定ケースは
  // expected から省略している。
  describe('parseArgs: run モード', () => {
    it('input.md 単独で run モード / open=true / outputDir 未指定を返す', () => {
      expect(parseArgs(['spec.md'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
      })
    })

    it('input.md と output-dir で run モードを返す', () => {
      expect(parseArgs(['spec.md', '/tmp/out'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
        outputDir: '/tmp/out',
      })
    })

    it('--no-open フラグで open=false になる', () => {
      expect(parseArgs(['--no-open', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: false,
      })
    })

    it('--no-open が引数の後ろに来ても認識する', () => {
      expect(parseArgs(['spec.md', '--no-open'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: false,
      })
    })

    it('--no-open が位置引数の間に来ても認識する', () => {
      expect(parseArgs(['spec.md', '--no-open', '/tmp/out'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: false,
        outputDir: '/tmp/out',
      })
    })

    it('input が `-` の場合は stdin token として run モードを返す', () => {
      expect(parseArgs(['-'])).toEqual({
        inputPath: '-',
        mode: 'run',
        open: true,
      })
    })
  })

  describe('parseArgs: --document-name', () => {
    it('--document-name で docName を上書きできる', () => {
      expect(parseArgs(['--document-name', 'override.md', 'spec.md'])).toEqual({
        documentName: 'override.md',
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
      })
    })

    it('--document-name と --no-open / output-dir を組み合わせられる', () => {
      expect(parseArgs(['--no-open', '--document-name', 'a.md', 'spec.md', '/tmp/out'])).toEqual({
        documentName: 'a.md',
        inputPath: 'spec.md',
        mode: 'run',
        open: false,
        outputDir: '/tmp/out',
      })
    })

    it('--document-name が末尾にあって値が無い場合は invalid', () => {
      expect(parseArgs(['spec.md', '--document-name'])).toEqual({ mode: 'invalid' })
    })

    it('--document-name の値位置に別フラグが来た場合は invalid', () => {
      expect(parseArgs(['--document-name', '--no-open', 'spec.md'])).toEqual({
        mode: 'invalid',
      })
    })
  })

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
    })
  })

  describe('parseArgs: invalid モード', () => {
    it('--no-open だけで位置引数がない場合は invalid', () => {
      expect(parseArgs(['--no-open'])).toEqual({ mode: 'invalid' })
    })

    it('位置引数が 3 個以上は invalid', () => {
      expect(parseArgs(['a.md', 'b', 'c'])).toEqual({ mode: 'invalid' })
    })

    it('未知のフラグは invalid', () => {
      expect(parseArgs(['--unknown', 'spec.md'])).toEqual({ mode: 'invalid' })
    })
  })

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
