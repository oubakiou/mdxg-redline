// review-request CLI の flag 定数 / value parser 群 / パース結果型。
// parse-args.ts の partition / dispatch ロジックから分離し、「どんな flag があり、
// 各値はどうパースするか」と「パース結果の型」を 1 か所に寄せる。CLI 引数追加時の編集箇所をここに集約する。
// parse-clean-args.ts / parse-run-args.ts / parse-args.ts はこのモジュールに片方向依存する (leaf)。
//
// 純粋関数のみ。Node API / DOM 依存ゼロ。

import type { SupportedLang } from '../core/shiki-aliases.generated'
import { normalizeLangIdentifier } from '../core/scan-fenced-langs'

export const NO_OPEN_FLAG = '--no-open'
export const HELP_FLAGS = new Set(['--help', '-h'])
export const DOCUMENT_NAME_FLAG = '--document-name'
export const THEME_FLAG = '--theme'
export const SHIKI_LANGS_FLAG = '--shiki-langs'
export const COMMENTS_WIDTH_FLAG = '--comments-width'
export const PAGE_NAV_WIDTH_FLAG = '--page-nav-width'
export const SHOW_OPEN_FILE_FLAG = '--show-open-file'
export const MERMAID_FLAG = '--mermaid'
export const MATH_FLAG = '--math'
export const MATH_FONTS_FLAG = '--math-fonts'
export const MARKDOWN_CSS_FLAG = '--markdown-css'
export const CLEAN_FLAG = '--clean'
export const YES_FLAG = '--yes'
export const KEEP_FLAG = '--keep'
export const RECURSIVE_FLAG = '--recursive'
export const RECURSIVE_SHORT_FLAG = '-r'
export const HEX_16_PATTERN = /^[0-9a-f]{16}$/i

export type ThemeHint = 'system' | 'light' | 'dark'
const THEME_VALUES = ['system', 'light', 'dark'] as const

export const isThemeHint = (value: string): value is ThemeHint =>
  (THEME_VALUES as readonly string[]).includes(value)

// --comments-width に渡せる範囲は comments-width.ts と揃える。
// 0  → 起動時 closed (画面右端タブのみ表示)
// 280–640 → open 状態でその幅
// 範囲外 (1–279 / 641+) は invalid。
const COMMENTS_WIDTH_MIN = 280
const COMMENTS_WIDTH_MAX = 640

// --page-nav-width に渡せる範囲は page-nav-width.ts と揃える。
// 0  → 起動時 closed (画面左端タブのみ表示)
// 180–480 → open 状態でその幅
const PAGE_NAV_WIDTH_MIN = 180
const PAGE_NAV_WIDTH_MAX = 480

const isValidCommentsWidthHint = (value: number): boolean => {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return false
  }
  if (value === 0) {
    return true
  }
  return value >= COMMENTS_WIDTH_MIN && value <= COMMENTS_WIDTH_MAX
}

const isValidPageNavWidthHint = (value: number): boolean => {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return false
  }
  if (value === 0) {
    return true
  }
  return value >= PAGE_NAV_WIDTH_MIN && value <= PAGE_NAV_WIDTH_MAX
}

/**
 * `--comments-width` の値を整数 (0 or 280–640) にパースする。
 * 範囲外・非数値・小数は null (CLI 側で invalid 扱い)。
 */
export const parseCommentsWidthValue = (raw: string): number | null => {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return null
  }
  const num = Number(trimmed)
  if (!isValidCommentsWidthHint(num)) {
    return null
  }
  return num
}

/**
 * `--page-nav-width` の値を整数 (0 or 180–480) にパースする。
 * 範囲外・非数値・小数は null (CLI 側で invalid 扱い)。
 */
export const parsePageNavWidthValue = (raw: string): number | null => {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return null
  }
  const num = Number(trimmed)
  if (!isValidPageNavWidthHint(num)) {
    return null
  }
  return num
}

/**
 * `--mermaid <mode>` のパース結果 (docs/mdxg-diagram-rendering.md §3.2 / §4 Step 4)。
 * - `auto` (既定): markdown を scanMermaidFences で走査し、mermaid ブロックがあるときだけ Mermaid runtime を注入
 * - `on`: 件数に関係なく必ず注入
 * - `off`: 注入しない (mermaid ブロックは Shiki ハイライト fallback で表示)
 */
export type MermaidMode = 'auto' | 'off' | 'on'
const MERMAID_VALUES = ['auto', 'on', 'off'] as const

const isMermaidMode = (value: string): value is MermaidMode =>
  (MERMAID_VALUES as readonly string[]).includes(value)

/**
 * `--mermaid` の値を MermaidMode にパースする。pure な関数で、CLI 引数パースと
 * 単体テストの両方から再利用する。未知の値・空文字は null を返し、CLI 側で invalid 扱い。
 */
export const parseMermaidValue = (value: string): MermaidMode | null => {
  const trimmed = value.trim()
  if (isMermaidMode(trimmed)) {
    return trimmed
  }
  return null
}

/**
 * `--math <mode>` のパース結果 (DESIGN.md §3 / §12 §14 Math Rendering)。
 * MermaidMode と意味論を完全に揃えるため同じ 'auto' | 'on' | 'off' を再利用する。
 */
export type MathMode = MermaidMode

/**
 * `--math` の値を MathMode にパースする。MermaidMode と同じ literal を共有しているので
 * 受け付ける値も同じ。CLI 側の dispatch だけが分かれる。
 */
export const parseMathValue = (value: string): MathMode | null => parseMermaidValue(value)

/**
 * `--math-fonts <mode>` のパース結果 (DESIGN.md §3 / §12 §14 Math Rendering)。
 * - `minimal` (既定): Main / AMS / Math / Size1-4 の 9 family のみ inline
 * - `all`: 全 20 family を inline
 */
export type MathFontsMode = 'all' | 'minimal'
const MATH_FONTS_VALUES = ['minimal', 'all'] as const

const isMathFontsMode = (value: string): value is MathFontsMode =>
  (MATH_FONTS_VALUES as readonly string[]).includes(value)

/**
 * `--math-fonts` の値を MathFontsMode にパースする。pure。
 */
export const parseMathFontsValue = (value: string): MathFontsMode | null => {
  const trimmed = value.trim()
  if (isMathFontsMode(trimmed)) {
    return trimmed
  }
  return null
}

/**
 * `--shiki-langs <mode>` のパース結果。
 * - `auto`: markdown をスキャンして必要 grammar だけを注入 (CLI 既定)
 * - `all`: Shiki bundled 全言語を注入
 * - `none`: 注入しない (全コードブロックを plain text fallback)
 * - `list`: CSV で明示指定された正規名集合だけを注入 (エイリアスは正規化済み)
 */
export type ShikiLangsMode =
  | { kind: 'all' }
  | { kind: 'auto' }
  | { kind: 'list'; langs: ReadonlySet<SupportedLang> }
  | { kind: 'none' }

const parseShikiLangsKeyword = (trimmed: string): ShikiLangsMode | null => {
  if (trimmed === 'auto') {
    return { kind: 'auto' }
  }
  if (trimmed === 'all') {
    return { kind: 'all' }
  }
  if (trimmed === 'none') {
    return { kind: 'none' }
  }
  return null
}

const parseShikiLangsList = (trimmed: string): ShikiLangsMode => {
  const tokens = trimmed
    .split(',')
    .map((token: string): string => token.trim())
    .filter((token: string): boolean => token.length > 0)
  const langs = new Set<SupportedLang>()
  for (const token of tokens) {
    const canonical = normalizeLangIdentifier(token)
    if (canonical !== null) {
      langs.add(canonical)
    }
  }
  return { kind: 'list', langs }
}

/**
 * `--shiki-langs` の値を ShikiLangsMode にパースする。pure。
 * 空白だけ / 未サポートのみは空 list (= none と等価) を返す。
 */
export const parseShikiLangsValue = (value: string): ShikiLangsMode =>
  parseShikiLangsKeyword(value.trim()) ?? parseShikiLangsList(value.trim())

export interface RunArgs {
  documentName?: string
  inputPath: string
  /** --mermaid モード。未指定なら省略 (CLI 側で auto を既定として解釈) */
  mermaid?: MermaidMode
  open: boolean
  outputDir?: string
  /** --page-nav-width で指定された数値 (0 or 180–480)。未指定なら省略 */
  pageNavWidth?: number
  shikiLangs?: ShikiLangsMode
  /** --comments-width で指定された数値 (0 or 280–640)。未指定なら省略 */
  commentsWidth?: number
  themeHint?: ThemeHint
  /**
   * --show-open-file が明示指定された場合のみ true。CLI 既定は不在 (= hidden 扱い)。
   * 不在 / false の時に <html data-toolbar-open-file="off"> が注入され、ブラウザ側 toolbar.ts が
   * #btn-load / #file-md を DOM から削除する (DESIGN.md §5.g)。
   */
  showOpenFile?: boolean
  /**
   * `--markdown-css <path>` で指定された CSS ファイルパス。指定時は CLI が中身を読み、
   * 配布 HTML の `<style id="markdown-css">` をユーザー指定の CSS で差し替える
   * (DESIGN.md §3 / §12 §1 Theming)。未指定なら省略 (build 時 inline 済みの `src/styles/markdown.css`
   * がそのまま使われる)。
   */
  markdownCssPath?: string
  /** --math モード。未指定なら省略 (CLI 側で auto を既定として解釈) */
  math?: MathMode
  /** --math-fonts モード。未指定なら省略 (CLI 側で minimal を既定として解釈) */
  mathFonts?: MathFontsMode
}

export interface CleanArgsParsed {
  dir: string
  keep: ReadonlySet<string>
  recursive: boolean
  yes: boolean
}

export type ParsedArgs =
  | { mode: 'help' }
  | { mode: 'invalid' }
  | ({ mode: 'run' } & RunArgs)
  | ({ mode: 'clean' } & CleanArgsParsed)

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('parseShikiLangsValue: keyword モード', () => {
    it('auto / all / none を ShikiLangsMode として返す', () => {
      expect(parseShikiLangsValue('auto')).toEqual({ kind: 'auto' })
      expect(parseShikiLangsValue('all')).toEqual({ kind: 'all' })
      expect(parseShikiLangsValue('none')).toEqual({ kind: 'none' })
    })

    it('前後の空白を許容する', () => {
      expect(parseShikiLangsValue('  auto  ')).toEqual({ kind: 'auto' })
    })
  })

  describe('parseShikiLangsValue: list モード', () => {
    it('CSV を正規名 Set にパースする (エイリアスは normalize 済み)', () => {
      const parsed = parseShikiLangsValue('ts,js,py')
      expect(parsed.kind).toBe('list')
      if (parsed.kind === 'list') {
        expect([...parsed.langs].toSorted()).toEqual(['javascript', 'python', 'typescript'])
      }
    })

    it('重複指定 (正規名 + エイリアス) は Set で重複排除される', () => {
      const parsed = parseShikiLangsValue('typescript,ts')
      expect(parsed.kind).toBe('list')
      if (parsed.kind === 'list') {
        expect([...parsed.langs]).toEqual(['typescript'])
      }
    })

    it('未サポート言語のみの指定は空 list (= none と等価) を返す', () => {
      const parsed = parseShikiLangsValue('mylang,xxx-fake')
      expect(parsed.kind).toBe('list')
      if (parsed.kind === 'list') {
        expect(parsed.langs.size).toBe(0)
      }
    })

    it('既知 + 未知の混在は既知のみが残る', () => {
      const parsed = parseShikiLangsValue('ts,mylang,py')
      expect(parsed.kind).toBe('list')
      if (parsed.kind === 'list') {
        expect([...parsed.langs].toSorted()).toEqual(['python', 'typescript'])
      }
    })

    it('空 token (連続カンマ / 末尾カンマ) は無視される', () => {
      const parsed = parseShikiLangsValue('ts,,py,')
      expect(parsed.kind).toBe('list')
      if (parsed.kind === 'list') {
        expect([...parsed.langs].toSorted()).toEqual(['python', 'typescript'])
      }
    })
  })

  describe('parseMermaidValue', () => {
    it('auto / on / off を MermaidMode として返す', () => {
      expect(parseMermaidValue('auto')).toBe('auto')
      expect(parseMermaidValue('on')).toBe('on')
      expect(parseMermaidValue('off')).toBe('off')
    })

    it('前後の空白を許容する', () => {
      expect(parseMermaidValue('  auto  ')).toBe('auto')
    })

    it('未知の値・空文字・大文字は null', () => {
      expect(parseMermaidValue('yes')).toBeNull()
      expect(parseMermaidValue('Auto')).toBeNull()
      expect(parseMermaidValue('')).toBeNull()
    })
  })

  describe('parseMathValue / parseMathFontsValue', () => {
    it('parseMathValue は auto / on / off を返す (MermaidMode と同じ literal)', () => {
      expect(parseMathValue('auto')).toBe('auto')
      expect(parseMathValue('on')).toBe('on')
      expect(parseMathValue('off')).toBe('off')
    })

    it('parseMathValue は前後の空白を許容、未知の値は null', () => {
      expect(parseMathValue('  auto  ')).toBe('auto')
      expect(parseMathValue('yes')).toBeNull()
      expect(parseMathValue('Auto')).toBeNull()
      expect(parseMathValue('')).toBeNull()
    })

    it('parseMathFontsValue は minimal / all を返し、それ以外は null', () => {
      expect(parseMathFontsValue('minimal')).toBe('minimal')
      expect(parseMathFontsValue('all')).toBe('all')
      expect(parseMathFontsValue('  minimal  ')).toBe('minimal')
      expect(parseMathFontsValue('auto')).toBeNull()
      expect(parseMathFontsValue('full')).toBeNull()
      expect(parseMathFontsValue('Minimal')).toBeNull()
      expect(parseMathFontsValue('')).toBeNull()
    })
  })

  describe('parseCommentsWidthValue', () => {
    it('0 は 0 を返す (closed 指定)', () => {
      expect(parseCommentsWidthValue('0')).toBe(0)
    })

    it('280–640 の整数文字列は数値を返す', () => {
      expect(parseCommentsWidthValue('280')).toBe(280)
      expect(parseCommentsWidthValue('360')).toBe(360)
      expect(parseCommentsWidthValue('640')).toBe(640)
    })

    it('前後の空白は許容する', () => {
      expect(parseCommentsWidthValue('  360  ')).toBe(360)
    })

    it('範囲外 (1–279 / 641+ / 負数) は null', () => {
      expect(parseCommentsWidthValue('1')).toBeNull()
      expect(parseCommentsWidthValue('279')).toBeNull()
      expect(parseCommentsWidthValue('641')).toBeNull()
      expect(parseCommentsWidthValue('-100')).toBeNull()
    })

    it('小数・非数値・空文字は null', () => {
      expect(parseCommentsWidthValue('360.5')).toBeNull()
      expect(parseCommentsWidthValue('auto')).toBeNull()
      expect(parseCommentsWidthValue('360px')).toBeNull()
      expect(parseCommentsWidthValue('')).toBeNull()
    })
  })
}
