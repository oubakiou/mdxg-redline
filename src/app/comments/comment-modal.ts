// コメント入力モーダルの状態管理・イベント配線・保存処理。
// floater (#floater) クリックで起動し、保留中の選択範囲 (PendingSelection) を保持したまま
// 「Save」で state.comments に追加し、関連 UI を更新する。

import type { Comment, PendingSelection } from '../../core/types'
import { closeSearch, isSearchOpen } from '../search/search'
import { qs, qsInput, toast, uid } from '../dom/dom-utils'
import { parsePendingSelection } from '../../core/feedback'
import { reapplyAllMarks } from './mark-engine'
import { renderComments } from './comments'
import { setFloaterVisible } from './floater'
import { state } from '../state/app-state'
import { translate } from '../i18n/i18n-browser'

/**
 * コメント入力モーダルの状態を表す tagged union。
 * - `add`: 新規作成 (pendingSelection に「どこに対するコメントか」の情報を保持し Save 時にコメント生成)
 * - `edit`: 既存コメント編集 (editingCommentId に対象 id を保持し Save 時に本文のみ差し替え)
 * - `closed`: 閉状態 (Cancel / Esc 後の正常値)
 * add と edit は排他で、両者のフィールドを同時に持たないことを型で保証する (誤コミット防止)。
 */
type ModalState =
  | { kind: 'closed' }
  | { kind: 'add'; pendingSelection: PendingSelection }
  | { kind: 'edit'; editingCommentId: string }

// container 経由で current を差し替えることで、tagged union への全体置換と const 規約を両立させる
// (let を使うと prefer-const と衝突するため)。
const modalState: { current: ModalState } = { current: { kind: 'closed' } }

export const isCommentModalOpen = (): boolean => modalState.current.kind !== 'closed'

// modal open 直前の active 要素 (Edit ボタン / floater 起動時は <body> 等)。close 時の focus 復元に使う。
let lastTrigger: HTMLElement | null = null
// showModalWithBody が予約する 50ms 後の input focus timer。close 時に cancel しないと、footer に
// focus 復元した後で発火して非表示 input へ焦点を奪う (§4 Step 5b / Step 5c の search-controller と同 pattern)。
let pendingFocusTimer: ReturnType<typeof setTimeout> | null = null

// FOCUSABLE_SELECTOR は static-modal.ts:133-140 と統一。happy-dom はレイアウトを計算しないため
// size 依存判定は使わず、selector match + 祖先の display/visibility/inert で focusable を判定する。
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const captureLastTrigger = (): void => {
  const active = document.activeElement
  if (active instanceof HTMLElement) {
    lastTrigger = active
    return
  }
  lastTrigger = null
}

const cancelModalFocusTimer = (): void => {
  if (pendingFocusTimer !== null) {
    clearTimeout(pendingFocusTimer)
    pendingFocusTimer = null
  }
}

const isHiddenByStyle = (el: HTMLElement): boolean => {
  if (el.hasAttribute('inert')) {
    return true
  }
  const style = globalThis.getComputedStyle(el)
  if (style.display === 'none') {
    return true
  }
  return style.visibility === 'hidden' || style.visibility === 'collapse'
}

const isHiddenByAncestors = (el: HTMLElement): boolean => {
  let current: HTMLElement | null = el
  while (current) {
    if (isHiddenByStyle(current)) {
      return true
    }
    current = current.parentElement
  }
  return false
}

// `#floater` の mousedown が preventDefault するため (comment-modal.ts の wireCommentModal)、新規追加
// 経路では lastTrigger が <body> 等の非 focusable になりうる。要素自身が selector に match するかを
// 最初に確認することで <body> / tabindex なし <div> を除外する (§5.s)。
const isFocusable = (el: HTMLElement | null): boolean => {
  if (!el || !el.isConnected) {
    return false
  }
  if (!el.matches(FOCUSABLE_SELECTOR)) {
    return false
  }
  return !isHiddenByAncestors(el)
}

// saveEditedComment は renderComments() で cmt-list を再描画してから本関数経由で close するため、
// lastTrigger (= 旧 Edit ボタン) が detach される。同一 comment id の新 Edit ボタンを引き直す (§5.s)。
const findReplacementEditButton = (trigger: HTMLElement | null): HTMLElement | null => {
  if (!trigger) {
    return null
  }
  const card = trigger.closest('.cmt-card')
  if (!card) {
    return null
  }
  const commentId = card.getAttribute('data-id')
  if (!commentId) {
    return null
  }
  return document.querySelector<HTMLElement>(`.cmt-card[data-id="${commentId}"] .cmt-edit`)
}

// 最終フォールバック: mobile なら footer Comment button、desktop なら .doc-pane。CSS display:none の
// footer 配下 button を hidden 属性 selector では弾けないため matchMedia で明示分岐する (§5.s)。
const resolveFallbackTarget = (): HTMLElement | null => {
  const isMobile = globalThis.matchMedia('(max-width: 768px)').matches
  if (isMobile) {
    const footerBtn = document.getElementById('btn-mobile-comments')
    if (footerBtn instanceof HTMLElement) {
      return footerBtn
    }
  }
  return document.querySelector<HTMLElement>('.doc-pane')
}

// (a) trigger が isFocusable → 戻す、(b) 同一 comment id の新 Edit ボタン、(c) mobile footer / .doc-pane
// の 3 段階フォールバックで focus を復元する (§5.s)。
const restoreFocusAfterClose = (trigger: HTMLElement | null): void => {
  if (trigger && isFocusable(trigger)) {
    trigger.focus({ preventScroll: true })
    return
  }
  const newEditBtn = findReplacementEditButton(trigger)
  if (newEditBtn && isFocusable(newEditBtn)) {
    newEditBtn.focus({ preventScroll: true })
    return
  }
  const fallback = resolveFallbackTarget()
  if (fallback) {
    fallback.focus({ preventScroll: true })
  }
}

const setModalChrome = (mode: 'add' | 'edit'): void => {
  if (mode === 'edit') {
    qs('#modal-input-label').textContent = translate('comments.edit_label')
    qs('#modal-save').textContent = translate('comments.save_button')
    return
  }
  qs('#modal-input-label').textContent = translate('modal.comment_label')
  qs('#modal-save').textContent = translate('modal.comment_save')
}

const showModalWithBody = (quote: string, body: string): void => {
  if (isSearchOpen()) {
    closeSearch()
  }
  captureLastTrigger()
  qs('#modal-quote').textContent = `“${quote}”`
  qsInput('#modal-input').value = body
  qs('#modal').classList.add('open')
  pendingFocusTimer = setTimeout((): void => {
    qsInput('#modal-input').focus()
    pendingFocusTimer = null
  }, 50)
}

/**
 * 選択範囲を保留状態にセットしてモーダルを開く。focus は CSS transition 後を狙って 50ms 遅延。
 *
 * 検索バーが開いていれば閉じる (DESIGN.md §12 「選択範囲 → コメント生成フロー中の検索 mark 退避」)。
 * 検索 mark を残したままコメント作成すると、新規 cmt mark が search-hl の内側にネストして
 * 見た目が混乱しうるのと、検索 hl が残った DOM 上での `range.surroundContents` 失敗経路を
 * 構造的に避けるための予防的クリア。
 */
const openModal = (sel: PendingSelection): void => {
  modalState.current = { kind: 'add', pendingSelection: sel }
  setModalChrome('add')
  showModalWithBody(sel.quote, '')
}

/** 既存コメントを編集対象にしてモーダルを開く。本文だけを差し替え、アンカー情報は保持する。 */
export const openEditCommentModal = (comment: Comment): void => {
  modalState.current = { editingCommentId: comment.id, kind: 'edit' }
  setModalChrome('edit')
  showModalWithBody(comment.quote, comment.comment)
}

/** モーダルを閉じ、保留状態をクリアして次回開閉時の漏洩を防ぐ */
export const closeCommentModal = (): void => {
  // drawer / search / menu の Escape 経路は global-keyboard.ts が modal の開閉に関係なく
  // closeCommentModal() を呼ぶため、closed のときは restoreFocusAfterClose まで進めず early return し、
  // drawer 操作中の Escape で focus が .doc-pane / footer に奪われる回帰を構造的に防ぐ (§5.s)。
  if (modalState.current.kind === 'closed') {
    return
  }
  cancelModalFocusTimer()
  qs('#modal').classList.remove('open')
  modalState.current = { kind: 'closed' }
  const trigger = lastTrigger
  lastTrigger = null
  restoreFocusAfterClose(trigger)
}

interface CommentContext {
  /** 全 markdown の blockAnchors。`sourceLine` の元 markdown 全体 1-origin 行番号を持つ */
  blockAnchors: Map<string, { sourceLine: number }>
  /** blockAnchor 解決失敗時の sourceLine フォールバック先 (祖先 page の sourceLineStart) */
  fallbackSourceLine: number
}

/**
 * 保留中の選択範囲と本文からコメントオブジェクトを組み立てる純粋関数。
 * `pageIndex` は selection の祖先 `<section.virtual-page>` から解決済みの値を直接受け取る
 * (selection.ts の `pageIndexForBlock`、§6.5)。
 *
 * 該当 blockAnchor が無い場合は `fallbackSourceLine` (= selection 祖先 page の `sourceLineStart`)
 * にフォールバックする。§6.6 invariant `sourceLine >= 1` を保つことで、保存直後の state と
 * reload 後の `isImportableComment` 検証で挙動が一致する。通常パスでは blockAnchors と DOM
 * blockId が 1:1 なのでフォールバックは触らず、構造的不整合があった場合の防御的経路として残す。
 */
const resolveSourceLine = (blockId: string, context: CommentContext): number => {
  const anchor = context.blockAnchors.get(blockId)
  if (!anchor) {
    return context.fallbackSourceLine
  }
  return anchor.sourceLine
}

const commentFromSelection = (
  selection: PendingSelection,
  body: string,
  context: CommentContext
): Comment => ({
  blockId: selection.blockId,
  comment: body,
  created: new Date().toISOString(),
  endOffset: selection.endOffset,
  id: uid(),
  pageIndex: selection.pageIndex,
  quote: selection.quote,
  sourceLine: resolveSourceLine(selection.blockId, context),
  startOffset: selection.startOffset,
})

/**
 * モーダルの「Save」ボタン押下時の処理。
 * 本文空 or 保留選択 null の場合は無視（誤コミット防止）。保存後に modal を閉じる前後で副作用を一通り回す。
 * 新規コメントの sourceLine フォールバックは selection 祖先 page の sourceLineStart を使う
 * (§6.5 / §9.1)。
 */
const resolveSelectionPageSourceLineStart = (pageIndex: number): number => {
  const page = state.pages[pageIndex]
  if (!page) {
    return 1
  }
  return page.sourceLineStart
}

/** 該当 id の本文だけを差し替え、アンカー情報は保持する。見つからなければ false (state 不変)。 */
const applyEditedBody = (comments: Comment[], commentId: string, body: string): boolean => {
  const target = comments.find((other): boolean => other.id === commentId)
  if (!target) {
    return false
  }
  target.comment = body
  return true
}

const saveEditedComment = (commentId: string, body: string): void => {
  if (!applyEditedBody(state.comments, commentId, body)) {
    return
  }
  renderComments()
  closeCommentModal()
  toast(translate('toast.comment_updated'))
}

const saveNewComment = (selection: PendingSelection, body: string): void => {
  const newComment = commentFromSelection(selection, body, {
    blockAnchors: state.blockAnchors,
    fallbackSourceLine: resolveSelectionPageSourceLineStart(selection.pageIndex),
  })
  state.comments.push(newComment)
  reapplyAllMarks()
  renderComments()
  closeCommentModal()
  toast(translate('toast.comment_added'))
}

const saveModalComment = async (): Promise<void> => {
  const body = qsInput('#modal-input').value.trim()
  if (!body) {
    return
  }
  const { current } = modalState
  if (current.kind === 'edit') {
    saveEditedComment(current.editingCommentId, body)
    return
  }
  if (current.kind === 'add') {
    saveNewComment(current.pendingSelection, body)
  }
}

// floater 起動の共通ハンドラ。preventDefault で選択解除を防ぎ、touchstart では後続の
// synthetic mousedown を抑止する (二重発火しても openModal は冪等なので実害は無いが、無駄を省く)。
// payload は floater が出た時点で dataset に確定済みなので、tap で選択が崩れても参照できる。
const activateFloater = (event: Event): void => {
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
  setFloaterVisible(floater, false)
}

export const wireCommentModal = (): void => {
  const floater = qs('#floater')
  floater.addEventListener('mousedown', activateFloater)
  floater.addEventListener('touchstart', activateFloater, { passive: false })
  qs('#modal-cancel').addEventListener('click', closeCommentModal)
  qs('#modal').addEventListener('click', (event): void => {
    const { target } = event
    if (target instanceof HTMLElement && target.id === 'modal') {
      closeCommentModal()
    }
  })
  qs('#modal-save').addEventListener('click', async (): Promise<void> => saveModalComment())
}

// テスト用 CommentContext / PendingSelection fixture。固有の state を持たないため module scope に置く
// (unicorn/consistent-function-scoping ルール対応)。
const dummyContext = (overrides: Partial<CommentContext> = {}): CommentContext => ({
  blockAnchors: new Map(),
  fallbackSourceLine: 1,
  ...overrides,
})

const dummySelection = (overrides: Partial<PendingSelection> = {}): PendingSelection => ({
  blockId: 'b001',
  endOffset: 1,
  pageIndex: 0,
  quote: 'q',
  startOffset: 0,
  ...overrides,
})

const dummyComment = (overrides: Partial<Comment> = {}): Comment => ({
  blockId: 'b001',
  comment: 'original',
  created: '2026-05-17T00:00:00.000Z',
  endOffset: 4,
  id: 'c1',
  pageIndex: 0,
  quote: 'anchor',
  sourceLine: 1,
  startOffset: 0,
  ...overrides,
})

const setupModalFixtureForTest = (): void => {
  document.body.innerHTML = `
    <div id="modal-quote"></div>
    <input id="modal-input" />
    <div id="modal-input-label"></div>
    <button id="modal-save"></button>
    <div id="modal"></div>
    <section class="doc-pane" tabindex="-1"></section>
    <button id="btn-mobile-comments"></button>
    <div class="cmt-card" data-id="c1"><button class="cmt-edit" data-edit="c1">edit</button></div>
  `
}

const setupFloaterFixtureForTest = (): void => {
  document.body.innerHTML = `
    <div id="floater"></div>
    <div id="modal-quote"></div>
    <input id="modal-input" />
    <div id="modal-input-label"></div>
    <button id="modal-save"></button>
    <button id="modal-cancel"></button>
    <div id="modal"></div>
  `
}

const queryElForTest = (selector: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(selector)
  if (!el) {
    throw new Error(`fixture missing ${selector}`)
  }
  return el
}

// saveEditedComment 経路 (renderComments で旧カードが detach され同 id の新カードが描画される) を模倣。
const appendReplacementEditCardForTest = (commentId: string): HTMLElement => {
  const card = document.createElement('div')
  card.className = 'cmt-card'
  card.dataset.id = commentId
  card.innerHTML = `<button class="cmt-edit" data-edit="${commentId}">edit</button>`
  document.body.appendChild(card)
  return card
}

if (import.meta.vitest) {
  const { afterEach, beforeEach, describe, it, expect, vi } = import.meta.vitest

  describe('commentFromSelection', () => {
    it('選択範囲と本文から正しいコメントを組み立てる', () => {
      const selection = dummySelection({
        blockId: 'b001',
        endOffset: 20,
        quote: '引用テキスト',
        startOffset: 10,
      })
      const result = commentFromSelection(selection, 'コメント本文', dummyContext())
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
      const sel = dummySelection({ blockId: 'b' })
      const first = commentFromSelection(sel, 'x', dummyContext())
      const second = commentFromSelection(sel, 'x', dummyContext())
      expect(first.id).not.toBe(second.id)
    })

    it('pageIndex は selection から取り込まれる (§6.5、Stacked View では祖先 section 由来)', () => {
      const sel = dummySelection({ pageIndex: 3 })
      const result = commentFromSelection(sel, 'x', dummyContext())
      expect(result.pageIndex).toBe(3)
    })

    it('sourceLine は blockAnchors から逆引きする (元 markdown 全体の 1-origin 維持)', () => {
      const sel = dummySelection({ blockId: 'b002' })
      const result = commentFromSelection(
        sel,
        'x',
        dummyContext({ blockAnchors: new Map([['b002', { sourceLine: 42 }]]) })
      )
      expect(result.sourceLine).toBe(42)
    })

    it('blockAnchor が見つからなければ fallbackSourceLine にフォールバック (§6.6 invariant sourceLine>=1 を維持)', () => {
      const sel = dummySelection({ blockId: 'b999' })
      const result = commentFromSelection(sel, 'x', dummyContext({ fallbackSourceLine: 42 }))
      expect(result.sourceLine).toBe(42)
    })

    it('default dummyContext のフォールバックは 1 (sourceLine >= 1 不変条件を満たす)', () => {
      const sel = dummySelection({ blockId: 'b999' })
      const result = commentFromSelection(sel, 'x', dummyContext())
      expect(result.sourceLine).toBe(1)
      expect(result.sourceLine).toBeGreaterThanOrEqual(1)
    })
  })

  describe('applyEditedBody', () => {
    it('該当 id の本文だけを差し替え、アンカー情報は保持する', () => {
      const target = dummyComment({ comment: 'before', id: 'c1' })
      const changed = applyEditedBody([target], 'c1', 'after')
      expect(changed).toBe(true)
      expect(target.comment).toBe('after')
      expect(target.blockId).toBe('b001')
      expect(target.startOffset).toBe(0)
      expect(target.endOffset).toBe(4)
      expect(target.quote).toBe('anchor')
      expect(target.created).toBe('2026-05-17T00:00:00.000Z')
    })

    it('存在しない id では false を返し state を変更しない', () => {
      const target = dummyComment({ comment: 'before', id: 'c1' })
      const changed = applyEditedBody([target], 'missing', 'after')
      expect(changed).toBe(false)
      expect(target.comment).toBe('before')
    })

    it('複数コメントのうち対象 id だけを編集する', () => {
      const first = dummyComment({ comment: 'a', id: 'c1' })
      const second = dummyComment({ comment: 'b', id: 'c2' })
      applyEditedBody([first, second], 'c2', 'edited')
      expect(first.comment).toBe('a')
      expect(second.comment).toBe('edited')
    })
  })

  describe('focus 復元契約 (§5.s / §4 Step 5c)', () => {
    beforeEach((): void => {
      setupModalFixtureForTest()
      vi.stubGlobal('matchMedia', (): { matches: boolean } => ({ matches: false }))
    })
    afterEach((): void => {
      closeCommentModal()
      vi.useRealTimers()
      vi.unstubAllGlobals()
      document.body.innerHTML = ''
    })

    it('Edit modal の close で focus が trigger (.cmt-edit) に戻る', () => {
      const editBtn = queryElForTest('.cmt-card[data-id="c1"] .cmt-edit')
      editBtn.focus()
      openEditCommentModal(dummyComment({ id: 'c1' }))
      closeCommentModal()
      expect(document.activeElement).toBe(editBtn)
    })

    it('modal closed 状態の closeCommentModal は no-op で focus を動かさない (Escape 連打 guard)', () => {
      const editBtn = queryElForTest('.cmt-card[data-id="c1"] .cmt-edit')
      editBtn.focus()
      closeCommentModal()
      expect(document.activeElement).toBe(editBtn)
    })

    it('open 直後の close で 50ms focus timer が cancel され input に focus が奪われない', () => {
      vi.useFakeTimers()
      const editBtn = queryElForTest('.cmt-card[data-id="c1"] .cmt-edit')
      editBtn.focus()
      openEditCommentModal(dummyComment({ id: 'c1' }))
      closeCommentModal()
      vi.advanceTimersByTime(100)
      expect(document.activeElement).toBe(editBtn)
    })

    it('trigger detach 時は同一 comment id の新 Edit ボタンに focus が戻る (saveEditedComment 経路)', () => {
      const oldCard = queryElForTest('.cmt-card[data-id="c1"]')
      queryElForTest('.cmt-card[data-id="c1"] .cmt-edit').focus()
      openEditCommentModal(dummyComment({ id: 'c1' }))
      oldCard.remove()
      const newCard = appendReplacementEditCardForTest('c1')
      closeCommentModal()
      expect(document.activeElement).toBe(newCard.querySelector('.cmt-edit'))
    })

    it('trigger が <body> 等の非 focusable のとき desktop では .doc-pane に退避する', () => {
      openEditCommentModal(dummyComment({ id: 'nope' }))
      closeCommentModal()
      expect(document.activeElement).toBe(queryElForTest('.doc-pane'))
    })

    it('trigger 非 focusable + mobile では footer Comment button に退避する', () => {
      vi.stubGlobal('matchMedia', (): { matches: boolean } => ({ matches: true }))
      openEditCommentModal(dummyComment({ id: 'nope' }))
      closeCommentModal()
      expect(document.activeElement).toBe(queryElForTest('#btn-mobile-comments'))
    })
  })

  describe('wireCommentModal: floater の touchstart 起動', () => {
    const validPayload = JSON.stringify({
      blockId: 'b001',
      endOffset: 4,
      pageIndex: 0,
      quote: 'anchor',
      startOffset: 0,
    })

    beforeEach((): void => {
      setupFloaterFixtureForTest()
      vi.stubGlobal('matchMedia', (): { matches: boolean } => ({ matches: false }))
    })
    afterEach((): void => {
      closeCommentModal()
      vi.unstubAllGlobals()
      document.body.innerHTML = ''
    })

    it('touchstart で dataset.payload から modal が open し floater は hide する', () => {
      wireCommentModal()
      const floater = queryElForTest('#floater')
      floater.dataset.payload = validPayload
      floater.dispatchEvent(new Event('touchstart', { bubbles: true, cancelable: true }))
      expect(queryElForTest('#modal').classList.contains('open')).toBe(true)
      expect(floater.style.display).toBe('none')
    })

    it('payload が無い touchstart は no-op (modal は開かない)', () => {
      wireCommentModal()
      const floater = queryElForTest('#floater')
      floater.dispatchEvent(new Event('touchstart', { bubbles: true, cancelable: true }))
      expect(queryElForTest('#modal').classList.contains('open')).toBe(false)
    })
  })
}
