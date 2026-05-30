// Mermaid / KaTeX upgrade の共通ユーティリティ。
// 両 renderer は render 本体 (Mermaid: async sequential / KaTeX: sync) と runtime bridge
// (BRIDGE_KEY / READY_EVENT) が非対称だが、状態集計・選択中 defer・idle スケジューラ・
// 失敗 toast の 4 領域は完全に対称なので本ファイルに集約してドリフトを構造的に防ぐ。

import { toast } from '../dom/dom-utils'

export type UpgradeStatus = 'failed' | 'ok' | 'skip'

export interface UpgradeResult {
  changedAny: boolean
  failedCount: number
}

export const accumulateUpgradeResult = (
  acc: UpgradeResult,
  status: UpgradeStatus
): UpgradeResult => {
  if (status === 'ok') {
    return { changedAny: true, failedCount: acc.failedCount }
  }
  if (status === 'failed') {
    return { changedAny: acc.changedAny, failedCount: acc.failedCount + 1 }
  }
  return acc
}

export const hasActiveSelection = (): boolean => {
  const sel = document.getSelection()
  return sel !== null && sel.toString().length > 0
}

export const onSelectionEnd = (callback: () => void): void => {
  const onChange = (): void => {
    if (!hasActiveSelection()) {
      document.removeEventListener('selectionchange', onChange)
      requestAnimationFrame(callback)
    }
  }
  document.addEventListener('selectionchange', onChange)
}

interface IdleScheduler {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
}

const IDLE_TIMEOUT_MS = 2000

export const scheduleIdle = (callback: () => void): void => {
  const ric = (globalThis as IdleScheduler).requestIdleCallback
  if (typeof ric === 'function') {
    ric((): void => callback(), { timeout: IDLE_TIMEOUT_MS })
    return
  }
  setTimeout(callback, 0)
}

export interface RenderFailureLabels {
  /** 1 件失敗時のメッセージ全文 (例: 'Diagram render failed for 1 block') */
  singular: string
  /** N 件 (N >= 2) 失敗時のメッセージテンプレート関数 */
  plural: (count: number) => string
}

export const reportRenderFailures = (failedCount: number, labels: RenderFailureLabels): void => {
  if (failedCount === 0) {
    return
  }
  if (failedCount === 1) {
    toast(labels.singular)
    return
  }
  toast(labels.plural(failedCount))
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('accumulateUpgradeResult', () => {
    it('ok は changedAny を true に上げる', () => {
      const result = accumulateUpgradeResult({ changedAny: false, failedCount: 0 }, 'ok')
      expect(result).toEqual({ changedAny: true, failedCount: 0 })
    })

    it('failed は failedCount をインクリメント', () => {
      const result = accumulateUpgradeResult({ changedAny: false, failedCount: 1 }, 'failed')
      expect(result).toEqual({ changedAny: false, failedCount: 2 })
    })

    it('skip は変化なし', () => {
      const before = { changedAny: true, failedCount: 3 }
      expect(accumulateUpgradeResult(before, 'skip')).toEqual(before)
    })
  })
}
