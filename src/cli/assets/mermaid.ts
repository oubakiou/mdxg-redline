// Mermaid runtime 注入: --mermaid モード判定 → runtime 読み込み → embed-template.html への inline + stderr 報告。

import type { MermaidMode, RunArgs } from '../parse-args'
import type { EmbedContext } from '../embed-context'
import process from 'node:process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { rewriteEmbeddedMermaid } from '../../core/embed'
import { scanMermaidFences } from '../../core/scan-mermaid'

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

export const applyMermaid = async (
  html: string,
  args: RunArgs,
  ctx: EmbedContext
): Promise<string> => {
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

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

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
      // 引数未指定 (undefined) 時の既定挙動を検証するテストのため no-undefined を無効化する。
      /* eslint-disable no-undefined */
      expect(shouldInjectMermaid(undefined, mdWithMermaid)).toBe(true)
      expect(shouldInjectMermaid(undefined, mdNoMermaid)).toBe(false)
      /* eslint-enable no-undefined */
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
}
