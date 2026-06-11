// src/review.html に静的配置された modal の open / close / focus 復元 / backdrop click の
// 共通 controller。help-modal.ts と mermaid-modal.ts が同形ボイラープレート (findBackdrop /
// lastTrigger capture & restore / `open` class toggle / close button focus / backdrop click)
// を共有していたため 1 箇所に集約してドリフトを構造的に防ぐ。
//
// 個別 modal 固有の挙動 (help: toolbar button aria-pressed sync、mermaid: body clear / drag
// state reset 等) は `onAfterOpen` / `onAfterClose` フックで受ける。フック名は意図的に
// after に限定: aria 状態は visual な open/close が完了した後 screen reader に通知される
// べきで、必要が出てから onBefore* を追加する方針 (リファクタリング計画書 H3 §)。

export interface StaticModalConfig {
  backdropId: string
  closeButtonId: string
  onAfterOpen?: () => void
  onAfterClose?: () => void
  /**
   * 開く直後に focus する要素 ID。未指定なら close button (config.closeButtonId) に focus する
   * (WAI-ARIA Authoring Practices のモーダルパターン既定)。input ベース modal (Open URL 等) で
   * 「開いたら即座にタイプ開始」UX を実現するため、close button focus を上書きする用途。
   */
  initialFocusId?: string
}

export interface StaticModalController {
  isOpen: () => boolean
  open: () => void
  close: () => void
  wire: () => void
}

export const createStaticModalController = (config: StaticModalConfig): StaticModalController => {
  // open 直前にフォーカスを持っていた要素を保存し、close 時にそこへ戻す
  // (WAI-ARIA Authoring Practices のモーダルパターン)。controller インスタンス毎に閉じこめる。
  let lastTrigger: HTMLElement | null = null

  const findBackdrop = (): HTMLElement | null => {
    const element = document.getElementById(config.backdropId)
    if (!(element instanceof HTMLElement)) {
      return null
    }
    return element
  }

  const isOpen = (): boolean => {
    const backdrop = findBackdrop()
    if (backdrop === null) {
      return false
    }
    return backdrop.classList.contains('open')
  }

  // modal 内部に既にフォーカスがいる時 (open のループ) は上書きしないことで、最初に modal
  // を開いた発火元を保持する。
  const captureTrigger = (backdrop: HTMLElement): void => {
    if (isOpen()) {
      return
    }
    const active = document.activeElement
    if (active instanceof HTMLElement && !backdrop.contains(active)) {
      lastTrigger = active
    }
  }

  const focusInitial = (): void => {
    const targetId = config.initialFocusId ?? config.closeButtonId
    const target = document.getElementById(targetId)
    if (!(target instanceof HTMLElement)) {
      return
    }
    // iOS Safari は <select> への programmatic focus でネイティブピッカーを即座に展開する。
    // タッチ主体 (coarse pointer) 環境では初期 focus を select に当てず close button へ退避し、
    // 開いただけでピッカーが勝手に開くのを防ぐ (キーボード操作主体の環境は従来どおり select)。
    if (target instanceof HTMLSelectElement && globalThis.matchMedia('(pointer: coarse)').matches) {
      const fallback = document.getElementById(config.closeButtonId)
      if (fallback instanceof HTMLElement) {
        fallback.focus()
      }
      return
    }
    target.focus()
  }

  const restoreTrigger = (): void => {
    if (lastTrigger !== null) {
      lastTrigger.focus()
      lastTrigger = null
    }
  }

  const open = (): void => {
    const backdrop = findBackdrop()
    if (backdrop === null) {
      return
    }
    captureTrigger(backdrop)
    backdrop.classList.add('open')
    if (config.onAfterOpen) {
      config.onAfterOpen()
    }
    focusInitial()
  }

  const close = (): void => {
    const backdrop = findBackdrop()
    if (backdrop === null) {
      return
    }
    backdrop.classList.remove('open')
    if (config.onAfterClose) {
      config.onAfterClose()
    }
    restoreTrigger()
  }

  /**
   * Close ボタンとバックドロップクリックで modal を閉じる listener を attach する。
   * Esc キーは review.ts の global keydown handler 側で他 modal と同列に扱うため、
   * このコントローラでは扱わない。
   */
  const wire = (): void => {
    const backdrop = findBackdrop()
    if (backdrop === null) {
      return
    }
    const closeBtn = document.getElementById(config.closeButtonId)
    if (closeBtn instanceof HTMLElement) {
      closeBtn.addEventListener('click', close)
    }
    backdrop.addEventListener('click', (event): void => {
      if (event.target === backdrop) {
        close()
      }
    })
  }

  return { close, isOpen, open, wire }
}

// aria-modal="true" の semantic を満たすための focus trap helper。
// 配線 (どの keydown で呼ぶか) は global-keyboard.ts 側に集約し、本ファイルは
// 「現在 open の modal 内で tabbable を循環させる」純粋ロジックだけ持つ。
// disabled / tabindex="-1" は除外する。:not(:hidden) を入れていないのは happy-dom が
// `offsetParent` を実装していない問題と、実 modal の tabbable は visible 前提なため。
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const queryTabbablesInside = (root: HTMLElement): HTMLElement[] => [
  ...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
]

interface TabContext {
  first: HTMLElement
  last: HTMLElement
  activeElement: Element | null
  outsideBackdrop: boolean
  goingBackward: boolean
}

const buildTabContext = (
  backdrop: HTMLElement,
  tabbables: HTMLElement[],
  goingBackward: boolean
): TabContext | null => {
  const [first] = tabbables
  const last = tabbables.at(-1)
  if (!first || !last) {
    return null
  }
  const { activeElement } = document
  return {
    activeElement,
    first,
    goingBackward,
    last,
    outsideBackdrop: !backdrop.contains(activeElement),
  }
}

// Tab 押下時に focus を循環/救出する先を決める。null は『何もしない (通常 Tab を許可)』。
const pickFocusTargetForTab = (ctx: TabContext): HTMLElement | null => {
  if (ctx.goingBackward) {
    if (ctx.activeElement === ctx.first || ctx.outsideBackdrop) {
      return ctx.last
    }
    return null
  }
  if (ctx.activeElement === ctx.last || ctx.outsideBackdrop) {
    return ctx.first
  }
  return null
}

const applyTabFocusWrap = (event: KeyboardEvent, next: HTMLElement | null): void => {
  if (next === null) {
    return
  }
  event.preventDefault()
  next.focus()
}

/**
 * Tab / Shift+Tab を modal 内で循環させ、背面 UI へフォーカスが抜けるのを防ぐ。
 * - Tab: 末尾 tabbable で押すと先頭へ wrap。modal 外に focus がある場合も先頭へ救出。
 * - Shift+Tab: 先頭で押すと末尾へ wrap。modal 外なら末尾へ救出。
 * - tabbable が 0 件: native Tab を抑止するだけ (focus 移動しない)。
 * いずれの再 focus も `preventDefault` を伴う。
 */
export const trapTabInModal = (backdrop: HTMLElement, event: KeyboardEvent): void => {
  const tabbables = queryTabbablesInside(backdrop)
  if (tabbables.length === 0) {
    event.preventDefault()
    return
  }
  const ctx = buildTabContext(backdrop, tabbables, event.shiftKey)
  if (ctx === null) {
    return
  }
  applyTabFocusWrap(event, pickFocusTargetForTab(ctx))
}

const setupModalFixtureForTest = (): { backdrop: HTMLElement; closeBtn: HTMLElement } => {
  document.body.innerHTML = ''
  const backdrop = document.createElement('div')
  backdrop.id = 'test-modal-backdrop'
  const closeBtn = document.createElement('button')
  closeBtn.id = 'test-modal-close'
  backdrop.appendChild(closeBtn)
  document.body.appendChild(backdrop)
  return { backdrop, closeBtn }
}

const activeElementIdForTest = (): string => {
  const active = document.activeElement
  if (active instanceof HTMLElement) {
    return active.id
  }
  return ''
}

const setupBackdropWithButtonsForTest = (
  count: number
): { backdrop: HTMLElement; buttons: HTMLElement[] } => {
  document.body.innerHTML = ''
  const backdrop = document.createElement('div')
  backdrop.id = 'trap-test-backdrop'
  backdrop.className = 'modal-backdrop open'
  const buttons = Array.from({ length: count }, (_unused, idx) => {
    const btn = document.createElement('button')
    btn.id = `tab-btn-${idx}`
    backdrop.appendChild(btn)
    return btn
  })
  document.body.appendChild(backdrop)
  return { backdrop, buttons }
}

const newTabKeydownForTest = (shift: boolean): KeyboardEvent =>
  new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: 'Tab',
    shiftKey: shift,
  })

const appendOutsiderButtonForTest = (id: string): HTMLElement => {
  const btn = document.createElement('button')
  btn.id = id
  document.body.appendChild(btn)
  return btn
}

const setupEmptyBackdropAndOutsiderForTest = (): {
  backdrop: HTMLElement
  outsider: HTMLElement
} => {
  document.body.innerHTML = ''
  const backdrop = document.createElement('div')
  backdrop.id = 'empty-backdrop'
  backdrop.className = 'modal-backdrop open'
  document.body.appendChild(backdrop)
  const outsider = document.createElement('button')
  outsider.id = 'lonely-btn'
  document.body.appendChild(outsider)
  return { backdrop, outsider }
}

if (import.meta.vitest) {
  const { afterEach, describe, expect, it, vi } = import.meta.vitest

  afterEach((): void => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  describe('createStaticModalController', () => {
    it('open / close で backdrop の `open` クラスをトグルする', () => {
      const { backdrop } = setupModalFixtureForTest()
      const ctl = createStaticModalController({
        backdropId: 'test-modal-backdrop',
        closeButtonId: 'test-modal-close',
      })
      expect(ctl.isOpen()).toBe(false)
      ctl.open()
      expect(backdrop.classList.contains('open')).toBe(true)
      expect(ctl.isOpen()).toBe(true)
      ctl.close()
      expect(backdrop.classList.contains('open')).toBe(false)
    })

    describe('初期 focus', () => {
      it('open 後は close button に focus する (initialFocusId 未指定時の既定)', () => {
        const { closeBtn } = setupModalFixtureForTest()
        const ctl = createStaticModalController({
          backdropId: 'test-modal-backdrop',
          closeButtonId: 'test-modal-close',
        })
        ctl.open()
        expect(document.activeElement).toBe(closeBtn)
      })

      it('initialFocusId を指定すると close button ではなく指定要素に focus する', () => {
        const { backdrop } = setupModalFixtureForTest()
        const input = document.createElement('input')
        input.id = 'test-modal-input'
        backdrop.appendChild(input)
        const ctl = createStaticModalController({
          backdropId: 'test-modal-backdrop',
          closeButtonId: 'test-modal-close',
          initialFocusId: 'test-modal-input',
        })
        ctl.open()
        expect(document.activeElement).toBe(input)
      })

      it('coarse pointer 環境では select の initialFocusId を close button に退避する', () => {
        const { backdrop, closeBtn } = setupModalFixtureForTest()
        const select = document.createElement('select')
        select.id = 'test-modal-select'
        backdrop.appendChild(select)
        vi.stubGlobal('matchMedia', (): { matches: boolean } => ({ matches: true }))
        const ctl = createStaticModalController({
          backdropId: 'test-modal-backdrop',
          closeButtonId: 'test-modal-close',
          initialFocusId: 'test-modal-select',
        })
        ctl.open()
        expect(document.activeElement).toBe(closeBtn)
      })

      it('fine pointer 環境では select の initialFocusId にそのまま focus する', () => {
        const { backdrop } = setupModalFixtureForTest()
        const select = document.createElement('select')
        select.id = 'test-modal-select'
        backdrop.appendChild(select)
        vi.stubGlobal('matchMedia', (): { matches: boolean } => ({ matches: false }))
        const ctl = createStaticModalController({
          backdropId: 'test-modal-backdrop',
          closeButtonId: 'test-modal-close',
          initialFocusId: 'test-modal-select',
        })
        ctl.open()
        expect(document.activeElement).toBe(select)
      })
    })

    it('close で open 前にフォーカスしていた trigger 要素に focus を戻す', () => {
      setupModalFixtureForTest()
      const trigger = document.createElement('button')
      trigger.id = 'trigger-btn'
      document.body.appendChild(trigger)
      trigger.focus()
      const ctl = createStaticModalController({
        backdropId: 'test-modal-backdrop',
        closeButtonId: 'test-modal-close',
      })
      ctl.open()
      ctl.close()
      expect(document.activeElement).toBe(trigger)
    })

    it('onAfterOpen は backdrop に open が付いた後 / close button focus の前に呼ばれる', () => {
      const { backdrop } = setupModalFixtureForTest()
      const trace: string[] = []
      const ctl = createStaticModalController({
        backdropId: 'test-modal-backdrop',
        closeButtonId: 'test-modal-close',
        onAfterOpen: (): void => {
          if (backdrop.classList.contains('open')) {
            trace.push('open-class-set')
            return
          }
          trace.push('open-class-missing')
        },
      })
      ctl.open()
      expect(trace).toEqual(['open-class-set'])
    })

    it('onAfterClose は backdrop の open が外れた後 / trigger restore の前に呼ばれる', () => {
      setupModalFixtureForTest()
      const trigger = document.createElement('button')
      document.body.appendChild(trigger)
      trigger.focus()
      const trace: string[] = []
      const ctl = createStaticModalController({
        backdropId: 'test-modal-backdrop',
        closeButtonId: 'test-modal-close',
        onAfterClose: (): void => {
          // この時点で activeElement は close-button のまま (restoreTrigger 前)
          trace.push(activeElementIdForTest())
        },
      })
      ctl.open()
      ctl.close()
      expect(trace).toEqual(['test-modal-close'])
      expect(document.activeElement).toBe(trigger)
    })

    it('wire 後は close button クリックで閉じる', () => {
      const { closeBtn } = setupModalFixtureForTest()
      const ctl = createStaticModalController({
        backdropId: 'test-modal-backdrop',
        closeButtonId: 'test-modal-close',
      })
      ctl.wire()
      ctl.open()
      closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(ctl.isOpen()).toBe(false)
    })

    it('wire 後は backdrop 自身のクリックで閉じる', () => {
      const { backdrop } = setupModalFixtureForTest()
      const ctl = createStaticModalController({
        backdropId: 'test-modal-backdrop',
        closeButtonId: 'test-modal-close',
      })
      ctl.wire()
      ctl.open()
      backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(ctl.isOpen()).toBe(false)
    })

    it('wire 後でも backdrop 内側要素のクリックでは閉じない (event.target 判定)', () => {
      const { backdrop } = setupModalFixtureForTest()
      const ctl = createStaticModalController({
        backdropId: 'test-modal-backdrop',
        closeButtonId: 'test-modal-close',
      })
      ctl.wire()
      ctl.open()
      const inner = document.createElement('div')
      backdrop.appendChild(inner)
      inner.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(ctl.isOpen()).toBe(true)
    })

    it('backdrop が DOM に無ければ open / close / wire は no-op (fail-soft)', () => {
      const ctl = createStaticModalController({
        backdropId: 'missing-backdrop',
        closeButtonId: 'missing-close',
      })
      expect((): void => {
        ctl.open()
        ctl.close()
        ctl.wire()
      }).not.toThrow()
      expect(ctl.isOpen()).toBe(false)
    })
  })

  describe('trapTabInModal', () => {
    it('末尾 tabbable で Tab を押すと先頭へ wrap する (preventDefault も伴う)', () => {
      const { backdrop, buttons } = setupBackdropWithButtonsForTest(3)
      const [first, , last] = buttons
      if (!first || !last) {
        throw new Error('fixture missing buttons')
      }
      last.focus()
      const event = newTabKeydownForTest(false)
      trapTabInModal(backdrop, event)
      expect(event.defaultPrevented).toBe(true)
      expect(activeElementIdForTest()).toBe(first.id)
    })

    it('先頭 tabbable で Shift+Tab を押すと末尾へ wrap する', () => {
      const { backdrop, buttons } = setupBackdropWithButtonsForTest(3)
      const [first, , last] = buttons
      if (!first || !last) {
        throw new Error('fixture missing buttons')
      }
      first.focus()
      const event = newTabKeydownForTest(true)
      trapTabInModal(backdrop, event)
      expect(event.defaultPrevented).toBe(true)
      expect(activeElementIdForTest()).toBe(last.id)
    })

    it('modal 外に focus がある状態で Tab を押すと先頭 tabbable へ救出される', () => {
      const { backdrop, buttons } = setupBackdropWithButtonsForTest(2)
      const [first] = buttons
      if (!first) {
        throw new Error('fixture missing buttons')
      }
      appendOutsiderButtonForTest('outside-btn').focus()
      const event = newTabKeydownForTest(false)
      trapTabInModal(backdrop, event)
      expect(event.defaultPrevented).toBe(true)
      expect(activeElementIdForTest()).toBe(first.id)
    })

    it('tabbable が 0 件のときは preventDefault のみで focus 移動しない', () => {
      const { backdrop, outsider } = setupEmptyBackdropAndOutsiderForTest()
      outsider.focus()
      const event = newTabKeydownForTest(false)
      trapTabInModal(backdrop, event)
      expect(event.defaultPrevented).toBe(true)
      // focus は modal 外のまま (救出先が無いため移動しない)
      expect(activeElementIdForTest()).toBe(outsider.id)
    })
  })
}
