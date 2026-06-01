// 脚注参照 `[N]` のホバー / フォーカスで、ページ末尾の対応する <li> 本文を
// フローティングツールチップとして表示する。コードブロック / 数式 / 脚注内リンク
// など脚注本文の HTML をそのまま再現する (title 属性 / CSS pseudo-element では
// プレーンテキスト止まりになるため別実装)。
//
// 既存挙動 (クリックで末尾セクションへスクロール) は維持し、ホバー / focus 時の
// 表示のみを追加する。

const TOOLTIP_ID = 'footnote-tooltip'
const TOOLTIP_GAP_PX = 8
const VIEWPORT_PADDING_PX = 8
const HOVER_DELAY_MS = 150
// hide には grace period を入れて、参照から tooltip 自身にカーソルを移して
// 内部リンクを辿る Wikipedia 風の操作を許容する。
const HIDE_DELAY_MS = 250

const REF_SELECTOR = 'a[data-footnote-ref]'
const BACKREF_SELECTOR = '[data-footnote-backref]'

interface Position {
  left: number
  top: number
}

interface ViewportRect {
  bottom: number
  left: number
  right: number
  scrollX: number
  scrollY: number
  top: number
}

interface ElementRect {
  bottom: number
  height: number
  left: number
  top: number
  width: number
}

const verticalSlot = (ref: ElementRect, tooltipHeight: number, viewportBottom: number): number => {
  if (ref.bottom + tooltipHeight + TOOLTIP_GAP_PX <= viewportBottom) {
    return ref.bottom + TOOLTIP_GAP_PX
  }
  return ref.top - tooltipHeight - TOOLTIP_GAP_PX
}

// pure: 参照矩形・ツールチップ寸法・ビューポート (scroll 込み) から絶対座標を計算する。
// 下に入れば下、入らなければ上に出す。水平は参照中央寄せ + 端で clamp。
export const computeTooltipPosition = (
  ref: ElementRect,
  tooltipSize: { height: number; width: number },
  viewport: ViewportRect
): Position => {
  const topVp = verticalSlot(ref, tooltipSize.height, viewport.bottom)
  const centeredLeft = ref.left + ref.width / 2 - tooltipSize.width / 2
  const maxLeft = viewport.right - tooltipSize.width - VIEWPORT_PADDING_PX
  const minLeft = viewport.left + VIEWPORT_PADDING_PX
  const clampedLeft = Math.max(minLeft, Math.min(centeredLeft, maxLeft))
  return { left: clampedLeft + viewport.scrollX, top: topVp + viewport.scrollY }
}

// pure: 脚注 <li> 本文 HTML から「↩ 戻り link (backref)」を除いた innerHTML を作る。
// 元 <li> は不変。backref はナビゲーション用 UI で、本文として読ませる要素ではない。
export const buildTooltipBodyHtml = (li: HTMLElement): string => {
  const clone = li.cloneNode(true)
  if (!(clone instanceof HTMLElement)) {
    return li.innerHTML
  }
  for (const backref of clone.querySelectorAll(BACKREF_SELECTOR)) {
    backref.remove()
  }
  return clone.innerHTML.trim()
}

const safeDecodeFragment = (raw: string): string | null => {
  try {
    return decodeURIComponent(raw)
  } catch {
    return null
  }
}

const findHtmlElementById = (id: string): HTMLElement | null => {
  const target = document.getElementById(id)
  if (!(target instanceof HTMLElement)) {
    return null
  }
  return target
}

const extractHashFragment = (href: string | null): string | null => {
  if (href === null || !href.startsWith('#')) {
    return null
  }
  const raw = href.slice(1)
  if (raw === '') {
    return null
  }
  return raw
}

// 参照 <a> の href (`#user-content-fn-N`) から対応する <li id="user-content-fn-N"> を解決する。
// marked-footnote 1.4.0 は label の percent-encoded 形をそのまま id / href に書き出すため
// (例: `[^脚注例]` → `id="user-content-fn-%E8%84%9A%E6%B3%A8%E4%BE%8B"`)、まず raw fragment で
// lookup する。decoded id を持つ他実装 / 手書きの脚注セクションとの互換のため、外れた場合のみ
// decoded fallback を試す。
export const findFootnoteBody = (ref: HTMLAnchorElement): HTMLElement | null => {
  const raw = extractHashFragment(ref.getAttribute('href'))
  if (raw === null) {
    return null
  }
  const rawHit = findHtmlElementById(raw)
  if (rawHit !== null) {
    return rawHit
  }
  const decoded = safeDecodeFragment(raw)
  if (decoded === null || decoded === raw) {
    return null
  }
  return findHtmlElementById(decoded)
}

let tooltipEl: HTMLElement | null = null
let showTimer: ReturnType<typeof setTimeout> | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null
let activeRef: HTMLAnchorElement | null = null

const clearShowTimer = (): void => {
  if (showTimer !== null) {
    clearTimeout(showTimer)
    showTimer = null
  }
}

const clearHideTimer = (): void => {
  if (hideTimer !== null) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

const hide = (): void => {
  clearShowTimer()
  clearHideTimer()
  if (tooltipEl === null) {
    return
  }
  tooltipEl.classList.remove('is-visible')
  tooltipEl.setAttribute('aria-hidden', 'true')
  activeRef = null
}

const scheduleHide = (): void => {
  clearHideTimer()
  hideTimer = setTimeout((): void => {
    hideTimer = null
    hide()
  }, HIDE_DELAY_MS)
}

const createTooltipEl = (): HTMLElement => {
  const el = document.createElement('div')
  el.id = TOOLTIP_ID
  el.className = 'footnote-tooltip'
  el.setAttribute('role', 'tooltip')
  el.setAttribute('aria-hidden', 'true')
  // tooltip 自身へカーソル移動でも hide 予約をキャンセル (Wikipedia 風)。
  el.addEventListener('mouseenter', clearHideTimer)
  el.addEventListener('mouseleave', scheduleHide)
  return el
}

const ensureTooltipEl = (): HTMLElement => {
  if (tooltipEl !== null) {
    return tooltipEl
  }
  const el = createTooltipEl()
  document.body.append(el)
  tooltipEl = el
  return el
}

const applyPosition = (el: HTMLElement, ref: HTMLAnchorElement): void => {
  const refRect = ref.getBoundingClientRect()
  const tooltipRect = el.getBoundingClientRect()
  const viewport: ViewportRect = {
    bottom: window.innerHeight,
    left: 0,
    right: window.innerWidth,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    top: 0,
  }
  const position = computeTooltipPosition(
    {
      bottom: refRect.bottom,
      height: refRect.height,
      left: refRect.left,
      top: refRect.top,
      width: refRect.width,
    },
    { height: tooltipRect.height, width: tooltipRect.width },
    viewport
  )
  el.style.left = `${String(position.left)}px`
  el.style.top = `${String(position.top)}px`
}

const showFor = (ref: HTMLAnchorElement): void => {
  const body = findFootnoteBody(ref)
  if (body === null) {
    return
  }
  const el = ensureTooltipEl()
  el.innerHTML = buildTooltipBodyHtml(body)
  el.classList.add('is-visible')
  el.setAttribute('aria-hidden', 'false')
  activeRef = ref
  applyPosition(el, ref)
}

const scheduleShow = (ref: HTMLAnchorElement): void => {
  clearShowTimer()
  clearHideTimer()
  showTimer = setTimeout((): void => {
    showTimer = null
    showFor(ref)
  }, HOVER_DELAY_MS)
}

const isFootnoteRef = (node: EventTarget | null): HTMLAnchorElement | null => {
  if (!(node instanceof Element)) {
    return null
  }
  const ref = node.closest(REF_SELECTOR)
  if (!(ref instanceof HTMLAnchorElement)) {
    return null
  }
  return ref
}

export const wireFootnoteTooltip = (): void => {
  document.addEventListener('mouseover', (event: MouseEvent): void => {
    const ref = isFootnoteRef(event.target)
    if (ref !== null) {
      scheduleShow(ref)
    }
  })
  document.addEventListener('mouseout', (event: MouseEvent): void => {
    const ref = isFootnoteRef(event.target)
    if (ref === null) {
      return
    }
    // 子要素間の mouseout はスキップ (relatedTarget が同じ ref 配下なら同じ要素上に居る)。
    if (event.relatedTarget instanceof Node && ref.contains(event.relatedTarget)) {
      return
    }
    scheduleHide()
  })
  document.addEventListener('focusin', (event: FocusEvent): void => {
    const ref = isFootnoteRef(event.target)
    if (ref !== null) {
      clearHideTimer()
      showFor(ref)
    }
  })
  document.addEventListener('focusout', (event: FocusEvent): void => {
    const ref = isFootnoteRef(event.target)
    if (ref !== null) {
      scheduleHide()
    }
  })
  document.addEventListener('keydown', (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && activeRef !== null) {
      hide()
    }
  })
}

if (import.meta.vitest) {
  const { afterEach, beforeEach, describe, expect, it } = import.meta.vitest

  // test helper を module top-level に出すと本番 bundle に乗ってしまう (`if (import.meta.vitest)`
  // ブロックは build 時に dead-code 除去されるが、module 直下の helper は除去されない)。
  // consistent-function-scoping はそれを意識しない pedantic な指摘なので、
  // 本ブロックに留めるために局所的に disable する。
  // eslint-disable-next-line unicorn/consistent-function-scoping
  const buildTestDom = (): { li: HTMLElement; ref: HTMLAnchorElement } => {
    document.body.innerHTML =
      '<li id="user-content-fn-1"><p>tooltip 本文</p></li>' +
      '<sup><a data-footnote-ref href="#user-content-fn-1">[1]</a></sup>'
    const li = document.getElementById('user-content-fn-1')
    const ref = document.querySelector('a[data-footnote-ref]')
    if (!(li instanceof HTMLElement) || !(ref instanceof HTMLAnchorElement)) {
      throw new Error('test DOM setup failed')
    }
    return { li, ref }
  }

  describe('computeTooltipPosition', () => {
    const viewport: ViewportRect = {
      bottom: 800,
      left: 0,
      right: 1024,
      scrollX: 0,
      scrollY: 100,
      top: 0,
    }

    it('下に収まれば参照の下に出す', () => {
      const ref = { bottom: 120, height: 20, left: 200, top: 100, width: 40 }
      const tooltipSize = { height: 80, width: 200 }
      const pos = computeTooltipPosition(ref, tooltipSize, viewport)
      expect(pos.top).toBe(120 + TOOLTIP_GAP_PX + viewport.scrollY)
    })

    it('下に収まらなければ参照の上に出す', () => {
      const ref = { bottom: 780, height: 20, left: 200, top: 760, width: 40 }
      const tooltipSize = { height: 80, width: 200 }
      const pos = computeTooltipPosition(ref, tooltipSize, viewport)
      expect(pos.top).toBe(760 - 80 - TOOLTIP_GAP_PX + viewport.scrollY)
    })

    it('参照中央に水平センタリングする', () => {
      const ref = { bottom: 120, height: 20, left: 400, top: 100, width: 40 }
      const tooltipSize = { height: 60, width: 200 }
      const pos = computeTooltipPosition(ref, tooltipSize, viewport)
      expect(pos.left).toBe(400 + 20 - 100 + viewport.scrollX)
    })

    it('左端で clamp する (viewport padding を残す)', () => {
      const ref = { bottom: 120, height: 20, left: 0, top: 100, width: 10 }
      const tooltipSize = { height: 60, width: 200 }
      const pos = computeTooltipPosition(ref, tooltipSize, viewport)
      expect(pos.left).toBe(VIEWPORT_PADDING_PX + viewport.scrollX)
    })

    it('右端で clamp する (viewport padding を残す)', () => {
      const ref = { bottom: 120, height: 20, left: 1020, top: 100, width: 10 }
      const tooltipSize = { height: 60, width: 200 }
      const pos = computeTooltipPosition(ref, tooltipSize, viewport)
      expect(pos.left).toBe(1024 - 200 - VIEWPORT_PADDING_PX + viewport.scrollX)
    })
  })

  describe('buildTooltipBodyHtml', () => {
    it('backref link を除いた HTML を返す', () => {
      const li = document.createElement('li')
      li.innerHTML = '<p>本文 <code>code</code> あり <a href="#x" data-footnote-backref>↩</a></p>'
      const html = buildTooltipBodyHtml(li)
      expect(html).toContain('<code>code</code>')
      expect(html).not.toContain('↩')
      expect(html).not.toContain('data-footnote-backref')
    })

    it('元 <li> は変更しない (clone 経由)', () => {
      const li = document.createElement('li')
      li.innerHTML = '<a href="#x" data-footnote-backref>↩</a>'
      buildTooltipBodyHtml(li)
      expect(li.querySelector('[data-footnote-backref]')).not.toBeNull()
    })
  })

  describe('findFootnoteBody', () => {
    beforeEach(() => {
      document.body.innerHTML = ''
    })

    it('href の id に一致する要素を返す', () => {
      const li = document.createElement('li')
      li.id = 'user-content-fn-1'
      li.textContent = 'footnote body'
      document.body.append(li)
      const anchor = document.createElement('a')
      anchor.setAttribute('data-footnote-ref', '')
      anchor.setAttribute('href', '#user-content-fn-1')
      expect(findFootnoteBody(anchor)).toBe(li)
    })

    it('href が `#` 以外なら null', () => {
      const anchor = document.createElement('a')
      anchor.setAttribute('href', '/elsewhere')
      expect(findFootnoteBody(anchor)).toBeNull()
    })

    it('対応 id が存在しなければ null', () => {
      const anchor = document.createElement('a')
      anchor.setAttribute('href', '#nonexistent')
      expect(findFootnoteBody(anchor)).toBeNull()
    })

    it('marked-footnote 形式 (id / href とも percent-encoded) を raw 一致で解決する', () => {
      const li = document.createElement('li')
      const encoded = `user-content-fn-${encodeURIComponent('脚注例')}`
      li.id = encoded
      document.body.append(li)
      const anchor = document.createElement('a')
      anchor.setAttribute('href', `#${encoded}`)
      expect(findFootnoteBody(anchor)).toBe(li)
    })

    it('decoded id しか持たない実装でも decoded fallback で解決する', () => {
      const li = document.createElement('li')
      li.id = 'user-content-fn-脚注例'
      document.body.append(li)
      const anchor = document.createElement('a')
      anchor.setAttribute('href', `#${encodeURIComponent('user-content-fn-脚注例')}`)
      expect(findFootnoteBody(anchor)).toBe(li)
    })

    it('decoded fallback で id が見つからなければ null', () => {
      const anchor = document.createElement('a')
      anchor.setAttribute('href', `#${encodeURIComponent('user-content-fn-存在しない')}`)
      expect(findFootnoteBody(anchor)).toBeNull()
    })

    it('壊れた percent-encoding (例: `%E0`) は null を返す', () => {
      const anchor = document.createElement('a')
      anchor.setAttribute('href', '#user-content-fn-%E0')
      expect(findFootnoteBody(anchor)).toBeNull()
    })
  })

  describe('wireFootnoteTooltip (DOM 統合)', () => {
    beforeEach(() => {
      document.body.innerHTML = ''
      tooltipEl = null
      activeRef = null
      clearShowTimer()
      clearHideTimer()
    })

    afterEach(() => {
      clearShowTimer()
      clearHideTimer()
    })

    it('focusin で即座に tooltip 本文を表示する', () => {
      wireFootnoteTooltip()
      const { ref } = buildTestDom()
      ref.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
      const tooltip = document.getElementById(TOOLTIP_ID)
      expect(tooltip).not.toBeNull()
      if (tooltip === null) {
        return
      }
      expect(tooltip.innerHTML).toContain('tooltip 本文')
      expect(tooltip.getAttribute('aria-hidden')).toBe('false')
      expect(tooltip.classList.contains('is-visible')).toBe(true)
    })

    it('Esc で hide される', () => {
      wireFootnoteTooltip()
      const { ref } = buildTestDom()
      ref.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      const tooltip = document.getElementById(TOOLTIP_ID)
      expect(tooltip).not.toBeNull()
      if (tooltip === null) {
        return
      }
      expect(tooltip.getAttribute('aria-hidden')).toBe('true')
      expect(tooltip.classList.contains('is-visible')).toBe(false)
    })

    it('対応 <li> が無ければ tooltip 要素は作られない', () => {
      wireFootnoteTooltip()
      const sup = document.createElement('sup')
      const ref = document.createElement('a')
      ref.setAttribute('data-footnote-ref', '')
      ref.setAttribute('href', '#user-content-fn-missing')
      sup.append(ref)
      document.body.append(sup)
      ref.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
      expect(document.getElementById(TOOLTIP_ID)).toBeNull()
    })
  })
}
