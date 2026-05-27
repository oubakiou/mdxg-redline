// ブラウザ側 KaTeX upgrade。docs/mdxg-math-rendering.archive.md §5.b C 案 に従い、
// 初期 render は plain `<span data-math="inline">` / `<div data-math="display">` で paint させ、
// requestIdleCallback で paint 後に各要素を KaTeX HTML に upgrade する (Mermaid と完全に対称、
// `src/app/mermaid.ts` 参照)。
//
// upgrade 後の DOM 構造:
//   <span data-math="inline" data-math-source="..." data-math-applied="1">
//     <span class="katex">…KaTeX 出力 (MathML + HTML)…</span>
//   </span>
// 失敗時:
//   <span data-math="inline" data-math-source="..." data-math-failed="1">$x$</span>
//
// 要素自体を残す理由: §6 アンカリングは textContent + selection.ts の textSegments が
// `[data-math]` を terminal として扱い `data-math-source` から `$...$` を再構成する経路で
// 動くため、要素が消えるとオフセット計算が壊れる (Step 6 と一体の設計)。
// `data-math-applied` / `data-math-failed` の組合せで idempotent 化する (二重描画防止)。

import { reapplyAllMarks } from './mark-engine'
import { state } from './app-state'
import { toast } from './dom-utils'

// dist/katex/katex.mjs 側で `globalThis.__mdxgKatex = katex` がセットされる契約
// (docs/mdxg-math-rendering.archive.md §3.2 / §5.h)。実 katex 型を import すると bundle に重複が出る
// ため、必要最小限の subset を local interface に切り出してランタイム形状チェック (isKatexLike)
// で吸収する (Mermaid と同じパターン)。
interface KatexRenderOptions {
  displayMode: boolean
  errorColor?: string
  strict?: 'error' | 'ignore' | 'warn'
  throwOnError?: boolean
  trust?: boolean
}

interface KatexLike {
  renderToString: (src: string, options?: KatexRenderOptions) => string
}

// global 名の `__` prefix は他コードとの衝突回避のための規約 (§5.h)。
// eslint-disable-next-line no-underscore-dangle
const BRIDGE_KEY = '__mdxgKatex' as const
const KATEX_READY_EVENT = 'mdxg:katex-ready'
const KATEX_READY_TIMEOUT_MS = 2000
const IDLE_TIMEOUT_MS = 2000

const readBridge = (): unknown => Reflect.get(globalThis, BRIDGE_KEY)

const isKatexLike = (value: unknown): value is KatexLike => {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const obj = value as { renderToString?: unknown }
  return typeof obj.renderToString === 'function'
}

const hasEmbeddedKatexScript = (): boolean => {
  const el = document.getElementById('embedded-katex')
  if (!(el instanceof HTMLElement)) {
    return false
  }
  return (el.textContent ?? '').trim().length > 0
}

const readKatexBridge = (): KatexLike | null => {
  const candidate = readBridge()
  if (isKatexLike(candidate)) {
    return candidate
  }
  return null
}

/**
 * `globalThis.__mdxgKatex` を取得する。未定義なら mdxg:katex-ready イベントを最大
 * KATEX_READY_TIMEOUT_MS ms 待つ。embedded-katex 自体が無い場合は即 null を返す
 * (KaTeX runtime 非注入時のフォールバック経路と一致、Mermaid と同じパターン)。
 */
const waitForKatexRuntime = async (): Promise<KatexLike | null> => {
  if (!hasEmbeddedKatexScript()) {
    return null
  }
  const present = readKatexBridge()
  if (present !== null) {
    return present
  }
  return new Promise<KatexLike | null>((resolve): void => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const onReady = (): void => {
      if (timer !== null) {
        clearTimeout(timer)
      }
      resolve(readKatexBridge())
    }
    timer = setTimeout((): void => {
      document.removeEventListener(KATEX_READY_EVENT, onReady)
      resolve(null)
    }, KATEX_READY_TIMEOUT_MS)
    document.addEventListener(KATEX_READY_EVENT, onReady, { once: true })
  })
}

// docs/mdxg-math-rendering.archive.md §5.f: 信頼境界の必須化。
//   trust: false       — \href / \url 等の外部リソース系コマンドを <mtext> として escape
//   strict: 'warn'     — \newcommand 等の制限付き命令は warning として続行
//   throwOnError: false — 構文エラーは katex-error span を返して例外を投げない
//   errorColor: 'inherit' — error 表示も --ink 配色を継承 (§7)
const KATEX_OPTIONS: Readonly<Required<Omit<KatexRenderOptions, 'displayMode'>>> = {
  errorColor: 'inherit',
  strict: 'warn',
  throwOnError: false,
  trust: false,
}

interface UpgradeResult {
  changedAny: boolean
  failedCount: number
}

type UpgradeStatus = 'failed' | 'ok' | 'skip'

const shouldSkipUpgrade = (el: HTMLElement): boolean => {
  if (el.dataset.mathApplied === '1' || el.dataset.mathFailed === '1') {
    return true
  }
  return typeof el.dataset.mathSource !== 'string'
}

// docs/mdxg-math-rendering.archive.md §5.b: 文法エラーのときだけ KaTeX は `katex-error` class を
// 含む span を返す (Step 1 PoC で確定)。未知マクロ (\href / \unknown_command 等) は
// best-effort `<mtext>` 描画になり class は付かない。後者は信頼境界として OK (`<a href>` を
// 出力しない、§5.f) かつ「サポートされているが入力が壊れている」ケースではないため
// silent best-effort として扱い toast 対象外にする。
const isErrorRender = (html: string): boolean => html.includes('katex-error')

const applyRenderedKatex = (el: HTMLElement, html: string): UpgradeStatus => {
  if (isErrorRender(html)) {
    el.dataset.mathFailed = '1'
    el.innerHTML = html
    return 'failed'
  }
  el.innerHTML = html
  el.dataset.mathApplied = '1'
  return 'ok'
}

const renderKatexInto = (el: HTMLElement, katex: KatexLike): UpgradeStatus => {
  const source = el.dataset.mathSource
  if (typeof source !== 'string') {
    return 'skip'
  }
  const displayMode = el.dataset.math === 'display'
  const html = katex.renderToString(source, { ...KATEX_OPTIONS, displayMode })
  return applyRenderedKatex(el, html)
}

const upgradeOneMathElement = (el: HTMLElement, katex: KatexLike): UpgradeStatus => {
  if (shouldSkipUpgrade(el)) {
    return 'skip'
  }
  try {
    return renderKatexInto(el, katex)
  } catch {
    // throwOnError: false にしているので通常は到達しない。version up 等で例外経路が
    // 復活した場合の保険として data-math-failed を立てる。
    el.dataset.mathFailed = '1'
    return 'failed'
  }
}

const collectMathElements = (docEl: HTMLElement): HTMLElement[] => {
  const nodes = docEl.querySelectorAll<HTMLElement>(
    '[data-math]:not([data-math-applied]):not([data-math-failed])'
  )
  return [...nodes]
}

const accumulateUpgradeResult = (acc: UpgradeResult, status: UpgradeStatus): UpgradeResult => {
  if (status === 'ok') {
    return { changedAny: true, failedCount: acc.failedCount }
  }
  if (status === 'failed') {
    return { changedAny: acc.changedAny, failedCount: acc.failedCount + 1 }
  }
  return acc
}

const upgradeAllMathElements = (docEl: HTMLElement, katex: KatexLike): UpgradeResult => {
  const elements = collectMathElements(docEl)
  let result: UpgradeResult = { changedAny: false, failedCount: 0 }
  for (const el of elements) {
    const status = upgradeOneMathElement(el, katex)
    result = accumulateUpgradeResult(result, status)
  }
  return result
}

const hasActiveSelection = (): boolean => {
  const sel = document.getSelection()
  return sel !== null && sel.toString().length > 0
}

const onSelectionEnd = (callback: () => void): void => {
  const onChange = (): void => {
    if (!hasActiveSelection()) {
      document.removeEventListener('selectionchange', onChange)
      requestAnimationFrame(callback)
    }
  }
  document.addEventListener('selectionchange', onChange)
}

interface IdleScheduler {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
}

const scheduleIdle = (callback: () => void): void => {
  const ric = (globalThis as IdleScheduler).requestIdleCallback
  if (typeof ric === 'function') {
    ric((): void => callback(), { timeout: IDLE_TIMEOUT_MS })
    return
  }
  setTimeout(callback, 0)
}

const cacheParentBlockHtml = (el: HTMLElement): void => {
  const parent = el.closest<HTMLElement>('[data-block-id]')
  if (parent === null) {
    return
  }
  const { blockId } = parent.dataset
  if (typeof blockId === 'string' && blockId !== '') {
    state.blockOriginalHTML.set(blockId, parent.innerHTML)
  }
}

// upgrade 後の block 構造変化 ([data-math] 子要素の innerHTML が KaTeX 出力に差し替わる) を
// blockOriginalHTML に焼き直す。要素自体は残るが innerHTML が変わるため、cmt mark を
// 後段で reapply する経路は親ブロックの innerHTML 全体を更新する必要がある (Mermaid と同様)。
const refreshKatexBlockOriginalHTML = (docEl: HTMLElement): void => {
  for (const el of docEl.querySelectorAll<HTMLElement>('[data-math-applied="1"]')) {
    cacheParentBlockHtml(el)
  }
}

const reportFailures = (failedCount: number): void => {
  if (failedCount === 0) {
    return
  }
  if (failedCount === 1) {
    toast('Math render failed for 1 expression')
    return
  }
  toast(`Math render failed for ${failedCount} expressions`)
}

/**
 * `#doc` 配下の `[data-math]` 要素を順次 KaTeX HTML に upgrade する。
 *
 * - KaTeX runtime 未注入 / 取得 timeout の場合は何もしない (plain `$...$` fallback が残る)
 * - 選択中は upgrade を後送りし、`selectionchange` で空に戻ったら再試行 (Mermaid と同じパターン)
 * - 文法エラーの要素は `data-math-failed="1"` を付けて再試行を抑止し、まとめて 1 回 toast 通知
 * - 成功した要素は blockOriginalHTML を焼き直して reapplyAllMarks する
 *   (embedded-feedback の cmt mark が upgrade 後の親ブロック内に再貼付される)
 */
export const upgradeMathElements = async (docEl: HTMLElement): Promise<void> => {
  const katex = await waitForKatexRuntime()
  if (katex === null) {
    return
  }
  const { changedAny, failedCount } = upgradeAllMathElements(docEl, katex)
  if (changedAny) {
    refreshKatexBlockOriginalHTML(docEl)
    reapplyAllMarks()
  }
  reportFailures(failedCount)
}

const runKatexUpgradeIgnoringErrors = (docEl: HTMLElement): void => {
  upgradeMathElements(docEl).catch((): void => {
    // upgrade 内部は個別要素の fail を data-math-failed で吸収する。ここに到達する例外は
    // 想定外のため silent drop は避けて toast のみ出す (Mermaid と同じ方針)。
    toast('Math upgrade failed')
  })
}

/**
 * paint 後 idle で `upgradeMathElements` を実行するエントリ。doc-renderer.ts から
 * Shiki / Mermaid upgrade と並行に呼ばれる (相互に独立した経路、idempotent)。
 */
export const scheduleKatexUpgrade = (docEl: HTMLElement): void => {
  const run = (): void => {
    if (hasActiveSelection()) {
      onSelectionEnd(run)
      return
    }
    runKatexUpgradeIgnoringErrors(docEl)
  }
  scheduleIdle(run)
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('isKatexLike type guard', () => {
    it('renderToString を関数として持つオブジェクトは true', () => {
      const fake: unknown = { renderToString: Function.prototype }
      expect(isKatexLike(fake)).toBe(true)
    })

    it('renderToString 欠落 / 非オブジェクト / null は false', () => {
      expect(isKatexLike({})).toBe(false)
      expect(isKatexLike(null)).toBe(false)
      expect(isKatexLike('katex')).toBe(false)
      expect(isKatexLike(42)).toBe(false)
    })
  })

  describe('accumulateUpgradeResult', () => {
    it('ok は changedAny を true に上げる', () => {
      const result = accumulateUpgradeResult({ changedAny: false, failedCount: 0 }, 'ok')
      expect(result).toEqual({ changedAny: true, failedCount: 0 })
    })

    it('failed は failedCount をインクリメント', () => {
      const result = accumulateUpgradeResult({ changedAny: false, failedCount: 1 }, 'failed')
      expect(result).toEqual({ changedAny: false, failedCount: 2 })
    })

    it('skip は変化なし', () => {
      const before = { changedAny: true, failedCount: 3 }
      expect(accumulateUpgradeResult(before, 'skip')).toEqual(before)
    })
  })

  describe('isErrorRender', () => {
    it('katex-error class を含む文字列は true', () => {
      expect(isErrorRender('<span class="katex-error" title="ParseError: ...">x</span>')).toBe(true)
    })

    it('best-effort `<mtext>` 描画 (未知マクロ) は false', () => {
      expect(isErrorRender(String.raw`<span class="katex"><mtext>\href</mtext></span>`)).toBe(false)
    })

    it('正常な KaTeX 出力は false', () => {
      expect(isErrorRender('<span class="katex"><math xmlns="...">x</math></span>')).toBe(false)
    })
  })
}
