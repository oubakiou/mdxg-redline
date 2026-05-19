// --- Workspace mode (file-watching protocol with Claude Code etc.) ----------
// Protocol (詳細は docs/DESIGN.md §8):
//   <workspace>/<mdFileName>-<docHash>-review.md     ← agent writes this; we pick mtime-latest
//   <workspace>/<mdFileName>-<docHash>-feedback.json ← we write this when user clicks Send

import { confirmDialog, noticeDialog } from './dialog'
import { deriveFeedbackJsonName, parseReviewMdFilename, stripMarkdownExt } from './embed-core'
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

// values() が返すエントリの最低限の型。kind で file/directory を判定する
interface FsEntry {
  kind: 'file' | 'directory'
  name: string
}

interface FsDirectoryHandle extends FsHandle {
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<FsFileHandle>
  values: () => AsyncIterableIterator<FsEntry>
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

/** ワークスペース連携のプロトコル定数。ファイル命名規約は docs/DESIGN.md §8 を参照 */
const WS = {
  OUTPUT_SUFFIX: '-feedback.json',
  POLL_MS: 2000,
}

/**
 * ワークスペース監視の実行時状態。
 * handle: ユーザーが選んだディレクトリの FileSystemDirectoryHandle（IndexedDB に永続化される）。
 * lastHash: 直近に取り込んだ *-review.md のハッシュ。差分検知に使う。
 * lastMdFileName: 直近に取り込んだファイルから抽出した mdFileName。
 *   feedback.json 書き出し時に「同じレビュー対象に対するペア」を保つために使う。
 * timer: setInterval の ID。null なら監視停止中。
 */
const wsState: {
  declinedHash: string | null
  handle: FsDirectoryHandle | null
  lastHash: string | null
  lastMdFileName: string | null
  polling: boolean
  timer: ReturnType<typeof setInterval> | null
} = {
  declinedHash: null,
  handle: null,
  lastHash: null,
  lastMdFileName: null,
  polling: false,
  timer: null,
}

interface WsControls {
  sendBtn: HTMLElement
  watchBtn: HTMLElement
}

/** File System Access API がブラウザで利用可能か。非対応環境では監視 UI を無効化する */
const wsSupported = (): boolean => typeof globalThis.showDirectoryPicker === 'function'

/** ワークスペース UI を構成する DOM 要素群をまとめて取得する */
const wsControls = (): WsControls => ({
  sendBtn: runtime().qs('#btn-send'),
  watchBtn: runtime().qs('#btn-watch'),
})

/** Watch folder ボタンを初期状態に戻す時の tooltip 文言。HTML 側の初期値と一致させる */
const WATCH_BTN_INACTIVE_TITLE =
  'Auto-load the latest *-review.md from a folder and write the matching *-feedback.json ' +
  'there when you click “Write feedback.json”'

interface EmptyStateEls {
  defaultState: HTMLElement
  folderEl: HTMLElement
  watchingState: HTMLElement
}

/** 空状態の DOM 要素 3 つを一度に取得し、どれかが欠けていれば null（早期 return 用） */
const emptyStateEls = (): EmptyStateEls | null => {
  const defaultState = document.getElementById('empty-state-default')
  const watchingState = document.getElementById('empty-state-watching')
  const folderEl = document.getElementById('empty-state-folder')
  if (!defaultState || !watchingState || !folderEl) {
    return null
  }
  return { defaultState, folderEl, watchingState }
}

/** wsState の変化に追従して空状態 (doc-wrap 内) を Watch 用 / 通常用に切り替える。
 * markdown が既にロード済みなら doc-wrap 自体が非表示なので、ここでの切り替えは無害だが
 * 次に markdown が clear された時に正しい方が出るよう常に最新化しておく。 */
const updateEmptyStateForWatching = (folderName: string | null): void => {
  const els = emptyStateEls()
  if (!els) {
    return
  }
  const watching = folderName !== null
  els.defaultState.hidden = watching
  els.watchingState.hidden = !watching
  if (watching) {
    els.folderEl.textContent = `“${folderName}”`
  }
}

/** ワークスペース監視中の UI 表示（接続済み・ポーリング中） */
const showWsActive = (controls: WsControls, handle: FsDirectoryHandle): void => {
  controls.watchBtn.textContent = `Watching · ${handle.name}`
  controls.watchBtn.classList.add('btn-watching')
  controls.watchBtn.setAttribute('data-tooltip', `Click to stop watching “${handle.name}”`)
  controls.sendBtn.style.display = ''
  updateEmptyStateForWatching(handle.name)
}

/** 過去にハンドルはあるが権限切れの状態。ユーザーが再許可するまで監視は止める */
const showWsReconnect = (controls: WsControls, handle: FsDirectoryHandle): void => {
  controls.watchBtn.textContent = `Reconnect · ${handle.name}`
  controls.watchBtn.classList.remove('btn-watching')
  controls.watchBtn.setAttribute(
    'data-tooltip',
    `Permission for “${handle.name}” has expired. Click to re-grant access`
  )
  controls.sendBtn.style.display = 'none'
  updateEmptyStateForWatching(null)
}

/** ワークスペース未接続の初期状態 */
const showWsInactive = (controls: WsControls): void => {
  controls.watchBtn.textContent = 'Watch folder'
  controls.watchBtn.classList.remove('btn-watching')
  controls.watchBtn.setAttribute('data-tooltip', WATCH_BTN_INACTIVE_TITLE)
  controls.sendBtn.style.display = 'none'
  updateEmptyStateForWatching(null)
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
  mdFileName: string
  text: string
}

// File 全体は不要で、mtime 比較と本文取得しか使わない。
// テスト時のモック生成しやすさのため、ここで意図的に narrow にしている。
type ReviewMdFile = Pick<File, 'lastModified' | 'text'>

interface ReviewMdCandidate {
  docHash: string
  file: ReviewMdFile
  mdFileName: string
  name: string
}

/**
 * 新候補が現在の best を上回るか判定。
 * mtime 最新を優先、同 mtime ならファイル名昇順で安定化（再現性のため）。
 */
const isNewerCandidate = (
  candidate: ReviewMdCandidate,
  current: ReviewMdCandidate | null
): boolean => {
  if (!current) {
    return true
  }
  if (candidate.file.lastModified !== current.file.lastModified) {
    return candidate.file.lastModified > current.file.lastModified
  }
  return candidate.name < current.name
}

/** unknown 値から name プロパティを取り出す。Error 以外は空文字フォールバック */
const errorName = (error: unknown): string => {
  if (error instanceof Error) {
    return error.name
  }
  return ''
}

/** 列挙中のファイルが削除された場合 (NotFoundError) は null に丸める。他のエラーは伝播させる */
const tryReadCandidateFile = async (
  handle: FsDirectoryHandle,
  name: string
): Promise<File | null> => {
  try {
    const fh = await handle.getFileHandle(name, { create: false })
    return await fh.getFile()
  } catch (error) {
    if (errorName(error) === 'NotFoundError') {
      return null
    }
    throw error
  }
}

/**
 * 1 件のディレクトリエントリを ReviewMdCandidate に解決する。
 * `*-<16桁hex>-review.md` パターンに一致しない場合や、列挙中の削除等で読み取り不能な場合は null。
 */
const resolveReviewMdCandidate = async (
  handle: FsDirectoryHandle,
  entry: FsEntry
): Promise<ReviewMdCandidate | null> => {
  if (entry.kind !== 'file') {
    return null
  }
  const parsed = parseReviewMdFilename(entry.name)
  if (!parsed) {
    return null
  }
  const file = await tryReadCandidateFile(handle, entry.name)
  if (!file) {
    return null
  }
  return { ...parsed, file, name: entry.name }
}

/** Watch folder ディレクトリ内の `*-review.md` から mtime 最新のものを選ぶ。1 件も無ければ null */
const findLatestReviewMd = async (handle: FsDirectoryHandle): Promise<ReviewMdCandidate | null> => {
  let best: ReviewMdCandidate | null = null
  for await (const entry of handle.values()) {
    const candidate = await resolveReviewMdCandidate(handle, entry)
    if (candidate && isNewerCandidate(candidate, best)) {
      best = candidate
    }
  }
  return best
}

/** ワークスペースから最新の *-review.md を読み、命名規約由来の mdFileName と本文ハッシュも返す */
const readWorkspaceInput = async (handle: FsDirectoryHandle): Promise<WorkspaceInput | null> => {
  const candidate = await findLatestReviewMd(handle)
  if (!candidate) {
    return null
  }
  const text = await candidate.file.text()
  const hash = await runtime().hashStr(text)
  return { hash, mdFileName: candidate.mdFileName, text }
}

/**
 * 新版 *-review.md を取り込んでよいかユーザーに確認する。
 * 取り込み対象の docHash と現在の state.docHash を比較して分岐する:
 *   - 同じ docHash の再取り込み → 無音許可（差分なし）
 *   - markdown 未ロード（初回） → 無音許可
 *   - 別 docHash + ロード済み → 確認ダイアログ
 * これにより、埋め込み HTML 等で先に markdown をロードした状態で別 hash の
 * `*-review.md` が見つかったケース（古い .md による意図しない上書き）を防ぐ。
 * declinedHash 一致は静かに却下し、同じ内容で繰り返し聞かない。
 */
const confirmWorkspaceReload = async (hash: string): Promise<boolean> => {
  if (hash === wsState.declinedHash) {
    return Promise.resolve(false)
  }
  const { docHash, markdown } = runtime().state
  if (!markdown || hash === docHash) {
    return Promise.resolve(true)
  }
  return confirmDialog(
    'Load the new review version?',
    'A *-review.md with a different docHash was found in the watched folder. ' +
      'The currently displayed content will be replaced. ' +
      'Existing comments stay attached to the previous version.'
  )
}

/** 取り込み差分の確定フロー。拒否時は hash を控え、同じ内容では再確認しない */
const loadWorkspaceInput = async ({ hash, mdFileName, text }: WorkspaceInput): Promise<void> => {
  const confirmed = await confirmWorkspaceReload(hash)
  if (!confirmed) {
    wsState.declinedHash = hash
    return
  }
  wsState.declinedHash = null
  wsState.lastHash = hash
  wsState.lastMdFileName = mdFileName
  const docName = `${mdFileName}.md`
  await runtime().loadFromMarkdown(docName, text)
  runtime().toast(`Loaded ${docName}`)
}

/**
 * ポーリング失敗時のエラー分岐。
 * - NotAllowedError: 権限剥奪 → 無音で停止（ユーザーには UI の Reconnect で気づかせる）。
 * - その他: 想定外なので監視を止めて通知する。
 *   ※ NotFoundError 相当（ファイル無し）は readWorkspaceInput が null を返すので、ここには到達しない。
 */
const handleWsPollError = (error: unknown): void => {
  wsStopWatching()
  updateWsUI()
  if (errorName(error) !== 'NotAllowedError') {
    runtime().toast('Workspace watch stopped')
  }
}

const pollWorkspaceInput = async (handle: FsDirectoryHandle): Promise<void> => {
  const input = await readWorkspaceInput(handle)
  if (!input || input.hash === wsState.lastHash) {
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
      'File System Access API is not supported',
      'Use Chrome, Edge, or another Chromium-based browser to enable folder watching.'
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

/**
 * 現在の state からファイル命名規約 §8 に従う feedback.json のファイル名を導出する。
 * docName から拡張子を除いて mdFileName とし、現在の docHash と組み合わせる。
 * docName / docHash が未確定なら null（呼び出し側で抑止）。
 */
const resolveFeedbackFilename = (): string | null => {
  const { state } = runtime()
  if (!state.docName || !state.docHash) {
    return null
  }
  return deriveFeedbackJsonName(stripMarkdownExt(state.docName), state.docHash)
}

/**
 * ワークスペースに <mdFileName>-<docHash>-feedback.json を書き出す。
 * ファイルが無ければ作成、あれば上書き。書き出したファイル名を返す（finishWsSend で表示に使う）。
 */
const writeWorkspaceFeedback = async (
  handle: FsDirectoryHandle,
  filename: string
): Promise<void> => {
  const fh = await handle.getFileHandle(filename, { create: true })
  const writable = await fh.createWritable()
  await writable.write(JSON.stringify(runtime().buildExportPayload(), null, 2))
  await writable.close()
}

/** Write 成功時のトーストとステータスバー更新 */
const finishWsSend = (filename: string): void => {
  const app = runtime()
  app.toast(`Wrote ${filename} · ${app.commentCountLabel()}`)
  app.qs('#status').textContent = `${app.state.docName} · ${filename} written`
}

/** wsSend の前段：本文・docHash 等の前提を確認し、書き出すべきファイル名を返す。前提不成立なら null */
const wsSendFilename = (): string | null => {
  if (!runtime().state.markdown) {
    runtime().toast('Nothing to write')
    return null
  }
  const filename = resolveFeedbackFilename()
  if (!filename) {
    runtime().toast('Nothing to write')
    return null
  }
  return filename
}

/** Write ボタン押下時：ワークスペースに feedback.json を書き出す。ハンドル無し or 本文無しは無音で中止 */
export const wsSend = async (): Promise<void> => {
  const { handle } = wsState
  if (!handle) {
    return
  }
  const filename = wsSendFilename()
  if (!filename) {
    return
  }
  try {
    await writeWorkspaceFeedback(handle, filename)
    finishWsSend(filename)
  } catch {
    runtime().toast('Write failed')
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

/** wsState 上の切断時クリア対象をひとまとめにする。Watch folder 切断・テストリセット双方から呼ぶ */
const clearWsState = (): void => {
  wsState.declinedHash = null
  wsState.handle = null
  wsState.lastHash = null
  wsState.lastMdFileName = null
}

/** 明示的に切断。確認ダイアログを挟み、その後ポーリング停止＋state クリア＋永続化削除を順に実施 */
const disconnectWorkspace = async (handle: FsDirectoryHandle): Promise<void> => {
  const confirmed = await confirmDialog(
    `Stop watching “${handle.name}”?`,
    'Comments stay in your browser. You can reconnect this folder anytime.'
  )
  if (!confirmed) {
    return
  }
  wsStopWatching()
  clearWsState()
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
  clearWsState()
  wsState.polling = false
  wsState.timer = null
}

const unwritableFileHandleForTest = (): FsFileHandle => ({
  createWritable: async (): Promise<FsWritableStream> => Promise.reject(new Error('not expected')),
  getFile: async (): Promise<File> => Promise.reject(new Error('not expected')),
})

// Generator body に少なくとも 1 つ yield を含めて require-yield をクリアしつつ、
// 空配列で iterate するため実際には 1 度も yield されない（空 async iterator になる）。
const asyncIterFromList = async function* asyncIterFromList<Item>(
  items: Item[]
): AsyncIterableIterator<Item> {
  for (const item of items) {
    yield item
  }
}

const emptyEntriesForTest = (): AsyncIterableIterator<FsEntry> => asyncIterFromList<FsEntry>([])

const makeReviewMdCandidateForTest = (
  name: string,
  lastModified: number,
  docHash = 'a1b2c3d4e5f6a7b8'
): ReviewMdCandidate => ({
  docHash,
  file: {
    lastModified,
    text: async (): Promise<string> => Promise.resolve(''),
  },
  mdFileName: name.replace(/-[0-9a-f]{16}-review\.md$/, ''),
  name,
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
    it('markdown 未ロードの初回取り込みは確認なしで許可する', async () => {
      configureWorkspace(
        workspaceRuntimeForTest({
          comments: [],
          docHash: null,
          docName: null,
          markdown: '',
        })
      )

      await expect(confirmWorkspaceReload('new-hash00000000')).resolves.toBe(true)
    })

    it('同じ docHash の再取り込みは確認なしで許可する', async () => {
      configureWorkspace(
        workspaceRuntimeForTest({
          comments: [workspaceCommentForTest('c1')],
          docHash: 'samehash00000000',
          docName: 'review.md',
          markdown: '# Review',
        })
      )

      await expect(confirmWorkspaceReload('samehash00000000')).resolves.toBe(true)
    })

    it('拒否済み hash は再確認せず拒否する', async () => {
      configureWorkspace(
        workspaceRuntimeForTest({
          comments: [workspaceCommentForTest('c1')],
          docHash: 'currenthash00000',
          docName: 'review.md',
          markdown: '# Review',
        })
      )
      wsState.declinedHash = 'declinedhash0000'

      await expect(confirmWorkspaceReload('declinedhash0000')).resolves.toBe(false)
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
        values: emptyEntriesForTest,
      }

      configureWorkspace(workspaceRuntimeForTest())
      wsState.handle = handle
      wsState.polling = true

      await wsPollOnce()
      expect(reads).toBe(0)
    })
  })

  describe('writeWorkspaceFeedback', () => {
    // state.docName='review.md' + state.docHash='testhash00000000' → 命名規約の filename
    const expectedFilename = 'review-testhash00000000-feedback.json'

    it('<mdFileName>-<docHash>-feedback.json に export payload を JSON として書き出す', async () => {
      let written = ''
      let closed = false
      const handle: FsDirectoryHandle = {
        getFileHandle: async (name, options): Promise<FsFileHandle> => {
          expect(name).toBe(expectedFilename)
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
        values: emptyEntriesForTest,
      }

      configureWorkspace(
        workspaceRuntimeForTest({
          comments: [workspaceCommentForTest('c1')],
          docHash: 'testhash00000000',
          docName: 'review.md',
          markdown: '# Review',
        })
      )

      await writeWorkspaceFeedback(handle, expectedFilename)
      expect(JSON.parse(written)).toEqual(runtime().buildExportPayload())
      expect(closed).toBe(true)
    })
  })

  describe('resolveFeedbackFilename', () => {
    it('docName と docHash からファイル命名規約どおりの filename を組み立てる', () => {
      configureWorkspace(
        workspaceRuntimeForTest({
          comments: [],
          docHash: 'a1b2c3d4e5f6a7b8',
          docName: 'spec.md',
          markdown: '# Spec',
        })
      )
      expect(resolveFeedbackFilename()).toBe('spec-a1b2c3d4e5f6a7b8-feedback.json')
    })

    it('docName が .markdown 拡張子でも除去して組み立てる', () => {
      configureWorkspace(
        workspaceRuntimeForTest({
          comments: [],
          docHash: 'a1b2c3d4e5f6a7b8',
          docName: 'notes.markdown',
          markdown: '# Notes',
        })
      )
      expect(resolveFeedbackFilename()).toBe('notes-a1b2c3d4e5f6a7b8-feedback.json')
    })

    it('docHash 未確定なら null（書き出し抑止）', () => {
      configureWorkspace(
        workspaceRuntimeForTest({
          comments: [],
          docHash: null,
          docName: 'spec.md',
          markdown: '',
        })
      )
      expect(resolveFeedbackFilename()).toBeNull()
    })
  })

  describe('isNewerCandidate', () => {
    it('current が null なら必ず新しい候補を採用', () => {
      expect(
        isNewerCandidate(makeReviewMdCandidateForTest('a-aaaaaaaaaaaaaaaa-review.md', 100), null)
      ).toBe(true)
    })

    it('mtime が新しい候補を採用', () => {
      const older = makeReviewMdCandidateForTest('a-aaaaaaaaaaaaaaaa-review.md', 100)
      const newer = makeReviewMdCandidateForTest('a-bbbbbbbbbbbbbbbb-review.md', 200)
      expect(isNewerCandidate(newer, older)).toBe(true)
      expect(isNewerCandidate(older, newer)).toBe(false)
    })

    it('mtime が同じならファイル名昇順で安定化', () => {
      const ahead = makeReviewMdCandidateForTest('aaa-aaaaaaaaaaaaaaaa-review.md', 100)
      const behind = makeReviewMdCandidateForTest('bbb-bbbbbbbbbbbbbbbb-review.md', 100)
      expect(isNewerCandidate(ahead, behind)).toBe(true)
      expect(isNewerCandidate(behind, ahead)).toBe(false)
    })
  })
}
