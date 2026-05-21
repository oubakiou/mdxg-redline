// 出力先フォルダの handle 管理と `<mdFileName>-<docHash>-feedback.json` の書き出し。
// プロトコル詳細は DESIGN.md §8 を参照。
// FS Access API の低レベル wrapper は workspace-fs.ts に切り出し済み。
// 本ファイルは runtime (UI / app state) に依存する書き出し workflow とその公開 API に専念する。

import type { Comment, ExportComment, ExportPayload } from '../core/types'
import {
  type FsDirectoryHandle,
  type FsFileHandle,
  type FsPermissionState,
  type FsWritableStream,
  getOutputFolderName,
  persistWorkspaceHandle,
  pickOutputFolder,
  reuseExistingHandle,
  safelyStoredHandle,
  wsState,
  wsSupported,
} from './workspace-fs'
import { deriveFeedbackJsonName, stripMarkdownExt } from '../core/embed'

interface WorkspaceRuntime {
  buildExportPayload: () => ExportPayload
  commentCountLabel: () => string
  onFeedbackWritten: () => void
  onOutputFolderChanged: () => void
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

interface SendButtonControls {
  sendBtn: HTMLElement
}

const sendButtonControls = (): SendButtonControls => ({
  sendBtn: runtime().qs('#btn-send'),
})

/**
 * 出力先フォルダ表示の更新。Write feedback.json ボタンの tooltip にだけ反映する。
 * ボタン本体テキストは常に "Write feedback.json" 固定で、状態の発見性は tooltip / toast に寄せる。
 */
const refreshSendButtonTooltip = (): void => {
  const { sendBtn } = sendButtonControls()
  const name = getOutputFolderName()
  if (name === null) {
    sendBtn.setAttribute(
      'data-tooltip',
      'Choose an output folder and write the current feedback there'
    )
    return
  }
  sendBtn.setAttribute('data-tooltip', `Write feedback.json into “${name}”`)
}

/**
 * 起動時に保存済みハンドルがあれば in-memory に復元する（権限の自動要求はしない）。
 * 失敗・未保存・API 非対応はすべて false で安全側に倒す。
 * UI ボタンのテキストは常時固定なので、ここでは tooltip だけ更新する。
 */
export const restoreWorkspaceHandle = async (): Promise<boolean> => {
  if (!wsSupported()) {
    refreshSendButtonTooltip()
    return false
  }
  const handle = await safelyStoredHandle()
  if (handle) {
    wsState.handle = handle
  }
  refreshSendButtonTooltip()
  return handle !== null
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
 * 指定ハンドルに <filename> を作成して export payload を書き出す。
 * ファイルが無ければ作成、あれば上書き。例外は呼び出し側で fail-soft 処理する。
 */
const writeFeedbackToHandle = async (
  handle: FsDirectoryHandle,
  filename: string
): Promise<void> => {
  const fh = await handle.getFileHandle(filename, { create: true })
  const writable = await fh.createWritable()
  await writable.write(JSON.stringify(runtime().buildExportPayload(), null, 2))
  await writable.close()
}

/** Write 成功時の toast と status bar を一括更新し、dirty 状態をクリアする */
const finishWrite = (folderName: string, filename: string): void => {
  const app = runtime()
  app.toast(`Wrote ${folderName}/${filename} · ${app.commentCountLabel()}`)
  app.qs('#status').textContent = `${app.state.docName} · ${folderName}/${filename} written`
  app.onFeedbackWritten()
}

/** ピッカーで取得したハンドルを wsState と IDB に反映し、tooltip を更新する */
const adoptPickedHandle = async (picked: FsDirectoryHandle): Promise<void> => {
  wsState.handle = picked
  await persistWorkspaceHandle(picked)
  refreshSendButtonTooltip()
}

/**
 * 「現在使えるハンドル」を返す。状態に応じて以下のいずれか：
 * - 既存ハンドルが使える → そのまま返す
 * - 既存ハンドルの権限が失効していて再許可も拒否 → ピッカーで選び直す
 * - ハンドルが無い → ピッカーで新規取得
 * 取得したハンドルは IDB へ永続化し、wsState に格納する。Cancel 時は null。
 */
const acquireUsableHandle = async (): Promise<FsDirectoryHandle | null> => {
  const existing = await reuseExistingHandle()
  if (existing) {
    return existing
  }
  const picked = await pickOutputFolder()
  if (!picked) {
    return null
  }
  await adoptPickedHandle(picked)
  return picked
}

/** 書き出し可能な前提が揃っていれば feedback.json の filename を返す。未確定なら toast を出して null */
const ensureWritableFilename = (): string | null => {
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

/**
 * ハンドルが無効化していた等で 1 度目の書き出しが失敗した時のリトライ。
 * ピッカーを再表示し、新しいハンドルで再書き出しを試みる。
 * Cancel・非対応ブラウザは pickOutputFolder 側で説明済みなのでここでは無音。
 * 再書き出し自体が失敗した場合のみ "Write failed" toast を出す。
 */
const retryWriteAfterFailure = async (filename: string): Promise<void> => {
  const fresh = await pickOutputFolder()
  if (!fresh) {
    return
  }
  await adoptPickedHandle(fresh)
  try {
    await writeFeedbackToHandle(fresh, filename)
    finishWrite(fresh.name, filename)
  } catch {
    runtime().toast('Write failed')
  }
}

export const writeFeedback = async (): Promise<void> => {
  const filename = ensureWritableFilename()
  if (!filename) {
    return
  }
  const handle = await acquireUsableHandle()
  if (!handle) {
    return
  }
  try {
    await writeFeedbackToHandle(handle, filename)
    finishWrite(handle.name, filename)
  } catch {
    await retryWriteAfterFailure(filename)
  }
}

/**
 * 既存ハンドルがあっても無条件でピッカーを開いてフォルダを差し替える。
 * 同フォルダを選び直しても害は無いので Cancel 以外は常に差し替える。
 */
export const changeOutputFolder = async (): Promise<void> => {
  const picked = await pickOutputFolder()
  if (!picked) {
    return
  }
  wsState.handle = picked
  await persistWorkspaceHandle(picked)
  refreshSendButtonTooltip()
  runtime().onOutputFolderChanged()
  runtime().toast(`Output folder set to “${picked.name}”`)
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
  commentCountLabel: (): string => `${String(state.comments.length)} comments`,
  onFeedbackWritten: (): void => {
    // test no-op
  },
  onOutputFolderChanged: (): void => {
    // test no-op
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
  wsState.handle = null
}

if (import.meta.vitest) {
  const { afterEach, beforeEach, describe, expect, it } = import.meta.vitest

  beforeEach(() => {
    resetWorkspaceForTest()
  })

  afterEach(() => {
    resetWorkspaceForTest()
  })

  describe('writeFeedbackToHandle', () => {
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

      await writeFeedbackToHandle(handle, expectedFilename)
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
}
