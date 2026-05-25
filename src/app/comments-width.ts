// コメントパネル幅 + open/closed 状態の単一の真実の源と、優先順位 P1 (localStorage > CLI hint > default)
// の決定ロジック。theme.ts と同じパターンで純粋関数 (clamp* / isValid* / resolveEffective* / shouldSnap*) と
// DOM/localStorage 側関数を同居させているが、純粋関数は副作用ゼロで in-source test できる粒度に保つ。
// 設計判断・優先順位は DESIGN.md §7c / §12 §1 Theming 行と対称の扱い。

export type CommentsOpenState = 'open' | 'closed'

export interface CommentsState {
  open: CommentsOpenState
  /** 開いている時の幅 (240–640)。closed のときも「次に開いた時の幅」として保持する */
  width: number
}

const WIDTH_STORAGE_KEY = 'mdxg-redline.comments-width'
const OPEN_STORAGE_KEY = 'mdxg-redline.comments-open'
const OPEN_VALUES = ['open', 'closed'] as const

export const COMMENTS_MIN_WIDTH = 240
export const COMMENTS_MAX_WIDTH = 640
export const COMMENTS_DEFAULT_WIDTH = 360
/** これ未満までドラッグされたら snap で closed にする閾値 (= COMMENTS_MIN_WIDTH と同値) */
export const COMMENTS_SNAP_THRESHOLD = COMMENTS_MIN_WIDTH

export const isCommentsOpenState = (value: unknown): value is CommentsOpenState =>
  typeof value === 'string' && (OPEN_VALUES as readonly string[]).includes(value)

/** 240–640 範囲の整数か判定する type guard。localStorage / data 属性読み込み時の防御に使う */
export const isValidStoredCommentsWidth = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= COMMENTS_MIN_WIDTH &&
  value <= COMMENTS_MAX_WIDTH

/** ドラッグ中の draft 値を 240–640 の整数にクランプする (Math.round で px 単位に正規化) */
export const clampCommentsWidth = (value: number): number => {
  if (!Number.isFinite(value)) {
    return COMMENTS_DEFAULT_WIDTH
  }
  const rounded = Math.round(value)
  if (rounded < COMMENTS_MIN_WIDTH) {
    return COMMENTS_MIN_WIDTH
  }
  if (rounded > COMMENTS_MAX_WIDTH) {
    return COMMENTS_MAX_WIDTH
  }
  return rounded
}

/** draft 幅が COMMENTS_SNAP_THRESHOLD 未満なら true (snap で closed にする) */
export const shouldSnapCommentsToClosed = (draftWidth: number): boolean =>
  Number.isFinite(draftWidth) && draftWidth < COMMENTS_SNAP_THRESHOLD

/**
 * CLI ヒント (data-comments-width 属性) の生文字列を CommentsHint にパースする pure 関数。
 *   "0"        → closed (width はデフォルト 360 を後段で適用)
 *   "240"-"640" → open (その幅)
 *   その他 / 範囲外 / 非数値 → null (CLI hint 無効)
 *
 * 戻り値の `width: null` (=closed 指定) は resolveEffectiveCommentsState 側で
 * COMMENTS_DEFAULT_WIDTH に展開する。closed 状態の復元幅を CLI で指定する経路は提供しない
 * (localStorage が空のときだけ CLI hint が効くため、closed + 任意幅の組み合わせは
 *  ユーザーが UI を操作した瞬間に上書きされる短命な状態にしかならない)。
 */
export interface CommentsHint {
  open: CommentsOpenState
  /** open=true のときの幅。closed 指定 (width: null) のときは後段で default を適用 */
  width: number | null
}

export const parseCommentsHint = (raw: string | null): CommentsHint | null => {
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
  if (isValidStoredCommentsWidth(num)) {
    return { open: 'open', width: num }
  }
  return null
}

/**
 * inline script と同じ優先順位 P1 で最終 CommentsState を決定する純粋関数。
 *   1. storedWidth / storedOpen (localStorage) があればそれ
 *   2. cliHint (<html data-comments-width>) があればそれ
 *   3. それ以外は { width: COMMENTS_DEFAULT_WIDTH, open: 'open' }
 *
 * width と open は独立に評価されない:
 * - storedOpen が無くて cliHint が closed の場合は open='closed'
 * - storedWidth は closed 状態でも保持される (次に開いた時の幅)
 */
const hintWidth = (cliHint: CommentsHint | null): number | null => {
  if (cliHint === null) {
    return null
  }
  return cliHint.width
}

const hintOpen = (cliHint: CommentsHint | null): CommentsOpenState | null => {
  if (cliHint === null) {
    return null
  }
  return cliHint.open
}

export const resolveEffectiveCommentsState = (
  storedWidth: number | null,
  storedOpen: CommentsOpenState | null,
  cliHint: CommentsHint | null
): CommentsState => {
  const width = storedWidth ?? hintWidth(cliHint) ?? COMMENTS_DEFAULT_WIDTH
  const open = storedOpen ?? hintOpen(cliHint) ?? 'open'
  return { open, width }
}

/** localStorage から stored width を読む。未保存・不正値・例外時 (プライバシーモード等) は null */
export const readStoredCommentsWidth = (): number | null => {
  try {
    const raw = localStorage.getItem(WIDTH_STORAGE_KEY)
    if (raw === null) {
      return null
    }
    const num = Number(raw)
    if (isValidStoredCommentsWidth(num)) {
      return num
    }
    return null
  } catch {
    return null
  }
}

/** localStorage に stored width を書く。例外 (quota / disabled) は飲み込む */
export const writeStoredCommentsWidth = (value: number): void => {
  try {
    localStorage.setItem(WIDTH_STORAGE_KEY, String(clampCommentsWidth(value)))
  } catch {
    // ignore: privacy mode / quota exceeded
  }
}

/** localStorage から stored open 状態を読む */
export const readStoredCommentsOpen = (): CommentsOpenState | null => {
  try {
    const raw = localStorage.getItem(OPEN_STORAGE_KEY)
    if (isCommentsOpenState(raw)) {
      return raw
    }
    return null
  } catch {
    return null
  }
}

/** localStorage に stored open 状態を書く */
export const writeStoredCommentsOpen = (value: CommentsOpenState): void => {
  try {
    localStorage.setItem(OPEN_STORAGE_KEY, value)
  } catch {
    // ignore
  }
}

/** <html data-comments-width> から CLI 注入値を読む。属性無し・不正値時は null */
export const readCommentsCliHint = (): CommentsHint | null =>
  parseCommentsHint(document.documentElement.getAttribute('data-comments-width'))

const formatCommentsCssWidth = (state: CommentsState): string => {
  if (state.open === 'open') {
    return `${clampCommentsWidth(state.width)}px`
  }
  return '0px'
}

/**
 * CommentsState を DOM に反映する:
 * - <html> の --comments-width CSS 変数を設定 (closed のときは 0px)
 * - <html> の .comments-closed クラスを toggle (CSS 側で comments panel 非表示 / toggle tab 表示を切替)
 */
export const applyCommentsState = (state: CommentsState): void => {
  const root = document.documentElement
  root.style.setProperty('--comments-width', formatCommentsCssWidth(state))
  root.classList.toggle('comments-closed', state.open === 'closed')
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('isCommentsOpenState', () => {
    it('open / closed は true', () => {
      expect(isCommentsOpenState('open')).toBe(true)
      expect(isCommentsOpenState('closed')).toBe(true)
    })

    it('未知の文字列・null・数値・空オブジェクトは false', () => {
      expect(isCommentsOpenState('hidden')).toBe(false)
      expect(isCommentsOpenState('')).toBe(false)
      expect(isCommentsOpenState(null)).toBe(false)
      expect(isCommentsOpenState(0)).toBe(false)
      expect(isCommentsOpenState({})).toBe(false)
    })
  })

  describe('isValidStoredCommentsWidth', () => {
    it('240-640 の整数は true', () => {
      expect(isValidStoredCommentsWidth(240)).toBe(true)
      expect(isValidStoredCommentsWidth(360)).toBe(true)
      expect(isValidStoredCommentsWidth(640)).toBe(true)
    })

    it('範囲外 (0 / 239 / 641) は false', () => {
      expect(isValidStoredCommentsWidth(0)).toBe(false)
      expect(isValidStoredCommentsWidth(239)).toBe(false)
      expect(isValidStoredCommentsWidth(641)).toBe(false)
    })

    it('NaN / Infinity / 非数値は false', () => {
      expect(isValidStoredCommentsWidth(Number.NaN)).toBe(false)
      expect(isValidStoredCommentsWidth(Number.POSITIVE_INFINITY)).toBe(false)
      expect(isValidStoredCommentsWidth('360')).toBe(false)
      expect(isValidStoredCommentsWidth(null)).toBe(false)
    })
  })

  describe('clampCommentsWidth', () => {
    it('範囲内はそのまま (整数化)', () => {
      expect(clampCommentsWidth(360)).toBe(360)
      expect(clampCommentsWidth(360.6)).toBe(361)
    })

    it('下限未満は 240 にクランプ', () => {
      expect(clampCommentsWidth(0)).toBe(240)
      expect(clampCommentsWidth(-100)).toBe(240)
      expect(clampCommentsWidth(239)).toBe(240)
    })

    it('上限超過は 640 にクランプ', () => {
      expect(clampCommentsWidth(641)).toBe(640)
      expect(clampCommentsWidth(10_000)).toBe(640)
    })

    it('非有限値は default (360) を返す', () => {
      expect(clampCommentsWidth(Number.NaN)).toBe(360)
      expect(clampCommentsWidth(Number.POSITIVE_INFINITY)).toBe(360)
    })
  })

  describe('shouldSnapCommentsToClosed', () => {
    it('閾値 (240) 未満は true', () => {
      expect(shouldSnapCommentsToClosed(0)).toBe(true)
      expect(shouldSnapCommentsToClosed(200)).toBe(true)
      expect(shouldSnapCommentsToClosed(239.9)).toBe(true)
    })

    it('閾値以上は false', () => {
      expect(shouldSnapCommentsToClosed(240)).toBe(false)
      expect(shouldSnapCommentsToClosed(360)).toBe(false)
      expect(shouldSnapCommentsToClosed(800)).toBe(false)
    })

    it('NaN / Infinity は false (snap しない、安全側)', () => {
      expect(shouldSnapCommentsToClosed(Number.NaN)).toBe(false)
      expect(shouldSnapCommentsToClosed(Number.POSITIVE_INFINITY)).toBe(false)
    })
  })

  describe('parseCommentsHint', () => {
    it('null / 空文字は null', () => {
      expect(parseCommentsHint(null)).toBeNull()
      expect(parseCommentsHint('')).toBeNull()
    })

    it('"0" は closed (width: null)', () => {
      expect(parseCommentsHint('0')).toEqual({ open: 'closed', width: null })
    })

    it('240-640 の数値文字列は open (その幅)', () => {
      expect(parseCommentsHint('240')).toEqual({ open: 'open', width: 240 })
      expect(parseCommentsHint('360')).toEqual({ open: 'open', width: 360 })
      expect(parseCommentsHint('640')).toEqual({ open: 'open', width: 640 })
    })

    it('範囲外 / 非数値は null', () => {
      expect(parseCommentsHint('239')).toBeNull()
      expect(parseCommentsHint('641')).toBeNull()
      expect(parseCommentsHint('auto')).toBeNull()
      expect(parseCommentsHint('360px')).toBeNull()
    })
  })

  describe('resolveEffectiveCommentsState', () => {
    it('P1-1: storedWidth + storedOpen があれば最優先 (CLI hint を無視)', () => {
      expect(resolveEffectiveCommentsState(320, 'open', { open: 'closed', width: null })).toEqual({
        open: 'open',
        width: 320,
      })
      expect(resolveEffectiveCommentsState(480, 'closed', { open: 'open', width: 240 })).toEqual({
        open: 'closed',
        width: 480,
      })
    })

    it('P1-2: stored が無ければ CLI hint を使う', () => {
      expect(resolveEffectiveCommentsState(null, null, { open: 'open', width: 480 })).toEqual({
        open: 'open',
        width: 480,
      })
      expect(resolveEffectiveCommentsState(null, null, { open: 'closed', width: null })).toEqual({
        open: 'closed',
        width: COMMENTS_DEFAULT_WIDTH,
      })
    })

    it('P1-3: stored も CLI hint も無ければ default (360, open)', () => {
      expect(resolveEffectiveCommentsState(null, null, null)).toEqual({
        open: 'open',
        width: COMMENTS_DEFAULT_WIDTH,
      })
    })

    it('storedWidth だけある場合は CLI hint の open を尊重する (width だけ stored 優先)', () => {
      expect(resolveEffectiveCommentsState(420, null, { open: 'closed', width: null })).toEqual({
        open: 'closed',
        width: 420,
      })
    })

    it('storedOpen だけある場合は CLI hint の width を尊重する', () => {
      expect(resolveEffectiveCommentsState(null, 'open', { open: 'closed', width: null })).toEqual({
        open: 'open',
        width: COMMENTS_DEFAULT_WIDTH,
      })
    })
  })
}
