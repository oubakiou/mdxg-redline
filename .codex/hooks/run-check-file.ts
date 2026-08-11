#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

interface HookPayload {
  cwd?: unknown
  tool_input?: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const messageFromError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

const emitAdditionalContext = (message: string): void => {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        additionalContext: `check-file failed:\n${message}`,
        hookEventName: 'PostToolUse',
      },
    })
  )
}

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

const getCwd = (payload: HookPayload): string => {
  if (typeof payload.cwd === 'string' && payload.cwd.length > 0) {
    return payload.cwd
  }

  return process.cwd()
}

const addPatchFile = (files: Set<string>, line: string, prefix: string): void => {
  if (!line.startsWith(prefix)) {
    return
  }

  const file = line.slice(prefix.length).trim()

  if (file.length > 0) {
    files.add(file)
  }
}

export const extractPatchFiles = (command: string): string[] => {
  const files = new Set<string>()

  for (const line of command.split(/\r?\n/)) {
    addPatchFile(files, line, '*** Add File: ')
    addPatchFile(files, line, '*** Update File: ')
    addPatchFile(files, line, '*** Move to: ')
  }

  return [...files]
}

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

const runCheck = (cwd: string, file: string): string | null => {
  const script = path.resolve(cwd, '.agents/scripts/check-file.sh')
  const result = spawnSync('bash', [script, file], { cwd, encoding: 'utf8' })

  if (result.status === 0) {
    return null
  }

  if (result.error) {
    return result.error.message
  }

  return [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
}

const main = (): void => {
  const payload = readPayload()
  const cwd = getCwd(payload)
  // 削除済みファイルなど、ファイル単位チェックに渡せない対象を除外する
  const files = getFiles(payload).filter((file) => existsSync(path.resolve(cwd, file)))
  const failures = files.flatMap((file) => {
    const failure = runCheck(cwd, file)

    if (failure === null) {
      return []
    }

    return [`${file}\n${failure}`]
  })

  if (failures.length > 0) {
    emitAdditionalContext(failures.join('\n\n'))
  }
}

/**
 * MARK: In-Source Testing
 * @example vp test .codex/hooks/run-check-file.ts
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
} else {
  // フック自体の例外も Codex へ返し、編集処理そのものは中断しない。
  try {
    main()
  } catch (error: unknown) {
    emitAdditionalContext(`hook failed: ${messageFromError(error)}`)
  }
}
