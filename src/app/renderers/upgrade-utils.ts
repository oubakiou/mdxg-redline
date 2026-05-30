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

/**
 * rAF × 2 を挟んで初回 paint を確実に通してから `callback` を呼ぶ。
 * 1 回目で layout、2 回目で paint 完了が保証される (Shiki ハイライト upgrade のように
 * 初回 paint された生 markup を残したまま innerHTML を差し替えたい用途)。
 */
export const scheduleAfterPaint = (callback: () => void): void => {
  requestAnimationFrame((): void => {
    requestAnimationFrame(callback)
  })
}

/**
 * 任意の `scheduler` で `task` を実行する高階 combinator。task 起動時に選択範囲が
 * 残っていれば `selectionchange` で空に戻るのを待ち、空になった次の rAF で再試行する。
 * Mermaid / KaTeX は `scheduleIdle`、Shiki は `scheduleAfterPaint` を渡す形で
 * paint timing は呼び出し側に保持しつつ「選択中 defer」だけを共通化する。
 */
export const scheduleWithSelectionGuard = (
  scheduler: (callback: () => void) => void,
  task: () => void
): void => {
  const runGuarded = (): void => {
    if (hasActiveSelection()) {
      onSelectionEnd(runGuarded)
      return
    }
    task()
  }
  scheduler(runGuarded)
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

// jsdom の Selection は実装が薄いため getSelection を差し替えて「選択あり / 解除」
// を制御するスタブを使う (in-source test 専用 helper)。
interface SelectionStubHandle {
  setText: (text: string) => void
  restore: () => void
}

const installSelectionStubForTest = (initialText: string): SelectionStubHandle => {
  const originalGetSelection: typeof document.getSelection = document.getSelection.bind(document)
  let selectionText = initialText
  // 完全な Selection を満たすには 30+ プロパティが必要だが、本コードが触るのは toString のみ。
  // 部分実装で十分なため unknown 経由でキャストする。
  const stub = (): Selection | null =>
    // 完全な Selection を満たすには 30+ プロパティが必要だが、本コードが触るのは toString のみ。
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    ({
      toString: (): string => selectionText,
    }) as unknown as Selection
  document.getSelection = stub
  return {
    restore: (): void => {
      document.getSelection = originalGetSelection
    },
    setText: (text): void => {
      selectionText = text
    },
  }
}

const waitOneFrameForTest = async (): Promise<void> => {
  await new Promise<void>((resolve): void => {
    requestAnimationFrame((): void => {
      resolve()
    })
  })
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

  describe('scheduleAfterPaint', () => {
    it('rAF を 2 段挟んでから callback を呼ぶ (1 段では発火しない)', async () => {
      const order: string[] = []
      scheduleAfterPaint((): void => {
        order.push('callback')
      })
      // 1 段だけ rAF を待つ: まだ呼ばれていない
      await new Promise<void>((resolve): void => {
        requestAnimationFrame((): void => {
          order.push('after-rAF-1')
          resolve()
        })
      })
      expect(order).toEqual(['after-rAF-1'])
      // もう 1 段待つと callback が来る
      await new Promise<void>((resolve): void => {
        requestAnimationFrame((): void => {
          requestAnimationFrame((): void => {
            resolve()
          })
        })
      })
      expect(order).toContain('callback')
    })
  })

  describe('scheduleWithSelectionGuard', () => {
    it('選択が無ければ scheduler 起動時にそのまま task を呼ぶ', () => {
      const called: string[] = []
      const scheduler = (cb: () => void): void => {
        called.push('scheduler')
        cb()
      }
      scheduleWithSelectionGuard(scheduler, (): void => {
        called.push('task')
      })
      expect(called).toEqual(['scheduler', 'task'])
    })

    it('選択中なら task は走らず、selectionchange で空に戻った次の rAF で再試行する', async () => {
      const selection = installSelectionStubForTest('highlighted')
      const called: string[] = []
      try {
        scheduleWithSelectionGuard(
          (cb): void => {
            cb()
          },
          (): void => {
            called.push('task')
          }
        )
        expect(called).toEqual([])
        selection.setText('')
        document.dispatchEvent(new Event('selectionchange'))
        await waitOneFrameForTest()
        expect(called).toEqual(['task'])
      } finally {
        selection.restore()
      }
    })
  })
}
