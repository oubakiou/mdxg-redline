// --lang フラグの先行抽出。サブパーサ非依存のグローバル メタフラグとして扱い、
// run / clean のサブパーサに渡る前に argv から strip する。
// 不正値 / 値欠落のエラーメッセージは「現在の lang で表示」したいが、通常の引数解析中に
// 不正値を検出する時点で lang 未確定だと循環依存になる。本ファイルが先行抽出 + エラー検出を
// 1 パスで行うことでこれを回避する。

import { type Lang, detectLangFromEnv } from '../core/i18n/i18n-core'
import { HELP_FLAGS } from './arg-spec'

const LANG_FLAG = '--lang'

export type LangExtractError = { kind: 'invalid_value'; token: string } | { kind: 'missing_value' }

export interface LangExtractResult {
  lang: Lang
  argv: string[]
  error: LangExtractError | null
}

const isValidLangValue = (value: string): value is Lang => value === 'en' || value === 'ja'

// `--lang` の値欠落判定: 次トークンが未定義 / --prefix / HELP_FLAGS (-h, --help) のいずれかなら
// 値欠落として扱い、次トークンは argv に残す (HELP 最優先契約と整合)。
const isMissingValueToken = (next: string | undefined): boolean => {
  if (typeof next !== 'string') {
    return true
  }
  if (next.startsWith('--')) {
    return true
  }
  return HELP_FLAGS.has(next)
}

interface ExtractState {
  lang: Lang | null
  error: LangExtractError | null
  out: string[]
  // 次トークンを --lang の値として消費するための pending フラグ。
  pendingLang: boolean
}

const INITIAL_STATE: ExtractState = {
  error: null,
  lang: null,
  out: [],
  pendingLang: false,
}

// 値トークンを受けて lang / error を更新する。pendingLang は呼び元で降ろす。
// lang 値自体は後勝ちで上書きする (有効値が複数あれば最後を採用) が、一度検出した不正値の
// error は保持する (flag-parser.ts の「不正値検出で停止」モデルと整合)。これにより
// `--lang fr --lang en` が silent に成功するのを防ぎ、bootstrap が必ず reject する。
const applyLangValue = (acc: ExtractState, value: string, env: NodeJS.ProcessEnv): ExtractState => {
  if (isValidLangValue(value)) {
    return { ...acc, lang: value, pendingLang: false }
  }
  if (value === 'auto') {
    return { ...acc, lang: detectLangFromEnv(env), pendingLang: false }
  }
  return { ...acc, error: { kind: 'invalid_value', token: value }, pendingLang: false }
}

// pending 状態で次トークンに遭遇したときの分岐: 値欠落なら error 記録 + token を argv に保持、
// それ以外なら applyLangValue で消費する。
const consumePendingLang = (
  acc: ExtractState,
  token: string,
  env: NodeJS.ProcessEnv
): ExtractState => {
  if (isMissingValueToken(token)) {
    return {
      ...acc,
      error: { kind: 'missing_value' },
      out: [...acc.out, token],
      pendingLang: false,
    }
  }
  return applyLangValue(acc, token, env)
}

// 通常状態で 1 トークンを進める。`--lang` なら pendingLang を立てるだけ、他は argv に保持。
const stepNormal = (acc: ExtractState, token: string): ExtractState => {
  if (token === LANG_FLAG) {
    return { ...acc, pendingLang: true }
  }
  return { ...acc, out: [...acc.out, token] }
}

const stepExtract =
  (env: NodeJS.ProcessEnv) =>
  (acc: ExtractState, token: string): ExtractState => {
    if (acc.pendingLang) {
      return consumePendingLang(acc, token, env)
    }
    return stepNormal(acc, token)
  }

// argv 末尾で pendingLang が残った場合 (= --lang だけで終端) は missing_value として正規化する。
const finalizeState = (state: ExtractState): ExtractState => {
  if (state.pendingLang) {
    return { ...state, error: { kind: 'missing_value' }, pendingLang: false }
  }
  return state
}

/**
 * 単一トラバーサルで --lang を抽出し、argv から strip し、エラー情報を返す。
 * 有効値同士の重複指定は後勝ち (--theme / --shiki-langs と同じ)。ただし一度検出した
 * 不正値の error は後続の有効値でクリアされず保持し、bootstrap で必ず reject する
 * (flag-parser.ts の「不正値検出で停止」モデルと整合)。例: `--lang fr --lang en` は
 * lang=en、error=invalid_value 'fr' を保持して reject される。
 */
export const extractLang = (
  rawArgv: readonly string[],
  env: NodeJS.ProcessEnv
): LangExtractResult => {
  const reduced = finalizeState(rawArgv.reduce<ExtractState>(stepExtract(env), INITIAL_STATE))
  const lang = reduced.lang ?? detectLangFromEnv(env)
  return { argv: reduced.out, error: reduced.error, lang }
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  const EMPTY_ENV: NodeJS.ProcessEnv = {}
  const EN_ENV: NodeJS.ProcessEnv = { LANG: 'en_US.UTF-8' }
  const JA_ENV: NodeJS.ProcessEnv = { LANG: 'ja_JP.UTF-8' }

  describe('extractLang: valid 値', () => {
    it('--lang en を抽出して argv から strip する', () => {
      expect(extractLang(['--lang', 'en'], EMPTY_ENV)).toEqual({
        argv: [],
        error: null,
        lang: 'en',
      })
    })

    it('--lang ja を抽出する', () => {
      expect(extractLang(['--lang', 'ja'], EMPTY_ENV)).toEqual({
        argv: [],
        error: null,
        lang: 'ja',
      })
    })

    it('--lang auto は env から推定する (ja env)', () => {
      expect(extractLang(['--lang', 'auto'], JA_ENV)).toEqual({
        argv: [],
        error: null,
        lang: 'ja',
      })
    })

    it('--lang auto は env から推定する (en env)', () => {
      expect(extractLang(['--lang', 'auto'], EN_ENV)).toEqual({
        argv: [],
        error: null,
        lang: 'en',
      })
    })
  })

  describe('extractLang: 未指定', () => {
    it('--lang なしは env から推定 (LANG=ja)', () => {
      expect(extractLang([], JA_ENV)).toEqual({
        argv: [],
        error: null,
        lang: 'ja',
      })
    })

    it('--lang なし + env なしは en fallback', () => {
      expect(extractLang([], EMPTY_ENV)).toEqual({
        argv: [],
        error: null,
        lang: 'en',
      })
    })
  })

  describe('extractLang: 不正値 (silent な事故を防ぐ)', () => {
    it("['--lang', 'fr'] は invalid_value エラーで env fallback", () => {
      expect(extractLang(['--lang', 'fr'], JA_ENV)).toEqual({
        argv: [],
        error: { kind: 'invalid_value', token: 'fr' },
        lang: 'ja',
      })
    })

    it("['--lang', 'spec.md'] は入力ファイル名として silent 消費せず invalid_value", () => {
      expect(extractLang(['--lang', 'spec.md'], EMPTY_ENV)).toEqual({
        argv: [],
        error: { kind: 'invalid_value', token: 'spec.md' },
        lang: 'en',
      })
    })
  })

  describe('extractLang: 値欠落 (--prefix / HELP_FLAGS の次トークンを誤消費しない)', () => {
    it('末尾 [--lang] は missing_value', () => {
      expect(extractLang(['--lang'], EMPTY_ENV)).toEqual({
        argv: [],
        error: { kind: 'missing_value' },
        lang: 'en',
      })
    })

    it('[--lang, --clean] は --clean を argv に残す', () => {
      expect(extractLang(['--lang', '--clean'], EMPTY_ENV)).toEqual({
        argv: ['--clean'],
        error: { kind: 'missing_value' },
        lang: 'en',
      })
    })

    it('[--lang, --help] は --help を argv に残す (help 最優先契約と整合)', () => {
      expect(extractLang(['--lang', '--help'], EMPTY_ENV)).toEqual({
        argv: ['--help'],
        error: { kind: 'missing_value' },
        lang: 'en',
      })
    })

    it('[--lang, -h] は -h を argv に残す (短形式 help も値欠落判定)', () => {
      expect(extractLang(['--lang', '-h'], EMPTY_ENV)).toEqual({
        argv: ['-h'],
        error: { kind: 'missing_value' },
        lang: 'en',
      })
    })

    it('[--clean, --lang] は --clean を残し missing_value', () => {
      expect(extractLang(['--clean', '--lang'], EMPTY_ENV)).toEqual({
        argv: ['--clean'],
        error: { kind: 'missing_value' },
        lang: 'en',
      })
    })
  })

  describe('extractLang: 後勝ち', () => {
    it('[--lang, ja, --lang, en] は en で確定', () => {
      expect(extractLang(['--lang', 'ja', '--lang', 'en'], EMPTY_ENV)).toEqual({
        argv: [],
        error: null,
        lang: 'en',
      })
    })

    it('[--lang, fr, --lang, en] は lang=en + error=invalid fr を保持 (silent な握り潰し防止)', () => {
      expect(extractLang(['--lang', 'fr', '--lang', 'en'], EMPTY_ENV)).toEqual({
        argv: [],
        error: { kind: 'invalid_value', token: 'fr' },
        lang: 'en',
      })
    })

    it('[--lang, en, --lang, fr] は lang=en stays + error=invalid fr', () => {
      expect(extractLang(['--lang', 'en', '--lang', 'fr'], JA_ENV)).toEqual({
        argv: [],
        error: { kind: 'invalid_value', token: 'fr' },
        lang: 'en',
      })
    })

    it('[--lang, ja, --lang, fr, --lang, en] は lang=en + error=invalid fr (中間の不正値を保持)', () => {
      expect(extractLang(['--lang', 'ja', '--lang', 'fr', '--lang', 'en'], EMPTY_ENV)).toEqual({
        argv: [],
        error: { kind: 'invalid_value', token: 'fr' },
        lang: 'en',
      })
    })
  })

  describe('extractLang: idempotent / 安定性', () => {
    it('extractLang(extractLang(x).argv) の argv が 1 回適用と一致', () => {
      const argv = ['--lang', 'ja', 'spec.md', './reviews']
      const first = extractLang(argv, EMPTY_ENV)
      const second = extractLang(first.argv, EMPTY_ENV)
      expect(second.argv).toEqual(first.argv)
    })
  })

  describe('extractLang: モード統合 (run / clean)', () => {
    it('clean モード: [--clean, ./reviews, --lang, ja, --yes] は argv から --lang を除去', () => {
      expect(extractLang(['--clean', './reviews', '--lang', 'ja', '--yes'], EMPTY_ENV)).toEqual({
        argv: ['--clean', './reviews', '--yes'],
        error: null,
        lang: 'ja',
      })
    })

    it('--lang 先行の clean モード: [--lang, ja, --clean]', () => {
      expect(extractLang(['--lang', 'ja', '--clean'], EMPTY_ENV)).toEqual({
        argv: ['--clean'],
        error: null,
        lang: 'ja',
      })
    })

    it('run 経路: [--lang, ja, spec.md, ./reviews] は位置引数を維持', () => {
      expect(extractLang(['--lang', 'ja', 'spec.md', './reviews'], EMPTY_ENV)).toEqual({
        argv: ['spec.md', './reviews'],
        error: null,
        lang: 'ja',
      })
    })
  })

  describe('extractLang: help と error の同時発生 (main() の help 最優先と組み合わせ)', () => {
    it('[--lang, fr, -h] は argv に -h を残し invalid_value を返す', () => {
      expect(extractLang(['--lang', 'fr', '-h'], EMPTY_ENV)).toEqual({
        argv: ['-h'],
        error: { kind: 'invalid_value', token: 'fr' },
        lang: 'en',
      })
    })

    it('[--lang, --help] は argv に --help を残し missing_value を返す', () => {
      expect(extractLang(['--lang', '--help'], EMPTY_ENV)).toEqual({
        argv: ['--help'],
        error: { kind: 'missing_value' },
        lang: 'en',
      })
    })

    it('[--lang, -h] は短形式 help でも値欠落判定が効く', () => {
      expect(extractLang(['--lang', '-h'], EMPTY_ENV)).toEqual({
        argv: ['-h'],
        error: { kind: 'missing_value' },
        lang: 'en',
      })
    })
  })
}
