// ブラウザ側 Mermaid upgrade。docs/mdxg-diagram-rendering.md §4 Step 5 / §5.b C 案 に従い、
// 初期 render は Shiki ハイライト経路に乗せたまま `<pre data-mermaid="1">` として paint させ、
// requestIdleCallback で paint 後に各 <pre> を SVG に upgrade する。
//
// upgrade 後の DOM 構造:
//   <pre data-mermaid="1" data-mermaid-applied="1" hidden>…元コード (textContent 保持)…</pre>
//   <svg …>…レンダリング結果…</svg>
//
// <pre> を残す理由: §6 アンカリングは textContent ベースで動くため、元コードを DOM 上に
// 残しておくことで cmt mark / 検索の貼付経路が壊れない (案 A: 検索対象外 skip は selection.ts 側で)。

import { MERMAID_ATTR, MERMAID_ATTR_VALUE } from '../../core/mermaid-attrs'
import { openMermaidModal } from './mermaid-modal'
import { reapplyAllMarks } from '../comments/mark-engine'
import { state } from '../state/app-state'
import { toast } from '../dom/dom-utils'

// dist/mermaid.mjs 側で `globalThis.__mdxgMermaid = mermaid` がセットされる契約 (§3.2 / §5.k)。
// 実 mermaid 型を import すると bundle に重複が出るため、必要最小限の subset を local interface に
// 切り出してランタイム形状チェック (isMermaidLike) で吸収する。
interface MermaidLike {
  initialize: (config: Record<string, unknown>) => void
  render: (id: string, src: string) => Promise<{ svg: string }>
}

// global 名の `__` prefix は他コードとの衝突回避のための規約 (docs/mdxg-diagram-rendering.md §5.k)。
// eslint-disable-next-line no-underscore-dangle
const BRIDGE_KEY = '__mdxgMermaid' as const
const MERMAID_READY_EVENT = 'mdxg:mermaid-ready'
const MERMAID_READY_TIMEOUT_MS = 2000
const IDLE_TIMEOUT_MS = 2000

const readBridge = (): unknown => Reflect.get(globalThis, BRIDGE_KEY)

const isMermaidLike = (value: unknown): value is MermaidLike => {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const obj = value as { initialize?: unknown; render?: unknown }
  return typeof obj.initialize === 'function' && typeof obj.render === 'function'
}

const hasEmbeddedMermaidScript = (): boolean => {
  const el = document.getElementById('embedded-mermaid')
  if (!(el instanceof HTMLElement)) {
    return false
  }
  return (el.textContent ?? '').trim().length > 0
}

const readMermaidBridge = (): MermaidLike | null => {
  const candidate = readBridge()
  if (isMermaidLike(candidate)) {
    return candidate
  }
  return null
}

/**
 * `globalThis.__mdxgMermaid` を取得する。未定義なら mdxg:mermaid-ready イベントを最大
 * MERMAID_READY_TIMEOUT_MS ms 待つ。embedded-mermaid 自体が無い場合は即 null を返す
 * (Mermaid runtime 非注入時のフォールバック経路と一致)。
 */
const waitForMermaidRuntime = async (): Promise<MermaidLike | null> => {
  if (!hasEmbeddedMermaidScript()) {
    return null
  }
  const present = readMermaidBridge()
  if (present !== null) {
    return present
  }
  return new Promise<MermaidLike | null>((resolve): void => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const onReady = (): void => {
      if (timer !== null) {
        clearTimeout(timer)
      }
      resolve(readMermaidBridge())
    }
    timer = setTimeout((): void => {
      document.removeEventListener(MERMAID_READY_EVENT, onReady)
      resolve(null)
    }, MERMAID_READY_TIMEOUT_MS)
    document.addEventListener(MERMAID_READY_EVENT, onReady, { once: true })
  })
}

// docs/mdxg-diagram-rendering.md §5.g: DESIGN.md §1 Theming の CSS variables を
// Mermaid themeVariables 形式に写像する。Mermaid は CSS variables を直接読まず、
// initialize 時の値を SVG に焼き込むため、theme トグル時は全 SVG 再描画が必要。
//
// GitHub 風の中性配色に揃える意図で、ノード塗りは淡グレー (--paper-edge)、枠線は --rule、
// 文字は --ink に固定する。secondary / tertiary を primary と同系で明示するのは、未指定だと
// Mermaid base theme が primaryColor から色相回転で派手な色を自動生成してしまうため。
const THEME_VARIABLE_MAP: readonly { cssVar: string; mermaidKey: string }[] = [
  { cssVar: '--paper', mermaidKey: 'background' },
  { cssVar: '--paper-edge', mermaidKey: 'primaryColor' },
  { cssVar: '--rule', mermaidKey: 'primaryBorderColor' },
  { cssVar: '--ink', mermaidKey: 'primaryTextColor' },
  { cssVar: '--paper-edge', mermaidKey: 'secondaryColor' },
  { cssVar: '--rule', mermaidKey: 'secondaryBorderColor' },
  { cssVar: '--ink', mermaidKey: 'secondaryTextColor' },
  { cssVar: '--paper-edge', mermaidKey: 'tertiaryColor' },
  { cssVar: '--rule', mermaidKey: 'tertiaryBorderColor' },
  { cssVar: '--ink', mermaidKey: 'tertiaryTextColor' },
  { cssVar: '--ink-soft', mermaidKey: 'lineColor' },
  { cssVar: '--ink', mermaidKey: 'textColor' },
  { cssVar: '--highlight-soft', mermaidKey: 'noteBkgColor' },
  { cssVar: '--ink', mermaidKey: 'noteTextColor' },
  { cssVar: '--rule', mermaidKey: 'noteBorderColor' },
  // GitHub は Mermaid に本文と同じ system font を渡す。既定の "trebuchet ms" のままだと
  // GitHub レンダリングと最も目立つ差が出るため fontFamily を明示する。
  { cssVar: '--font-system', mermaidKey: 'fontFamily' },
  // エッジラベルの下敷きを紙色に揃え、線が透けて見えないようにする (GitHub 同様)。
  { cssVar: '--paper', mermaidKey: 'edgeLabelBackground' },
]

export const resolveThemeVariables = (): Record<string, string> => {
  const styles = getComputedStyle(document.documentElement)
  const out: Record<string, string> = {}
  for (const { cssVar, mermaidKey } of THEME_VARIABLE_MAP) {
    const value = styles.getPropertyValue(cssVar).trim()
    if (value !== '') {
      out[mermaidKey] = value
    }
  }
  return out
}

let mermaidInitialized = false

const resolveFontFamily = (): string =>
  getComputedStyle(document.documentElement).getPropertyValue('--font-system').trim()

const initializeMermaidOnce = (mermaid: MermaidLike): void => {
  if (mermaidInitialized) {
    return
  }
  const themeVariables = resolveThemeVariables()
  const config: Record<string, unknown> = {
    securityLevel: 'strict',
    startOnLoad: false,
    theme: 'base',
    themeVariables,
  }
  // themeVariables.fontFamily だけだと base theme が描画時に既定の "trebuchet ms" で
  // 上書きする可能性があるため、top-level config 経由でも明示して確実に伝える。
  const fontFamily = resolveFontFamily()
  if (fontFamily !== '') {
    config.fontFamily = fontFamily
  }
  mermaid.initialize(config)
  mermaidInitialized = true
}

let renderCounter = 0
const uniqueMermaidId = (): string => {
  renderCounter += 1
  return `mdxg-mermaid-${renderCounter}`
}

const parseSvg = (svgText: string): SVGSVGElement | null => {
  const tpl = document.createElement('template')
  tpl.innerHTML = svgText
  const first = tpl.content.firstElementChild
  if (first instanceof SVGSVGElement) {
    return first
  }
  return null
}

const SVG_CLICK_TARGET_TAGS = new Set(['A', 'a'])

// SVG クリックでモーダル拡大を開く (docs/mdxg-diagram-rendering.md §5.j)。
// - 選択中 (テキスト選択操作中の誤発火) はスキップ
// - SVG 内 `<a>` (Mermaid `click` directive) クリックは <a> の既定挙動を優先し open しない
const handleMermaidSvgClick = (event: Event, svg: SVGSVGElement): void => {
  const sel = document.getSelection()
  if (sel !== null && sel.toString().length > 0) {
    return
  }
  const { target } = event
  if (target instanceof Element && target.closest('a') !== null) {
    return
  }
  if (target instanceof Element && SVG_CLICK_TARGET_TAGS.has(target.tagName)) {
    return
  }
  openMermaidModal(svg)
}

const wireMermaidSvgExpand = (svg: SVGSVGElement): void => {
  svg.setAttribute('role', 'button')
  svg.setAttribute('tabindex', '0')
  svg.setAttribute('aria-label', 'Expand diagram')
  svg.setAttribute(MERMAID_ATTR.expandable, MERMAID_ATTR_VALUE)
  svg.style.cursor = 'zoom-in'
  svg.addEventListener('click', (event): void => handleMermaidSvgClick(event, svg))
  svg.addEventListener('keydown', (event): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openMermaidModal(svg)
    }
  })
}

const insertSvgAfterPre = (pre: HTMLElement, svg: SVGSVGElement): void => {
  pre.hidden = true
  // data-mermaid-svg は selection.ts の textSegments skip 判定に使う識別子
  // (docs/mdxg-diagram-rendering.md §4 Step 6 案 A: ダイアグラム内文字列は検索 / コメント対象外)。
  svg.setAttribute(MERMAID_ATTR.svg, MERMAID_ATTR_VALUE)
  wireMermaidSvgExpand(svg)
  pre.after(svg)
}

interface UpgradeResult {
  changedAny: boolean
  failedCount: number
}

type UpgradeStatus = 'failed' | 'ok' | 'skip'

const shouldSkipUpgrade = (pre: HTMLElement): boolean => {
  if (pre.dataset.mermaidApplied === '1' || pre.dataset.mermaidFailed === '1') {
    return true
  }
  return (pre.textContent ?? '').trim() === ''
}

const renderMermaidSvgInto = async (
  pre: HTMLElement,
  mermaid: MermaidLike
): Promise<UpgradeStatus> => {
  const { svg: svgText } = await mermaid.render(uniqueMermaidId(), pre.textContent ?? '')
  const svg = parseSvg(svgText)
  if (svg === null) {
    pre.dataset.mermaidFailed = '1'
    return 'failed'
  }
  insertSvgAfterPre(pre, svg)
  pre.dataset.mermaidApplied = '1'
  return 'ok'
}

const upgradeOneMermaidPre = async (
  pre: HTMLElement,
  mermaid: MermaidLike
): Promise<UpgradeStatus> => {
  if (shouldSkipUpgrade(pre)) {
    return 'skip'
  }
  try {
    return await renderMermaidSvgInto(pre, mermaid)
  } catch {
    pre.dataset.mermaidFailed = '1'
    return 'failed'
  }
}

const collectMermaidPres = (docEl: HTMLElement): HTMLElement[] => {
  const nodes = docEl.querySelectorAll<HTMLElement>(
    `pre[${MERMAID_ATTR.code}="${MERMAID_ATTR_VALUE}"]:not([${MERMAID_ATTR.applied}]):not([${MERMAID_ATTR.failed}])`
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

const upgradeAllMermaidPres = async (
  docEl: HTMLElement,
  mermaid: MermaidLike
): Promise<UpgradeResult> => {
  const pres = collectMermaidPres(docEl)
  let result: UpgradeResult = { changedAny: false, failedCount: 0 }
  for (const pre of pres) {
    // for-await: 並列描画でレイアウトスラッシングが起きないよう順次処理する (§5.b C 案)
    // eslint-disable-next-line no-await-in-loop
    const status = await upgradeOneMermaidPre(pre, mermaid)
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

const cacheParentBlockHtml = (pre: HTMLElement): void => {
  const parent = pre.closest<HTMLElement>('[data-block-id]')
  if (parent === null) {
    return
  }
  const { blockId } = parent.dataset
  if (typeof blockId === 'string' && blockId !== '') {
    state.blockOriginalHTML.set(blockId, parent.innerHTML)
  }
}

// upgrade 後の block 構造変化 (<pre hidden> + sibling <svg>) を blockOriginalHTML に焼き直す。
// <pre> 自身の innerHTML は変わらないが、親ブロック側に sibling <svg> が追加されているため
// 親まで遡って blockOriginalHTML を再構築する。
const refreshMermaidBlockOriginalHTML = (docEl: HTMLElement): void => {
  for (const pre of docEl.querySelectorAll<HTMLElement>(
    `pre[${MERMAID_ATTR.applied}="${MERMAID_ATTR_VALUE}"]`
  )) {
    cacheParentBlockHtml(pre)
  }
}

const reportFailures = (failedCount: number): void => {
  if (failedCount === 0) {
    return
  }
  if (failedCount === 1) {
    toast('Diagram render failed for 1 block')
    return
  }
  toast(`Diagram render failed for ${failedCount} blocks`)
}

/**
 * `#doc` 配下の `<pre data-mermaid="1">` を順次 SVG に upgrade する。
 *
 * - mermaid runtime 未注入 / 取得 timeout の場合は何もしない (Shiki ハイライト fallback が残る)
 * - 選択中は upgrade を後送りし、`selectionchange` で空に戻ったら再試行 (Shiki と同じパターン)
 * - 失敗した <pre> は `data-mermaid-failed="1"` を付けて再試行を抑止し、まとめて 1 回 toast 通知
 * - 成功したブロックは blockOriginalHTML を焼き直して reapplyAllMarks する
 *   (embedded-feedback の cmt mark が upgrade 後の <pre hidden> 内に再貼付される)
 */
export const upgradeMermaidFences = async (docEl: HTMLElement): Promise<void> => {
  const mermaid = await waitForMermaidRuntime()
  if (mermaid === null) {
    return
  }
  initializeMermaidOnce(mermaid)
  const { changedAny, failedCount } = await upgradeAllMermaidPres(docEl, mermaid)
  if (changedAny) {
    refreshMermaidBlockOriginalHTML(docEl)
    reapplyAllMarks()
  }
  reportFailures(failedCount)
}

const runMermaidUpgradeIgnoringErrors = (docEl: HTMLElement): void => {
  upgradeMermaidFences(docEl).catch((): void => {
    // upgrade 内部は個別ブロックの fail を data-mermaid-failed で吸収する。ここに到達する例外は
    // 想定外のため silent drop は避けたいが、本実装ではグローバルエラーハンドラに委ねず
    // ローカルで toast のみ出す方針 (検索 / cmt mark との競合で UX が崩れるのを避ける)。
    toast('Diagram upgrade failed')
  })
}

/**
 * paint 後 idle で `upgradeMermaidFences` を実行するエントリ。doc-renderer.ts から
 * Shiki upgrade と並行に呼ばれる (双方とも idempotent / 互いに干渉しない)。
 */
export const scheduleMermaidUpgrade = (docEl: HTMLElement): void => {
  const run = (): void => {
    if (hasActiveSelection()) {
      onSelectionEnd(run)
      return
    }
    runMermaidUpgradeIgnoringErrors(docEl)
  }
  scheduleIdle(run)
}

const resetMermaidPre = (pre: HTMLElement): void => {
  pre.hidden = false
  delete pre.dataset.mermaidApplied
  delete pre.dataset.mermaidFailed
}

/**
 * Theme トグル時に呼ぶ。`<pre[data-mermaid-applied]>` から sibling SVG を全 remove し、
 * `data-mermaid-applied` / `data-mermaid-failed` フラグを外した上で `mermaidInitialized` を
 * リセットして再 schedule する。次の `upgradeMermaidFences` で新しい themeVariables を持つ
 * mermaid.initialize() が走り、SVG が再生成される (docs/mdxg-diagram-rendering.md §5.g)。
 *
 * Shiki の CSS variables 経路と異なり、Mermaid は CSS variables を SVG に焼き込むため CSS
 * だけでは追従できない。`subscribeSystemTheme` の callback と toggle click の双方から呼ばれる。
 * runtime 未注入時は upgrade 経路自体が no-op になるため安全に呼べる。
 */
export const redrawMermaidForTheme = (docEl: HTMLElement): void => {
  for (const svg of docEl.querySelectorAll(`[${MERMAID_ATTR.svg}="${MERMAID_ATTR_VALUE}"]`)) {
    svg.remove()
  }
  for (const pre of docEl.querySelectorAll<HTMLElement>(
    `pre[${MERMAID_ATTR.code}="${MERMAID_ATTR_VALUE}"]`
  )) {
    resetMermaidPre(pre)
  }
  mermaidInitialized = false
  scheduleMermaidUpgrade(docEl)
}

const buildMermaidPreForTest = (textContent: string): HTMLElement => {
  const pre = document.createElement('pre')
  pre.setAttribute(MERMAID_ATTR.code, MERMAID_ATTR_VALUE)
  pre.textContent = textContent
  return pre
}

const buildMermaidBlockForTest = (blockId: string, applied: boolean): HTMLElement => {
  const block = document.createElement('div')
  block.setAttribute('data-block-id', blockId)
  const pre = document.createElement('pre')
  pre.setAttribute(MERMAID_ATTR.code, MERMAID_ATTR_VALUE)
  if (applied) {
    pre.setAttribute(MERMAID_ATTR.applied, MERMAID_ATTR_VALUE)
  }
  pre.textContent = 'graph TD'
  block.appendChild(pre)
  return block
}

const wrapInRoot = (block: HTMLElement): HTMLElement => {
  const root = document.createElement('div')
  root.appendChild(block)
  return root
}

const noopVoid = (): void => {
  /* noop */
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('isMermaidLike type guard', () => {
    it('initialize / render を関数として持つオブジェクトは true', () => {
      const fake: unknown = { initialize: Function.prototype, render: Function.prototype }
      expect(isMermaidLike(fake)).toBe(true)
    })

    it('片方欠落 / 非オブジェクト / null は false', () => {
      expect(isMermaidLike({ initialize: Function.prototype })).toBe(false)
      expect(isMermaidLike({ render: Function.prototype })).toBe(false)
      expect(isMermaidLike(null)).toBe(false)
      expect(isMermaidLike('mermaid')).toBe(false)
      expect(isMermaidLike(42)).toBe(false)
    })
  })

  describe('uniqueMermaidId', () => {
    it('呼び出すたびに異なる ID を返す', () => {
      const firstId = uniqueMermaidId()
      const secondId = uniqueMermaidId()
      expect(firstId).not.toBe(secondId)
      expect(firstId).toMatch(/^mdxg-mermaid-\d+$/)
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

  describe('shouldSkipUpgrade (idempotency contract)', () => {
    it('新規 <pre data-mermaid="1"> は upgrade 対象 (skip しない)', () => {
      const pre = buildMermaidPreForTest('graph TD\nA --> B')
      expect(shouldSkipUpgrade(pre)).toBe(false)
    })

    it('data-mermaid-applied="1" は再入防止で skip', () => {
      const pre = buildMermaidPreForTest('graph TD')
      pre.dataset.mermaidApplied = '1'
      expect(shouldSkipUpgrade(pre)).toBe(true)
    })

    it('data-mermaid-failed="1" は再試行抑止で skip', () => {
      const pre = buildMermaidPreForTest('graph TD')
      pre.dataset.mermaidFailed = '1'
      expect(shouldSkipUpgrade(pre)).toBe(true)
    })

    it('textContent が空白のみの <pre> は skip', () => {
      const pre = buildMermaidPreForTest('   \n\n   ')
      expect(shouldSkipUpgrade(pre)).toBe(true)
    })
  })

  describe('upgradeOneMermaidPre (fail-soft)', () => {
    it('mermaid.render が throw すると "failed" を返し data-mermaid-failed="1" を立てる', async () => {
      const pre = buildMermaidPreForTest('graph TD')
      const fakeMermaid: MermaidLike = {
        initialize: noopVoid,
        render: async (): Promise<{ svg: string }> => Promise.reject(new Error('parse fail')),
      }
      const status = await upgradeOneMermaidPre(pre, fakeMermaid)
      expect(status).toBe('failed')
      expect(pre.dataset.mermaidFailed).toBe('1')
      expect(pre.dataset.mermaidApplied).toBeUndefined()
    })

    it('SVG パース失敗 (非 <svg> root) は "failed" + data-mermaid-failed="1"', async () => {
      const pre = buildMermaidPreForTest('graph TD')
      const fakeMermaid: MermaidLike = {
        initialize: noopVoid,
        render: async (): Promise<{ svg: string }> =>
          Promise.resolve({ svg: '<div>not svg</div>' }),
      }
      const status = await upgradeOneMermaidPre(pre, fakeMermaid)
      expect(status).toBe('failed')
      expect(pre.dataset.mermaidFailed).toBe('1')
    })

    it('既に applied=1 の <pre> は render を呼ばず "skip"', async () => {
      const pre = buildMermaidPreForTest('graph TD')
      pre.dataset.mermaidApplied = '1'
      let called = false
      const fakeMermaid: MermaidLike = {
        initialize: noopVoid,
        render: async (): Promise<{ svg: string }> => {
          called = true
          return Promise.resolve({ svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' })
        },
      }
      const status = await upgradeOneMermaidPre(pre, fakeMermaid)
      expect(status).toBe('skip')
      expect(called).toBe(false)
    })
  })

  describe('refreshMermaidBlockOriginalHTML (blockOriginalHTML 更新契約)', () => {
    it('data-mermaid-applied="1" の <pre> 親 block の innerHTML を state.blockOriginalHTML に格納', () => {
      const block = buildMermaidBlockForTest('b-test', true)
      const root = wrapInRoot(block)
      state.blockOriginalHTML.delete('b-test')
      refreshMermaidBlockOriginalHTML(root)
      expect(state.blockOriginalHTML.get('b-test')).toBe(block.innerHTML)
    })

    it('applied 属性なしの <pre> は state を触らない', () => {
      const block = buildMermaidBlockForTest('b-untouched', false)
      const root = wrapInRoot(block)
      state.blockOriginalHTML.delete('b-untouched')
      refreshMermaidBlockOriginalHTML(root)
      expect(state.blockOriginalHTML.has('b-untouched')).toBe(false)
    })
  })
}
