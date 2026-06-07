// paint 後に各 `<pre>` を Shiki ハイライト出力で upgrade する idle 経路。
// 元 `<pre>` を残して innerHTML だけ差し替えることで `data-block-id` / 親 `.code-block-wrap` /
// Copy button を触らず、§6 アンカリングと §5.c wrap 構造を不変に保つ
// (DESIGN.md §12 §2 Code Block Rendering C 案)。

import { getOrCreateHighlighter, highlightFenceWithShiki } from './shiki'
import type { HighlighterCore } from 'shiki/core'
import { reapplyAllMarks } from '../comments/mark-engine'
import { refreshBlockOriginalHTML } from '../document/block-cache'
import { scheduleAfterPaint, scheduleWithSelectionGuard } from './upgrade-utils'

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

/**
 * paint 後に Shiki ハイライトを各 `<pre>` に乗せる。
 *
 * paint timing は `scheduleAfterPaint` (rAF × 2) で確保し、選択中 defer は
 * `scheduleWithSelectionGuard` 経由で Mermaid / KaTeX と共通化している。
 */
export const scheduleShikiUpgrade = (doc: HTMLElement): void => {
  scheduleWithSelectionGuard(scheduleAfterPaint, (): void => {
    performShikiUpgrade(doc)
  })
}

// attach 済み listener function reference を保持。null = 未 attach。
// `resetShikiLangsListenerForTest` で `removeEventListener` するために handler 自体を持っておく。
let shikiLangsListener: (() => void) | null = null

/**
 * `mdxg:shiki-langs-ready` を永続 listen して受け取るたび `upgrade(doc)` を再走させる。
 * 遅延が大きい回線や複数 grammar の段階 load でも upgrade が取りこぼされないことを保証する。
 * event 自体が発火しない経路では attach されても何も起こらない。
 *
 * 重複 attach は module-level reference (`shikiLangsListener`) のガードで idempotent。
 * `upgrade` は dependency injection 用の optional 引数で、default は本 module の
 * `scheduleShikiUpgrade`。listener の発火を test から直接 verify するためにある。
 */
export const attachShikiLangsReadyListener = (
  doc: HTMLElement,
  upgrade: (doc: HTMLElement) => void = scheduleShikiUpgrade
): void => {
  if (shikiLangsListener !== null) {
    return
  }
  if (typeof document === 'undefined') {
    return
  }
  const listener = (): void => {
    upgrade(doc)
  }
  shikiLangsListener = listener
  document.addEventListener('mdxg:shiki-langs-ready', listener)
}

/**
 * 永続 listener を実際に `removeEventListener` で外し、reference を null に戻す test 専用 helper。
 * 本番経路では呼ばない (page reload で破棄される設計)。
 */
export const resetShikiLangsListenerForTest = (): void => {
  if (shikiLangsListener !== null && typeof document !== 'undefined') {
    document.removeEventListener('mdxg:shiki-langs-ready', shikiLangsListener)
  }
  shikiLangsListener = null
}

const createTestDocEl = (id: string): HTMLElement => {
  const doc = document.createElement('div')
  doc.id = id
  document.body.appendChild(doc)
  return doc
}

const dispatchShikiLangsReady = (times: number): void => {
  for (let count = 0; count < times; count += 1) {
    document.dispatchEvent(new Event('mdxg:shiki-langs-ready'))
  }
}

const attachWithEphemeralDoc = (
  id: string,
  upgrade: (doc: HTMLElement) => void
): { remove: () => void } => {
  const doc = createTestDocEl(id)
  attachShikiLangsReadyListener(doc, upgrade)
  return { remove: (): void => doc.remove() }
}

interface ResetIsolationCallCounts {
  newCount: number
  oldCount: number
}

interface MockFnLike {
  (...args: unknown[]): unknown
  mock: { calls: unknown[][] }
}

const runResetIsolationScenario = (makeFn: () => MockFnLike): ResetIsolationCallCounts => {
  const oldUpgrade = makeFn()
  const newUpgrade = makeFn()
  const first = attachWithEphemeralDoc('doc-test-reset-old', oldUpgrade)
  first.remove()
  resetShikiLangsListenerForTest()
  const second = attachWithEphemeralDoc('doc-test-reset-new', newUpgrade)
  try {
    dispatchShikiLangsReady(1)
    return { newCount: newUpgrade.mock.calls.length, oldCount: oldUpgrade.mock.calls.length }
  } finally {
    second.remove()
  }
}

if (import.meta.vitest) {
  const { afterEach, describe, expect, it, vi } = import.meta.vitest

  describe('attachShikiLangsReadyListener', () => {
    afterEach((): void => {
      resetShikiLangsListenerForTest()
    })

    it('event 発火で upgrade が doc を引数に呼ばれる', () => {
      const doc = createTestDocEl('doc-test-1')
      const upgrade = vi.fn()
      try {
        attachShikiLangsReadyListener(doc, upgrade)
        dispatchShikiLangsReady(1)
        expect(upgrade).toHaveBeenCalledTimes(1)
        expect(upgrade).toHaveBeenCalledWith(doc)
      } finally {
        doc.remove()
      }
    })

    it('2 回呼んでも listener は 1 度しか attach されない (idempotent)', () => {
      const doc = createTestDocEl('doc-test-2')
      const upgrade = vi.fn()
      try {
        attachShikiLangsReadyListener(doc, upgrade)
        attachShikiLangsReadyListener(doc, upgrade)
        dispatchShikiLangsReady(1)
        expect(upgrade).toHaveBeenCalledTimes(1)
      } finally {
        doc.remove()
      }
    })

    it('永続 listener なので複数回 event 発火しても都度 upgrade が走る', () => {
      const doc = createTestDocEl('doc-test-3')
      const upgrade = vi.fn()
      try {
        attachShikiLangsReadyListener(doc, upgrade)
        dispatchShikiLangsReady(3)
        expect(upgrade).toHaveBeenCalledTimes(3)
      } finally {
        doc.remove()
      }
    })

    it('reset 後は古い listener が累積せず、新しい upgrade だけが呼ばれる', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const counts = runResetIsolationScenario((): MockFnLike => vi.fn() as unknown as MockFnLike)
      expect(counts.newCount).toBe(1)
      expect(counts.oldCount).toBe(0)
    })
  })
}
