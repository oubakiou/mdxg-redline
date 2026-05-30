// Help modal (MDXG §13 affordance)。
// `?` キーで toggle、Esc / Close ボタン / バックドロップクリックで閉じる。modal HTML 自体は
// src/review.html に静的に置いてあり、本モジュールは open/close のクラス操作と wiring のみ
// 担当する (動的生成の dialog.ts とは別経路: コメント入力モーダルと同じ既存パターン)。
// open/close / focus 復元 / backdrop click の共通骨格は static-modal.ts に集約済みで、
// 本ファイルは toolbar Help button の aria-pressed sync という固有挙動だけ持つ。

import { createStaticModalController } from '../dom/static-modal'

const HELP_TOGGLE_BUTTON_ID = 'btn-help'

const syncHelpToggleButton = (open: boolean): void => {
  const btn = document.getElementById(HELP_TOGGLE_BUTTON_ID)
  if (!(btn instanceof HTMLElement)) {
    return
  }
  btn.classList.toggle('btn-active', open)
  btn.setAttribute('aria-pressed', String(open))
}

const controller = createStaticModalController({
  backdropId: 'help-modal-backdrop',
  closeButtonId: 'help-modal-close',
  onAfterClose: (): void => {
    syncHelpToggleButton(false)
  },
  onAfterOpen: (): void => {
    syncHelpToggleButton(true)
  },
})

export const isHelpModalOpen = (): boolean => controller.isOpen()
export const openHelpModal = (): void => {
  controller.open()
}
export const closeHelpModal = (): void => {
  controller.close()
}

export const toggleHelpModal = (): void => {
  if (controller.isOpen()) {
    controller.close()
    return
  }
  controller.open()
}

export const wireHelpModal = (): void => {
  controller.wire()
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
  // 将来 WASD ベースのマップを変えたら、ここが落ちて気付ける保険 (§13)。
  // 完全な constants 一元化はコスト高なので、最小限の integration test に留める。
  const moduleDir = path.dirname(url.fileURLToPath(import.meta.url))
  const reviewHtmlPath = path.resolve(moduleDir, '..', '..', 'review.html')
  const reviewHtml = fs.readFileSync(reviewHtmlPath, 'utf8')
  const helpSection = /<dl class="help-shortcuts">[\s\S]*?<\/dl>/.exec(reviewHtml)
  const helpSectionText = extractHelpSectionText(helpSection)

  // データ駆動でキー名の存在をチェックすることで、describe / it の数を抑えつつ
  // 将来のキー追加にも 1 行で対応できる。
  const expectedKbdKeys: readonly string[] = [
    'a',
    'd',
    'w',
    's',
    'e',
    'f',
    'h',
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
