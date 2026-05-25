// Help modal (MDXG §13 affordance)。
// `?` キーで toggle、Esc / Close ボタン / バックドロップクリックで閉じる。modal HTML 自体は
// src/review.html に静的に置いてあり、本モジュールは open/close のクラス操作と wiring のみ
// 担当する (動的生成の dialog.ts とは別経路: コメント入力モーダルと同じ既存パターン)。

const HELP_MODAL_BACKDROP_ID = 'help-modal-backdrop'
const HELP_MODAL_CLOSE_ID = 'help-modal-close'

// open 直前にフォーカスを持っていた要素を保存し、close 時にそこへ戻す
// (WAI-ARIA Authoring Practices のモーダルパターン)。`?` で開いた場合は直前の link 等、
// toolbar の Help ボタン経由なら `#btn-help` が target になる。modal 内部に既にフォーカスが
// いる時 (open のループ) は上書きしないことで、最初に modal を開いた発火元を保持する。
let lastTrigger: HTMLElement | null = null

const findBackdrop = (): HTMLElement | null => {
  const element = document.getElementById(HELP_MODAL_BACKDROP_ID)
  if (!(element instanceof HTMLElement)) {
    return null
  }
  return element
}

export const isHelpModalOpen = (): boolean => {
  const backdrop = findBackdrop()
  if (backdrop === null) {
    return false
  }
  return backdrop.classList.contains('open')
}

const captureTrigger = (backdrop: HTMLElement): void => {
  if (isHelpModalOpen()) {
    return
  }
  const active = document.activeElement
  if (active instanceof HTMLElement && !backdrop.contains(active)) {
    lastTrigger = active
  }
}

export const openHelpModal = (): void => {
  const backdrop = findBackdrop()
  if (backdrop === null) {
    return
  }
  captureTrigger(backdrop)
  backdrop.classList.add('open')
  const closeBtn = document.getElementById(HELP_MODAL_CLOSE_ID)
  if (closeBtn instanceof HTMLElement) {
    closeBtn.focus()
  }
}

export const closeHelpModal = (): void => {
  const backdrop = findBackdrop()
  if (backdrop === null) {
    return
  }
  backdrop.classList.remove('open')
  if (lastTrigger !== null) {
    lastTrigger.focus()
    lastTrigger = null
  }
}

export const toggleHelpModal = (): void => {
  if (isHelpModalOpen()) {
    closeHelpModal()
    return
  }
  openHelpModal()
}

/**
 * Close ボタンとバックドロップクリックで modal を閉じる listener を attach する。
 * Esc キーは review.ts の global keydown handler 側で扱う (他 modal / menu と同じ場所で
 * Esc の責務を一箇所にまとめるため)。
 */
export const wireHelpModal = (): void => {
  const backdrop = findBackdrop()
  if (backdrop === null) {
    return
  }
  const closeBtn = document.getElementById(HELP_MODAL_CLOSE_ID)
  if (closeBtn instanceof HTMLElement) {
    closeBtn.addEventListener('click', closeHelpModal)
  }
  backdrop.addEventListener('click', (event): void => {
    if (event.target === backdrop) {
      closeHelpModal()
    }
  })
}

// help-shortcuts <dl> matcher の戻り値を string に正規化する純粋ヘルパ (in-source test 専用)。
// outer scope 必須 (consistent-function-scoping)、let を避けて const 経由で string を取り出すため
// destructuring を介する (prefer-destructuring)。
const extractHelpSectionText = (match: RegExpExecArray | null): string => {
  if (match === null) {
    return ''
  }
  const [text] = match
  return text
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest
  const fs = await import('node:fs')
  const path = await import('node:path')
  const url = await import('node:url')

  // help modal の HTML 文言 (src/review.html) と review.ts 側のキーバインド実装が
  // ずれないよう、HTML 内に期待のキーが残っているかを文字列マッチで verify する。
  // 将来 `g` を別キーに変えたら / `?` を変えたら、ここが落ちて気付ける保険 (§13)。
  // 完全な constants 一元化はコスト高なので、最小限の integration test に留める。
  const moduleDir = path.dirname(url.fileURLToPath(import.meta.url))
  const reviewHtmlPath = path.resolve(moduleDir, '..', 'review.html')
  const reviewHtml = fs.readFileSync(reviewHtmlPath, 'utf8')
  const helpSection = /<dl class="help-shortcuts">[\s\S]*?<\/dl>/.exec(reviewHtml)
  const helpSectionText = extractHelpSectionText(helpSection)

  // データ駆動でキー名の存在をチェックすることで、describe / it の数を抑えつつ
  // 将来のキー追加にも 1 行で対応できる。
  const expectedKbdKeys: readonly string[] = [
    'g',
    '?',
    'Esc',
    'Tab',
    'Enter',
    '↑',
    '↓',
    'Home',
    'End',
  ]

  describe('help modal HTML / 実装の整合 (§13)', () => {
    it('help-shortcuts <dl> ブロックが src/review.html に存在する', () => {
      expect(helpSection).not.toBeNull()
    })

    it.each(expectedKbdKeys)('`%s` のキーバインドが <kbd> 表記で含まれる', (key) => {
      expect(helpSectionText).toContain(`<kbd>${key}</kbd>`)
    })
  })
}
