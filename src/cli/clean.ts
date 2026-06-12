// `--clean [dir]` サブコマンドの facade (dir 省略時はカレントディレクトリを対象)。
// `<dir>` 直下の `*-<docHash>-review.html` / `*-<docHash>-feedback.json` を
// docs/design/DESIGN.md §8 ファイル命名規約に従って機械的に一括削除する。
// `--recursive` (`-r`) 指定時は readdir({ recursive: true }) でサブディレクトリ配下も対象にする。
//
// 責務分割: pure 分類 (本ファイル `classifyEntries`) / stdout フォーマッタ (`clean-format.ts`)
// / 実 fs 統合 (`clean-io.ts` の `defaultCleanIo`) / orchestrator (本ファイル `runClean`)。

import { resolve } from 'node:path'

import { formatDeleted, formatDryRun } from './clean-format'

/**
 * `<mdFileName>-<16桁hex>-(review.html|feedback.json)` 形式のファイル名を識別する正規表現。
 * 大小無視は parseReviewMdFilename 削除前の挙動と整合させるための保険で、CLI 自体は
 * 小文字 hex で出力するため通常は小文字でマッチする。
 */
export const REVIEW_ARTIFACT_PATTERN = /^(.+)-([0-9a-f]{16})-(review\.html|feedback\.json)$/i

export interface ClassifiedEntry {
  docHash: string
  filename: string
  mdFileName: string
  suffix: 'feedback.json' | 'review.html'
}

export interface ClassifyResult {
  kept: readonly ClassifiedEntry[]
  skipped: readonly string[]
  toDelete: readonly ClassifiedEntry[]
}

const matchEntry = (filename: string): ClassifiedEntry | null => {
  const match = REVIEW_ARTIFACT_PATTERN.exec(filename)
  if (!match) {
    return null
  }
  const [, mdFileName, hash, suffix] = match
  if (suffix !== 'review.html' && suffix !== 'feedback.json') {
    return null
  }
  return {
    docHash: hash.toLowerCase(),
    filename,
    mdFileName,
    suffix,
  }
}

/**
 * ファイル名列を「削除候補 / `--keep` で温存 / 規約外で skip」の 3 つに振り分ける pure 関数。
 * I/O を持たないため in-source test で全分岐を網羅する。
 */
export const classifyEntries = (
  filenames: readonly string[],
  keepHashes: ReadonlySet<string>
): ClassifyResult => {
  const matched = filenames
    .map((filename: string): ClassifiedEntry | null => matchEntry(filename))
    .filter((entry: ClassifiedEntry | null): entry is ClassifiedEntry => entry !== null)
  const skipped = filenames.filter((filename: string): boolean => matchEntry(filename) === null)
  const toDelete = matched.filter(
    (entry: ClassifiedEntry): boolean => !keepHashes.has(entry.docHash)
  )
  const kept = matched.filter((entry: ClassifiedEntry): boolean => keepHashes.has(entry.docHash))
  return { kept, skipped, toDelete }
}

export interface CleanArgs {
  dir: string
  keep: ReadonlySet<string>
  recursive: boolean
  yes: boolean
}

export interface CleanIo {
  readdir: (path: string, opts?: { recursive?: boolean }) => Promise<string[]>
  stderr: (text: string) => void
  stdout: (text: string) => void
  unlink: (path: string) => Promise<void>
}

const deleteEntries = async (
  dir: string,
  entries: readonly ClassifiedEntry[],
  io: CleanIo
): Promise<void> => {
  await Promise.all(
    entries.map(
      async (entry: ClassifiedEntry): Promise<void> => io.unlink(resolve(dir, entry.filename))
    )
  )
}

/**
 * `--clean` の実行エントリ。CLI 経由でも他テスト経路でも使えるよう、I/O は引数で受け取る。
 * 戻り値は process exit code 相当 (0 = success, 1 = failure)。
 */
export const runClean = async (args: CleanArgs, io: CleanIo): Promise<number> => {
  const dirAbs = resolve(args.dir)
  const filenames = await io.readdir(dirAbs, { recursive: args.recursive })
  const result = classifyEntries(filenames, args.keep)
  if (!args.yes) {
    io.stdout(formatDryRun(dirAbs, result))
    return 0
  }
  await deleteEntries(dirAbs, result.toDelete, io)
  io.stdout(formatDeleted(dirAbs, result.toDelete.length, result.kept.length))
  return 0
}

// defaultCleanIo は実 fs / stdio 結合経路として `./clean-io.ts` に集約。
// CLI 既存 import は本ファイルからも参照できるよう re-export しておく。
export { defaultCleanIo } from './clean-io'

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('REVIEW_ARTIFACT_PATTERN', () => {
    it('review.html と feedback.json にマッチする', () => {
      expect(REVIEW_ARTIFACT_PATTERN.test('spec-a1b2c3d4e5f6a7b8-review.html')).toBe(true)
      expect(REVIEW_ARTIFACT_PATTERN.test('spec-a1b2c3d4e5f6a7b8-feedback.json')).toBe(true)
    })

    it('review.md (旧形式) にはマッチしない', () => {
      expect(REVIEW_ARTIFACT_PATTERN.test('spec-a1b2c3d4e5f6a7b8-review.md')).toBe(false)
    })

    it('hash が 16 桁でない場合はマッチしない', () => {
      expect(REVIEW_ARTIFACT_PATTERN.test('spec-abc-review.html')).toBe(false)
      expect(REVIEW_ARTIFACT_PATTERN.test('spec-a1b2c3d4e5f6a7b-review.html')).toBe(false)
    })

    it('hash 部分に非 hex 文字を含む場合はマッチしない', () => {
      expect(REVIEW_ARTIFACT_PATTERN.test('spec-zzzzzzzzzzzzzzzz-review.html')).toBe(false)
    })

    it('原本 .md や .archive.md はマッチしない', () => {
      expect(REVIEW_ARTIFACT_PATTERN.test('DESIGN.md')).toBe(false)
      expect(REVIEW_ARTIFACT_PATTERN.test('html-split-standalone-embed-template.archive.md')).toBe(
        false
      )
    })
  })

  describe('classifyEntries', () => {
    it('規約にマッチするものを toDelete、それ以外を skipped に振り分ける', () => {
      const result = classifyEntries(
        [
          'spec-a1b2c3d4e5f6a7b8-review.html',
          'spec-a1b2c3d4e5f6a7b8-feedback.json',
          'DESIGN.md',
          'README.md',
        ],
        new Set()
      )
      expect(result.toDelete.map((entry: ClassifiedEntry): string => entry.filename)).toEqual([
        'spec-a1b2c3d4e5f6a7b8-review.html',
        'spec-a1b2c3d4e5f6a7b8-feedback.json',
      ])
      expect(result.skipped).toEqual(['DESIGN.md', 'README.md'])
      expect(result.kept).toEqual([])
    })

    it('--keep で指定された hash は kept に分離される', () => {
      const result = classifyEntries(
        [
          'a-1111111111111111-review.html',
          'a-1111111111111111-feedback.json',
          'b-2222222222222222-review.html',
        ],
        new Set(['1111111111111111'])
      )
      expect(result.toDelete.map((entry: ClassifiedEntry): string => entry.filename)).toEqual([
        'b-2222222222222222-review.html',
      ])
      expect(result.kept.map((entry: ClassifiedEntry): string => entry.filename)).toEqual([
        'a-1111111111111111-review.html',
        'a-1111111111111111-feedback.json',
      ])
    })

    it('mdFileName にハイフンが含まれていても docHash を末尾から抽出できる', () => {
      const result = classifyEntries(['part-1-pre-release-a1b2c3d4e5f6a7b8-review.html'], new Set())
      expect(result.toDelete).toHaveLength(1)
      const [entry] = result.toDelete
      expect(entry.docHash).toBe('a1b2c3d4e5f6a7b8')
      expect(entry.mdFileName).toBe('part-1-pre-release')
    })

    it('大文字 hex を含むファイル名も小文字に正規化して keep と照合できる', () => {
      const result = classifyEntries(
        ['spec-A1B2C3D4E5F6A7B8-review.html'],
        new Set(['a1b2c3d4e5f6a7b8'])
      )
      expect(result.toDelete).toHaveLength(0)
      expect(result.kept).toHaveLength(1)
    })

    it('原本 .md・.archive.md・dotfile などは skipped に入る', () => {
      const result = classifyEntries(
        ['DESIGN.md', 'spec.archive.md', '.gitkeep', 'spec-a1b2c3d4e5f6a7b8-review.md'],
        new Set()
      )
      expect(result.toDelete).toEqual([])
      expect(result.skipped).toEqual([
        'DESIGN.md',
        'spec.archive.md',
        '.gitkeep',
        'spec-a1b2c3d4e5f6a7b8-review.md',
      ])
    })

    it('空入力は全カテゴリ空', () => {
      const result = classifyEntries([], new Set())
      expect(result.toDelete).toEqual([])
      expect(result.kept).toEqual([])
      expect(result.skipped).toEqual([])
    })
  })

  describe('runClean: dry-run', () => {
    const setup = (filenames: readonly string[]): { io: CleanIo; output: string[] } => {
      const output: string[] = []
      const io: CleanIo = {
        readdir: async (): Promise<string[]> => [...filenames],
        stderr: (): void => {
          // tests only assert stdout
        },
        stdout: (text: string): void => {
          output.push(text)
        },
        unlink: async (): Promise<void> => {
          throw new Error('unlink must not be called in dry-run')
        },
      }
      return { io, output }
    }

    it('--yes 未指定では unlink を呼ばず削除候補を列挙する', async () => {
      const { io, output } = setup([
        'spec-a1b2c3d4e5f6a7b8-review.html',
        'spec-a1b2c3d4e5f6a7b8-feedback.json',
        'DESIGN.md',
      ])
      const code = await runClean(
        { dir: '/tmp/x', keep: new Set(), recursive: false, yes: false },
        io
      )
      expect(code).toBe(0)
      expect(output.join('')).toMatch(/Would delete 2 file\(s\)/)
      expect(output.join('')).toMatch(/spec-a1b2c3d4e5f6a7b8-review\.html/)
      expect(output.join('')).toMatch(/Run with --yes to delete\./)
    })

    it('マッチが 0 件のときは "No review/feedback artifacts found" を表示する', async () => {
      const { io, output } = setup(['DESIGN.md', 'README.md'])
      const code = await runClean(
        { dir: '/tmp/x', keep: new Set(), recursive: false, yes: false },
        io
      )
      expect(code).toBe(0)
      expect(output.join('')).toMatch(/No review\/feedback artifacts found/)
    })
  })

  describe('runClean: --yes', () => {
    it('--yes 指定では unlink を呼んで削除件数を表示する', async () => {
      const unlinked: string[] = []
      const output: string[] = []
      const io: CleanIo = {
        readdir: async (): Promise<string[]> => [
          'spec-a1b2c3d4e5f6a7b8-review.html',
          'spec-a1b2c3d4e5f6a7b8-feedback.json',
          'DESIGN.md',
        ],
        stderr: (): void => {
          // unused
        },
        stdout: (text: string): void => {
          output.push(text)
        },
        unlink: async (path: string): Promise<void> => {
          unlinked.push(path)
        },
      }
      const code = await runClean(
        { dir: '/tmp/x', keep: new Set(), recursive: false, yes: true },
        io
      )
      expect(code).toBe(0)
      expect(unlinked.toSorted()).toEqual([
        '/tmp/x/spec-a1b2c3d4e5f6a7b8-feedback.json',
        '/tmp/x/spec-a1b2c3d4e5f6a7b8-review.html',
      ])
      expect(output.join('')).toMatch(/Deleted 2 file\(s\)/)
    })

    it('--keep が指定された hash は unlink 対象から除外される', async () => {
      const unlinked: string[] = []
      const io: CleanIo = {
        readdir: async (): Promise<string[]> => [
          'a-1111111111111111-review.html',
          'b-2222222222222222-review.html',
        ],
        stderr: (): void => {
          // unused
        },
        stdout: (): void => {
          // unused
        },
        unlink: async (path: string): Promise<void> => {
          unlinked.push(path)
        },
      }
      await runClean(
        { dir: '/tmp/x', keep: new Set(['1111111111111111']), recursive: false, yes: true },
        io
      )
      expect(unlinked).toEqual(['/tmp/x/b-2222222222222222-review.html'])
    })

    it('recursive=true ではサブディレクトリ配下の成果物も unlink 対象になる', async () => {
      const unlinked: string[] = []
      const readdirOpts: ({ recursive?: boolean } | undefined)[] = []
      const io: CleanIo = {
        readdir: async (_path: string, opts?: { recursive?: boolean }): Promise<string[]> => {
          readdirOpts.push(opts)
          return [
            'spec-a1b2c3d4e5f6a7b8-review.html',
            'sub',
            'sub/nested-1111111111111111-feedback.json',
          ]
        },
        stderr: (): void => {
          // unused
        },
        stdout: (): void => {
          // unused
        },
        unlink: async (path: string): Promise<void> => {
          unlinked.push(path)
        },
      }
      await runClean({ dir: '/tmp/x', keep: new Set(), recursive: true, yes: true }, io)
      expect(readdirOpts).toEqual([{ recursive: true }])
      expect(unlinked.toSorted()).toEqual([
        '/tmp/x/spec-a1b2c3d4e5f6a7b8-review.html',
        '/tmp/x/sub/nested-1111111111111111-feedback.json',
      ])
    })
  })

  // defaultCleanIo の実 fs 統合テストは `./clean-io.ts` に分離済み。
}
