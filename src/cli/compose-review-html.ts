// review-request CLI の HTML compose pipeline。
// prepareEmbed で入出力パスと docHash を確定し、その後の rewrite を直列に通して最終 HTML を組み立てる。
// - HTML 属性 hint (theme / panel 幅 / toolbar) と <title> の rewrite
// - Shiki grammar / Mermaid runtime / KaTeX runtime の動的注入 (assets/* に委譲)
// - --markdown-css 差し替え
// - 初期 status text と embedded-md meta upsert

import type { RunArgs } from './parse-args'
import { sanitizeMdFileName } from '../core/filename-sanitize'
import {
  computeDocHash,
  deriveReviewHtmlName,
  formatLoadedStatus,
  rewriteEmbeddedMarkdownCss,
  rewriteInitialStatus,
  rewriteReviewHtml,
  rewriteTitle,
  stripMarkdownExt,
  upsertEmbeddedMdMeta,
  upsertHtmlDataCommentsWidth,
  upsertHtmlDataPageNavWidth,
  upsertHtmlDataTheme,
  upsertHtmlDataToolbarOpenFile,
} from '../core/embed'
import { dirname, resolve } from 'node:path'
import type { EmbedContext } from './embed-context'
import { applyKatex } from './assets/katex'
import { applyMermaid } from './assets/mermaid'
import { applyResumeFeedback } from './assets/resume-feedback'
import { applyShikiLangs } from './assets/shiki'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { resolveInput } from './input-source'

// embed-template.html は CLI から見て暗黙的な前提依存のため、未生成時は Node 既定の ENOENT より
// 親切な案内に差し替える。input.md は利用者が指定したパスなので、
// 元の ENOENT メッセージのまま返した方が原因が分かりやすい。
const readReviewHtml = async (path: string): Promise<string> => {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(
        `${path} が見つかりません。先に \`npm run build\` を実行して dist/embed-template.html を生成してください。`,
        { cause: error }
      )
    }
    throw error
  }
}

export const prepareEmbed = async (args: RunArgs): Promise<EmbedContext> => {
  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const [input, reviewHtml] = await Promise.all([
    resolveInput(args.inputPath, args.documentName),
    readReviewHtml(resolve(scriptDir, 'embed-template.html')),
  ])
  const docHash = await computeDocHash(input.markdown)
  const mdFileName = sanitizeMdFileName(stripMarkdownExt(input.docName))
  const targetDir = args.outputDir ?? input.defaultOutputDir
  const outputPath = resolve(targetDir, deriveReviewHtmlName(mdFileName, docHash))
  return {
    docHash,
    docName: input.docName,
    markdown: input.markdown,
    outputPath,
    reviewHtml,
    scriptDir,
  }
}

// --theme 未指定時は data-theme を付けず、既存配布物との互換性を維持する。
// 明示指定時のみ <html data-theme> を上書きし、生成 HTML 初回起動の初期値ヒントにする
// (受信側 inline script は localStorage > data-theme > prefers-color-scheme の優先順位)。
const applyThemeHint = (html: string, themeHint: RunArgs['themeHint']): string => {
  if (typeof themeHint !== 'string') {
    return html
  }
  return upsertHtmlDataTheme(html, themeHint)
}

// --comments-width も applyThemeHint と同じ責務分担。未指定時は属性を付けない。
const applyCommentsWidthHint = (html: string, commentsWidth: RunArgs['commentsWidth']): string => {
  if (typeof commentsWidth !== 'number') {
    return html
  }
  return upsertHtmlDataCommentsWidth(html, commentsWidth)
}

const applyPageNavWidthHint = (html: string, pageNavWidth: RunArgs['pageNavWidth']): string => {
  if (typeof pageNavWidth !== 'number') {
    return html
  }
  return upsertHtmlDataPageNavWidth(html, pageNavWidth)
}

// --show-open-file 未指定時は <html data-toolbar-open-file="off"> を注入し、
// ブラウザ側 toolbar.ts が #btn-load / #file-md を起動時に DOM から削除する。
// CLI 経路で別 MD を誤読み込みする事故 (state.comments 初期化) を構造的に塞ぐ (DESIGN.md §5.g)。
const applyToolbarOpenFileHint = (html: string, showOpenFile: RunArgs['showOpenFile']): string => {
  if (showOpenFile === true) {
    return html
  }
  return upsertHtmlDataToolbarOpenFile(html, 'off')
}

// CLI 出力 HTML の <title> を `MDXG Redline — <docName>` に書き換える。ブラウザタブ /
// ファイル共有先で配布物を識別しやすくするためで、standalone HTML (CLI 非経由) は元のまま。
const applyTitleRewrite = (html: string, docName: string): string =>
  rewriteTitle(html, `MDXG Redline — ${docName}`)

// --markdown-css 未指定時はテンプレートに inline 済みのデフォルト markdown.css をそのまま使い、
// 指定時のみ <style id="markdown-css"> の中身をユーザー CSS で差し替える (DESIGN.md §3 / §12 §1 Theming)。
// readReviewHtml と同じ理由 (CLI から見た暗黙の前提依存) で、未生成テンプレート
// 経路ではなくユーザー指定パスの ENOENT は元の Node メッセージで返す (利用者が指定したパスのため)。
const applyMarkdownCss = async (html: string, args: RunArgs): Promise<string> => {
  if (typeof args.markdownCssPath !== 'string') {
    return html
  }
  const css = await readFile(args.markdownCssPath, 'utf8')
  return rewriteEmbeddedMarkdownCss(html, css)
}

// HTML 属性 hint 系の rewrite を先にまとめて適用する pure 部分 (Mermaid / Shiki 等の
// 重い async 注入と分離して max-statements を満たす)。
const applyHintRewrites = (args: RunArgs, ctx: EmbedContext): string => {
  const embedded = rewriteReviewHtml(ctx.reviewHtml, ctx.markdown, ctx.docName)
  const withTheme = applyThemeHint(embedded, args.themeHint)
  const withComments = applyCommentsWidthHint(withTheme, args.commentsWidth)
  const withPageNav = applyPageNavWidthHint(withComments, args.pageNavWidth)
  const withToolbar = applyToolbarOpenFileHint(withPageNav, args.showOpenFile)
  return applyTitleRewrite(withToolbar, ctx.docName)
}

export const composeReviewHtml = async (args: RunArgs, ctx: EmbedContext): Promise<string> => {
  const withHints = applyHintRewrites(args, ctx)
  const withShiki = await applyShikiLangs(withHints, args, ctx)
  const withMermaid = await applyMermaid(withShiki, args, ctx)
  const withKatex = await applyKatex(withMermaid, args, ctx)
  const withResume = await applyResumeFeedback(withKatex, args, ctx)
  const withMarkdownCss = await applyMarkdownCss(withResume, args)
  const statusText = formatLoadedStatus(ctx.docName, ctx.docHash)
  const withStatus = rewriteInitialStatus(withMarkdownCss, statusText)
  return upsertEmbeddedMdMeta(withStatus)
}
