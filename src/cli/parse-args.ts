// review-request CLI の引数パースと、出力ファイル名 prefix のサニタイズ。
// help テキストも CLI 表示用の単一定数としてここに集約する。

import type { SupportedLang } from '../core/shiki-aliases.generated'
import { normalizeLangIdentifier } from '../core/scan-fenced-langs'

const NO_OPEN_FLAG = '--no-open'
const HELP_FLAGS = new Set(['--help', '-h'])
const DOCUMENT_NAME_FLAG = '--document-name'
const THEME_FLAG = '--theme'
const SHIKI_LANGS_FLAG = '--shiki-langs'
const COMMENTS_WIDTH_FLAG = '--comments-width'
const PAGE_NAV_WIDTH_FLAG = '--page-nav-width'
const SHOW_OPEN_FILE_FLAG = '--show-open-file'
const MERMAID_FLAG = '--mermaid'
const MATH_FLAG = '--math'
const MATH_FONTS_FLAG = '--math-fonts'
const MARKDOWN_CSS_FLAG = '--markdown-css'
const CLEAN_FLAG = '--clean'
const YES_FLAG = '--yes'
const KEEP_FLAG = '--keep'
const HEX_16_PATTERN = /^[0-9a-f]{16}$/i

export type ThemeHint = 'system' | 'light' | 'dark'
const THEME_VALUES = ['system', 'light', 'dark'] as const

const isThemeHint = (value: string): value is ThemeHint =>
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
 * - `auto` (既定): markdown を countMath で走査し、$...$ / $$...$$ があるときだけ KaTeX runtime を注入
 * - `on`: 件数に関係なく必ず注入
 * - `off`: 注入しない ($...$ / $$...$$ は raw な markdown 文法のまま plain text 表示)
 *
 * MermaidMode と意味論を完全に揃えるため同じ '`auto' | 'on' | 'off'` を再利用する。
 */
export type MathMode = MermaidMode

/**
 * `--math` の値を MathMode にパースする。MermaidMode と同じ literal を共有しているので
 * 受け付ける値も同じ。CLI 側の dispatch だけが分かれる。
 */
export const parseMathValue = (value: string): MathMode | null => parseMermaidValue(value)

/**
 * `--math-fonts <mode>` のパース結果 (docs/mdxg-math-rendering.archive.md §5.g / §5.l)。
 * - `minimal` (既定): Main / AMS / Math / Size1-4 の 9 family のみ inline。\mathcal / \mathfrak /
 *   \mathscr / SansSerif / Typewriter は OS フォントへ fallback
 * - `all`: 全 20 family を inline。珍しい数式記号も完全な字形で描画
 */
export type MathFontsMode = 'all' | 'minimal'
const MATH_FONTS_VALUES = ['minimal', 'all'] as const

const isMathFontsMode = (value: string): value is MathFontsMode =>
  (MATH_FONTS_VALUES as readonly string[]).includes(value)

/**
 * `--math-fonts` の値を MathFontsMode にパースする。pure な関数で、CLI 引数パースと
 * 単体テストの両方から再利用する。未知の値・空文字は null を返し、CLI 側で invalid 扱い。
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
 *
 * 既定が `auto` なのは、配布者が何も指定しなくても配布物サイズが最小化される
 * (仕様書系で +0 KB / コード混在レビューで +100〜300 KB) よう倒すため。
 * `all` は +1〜1.5 MB gzip で重く、`none` は MDXG §2 [MUST] (シンタックス
 * ハイライト) を満たさない。
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
 * `--shiki-langs` の値を ShikiLangsMode にパースする。pure な関数で、CLI 引数パースと
 * 単体テストの両方から再利用する。空白だけ / 未サポートのみは空 list (= none と等価) を返す。
 */
export const parseShikiLangsValue = (value: string): ShikiLangsMode =>
  parseShikiLangsKeyword(value.trim()) ?? parseShikiLangsList(value.trim())

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
  --theme <value>        Set the initial theme hint for the generated HTML.
                         One of: system | light | dark. Written as a
                         <html data-theme> attribute and used only when the
                         viewer has no localStorage preference yet (the user's
                         UI toggle history always wins). Omit to leave the
                         attribute off entirely.
  --shiki-langs <value>  Select which Shiki grammars to embed in the HTML
                         for syntax highlighting. One of:
                           auto  Scan the input markdown and embed only the
                                 grammars used by fenced blocks (default).
                           all   Embed all Shiki-bundled grammars (heaviest,
                                 ~235 languages, ~5.5 MB gzipped).
                           none  Embed no grammars (all code blocks render as
                                 plain text).
                           <csv> Comma-separated list of language identifiers
                                 (e.g. ts,js,py). Aliases are normalized to
                                 canonical names; unsupported entries are
                                 silently ignored.
  --comments-width <px>   Set the initial comments-panel width hint for the
                         generated HTML. One of:
                           0         Start with the comments panel closed (only the
                                     edge tab is visible until the user opens
                                     it).
                           280–640   Start open with the given width in pixels.
                         Written as a <html data-comments-width> attribute and
                         used only when the viewer has no localStorage
                         preference yet (the user's UI history always wins).
                         Omit to leave the attribute off entirely.
  --page-nav-width <px>  Set the initial document-pages panel (left TOC) width
                         hint. One of:
                           0         Start with the panel closed (only the left
                                     edge tab is visible).
                           180–480   Start open with the given width in pixels.
                         Written as a <html data-page-nav-width> attribute and
                         follows the same precedence rules as --comments-width.
  --mermaid <value>      Control Mermaid runtime injection for \`\`\`mermaid blocks.
                         One of:
                           auto  Inject Mermaid only if the markdown contains at
                                 least one \`\`\`mermaid block (default). Keeps
                                 distribution size minimal when not used.
                           on    Always inject. Adds ~700 KB gzipped to the
                                 distribution HTML.
                           off   Never inject. \`\`\`mermaid blocks fall back to
                                 Shiki-highlighted code blocks (MDXG §15 [MUST]).
  --math <value>         Control KaTeX runtime injection for $...$ / $$...$$
                         math expressions (MDXG §14). One of:
                           auto  Inject KaTeX only if the markdown contains at
                                 least one math expression (default).
                           on    Always inject. Adds ~250 / ~350 KB gzipped
                                 depending on --math-fonts.
                           off   Never inject. $...$ / $$...$$ render as raw
                                 markdown text (MDXG §14 [MUST]).
  --math-fonts <value>   Choose the KaTeX woff2 font set embedded as data URI
                         (only meaningful when KaTeX is injected). One of:
                           minimal  Main / AMS / Math / Size1-4 only, +~110 KB
                                    gzipped (default). \\mathcal / \\mathfrak /
                                    \\mathscr / SansSerif / Typewriter fall back
                                    to the host's system font.
                           all      Embed all 20 woff2 families, +~220 KB gzipped.
                                    Use when the document relies on rare math
                                    glyphs (\\mathcal{X}, \\mathfrak{X}, ...).
  --markdown-css <path>  Replace the bundled markdown preview stylesheet with the
                         CSS file at <path>. Targets only the markdown preview
                         (#doc scope). Layout / chrome (review.css) is not
                         affected. Useful for distributing review HTML with a
                         custom typographic theme.
  --no-open              Generate the HTML but do not launch a browser.
  --show-open-file       Keep the "Open file" button visible in the generated
                         HTML's header. By default (without this flag), CLI
                         output hides the button to prevent accidentally
                         loading a different markdown (which would discard the
                         current comments). The standalone HTML — opened
                         directly without the CLI — always shows the button.
  -h, --help             Print this help and exit. Takes precedence over all
                         other arguments and flags when present.

Cleanup mode:
  --clean <dir>          Remove all *-<docHash>-review.html and
                         *-<docHash>-feedback.json files in <dir> (top level
                         only). By default runs in dry-run mode and only
                         prints the candidates; pass --yes to actually delete.
  --yes                  With --clean, perform deletion (no prompt). Without
                         --yes, --clean is dry-run.
  --keep <docHash>       With --clean, preserve files whose 16-hex docHash
                         matches. May be repeated.

Examples:
  mdxg-redline spec.md
  mdxg-redline spec.md ./reviews
  mdxg-redline --no-open spec.md
  mdxg-redline --theme dark spec.md
  cat spec.md | mdxg-redline - --document-name spec.md
  mdxg-redline --clean ./reviews
  mdxg-redline --clean ./reviews --yes
  mdxg-redline --clean ./reviews --keep a1b2c3d4e5f6a7b8 --yes
`

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
  yes: boolean
}

export type ParsedArgs =
  | { mode: 'help' }
  | { mode: 'invalid' }
  | ({ mode: 'run' } & RunArgs)
  | ({ mode: 'clean' } & CleanArgsParsed)

interface CleanPartitionState {
  dir: string | null
  keep: Set<string>
  pendingDir: boolean
  pendingKeep: boolean
  valid: boolean
  yes: boolean
}

const INITIAL_CLEAN_STATE: CleanPartitionState = {
  dir: null,
  keep: new Set(),
  pendingDir: false,
  pendingKeep: false,
  valid: true,
  yes: false,
}

const consumeCleanDirValue = (acc: CleanPartitionState, token: string): CleanPartitionState => {
  if (token.startsWith('--')) {
    return { ...acc, valid: false }
  }
  return { ...acc, dir: token, pendingDir: false }
}

const consumeCleanKeepValue = (acc: CleanPartitionState, token: string): CleanPartitionState => {
  if (!HEX_16_PATTERN.test(token)) {
    return { ...acc, valid: false }
  }
  const next = new Set(acc.keep)
  next.add(token.toLowerCase())
  return { ...acc, keep: next, pendingKeep: false }
}

// --clean は 1 回のみ許容する (複数指定で後勝ちになると意図が曖昧になり、誤って別ディレクトリを
// 削除しかける事故が起きやすいため、構造的に弾く)。--yes は冪等なので重複でも valid のまま。
// --keep は仕様上繰り返し指定で hash を蓄積するため、ここでは重複チェックしない。
const markCleanFlag = (acc: CleanPartitionState): CleanPartitionState => {
  if (acc.dir !== null || acc.pendingDir) {
    return { ...acc, valid: false }
  }
  return { ...acc, pendingDir: true }
}

const CLEAN_FLAG_TABLE: readonly {
  flag: string
  mark: (acc: CleanPartitionState) => CleanPartitionState
}[] = [
  { flag: CLEAN_FLAG, mark: markCleanFlag },
  { flag: KEEP_FLAG, mark: (acc): CleanPartitionState => ({ ...acc, pendingKeep: true }) },
  { flag: YES_FLAG, mark: (acc): CleanPartitionState => ({ ...acc, yes: true }) },
]

const stepCleanArg = (acc: CleanPartitionState, token: string): CleanPartitionState => {
  if (!acc.valid) {
    return acc
  }
  if (acc.pendingDir) {
    return consumeCleanDirValue(acc, token)
  }
  if (acc.pendingKeep) {
    return consumeCleanKeepValue(acc, token)
  }
  const entry = CLEAN_FLAG_TABLE.find((row): boolean => row.flag === token)
  if (!entry) {
    return { ...acc, valid: false }
  }
  return entry.mark(acc)
}

const parseCleanArgs = (argv: readonly string[]): ParsedArgs => {
  const state = argv.reduce<CleanPartitionState>(stepCleanArg, INITIAL_CLEAN_STATE)
  if (!state.valid || state.pendingDir || state.pendingKeep || state.dir === null) {
    return { mode: 'invalid' }
  }
  return { dir: state.dir, keep: state.keep, mode: 'clean', yes: state.yes }
}

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

// --document-name の値位置で受け取った token を処理する。次に来た token が別フラグなら
// 値欠落として invalid 扱い、それ以外は文字列値として保存する。
const consumeDocNameValue = (acc: PartitionState, token: string): PartitionState => {
  if (token.startsWith('--')) {
    return { ...acc, valid: false }
  }
  return { ...acc, documentName: token, pendingDocName: false }
}

// --theme の値位置。許容値 (system|light|dark) 以外は invalid。`-` 始まりも値欠落扱い。
const consumeThemeValue = (acc: PartitionState, token: string): PartitionState => {
  if (token.startsWith('--') || !isThemeHint(token)) {
    return { ...acc, valid: false }
  }
  return { ...acc, pendingTheme: false, themeHint: token }
}

// --shiki-langs の値位置。auto / all / none / CSV を受け付ける。`-` 始まりは値欠落扱い。
// CSV のうち未サポート識別子は parseShikiLangsValue 内で silently drop されるため、
// `--shiki-langs mylang,xxx-fake` のような全滅入力でも invalid にはせず空 list (= none と同等) を返す。
const consumeShikiLangsValue = (acc: PartitionState, token: string): PartitionState => {
  if (token.startsWith('--')) {
    return { ...acc, valid: false }
  }
  return { ...acc, pendingShikiLangs: false, shikiLangs: parseShikiLangsValue(token) }
}

// --comments-width の値位置。0 or 280–640 の整数のみ valid。`-` 始まりや範囲外は invalid。
const consumeCommentsWidthValue = (acc: PartitionState, token: string): PartitionState => {
  if (token.startsWith('--')) {
    return { ...acc, valid: false }
  }
  const parsed = parseCommentsWidthValue(token)
  if (parsed === null) {
    return { ...acc, valid: false }
  }
  return { ...acc, commentsWidth: parsed, pendingCommentsWidth: false }
}

// --mermaid の値位置。auto / on / off のみ valid。`-` 始まりは値欠落扱い。
const consumeMermaidValue = (acc: PartitionState, token: string): PartitionState => {
  if (token.startsWith('--')) {
    return { ...acc, valid: false }
  }
  const parsed = parseMermaidValue(token)
  if (parsed === null) {
    return { ...acc, valid: false }
  }
  return { ...acc, mermaid: parsed, pendingMermaid: false }
}

// --math の値位置。auto / on / off のみ valid。--mermaid と完全に対称。
const consumeMathValue = (acc: PartitionState, token: string): PartitionState => {
  if (token.startsWith('--')) {
    return { ...acc, valid: false }
  }
  const parsed = parseMathValue(token)
  if (parsed === null) {
    return { ...acc, valid: false }
  }
  return { ...acc, math: parsed, pendingMath: false }
}

// --math-fonts の値位置。minimal / all のみ valid。`-` 始まりは値欠落扱い。
const consumeMathFontsValue = (acc: PartitionState, token: string): PartitionState => {
  if (token.startsWith('--')) {
    return { ...acc, valid: false }
  }
  const parsed = parseMathFontsValue(token)
  if (parsed === null) {
    return { ...acc, valid: false }
  }
  return { ...acc, mathFonts: parsed, pendingMathFonts: false }
}

// --markdown-css の値位置。任意のパス文字列を受け入れ、ファイル存在チェックは CLI 側で行う。
// `-` 始まりは値欠落扱い。stdin (`-`) は別系統 (input markdown) でしか使わないため、CSS で
// `-` を許す必要はない。
const consumeMarkdownCssValue = (acc: PartitionState, token: string): PartitionState => {
  if (token.startsWith('--') || token === '-') {
    return { ...acc, valid: false }
  }
  return { ...acc, markdownCssPath: token, pendingMarkdownCss: false }
}

// --page-nav-width の値位置。0 or 180–480 の整数のみ valid。
const consumePageNavWidthValue = (acc: PartitionState, token: string): PartitionState => {
  if (token.startsWith('--')) {
    return { ...acc, valid: false }
  }
  const parsed = parsePageNavWidthValue(token)
  if (parsed === null) {
    return { ...acc, valid: false }
  }
  return { ...acc, pageNavWidth: parsed, pendingPageNavWidth: false }
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

// 値待ちフラグがあるならその consumer に委譲し、無ければ null を返す。max-statements を
// 抑えるためテーブル駆動で書く。
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

const PENDING_VALUE_TABLE: readonly {
  consume: (acc: PartitionState, token: string) => PartitionState
  key: PendingFlagKey
}[] = [
  { consume: consumeDocNameValue, key: 'pendingDocName' },
  { consume: consumeThemeValue, key: 'pendingTheme' },
  { consume: consumeShikiLangsValue, key: 'pendingShikiLangs' },
  { consume: consumeCommentsWidthValue, key: 'pendingCommentsWidth' },
  { consume: consumePageNavWidthValue, key: 'pendingPageNavWidth' },
  { consume: consumeMermaidValue, key: 'pendingMermaid' },
  { consume: consumeMathValue, key: 'pendingMath' },
  { consume: consumeMathFontsValue, key: 'pendingMathFonts' },
  { consume: consumeMarkdownCssValue, key: 'pendingMarkdownCss' },
]

const consumePendingValue = (acc: PartitionState, token: string): PartitionState | null => {
  const entry = PENDING_VALUE_TABLE.find((row): boolean => acc[row.key])
  if (!entry) {
    return null
  }
  return entry.consume(acc, token)
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

// 位置引数 (<input.md|->, [output-dir]) と --no-open / --document-name / -h / --help を
// 混在順序で受け付ける。引数なし or -h / --help は help モード（他の引数が混じっていても
// help を最優先する）。未知フラグ・位置引数の個数違反・--document-name の値欠落は invalid。
const parseRunArgs = (argv: readonly string[]): ParsedArgs => {
  const parts = partitionArgs(argv)
  if (!parts.valid) {
    return { mode: 'invalid' }
  }
  if (parts.positional.length < 1 || parts.positional.length > 2) {
    return { mode: 'invalid' }
  }
  return buildRunArgs(parts)
}

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

  describe('parseArgs: --show-open-file', () => {
    it('--show-open-file 指定で showOpenFile=true を返す', () => {
      expect(parseArgs(['--show-open-file', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
        showOpenFile: true,
      })
    })

    it('--show-open-file 未指定では showOpenFile を含まない (= 既定 hidden)', () => {
      const result = parseArgs(['spec.md'])
      expect(result).toEqual({ inputPath: 'spec.md', mode: 'run', open: true })
      if (result.mode === 'run') {
        expect(result.showOpenFile).toBeUndefined()
      }
    })

    it('--show-open-file は --no-open / output-dir と組み合わせられる', () => {
      expect(parseArgs(['--no-open', '--show-open-file', 'spec.md', '/tmp/out'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: false,
        outputDir: '/tmp/out',
        showOpenFile: true,
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

  describe('parseArgs: --clean', () => {
    it('--clean <dir> だけで dry-run の clean モードを返す', () => {
      const parsed = parseArgs(['--clean', '/tmp/x'])
      expect(parsed.mode).toBe('clean')
      if (parsed.mode === 'clean') {
        expect(parsed.dir).toBe('/tmp/x')
        expect(parsed.yes).toBe(false)
        expect([...parsed.keep]).toEqual([])
      }
    })

    it('--yes 付きで yes=true', () => {
      const parsed = parseArgs(['--clean', '/tmp/x', '--yes'])
      expect(parsed.mode).toBe('clean')
      if (parsed.mode === 'clean') {
        expect(parsed.yes).toBe(true)
      }
    })

    it('--keep を複数指定すると Set に重複なく蓄積される', () => {
      const parsed = parseArgs([
        '--clean',
        '/tmp/x',
        '--keep',
        'a1b2c3d4e5f6a7b8',
        '--keep',
        'A1B2C3D4E5F6A7B8',
        '--keep',
        '1111111111111111',
      ])
      expect(parsed.mode).toBe('clean')
      if (parsed.mode === 'clean') {
        expect([...parsed.keep].toSorted()).toEqual(['1111111111111111', 'a1b2c3d4e5f6a7b8'])
      }
    })

    it('--clean の値欠落は invalid', () => {
      expect(parseArgs(['--clean'])).toEqual({ mode: 'invalid' })
    })

    it('--clean の値位置に別フラグが来た場合は invalid', () => {
      expect(parseArgs(['--clean', '--yes'])).toEqual({ mode: 'invalid' })
    })

    it('--keep の値が 16 桁 hex でない場合は invalid', () => {
      expect(parseArgs(['--clean', '/tmp/x', '--keep', 'abc'])).toEqual({ mode: 'invalid' })
      expect(parseArgs(['--clean', '/tmp/x', '--keep', 'zzzzzzzzzzzzzzzz'])).toEqual({
        mode: 'invalid',
      })
    })

    it('--keep の値欠落は invalid', () => {
      expect(parseArgs(['--clean', '/tmp/x', '--keep'])).toEqual({ mode: 'invalid' })
    })

    it('clean モードでは run モード用フラグ (--no-open / --theme 等) は invalid', () => {
      expect(parseArgs(['--clean', '/tmp/x', '--no-open'])).toEqual({ mode: 'invalid' })
      expect(parseArgs(['--clean', '/tmp/x', '--theme', 'dark'])).toEqual({ mode: 'invalid' })
    })

    it('--clean を 2 回以上指定すると invalid (後勝ちで誤ディレクトリ削除を防ぐ)', () => {
      expect(parseArgs(['--clean', '/tmp/a', '--clean', '/tmp/b'])).toEqual({ mode: 'invalid' })
      expect(parseArgs(['--clean', '/tmp/a', '--clean', '/tmp/b', '--yes'])).toEqual({
        mode: 'invalid',
      })
    })
  })

  describe('parseArgs: --theme', () => {
    it('--theme system / light / dark がパースされる', () => {
      expect(parseArgs(['--theme', 'system', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
        themeHint: 'system',
      })
      expect(parseArgs(['--theme', 'light', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
        themeHint: 'light',
      })
      expect(parseArgs(['--theme', 'dark', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
        themeHint: 'dark',
      })
    })

    it('--theme が末尾にあって値が無い場合は invalid', () => {
      expect(parseArgs(['spec.md', '--theme'])).toEqual({ mode: 'invalid' })
    })

    it('--theme の値位置に別フラグが来た場合は invalid', () => {
      expect(parseArgs(['--theme', '--no-open', 'spec.md'])).toEqual({ mode: 'invalid' })
    })

    it('--theme の値が許容外 (auto / 空文字 / 大文字) は invalid', () => {
      expect(parseArgs(['--theme', 'auto', 'spec.md'])).toEqual({ mode: 'invalid' })
      expect(parseArgs(['--theme', '', 'spec.md'])).toEqual({ mode: 'invalid' })
      expect(parseArgs(['--theme', 'Dark', 'spec.md'])).toEqual({ mode: 'invalid' })
    })

    it('--theme 未指定時は themeHint が含まれない (data-theme 属性は付かない)', () => {
      expect(parseArgs(['spec.md'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
      })
    })

    it('--theme と他のフラグ・位置引数の組み合わせも認識する', () => {
      expect(
        parseArgs([
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

  describe('parseArgs: --shiki-langs', () => {
    it('--shiki-langs auto / all / none が認識される', () => {
      expect(parseArgs(['--shiki-langs', 'auto', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
        shikiLangs: { kind: 'auto' },
      })
      expect(parseArgs(['--shiki-langs', 'all', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
        shikiLangs: { kind: 'all' },
      })
      expect(parseArgs(['--shiki-langs', 'none', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
        shikiLangs: { kind: 'none' },
      })
    })

    it('--shiki-langs ts,js が list として認識される (エイリアス正規化)', () => {
      const parsed = parseArgs(['--shiki-langs', 'ts,js', 'spec.md'])
      expect(parsed.mode).toBe('run')
      if (parsed.mode === 'run' && parsed.shikiLangs && parsed.shikiLangs.kind === 'list') {
        expect([...parsed.shikiLangs.langs].toSorted()).toEqual(['javascript', 'typescript'])
      }
    })

    it('--shiki-langs が末尾にあって値が無い場合は invalid', () => {
      expect(parseArgs(['spec.md', '--shiki-langs'])).toEqual({ mode: 'invalid' })
    })

    it('--shiki-langs の値位置に別フラグが来た場合は invalid', () => {
      expect(parseArgs(['--shiki-langs', '--no-open', 'spec.md'])).toEqual({ mode: 'invalid' })
    })

    it('--shiki-langs 未指定時は shikiLangs が含まれない', () => {
      expect(parseArgs(['spec.md'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
      })
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

  describe('parseArgs: --mermaid', () => {
    it('--mermaid auto / on / off が認識される', () => {
      expect(parseArgs(['--mermaid', 'auto', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        mermaid: 'auto',
        mode: 'run',
        open: true,
      })
      expect(parseArgs(['--mermaid', 'on', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        mermaid: 'on',
        mode: 'run',
        open: true,
      })
      expect(parseArgs(['--mermaid', 'off', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        mermaid: 'off',
        mode: 'run',
        open: true,
      })
    })

    it('--mermaid が末尾にあって値が無い場合は invalid', () => {
      expect(parseArgs(['spec.md', '--mermaid'])).toEqual({ mode: 'invalid' })
    })

    it('--mermaid の値位置に別フラグが来た場合は invalid', () => {
      expect(parseArgs(['--mermaid', '--no-open', 'spec.md'])).toEqual({ mode: 'invalid' })
    })

    it('--mermaid の値が許容外 (yes / Auto / 空文字) は invalid', () => {
      expect(parseArgs(['--mermaid', 'yes', 'spec.md'])).toEqual({ mode: 'invalid' })
      expect(parseArgs(['--mermaid', 'Auto', 'spec.md'])).toEqual({ mode: 'invalid' })
    })

    it('--mermaid 未指定時は mermaid が含まれない (CLI 側で auto 既定として解釈)', () => {
      expect(parseArgs(['spec.md'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
      })
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

  describe('parseArgs: --math / --math-fonts', () => {
    it('--math auto / on / off が認識される', () => {
      expect(parseArgs(['--math', 'auto', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        math: 'auto',
        mode: 'run',
        open: true,
      })
      expect(parseArgs(['--math', 'on', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        math: 'on',
        mode: 'run',
        open: true,
      })
      expect(parseArgs(['--math', 'off', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        math: 'off',
        mode: 'run',
        open: true,
      })
    })

    it('--math-fonts minimal / all が認識される', () => {
      expect(parseArgs(['--math-fonts', 'minimal', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        mathFonts: 'minimal',
        mode: 'run',
        open: true,
      })
      expect(parseArgs(['--math-fonts', 'all', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        mathFonts: 'all',
        mode: 'run',
        open: true,
      })
    })

    it('--math と --math-fonts は組み合わせて指定できる', () => {
      expect(parseArgs(['--math', 'on', '--math-fonts', 'all', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        math: 'on',
        mathFonts: 'all',
        mode: 'run',
        open: true,
      })
    })

    it('--math が末尾で値が無い場合は invalid', () => {
      expect(parseArgs(['spec.md', '--math'])).toEqual({ mode: 'invalid' })
    })

    it('--math の値位置に別フラグが来た場合は invalid', () => {
      expect(parseArgs(['--math', '--no-open', 'spec.md'])).toEqual({ mode: 'invalid' })
    })

    it('--math の値が許容外 (yes / Auto / 空文字) は invalid', () => {
      expect(parseArgs(['--math', 'yes', 'spec.md'])).toEqual({ mode: 'invalid' })
      expect(parseArgs(['--math', 'Auto', 'spec.md'])).toEqual({ mode: 'invalid' })
    })

    it('--math-fonts が末尾で値が無い場合は invalid', () => {
      expect(parseArgs(['spec.md', '--math-fonts'])).toEqual({ mode: 'invalid' })
    })

    it('--math-fonts の値が許容外 (full / Minimal / 空文字) は invalid', () => {
      expect(parseArgs(['--math-fonts', 'full', 'spec.md'])).toEqual({ mode: 'invalid' })
      expect(parseArgs(['--math-fonts', 'Minimal', 'spec.md'])).toEqual({ mode: 'invalid' })
    })

    it('--math / --math-fonts 未指定時は対応プロパティを含まない', () => {
      expect(parseArgs(['spec.md'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
      })
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

  describe('parseArgs: --comments-width', () => {
    it('--comments-width 0 は closed 指定として認識される', () => {
      expect(parseArgs(['--comments-width', '0', 'spec.md'])).toEqual({
        commentsWidth: 0,
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
      })
    })

    it('--comments-width 320 は open + 幅 320 として認識される', () => {
      expect(parseArgs(['--comments-width', '320', 'spec.md'])).toEqual({
        commentsWidth: 320,
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
      })
    })

    it('--comments-width 640 (上限) も valid', () => {
      expect(parseArgs(['--comments-width', '640', 'spec.md'])).toEqual({
        commentsWidth: 640,
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
      })
    })

    it('--comments-width が末尾にあって値が無い場合は invalid', () => {
      expect(parseArgs(['spec.md', '--comments-width'])).toEqual({ mode: 'invalid' })
    })

    it('--comments-width の値位置に別フラグが来た場合は invalid', () => {
      expect(parseArgs(['--comments-width', '--no-open', 'spec.md'])).toEqual({ mode: 'invalid' })
    })

    it('--comments-width 範囲外 (279 / 641) は invalid', () => {
      expect(parseArgs(['--comments-width', '279', 'spec.md'])).toEqual({ mode: 'invalid' })
      expect(parseArgs(['--comments-width', '641', 'spec.md'])).toEqual({ mode: 'invalid' })
    })

    it('--comments-width 非数値 (auto / px 単位付き) は invalid', () => {
      expect(parseArgs(['--comments-width', 'auto', 'spec.md'])).toEqual({ mode: 'invalid' })
      expect(parseArgs(['--comments-width', '360px', 'spec.md'])).toEqual({ mode: 'invalid' })
    })

    it('--comments-width 未指定時は commentsWidth が含まれない', () => {
      expect(parseArgs(['spec.md'])).toEqual({
        inputPath: 'spec.md',
        mode: 'run',
        open: true,
      })
    })

    it('--comments-width と他のフラグの組み合わせも認識する', () => {
      expect(
        parseArgs([
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

  // VALUE_FLAG_TABLE と PENDING_VALUE_TABLE の対応漏れは型では検出できない (mark が
  // 立てる pending* キーと PENDING_VALUE_TABLE の key が runtime でのみ結びつく)。
  // 片方だけ追加 / 削除した場合に「値が消費されない」「未定義の pending を見に行く」
  // 等の silent な不具合になるため、両テーブルの整合性を機械的に検証する。
  describe('VALUE_FLAG_TABLE / PENDING_VALUE_TABLE 整合性', () => {
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

    it('VALUE_FLAG_TABLE が立てる全ての pending キーは PENDING_VALUE_TABLE に entry を持つ', () => {
      const handledKeys = new Set(PENDING_VALUE_TABLE.map((row): PendingFlagKey => row.key))
      for (const entry of VALUE_FLAG_TABLE) {
        const [pendingKey] = collectPendingKeys(entry.mark(INITIAL_PARTITION_STATE))
        expect(pendingKey, `flag=${entry.flag}`).toBeDefined()
        expect(handledKeys.has(pendingKey), `flag=${entry.flag}, key=${pendingKey}`).toBe(true)
      }
    })

    it('PENDING_VALUE_TABLE の全 key は VALUE_FLAG_TABLE のいずれかで立てられる (dead entry が無い)', () => {
      const reachable = new Set<PendingFlagKey>()
      for (const entry of VALUE_FLAG_TABLE) {
        for (const key of collectPendingKeys(entry.mark(INITIAL_PARTITION_STATE))) {
          reachable.add(key)
        }
      }
      for (const row of PENDING_VALUE_TABLE) {
        expect(reachable.has(row.key), `key=${row.key}`).toBe(true)
      }
    })

    it('PENDING_VALUE_TABLE の key は重複しない', () => {
      const keys = PENDING_VALUE_TABLE.map((row): PendingFlagKey => row.key)
      expect(new Set(keys).size).toBe(keys.length)
    })

    it('VALUE_FLAG_TABLE の flag は重複しない', () => {
      const flags = VALUE_FLAG_TABLE.map((row): string => row.flag)
      expect(new Set(flags).size).toBe(flags.length)
    })
  })
}
