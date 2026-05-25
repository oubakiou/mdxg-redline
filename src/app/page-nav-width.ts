// 左サイドバー (page-nav) 幅 + open/closed 状態の単一の真実の源と、優先順位 P1
// (localStorage > CLI hint > default) の決定ロジック。comments-width.ts と並列に保つ:
// 右サイドバーと左サイドバーで storage key / 値域 / default が異なるため共通化は避け、
// 対称な 2 ファイルとして保持する (DESIGN.md §7c / mdxg-virtual-pages.archive.md §13.1 (a))。

export type PageNavOpenState = 'open' | 'closed'

export interface PageNavState {
  open: PageNavOpenState
  /** 開いている時の幅 (180–480)。closed のときも「次に開いた時の幅」として保持する */
  width: number
}

const WIDTH_STORAGE_KEY = 'mdxg-redline.page-nav-width'
const OPEN_STORAGE_KEY = 'mdxg-redline.page-nav-open'
const OPEN_VALUES = ['open', 'closed'] as const

export const PAGE_NAV_MIN_WIDTH = 180
export const PAGE_NAV_MAX_WIDTH = 480
export const PAGE_NAV_DEFAULT_WIDTH = 220
/** これ未満までドラッグされたら snap で closed にする閾値 (= PAGE_NAV_MIN_WIDTH と同値) */
export const PAGE_NAV_SNAP_THRESHOLD = PAGE_NAV_MIN_WIDTH

export const isPageNavOpenState = (value: unknown): value is PageNavOpenState =>
  typeof value === 'string' && (OPEN_VALUES as readonly string[]).includes(value)

/** 180–480 範囲の整数か判定する type guard。localStorage / data 属性読み込み時の防御に使う */
export const isValidStoredPageNavWidth = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= PAGE_NAV_MIN_WIDTH &&
  value <= PAGE_NAV_MAX_WIDTH

/** ドラッグ中の draft 値を 180–480 の整数にクランプする (Math.round で px 単位に正規化) */
export const clampPageNavWidth = (value: number): number => {
  if (!Number.isFinite(value)) {
    return PAGE_NAV_DEFAULT_WIDTH
  }
  const rounded = Math.round(value)
  if (rounded < PAGE_NAV_MIN_WIDTH) {
    return PAGE_NAV_MIN_WIDTH
  }
  if (rounded > PAGE_NAV_MAX_WIDTH) {
    return PAGE_NAV_MAX_WIDTH
  }
  return rounded
}

/** draft 幅が PAGE_NAV_SNAP_THRESHOLD 未満なら true (snap で closed にする) */
export const shouldSnapPageNavToClosed = (draftWidth: number): boolean =>
  Number.isFinite(draftWidth) && draftWidth < PAGE_NAV_SNAP_THRESHOLD

/**
 * CLI ヒント (data-page-nav-width 属性) の生文字列を PageNavHint にパースする pure 関数。
 *   "0"        → closed (width はデフォルト 220 を後段で適用)
 *   "180"-"480" → open (その幅)
 *   その他 / 範囲外 / 非数値 → null (CLI hint 無効)
 */
export interface PageNavHint {
  open: PageNavOpenState
  /** open=true のときの幅。closed 指定 (width: null) のときは後段で default を適用 */
  width: number | null
}

export const parsePageNavHint = (raw: string | null): PageNavHint | null => {
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
  if (isValidStoredPageNavWidth(num)) {
    return { open: 'open', width: num }
  }
  return null
}

/**
 * inline script と同じ優先順位 P1 で最終 PageNavState を決定する純粋関数。
 *   1. storedWidth / storedOpen (localStorage) があればそれ
 *   2. cliHint (<html data-page-nav-width>) があればそれ
 *   3. それ以外は { width: PAGE_NAV_DEFAULT_WIDTH, open: 'open' }
 */
const hintWidth = (cliHint: PageNavHint | null): number | null => {
  if (cliHint === null) {
    return null
  }
  return cliHint.width
}

const hintOpen = (cliHint: PageNavHint | null): PageNavOpenState | null => {
  if (cliHint === null) {
    return null
  }
  return cliHint.open
}

export const resolveEffectivePageNavState = (
  storedWidth: number | null,
  storedOpen: PageNavOpenState | null,
  cliHint: PageNavHint | null
): PageNavState => {
  const width = storedWidth ?? hintWidth(cliHint) ?? PAGE_NAV_DEFAULT_WIDTH
  const open = storedOpen ?? hintOpen(cliHint) ?? 'open'
  return { open, width }
}

/** localStorage から stored width を読む。未保存・不正値・例外時 (プライバシーモード等) は null */
export const readStoredPageNavWidth = (): number | null => {
  try {
    const raw = localStorage.getItem(WIDTH_STORAGE_KEY)
    if (raw === null) {
      return null
    }
    const num = Number(raw)
    if (isValidStoredPageNavWidth(num)) {
      return num
    }
    return null
  } catch {
    return null
  }
}

/** localStorage に stored width を書く。例外 (quota / disabled) は飲み込む */
export const writeStoredPageNavWidth = (value: number): void => {
  try {
    localStorage.setItem(WIDTH_STORAGE_KEY, String(clampPageNavWidth(value)))
  } catch {
    // ignore: privacy mode / quota exceeded
  }
}

/** localStorage から stored open 状態を読む */
export const readStoredPageNavOpen = (): PageNavOpenState | null => {
  try {
    const raw = localStorage.getItem(OPEN_STORAGE_KEY)
    if (isPageNavOpenState(raw)) {
      return raw
    }
    return null
  } catch {
    return null
  }
}

/** localStorage に stored open 状態を書く */
export const writeStoredPageNavOpen = (value: PageNavOpenState): void => {
  try {
    localStorage.setItem(OPEN_STORAGE_KEY, value)
  } catch {
    // ignore
  }
}

/** <html data-page-nav-width> から CLI 注入値を読む。属性無し・不正値時は null */
export const readPageNavCliHint = (): PageNavHint | null =>
  parsePageNavHint(document.documentElement.getAttribute('data-page-nav-width'))

const formatPageNavCssWidth = (state: PageNavState): string => {
  if (state.open === 'open') {
    return `${clampPageNavWidth(state.width)}px`
  }
  return '0px'
}

/**
 * PageNavState を DOM に反映する:
 * - <html> の --page-nav-width CSS 変数を設定 (closed のときは 0px)
 * - <html> の .page-nav-closed クラスを toggle (CSS 側で page-nav 非表示 / toggle tab 表示を切替)
 */
export const applyPageNavState = (state: PageNavState): void => {
  const root = document.documentElement
  root.style.setProperty('--page-nav-width', formatPageNavCssWidth(state))
  root.classList.toggle('page-nav-closed', state.open === 'closed')
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('isPageNavOpenState', () => {
    it('open / closed は true', () => {
      expect(isPageNavOpenState('open')).toBe(true)
      expect(isPageNavOpenState('closed')).toBe(true)
    })

    it('未知の文字列・null・数値・空オブジェクトは false', () => {
      expect(isPageNavOpenState('hidden')).toBe(false)
      expect(isPageNavOpenState('')).toBe(false)
      expect(isPageNavOpenState(null)).toBe(false)
      expect(isPageNavOpenState(0)).toBe(false)
      expect(isPageNavOpenState({})).toBe(false)
    })
  })

  describe('isValidStoredPageNavWidth', () => {
    it('180-480 の整数は true', () => {
      expect(isValidStoredPageNavWidth(180)).toBe(true)
      expect(isValidStoredPageNavWidth(220)).toBe(true)
      expect(isValidStoredPageNavWidth(480)).toBe(true)
    })

    it('範囲外 (0 / 179 / 481) は false', () => {
      expect(isValidStoredPageNavWidth(0)).toBe(false)
      expect(isValidStoredPageNavWidth(179)).toBe(false)
      expect(isValidStoredPageNavWidth(481)).toBe(false)
    })

    it('NaN / Infinity / 非数値は false', () => {
      expect(isValidStoredPageNavWidth(Number.NaN)).toBe(false)
      expect(isValidStoredPageNavWidth(Number.POSITIVE_INFINITY)).toBe(false)
      expect(isValidStoredPageNavWidth('220')).toBe(false)
      expect(isValidStoredPageNavWidth(null)).toBe(false)
    })
  })

  describe('clampPageNavWidth', () => {
    it('範囲内はそのまま (整数化)', () => {
      expect(clampPageNavWidth(220)).toBe(220)
      expect(clampPageNavWidth(220.6)).toBe(221)
    })

    it('下限未満は 180 にクランプ', () => {
      expect(clampPageNavWidth(0)).toBe(180)
      expect(clampPageNavWidth(-100)).toBe(180)
      expect(clampPageNavWidth(179)).toBe(180)
    })

    it('上限超過は 480 にクランプ', () => {
      expect(clampPageNavWidth(481)).toBe(480)
      expect(clampPageNavWidth(10_000)).toBe(480)
    })

    it('非有限値は default (220) を返す', () => {
      expect(clampPageNavWidth(Number.NaN)).toBe(220)
      expect(clampPageNavWidth(Number.POSITIVE_INFINITY)).toBe(220)
    })
  })

  describe('shouldSnapPageNavToClosed', () => {
    it('閾値 (180) 未満は true', () => {
      expect(shouldSnapPageNavToClosed(0)).toBe(true)
      expect(shouldSnapPageNavToClosed(100)).toBe(true)
      expect(shouldSnapPageNavToClosed(179.9)).toBe(true)
    })

    it('閾値以上は false', () => {
      expect(shouldSnapPageNavToClosed(180)).toBe(false)
      expect(shouldSnapPageNavToClosed(220)).toBe(false)
      expect(shouldSnapPageNavToClosed(500)).toBe(false)
    })

    it('NaN / Infinity は false (snap しない、安全側)', () => {
      expect(shouldSnapPageNavToClosed(Number.NaN)).toBe(false)
      expect(shouldSnapPageNavToClosed(Number.POSITIVE_INFINITY)).toBe(false)
    })
  })

  describe('parsePageNavHint', () => {
    it('null / 空文字は null', () => {
      expect(parsePageNavHint(null)).toBeNull()
      expect(parsePageNavHint('')).toBeNull()
    })

    it('"0" は closed (width: null)', () => {
      expect(parsePageNavHint('0')).toEqual({ open: 'closed', width: null })
    })

    it('180-480 の数値文字列は open (その幅)', () => {
      expect(parsePageNavHint('180')).toEqual({ open: 'open', width: 180 })
      expect(parsePageNavHint('220')).toEqual({ open: 'open', width: 220 })
      expect(parsePageNavHint('480')).toEqual({ open: 'open', width: 480 })
    })

    it('範囲外 / 非数値は null', () => {
      expect(parsePageNavHint('179')).toBeNull()
      expect(parsePageNavHint('481')).toBeNull()
      expect(parsePageNavHint('auto')).toBeNull()
      expect(parsePageNavHint('220px')).toBeNull()
    })
  })

  describe('resolveEffectivePageNavState', () => {
    it('P1-1: storedWidth + storedOpen があれば最優先 (CLI hint を無視)', () => {
      expect(resolveEffectivePageNavState(280, 'open', { open: 'closed', width: null })).toEqual({
        open: 'open',
        width: 280,
      })
      expect(resolveEffectivePageNavState(320, 'closed', { open: 'open', width: 200 })).toEqual({
        open: 'closed',
        width: 320,
      })
    })

    it('P1-2: stored が無ければ CLI hint を使う', () => {
      expect(resolveEffectivePageNavState(null, null, { open: 'open', width: 300 })).toEqual({
        open: 'open',
        width: 300,
      })
      expect(resolveEffectivePageNavState(null, null, { open: 'closed', width: null })).toEqual({
        open: 'closed',
        width: PAGE_NAV_DEFAULT_WIDTH,
      })
    })

    it('P1-3: stored も CLI hint も無ければ default (220, open)', () => {
      expect(resolveEffectivePageNavState(null, null, null)).toEqual({
        open: 'open',
        width: PAGE_NAV_DEFAULT_WIDTH,
      })
    })
  })
}
