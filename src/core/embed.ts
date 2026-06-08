// template HTML (dist/embed-template.html / dist/standalone.html) の <script id="embedded-md"> /
// <html> 属性 / runtime asset 注入を担う pure logic 群の barrel。
// Node CLI からも、将来のブラウザ側 UI からも使えるよう、I/O や Node 専用 API は持たない。
// 実体は src/core/embed/{hash,names,script-encoding,html-rewrite,runtime-assets}.ts に分割している。

export { computeDocHash } from './embed/hash'
export { deriveFeedbackJsonName, deriveReviewHtmlName, stripMarkdownExt } from './embed/names'
export {
  encodeEmbeddedFeedback,
  encodeEmbeddedMarkdown,
  encodeEmbeddedShikiLangs,
} from './embed/script-encoding'
export {
  formatLoadedStatus,
  rewriteEmbeddedFeedback,
  rewriteEmbeddedMarkdownCss,
  rewriteEmbeddedShikiLangs,
  rewriteInitialStatus,
  rewriteReviewHtml,
  rewriteTitle,
  upsertEmbeddedMdMeta,
  upsertHtmlDataCommentsWidth,
  upsertHtmlDataPageNavWidth,
  upsertHtmlDataTheme,
  upsertHtmlDataToolbarOpenFile,
  upsertHtmlDataToolbarPasteMarkdown,
} from './embed/html-rewrite'
export {
  type KatexRuntimeAssets,
  rewriteEmbeddedKatex,
  rewriteEmbeddedMermaid,
} from './embed/runtime-assets'
