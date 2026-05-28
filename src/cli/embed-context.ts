// asset 注入 / hint rewrite が共通で参照する読み取り専用コンテキスト。
// compose-review-html.ts の prepareEmbed が組み立て、その後の rewrite chain は
// このオブジェクトをそのまま渡し回す (mutate しない)。

export interface EmbedContext {
  docHash: string
  docName: string
  markdown: string
  outputPath: string
  reviewHtml: string
  scriptDir: string
}
