// 文書ロード経路を共通化する DocumentLoader factory。
// online / local / paste / open file の全入力経路を `loadDocument(source)` に統一し、
// `registerOnDocumentLoad(hook)` で文書切替時に副作用を自動実行する hook 経路を提供する。
//
// 設計の意図 (docs/feature-ui-i18n.md §3.5 文書ライフサイクル hook):
//   - 各入力経路で `clearOnlineSource()` / `showOnlineSource(url)` を個別に呼ぶと、新しい
//     入力経路を追加した時に呼び忘れる構造的リスクがある。loadDocument に hook を集約することで
//     構造的に整合させる
//   - factory pattern で baseLoader を引数で受けることで循環依存を回避し、既存 app-wiring.ts の
//     online asset decorator (Mermaid / KaTeX / Shiki lazy fetch) が適用済みの loader を
//     そのまま注入できる。直接 import に変えると decorator がバイパスされる
//
// hook の throw 契約: 各モジュールの hook 実装は **throw しない** ことを契約とする
// (副作用は logger / state 更新経由)。内部 try/catch は防御層であり、実装側の規律違反を
// 構造的に許容する保険。hook A が throw しても hook B, C は実行され、loadDocument は
// 引き続き resolve する。

export type DocumentSource =
  | { kind: 'local'; docName: string; body: string }
  | { kind: 'online'; url: string; docName: string; body: string }

export type Unsubscribe = () => void

export interface DocumentLoader {
  loadDocument: (source: DocumentSource) => Promise<void>
  registerOnDocumentLoad: (hook: (source: DocumentSource) => void) => Unsubscribe
}

const recordHookError = (error: unknown): void => {
  // hook 例外を握りつぶす経路は二段: (1) 開発時に hook 規律違反 (throw 禁止契約) を発見する
  // ために console.error で stderr に出す、(2) globalThis に直近の 1 件を記録し test fixture
  // からの assertion を可能にする (online runtime-decorator の `__mdxg*` パターンと整合)。
  // 複数 hook が同一 load で throw した場合は (1) に全件、(2) に最後の 1 件が残る。
  // eslint-disable-next-line no-console
  console.error('[load-document] hook threw, isolated:', error)
  Reflect.set(globalThis, '__mdxgDocumentLoaderHookError', error)
}

/**
 * `loadDocument(source)` と `registerOnDocumentLoad(hook)` を持つ DocumentLoader を組み立てる。
 * baseLoader は decorator 適用済みの `loadFromMarkdown` を渡す (app-wiring.ts の単一合成ポイント)。
 *
 * baseLoader が reject すると hook は実行されず、loadDocument も reject する (フェイルファスト)。
 * baseLoader が resolve した後の hook は失敗隔離: 1 つが throw しても他の hook は実行され、
 * loadDocument は resolve する。反復中に hook 内から unsubscribe() を呼ばれても次の hook が
 * スキップされないよう、スナップショット `hooks.slice()` で反復する。
 */
export const createDocumentLoader = (
  baseLoader: (docName: string, body: string) => Promise<void>
): DocumentLoader => {
  const hooks: ((source: DocumentSource) => void)[] = []
  return {
    loadDocument: async (source): Promise<void> => {
      await baseLoader(source.docName, source.body)
      const snapshot = [...hooks]
      for (const hook of snapshot) {
        try {
          hook(source)
        } catch (error) {
          recordHookError(error)
        }
      }
    },
    registerOnDocumentLoad: (hook): Unsubscribe => {
      hooks.push(hook)
      return (): void => {
        const idx = hooks.indexOf(hook)
        if (idx !== -1) {
          hooks.splice(idx, 1)
        }
      }
    },
  }
}

// === in-source test helpers (module scope to satisfy unicorn/consistent-function-scoping) ===

const noopLoader = async (_docName: string, _body: string): Promise<void> => {
  await Promise.resolve()
}

const buildLocalSource = (overrides: { body?: string; docName?: string } = {}): DocumentSource => ({
  body: overrides.body ?? '# x\n',
  docName: overrides.docName ?? 'doc.md',
  kind: 'local',
})

const buildOnlineSource = (url: string): DocumentSource => ({
  body: '# y\n',
  docName: 'doc.md',
  kind: 'online',
  url,
})

if (import.meta.vitest) {
  const { describe, expect, it, vi } = import.meta.vitest

  describe('createDocumentLoader: loadDocument basics', () => {
    it('baseLoader を docName / body で 1 回呼ぶ', async () => {
      const base = vi.fn(noopLoader)
      const { loadDocument } = createDocumentLoader(base)
      await loadDocument(buildLocalSource({ body: 'body', docName: 'a.md' }))
      expect(base).toHaveBeenCalledTimes(1)
      expect(base).toHaveBeenCalledWith('a.md', 'body')
    })

    it('hook が登録されていない場合も resolve する', async () => {
      const { loadDocument } = createDocumentLoader(noopLoader)
      await expect(loadDocument(buildLocalSource())).resolves.toBeUndefined()
    })

    it('baseLoader が reject すると loadDocument も reject し、hook は呼ばれない', async () => {
      const base = vi.fn(async (): Promise<void> => {
        throw new Error('boom')
      })
      const { loadDocument, registerOnDocumentLoad } = createDocumentLoader(base)
      const hook = vi.fn()
      registerOnDocumentLoad(hook)
      await expect(loadDocument(buildLocalSource())).rejects.toThrow('boom')
      expect(hook).not.toHaveBeenCalled()
    })
  })

  describe('createDocumentLoader: hook invocation', () => {
    it('登録済み hook 全てに source を渡して呼ぶ', async () => {
      const { loadDocument, registerOnDocumentLoad } = createDocumentLoader(noopLoader)
      const hookA = vi.fn()
      const hookB = vi.fn()
      registerOnDocumentLoad(hookA)
      registerOnDocumentLoad(hookB)
      const source = buildOnlineSource('https://a/')
      await loadDocument(source)
      expect(hookA).toHaveBeenCalledWith(source)
      expect(hookB).toHaveBeenCalledWith(source)
    })

    it('hook A が throw しても hook B / C は実行され、loadDocument は resolve する', async () => {
      const { loadDocument, registerOnDocumentLoad } = createDocumentLoader(noopLoader)
      const hookB = vi.fn()
      const hookC = vi.fn()
      registerOnDocumentLoad((): void => {
        throw new Error('A failed')
      })
      registerOnDocumentLoad(hookB)
      registerOnDocumentLoad(hookC)
      await expect(loadDocument(buildLocalSource())).resolves.toBeUndefined()
      expect(hookB).toHaveBeenCalledTimes(1)
      expect(hookC).toHaveBeenCalledTimes(1)
    })

    it('hook throw は globalThis.__mdxgDocumentLoaderHookError に記録される', async () => {
      const { loadDocument, registerOnDocumentLoad } = createDocumentLoader(noopLoader)
      registerOnDocumentLoad((): void => {
        throw new Error('captured')
      })
      await loadDocument(buildLocalSource())
      const recorded: unknown = Reflect.get(globalThis, '__mdxgDocumentLoaderHookError')
      if (!(recorded instanceof Error)) {
        throw new Error('expected recorded hook error')
      }
      expect(recorded.message).toBe('captured')
      Reflect.deleteProperty(globalThis, '__mdxgDocumentLoaderHookError')
    })
  })

  describe('createDocumentLoader: unsubscribe', () => {
    it('戻り値で hook を解除でき、後続 loadDocument で呼ばれない', async () => {
      const { loadDocument, registerOnDocumentLoad } = createDocumentLoader(noopLoader)
      const hook = vi.fn()
      const unsub = registerOnDocumentLoad(hook)
      unsub()
      await loadDocument(buildLocalSource())
      expect(hook).not.toHaveBeenCalled()
    })

    it('複数 hook の中 1 件を unsubscribe しても残りは呼ばれる', async () => {
      const { loadDocument, registerOnDocumentLoad } = createDocumentLoader(noopLoader)
      const hookA = vi.fn()
      const hookB = vi.fn()
      const hookC = vi.fn()
      registerOnDocumentLoad(hookA)
      registerOnDocumentLoad(hookB)()
      registerOnDocumentLoad(hookC)
      await loadDocument(buildLocalSource())
      expect([hookA.mock.calls.length, hookB.mock.calls.length, hookC.mock.calls.length]).toEqual([
        1, 0, 1,
      ])
    })

    it('同じ Unsubscribe を 2 回呼んでも例外を投げない', () => {
      const { registerOnDocumentLoad } = createDocumentLoader(noopLoader)
      const unsub = registerOnDocumentLoad(vi.fn())
      unsub()
      expect((): void => unsub()).not.toThrow()
    })
  })

  describe('createDocumentLoader: 反復中の unsubscribe 耐性', () => {
    it('hook A 自身の unsubscribe でも今回の呼び出しで B / C が呼ばれ、2 回目では A だけ skip', async () => {
      const { loadDocument, registerOnDocumentLoad } = createDocumentLoader(noopLoader)
      let unsubA: Unsubscribe | null = null
      const hookA = vi.fn((): void => {
        if (unsubA !== null) {
          unsubA()
        }
      })
      const [hookB, hookC] = [vi.fn(), vi.fn()]
      unsubA = registerOnDocumentLoad(hookA)
      for (const hook of [hookB, hookC]) {
        registerOnDocumentLoad(hook)
      }
      await loadDocument(buildLocalSource())
      await loadDocument(buildLocalSource())
      // 1 回目: A/B/C すべて呼ばれる。2 回目: A は解除済みで skip、B/C は引き続き呼ばれる。
      // 累積 calls.length で snapshot 検証する (mockClear を使わず statement 数を抑える)。
      expect([hookA.mock.calls.length, hookB.mock.calls.length, hookC.mock.calls.length]).toEqual([
        1, 2, 2,
      ])
    })

    it('hook A が hook B を解除しても、今回の呼び出しで B は呼ばれる', async () => {
      const { loadDocument, registerOnDocumentLoad } = createDocumentLoader(noopLoader)
      const hookB = vi.fn()
      let unsubB: Unsubscribe | null = null
      registerOnDocumentLoad((): void => {
        if (unsubB !== null) {
          unsubB()
        }
      })
      unsubB = registerOnDocumentLoad(hookB)
      await loadDocument(buildLocalSource())
      await loadDocument(buildLocalSource())
      // 1 回目: B は呼ばれて hookA に解除される。2 回目: B は解除済みで skip。累積 1。
      expect(hookB.mock.calls.length).toBe(1)
    })
  })

  describe('createDocumentLoader: 文書ライフサイクル代表シナリオ (§3.5)', () => {
    it('online → local の順で source.kind が hook に正しく渡る', async () => {
      const { loadDocument, registerOnDocumentLoad } = createDocumentLoader(noopLoader)
      const observed: DocumentSource['kind'][] = []
      registerOnDocumentLoad((source): void => {
        observed.push(source.kind)
      })
      await loadDocument(buildOnlineSource('https://a/'))
      await loadDocument(buildLocalSource())
      expect(observed).toEqual(['online', 'local'])
    })
  })
}
