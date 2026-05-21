#!/usr/bin/env node
// review-request CLI: レビュー依頼用 HTML を生成して標準ブラウザで開くツール。
// embed-core の純粋な埋め込みロジックに、Node 側の I/O (引数パース / ファイル読み書き /
// ブラウザ起動) だけを付ける薄い CLI。ビルド後は dist/review-request.mjs として配布される。
// dist/review.html を同ディレクトリから読み込む。
// 出力ファイル名は docs/DESIGN.md §8 のファイル命名規約に従い、入力 MD の basename と
// 本文 SHA-256 から自動決定する。利用者は output ファイル名ではなくディレクトリだけ指定できる。
// 既定では生成した HTML を OS の標準ブラウザで開く。`--no-open` で抑止できる。
// VS Code Remote Containers / Codespaces のように $BROWSER が file:// を扱えない環境を
// 検知した場合のみ、軽量 HTTP サーバーを 127.0.0.1 に立てて http URL で配信する。
// 本ファイルはエントリ専用に薄く保ち、引数パース / 入力解決 / ブラウザ起動 / HTTP サーバーは
// cli/{parse-args,input-source,open-command,serve}.ts に分割している。

import { HELP_TEXT, type RunArgs, parseArgs, sanitizeMdFileName } from './parse-args'
import {
  computeDocHash,
  deriveReviewHtmlName,
  rewriteReviewHtml,
  stripMarkdownExt,
} from '../core/embed'
import { dirname, resolve } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'

import { fileURLToPath } from 'node:url'
import { openOutput } from './serve'
import process from 'node:process'
import { resolveInput } from './input-source'

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

// review.html は CLI から見て暗黙的な前提依存のため、未生成時は Node 既定の ENOENT より
// 親切な案内に差し替える。input.md は利用者が指定したパスなので、
// 元の ENOENT メッセージのまま返した方が原因が分かりやすい。
const readReviewHtml = async (path: string): Promise<string> => {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(
        `${path} が見つかりません。先に \`npm run build\` を実行して dist/review.html を生成してください。`,
        { cause: error }
      )
    }
    throw error
  }
}

interface EmbedContext {
  docName: string
  markdown: string
  outputPath: string
  reviewHtml: string
}

const prepareEmbed = async (args: RunArgs): Promise<EmbedContext> => {
  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const [input, reviewHtml] = await Promise.all([
    resolveInput(args.inputPath, args.documentName),
    readReviewHtml(resolve(scriptDir, 'review.html')),
  ])
  const docHash = await computeDocHash(input.markdown)
  const mdFileName = sanitizeMdFileName(stripMarkdownExt(input.docName))
  const targetDir = args.outputDir ?? input.defaultOutputDir
  const outputPath = resolve(targetDir, deriveReviewHtmlName(mdFileName, docHash))
  return { docName: input.docName, markdown: input.markdown, outputPath, reviewHtml }
}

const runEmbed = async (args: RunArgs): Promise<void> => {
  const ctx = await prepareEmbed(args)
  const result = rewriteReviewHtml(ctx.reviewHtml, ctx.markdown, ctx.docName)
  await writeFile(ctx.outputPath, result, 'utf8')
  // 生成先パスを stdout に出し、シェルスクリプト・エージェントが拾えるようにする。
  // --no-open でも、open 成功時でも、失敗時でも常に出す。
  process.stdout.write(`${ctx.outputPath}\n`)
  if (args.open) {
    await openOutput(ctx.outputPath)
  }
}

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2))
  if (args.mode === 'help') {
    process.stdout.write(HELP_TEXT)
    return
  }
  if (args.mode === 'invalid') {
    process.stderr.write(
      `mdxg-redline: invalid arguments. Run \`mdxg-redline --help\` for usage.\n`
    )
    process.exit(1)
  }
  await runEmbed(args)
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
