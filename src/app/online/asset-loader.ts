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
  resolveCanonicalKatexPaths,
  resolveCanonicalMermaidPath,
  resolveCanonicalShikiLangPath,
  resolveKatexPaths,
  resolveMermaidPath,
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
  /** runtime ロード済みフラグ。 loadKatexRuntime の 3 ファイル (JS/CSS/fontsExtra) 全成功で true */
  katex: boolean
  readonly langs: Set<SupportedLang>
  /** runtime ロード済みフラグ。 loadMermaidRuntime の dynamic import 成功で true */
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

/**
 * KaTeX 3 ファイル (JS / CSS / fontsExtraCss) の個別 load 状態。 `katexLoaded` (boolean) は
 * 「3 ファイル全成功」を示す aggregated flag だが、 status UI 側で「JS だけ成功 / CSS だけ失敗」
 * を識別したい場合に個別 flag を参照する用途。
 */
export interface KatexLoadDetail {
  cssLoaded: boolean
  fontsExtraLoaded: boolean
  jsLoaded: boolean
}

export interface OnlineAssetLoadResult {
  failures: AssetLoadFailure[]
  /**
   * 開始時の `cache.generation` を closure に保持して返す。fire-and-forget で連続文書ロードが
   * 発生したとき、外部の status 更新側がこれと `cache.generation` を比較し、前世代の遅延完了が
   * 後世代の status を上書きするのを防ぐ用途。
   */
  generation: number
  /**
   * KaTeX 必要 markdown では「3 ファイル全成功」のみ true。 不要 markdown では cache.katex
   * (既ロード履歴) を返す。
   */
  katexLoaded: boolean
  /** 3 ファイル個別 load 状態。 needKatex=false なら null (未試行)。 */
  katexDetail: KatexLoadDetail | null
  loadedLangs: SupportedLang[]
  /**
   * Mermaid 必要 markdown では今回 load の成否を返す。 Mermaid 不要 markdown では cache に
   * 既ロード履歴があるかを返す (Open file 経路で「以前 load 済み」を表現)。
   */
  mermaidLoaded: boolean
}

/**
 * fresh な `OnlineAssetCache` を作る。 `mermaid` / `katex` は `false` 初期化で、 該当 markdown が
 * 必要としたときに loader 経路で fetch + import 成功で `true` に立ち上がる。
 */
export const createOnlineAssetCache = (): OnlineAssetCache => ({
  currentAbortController: null,
  generation: 0,
  inFlight: new Map<string, Promise<unknown>>(),
  katex: false,
  langs: new Set<SupportedLang>(),
  mermaid: false,
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

interface AssetLoadContext {
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
  ctx: AssetLoadContext,
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
  ctx: AssetLoadContext,
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
  ctx: AssetLoadContext,
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
  ctx: AssetLoadContext,
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

// `cache.langs.add(...)` は signal.aborted を直接見ない。 abort された lang は
// `loadOneShikiLang` 内部で grammar=null を返すため間接的に gate されており、 abort 直後の
// cache 汚染は起きない。
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
  ctx: AssetLoadContext,
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

/**
 * `scanFencedLangs` から得た言語集合から既ロード分を除いた未取得 lang を返す。
 *
 * 設計上の注意: ` ```mermaid ` フェンスは `SHIKI_SUPPORTED_LANGS` に `'mermaid'` が含まれるため
 * Shiki 経路にも流入する (shiki-aliases.generated.ts:136)。 これは意図的: Mermaid runtime の
 * load / 描画が失敗したときの fallback として、 mermaid grammar による Shiki ハイライト表示が
 * 残るようにするため (mermaid.ts の upgradeMermaidFences が failed flag を立てたままにすると
 * Shiki ハイライト済みの `<pre>` が visible として残る)。 mermaid grammar 取得失敗が
 * `failures` に混ざるのは §5.b 「Promise.allSettled で個別エラー許容」と整合。
 *
 * in-source test では `cache.langs.add('mermaid')` で Shiki 経路を skip させて Mermaid 経路だけを
 * isolated に検証している (Mermaid 経路 test の意図簡略化、 本番経路には適用しない)。
 */
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
  ctx: AssetLoadContext
  missing: SupportedLang[]
  needKatex: boolean
  needMermaid: boolean
}

const computeAssetRequirements = (
  markdown: string,
  baseUrl: URL,
  cache: OnlineAssetCache
): AssetRequirements => {
  const ctx: AssetLoadContext = {
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

// === Mermaid runtime loader ===

interface MermaidLoadOutcome {
  failures: AssetLoadFailure[]
  loaded: boolean
}

const MERMAID_SENTINEL = '/* runtime-loaded */'

/**
 * `<script id="embedded-mermaid">` の textContent に sentinel を書き込み、
 * `waitForRuntime` の hasEmbeddedScript gate (textContent.trim().length > 0) を通過させる。
 * 注入は dynamic import の **前** に行うことで、 boot 直後の waitForRuntime 試行が
 * 即 null 返却して諦めるのを防ぐ (永続 listener と併せて遅延 load を救済する設計)。
 */
const ensureMermaidSentinel = (): void => {
  if (typeof document === 'undefined') {
    return
  }
  const el = document.getElementById('embedded-mermaid')
  if (!(el instanceof HTMLElement)) {
    return
  }
  if ((el.textContent ?? '').trim().length === 0) {
    el.textContent = MERMAID_SENTINEL
  }
}

/**
 * load 失敗 / abort 時に sentinel を空に戻す。 注入したまま runtime が立ち上がらない状態を放置すると、
 * 次回 boot で `waitForRuntime` の `hasEmbeddedScript` gate が「true (runtime あり)」と誤判定して
 * 2 秒 timeout idle まで待ってしまう。 sentinel 自身が書いた値だけを clear し、 他経路 (CLI で
 * runtime 既 inline) の textContent には触らない。
 */
const clearMermaidSentinel = (): void => {
  if (typeof document === 'undefined') {
    return
  }
  const el = document.getElementById('embedded-mermaid')
  if (!(el instanceof HTMLElement)) {
    return
  }
  if ((el.textContent ?? '').trim() === MERMAID_SENTINEL.trim()) {
    el.textContent = ''
  }
}

const buildMermaidImportFailure = (url: URL, detail: string): AssetLoadFailure => ({
  asset: 'mermaid',
  cause: 'mermaid-import-reject',
  detail: `import reject at ${url.href}: ${detail}`,
})

const buildMermaidRecoveryFailure = (
  fingerprintedUrl: URL,
  canonicalUrl: URL
): AssetLoadFailure => ({
  asset: 'mermaid',
  cause: 'mermaid-import-reject',
  detail: `fingerprinted import reject at ${fingerprintedUrl.href}, recovered from ${canonicalUrl.href}`,
  reason: 'recovered-from-load-failure',
})

const MERMAID_ABORTED_FAILURE: AssetLoadFailure = {
  asset: 'mermaid',
  cause: 'aborted-by-newer-generation',
  detail: 'aborted by newer generation',
}

type MermaidImporter = (url: URL) => Promise<string | null>

/**
 * dynamic `import()` 1 度実行する。 reject 原因 (404 / CSP / MIME / 構文 / network) は HTTP
 * status を露出しない仕様のため、 文字列化した error message だけ返す (`failures[].detail` で
 * DevTools 追跡可能にする)。 成功時は null。
 *
 * `/* @vite-ignore *​/` は Vite が build 時に dynamic import の static 解析を試みるのを抑止する
 * 指示子で、 runtime に組み立てた URL 文字列 (manifest 由来) を bundle に含めないようにする。
 */
const defaultMermaidImporter: MermaidImporter = async (url: URL): Promise<string | null> => {
  try {
    await import(/* @vite-ignore */ url.href)
    return null
  } catch (error) {
    return String(error)
  }
}

// `vi.stubGlobal('import', ...)` は ESM 仕様で不可能なため、 dynamic import を関数経由で
// 差し替え可能にする。 本番経路では default を使い、 test だけ setMermaidImporterForTest で
// vi.fn() に差し替える。
let mermaidImporter: MermaidImporter = defaultMermaidImporter

export const setMermaidImporterForTest = (importer: MermaidImporter): void => {
  mermaidImporter = importer
}

export const resetMermaidImporterForTest = (): void => {
  mermaidImporter = defaultMermaidImporter
}

const importMermaidOnce = async (url: URL): Promise<string | null> => mermaidImporter(url)

const tryMermaidCanonicalRetry = async (
  ctx: AssetLoadContext,
  fingerprintedUrl: URL,
  fingerprintedError: string
): Promise<MermaidLoadOutcome> => {
  const canonicalUrl = new URL(resolveCanonicalMermaidPath(), ctx.baseUrl)
  // manifest 欠落で resolveMermaidPath が canonical を直接返したケースは retry しない (重複防止)
  if (canonicalUrl.href === fingerprintedUrl.href) {
    return {
      failures: [buildMermaidImportFailure(fingerprintedUrl, fingerprintedError)],
      loaded: false,
    }
  }
  const canonicalError = await importMermaidOnce(canonicalUrl)
  if (ctx.signal.aborted) {
    return { failures: [MERMAID_ABORTED_FAILURE], loaded: false }
  }
  if (canonicalError === null) {
    return {
      failures: [buildMermaidRecoveryFailure(fingerprintedUrl, canonicalUrl)],
      loaded: true,
    }
  }
  return {
    failures: [buildMermaidImportFailure(canonicalUrl, canonicalError)],
    loaded: false,
  }
}

const loadMermaidOnce = async (ctx: AssetLoadContext): Promise<MermaidLoadOutcome> => {
  if (ctx.signal.aborted) {
    return { failures: [MERMAID_ABORTED_FAILURE], loaded: false }
  }
  ensureMermaidSentinel()
  const fingerprintedUrl = new URL(resolveMermaidPath(ctx.manifest), ctx.baseUrl)
  const fingerprintedError = await importMermaidOnce(fingerprintedUrl)
  if (ctx.signal.aborted) {
    return { failures: [MERMAID_ABORTED_FAILURE], loaded: false }
  }
  if (fingerprintedError === null) {
    return { failures: [], loaded: true }
  }
  return tryMermaidCanonicalRetry(ctx, fingerprintedUrl, fingerprintedError)
}

/**
 * Mermaid runtime を同一オリジン dynamic import で後追い注入する。
 * 手順: (1) sentinel を `<script id="embedded-mermaid">` に注入、 (2) manifest 経由
 * fingerprinted URL で `import()`、 (3) reject 時に canonical へ任意 retry。 成功時は
 * mermaid-entry.ts の bridge コードが `globalThis.__mdxgMermaid` 代入 + `mdxg:mermaid-ready`
 * dispatch を自動実行し、 attachMermaidReadyListener が pickup する。
 *
 * dedupeFetch で同一 URL の重複 import を集約 (ES module spec で 2 度目は cache 返却だが、
 * AbortController + 世代管理との整合のため明示的に 1 Promise に揃える)。
 *
 * cache.mermaid mutation の世代 gate: 旧世代の遅延完了が新世代の cache を上書きする race を防ぐため、
 * `!ctx.signal.aborted` を確認してから true を立てる。 abort された / load 失敗時には sentinel を
 * clear して次回 boot で `waitForRuntime` が 2 秒 idle timeout に陥らないようにする。
 */
export const loadMermaidRuntime = async (
  ctx: AssetLoadContext,
  cache: OnlineAssetCache
): Promise<MermaidLoadOutcome> => {
  const key = `mermaid:${new URL(resolveMermaidPath(ctx.manifest), ctx.baseUrl).href}`
  const outcome = await dedupeFetch(
    cache,
    key,
    async (): Promise<MermaidLoadOutcome> => loadMermaidOnce(ctx)
  )
  if (outcome.loaded && !ctx.signal.aborted) {
    cache.mermaid = true
  } else {
    clearMermaidSentinel()
  }
  return outcome
}

const loadMermaidIfNeeded = async (
  reqs: AssetRequirements,
  cache: OnlineAssetCache
): Promise<MermaidLoadOutcome> => {
  if (!reqs.needMermaid) {
    return { failures: [], loaded: false }
  }
  return loadMermaidRuntime(reqs.ctx, cache)
}

// === KaTeX runtime loader ===
// 3 ファイル独立 retry: JS は import (任意 reject で canonical)、 CSS / fontsExtraCss は fetch
// (404 で canonical)。 1 つの canonical 成功で他は救わない。 全 3 成功時のみ cache.katex = true。

interface KatexLoadOutcome {
  cssLoaded: boolean
  failures: AssetLoadFailure[]
  fontsExtraLoaded: boolean
  jsLoaded: boolean
  loaded: boolean
}

type KatexImporter = (url: URL) => Promise<string | null>

const defaultKatexImporter: KatexImporter = async (url: URL): Promise<string | null> => {
  try {
    await import(/* @vite-ignore */ url.href)
    return null
  } catch (error) {
    return String(error)
  }
}

let katexImporter: KatexImporter = defaultKatexImporter

export const setKatexImporterForTest = (importer: KatexImporter): void => {
  katexImporter = importer
}

export const resetKatexImporterForTest = (): void => {
  katexImporter = defaultKatexImporter
}

const KATEX_JS_SENTINEL = '/* runtime-loaded */'

const ensureKatexJsSentinel = (): void => {
  if (typeof document === 'undefined') {
    return
  }
  const el = document.getElementById('embedded-katex')
  if (!(el instanceof HTMLElement)) {
    return
  }
  if ((el.textContent ?? '').trim().length === 0) {
    el.textContent = KATEX_JS_SENTINEL
  }
}

const clearKatexJsSentinel = (): void => {
  if (typeof document === 'undefined') {
    return
  }
  const el = document.getElementById('embedded-katex')
  if (!(el instanceof HTMLElement)) {
    return
  }
  if ((el.textContent ?? '').trim() === KATEX_JS_SENTINEL.trim()) {
    el.textContent = ''
  }
}

const KATEX_ABORTED_FAILURE: AssetLoadFailure = {
  asset: 'katex',
  cause: 'aborted-by-newer-generation',
  detail: 'aborted by newer generation',
}

const buildKatexJsImportFailure = (url: URL, detail: string): AssetLoadFailure => ({
  asset: 'katex',
  cause: 'katex-import-reject',
  detail: `import reject at ${url.href}: ${detail}`,
})

const buildKatexJsRecoveryFailure = (
  fingerprintedUrl: URL,
  canonicalUrl: URL
): AssetLoadFailure => ({
  asset: 'katex',
  cause: 'katex-import-reject',
  detail: `fingerprinted import reject at ${fingerprintedUrl.href}, recovered from ${canonicalUrl.href}`,
  reason: 'recovered-from-load-failure',
})

interface KatexJsLoadResult {
  failures: AssetLoadFailure[]
  loaded: boolean
}

const tryKatexJsCanonicalRetry = async (
  ctx: AssetLoadContext,
  fingerprintedUrl: URL,
  fingerprintedError: string
): Promise<KatexJsLoadResult> => {
  const canonicalUrl = new URL(resolveCanonicalKatexPaths().js, ctx.baseUrl)
  if (canonicalUrl.href === fingerprintedUrl.href) {
    return {
      failures: [buildKatexJsImportFailure(fingerprintedUrl, fingerprintedError)],
      loaded: false,
    }
  }
  const canonicalError = await katexImporter(canonicalUrl)
  if (ctx.signal.aborted) {
    return { failures: [KATEX_ABORTED_FAILURE], loaded: false }
  }
  if (canonicalError === null) {
    return { failures: [buildKatexJsRecoveryFailure(fingerprintedUrl, canonicalUrl)], loaded: true }
  }
  return { failures: [buildKatexJsImportFailure(canonicalUrl, canonicalError)], loaded: false }
}

const loadKatexJsOnce = async (
  ctx: AssetLoadContext,
  fingerprintedPath: string
): Promise<KatexJsLoadResult> => {
  if (ctx.signal.aborted) {
    return { failures: [KATEX_ABORTED_FAILURE], loaded: false }
  }
  ensureKatexJsSentinel()
  const fingerprintedUrl = new URL(fingerprintedPath, ctx.baseUrl)
  const fingerprintedError = await katexImporter(fingerprintedUrl)
  if (ctx.signal.aborted) {
    return { failures: [KATEX_ABORTED_FAILURE], loaded: false }
  }
  if (fingerprintedError === null) {
    return { failures: [], loaded: true }
  }
  return tryKatexJsCanonicalRetry(ctx, fingerprintedUrl, fingerprintedError)
}

interface KatexCssOutcome {
  css: string | null
  networkError: string | null
  status: number | null
}

// 200 OK + 空 body は CDN error page / 不正 cache の signal。 loaded=true として集約すると
// cache.katex=true に立ち上がり「永久 unstyled」状態が cache 経由で固定化されるため、 network
// 失敗扱いに倒して loaded=false にする (次回 reload で fresh fetch を許す)。
const parseKatexCssResponse = async (response: Response): Promise<KatexCssOutcome> => {
  if (response.status === 404) {
    return { css: null, networkError: null, status: 404 }
  }
  if (!response.ok) {
    return { css: null, networkError: `HTTP ${response.status}`, status: response.status }
  }
  const css = await response.text()
  if (css.trim().length === 0) {
    return { css: null, networkError: 'empty body', status: response.status }
  }
  return { css, networkError: null, status: response.status }
}

const fetchKatexCssOnce = async (url: URL, signal: AbortSignal): Promise<KatexCssOutcome> => {
  try {
    const response = await fetch(url.href, { signal })
    return await parseKatexCssResponse(response)
  } catch (error) {
    return { css: null, networkError: String(error), status: null }
  }
}

interface KatexCssLoadResult {
  failures: AssetLoadFailure[]
  loaded: boolean
}

const buildKatexCssFetchFailure = (
  blockId: string,
  outcome: KatexCssOutcome,
  url: URL
): AssetLoadFailure => {
  if (outcome.status === 404) {
    return {
      asset: 'katex',
      cause: 'katex-css-fetch-404',
      detail: `404 at ${url.href} (${blockId})`,
    }
  }
  return {
    asset: 'katex',
    cause: 'katex-css-fetch-network',
    detail:
      outcome.networkError ?? `status ${outcome.status ?? 'unknown'} at ${url.href} (${blockId})`,
  }
}

const buildKatexCssRecoveryFailure = (
  blockId: string,
  fingerprintedUrl: URL,
  canonicalUrl: URL
): AssetLoadFailure => ({
  asset: 'katex',
  cause: 'katex-css-fetch-404',
  detail: `fingerprinted 404 at ${fingerprintedUrl.href} (${blockId}), recovered from ${canonicalUrl.href}`,
  reason: 'recovered-from-404',
})

// 防御的 guard: 既存 textContent が空のときのみ書き込む。 dedupeFetch をすり抜けた重複 inject や
// 別経路で先に CSS が書き込まれていた場合の意図せぬ上書きを防ぐ。 同 ID style 要素に有効な CSS が
// 既に入っていれば「先勝ち」とする (loadKatexRuntime は cache.katex=true で 2 度目を skip するため、
// 通常経路では空 → 1 度 inject の流れになり guard は no-op)。
const injectKatexCss = (blockId: string, css: string): void => {
  if (typeof document === 'undefined') {
    return
  }
  const el = document.getElementById(blockId)
  if (!(el instanceof HTMLStyleElement)) {
    return
  }
  if ((el.textContent ?? '').trim().length > 0) {
    return
  }
  el.textContent = css
}

interface KatexCssTarget {
  blockId: string
  canonicalPath: string
  fingerprintedPath: string
}

interface KatexCssCanonicalRetryContext {
  ctx: AssetLoadContext
  fingerprintedOutcome: KatexCssOutcome
  fingerprintedUrl: URL
  target: KatexCssTarget
}

const finalizeKatexCssCanonicalRetry = (
  canonical: KatexCssOutcome,
  canonicalUrl: URL,
  retryCtx: KatexCssCanonicalRetryContext
): KatexCssLoadResult => {
  if (canonical.css !== null) {
    injectKatexCss(retryCtx.target.blockId, canonical.css)
    return {
      failures: [
        buildKatexCssRecoveryFailure(
          retryCtx.target.blockId,
          retryCtx.fingerprintedUrl,
          canonicalUrl
        ),
      ],
      loaded: true,
    }
  }
  return {
    failures: [buildKatexCssFetchFailure(retryCtx.target.blockId, canonical, canonicalUrl)],
    loaded: false,
  }
}

const tryKatexCssCanonicalRetry = async (
  retryCtx: KatexCssCanonicalRetryContext
): Promise<KatexCssLoadResult> => {
  const canonicalUrl = new URL(retryCtx.target.canonicalPath, retryCtx.ctx.baseUrl)
  if (canonicalUrl.href === retryCtx.fingerprintedUrl.href) {
    return {
      failures: [
        buildKatexCssFetchFailure(
          retryCtx.target.blockId,
          retryCtx.fingerprintedOutcome,
          retryCtx.fingerprintedUrl
        ),
      ],
      loaded: false,
    }
  }
  const canonical = await fetchKatexCssOnce(canonicalUrl, retryCtx.ctx.signal)
  if (retryCtx.ctx.signal.aborted) {
    return { failures: [KATEX_ABORTED_FAILURE], loaded: false }
  }
  return finalizeKatexCssCanonicalRetry(canonical, canonicalUrl, retryCtx)
}

interface KatexCssFinalizeArgs {
  ctx: AssetLoadContext
  fingerprinted: KatexCssOutcome
  fingerprintedUrl: URL
  target: KatexCssTarget
}

const finalizeKatexCssFingerprinted = async (
  args: KatexCssFinalizeArgs
): Promise<KatexCssLoadResult> => {
  if (args.fingerprinted.css !== null) {
    injectKatexCss(args.target.blockId, args.fingerprinted.css)
    return { failures: [], loaded: true }
  }
  if (args.fingerprinted.status === 404) {
    return tryKatexCssCanonicalRetry({
      ctx: args.ctx,
      fingerprintedOutcome: args.fingerprinted,
      fingerprintedUrl: args.fingerprintedUrl,
      target: args.target,
    })
  }
  return {
    failures: [
      buildKatexCssFetchFailure(args.target.blockId, args.fingerprinted, args.fingerprintedUrl),
    ],
    loaded: false,
  }
}

const loadKatexCssOnce = async (
  ctx: AssetLoadContext,
  target: KatexCssTarget
): Promise<KatexCssLoadResult> => {
  if (ctx.signal.aborted) {
    return { failures: [KATEX_ABORTED_FAILURE], loaded: false }
  }
  const fingerprintedUrl = new URL(target.fingerprintedPath, ctx.baseUrl)
  const fingerprinted = await fetchKatexCssOnce(fingerprintedUrl, ctx.signal)
  if (ctx.signal.aborted) {
    return { failures: [KATEX_ABORTED_FAILURE], loaded: false }
  }
  return finalizeKatexCssFingerprinted({ ctx, fingerprinted, fingerprintedUrl, target })
}

const KATEX_CSS_BLOCK_ID = 'embedded-katex-css'
const KATEX_FONTS_EXTRA_CSS_BLOCK_ID = 'embedded-katex-fonts-extra-css'

const buildKatexCssTargets = (
  fingerprinted: { css: string; fontsExtraCss: string },
  canonical: { css: string; fontsExtraCss: string }
): { css: KatexCssTarget; fontsExtra: KatexCssTarget } => ({
  css: {
    blockId: KATEX_CSS_BLOCK_ID,
    canonicalPath: canonical.css,
    fingerprintedPath: fingerprinted.css,
  },
  fontsExtra: {
    blockId: KATEX_FONTS_EXTRA_CSS_BLOCK_ID,
    canonicalPath: canonical.fontsExtraCss,
    fingerprintedPath: fingerprinted.fontsExtraCss,
  },
})

const loadKatexOnce = async (ctx: AssetLoadContext): Promise<KatexLoadOutcome> => {
  if (ctx.signal.aborted) {
    return {
      cssLoaded: false,
      failures: [KATEX_ABORTED_FAILURE],
      fontsExtraLoaded: false,
      jsLoaded: false,
      loaded: false,
    }
  }
  const fingerprinted = resolveKatexPaths(ctx.manifest)
  const targets = buildKatexCssTargets(fingerprinted, resolveCanonicalKatexPaths())
  const [js, css, fontsExtra] = await Promise.all([
    loadKatexJsOnce(ctx, fingerprinted.js),
    loadKatexCssOnce(ctx, targets.css),
    loadKatexCssOnce(ctx, targets.fontsExtra),
  ])
  return {
    cssLoaded: css.loaded,
    failures: [...js.failures, ...css.failures, ...fontsExtra.failures],
    fontsExtraLoaded: fontsExtra.loaded,
    jsLoaded: js.loaded,
    loaded: js.loaded && css.loaded && fontsExtra.loaded,
  }
}

/**
 * KaTeX runtime (JS + CSS + fonts-extra CSS) を同一オリジン dynamic import + fetch で
 * 後追い注入する。 3 ファイル独立 retry: JS は import (任意 reject で canonical)、
 * CSS / fontsExtra は fetch (404 で canonical)。 1 つの canonical 成功で他は救わない。 全 3 成功時のみ
 * cache.katex = true (世代 gate で旧世代の stale write を防ぐ)。 JS 失敗時のみ sentinel rollback
 * (CSS は textContent 空のまま KaTeX 描画されない以外副作用なし)。
 */
export const loadKatexRuntime = async (
  ctx: AssetLoadContext,
  cache: OnlineAssetCache
): Promise<KatexLoadOutcome> => {
  const fingerprinted = resolveKatexPaths(ctx.manifest)
  const key = `katex:${new URL(fingerprinted.js, ctx.baseUrl).href}`
  const outcome = await dedupeFetch(
    cache,
    key,
    async (): Promise<KatexLoadOutcome> => loadKatexOnce(ctx)
  )
  if (outcome.loaded && !ctx.signal.aborted) {
    cache.katex = true
    // entry の 1 度目 dispatch (JS evaluate 直後) は CSS 未注入の状態で発火しているため、
    // renderer 側 isKatexCssReady gate で skip されている。 CSS 注入完了後に改めて event を
    // dispatch して永続 listener に再 upgrade を促す (CSS 注入済みで gate 通過 → KaTeX HTML 描画)。
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new Event('mdxg:katex-ready'))
    }
  } else if (!outcome.jsLoaded) {
    clearKatexJsSentinel()
  }
  return outcome
}

const loadKatexIfNeeded = async (
  reqs: AssetRequirements,
  cache: OnlineAssetCache
): Promise<KatexLoadOutcome> => {
  if (!reqs.needKatex) {
    return {
      cssLoaded: false,
      failures: [],
      fontsExtraLoaded: false,
      jsLoaded: false,
      loaded: false,
    }
  }
  return loadKatexRuntime(reqs.ctx, cache)
}

/**
 * `OnlineAssetLoadResult.katexLoaded` の値を計算する (resolveMermaidLoadedFlag と semantics 対称)。
 * needKatex=true なら今回 load の成否、 needKatex=false なら cache.katex (過去 session で load 済み
 * かどうか)。
 */
const resolveKatexLoadedFlag = (
  reqs: AssetRequirements,
  katex: KatexLoadOutcome,
  cache: OnlineAssetCache
): boolean => {
  if (reqs.needKatex) {
    return katex.loaded
  }
  return cache.katex
}

/**
 * 3 ファイル個別 load 状態を OnlineAssetLoadResult に露出する。 status UI 側で「JS だけ成功 /
 * CSS だけ失敗」を識別する用途。 needKatex=false (未試行) なら null を返し、 katex.loaded 単独の
 * boolean では失われる情報を補完する。
 */
const resolveKatexDetail = (
  reqs: AssetRequirements,
  katex: KatexLoadOutcome
): KatexLoadDetail | null => {
  if (!reqs.needKatex) {
    return null
  }
  return {
    cssLoaded: katex.cssLoaded,
    fontsExtraLoaded: katex.fontsExtraLoaded,
    jsLoaded: katex.jsLoaded,
  }
}

/**
 * `OnlineAssetLoadResult.mermaidLoaded` の値を計算する semantics:
 * - **reqs.needMermaid === true**: 今回 load の成否 (true = 今 fetch 成功 or canonical recovered、 false = 永続失敗)
 * - **reqs.needMermaid === false**: cache.mermaid (true = 既ロード = bridge 動作可能、 false = 未試行 = 失敗と区別できない曖昧状態)
 *
 * 「Mermaid 不要 markdown × 未 load」で false が返る経路は「load 失敗」ではなく「未必要」を意味する。
 * status UI 側で両者を区別したい場合は別 field (例: `mermaidNeeded: boolean`) を追加する。
 */
const resolveMermaidLoadedFlag = (
  reqs: AssetRequirements,
  mermaid: MermaidLoadOutcome,
  cache: OnlineAssetCache
): boolean => {
  if (reqs.needMermaid) {
    return mermaid.loaded
  }
  return cache.mermaid
}

/**
 * markdown 本文を scan して必要な Shiki / Mermaid / KaTeX アセットを発火させる中核関数。
 * 起動経路から fire-and-forget で呼び出されるため戻り値を握りつぶしても呼び出し側の挙動を
 * 壊さない設計。KaTeX 経路は loader 未実装の間 `OnlineAssetCache.katex` の stub フラグで
 * skip され、本実装が入った時点で gate を解く。
 */
export const loadOnlineAssets = async (
  markdown: string,
  baseUrl: URL,
  cache: OnlineAssetCache
): Promise<OnlineAssetLoadResult> => {
  const myGeneration = cache.generation
  const reqs = computeAssetRequirements(markdown, baseUrl, cache)
  const [shiki, mermaid, katex] = await Promise.all([
    loadShikiGrammars(reqs.ctx, reqs.missing, cache),
    loadMermaidIfNeeded(reqs, cache),
    loadKatexIfNeeded(reqs, cache),
  ])
  return {
    failures: [...shiki.failures, ...mermaid.failures, ...katex.failures],
    generation: myGeneration,
    katexDetail: resolveKatexDetail(reqs, katex),
    katexLoaded: resolveKatexLoadedFlag(reqs, katex, cache),
    loadedLangs: shiki.loaded,
    mermaidLoaded: resolveMermaidLoadedFlag(reqs, mermaid, cache),
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

const installEmbeddedMermaidScript = (): HTMLElement => {
  const existing = document.getElementById('embedded-mermaid')
  if (existing instanceof HTMLElement) {
    return existing
  }
  const el = document.createElement('script')
  el.id = 'embedded-mermaid'
  el.setAttribute('type', 'module')
  el.textContent = ''
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
  const ids = [
    'online-asset-manifest',
    'embedded-shiki-langs',
    'embedded-mermaid',
    'embedded-katex',
    'embedded-katex-css',
    'embedded-katex-fonts-extra-css',
  ]
  for (const id of ids) {
    const el = document.getElementById(id)
    if (el !== null) {
      el.remove()
    }
  }
}

interface MermaidTestCtx {
  cache: OnlineAssetCache
  mermaidEl: HTMLElement
}

const setupMermaidTest = (
  importer: MermaidImporter,
  manifestJson: string | null = null
): MermaidTestCtx => {
  installEmbeddedShikiLangsScript()
  const mermaidEl = installEmbeddedMermaidScript()
  if (manifestJson !== null) {
    installManifestScript(manifestJson)
  }
  setMermaidImporterForTest(importer)
  const cache = createOnlineAssetCache()
  // ```mermaid``` fence は scanFencedLangs にも 'mermaid' lang として認識されて Shiki 経路にも
  // 流れ込むが、本 helper は Mermaid 経路だけ検証したいので Shiki は cache 既ロード扱いで skip。
  cache.langs.add('mermaid')
  return { cache, mermaidEl }
}

const FINGERPRINTED_MERMAID_MANIFEST = JSON.stringify({
  mermaid: 'fingerprinted/mermaid.old.mjs',
  shikiLangs: {},
})

const MERMAID_TEST_MD = '```mermaid\ngraph TD\nA --> B\n```\n'

const firstImportSpyUrl = (spy: { mock: { calls: unknown[][] } }): string => {
  const [first] = spy.mock.calls
  if (!first) {
    return ''
  }
  const [url] = first
  return String(url)
}

const FINGERPRINTED_MERMAID_ABC_MANIFEST = JSON.stringify({
  mermaid: 'fingerprinted/mermaid.abc.mjs',
  shikiLangs: {},
})

interface DeferredImporter {
  importer: MermaidImporter
  resolve: (value: string | null) => void
}

const createDeferredMermaidImporter = (): DeferredImporter => {
  let resolveFn: ((value: string | null) => void) | null = null
  const importer: MermaidImporter = async (): Promise<string | null> =>
    new Promise((resolve): void => {
      resolveFn = resolve
    })
  const resolve = (value: string | null): void => {
    if (resolveFn !== null) {
      resolveFn(value)
    }
  }
  return { importer, resolve }
}

const runAbortedThenClearedCycle = async (importer: MermaidImporter): Promise<MermaidTestCtx> => {
  const ctx = setupMermaidTest(importer, FINGERPRINTED_MERMAID_ABC_MANIFEST)
  ctx.cache.currentAbortController = new AbortController()
  ctx.cache.currentAbortController.abort()
  await loadOnlineAssets(MERMAID_TEST_MD, new URL('https://h/'), ctx.cache)
  ctx.cache.inFlight.clear()
  ctx.cache.currentAbortController = new AbortController()
  return ctx
}

// === KaTeX test helpers (module scope) ===

const createKatexScriptElForTest = (): HTMLElement => {
  const existing = document.getElementById('embedded-katex')
  if (existing instanceof HTMLElement) {
    return existing
  }
  const el = document.createElement('script')
  el.id = 'embedded-katex'
  el.setAttribute('type', 'module')
  el.textContent = ''
  document.body.appendChild(el)
  return el
}

const createKatexStyleElForTest = (id: string): HTMLStyleElement => {
  const existing = document.getElementById(id)
  if (existing instanceof HTMLStyleElement) {
    return existing
  }
  const el = document.createElement('style')
  el.id = id
  el.textContent = ''
  document.body.appendChild(el)
  return el
}

interface KatexTestCtx {
  cache: OnlineAssetCache
  cssEl: HTMLStyleElement
  fontsExtraEl: HTMLStyleElement
  jsEl: HTMLElement
}

const FINGERPRINTED_KATEX_MANIFEST = JSON.stringify({
  katex: {
    css: 'fingerprinted/katex/katex.aaa.css',
    fontsExtraCss: 'fingerprinted/katex/katex-fonts-extra.bbb.css',
    js: 'fingerprinted/katex/katex.ccc.mjs',
  },
  shikiLangs: {},
})

const KATEX_TEST_MD = '$x^2$\n'

interface KatexTestSetup {
  importer: KatexImporter
  manifestJson?: string
}

const setupKatexTest = (opts: KatexTestSetup): KatexTestCtx => {
  installEmbeddedShikiLangsScript()
  const jsEl = createKatexScriptElForTest()
  const cssEl = createKatexStyleElForTest('embedded-katex-css')
  const fontsExtraEl = createKatexStyleElForTest('embedded-katex-fonts-extra-css')
  if (typeof opts.manifestJson === 'string') {
    installManifestScript(opts.manifestJson)
  }
  setKatexImporterForTest(opts.importer)
  return { cache: createOnlineAssetCache(), cssEl, fontsExtraEl, jsEl }
}

const okCssResponse = (body: string): Response =>
  new Response(body, { headers: { 'content-type': 'text/css' }, status: 200 })

const notFoundCssResponse = (): Response => new Response('not found', { status: 404 })

const abortCacheNow = (cache: OnlineAssetCache): void => {
  const controller = new AbortController()
  controller.abort()
  cache.currentAbortController = controller
}

if (import.meta.vitest) {
  const { afterEach, beforeEach, describe, expect, it, vi } = import.meta.vitest

  describe('createOnlineAssetCache', () => {
    it('Mermaid / KaTeX いずれも false 初期化 (loader 成功で true に立ち上がる gate)', () => {
      const cache = createOnlineAssetCache()
      expect(cache.mermaid).toBe(false)
      expect(cache.katex).toBe(false)
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

  describe('loadMermaidRuntime: fingerprinted → canonical retry', () => {
    beforeEach((): void => {
      resetCachedManifestForTest()
    })
    afterEach((): void => {
      cleanupTestNodes()
      resetMermaidImporterForTest()
      vi.unstubAllGlobals()
    })

    it('Mermaid fence の無い markdown では import が走らない', async () => {
      const importSpy = vi.fn()
      const { cache } = setupMermaidTest(importSpy)
      await loadOnlineAssets('# title only\n', new URL('https://h/'), cache)
      expect(importSpy).not.toHaveBeenCalled()
      expect(cache.mermaid).toBe(false)
    })

    it('fingerprinted import 成功で cache.mermaid=true + sentinel に MERMAID_SENTINEL 文字列 exact match', async () => {
      const importSpy = vi.fn(async (): Promise<string | null> => null)
      const manifestJson = JSON.stringify({
        mermaid: 'fingerprinted/mermaid.abc.mjs',
        shikiLangs: {},
      })
      const { cache, mermaidEl } = setupMermaidTest(importSpy, manifestJson)
      const result = await loadOnlineAssets(MERMAID_TEST_MD, new URL('https://h/'), cache)
      expect(firstImportSpyUrl(importSpy)).toBe('https://h/fingerprinted/mermaid.abc.mjs')
      expect(cache.mermaid).toBe(true)
      expect(result.mermaidLoaded).toBe(true)
      // sentinel 文字列 literal の exact match。 waitForRuntime gate (hasEmbeddedScript) の
      // textContent.trim().length > 0 仕様に依存しているため、 sentinel をリファクタしたら gate
      // を壊す危険があり、 exact match で regression を早期検出する
      expect(mermaidEl.textContent).toContain('/* runtime-loaded */')
    })

    it('manifest 欠落時は canonical パスに 1 度だけ import (重複 retry なし)', async () => {
      const importSpy = vi.fn(async (): Promise<string | null> => 'TypeError: fetch failed')
      const { cache } = setupMermaidTest(importSpy)
      const result = await loadOnlineAssets(MERMAID_TEST_MD, new URL('https://h/'), cache)
      expect(importSpy).toHaveBeenCalledTimes(1)
      expect(firstImportSpyUrl(importSpy)).toBe('https://h/canonical/mermaid.mjs')
      expect(cache.mermaid).toBe(false)
      const reasons = result.failures.map((failure): string | null => failure.reason ?? null)
      expect(reasons).toEqual([null])
    })

    it('fingerprinted reject → canonical 成功で recovered-from-load-failure を集約', async () => {
      const importSpy = vi.fn().mockResolvedValueOnce('TypeError: 404').mockResolvedValueOnce(null)
      const { cache } = setupMermaidTest(importSpy, FINGERPRINTED_MERMAID_MANIFEST)
      const result = await loadOnlineAssets(MERMAID_TEST_MD, new URL('https://h/'), cache)
      expect(importSpy).toHaveBeenCalledTimes(2)
      expect(cache.mermaid).toBe(true)
      expect(result.failures).toEqual([
        expect.objectContaining({
          asset: 'mermaid',
          cause: 'mermaid-import-reject',
          reason: 'recovered-from-load-failure',
        }),
      ])
    })

    it('fingerprinted も canonical も reject で mermaidLoaded=false + failures 集約', async () => {
      const importSpy = vi.fn(async (): Promise<string | null> => 'TypeError: failed')
      const { cache } = setupMermaidTest(importSpy, FINGERPRINTED_MERMAID_MANIFEST)
      const result = await loadOnlineAssets(MERMAID_TEST_MD, new URL('https://h/'), cache)
      expect(importSpy).toHaveBeenCalledTimes(2)
      expect(cache.mermaid).toBe(false)
      expect(result.mermaidLoaded).toBe(false)
      const causes = result.failures.map((failure): string => failure.cause)
      expect(causes).toContain('mermaid-import-reject')
    })

    it('既に cache.mermaid=true なら再 import しない (Open file 経路 SHOULD)', async () => {
      const importSpy = vi.fn()
      const { cache } = setupMermaidTest(importSpy)
      cache.mermaid = true
      const result = await loadOnlineAssets(MERMAID_TEST_MD, new URL('https://h/'), cache)
      expect(importSpy).not.toHaveBeenCalled()
      expect(result.mermaidLoaded).toBe(true)
    })

    it('signal.aborted なら import 前に aborted-by-newer-generation を集約', async () => {
      const importSpy = vi.fn()
      const { cache } = setupMermaidTest(importSpy)
      cache.currentAbortController = new AbortController()
      cache.currentAbortController.abort()
      const result = await loadOnlineAssets(MERMAID_TEST_MD, new URL('https://h/'), cache)
      expect(importSpy).not.toHaveBeenCalled()
      const causes = result.failures.map((failure): string => failure.cause)
      expect(causes).toContain('aborted-by-newer-generation')
    })

    it('Shiki 失敗で Mermaid load を妨げない (Promise.all で独立)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not found', { status: 404 })))
      const { cache } = setupMermaidTest(async (): Promise<string | null> => null)
      const md = `${MERMAID_TEST_MD}\n\`\`\`ts\nx\n\`\`\`\n`
      const result = await loadOnlineAssets(md, new URL('https://h/'), cache)
      expect(cache.mermaid).toBe(true)
      expect(result.mermaidLoaded).toBe(true)
      expect(result.loadedLangs).toEqual([])
    })
  })

  describe('loadMermaidRuntime: sentinel rollback / 世代 gate / regression guard', () => {
    beforeEach((): void => {
      resetCachedManifestForTest()
    })
    afterEach((): void => {
      cleanupTestNodes()
      resetMermaidImporterForTest()
      vi.unstubAllGlobals()
    })

    it('失敗時に sentinel が空に rollback される (次回 boot の 2 秒 idle timeout 回避)', async () => {
      const importSpy = vi.fn(async (): Promise<string | null> => 'TypeError: failed')
      const { cache, mermaidEl } = setupMermaidTest(importSpy, FINGERPRINTED_MERMAID_MANIFEST)
      await loadOnlineAssets(MERMAID_TEST_MD, new URL('https://h/'), cache)
      expect(cache.mermaid).toBe(false)
      expect((mermaidEl.textContent ?? '').trim()).toBe('')
    })

    it('abort 完了後の cache.mermaid stale write を世代 gate で防ぐ', async () => {
      const { importer, resolve } = createDeferredMermaidImporter()
      const { cache } = setupMermaidTest(importer, FINGERPRINTED_MERMAID_ABC_MANIFEST)
      cache.currentAbortController = new AbortController()
      const promise = loadOnlineAssets(MERMAID_TEST_MD, new URL('https://h/'), cache)
      cache.currentAbortController.abort()
      resolve(null)
      await promise
      expect(cache.mermaid).toBe(false)
    })

    it('abort + inFlight.clear() で次世代の同一 URL 要求が新規 Promise を作る (regression guard)', async () => {
      const importSpy = vi.fn(async (): Promise<string | null> => null)
      const { cache } = await runAbortedThenClearedCycle(importSpy)
      const result = await loadOnlineAssets(MERMAID_TEST_MD, new URL('https://h/'), cache)
      expect(importSpy).toHaveBeenCalledTimes(1)
      expect(cache.mermaid).toBe(true)
      expect(result.mermaidLoaded).toBe(true)
    })
  })

  describe('loadKatexRuntime: 3 ファイル独立 retry', () => {
    beforeEach((): void => {
      resetCachedManifestForTest()
    })
    afterEach((): void => {
      cleanupTestNodes()
      resetKatexImporterForTest()
      vi.unstubAllGlobals()
    })

    it('数式の無い markdown では import / fetch が発火しない', async () => {
      const importSpy = vi.fn()
      const fetchSpy = vi.fn()
      vi.stubGlobal('fetch', fetchSpy)
      const { cache } = setupKatexTest({ importer: importSpy })
      await loadOnlineAssets('# no math\n', new URL('https://h/'), cache)
      expect(importSpy).not.toHaveBeenCalled()
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(cache.katex).toBe(false)
    })

    it('3 ファイル全成功で cache.katex=true + sentinel + CSS textContent exact 注入', async () => {
      const importSpy = vi.fn(async (): Promise<string | null> => null)
      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce(okCssResponse('.katex{font:1em sans-serif;}'))
        .mockResolvedValueOnce(okCssResponse('@font-face{font-family:KaTeX}'))
      vi.stubGlobal('fetch', fetchSpy)
      const { cache, jsEl, cssEl, fontsExtraEl } = setupKatexTest({
        importer: importSpy,
        manifestJson: FINGERPRINTED_KATEX_MANIFEST,
      })
      const result = await loadOnlineAssets(KATEX_TEST_MD, new URL('https://h/'), cache)
      expect(cache.katex).toBe(true)
      expect(result.katexLoaded).toBe(true)
      // sentinel / CSS は exact match で「上書き or append」を区別 (assertion 強化)
      expect(jsEl.textContent).toBe('/* runtime-loaded */')
      expect(cssEl.textContent).toBe('.katex{font:1em sans-serif;}')
      expect(fontsExtraEl.textContent).toBe('@font-face{font-family:KaTeX}')
    })

    it('JS import reject → canonical 成功で recovered-from-load-failure を集約', async () => {
      const importSpy = vi.fn().mockResolvedValueOnce('TypeError: 404').mockResolvedValueOnce(null)
      vi.stubGlobal(
        'fetch',
        vi.fn(async (): Promise<Response> => okCssResponse('.katex{}'))
      )
      const { cache } = setupKatexTest({
        importer: importSpy,
        manifestJson: FINGERPRINTED_KATEX_MANIFEST,
      })
      const result = await loadOnlineAssets(KATEX_TEST_MD, new URL('https://h/'), cache)
      expect(importSpy).toHaveBeenCalledTimes(2)
      expect(cache.katex).toBe(true)
      expect(result.failures).toContainEqual(
        expect.objectContaining({
          asset: 'katex',
          cause: 'katex-import-reject',
          reason: 'recovered-from-load-failure',
        })
      )
    })

    it('CSS fingerprinted 404 → canonical 成功で recovered-from-404 を集約', async () => {
      const importSpy = vi.fn(async (): Promise<string | null> => null)
      // fingerprinted CSS / fontsExtra は 404 → canonical で成功
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: unknown): Promise<Response> => {
          if (String(input).includes('fingerprinted/')) {
            return notFoundCssResponse()
          }
          return okCssResponse('.katex{}')
        })
      )
      const { cache } = setupKatexTest({
        importer: importSpy,
        manifestJson: FINGERPRINTED_KATEX_MANIFEST,
      })
      const result = await loadOnlineAssets(KATEX_TEST_MD, new URL('https://h/'), cache)
      expect(cache.katex).toBe(true)
      const recovered = result.failures.filter(
        (failure): boolean =>
          failure.cause === 'katex-css-fetch-404' && failure.reason === 'recovered-from-404'
      )
      expect(recovered).toHaveLength(2)
    })

    it('CSS だけ全 reject で katex.loaded=false + sentinel rollback はしない (JS 成功)', async () => {
      const importSpy = vi.fn(async (): Promise<string | null> => null)
      vi.stubGlobal(
        'fetch',
        vi.fn(async (): Promise<Response> => notFoundCssResponse())
      )
      const { cache, jsEl } = setupKatexTest({
        importer: importSpy,
        manifestJson: FINGERPRINTED_KATEX_MANIFEST,
      })
      const result = await loadOnlineAssets(KATEX_TEST_MD, new URL('https://h/'), cache)
      expect(cache.katex).toBe(false)
      expect(result.katexLoaded).toBe(false)
      expect(jsEl.textContent).toContain('/* runtime-loaded */')
    })

    it('JS reject で sentinel rollback (次回 boot の 2 秒 idle timeout 回避)', async () => {
      const importSpy = vi.fn(async (): Promise<string | null> => 'TypeError: failed')
      vi.stubGlobal(
        'fetch',
        vi.fn(async (): Promise<Response> => okCssResponse('.katex{}'))
      )
      const { cache, jsEl } = setupKatexTest({
        importer: importSpy,
        manifestJson: FINGERPRINTED_KATEX_MANIFEST,
      })
      await loadOnlineAssets(KATEX_TEST_MD, new URL('https://h/'), cache)
      expect(cache.katex).toBe(false)
      expect((jsEl.textContent ?? '').trim()).toBe('')
    })
  })

  describe('loadKatexRuntime: manifest / cache / abort', () => {
    beforeEach((): void => {
      resetCachedManifestForTest()
    })
    afterEach((): void => {
      cleanupTestNodes()
      resetKatexImporterForTest()
      vi.unstubAllGlobals()
    })

    it('manifest 欠落時は canonical パスで JS import + CSS fetch (重複 retry なし)', async () => {
      const importSpy = vi.fn(async (): Promise<string | null> => null)
      const fetchSpy = vi.fn(async (): Promise<Response> => okCssResponse('.katex{}'))
      vi.stubGlobal('fetch', fetchSpy)
      const { cache } = setupKatexTest({ importer: importSpy })
      await loadOnlineAssets(KATEX_TEST_MD, new URL('https://h/'), cache)
      expect(importSpy).toHaveBeenCalledTimes(1)
      expect(fetchSpy).toHaveBeenCalledTimes(2)
      expect(cache.katex).toBe(true)
    })

    it('既に cache.katex=true なら再 import / fetch しない (Open file 経路 SHOULD)', async () => {
      const importSpy = vi.fn()
      const fetchSpy = vi.fn()
      vi.stubGlobal('fetch', fetchSpy)
      const { cache } = setupKatexTest({ importer: importSpy })
      cache.katex = true
      const result = await loadOnlineAssets(KATEX_TEST_MD, new URL('https://h/'), cache)
      expect(importSpy).not.toHaveBeenCalled()
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(result.katexLoaded).toBe(true)
    })

    it('signal.aborted なら import / fetch 前に aborted-by-newer-generation を集約', async () => {
      const importSpy = vi.fn()
      const fetchSpy = vi.fn()
      vi.stubGlobal('fetch', fetchSpy)
      const { cache } = setupKatexTest({ importer: importSpy })
      abortCacheNow(cache)
      const result = await loadOnlineAssets(KATEX_TEST_MD, new URL('https://h/'), cache)
      expect(importSpy).not.toHaveBeenCalled()
      expect(fetchSpy).not.toHaveBeenCalled()
      const causes = result.failures.map((failure): string => failure.cause)
      expect(causes).toContain('aborted-by-newer-generation')
    })
  })

  describe('loadKatexRuntime: shape validation / 3 ファイル独立性 / network error', () => {
    beforeEach((): void => {
      resetCachedManifestForTest()
    })
    afterEach((): void => {
      cleanupTestNodes()
      resetKatexImporterForTest()
      vi.unstubAllGlobals()
    })

    it('200 OK + 空 body の CSS は loaded=false として集約 (katex-css-fetch-network)', async () => {
      const importSpy = vi.fn(async (): Promise<string | null> => null)
      vi.stubGlobal(
        'fetch',
        vi.fn(async (): Promise<Response> => okCssResponse(''))
      )
      const { cache } = setupKatexTest({
        importer: importSpy,
        manifestJson: FINGERPRINTED_KATEX_MANIFEST,
      })
      const result = await loadOnlineAssets(KATEX_TEST_MD, new URL('https://h/'), cache)
      expect(cache.katex).toBe(false)
      expect(result.katexLoaded).toBe(false)
      const networkFailures = result.failures.filter(
        (failure): boolean => failure.cause === 'katex-css-fetch-network'
      )
      expect(networkFailures.length).toBeGreaterThan(0)
    })

    it('injectKatexCss は既存 textContent が非空ならスキップ (上書きしない)', async () => {
      const importSpy = vi.fn(async (): Promise<string | null> => null)
      vi.stubGlobal(
        'fetch',
        vi.fn(async (): Promise<Response> => okCssResponse('.katex{new}'))
      )
      const { cache, cssEl } = setupKatexTest({
        importer: importSpy,
        manifestJson: FINGERPRINTED_KATEX_MANIFEST,
      })
      // 先に CSS を書き込んでおく (別経路で書き込まれた状態を再現)
      cssEl.textContent = '.katex{prior}'
      await loadOnlineAssets(KATEX_TEST_MD, new URL('https://h/'), cache)
      expect(cssEl.textContent).toBe('.katex{prior}')
    })

    it('CSS injection idempotent (cache miss 経路で 2 度呼びでも append しない)', async () => {
      const importSpy = vi.fn(async (): Promise<string | null> => null)
      vi.stubGlobal(
        'fetch',
        vi.fn(async (): Promise<Response> => okCssResponse('.katex{first}'))
      )
      const { cache, cssEl } = setupKatexTest({
        importer: importSpy,
        manifestJson: FINGERPRINTED_KATEX_MANIFEST,
      })
      await loadOnlineAssets(KATEX_TEST_MD, new URL('https://h/'), cache)
      // 1 回目で .katex{first} が exact match で入る (toBe で exact match assertion 強化)
      expect(cssEl.textContent).toBe('.katex{first}')
      // 2 回目 (cache.katex=true なので skip 経路) でも textContent が append されない
      await loadOnlineAssets(KATEX_TEST_MD, new URL('https://h/'), cache)
      expect(cssEl.textContent).toBe('.katex{first}')
    })

    it('3 ファイル独立性 — JS canonical 救済でも CSS canonical fetch は呼ばれない', async () => {
      const importSpy = vi.fn().mockResolvedValueOnce('TypeError: 404').mockResolvedValueOnce(null)
      const fetchSpy = vi.fn(async (): Promise<Response> => okCssResponse('.katex{}'))
      vi.stubGlobal('fetch', fetchSpy)
      const { cache } = setupKatexTest({
        importer: importSpy,
        manifestJson: FINGERPRINTED_KATEX_MANIFEST,
      })
      await loadOnlineAssets(KATEX_TEST_MD, new URL('https://h/'), cache)
      // JS は fingerprinted reject + canonical 成功で 2 回 import
      expect(importSpy).toHaveBeenCalledTimes(2)
      // CSS は fingerprinted 成功で canonical fetch されず 2 回のみ (CSS + fontsExtra)
      expect(fetchSpy).toHaveBeenCalledTimes(2)
      const fetchedUrls = (fetchSpy.mock.calls as unknown[][]).map((args): string => {
        const [first] = args
        return String(first)
      })
      expect(fetchedUrls.every((url): boolean => url.includes('fingerprinted/'))).toBe(true)
    })

    it('3 ファイル独立性 — CSS canonical 救済でも JS canonical import は呼ばれない', async () => {
      const importSpy = vi.fn(async (): Promise<string | null> => null)
      const fetchSpy = vi.fn(async (input: unknown): Promise<Response> => {
        if (String(input).includes('fingerprinted/')) {
          return notFoundCssResponse()
        }
        return okCssResponse('.katex{recovered}')
      })
      vi.stubGlobal('fetch', fetchSpy)
      const { cache } = setupKatexTest({
        importer: importSpy,
        manifestJson: FINGERPRINTED_KATEX_MANIFEST,
      })
      await loadOnlineAssets(KATEX_TEST_MD, new URL('https://h/'), cache)
      // JS は fingerprinted 成功で 1 回のみ (canonical import なし)
      expect(importSpy).toHaveBeenCalledTimes(1)
      // CSS は fingerprinted 404 → canonical 成功で 2 + 2 = 4 回 fetch
      expect(fetchSpy).toHaveBeenCalledTimes(4)
    })

    it('CSS network error (HTTP 500) は retry なしで katex-css-fetch-network に集約', async () => {
      const importSpy = vi.fn(async (): Promise<string | null> => null)
      vi.stubGlobal(
        'fetch',
        vi.fn(async (): Promise<Response> => new Response('error', { status: 500 }))
      )
      const { cache } = setupKatexTest({
        importer: importSpy,
        manifestJson: FINGERPRINTED_KATEX_MANIFEST,
      })
      const result = await loadOnlineAssets(KATEX_TEST_MD, new URL('https://h/'), cache)
      expect(cache.katex).toBe(false)
      // 404 ではないため canonical retry なし → CSS / fontsExtra で計 2 件の network failure
      const networkFailures = result.failures.filter(
        (failure): boolean => failure.cause === 'katex-css-fetch-network'
      )
      expect(networkFailures).toHaveLength(2)
    })

    it('CSS fetch が throw (TypeError) → retry なしで network failure に集約', async () => {
      const importSpy = vi.fn(async (): Promise<string | null> => null)
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')))
      const { cache } = setupKatexTest({
        importer: importSpy,
        manifestJson: FINGERPRINTED_KATEX_MANIFEST,
      })
      const result = await loadOnlineAssets(KATEX_TEST_MD, new URL('https://h/'), cache)
      expect(cache.katex).toBe(false)
      const networkFailures = result.failures.filter(
        (failure): boolean => failure.cause === 'katex-css-fetch-network'
      )
      expect(networkFailures).toHaveLength(2)
    })

    it('katexDetail: needKatex=true で 3 フラグを露出、 needKatex=false で null', async () => {
      const importSpy = vi.fn(async (): Promise<string | null> => null)
      vi.stubGlobal(
        'fetch',
        vi.fn(async (): Promise<Response> => okCssResponse('.katex{}'))
      )
      const { cache } = setupKatexTest({
        importer: importSpy,
        manifestJson: FINGERPRINTED_KATEX_MANIFEST,
      })
      const withMath = await loadOnlineAssets(KATEX_TEST_MD, new URL('https://h/'), cache)
      expect(withMath.katexDetail).toEqual({
        cssLoaded: true,
        fontsExtraLoaded: true,
        jsLoaded: true,
      })
      cache.katex = false
      const noMath = await loadOnlineAssets('# no math\n', new URL('https://h/'), cache)
      expect(noMath.katexDetail).toBeNull()
    })
  })

  describe('loadKatexRuntime: CSS 注入完了後の mdxg:katex-ready 再 dispatch', () => {
    beforeEach((): void => {
      resetCachedManifestForTest()
    })
    afterEach((): void => {
      cleanupTestNodes()
      resetKatexImporterForTest()
      vi.unstubAllGlobals()
    })

    it('3 ファイル全成功で CSS 注入完了後に再 dispatch (unstyled 永続化の防御)', async () => {
      const importSpy = vi.fn(async (): Promise<string | null> => null)
      vi.stubGlobal(
        'fetch',
        vi.fn(async (): Promise<Response> => okCssResponse('.katex{}'))
      )
      const { cache } = setupKatexTest({
        importer: importSpy,
        manifestJson: FINGERPRINTED_KATEX_MANIFEST,
      })
      const eventSpy = vi.fn()
      document.addEventListener('mdxg:katex-ready', eventSpy)
      try {
        await loadOnlineAssets(KATEX_TEST_MD, new URL('https://h/'), cache)
        expect(eventSpy).toHaveBeenCalledTimes(1)
      } finally {
        document.removeEventListener('mdxg:katex-ready', eventSpy)
      }
    })

    it('CSS 永続失敗時は再 dispatch しない (raw fallback 維持)', async () => {
      const importSpy = vi.fn(async (): Promise<string | null> => null)
      vi.stubGlobal(
        'fetch',
        vi.fn(async (): Promise<Response> => notFoundCssResponse())
      )
      const { cache } = setupKatexTest({
        importer: importSpy,
        manifestJson: FINGERPRINTED_KATEX_MANIFEST,
      })
      const eventSpy = vi.fn()
      document.addEventListener('mdxg:katex-ready', eventSpy)
      try {
        await loadOnlineAssets(KATEX_TEST_MD, new URL('https://h/'), cache)
        expect(eventSpy).not.toHaveBeenCalled()
      } finally {
        document.removeEventListener('mdxg:katex-ready', eventSpy)
      }
    })
  })
}
