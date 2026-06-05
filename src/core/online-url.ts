// allowlist は origin 形式 (`<scheme>://<host>`) で持つ。CSP `connect-src` ディレクティブの
// 値表記および JSON config (§3.3) と同形にすることで drift を構造的に避ける。
// 比較は `URL#origin` (RFC 6454) と == 比較で行うため、末尾スラッシュやパスは含めない。
export const DEFAULT_ONLINE_ALLOWLIST: readonly string[] = Object.freeze([
  'https://raw.githubusercontent.com',
  'https://gist.githubusercontent.com',
])

export interface FetchOpts {
  timeoutMs: number
  maxBodyBytes: number
  acceptedContentTypes: readonly string[]
}

// `acceptedContentTypes` は明示列挙のみで wildcard / 空文字を含めない。空文字 (content-type
// ヘッダ欠落) を accept すると HTML や任意バイナリを markdown としてレンダリングする経路を
// 開いてしまうため、攻撃面縮小を優先する。OSS hosting (raw / gist) は常に text/plain を
// 返すことを Step 1 PoC で実測済み。`application/octet-stream` は CORS 経由 bare 文字列保険。
export const DEFAULT_FETCH_OPTS: FetchOpts = Object.freeze({
  acceptedContentTypes: Object.freeze([
    'text/markdown',
    'text/plain',
    'text/x-markdown',
    'application/octet-stream',
  ]),
  maxBodyBytes: 5 * 1024 * 1024,
  timeoutMs: 15_000,
}) as FetchOpts

export type ValidationReason = 'malformed' | 'scheme_not_https' | 'host_not_allowlisted'

export type ValidationResult = { ok: true; url: URL } | { ok: false; reason: ValidationReason }

export type FetchResult =
  | { ok: true; text: string; finalUrl: string }
  | { ok: false; error: 'http_error'; status: number }
  | { ok: false; error: 'timeout' }
  | { ok: false; error: 'network_error'; message: string }
  | { ok: false; error: 'size_exceeded'; reportedBytes?: number; receivedBytes?: number }
  | { ok: false; error: 'unsupported_content_type'; contentType: string }
  | { ok: false; error: 'redirected_off_allowlist'; finalUrl: string }
  | { ok: false; error: 'pre_validation_failed'; reason: ValidationReason; url: string }

type FetchFailure = Exclude<FetchResult, { ok: true }>

const tryParseUrl = (input: string): URL | null => {
  try {
    return new URL(input)
  } catch {
    return null
  }
}

const errorMessage = (err: unknown): string => {
  if (err instanceof Error) {
    return err.message
  }
  return String(err)
}

// 末尾ドット付き FQDN (`raw.githubusercontent.com.`) を strip し、host を小文字化する。
// DNS 解決上は trailing dot あり / なしは同一実体だが `URL#origin` は dot を保持して
// 返すため、正規化しないと allowlist マッチが UX 上不整合を起こす。
const portSuffix = (port: string): string => {
  if (port === '') {
    return ''
  }
  return `:${port}`
}

export const normalizeOriginForCompare = (url: URL): string => {
  const host = url.hostname.toLowerCase().replace(/\.$/u, '')
  return `${url.protocol}//${host}${portSuffix(url.port)}`
}

export const validateOnlineUrl = (
  input: string,
  allowlist: readonly string[]
): ValidationResult => {
  if (!input) {
    return { ok: false, reason: 'malformed' }
  }
  const parsed = tryParseUrl(input)
  if (parsed === null) {
    return { ok: false, reason: 'malformed' }
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'scheme_not_https' }
  }
  if (!allowlist.includes(normalizeOriginForCompare(parsed))) {
    return { ok: false, reason: 'host_not_allowlisted' }
  }
  return { ok: true, url: parsed }
}

const performFetch = async (
  target: string,
  signal: AbortSignal
): Promise<Response | FetchFailure> => {
  try {
    // simple request 厳守 (preflight 回避): Authorization 等 safelist 外ヘッダを付けない
    return await fetch(target, { redirect: 'follow', signal })
  } catch (error) {
    if (signal.aborted) {
      return { error: 'timeout', ok: false }
    }
    return { error: 'network_error', message: errorMessage(error), ok: false }
  }
}

const checkContentType = (res: Response, accepted: readonly string[]): FetchFailure | null => {
  const rawContentType = res.headers.get('content-type') ?? ''
  const baseContentType = rawContentType.split(';')[0].trim().toLowerCase()
  if (!accepted.includes(baseContentType)) {
    return { contentType: rawContentType, error: 'unsupported_content_type', ok: false }
  }
  return null
}

const checkContentLength = (
  res: Response,
  maxBodyBytes: number,
  ac: AbortController
): FetchResult | null => {
  const reportedLength = res.headers.get('content-length')
  if (reportedLength === null) {
    return null
  }
  const reportedBytes = Number(reportedLength)
  if (!Number.isFinite(reportedBytes)) {
    return null
  }
  // Content-Length が負値 / 非整数は HTTP/1.1 RFC 7230 §3.3.2 違反。ヘッダ偽装の兆候として
  // size_exceeded で reject し、stream 累積防御 (2 段目) に依存させない（早期検出）。
  if (reportedBytes < 0 || !Number.isInteger(reportedBytes) || reportedBytes > maxBodyBytes) {
    ac.abort()
    return { error: 'size_exceeded', ok: false, reportedBytes }
  }
  return null
}

const validateResponse = (
  res: Response,
  opts: FetchOpts,
  ac: AbortController
): FetchResult | null => {
  if (!res.ok) {
    return { error: 'http_error', ok: false, status: res.status }
  }
  const ctError = checkContentType(res, opts.acceptedContentTypes)
  if (ctError !== null) {
    return ctError
  }
  return checkContentLength(res, opts.maxBodyBytes, ac)
}

interface StreamState {
  chunks: Uint8Array[]
  received: number
}

interface SizeContext {
  maxBodyBytes: number
  ac: AbortController
}

const appendChunk = (
  state: StreamState,
  value: Uint8Array,
  ctx: SizeContext
): FetchFailure | null => {
  const next = state.received + value.byteLength
  if (next > ctx.maxBodyBytes) {
    ctx.ac.abort()
    return { error: 'size_exceeded', ok: false, receivedBytes: next }
  }
  state.received = next
  state.chunks.push(value)
  return null
}

type ChunksResult = { ok: true; chunks: readonly Uint8Array[]; received: number } | FetchFailure

const readAllChunks = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ctx: SizeContext
): Promise<ChunksResult> => {
  const state: StreamState = { chunks: [], received: 0 }
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    if (value) {
      const failure = appendChunk(state, value, ctx)
      if (failure !== null) {
        return failure
      }
    }
  }
  return { chunks: state.chunks, ok: true, received: state.received }
}

const drainStream = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ctx: SizeContext
): Promise<ChunksResult> => {
  try {
    return await readAllChunks(reader, ctx)
  } catch (error) {
    if (ctx.ac.signal.aborted) {
      return { error: 'timeout', ok: false }
    }
    return { error: 'network_error', message: errorMessage(error), ok: false }
  } finally {
    // success (done=true) では cancel は no-op だが、size_exceeded / timeout / network_error 経路で
    // reader lock を確実に release するために finally で呼ぶ。reject は無視 (既にエラー処理済み)。
    reader.cancel().catch((): void => {
      /* noop: 既にエラー処理済み */
    })
  }
}

const mergeChunks = (chunks: readonly Uint8Array[], total: number): Uint8Array => {
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

interface ReadBodyParams {
  res: Response
  maxBodyBytes: number
  requestedUrl: string
  ac: AbortController
}

const readBodyFallback = async (
  res: Response,
  maxBodyBytes: number,
  requestedUrl: string
): Promise<FetchResult> => {
  const text = await res.text()
  const encoded = new TextEncoder().encode(text)
  if (encoded.byteLength > maxBodyBytes) {
    return { error: 'size_exceeded', ok: false, receivedBytes: encoded.byteLength }
  }
  return { finalUrl: res.url || requestedUrl, ok: true, text }
}

const readBodyWithLimit = async (params: ReadBodyParams): Promise<FetchResult> => {
  const { res, maxBodyBytes, requestedUrl, ac } = params
  if (!res.body) {
    return readBodyFallback(res, maxBodyBytes, requestedUrl)
  }
  const outcome = await drainStream(res.body.getReader(), { ac, maxBodyBytes })
  if (!outcome.ok) {
    return outcome
  }
  return {
    finalUrl: res.url || requestedUrl,
    ok: true,
    text: new TextDecoder('utf-8').decode(mergeChunks(outcome.chunks, outcome.received)),
  }
}

interface RunFetchParams {
  url: string
  opts: FetchOpts
  ac: AbortController
}

const runFetch = async (params: RunFetchParams): Promise<FetchResult> => {
  const { url, opts, ac } = params
  const fetchOutcome = await performFetch(url, ac.signal)
  if (!(fetchOutcome instanceof Response)) {
    return fetchOutcome
  }
  const validationError = validateResponse(fetchOutcome, opts, ac)
  if (validationError !== null) {
    return validationError
  }
  return readBodyWithLimit({
    ac,
    maxBodyBytes: opts.maxBodyBytes,
    requestedUrl: url,
    res: fetchOutcome,
  })
}

// 二重防御: CSP `connect-src` がリダイレクト各 hop を再評価するという §3.4 の前提に加え、
// CSP 設定ミス / meta タグ単独で HTTP header が剥がれた等のシナリオに備え、最終 URL の
// origin が allowlist にあるかを fetch 後にもう 1 度検証する。
const checkFinalUrl = (result: FetchResult, allowlist: readonly string[]): FetchResult => {
  if (!result.ok) {
    return result
  }
  const finalParsed = tryParseUrl(result.finalUrl)
  if (finalParsed === null || !allowlist.includes(normalizeOriginForCompare(finalParsed))) {
    return { error: 'redirected_off_allowlist', finalUrl: result.finalUrl, ok: false }
  }
  return result
}

export const fetchMarkdownFromUrl = async (
  url: string,
  opts: FetchOpts = DEFAULT_FETCH_OPTS,
  allowlist: readonly string[] = DEFAULT_ONLINE_ALLOWLIST
): Promise<FetchResult> => {
  // fetch 前検証: allowlist を引数に取る境界関数として、caller の validateOnlineUrl 呼び忘れ
  // および `https://attacker/redirect-to-raw` のように初回 GET だけ allowlist 外に飛ばす
  // 攻撃を内部完結で塞ぐ。fetch 後の checkFinalUrl と合わせて二段防御を本関数で完結させる。
  const preValidation = validateOnlineUrl(url, allowlist)
  if (!preValidation.ok) {
    return { error: 'pre_validation_failed', ok: false, reason: preValidation.reason, url }
  }
  const ac = new AbortController()
  const timer = setTimeout(() => {
    ac.abort()
  }, opts.timeoutMs)
  try {
    const result = await runFetch({ ac, opts, url })
    return checkFinalUrl(result, allowlist)
  } finally {
    clearTimeout(timer)
  }
}

if (import.meta.vitest) {
  const { describe, expect, it, afterEach, vi } = import.meta.vitest

  const TEST_URL = 'https://raw.githubusercontent.com/x/y/main/README.md'

  const makeOpts = (overrides: Partial<FetchOpts> = {}): FetchOpts => ({
    acceptedContentTypes: DEFAULT_FETCH_OPTS.acceptedContentTypes,
    maxBodyBytes: 1024,
    timeoutMs: 1000,
    ...overrides,
  })

  // vitest 専用 helper のため、unicorn は module 外移動を勧めるが
  // import.meta.vitest ガード内に閉じ込めて production bundle から落とす方針を優先する
  // eslint-disable-next-line unicorn/consistent-function-scoping
  const streamResponse = (
    body: string,
    init: { contentType?: string; contentLength?: string; status?: number } = {}
  ): Response => {
    const { contentType = 'text/plain; charset=utf-8', contentLength, status = 200 } = init
    const headers = new Headers({ 'content-type': contentType })
    if (typeof contentLength === 'string') {
      headers.set('content-length', contentLength)
    }
    const encoded = new TextEncoder().encode(body)
    const stream = new ReadableStream<Uint8Array>({
      start(controller: ReadableStreamDefaultController<Uint8Array>): void {
        controller.enqueue(encoded)
        controller.close()
      },
    })
    return new Response(stream, { headers, status })
  }

  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.useRealTimers()
  })

  // describe を 2 つに分けているのは max-statements (10) を満たすため。テスト粒度は同じ。
  const validateAllowlist = [
    'https://raw.githubusercontent.com',
    'https://gist.githubusercontent.com',
  ]

  describe('validateOnlineUrl: 基本検証 (parse / scheme / allowlist miss)', () => {
    it('空文字列は malformed', () => {
      expect(validateOnlineUrl('', validateAllowlist)).toEqual({
        ok: false,
        reason: 'malformed',
      })
    })

    it('parse 不能な文字列は malformed', () => {
      expect(validateOnlineUrl('not a url', validateAllowlist)).toEqual({
        ok: false,
        reason: 'malformed',
      })
    })

    it('http:// (同一 host でも scheme 不一致) は scheme_not_https', () => {
      expect(validateOnlineUrl('http://raw.githubusercontent.com/x', validateAllowlist)).toEqual({
        ok: false,
        reason: 'scheme_not_https',
      })
    })

    it('file:// 等の他 scheme も scheme_not_https', () => {
      expect(validateOnlineUrl('file:///etc/passwd', validateAllowlist)).toEqual({
        ok: false,
        reason: 'scheme_not_https',
      })
    })

    it('allowlist 外 origin は host_not_allowlisted', () => {
      expect(validateOnlineUrl('https://example.com/x.md', validateAllowlist)).toEqual({
        ok: false,
        reason: 'host_not_allowlisted',
      })
    })

    it('subdomain spoofing (evil.raw.githubusercontent.com) も host_not_allowlisted', () => {
      expect(
        validateOnlineUrl('https://evil.raw.githubusercontent.com/x', validateAllowlist)
      ).toEqual({
        ok: false,
        reason: 'host_not_allowlisted',
      })
    })
  })

  describe('validateOnlineUrl: accept + host 正規化', () => {
    it('allowlist 内の https origin を accept する', () => {
      const result = validateOnlineUrl(
        'https://raw.githubusercontent.com/owner/repo/main/README.md',
        validateAllowlist
      )
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.url.origin).toBe('https://raw.githubusercontent.com')
      }
    })

    it('末尾ドット付き FQDN (raw.githubusercontent.com.) も accept する', () => {
      const result = validateOnlineUrl(
        'https://raw.githubusercontent.com./owner/repo/main/README.md',
        validateAllowlist
      )
      expect(result.ok).toBe(true)
    })

    it('大文字混入 host (RAW.GITHUBUSERCONTENT.COM) も accept する', () => {
      const result = validateOnlineUrl(
        'https://RAW.GitHubUserContent.com/owner/repo/main/README.md',
        validateAllowlist
      )
      expect(result.ok).toBe(true)
    })

    it('DEFAULT_ONLINE_ALLOWLIST は raw / gist の 2 origin (scheme 込み)', () => {
      expect([...DEFAULT_ONLINE_ALLOWLIST]).toEqual([
        'https://raw.githubusercontent.com',
        'https://gist.githubusercontent.com',
      ])
    })
  })

  // describe を 4 つに分けているのは max-statements (10) を満たすため。テスト粒度は同じ。
  describe('fetchMarkdownFromUrl: success cases', () => {
    it('正常系: text を返す', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(streamResponse('# hello'))
      const result = await fetchMarkdownFromUrl(TEST_URL, makeOpts())
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.text).toBe('# hello')
      }
    })

    it('finalUrl に response.url を返す (redirect follow 後の最終 URL)', async () => {
      const finalUrl = 'https://raw.githubusercontent.com/x/y/main/REAL.md'
      const res = streamResponse('# real')
      Object.defineProperty(res, 'url', { value: finalUrl })
      globalThis.fetch = vi.fn().mockResolvedValue(res)
      const result = await fetchMarkdownFromUrl(TEST_URL, makeOpts())
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.finalUrl).toBe(finalUrl)
      }
    })

    it('Content-Type が text/markdown なら accept', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(streamResponse('# md', { contentType: 'text/markdown' }))
      const result = await fetchMarkdownFromUrl(TEST_URL, makeOpts())
      expect(result.ok).toBe(true)
    })
  })

  describe('fetchMarkdownFromUrl: HTTP / content-type errors', () => {
    it('404 → http_error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('', { status: 404 }))
      const result = await fetchMarkdownFromUrl(TEST_URL, makeOpts())
      expect(result).toEqual({ error: 'http_error', ok: false, status: 404 })
    })

    it('500 → http_error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('', { status: 500 }))
      const result = await fetchMarkdownFromUrl(TEST_URL, makeOpts())
      expect(result).toEqual({ error: 'http_error', ok: false, status: 500 })
    })

    it('Content-Type が json なら unsupported_content_type', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('{}', {
          headers: { 'content-type': 'application/json' },
          status: 200,
        })
      )
      const result = await fetchMarkdownFromUrl(TEST_URL, makeOpts())
      expect(result.ok).toBe(false)
      if (!result.ok && result.error === 'unsupported_content_type') {
        expect(result.contentType).toBe('application/json')
      }
    })

    it('Content-Type が text/html なら unsupported_content_type', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('<html/>', {
          headers: { 'content-type': 'text/html; charset=utf-8' },
          status: 200,
        })
      )
      const result = await fetchMarkdownFromUrl(TEST_URL, makeOpts())
      expect(result.ok).toBe(false)
      if (!result.ok && result.error === 'unsupported_content_type') {
        expect(result.contentType).toBe('text/html; charset=utf-8')
      }
    })
  })

  describe('fetchMarkdownFromUrl: size limit', () => {
    it('Content-Length 事前チェックで size_exceeded (body を読まずに reject)', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(streamResponse('hello', { contentLength: '99999' }))
      const result = await fetchMarkdownFromUrl(TEST_URL, makeOpts({ maxBodyBytes: 100 }))
      expect(result.ok).toBe(false)
      if (!result.ok && result.error === 'size_exceeded') {
        expect(result.reportedBytes).toBe(99_999)
        expect(result.receivedBytes).toBeUndefined()
      }
    })

    it('Content-Length が嘘で実 body 超過なら stream 中に size_exceeded', async () => {
      const large = 'x'.repeat(2048)
      globalThis.fetch = vi.fn().mockResolvedValue(streamResponse(large, { contentLength: '10' }))
      const result = await fetchMarkdownFromUrl(TEST_URL, makeOpts({ maxBodyBytes: 1024 }))
      expect(result.ok).toBe(false)
      if (!result.ok && result.error === 'size_exceeded') {
        expect(result.reportedBytes).toBeUndefined()
        expect(result.receivedBytes).toBeGreaterThan(1024)
      }
    })

    it('Content-Length 不在で実 body 超過なら stream 中に size_exceeded', async () => {
      const large = 'x'.repeat(2048)
      globalThis.fetch = vi.fn().mockResolvedValue(streamResponse(large))
      const result = await fetchMarkdownFromUrl(TEST_URL, makeOpts({ maxBodyBytes: 1024 }))
      expect(result.ok).toBe(false)
      if (!result.ok && result.error === 'size_exceeded') {
        expect(result.receivedBytes).toBeGreaterThan(1024)
      }
    })

    it('Content-Length が不正値 (NaN) は事前チェックを skip して stream に倒す', async () => {
      const body = 'short'
      globalThis.fetch = vi.fn().mockResolvedValue(streamResponse(body, { contentLength: 'abc' }))
      const result = await fetchMarkdownFromUrl(TEST_URL, makeOpts({ maxBodyBytes: 1024 }))
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.text).toBe(body)
      }
    })

    it('Content-Length 負値はヘッダ偽装兆候として size_exceeded で即 reject', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(streamResponse('hello', { contentLength: '-1' }))
      const result = await fetchMarkdownFromUrl(TEST_URL, makeOpts({ maxBodyBytes: 1024 }))
      expect(result.ok).toBe(false)
      if (!result.ok && result.error === 'size_exceeded') {
        expect(result.reportedBytes).toBe(-1)
      }
    })

    it('Content-Length 非整数 (10.5) も RFC 7230 §3.3.2 違反として size_exceeded で reject', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(streamResponse('hello', { contentLength: '10.5' }))
      const result = await fetchMarkdownFromUrl(TEST_URL, makeOpts({ maxBodyBytes: 1024 }))
      expect(result.ok).toBe(false)
      if (!result.ok && result.error === 'size_exceeded') {
        expect(result.reportedBytes).toBe(10.5)
      }
    })
  })

  describe('fetchMarkdownFromUrl: network errors', () => {
    it('timeout → timeout error', async () => {
      globalThis.fetch = vi.fn().mockImplementation(
        async (_input: unknown, init?: RequestInit): Promise<Response> =>
          new Promise<Response>((_resolve, reject) => {
            const { signal } = init ?? {}
            if (signal) {
              signal.addEventListener('abort', () => {
                reject(new DOMException('aborted', 'AbortError'))
              })
            }
          })
      )
      const result = await fetchMarkdownFromUrl(TEST_URL, makeOpts({ timeoutMs: 10 }))
      expect(result).toEqual({ error: 'timeout', ok: false })
    })

    it('fetch reject (CORS / network) → network_error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
      const result = await fetchMarkdownFromUrl(TEST_URL, makeOpts())
      expect(result.ok).toBe(false)
      if (!result.ok && result.error === 'network_error') {
        expect(result.message).toBe('Failed to fetch')
      }
    })

    it('stream 途中で reader が throw → network_error', async () => {
      const failingStream = new ReadableStream<Uint8Array>({
        start(controller: ReadableStreamDefaultController<Uint8Array>): void {
          controller.error(new Error('stream broken'))
        },
      })
      const res = new Response(failingStream, {
        headers: { 'content-type': 'text/plain' },
        status: 200,
      })
      globalThis.fetch = vi.fn().mockResolvedValue(res)
      const result = await fetchMarkdownFromUrl(TEST_URL, makeOpts())
      expect(result.ok).toBe(false)
      if (!result.ok && result.error === 'network_error') {
        expect(result.message).toBe('stream broken')
      }
    })
  })

  // CSP `connect-src` がリダイレクト各 hop を再評価する前提を補強する二重防御
  describe('fetchMarkdownFromUrl: redirect validation', () => {
    it('最終 URL の origin が allowlist 外なら redirected_off_allowlist', async () => {
      const offUrl = 'https://attacker.example.com/x.md'
      const res = streamResponse('# off')
      Object.defineProperty(res, 'url', { value: offUrl })
      globalThis.fetch = vi.fn().mockResolvedValue(res)
      const result = await fetchMarkdownFromUrl(TEST_URL, makeOpts())
      expect(result.ok).toBe(false)
      if (!result.ok && result.error === 'redirected_off_allowlist') {
        expect(result.finalUrl).toBe(offUrl)
      }
    })

    it('最終 URL の origin が allowlist 内 (別 host) なら accept', async () => {
      const finalUrl = 'https://gist.githubusercontent.com/owner/abc/raw/file.md'
      const res = streamResponse('# allowed')
      Object.defineProperty(res, 'url', { value: finalUrl })
      globalThis.fetch = vi.fn().mockResolvedValue(res)
      const result = await fetchMarkdownFromUrl(TEST_URL, makeOpts())
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.finalUrl).toBe(finalUrl)
      }
    })
  })

  // 同じ allowlist を引数に取る境界関数として、fetch 前にも validateOnlineUrl を回し、
  // caller の検証呼び忘れ / 初回 URL だけ allowlist 外に飛ばす攻撃を内部完結で塞ぐ
  describe('fetchMarkdownFromUrl: pre-validation (fetch 前検証)', () => {
    it('allowlist 外 URL は fetch せずに pre_validation_failed (host_not_allowlisted)', async () => {
      const fetchSpy = vi.fn()
      globalThis.fetch = fetchSpy
      const result = await fetchMarkdownFromUrl('https://attacker.example.com/x.md', makeOpts())
      expect(result.ok).toBe(false)
      if (!result.ok && result.error === 'pre_validation_failed') {
        expect(result.reason).toBe('host_not_allowlisted')
        expect(result.url).toBe('https://attacker.example.com/x.md')
      }
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('不正 URL は fetch せずに pre_validation_failed (malformed)', async () => {
      const fetchSpy = vi.fn()
      globalThis.fetch = fetchSpy
      const result = await fetchMarkdownFromUrl('not a url', makeOpts())
      expect(result.ok).toBe(false)
      if (!result.ok && result.error === 'pre_validation_failed') {
        expect(result.reason).toBe('malformed')
      }
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('http:// は fetch せずに pre_validation_failed (scheme_not_https)', async () => {
      const fetchSpy = vi.fn()
      globalThis.fetch = fetchSpy
      const result = await fetchMarkdownFromUrl('http://raw.githubusercontent.com/x', makeOpts())
      expect(result.ok).toBe(false)
      if (!result.ok && result.error === 'pre_validation_failed') {
        expect(result.reason).toBe('scheme_not_https')
      }
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('攻撃シナリオ: 初回 URL が allowlist 外で最終 URL が allowlist 内へリダイレクトされるケースでも fetch せずに reject', async () => {
      const fetchSpy = vi.fn()
      globalThis.fetch = fetchSpy
      const result = await fetchMarkdownFromUrl(
        'https://attacker.example.com/redirect-to-raw',
        makeOpts()
      )
      expect(result.ok).toBe(false)
      if (!result.ok && result.error === 'pre_validation_failed') {
        expect(result.reason).toBe('host_not_allowlisted')
      }
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('allowlist 引数を明示的に空 [] で渡すと allowlist 内 URL も pre_validation_failed', async () => {
      const fetchSpy = vi.fn()
      globalThis.fetch = fetchSpy
      const result = await fetchMarkdownFromUrl(TEST_URL, makeOpts(), [])
      expect(result.ok).toBe(false)
      if (!result.ok && result.error === 'pre_validation_failed') {
        expect(result.reason).toBe('host_not_allowlisted')
      }
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  // res.body が null の Response (一部実装 / null body Response) で stream を踏まない経路の回帰
  describe('fetchMarkdownFromUrl: fallback path (no body stream)', () => {
    // streamResponse と同じく vitest 専用のため module 外移動はせず、
    // import.meta.vitest ガード内に閉じ込めて production bundle から落とす
    // eslint-disable-next-line unicorn/consistent-function-scoping
    const nullBodyResponseWithText = (text: string): Response => {
      const res = new Response(null, {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        status: 200,
      })
      Object.defineProperty(res, 'text', { value: async (): Promise<string> => text })
      return res
    }

    it('マルチバイト含む text の receivedBytes は UTF-8 byteLength (text.length ではない)', async () => {
      const text = 'あ'.repeat(700)
      globalThis.fetch = vi.fn().mockResolvedValue(nullBodyResponseWithText(text))
      const result = await fetchMarkdownFromUrl(TEST_URL, makeOpts({ maxBodyBytes: 1024 }))
      expect(result.ok).toBe(false)
      if (!result.ok && result.error === 'size_exceeded') {
        expect(result.receivedBytes).toBe(2100)
      }
    })

    it('上限内なら text を返す', async () => {
      const text = 'short'
      globalThis.fetch = vi.fn().mockResolvedValue(nullBodyResponseWithText(text))
      const result = await fetchMarkdownFromUrl(TEST_URL, makeOpts({ maxBodyBytes: 1024 }))
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.text).toBe(text)
      }
    })
  })
}
