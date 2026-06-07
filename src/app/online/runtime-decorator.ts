// online edition の全入力経路 (toolbar Open file / Open URL modal / boot ?url=) で
// 単一の asset-loader 経路を経由するための `loadFromMarkdown` decorator。装飾後の
// loadFromMarkdown は呼び出しごとに asset-loader を fire-and-forget で発火させる。
//
// 前世代の fetch は AbortController.abort() で停止し、inFlight Map を clear して abort 済み
// Promise を切り離す。これをしないと次世代の同一 URL 要求が旧 Promise を再利用して即
// AbortError で reject される。

import { loadOnlineAssets, type OnlineAssetCache } from './asset-loader'

export type LoadFromMarkdown = (name: string, text: string) => Promise<void>

const getOnlineBaseUrl = (): URL => {
  if (typeof document === 'undefined') {
    return new URL('about:blank')
  }
  return new URL(document.baseURI)
}

const bumpGeneration = (cache: OnlineAssetCache): void => {
  if (cache.currentAbortController !== null) {
    cache.currentAbortController.abort()
  }
  cache.inFlight.clear()
  cache.currentAbortController = new AbortController()
  cache.generation += 1
}

/**
 * `loadFromMarkdown(name, text)` を装飾して asset-loader を発火させる。base の Promise<void>
 * はそのまま return することで await chain を壊さない。asset-loader は fire-and-forget で、
 * 大きな runtime の load 中も plain 描画を block しない。
 *
 * decorator 自体は pure 関数で、base を mutate せず新規関数を返す。
 */
export const decorateLoadFromMarkdownForOnline =
  (base: LoadFromMarkdown, cache: OnlineAssetCache): LoadFromMarkdown =>
  async (name: string, text: string): Promise<void> => {
    bumpGeneration(cache)
    // asset-loader 戻り値の Promise は意図的に握りつぶす (fire-and-forget)。unhandled rejection
    // を避けるため `.catch` だけは付け、内容は外側から見える globalThis に記録するに留める。
    loadOnlineAssets(text, getOnlineBaseUrl(), cache).catch((error: unknown): void => {
      Reflect.set(globalThis, '__mdxgOnlineAssetLoaderRejection', error)
    })
    return base(name, text)
  }

// === in-source test helpers (module scope) ===

const resolveVoid = async (): Promise<void> => {
  // no-op
}

const callDecorated = async (
  decorated: LoadFromMarkdown,
  name: string,
  text: string
): Promise<void> => decorated(name, text)

if (import.meta.vitest) {
  const { describe, expect, it, vi } = import.meta.vitest
  const { createOnlineAssetCache } = await import('./asset-loader')

  const assertControllerSwap = (
    before: AbortController | null,
    after: AbortController | null
  ): void => {
    expect(before).not.toBeNull()
    expect(after).not.toBe(before)
    if (before !== null) {
      expect(before.signal.aborted).toBe(true)
    }
    if (after !== null) {
      expect(after.signal.aborted).toBe(false)
    }
  }

  describe('decorateLoadFromMarkdownForOnline', () => {
    it('base loadFromMarkdown を mutate せず新規関数を返す (pure)', () => {
      const base = vi.fn(resolveVoid)
      const cache = createOnlineAssetCache()
      const decorated = decorateLoadFromMarkdownForOnline(base, cache)
      expect(decorated).not.toBe(base)
    })

    it('装飾 runtime は base.loadFromMarkdown を await chain で透過する', async () => {
      let baseInvoked = false
      const base: LoadFromMarkdown = async (): Promise<void> => {
        baseInvoked = true
      }
      const cache = createOnlineAssetCache()
      const decorated = decorateLoadFromMarkdownForOnline(base, cache)
      await callDecorated(decorated, 'doc', '# x\n')
      expect(baseInvoked).toBe(true)
    })

    it('loadFromMarkdown 呼び出しで cache.generation が +1 される', async () => {
      const base = vi.fn(resolveVoid)
      const cache = createOnlineAssetCache()
      const decorated = decorateLoadFromMarkdownForOnline(base, cache)
      expect(cache.generation).toBe(0)
      await callDecorated(decorated, 'doc', '# x\n')
      expect(cache.generation).toBe(1)
      await callDecorated(decorated, 'doc', '# y\n')
      expect(cache.generation).toBe(2)
    })

    it('前世代の AbortController が abort() されて新しい controller に差し替わる', async () => {
      const base = vi.fn(resolveVoid)
      const cache = createOnlineAssetCache()
      const decorated = decorateLoadFromMarkdownForOnline(base, cache)
      await callDecorated(decorated, 'doc', '# x\n')
      const firstController = cache.currentAbortController
      await callDecorated(decorated, 'doc', '# y\n')
      const secondController = cache.currentAbortController
      assertControllerSwap(firstController, secondController)
    })

    it('decorator が呼ばれるたびに inFlight Map.clear() で旧 Promise を切り離す', async () => {
      const base = vi.fn(resolveVoid)
      const cache = createOnlineAssetCache()
      cache.inFlight.set('https://stale/x.json', Promise.resolve('stale'))
      const decorated = decorateLoadFromMarkdownForOnline(base, cache)
      await callDecorated(decorated, 'doc', '# x\n')
      expect(cache.inFlight.has('https://stale/x.json')).toBe(false)
    })

    it('base loadFromMarkdown は装飾後も同じ引数で呼ばれる', async () => {
      const base = vi.fn(resolveVoid)
      const cache = createOnlineAssetCache()
      const decorated = decorateLoadFromMarkdownForOnline(base, cache)
      await callDecorated(decorated, 'mydoc', '# title\n')
      expect(base).toHaveBeenCalledWith('mydoc', '# title\n')
    })
  })
}
