// textSegments が「要素ごと skip」する対象を集約した skip rule 集。
// selection.ts (cmt mark 貼付経路) と search.ts (検索一致経路) の共通 invariant としてここに寄せる。
// 各カテゴリの設計判断は selection.ts の元コメントを参照のこと。
//
// - SKIP_TEXT_SEGMENT_CLASSES: code-copy-btn / code-lang-label / sr-only
// - SKIP_TEXT_SEGMENT_ATTRS:   data-mermaid-applied / data-mermaid-svg (値マッチ)
// - SKIP_TEXT_SEGMENT_ATTR_NAMES: data-math / data-footnote-ref / data-footnote-backref (属性有無)
// - SKIP_TEXT_SEGMENT_SELECTOR: 上記すべてを 1 つの CSS セレクタにマージ
// - shouldSkipForTextSegments: walk ベースの判定 (textSegments が使う)

import { MERMAID_ATTR, MERMAID_ATTR_VALUE } from '../core/mermaid-attrs'

// `.code-copy-btn` / `.code-lang-label` 配下: 描画時の動的注入で markdown 由来でなく、
// 再描画前後 / ネストブロック vs トップレベルで textContent が変動するため除外。
// `.sr-only` は marked-footnote 1.4.0 が <section.footnotes> 冒頭に強制挿入する
// a11y 用 visible-hidden <h2> を除外するためだけに使う footnote 専用クラス。
export const SKIP_TEXT_SEGMENT_CLASSES = ['code-copy-btn', 'code-lang-label', 'sr-only']

// upgrade 済み mermaid (<pre[data-mermaid-applied]> + 兄弟 <svg[data-mermaid-svg]>) は
// 「ダイアグラム全体を検索 / コメント対象外にする」案 A (docs/mdxg-diagram-rendering.archive.md
// §4 Step 6)。未 upgrade (data-mermaid="1") は Shiki ハイライト fallback の検索 / コメント対象。
export const SKIP_TEXT_SEGMENT_ATTRS: readonly { attr: string; value: string }[] = [
  { attr: MERMAID_ATTR.applied, value: MERMAID_ATTR_VALUE },
  { attr: MERMAID_ATTR.svg, value: MERMAID_ATTR_VALUE },
]

// 属性の有無だけで skip 判定する系統。
// - data-math: KaTeX upgrade 前後で textContent が大きく変わる ($x$ ↔ MathML+HTML span) ため
//   要素ごと skip する。これで textSegments が upgrade 前後で完全に同じ出力になる
// - data-footnote-ref / data-footnote-backref: marked-footnote 1.4.0 が <sup><a>N</a></sup> /
//   ↩ backref に付与。`[^id]` (4+ chars) と DOM textContent (1 char) の長さ差を吸収し、
//   合成 UI 要素 (`↩`) を選択 / 検索 / mark の対象から外す
export const SKIP_TEXT_SEGMENT_ATTR_NAMES: readonly string[] = [
  'data-math',
  'data-footnote-ref',
  'data-footnote-backref',
]

/** textSegments の walk で node ごとに skip するか判定する。Element 以外は false。 */
export const shouldSkipForTextSegments = (node: Node): boolean => {
  if (!(node instanceof Element)) {
    return false
  }
  if (SKIP_TEXT_SEGMENT_CLASSES.some((cls): boolean => node.classList.contains(cls))) {
    return true
  }
  if (SKIP_TEXT_SEGMENT_ATTR_NAMES.some((attr): boolean => node.hasAttribute(attr))) {
    return true
  }
  return SKIP_TEXT_SEGMENT_ATTRS.some(
    ({ attr, value }): boolean => node.getAttribute(attr) === value
  )
}

// textSegments が要素ごと skip する全カテゴリを 1 つの CSS セレクタにマージ。
// shouldSkipForTextSegments と 1:1 対応させ、要素境界経路 (`range.toString().length` 補正) からも
// 漏れがないようにする (review feedback Medium: footnote skip 追加時に補正側が math 専用のまま
// `<sup>1</sup>` / `<a>↩</a>` 分の長さがズレた回帰への対応)。
export const SKIP_TEXT_SEGMENT_SELECTOR = [
  '[data-math]',
  '[data-footnote-ref]',
  '[data-footnote-backref]',
  '.code-copy-btn',
  '.code-lang-label',
  '.sr-only',
  `[${MERMAID_ATTR.applied}="${MERMAID_ATTR_VALUE}"]`,
  `[${MERMAID_ATTR.svg}="${MERMAID_ATTR_VALUE}"]`,
].join(', ')
