// <pre> を <div class="code-block-wrap"> で wrap し、コピーボタンと言語ラベルを追加するヘルパ。
// 初回描画 (doc-renderer.ts) と mark 再適用後の wrap 復元 (mark-engine.ts) の双方から呼ばれる。

import { MERMAID_ATTR, MERMAID_ATTR_VALUE } from '../../core/mermaid-attrs'
import { normalizeLangIdentifier } from '../../core/scan-fenced-langs'
import { toast } from '../dom/dom-utils'
import { translate } from '../i18n/i18n-browser'

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
    setCopyButtonLabel(btn, translate('modal.code_copied'))
    setTimeout((): void => setCopyButtonLabel(btn, translate('modal.code_copy')), COPY_FEEDBACK_MS)
  } catch {
    toast(translate('toast.copy_failed_with_hint'))
  }
}

const buildCopyButton = (pre: HTMLElement): HTMLButtonElement => {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'code-copy-btn'
  btn.setAttribute('aria-label', translate('modal.code_copy_aria'))
  const span = document.createElement('span')
  span.setAttribute('aria-hidden', 'true')
  span.textContent = translate('modal.code_copy')
  btn.appendChild(span)
  btn.addEventListener('click', async (): Promise<void> => {
    await handleCopyClick(btn, pre)
  })
  return btn
}

/**
 * `<pre data-lang="…">` の値から表示用ラベルテキストを決める。
 * 正規名にマップできれば正規名 (`ts → typescript` / `sh → bash`)、
 * Shiki bundled 全言語のホワイトリスト外で正規化できない識別子は生 lang をそのまま返す
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
    pre.before(buildLangLabel(lang))
  }
  wrap.appendChild(buildCopyButton(pre))
}

const wrapPreWithCopyButton = (pre: HTMLElement): void => {
  // mermaid フェンスは upgrade 後 <pre hidden> + sibling <svg> 構造になり、Copy button が
  // 視覚的に意味を持たない。upgrade 前の Shiki ハイライト fallback 時もダイアグラム DSL の
  // コードをコピーする UX 価値が低いため、data-mermaid="1" の <pre> 全般を除外する
  // (docs/mdxg-diagram-rendering.md §4 Step 5a)。
  if (pre.getAttribute(MERMAID_ATTR.code) === MERMAID_ATTR_VALUE) {
    return
  }
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

const buildRootWithPre = (preHtml: string): HTMLElement => {
  const root = document.createElement('div')
  root.innerHTML = preHtml
  return root
}

const expectElement = <Element_ extends Element>(value: Element_ | null): Element_ => {
  if (value === null) {
    throw new Error('expected non-null element')
  }
  return value
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('injectCopyButtons', () => {
    it('裸の <pre> を <div class="code-block-wrap"> で囲む', () => {
      const root = buildRootWithPre('<pre><code>x</code></pre>')
      injectCopyButtons(root)
      const wrap = expectElement(root.querySelector('div.code-block-wrap'))
      const pre = expectElement(root.querySelector('pre'))
      // <pre> は wrap の子になっている
      expect(pre.parentElement).toBe(wrap)
    })

    it('Copy button を wrap 内に append する (aria-label / class 規約)', () => {
      const root = buildRootWithPre('<pre><code>x</code></pre>')
      injectCopyButtons(root)
      const btn = expectElement(root.querySelector('button.code-copy-btn'))
      const wrap = expectElement(root.querySelector('div.code-block-wrap'))
      expect(btn.parentElement).toBe(wrap)
      expect(btn.getAttribute('aria-label')).toBe('Copy code')
      const span = expectElement(btn.querySelector('span'))
      expect(span.textContent).toBe('Copy')
    })

    it('data-lang 付き <pre> は <span class="code-lang-label"> をその直前に挿入する', () => {
      const root = buildRootWithPre('<pre data-lang="ts"><code>1</code></pre>')
      injectCopyButtons(root)
      const label = expectElement(root.querySelector('span.code-lang-label'))
      // ts → typescript に正規化される (normalizeLangIdentifier 経由)
      expect(label.textContent).toBe('typescript')
      // <pre> の直前の sibling として置かれている (wrap の子のうち pre より前)
      const pre = expectElement(root.querySelector('pre'))
      expect(label.nextElementSibling).toBe(pre)
    })

    it('正規化できない data-lang は raw 値をそのままラベルにする', () => {
      const root = buildRootWithPre('<pre data-lang="nim-custom"><code>x</code></pre>')
      injectCopyButtons(root)
      const label = expectElement(root.querySelector('span.code-lang-label'))
      expect(label.textContent).toBe('nim-custom')
    })

    it('data-lang 無しなら code-lang-label は注入しない', () => {
      const root = buildRootWithPre('<pre><code>x</code></pre>')
      injectCopyButtons(root)
      expect(root.querySelector('span.code-lang-label')).toBeNull()
    })

    it('idempotent: 既に wrap 済みの <pre> を再度通しても 2 重 wrap / 2 個目の button を作らない', () => {
      const root = buildRootWithPre('<pre><code>x</code></pre>')
      injectCopyButtons(root)
      injectCopyButtons(root)
      expect(root.querySelectorAll('div.code-block-wrap')).toHaveLength(1)
      expect(root.querySelectorAll('button.code-copy-btn')).toHaveLength(1)
    })

    it('data-mermaid="1" の <pre> は wrap / button 注入対象外', () => {
      const root = buildRootWithPre('<pre data-mermaid="1"><code>graph TD</code></pre>')
      injectCopyButtons(root)
      expect(root.querySelector('div.code-block-wrap')).toBeNull()
      expect(root.querySelector('button.code-copy-btn')).toBeNull()
    })

    it('root 配下に複数 <pre> があれば全部を独立に wrap する', () => {
      const root = buildRootWithPre(
        '<pre data-lang="ts"><code>a</code></pre><pre><code>b</code></pre>'
      )
      injectCopyButtons(root)
      expect(root.querySelectorAll('div.code-block-wrap')).toHaveLength(2)
      expect(root.querySelectorAll('button.code-copy-btn')).toHaveLength(2)
      // data-lang 付きの方だけラベルが出る
      expect(root.querySelectorAll('span.code-lang-label')).toHaveLength(1)
    })
  })
}
