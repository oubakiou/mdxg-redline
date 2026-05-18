// --- Workspace mode (file-watching protocol with Claude Code etc.) ----------
// Protocol:
//   <workspace>/review.md      ← agent writes this; we auto-load on change
//   <workspace>/feedback.json  ← we write this when user clicks Send

import { confirmDialog, noticeDialog } from './dialog'
import { IDB } from './storage'

// File System Access API の型は実装依存のため、利用箇所だけ narrow に定義する
type FsPermissionState = 'granted' | 'denied' | 'prompt'

interface FsHandle {
  name: string
  queryPermission: (options: { mode: 'read' | 'readwrite' }) => Promise<FsPermissionState>
  requestPermission: (options: { mode: 'read' | 'readwrite' }) => Promise<FsPermissionState>
}

interface FsFileHandle {
  getFile: () => Promise<File>
  createWritable: () => Promise<FsWritableStream>
}

interface FsWritableStream {
  write: (data: string) => Promise<void>
  close: () => Promise<void>
}

interface FsDirectoryHandle extends FsHandle {
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<FsFileHandle>
}

interface Comment {
  id: string
  quote: string
  comment: string
  blockId: string
  startOffset: number
  endOffset: number
  created: string
}

interface ExportComment {
  comment: string
  created: string
  headingPath: string[]
  id: string
  quote: string
  sourceLine: number
}

interface ExportPayload {
  comments: ExportComment[]
  docHash: string
  document: string | null
  exportedAt: string
}

interface WorkspaceRuntime {
  buildExportPayload: () => ExportPayload
  commentCountLabel: () => string
  hashStr: (str: string) => Promise<string>
  loadFromMarkdown: (name: string, text: string) => Promise<void>
  qs: (selector: string) => HTMLElement
  state: {
    comments: Comment[]
    docHash: string | null
    docName: string | null
    markdown: string
  }
  toast: (msg: string) => void
}

const runtimeRef: { current: WorkspaceRuntime | null } = {
  current: null,
}

export const configureWorkspace = (runtime: WorkspaceRuntime): void => {
  runtimeRef.current = runtime
}

const runtime = (): WorkspaceRuntime => {
  if (!runtimeRef.current) {
    throw new Error('Workspace runtime is not configured')
  }
  return runtimeRef.current
}

declare global {
  // showDirectoryPicker は Chromium 系のみ実装される
  // eslint-disable-next-line no-var
  var showDirectoryPicker:
    | ((options?: { mode: 'read' | 'readwrite' }) => Promise<FsDirectoryHandle>)
    | undefined
}

/** ワークスペース連携のプロトコル定数。エージェント側もこのファイル名を前提にしているため安易に変えない */
const WS = {
  INPUT_FILE: 'review.md',
  OUTPUT_FILE: 'feedback.json',
  POLL_MS: 2000,
}

/**
 * ワークスペース監視の実行時状態。
 * handle: ユーザーが選んだディレクトリの FileSystemDirectoryHandle（IndexedDB に永続化される）。
 * lastHash: 直近に読み込んだ review.md のハッシュ。差分検知に使う。
 * timer: setInterval の ID。null なら監視停止中。
 */
const wsState: {
  declinedHash: string | null
  handle: FsDirectoryHandle | null
  lastHash: string | null
  polling: boolean
  timer: ReturnType<typeof setInterval> | null
} = {
  declinedHash: null,
  handle: null,
  lastHash: null,
  polling: false,
  timer: null,
}

interface WsControls {
  sendBtn: HTMLElement
  status: HTMLElement
  watchBtn: HTMLElement
}

/** File System Access API がブラウザで利用可能か。非対応環境では監視 UI を無効化する */
const wsSupported = (): boolean => typeof globalThis.showDirectoryPicker === 'function'

/** ワークスペース UI を構成する DOM 要素群（buttons + status）をまとめて取得する */
const wsControls = (): WsControls => ({
  sendBtn: runtime().qs('#btn-send'),
  status: runtime().qs('#ws-status'),
  watchBtn: runtime().qs('#btn-watch'),
})

/** ワークスペース監視中の UI 表示（接続済み・ポーリング中） */
const showWsActive = (controls: WsControls, handle: FsDirectoryHandle): void => {
  controls.watchBtn.textContent = `Watching · ${handle.name}`
  controls.watchBtn.classList.add('btn-primary')
  controls.sendBtn.style.display = ''
  controls.status.style.display = ''
  controls.status.textContent = `● ${WS.INPUT_FILE} → ${WS.OUTPUT_FILE}`
}

/** 過去にハンドルはあるが権限切れの状態。ユーザーが再許可するまで監視は止める */
const showWsReconnect = (controls: WsControls, handle: FsDirectoryHandle): void => {
  controls.watchBtn.textContent = `Reconnect · ${handle.name}`
  controls.watchBtn.classList.remove('btn-primary')
  controls.sendBtn.style.display = 'none'
  controls.status.style.display = 'none'
}

/** ワークスペース未接続の初期状態 */
const showWsInactive = (controls: WsControls): void => {
  controls.watchBtn.textContent = 'Watch folder'
  controls.watchBtn.classList.remove('btn-primary')
  controls.sendBtn.style.display = 'none'
  controls.status.style.display = 'none'
}

/** wsState の現在値に応じて 3 つの UI 状態（active / reconnect / inactive）に分岐させる */
const updateWsUI = (): void => {
  const controls = wsControls()
  const { handle, timer } = wsState
  if (handle && timer) {
    showWsActive(controls, handle)
    return
  }
  if (handle) {
    showWsReconnect(controls, handle)
    return
  }
  showWsInactive(controls)
}

/** ポーリングを止めて timer をクリア。再開・切断時のクリーンアップで使う */
const wsStopWatching = (): void => {
  const { timer } = wsState
  if (timer) {
    clearInterval(timer)
    wsState.timer = null
  }
}

interface WorkspaceInput {
  hash: string
  text: string
}

/** ワークスペースから review.md を読み、内容ハッシュも併せて返す（差分検知用） */
const readWorkspaceInput = async (handle: FsDirectoryHandle): Promise<WorkspaceInput> => {
  const fh = await handle.getFileHandle(WS.INPUT_FILE, { create: false })
  const file = await fh.getFile()
  const text = await file.text()
  const hash = await runtime().hashStr(text)
  return { hash, text }
}

/**
 * 新版 review.md を取り込んでよいかユーザーに確認する。
 * 初回読み込み（lastHash 未設定）またはコメントが 1 件もない場合は無条件 true として、UI を阻害しない。
 * 既存コメントがある場合のみ確認ダイアログを出し、ユーザーが拒否したら現状を維持する。
 */
const confirmWorkspaceReload = async (hash: string): Promise<boolean> => {
  if (wsState.lastHash === null || runtime().state.comments.length === 0) {
    return Promise.resolve(true)
  }
  if (hash === wsState.declinedHash) {
    return Promise.resolve(false)
  }
  return confirmDialog(
    `${WS.INPUT_FILE} has been updated. Load the new version? Current comments will be archived under the previous version's hash.`
  )
}

/** review.md の差分を検知した後の取り込みフロー。ユーザー拒否時は hash を控え、同じ内容では再確認しない */
const loadWorkspaceInput = async ({ hash, text }: WorkspaceInput): Promise<void> => {
  const confirmed = await confirmWorkspaceReload(hash)
  if (!confirmed) {
    wsState.declinedHash = hash
    return
  }
  wsState.declinedHash = null
  wsState.lastHash = hash
  await runtime().loadFromMarkdown(WS.INPUT_FILE, text)
  runtime().toast(`Loaded ${WS.INPUT_FILE}`)
}

/**
 * ポーリング失敗時のエラー分岐。
 * - NotFoundError: review.md がまだ存在しない（エージェント側がこれから書き込む途中）→ 無視して継続。
 * - NotAllowedError: 権限剥奪 → 無音で停止（ユーザーには UI の Reconnect で気づかせる）。
 * - その他: 想定外なので監視を止めて通知する。
 */
/** unknown 値から name プロパティを取り出す。Error 以外は空文字フォールバック */
const errorName = (error: unknown): string => {
  if (error instanceof Error) {
    return error.name
  }
  return ''
}

const handleWsPollError = (error: unknown): void => {
  const name = errorName(error)
  if (name === 'NotFoundError') {
    return
  }
  wsStopWatching()
  updateWsUI()
  if (name !== 'NotAllowedError') {
    runtime().toast('Workspace watch stopped')
  }
}

const pollWorkspaceInput = async (handle: FsDirectoryHandle): Promise<void> => {
  const input = await readWorkspaceInput(handle)
  if (input.hash === wsState.lastHash) {
    return
  }
  await loadWorkspaceInput(input)
}

/** 1 回分のポーリング。ハッシュ一致なら何もしない（バッテリ・I/O 効率を優先） */
const wsPollOnce = async (): Promise<void> => {
  const { handle } = wsState
  if (!handle || wsState.polling) {
    return
  }
  wsState.polling = true
  try {
    await pollWorkspaceInput(handle)
  } catch (error) {
    handleWsPollError(error)
  } finally {
    wsState.polling = false
  }
}

/** 監視を開始。即時 1 回ポール→以降 POLL_MS 間隔で繰り返し。再開時に多重に走らないよう先に stop してから start する */
const wsStartWatching = (): void => {
  wsStopWatching()
  wsPollOnce().catch((): void => runtime().toast('Workspace watch failed'))
  wsState.timer = setInterval(wsPollOnce, WS.POLL_MS)
}

/**
 * FileSystemDirectoryHandle を IndexedDB に格納する。Chromium 系は IDB へ structured-clone でハンドルを保持できる。
 * 永続化失敗はセッション中の動作には影響しないため try/catch で握りつぶす（次回起動時に再度ピッカーが必要になるだけ）。
 */
const persistWorkspaceHandle = async (handle: FsDirectoryHandle): Promise<void> => {
  try {
    await IDB.set('workspace-handle', handle)
  } catch {
    // handle 永続化失敗時もメモリ上のハンドルで動作継続（次回開き直しで再要求になる）
  }
}

/** state.handle を確定し、監視開始＋UI 反映までの定形を 1 か所に集約 */
const activateWorkspaceHandle = (handle: FsDirectoryHandle): void => {
  wsState.handle = handle
  wsStartWatching()
  updateWsUI()
}

/** ピッカー結果のハンドルを取り込み、UI 状態まで反映する一連の流れ（wsConnect から切り出して max-statements を緩和） */
const acceptPickedHandle = async (handle: FsDirectoryHandle): Promise<void> => {
  await persistWorkspaceHandle(handle)
  activateWorkspaceHandle(handle)
  runtime().toast(`Connected · ${handle.name}`)
}

/**
 * 新規にディレクトリピッカーを開いてワークスペースに接続する。
 * 非対応ブラウザでは説明ダイアログを出して早期 return、ユーザーが Cancel した場合（AbortError）は静かに何もしない。
 */
const wsConnect = async (): Promise<void> => {
  if (!wsSupported() || !globalThis.showDirectoryPicker) {
    await noticeDialog(
      'This browser does not support the File System Access API.\nUse Chrome, Edge, or another Chromium-based browser.'
    )
    return
  }
  try {
    const handle = await globalThis.showDirectoryPicker({ mode: 'readwrite' })
    await acceptPickedHandle(handle)
  } catch (error) {
    if (errorName(error) !== 'AbortError') {
      runtime().toast('Connect failed')
    }
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
 * 復元した handle の権限状態に応じて分岐する。
 * granted ならそのまま監視再開、そうでなければ UI を Reconnect 状態に切り替えてユーザー操作を待つ。
 */
const applyRestoredWorkspace = (
  handle: FsDirectoryHandle,
  permission: FsPermissionState
): boolean => {
  if (permission === 'granted') {
    activateWorkspaceHandle(handle)
    return true
  }
  wsState.handle = handle // remember, but show "Reconnect"
  updateWsUI()
  return false
}

/**
 * 起動時に前回のワークスペースを自動復元しようとする。
 * - API 非対応／保存ハンドル無し／例外発生時はすべて false 返却で安全側に倒す。
 * - 権限を問い合わせるだけで再要求はしない（自動でモーダルを出さない設計）。
 */
export const tryRestoreWorkspace = async (): Promise<boolean> => {
  if (!wsSupported()) {
    return false
  }
  try {
    const handle = await storedWorkspaceHandle()
    if (!handle) {
      return false
    }
    const perm = await handle.queryPermission({ mode: 'readwrite' })
    return applyRestoredWorkspace(handle, perm)
  } catch {
    return false
  }
}

/** Reconnect ボタン押下時など、明示的なユーザー操作のタイミングで権限を要求する */
const wsRequestPermission = async (): Promise<boolean> => {
  const { handle } = wsState
  if (!handle) {
    return false
  }
  try {
    const perm = await handle.requestPermission({ mode: 'readwrite' })
    if (perm !== 'granted') {
      return false
    }
    activateWorkspaceHandle(handle)
    return true
  } catch {
    return false
  }
}

/** ワークスペースに feedback.json を書き出す。ファイルが無ければ作成、あれば上書き */
const writeWorkspaceFeedback = async (handle: FsDirectoryHandle): Promise<void> => {
  const fh = await handle.getFileHandle(WS.OUTPUT_FILE, { create: true })
  const writable = await fh.createWritable()
  await writable.write(JSON.stringify(runtime().buildExportPayload(), null, 2))
  await writable.close()
}

/** Send 成功時のトーストとステータスバー更新 */
const finishWsSend = (): void => {
  const app = runtime()
  app.toast(`Submitted · ${app.commentCountLabel()}`)
  app.qs('#status').textContent = `${app.state.docName} · submitted`
}

/** Send ボタン押下時：ワークスペースに feedback.json を書き出す。ハンドル無し or 本文無しは無音で中止 */
export const wsSend = async (): Promise<void> => {
  const { handle } = wsState
  if (!handle) {
    return
  }
  if (!runtime().state.markdown) {
    runtime().toast('Nothing to submit')
    return
  }
  try {
    await writeWorkspaceFeedback(handle)
    finishWsSend()
  } catch {
    runtime().toast('Submit failed')
  }
}

/** 保存済みハンドルを IDB から削除（切断時の後始末。失敗してもメモリ側の切断状態は維持する） */
const forgetWorkspaceHandle = async (): Promise<void> => {
  try {
    await IDB.del('workspace-handle')
  } catch {
    // 永続化ハンドル削除失敗時もメモリ上の disconnect 状態は確定させる
  }
}

/** 既存ハンドルへの権限再要求 → 失敗時は新規にディレクトリピッカーを開く 2 段構え */
const reconnectWorkspace = async (): Promise<void> => {
  const ok = await wsRequestPermission()
  if (!ok) {
    await wsConnect()
  }
}

/** 明示的に切断。確認ダイアログを挟み、その後ポーリング停止＋state クリア＋永続化削除を順に実施 */
const disconnectWorkspace = async (handle: FsDirectoryHandle): Promise<void> => {
  const confirmed = await confirmDialog(`Stop watching ${handle.name}/?`)
  if (!confirmed) {
    return
  }
  wsStopWatching()
  wsState.declinedHash = null
  wsState.handle = null
  wsState.lastHash = null
  await forgetWorkspaceHandle()
  updateWsUI()
  runtime().toast('Disconnected')
}

/**
 * Watch ボタン押下時のディスパッチャ。
 * - handle あり & timer 無し: 権限切れ状態 → reconnect 試行
 * - handle あり & timer あり: 監視中 → disconnect
 * - handle 無し: 新規接続
 */
export const handleWatchClick = async (): Promise<void> => {
  const { handle, timer } = wsState
  if (handle && !timer) {
    await reconnectWorkspace()
    return
  }
  if (handle && timer) {
    await disconnectWorkspace(handle)
    return
  }
  await wsConnect()
}

const workspaceCommentForTest = (id: string): Comment => ({
  blockId: 'b001',
  comment: 'body',
  created: '2026-05-17T00:00:00.000Z',
  endOffset: 4,
  id,
  quote: 'text',
  startOffset: 0,
})

const workspaceRuntimeForTest = (
  state: WorkspaceRuntime['state'] = {
    comments: [],
    docHash: 'testhash00000000',
    docName: 'review.md',
    markdown: '# Review',
  }
): WorkspaceRuntime => ({
  buildExportPayload: (): ExportPayload => ({
    comments: state.comments.map(
      (comment): ExportComment => ({
        comment: comment.comment,
        created: comment.created,
        headingPath: [],
        id: comment.id,
        quote: comment.quote,
        sourceLine: 0,
      })
    ),
    docHash: state.docHash ?? '',
    document: state.docName,
    exportedAt: '2026-05-17T00:00:00.000Z',
  }),
  commentCountLabel: (): string => `${state.comments.length} comments`,
  hashStr: async (text: string): Promise<string> => Promise.resolve(`hash:${text.length}`),
  loadFromMarkdown: async (_name: string, text: string): Promise<void> => {
    state.markdown = text
    return Promise.resolve()
  },
  qs: (selector: string): HTMLElement => {
    throw new Error(`Unexpected selector in workspace test: ${selector}`)
  },
  state,
  toast: (_msg: string): void => {
    // test no-op
  },
})

const resetWorkspaceForTest = (): void => {
  wsStopWatching()
  wsState.declinedHash = null
  wsState.handle = null
  wsState.lastHash = null
  wsState.polling = false
  wsState.timer = null
}

const unwritableFileHandleForTest = (): FsFileHandle => ({
  createWritable: async (): Promise<FsWritableStream> => Promise.reject(new Error('not expected')),
  getFile: async (): Promise<File> => Promise.reject(new Error('not expected')),
})

if (import.meta.vitest) {
  const { afterEach, beforeEach, describe, expect, it } = import.meta.vitest

  beforeEach(() => {
    resetWorkspaceForTest()
  })

  afterEach(() => {
    resetWorkspaceForTest()
  })

  describe('confirmWorkspaceReload', () => {
    it('初回読み込みは確認なしで許可する', async () => {
      configureWorkspace(
        workspaceRuntimeForTest({
          comments: [workspaceCommentForTest('c1')],
          docHash: 'testhash00000000',
          docName: 'review.md',
          markdown: '# Review',
        })
      )

      await expect(confirmWorkspaceReload('new-hash')).resolves.toBe(true)
    })

    it('コメントがなければ確認なしで許可する', async () => {
      configureWorkspace(workspaceRuntimeForTest())
      wsState.lastHash = 'old-hash'

      await expect(confirmWorkspaceReload('new-hash')).resolves.toBe(true)
    })

    it('拒否済み hash は再確認せず拒否する', async () => {
      configureWorkspace(
        workspaceRuntimeForTest({
          comments: [workspaceCommentForTest('c1')],
          docHash: 'testhash00000000',
          docName: 'review.md',
          markdown: '# Review',
        })
      )
      wsState.lastHash = 'old-hash'
      wsState.declinedHash = 'new-hash'

      await expect(confirmWorkspaceReload('new-hash')).resolves.toBe(false)
    })
  })

  describe('wsPollOnce', () => {
    it('既に polling 中ならファイルを読みに行かない', async () => {
      let reads = 0
      const handle: FsDirectoryHandle = {
        getFileHandle: async (): Promise<FsFileHandle> => {
          reads += 1
          return Promise.resolve(unwritableFileHandleForTest())
        },
        name: 'workspace',
        queryPermission: async (): Promise<FsPermissionState> => Promise.resolve('granted'),
        requestPermission: async (): Promise<FsPermissionState> => Promise.resolve('granted'),
      }

      configureWorkspace(workspaceRuntimeForTest())
      wsState.handle = handle
      wsState.polling = true

      await wsPollOnce()
      expect(reads).toBe(0)
    })
  })

  describe('writeWorkspaceFeedback', () => {
    it('feedback.json に export payload を JSON として書き出す', async () => {
      let written = ''
      let closed = false
      const handle: FsDirectoryHandle = {
        getFileHandle: async (name, options): Promise<FsFileHandle> => {
          expect(name).toBe(WS.OUTPUT_FILE)
          expect(options).toEqual({ create: true })
          return Promise.resolve({
            createWritable: async (): Promise<FsWritableStream> =>
              Promise.resolve({
                close: async (): Promise<void> => {
                  closed = true
                  return Promise.resolve()
                },
                write: async (data: string): Promise<void> => {
                  written = data
                  return Promise.resolve()
                },
              }),
            getFile: async (): Promise<File> => Promise.reject(new Error('not expected')),
          })
        },
        name: 'workspace',
        queryPermission: async (): Promise<FsPermissionState> => Promise.resolve('granted'),
        requestPermission: async (): Promise<FsPermissionState> => Promise.resolve('granted'),
      }

      configureWorkspace(
        workspaceRuntimeForTest({
          comments: [workspaceCommentForTest('c1')],
          docHash: 'testhash00000000',
          docName: 'review.md',
          markdown: '# Review',
        })
      )

      await writeWorkspaceFeedback(handle)
      expect(JSON.parse(written)).toEqual(runtime().buildExportPayload())
      expect(closed).toBe(true)
    })
  })
}
