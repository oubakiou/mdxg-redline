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
import type { Page } from '../core/page-split'
import { getOrCreateHighlighter, highlightFenceWithShiki } from './shiki'
import { injectCopyButtons } from './code-copy-wrap'
import { qs } from './dom-utils'
import { reapplyAllMarks } from './mark-engine'
import { renderMarkdown } from '../core/markdown'
import { scheduleKatexUpgrade } from './katex'
import { scheduleMermaidUpgrade } from './mermaid'
import { state } from './app-state'

/** ドキュメントが未読込のときの表示。プレースホルダ #doc-wrap を見える状態に戻す */
const showEmptyDocument = (doc: HTMLElement, wrap: HTMLElement): void => {
  doc.innerHTML = ''
  wrap.style.display = 'block'
}

/**
 * Stacked View 配下の全 `<section.virtual-page>` の子ブロックを文書順に走査し、
 * `b001` から連番の blockId を付与しつつ原 HTML をキャッシュする。
 * 以降の mark 再適用ではこのキャッシュをベースに HTML を巻き戻すため、レンダリング直後に必ず呼ぶ必要がある。
 */
const cacheBlockOriginalHTML = (doc: HTMLElement): void => {
  state.blockOriginalHTML.clear()
  let blockIndex = 0
  for (const section of doc.querySelectorAll<HTMLElement>(':scope > section.virtual-page')) {
    for (const el of section.children) {
      if (el instanceof HTMLElement) {
        blockIndex += 1
        const id = `b${String(blockIndex).padStart(3, '0')}`
        el.dataset.blockId = id
        state.blockOriginalHTML.set(id, el.innerHTML)
      }
    }
  }
}

/**
 * blockOriginalHTML に焼き込まない動的装飾要素のセレクタ。
 *
 * - `mark.cmt`: state.comments を reapplyAllMarks で都度貼り直すため、blockOriginalHTML には
 *   素の本文を保ちたい。焼き込むと巻き戻し時に cmt が DOM 上に残り、新規 cmt が重ねて貼られて
 *   二重 mark になる
 * - `mark.search-hl`: 検索バー open 中のみ DOM に貼られる短命装飾。焼き込むと closeSearch 後の
 *   reapplyAllMarks で復元され、検索を閉じてもハイライトが残る (本ファイル冒頭の検索 UX 不変条件)
 *
 * 焼き込み時の clone から unwrap して、blockOriginalHTML を「動的装飾を含まない素のレンダリング
 * 結果 (Shiki span 入り)」に揃える。
 */
const DYNAMIC_MARK_SELECTORS: readonly string[] = ['mark.cmt', 'mark.search-hl']

const unwrapElement = (target: Element): void => {
  while (target.firstChild) {
    target.before(target.firstChild)
  }
  target.remove()
}

/** clone した subtree から code-block-wrap を剥がす (前処理 1) */
const replaceCodeBlockWraps = (cleaned: Element): void => {
  for (const wrap of cleaned.querySelectorAll('.code-block-wrap')) {
    const pre = wrap.querySelector(':scope > pre')
    if (pre) {
      wrap.replaceWith(pre)
    }
  }
}

/** clone した subtree から cmt / search-hl mark を unwrap する (前処理 2) */
const stripDynamicMarks = (cleaned: Element): void => {
  for (const selector of DYNAMIC_MARK_SELECTORS) {
    for (const mark of cleaned.querySelectorAll(selector)) {
      unwrapElement(mark)
    }
  }
}

/**
 * `<div class="code-block-wrap">` を中の `<pre>` で置き換え、cmt / search-hl mark を unwrap した
 * innerHTML を返す。reapplyAllMarks の巻き戻し前提として、装飾要素を blockOriginalHTML に
 * 焼き込まないキャッシュ値を生成する。
 *
 * code-block-wrap を剥がす理由: `el.innerHTML` をそのままキャッシュすると、後段の reapplyAllMarks
 * が `el.innerHTML = original` で書き戻した際に wrap / Copy button が文字列パース由来の新 DOM
 * として復元され、button の click ハンドラが失われる (ネストされた `<pre>` のみ顕在化。トップ
 * レベル `<pre>` の el は `<pre>` 自身で wrap を内側に含まない)。wrap を剥がした HTML を
 * キャッシュすれば、巻き戻し後 `injectCopyButtons` の「wrap が無ければ作る」分岐が走り button が
 * 正しく再生成される。
 */
const innerHTMLForOriginalCache = (el: HTMLElement): string => {
  const cleaned = el.cloneNode(true)
  if (!(cleaned instanceof Element)) {
    return el.innerHTML
  }
  replaceCodeBlockWraps(cleaned)
  stripDynamicMarks(cleaned)
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
      state.blockOriginalHTML.set(id, innerHTMLForOriginalCache(el))
    }
  }
}

/**
 * 1 ページ分の markdown を `<section class="virtual-page">` に描画する。
 * dataset.pageIndex / pageSlug は scroll-spy / TOC click / selection の page 帰属解決に使う。
 * heading slug は当該 page の H3–H6 だけを渡すため、ページを跨いだ slug 衝突は起こらない
 * (page-split.ts の outline 抽出で per-page 一意化済み)。
 */
const renderPageSection = (page: Page): HTMLElement => {
  const section = document.createElement('section')
  section.className = 'virtual-page'
  section.dataset.pageIndex = String(page.index)
  section.dataset.pageSlug = page.slug
  section.innerHTML = renderMarkdown(page.markdown, null, {
    headingSlugs: page.headings.map((heading): string => heading.slug),
  })
  return section
}

/**
 * Stacked View: 全 page を `<section.virtual-page>` で連続描画する。
 * ブロック原 HTML と markdown 上のアンカーは doc 全体で 1 度だけ計算し、
 * mark-engine が page を跨いだ document スコープ blockId で動けるようにする。
 */
const mountRenderedDoc = (doc: HTMLElement, wrap: HTMLElement): void => {
  wrap.style.display = 'none'
  // C 案: 初期 render は highlighter を渡さず marked の plain 出力で paint を稼ぐ。
  // ハイライトは scheduleShikiUpgrade で paint 後に追いかける。
  doc.innerHTML = ''
  for (const page of state.pages) {
    doc.appendChild(renderPageSection(page))
  }
  // cacheBlockOriginalHTML を injectCopyButtons より先に呼び、トップレベル <pre> の場合に
  // blockId が <pre> 自身に付与されるよう順序を保つ (wrap 後だと block-id は <div> 側に移る)。
  cacheBlockOriginalHTML(doc)
  injectCopyButtons(doc)
  state.blockAnchors = buildBlockAnchors(state.markdown)
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

// paint 後の upgrade 3 系統 (Shiki / Mermaid / KaTeX) をまとめて schedule する。
// それぞれが内部で「runtime 未注入時 / 対象 0 件は no-op」「選択中はスキップ + 再試行」
// を満たしており互いに独立して走るため、ここでは順序を持たず並列に発火するだけで足りる。
// renderDoc の max-statements 緩和を兼ねた分離 (Mermaid 追加時と同じパターン)。
const schedulePostPaintUpgrades = (doc: HTMLElement): void => {
  scheduleShikiUpgrade(doc)
  scheduleMermaidUpgrade(doc)
  scheduleKatexUpgrade(doc)
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
    schedulePostPaintUpgrades(doc)
  }
  document.documentElement.classList.add('doc-ready')
}
