// online edition の起動経路で fire-and-forget 発火する非同期 asset loader。markdown 本文を
// scan して必要な Shiki grammar / Mermaid runtime / KaTeX runtime を同一オリジン同梱資材から
// 並行 fetch し、各 renderer の後追い注入経路を経由して progressive upgrade を起動する。
//
// 世代 ID / AbortController / in-flight Promise cache の 3 段で連続文書ロードの競合を抑える。
// AbortController.abort() の直後に inFlight.clear() を呼ばないと、abort 済み Promise が
// Map に残り、次世代の同一 URL 要求がそれを再利用 → 即 AbortError で reject される競合に
// 陥る。

import { installShikiGrammars } from '../renderers/shiki'
import {
  type OnlineAssetManifest,
  readOnlineAssetManifestFromDom,
  resolveCanonicalShikiLangPath,
  resolveShikiLangPath,
} from '../../core/online-asset-manifest'
import { countMath } from '../../core/math'
import { scanFencedLangs } from '../../core/scan-fenced-langs'
import { scanMermaidFences } from '../../core/scan-mermaid'
import type { SupportedLang } from '../../core/shiki-aliases.generated'

export interface OnlineAssetCache {
  /** loadFromMarkdown 呼び出しごとに inc。status 更新の世代 gate に使う */
  currentAbortController: AbortController | null
  generation: number
  /** 同一 URL の重複取得を集約。abort 時に clear() で旧 Promise を切り離す必要がある */
  readonly inFlight: Map<string, Promise<unknown>>
  /** runtime 後追い注入が未実装の間は true 初期化で loader を skip させる stub */
  katex: boolean
  readonly langs: Set<SupportedLang>
  /** runtime 後追い注入が未実装の間は true 初期化で loader を skip させる stub */
  mermaid: boolean
}

export type AssetLoadCause =
  | 'aborted-by-newer-generation'
  | 'katex-css-fetch-404'
  | 'katex-css-fetch-network'
  | 'katex-import-reject'
  | 'mermaid-import-reject'
  | 'shiki-fetch-404'
  | 'shiki-fetch-network'
  | 'shiki-parse-error'

export type AssetLoadReason = 'recovered-from-404' | 'recovered-from-load-failure'

export interface AssetLoadFailure {
  asset: 'katex' | 'mermaid' | 'shiki'
  cause: AssetLoadCause
  detail: string
  lang?: SupportedLang
  reason?: AssetLoadReason
}

export interface OnlineAssetLoadResult {
  failures: AssetLoadFailure[]
  /**
   * 開始時の `cache.generation` を closure に保持して返す。fire-and-forget で連続文書ロードが
   * 発生したとき、外部の status 更新側がこれと `cache.generation` を比較し、前世代の遅延完了が
   * 後世代の status を上書きするのを防ぐ用途。
   */
  generation: number
  /** KaTeX runtime 後追い注入が未実装の間は cache stub の効果で常に `true` を返す */
  katexLoaded: boolean
  loadedLangs: SupportedLang[]
  /** Mermaid runtime 後追い注入が未実装の間は cache stub の効果で常に `true` を返す */
  mermaidLoaded: boolean
}

/**
 * fresh な `OnlineAssetCache` を作る。`katex` / `mermaid` は loader 未実装の間 stub として
 * `true` で初期化し、本実装が入った時点で `false` 初期化に切り替えて gate を解く。
 */
export const createOnlineAssetCache = (): OnlineAssetCache => ({
  currentAbortController: null,
  generation: 0,
  inFlight: new Map<string, Promise<unknown>>(),
  katex: true,
  langs: new Set<SupportedLang>(),
  mermaid: true,
})

let cachedManifest: OnlineAssetManifest | null = null

const getManifest = (): OnlineAssetManifest => {
  if (cachedManifest !== null) {
    return cachedManifest
  }
  cachedManifest = readOnlineAssetManifestFromDom()
  return cachedManifest
}

/**
 * test 用に module-level の manifest cache を破棄する。本番経路では呼ばない (起動時 1 度の
 * parse 結果を session 中 reuse するため)。
 */
export const resetCachedManifestForTest = (): void => {
  cachedManifest = null
}

interface ShikiFetchOutcome {
  /** 1 言語 1 ファイルが LanguageRegistration[] 形式で配布されるため、top-level array を直接持つ */
  grammar: unknown[] | null
  networkError: string | null
  status: number | null
}

interface ShikiLoadContext {
  baseUrl: URL
  manifest: OnlineAssetManifest
  signal: AbortSignal
}

const networkOutcome = (detail: string): ShikiFetchOutcome => ({
  grammar: null,
  networkError: detail,
  status: null,
})

const NOT_FOUND_OUTCOME: ShikiFetchOutcome = { grammar: null, networkError: null, status: 404 }

/**
 * Shiki が emit する 1 言語 1 ファイルの grammar JSON は `LanguageRegistration[]` (top-level
 * array) 形式で、各要素は `LanguageRegistration` の必須フィールド `name: string` および
 * `scopeName: string` を持つ。200 OK + 形だけ整った payload (`[{"error":"not found"}]` /
 * CDN error page など) を取り違えてキャッシュしないように、必須フィールド付き plain object の
 * array であることを確認する。失敗ケースでは `cache.langs` に追加せず、次回 reload で再 fetch
 * を許す。
 */
const isShikiGrammarRegistration = (item: unknown): boolean => {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    return false
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const record = item as Record<string, unknown>
  return typeof record.name === 'string' && typeof record.scopeName === 'string'
}

const payloadContainsLang = (lang: SupportedLang, payload: readonly unknown[]): boolean =>
  payload.some((item: unknown): boolean => {
    if (typeof item !== 'object' || item === null) {
      return false
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const record = item as Record<string, unknown>
    return record.name === lang
  })

const isValidShikiGrammarPayload = (
  lang: SupportedLang,
  payload: unknown
): payload is unknown[] => {
  if (!Array.isArray(payload) || payload.length === 0) {
    return false
  }
  if (!payload.every(isShikiGrammarRegistration)) {
    return false
  }
  return payloadContainsLang(lang, payload)
}

const parseGrammarJson = async (
  response: Response,
  lang: SupportedLang
): Promise<ShikiFetchOutcome> => {
  const parsed = await response.json().catch((): null => null)
  if (!isValidShikiGrammarPayload(lang, parsed)) {
    return { grammar: null, networkError: 'parse error', status: response.status }
  }
  return { grammar: parsed, networkError: null, status: response.status }
}

const fetchShikiGrammarOnce = async (
  url: URL,
  signal: AbortSignal,
  lang: SupportedLang
): Promise<ShikiFetchOutcome> => {
  try {
    const response = await fetch(url.href, { signal })
    if (response.status === 404) {
      return NOT_FOUND_OUTCOME
    }
    if (!response.ok) {
      return networkOutcome(`HTTP ${response.status}`)
    }
    return parseGrammarJson(response, lang)
  } catch (error) {
    return networkOutcome(String(error))
  }
}

interface ShikiLangLoadResult {
  failures: AssetLoadFailure[]
  /** parseGrammarJson の戻り型に合わせ array 直接保持 */
  grammar: unknown[] | null
  lang: SupportedLang
}

const buildAbortedFailure = (lang: SupportedLang): AssetLoadFailure => ({
  asset: 'shiki',
  cause: 'aborted-by-newer-generation',
  detail: 'aborted by newer generation',
  lang,
})

const buildCanonicalRecoveryFailure = (
  lang: SupportedLang,
  fingerprintedUrl: URL,
  canonicalUrl: URL
): AssetLoadFailure => ({
  asset: 'shiki',
  cause: 'shiki-fetch-404',
  detail: `fingerprinted 404 at ${fingerprintedUrl.href}, recovered from ${canonicalUrl.href}`,
  lang,
  reason: 'recovered-from-404',
})

const buildShikiFetchFailure = (
  lang: SupportedLang,
  outcome: ShikiFetchOutcome,
  url: URL
): AssetLoadFailure => {
  if (outcome.status === 404) {
    return { asset: 'shiki', cause: 'shiki-fetch-404', detail: `404 at ${url.href}`, lang }
  }
  if (outcome.status !== null && outcome.grammar === null) {
    return {
      asset: 'shiki',
      cause: 'shiki-parse-error',
      detail: outcome.networkError ?? 'parse error',
      lang,
    }
  }
  return {
    asset: 'shiki',
    cause: 'shiki-fetch-network',
    detail: outcome.networkError ?? `status ${outcome.status ?? 'unknown'} at ${url.href}`,
    lang,
  }
}

const tryCanonicalRetry = async (
  ctx: ShikiLoadContext,
  lang: SupportedLang,
  fingerprintedUrl: URL
): Promise<ShikiLangLoadResult> => {
  const canonicalUrl = new URL(resolveCanonicalShikiLangPath(lang), ctx.baseUrl)
  const canonical = await fetchShikiGrammarOnce(canonicalUrl, ctx.signal, lang)
  if (ctx.signal.aborted) {
    return { failures: [buildAbortedFailure(lang)], grammar: null, lang }
  }
  if (canonical.grammar !== null) {
    return {
      failures: [buildCanonicalRecoveryFailure(lang, fingerprintedUrl, canonicalUrl)],
      grammar: canonical.grammar,
      lang,
    }
  }
  return { failures: [buildShikiFetchFailure(lang, canonical, canonicalUrl)], grammar: null, lang }
}

interface FingerprintedAttempt {
  fingerprinted: ShikiFetchOutcome
  fingerprintedUrl: URL
  lang: SupportedLang
}

/**
 * fingerprinted で 404 を受けた時に canonical retry を判断する。fingerprintedUrl と
 * canonical URL が同一の場合 (manifest 欠落で resolveShikiLangPath が直に canonical を
 * 返したケース) は重複 fetch + `recovered-from-404` 誤記録を防ぐため retry しない。
 */
const handleFingerprinted404 = async (
  ctx: ShikiLoadContext,
  attempt: FingerprintedAttempt
): Promise<ShikiLangLoadResult> => {
  const { fingerprinted, fingerprintedUrl, lang } = attempt
  const canonicalUrl = new URL(resolveCanonicalShikiLangPath(lang), ctx.baseUrl)
  if (canonicalUrl.href === fingerprintedUrl.href) {
    return {
      failures: [buildShikiFetchFailure(lang, fingerprinted, fingerprintedUrl)],
      grammar: null,
      lang,
    }
  }
  return tryCanonicalRetry(ctx, lang, fingerprintedUrl)
}

const handleFingerprintedOutcome = async (
  ctx: ShikiLoadContext,
  attempt: FingerprintedAttempt
): Promise<ShikiLangLoadResult> => {
  const { fingerprinted, fingerprintedUrl, lang } = attempt
  if (fingerprinted.grammar !== null) {
    return { failures: [], grammar: fingerprinted.grammar, lang }
  }
  if (fingerprinted.status === 404) {
    return handleFingerprinted404(ctx, attempt)
  }
  return {
    failures: [buildShikiFetchFailure(lang, fingerprinted, fingerprintedUrl)],
    grammar: null,
    lang,
  }
}

const loadOneShikiLang = async (
  ctx: ShikiLoadContext,
  lang: SupportedLang
): Promise<ShikiLangLoadResult> => {
  if (ctx.signal.aborted) {
    return { failures: [buildAbortedFailure(lang)], grammar: null, lang }
  }
  const fingerprintedUrl = new URL(resolveShikiLangPath(ctx.manifest, lang), ctx.baseUrl)
  const fingerprinted = await fetchShikiGrammarOnce(fingerprintedUrl, ctx.signal, lang)
  if (ctx.signal.aborted) {
    return { failures: [buildAbortedFailure(lang)], grammar: null, lang }
  }
  return handleFingerprintedOutcome(ctx, { fingerprinted, fingerprintedUrl, lang })
}

const dedupeFetch = async <Value>(
  cache: OnlineAssetCache,
  key: string,
  task: () => Promise<Value>
): Promise<Value> => {
  if (cache.inFlight.has(key)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return cache.inFlight.get(key) as Promise<Value>
  }
  const promise = task().finally((): void => {
    if (cache.inFlight.get(key) === promise) {
      cache.inFlight.delete(key)
    }
  })
  cache.inFlight.set(key, promise)
  return promise
}

interface ShikiBatchResult {
  failures: AssetLoadFailure[]
  loaded: SupportedLang[]
  mergedGrammars: Record<string, unknown>
}

const ingestSettledShikiResult = (
  cache: OnlineAssetCache,
  settled: PromiseSettledResult<ShikiLangLoadResult>,
  batch: ShikiBatchResult
): void => {
  if (settled.status === 'rejected') {
    batch.failures.push({
      asset: 'shiki',
      cause: 'shiki-fetch-network',
      detail: String(settled.reason),
    })
    return
  }
  batch.failures.push(...settled.value.failures)
  if (settled.value.grammar !== null) {
    // installShikiGrammars が `{ <lang>: LanguageRegistration[] }` 形式を期待するため、
    // top-level array のままではなく lang を key にしたエントリとして merge する。
    batch.mergedGrammars[settled.value.lang] = settled.value.grammar
    batch.loaded.push(settled.value.lang)
    cache.langs.add(settled.value.lang)
  }
}

const accumulateShikiResults = (
  cache: OnlineAssetCache,
  results: PromiseSettledResult<ShikiLangLoadResult>[]
): ShikiBatchResult => {
  const batch: ShikiBatchResult = { failures: [], loaded: [], mergedGrammars: {} }
  for (const settled of results) {
    ingestSettledShikiResult(cache, settled, batch)
  }
  return batch
}

/**
 * Shiki grammar 群を並行 fetch + bridges merge する。fingerprinted で 404 を受けた lang は
 * canonical パスに 1 度 retry し、`failures` に `recovered-from-404` を残す。1 件以上 fulfilled
 * したら `installShikiGrammars` で textContent merge update + highlighter reset +
 * `mdxg:shiki-langs-ready` event 発火で永続 listener に通知する。
 */
export const loadShikiGrammars = async (
  ctx: ShikiLoadContext,
  langs: readonly SupportedLang[],
  cache: OnlineAssetCache
): Promise<{ failures: AssetLoadFailure[]; loaded: SupportedLang[] }> => {
  if (langs.length === 0) {
    return { failures: [], loaded: [] }
  }
  const settled = await Promise.allSettled(
    langs.map(async (lang): Promise<ShikiLangLoadResult> => {
      const key = new URL(resolveShikiLangPath(ctx.manifest, lang), ctx.baseUrl).href
      return dedupeFetch(
        cache,
        key,
        async (): Promise<ShikiLangLoadResult> => loadOneShikiLang(ctx, lang)
      )
    })
  )
  const batch = accumulateShikiResults(cache, settled)
  if (Object.keys(batch.mergedGrammars).length > 0) {
    installShikiGrammars(batch.mergedGrammars)
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new Event('mdxg:shiki-langs-ready'))
    }
  }
  return { failures: batch.failures, loaded: batch.loaded }
}

const filterMissingLangs = (
  scanned: Iterable<SupportedLang>,
  loaded: Set<SupportedLang>
): SupportedLang[] => {
  const result: SupportedLang[] = []
  for (const lang of scanned) {
    if (!loaded.has(lang)) {
      result.push(lang)
    }
  }
  return result
}

const getEffectiveSignal = (cache: OnlineAssetCache): AbortSignal => {
  if (cache.currentAbortController !== null) {
    return cache.currentAbortController.signal
  }
  return new AbortController().signal
}

interface AssetRequirements {
  ctx: ShikiLoadContext
  missing: SupportedLang[]
  needKatex: boolean
  needMermaid: boolean
}

const computeAssetRequirements = (
  markdown: string,
  baseUrl: URL,
  cache: OnlineAssetCache
): AssetRequirements => {
  const ctx: ShikiLoadContext = {
    baseUrl,
    manifest: getManifest(),
    signal: getEffectiveSignal(cache),
  }
  const missing = filterMissingLangs(scanFencedLangs(markdown), cache.langs)
  // Mermaid / KaTeX 経路は cache.* === true 初期化の stub で skip される (loader 未実装の間)
  const needMermaid = scanMermaidFences(markdown) > 0 && !cache.mermaid
  const mathCounts = countMath(markdown)
  const needKatex = mathCounts.inline + mathCounts.display > 0 && !cache.katex
  return { ctx, missing, needKatex, needMermaid }
}

/**
 * markdown 本文を scan して必要な Shiki / Mermaid / KaTeX アセットを発火させる中核関数。
 * 起動経路から fire-and-forget で呼び出されるため戻り値を握りつぶしても呼び出し側の挙動を
 * 壊さない設計。Mermaid / KaTeX 経路は loader 未実装の間 `OnlineAssetCache` の stub フラグで
 * skip され、本実装が入った時点で gate を解く。
 */
export const loadOnlineAssets = async (
  markdown: string,
  baseUrl: URL,
  cache: OnlineAssetCache
): Promise<OnlineAssetLoadResult> => {
  const myGeneration = cache.generation
  const reqs = computeAssetRequirements(markdown, baseUrl, cache)
  const shiki = await loadShikiGrammars(reqs.ctx, reqs.missing, cache)
  return {
    failures: shiki.failures,
    generation: myGeneration,
    katexLoaded: !reqs.needKatex && cache.katex,
    loadedLangs: shiki.loaded,
    mermaidLoaded: !reqs.needMermaid && cache.mermaid,
  }
}

// === in-source test helpers (module scope) ===
// `unicorn/consistent-function-scoping` を満たすため if(import.meta.vitest) block の外で定義する。
// `import.meta.vitest` は本番ビルドで false 評価されるため、test 専用 helper も dead code として落ちる。

// 実 dist (`dist/shiki-langs/<lang>.json`) は `LanguageRegistration[]` 形式 (top-level array、
// 各要素は `name: string` / `scopeName: string` 等を含む RawGrammar object)。
// 必須フィールドが揃わない fixture では isValidShikiGrammarPayload で弾かれるため、test も
// 実 RawGrammar の必須フィールド shape に揃える。
const TEST_GRAMMAR_TS = JSON.stringify([
  { name: 'typescript', patterns: [], scopeName: 'source.ts' },
])

const installManifestScript = (json: string): HTMLElement => {
  const el = document.createElement('script')
  el.id = 'online-asset-manifest'
  el.type = 'application/json'
  el.textContent = json
  document.body.appendChild(el)
  return el
}

const installEmbeddedShikiLangsScript = (): HTMLElement => {
  const existing = document.getElementById('embedded-shiki-langs')
  if (existing instanceof HTMLElement) {
    return existing
  }
  const el = document.createElement('script')
  el.id = 'embedded-shiki-langs'
  el.type = 'application/json'
  el.textContent = '{}'
  document.body.appendChild(el)
  return el
}

interface FetchSpyLike {
  mock: { calls: unknown[][] }
}

const getFirstFetchUrl = (spy: FetchSpyLike): string => {
  const { calls } = spy.mock
  if (calls.length === 0) {
    return ''
  }
  const [first] = calls
  return String(first[0])
}

const cleanupTestNodes = (): void => {
  const manifestEl = document.getElementById('online-asset-manifest')
  if (manifestEl !== null) {
    manifestEl.remove()
  }
  const shikiEl = document.getElementById('embedded-shiki-langs')
  if (shikiEl !== null) {
    shikiEl.remove()
  }
}

if (import.meta.vitest) {
  const { afterEach, beforeEach, describe, expect, it, vi } = import.meta.vitest

  describe('createOnlineAssetCache', () => {
    it('Mermaid / KaTeX は stub フラグで true 初期化されている (loader 未実装)', () => {
      const cache = createOnlineAssetCache()
      expect(cache.mermaid).toBe(true)
      expect(cache.katex).toBe(true)
      expect(cache.langs.size).toBe(0)
      expect(cache.generation).toBe(0)
      expect(cache.currentAbortController).toBeNull()
      expect(cache.inFlight.size).toBe(0)
    })
  })

  describe('loadOnlineAssets: scan → 必要 lang のみ fetch', () => {
    beforeEach((): void => {
      resetCachedManifestForTest()
    })
    afterEach((): void => {
      cleanupTestNodes()
      vi.unstubAllGlobals()
    })

    it('フェンス無し markdown では fetch を発火しない', async () => {
      installEmbeddedShikiLangsScript()
      const fetchSpy = vi.fn()
      vi.stubGlobal('fetch', fetchSpy)
      const cache = createOnlineAssetCache()
      const result = await loadOnlineAssets('# title only\n', new URL('https://h/'), cache)
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(result.loadedLangs).toEqual([])
      expect(result.failures).toEqual([])
    })

    it('既に cache.langs にある lang は再 fetch しない', async () => {
      installEmbeddedShikiLangsScript()
      const fetchSpy = vi.fn()
      vi.stubGlobal('fetch', fetchSpy)
      const cache = createOnlineAssetCache()
      cache.langs.add('typescript')
      await loadOnlineAssets('```ts\nlet x = 1\n```\n', new URL('https://h/'), cache)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('manifest 欠落時は canonical パスに fetch する (fail-safe)', async () => {
      installEmbeddedShikiLangsScript()
      const fetchSpy = vi.fn().mockResolvedValue(Response.json(JSON.parse(TEST_GRAMMAR_TS)))
      vi.stubGlobal('fetch', fetchSpy)
      const cache = createOnlineAssetCache()
      await loadOnlineAssets('```ts\nx\n```\n', new URL('https://host/sub/'), cache)
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(getFirstFetchUrl(fetchSpy)).toBe(
        'https://host/sub/canonical/shiki-langs/typescript.json'
      )
    })

    it('manifest hash 付きパスを優先する', async () => {
      installManifestScript(
        JSON.stringify({
          shikiLangs: { typescript: 'fingerprinted/shiki-langs/typescript.deadbeef.json' },
        })
      )
      installEmbeddedShikiLangsScript()
      const fetchSpy = vi.fn().mockResolvedValue(Response.json(JSON.parse(TEST_GRAMMAR_TS)))
      vi.stubGlobal('fetch', fetchSpy)
      const cache = createOnlineAssetCache()
      await loadOnlineAssets('```ts\nx\n```\n', new URL('https://host/'), cache)
      expect(getFirstFetchUrl(fetchSpy)).toBe(
        'https://host/fingerprinted/shiki-langs/typescript.deadbeef.json'
      )
    })
  })

  describe('loadShikiGrammars: 404 retry / canonical recovery', () => {
    beforeEach((): void => {
      resetCachedManifestForTest()
    })
    afterEach((): void => {
      cleanupTestNodes()
      vi.unstubAllGlobals()
    })

    it('fingerprinted 404 → canonical 成功で recovered-from-404 を failures に残す', async () => {
      installManifestScript(
        JSON.stringify({
          shikiLangs: { typescript: 'fingerprinted/shiki-langs/typescript.old.json' },
        })
      )
      installEmbeddedShikiLangsScript()
      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce(new Response('not found', { status: 404 }))
        .mockResolvedValueOnce(Response.json(JSON.parse(TEST_GRAMMAR_TS)))
      vi.stubGlobal('fetch', fetchSpy)
      const cache = createOnlineAssetCache()
      const result = await loadOnlineAssets('```ts\nx\n```\n', new URL('https://h/'), cache)
      expect(fetchSpy).toHaveBeenCalledTimes(2)
      expect(result.loadedLangs).toEqual(['typescript'])
      expect(result.failures).toEqual([
        expect.objectContaining({
          asset: 'shiki',
          cause: 'shiki-fetch-404',
          lang: 'typescript',
          reason: 'recovered-from-404',
        }),
      ])
    })

    it('manifest 欠落時の fingerprinted == canonical では 404 で重複 fetch しない', async () => {
      // manifest を inject しないと resolveShikiLangPath は canonical を直接返すため、
      // fingerprinted と canonical が同一 URL。404 retry が無駄打ちにならないことを検証。
      installEmbeddedShikiLangsScript()
      const fetchSpy = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }))
      vi.stubGlobal('fetch', fetchSpy)
      const cache = createOnlineAssetCache()
      const result = await loadOnlineAssets('```ts\nx\n```\n', new URL('https://h/'), cache)
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      // recovered-from-404 は誤った記録なので付かない
      expect(result.failures.map((failure): string | null => failure.reason ?? null)).toEqual([
        null,
      ])
    })

    it('fingerprinted も canonical も 404 なら failures に 404 を残し loadedLangs は空', async () => {
      // manifest 付きで fingerprinted URL ≠ canonical URL にしないと P2(2) 抑制が働いて
      // canonical 側 retry が走らないため、この test は manifest 必須。
      installManifestScript(
        JSON.stringify({
          shikiLangs: { typescript: 'fingerprinted/shiki-langs/typescript.old.json' },
        })
      )
      installEmbeddedShikiLangsScript()
      const fetchSpy = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }))
      vi.stubGlobal('fetch', fetchSpy)
      const cache = createOnlineAssetCache()
      const result = await loadOnlineAssets('```ts\nx\n```\n', new URL('https://h/'), cache)
      expect(fetchSpy).toHaveBeenCalledTimes(2)
      expect(result.loadedLangs).toEqual([])
      expect(result.failures.map((failure): string => failure.cause)).toContain('shiki-fetch-404')
    })

    it('network error (fetch throws) は shiki-fetch-network、retry しない', async () => {
      installEmbeddedShikiLangsScript()
      const fetchSpy = vi.fn().mockRejectedValue(new TypeError('network down'))
      vi.stubGlobal('fetch', fetchSpy)
      const cache = createOnlineAssetCache()
      const result = await loadOnlineAssets('```ts\nx\n```\n', new URL('https://h/'), cache)
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(result.failures.map((failure): string => failure.cause)).toContain(
        'shiki-fetch-network'
      )
    })
  })

  describe('loadShikiGrammars: shape validation', () => {
    beforeEach((): void => {
      resetCachedManifestForTest()
    })
    afterEach((): void => {
      cleanupTestNodes()
      vi.unstubAllGlobals()
    })

    it('200 OK + payload に要求 lang 不在 / 不正 shape は shiki-parse-error で cache に乗らない', async () => {
      installEmbeddedShikiLangsScript()
      // {} は 200 で返るが要求 lang ("typescript") の entry がない → shape NG
      const fetchSpy = vi.fn().mockResolvedValue(Response.json({}))
      vi.stubGlobal('fetch', fetchSpy)
      const cache = createOnlineAssetCache()
      const result = await loadOnlineAssets('```ts\nx\n```\n', new URL('https://h/'), cache)
      expect(result.loadedLangs).toEqual([])
      expect(cache.langs.has('typescript')).toBe(false)
      expect(result.failures.map((failure): string => failure.cause)).toContain('shiki-parse-error')
    })

    it('200 OK + payload の entry が array でないと shiki-parse-error (CDN error page 等)', async () => {
      installEmbeddedShikiLangsScript()
      // CDN が error JSON を 200 で返すパターン
      const fetchSpy = vi
        .fn()
        .mockResolvedValue(Response.json({ typescript: 'this is a string, not array' }))
      vi.stubGlobal('fetch', fetchSpy)
      const cache = createOnlineAssetCache()
      const result = await loadOnlineAssets('```ts\nx\n```\n', new URL('https://h/'), cache)
      expect(result.loadedLangs).toEqual([])
      expect(cache.langs.has('typescript')).toBe(false)
      expect(result.failures.map((failure): string => failure.cause)).toContain('shiki-parse-error')
    })

    it('200 OK + 別言語の grammar (name が要求 lang と一致しない) を shape NG として弾く', async () => {
      // 要求 lang は typescript だが、URL が誤って python grammar を 200 で返したケース。
      // 受理して typescript として cache すると Shiki 初期化で typescript が見つからず永久に失敗する。
      installEmbeddedShikiLangsScript()
      const fetchSpy = vi
        .fn()
        .mockResolvedValue(
          Response.json([{ name: 'python', patterns: [], scopeName: 'source.python' }])
        )
      vi.stubGlobal('fetch', fetchSpy)
      const cache = createOnlineAssetCache()
      const result = await loadOnlineAssets('```ts\nx\n```\n', new URL('https://h/'), cache)
      expect(result.loadedLangs).toEqual([])
      expect(cache.langs.has('typescript')).toBe(false)
      expect(result.failures.map((failure): string => failure.cause)).toContain('shiki-parse-error')
    })

    it('200 OK + 形だけ整った array (例: [{"error":"not found"}]) を shape NG として弾く', async () => {
      // 必須フィールド (name / scopeName) を持たない array は LanguageRegistration として無効。
      // 受理して cache.langs に乗せると Shiki 初期化が永久に失敗するので、shape NG として弾く。
      installEmbeddedShikiLangsScript()
      const fetchSpy = vi.fn().mockResolvedValue(Response.json([{ error: 'not found' }]))
      vi.stubGlobal('fetch', fetchSpy)
      const cache = createOnlineAssetCache()
      const result = await loadOnlineAssets('```ts\nx\n```\n', new URL('https://h/'), cache)
      expect(result.loadedLangs).toEqual([])
      expect(cache.langs.has('typescript')).toBe(false)
      expect(result.failures.map((failure): string => failure.cause)).toContain('shiki-parse-error')
    })

    it('Promise.allSettled は 1 件失敗で他言語の grammar を載せる', async () => {
      installEmbeddedShikiLangsScript()
      const fetchSpy = vi.fn().mockImplementation(async (input: unknown): Promise<Response> => {
        if (String(input).includes('python')) {
          return Promise.resolve(new Response('not found', { status: 404 }))
        }
        return Promise.resolve(Response.json(JSON.parse(TEST_GRAMMAR_TS)))
      })
      vi.stubGlobal('fetch', fetchSpy)
      const cache = createOnlineAssetCache()
      const result = await loadOnlineAssets(
        '```ts\nx\n```\n\n```py\ny\n```\n',
        new URL('https://h/'),
        cache
      )
      expect(result.loadedLangs).toContain('typescript')
      expect(result.loadedLangs).not.toContain('python')
      expect(result.failures.some((failure): boolean => failure.lang === 'python')).toBe(true)
    })
  })

  describe('loadOnlineAssets: 世代 ID + in-flight cache', () => {
    beforeEach((): void => {
      resetCachedManifestForTest()
    })
    afterEach((): void => {
      cleanupTestNodes()
      vi.unstubAllGlobals()
    })

    it('result.generation は呼び出し時の cache.generation を返す', async () => {
      installEmbeddedShikiLangsScript()
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))
      const cache = createOnlineAssetCache()
      cache.generation = 7
      const result = await loadOnlineAssets('# x\n', new URL('https://h/'), cache)
      expect(result.generation).toBe(7)
    })

    it('同一 URL の連続要求は in-flight Promise が再利用される (重複 fetch なし)', async () => {
      installEmbeddedShikiLangsScript()
      const fetchSpy = vi.fn().mockResolvedValue(Response.json(JSON.parse(TEST_GRAMMAR_TS)))
      vi.stubGlobal('fetch', fetchSpy)
      const cache = createOnlineAssetCache()
      const md = '```ts\nx\n```\n'
      const p1 = loadOnlineAssets(md, new URL('https://h/'), cache)
      cache.langs.delete('typescript')
      const p2 = loadOnlineAssets(md, new URL('https://h/'), cache)
      await Promise.all([p1, p2])
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('inFlight Map は task 完了後に entry を削除する (leak しない)', async () => {
      installEmbeddedShikiLangsScript()
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(JSON.parse(TEST_GRAMMAR_TS))))
      const cache = createOnlineAssetCache()
      await loadOnlineAssets('```ts\nx\n```\n', new URL('https://h/'), cache)
      expect(cache.inFlight.size).toBe(0)
    })
  })

  describe('loadOnlineAssets: AbortController で前世代 fetch を中断', () => {
    beforeEach((): void => {
      resetCachedManifestForTest()
    })
    afterEach((): void => {
      cleanupTestNodes()
      vi.unstubAllGlobals()
    })

    it('signal.aborted で fetch 前に aborted-by-newer-generation を集約', async () => {
      installEmbeddedShikiLangsScript()
      const cache = createOnlineAssetCache()
      cache.currentAbortController = new AbortController()
      cache.currentAbortController.abort()
      const fetchSpy = vi.fn()
      vi.stubGlobal('fetch', fetchSpy)
      const result = await loadOnlineAssets('```ts\nx\n```\n', new URL('https://h/'), cache)
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(result.loadedLangs).toEqual([])
      expect(result.failures.map((failure): string => failure.cause)).toContain(
        'aborted-by-newer-generation'
      )
    })
  })
}
