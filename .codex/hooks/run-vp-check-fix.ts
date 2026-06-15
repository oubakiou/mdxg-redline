#!/usr/bin/env node

/**
 * Codex の PostToolUse フックで編集対象ファイルに `vp check --fix` を実行する。
 * 失敗時は処理を止めず、追加コンテキストとして Codex にフィードバックする。
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

/** Codex / Claude 互換 hook payload のうち、このフックが参照する最小フィールド */
interface HookPayload {
  cwd?: unknown
  tool_input?: unknown
}

/** 値が配列ではないオブジェクトかどうか判定する型ガード */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** throw された値を hook 出力用の文字列に変換する */
const messageFromError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

/** `vp check --fix` の失敗内容を PostToolUse の additionalContext として返す */
const emitAdditionalContext = (message: string): void => {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        additionalContext: `vp check --fix failed:\n${message}`,
        hookEventName: 'PostToolUse',
      },
    })
  )
}

/** stdin から hook payload JSON を読み取る。空入力や非オブジェクト入力は空 payload として扱う */
const readPayload = (): HookPayload => {
  const raw = readFileSync(0, 'utf8').trim()

  if (!raw) {
    return {}
  }

  const parsed: unknown = JSON.parse(raw)

  if (isRecord(parsed)) {
    return parsed
  }

  return {}
}

/** payload.cwd が有効な文字列なら使用し、それ以外は現在の cwd にフォールバックする */
const getCwd = (payload: HookPayload): string => {
  if (typeof payload.cwd === 'string' && payload.cwd.length > 0) {
    return payload.cwd
  }

  return process.cwd()
}

/** patch のヘッダー行からファイルパスを取り出して集合に追加する */
const addPatchFile = (files: Set<string>, line: string, prefix: string): void => {
  if (!line.startsWith(prefix)) {
    return
  }

  const file = line.slice(prefix.length).trim()

  if (file.length > 0) {
    files.add(file)
  }
}

/** apply_patch 入力から追加・更新・移動先のファイルを抽出する */
export const extractPatchFiles = (command: string): string[] => {
  const files = new Set<string>()

  for (const line of command.split(/\r?\n/)) {
    addPatchFile(files, line, '*** Add File: ')
    addPatchFile(files, line, '*** Update File: ')
    addPatchFile(files, line, '*** Move to: ')
  }

  return [...files]
}

/** Claude 形式の file_path または Codex apply_patch 形式の command から対象ファイルを得る */
export const getFiles = (payload: HookPayload): string[] => {
  if (!isRecord(payload.tool_input)) {
    return []
  }

  if (typeof payload.tool_input.file_path === 'string') {
    return [payload.tool_input.file_path]
  }

  if (typeof payload.tool_input.command === 'string') {
    return extractPatchFiles(payload.tool_input.command)
  }

  return []
}

/** 削除済みファイルなど、ファイル単位チェックに渡せない対象を除外する */
export const existingFiles = (cwd: string, files: string[]): string[] => {
  const existing: string[] = []

  for (const file of files) {
    if (existsSync(path.resolve(cwd, file))) {
      existing.push(file)
    }
  }

  return existing
}

/** ファイル単位チェック失敗時に Codex へ返すメッセージを組み立てる */
export const formatFailure = (file: string, output: string): string => {
  const lines = [`vp check --fix failed for ${file}.`]

  if (output.length > 0) {
    lines.push(output)
  }

  return lines.join('\n')
}

/** 指定ファイルに `vp check --fix` を実行し、失敗時のみ説明文を返す */
const runCheck = (cwd: string, file: string): string | null => {
  const result = spawnSync('vp', ['check', '--fix', file], { cwd, encoding: 'utf8' })

  if (result.error) {
    return `vp check --fix could not be started for ${file}: ${result.error.message}`
  }

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    return formatFailure(file, output)
  }

  return null
}

/** 複数ファイルのチェック結果を集約し、失敗メッセージだけを返す */
const collectFailures = (cwd: string, files: string[]): string[] => {
  const failures: string[] = []

  for (const file of files) {
    const failure = runCheck(cwd, file)

    if (failure) {
      failures.push(failure)
    }
  }

  return failures
}

/** hook payload から対象ファイルを決定し、失敗があれば additionalContext として返す */
const main = (): void => {
  const payload = readPayload()
  const cwd = getCwd(payload)
  const files = existingFiles(cwd, getFiles(payload))

  if (files.length === 0) {
    return
  }

  const failures = collectFailures(cwd, files)

  if (failures.length > 0) {
    emitAdditionalContext(failures.join('\n\n'))
  }
}

/**
 * MARK: In-Source Testing
 * @example vp test .codex/hooks/run-vp-check-fix.ts
 */

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('extractPatchFiles', () => {
    it('apply_patch の追加・更新・移動先ファイルを抽出する', () => {
      const command = [
        '*** Begin Patch',
        '*** Add File: src/new.ts',
        '*** Update File: src/current.ts',
        '*** Move to: src/moved.ts',
        '*** Delete File: src/deleted.ts',
        '*** End Patch',
      ].join('\n')

      expect(extractPatchFiles(command)).toStrictEqual([
        'src/new.ts',
        'src/current.ts',
        'src/moved.ts',
      ])
    })

    it('同じファイルが複数回出ても一度だけ返す', () => {
      const command = [
        '*** Begin Patch',
        '*** Update File: src/current.ts',
        '*** Update File: src/current.ts',
        '*** End Patch',
      ].join('\n')

      expect(extractPatchFiles(command)).toStrictEqual(['src/current.ts'])
    })
  })

  describe('getFiles', () => {
    it('Claude 形式の file_path を優先して返す', () => {
      const payload = {
        tool_input: {
          command: '*** Update File: src/ignored.ts',
          file_path: 'src/from-file-path.ts',
        },
      }

      expect(getFiles(payload)).toStrictEqual(['src/from-file-path.ts'])
    })

    it('Codex apply_patch 形式の command から対象ファイルを返す', () => {
      const payload = {
        tool_input: {
          command: ['*** Begin Patch', '*** Update File: src/current.ts', '*** End Patch'].join(
            '\n'
          ),
        },
      }

      expect(getFiles(payload)).toStrictEqual(['src/current.ts'])
    })

    it('tool_input がオブジェクトでない場合は空配列を返す', () => {
      expect(getFiles({ tool_input: 'invalid' })).toStrictEqual([])
    })
  })

  describe('existingFiles', () => {
    it('存在するファイルだけを残す', () => {
      expect(existingFiles(process.cwd(), ['package.json', '.temp/missing-file.ts'])).toStrictEqual(
        ['package.json']
      )
    })
  })

  describe('formatFailure', () => {
    it('vp の出力がある場合は失敗メッセージに含める', () => {
      expect(formatFailure('src/current.ts', 'lint error')).toBe(
        'vp check --fix failed for src/current.ts.\nlint error'
      )
    })

    it('vp の出力が空の場合はファイル名だけを含める', () => {
      expect(formatFailure('src/current.ts', '')).toBe('vp check --fix failed for src/current.ts.')
    })
  })
} else {
  // フック自体の例外も Codex へ返し、編集処理そのものは中断しない。
  try {
    main()
  } catch (error: unknown) {
    emitAdditionalContext(`hook failed: ${messageFromError(error)}`)
  }
}
