// $BROWSER が file:// を扱えない環境 (VS Code Remote Containers / Codespaces) 向けの
// 軽量 HTTP サーバー。生成済み HTML 1 ファイルだけを 127.0.0.1 に配信し、初回アクセス後
// 自動停止する。ポートは MDXG_REDLINE_PORT or DEFAULT_PORT を優先し、衝突時のみ
// ランダムポートにフォールバックする。

import { isHostBrowserUnreachableViaFile, openInBrowser } from './open-command'

import { basename } from 'node:path'
import { createReadStream } from 'node:fs'
import { createServer } from 'node:http'
import process from 'node:process'

const SERVE_AUTOSTOP_MS = 10_000
const SERVE_GIVEUP_MS = 60_000
const SERVE_HOST = '127.0.0.1'
// 固定ポートを優先するのは、ブラウザ側の IndexedDB が origin (`http://localhost:<port>`)
// に紐づくため。ランダムポートだと毎回 origin が変わり workspace-handle のサイレント復元が
// 効かない (DESIGN.md §8)。Dynamic/Ephemeral 範囲の 5 桁高ポートを採用し、
// 既知サービスとの衝突を避ける。
const DEFAULT_PORT = 51_729
const PORT_ENV_VAR = 'MDXG_REDLINE_PORT'

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
export const openOutput = async (outputPath: string): Promise<void> => {
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

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('resolvePreferredPort', () => {
    // process.stderr.write を関数差し替えで黙らせ、警告経路のテストで標準エラー出力に
    // ノイズを出さないようにする。捕捉した書き込みは文字列配列で返す。
    // chunk → string 変換は if/else で展開している（no-ternary 回避 + 別 helper を
    // 切り出すと unicorn/consistent-function-scoping が「captures nothing」と警告するため）。
    const silenceStderr = (fn: () => number): string[] => {
      const written: string[] = []
      const original = process.stderr.write.bind(process.stderr)
      process.stderr.write = ((chunk: string | Uint8Array): boolean => {
        if (typeof chunk === 'string') {
          written.push(chunk)
        } else {
          written.push(chunk.toString())
        }
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
