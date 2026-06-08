// ブラウザ側 KaTeX upgrade。DESIGN.md §12 §14 Math Rendering C 案 に従い、
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
// 動くため、要素が消えるとオフセット計算が壊れる。
// `data-math-applied` / `data-math-failed` の組合せで idempotent 化する (二重描画防止)。

import { isOnlineEdition } from '../boot'
import { reapplyAllMarks } from '../comments/mark-engine'
import { state } from '../state/app-state'
import {
  type UpgradeResult,
  type UpgradeStatus,
  accumulateUpgradeResult,
  reportRenderFailures,
} from './upgrade-utils'
import { type RuntimeBridgeConfig, isRuntimeLike, waitForRuntime } from './runtime-bridge'
import {
  refreshAppliedBlocksOriginalHTML,
  runUpgradeIgnoringErrors,
  scheduleUpgradeOnIdle,
} from './upgrade-orchestrator'

// dist/katex/katex.mjs 側で `globalThis.__mdxgKatex = katex` がセットされる契約
// (DESIGN.md §12 §14 Math Rendering)。実 katex 型を import すると bundle に重複が出る
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

const isKatexLike = (value: unknown): value is KatexLike =>
  isRuntimeLike<KatexLike>(value, ['renderToString'])

// global 名の `__` prefix は他コードとの衝突回避のための規約 (§5.h)。
const KATEX_BRIDGE: RuntimeBridgeConfig<KatexLike> = {
  // eslint-disable-next-line no-underscore-dangle
  bridgeKey: '__mdxgKatex',
  embeddedScriptId: 'embedded-katex',
  isValid: isKatexLike,
  readyEvent: 'mdxg:katex-ready',
}

// 単一 `<style>` block の textContent 非空判定。 block 不在は CSS 別経路注入済み (CLI 経路で
// review.html に block が無い構成等) として true を返す。
const isStyleBlockReady = (id: string): boolean => {
  const el = document.getElementById(id)
  if (!(el instanceof HTMLStyleElement)) {
    return true
  }
  return (el.textContent ?? '').trim().length > 0
}

// CSS が注入されているかを判定する gate。 KaTeX JS の評価完了 (mdxg:katex-ready dispatch) は
// CSS fetch と独立で発火するため、 CSS 未注入のまま upgrade すると永続的に unstyled な KaTeX HTML
// が DOM に残る (data-math-applied=1 で再試行抑止 + raw `$...$` fallback には戻らない)。
//
// online edition では asset-loader が 3 ファイル (JS / CSS / fontsExtra) を並列 fetch + 注入し、
// JS が先に ready しても CSS / fontsExtra が in-flight or 失敗の可能性がある。 主 CSS だけ確認すると
// fontsExtra 依存 glyph (\mathcal / \mathfrak / \mathscr 等 KaTeX_Caligraphic / Fraktur / Script
// family) が不完全フォントで固定される穴があるため、 fontsExtra block も非空必須に倒す。
//
// CLI 経路 (standalone `--math-fonts minimal`) は fontsExtra block が **意図的に空** で deploy
// される (minimal 9 family のみで描画する設計)。 isOnlineEdition() で経路を分岐し、 CLI 側では
// fontsExtra の非空要求を外す。 standalone `--math-fonts all` / embed-template は CSS 既 inline で
// gate を通過。
const isKatexCssReady = (): boolean => {
  if (typeof document === 'undefined') {
    return true
  }
  if (!isOnlineEdition()) {
    return isStyleBlockReady('embedded-katex-css')
  }
  return (
    isStyleBlockReady('embedded-katex-css') && isStyleBlockReady('embedded-katex-fonts-extra-css')
  )
}

// DESIGN.md §11 信頼境界 / §12 §14 Math Rendering: 信頼境界の必須化。
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

const shouldSkipUpgrade = (el: HTMLElement): boolean => {
  if (el.dataset.mathApplied === '1' || el.dataset.mathFailed === '1') {
    return true
  }
  return typeof el.dataset.mathSource !== 'string'
}

// DESIGN.md §12 §14 Math Rendering: 文法エラーのときだけ KaTeX は `katex-error` class を
// 含む span を返す。 未知マクロ (\href / \unknown_command 等) は
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

const upgradeAllMathElements = (docEl: HTMLElement, katex: KatexLike): UpgradeResult => {
  const elements = collectMathElements(docEl)
  let result: UpgradeResult = { changedAny: false, failedCount: 0 }
  for (const el of elements) {
    const status = upgradeOneMathElement(el, katex)
    result = accumulateUpgradeResult(result, status)
  }
  return result
}

const KATEX_APPLIED_SELECTOR = '[data-math-applied="1"]'

const KATEX_FAILURE_LABELS = {
  plural: (count: number): string => `Math render failed for ${count} expressions`,
  singular: 'Math render failed for 1 expression',
} as const

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
  const katex = await waitForRuntime(KATEX_BRIDGE)
  if (katex === null) {
    return
  }
  // CSS 未注入のまま upgrade すると永続 unstyled な KaTeX HTML が DOM に残る (詳細は isKatexCssReady)。
  // asset-loader が 3 ファイル全成功時に mdxg:katex-ready を再 dispatch するため、 永続 listener が
  // 後追いで再試行する。
  if (!isKatexCssReady()) {
    return
  }
  const { changedAny, failedCount } = upgradeAllMathElements(docEl, katex)
  if (changedAny) {
    refreshAppliedBlocksOriginalHTML(docEl, KATEX_APPLIED_SELECTOR)
    reapplyAllMarks()
  }
  reportRenderFailures(failedCount, KATEX_FAILURE_LABELS)
}

/**
 * paint 後 idle で `upgradeMathElements` を実行するエントリ。doc-renderer.ts から
 * Shiki / Mermaid upgrade と並行に呼ばれる (相互に独立した経路、idempotent)。
 */
export const scheduleKatexUpgrade = (docEl: HTMLElement): void => {
  scheduleUpgradeOnIdle((): void => {
    runUpgradeIgnoringErrors(
      async (): Promise<void> => upgradeMathElements(docEl),
      'Math upgrade failed'
    )
  })
}

// attach 済み listener function reference を保持。null = 未 attach。
// Mermaid / Shiki の永続 listener と完全に対称な runtime 後追い注入用設計
// (docs/feature-online-runtime-assets.md §3.3)。
let katexReadyListener: (() => void) | null = null

/**
 * `mdxg:katex-ready` を永続 listen して受け取るたび `upgrade(doc)` を再走させる。
 * online edition で asset-loader が dynamic import で KaTeX runtime を後追い注入する経路で
 * 必要。`waitForRuntime` の 2 秒 timeout を超える 3G/4G の遅延 import でも event を取りこぼさない
 * (Mermaid と完全に対称)。
 *
 * 重複 attach は module-level reference (`katexReadyListener`) のガードで idempotent。
 * `upgrade` は dependency injection 用の optional 引数で、 default は本 module の
 * `scheduleKatexUpgrade`。listener の発火を test から直接 verify するためにある。
 */
export const attachKatexReadyListener = (
  doc: HTMLElement,
  upgrade: (doc: HTMLElement) => void = scheduleKatexUpgrade
): void => {
  if (katexReadyListener !== null) {
    return
  }
  if (typeof document === 'undefined') {
    return
  }
  const listener = (): void => {
    upgrade(doc)
  }
  katexReadyListener = listener
  document.addEventListener('mdxg:katex-ready', listener)
}

/**
 * 永続 listener を実際に `removeEventListener` で外し、 reference を null に戻す test 専用 helper。
 * 本番経路では呼ばない (page reload で破棄される設計)。
 */
export const resetKatexReadyListenerForTest = (): void => {
  if (katexReadyListener !== null && typeof document !== 'undefined') {
    document.removeEventListener('mdxg:katex-ready', katexReadyListener)
  }
  katexReadyListener = null
}

/**
 * 永続 listener が attach されているかを返す test 専用 helper。 app-wiring の online gate test で
 * 「online=true なら attach される / online=false (CLI) なら attach されない」を verify する用途。
 */
export const hasKatexReadyListenerForTest = (): boolean => katexReadyListener !== null

const buildMathElForTest = (
  mode: 'display' | 'inline',
  source: string | null,
  flag?: 'applied' | 'failed'
): HTMLElement => {
  const el = document.createElement('span')
  el.dataset.math = mode
  if (source !== null) {
    el.dataset.mathSource = source
  }
  if (flag === 'applied') {
    el.dataset.mathApplied = '1'
  } else if (flag === 'failed') {
    el.dataset.mathFailed = '1'
  }
  el.textContent = source ?? ''
  return el
}

const buildMathBlockForTest = (blockId: string, applied: boolean): HTMLElement => {
  const block = document.createElement('div')
  block.setAttribute('data-block-id', blockId)
  const el = document.createElement('span')
  el.dataset.math = 'inline'
  el.dataset.mathSource = 'x'
  if (applied) {
    el.dataset.mathApplied = '1'
  }
  block.appendChild(el)
  return block
}

const wrapInRoot = (block: HTMLElement): HTMLElement => {
  const root = document.createElement('div')
  root.appendChild(block)
  return root
}

const createKatexTestDocEl = (id: string): HTMLElement => {
  const doc = document.createElement('div')
  doc.id = id
  document.body.appendChild(doc)
  return doc
}

const dispatchKatexReady = (times: number): void => {
  for (let count = 0; count < times; count += 1) {
    document.dispatchEvent(new Event('mdxg:katex-ready'))
  }
}

const attachKatexWithEphemeralDoc = (
  id: string,
  upgrade: (doc: HTMLElement) => void
): { remove: () => void } => {
  const doc = createKatexTestDocEl(id)
  attachKatexReadyListener(doc, upgrade)
  return { remove: (): void => doc.remove() }
}

interface KatexResetIsolationCallCounts {
  newCount: number
  oldCount: number
}

interface KatexMockFnLike {
  (...args: unknown[]): unknown
  mock: { calls: unknown[][] }
}

const installKatexStyleBlockForTest = (id: string, content: string): HTMLStyleElement => {
  const el = document.createElement('style')
  el.id = id
  el.textContent = content
  document.body.appendChild(el)
  return el
}

const runKatexResetIsolationScenario = (
  makeFn: () => KatexMockFnLike
): KatexResetIsolationCallCounts => {
  const oldUpgrade = makeFn()
  const newUpgrade = makeFn()
  const first = attachKatexWithEphemeralDoc('doc-katex-test-reset-old', oldUpgrade)
  first.remove()
  resetKatexReadyListenerForTest()
  const second = attachKatexWithEphemeralDoc('doc-katex-test-reset-new', newUpgrade)
  try {
    dispatchKatexReady(1)
    return { newCount: newUpgrade.mock.calls.length, oldCount: oldUpgrade.mock.calls.length }
  } finally {
    second.remove()
  }
}

if (import.meta.vitest) {
  const { afterEach, describe, expect, it, vi } = import.meta.vitest

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

  describe('shouldSkipUpgrade (idempotency contract)', () => {
    it('data-math-applied="1" は再入防止で skip', () => {
      const el = buildMathElForTest('inline', 'x', 'applied')
      expect(shouldSkipUpgrade(el)).toBe(true)
    })

    it('data-math-failed="1" は再試行抑止で skip', () => {
      const el = buildMathElForTest('inline', 'x', 'failed')
      expect(shouldSkipUpgrade(el)).toBe(true)
    })

    it('data-math-source 欠落要素は skip (renderToString に渡せないため)', () => {
      const el = buildMathElForTest('inline', null)
      expect(shouldSkipUpgrade(el)).toBe(true)
    })

    it('新規の data-math + data-math-source 付き要素は upgrade 対象', () => {
      const el = buildMathElForTest('inline', 'x')
      expect(shouldSkipUpgrade(el)).toBe(false)
    })
  })

  describe('applyRenderedKatex (fail-soft フラグ遷移)', () => {
    it('katex-error 含む HTML → data-math-failed="1" + innerHTML 差し替え', () => {
      const el = buildMathElForTest('inline', 'x')
      const status = applyRenderedKatex(el, '<span class="katex-error">err</span>')
      expect(status).toBe('failed')
      expect(el.dataset.mathFailed).toBe('1')
      expect(el.dataset.mathApplied).toBeUndefined()
      expect(el.innerHTML).toBe('<span class="katex-error">err</span>')
    })

    it('正常な KaTeX HTML → data-math-applied="1" + innerHTML 差し替え', () => {
      const el = buildMathElForTest('inline', 'x')
      const status = applyRenderedKatex(el, '<span class="katex"><math>x</math></span>')
      expect(status).toBe('ok')
      expect(el.dataset.mathApplied).toBe('1')
      expect(el.dataset.mathFailed).toBeUndefined()
      expect(el.innerHTML).toBe('<span class="katex"><math>x</math></span>')
    })
  })

  describe('refreshKatexBlockOriginalHTML (blockOriginalHTML 更新契約)', () => {
    it('data-math-applied="1" の親 block の innerHTML を state.blockOriginalHTML に格納', () => {
      const block = buildMathBlockForTest('b-math', true)
      const root = wrapInRoot(block)
      state.blockOriginalHTML.delete('b-math')
      refreshAppliedBlocksOriginalHTML(root, KATEX_APPLIED_SELECTOR)
      expect(state.blockOriginalHTML.get('b-math')).toBe(block.innerHTML)
    })

    it('applied 属性なしの要素は state を触らない', () => {
      const block = buildMathBlockForTest('b-math-untouched', false)
      const root = wrapInRoot(block)
      state.blockOriginalHTML.delete('b-math-untouched')
      refreshAppliedBlocksOriginalHTML(root, KATEX_APPLIED_SELECTOR)
      expect(state.blockOriginalHTML.has('b-math-untouched')).toBe(false)
    })
  })

  // KaTeX バージョン更新時の再評価チェックリスト (scripts/build-katex-css.ts 冒頭 / §5.j) を
  // version-pin assert に加えて継続的に守る contract test。実際に使う KATEX_OPTIONS と
  // isErrorRender を再利用し、pin した katex の挙動 / dist 構造が前提から逸脱したら fail させる。
  describe('KaTeX version contract (§5.j 再評価チェックリスト)', () => {
    const loadKatex = async (): Promise<KatexLike> => {
      const mod = (await import('katex')) as { default: KatexLike }
      return mod.default
    }

    const dangerousCommands = [
      String.raw`\href{https://evil.example/}{x}`,
      String.raw`\url{https://evil.example/}`,
      String.raw`\includegraphics{x.png}`,
      String.raw`\htmlClass{evil}{x}`,
      String.raw`\htmlStyle{color:red}{x}`,
      String.raw`\htmlData{a=b}{x}`,
    ]

    it('§5.f trust:false: 外部リソース系コマンドが <a>/href/<img>/class 注入を出さない', async () => {
      const katex = await loadKatex()
      for (const src of dangerousCommands) {
        const out = katex.renderToString(src, { ...KATEX_OPTIONS, displayMode: false })
        expect(out).not.toMatch(/<a[\s>]/i)
        expect(out).not.toMatch(/href\s*=/i)
        expect(out).not.toMatch(/<img[\s>]/i)
        expect(out).not.toMatch(/class="[^"]*\bevil\b/i)
      }
    })

    it('renderToString は同期で katex 文字列を返す', async () => {
      const katex = await loadKatex()
      const out = katex.renderToString('x^2 + y^2', { ...KATEX_OPTIONS, displayMode: false })
      expect(typeof out).toBe('string')
      expect(out).toContain('katex')
    })

    it('文法エラーは isErrorRender=true (data-math-failed 判定の前提)', async () => {
      const katex = await loadKatex()
      const out = katex.renderToString(String.raw`\frac{`, { ...KATEX_OPTIONS, displayMode: false })
      expect(isErrorRender(out)).toBe(true)
    })

    it('未知マクロは best-effort で isErrorRender=false', async () => {
      const katex = await loadKatex()
      const out = katex.renderToString(String.raw`\href{https://x.example/}{y}`, {
        ...KATEX_OPTIONS,
        displayMode: false,
      })
      expect(isErrorRender(out)).toBe(false)
    })

    it('§5.g フォントセット: katex.min.css の @font-face root は既知 12 種・全 woff2', async () => {
      const fs = await import('node:fs')
      const { createRequire } = await import('node:module')
      const nodeRequire = createRequire(import.meta.url)
      const cssPath = nodeRequire
        .resolve('katex/package.json')
        .replace(/package\.json$/, 'dist/katex.min.css')
      const css = fs.readFileSync(cssPath, 'utf8')
      const blocks = [...css.matchAll(/@font-face\{[^}]*\}/g)].map((match) => match[0])
      // 既知 12 root のみ許容。負の lookahead で MainNew のような未知の長い root の
      // prefix マッチを弾く (新規 family が増えたら fail させる)。
      const knownRoot =
        /font-family:"?KaTeX_(?:AMS|Caligraphic|Fraktur|Main|Math|SansSerif|Script|Size1|Size2|Size3|Size4|Typewriter)(?![A-Za-z0-9])/

      expect(blocks.length).toBeGreaterThan(0)
      expect(blocks.every((block) => knownRoot.test(block))).toBe(true)
      expect(blocks.every((block) => /url\(fonts\/[^)]+\.woff2\)/.test(block))).toBe(true)
    })
  })

  describe('isKatexCssReady (gate against unstyled KaTeX HTML)', () => {
    afterEach((): void => {
      for (const id of ['embedded-katex-css', 'embedded-katex-fonts-extra-css']) {
        const el = document.getElementById(id)
        if (el !== null) {
          el.remove()
        }
      }
      delete document.documentElement.dataset.mdxgOnline
    })

    it('CLI 経路 (online=false) + block 不在なら true (standalone / embed-template 非干渉)', () => {
      expect(isKatexCssReady()).toBe(true)
    })

    it('CLI 経路 (online=false) + 主 CSS 注入済み + fontsExtra 空でも true (--math-fonts minimal 非干渉)', () => {
      installKatexStyleBlockForTest('embedded-katex-css', '.katex{font:1em sans-serif;}')
      installKatexStyleBlockForTest('embedded-katex-fonts-extra-css', '')
      expect(isKatexCssReady()).toBe(true)
    })

    it('online edition + 主 CSS 空なら false (CSS 未注入経路で upgrade skip)', () => {
      document.documentElement.dataset.mdxgOnline = '1'
      installKatexStyleBlockForTest('embedded-katex-css', '')
      installKatexStyleBlockForTest('embedded-katex-fonts-extra-css', '@font-face{}')
      expect(isKatexCssReady()).toBe(false)
    })

    it('online edition + 主 CSS 注入済み + fontsExtra 空なら false (fontsExtra 未注入で upgrade skip)', () => {
      document.documentElement.dataset.mdxgOnline = '1'
      installKatexStyleBlockForTest('embedded-katex-css', '.katex{font:1em sans-serif;}')
      installKatexStyleBlockForTest('embedded-katex-fonts-extra-css', '')
      expect(isKatexCssReady()).toBe(false)
    })

    it('online edition + 2 block 両方注入済みなら true (asset-loader 3 ファイル全成功後)', () => {
      document.documentElement.dataset.mdxgOnline = '1'
      installKatexStyleBlockForTest('embedded-katex-css', '.katex{font:1em sans-serif;}')
      installKatexStyleBlockForTest(
        'embedded-katex-fonts-extra-css',
        '@font-face{font-family:KaTeX_Caligraphic}'
      )
      expect(isKatexCssReady()).toBe(true)
    })
  })

  describe('attachKatexReadyListener (永続 listener)', () => {
    afterEach((): void => {
      resetKatexReadyListenerForTest()
    })

    it('event 発火で upgrade が doc を引数に呼ばれる', () => {
      const doc = createKatexTestDocEl('doc-katex-test-1')
      const upgrade = vi.fn()
      try {
        attachKatexReadyListener(doc, upgrade)
        dispatchKatexReady(1)
        expect(upgrade).toHaveBeenCalledTimes(1)
        expect(upgrade).toHaveBeenCalledWith(doc)
      } finally {
        doc.remove()
      }
    })

    it('2 回呼んでも listener は 1 度しか attach されない (idempotent)', () => {
      const doc = createKatexTestDocEl('doc-katex-test-2')
      const upgrade = vi.fn()
      try {
        attachKatexReadyListener(doc, upgrade)
        attachKatexReadyListener(doc, upgrade)
        dispatchKatexReady(1)
        expect(upgrade).toHaveBeenCalledTimes(1)
      } finally {
        doc.remove()
      }
    })

    it('永続 listener なので複数回 event 発火しても都度 upgrade が走る (waitForRuntime 2秒 timeout 補完)', () => {
      const doc = createKatexTestDocEl('doc-katex-test-3')
      const upgrade = vi.fn()
      try {
        attachKatexReadyListener(doc, upgrade)
        dispatchKatexReady(3)
        expect(upgrade).toHaveBeenCalledTimes(3)
      } finally {
        doc.remove()
      }
    })

    it('reset 後は古い listener が累積せず、新しい upgrade だけが呼ばれる', () => {
      const counts = runKatexResetIsolationScenario(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (): KatexMockFnLike => vi.fn() as unknown as KatexMockFnLike
      )
      expect(counts.newCount).toBe(1)
      expect(counts.oldCount).toBe(0)
    })
  })
}
