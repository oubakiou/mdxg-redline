// グローバル keydown を 1 経路に集約する WASD キーマップの wiring (§13)。
// Escape (modal/menu 閉じ) → Cmd/Ctrl+Enter (modal save) → WASD affordance の 3 段で dispatch する。
// modal open 中は aria-modal="true" の semantic に従い affordance キーを短絡する
// (Esc / Cmd+Enter は別経路で先に処理されるため影響なし)。

import { closeCommentModal } from '../comments/comment-modal'
import { closeHelpModal, openHelpModal } from './help-modal'
import { closeMermaidModal } from '../renderers/mermaid-modal'
import { closeOpenUrlModal } from '../online/open-url-modal'
import { closePasteMarkdownModal } from './paste-markdown-modal'
import { closeMobileDrawers, isMobileDrawerOpen } from './mobile-footer'
import { closeSearch, isSearchOpen, openSearch } from '../search/search'
import { closeSettingsModal } from './settings-modal'
import { qs } from '../dom/dom-utils'
import { trapTabInModal } from '../dom/static-modal'
import {
  activateFocusedItem,
  hasNoModifier,
  moveFocusDown,
  moveFocusLeft,
  moveFocusRight,
  moveFocusUp,
  shouldSkipAffordanceKey,
} from '../navigation/keyboard-shortcuts'

export interface DropdownLike {
  close: () => void
}

// .modal-backdrop.open が DOM 上に 1 つでもあれば「modal が開いている」と判定する。
// 個別の isOpen() を全 modal から束ねる代替もあるが、HTML 側の class 規約 (`open` 付与で
// display:flex) を直接読む方が将来 modal 種別が増えても自動で拾える。
export const isAnyModalOpen = (): boolean => document.querySelector('.modal-backdrop.open') !== null

// aria-modal="true" の semantic に従い modal open 中は Tab を modal 内で循環させる。
// .modal-backdrop.open が無いとき (= modal 閉) は native Tab に任せる (no-op)。
const handleTabKey = (event: KeyboardEvent): void => {
  const openBackdrop = document.querySelector<HTMLElement>('.modal-backdrop.open')
  if (openBackdrop !== null) {
    trapTabInModal(openBackdrop, event)
  }
}

/**
 * グローバル keydown を 1 経路に集約する。Escape (modal/menu 閉じ) → Cmd/Ctrl+Enter
 * (modal save) → WASD affordance の 3 段で dispatch する。
 * commentsMenu / sendMenu / openMenu は createDropdownMenu の戻り値で、Escape 時に同時に
 * 閉じる必要があるため引数として渡す (DOM ID 経由で再取得しても良いが、close handle を直接
 * 持つ方が破綻に強い)。
 */
export const setupKeyboardHandlers = (
  commentsMenu: DropdownLike,
  sendMenu: DropdownLike,
  openMenu: DropdownLike
): void => {
  // statements 数を 10 以下に抑えるため modal / menu / search の 3 グループに分解する
  const closeAllModalsForEscape = (): void => {
    closeCommentModal()
    closeHelpModal()
    closeMermaidModal()
    closeOpenUrlModal()
    closePasteMarkdownModal()
    closeSettingsModal()
  }
  const closeAllMenusForEscape = (): void => {
    commentsMenu.close()
    sendMenu.close()
    openMenu.close()
  }
  const handleEscapeKey = (): void => {
    // mobile drawer は modal-backdrop を持たない別経路のため、modal close より先に閉じる (§5.j)。
    closeMobileDrawers()
    closeAllModalsForEscape()
    closeAllMenusForEscape()
    if (isSearchOpen()) {
      closeSearch()
    }
  }
  const handleModalSaveKey = (): void => {
    if (qs('#modal').classList.contains('open')) {
      qs('#modal-save').click()
    }
  }
  // WASD ベースのキーマップ (§13)。dispatch table で event.code → handler に振り分ける。
  // すべて単独キーのため textarea / input / contenteditable に focus があるときは
  // shouldSkipAffordanceKey でスキップして文字入力を妨げない。`event.repeat` ガードは
  // 押しっぱなしによる連続発火を塞ぐ (modal の点滅対策、§13)。
  const AFFORDANCE_KEY_HANDLERS: Record<string, () => void> = {
    KeyA: moveFocusLeft,
    KeyD: moveFocusRight,
    KeyE: activateFocusedItem,
    KeyF: openSearch,
    KeyH: openHelpModal,
    KeyS: moveFocusDown,
    KeyW: moveFocusUp,
  }
  const KBD_FLASH_MS = 420
  const KBD_FLASH_KEYS: Record<string, string> = {
    KeyA: 'a',
    KeyD: 'd',
    KeyE: 'e',
    KeyS: 's',
    KeyW: 'w',
  }
  const flashKbdHints = (code: string): void => {
    const key = KBD_FLASH_KEYS[code]
    if (!key) {
      return
    }
    const targets = document.querySelectorAll<HTMLElement>(
      `.page-nav-keyhints kbd[data-key="${key}"], .doc-pane-keyhints kbd[data-key="${key}"], .comments-keyhints kbd[data-key="${key}"]`
    )
    for (const el of targets) {
      el.classList.add('kbd-active')
      globalThis.setTimeout(() => el.classList.remove('kbd-active'), KBD_FLASH_MS)
    }
  }
  const handleAffordanceKeys = (event: KeyboardEvent): void => {
    // suppress 条件:
    //   - editable target 上 / 押しっぱなし (shouldSkipAffordanceKey)
    //   - modifier 付き (hasNoModifier 否定)
    //   - modal open 中 (aria-modal="true" semantic で背面 pane / 別 modal を保護)
    //   - mobile drawer open 中 (modal-backdrop を持たない別経路のため isAnyModalOpen と並列に OR、§5.j)
    if (
      shouldSkipAffordanceKey(event) ||
      !hasNoModifier(event) ||
      isAnyModalOpen() ||
      isMobileDrawerOpen()
    ) {
      return
    }
    const handler = AFFORDANCE_KEY_HANDLERS[event.code]
    if (handler) {
      event.preventDefault()
      flashKbdHints(event.code)
      handler()
    }
  }

  document.addEventListener('keydown', (event): void => {
    if (event.key === 'Escape') {
      handleEscapeKey()
      return
    }
    if (event.key === 'Tab') {
      handleTabKey(event)
      return
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      handleModalSaveKey()
      return
    }
    handleAffordanceKeys(event)
  })
}

const insertBackdropForTest = (id: string, open: boolean): HTMLElement => {
  const el = document.createElement('div')
  el.id = id
  el.classList.add('modal-backdrop')
  if (open) {
    el.classList.add('open')
  }
  document.body.appendChild(el)
  return el
}

const dispatchKeyForTest = (key: string, code: string): KeyboardEvent => {
  // happy-dom は KeyboardEvent constructor の `code` を反映しない versions があるため
  // defineProperty で明示する。defaultPrevented は dispatch 経由のみ更新されるので、
  // 直接呼び出しではなく document.dispatchEvent を経由する。
  // cancelable: true を渡さないと preventDefault が no-op になり defaultPrevented が更新されない。
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key })
  Object.defineProperty(event, 'code', { configurable: true, value: code })
  document.dispatchEvent(event)
  return event
}

const noopForTest = (): void => {
  /* noop */
}
const stubDropdownForTest = (): DropdownLike => ({ close: noopForTest })

const getHelpModalBackdropForTest = (): HTMLElement => {
  const el = document.getElementById('help-modal-backdrop')
  if (el === null) {
    throw new Error('fixture missing: help-modal-backdrop')
  }
  return el
}

const appendButtonForTest = (parent: HTMLElement, id: string): HTMLElement => {
  const btn = document.createElement('button')
  btn.id = id
  parent.appendChild(btn)
  return btn
}

const setupTabTrapFixtureForTest = (): { outsider: HTMLElement } => {
  document.body.innerHTML = ''
  const backdrop = document.createElement('div')
  backdrop.id = 'tab-bd'
  backdrop.className = 'modal-backdrop open'
  appendButtonForTest(backdrop, 'inner-a')
  appendButtonForTest(backdrop, 'inner-b')
  document.body.appendChild(backdrop)
  const outsider = appendButtonForTest(document.body, 'outsider')
  return { outsider }
}

if (import.meta.vitest) {
  const { afterEach, beforeEach, describe, expect, it } = import.meta.vitest

  // setupKeyboardHandlers は document に永続的な listener を attach する。
  // 本ファイル内で 1 回だけ wire して、それ以降の describe で keydown を dispatch する。
  setupKeyboardHandlers(stubDropdownForTest(), stubDropdownForTest(), stubDropdownForTest())

  describe('isAnyModalOpen', () => {
    beforeEach((): void => {
      document.body.innerHTML = ''
    })
    afterEach((): void => {
      document.body.innerHTML = ''
    })

    it('.modal-backdrop が DOM に無ければ false', () => {
      expect(isAnyModalOpen()).toBe(false)
    })

    it('.modal-backdrop だけで open class が無ければ false', () => {
      insertBackdropForTest('test-bd', false)
      expect(isAnyModalOpen()).toBe(false)
    })

    it('.modal-backdrop.open が 1 つでもあれば true', () => {
      insertBackdropForTest('test-bd', true)
      expect(isAnyModalOpen()).toBe(true)
    })

    it('複数 backdrop のうち 1 つでも open なら true', () => {
      insertBackdropForTest('closed-bd', false)
      insertBackdropForTest('open-bd', true)
      expect(isAnyModalOpen()).toBe(true)
    })
  })

  describe('handleAffordanceKeys: modal open 中 short-circuit (integration)', () => {
    // help-modal-backdrop は closeHelpModal が参照する規約 ID。class 切替で open/close を表現する。
    beforeEach((): void => {
      // closeCommentModal が `qs('#modal')` を要求するため、Esc 経路を通すには #modal も用意する。
      document.body.innerHTML = '<div id="modal"></div>'
      insertBackdropForTest('help-modal-backdrop', false)
    })
    afterEach((): void => {
      document.body.innerHTML = ''
    })

    it('modal が無いとき "d" は preventDefault される (handler が走る)', () => {
      const event = dispatchKeyForTest('d', 'KeyD')
      expect(event.defaultPrevented).toBe(true)
    })

    it('modal open 中は "d" の preventDefault が呼ばれない (短絡)', () => {
      getHelpModalBackdropForTest().classList.add('open')
      const event = dispatchKeyForTest('d', 'KeyD')
      expect(event.defaultPrevented).toBe(false)
    })

    it('modal を閉じた後は再び "d" の preventDefault が走る', () => {
      const bd = getHelpModalBackdropForTest()
      bd.classList.add('open')
      bd.classList.remove('open')
      const event = dispatchKeyForTest('d', 'KeyD')
      expect(event.defaultPrevented).toBe(true)
    })

    it('modal open 中でも Esc は modal close 経路を通り backdrop の open class が外れる', () => {
      const bd = getHelpModalBackdropForTest()
      bd.classList.add('open')
      dispatchKeyForTest('Escape', 'Escape')
      expect(bd.classList.contains('open')).toBe(false)
    })

    it('modal open 中の Tab は trapTabInModal 経由で focus が modal 内に留まる', () => {
      // 外側 button に focus してから Tab を dispatch → 先頭の inner button に救出される。
      const { outsider } = setupTabTrapFixtureForTest()
      outsider.focus()
      dispatchKeyForTest('Tab', 'Tab')
      const active = document.activeElement
      expect(active instanceof HTMLElement && active.id).toBe('inner-a')
    })
  })

  describe('mobile drawer 連動 (§4 Step 5)', () => {
    beforeEach((): void => {
      // closeCommentModal が qs('#modal') を要求するため Esc 経路用に最小 DOM を用意する。
      document.body.innerHTML = '<div id="modal"></div>'
    })
    afterEach((): void => {
      document.documentElement.className = ''
      document.body.innerHTML = ''
    })

    it('drawer open 中の Escape で closeMobileDrawers が走り open class が外れる', () => {
      document.documentElement.classList.add('mobile-page-nav-open')
      dispatchKeyForTest('Escape', 'Escape')
      expect(document.documentElement.classList.contains('mobile-page-nav-open')).toBe(false)
    })

    it('drawer 閉のとき affordance キー "d" は preventDefault される (handler が走る)', () => {
      expect(dispatchKeyForTest('d', 'KeyD').defaultPrevented).toBe(true)
    })

    it('drawer open 中は affordance キー "d" が suppress され preventDefault されない', () => {
      document.documentElement.classList.add('mobile-comments-open')
      expect(dispatchKeyForTest('d', 'KeyD').defaultPrevented).toBe(false)
    })
  })
}
