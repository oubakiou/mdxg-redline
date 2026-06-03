// 左右サイドバーの幅 + open/closed 状態を扱う共通 factory。
// 純粋関数 (clamp / isValid / parseHint / resolveEffectiveState / shouldSnapToClosed) と
// DOM / localStorage 副作用関数を 1 つの config から派生させる。
//
// 右パネル (comments) と左パネル (page-nav) は値域・storage key・default 幅が異なるだけで
// 構造的に対称な実装になっているため、本 factory で 1 か所に統合する
// (DESIGN.md §7c / §12 §1 Theming 行の優先順位 P1 と同じ規約)。
// 優先順位 P1 は CLI hint > localStorage > default。CLI で `--comments-width 0` のような
// 明示指定があれば毎回必ずそれを尊重し、明示指定が無い場合だけユーザーが UI で操作した
// localStorage 値を引き継ぐ。
// 個別の named export と値域定数は src/app/{comments/comments-width,navigation/page-nav-width}.ts の薄い wrapper で再公開する。

export type SidebarOpenState = 'open' | 'closed'

export interface SidebarState {
  open: SidebarOpenState
  /** 開いている時の幅 (minWidth–maxWidth)。closed のときも「次に開いた時の幅」として保持する */
  width: number
}

export interface SidebarHint {
  open: SidebarOpenState
  /** open のときの幅。closed 指定 (width: null) のときは後段で default を適用 */
  width: number | null
}

export interface SidebarWidthConfig {
  /** `<html>` に toggle する class 名 (例: 'comments-closed') */
  closedClassName: string
  /** `<html>` の CSS variable 名 (例: '--comments-width') */
  cssVarName: string
  /** `<html>` から CLI hint を読む属性名 (例: 'data-comments-width') */
  dataAttrName: string
  defaultWidth: number
  maxWidth: number
  minWidth: number
  openStorageKey: string
  widthStorageKey: string
}

export interface SidebarWidthModule {
  applyState: (state: SidebarState) => void
  clampWidth: (value: number) => number
  isOpenState: (value: unknown) => value is SidebarOpenState
  isValidStoredWidth: (value: unknown) => value is number
  parseHint: (raw: string | null) => SidebarHint | null
  readCliHint: () => SidebarHint | null
  readStoredOpen: () => SidebarOpenState | null
  readStoredWidth: () => number | null
  resolveEffectiveState: (
    storedWidth: number | null,
    storedOpen: SidebarOpenState | null,
    cliHint: SidebarHint | null
  ) => SidebarState
  shouldSnapToClosed: (draftWidth: number) => boolean
  writeStoredOpen: (value: SidebarOpenState) => void
  writeStoredWidth: (value: number) => void
}

const OPEN_VALUES: readonly SidebarOpenState[] = ['open', 'closed']

const isOpenStateImpl = (value: unknown): value is SidebarOpenState =>
  typeof value === 'string' && (OPEN_VALUES as readonly string[]).includes(value)

const hintWidth = (cliHint: SidebarHint | null): number | null => {
  if (cliHint === null) {
    return null
  }
  return cliHint.width
}

const hintOpen = (cliHint: SidebarHint | null): SidebarOpenState | null => {
  if (cliHint === null) {
    return null
  }
  return cliHint.open
}

// factory は config をクロージャ捕捉した 13 個の pure 関数を組み立てるため、
// max-statements (既定 10) を超える。各 inner 関数自体は短く、責務単位の分割では
// かえって config の引き渡しが冗長になるためファクトリー全体でルールを緩める。
// eslint-disable-next-line max-statements
export const createSidebarWidthModule = (config: SidebarWidthConfig): SidebarWidthModule => {
  const isValidStoredWidth = (value: unknown): value is number =>
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= config.minWidth &&
    value <= config.maxWidth

  const clampWidth = (value: number): number => {
    if (!Number.isFinite(value)) {
      return config.defaultWidth
    }
    const rounded = Math.round(value)
    if (rounded < config.minWidth) {
      return config.minWidth
    }
    if (rounded > config.maxWidth) {
      return config.maxWidth
    }
    return rounded
  }

  // snap 閾値は minWidth と同値 (これ未満にドラッグされたら snap で closed にする)
  const shouldSnapToClosed = (draftWidth: number): boolean =>
    Number.isFinite(draftWidth) && draftWidth < config.minWidth

  const parseHint = (raw: string | null): SidebarHint | null => {
    if (raw === null || raw.trim() === '') {
      return null
    }
    const num = Number(raw)
    if (!Number.isFinite(num)) {
      return null
    }
    if (num === 0) {
      return { open: 'closed', width: null }
    }
    if (isValidStoredWidth(num)) {
      return { open: 'open', width: num }
    }
    return null
  }

  const resolveEffectiveState = (
    storedWidth: number | null,
    storedOpen: SidebarOpenState | null,
    cliHint: SidebarHint | null
  ): SidebarState => {
    const width = hintWidth(cliHint) ?? storedWidth ?? config.defaultWidth
    const open = hintOpen(cliHint) ?? storedOpen ?? 'open'
    return { open, width }
  }

  const readStoredWidth = (): number | null => {
    try {
      const raw = localStorage.getItem(config.widthStorageKey)
      if (raw === null) {
        return null
      }
      const num = Number(raw)
      if (isValidStoredWidth(num)) {
        return num
      }
      return null
    } catch {
      return null
    }
  }

  const writeStoredWidth = (value: number): void => {
    try {
      localStorage.setItem(config.widthStorageKey, String(clampWidth(value)))
    } catch {
      // ignore: privacy mode / quota exceeded
    }
  }

  const readStoredOpen = (): SidebarOpenState | null => {
    try {
      const raw = localStorage.getItem(config.openStorageKey)
      if (isOpenStateImpl(raw)) {
        return raw
      }
      return null
    } catch {
      return null
    }
  }

  const writeStoredOpen = (value: SidebarOpenState): void => {
    try {
      localStorage.setItem(config.openStorageKey, value)
    } catch {
      // ignore
    }
  }

  const readCliHint = (): SidebarHint | null =>
    parseHint(document.documentElement.getAttribute(config.dataAttrName))

  const formatCssWidth = (state: SidebarState): string => {
    if (state.open === 'open') {
      return `${clampWidth(state.width)}px`
    }
    return '0px'
  }

  const applyState = (state: SidebarState): void => {
    const root = document.documentElement
    root.style.setProperty(config.cssVarName, formatCssWidth(state))
    root.classList.toggle(config.closedClassName, state.open === 'closed')
  }

  return {
    applyState,
    clampWidth,
    isOpenState: isOpenStateImpl,
    isValidStoredWidth,
    parseHint,
    readCliHint,
    readStoredOpen,
    readStoredWidth,
    resolveEffectiveState,
    shouldSnapToClosed,
    writeStoredOpen,
    writeStoredWidth,
  }
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  // 任意の config で factory を組み立て、純粋関数の振る舞いだけ smoke check する。
  // 値域 (280-640 / 180-480) ごとの境界テストは wrapper 側に残し、本 factory は
  // 「config に従って min/max/default が正しく作用するか」を 1 ケースで確認するに留める。
  const SAMPLE_CONFIG: SidebarWidthConfig = {
    closedClassName: 'sample-closed',
    cssVarName: '--sample-width',
    dataAttrName: 'data-sample-width',
    defaultWidth: 360,
    maxWidth: 640,
    minWidth: 280,
    openStorageKey: 'sample.open',
    widthStorageKey: 'sample.width',
  }

  describe('createSidebarWidthModule: pure functions', () => {
    const mod = createSidebarWidthModule(SAMPLE_CONFIG)

    it('isOpenState', () => {
      expect(mod.isOpenState('open')).toBe(true)
      expect(mod.isOpenState('closed')).toBe(true)
      expect(mod.isOpenState('hidden')).toBe(false)
      expect(mod.isOpenState(null)).toBe(false)
    })

    it('isValidStoredWidth は config の minWidth/maxWidth を境界に判定する', () => {
      expect(mod.isValidStoredWidth(280)).toBe(true)
      expect(mod.isValidStoredWidth(640)).toBe(true)
      expect(mod.isValidStoredWidth(279)).toBe(false)
      expect(mod.isValidStoredWidth(641)).toBe(false)
      expect(mod.isValidStoredWidth(Number.NaN)).toBe(false)
    })

    it('clampWidth は config の境界にクランプ + 非有限値は default を返す', () => {
      expect(mod.clampWidth(360.6)).toBe(361)
      expect(mod.clampWidth(0)).toBe(280)
      expect(mod.clampWidth(10_000)).toBe(640)
      expect(mod.clampWidth(Number.NaN)).toBe(360)
    })

    it('shouldSnapToClosed は config の minWidth 未満で true', () => {
      expect(mod.shouldSnapToClosed(279.9)).toBe(true)
      expect(mod.shouldSnapToClosed(280)).toBe(false)
      expect(mod.shouldSnapToClosed(Number.NaN)).toBe(false)
    })

    it('parseHint は "0" / 数値 / 範囲外を順にパースする', () => {
      expect(mod.parseHint(null)).toBeNull()
      expect(mod.parseHint('')).toBeNull()
      expect(mod.parseHint('0')).toEqual({ open: 'closed', width: null })
      expect(mod.parseHint('360')).toEqual({ open: 'open', width: 360 })
      expect(mod.parseHint('279')).toBeNull()
      expect(mod.parseHint('auto')).toBeNull()
    })

    it('resolveEffectiveState は CLI hint > localStorage > default の P1', () => {
      expect(mod.resolveEffectiveState(320, 'open', { open: 'closed', width: null })).toEqual({
        open: 'closed',
        width: 320,
      })
      expect(mod.resolveEffectiveState(null, null, { open: 'open', width: 480 })).toEqual({
        open: 'open',
        width: 480,
      })
      expect(mod.resolveEffectiveState(320, 'open', null)).toEqual({
        open: 'open',
        width: 320,
      })
      expect(mod.resolveEffectiveState(null, null, null)).toEqual({
        open: 'open',
        width: 360,
      })
      expect(mod.resolveEffectiveState(null, null, { open: 'closed', width: null })).toEqual({
        open: 'closed',
        width: 360,
      })
    })
  })
}
