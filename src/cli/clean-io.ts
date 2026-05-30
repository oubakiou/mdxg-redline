// `--clean` サブコマンドの実 fs / stdio 統合。
// runClean は CleanIo を DI で受け取るため、本ファイルは「production の defaultCleanIo」と
// それに伴う実 fs 統合テストを集約する。pure ロジック (classifyEntries) / フォーマッタ
// (clean-format.ts) とは分離されている。

import { readdir, unlink } from 'node:fs/promises'

import type { CleanIo } from './clean'

export const defaultCleanIo: CleanIo = {
  readdir: async (path: string, opts: { recursive?: boolean } = {}): Promise<string[]> =>
    readdir(path, { recursive: opts.recursive === true }),
  stderr: (text: string): void => {
    process.stderr.write(text)
  },
  stdout: (text: string): void => {
    process.stdout.write(text)
  },
  unlink: async (path: string): Promise<void> => unlink(path),
}

if (import.meta.vitest) {
  const { describe, expect, it } = await import('vitest')
  const { mkdir, mkdtemp, rm, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const path = await import('node:path')
  const resolve = (...args: string[]): string => path.resolve(...args)
  const { runClean } = await import('./clean')

  // defaultCleanIo は readdir の recursive オプションを実 fs まで伝搬する必要がある
  // (ここで取りこぼすと CLI 実行時だけ -r が無視される。モック io 経由のテストでは検出できない)。
  describe('defaultCleanIo (実 fs 統合)', () => {
    const setupTree = async (): Promise<string> => {
      const base = await mkdtemp(resolve(tmpdir(), 'mdxg-clean-'))
      await writeFile(resolve(base, 'top-a1b2c3d4e5f6a7b8-review.html'), '')
      await mkdir(resolve(base, 'sub'))
      await writeFile(resolve(base, 'sub', 'nested-1111111111111111-feedback.json'), '')
      return base
    }

    it('recursive=false ではサブディレクトリ配下を実際に削除しない', async () => {
      const base = await setupTree()
      await runClean({ dir: base, keep: new Set(), recursive: false, yes: true }, defaultCleanIo)
      const remaining = await readdir(base, { recursive: true })
      expect(remaining.toSorted()).toEqual(['sub', 'sub/nested-1111111111111111-feedback.json'])
      await rm(base, { recursive: true })
    })

    it('recursive=true ではサブディレクトリ配下の成果物まで実際に削除する', async () => {
      const base = await setupTree()
      await runClean({ dir: base, keep: new Set(), recursive: true, yes: true }, defaultCleanIo)
      const remaining = await readdir(base, { recursive: true })
      expect(remaining).toEqual(['sub'])
      await rm(base, { recursive: true })
    })
  })
}
