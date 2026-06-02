/**
 * 1 件分のコメント（位置情報＋本文＋メタ）。
 *
 * `blockId` / `startOffset` / `endOffset` は内部 DOM anchor (mark を貼り直すのに必要)。
 * resume 経路 (CLI が同じプレフィックスの feedback.json を embedded-feedback に inline) で
 * `isImportableComment` の必須フィールドを満たすため、`ExportComment` 経由で feedback.json にも
 * 含める (DESIGN.md §5)。
 * `sourceLine` は元 markdown 全体での 1-origin 行番号で、後段 LLM が markdown ソース上で
 * 位置特定するための一次キー。
 * `pageIndex` は所属仮想ページの 0-origin index で state 内では必須だが、boot 側で sourceLine
 * から逆引きできるため export には含めない。
 *
 * 不変条件 (§6.6):
 * - sourceLine は 1 以上の整数。欠損 / 0 以下は破棄
 * - pageIndex は `0 <= pageIndex < state.pages.length`。範囲外は破棄
 * - blockId は当該ページスコープで `b001` から連番 (§7.1)
 */
export interface Comment {
  blockId: string
  comment: string
  created: string
  endOffset: number
  id: string
  pageIndex: number
  quote: string
  sourceLine: number
  startOffset: number
}

/** 選択範囲を伴う保留状態。フローター・モーダルが共有する形 */
export interface PendingSelection {
  blockId: string
  endOffset: number
  /**
   * Stacked View で選択範囲の祖先 `<section.virtual-page>` から取得した所属 page index。
   * 新規 Comment の `pageIndex` 必須化 (§6.5) を満たすため selection 段階で確定させる。
   */
  pageIndex: number
  quote: string
  startOffset: number
}

/**
 * エクスポート JSON 中の 1 コメント。LLM が markdown ソース上で位置特定するための
 * `headingPath` (祖先見出しパス) と `sourceLine` (ブロック開始行) に加え、内部用 anchor
 * (`blockId` / `startOffset` / `endOffset`) も併記する。
 *
 * 内部 anchor は後段 LLM にとっては余剰だが、CLI が同じ <name>-<hash>-feedback.json を
 * 新ラウンドの review HTML に `<script id="embedded-feedback">` として注入し直す resume
 * 経路で `isImportableComment` (src/core/feedback.ts) の必須フィールドを満たすために必要。
 * docHash 一致前提なら blockId / offset は安全に再利用できる。
 */
export interface ExportComment {
  blockId: string
  comment: string
  created: string
  endOffset: number
  headingPath: string[]
  id: string
  quote: string
  sourceLine: number
  startOffset: number
}

/** エクスポート JSON のスキーマ。internal フィールドが漏れないよう明示列挙 */
export interface ExportPayload {
  comments: ExportComment[]
  docHash: string
  document: string | null
  exportedAt: string
}
