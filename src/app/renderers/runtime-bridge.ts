// Mermaid / KaTeX 等のブラウザ側 runtime 注入を待つ共通 primitive。
// 各 runtime は `globalThis.__mdxg<X>` に bridge 値を書き込み、`mdxg:<x>-ready` イベントを
// dispatch する規約。本関数は (1) 対応する `<script id="embedded-<x>">` の存在チェック、
// (2) すでに bridge が立っていれば即返却、(3) 立っていなければ ready event を最大 timeout ms 待つ、
// の 3 段で目的の runtime オブジェクトを取得する。embedded script 自体が無ければ即 null
// (runtime 非注入時のフォールバック経路と一致)。

export interface RuntimeBridgeConfig<Runtime> {
  /** `globalThis.<bridgeKey>` に runtime が書き込まれる規約 (例: '__mdxgMermaid') */
  bridgeKey: string
  /** `<script id="<embeddedScriptId>">` で runtime ESM が読み込まれているか判定する DOM id */
  embeddedScriptId: string
  /** bridge candidate が runtime として有効か判定する type guard */
  isValid: (candidate: unknown) => candidate is Runtime
  /** runtime ロード完了時に dispatch される CustomEvent name (例: 'mdxg:mermaid-ready') */
  readyEvent: string
  /** ready event 待機の最大 ms (既定 2000ms) */
  readyTimeoutMs?: number
}

const DEFAULT_READY_TIMEOUT_MS = 2000

/**
 * runtime bridge 値が指定 key 群を `function` として持つか検査する generic type guard。
 * Mermaid / KaTeX 等のブラウザ runtime は object root + 必要 API が関数の形であるため、
 * `requiredFunctionKeys` を渡すだけで `isMermaidLike` / `isKatexLike` 個別実装の写し間違いを防げる。
 */
export const isRuntimeLike = <Runtime>(
  value: unknown,
  requiredFunctionKeys: readonly (keyof Runtime)[]
): value is Runtime => {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  return requiredFunctionKeys.every((key): boolean => typeof Reflect.get(value, key) === 'function')
}

const hasEmbeddedScript = (id: string): boolean => {
  const el = document.getElementById(id)
  if (!(el instanceof HTMLElement)) {
    return false
  }
  return (el.textContent ?? '').trim().length > 0
}

export const waitForRuntime = async <Runtime>(
  config: RuntimeBridgeConfig<Runtime>
): Promise<Runtime | null> => {
  if (!hasEmbeddedScript(config.embeddedScriptId)) {
    return null
  }
  const readBridge = (): Runtime | null => {
    const candidate = Reflect.get(globalThis, config.bridgeKey)
    if (config.isValid(candidate)) {
      return candidate
    }
    return null
  }
  const present = readBridge()
  if (present !== null) {
    return present
  }
  const timeoutMs = config.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS
  return new Promise<Runtime | null>((resolve): void => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const onReady = (): void => {
      if (timer !== null) {
        clearTimeout(timer)
      }
      resolve(readBridge())
    }
    timer = setTimeout((): void => {
      document.removeEventListener(config.readyEvent, onReady)
      resolve(null)
    }, timeoutMs)
    document.addEventListener(config.readyEvent, onReady, { once: true })
  })
}

interface FakeBridge {
  tag: 'fake'
}

const isFakeBridge = (value: unknown): value is FakeBridge =>
  typeof value === 'object' && value !== null && (value as { tag?: unknown }).tag === 'fake'

const buildFakeConfig = (
  bridgeKey: string,
  embeddedScriptId: string,
  readyEvent: string
): RuntimeBridgeConfig<FakeBridge> => ({
  bridgeKey,
  embeddedScriptId,
  isValid: isFakeBridge,
  readyEvent,
  readyTimeoutMs: 50,
})

const installEmbeddedScriptForTest = (id: string): HTMLElement => {
  const el = document.createElement('script')
  el.id = id
  el.textContent = '1'
  document.body.appendChild(el)
  return el
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('waitForRuntime', () => {
    it('embedded script が無いと即 null を返す', async () => {
      const config = buildFakeConfig('__mdxgFake1', 'embedded-fake1', 'mdxg:fake1-ready')
      const result = await waitForRuntime(config)
      expect(result).toBeNull()
    })

    it('既に bridge があれば即返す', async () => {
      const config = buildFakeConfig('__mdxgFake2', 'embedded-fake2', 'mdxg:fake2-ready')
      const script = installEmbeddedScriptForTest('embedded-fake2')
      Reflect.set(globalThis, '__mdxgFake2', { tag: 'fake' })
      try {
        const result = await waitForRuntime(config)
        expect(result).toEqual({ tag: 'fake' })
      } finally {
        Reflect.deleteProperty(globalThis, '__mdxgFake2')
        script.remove()
      }
    })

    it('ready event 発火で bridge を取得する', async () => {
      const config = buildFakeConfig('__mdxgFake3', 'embedded-fake3', 'mdxg:fake3-ready')
      const script = installEmbeddedScriptForTest('embedded-fake3')
      try {
        const pending = waitForRuntime(config)
        Reflect.set(globalThis, '__mdxgFake3', { tag: 'fake' })
        document.dispatchEvent(new CustomEvent('mdxg:fake3-ready'))
        const result = await pending
        expect(result).toEqual({ tag: 'fake' })
      } finally {
        Reflect.deleteProperty(globalThis, '__mdxgFake3')
        script.remove()
      }
    })

    it('timeout 内に ready event が来ないと null を返す', async () => {
      const config = buildFakeConfig('__mdxgFake4', 'embedded-fake4', 'mdxg:fake4-ready')
      const script = installEmbeddedScriptForTest('embedded-fake4')
      try {
        const result = await waitForRuntime(config)
        expect(result).toBeNull()
      } finally {
        script.remove()
      }
    })
  })
}
