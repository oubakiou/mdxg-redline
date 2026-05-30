// Mermaid / KaTeX upgrade の共通 orchestrator。
// renderer 個別の collectElements / upgradeOne / runtime 取得は呼び出し側に残し、
// 「blockOriginalHTML の焼き直し / 失敗時 toast / paint 後 idle スケジュール」の
// 横断パターンを 1 ファイルに集約してドリフトを構造的に防ぐ。
// 状態集計 / 選択中 defer / 失敗 toast 低レベル primitive は upgrade-utils.ts、
// runtime 取得は runtime-bridge.ts に分離されている。

import { scheduleIdle, scheduleWithSelectionGuard } from './upgrade-utils'
import { state } from '../state/app-state'
import { toast } from '../dom/dom-utils'

/**
 * upgrade 後の要素を含む `[data-block-id]` 親 block の innerHTML を blockOriginalHTML に焼き直す。
 * upgrade で innerHTML が変化 (KaTeX) または兄弟構造が変化 (Mermaid: <pre hidden> + sibling <svg>)
 * した要素に対して呼ぶ。reapplyAllMarks 経路で親ブロックの innerHTML 全体を更新する必要があるため。
 */
const cacheParentBlockHtml = (el: HTMLElement): void => {
  const parent = el.closest<HTMLElement>('[data-block-id]')
  if (parent === null) {
    return
  }
  const { blockId } = parent.dataset
  if (typeof blockId === 'string' && blockId !== '') {
    state.blockOriginalHTML.set(blockId, parent.innerHTML)
  }
}

/**
 * 指定 selector に該当する upgrade 済み要素の親 block の innerHTML を blockOriginalHTML に
 * 焼き直す。Mermaid なら `pre[data-mermaid-applied="1"]`、KaTeX なら `[data-math-applied="1"]`。
 */
export const refreshAppliedBlocksOriginalHTML = (docEl: HTMLElement, selector: string): void => {
  for (const el of docEl.querySelectorAll<HTMLElement>(selector)) {
    cacheParentBlockHtml(el)
  }
}

/**
 * upgrade を Promise として実行し、想定外例外を共通 catch で toast に流す。
 * upgrade 内部は個別要素の fail を data-*-failed フラグで吸収する前提で、
 * ここに到達する例外は環境異常などの「想定外」を意味する。
 *
 * `upgrade` は async 関数であること。非 async で呼び出し時点で sync throw する関数を
 * 渡すと `.catch` を経由せずに caller へ伝播するため、呼び出し側で常に
 * `async (): Promise<void> => doSomething(...)` のように包む。
 */
export const runUpgradeIgnoringErrors = (
  upgrade: () => Promise<void>,
  errorMessage: string
): void => {
  upgrade().catch((): void => {
    toast(errorMessage)
  })
}

/**
 * paint 後 idle で upgrade を実行するエントリ。選択中は selectionchange を待ち、
 * 空に戻ったら再試行する (Shiki / cmt mark との競合回避、§5.b C 案)。
 */
export const scheduleUpgradeOnIdle = (run: () => void): void => {
  scheduleWithSelectionGuard(scheduleIdle, run)
}

const rejectingUpgradeForTest = async (): Promise<void> => {
  throw new Error('boom')
}

const ensureToastElementForTest = (): HTMLElement => {
  const existing = document.getElementById('toast')
  if (existing) {
    return existing
  }
  const el = document.createElement('div')
  el.id = 'toast'
  document.body.appendChild(el)
  return el
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('refreshAppliedBlocksOriginalHTML', () => {
    it('selector にマッチする要素の親 block の innerHTML を state に格納', () => {
      const root = document.createElement('div')
      const block = document.createElement('div')
      block.setAttribute('data-block-id', 'b-orch')
      block.innerHTML = '<span data-marker="applied">x</span>'
      root.appendChild(block)
      state.blockOriginalHTML.delete('b-orch')
      refreshAppliedBlocksOriginalHTML(root, '[data-marker="applied"]')
      expect(state.blockOriginalHTML.get('b-orch')).toBe(block.innerHTML)
    })

    it('selector に該当が無ければ state を触らない', () => {
      const root = document.createElement('div')
      const block = document.createElement('div')
      block.setAttribute('data-block-id', 'b-orch-empty')
      block.innerHTML = '<span>plain</span>'
      root.appendChild(block)
      state.blockOriginalHTML.delete('b-orch-empty')
      refreshAppliedBlocksOriginalHTML(root, '[data-marker="applied"]')
      expect(state.blockOriginalHTML.has('b-orch-empty')).toBe(false)
    })

    it('data-block-id 祖先が無い要素は no-op (fail-soft)', () => {
      const root = document.createElement('div')
      const orphan = document.createElement('span')
      orphan.setAttribute('data-marker', 'applied')
      root.appendChild(orphan)
      expect((): void => {
        refreshAppliedBlocksOriginalHTML(root, '[data-marker="applied"]')
      }).not.toThrow()
    })
  })

  describe('runUpgradeIgnoringErrors', () => {
    it('upgrade が reject すると toast を出して swallow する (rethrow しない)', async () => {
      const toastEl = ensureToastElementForTest()
      expect((): void => {
        runUpgradeIgnoringErrors(rejectingUpgradeForTest, 'fake upgrade failed')
      }).not.toThrow()
      await new Promise((resolve): void => {
        setTimeout(resolve, 0)
      })
      expect(toastEl.textContent).toBe('fake upgrade failed')
    })

    it('upgrade が resolve すれば toast は出ない', async () => {
      const toastEl = ensureToastElementForTest()
      toastEl.textContent = ''
      let resolved = false
      runUpgradeIgnoringErrors(async (): Promise<void> => {
        resolved = true
      }, 'should-not-toast')
      await new Promise((resolve): void => {
        setTimeout(resolve, 0)
      })
      expect(resolved).toBe(true)
      expect(toastEl.textContent).toBe('')
    })
  })
}
