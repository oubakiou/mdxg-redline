/**
 * 1 件分のコメント（位置情報＋本文＋メタ）。
 *
 * `blockId` / `startOffset` / `endOffset` は内部 DOM anchor (mark を貼り直すのに必要)。
 * `sourceLine` は元 markdown 全体での 1-origin 行番号で、export feedback.json にも出る位置参照。
 * `pageIndex` は所属仮想ページの 0-origin index で、state 内では必須。export には含めない
 * (LLM が解釈できない UI 内部 anchor は出力から除く方針、DESIGN.md §5 /
 *  mdxg-virtual-pages.archive.md §6.5 / §11 参照)。
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
 * エクスポート JSON 中の 1 コメント。内部用 `Comment` の `blockId / startOffset / endOffset`
 * (UI 内部の anchor) は外し、LLM が markdown ソース上で位置特定するための
 * `headingPath` (祖先見出しパス) と `sourceLine` (ブロック開始行) を追加する。
 */
export interface ExportComment {
  comment: string
  created: string
  headingPath: string[]
  id: string
  quote: string
  sourceLine: number
}

/** エクスポート JSON のスキーマ。internal フィールドが漏れないよう明示列挙 */
export interface ExportPayload {
  comments: ExportComment[]
  docHash: string
  document: string | null
  exportedAt: string
}
