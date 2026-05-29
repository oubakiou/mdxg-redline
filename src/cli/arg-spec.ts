// review-request CLI の flag 定数 と value parser 群。
// parse-args.ts の partition / dispatch ロジックから分離し、「どんな flag があり、
// 各値はどうパースするか」だけを 1 か所に寄せる。CLI 引数追加時の編集箇所をここに集約する。
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
 * `--math <mode>` のパース結果 (docs/mdxg-math-rendering.archive.md §3.2 / §4 Step 4)。
 * MermaidMode と意味論を完全に揃えるため同じ 'auto' | 'on' | 'off' を再利用する。
 */
export type MathMode = MermaidMode

/**
 * `--math` の値を MathMode にパースする。MermaidMode と同じ literal を共有しているので
 * 受け付ける値も同じ。CLI 側の dispatch だけが分かれる。
 */
export const parseMathValue = (value: string): MathMode | null => parseMermaidValue(value)

/**
 * `--math-fonts <mode>` のパース結果 (docs/mdxg-math-rendering.archive.md §5.g / §5.l)。
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
