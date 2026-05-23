// state.markdown を HTML 化して #doc に流し込み、後段の mark 再適用が依存する
// blockOriginalHTML / blockAnchors の 2 つのキャッシュも更新する。

import { type CodeHighlighter, renderMarkdown } from '../core/markdown'
import { getOrCreateHighlighter, highlightFenceWithShiki } from './shiki'
import { buildBlockAnchors } from '../core/block-anchors'
import { injectCopyButtons } from './code-copy-wrap'
import { qs } from './dom-utils'
import { reapplyAllMarks } from './mark-engine'
import { state } from './app-state'

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
  // cacheBlockOriginalHTML を injectCopyButtons より先に呼び、トップレベル <pre> の場合に
  // blockId が <pre> 自身に付与されるよう順序を保つ (wrap 後だと block-id は <div> 側に移る)。
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
  } else {
    mountRenderedDoc(doc, wrap)
    reapplyAllMarks()
  }
  document.documentElement.classList.add('doc-ready')
}
