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

import { basename, dirname, resolve } from 'node:path'
import {
  computeDocHash,
  deriveReviewHtmlName,
  rewriteReviewHtml,
  stripMarkdownExt,
} from './embed-core'
import { readFile, writeFile } from 'node:fs/promises'

import { createReadStream } from 'node:fs'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const USAGE = 'Usage: review-request [--no-open] <input.md> [output-dir]'
const NO_OPEN_FLAG = '--no-open'
const SERVE_AUTOSTOP_MS = 10_000
const SERVE_GIVEUP_MS = 60_000
const SERVE_HOST = '127.0.0.1'
// 固定ポートを優先するのは、ブラウザ側の IndexedDB が origin (`http://localhost:<port>`)
// に紐づくため。ランダムポートだと毎回 origin が変わり workspace-handle のサイレント復元が
// 効かない (DESIGN.md §8)。Dynamic/Ephemeral 範囲の 5 桁高ポートを採用し、
// 既知サービスとの衝突を避ける。
const DEFAULT_PORT = 51_729
const PORT_ENV_VAR = 'MDXG_REDLINE_PORT'

// VS Code Remote Containers / Codespaces などで $BROWSER がホスト側ブラウザを
// 開く helper script を指している場合、URL は openExternal でホストに転送できるが、
// devcontainer 内の file パス・file:// URI はホスト OS から見えないため静かに無視される。
// この検知が true の場合のみ、軽量 HTTP サーバーを起動して http URL でホストに渡す。
export const isHostBrowserUnreachableViaFile = (env: {
  BROWSER?: string
  CODESPACES?: string
  REMOTE_CONTAINERS?: string
}): boolean => {
  if (env.REMOTE_CONTAINERS === 'true') {
    return true
  }
  if (env.CODESPACES === 'true') {
    return true
  }
  const browser = env.BROWSER ?? ''
  return browser.includes('vscode-server') && browser.includes('helpers/browser.sh')
}

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

// process.stderr.write は string | Uint8Array の両方を取り得るが、ここでは
// テストでの差し替え時にだけ呼ばれ、文字列としてのみ扱う。三項演算子は既存
// lint 規約で禁止なので関数化して narrowing を任せる。
const stderrChunkToString = (chunk: string | Uint8Array): string => {
  if (typeof chunk === 'string') {
    return chunk
  }
  return chunk.toString()
}

interface ParsedArgs {
  inputPath: string
  open: boolean
  outputDir: string | undefined
}

// 位置引数 (input.md, output-dir) と --no-open フラグの混在を許容する。
// 未知のフラグ・引数個数の異常は null を返す。
export const parseArgs = (argv: readonly string[]): ParsedArgs | null => {
  const flags = argv.filter((arg): boolean => arg.startsWith('--'))
  const positional = argv.filter((arg): boolean => !arg.startsWith('--'))
  if (flags.some((flag): boolean => flag !== NO_OPEN_FLAG)) {
    return null
  }
  if (positional.length < 1 || positional.length > 2) {
    return null
  }
  return {
    inputPath: positional[0],
    open: !flags.includes(NO_OPEN_FLAG),
    outputDir: positional[1],
  }
}

interface LaunchCommand {
  args: readonly string[]
  command: string
}

// OS ごとの「既定ブラウザでファイルを開く」コマンドを組み立てる。
// shell: true を使わずに済むよう、引数配列としてそのまま execFile に渡せる形で返す。
// Windows の start は cmd.exe のビルトインのため cmd.exe 経由で呼ぶ。
// `""` は start のウィンドウタイトル位置のプレースホルダ（無いとパスがタイトル扱いになる）。
// $BROWSER が設定されていれば、VS Code Remote Containers / Codespaces / その他 CI 環境の
// 流儀に合わせて最優先で使う。これにより devcontainer 内に xdg-open が無くても、
// VS Code が用意した helper script 経由でホスト側のブラウザに転送できる
// (gh CLI など他ツールと同じ慣習)。
export const buildOpenCommand = (
  platform: NodeJS.Platform,
  path: string,
  env: { BROWSER?: string } = process.env
): LaunchCommand => {
  if (env.BROWSER) {
    return { args: [path], command: env.BROWSER }
  }
  if (platform === 'darwin') {
    return { args: [path], command: 'open' }
  }
  if (platform === 'win32') {
    return { args: ['/c', 'start', '""', path], command: 'cmd.exe' }
  }
  return { args: [path], command: 'xdg-open' }
}

// 既定ブラウザを起動する。失敗 (xdg-open 未インストール、headless 環境等) しても
// exit code は維持し、stderr に警告だけ出す。HTML 生成自体は成功している前提。
const openInBrowser = async (path: string): Promise<void> =>
  new Promise<void>((done): void => {
    const { args, command } = buildOpenCommand(process.platform, path, process.env)
    execFile(command, args, (error): void => {
      if (error) {
        process.stderr.write(
          `review-request: ブラウザを起動できませんでした (${command}: ${error.message})。上記のパスを手動で開いてください。\n`
        )
      }
      done()
    })
  })

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
  const outputPath = resolve(targetDir, deriveReviewHtmlName(stripMarkdownExt(docName), docHash))
  return { docName, markdown, outputPath, reviewHtml }
}

interface ServeHandle {
  done: Promise<void>
  url: string
}

// 環境変数 MDXG_REDLINE_PORT (整数の有効ポート番号 1..65535) を優先し、
// 未指定 / 不正値なら DEFAULT_PORT を使う。Number.parseInt だと "8080abc" が
// 8080 として通ってしまうため、末尾ゴミも弾く Number() で全体を変換する。
export const resolvePreferredPort = (env: Record<string, string | undefined>): number => {
  const raw = env[PORT_ENV_VAR]
  if (!raw) {
    return DEFAULT_PORT
  }
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    process.stderr.write(
      `review-request: ${PORT_ENV_VAR}="${raw}" は有効なポート番号ではないため ${String(DEFAULT_PORT)} を使います。\n`
    )
    return DEFAULT_PORT
  }
  return parsed
}

// EADDRINUSE (使用中) のみフォールバックの判断材料にする。
// それ以外のエラー (権限不足等) は呼び出し側に伝播させる。
const isPortInUseError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'EADDRINUSE'

interface ListenResult {
  port: number
  server: ReturnType<typeof createServer>
}

// 単一サーバーインスタンスを指定ポートで listen 試行する。
// 失敗時は listen のコールバックではなく error イベントで通知されるため、
// once('error') と once('listening') を競争させて Promise を解決する。
// onListening / onError は相互参照になるため、解決後にもう片方を removeListener
// できるよう、関数参照を後付け代入できる listeners オブジェクトに包んで前方参照を回避する。
const tryListen = async (
  server: ReturnType<typeof createServer>,
  port: number
): Promise<ListenResult> =>
  new Promise<ListenResult>((resolveFn, rejectFn): void => {
    const listeners: {
      onError: (error: Error) => void
      onListening: () => void
    } = {
      onError: (): void => {
        /* assigned below */
      },
      onListening: (): void => {
        /* assigned below */
      },
    }
    listeners.onError = (error: Error): void => {
      server.removeListener('listening', listeners.onListening)
      rejectFn(error)
    }
    listeners.onListening = (): void => {
      server.removeListener('error', listeners.onError)
      const addr = server.address()
      if (addr === null || typeof addr === 'string') {
        rejectFn(new Error('HTTP サーバーのアドレス取得に失敗しました'))
        return
      }
      resolveFn({ port: addr.port, server })
    }
    server.once('error', listeners.onError)
    server.once('listening', listeners.onListening)
    server.listen(port, SERVE_HOST)
  })

// 希望ポートで listen を試み、EADDRINUSE 時のみランダムポート (0) に再試行する。
// Node の http.Server は listen 失敗時に内部 handle を close するため、
// 同じインスタンスで `.listen()` を呼び直せる（factory 関数を渡し直す必要はない）。
const listenWithFallback = async (
  server: ReturnType<typeof createServer>,
  preferred: number
): Promise<ListenResult> => {
  try {
    return await tryListen(server, preferred)
  } catch (error) {
    if (!isPortInUseError(error)) {
      throw error
    }
  }
  const result = await tryListen(server, 0)
  process.stderr.write(
    `review-request: ポート ${String(preferred)} が使用中のため ${String(result.port)} を使います。${PORT_ENV_VAR} でデフォルトを上書きできます。今回はブラウザ側 IndexedDB のサイレント復元 (Write feedback.json の保存先記憶) が効かない可能性があります。\n`
  )
  return result
}

// 軽量 HTTP サーバーを SERVE_HOST に立てて、固定の HTML 1 ファイルだけを配信する。
// リクエスト URL のパスは無視して常に同じファイルを返すため、パストラバーサルは
// 構造的に発生しない。devcontainer / Codespaces のように $BROWSER が file:// を扱えない
// 環境向けの fallback。
// ポート選定は (1) MDXG_REDLINE_PORT or DEFAULT_PORT を試す → (2) EADDRINUSE ならランダム
// (port=0) にフォールバックし、ブラウザ側 IndexedDB のサイレント復元が今回は効かない旨を
// stderr に警告する。
// 停止条件は二段構え：
//  - 初回リクエストを受けたら SERVE_AUTOSTOP_MS の猶予を取って close（リロードに 1 度耐える余裕）
//  - リクエストが来ないまま SERVE_GIVEUP_MS 経過したら諦めて close（$BROWSER 失敗時の保険）
// レスポンスには `Connection: close` を付けて keep-alive を無効化し、`server.close()` の
// コールバックが返らずにハングするのを防ぐ。
const serveOnceAndAutoStop = async (filePath: string): Promise<ServeHandle> => {
  const server = createServer((_req, res): void => {
    res.writeHead(200, {
      Connection: 'close',
      'Content-Type': 'text/html; charset=utf-8',
    })
    createReadStream(filePath).pipe(res)
  })
  const preferred = resolvePreferredPort(process.env)
  const listened = await listenWithFallback(server, preferred)
  const done = new Promise<void>((doneResolve): void => {
    const giveup = setTimeout((): void => {
      server.close((): void => doneResolve())
    }, SERVE_GIVEUP_MS)
    server.once('request', (): void => {
      clearTimeout(giveup)
      setTimeout((): void => {
        server.close((): void => doneResolve())
      }, SERVE_AUTOSTOP_MS)
    })
  })
  return {
    done,
    url: `http://localhost:${String(listened.port)}/${encodeURIComponent(basename(filePath))}`,
  }
}

// VS Code Remote 系で $BROWSER 経由の file:// 渡しが届かない環境を検知した場合のみ、
// 軽量 HTTP サーバー経由で http URL を $BROWSER に渡してホスト側ブラウザに到達させる。
// それ以外の環境（ローカル desktop / 通常の $BROWSER 設定）では file パスを直渡し。
const openOutput = async (outputPath: string): Promise<void> => {
  if (!isHostBrowserUnreachableViaFile(process.env)) {
    await openInBrowser(outputPath)
    return
  }
  const handle = await serveOnceAndAutoStop(outputPath)
  process.stderr.write(
    `review-request: VS Code Remote 環境を検知。HTTP サーバーを ${handle.url} で起動しました。初回アクセス後 ${SERVE_AUTOSTOP_MS / 1000} 秒、リクエストが無ければ ${SERVE_GIVEUP_MS / 1000} 秒で自動停止します。\n`
  )
  await openInBrowser(handle.url)
  await handle.done
}

const runEmbed = async (args: ParsedArgs): Promise<void> => {
  const ctx = await prepareEmbed(args.inputPath, args.outputDir)
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
  if (!args) {
    process.stderr.write(`${USAGE}\n`)
    process.exit(1)
  }
  await runEmbed(args)
}

// in-source test 実行時は main() が走らないようにする。
// vitest は import.meta.vitest を truthy に定義する。production bundle では
// vite config の define で undefined にされ、main() が通常通り起動する。
if (!import.meta.vitest) {
  main().catch((error: unknown): void => {
    process.stderr.write(`review-request: ${errorMessage(error)}\n`)
    process.exit(1)
  })
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('parseArgs', () => {
    // toEqual は `{outputDir: undefined}` を欠落プロパティと同一視するため、
    // outputDir 未指定ケースでは expected オブジェクトから outputDir を省略している
    // （no-undefined lint 回避）。指定ケースでは値で比較する。
    it('input.md 単独で open=true / outputDir 未指定を返す', () => {
      expect(parseArgs(['spec.md'])).toEqual({ inputPath: 'spec.md', open: true })
    })

    it('input.md と output-dir で open=true / outputDir 指定を返す', () => {
      expect(parseArgs(['spec.md', '/tmp/out'])).toEqual({
        inputPath: 'spec.md',
        open: true,
        outputDir: '/tmp/out',
      })
    })

    it('--no-open フラグで open=false になる', () => {
      expect(parseArgs(['--no-open', 'spec.md'])).toEqual({
        inputPath: 'spec.md',
        open: false,
      })
    })

    it('--no-open が引数の後ろに来ても認識する', () => {
      expect(parseArgs(['spec.md', '--no-open'])).toEqual({
        inputPath: 'spec.md',
        open: false,
      })
    })

    it('--no-open が位置引数の間に来ても認識する', () => {
      expect(parseArgs(['spec.md', '--no-open', '/tmp/out'])).toEqual({
        inputPath: 'spec.md',
        open: false,
        outputDir: '/tmp/out',
      })
    })

    it('引数が空の場合は null', () => {
      expect(parseArgs([])).toBeNull()
    })

    it('--no-open だけで位置引数がない場合は null', () => {
      expect(parseArgs(['--no-open'])).toBeNull()
    })

    it('位置引数が 3 個以上は null', () => {
      expect(parseArgs(['a.md', 'b', 'c'])).toBeNull()
    })

    it('未知のフラグは null', () => {
      expect(parseArgs(['--unknown', 'spec.md'])).toBeNull()
    })
  })

  // テスト実行環境 (vitest under devcontainer) 自身が $BROWSER を持つため、
  // プラットフォーム別のフォールバックを検証する側のケースでは明示的に空 env を渡す。
  describe('buildOpenCommand', () => {
    const noBrowserEnv = {} as const

    it('macOS では open を使う', () => {
      expect(buildOpenCommand('darwin', '/tmp/x.html', noBrowserEnv)).toEqual({
        args: ['/tmp/x.html'],
        command: 'open',
      })
    })

    it('Linux では xdg-open を使う', () => {
      expect(buildOpenCommand('linux', '/tmp/x.html', noBrowserEnv)).toEqual({
        args: ['/tmp/x.html'],
        command: 'xdg-open',
      })
    })

    it('Windows では cmd.exe /c start "" <path> を使う', () => {
      expect(buildOpenCommand('win32', String.raw`C:\tmp\x.html`, noBrowserEnv)).toEqual({
        args: ['/c', 'start', '""', String.raw`C:\tmp\x.html`],
        command: 'cmd.exe',
      })
    })

    it('その他の POSIX プラットフォーム (freebsd 等) は xdg-open にフォールバック', () => {
      expect(buildOpenCommand('freebsd', '/tmp/x.html', noBrowserEnv)).toEqual({
        args: ['/tmp/x.html'],
        command: 'xdg-open',
      })
    })

    it('パスに空白・特殊文字が含まれていてもエスケープせずそのまま配列に入れる', () => {
      // shell: true を使わないので execFile 側がそのまま argv として渡してくれる前提。
      expect(buildOpenCommand('darwin', '/tmp/with space & sym.html', noBrowserEnv)).toEqual({
        args: ['/tmp/with space & sym.html'],
        command: 'open',
      })
    })

    it('$BROWSER が設定されている場合は全プラットフォームでそれを最優先する', () => {
      const env = { BROWSER: '/vscode/helpers/browser.sh' } as const
      expect(buildOpenCommand('linux', '/tmp/x.html', env)).toEqual({
        args: ['/tmp/x.html'],
        command: '/vscode/helpers/browser.sh',
      })
      expect(buildOpenCommand('darwin', '/tmp/x.html', env)).toEqual({
        args: ['/tmp/x.html'],
        command: '/vscode/helpers/browser.sh',
      })
      expect(buildOpenCommand('win32', '/tmp/x.html', env)).toEqual({
        args: ['/tmp/x.html'],
        command: '/vscode/helpers/browser.sh',
      })
    })

    it('$BROWSER が空文字列の場合はプラットフォーム既定にフォールバックする', () => {
      const env = { BROWSER: '' } as const
      expect(buildOpenCommand('linux', '/tmp/x.html', env)).toEqual({
        args: ['/tmp/x.html'],
        command: 'xdg-open',
      })
    })
  })

  describe('isHostBrowserUnreachableViaFile', () => {
    it('REMOTE_CONTAINERS=true なら true', () => {
      expect(isHostBrowserUnreachableViaFile({ REMOTE_CONTAINERS: 'true' })).toBe(true)
    })

    it('CODESPACES=true なら true', () => {
      expect(isHostBrowserUnreachableViaFile({ CODESPACES: 'true' })).toBe(true)
    })

    it('BROWSER が VS Code server helper script を指していたら true', () => {
      expect(
        isHostBrowserUnreachableViaFile({
          BROWSER: '/vscode/vscode-server/bin/linux-arm64/abcdef/bin/helpers/browser.sh',
        })
      ).toBe(true)
    })

    it('空 env / 未設定なら false', () => {
      expect(isHostBrowserUnreachableViaFile({})).toBe(false)
    })

    it('REMOTE_CONTAINERS が文字列の "false" などなら false', () => {
      expect(isHostBrowserUnreachableViaFile({ REMOTE_CONTAINERS: 'false' })).toBe(false)
    })

    it('BROWSER がローカル desktop の通常ブラウザを指していたら false', () => {
      expect(isHostBrowserUnreachableViaFile({ BROWSER: '/usr/bin/firefox' })).toBe(false)
      expect(isHostBrowserUnreachableViaFile({ BROWSER: 'google-chrome' })).toBe(false)
    })

    it('BROWSER に vscode-server を含むだけで helpers/browser.sh を含まなければ false', () => {
      // 誤検知防止: vscode-server を含む別のスクリプトに偶然マッチさせない。
      expect(
        isHostBrowserUnreachableViaFile({
          BROWSER: '/some/path/vscode-server/somethingelse.sh',
        })
      ).toBe(false)
    })
  })

  describe('resolvePreferredPort', () => {
    // process.stderr.write を関数差し替えで黙らせ、警告経路のテストで標準エラー出力に
    // ノイズを出さないようにする。捕捉した書き込みは文字列配列で返す。
    const silenceStderr = (fn: () => number): string[] => {
      const written: string[] = []
      const original = process.stderr.write.bind(process.stderr)
      process.stderr.write = ((chunk: string | Uint8Array): boolean => {
        written.push(stderrChunkToString(chunk))
        return true
      }) as typeof process.stderr.write
      try {
        fn()
      } finally {
        process.stderr.write = original
      }
      return written
    }

    it('環境変数が未設定なら DEFAULT_PORT (51729) を返す', () => {
      expect(resolvePreferredPort({})).toBe(51_729)
    })

    it('環境変数が空文字なら DEFAULT_PORT を返す', () => {
      expect(resolvePreferredPort({ MDXG_REDLINE_PORT: '' })).toBe(51_729)
    })

    it('有効なポート番号の文字列を整数として返す', () => {
      expect(resolvePreferredPort({ MDXG_REDLINE_PORT: '8080' })).toBe(8080)
    })

    it('範囲外 (0 以下 / 65535 超) は DEFAULT_PORT へ fallback して stderr 警告', () => {
      let value = 0
      const written = silenceStderr((): number => {
        value = resolvePreferredPort({ MDXG_REDLINE_PORT: '0' })
        return value
      })
      expect(value).toBe(51_729)
      expect(written.join('')).toContain('有効なポート番号ではない')
    })

    it('非整数の文字列も DEFAULT_PORT へ fallback', () => {
      let value = 0
      silenceStderr((): number => {
        value = resolvePreferredPort({ MDXG_REDLINE_PORT: 'abc' })
        return value
      })
      expect(value).toBe(51_729)
    })

    // Number.parseInt("8080abc", 10) は 8080 を返してしまうため、Number() で
    // 文字列全体を変換する実装になっている。リグレッション防止のためのテスト。
    it('末尾にゴミがある "8080abc" 形式は DEFAULT_PORT へ fallback', () => {
      let value = 0
      silenceStderr((): number => {
        value = resolvePreferredPort({ MDXG_REDLINE_PORT: '8080abc' })
        return value
      })
      expect(value).toBe(51_729)
    })
  })
}
