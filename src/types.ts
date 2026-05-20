/** 1 件分のコメント（位置情報＋本文＋メタ）。state.comments / 永続化 / エクスポート JSON で共通の形 */
export interface Comment {
  id: string
  quote: string
  comment: string
  blockId: string
  startOffset: number
  endOffset: number
  created: string
}

/** 選択範囲を伴う保留状態。フローター・モーダルが共有する形 */
export interface PendingSelection {
  blockId: string
  endOffset: number
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
