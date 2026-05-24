// state.markdown を HTML 化して #doc に流し込み、後段の mark 再適用が依存する
// blockOriginalHTML / blockAnchors の 2 つのキャッシュも更新する。
//
// 初期 render は marked のみで plain `<pre><code class="language-…">` を出して即 paint させ、
// rAF × 2 で paint 確実後に Shiki を初期化して各 `<pre>` の innerHTML を upgrade する 2 段階構成
// (docs/mdxg-rendering-code-block.archive.md §5.b C 案)。

// fmt が `type` 修飾子付き specifier を先頭に並べ替える挙動と lint の sort-imports
// (identifier 文字列順) がこのファイルでは衝突するため、ファイル全体で無効化する。
/* eslint-disable sort-imports */

import { buildBlockAnchors } from '../core/block-anchors'
import type { HighlighterCore } from 'shiki/core'
import { getOrCreateHighlighter, highlightFenceWithShiki } from './shiki'
import { injectCopyButtons } from './code-copy-wrap'
import { qs } from './dom-utils'
import { reapplyAllMarks } from './mark-engine'
import { renderMarkdown } from '../core/markdown'
import { state } from './app-state'

/** ドキュメントが未読込のときの表示。プレースホルダ #doc-wrap を見える状態に戻す */
const showEmptyDocument = (doc: HTMLElement, wrap: HTMLElement): void => {
  doc.innerHTML = ''
  wrap.style.display = 'block'
}

/**
 * トップレベルブロックに連番 ID を付け、原 HTML をキャッシュする。
 * 以降の mark 再適用ではこのキャッシュをベースに HTML を巻き戻すため、レンダリング直後に必ず呼ぶ必要がある。
 *
 * `blockIdStart` は doc 全体での 1-origin index。Single Page 描画でも document スコープ blockId を
 * 維持するため、active page の先頭ブロックが doc 全体で何番目かを caller が渡す。
 */
const cacheBlockOriginalHTML = (doc: HTMLElement, blockIdStart: number): void => {
  state.blockOriginalHTML.clear()
  for (const [index, el] of [...doc.children].entries()) {
    if (el instanceof HTMLElement) {
      const id = `b${String(blockIdStart + index).padStart(3, '0')}`
      el.dataset.blockId = id
      state.blockOriginalHTML.set(id, el.innerHTML)
    }
  }
}

/**
 * `<div class="code-block-wrap">` を中の `<pre>` で置き換えた innerHTML を返す。
 *
 * `el.innerHTML` をそのままキャッシュすると、後段の `reapplyAllMarks` が `el.innerHTML = original`
 * で書き戻した際に wrap / Copy button が文字列パース由来の新 DOM として復元され、button の
 * click ハンドラが失われる (ネストされた `<pre>` のみ顕在化。トップレベル `<pre>` の el は
 * `<pre>` 自身で wrap を内側に含まない)。wrap を剥がした HTML をキャッシュすれば、巻き戻し後
 * `injectCopyButtons` の「wrap が無ければ作る」分岐が走り button が正しく再生成される。
 */
const innerHTMLWithoutCodeBlockWrap = (el: HTMLElement): string => {
  const cleaned = el.cloneNode(true)
  if (!(cleaned instanceof Element)) {
    return el.innerHTML
  }
  for (const wrap of cleaned.querySelectorAll('.code-block-wrap')) {
    const pre = wrap.querySelector(':scope > pre')
    if (pre) {
      wrap.replaceWith(pre)
    }
  }
  return cleaned.innerHTML
}

/**
 * Shiki upgrade 後の DOM 状態を blockOriginalHTML に焼き直す。
 * upgrade 後の reapplyAllMarks は blockOriginalHTML を innerHTML に書き戻すループなので、
 * Shiki span 入りの新 innerHTML をここで反映しておかないと巻き戻しでハイライトが消える。
 */
const refreshBlockOriginalHTML = (doc: HTMLElement): void => {
  for (const el of doc.querySelectorAll<HTMLElement>('[data-block-id]')) {
    const id = el.dataset.blockId
    if (id) {
      state.blockOriginalHTML.set(id, innerHTMLWithoutCodeBlockWrap(el))
    }
  }
}

/**
 * 現在 activePage の markdown を返す。pages が未確定 (loadFromMarkdown 前) のときは
 * state.markdown 全体を返して既存の単一ページ render 経路と互換にする。
 */
const getActivePageMarkdown = (): string => {
  const page = state.pages[state.activePageIndex]
  if (!page) {
    return state.markdown
  }
  return page.markdown
}

/**
 * 現在 activePage の H3–H6 outline slug 列を返す。
 * `renderMarkdown` の `headingSlugs` オプションに渡すことで、H3–H6 に
 * `id="<slug>"` を出現順で注入し、Page Outline の URL fragment スクロール先になる
 * (Phase 4 / MDXG §8)。
 */
const getActivePageHeadingSlugs = (): readonly string[] => {
  const page = state.pages[state.activePageIndex]
  if (!page) {
    return []
  }
  return page.headings.map((heading): string => heading.slug)
}

/**
 * 全 markdown の anchors のうち、active page が占める sourceLine 範囲
 * `[sourceLineStart, sourceLineEnd]` に入る blockId 列を文書順で取り出す。
 * Single Page 描画でも document スコープ blockId を維持するため、active page の先頭 blockId が
 * doc 全体で何番目なのかを確定する起点になる。
 */
const collectActivePageBlockIds = (allAnchors: ReturnType<typeof buildBlockAnchors>): string[] => {
  const activePage = state.pages[state.activePageIndex]
  if (!activePage) {
    return [...allAnchors.keys()]
  }
  const matched: string[] = []
  for (const [blockId, anchor] of allAnchors) {
    if (
      anchor.sourceLine >= activePage.sourceLineStart &&
      anchor.sourceLine <= activePage.sourceLineEnd
    ) {
      matched.push(blockId)
    }
  }
  return matched
}

/**
 * `b001` 形式の blockId 文字列を数値 index に戻す。`b007` → 7 のような変換で、
 * cacheBlockOriginalHTML の起点引数として連番計算に使う。
 */
const blockIdToIndex = (blockId: string): number => Number.parseInt(blockId.slice(1), 10)

const resolveActivePageBlockIdStart = (
  allAnchors: ReturnType<typeof buildBlockAnchors>
): number => {
  const blockIds = collectActivePageBlockIds(allAnchors)
  if (blockIds.length === 0) {
    return 1
  }
  return blockIdToIndex(blockIds[0])
}

/** markdown を HTML 化して #doc に流し込み、ブロック原 HTML と markdown 上のアンカーを更新する */
const mountRenderedDoc = (doc: HTMLElement, wrap: HTMLElement): void => {
  wrap.style.display = 'none'
  // C 案: 初期 render は highlighter を渡さず marked の plain 出力で paint を稼ぐ。
  // ハイライトは scheduleShikiUpgrade で paint 後に追いかける。
  const pageMarkdown = getActivePageMarkdown()
  doc.innerHTML = renderMarkdown(pageMarkdown, null, {
    headingSlugs: getActivePageHeadingSlugs(),
  })
  const allAnchors = buildBlockAnchors(state.markdown)
  // cacheBlockOriginalHTML を injectCopyButtons より先に呼び、トップレベル <pre> の場合に
  // blockId が <pre> 自身に付与されるよう順序を保つ (wrap 後だと block-id は <div> 側に移る)。
  cacheBlockOriginalHTML(doc, resolveActivePageBlockIdStart(allAnchors))
  injectCopyButtons(doc)
  state.blockAnchors = allAnchors
}

const extractLangFromCode = (code: HTMLElement): string | null => {
  const langClass = [...code.classList].find((cls): boolean => cls.startsWith('language-'))
  if (!langClass) {
    return null
  }
  return langClass.slice('language-'.length)
}

const parseShikiPre = (html: string): HTMLElement | null => {
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  const first = tpl.content.firstElementChild
  if (first instanceof HTMLElement && first.tagName === 'PRE') {
    return first
  }
  return null
}

/**
 * Shiki が出力した `<pre class="shiki ...">` の中身と装飾を `target` に転写する。
 * target 自体は残すため、`data-block-id` / 親 `.code-block-wrap` / Copy button は触られない。
 */
const transferShikiPre = (target: HTMLElement, source: HTMLElement): void => {
  target.innerHTML = source.innerHTML
  for (const cls of source.classList) {
    target.classList.add(cls)
  }
  const styleAttr = source.getAttribute('style')
  if (styleAttr !== null) {
    target.setAttribute('style', styleAttr)
  }
  const tabindex = source.getAttribute('tabindex')
  if (tabindex !== null) {
    target.setAttribute('tabindex', tabindex)
  }
}

/** `<code>` から lang を取り出し、Shiki 出力の `<pre>` を返す。lang 無し / 未対応言語なら null */
const resolveShikiPreFromCode = (
  code: HTMLElement,
  highlighter: HighlighterCore
): HTMLElement | null => {
  const lang = extractLangFromCode(code)
  if (lang === null) {
    return null
  }
  const html = highlightFenceWithShiki(highlighter, code.textContent ?? '', lang)
  if (html === null) {
    return null
  }
  return parseShikiPre(html)
}

/**
 * `<pre>` から Shiki 出力の `<pre>` を解決する。idempotent / `<code>` 無し / 未対応言語の
 * いずれでも null を返す。upgradeOnePre から複雑度を逃がすために独立させた。
 */
const resolveShikiPre = (pre: HTMLElement, highlighter: HighlighterCore): HTMLElement | null => {
  if (pre.dataset.shikiApplied === '1') {
    return null
  }
  const code = pre.querySelector<HTMLElement>(':scope > code')
  if (code === null) {
    return null
  }
  return resolveShikiPreFromCode(code, highlighter)
}

/**
 * 単一 `<pre>` を Shiki 出力で upgrade する。idempotent: `data-shiki-applied` が立っていれば skip。
 * 元 `<pre>` 自身は残して innerHTML だけ差し替えるため、§5.c の wrap 構造と §6 アンカリングは不変。
 */
const upgradeOnePre = (pre: HTMLElement, highlighter: HighlighterCore): boolean => {
  const shikiPre = resolveShikiPre(pre, highlighter)
  if (shikiPre === null) {
    return false
  }
  transferShikiPre(pre, shikiPre)
  pre.dataset.shikiApplied = '1'
  return true
}

/** `#doc` 配下の全 `<pre>` を Shiki で upgrade する。1 件でも変化があれば true を返す */
const upgradeFencesWithShiki = (doc: HTMLElement, highlighter: HighlighterCore): boolean => {
  let changed = false
  for (const pre of doc.querySelectorAll<HTMLElement>('pre')) {
    if (upgradeOnePre(pre, highlighter)) {
      changed = true
    }
  }
  return changed
}

const hasActiveSelection = (): boolean => {
  const sel = document.getSelection()
  return sel !== null && sel.toString().length > 0
}

/** Shiki 初期化 → upgrade → blockOriginalHTML 焼き直し → mark 再貼付の本体 */
const performShikiUpgrade = (doc: HTMLElement): void => {
  const highlighter = getOrCreateHighlighter()
  if (highlighter === null) {
    return
  }
  if (!upgradeFencesWithShiki(doc, highlighter)) {
    return
  }
  refreshBlockOriginalHTML(doc)
  reapplyAllMarks()
}

/** 選択範囲が解除された次の rAF で `callback` を 1 度だけ呼ぶ */
const onSelectionEnd = (callback: () => void): void => {
  const onChange = (): void => {
    if (!hasActiveSelection()) {
      document.removeEventListener('selectionchange', onChange)
      requestAnimationFrame(callback)
    }
  }
  document.addEventListener('selectionchange', onChange)
}

/**
 * paint 後に Shiki ハイライトを各 `<pre>` に乗せる。
 *
 * rAF × 2 で初回 paint を確実に挟んでから走らせる (1 回目で layout、2 回目で paint 完了が保証される)。
 * 選択中は upgrade を後送りし、`selectionchange` で空に戻ったら次の rAF で再試行する。
 */
const scheduleShikiUpgrade = (doc: HTMLElement): void => {
  const run = (): void => {
    if (hasActiveSelection()) {
      onSelectionEnd(run)
      return
    }
    performShikiUpgrade(doc)
  }
  requestAnimationFrame((): void => {
    requestAnimationFrame(run)
  })
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
    scheduleShikiUpgrade(doc)
  }
  document.documentElement.classList.add('doc-ready')
}
