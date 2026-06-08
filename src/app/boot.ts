// --- Boot: workspace > online URL > embedded -------------------------------

import { DEFAULT_FETCH_OPTS, type FetchResult, fetchMarkdownFromUrl } from '../core/online-url'
import {
  type ImportedComment,
  embeddedCommentsFromUnknown,
  resolveImportedComments,
} from '../core/feedback'
import { markFeedbackWritten, replaceComments, state } from './state/app-state'
import { findPageIndexBySourceLine } from '../core/page-split'
import { reapplyAllMarks } from './comments/mark-engine'
import { renderComments } from './comments/comments'
import { showOnlineError } from './online/error-display'
import { showOnlineSource } from './online/source-display'
import { resolveOnlineAllowlistFromJson } from '../core/online-allowlist-config'
import { normalizeGithubViewUrl } from '../core/online-url-normalize'
import { restoreWorkspaceHandle } from './workspace/workspace'

interface BootRuntime {
  loadFromMarkdown: (name: string, text: string) => Promise<void>
}

/** 任意要素の textContent を trim して返す。null/未存在の場合は空文字（embedded フォールバックを連鎖させやすくする） */
export const elementText = (el: { textContent?: string | null } | null): string => {
  if (el && el.textContent) {
    return el.textContent.trim()
  }
  return ''
}

/**
 * import 段階の ImportedComment[] を resolveImportedComments で Comment[] に格上げし、
 * state にセットして再描画する。sourceLine が markdown 全体の範囲外なコメントは
 * resolveImportedComments 内で破棄される (§6.6 / §9.1)。
 */
const applyEmbeddedComments = (imported: readonly ImportedComment[]): void => {
  replaceComments(
    resolveImportedComments(imported, (sourceLine): number | null =>
      findPageIndexBySourceLine(state.pages, sourceLine)
    )
  )
  markFeedbackWritten()
  reapplyAllMarks()
  renderComments()
}

/**
 * 埋め込み HTML 内に同梱された feedback JSON があれば取り込む。
 * 単独ファイル配布で「ドキュメントとコメントを同梱して配る」ユースケース向けで、不正なら静かに無視する。
 */
const restoreEmbeddedFeedback = (feedbackText: string): void => {
  if (!feedbackText) {
    return
  }
  try {
    const comments = embeddedCommentsFromUnknown(JSON.parse(feedbackText))
    if (comments.length > 0) {
      applyEmbeddedComments(comments)
    }
  } catch {
    // embedded feedback is optional
  }
}

/**
 * `<script id="embedded-md">` の textContent から元の markdown を復元する。
 * CLI 側が `encodeEmbeddedMarkdown` で JSON 文字列として書き込んでいる前提で、
 * `JSON.parse` で生 markdown に戻す。docHash が CLI 側と一致するよう trim はしない。
 * 未挿入のプレースホルダ（空または空白のみ）は null。
 */
export const prepareEmbeddedMarkdown = (raw: string): string | null => {
  if (raw.trim().length === 0) {
    return null
  }
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'string') {
    throw new TypeError('embedded-md must be a JSON string')
  }
  return parsed
}

/** `<script id="embedded-md">` のような埋め込み MD を起動時に読み込む。存在しなければ false */
const loadEmbeddedMarkdown = async (runtime: BootRuntime): Promise<boolean> => {
  const embedded = document.getElementById('embedded-md')
  if (!(embedded instanceof HTMLElement)) {
    return false
  }
  const embeddedText = prepareEmbeddedMarkdown(embedded.textContent ?? '')
  if (embeddedText === null) {
    return false
  }
  const name = embedded.dataset.name || 'document.md'
  await runtime.loadFromMarkdown(name, embeddedText)
  restoreEmbeddedFeedback(elementText(document.getElementById('embedded-feedback')))
  return true
}

/** `<html data-mdxg-online="1">` 属性で online 配布物を判定する (§3.1 gating marker) */
export const isOnlineEdition = (): boolean => {
  if (typeof document === 'undefined' || !document.documentElement) {
    return false
  }
  return document.documentElement.dataset.mdxgOnline === '1'
}

/** http(s) 配信時のみ fetch 経路を発火させる (§3.4 順序の根拠 / §5.e file:// 起動方針) */
const isHttpProtocol = (protocol: string): boolean => protocol === 'http:' || protocol === 'https:'

/** url pathname の末端から markdown ファイル名を推定 (空 / parse 失敗 → fallback) */
export const deriveDocNameFromUrl = (url: string): string => {
  try {
    const parsed = new URL(url)
    const segments = parsed.pathname.split('/').filter((segment): boolean => segment !== '')
    const last = segments.at(-1)
    if (typeof last === 'string' && last !== '') {
      return last
    }
  } catch {
    /* fallthrough to default */
  }
  return 'document.md'
}

type FetchFailure = Exclude<FetchResult, { ok: true }>

/** §5.d エラーカテゴリのメッセージ。Step 5 で error modal に richen 化する想定の暫定 toast 用 */
export const formatFetchFailureMessage = (failure: FetchFailure): string => {
  switch (failure.error) {
    case 'http_error': {
      return `URL が見つかりません (HTTP ${failure.status})`
    }
    case 'network_error': {
      return `ネットワークエラー: ${failure.message}`
    }
    case 'pre_validation_failed': {
      return `URL が対応リストに含まれていません (${failure.reason}): ${failure.url}`
    }
    case 'redirected_off_allowlist': {
      return `リダイレクト先が対応 URL リスト外でした: ${failure.finalUrl}`
    }
    case 'size_exceeded': {
      return '対応サイズを超えています'
    }
    case 'timeout': {
      return 'fetch がタイムアウトしました'
    }
    case 'unsupported_content_type': {
      return `対応形式ではありません (${failure.contentType})`
    }
    default: {
      // exhaustiveness check: FetchFailure に新 variant が追加されたら `satisfies never` が
      // 型エラーで気付かせる。runtime fallback は throw せず graceful な文字列に倒し、
      // toast / Step 5 modal に表示できる経路を維持する (white screen 回避)。
      failure satisfies never
      return '不明なエラーが発生しました'
    }
  }
}

/** DOM の `<script id="online-allowlist">` から allowlist を取り出し、壊れていれば DEFAULT */
const readOnlineAllowlistFromDom = (): readonly string[] => {
  const el = document.getElementById('online-allowlist')
  return resolveOnlineAllowlistFromJson(elementText(el))
}

/** `?url=` クエリを読み出し、空 / 未指定なら null を返す */
const readUrlQuery = (): string | null => {
  const url = new URLSearchParams(globalThis.location.search).get('url')
  if (url === null || url === '') {
    return null
  }
  return url
}

/**
 * fetch 中の Loading 表示を出すまでの遅延 (ms)。 高速回線 / キャッシュヒットで 150ms 未満に
 * fetch が終わるケースでは spinner を一切表示せず flicker を防ぐ。 既存の embedded-md
 * 経路で使っている `.has-embedded-md .doc-pane::before/::after` spinner をそのまま流用し、
 * 「fetch → rendering」が継ぎ目なく繋がる UX にする (§5.d / DESIGN.md §3.4)。
 */
const ONLINE_FETCH_LOADING_DELAY_MS = 150

type FetchSuccess = Extract<FetchResult, { ok: true }>

const scheduleFetchLoadingSpinner = (): ReturnType<typeof setTimeout> =>
  globalThis.setTimeout((): void => {
    document.documentElement.classList.add('has-embedded-md')
  }, ONLINE_FETCH_LOADING_DELAY_MS)

/** fetch 失敗時: spinner class を剥がしてから empty-state-online-error を露出させる */
const handleFetchFailure = (failure: FetchFailure): false => {
  document.documentElement.classList.remove('has-embedded-md')
  showOnlineError(formatFetchFailureMessage(failure))
  return false
}

/**
 * fetch 成功時: spinner class はそのまま維持して rendering 経路に繋ぐ。 docName は redirect 後の
 * finalUrl から derive する。 gist メインページ URL (gist.github.com/<user>/<id>) は normalize
 * で末尾 `/raw` が補完されるため、 normalizedUrl ベースだと docName が "raw" になり export
 * ファイル名が `raw-<hash>-feedback.json` 等に退化する。 raw 配信側は
 * `<commit_sha>/<filename>` 形式に redirect するため finalUrl 末尾を取れば実ファイル名が拾える
 * (test 環境では Response.url 空 → requestedUrl=normalizedUrl に fallback、
 * §online-url.ts readBodyWithLimit)。
 */
const handleFetchSuccess = async (result: FetchSuccess, runtime: BootRuntime): Promise<true> => {
  // 冒頭の classList.add は idempotent な保険。 fetch が 150ms 未満で完了した場合は spinner timer
  // が一度も fire していないため、 ここで初めて class が立つ。 150ms 超で完了した場合は既に立って
  // いるので no-op。 caller 側 (tryFetchAndLoad) で `clearTimeout` 後に走ることが保証されるため、
  // タイマー callback と race して二重 add される懸念はない。
  document.documentElement.classList.add('has-embedded-md')
  showOnlineSource(result.finalUrl)
  await runtime.loadFromMarkdown(deriveDocNameFromUrl(result.finalUrl), result.text)
  return true
}

/**
 * `fetchMarkdownFromUrl` の想定外 throw (jsdom / 環境固有 / import エラー等) を `network_error`
 * の graceful な `FetchResult` に正規化する。 通常経路では網羅的 try/catch 済みで throw しない
 * 不変だが、 二重保険として置く。 fetch だけを catch 対象にし、 描画系 (`loadFromMarkdown`) の
 * 例外は意図的に伝播させて boot.catch の `Startup failed` 経路で扱う (誤分類防止)。
 */
const fetchOrFallbackFailure = async (
  normalizedUrl: string,
  allowlist: readonly string[]
): Promise<FetchResult> => {
  try {
    return await fetchMarkdownFromUrl(normalizedUrl, DEFAULT_FETCH_OPTS, allowlist)
  } catch (error) {
    return { error: 'network_error', message: String(error), ok: false }
  }
}

/**
 * fetch を `scheduleFetchLoadingSpinner` の timer 監視下で実行し、 fetch 完了 (graceful な
 * `FetchResult` で必ず終了) を待ってから `finally` で必ず `clearTimeout` する。 描画段階を
 * 含めずに timer 管理 scope を切ることで、 後続の `loadFromMarkdown` 例外が catch されず
 * 正常に上位 (boot.catch) に伝播する経路を確保する。
 */
const fetchWithSpinnerCleanup = async (
  normalizedUrl: string,
  allowlist: readonly string[]
): Promise<FetchResult> => {
  const loadingTimer = scheduleFetchLoadingSpinner()
  try {
    return await fetchOrFallbackFailure(normalizedUrl, allowlist)
  } finally {
    globalThis.clearTimeout(loadingTimer)
  }
}

/**
 * allowlist 検証込みで fetch して、成功すれば loadFromMarkdown に渡す。
 * 成功時は Source link を status bar に表示 (§5.f Referer leak 防止 3 属性付き)、
 * `#empty-state-default` を `has-embedded-md` class 追加で隠す (online edition は CLI rewrite を
 * 経由しないため `<meta name="mdxg-redline:embedded-md">` がなく、boot 時に class が立たない)。
 * 失敗時は §5.d カテゴリ別メッセージを inline error UI に表示 + 「別 URL を試す」ボタン (Step 5)。
 *
 * fetch が `ONLINE_FETCH_LOADING_DELAY_MS` を超えた時点で `has-embedded-md` を前倒し付与し、
 * 既存の spinner pattern を Loading 表示として再利用する。 fetch 失敗時は class を剥がして
 * empty-state-online-error を露出させる経路に戻す (class が残ると `#doc-wrap { display: none }`
 * で error UI まで隠れる)。
 *
 * 描画 (handleFetchSuccess 内の `runtime.loadFromMarkdown`) の例外は **意図的に** 上位に
 * 伝播させる。 spinner timer 管理は `fetchWithSpinnerCleanup` の finally で fetch 完了時点に
 * 限定して閉じることで、 描画段階の throw が `network_error` に誤分類される設計事故 (Shiki
 * 注入失敗 / docHash 計算エラー等が「URL fetch 失敗」UI で表示されてしまう) を構造的に防ぐ。
 * 結果として描画 throw は app-wiring の boot.catch (`Startup failed` toast + `has-embedded-md`
 * 剥がし) に倒れる。
 */
const tryFetchAndLoad = async (url: string, runtime: BootRuntime): Promise<boolean> => {
  const allowlist = readOnlineAllowlistFromDom()
  // 人間が普段ブラウザで開く github.com/blob / gist.github.com の URL を allowlist 内 origin
  // (raw / gist raw) に書き換えてから fetchMarkdownFromUrl に渡す。?url= クエリと
  // Open URL modal の入力は元 URL のまま保持する (URL バーは入力 URL のまま、§3.4 入力 UX)。
  const normalizedUrl = normalizeGithubViewUrl(url)
  const result = await fetchWithSpinnerCleanup(normalizedUrl, allowlist)
  if (!result.ok) {
    return handleFetchFailure(result)
  }
  return handleFetchSuccess(result, runtime)
}

/**
 * §3.4 ステップ 2: online edition で `?url=` クエリがあれば fetch して loadFromMarkdown に流す。
 * - `?url=` 未指定 → false で既存経路 (embedded-md) にフォールスルー
 * - location.protocol が http(s) でない → showOnlineError + フォールスルー (file:// 起動方針 §5.e)
 * - fetch 失敗 → §5.d カテゴリ別 showOnlineError + フォールスルー
 * 戻り値 true は loadFromMarkdown 成功 (embedded-md 経路を skip)
 */
export const loadFromOnlineUrlQuery = async (runtime: BootRuntime): Promise<boolean> => {
  const url = readUrlQuery()
  if (url === null) {
    return false
  }
  if (!isHttpProtocol(globalThis.location.protocol)) {
    showOnlineError('online edition は http(s) でホスティングされた環境でのみ機能します')
    return false
  }
  return tryFetchAndLoad(url, runtime)
}

/**
 * 起動時のロード優先順位を順に試す（詳細は DESIGN.md §9 / docs/archive/feature-online-edition.archive.md §3.4）。
 * 0. 保存済みの出力先フォルダ handle を IDB からサイレント復元（書き出し時の picker 省略用）
 * 1. オンライン版 (`data-mdxg-online`) で `?url=` があれば fetch (allowlist 検証は wrapper 内で完結)
 * 2. 埋め込み MD（review-request CLI 配布 / 同梱配布のケース）
 *
 * online edition では online 経路の結果に関わらず必ず return し、embedded-md フォールスルーを
 * させない。さもないと将来 build pipeline の事故で online.html に placeholder embedded-md が
 * 注入された場合、hostile `?url=` の fetch 失敗で「toast + 無関係 doc 描画」になる経路が開く。
 */
export const boot = async (runtime: BootRuntime): Promise<void> => {
  await restoreWorkspaceHandle()
  if (isOnlineEdition()) {
    await loadFromOnlineUrlQuery(runtime)
    return
  }
  if (await loadEmbeddedMarkdown(runtime)) {
    return
  }
}

if (import.meta.vitest) {
  const { afterEach, beforeEach, describe, expect, it, vi } = import.meta.vitest

  describe('elementText', () => {
    it('null を渡すと空文字を返す', () => {
      expect(elementText(null)).toBe('')
    })

    it('textContent を trim して返す', () => {
      expect(elementText({ textContent: '  hello\n' })).toBe('hello')
    })

    it('textContent が空ならフォールバックで空文字', () => {
      expect(elementText({ textContent: '' })).toBe('')
    })
  })

  describe('prepareEmbeddedMarkdown', () => {
    it('JSON 文字列を decode して元 markdown を返す', () => {
      expect(prepareEmbeddedMarkdown(JSON.stringify('# title\n'))).toBe('# title\n')
    })

    it('CLI の < 置換を含む形でも JSON.parse 経由で </script> リテラルが復元される', () => {
      const encoded = JSON.stringify('a </script> b').replace(/</g, String.raw`<`)
      expect(prepareEmbeddedMarkdown(encoded)).toBe('a </script> b')
    })

    it('空白だけの textContent は null を返す', () => {
      expect(prepareEmbeddedMarkdown('   \n\n  ')).toBeNull()
    })

    it('空文字は null を返す', () => {
      expect(prepareEmbeddedMarkdown('')).toBeNull()
    })

    it('JSON が文字列以外なら TypeError', () => {
      expect(() => prepareEmbeddedMarkdown('123')).toThrow(TypeError)
    })
  })

  describe('isOnlineEdition', () => {
    afterEach(() => {
      delete document.documentElement.dataset.mdxgOnline
    })

    it('data-mdxg-online="1" のとき true', () => {
      document.documentElement.dataset.mdxgOnline = '1'
      expect(isOnlineEdition()).toBe(true)
    })

    it('属性なしのとき false', () => {
      delete document.documentElement.dataset.mdxgOnline
      expect(isOnlineEdition()).toBe(false)
    })

    it('"1" 以外の値 ("0" / 空文字) では false', () => {
      document.documentElement.dataset.mdxgOnline = '0'
      expect(isOnlineEdition()).toBe(false)
      document.documentElement.dataset.mdxgOnline = ''
      expect(isOnlineEdition()).toBe(false)
    })
  })

  describe('deriveDocNameFromUrl', () => {
    it('pathname 末端のセグメントを返す', () => {
      expect(deriveDocNameFromUrl('https://raw.example.com/owner/repo/main/README.md')).toBe(
        'README.md'
      )
    })

    it('trailing slash 付きは直前のセグメント', () => {
      expect(deriveDocNameFromUrl('https://example.com/path/')).toBe('path')
    })

    it('pathname なし (origin のみ) は fallback', () => {
      expect(deriveDocNameFromUrl('https://example.com')).toBe('document.md')
    })

    it('連続 slash も filter で skip して末端を返す', () => {
      expect(deriveDocNameFromUrl('https://example.com//a///b//')).toBe('b')
    })

    it('parse 不能な URL は fallback', () => {
      expect(deriveDocNameFromUrl('not a url')).toBe('document.md')
    })
  })

  describe('formatFetchFailureMessage', () => {
    it('http_error: HTTP status を含む', () => {
      const msg = formatFetchFailureMessage({ error: 'http_error', ok: false, status: 404 })
      expect(msg).toContain('404')
    })

    it('timeout: タイムアウトを示す', () => {
      const msg = formatFetchFailureMessage({ error: 'timeout', ok: false })
      expect(msg).toContain('タイムアウト')
    })

    it('network_error: message を含む', () => {
      const msg = formatFetchFailureMessage({
        error: 'network_error',
        message: 'Failed to fetch',
        ok: false,
      })
      expect(msg).toContain('Failed to fetch')
    })

    it('pre_validation_failed: reason + url を含む', () => {
      const msg = formatFetchFailureMessage({
        error: 'pre_validation_failed',
        ok: false,
        reason: 'host_not_allowlisted',
        url: 'https://evil.example',
      })
      expect(msg).toContain('https://evil.example')
      expect(msg).toContain('host_not_allowlisted')
    })

    it('redirected_off_allowlist: finalUrl を含む', () => {
      const msg = formatFetchFailureMessage({
        error: 'redirected_off_allowlist',
        finalUrl: 'https://attacker.example/x',
        ok: false,
      })
      expect(msg).toContain('https://attacker.example/x')
    })

    it('size_exceeded: サイズ超過を示す', () => {
      const msg = formatFetchFailureMessage({ error: 'size_exceeded', ok: false })
      expect(msg).toContain('サイズ')
    })

    it('unsupported_content_type: contentType を含む', () => {
      const msg = formatFetchFailureMessage({
        contentType: 'application/json',
        error: 'unsupported_content_type',
        ok: false,
      })
      expect(msg).toContain('application/json')
    })
  })

  // describe を 2 つに分けているのは max-statements (10) を満たすため。テスト粒度は同じ。
  describe('loadFromOnlineUrlQuery: fallthrough / protocol / pre-validation', () => {
    const ALLOWLIST_JSON = '["https://raw.githubusercontent.com"]'
    const originalFetch = globalThis.fetch

    beforeEach(() => {
      const allowlistScript = document.createElement('script')
      allowlistScript.id = 'online-allowlist'
      allowlistScript.type = 'application/json'
      allowlistScript.textContent = ALLOWLIST_JSON
      document.head.append(allowlistScript)
      const toastDiv = document.createElement('div')
      toastDiv.id = 'toast'
      document.body.append(toastDiv)
    })

    afterEach(() => {
      const allowlistEl = document.getElementById('online-allowlist')
      if (allowlistEl !== null) {
        allowlistEl.remove()
      }
      const toastEl = document.getElementById('toast')
      if (toastEl !== null) {
        toastEl.remove()
      }
      globalThis.fetch = originalFetch
      vi.unstubAllGlobals()
    })

    const makeRuntime = (): {
      runtime: BootRuntime
      spy: ReturnType<typeof vi.fn>
    } => {
      const spy = vi.fn(async (): Promise<void> => {
        /* noop test stub */
      })
      return { runtime: { loadFromMarkdown: spy }, spy }
    }

    it('?url= 未指定で false を返し、loadFromMarkdown は呼ばれない (fallthrough)', async () => {
      vi.stubGlobal('location', { protocol: 'http:', search: '' })
      const { runtime, spy } = makeRuntime()
      expect(await loadFromOnlineUrlQuery(runtime)).toBe(false)
      expect(spy).not.toHaveBeenCalled()
    })

    it('file:// + ?url= 指定で false を返し、fetch は発火しない (§5.e)', async () => {
      vi.stubGlobal('location', {
        protocol: 'file:',
        search: '?url=https://raw.githubusercontent.com/x',
      })
      const fetchSpy = vi.fn()
      globalThis.fetch = fetchSpy
      const { runtime, spy } = makeRuntime()
      expect(await loadFromOnlineUrlQuery(runtime)).toBe(false)
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(spy).not.toHaveBeenCalled()
    })

    it('http(s) + allowlist 外 URL は fetch せずに false (pre_validation_failed)', async () => {
      vi.stubGlobal('location', { protocol: 'https:', search: '?url=https://attacker.example/x' })
      const fetchSpy = vi.fn()
      globalThis.fetch = fetchSpy
      const { runtime, spy } = makeRuntime()
      expect(await loadFromOnlineUrlQuery(runtime)).toBe(false)
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(spy).not.toHaveBeenCalled()
    })
  })

  describe('loadFromOnlineUrlQuery: 成功 / fetch 失敗', () => {
    const ALLOWLIST_JSON =
      '["https://raw.githubusercontent.com","https://gist.githubusercontent.com"]'
    const originalFetch = globalThis.fetch

    beforeEach(() => {
      const allowlistScript = document.createElement('script')
      allowlistScript.id = 'online-allowlist'
      allowlistScript.type = 'application/json'
      allowlistScript.textContent = ALLOWLIST_JSON
      document.head.append(allowlistScript)
      const toastDiv = document.createElement('div')
      toastDiv.id = 'toast'
      document.body.append(toastDiv)
    })

    afterEach(() => {
      const allowlistEl = document.getElementById('online-allowlist')
      if (allowlistEl !== null) {
        allowlistEl.remove()
      }
      const toastEl = document.getElementById('toast')
      if (toastEl !== null) {
        toastEl.remove()
      }
      globalThis.fetch = originalFetch
      vi.unstubAllGlobals()
    })

    it('http(s) + 有効 ?url= で loadFromMarkdown(deriveDocNameFromUrl(url), text) が呼ばれて true', async () => {
      vi.stubGlobal('location', {
        protocol: 'https:',
        search: '?url=https://raw.githubusercontent.com/owner/repo/main/README.md',
      })
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('# hello', {
          headers: { 'content-type': 'text/plain' },
          status: 200,
        })
      )
      const spy = vi.fn(async (): Promise<void> => {
        /* noop test stub */
      })
      expect(await loadFromOnlineUrlQuery({ loadFromMarkdown: spy })).toBe(true)
      expect(spy).toHaveBeenCalledWith('README.md', '# hello')
    })

    it('gist メインページ URL は redirect 後の finalUrl 末尾から docName を拾う', async () => {
      vi.stubGlobal('location', {
        protocol: 'https:',
        search: '?url=https://gist.github.com/user/abc123',
      })
      const finalUrl =
        'https://gist.githubusercontent.com/user/abc123/raw/abcdef1234567890/hello.md'
      const res = new Response('# hello', {
        headers: { 'content-type': 'text/plain' },
        status: 200,
      })
      Object.defineProperty(res, 'url', { value: finalUrl })
      globalThis.fetch = vi.fn().mockResolvedValue(res)
      const spy = vi.fn(async (): Promise<void> => {
        /* noop test stub */
      })
      expect(await loadFromOnlineUrlQuery({ loadFromMarkdown: spy })).toBe(true)
      expect(spy).toHaveBeenCalledWith('hello.md', '# hello')
    })

    it('fetch が 404 を返すと false + loadFromMarkdown 呼ばれない', async () => {
      vi.stubGlobal('location', {
        protocol: 'https:',
        search: '?url=https://raw.githubusercontent.com/x',
      })
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('', { status: 404 }))
      const spy = vi.fn(async (): Promise<void> => {
        /* noop test stub */
      })
      expect(await loadFromOnlineUrlQuery({ loadFromMarkdown: spy })).toBe(false)
      expect(spy).not.toHaveBeenCalled()
    })
  })

  // `unicorn/consistent-function-scoping` の disable は appendScript / appendEmptyStateError /
  // appendLoadingTestDom / delayedResponse の 4 helper に共通。 これらは outer scope の `vi` /
  // `expect` を closure capture しない DOM / 標準 API 経由だが、 `import.meta.vitest` ガード内に
  // 閉じ込めて production bundle から落とすため module 外には出さない方針を優先する
  // (`src/app/online/error-display.ts:72-74` と同じ reasoning)。
  // eslint-disable-next-line unicorn/consistent-function-scoping
  const appendScript = (id: string, type: string, content: string): void => {
    const el = document.createElement('script')
    el.id = id
    el.type = type
    el.textContent = content
    document.head.append(el)
  }
  // eslint-disable-next-line unicorn/consistent-function-scoping
  const appendEmptyStateError = (): void => {
    const errorEl = document.createElement('div')
    errorEl.id = 'empty-state-online-error'
    errorEl.hidden = true
    const errorMsg = document.createElement('div')
    errorMsg.id = 'online-error-message'
    errorEl.append(errorMsg)
    document.body.append(errorEl)
  }
  // eslint-disable-next-line unicorn/consistent-function-scoping
  const appendLoadingTestDom = (): void => {
    const toastDiv = document.createElement('div')
    toastDiv.id = 'toast'
    document.body.append(toastDiv)
    const defaultEl = document.createElement('div')
    defaultEl.id = 'empty-state-default'
    document.body.append(defaultEl)
  }
  const ALLOWLIST_JSON =
    '["https://raw.githubusercontent.com","https://gist.githubusercontent.com"]'
  const stubOnlineUrl = (): void => {
    vi.stubGlobal('location', {
      protocol: 'https:',
      search: '?url=https://raw.githubusercontent.com/x/README.md',
    })
  }
  const noopRuntime = (): BootRuntime => ({
    loadFromMarkdown: vi.fn(async (): Promise<void> => {
      /* noop */
    }),
  })
  // eslint-disable-next-line unicorn/consistent-function-scoping
  const delayedResponse = async (status: number, delayMs: number, body = ''): Promise<Response> =>
    new Promise((resolve): void => {
      globalThis.setTimeout((): void => {
        resolve(new Response(body, { status }))
      }, delayMs)
    })
  const expectErrorVisible = (): void => {
    const errorEl = document.getElementById('empty-state-online-error')
    expect(errorEl instanceof HTMLElement && errorEl.hidden).toBe(false)
  }
  const expectErrorHidden = (): void => {
    const errorEl = document.getElementById('empty-state-online-error')
    expect(errorEl instanceof HTMLElement && errorEl.hidden).toBe(true)
  }
  const throwingRuntime = (error: Error): BootRuntime => ({
    loadFromMarkdown: vi.fn(async (): Promise<void> => {
      throw error
    }),
  })

  describe('loadFromOnlineUrlQuery: Loading spinner (has-embedded-md) の遅延付与', () => {
    const originalFetch = globalThis.fetch

    beforeEach(() => {
      appendScript('online-allowlist', 'application/json', ALLOWLIST_JSON)
      appendLoadingTestDom()
      appendEmptyStateError()
      document.documentElement.dataset.mdxgOnline = '1'
      document.documentElement.classList.remove('has-embedded-md')
    })

    afterEach(() => {
      for (const id of [
        'online-allowlist',
        'toast',
        'empty-state-online-error',
        'empty-state-default',
      ]) {
        const el = document.getElementById(id)
        if (el !== null) {
          el.remove()
        }
      }
      globalThis.fetch = originalFetch
      document.documentElement.classList.remove('has-embedded-md')
      delete document.documentElement.dataset.mdxgOnline
      vi.useRealTimers()
      vi.unstubAllGlobals()
    })

    it('fetch が 150ms 未満で成功する場合は spinner timer が fire する前に clear される (flicker 回避)', async () => {
      vi.useFakeTimers()
      stubOnlineUrl()
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('# fast', {
          headers: { 'content-type': 'text/plain' },
          status: 200,
        })
      )
      const promise = loadFromOnlineUrlQuery(noopRuntime())
      // fetch は mockResolvedValue で同期解決するが、 fetchMarkdownFromUrl の `await fetch(...)` や
      // body read の micro-task chain を flush するため fake timer を 50ms 進める (50ms 自体に
      // 意味はなく、 spinner timer の閾値 150ms 未満であれば何でもよい)。
      await vi.advanceTimersByTimeAsync(50)
      expect(await promise).toBe(true)
      // 成功経路の handleFetchSuccess で改めて has-embedded-md が付与される (rendering spinner として継続)
      expect(document.documentElement.classList.contains('has-embedded-md')).toBe(true)
    })

    it('fetch 失敗時は spinner timer が fire していても has-embedded-md が剥がされる (error UI 露出)', async () => {
      vi.useFakeTimers()
      stubOnlineUrl()
      // delayedResponse(404, 200) は 200ms 後に status=404 で resolve するため fetchMarkdownFromUrl
      // 内では `http_error` の failure 戻り値になり、 throw 経路ではなく `!result.ok` 経路を通る。
      globalThis.fetch = vi
        .fn()
        .mockImplementation(async (): Promise<Response> => delayedResponse(404, 200))
      const promise = loadFromOnlineUrlQuery(noopRuntime())
      await vi.advanceTimersByTimeAsync(150)
      expect(document.documentElement.classList.contains('has-embedded-md')).toBe(true)
      await vi.advanceTimersByTimeAsync(50)
      expect(await promise).toBe(false)
      expect(document.documentElement.classList.contains('has-embedded-md')).toBe(false)
      expectErrorVisible()
    })

    it('fetch が想定外に throw した場合も finally で timer が clear され has-embedded-md がリークしない', async () => {
      vi.useFakeTimers()
      stubOnlineUrl()
      // `fetchMarkdownFromUrl` 内部は通常 graceful な FetchResult を返すが、 二重保険として
      // `globalThis.fetch` 自身が同期 throw する想定外ケースを再現。 fetchOrFallbackFailure の
      // catch で `network_error` に正規化され、 finally で clearTimeout される。
      globalThis.fetch = vi.fn().mockImplementation((): never => {
        throw new Error('synthetic boom')
      })
      const promise = loadFromOnlineUrlQuery(noopRuntime())
      // throw は同期だが await 解決の micro-task を flush
      await vi.advanceTimersByTimeAsync(0)
      expect(await promise).toBe(false)
      // 150ms 以上進めても spinner timer が立ち上がってこないこと (clearTimeout 済み)
      await vi.advanceTimersByTimeAsync(200)
      expect(document.documentElement.classList.contains('has-embedded-md')).toBe(false)
      expectErrorVisible()
    })

    it('fetch 成功後の loadFromMarkdown reject は catch せず上位 (boot.catch) に伝播する', async () => {
      vi.useFakeTimers()
      stubOnlineUrl()
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('# hello', {
          headers: { 'content-type': 'text/plain' },
          status: 200,
        })
      )
      // 描画段階の例外 (Shiki 注入失敗 / docHash 計算エラー等を想定) は意図的に伝播させる経路で、
      // fetch エラーと混同して empty-state-online-error に倒さないこと、 spinner timer は fetch
      // 完了時点で clear 済みでリークしないことを確認する。 advanceTimersByTimeAsync より先に
      // rejection handler を attach しないと Node が unhandled rejection として警告するため、
      // promise 作成直後に no-op catch を仕込んでから assertion 用に再度 await する。
      const promise = loadFromOnlineUrlQuery(throwingRuntime(new Error('render boom')))
      promise.catch((): void => {
        /* swallow to suppress unhandled rejection; assertion uses expect(promise).rejects below */
      })
      await vi.advanceTimersByTimeAsync(50)
      await expect(promise).rejects.toThrow('render boom')
      // fetch エラー UI には倒れていないこと (empty-state-online-error は hidden のまま)
      expectErrorHidden()
      // 描画 throw 後は handleFetchSuccess の classList.add で has-embedded-md が立った状態で残るが、
      // これは app-wiring の boot.catch (`Startup failed` toast + `classList.remove('has-embedded-md')`)
      // で responsibly に剥がされる責務分離。 boot.ts 単体では timer リークしていないことだけ確認する
      // (timer は fetch 完了時に clear 済みのため、 ここから 200ms 進めても新規 add は起きない)。
      await vi.advanceTimersByTimeAsync(200)
      expect(document.documentElement.classList.contains('has-embedded-md')).toBe(true)
    })
  })
}
