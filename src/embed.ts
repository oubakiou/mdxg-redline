#!/usr/bin/env node
// embed-core の純粋ロジックに、Node 側の I/O (引数パース / ファイル読み書き) だけを付ける薄い CLI。
// ビルド後は dist/embed.mjs として配布される。dist/review.html を同ディレクトリから読み込む。

import { basename, dirname, resolve } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

import { rewriteReviewHtml } from './embed-core'

const USAGE = 'Usage: embed <input.md> <output.html>'

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

// review.html は CLI から見て暗黙的な前提依存のため、未生成時は Node 既定の ENOENT より
// 親切な案内に差し替える。input.md / output.html は利用者が指定したパスなので、
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

const main = async (): Promise<void> => {
  const [inputPath, outputPath] = process.argv.slice(2)
  if (!inputPath || !outputPath) {
    process.stderr.write(`${USAGE}\n`)
    process.exit(1)
  }

  // dist/embed.mjs と dist/review.html は同じディレクトリに配置される前提。
  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const reviewHtmlPath = resolve(scriptDir, 'review.html')

  const [markdown, reviewHtml] = await Promise.all([
    readFile(inputPath, 'utf8'),
    readReviewHtml(reviewHtmlPath),
  ])

  const docName = basename(inputPath)
  const result = rewriteReviewHtml(reviewHtml, markdown, docName)
  await writeFile(outputPath, result, 'utf8')
}

main().catch((error: unknown) => {
  process.stderr.write(`embed: ${errorMessage(error)}\n`)
  process.exit(1)
})
