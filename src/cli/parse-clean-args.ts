// `--clean` サブコマンドの引数パース。run モードとは独立した state machine で、
// 位置引数 (削除対象 dir) と --yes / --keep / --recursive / -r を受け付ける。
// flag 定数 / 結果型は arg-spec.ts に集約。dispatch (どのモードか) は parse-args.ts。

import {
  CLEAN_FLAG,
  HEX_16_PATTERN,
  KEEP_FLAG,
  KEEP_VALUE_HELP,
  type ParsedArgs,
  RECURSIVE_FLAG,
  RECURSIVE_SHORT_FLAG,
  YES_FLAG,
} from './arg-spec'
import {
  formatInvalidValueMessage,
  formatMissingValueMessage,
  formatUnknownFlagMessage,
} from './flag-parser'
import { translateCli } from './i18n'

interface CleanPartitionState {
  cleanSeen: boolean
  dir: string | null
  error: string | null
  keep: Set<string>
  pendingDir: boolean
  pendingKeep: boolean
  recursive: boolean
  valid: boolean
  yes: boolean
}

const INITIAL_CLEAN_STATE: CleanPartitionState = {
  cleanSeen: false,
  dir: null,
  error: null,
  keep: new Set(),
  pendingDir: false,
  pendingKeep: false,
  recursive: false,
  valid: true,
  yes: false,
}

const consumeCleanDirValue = (acc: CleanPartitionState, token: string): CleanPartitionState =>
  // token が `--` 始まりのケースは stepCleanArg 側で「dir 省略」として先に分岐するため、
  // ここに来る token は常に位置引数 (= ディレクトリ値) となる。
  ({ ...acc, dir: token, pendingDir: false })

const consumeCleanKeepValue = (acc: CleanPartitionState, token: string): CleanPartitionState => {
  if (!HEX_16_PATTERN.test(token)) {
    return {
      ...acc,
      error: formatInvalidValueMessage(KEEP_FLAG, token, KEEP_VALUE_HELP),
      valid: false,
    }
  }
  const next = new Set(acc.keep)
  next.add(token.toLowerCase())
  return { ...acc, keep: next, pendingKeep: false }
}

// --clean は 1 回のみ許容する (複数指定で後勝ちになると意図が曖昧になり、誤って別ディレクトリを
// 削除しかける事故が起きやすいため、構造的に弾く)。--yes は冪等なので重複でも valid のまま。
// --keep は仕様上繰り返し指定で hash を蓄積するため、ここでは重複チェックしない。
const markCleanFlag = (acc: CleanPartitionState): CleanPartitionState => {
  if (acc.cleanSeen) {
    return {
      ...acc,
      error: translateCli('cli.error.clean_specified_multiple', { flag: CLEAN_FLAG }),
      valid: false,
    }
  }
  return { ...acc, cleanSeen: true, pendingDir: true }
}

const CLEAN_FLAG_TABLE: readonly {
  flag: string
  mark: (acc: CleanPartitionState) => CleanPartitionState
}[] = [
  { flag: CLEAN_FLAG, mark: markCleanFlag },
  { flag: KEEP_FLAG, mark: (acc): CleanPartitionState => ({ ...acc, pendingKeep: true }) },
  { flag: YES_FLAG, mark: (acc): CleanPartitionState => ({ ...acc, yes: true }) },
  { flag: RECURSIVE_FLAG, mark: (acc): CleanPartitionState => ({ ...acc, recursive: true }) },
  { flag: RECURSIVE_SHORT_FLAG, mark: (acc): CleanPartitionState => ({ ...acc, recursive: true }) },
]

const isCleanFlagToken = (token: string): boolean =>
  CLEAN_FLAG_TABLE.some((row): boolean => row.flag === token)

const consumeCleanFlag = (acc: CleanPartitionState, token: string): CleanPartitionState => {
  const entry = CLEAN_FLAG_TABLE.find((row): boolean => row.flag === token)
  if (!entry) {
    return { ...acc, error: formatUnknownFlagMessage(token), valid: false }
  }
  return entry.mark(acc)
}

const stepCleanArg = (acc: CleanPartitionState, token: string): CleanPartitionState => {
  if (!acc.valid) {
    return acc
  }
  if (acc.pendingDir) {
    // dir 値の位置に別フラグ (--yes / --keep / --recursive / -r) が来た場合は dir 省略と解釈し、
    // pendingDir を降ろしてその token をフラグとして処理し直す (dir は finalize で `.` に既定化)。
    // `--` 始まりも一律フラグ扱い (未知フラグは consumeCleanFlag で invalid になる)。
    if (token.startsWith('--') || isCleanFlagToken(token)) {
      return stepCleanArg({ ...acc, pendingDir: false }, token)
    }
    return consumeCleanDirValue(acc, token)
  }
  if (acc.pendingKeep) {
    return consumeCleanKeepValue(acc, token)
  }
  return consumeCleanFlag(acc, token)
}

const cleanInvalid = (error: string | null): ParsedArgs => {
  if (error === null) {
    return { mode: 'invalid' }
  }
  return { error, mode: 'invalid' }
}

export const parseCleanArgs = (argv: readonly string[]): ParsedArgs => {
  const state = argv.reduce<CleanPartitionState>(stepCleanArg, INITIAL_CLEAN_STATE)
  if (!state.valid) {
    return cleanInvalid(state.error)
  }
  if (state.pendingKeep) {
    return cleanInvalid(formatMissingValueMessage(KEEP_FLAG, KEEP_VALUE_HELP))
  }
  // dir 省略時 (`--clean` 単独 / `--clean --yes` 等) はカレントディレクトリを対象とする。
  return {
    dir: state.dir ?? '.',
    keep: state.keep,
    mode: 'clean',
    recursive: state.recursive,
    yes: state.yes,
  }
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('parseCleanArgs: --clean', () => {
    it('--clean <dir> だけで dry-run の clean モードを返す', () => {
      const parsed = parseCleanArgs(['--clean', '/tmp/x'])
      expect(parsed.mode).toBe('clean')
      if (parsed.mode === 'clean') {
        expect(parsed.dir).toBe('/tmp/x')
        expect(parsed.yes).toBe(false)
        expect([...parsed.keep]).toEqual([])
      }
    })

    it('--yes 付きで yes=true', () => {
      const parsed = parseCleanArgs(['--clean', '/tmp/x', '--yes'])
      expect(parsed.mode).toBe('clean')
      if (parsed.mode === 'clean') {
        expect(parsed.yes).toBe(true)
      }
    })

    it('--keep を複数指定すると Set に重複なく蓄積される', () => {
      const parsed = parseCleanArgs([
        '--clean',
        '/tmp/x',
        '--keep',
        'a1b2c3d4e5f6a7b8',
        '--keep',
        'A1B2C3D4E5F6A7B8',
        '--keep',
        '1111111111111111',
      ])
      expect(parsed.mode).toBe('clean')
      if (parsed.mode === 'clean') {
        expect([...parsed.keep].toSorted()).toEqual(['1111111111111111', 'a1b2c3d4e5f6a7b8'])
      }
    })

    it('--clean 単独 (dir 省略) はカレントディレクトリ `.` を対象とする', () => {
      const parsed = parseCleanArgs(['--clean'])
      expect(parsed.mode).toBe('clean')
      if (parsed.mode === 'clean') {
        expect(parsed.dir).toBe('.')
        expect(parsed.yes).toBe(false)
        expect([...parsed.keep]).toEqual([])
      }
    })

    it('--clean --yes (dir 省略) はカレントディレクトリを実削除対象とする', () => {
      const parsed = parseCleanArgs(['--clean', '--yes'])
      expect(parsed.mode).toBe('clean')
      if (parsed.mode === 'clean') {
        expect(parsed.dir).toBe('.')
        expect(parsed.yes).toBe(true)
      }
    })

    it('--clean --keep <hash> (dir 省略) もカレントディレクトリを対象に keep を蓄積する', () => {
      const parsed = parseCleanArgs(['--clean', '--keep', 'a1b2c3d4e5f6a7b8'])
      expect(parsed.mode).toBe('clean')
      if (parsed.mode === 'clean') {
        expect(parsed.dir).toBe('.')
        expect([...parsed.keep]).toEqual(['a1b2c3d4e5f6a7b8'])
      }
    })

    it('--keep の値が 16 桁 hex でない場合は invalid', () => {
      expect(parseCleanArgs(['--clean', '/tmp/x', '--keep', 'abc'])).toMatchObject({
        mode: 'invalid',
      })
      expect(parseCleanArgs(['--clean', '/tmp/x', '--keep', 'zzzzzzzzzzzzzzzz'])).toMatchObject({
        mode: 'invalid',
      })
    })

    it('--keep の値欠落は invalid', () => {
      expect(parseCleanArgs(['--clean', '/tmp/x', '--keep'])).toMatchObject({ mode: 'invalid' })
    })

    it('clean モードでは run モード用フラグ (--no-open / --theme 等) は invalid', () => {
      expect(parseCleanArgs(['--clean', '/tmp/x', '--no-open'])).toMatchObject({ mode: 'invalid' })
      expect(parseCleanArgs(['--clean', '/tmp/x', '--theme', 'dark'])).toMatchObject({
        mode: 'invalid',
      })
    })

    it('--clean を 2 回以上指定すると invalid (後勝ちで誤ディレクトリ削除を防ぐ)', () => {
      expect(parseCleanArgs(['--clean', '/tmp/a', '--clean', '/tmp/b'])).toMatchObject({
        mode: 'invalid',
      })
      expect(parseCleanArgs(['--clean', '/tmp/a', '--clean', '/tmp/b', '--yes'])).toMatchObject({
        mode: 'invalid',
      })
    })
  })

  describe('parseCleanArgs: --clean --recursive', () => {
    it('--recursive 未指定時は recursive=false', () => {
      const parsed = parseCleanArgs(['--clean', '/tmp/x'])
      expect(parsed.mode).toBe('clean')
      if (parsed.mode === 'clean') {
        expect(parsed.recursive).toBe(false)
      }
    })

    it('--recursive / -r で recursive=true になる', () => {
      for (const flag of ['--recursive', '-r']) {
        const parsed = parseCleanArgs(['--clean', '/tmp/x', flag])
        expect(parsed.mode).toBe('clean')
        if (parsed.mode === 'clean') {
          expect(parsed.recursive, `flag=${flag}`).toBe(true)
          expect(parsed.dir).toBe('/tmp/x')
        }
      }
    })

    it('dir 省略 + -r でもカレントディレクトリを再帰対象にする', () => {
      const parsed = parseCleanArgs(['--clean', '-r', '--yes'])
      expect(parsed.mode).toBe('clean')
      if (parsed.mode === 'clean') {
        expect(parsed.dir).toBe('.')
        expect(parsed.recursive).toBe(true)
        expect(parsed.yes).toBe(true)
      }
    })
  })

  describe('parseCleanArgs: invalid arguments の error メッセージ', () => {
    it('未知 flag は unknown option を含む', () => {
      expect(parseCleanArgs(['--clean', '/tmp/x', '--no-open'])).toEqual({
        error: 'unknown option: --no-open',
        mode: 'invalid',
      })
    })

    it('--keep の無効な hex は flag 名と期待形式を含む', () => {
      expect(parseCleanArgs(['--clean', '/tmp/x', '--keep', 'abc'])).toEqual({
        error: "--keep: invalid value 'abc' (expected a 16-character hex docHash (0-9, a-f))",
        mode: 'invalid',
      })
    })

    it('--keep 末尾で値欠落は missing value メッセージになる', () => {
      expect(parseCleanArgs(['--clean', '/tmp/x', '--keep'])).toEqual({
        error: '--keep: missing value (expected a 16-character hex docHash (0-9, a-f))',
        mode: 'invalid',
      })
    })

    it('--clean を 2 回以上指定すると specified more than once を含む', () => {
      expect(parseCleanArgs(['--clean', '/tmp/a', '--clean', '/tmp/b'])).toEqual({
        error:
          '--clean: specified more than once (use it only once to avoid wiping the wrong directory)',
        mode: 'invalid',
      })
    })
  })
}
