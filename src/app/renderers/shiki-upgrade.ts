// paint 後に各 `<pre>` を Shiki ハイライト出力で upgrade する idle 経路。
// 元 `<pre>` を残して innerHTML だけ差し替えることで `data-block-id` / 親 `.code-block-wrap` /
// Copy button を触らず、§6 アンカリングと §5.c wrap 構造を不変に保つ
// (DESIGN.md §12 §2 Code Block Rendering C 案)。

import { getOrCreateHighlighter, highlightFenceWithShiki } from './shiki'
import type { HighlighterCore } from 'shiki/core'
import { reapplyAllMarks } from '../comments/mark-engine'
import { refreshBlockOriginalHTML } from '../document/block-cache'

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
export const scheduleShikiUpgrade = (doc: HTMLElement): void => {
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
