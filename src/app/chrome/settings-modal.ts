import {
  type StoredTheme,
  applyAppliedTheme,
  getSystemPrefersDark,
  isStoredTheme,
  readCliHint,
  readStoredTheme,
  resolveAppliedTheme,
  subscribeSystemTheme,
  writeStoredTheme,
} from './theme'
import { getLang, setLang, subscribeLangChange } from '../i18n/i18n-browser'
import { createStaticModalController } from '../dom/static-modal'
import type { Lang } from '../../core/i18n/i18n-core'
import { redrawMermaidForTheme } from '../renderers/mermaid'

const SETTINGS_TOGGLE_BUTTON_ID = 'btn-settings'
const SETTINGS_BACKDROP_ID = 'settings-modal-backdrop'
const SETTINGS_CLOSE_BUTTON_ID = 'settings-modal-close'
const THEME_SELECT_ID = 'settings-theme-select'
const LANG_SELECT_ID = 'settings-lang-select'

const isLangValue = (value: string): value is Lang => value === 'en' || value === 'ja'

// FOUC inline script と同じ P1 (cliHint > stored > 'system') で起動時の effective StoredTheme
// を求める。subscribeSystemTheme の guard と select 初期表示で同じ値を参照する。
const initialThemeSelection = (): StoredTheme => readCliHint() ?? readStoredTheme() ?? 'system'

interface SettingsSessionState {
  currentTheme: StoredTheme
}

const session: SettingsSessionState = { currentTheme: initialThemeSelection() }

// Mermaid は CSS variables を直接読まず initialize 時のテーマ色を SVG に焼き込むため、
// CSS だけでは theme 切り替えに追従できず明示的な再描画が要る。
const refreshMermaidAfterTheme = (): void => {
  const doc = document.querySelector<HTMLElement>('#doc')
  if (doc !== null) {
    redrawMermaidForTheme(doc)
  }
}

const syncSettingsButtonAria = (open: boolean): void => {
  const btn = document.getElementById(SETTINGS_TOGGLE_BUTTON_ID)
  if (!(btn instanceof HTMLElement)) {
    return
  }
  btn.classList.toggle('btn-active', open)
  btn.setAttribute('aria-pressed', String(open))
}

const findThemeSelect = (): HTMLSelectElement | null => {
  const el = document.getElementById(THEME_SELECT_ID)
  if (el instanceof HTMLSelectElement) {
    return el
  }
  return null
}

const findLangSelect = (): HTMLSelectElement | null => {
  const el = document.getElementById(LANG_SELECT_ID)
  if (el instanceof HTMLSelectElement) {
    return el
  }
  return null
}

// 他経路で setLang や theme が変わった後でも、次回 open で select が必ず実状態に揃うよう
// open 直前に同期する。
const syncControlsToState = (): void => {
  const themeSelect = findThemeSelect()
  if (themeSelect !== null) {
    themeSelect.value = session.currentTheme
  }
  const langSelect = findLangSelect()
  if (langSelect !== null) {
    langSelect.value = getLang()
  }
}

// 初期 focus を theme select に向けるのは、開いた直後にすぐ theme / lang を select で操作できる
// 「最頻のユースケース」起点にするため。Tab / Shift+Tab は global-keyboard.ts:handleTabKey が
// trapTabInModal で modal 内に閉じ込めるため、close button 起点でも DOM 順で巡回できる。
const controller = createStaticModalController({
  backdropId: SETTINGS_BACKDROP_ID,
  closeButtonId: SETTINGS_CLOSE_BUTTON_ID,
  initialFocusId: THEME_SELECT_ID,
  onAfterClose: (): void => {
    syncSettingsButtonAria(false)
  },
  onAfterOpen: (): void => {
    syncControlsToState()
    syncSettingsButtonAria(true)
  },
})

export const isSettingsModalOpen = (): boolean => controller.isOpen()
export const openSettingsModal = (): void => {
  controller.open()
}
export const closeSettingsModal = (): void => {
  controller.close()
}
export const toggleSettingsModal = (): void => {
  if (controller.isOpen()) {
    controller.close()
    return
  }
  controller.open()
}

const applyThemeSelection = (next: StoredTheme): void => {
  session.currentTheme = next
  writeStoredTheme(next)
  // CLI hint は「初回 paint で localStorage より優先」する起動時ヒントだが、
  // ユーザーが UI で選んだ値はそれを上書きして即座に適用する (resolveAppliedTheme は CLI hint 無視)。
  applyAppliedTheme(resolveAppliedTheme(next, getSystemPrefersDark()))
  refreshMermaidAfterTheme()
}

const wireThemeSelect = (): void => {
  const select = findThemeSelect()
  if (select === null) {
    return
  }
  select.value = session.currentTheme
  select.addEventListener('change', (): void => {
    const { value } = select
    if (isStoredTheme(value)) {
      applyThemeSelection(value)
    }
  })
}

const wireLangSelect = (): void => {
  const select = findLangSelect()
  if (select === null) {
    return
  }
  select.value = getLang()
  select.addEventListener('change', (): void => {
    const { value } = select
    if (isLangValue(value)) {
      setLang(value)
    }
  })
  // 外部から setLang が呼ばれた場合も select 値を追従させる。
  subscribeLangChange((lang): void => {
    select.value = lang
  })
}

const wireSettingsToggleButton = (): void => {
  const button = document.getElementById(SETTINGS_TOGGLE_BUTTON_ID)
  if (!(button instanceof HTMLElement)) {
    return
  }
  button.addEventListener('click', toggleSettingsModal)
}

export const wireSettingsModal = (): void => {
  controller.wire()
  wireThemeSelect()
  wireLangSelect()
  wireSettingsToggleButton()
  // OS テーマ変更は session.currentTheme が 'system' のときだけ反映する。ユーザーが light/dark を
  // 明示選択している間は OS 設定変化を無視するための guard。
  subscribeSystemTheme((prefersDark): void => {
    if (session.currentTheme !== 'system') {
      return
    }
    applyAppliedTheme(resolveAppliedTheme('system', prefersDark))
    refreshMermaidAfterTheme()
  })
}

if (import.meta.vitest) {
  const { afterEach, beforeEach, describe, expect, it } = import.meta.vitest

  // テスト間で session state / localStorage / DOM をリセットする。settings-modal は module
  // 単一インスタンスの session を持つため、明示 reset しないと cross-test mutation が起きる。
  const resetState = (): void => {
    session.currentTheme = 'system'
    try {
      localStorage.removeItem('mdxg-redline.theme')
      localStorage.removeItem('mdxg-redline.lang')
    } catch {
      // ignore (private mode 等)
    }
    document.documentElement.classList.remove('dark')
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.lang = 'en'
    document.body.innerHTML = ''
  }

  // 設定モーダル + 歯車ボタン + #doc の最小 fixture (review.html の該当部分を再現)。
  const setupFixture = (): void => {
    document.body.innerHTML = `
      <button id="${SETTINGS_TOGGLE_BUTTON_ID}" aria-pressed="false"></button>
      <div id="${SETTINGS_BACKDROP_ID}" class="modal-backdrop">
        <div class="modal">
          <select id="${THEME_SELECT_ID}">
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
          <select id="${LANG_SELECT_ID}">
            <option value="en">English</option>
            <option value="ja">日本語</option>
          </select>
          <button id="${SETTINGS_CLOSE_BUTTON_ID}"></button>
        </div>
      </div>
    `
  }

  beforeEach((): void => {
    resetState()
    setupFixture()
  })

  afterEach(resetState)

  describe('syncControlsToState', () => {
    it('open 時に select 値を session / 現在の lang に合わせる', () => {
      session.currentTheme = 'dark'
      document.documentElement.lang = 'ja'
      // i18n-browser の currentLang を 'ja' にするため setLang を呼ぶ。
      setLang('ja')
      syncControlsToState()
      const themeSelect = findThemeSelect()
      const langSelect = findLangSelect()
      if (themeSelect === null || langSelect === null) {
        throw new Error('select fixture missing')
      }
      expect(themeSelect.value).toBe('dark')
      expect(langSelect.value).toBe('ja')
    })
  })

  describe('applyThemeSelection: state / DOM / localStorage の同期', () => {
    it('dark を選ぶと session / localStorage / .dark class が同期する', () => {
      applyThemeSelection('dark')
      expect(session.currentTheme).toBe('dark')
      expect(localStorage.getItem('mdxg-redline.theme')).toBe('dark')
      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })

    it('light を選ぶと .dark class が外れる', () => {
      document.documentElement.classList.add('dark')
      applyThemeSelection('light')
      expect(document.documentElement.classList.contains('dark')).toBe(false)
    })
  })

  describe('wireThemeSelect: change イベントで applyThemeSelection が走る', () => {
    it('select change で session.currentTheme と .dark class が更新される', () => {
      wireThemeSelect()
      const select = findThemeSelect()
      if (select === null) {
        throw new Error('theme select fixture missing')
      }
      select.value = 'dark'
      select.dispatchEvent(new Event('change'))
      expect(session.currentTheme).toBe('dark')
      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })

    it('不正な value は無視される (state は不変)', () => {
      wireThemeSelect()
      const select = findThemeSelect()
      if (select === null) {
        throw new Error('theme select fixture missing')
      }
      const before = session.currentTheme
      // value setter は <option> が無ければ空文字に倒れるが、念のため直接代入
      select.value = 'invalid'
      select.dispatchEvent(new Event('change'))
      expect(session.currentTheme).toBe(before)
    })
  })

  describe('wireLangSelect: change イベントで setLang が走る', () => {
    it('select change で <html lang> と select 値が同期する', () => {
      wireLangSelect()
      const select = findLangSelect()
      if (select === null) {
        throw new Error('lang select fixture missing')
      }
      select.value = 'ja'
      select.dispatchEvent(new Event('change'))
      expect(document.documentElement.lang).toBe('ja')
      expect(getLang()).toBe('ja')
    })

    it('subscribeLangChange 経由で select 値が追従する (外部から setLang した場合)', () => {
      wireLangSelect()
      const select = findLangSelect()
      if (select === null) {
        throw new Error('lang select fixture missing')
      }
      setLang('ja')
      expect(select.value).toBe('ja')
      setLang('en')
      expect(select.value).toBe('en')
    })
  })

  describe('open 時の初期 focus', () => {
    it('open 直後の focus は theme select (Tab で lang / close まで modal 内を辿れる起点)', () => {
      controller.wire()
      controller.open()
      const themeSelect = findThemeSelect()
      expect(document.activeElement).toBe(themeSelect)
    })
  })

  describe('toggleSettingsModal: open / close と aria-pressed 同期', () => {
    // 「open class が立つ」「aria-pressed が true / false に追従する」を 2 ケースに分けて
    // it 内 statements を max-statements (10) 以下に保つ。
    interface ToggleSnapshot {
      backdropOpen: boolean
      ariaPressed: string | null
    }
    const snapshotToggleState = (): ToggleSnapshot => {
      const backdrop = document.getElementById(SETTINGS_BACKDROP_ID)
      const button = document.getElementById(SETTINGS_TOGGLE_BUTTON_ID)
      if (backdrop === null || button === null) {
        throw new Error('fixture missing')
      }
      return {
        ariaPressed: button.getAttribute('aria-pressed'),
        backdropOpen: backdrop.classList.contains('open'),
      }
    }

    it('toggle で open class と aria-pressed が true 側に揃う', () => {
      controller.wire()
      toggleSettingsModal()
      expect(snapshotToggleState()).toEqual({ ariaPressed: 'true', backdropOpen: true })
    })

    it('もう一度 toggle すると open class と aria-pressed が false 側に揃う', () => {
      controller.wire()
      toggleSettingsModal()
      toggleSettingsModal()
      expect(snapshotToggleState()).toEqual({ ariaPressed: 'false', backdropOpen: false })
    })
  })
}
