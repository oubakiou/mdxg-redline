// グローバル keydown を 1 経路に集約する WASD キーマップの wiring (§13)。
// Escape (modal/menu 閉じ) → Cmd/Ctrl+Enter (modal save) → WASD affordance の 3 段で dispatch する。

import { closeCommentModal } from '../comments/comment-modal'
import { closeHelpModal, openHelpModal } from './help-modal'
import { closeMermaidModal } from '../renderers/mermaid-modal'
import { closeOpenUrlModal } from '../online/open-url-modal'
import { closeSearch, isSearchOpen, openSearch } from '../search/search'
import { qs } from '../dom/dom-utils'
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

/**
 * グローバル keydown を 1 経路に集約する。Escape (modal/menu 閉じ) → Cmd/Ctrl+Enter
 * (modal save) → WASD affordance の 3 段で dispatch する。
 * commentsMenu / sendMenu は createDropdownMenu の戻り値で、Escape 時に同時に閉じる必要があるため
 * 引数として渡す (DOM ID 経由で再取得しても良いが、close handle を直接持つ方が破綻に強い)。
 */
export const setupKeyboardHandlers = (commentsMenu: DropdownLike, sendMenu: DropdownLike): void => {
  const handleEscapeKey = (): void => {
    closeCommentModal()
    closeHelpModal()
    closeMermaidModal()
    closeOpenUrlModal()
    commentsMenu.close()
    sendMenu.close()
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
    if (shouldSkipAffordanceKey(event)) {
      return
    }
    if (!hasNoModifier(event)) {
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
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      handleModalSaveKey()
      return
    }
    handleAffordanceKeys(event)
  })
}
