// DOM エントリポイント。純粋ロジックや外部境界は markdown / feedback / selection /
// workspace / boot に分け、workspace と boot には runtime を注入して循環 import を避ける。

import { type BlockAnchor, buildBlockAnchors, renderMarkdown } from './markdown'
import type { Comment, DocumentSnapshot, ExportPayload, PendingSelection } from './types'
import { buildDomRange, getSelectionInfo } from './selection'
import { buildReviewExportPayload, commentCountLabel as formatCommentCount } from './review-export'
import { commentsFromStored, parsePendingSelection } from './feedback'
import { configureWorkspace, handleWatchClick, wsSend } from './workspace'
import { Store } from './storage'
import { boot } from './boot'
import { createSidebar } from './sidebar'
import { wireToolbar } from './toolbar'

// --- Types ------------------------------------------------------------------

interface MarkableRange {
  endNode: Text
  range: Range
  startNode: Text
}

type SelectionInfo = NonNullable<ReturnType<typeof getSelectionInfo>>

// --- State ------------------------------------------------------------------
/**
 * アプリ全体の現在状態。レンダリング・保存・サイドバー描画はすべてこの 1 箇所を参照する単一の真の源として扱う。
 * docHash は markdown 本文の SHA-256 先頭 8 バイト hex で、保存キーや workspace 取り込みの版差分検知に用いる。
 */
export const state: {
  blockAnchors: Map<string, BlockAnchor>
  blockOriginalHTML: Map<string, string>
  comments: Comment[]
  docHash: string | null
  docName: string | null
  markdown: string
} = {
  blockAnchors: new Map(),
  blockOriginalHTML: new Map(),
  comments: [],
  docHash: null,
  docName: null,
  markdown: '',
}

// --- Utils ------------------------------------------------------------------
/**
 * `document.querySelector` の薄いエイリアス。本ファイルでは全箇所これ経由でアクセスする。
 * セレクタが必ず存在する前提のアプリ仕様なので、見つからなければ throw して気付かせる。
 */
export const qs = (selector: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(selector)
  if (!el) {
    throw new Error(`Element not found: ${selector}`)
  }
  return el
}

/** `qs` の input/textarea 版。`.value` `.focus()` 等を型安全に取りに行く */
const qsInput = (selector: string): HTMLInputElement | HTMLTextAreaElement => {
  const el = qs(selector)
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
    throw new Error(`Element ${selector} is not an input or textarea`)
  }
  return el
}

/** 8 文字の base36 ランダム ID。コメント等の一過性 ID として使う（衝突確率は実用上問題にならない範囲を想定） */
const uid = (): string => Math.random().toString(36).slice(2, 10)

/** SHA-256 の先頭 8 バイトを hex で返す。docHash として保存キー・ワークスペース差分検知に使う（短く比較しやすいことを優先） */
export const hashStr = async (str: string): Promise<string> => {
  const buf = new TextEncoder().encode(str)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(hash)]
    .slice(0, 8)
    .map((byte): string => byte.toString(16).padStart(2, '0'))
    .join('')
}

// toast の解除タイマー。関数静的プロパティを使わず、モジュールスコープで型安全に保持する。
let toastTimer: ReturnType<typeof setTimeout> | null = null

/** 1.8 秒で消える短時間トースト。連続呼び出しは前回の解除タイマーを潰して上書きする */
export const toast = (msg: string): void => {
  const toastEl = qs('#toast')
  toastEl.textContent = msg
  toastEl.classList.add('show')
  if (toastTimer !== null) {
    clearTimeout(toastTimer)
  }
  toastTimer = setTimeout((): void => toastEl.classList.remove('show'), 1800)
}

// ダイアログ層（confirmDialog / noticeDialog ほか）は ./dialog に切り出している。
// スクロール層（smoothScrollToCenter ほか）は ./scroll に切り出している。

// --- Render markdown --------------------------------------------------------

/**
 * 指定 Range を `<mark class="cmt">` で囲む。
 * 単一テキストノード内なら surroundContents、ノードまたぎなら extractContents+insertNode で対応する。
 * surroundContents は要素境界をまたぐと例外を投げるため try/catch でフォールバック扱いにする（その mark のみスキップ）。
 */
const wrapRangeWithMark = (domRange: MarkableRange, commentId: string): void => {
  const { endNode, range, startNode } = domRange
  const mark = document.createElement('mark')
  mark.className = 'cmt'
  mark.dataset.commentId = commentId
  try {
    if (startNode === endNode) {
      range.surroundContents(mark)
    } else {
      const contents = range.extractContents()
      mark.appendChild(contents)
      range.insertNode(mark)
    }
  } catch {
    // Fallback: skip this mark if range crosses element boundaries awkwardly
  }
}

/** 1 件のコメントに対応する mark を該当ブロック上に貼る。Range 構築失敗時は何もしない（fail-soft） */
const applyMark = (blockEl: Element, comment: Comment): void => {
  const built = buildDomRange(blockEl, comment)
  if (!built) {
    return
  }
  wrapRangeWithMark(built, comment.id)
}

/** state.comments を blockId キーでグルーピングする。再描画時にブロック単位でまとめて処理するための前処理 */
const commentsGroupedByBlock = (): Map<string, Comment[]> => {
  const byBlock = new Map<string, Comment[]>()
  for (const comment of state.comments) {
    const bucket = byBlock.get(comment.blockId)
    if (bucket) {
      bucket.push(comment)
    } else {
      byBlock.set(comment.blockId, [comment])
    }
  }
  return byBlock
}

/**
 * 同一ブロック内のコメントを startOffset の降順で並べる。
 * 後ろから mark を貼ることで、前方への挿入による以降のオフセットずれを回避する。
 */
const sortedBlockComments = (byBlock: Map<string, Comment[]>, blockId: string): Comment[] =>
  [...(byBlock.get(blockId) || [])].toSorted(
    (left, right): number => right.startOffset - left.startOffset
  )

/** ブロック内 HTML を原状復帰してから、そのブロックに紐づく全コメントの mark を貼り直す */
const applyMarksForBlock = ({
  blockId,
  byBlock,
  doc,
  original,
}: {
  blockId: string
  byBlock: Map<string, Comment[]>
  doc: Element
  original: string
}): void => {
  const el = doc.querySelector(`[data-block-id="${blockId}"]`)
  if (!el) {
    return
  }
  el.innerHTML = original
  for (const comment of sortedBlockComments(byBlock, blockId)) {
    applyMark(el, comment)
  }
}

/**
 * すべてのブロックに対して mark を貼り直す。
 * コメントの追加・削除があるたび「キャッシュ済み原 HTML へ戻す → 全 mark 再生成」というラウンドトリップを取り、
 * 差分管理を避けて単純化している（コメント件数は実用上それほど多くならない想定）。
 */
export const reapplyAllMarks = (): void => {
  const doc = qs('#doc')
  const byBlock = commentsGroupedByBlock()
  for (const [bid, original] of state.blockOriginalHTML) {
    applyMarksForBlock({ blockId: bid, byBlock, doc, original })
  }
}

/** ドキュメントが未読込のときの表示。プレースホルダ #doc-wrap を見える状態に戻す */
const showEmptyDocument = (doc: HTMLElement, wrap: HTMLElement): void => {
  doc.innerHTML = ''
  wrap.style.display = 'block'
}

/**
 * トップレベルブロックに連番 ID を付け、原 HTML をキャッシュする。
 * 以降の mark 再適用ではこのキャッシュをベースに HTML を巻き戻すため、レンダリング直後に必ず呼ぶ必要がある。
 */
const cacheBlockOriginalHTML = (doc: HTMLElement): void => {
  state.blockOriginalHTML.clear()
  for (const [index, el] of [...doc.children].entries()) {
    if (el instanceof HTMLElement) {
      const id = `b${String(index + 1).padStart(3, '0')}`
      el.dataset.blockId = id
      state.blockOriginalHTML.set(id, el.innerHTML)
    }
  }
}

/** markdown を HTML 化して #doc に流し込み、ブロック原 HTML と markdown 上のアンカーを更新する */
const mountRenderedDoc = (doc: HTMLElement, wrap: HTMLElement): void => {
  wrap.style.display = 'none'
  doc.innerHTML = renderMarkdown(state.markdown)
  cacheBlockOriginalHTML(doc)
  state.blockAnchors = buildBlockAnchors(state.markdown)
}

/** markdown → HTML レンダリング、ブロック原 HTML キャッシュ、全 mark 再適用までを一括で行うパイプライン */
const renderDoc = (): void => {
  const doc = qs('#doc')
  const wrap = qs('#doc-wrap')
  if (!state.markdown) {
    state.blockAnchors.clear()
    showEmptyDocument(doc, wrap)
    return
  }
  mountRenderedDoc(doc, wrap)
  reapplyAllMarks()
}

// --- Selection -> floater ---------------------------------------------------

/** フローターの data-payload 属性に乗せるための保存可能サブセット。rect は実行時の DOM 位置なので含めない */
const selectionFloaterPayload = (info: SelectionInfo): string =>
  JSON.stringify({
    blockId: info.blockId,
    endOffset: info.endOffset,
    quote: info.quote,
    startOffset: info.startOffset,
  })

/** 選択 rect の上に floater を中央配置する。`Math.max(8, left)` で画面左端から最低 8px のマージンを確保 */
const positionFloater = (floater: HTMLElement, rect: DOMRect): void => {
  const top = rect.top - 42
  const left = rect.left + rect.width / 2 - floater.offsetWidth / 2
  floater.style.top = `${top}px`
  floater.style.left = `${Math.max(8, left)}px`
}

/** 選択状態に応じてフローターの表示/非表示と位置を更新する。selectionchange ハンドラから呼び出される */
const updateFloaterFromSelection = (): void => {
  const info = getSelectionInfo()
  const floater = qs('#floater')
  if (!info) {
    floater.style.display = 'none'
    return
  }
  floater.style.display = 'block'
  positionFloater(floater, info.rect)
  floater.dataset.payload = selectionFloaterPayload(info)
}

/**
 * 選択変更系イベントの共通ハンドラ。
 * 10ms 遅延させているのは、mouseup/keyup 直後に Selection オブジェクトが完全に確定する前に読みに行くと
 * range が空になるブラウザ挙動を避けるため。
 */
const onSelChange = (): void => {
  setTimeout(updateFloaterFromSelection, 10)
}

if (!import.meta.vitest) {
  document.addEventListener('mouseup', onSelChange)
  document.addEventListener('keyup', onSelChange)
}

// --- Modal ------------------------------------------------------------------

/**
 * コメント入力モーダルの状態。
 * pendingSelection に「どこに対するコメントか」の情報（blockId, offsets, quote）を保持し、
 * Save 時にこれを基準にコメントを生成する。Cancel/Esc で必ず null へ戻すこと（誤コミット防止）。
 */
const modalState: { pendingSelection: PendingSelection | null } = {
  pendingSelection: null,
}

/** 選択範囲を保留状態にセットしてモーダルを開く。focus は CSS transition 後を狙って 50ms 遅延 */
const openModal = (sel: PendingSelection): void => {
  modalState.pendingSelection = sel
  qs('#modal-quote').textContent = `“${sel.quote}”`
  qsInput('#modal-input').value = ''
  qs('#modal').classList.add('open')
  setTimeout((): void => qsInput('#modal-input').focus(), 50)
}

/** モーダルを閉じ、pendingSelection をクリアして次回開閉時の漏洩を防ぐ */
const closeModal = (): void => {
  qs('#modal').classList.remove('open')
  modalState.pendingSelection = null
}

// --- Action menu (Comments dropdown) ----------------------------------------

/** Comments ドロップダウンを開く。aria-expanded も同期して支援技術にも状態を伝える */
const openCommentsMenu = (): void => {
  qs('#menu-comments').classList.add('open')
  qs('#btn-comments-menu').setAttribute('aria-expanded', 'true')
}

/** Comments ドロップダウンを閉じる（Esc / 外側クリック / メニュー項目クリックの後始末から共通利用） */
const closeCommentsMenu = (): void => {
  qs('#menu-comments').classList.remove('open')
  qs('#btn-comments-menu').setAttribute('aria-expanded', 'false')
}

// --- Persistence ------------------------------------------------------------

/**
 * 現在の state を docHash 単位で保存する（キー: `doc:<docHash>`）。
 * docHash 未確定（ドキュメント未読込）の場合は何もしない。
 * 同じ markdown は同じハッシュになるため、ドキュメント本文ベースでコメントを復元できる。
 */
export const save = async (): Promise<void> => {
  if (!state.docHash) {
    return
  }
  const payload: DocumentSnapshot = {
    comments: state.comments,
    markdown: state.markdown,
    name: state.docName,
    updated: new Date().toISOString(),
  }
  await Store.set(`doc:${state.docHash}`, payload)
  qs('#status').textContent = `${state.docName} · saved`
}

// --- Sidebar ----------------------------------------------------------------

const sidebar = createSidebar({
  qs,
  reapplyAllMarks,
  save,
  state,
  toast,
})

/** サイドバー全体を再描画。コメントの追加・削除・読み込み後に呼ぶ単一エントリポイント */
export const renderSidebar = (): void => sidebar.render()

/** ステータスバーの「loaded/restored」サフィックス。コメントが復元できたかでラベルを切り替える */
const loadStatusLabel = (): string => {
  if (state.comments.length > 0) {
    return 'restored'
  }
  return 'loaded'
}

/**
 * markdown 本文を取り込んで state を構築・描画・ステータス更新する中心ルーチン。
 * 同じ markdown を再読込しても docHash が変わらないため、Store から以前のコメントを復元できる。
 */
export const loadFromMarkdown = async (name: string, text: string): Promise<void> => {
  state.docName = name
  state.markdown = text
  state.docHash = await hashStr(text)
  // Restore prior comments if any
  const saved = await Store.get(`doc:${state.docHash}`)
  state.comments = commentsFromStored(saved)
  renderDoc()
  renderSidebar()
  qs('#status').textContent = `${name} (${state.docHash}) · ${loadStatusLabel()}`
}

// --- Modal / Menu event listeners -------------------------------------------

/** 保留中の選択範囲と本文からコメントオブジェクトを組み立てる純粋関数 */
const commentFromSelection = (selection: PendingSelection, body: string): Comment => ({
  blockId: selection.blockId,
  comment: body,
  created: new Date().toISOString(),
  endOffset: selection.endOffset,
  id: uid(),
  quote: selection.quote,
  startOffset: selection.startOffset,
})

/**
 * モーダルの「Save」ボタン押下時の処理。
 * 本文空 or 保留選択 null の場合は無視（誤コミット防止）。保存後に modal を閉じる前後で副作用を一通り回す。
 */
const saveModalComment = async (): Promise<void> => {
  const body = qsInput('#modal-input').value.trim()
  const selection = modalState.pendingSelection
  if (!body || !selection) {
    return
  }
  state.comments.push(commentFromSelection(selection, body))
  await save()
  reapplyAllMarks()
  renderSidebar()
  closeModal()
  toast('Comment added')
}

if (!import.meta.vitest) {
  qs('#floater').addEventListener('mousedown', (event): void => {
    event.preventDefault()
    const floater = qs('#floater')
    const { payload } = floater.dataset
    if (!payload) {
      return
    }
    const parsed = parsePendingSelection(payload)
    if (!parsed) {
      return
    }
    openModal(parsed)
    floater.style.display = 'none'
  })
  qs('#modal-cancel').addEventListener('click', closeModal)
  qs('#modal').addEventListener('click', (event): void => {
    const { target } = event
    if (target instanceof HTMLElement && target.id === 'modal') {
      closeModal()
    }
  })
  qs('#modal-save').addEventListener('click', async (): Promise<void> => saveModalComment())
  document.addEventListener('keydown', (event): void => {
    if (event.key === 'Escape') {
      closeModal()
      closeCommentsMenu()
    }
    if (
      event.key === 'Enter' &&
      (event.metaKey || event.ctrlKey) &&
      qs('#modal').classList.contains('open')
    ) {
      qs('#modal-save').click()
    }
  })
  qs('#btn-comments-menu').addEventListener('click', (event): void => {
    event.stopPropagation()
    if (qs('#menu-comments').classList.contains('open')) {
      closeCommentsMenu()
    } else {
      openCommentsMenu()
    }
  })
  qs('#menu-comments').addEventListener(
    'click',
    (event): void => {
      const { target } = event
      if (target instanceof Element && target.closest('.menu-item')) {
        closeCommentsMenu()
      }
    },
    true
  )
  document.addEventListener('click', (event): void => {
    if (!qs('#menu-comments').classList.contains('open')) {
      return
    }
    const { target } = event
    if (
      target instanceof Element &&
      (target.closest('#menu-comments') || target.closest('#btn-comments-menu'))
    ) {
      return
    }
    closeCommentsMenu()
  })
}

// Click on mark → highlight sidebar
/** 本文側 mark のクリックで対応するサイドバーカードをアクティブ化＋画面中央へスクロール */
const activateMark = (mark: HTMLElement): void => sidebar.activateMark(mark)

if (!import.meta.vitest) {
  document.addEventListener('click', (event): void => {
    const { target } = event
    if (!(target instanceof Element)) {
      return
    }
    const mark = target.closest('mark.cmt')
    if (!(mark instanceof HTMLElement)) {
      return
    }
    activateMark(mark)
  })
}

// --- Toolbar actions --------------------------------------------------------

export const buildExportPayload = (): ExportPayload => buildReviewExportPayload(state)

export const commentCountLabel = (): string => formatCommentCount(state.comments.length)

if (!import.meta.vitest) {
  wireToolbar({
    buildExportPayload,
    commentCountLabel,
    loadFromMarkdown,
    qs,
    qsInput,
    reapplyAllMarks,
    renderSidebar,
    save,
    state,
    toast,
  })
}

// --- Workspace mode wiring --------------------------------------------------
// 実装本体は ./workspace に切り出している。ここでは Watch / Send ボタンの
// イベント配線のみを担う（循環 import の TDZ を避けるため、DOM 取得は
// review.ts 側で行い、workspace.ts からはハンドラ関数のみ受け取る）。

configureWorkspace({
  buildExportPayload,
  commentCountLabel,
  hashStr,
  loadFromMarkdown,
  qs,
  state,
  toast,
})

if (!import.meta.vitest) {
  qs('#btn-watch').addEventListener('click', async (): Promise<void> => handleWatchClick())
  qs('#btn-send').addEventListener('click', wsSend)
}

// --- Boot trigger -----------------------------------------------------------
// 起動シーケンス本体は ./boot に切り出している。ここでは vitest を除いて
// 一度だけ boot() を発火させるだけにする（モジュール初期化時の TDZ を避けるため、
// review.ts 側で実行する）。

if (!import.meta.vitest) {
  boot({
    loadFromMarkdown,
    reapplyAllMarks,
    renderSidebar,
    save,
    state,
    store: Store,
    toast,
  }).catch((): void => toast('Startup failed'))
}

// テスト用のダミーコメント (id 以外は空の Comment)。
// テスト関数の外に置くのは consistent-function-scoping の警告を避けるため。
const dummyCommentForTest = (id: string): Comment => ({
  blockId: '',
  comment: '',
  created: '',
  endOffset: 0,
  id,
  quote: '',
  startOffset: 0,
})

/**
 * MARK: In-Source Testing
 * @example vp test skills/md-review-request/src/review.ts
 */

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest

  describe('loadStatusLabel (state 依存)', () => {
    it('コメント 0 件なら loaded', () => {
      const prev = state.comments
      state.comments = []
      try {
        expect(loadStatusLabel()).toBe('loaded')
      } finally {
        state.comments = prev
      }
    })

    it('コメント 1 件以上なら restored', () => {
      const prev = state.comments
      state.comments = [dummyCommentForTest('x')]
      try {
        expect(loadStatusLabel()).toBe('restored')
      } finally {
        state.comments = prev
      }
    })
  })

  describe('commentCountLabel (state 依存)', () => {
    it('1 件のときは単数形', () => {
      const prev = state.comments
      state.comments = [dummyCommentForTest('x')]
      try {
        expect(commentCountLabel()).toBe('1 comment')
      } finally {
        state.comments = prev
      }
    })

    it('0 件のときは複数形 (i18n 非対応の既知挙動)', () => {
      const prev = state.comments
      state.comments = []
      try {
        expect(commentCountLabel()).toBe('0 comments')
      } finally {
        state.comments = prev
      }
    })

    it('2 件以上のときは複数形', () => {
      const prev = state.comments
      state.comments = [
        dummyCommentForTest('a'),
        dummyCommentForTest('b'),
        dummyCommentForTest('c'),
      ]
      try {
        expect(commentCountLabel()).toBe('3 comments')
      } finally {
        state.comments = prev
      }
    })
  })

  describe('commentFromSelection', () => {
    it('選択範囲と本文から正しいコメントを組み立てる', () => {
      const selection = {
        blockId: 'b001',
        endOffset: 20,
        quote: '引用テキスト',
        startOffset: 10,
      }
      const result = commentFromSelection(selection, 'コメント本文')
      expect(result.blockId).toBe('b001')
      expect(result.startOffset).toBe(10)
      expect(result.endOffset).toBe(20)
      expect(result.quote).toBe('引用テキスト')
      expect(result.comment).toBe('コメント本文')
      expect(typeof result.id).toBe('string')
      expect(result.id.length).toBeGreaterThan(0)
      // created は ISO8601 形式のはず
      expect(result.created).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })

    it('id は呼び出しごとに異なる', () => {
      const sel = { blockId: 'b', endOffset: 1, quote: 'q', startOffset: 0 }
      const first = commentFromSelection(sel, 'x')
      const second = commentFromSelection(sel, 'x')
      expect(first.id).not.toBe(second.id)
    })
  })
}
