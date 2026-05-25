// 出力先フォルダの handle 管理と `<mdFileName>-<docHash>-feedback.json` の書き出し。
// プロトコル詳細は DESIGN.md §8 を参照。
// FS Access API の低レベル wrapper は workspace-fs.ts に切り出し済み。
// 本ファイルは書き出し workflow とその公開 API に専念し、依存は全て直接 import する。

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
import {
  buildReviewExportPayload,
  commentCountLabel as formatCommentCount,
} from '../core/review-export'
import { deriveFeedbackJsonName, stripMarkdownExt } from '../core/embed'
import { markFeedbackUnsaved, markFeedbackWritten, state } from './app-state'
import { qs, toast } from './dom-utils'
import type { ExportPayload } from '../core/types'
import { renderComments } from './comments'

const buildExportPayload = (): ExportPayload => buildReviewExportPayload(state)

const commentCountLabel = (): string => formatCommentCount(state.comments.length)

/**
 * 出力先フォルダ表示の更新。Write feedback.json ボタンの tooltip にだけ反映する。
 * ボタン本体テキストは常に "Write feedback.json" 固定で、状態の発見性は tooltip / toast に寄せる。
 */
const refreshSendButtonTooltip = (): void => {
  const sendBtn = qs('#btn-send')
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
  await writable.write(JSON.stringify(buildExportPayload(), null, 2))
  await writable.close()
}

/** Write 成功時の toast と status bar を一括更新し、dirty 状態をクリアする */
const finishWrite = (folderName: string, filename: string): void => {
  toast(`Wrote ${folderName}/${filename} · ${commentCountLabel()}`)
  qs('#status').textContent = `${state.docName} · ${folderName}/${filename} written`
  markFeedbackWritten()
  renderComments()
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
  if (!state.markdown) {
    toast('Nothing to write')
    return null
  }
  const filename = resolveFeedbackFilename()
  if (!filename) {
    toast('Nothing to write')
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
    toast('Write failed')
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
  markFeedbackUnsaved()
  renderComments()
  toast(`Output folder set to “${picked.name}”`)
}

const resetWorkspaceForTest = (): void => {
  wsState.handle = null
}

if (import.meta.vitest) {
  const { afterEach, beforeEach, describe, expect, it } = import.meta.vitest

  // state は app-state.ts の mutable singleton。テスト用に直接書き換えるため、
  // 各 it の前後で関連フィールドを退避・復元して相互干渉を防ぐ。
  const snapshot = {
    comments: state.comments,
    docHash: state.docHash,
    docName: state.docName,
    markdown: state.markdown,
  }

  beforeEach(() => {
    resetWorkspaceForTest()
    snapshot.comments = state.comments
    snapshot.docHash = state.docHash
    snapshot.docName = state.docName
    snapshot.markdown = state.markdown
  })

  afterEach(() => {
    resetWorkspaceForTest()
    state.comments = snapshot.comments
    state.docHash = snapshot.docHash
    state.docName = snapshot.docName
    state.markdown = snapshot.markdown
  })

  describe('writeFeedbackToHandle', () => {
    const expectedFilename = 'review-testhash00000000-feedback.json'

    it('<mdFileName>-<docHash>-feedback.json に export payload を JSON として書き出す', async () => {
      state.comments = []
      state.docHash = 'testhash00000000'
      state.docName = 'review.md'
      state.markdown = '# Review'

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

      await writeFeedbackToHandle(handle, expectedFilename)
      // exportedAt は呼び出しごとに ms 単位で変動するため個別フィールドで検証する
      expect(JSON.parse(written)).toMatchObject({
        comments: [],
        docHash: 'testhash00000000',
        document: 'review.md',
      })
      expect(closed).toBe(true)
    })
  })

  describe('resolveFeedbackFilename', () => {
    it('docName と docHash からファイル命名規約どおりの filename を組み立てる', () => {
      state.docHash = 'a1b2c3d4e5f6a7b8'
      state.docName = 'spec.md'
      state.markdown = '# Spec'
      expect(resolveFeedbackFilename()).toBe('spec-a1b2c3d4e5f6a7b8-feedback.json')
    })

    it('docName が .markdown 拡張子でも除去して組み立てる', () => {
      state.docHash = 'a1b2c3d4e5f6a7b8'
      state.docName = 'notes.markdown'
      state.markdown = '# Notes'
      expect(resolveFeedbackFilename()).toBe('notes-a1b2c3d4e5f6a7b8-feedback.json')
    })

    it('docHash 未確定なら null（書き出し抑止）', () => {
      state.docHash = null
      state.docName = 'spec.md'
      state.markdown = ''
      expect(resolveFeedbackFilename()).toBeNull()
    })
  })
}
