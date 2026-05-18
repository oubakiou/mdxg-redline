// --- Boot: workspace > embedded > url hash > restored session ---------------

import { embeddedCommentsFromUnknown } from './feedback'
import { tryRestoreWorkspace } from './workspace'

interface Comment {
  id: string
  quote: string
  comment: string
  blockId: string
  startOffset: number
  endOffset: number
  created: string
}

interface BootRuntime {
  loadFromMarkdown: (name: string, text: string) => Promise<void>
  reapplyAllMarks: () => void
  renderSidebar: () => void
  save: () => Promise<void>
  store: {
    get: (key: string) => Promise<unknown>
    listKeys: (prefix: string) => Promise<string[]>
  }
  state: {
    comments: Comment[]
    markdown: string
  }
  toast: (msg: string) => void
}

/** 永続化された 1 ドキュメント分のスナップショット。Store.get の戻り値を narrow した型 */
interface StoredDocument {
  comments?: Comment[]
  markdown?: string
  name?: string | null
  updated?: string
}

/** 任意要素の textContent を trim して返す。null/未存在の場合は空文字（embedded フォールバックを連鎖させやすくする） */
export const elementText = (el: { textContent?: string | null } | null): string => {
  if (el && el.textContent) {
    return el.textContent.trim()
  }
  return ''
}

/** Store/JSON.parse 由来の unknown を StoredDocument として扱う最低限ガード */
const isStoredDocument = (value: unknown): value is StoredDocument =>
  value !== null && typeof value === 'object'

/** 取り込んだコメント配列を state に流し込み、保存・再描画まで実施する */
const applyEmbeddedComments = async (runtime: BootRuntime, comments: Comment[]): Promise<void> => {
  runtime.state.comments = comments
  await runtime.save()
  runtime.reapplyAllMarks()
  runtime.renderSidebar()
}

/**
 * 埋め込み HTML 内に同梱された feedback JSON があれば取り込む。
 * 単独ファイル配布で「ドキュメントとコメントを同梱して配る」ユースケース向けで、不正なら静かに無視する。
 */
const restoreEmbeddedFeedback = async (
  runtime: BootRuntime,
  feedbackText: string
): Promise<void> => {
  if (!feedbackText) {
    return
  }
  try {
    const comments = embeddedCommentsFromUnknown(JSON.parse(feedbackText))
    if (comments.length > 0) {
      await applyEmbeddedComments(runtime, comments)
    }
  } catch {
    // embedded feedback is optional
  }
}

/** `<script id="embedded-md">` のような埋め込み MD を起動時に読み込む。存在しなければ false を返して次のフォールバックに譲る */
const loadEmbeddedMarkdown = async (runtime: BootRuntime): Promise<boolean> => {
  const embedded = document.getElementById('embedded-md')
  const embeddedText = elementText(embedded)
  if (!embeddedText || !(embedded instanceof HTMLElement)) {
    return false
  }
  const name = embedded.dataset.name || 'document.md'
  await runtime.loadFromMarkdown(name, embeddedText)
  await restoreEmbeddedFeedback(runtime, elementText(document.getElementById('embedded-feedback')))
  return true
}

/** location.hash を URLSearchParams にパース。"#" 単独なら null として早期に分岐 */
const hashParams = (): URLSearchParams | null => {
  if (location.hash.length <= 1) {
    return null
  }
  return new URLSearchParams(location.hash.slice(1))
}

const normalizeBase64Param = (encoded: string): string => {
  const restoredStandardChars = encoded.replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/')
  const padLength = (4 - (restoredStandardChars.length % 4)) % 4
  return `${restoredStandardChars}${'='.repeat(padLength)}`
}

/** Base64 / Base64URL 文字列を UTF-8 デコードする。本文自体には decodeURIComponent をかけない */
const decodeBase64Utf8 = (encoded: string): string => {
  const binary = atob(normalizeBase64Param(encoded))
  const bytes = Uint8Array.from(binary, (ch): number => ch.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** hash パラメータから markdown を取り出してロードする本体（loadHashMarkdown の statements を分割） */
const loadFromHashParams = async (
  runtime: BootRuntime,
  params: URLSearchParams
): Promise<boolean> => {
  const md = params.get('md')
  if (md === null) {
    return false
  }
  const decoded = decodeBase64Utf8(md)
  const name = params.get('name') || 'shared.md'
  await runtime.loadFromMarkdown(name, decoded)
  return true
}

/**
 * URL ハッシュ `#md=<base64url>&name=<file>` から MD を読み込む。
 * Base64 → UTF-8 復号には `atob` + `TextDecoder` を使う（非推奨の `escape` を避ける）。
 */
const loadHashMarkdown = async (runtime: BootRuntime): Promise<boolean> => {
  try {
    const params = hashParams()
    if (!params) {
      return false
    }
    return await loadFromHashParams(runtime, params)
  } catch {
    return false
  }
}

/** updated タイムスタンプが最も新しいドキュメントを 1 つ選ぶ（null・未定義に強い reduce 形） */
export const latestDocument = <DocumentLike extends { updated?: string }>(
  documents: (DocumentLike | null | undefined)[]
): DocumentLike | null =>
  documents.reduce<DocumentLike | null>((current, doc): DocumentLike | null => {
    if (!doc) {
      return current
    }
    if (!current || (doc.updated || '') > (current.updated || '')) {
      return doc
    }
    return current
  }, null)

/** 直近セッションの復元。保存済みドキュメントをすべて舐めて最新を採用する（多数あっても起動時 1 回限りなのでコストは許容） */
const restoreLatestDocument = async (runtime: BootRuntime): Promise<void> => {
  try {
    const keys = await runtime.store.listKeys('doc:')
    if (keys.length === 0) {
      return
    }
    const stored = await Promise.all(
      keys.map(async (key): Promise<unknown> => runtime.store.get(key))
    )
    const documents = stored.filter((value): value is StoredDocument => isStoredDocument(value))
    const latest = latestDocument(documents)
    if (latest && latest.name && latest.markdown) {
      await runtime.loadFromMarkdown(latest.name, latest.markdown)
      runtime.toast('Restored last session')
    }
  } catch {
    // no storage
  }
}

/**
 * 起動時のロード優先順位を順に試す。
 * 1. ワークスペース監視を復元（成功してもこの後の手段は止めない: workspace の review.md は遅延着信もあるため）
 * 2. 埋め込み MD（同梱配布のケース）
 * 3. URL ハッシュの共有 MD
 * 4. workspace ポーリングで既に読み込まれていれば終了
 * 5. それでも未読込なら直近セッションを復元
 */
export const boot = async (runtime: BootRuntime): Promise<void> => {
  await tryRestoreWorkspace()
  if (await loadEmbeddedMarkdown(runtime)) {
    return
  }
  if (await loadHashMarkdown(runtime)) {
    return
  }
  if (runtime.state.markdown) {
    return
  }
  await restoreLatestDocument(runtime)
}

const encodeBase64UrlForTest = (text: string): string => {
  const bytes = [...new TextEncoder().encode(text)]
  const binary = bytes.map((byte): string => String.fromCharCode(byte)).join('')
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const bootRuntimeForTest = (loaded: { name: string; text: string }[] = []): BootRuntime => ({
  loadFromMarkdown: async (name: string, text: string): Promise<void> => {
    loaded.push({ name, text })
    return Promise.resolve()
  },
  reapplyAllMarks: (): void => {
    // test no-op
  },
  renderSidebar: (): void => {
    // test no-op
  },
  save: async (): Promise<void> => Promise.resolve(),
  state: {
    comments: [],
    markdown: '',
  },
  store: {
    get: async (): Promise<unknown> => Promise.resolve(null),
    listKeys: async (): Promise<string[]> => Promise.resolve([]),
  },
  toast: (): void => {
    // test no-op
  },
})

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

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

  describe('latestDocument', () => {
    it('updated が最も新しいドキュメントを返す', () => {
      const docs = [
        { name: 'a', updated: '2024-01-01T00:00:00Z' },
        { name: 'b', updated: '2024-03-01T00:00:00Z' },
        { name: 'c', updated: '2024-02-01T00:00:00Z' },
      ]
      expect(latestDocument(docs)).toEqual(docs[1])
    })

    it('空配列なら null', () => {
      expect(latestDocument([])).toBeNull()
    })

    it('null エントリを無視して最新を返す', () => {
      const docs = [null, { name: 'x', updated: '2024-01-01' }, null]
      expect(latestDocument(docs)).toEqual({ name: 'x', updated: '2024-01-01' })
    })
  })

  describe('decodeBase64Utf8', () => {
    it('Base64URL の markdown を UTF-8 として復号する', () => {
      expect(decodeBase64Utf8(encodeBase64UrlForTest('# 見出し'))).toBe('# 見出し')
    })

    it('URLSearchParams で空白化した + を標準 Base64 として復元する', () => {
      expect(decodeBase64Utf8('77 9')).toBe('\uFFFD')
    })
  })

  describe('loadFromHashParams', () => {
    it('md と name を hash params から取り込む', async () => {
      const loaded: { name: string; text: string }[] = []
      const runtime = bootRuntimeForTest(loaded)
      const params = new URLSearchParams({
        md: encodeBase64UrlForTest('# Review'),
        name: 'request.md',
      })

      await expect(loadFromHashParams(runtime, params)).resolves.toBe(true)
      expect(loaded).toEqual([{ name: 'request.md', text: '# Review' }])
    })

    it('md がなければ false を返す', async () => {
      await expect(loadFromHashParams(bootRuntimeForTest(), new URLSearchParams())).resolves.toBe(
        false
      )
    })
  })
}
