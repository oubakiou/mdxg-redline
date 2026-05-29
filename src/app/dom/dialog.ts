// --- Dialog --------------------------------------------------------------
// `showChoiceDialog` を 1 つの巨大関数にせず、生成・配線・後始末を分けることで、
// OK のみ / OK + Cancel の差分を `addCancelButton` のオプション追加だけで表現する。
// 構造は header (title) / body (optional message) / footer (actions) の Primer 流 3 区画。

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

let dialogTitleCounter = 0
/** title 要素と一意な ID を発行して aria-labelledby と組で使えるようにする */
const nextDialogTitleId = (): string => {
  dialogTitleCounter += 1
  return `modal-title-${String(dialogTitleCounter)}`
}

/** ダイアログ本体。role/aria-modal を付けてスクリーンリーダーにモーダルであることを通知する。
 * modal-compact はテキスト主体の confirm / notice 用に幅を絞るための modifier
 * （textarea を含むコメント入力モーダルとは幅要件が異なる）。 */
const createDialogModal = (titleId: string): HTMLDivElement => {
  const modal = document.createElement('div')
  modal.className = 'modal modal-compact'
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')
  modal.setAttribute('aria-labelledby', titleId)
  return modal
}

/** ヘッダー section。Primer 流の太字タイトルを内包する */
const createDialogHeader = (title: string, titleId: string): HTMLElement => {
  const header = document.createElement('header')
  header.className = 'modal-header'
  const titleEl = document.createElement('h2')
  titleEl.className = 'modal-title'
  titleEl.id = titleId
  titleEl.textContent = title
  header.appendChild(titleEl)
  return header
}

/** body section。modal 設計上 title + body の 2 段は常に揃える前提 */
const createDialogBody = (message: string): HTMLDivElement => {
  const body = document.createElement('div')
  body.className = 'modal-body'
  const messageEl = document.createElement('p')
  messageEl.className = 'modal-message'
  messageEl.textContent = message
  body.appendChild(messageEl)
  return body
}

/** footer section。ボタンを並べる行コンテナ */
const createDialogActions = (): HTMLElement => {
  const actions = document.createElement('footer')
  actions.className = 'modal-actions'
  return actions
}

/** オーバーレイ・モーダル・header / body / footer を組み合わせた素のシェルを返す。
 * title と body は両方とも必須。title だけで成立する短い問いかけでも、利用者の不安を
 * 拭うための補足（影響範囲・可逆性など）を意識的に書くことを呼び出し規約として強制している。
 * 呼び出し側はボタンを actions に追加する。 */
const buildDialogShell = (
  title: string,
  body: string
): { actions: HTMLElement; overlay: HTMLDivElement } => {
  const overlay = createDialogOverlay()
  const titleId = nextDialogTitleId()
  const modal = createDialogModal(titleId)
  const header = createDialogHeader(title, titleId)
  const actions = createDialogActions()
  modal.append(header, createDialogBody(body), actions)
  overlay.appendChild(modal)
  return { actions, overlay }
}

type DialogCleanup = (value: boolean) => void

/** Cancel ボタンを追加。confirmDialog のみで使い、noticeDialog では呼ばない */
const addCancelButton = (actions: HTMLElement, cleanup: DialogCleanup): void => {
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
const showChoiceDialog = async (
  title: string,
  body: string,
  withCancel = false
): Promise<boolean> =>
  new Promise((resolve): void => {
    const { actions, overlay } = buildDialogShell(title, body)
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

/** OK/Cancel 付きの確認ダイアログ。Cancel 時は false を返す。
 * title (見出し) と body (補足説明) の両方が必須。短い問いかけでも影響範囲や
 * 可逆性を必ず body で示す呼び出し規約とする。 */
export const confirmDialog = async (title: string, body: string): Promise<boolean> =>
  showChoiceDialog(title, body, true)

/** OK のみの通知ダイアログ。返り値は常に true（呼び出し側は無視してよい）。
 * title と body は両方とも必須（理由は confirmDialog 同様）。 */
export const noticeDialog = async (title: string, body: string): Promise<boolean> =>
  showChoiceDialog(title, body)
