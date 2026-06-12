#!/usr/bin/env node
// review-request CLI: レビュー依頼用 HTML を生成して標準ブラウザで開くツール。
// embed-core の純粋な埋め込みロジックに、Node 側の I/O (引数パース / ファイル読み書き /
// ブラウザ起動) だけを付ける薄い CLI。ビルド後は dist/review-request.mjs として配布される。
// dist/embed-template.html を同ディレクトリから読み込む。
// 出力ファイル名は docs/design/DESIGN.md §8 のファイル命名規約に従い、入力 MD の basename と
// 本文 SHA-256 から自動決定する。利用者は output ファイル名ではなくディレクトリだけ指定できる。
// 既定では生成した HTML を OS の標準ブラウザで開く。`--no-open` で抑止できる。
// VS Code Remote Containers / Codespaces のように $BROWSER が file:// を扱えない環境を
// 検知した場合のみ、軽量 HTTP サーバーを 127.0.0.1 に立てて http URL で配信する。
// 本ファイルはエントリ専用に薄く保ち、引数パース / 入力解決 / ブラウザ起動 / HTTP サーバー /
// asset 注入 / HTML compose は cli/{parse-args,input-source,open-command,serve,assets/*,compose-review-html}.ts に分割している。
//
// 起動順序:
//   1. extractLang(rawArgv, env) で --lang を先行抽出して setCliLang
//   2. argv に -h / --help が残っていれば help 最優先で getHelpText() を stdout に書き出す
//   3. extractLang のエラー (invalid_value / missing_value) があれば translateCli で reject
//   4. 通常モード判定 (parseArgs → run / clean / invalid)
//
// --lang はサブパーサ非依存のグローバル メタフラグとして扱い、arg-spec / parse-clean-args の
// FLAG_TABLE には追加しない。ここで argv から strip してから parseArgs に渡すことで、
// run / clean のサブパーサは --lang の存在を知らずに済む。

import { type RunArgs, getHelpText, parseArgs } from './parse-args'
import { HELP_FLAGS } from './arg-spec'
import { composeReviewHtml, prepareEmbed } from './compose-review-html'
import { defaultCleanIo, runClean } from './clean'
import { errorMessage } from './error-message'
import { extractLang } from './preextract-lang'
import { openOutput } from './serve'
import process from 'node:process'
import { setCliLang, translateCli } from './i18n'
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
    return `${translateCli('cli.error.invalid_arguments', { detail })}\n`
  }
  return `${translateCli('cli.error.invalid_arguments_no_detail')}\n`
}

const handleNonRunModes = (args: ReturnType<typeof parseArgs>): boolean => {
  if (args.mode === 'help') {
    process.stdout.write(getHelpText())
    return true
  }
  if (args.mode === 'invalid') {
    process.stderr.write(formatInvalidArgsMessage(args.error))
    process.exit(1)
  }
  return false
}

const formatLangErrorMessage = (
  error: Exclude<ReturnType<typeof extractLang>['error'], null>
): string => {
  if (error.kind === 'invalid_value') {
    return translateCli('cli.error.invalid_lang')
  }
  return translateCli('cli.error.missing_flag_value', {
    expected: 'auto, en, ja',
    flag: '--lang',
  })
}

// bootstrap phase: --lang を抽出 + setCliLang + help 最優先 + langError reject。
// 戻り値が null なら通常解析に進むべき argv、null 以外なら main は何もせず return する契約。
const bootstrapCliLang = (rawArgv: readonly string[]): string[] | null => {
  const { argv, error: langError, lang } = extractLang(rawArgv, process.env)
  setCliLang(lang)
  // (1) help 最優先: --lang fr --help / --lang --help でも help を表示する (parseArgs の既存契約と整合)。
  if (argv.some((token): boolean => HELP_FLAGS.has(token))) {
    process.stdout.write(getHelpText())
    return null
  }
  // (2) --lang 起因のエラーは help が無い場合のみ reject。
  if (langError !== null) {
    process.stderr.write(`mdxg-redline: ${formatLangErrorMessage(langError)}\n`)
    process.exit(2)
  }
  return argv
}

const dispatchParsedMode = async (args: ReturnType<typeof parseArgs>): Promise<void> => {
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

const main = async (): Promise<void> => {
  const argv = bootstrapCliLang(process.argv.slice(2))
  if (argv === null) {
    return
  }
  // (3) 通常モード判定。argv は strip 済みなのでサブパーサに `--lang` が漏れない。
  await dispatchParsedMode(parseArgs(argv))
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
    process.stderr.write(
      `${translateCli('cli.error.unexpected', { message: errorMessage(error) })}\n`
    )
    process.exit(1)
  })
}

if (import.meta.vitest) {
  const { afterEach, beforeEach, describe, expect, it, vi } = import.meta.vitest

  beforeEach(() => {
    setCliLang('en')
  })
  afterEach(() => {
    setCliLang('en')
  })

  describe('handleNonRunModes', () => {
    it('mode=help は help テキストを stdout に書いて true を返す', () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
      try {
        const handled = handleNonRunModes({ mode: 'help' })
        expect(handled).toBe(true)
        expect(stdoutSpy).toHaveBeenCalledWith(getHelpText())
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

    it('ja 言語で mode=invalid は日本語の枠 + detail を stderr に出す', () => {
      setCliLang('ja')
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((): never => {
        throw new Error('process.exit called')
      })
      try {
        expect((): void => {
          handleNonRunModes({ error: 'unknown option: --bogus', mode: 'invalid' })
        }).toThrow('process.exit called')
        const written = stderrSpy.mock.calls.map((call) => String(call[0])).join('')
        expect(written).toContain('引数が不正です')
        expect(written).toContain('unknown option: --bogus')
      } finally {
        stderrSpy.mockRestore()
        exitSpy.mockRestore()
      }
    })
  })

  describe('formatLangErrorMessage', () => {
    it('invalid_value は cli.error.invalid_lang を返す', () => {
      expect(formatLangErrorMessage({ kind: 'invalid_value', token: 'fr' })).toBe(
        '--lang must be one of: auto, en, ja'
      )
    })

    it('missing_value は --lang の missing_flag_value を返す', () => {
      expect(formatLangErrorMessage({ kind: 'missing_value' })).toBe(
        '--lang: missing value (expected auto, en, ja)'
      )
    })

    it('ja 言語に切り替えると日本語メッセージを返す', () => {
      setCliLang('ja')
      expect(formatLangErrorMessage({ kind: 'invalid_value', token: 'fr' })).toContain(
        '--lang は auto / en / ja'
      )
    })
  })
}
