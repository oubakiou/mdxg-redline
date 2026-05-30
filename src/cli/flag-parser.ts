// run モードの引数 partition で使う state machine primitive。
// flag テーブル / pending 値テーブル / 単一トークン消費関数 (stepArg) を担う。
// この層は PartitionState を入出力する pure な reducer であり、
// PartitionedArgs への変換は parse-run-args.ts (orchestrator) 側の責務。

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

export interface PartitionState {
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

export const INITIAL_PARTITION_STATE: PartitionState = {
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
export const stepArg = (acc: PartitionState, token: string): PartitionState => {
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

export const isPartitionValid = (state: PartitionState): boolean =>
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

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

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
