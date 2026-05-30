// state.markdown を HTML 化して #doc に流し込み、後段の mark 再適用が依存する
// blockOriginalHTML / blockAnchors の 2 つのキャッシュも更新する orchestration。
// 実体は app/{doc-mount, block-cache, shiki-upgrade}.ts に分割しており、本ファイルは
// 「空状態 / 描画状態の切替 + post-paint upgrade の schedule」に集中する。
//
// 初期 render は marked のみで plain `<pre><code class="language-…">` を出して即 paint させ、
// rAF × 2 で paint 確実後に Shiki を初期化して各 `<pre>` の innerHTML を upgrade する 2 段階構成
// (DESIGN.md §12 §2 Code Block Rendering C 案)。

import { mountRenderedDoc, showEmptyDocument } from './doc-mount'
import { qs } from '../dom/dom-utils'
import { reapplyAllMarks } from '../comments/mark-engine'
import { scheduleKatexUpgrade } from '../renderers/katex'
import { scheduleMermaidUpgrade } from '../renderers/mermaid'
import { scheduleShikiUpgrade } from '../renderers/shiki-upgrade'
import { state } from '../state/app-state'

// paint 後の upgrade 3 系統 (Shiki / Mermaid / KaTeX) をまとめて schedule する。
// それぞれが内部で「runtime 未注入時 / 対象 0 件は no-op」「選択中はスキップ + 再試行」
// を満たしており互いに独立して走るため、ここでは順序を持たず並列に発火するだけで足りる。
const schedulePostPaintUpgrades = (doc: HTMLElement): void => {
  scheduleShikiUpgrade(doc)
  scheduleMermaidUpgrade(doc)
  scheduleKatexUpgrade(doc)
}

export const renderDoc = (): void => {
  const doc = qs('#doc')
  const wrap = qs('#doc-wrap')
  if (!state.markdown) {
    state.blockAnchors.clear()
    showEmptyDocument(doc, wrap)
  } else {
    mountRenderedDoc(doc, wrap)
    reapplyAllMarks()
    schedulePostPaintUpgrades(doc)
  }
  document.documentElement.classList.add('doc-ready')
}
