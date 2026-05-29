// ドロップダウンメニューの開閉と outside-click 処理を共通化する小さなコントローラ。
// 同じパターン (button toggle + `.menu-item` クリックで close + 外側クリックで close) を
// 持つ「Comments ▾」と Write feedback.json の caret ▾ 両方を 1 つの factory で扱う。
// Esc 処理だけは複数コントローラを横断するため呼び出し側 (review.ts) で集約する。

import { qs } from './dom-utils'

export interface DropdownMenuController {
  close: () => void
  isOpen: () => boolean
  toggle: () => void
}

export interface DropdownMenuOptions {
  /** 開閉トグルとなるボタン要素のセレクタ */
  buttonId: string
  /** 表示制御対象の menu 要素のセレクタ */
  menuId: string
}

/**
 * `buttonId` をトグル、`menuId` を表示対象として一連のイベントを配線する。
 * - button click → toggle (stopPropagation で直後の document click による即 close を防ぐ)
 * - `.menu-item` クリック → close（capture: true で行内の他ハンドラより先に発火）
 * - menu と button 以外の外側 click → close
 */
export const createDropdownMenu = (options: DropdownMenuOptions): DropdownMenuController => {
  const button = qs(options.buttonId)
  const menu = qs(options.menuId)

  const open = (): void => {
    menu.classList.add('open')
    button.setAttribute('aria-expanded', 'true')
  }

  const close = (): void => {
    menu.classList.remove('open')
    button.setAttribute('aria-expanded', 'false')
  }

  const isOpen = (): boolean => menu.classList.contains('open')

  const toggle = (): void => {
    if (isOpen()) {
      close()
      return
    }
    open()
  }

  button.addEventListener('click', (event): void => {
    event.stopPropagation()
    toggle()
  })

  menu.addEventListener(
    'click',
    (event): void => {
      const { target } = event
      if (target instanceof Element && target.closest('.menu-item')) {
        close()
      }
    },
    true
  )

  document.addEventListener('click', (event): void => {
    if (!isOpen()) {
      return
    }
    const { target } = event
    if (
      target instanceof Element &&
      (target.closest(options.menuId) || target.closest(options.buttonId))
    ) {
      return
    }
    close()
  })

  return { close, isOpen, toggle }
}
