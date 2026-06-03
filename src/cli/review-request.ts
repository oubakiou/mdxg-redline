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
// 本ファイルはエントリ専用に薄く保ち、引数パース / 入力解決 / ブラウザ起動 / HTTP サーバー /
// asset 注入 / HTML compose は cli/{parse-args,input-source,open-command,serve,assets/*,compose-review-html}.ts に分割している。

import { HELP_TEXT, type RunArgs, parseArgs } from './parse-args'
import { composeReviewHtml, prepareEmbed } from './compose-review-html'
import { defaultCleanIo, runClean } from './clean'
import { errorMessage } from './error-message'
import { openOutput } from './serve'
import process from 'node:process'
import { writeFile } from 'node:fs/promises'

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

const formatInvalidArgsMessage = (detail: string | undefined): string => {
  if (typeof detail === 'string' && detail.length > 0) {
    return `mdxg-redline: invalid arguments: ${detail}. Run \`mdxg-redline --help\` for usage.\n`
  }
  return `mdxg-redline: invalid arguments. Run \`mdxg-redline --help\` for usage.\n`
}

const handleNonRunModes = (args: ReturnType<typeof parseArgs>): boolean => {
  if (args.mode === 'help') {
    process.stdout.write(HELP_TEXT)
    return true
  }
  if (args.mode === 'invalid') {
    process.stderr.write(formatInvalidArgsMessage(args.error))
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
    const code = await runClean(
      { dir: args.dir, keep: args.keep, recursive: args.recursive, yes: args.yes },
      defaultCleanIo
    )
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
  const { describe, expect, it, vi } = import.meta.vitest

  describe('handleNonRunModes', () => {
    it('mode=help は HELP_TEXT を stdout に書いて true を返す', () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
      try {
        const handled = handleNonRunModes({ mode: 'help' })
        expect(handled).toBe(true)
        expect(stdoutSpy).toHaveBeenCalledWith(HELP_TEXT)
      } finally {
        stdoutSpy.mockRestore()
      }
    })

    // RunArgs の必須フィールドは inputPath / open / mode の 3 つ。optional は省略 (parseArgs の
    // 出力スキーマと同じ minimal な形)。`as ReturnType<typeof parseArgs>` cast を避けることで、
    // 将来 RunArgs / CleanArgsParsed に必須フィールドが追加されたとき型エラーで気付ける。
    it('mode=run は何もせず false を返す', () => {
      const handled = handleNonRunModes({
        inputPath: 'x.md',
        mode: 'run',
        open: false,
      })
      expect(handled).toBe(false)
    })

    it('mode=clean は何もせず false を返す', () => {
      const handled = handleNonRunModes({
        dir: './reviews',
        keep: new Set<string>(),
        mode: 'clean',
        recursive: false,
        yes: false,
      })
      expect(handled).toBe(false)
    })

    // mode=invalid は process.stderr に書いて process.exit(1) を呼ぶ。
    // vitest のプロセスが落ちないよう exit / stderr を mock し、副作用を観測する。
    it('mode=invalid は stderr に書いて process.exit(1) を呼ぶ', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((): never => {
        throw new Error('process.exit called')
      })
      try {
        expect((): void => {
          handleNonRunModes({ mode: 'invalid' })
        }).toThrow('process.exit called')
        expect(exitSpy).toHaveBeenCalledWith(1)
        expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('invalid arguments'))
      } finally {
        stderrSpy.mockRestore()
        exitSpy.mockRestore()
      }
    })

    it('mode=invalid に error がある時は detail を stderr に含めて出す', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((): never => {
        throw new Error('process.exit called')
      })
      try {
        expect((): void => {
          handleNonRunModes({
            error: "--comments-width: invalid value '200' (expected 0 (closed) or 280-640)",
            mode: 'invalid',
          })
        }).toThrow('process.exit called')
        expect(stderrSpy).toHaveBeenCalledWith(
          "mdxg-redline: invalid arguments: --comments-width: invalid value '200' (expected 0 (closed) or 280-640). Run `mdxg-redline --help` for usage.\n"
        )
      } finally {
        stderrSpy.mockRestore()
        exitSpy.mockRestore()
      }
    })
  })
}
