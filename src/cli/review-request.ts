#!/usr/bin/env node
// review-request CLI: レビュー依頼用 HTML を生成して標準ブラウザで開くツール。
// embed-core の純粋な埋め込みロジックに、Node 側の I/O (引数パース / ファイル読み書き /
// ブラウザ起動) だけを付ける薄い CLI。ビルド後は dist/review-request.mjs として配布される。
// dist/embed-template.html を同ディレクトリから読み込む。
// 出力ファイル名は docs/DESIGN.md §8 のファイル命名規約に従い、入力 MD の basename と
// 本文 SHA-256 から自動決定する。利用者は output ファイル名ではなくディレクトリだけ指定できる。
// 既定では生成した HTML を OS の標準ブラウザで開く。`--no-open` で抑止できる。
// VS Code Remote Containers / Codespaces のように $BROWSER が file:// を扱えない環境を
// 検知した場合のみ、軽量 HTTP サーバーを 127.0.0.1 に立てて http URL で配信する。
// 本ファイルはエントリ専用に薄く保ち、引数パース / 入力解決 / ブラウザ起動 / HTTP サーバーは
// cli/{parse-args,input-source,open-command,serve}.ts に分割している。

import {
  HELP_TEXT,
  type MermaidMode,
  type RunArgs,
  type ShikiLangsMode,
  parseArgs,
  sanitizeMdFileName,
} from './parse-args'
import { SHIKI_SUPPORTED_LANGS, type SupportedLang } from '../core/shiki-aliases.generated'
import {
  computeDocHash,
  deriveReviewHtmlName,
  formatLoadedStatus,
  rewriteEmbeddedMermaid,
  rewriteEmbeddedShikiLangs,
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
import { defaultCleanIo, runClean } from './clean'
import { dirname, resolve } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'

import { fileURLToPath } from 'node:url'
import { openOutput } from './serve'
import process from 'node:process'
import { resolveInput } from './input-source'
import { scanFencedLangs } from '../core/scan-fenced-langs'
import { scanMermaidFences } from '../core/scan-mermaid'

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

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

interface EmbedContext {
  docHash: string
  docName: string
  markdown: string
  outputPath: string
  reviewHtml: string
  scriptDir: string
}

const prepareEmbed = async (args: RunArgs): Promise<EmbedContext> => {
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

/**
 * `--shiki-langs` の指定 (未指定時は auto と同じ) から注入対象の正規名集合を決める pure 関数。
 * - auto / 未指定: markdown を scan して使用されている grammar を集める
 * - all: SHIKI_SUPPORTED_LANGS 全部
 * - none: 空 Set
 * - list: 指定された Set をそのまま使う
 */
export const resolveShikiLangSet = (
  mode: ShikiLangsMode | undefined,
  markdown: string
): Set<SupportedLang> => {
  if (!mode || mode.kind === 'auto') {
    return scanFencedLangs(markdown)
  }
  if (mode.kind === 'all') {
    return new Set<SupportedLang>(SHIKI_SUPPORTED_LANGS)
  }
  if (mode.kind === 'none') {
    return new Set<SupportedLang>()
  }
  return new Set(mode.langs)
}

// readReviewHtml と同じ理由 (CLI から見た暗黙の前提依存) で、未生成時は Node 既定の ENOENT より
// 親切な案内に差し替える。`dist/shiki-langs/` は commit 対象だが、partial clone や手動削除で
// 欠けるケースが残るため、フェールセーフのエラーパスを残す。
const readGrammarJson = async (scriptDir: string, lang: SupportedLang): Promise<unknown> => {
  const path = resolve(scriptDir, 'shiki-langs', `${lang}.json`)
  try {
    const content = await readFile(path, 'utf8')
    return JSON.parse(content)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(
        `${path} が見つかりません。先に \`npm run build\` を実行して dist/shiki-langs/ を生成してください。`,
        { cause: error }
      )
    }
    throw error
  }
}

const loadShikiGrammars = async (
  langs: ReadonlySet<SupportedLang>,
  scriptDir: string
): Promise<Record<string, unknown>> => {
  const grammars: Record<string, unknown> = {}
  await Promise.all(
    [...langs].map(async (lang: SupportedLang): Promise<void> => {
      grammars[lang] = await readGrammarJson(scriptDir, lang)
    })
  )
  return grammars
}

const applyShikiLangs = async (html: string, args: RunArgs, ctx: EmbedContext): Promise<string> => {
  const langs = resolveShikiLangSet(args.shikiLangs, ctx.markdown)
  const grammars = await loadShikiGrammars(langs, ctx.scriptDir)
  return rewriteEmbeddedShikiLangs(html, grammars)
}

/**
 * `--mermaid` mode と markdown 内容から Mermaid runtime を注入すべきか判定する pure 関数。
 * - mode 未指定 / `auto`: scanMermaidFences > 0 のときのみ true
 * - `on`: 常に true
 * - `off`: 常に false
 */
export const shouldInjectMermaid = (mode: MermaidMode | undefined, markdown: string): boolean => {
  if (mode === 'off') {
    return false
  }
  if (mode === 'on') {
    return true
  }
  return scanMermaidFences(markdown) > 0
}

const readMermaidRuntime = async (scriptDir: string): Promise<string> => {
  const path = resolve(scriptDir, 'mermaid.mjs')
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(
        `${path} が見つかりません。先に \`npm run build\` を実行して dist/mermaid.mjs を生成してください。`,
        { cause: error }
      )
    }
    throw error
  }
}

const applyMermaid = async (html: string, args: RunArgs, ctx: EmbedContext): Promise<string> => {
  if (!shouldInjectMermaid(args.mermaid, ctx.markdown)) {
    return html
  }
  const runtime = await readMermaidRuntime(ctx.scriptDir)
  const { escapedScriptCount, html: rewritten } = rewriteEmbeddedMermaid(html, runtime)
  const count = scanMermaidFences(ctx.markdown)
  process.stderr.write(
    `Detected ${count} mermaid block(s). Embedding mermaid runtime (+~700 KB gzipped).\n`
  )
  if (escapedScriptCount > 0) {
    process.stderr.write(`(escaped ${escapedScriptCount} literal </script> in mermaid runtime)\n`)
  }
  return rewritten
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

// rewrite 系を直列に通して最終 HTML を組み立てる。max-statements を満たすため runEmbed から
// 分離している。
const composeReviewHtml = async (args: RunArgs, ctx: EmbedContext): Promise<string> => {
  const withHints = applyHintRewrites(args, ctx)
  const withShiki = await applyShikiLangs(withHints, args, ctx)
  const withMermaid = await applyMermaid(withShiki, args, ctx)
  const statusText = formatLoadedStatus(ctx.docName, ctx.docHash)
  const withStatus = rewriteInitialStatus(withMermaid, statusText)
  return upsertEmbeddedMdMeta(withStatus)
}

const runEmbed = async (args: RunArgs): Promise<void> => {
  const ctx = await prepareEmbed(args)
  const result = await composeReviewHtml(args, ctx)
  await writeFile(ctx.outputPath, result, 'utf8')
  // 生成先パスを stdout に出し、シェルスクリプト・エージェントが拾えるようにする。
  // --no-open でも、open 成功時でも、失敗時でも常に出す。
  process.stdout.write(`${ctx.outputPath}\n`)
  if (args.open) {
    await openOutput(ctx.outputPath)
  }
}

const handleNonRunModes = (args: ReturnType<typeof parseArgs>): boolean => {
  if (args.mode === 'help') {
    process.stdout.write(HELP_TEXT)
    return true
  }
  if (args.mode === 'invalid') {
    process.stderr.write(
      `mdxg-redline: invalid arguments. Run \`mdxg-redline --help\` for usage.\n`
    )
    process.exit(1)
  }
  return false
}

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2))
  if (handleNonRunModes(args)) {
    return
  }
  if (args.mode === 'clean') {
    const code = await runClean({ dir: args.dir, keep: args.keep, yes: args.yes }, defaultCleanIo)
    process.exit(code)
  }
  if (args.mode === 'run') {
    await runEmbed(args)
  }
}

// in-source test 実行時は main() が走らないようにする。
// vitest は import.meta.vitest を truthy に定義する。production bundle では
// vite config の define で undefined にされ、main() が通常通り起動する。
// path 比較ベースの entry 判定 (`import.meta.url === pathToFileURL(argv[1]).href`) は
// Node が import.meta.url を realpath で返す一方 argv[1] は symlink のままになるため、
// npm の bin (node_modules/.bin/mdxg-redline) や任意の symlink ラッパー経由で起動されると
// silent failure を起こす。本 CLI はそれが主要配布経路なので、path 比較は採用しない。
if (!import.meta.vitest) {
  main().catch((error: unknown): void => {
    process.stderr.write(`review-request: ${errorMessage(error)}\n`)
    process.exit(1)
  })
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('resolveShikiLangSet', () => {
    const sampleMd = '```ts\nx\n```\n\n```py\ny\n```\n'

    // 未指定 (undefined) の挙動は型で `mode: ShikiLangsMode | undefined` として受け入れ、
    // 関数本体の `!mode || mode.kind === 'auto'` で auto と同じパスに合流させている。
    // no-undefined lint 回避のためテスト側では auto 経路の一致確認のみに留める。
    it('auto は markdown スキャン結果を返す', () => {
      const set = resolveShikiLangSet({ kind: 'auto' }, sampleMd)
      expect([...set].toSorted()).toEqual(['python', 'typescript'])
    })

    it('all は SHIKI_SUPPORTED_LANGS 全体を返す', () => {
      const set = resolveShikiLangSet({ kind: 'all' }, sampleMd)
      expect(set.size).toBe(SHIKI_SUPPORTED_LANGS.length)
    })

    it('none は空 Set を返す', () => {
      const set = resolveShikiLangSet({ kind: 'none' }, sampleMd)
      expect(set.size).toBe(0)
    })

    it('list は指定された正規名集合をそのまま返す (markdown 内容に依存しない)', () => {
      const langs = new Set<SupportedLang>(['rust', 'go'])
      const set = resolveShikiLangSet({ kind: 'list', langs }, sampleMd)
      expect([...set].toSorted()).toEqual(['go', 'rust'])
    })
  })

  describe('readGrammarJson', () => {
    // OS をまたいで存在しないことが保証されるディレクトリにフェイクパスを切る。
    // tmp の絶対パス指定で、`shiki-langs/typescript.json` を join しても確実に存在しない。
    const nonexistentScriptDir = resolve('/this-path-should-not-exist-mdxg-redline-test')

    it('ENOENT のときは "npm run build" 案内付きの Error を投げる', async () => {
      try {
        await readGrammarJson(nonexistentScriptDir, 'typescript')
        throw new Error('expected readGrammarJson to throw')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        const message = errorMessage(error)
        expect(message).toContain('shiki-langs')
        expect(message).toContain('npm run build')
      }
    })
  })

  describe('shouldInjectMermaid', () => {
    const mdWithMermaid = '```mermaid\ngraph TD\nA-->B\n```\n'
    const mdNoMermaid = '# Hello\n\n```ts\nlet x = 1\n```\n'

    it('auto × 1+ 件 → true', () => {
      expect(shouldInjectMermaid('auto', mdWithMermaid)).toBe(true)
    })

    it('auto × 0 件 → false', () => {
      expect(shouldInjectMermaid('auto', mdNoMermaid)).toBe(false)
    })

    it('未指定 (undefined) は auto と同じ挙動', () => {
      // eslint-disable-next-line no-undefined
      expect(shouldInjectMermaid(undefined, mdWithMermaid)).toBe(true)
      // eslint-disable-next-line no-undefined
      expect(shouldInjectMermaid(undefined, mdNoMermaid)).toBe(false)
    })

    it('on は markdown 内容に関係なく true', () => {
      expect(shouldInjectMermaid('on', mdWithMermaid)).toBe(true)
      expect(shouldInjectMermaid('on', mdNoMermaid)).toBe(true)
    })

    it('off は markdown 内容に関係なく false', () => {
      expect(shouldInjectMermaid('off', mdWithMermaid)).toBe(false)
      expect(shouldInjectMermaid('off', mdNoMermaid)).toBe(false)
    })
  })

  describe('errorMessage', () => {
    it('Error インスタンスはその message を返す', () => {
      expect(errorMessage(new Error('boom'))).toBe('boom')
    })

    it('Error 以外 (文字列 / 数値 / null など) は String() でフォールバック', () => {
      expect(errorMessage('plain')).toBe('plain')
      expect(errorMessage(42)).toBe('42')
      expect(errorMessage(null)).toBe('null')
    })
  })
}
