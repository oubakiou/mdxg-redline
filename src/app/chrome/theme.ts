// Theme (light/dark/system) の単一の真実の源と、優先順位 P1 (localStorage > CLI hint > OS) の
// 決定ロジック。純粋関数 (resolve* / next* / isStoredTheme) と DOM/localStorage 側関数を
// 同居させているが、純粋関数は副作用ゼロで in-source test できる粒度に保つ。
// 設計判断・優先順位は DESIGN.md §7c / §12 §1 Theming 行を参照。

export type StoredTheme = 'system' | 'light' | 'dark'
export type AppliedTheme = 'light' | 'dark'

const STORAGE_KEY = 'mdxg-redline.theme'
const STORED_VALUES = ['system', 'light', 'dark'] as const

/** 任意値が StoredTheme か判定する type guard。localStorage / data-theme 読み込み時の防御に使う */
export const isStoredTheme = (value: unknown): value is StoredTheme =>
  typeof value === 'string' && (STORED_VALUES as readonly string[]).includes(value)

/** stored 値 + OS 設定から、実際に DOM に適用する light/dark を決定する */
export const resolveAppliedTheme = (
  stored: StoredTheme,
  systemPrefersDark: boolean
): AppliedTheme => {
  if (stored === 'system') {
    if (systemPrefersDark) {
      return 'dark'
    }
    return 'light'
  }
  return stored
}

/** トグルボタン押下時の循環順序: system → light → dark → system */
export const nextStoredTheme = (current: StoredTheme): StoredTheme => {
  if (current === 'system') {
    return 'light'
  }
  if (current === 'light') {
    return 'dark'
  }
  return 'system'
}

/**
 * inline script と同じ優先順位 P1 で最終 AppliedTheme を決定する純粋関数。
 *   1. stored (localStorage) があればそれ
 *   2. cliHint (<html data-theme>) があればそれ
 *   3. それ以外は 'system'
 * いずれの段階でも 'system' は systemPrefersDark で light/dark に展開する。
 */
export const resolveEffectiveTheme = (
  stored: StoredTheme | null,
  cliHint: StoredTheme | null,
  systemPrefersDark: boolean
): AppliedTheme => {
  const effective: StoredTheme = stored ?? cliHint ?? 'system'
  return resolveAppliedTheme(effective, systemPrefersDark)
}

/** localStorage から stored theme を読む。未保存・不正値・例外時 (プライバシーモード等) は null */
export const readStoredTheme = (): StoredTheme | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (isStoredTheme(raw)) {
      return raw
    }
    return null
  } catch {
    return null
  }
}

/** localStorage に stored theme を書く。例外 (quota / disabled) は飲み込む */
export const writeStoredTheme = (value: StoredTheme): void => {
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // ignore: privacy mode / quota exceeded など。inline script 側で fallback する
  }
}

/** <html data-theme> から CLI 注入値を読む。属性無し・不正値時は null */
export const readCliHint = (): StoredTheme | null => {
  const raw = document.documentElement.getAttribute('data-theme')
  if (isStoredTheme(raw)) {
    return raw
  }
  return null
}

/** 現在の OS prefers-color-scheme 設定 */
export const getSystemPrefersDark = (): boolean =>
  globalThis.matchMedia('(prefers-color-scheme: dark)').matches

/** AppliedTheme を DOM に反映する (<html> の .dark クラスを toggle) */
export const applyAppliedTheme = (theme: AppliedTheme): void => {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

/**
 * OS prefers-color-scheme の change イベントを購読する。戻り値は unsubscribe 関数。
 * 呼び出し側で stored が 'system' (相当) の間だけ cb を反映するかどうかを判断する。
 */
export const subscribeSystemTheme = (cb: (prefersDark: boolean) => void): (() => void) => {
  const mql = globalThis.matchMedia('(prefers-color-scheme: dark)')
  const handler = (event: MediaQueryListEvent): void => cb(event.matches)
  mql.addEventListener('change', handler)
  return (): void => mql.removeEventListener('change', handler)
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('isStoredTheme', () => {
    it('system / light / dark は true', () => {
      expect(isStoredTheme('system')).toBe(true)
      expect(isStoredTheme('light')).toBe(true)
      expect(isStoredTheme('dark')).toBe(true)
    })

    it('未知の文字列・null・数値・空オブジェクトは false', () => {
      expect(isStoredTheme('auto')).toBe(false)
      expect(isStoredTheme('')).toBe(false)
      expect(isStoredTheme(null)).toBe(false)
      expect(isStoredTheme(0)).toBe(false)
      expect(isStoredTheme({})).toBe(false)
    })
  })

  describe('resolveAppliedTheme', () => {
    it('system × systemPrefersDark=true → dark', () => {
      expect(resolveAppliedTheme('system', true)).toBe('dark')
    })

    it('system × systemPrefersDark=false → light', () => {
      expect(resolveAppliedTheme('system', false)).toBe('light')
    })

    it('light は OS 設定に関わらず light を返す（明示優先）', () => {
      expect(resolveAppliedTheme('light', true)).toBe('light')
      expect(resolveAppliedTheme('light', false)).toBe('light')
    })

    it('dark は OS 設定に関わらず dark を返す（明示優先）', () => {
      expect(resolveAppliedTheme('dark', true)).toBe('dark')
      expect(resolveAppliedTheme('dark', false)).toBe('dark')
    })
  })

  describe('nextStoredTheme', () => {
    it('system → light → dark → system の循環', () => {
      expect(nextStoredTheme('system')).toBe('light')
      expect(nextStoredTheme('light')).toBe('dark')
      expect(nextStoredTheme('dark')).toBe('system')
    })
  })

  describe('resolveEffectiveTheme', () => {
    it('P1-1: stored があれば stored が最優先 (CLI hint と OS を無視)', () => {
      expect(resolveEffectiveTheme('light', 'dark', true)).toBe('light')
      expect(resolveEffectiveTheme('dark', 'light', false)).toBe('dark')
    })

    it('P1-1: stored=system は OS 設定を反映 (CLI hint は無視)', () => {
      expect(resolveEffectiveTheme('system', 'dark', true)).toBe('dark')
      expect(resolveEffectiveTheme('system', 'dark', false)).toBe('light')
    })

    it('P1-2: stored=null かつ cliHint があれば cliHint を使う', () => {
      expect(resolveEffectiveTheme(null, 'dark', false)).toBe('dark')
      expect(resolveEffectiveTheme(null, 'light', true)).toBe('light')
    })

    it('P1-2: stored=null かつ cliHint=system は OS 設定を反映', () => {
      expect(resolveEffectiveTheme(null, 'system', true)).toBe('dark')
      expect(resolveEffectiveTheme(null, 'system', false)).toBe('light')
    })

    it('P1-3: stored=null かつ cliHint=null は system 既定 (OS 設定反映)', () => {
      expect(resolveEffectiveTheme(null, null, true)).toBe('dark')
      expect(resolveEffectiveTheme(null, null, false)).toBe('light')
    })
  })
}
