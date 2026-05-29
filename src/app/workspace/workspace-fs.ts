// File System Access API のブラウザ依存ハンドルを扱う薄いラッパ層。
// runtime (UI / app-state) に依存しないため単体で test 可能で、
// workspace.ts は本モジュールの上にドメインロジック (writeFeedback 等) を組み上げる。

import { IDB } from './storage'
import { noticeDialog } from '../dom/dialog'

// File System Access API の型は実装依存のため、利用箇所だけ narrow に定義する
export type FsPermissionState = 'granted' | 'denied' | 'prompt'

export interface FsHandle {
  name: string
  queryPermission: (options: { mode: 'read' | 'readwrite' }) => Promise<FsPermissionState>
  requestPermission: (options: { mode: 'read' | 'readwrite' }) => Promise<FsPermissionState>
}

export interface FsFileHandle {
  createWritable: () => Promise<FsWritableStream>
}

export interface FsWritableStream {
  close: () => Promise<void>
  write: (data: string) => Promise<void>
}

export interface FsDirectoryHandle extends FsHandle {
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<FsFileHandle>
}

declare global {
  // showDirectoryPicker は Chromium 系のみ実装される
  // eslint-disable-next-line no-var
  var showDirectoryPicker:
    | ((options?: { mode: 'read' | 'readwrite' }) => Promise<FsDirectoryHandle>)
    | undefined
}

/**
 * 現在記憶しているディレクトリハンドル。null なら未接続状態。
 * 起動時に IDB から復元され、ピッカーで選び直すと差し替わる。永続化キーは `workspace-handle`。
 * workspace.ts からも mutate される共有 mutable state (state object と同じ pattern)。
 */
export const wsState: { handle: FsDirectoryHandle | null } = {
  handle: null,
}

/** File System Access API がブラウザで利用可能か。非対応環境ではピッカーを開けない */
export const wsSupported = (): boolean => typeof globalThis.showDirectoryPicker === 'function'

/** unknown 値から name プロパティを取り出す。Error 以外は空文字フォールバック */
const errorName = (error: unknown): string => {
  if (error instanceof Error) {
    return error.name
  }
  return ''
}

/** 現在保持しているハンドル名を返す（ツールチップ表示用）。未接続なら null */
export const getOutputFolderName = (): string | null => {
  if (!wsState.handle) {
    return null
  }
  return wsState.handle.name
}

/**
 * FileSystemDirectoryHandle を IndexedDB に格納する。Chromium 系は IDB へ structured-clone でハンドルを保持できる。
 * 永続化失敗はセッション中の動作には影響しないため try/catch で握りつぶす（次回起動時に再度ピッカーが必要になるだけ）。
 */
export const persistWorkspaceHandle = async (handle: FsDirectoryHandle): Promise<void> => {
  try {
    await IDB.set('workspace-handle', handle)
  } catch {
    // handle 永続化失敗時もメモリ上のハンドルで動作継続（次回開き直しで再要求になる）
  }
}

/** IDB から取り出した unknown が FsDirectoryHandle として最低限利用可能かを検査する型ガード */
const isDirectoryHandle = (value: unknown): value is FsDirectoryHandle => {
  if (!value || typeof value !== 'object') {
    return false
  }
  return 'queryPermission' in value && 'getFileHandle' in value
}

/** 前回保存した directory handle を IDB から取り出す。空なら null（呼び出し側は復元スキップへ） */
const storedWorkspaceHandle = async (): Promise<FsDirectoryHandle | null> => {
  const handle = await IDB.get('workspace-handle')
  if (!isDirectoryHandle(handle)) {
    return null
  }
  return handle
}

/**
 * 例外を null に潰して storedWorkspaceHandle を呼ぶ thin wrapper。
 * 復元失敗は「未保存」と同じ扱いにできるよう、呼び出し側を try なしで書ける形にする。
 */
export const safelyStoredHandle = async (): Promise<FsDirectoryHandle | null> => {
  try {
    return await storedWorkspaceHandle()
  } catch {
    return null
  }
}

/**
 * ピッカーを開いて新しいディレクトリハンドルを取得する。
 * AbortError（ユーザー Cancel）は null として静かに返し、その他のエラーは伝播させる。
 * 非対応ブラウザでは説明ダイアログを 1 度だけ出して null。
 */
export const pickOutputFolder = async (): Promise<FsDirectoryHandle | null> => {
  if (!wsSupported() || !globalThis.showDirectoryPicker) {
    await noticeDialog(
      'File System Access API is not supported',
      'Use Chrome, Edge, or another Chromium-based browser to enable writing feedback.json directly to a folder. ' +
        'You can still use Export as JSON / Copy as JSON.'
    )
    return null
  }
  try {
    return await globalThis.showDirectoryPicker({ mode: 'readwrite' })
  } catch (error) {
    if (errorName(error) === 'AbortError') {
      return null
    }
    throw error
  }
}

/**
 * 既存ハンドルの権限を確認し、必要なら要求する。
 * - granted: そのまま使用可
 * - prompt:  requestPermission を呼ぶ。失敗・拒否は false
 * - denied:  false
 */
export const ensureHandlePermission = async (handle: FsDirectoryHandle): Promise<boolean> => {
  try {
    const current = await handle.queryPermission({ mode: 'readwrite' })
    if (current === 'granted') {
      return true
    }
    if (current === 'denied') {
      return false
    }
    const after = await handle.requestPermission({ mode: 'readwrite' })
    return after === 'granted'
  } catch {
    return false
  }
}

/** 既存ハンドルが使える状態なら返す。無い／拒否なら null を返して呼び出し側にピッカーを促す */
export const reuseExistingHandle = async (): Promise<FsDirectoryHandle | null> => {
  if (!wsState.handle) {
    return null
  }
  const ok = await ensureHandlePermission(wsState.handle)
  if (!ok) {
    return null
  }
  return wsState.handle
}

const forgetWorkspaceHandleForTest = async (): Promise<void> => {
  try {
    await IDB.del('workspace-handle')
  } catch {
    // 永続化失敗はテストの判定材料にしない
  }
}

const resetWorkspaceFsForTest = (): void => {
  wsState.handle = null
}

if (import.meta.vitest) {
  const { afterEach, beforeEach, describe, expect, it } = import.meta.vitest

  beforeEach(() => {
    resetWorkspaceFsForTest()
  })

  afterEach(() => {
    resetWorkspaceFsForTest()
  })

  describe('ensureHandlePermission', () => {
    const makeHandle = (
      initial: FsPermissionState,
      afterRequest: FsPermissionState = initial
    ): FsDirectoryHandle => ({
      getFileHandle: async (): Promise<FsFileHandle> => Promise.reject(new Error('not expected')),
      name: 'workspace',
      queryPermission: async (): Promise<FsPermissionState> => Promise.resolve(initial),
      requestPermission: async (): Promise<FsPermissionState> => Promise.resolve(afterRequest),
    })

    it('granted ならそのまま true', async () => {
      await expect(ensureHandlePermission(makeHandle('granted'))).resolves.toBe(true)
    })

    it('denied なら false（requestPermission を呼ばない）', async () => {
      await expect(ensureHandlePermission(makeHandle('denied'))).resolves.toBe(false)
    })

    it('prompt + requestPermission が granted なら true', async () => {
      await expect(ensureHandlePermission(makeHandle('prompt', 'granted'))).resolves.toBe(true)
    })

    it('prompt + requestPermission が denied なら false', async () => {
      await expect(ensureHandlePermission(makeHandle('prompt', 'denied'))).resolves.toBe(false)
    })
  })

  describe('getOutputFolderName', () => {
    it('ハンドル未保持なら null', () => {
      expect(getOutputFolderName()).toBeNull()
    })

    it('ハンドル保持中はその name を返す', () => {
      wsState.handle = {
        getFileHandle: async (): Promise<FsFileHandle> => Promise.reject(new Error('not expected')),
        name: '~/reviews',
        queryPermission: async (): Promise<FsPermissionState> => Promise.resolve('granted'),
        requestPermission: async (): Promise<FsPermissionState> => Promise.resolve('granted'),
      }
      expect(getOutputFolderName()).toBe('~/reviews')
    })
  })

  describe('forgetWorkspaceHandleForTest', () => {
    it('呼び出して例外を投げない（IDB 未初期化環境でも安全）', async () => {
      await expect(forgetWorkspaceHandleForTest()).resolves.toBeUndefined()
    })
  })

  describe('isDirectoryHandle', () => {
    // queryPermission と getFileHandle の 2 メソッド存在を要件とする narrow check。
    // IDB 復元時に malformed な値が来ても fail-soft に弾けることがこの guard の責務。
    it('queryPermission と getFileHandle を持つオブジェクトは directory handle と判定する', () => {
      const stub = {
        getFileHandle: (): void => {
          /* stub */
        },
        queryPermission: (): void => {
          /* stub */
        },
      }
      expect(isDirectoryHandle(stub)).toBe(true)
    })

    it('null や IDB.get の未保存キー (undefined) は false', () => {
      expect(isDirectoryHandle(null)).toBe(false)
      // IDB.get(key) は key 不在時に undefined を返すため、unknown 入力として
      // それを安全に弾けることを検証する。undefined リテラルを直接書くと
      // no-undefined lint に抵触するため、未代入の optional から取り出す形で渡す。
      const { absent } = {} as { absent?: unknown }
      expect(isDirectoryHandle(absent)).toBe(false)
    })

    it('object でない truthy 値 (string / number / boolean) は false', () => {
      expect(isDirectoryHandle('handle')).toBe(false)
      expect(isDirectoryHandle(42)).toBe(false)
      expect(isDirectoryHandle(true)).toBe(false)
    })

    it('queryPermission か getFileHandle のいずれかを欠くオブジェクトは false', () => {
      const missingQuery = {
        getFileHandle: (): void => {
          /* stub */
        },
      }
      const missingGetFile = {
        queryPermission: (): void => {
          /* stub */
        },
      }
      expect(isDirectoryHandle(missingQuery)).toBe(false)
      expect(isDirectoryHandle(missingGetFile)).toBe(false)
    })
  })

  describe('safelyStoredHandle', () => {
    // 復元失敗を「未保存」と同じ扱いにする fail-soft 契約。IDB 未初期化な test 環境では
    // 例外が出ても (or 値が無くても) null を返すことを保証する。
    it('IDB 未初期化環境でも例外を投げず null を返す (fail-soft)', async () => {
      await expect(safelyStoredHandle()).resolves.toBeNull()
    })
  })
}
