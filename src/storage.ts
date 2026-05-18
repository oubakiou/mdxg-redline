// --- Storage helpers --------------------------------------------------------
// Uses globalThis.storage when running inside Claude.ai; falls back to IndexedDB
// when opened locally via file:// so the tool works either way.

/**
 * Claude.ai 内アーティファクトで提供される `globalThis.storage` の最小契約。
 * 公式型は存在しないため、利用箇所だけ拾った narrow な定義に留める。
 */
interface ArtifactStorage {
  delete: (key: string) => Promise<void>
  get: (key: string) => Promise<{ value: string } | null | undefined>
  list: (prefix: string) => Promise<{ keys?: string[] } | null | undefined>
  set: (key: string, value: string) => Promise<void>
}

declare global {
  // globalThis.storage は Claude.ai アーティファクト環境のみ注入されるため optional
  // eslint-disable-next-line no-var
  var storage: ArtifactStorage | undefined
}

/**
 * IndexedDB の薄いラッパー。`margin-notes` DB / `kv` ストアに対する get/set/del/keys を Promise 化する。
 * IDB 自体の生 API を Store / ワークスペースハンドル永続化の両方から使うため、独立した低レベル層として分離している。
 */
export const IDB = {
  dbCache: null as IDBDatabase | null,
  async del(key: string): Promise<void> {
    const db = await this.open()
    return new Promise((resolve, reject): void => {
      const req = db.transaction('kv', 'readwrite').objectStore('kv').delete(key)
      req.onsuccess = (): void => resolve()
      req.addEventListener('error', (): void => reject(req.error))
    })
  },
  async get(key: string): Promise<unknown> {
    const db = await this.open()
    return new Promise((resolve, reject): void => {
      const req = db.transaction('kv').objectStore('kv').get(key)
      req.onsuccess = (): void => resolve(req.result)
      req.addEventListener('error', (): void => reject(req.error))
    })
  },
  async keys(prefix: string): Promise<string[]> {
    const db = await this.open()
    return new Promise((resolve, reject): void => {
      const out: string[] = []
      const req = db.transaction('kv').objectStore('kv').openKeyCursor()
      req.onsuccess = (): void => {
        const cursor = req.result
        if (!cursor) {
          return resolve(out)
        }
        if (typeof cursor.key !== 'string') {
          cursor.continue()
          return
        }
        const { key } = cursor
        if (!prefix || key.startsWith(prefix)) {
          out.push(key)
        }
        cursor.continue()
      }
      req.addEventListener('error', (): void => reject(req.error))
    })
  },
  /** DB を開いてキャッシュする。複数同時呼び出しはそれぞれ Promise を返すが、dbCache に最初のインスタンスが入れば以後はそれを使い回す */
  async open(): Promise<IDBDatabase> {
    if (this.dbCache) {
      return this.dbCache
    }
    return new Promise((resolve, reject): void => {
      const req = indexedDB.open('margin-notes', 1)
      req.onupgradeneeded = (): IDBObjectStore => req.result.createObjectStore('kv')
      req.onsuccess = (): void => {
        this.dbCache = req.result
        resolve(req.result)
      }
      req.addEventListener('error', (): void => reject(req.error))
    })
  },
  async set(key: string, value: unknown): Promise<void> {
    const db = await this.open()
    return new Promise((resolve, reject): void => {
      const req = db.transaction('kv', 'readwrite').objectStore('kv').put(value, key)
      req.onsuccess = (): void => resolve()
      req.addEventListener('error', (): void => reject(req.error))
    })
  },
}

/** globalThis に乗ったアーティファクトストアを narrow 型で取得（未提供環境では undefined） */
const artifactStorage: ArtifactStorage | undefined = globalThis.storage

/** Claude.ai のアーティファクト用 globalThis.storage が利用可能か。起動時に 1 回だけ判定して以後は使い回す */
const hasArtifactStore =
  typeof artifactStorage !== 'undefined' && typeof artifactStorage.get === 'function'

/** globalThis.storage から JSON 値を取り出す。レコードが無い／パース失敗時は null を返す（呼び出し側の fallback を促す） */
const getFromArtifactStore = async (key: string): Promise<unknown> => {
  if (!artifactStorage) {
    return null
  }
  try {
    const record = await artifactStorage.get(key)
    if (!record) {
      return null
    }
    return JSON.parse(record.value)
  } catch {
    return null
  }
}

/** IndexedDB から `store:` プレフィックス付きで JSON 値を取り出す。失敗・欠落時は null */
const getFromIdbStore = async (key: string): Promise<unknown> => {
  try {
    const stored = await IDB.get(`store:${key}`)
    if (typeof stored !== 'string') {
      return null
    }
    return JSON.parse(stored)
  } catch {
    return null
  }
}

/**
 * 永続化 API のファサード。`globalThis.storage`（Claude.ai アーティファクト）が使えれば優先し、
 * 失敗時または非対応環境では IndexedDB へフォールバックする。呼び出し側は環境を気にせず使える。
 */
export const Store = {
  async del(key: string): Promise<void> {
    if (hasArtifactStore && artifactStorage) {
      try {
        await artifactStorage.delete(key)
        return
      } catch {
        // globalThis.storage 失敗時は IDB フォールバックへ
      }
    }
    try {
      await IDB.del(`store:${key}`)
    } catch {
      // 永続化に失敗してもアプリの動作は継続させる（メモリ状態のみ）
    }
  },
  async get(key: string): Promise<unknown> {
    if (hasArtifactStore) {
      return getFromArtifactStore(key)
    }
    return getFromIdbStore(key)
  },
  async listKeys(prefix: string): Promise<string[]> {
    if (hasArtifactStore && artifactStorage) {
      try {
        const listed = await artifactStorage.list(prefix)
        return (listed && listed.keys) || []
      } catch {
        return []
      }
    }
    try {
      const keys = await IDB.keys(`store:${prefix}`)
      return keys.map((key): string => key.slice(6))
    } catch {
      return []
    }
  },
  async set(key: string, value: unknown): Promise<void> {
    if (hasArtifactStore && artifactStorage) {
      try {
        await artifactStorage.set(key, JSON.stringify(value))
        return
      } catch {
        /* fall through */
      }
    }
    try {
      await IDB.set(`store:${key}`, JSON.stringify(value))
    } catch {
      // 永続化に失敗してもアプリの動作は継続させる（メモリ状態のみ）
    }
  },
}
