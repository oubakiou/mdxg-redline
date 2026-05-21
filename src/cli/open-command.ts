// OS / 環境変数に応じて「既定ブラウザでファイルを開く」コマンドを組み立て、起動する。
// VS Code Remote Containers / Codespaces のように $BROWSER がホスト側ヘルパー経由で
// ホストブラウザを開くが file パスはホストから見えない、という環境を検知する判定もここに置く。

import { execFile } from 'node:child_process'
import process from 'node:process'

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
// $BROWSER の値は単一実行可能パスとして扱い、execFile に引数配列 [path] を渡す。
// `open -a "Google Chrome"` のような複合文字列は意図的にサポートしない:
// sh -c 経由で実行すると引数注入経路 (利用者環境変数 → シェル解釈) を作ってしまうため。
// 複数引数が必要な場合は wrapper script を作って $BROWSER にそのパスを設定する運用とする
// (gh CLI なども同じ前提)。
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
export const openInBrowser = async (path: string): Promise<void> =>
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

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

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
}
