// run モードの引数 partition で使う state machine primitive。
// 各値フラグは FlagDef ({ flag, consume }) に統合し、existential な Value 型は
// `defineFlagDef` の closure に閉じ込めることで、テーブル格納時に unknown cast を不要にする。
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

// FlagDef は外側からは Value 型を持たない。Value は defineFlagDef の closure 内で
// parser → assign の連結に閉じるため、テーブル格納時の existential 型エミュレートが不要。
export interface FlagDef {
  flag: string
  consume: (acc: PartitionState, token: string) => PartitionState
}

export interface PartitionState {
  documentName: string | null
  markdownCssPath: string | null
  math: MathMode | null
  mathFonts: MathFontsMode | null
  mermaid: MermaidMode | null
  open: boolean
  pageNavWidth: number | null
  // 値待ちのフラグ。null の間は新しい flag / 位置引数として token を消費する。
  // 非 null の間に来た token は pending.consume に渡され、消費後に null に戻す。
  pending: FlagDef | null
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
  pending: null,
  positional: [],
  shikiLangs: null,
  showOpenFile: false,
  themeHint: null,
  valid: true,
}

// FlagDef のファクトリ。Value を generic で受け、parser + assign を closure に閉じ込めて
// FlagDef (Value 型を持たない) を返す。テーブル格納時の existential エミュレートが不要になる。
interface FlagSpec<Value> {
  flag: string
  parser: (token: string) => Value | null
  assign: (acc: PartitionState, value: Value) => PartitionState
}

const defineFlagDef = <Value>(spec: FlagSpec<Value>): FlagDef => ({
  consume: (acc, token): PartitionState => {
    const value = spec.parser(token)
    if (value === null) {
      return { ...acc, valid: false }
    }
    return spec.assign(acc, value)
  },
  flag: spec.flag,
})

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

// 値を取るフラグの宣言的テーブル。flag・parser・assign を 1 entry に凝集する。
// CSV のうち未サポート識別子は parseShikiLangsValue 内で silently drop されるため、
// `--shiki-langs mylang,xxx-fake` のような全滅入力でも invalid にはせず空 list (= none と同等) を返す。
// markdown-css のみ `-` 単独 (stdin sentinel と衝突するパス) を parser 内で null 返しして弾く。
const VALUE_FLAG_DEFS: readonly FlagDef[] = [
  defineFlagDef<string>({
    assign: (acc, value): PartitionState => ({ ...acc, documentName: value }),
    flag: DOCUMENT_NAME_FLAG,
    parser: (token): string => token,
  }),
  defineFlagDef<ThemeHint>({
    assign: (acc, value): PartitionState => ({ ...acc, themeHint: value }),
    flag: THEME_FLAG,
    parser: parseThemeHintValue,
  }),
  defineFlagDef<ShikiLangsMode>({
    assign: (acc, value): PartitionState => ({ ...acc, shikiLangs: value }),
    flag: SHIKI_LANGS_FLAG,
    parser: (token): ShikiLangsMode => parseShikiLangsValue(token),
  }),
  defineFlagDef<number>({
    assign: (acc, value): PartitionState => ({ ...acc, commentsWidth: value }),
    flag: COMMENTS_WIDTH_FLAG,
    parser: parseCommentsWidthValue,
  }),
  defineFlagDef<number>({
    assign: (acc, value): PartitionState => ({ ...acc, pageNavWidth: value }),
    flag: PAGE_NAV_WIDTH_FLAG,
    parser: parsePageNavWidthValue,
  }),
  defineFlagDef<MermaidMode>({
    assign: (acc, value): PartitionState => ({ ...acc, mermaid: value }),
    flag: MERMAID_FLAG,
    parser: parseMermaidValue,
  }),
  defineFlagDef<MathMode>({
    assign: (acc, value): PartitionState => ({ ...acc, math: value }),
    flag: MATH_FLAG,
    parser: parseMathValue,
  }),
  defineFlagDef<MathFontsMode>({
    assign: (acc, value): PartitionState => ({ ...acc, mathFonts: value }),
    flag: MATH_FONTS_FLAG,
    parser: parseMathFontsValue,
  }),
  // stdin (`-`) は input markdown 専用 sentinel のため、CSS path として受け入れると衝突する。
  // parser で `-` を null 返しすることで「値欠落」と同じ invalid 経路に流す。
  defineFlagDef<string>({
    assign: (acc, value): PartitionState => ({ ...acc, markdownCssPath: value }),
    flag: MARKDOWN_CSS_FLAG,
    parser: parseMarkdownCssPathValue,
  }),
]

// VALUE_FLAG_DEFS の O(1) lookup index。flag 増減時にも自動で同期される。
const VALUE_FLAG_INDEX: ReadonlyMap<string, FlagDef> = new Map(
  VALUE_FLAG_DEFS.map((def): readonly [string, FlagDef] => [def.flag, def])
)

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

// `--` 始まりのトークンを既知フラグへ振り分け。未知フラグは invalid。
// 値を取るフラグは pending に格納し、次トークンで pending.consume が走る。
const consumeFlag = (acc: PartitionState, token: string): PartitionState => {
  const standalone = consumeStandaloneFlag(acc, token)
  if (standalone !== null) {
    return standalone
  }
  const def = VALUE_FLAG_INDEX.get(token)
  if (def) {
    return { ...acc, pending: def }
  }
  return { ...acc, valid: false }
}

// pending な FlagDef がある状態で次トークンを消費する。
// `--` 始まりは値欠落として invalid。parser 失敗時 (consume 内で valid=false) も
// pending は先に clear するため、`isPartitionValid` 経由でなく `state.pending` を
// 直接参照するコードは「pending は invalid 経路でも残らない」前提で書ける。
const consumePendingValue = (acc: PartitionState, token: string): PartitionState | null => {
  if (acc.pending === null) {
    return null
  }
  if (token.startsWith('--')) {
    return { ...acc, pending: null, valid: false }
  }
  return acc.pending.consume({ ...acc, pending: null }, token)
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
  state.valid && state.pending === null

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('VALUE_FLAG_DEFS 整合性', () => {
    it('VALUE_FLAG_DEFS の flag は重複しない', () => {
      const flags = VALUE_FLAG_DEFS.map((row): string => row.flag)
      expect(new Set(flags).size).toBe(flags.length)
    })

    it('parser が null を返した場合 consume は valid=false を伝播する', () => {
      const def = VALUE_FLAG_INDEX.get(THEME_FLAG)
      expect(def).toBeDefined()
      if (def) {
        const next = def.consume(INITIAL_PARTITION_STATE, 'NotAThemeHint')
        expect(next.valid).toBe(false)
      }
    })

    it('FlagDef.consume は成功時に pending を変更しない (pending 管理は stepArg 側)', () => {
      const def = VALUE_FLAG_INDEX.get(DOCUMENT_NAME_FLAG)
      expect(def).toBeDefined()
      if (def) {
        const base: PartitionState = { ...INITIAL_PARTITION_STATE, pending: def }
        const next = def.consume(base, 'spec.md')
        expect(next.documentName).toBe('spec.md')
        expect(next.pending).toBe(def)
      }
    })

    // 全 def smoke test: 新規 flag 追加時の登録漏れ (FlagDef 形式違反 / 空 flag prefix) を検知する。
    it('全 VALUE_FLAG_DEFS は --prefix の flag と function 型 consume を持つ', () => {
      for (const def of VALUE_FLAG_DEFS) {
        expect(def.flag.startsWith('--'), `flag=${def.flag}`).toBe(true)
        expect(typeof def.consume, `flag=${def.flag}`).toBe('function')
      }
    })

    it('VALUE_FLAG_INDEX は VALUE_FLAG_DEFS の全 entry を含む', () => {
      expect(VALUE_FLAG_INDEX.size).toBe(VALUE_FLAG_DEFS.length)
      for (const def of VALUE_FLAG_DEFS) {
        expect(VALUE_FLAG_INDEX.get(def.flag)).toBe(def)
      }
    })
  })
}
