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
 * allowlist 検証込みで fetch して、成功すれば loadFromMarkdown に渡す。
 * 成功時は Source link を status bar に表示 (§5.f Referer leak 防止 3 属性付き)、
 * `#empty-state-default` を `has-embedded-md` class 追加で隠す (online edition は CLI rewrite を
 * 経由しないため `<meta name="mdxg-redline:embedded-md">` がなく、boot 時に class が立たない)。
 * 失敗時は §5.d カテゴリ別メッセージを inline error UI に表示 + 「別 URL を試す」ボタン (Step 5)。
 */
const tryFetchAndLoad = async (url: string, runtime: BootRuntime): Promise<boolean> => {
  const allowlist = readOnlineAllowlistFromDom()
  const result = await fetchMarkdownFromUrl(url, DEFAULT_FETCH_OPTS, allowlist)
  if (!result.ok) {
    showOnlineError(formatFetchFailureMessage(result))
    return false
  }
  document.documentElement.classList.add('has-embedded-md')
  showOnlineSource(result.finalUrl)
  await runtime.loadFromMarkdown(deriveDocNameFromUrl(url), result.text)
  return true
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
 * 起動時のロード優先順位を順に試す（詳細は DESIGN.md §9 / docs/feature-online-edition.md §3.4）。
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
}
