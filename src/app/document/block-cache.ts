// `<section.virtual-page>` 配下の全 top-level Element に blockId を採番し、
// `state.blockOriginalHTML` / `state.blockAnchors` を構築する pure module。
// reapplyAllMarks の巻き戻しが依存する「動的装飾を含まない素のレンダリング結果」のキャッシュ規約も
// ここで定義する (DESIGN.md §6 アンカリング / §12 §2 Code Block Rendering)。

import {
  type AnchorPositionsResult,
  type BlockAnchor,
  computeAnchorPositions,
} from '../../core/block-anchors'
import { state } from '../state/app-state'

const formatBlockId = (index: number): string => `b${String(index).padStart(3, '0')}`

interface AnchorAssignmentState {
  anchors: Map<string, BlockAnchor>
  blockIndex: number
  documentaryCursor: number
}

const assignDocumentaryBlock = (
  el: HTMLElement,
  assignment: AnchorAssignmentState,
  positions: AnchorPositionsResult
): void => {
  assignment.blockIndex += 1
  const id = formatBlockId(assignment.blockIndex)
  el.dataset.blockId = id
  state.blockOriginalHTML.set(id, el.innerHTML)
  const position = positions.documentary[assignment.documentaryCursor]
  if (position) {
    assignment.anchors.set(id, position)
  }
  assignment.documentaryCursor += 1
}

const labelFromFootnoteLi = (li: HTMLElement): string | null => {
  const match = /^footnote-(.+)$/u.exec(li.id)
  if (match === null) {
    return null
  }
  return match[1]
}

const resolveFootnoteAnchor = (
  li: HTMLElement,
  positions: AnchorPositionsResult
): BlockAnchor | null => {
  const label = labelFromFootnoteLi(li)
  if (label === null) {
    return null
  }
  return positions.footnoteByLabel.get(label) ?? null
}

const assignFootnoteListItem = (
  li: HTMLElement,
  assignment: AnchorAssignmentState,
  positions: AnchorPositionsResult
): void => {
  assignment.blockIndex += 1
  const id = formatBlockId(assignment.blockIndex)
  li.dataset.blockId = id
  // `<li>` は標準で focusable ではなく、Step 5 の `el.focus()` が footnote-ref クリック後に
  // no-op になってしまうため `tabindex="-1"` を付与する (docs/mdxg-footnotes.md Step 7)。
  // Tab 順には乗らない programmatic focus target として機能し、jump 後の視覚 focus indicator
  // と次の Tab 移動の起点が成立する。
  li.tabIndex = -1
  state.blockOriginalHTML.set(id, li.innerHTML)
  const anchor = resolveFootnoteAnchor(li, positions)
  if (anchor !== null) {
    assignment.anchors.set(id, anchor)
  }
}

const assignFootnoteListItems = (
  section: HTMLElement,
  assignment: AnchorAssignmentState,
  positions: AnchorPositionsResult
): void => {
  for (const li of section.querySelectorAll<HTMLElement>(':scope > ol > li')) {
    assignFootnoteListItem(li, assignment, positions)
  }
}

const assignChildBlock = (
  el: Element,
  assignment: AnchorAssignmentState,
  positions: AnchorPositionsResult
): void => {
  if (!(el instanceof HTMLElement)) {
    return
  }
  if (el.matches('section[data-footnotes]')) {
    assignFootnoteListItems(el, assignment, positions)
  } else {
    assignDocumentaryBlock(el, assignment, positions)
  }
}

const assignSectionBlocks = (
  section: HTMLElement,
  assignment: AnchorAssignmentState,
  positions: AnchorPositionsResult
): void => {
  for (const el of section.children) {
    assignChildBlock(el, assignment, positions)
  }
}

/**
 * Stacked View 配下の全 `<section.virtual-page>` の子要素を文書順に走査し、blockId を採番する。
 * `<section[data-footnotes]>` 配下の `<li id="footnote-<label>">` は label 経由で footnote anchor を
 * 逆引き (DOM は参照順、lexer は定義順なので index ベースの 1:1 対応にできない、Step 4 PoC で確定)。
 * その他の documentary block は文書順に lexer documentary anchor を sequential に消費する。
 *
 * blockOriginalHTML へのキャッシュも同経路で行うことで、mark 再適用 / Shiki upgrade 等の巻き戻しで
 * 同じ blockId が同じ DOM 要素を指すことを構造的に保つ。
 */
export const cacheBlocksAndBuildAnchors = (doc: HTMLElement): Map<string, BlockAnchor> => {
  state.blockOriginalHTML.clear()
  const positions = computeAnchorPositions(state.markdown)
  const assignment: AnchorAssignmentState = {
    anchors: new Map(),
    blockIndex: 0,
    documentaryCursor: 0,
  }
  for (const section of doc.querySelectorAll<HTMLElement>(':scope > section.virtual-page')) {
    assignSectionBlocks(section, assignment, positions)
  }
  return assignment.anchors
}

/**
 * blockOriginalHTML に焼き込まない動的装飾要素のセレクタ。
 *
 * - `mark.cmt`: state.comments を reapplyAllMarks で都度貼り直すため、blockOriginalHTML には
 *   素の本文を保ちたい。焼き込むと巻き戻し時に cmt が DOM 上に残り、新規 cmt が重ねて貼られて
 *   二重 mark になる
 * - `mark.search-hl`: 検索バー open 中のみ DOM に貼られる短命装飾。焼き込むと closeSearch 後の
 *   reapplyAllMarks で復元され、検索を閉じてもハイライトが残る (本ファイル冒頭の検索 UX 不変条件)
 *
 * 焼き込み時の clone から unwrap して、blockOriginalHTML を「動的装飾を含まない素のレンダリング
 * 結果 (Shiki span 入り)」に揃える。
 */
const DYNAMIC_MARK_SELECTORS: readonly string[] = ['mark.cmt', 'mark.search-hl']

const unwrapElement = (target: Element): void => {
  while (target.firstChild) {
    target.before(target.firstChild)
  }
  target.remove()
}

/** clone した subtree から code-block-wrap を剥がす (前処理 1) */
const replaceCodeBlockWraps = (cleaned: Element): void => {
  for (const wrap of cleaned.querySelectorAll('.code-block-wrap')) {
    const pre = wrap.querySelector(':scope > pre')
    if (pre) {
      wrap.replaceWith(pre)
    }
  }
}

/** clone した subtree から cmt / search-hl mark を unwrap する (前処理 2) */
const stripDynamicMarks = (cleaned: Element): void => {
  for (const selector of DYNAMIC_MARK_SELECTORS) {
    for (const mark of cleaned.querySelectorAll(selector)) {
      unwrapElement(mark)
    }
  }
}

/**
 * `<div class="code-block-wrap">` を中の `<pre>` で置き換え、cmt / search-hl mark を unwrap した
 * innerHTML を返す。reapplyAllMarks の巻き戻し前提として、装飾要素を blockOriginalHTML に
 * 焼き込まないキャッシュ値を生成する。
 *
 * code-block-wrap を剥がす理由: `el.innerHTML` をそのままキャッシュすると、後段の reapplyAllMarks
 * が `el.innerHTML = original` で書き戻した際に wrap / Copy button が文字列パース由来の新 DOM
 * として復元され、button の click ハンドラが失われる (ネストされた `<pre>` のみ顕在化。トップ
 * レベル `<pre>` の el は `<pre>` 自身で wrap を内側に含まない)。wrap を剥がした HTML を
 * キャッシュすれば、巻き戻し後 `injectCopyButtons` の「wrap が無ければ作る」分岐が走り button が
 * 正しく再生成される。
 */
const innerHTMLForOriginalCache = (el: HTMLElement): string => {
  const cleaned = el.cloneNode(true)
  if (!(cleaned instanceof Element)) {
    return el.innerHTML
  }
  replaceCodeBlockWraps(cleaned)
  stripDynamicMarks(cleaned)
  return cleaned.innerHTML
}

/**
 * Shiki / Mermaid / KaTeX upgrade 後の DOM 状態を blockOriginalHTML に焼き直す。
 * upgrade 後の reapplyAllMarks は blockOriginalHTML を innerHTML に書き戻すループなので、
 * Shiki span 入りの新 innerHTML をここで反映しておかないと巻き戻しでハイライトが消える。
 */
export const refreshBlockOriginalHTML = (doc: HTMLElement): void => {
  for (const el of doc.querySelectorAll<HTMLElement>('[data-block-id]')) {
    const id = el.dataset.blockId
    if (id) {
      state.blockOriginalHTML.set(id, innerHTMLForOriginalCache(el))
    }
  }
}

const buildElementFromHtml = (html: string): HTMLElement => {
  const element = document.createElement('div')
  element.innerHTML = html
  return element
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('innerHTMLForOriginalCache (動的装飾の焼き込み除外)', () => {
    it('裸の HTML はそのまま返す (Shiki span 等は保持される想定)', () => {
      const el = buildElementFromHtml(
        '<pre class="shiki"><code><span class="line"><span style="color:#abc">x</span></span></code></pre>'
      )
      const result = innerHTMLForOriginalCache(el)
      expect(result).toContain('<pre class="shiki">')
      expect(result).toContain('style="color:#abc"')
    })

    it('mark.cmt を unwrap して中身のテキストだけ残す', () => {
      const el = buildElementFromHtml('Hello <mark class="cmt" data-comment-id="c1">world</mark>!')
      const result = innerHTMLForOriginalCache(el)
      expect(result).toBe('Hello world!')
    })

    it('mark.search-hl を unwrap する', () => {
      const el = buildElementFromHtml(
        'see <mark class="search-hl" data-search-index="0">term</mark> here'
      )
      const result = innerHTMLForOriginalCache(el)
      expect(result).toBe('see term here')
    })

    it('ネスト mark (cmt 内に search-hl) を両方 unwrap する', () => {
      const el = buildElementFromHtml(
        'before <mark class="cmt" data-comment-id="c1">a <mark class="search-hl" data-search-index="0">b</mark> c</mark> after'
      )
      const result = innerHTMLForOriginalCache(el)
      expect(result).toBe('before a b c after')
    })

    it('<div class="code-block-wrap"> を中の <pre> で置き換える (button / lang-label は剥落)', () => {
      const el = buildElementFromHtml(
        '<div class="code-block-wrap">' +
          '<span class="code-lang-label">typescript</span>' +
          '<pre><code>const x = 1</code></pre>' +
          '<button class="code-copy-btn"><span>Copy</span></button>' +
          '</div>'
      )
      const result = innerHTMLForOriginalCache(el)
      expect(result).toContain('<pre>')
      expect(result).toContain('const x = 1')
      expect(result).not.toContain('code-block-wrap')
      expect(result).not.toContain('code-copy-btn')
    })

    it('mark の unwrap と code-block-wrap の剥離が両立する (合わせ技)', () => {
      const el = buildElementFromHtml(
        '<mark class="cmt" data-comment-id="c1">prelude</mark> ' +
          '<div class="code-block-wrap">' +
          '<pre><code>code</code></pre>' +
          '<button class="code-copy-btn"><span>Copy</span></button>' +
          '</div>'
      )
      const result = innerHTMLForOriginalCache(el)
      expect(result).not.toContain('mark class="cmt"')
      expect(result).not.toContain('code-block-wrap')
      expect(result).toContain('prelude')
      expect(result).toContain('<pre><code>code</code></pre>')
    })
  })
}
