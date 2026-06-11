// 選択範囲に追従する「＋ Comment」フローター。Selection オブジェクトを読み取り、
// rect 位置と payload (blockId / offsets / quote) を floater 要素に書き込む。
// floater クリック → モーダルへの遷移は comment-modal.ts 側で配線する。

import { getSelectionInfo } from './selection'
import { isCommentModalOpen } from './comment-modal'
import { qs } from '../dom/dom-utils'

/**
 * data-payload に乗せる保存可能サブセット。`SelectionInfo` から rect を除いた構造で、
 * 引数の型をこれに絞ることでテスト fixture が DOMRect を作る必要を無くす。
 * pageIndex は selection.ts が祖先 `<section.virtual-page>` から解決した値で、
 * comment-modal 側で新規 Comment の `pageIndex` (§6.5) に直接埋め込む。
 */
interface FloaterPayloadInfo {
  blockId: string
  endOffset: number
  pageIndex: number
  quote: string
  startOffset: number
}

/**
 * positionFloater が触る最小限の HTMLElement / DOMRect サブセットを構造型で表現する。
 * 実 DOM 要素 / DOMRect はこれを satisfy するため、production の呼び出し側はキャスト不要。
 */
interface FloaterTarget {
  offsetWidth: number
  style: { left: string; top: string }
}
interface FloaterAnchorRect {
  left: number
  top: number
  width: number
}

/** フローターの data-payload 属性に乗せるための保存可能サブセット。rect は実行時の DOM 位置なので含めない */
const selectionFloaterPayload = (info: FloaterPayloadInfo): string =>
  JSON.stringify({
    blockId: info.blockId,
    endOffset: info.endOffset,
    pageIndex: info.pageIndex,
    quote: info.quote,
    startOffset: info.startOffset,
  })

/** 選択 rect の上に floater を中央配置する。`Math.max(8, left)` で画面左端から最低 8px のマージンを確保 */
const positionFloater = (floater: FloaterTarget, rect: FloaterAnchorRect): void => {
  const top = rect.top - 42
  const left = rect.left + rect.width / 2 - floater.offsetWidth / 2
  floater.style.top = `${top}px`
  floater.style.left = `${Math.max(8, left)}px`
}

/** 選択状態に応じてフローターの表示/非表示と位置を更新する。selectionchange ハンドラから呼び出される */
const updateFloaterFromSelection = (): void => {
  // modal 表示中は selection 変化で floater を出し直さない。coarse 環境では floater tap 後も
  // selectionchange が発火し、選択が残ったままだと modal の背後に floater が再出現するため。
  if (isCommentModalOpen()) {
    return
  }
  const info = getSelectionInfo()
  const floater = qs('#floater')
  if (!info) {
    floater.style.display = 'none'
    return
  }
  floater.style.display = 'block'
  positionFloater(floater, info.rect)
  floater.dataset.payload = selectionFloaterPayload(info)
}

/**
 * 選択変更系イベントの共通ハンドラ。
 * 10ms 遅延させているのは、mouseup/keyup 直後に Selection オブジェクトが完全に確定する前に読みに行くと
 * range が空になるブラウザ挙動を避けるため。
 */
const onSelChange = (): void => {
  setTimeout(updateFloaterFromSelection, 10)
}

export const wireFloater = (): void => {
  document.addEventListener('mouseup', onSelChange)
  document.addEventListener('keyup', onSelChange)
  // タッチでの範囲選択は mouseup を発火させないため floater が出ない。selectionchange で拾う。
  // desktop は「離した瞬間に出す」mouseup の方が安定する (selectionchange は選択中も連続発火し
  // floater が追従して出続ける) ので、coarse pointer 環境のときだけ併用する。
  if (globalThis.matchMedia('(pointer: coarse)').matches) {
    document.addEventListener('selectionchange', onSelChange)
  }
}

if (import.meta.vitest) {
  const { afterEach, describe, expect, it, vi } = import.meta.vitest

  describe('selectionFloaterPayload', () => {
    it('blockId / endOffset / pageIndex / quote / startOffset の JSON 文字列を返す (rect は含めない)', () => {
      // toEqual が exact match のため、不要フィールド (rect 等) が混入しないことも同時に検証される
      const parsed: unknown = JSON.parse(
        selectionFloaterPayload({
          blockId: 'b001',
          endOffset: 20,
          pageIndex: 2,
          quote: 'text',
          startOffset: 10,
        })
      )
      expect(parsed).toEqual({
        blockId: 'b001',
        endOffset: 20,
        pageIndex: 2,
        quote: 'text',
        startOffset: 10,
      })
    })
  })

  describe('positionFloater', () => {
    it('rect の水平中央 - floater.offsetWidth/2 を left に、rect.top - 42 を top に書く', () => {
      const floater: FloaterTarget = { offsetWidth: 100, style: { left: '', top: '' } }
      positionFloater(floater, { left: 200, top: 240, width: 80 })
      // top = 240 - 42 = 198 / left = 200 + 40 - 50 = 190
      expect(floater.style.top).toBe('198px')
      expect(floater.style.left).toBe('190px')
    })

    it('画面左端からはみ出す場合は left を 8px に固定する (Math.max(8, left) ガード)', () => {
      const floater: FloaterTarget = { offsetWidth: 200, style: { left: '', top: '' } }
      // 10 + 25 - 100 = -65 → max(8, -65) = 8
      positionFloater(floater, { left: 10, top: 100, width: 50 })
      expect(floater.style.left).toBe('8px')
    })

    it('rect 中央が画面右側にあっても left がそのまま反映される (上限ガードは無い)', () => {
      const floater: FloaterTarget = { offsetWidth: 40, style: { left: '', top: '' } }
      // 800 + 30 - 20 = 810
      positionFloater(floater, { left: 800, top: 0, width: 60 })
      expect(floater.style.left).toBe('810px')
    })
  })

  describe('wireFloater (selectionchange の pointer 別配線)', () => {
    afterEach(() => {
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    })

    it('coarse pointer 環境では selectionchange も購読する', () => {
      vi.stubGlobal('matchMedia', (): { matches: boolean } => ({ matches: true }))
      const spy = vi.spyOn(document, 'addEventListener').mockImplementation((): void => {
        // no-op: 実登録を抑止し、呼び出し時の event 名だけ記録する
      })
      wireFloater()
      const events = spy.mock.calls.map((call) => call[0])
      expect(events).toContain('selectionchange')
    })

    it('fine pointer 環境では selectionchange を購読せず mouseup のみ', () => {
      vi.stubGlobal('matchMedia', (): { matches: boolean } => ({ matches: false }))
      const spy = vi.spyOn(document, 'addEventListener').mockImplementation((): void => {
        // no-op: 実登録を抑止し、呼び出し時の event 名だけ記録する
      })
      wireFloater()
      const events = spy.mock.calls.map((call) => call[0])
      expect(events).not.toContain('selectionchange')
      expect(events).toContain('mouseup')
    })
  })
}
