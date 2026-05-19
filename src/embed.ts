#!/usr/bin/env node
// embed-core の純粋ロジックに、Node 側の I/O (引数パース / ファイル読み書き) だけを付ける薄い CLI。
// ビルド後は dist/embed.mjs として配布される。dist/review.html を同ディレクトリから読み込む。
// 出力ファイル名は docs/DESIGN.md §8 のファイル命名規約に従い、入力 MD の basename と
// 本文 SHA-256 から自動決定する。利用者は output ファイル名ではなくディレクトリだけ指定できる。

import { basename, dirname, resolve } from 'node:path'
import {
  computeDocHash,
  deriveReviewHtmlName,
  deriveReviewMdName,
  rewriteReviewHtml,
  stripMarkdownExt,
} from './embed-core'
import { readFile, writeFile } from 'node:fs/promises'

import { fileURLToPath } from 'node:url'
import process from 'node:process'

const USAGE = 'Usage: embed <input.md> [output-dir]'

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
  htmlOutputPath: string
  markdown: string
  mdOutputPath: string
  reviewHtml: string
}

// 入力読み込みと出力パスの導出をまとめる。
// main 側の statements を減らすために helper として分離している。
const prepareEmbed = async (
  inputPath: string,
  outputDir: string | undefined
): Promise<EmbedContext> => {
  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const [markdown, reviewHtml] = await Promise.all([
    readFile(inputPath, 'utf8'),
    readReviewHtml(resolve(scriptDir, 'review.html')),
  ])
  const docName = basename(inputPath)
  const docHash = await computeDocHash(markdown)
  const targetDir = outputDir ?? dirname(inputPath)
  const mdFileName = stripMarkdownExt(docName)
  const htmlOutputPath = resolve(targetDir, deriveReviewHtmlName(mdFileName, docHash))
  const mdOutputPath = resolve(targetDir, deriveReviewMdName(mdFileName, docHash))
  return { docName, htmlOutputPath, markdown, mdOutputPath, reviewHtml }
}

// Watch folder 経路と埋め込み HTML 経路の整合性を保つため、HTML と一緒に
// `<mdFileName>-<docHash>-review.md` も書き出す。ブラウザが Watch folder を
// 有効化したときに、HTML の docHash と一致する .md が同ディレクトリに存在することで、
// 古い .md による意図しない上書きを防げる。
const runEmbed = async (inputPath: string, outputDir: string | undefined): Promise<void> => {
  const ctx = await prepareEmbed(inputPath, outputDir)
  const result = rewriteReviewHtml(ctx.reviewHtml, ctx.markdown, ctx.docName)
  await Promise.all([
    writeFile(ctx.htmlOutputPath, result, 'utf8'),
    writeFile(ctx.mdOutputPath, ctx.markdown, 'utf8'),
  ])
  // 生成先パスを stdout に出し、シェルスクリプト・エージェントが拾えるようにする。
  process.stdout.write(`${ctx.htmlOutputPath}\n${ctx.mdOutputPath}\n`)
}

const main = async (): Promise<void> => {
  const [inputPath, outputDir] = process.argv.slice(2)
  if (!inputPath) {
    process.stderr.write(`${USAGE}\n`)
    process.exit(1)
  }
  await runEmbed(inputPath, outputDir)
}

main().catch((error: unknown) => {
  process.stderr.write(`embed: ${errorMessage(error)}\n`)
  process.exit(1)
})
