#!/usr/bin/env node
// Shiki の bundledLanguagesInfo から MDXG Redline で同梱する言語の正規名と
// エイリアスマップを抽出し、src/core/shiki-aliases.generated.ts に書き出す。
//
// この generated.ts は CLI / browser 双方が import するため src/ 配下に置き
// commit する。再生成のトリガは Shiki version up と SPEC_LANGS の増減。
// vite.config.ts の prebuild フックでも同じロジックが走り、毎ビルド最新化される。
// 共通ロジックは scripts/lib/shiki-meta.ts に集約。

import { buildAliasMap, canonicalizeSpec, formatAliasesTs } from './lib/shiki-meta.ts'
import { dirname, resolve } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const readShikiVersion = async (scriptDir: string): Promise<string> => {
  const pkgPath = resolve(scriptDir, '..', 'node_modules', 'shiki', 'package.json')
  const pkgJson = await readFile(pkgPath, 'utf8')
  const parsed: unknown = JSON.parse(pkgJson)
  if (typeof parsed !== 'object' || parsed === null || !('version' in parsed)) {
    throw new Error('shiki/package.json から version を読み取れませんでした')
  }
  const { version } = parsed
  if (typeof version !== 'string') {
    throw new Error('shiki/package.json の version が string ではありません')
  }
  return version
}

const main = async (): Promise<void> => {
  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const shikiVersion = await readShikiVersion(scriptDir)

  const canonicals = canonicalizeSpec()
  const aliasMap = buildAliasMap(canonicals)
  const ts = formatAliasesTs({ aliasMap, canonicals, shikiVersion })

  const outPath = resolve(scriptDir, '..', 'src', 'core', 'shiki-aliases.generated.ts')
  await writeFile(outPath, ts, 'utf8')
  process.stdout.write(
    `Wrote ${outPath} (${canonicals.length} canonical langs, ${Object.keys(aliasMap).length} alias entries)\n`
  )
}

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

main().catch((error: unknown) => {
  process.stderr.write(`generate-shiki-aliases: ${errorMessage(error)}\n`)
  process.exit(1)
})
