// <pre> を <div class="code-block-wrap"> で wrap し、コピーボタンと言語ラベルを追加するヘルパ。
// 初回描画 (doc-renderer.ts) と mark 再適用後の wrap 復元 (mark-engine.ts) の双方から呼ばれる。

import { normalizeLangIdentifier } from '../core/scan-fenced-langs'
import { toast } from './dom-utils'

const COPY_FEEDBACK_MS = 1500

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

/**
 * `<pre data-lang="…">` の値から表示用ラベルテキストを決める。
 * 正規名にマップできれば正規名 (`ts → typescript` / `sh → bash`)、
 * 27 言語ホワイトリスト外で正規化できない識別子は生 lang をそのまま返す
 * (`nim` や typo を含むフェンスでもラベルが消えないようにする)。
 */
const resolveLangLabelText = (rawLang: string): string =>
  normalizeLangIdentifier(rawLang) ?? rawLang

const buildLangLabel = (rawLang: string): HTMLSpanElement => {
  const span = document.createElement('span')
  span.className = 'code-lang-label'
  span.setAttribute('aria-hidden', 'true')
  span.textContent = resolveLangLabelText(rawLang)
  return span
}

const createCodeBlockWrap = (pre: HTMLElement): HTMLElement => {
  const wrap = document.createElement('div')
  wrap.className = 'code-block-wrap'
  pre.before(wrap)
  wrap.appendChild(pre)
  return wrap
}

const appendWrapActions = (wrap: HTMLElement, pre: HTMLElement): void => {
  const { lang } = pre.dataset
  if (lang) {
    wrap.appendChild(buildLangLabel(lang))
  }
  wrap.appendChild(buildCopyButton(pre))
}

const wrapPreWithCopyButton = (pre: HTMLElement): void => {
  const parent = pre.parentElement
  if (parent && parent.classList.contains('code-block-wrap')) {
    return
  }
  appendWrapActions(createCodeBlockWrap(pre), pre)
}

/**
 * `root` 配下の `<pre>` 各要素を `<div class="code-block-wrap">` で wrap し、コピー button を
 * sibling として追加する。idempotent: 既に wrap 済みの `<pre>` は触らない。
 *
 * mark-engine の reapplyAllMarks は各ブロックの innerHTML を巻き戻すため、ネストされた
 * `<pre>` (リスト内 / 引用内など) は wrap が消える。巻き戻し直後に再呼び出ししない限り
 * Copy ボタンが永続的に欠落するので、両経路で呼ぶ必要がある。
 */
export const injectCopyButtons = (root: HTMLElement): void => {
  const pres = root.querySelectorAll('pre')
  for (const pre of pres) {
    if (pre instanceof HTMLElement) {
      wrapPreWithCopyButton(pre)
    }
  }
}
