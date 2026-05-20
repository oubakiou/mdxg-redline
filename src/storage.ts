// --- Storage helpers --------------------------------------------------------
// `FileSystemDirectoryHandle` は JSON 化できず IndexedDB に直接シリアライズする
// しか手段がないため、workspace-handle 永続化のためだけに IDB の薄いラッパーを
// 提供する。

/** IndexedDB の薄いラッパー。`margin-notes` DB / `kv` ストアに対する get/set/del を Promise 化する */
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
