// --- Dialog --------------------------------------------------------------
// `showChoiceDialog` を 1 つの巨大関数にせず、生成・配線・後始末を分けることで、
// OK のみ / OK + Cancel の差分を `addCancelButton` のオプション追加だけで表現する。

/** ボタン要素を生成（type=button を強制してフォーム外での submit 誤発火を避ける） */
const createDialogButton = (label: string, className: string): HTMLButtonElement => {
  const button = document.createElement('button')
  button.className = className
  button.type = 'button'
  button.textContent = label
  return button
}

/** 背景クリック検知用のオーバーレイ。open クラスを最初から付けて transition なしで即表示する */
const createDialogOverlay = (): HTMLDivElement => {
  const overlay = document.createElement('div')
  overlay.className = 'modal-backdrop open'
  return overlay
}

/** ダイアログ本体。role/aria-modal を付けてスクリーンリーダーにモーダルであることを通知する */
const createDialogModal = (): HTMLDivElement => {
  const modal = document.createElement('div')
  modal.className = 'modal'
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')
  return modal
}

/** メッセージ表示要素（既存スタイル流用のため className に modal-quote を使う） */
const createDialogMessage = (message: string): HTMLParagraphElement => {
  const messageEl = document.createElement('p')
  messageEl.className = 'modal-quote'
  messageEl.textContent = message
  return messageEl
}

/** ボタンを並べる行コンテナ */
const createDialogActions = (): HTMLDivElement => {
  const actions = document.createElement('div')
  actions.className = 'modal-actions'
  return actions
}

/** オーバーレイ・モーダル・メッセージ・アクション行を組み合わせた素のシェルを返す。ボタンの追加は呼び出し側で行う */
const buildDialogShell = (
  message: string
): { actions: HTMLDivElement; overlay: HTMLDivElement } => {
  const overlay = createDialogOverlay()
  const modal = createDialogModal()
  const messageEl = createDialogMessage(message)
  const actions = createDialogActions()
  modal.append(messageEl, actions)
  overlay.appendChild(modal)
  return { actions, overlay }
}

type DialogCleanup = (value: boolean) => void

/** Cancel ボタンを追加。confirmDialog のみで使い、noticeDialog では呼ばない */
const addCancelButton = (actions: HTMLDivElement, cleanup: DialogCleanup): void => {
  const cancelButton = createDialogButton('Cancel', 'btn btn-ghost')
  cancelButton.addEventListener('click', (): void => cleanup(false))
  actions.appendChild(cancelButton)
}

/**
 * ダイアログの動作イベントをまとめて配線する。
 * - Escape キーで cancel 扱い
 * - 背景クリックで cancel 扱い（モーダル本体クリックは伝播するが target チェックで吸収）
 * - confirm ボタンで OK 扱い
 * - 描画直後に confirm にフォーカスを移して Enter 即押せる UX を確保
 */
const attachDialogEvents = ({
  cleanup,
  confirmButton,
  onKeydown,
  overlay,
}: {
  cleanup: DialogCleanup
  confirmButton: HTMLButtonElement
  onKeydown: (event: KeyboardEvent) => void
  overlay: HTMLDivElement
}): void => {
  document.addEventListener('keydown', onKeydown)
  overlay.addEventListener('click', (event): void => {
    if (event.target === overlay) {
      cleanup(false)
    }
  })
  confirmButton.addEventListener('click', (): void => cleanup(true))
  setTimeout((): void => confirmButton.focus(), 0)
}

/**
 * モーダルダイアログを Promise ベースで提示する共通関数。
 * `withCancel=true` で OK/Cancel 両ボタン、false で OK のみとなり、結果は boolean に正規化される。
 * listener オブジェクトを介して `cleanup` から keydown ハンドラを参照しているのは、
 * 自己参照の必要があるため（自身を removeEventListener する）。
 */
const showChoiceDialog = async (message: string, withCancel = false): Promise<boolean> =>
  new Promise((resolve): void => {
    const { actions, overlay } = buildDialogShell(message)
    const confirmButton = createDialogButton('OK', 'btn btn-primary')
    const listener: { onKeydown: (event: KeyboardEvent) => void } = {
      onKeydown: (): void => {
        /* placeholder until configured below */
      },
    }
    const cleanup: DialogCleanup = (value): void => {
      document.removeEventListener('keydown', listener.onKeydown)
      overlay.remove()
      resolve(value)
    }
    listener.onKeydown = (event): void => {
      if (event.key === 'Escape') {
        cleanup(false)
      }
    }
    if (withCancel) {
      addCancelButton(actions, cleanup)
    }
    actions.appendChild(confirmButton)
    document.body.appendChild(overlay)
    attachDialogEvents({ cleanup, confirmButton, onKeydown: listener.onKeydown, overlay })
  })

/** OK/Cancel 付きの確認ダイアログ。Cancel 時は false を返す */
export const confirmDialog = async (message: string): Promise<boolean> =>
  showChoiceDialog(message, true)

/** OK のみの通知ダイアログ。返り値は常に true（呼び出し側は無視してよい） */
export const noticeDialog = async (message: string): Promise<boolean> => showChoiceDialog(message)
