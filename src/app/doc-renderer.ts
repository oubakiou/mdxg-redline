// state.markdown を HTML 化して #doc に流し込み、後段の mark 再適用が依存する
// blockOriginalHTML / blockAnchors の 2 つのキャッシュも更新する。

import { type CodeHighlighter, renderMarkdown } from '../core/markdown'
import { getOrCreateHighlighter, highlightFenceWithShiki } from './shiki'
import { qs, toast } from './dom-utils'
import { buildBlockAnchors } from '../core/block-anchors'
import { reapplyAllMarks } from './mark-engine'
import { state } from './app-state'

const COPY_FEEDBACK_MS = 1500

/**
 * embedded-shiki-langs から構築した Shiki ハイライタを CodeHighlighter インターフェースに包む。
 * highlighter が初期化失敗 / 埋め込み無しなら null を返し、renderMarkdown 側で plain text fallback。
 */
const getCodeHighlighter = (): CodeHighlighter | null => {
  const shiki = getOrCreateHighlighter()
  if (!shiki) {
    return null
  }
  return {
    highlight(code: string, rawLang: string): string | null {
      return highlightFenceWithShiki(shiki, code, rawLang)
    },
  }
}

const setCopyButtonLabel = (btn: HTMLButtonElement, label: string): void => {
  const span = btn.querySelector('span')
  if (span) {
    span.textContent = label
  }
}

const handleCopyClick = async (btn: HTMLButtonElement, pre: HTMLElement): Promise<void> => {
  try {
    await navigator.clipboard.writeText(pre.textContent ?? '')
    setCopyButtonLabel(btn, 'Copied')
    setTimeout((): void => setCopyButtonLabel(btn, 'Copy'), COPY_FEEDBACK_MS)
  } catch {
    toast('Copy failed. Select the text manually.')
  }
}

const buildCopyButton = (pre: HTMLElement): HTMLButtonElement => {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'code-copy-btn'
  btn.setAttribute('aria-label', 'Copy code')
  const span = document.createElement('span')
  span.setAttribute('aria-hidden', 'true')
  span.textContent = 'Copy'
  btn.appendChild(span)
  btn.addEventListener('click', async (): Promise<void> => {
    await handleCopyClick(btn, pre)
  })
  return btn
}

const wrapPreWithCopyButton = (pre: HTMLElement): void => {
  const parent = pre.parentElement
  if (parent && parent.classList.contains('code-block-wrap')) {
    return
  }
  const wrap = document.createElement('div')
  wrap.className = 'code-block-wrap'
  pre.before(wrap)
  wrap.appendChild(pre)
  wrap.appendChild(buildCopyButton(pre))
}

/**
 * `<pre>` 各要素を `<div class="code-block-wrap">` で wrap し、コピー button を
 * sibling として追加する。idempotent: 既に wrap 済みなら何もしない。
 *
 * §6 アンカリングを壊さないため、cacheBlockOriginalHTML を **先に** 呼び blockId を
 * `<pre>` に付けてから wrap する。これにより `<pre>` の `data-block-id` は維持され、
 * blockOriginalHTML には `<pre>` の innerHTML だけが保存される (button テキストは混入しない)。
 */
export const injectCopyButtons = (doc: HTMLElement): void => {
  const pres = doc.querySelectorAll('pre')
  for (const pre of pres) {
    if (pre instanceof HTMLElement) {
      wrapPreWithCopyButton(pre)
    }
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
  doc.innerHTML = renderMarkdown(state.markdown, getCodeHighlighter())
  // cacheBlockOriginalHTML を先に呼び `<pre>` が blockId を持った状態でキャッシュしてから wrap する。
  // これにより blockOriginalHTML には `<pre>` の innerHTML だけが入り、button の textContent が
  // §6 のブロックフラットテキスト計算に混入しない。
  cacheBlockOriginalHTML(doc)
  injectCopyButtons(doc)
  state.blockAnchors = buildBlockAnchors(state.markdown)
}

export const renderDoc = (): void => {
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
