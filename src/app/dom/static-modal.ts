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
    if (target instanceof HTMLElement) {
      target.focus()
    }
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

if (import.meta.vitest) {
  const { afterEach, describe, expect, it } = import.meta.vitest

  afterEach((): void => {
    document.body.innerHTML = ''
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
}
