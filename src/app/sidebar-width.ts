// サイドバー幅 + open/closed 状態の単一の真実の源と、優先順位 P1 (localStorage > CLI hint > default)
// の決定ロジック。theme.ts と同じパターンで純粋関数 (clamp* / isValid* / resolveEffective* / shouldSnap*) と
// DOM/localStorage 側関数を同居させているが、純粋関数は副作用ゼロで in-source test できる粒度に保つ。
// 設計判断・優先順位は DESIGN.md §7c / §12 §1 Theming 行と対称の扱い。

export type SidebarOpenState = 'open' | 'closed'

export interface SidebarState {
  open: SidebarOpenState
  /** 開いている時の幅 (240–640)。closed のときも「次に開いた時の幅」として保持する */
  width: number
}

const WIDTH_STORAGE_KEY = 'mdxg-redline.sidebar-width'
const OPEN_STORAGE_KEY = 'mdxg-redline.sidebar-open'
const OPEN_VALUES = ['open', 'closed'] as const

export const SIDEBAR_MIN_WIDTH = 240
export const SIDEBAR_MAX_WIDTH = 640
export const SIDEBAR_DEFAULT_WIDTH = 360
/** これ未満までドラッグされたら snap で closed にする閾値 (= SIDEBAR_MIN_WIDTH と同値) */
export const SIDEBAR_SNAP_THRESHOLD = SIDEBAR_MIN_WIDTH

export const isSidebarOpenState = (value: unknown): value is SidebarOpenState =>
  typeof value === 'string' && (OPEN_VALUES as readonly string[]).includes(value)

/** 240–640 範囲の整数か判定する type guard。localStorage / data 属性読み込み時の防御に使う */
export const isValidStoredWidth = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= SIDEBAR_MIN_WIDTH &&
  value <= SIDEBAR_MAX_WIDTH

/** ドラッグ中の draft 値を 240–640 の整数にクランプする (Math.round で px 単位に正規化) */
export const clampSidebarWidth = (value: number): number => {
  if (!Number.isFinite(value)) {
    return SIDEBAR_DEFAULT_WIDTH
  }
  const rounded = Math.round(value)
  if (rounded < SIDEBAR_MIN_WIDTH) {
    return SIDEBAR_MIN_WIDTH
  }
  if (rounded > SIDEBAR_MAX_WIDTH) {
    return SIDEBAR_MAX_WIDTH
  }
  return rounded
}

/** draft 幅が SIDEBAR_SNAP_THRESHOLD 未満なら true (snap で closed にする) */
export const shouldSnapToClosed = (draftWidth: number): boolean =>
  Number.isFinite(draftWidth) && draftWidth < SIDEBAR_SNAP_THRESHOLD

/**
 * CLI ヒント (data-sidebar-width 属性) の生文字列を SidebarHint にパースする pure 関数。
 *   "0"        → closed (width はデフォルト 360 を後段で適用)
 *   "240"-"640" → open (その幅)
 *   その他 / 範囲外 / 非数値 → null (CLI hint 無効)
 *
 * 戻り値の `width: null` (=closed 指定) は resolveEffectiveSidebarState 側で
 * SIDEBAR_DEFAULT_WIDTH に展開する。closed 状態の復元幅を CLI で指定する経路は提供しない
 * (localStorage が空のときだけ CLI hint が効くため、closed + 任意幅の組み合わせは
 *  ユーザーが UI を操作した瞬間に上書きされる短命な状態にしかならない)。
 */
export interface SidebarHint {
  open: SidebarOpenState
  /** open=true のときの幅。closed 指定 (width: null) のときは後段で default を適用 */
  width: number | null
}

export const parseSidebarHint = (raw: string | null): SidebarHint | null => {
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

/**
 * inline script と同じ優先順位 P1 で最終 SidebarState を決定する純粋関数。
 *   1. storedWidth / storedOpen (localStorage) があればそれ
 *   2. cliHint (<html data-sidebar-width>) があればそれ
 *   3. それ以外は { width: SIDEBAR_DEFAULT_WIDTH, open: 'open' }
 *
 * width と open は独立に評価されない:
 * - storedOpen が無くて cliHint が closed の場合は open='closed'
 * - storedWidth は closed 状態でも保持される (次に開いた時の幅)
 */
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

export const resolveEffectiveSidebarState = (
  storedWidth: number | null,
  storedOpen: SidebarOpenState | null,
  cliHint: SidebarHint | null
): SidebarState => {
  const width = storedWidth ?? hintWidth(cliHint) ?? SIDEBAR_DEFAULT_WIDTH
  const open = storedOpen ?? hintOpen(cliHint) ?? 'open'
  return { open, width }
}

/** localStorage から stored width を読む。未保存・不正値・例外時 (プライバシーモード等) は null */
export const readStoredSidebarWidth = (): number | null => {
  try {
    const raw = localStorage.getItem(WIDTH_STORAGE_KEY)
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

/** localStorage に stored width を書く。例外 (quota / disabled) は飲み込む */
export const writeStoredSidebarWidth = (value: number): void => {
  try {
    localStorage.setItem(WIDTH_STORAGE_KEY, String(clampSidebarWidth(value)))
  } catch {
    // ignore: privacy mode / quota exceeded
  }
}

/** localStorage から stored open 状態を読む */
export const readStoredSidebarOpen = (): SidebarOpenState | null => {
  try {
    const raw = localStorage.getItem(OPEN_STORAGE_KEY)
    if (isSidebarOpenState(raw)) {
      return raw
    }
    return null
  } catch {
    return null
  }
}

/** localStorage に stored open 状態を書く */
export const writeStoredSidebarOpen = (value: SidebarOpenState): void => {
  try {
    localStorage.setItem(OPEN_STORAGE_KEY, value)
  } catch {
    // ignore
  }
}

/** <html data-sidebar-width> から CLI 注入値を読む。属性無し・不正値時は null */
export const readSidebarCliHint = (): SidebarHint | null =>
  parseSidebarHint(document.documentElement.getAttribute('data-sidebar-width'))

const formatSidebarCssWidth = (state: SidebarState): string => {
  if (state.open === 'open') {
    return `${clampSidebarWidth(state.width)}px`
  }
  return '0px'
}

/**
 * SidebarState を DOM に反映する:
 * - <html> の --sidebar-width CSS 変数を設定 (closed のときは 0px)
 * - <html> の .sidebar-closed クラスを toggle (CSS 側で sidebar 非表示 / toggle tab 表示を切替)
 */
export const applySidebarState = (state: SidebarState): void => {
  const root = document.documentElement
  root.style.setProperty('--sidebar-width', formatSidebarCssWidth(state))
  root.classList.toggle('sidebar-closed', state.open === 'closed')
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('isSidebarOpenState', () => {
    it('open / closed は true', () => {
      expect(isSidebarOpenState('open')).toBe(true)
      expect(isSidebarOpenState('closed')).toBe(true)
    })

    it('未知の文字列・null・数値・空オブジェクトは false', () => {
      expect(isSidebarOpenState('hidden')).toBe(false)
      expect(isSidebarOpenState('')).toBe(false)
      expect(isSidebarOpenState(null)).toBe(false)
      expect(isSidebarOpenState(0)).toBe(false)
      expect(isSidebarOpenState({})).toBe(false)
    })
  })

  describe('isValidStoredWidth', () => {
    it('240-640 の整数は true', () => {
      expect(isValidStoredWidth(240)).toBe(true)
      expect(isValidStoredWidth(360)).toBe(true)
      expect(isValidStoredWidth(640)).toBe(true)
    })

    it('範囲外 (0 / 239 / 641) は false', () => {
      expect(isValidStoredWidth(0)).toBe(false)
      expect(isValidStoredWidth(239)).toBe(false)
      expect(isValidStoredWidth(641)).toBe(false)
    })

    it('NaN / Infinity / 非数値は false', () => {
      expect(isValidStoredWidth(Number.NaN)).toBe(false)
      expect(isValidStoredWidth(Number.POSITIVE_INFINITY)).toBe(false)
      expect(isValidStoredWidth('360')).toBe(false)
      expect(isValidStoredWidth(null)).toBe(false)
    })
  })

  describe('clampSidebarWidth', () => {
    it('範囲内はそのまま (整数化)', () => {
      expect(clampSidebarWidth(360)).toBe(360)
      expect(clampSidebarWidth(360.6)).toBe(361)
    })

    it('下限未満は 240 にクランプ', () => {
      expect(clampSidebarWidth(0)).toBe(240)
      expect(clampSidebarWidth(-100)).toBe(240)
      expect(clampSidebarWidth(239)).toBe(240)
    })

    it('上限超過は 640 にクランプ', () => {
      expect(clampSidebarWidth(641)).toBe(640)
      expect(clampSidebarWidth(10_000)).toBe(640)
    })

    it('非有限値は default (360) を返す', () => {
      expect(clampSidebarWidth(Number.NaN)).toBe(360)
      expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(360)
    })
  })

  describe('shouldSnapToClosed', () => {
    it('閾値 (240) 未満は true', () => {
      expect(shouldSnapToClosed(0)).toBe(true)
      expect(shouldSnapToClosed(200)).toBe(true)
      expect(shouldSnapToClosed(239.9)).toBe(true)
    })

    it('閾値以上は false', () => {
      expect(shouldSnapToClosed(240)).toBe(false)
      expect(shouldSnapToClosed(360)).toBe(false)
      expect(shouldSnapToClosed(800)).toBe(false)
    })

    it('NaN / Infinity は false (snap しない、安全側)', () => {
      expect(shouldSnapToClosed(Number.NaN)).toBe(false)
      expect(shouldSnapToClosed(Number.POSITIVE_INFINITY)).toBe(false)
    })
  })

  describe('parseSidebarHint', () => {
    it('null / 空文字は null', () => {
      expect(parseSidebarHint(null)).toBeNull()
      expect(parseSidebarHint('')).toBeNull()
    })

    it('"0" は closed (width: null)', () => {
      expect(parseSidebarHint('0')).toEqual({ open: 'closed', width: null })
    })

    it('240-640 の数値文字列は open (その幅)', () => {
      expect(parseSidebarHint('240')).toEqual({ open: 'open', width: 240 })
      expect(parseSidebarHint('360')).toEqual({ open: 'open', width: 360 })
      expect(parseSidebarHint('640')).toEqual({ open: 'open', width: 640 })
    })

    it('範囲外 / 非数値は null', () => {
      expect(parseSidebarHint('239')).toBeNull()
      expect(parseSidebarHint('641')).toBeNull()
      expect(parseSidebarHint('auto')).toBeNull()
      expect(parseSidebarHint('360px')).toBeNull()
    })
  })

  describe('resolveEffectiveSidebarState', () => {
    it('P1-1: storedWidth + storedOpen があれば最優先 (CLI hint を無視)', () => {
      expect(resolveEffectiveSidebarState(320, 'open', { open: 'closed', width: null })).toEqual({
        open: 'open',
        width: 320,
      })
      expect(resolveEffectiveSidebarState(480, 'closed', { open: 'open', width: 240 })).toEqual({
        open: 'closed',
        width: 480,
      })
    })

    it('P1-2: stored が無ければ CLI hint を使う', () => {
      expect(resolveEffectiveSidebarState(null, null, { open: 'open', width: 480 })).toEqual({
        open: 'open',
        width: 480,
      })
      expect(resolveEffectiveSidebarState(null, null, { open: 'closed', width: null })).toEqual({
        open: 'closed',
        width: SIDEBAR_DEFAULT_WIDTH,
      })
    })

    it('P1-3: stored も CLI hint も無ければ default (360, open)', () => {
      expect(resolveEffectiveSidebarState(null, null, null)).toEqual({
        open: 'open',
        width: SIDEBAR_DEFAULT_WIDTH,
      })
    })

    it('storedWidth だけある場合は CLI hint の open を尊重する (width だけ stored 優先)', () => {
      expect(resolveEffectiveSidebarState(420, null, { open: 'closed', width: null })).toEqual({
        open: 'closed',
        width: 420,
      })
    })

    it('storedOpen だけある場合は CLI hint の width を尊重する', () => {
      expect(resolveEffectiveSidebarState(null, 'open', { open: 'closed', width: null })).toEqual({
        open: 'open',
        width: SIDEBAR_DEFAULT_WIDTH,
      })
    })
  })
}
