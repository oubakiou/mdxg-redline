#!/usr/bin/env node
import { execSync } from 'node:child_process'
import path from 'node:path'

/**
 * ステータスラインをカスタマイズする
 * https://code.claude.com/docs/ja/statusline
 */

// `git diff --numstat` 等の読み取り系コマンドは、 stat 情報が stale な index を refresh する
// ために exclusive な `.git/index.lock` を握る。 ステータスラインは数秒ごとに呼ばれるので、
// ユーザーの `git commit` と頻繁にレースして `Unable to create '.git/index.lock'` を起こす。
// `GIT_OPTIONAL_LOCKS=0` は git 公式の escape hatch で、読み取り系の lock 取得を skip させる
// (副作用: 表示する staged/modified カウントが一瞬古いことがあるが、ステータスラインの目的では
// 許容できる)。 LazyGit / VS Code Git extension / Starship 等の標準テクニック。
process.env.GIT_OPTIONAL_LOCKS = '0'

const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const RESET = '\x1b[0m'

/** 使用率に応じたANSIカラーコードを返す */
const colorize = (pct: number): string => {
  if (pct >= 40) {
    return RED
  }
  if (pct >= 20) {
    return YELLOW
  }
  return GREEN
}

/** 使用率に応じた絵文字を返す */
const emoji = (pct: number): string => {
  if (pct >= 40) {
    return '💀'
  }
  if (pct >= 20) {
    return '🫠'
  }
  return '😊'
}

/** 値がオブジェクトかどうか判定する型ガード */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** ネストされたオブジェクトから数値を取得しfloorする */
const getNestedNumber = (
  obj: Record<string, unknown>,
  keys: { key1: string; key2: string; fallback: number }
): number => {
  const nested = obj[keys.key1]
  if (isRecord(nested)) {
    const val = nested[keys.key2]
    if (typeof val === 'number') {
      return Math.floor(val)
    }
  }
  return keys.fallback
}

/** レートリミットの使用率を色付きでフォーマットする */
const formatRate = (pct: number, label: string): string | false => {
  if (pct < 0) {
    return false
  }
  return `${colorize(pct)}${label}:${pct}%${RESET}`
}

/** コンテキストウィンドウの使用率表示を組み立てる */
const buildContextInfo = (data: Record<string, unknown>): string => {
  const ctxPct = getNestedNumber(data, {
    fallback: 0,
    key1: 'context_window',
    key2: 'used_percentage',
  })
  return `${emoji(ctxPct)} ${colorize(ctxPct)}ctx:${ctxPct}%${RESET}`
}

/** レートリミットオブジェクトから指定キーの使用率を抽出する */
const extractRatePct = (rateLimits: unknown, key: string): number => {
  if (!isRecord(rateLimits)) {
    return -1
  }
  const bucket = rateLimits[key]
  if (isRecord(bucket) && typeof bucket.used_percentage === 'number') {
    return Math.floor(bucket.used_percentage)
  }
  return -1
}

/** 5時間/7日のレートリミット表示を組み立てる */
const buildRateInfo = (data: Record<string, unknown>): string => {
  const fiveHourPct = extractRatePct(data.rate_limits, 'five_hour')
  const sevenDayPct = extractRatePct(data.rate_limits, 'seven_day')
  return [formatRate(fiveHourPct, '5h'), formatRate(sevenDayPct, '7d')].filter(Boolean).join(' | ')
}

/** staged/modifiedのファイル数を取得する */
const getGitChanges = (): { staged: number; modified: number } => {
  const staged = execSync('git diff --cached --numstat', { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean).length
  const modified = execSync('git diff --numstat', { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean).length
  return { modified, staged }
}

/** git変更状況を色付き文字列にフォーマットする */
const buildGitStatus = (staged: number, modified: number): string => {
  const parts = [
    staged && `${GREEN}+${staged}${RESET}`,
    modified && `${YELLOW}~${modified}${RESET}`,
  ]
  return parts.filter(Boolean).join('')
}

/** リポジトリ名・ブランチ名をOSC 8リンク付きで組み立てる */
const buildGitInfo = (): string[] => {
  execSync('git rev-parse --git-dir', { stdio: 'ignore' })
  // SSH を HTTPS 形式に変換
  const remote = execSync('git remote get-url origin', {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'ignore'],
  })
    .trim()
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/\.git$/, '')
  const repoName = path.basename(remote)
  const branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim()
  const { staged, modified } = getGitChanges()
  const gitStatus = buildGitStatus(staged, modified)

  // OSC 8 ハイパーリンク
  const repoLink = `\x1b]8;;${remote}\x07${repoName}\x1b]8;;\x07`
  const branchLink = `\x1b]8;;${remote}/tree/${branch}\x07${branch}\x1b]8;;\x07`

  return [`📁 ${repoLink}`, `🌿 ${branchLink} ${gitStatus}`]
}

/** パーツを「|」区切りで標準出力に書き出す */
const outputLine = (parts: string[]): void => {
  process.stdout.write(`${parts.filter(Boolean).join(' | ')}\n`)
}

/** dataオブジェクトからワークスペースのディレクトリ名を取得する */
const extractDirName = (data: Record<string, unknown>): string => {
  if (!isRecord(data.workspace)) {
    return ''
  }
  const cd = data.workspace.current_dir
  if (typeof cd === 'string') {
    return path.basename(cd)
  }
  return ''
}

const chunks: string[] = []
process.stdin.on('data', (chunk) => chunks.push(String(chunk)))
process.stdin.on('end', () => {
  const data: Record<string, unknown> = JSON.parse(chunks.join(''))
  const dir = extractDirName(data)
  const ctxInfo = buildContextInfo(data)
  const rateInfo = buildRateInfo(data)

  try {
    const gitParts = buildGitInfo()
    outputLine([ctxInfo, rateInfo, ...gitParts])
  } catch {
    outputLine([ctxInfo, rateInfo, `📁 ${dir}`])
  }
})

/**
 * MARK: In-Source Testing
 * @example vp test .claude/statusline.ts
 */

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest

  describe('colorize', () => {
    it('40以上は赤を返す', () => {
      expect(colorize(40)).toBe(RED)
      expect(colorize(100)).toBe(RED)
    })
    it('20以上40未満は黄色を返す', () => {
      expect(colorize(20)).toBe(YELLOW)
      expect(colorize(39)).toBe(YELLOW)
    })
    it('20未満は緑を返す', () => {
      expect(colorize(0)).toBe(GREEN)
      expect(colorize(19)).toBe(GREEN)
    })
  })

  describe('emoji', () => {
    it('40以上は💀を返す', () => {
      expect(emoji(40)).toBe('💀')
    })
    it('20以上40未満は🫠を返す', () => {
      expect(emoji(20)).toBe('🫠')
    })
    it('20未満は😊を返す', () => {
      expect(emoji(0)).toBe('😊')
    })
  })

  describe('getNestedNumber', () => {
    it('ネストされた値を取得する', () => {
      const obj = { context_window: { used_percentage: 35.7 } }
      const result = getNestedNumber(obj, {
        fallback: 0,
        key1: 'context_window',
        key2: 'used_percentage',
      })
      expect(result).toBe(35)
    })
    it('キーが存在しない場合はfallbackを返す', () => {
      const result = getNestedNumber({}, { fallback: -1, key1: 'missing', key2: 'val' })
      expect(result).toBe(-1)
    })
  })

  describe('formatRate', () => {
    it('負の値はfalseを返す', () => {
      expect(formatRate(-1, '5h')).toBe(false)
    })
    it('0以上はフォーマットされた文字列を返す', () => {
      const result = formatRate(10, '5h')
      expect(result).toContain('5h:10%')
    })
  })

  describe('extractRatePct', () => {
    it('falseの場合は-1を返す', () => {
      expect(extractRatePct(false, 'five_hour')).toBe(-1)
    })
    it('キーが存在しない場合は-1を返す', () => {
      expect(extractRatePct({}, 'five_hour')).toBe(-1)
    })
    it('値が存在する場合はfloorした値を返す', () => {
      const limits = { five_hour: { used_percentage: 25.9 } }
      expect(extractRatePct(limits, 'five_hour')).toBe(25)
    })
  })

  describe('buildRateInfo', () => {
    it('rate_limitsがない場合は空文字を返す', () => {
      expect(buildRateInfo({})).toBe('')
    })
    it('rate_limitsがある場合はフォーマットされた文字列を返す', () => {
      const data = {
        rate_limits: {
          five_hour: { used_percentage: 10 },
          seven_day: { used_percentage: 30 },
        },
      }
      const result = buildRateInfo(data)
      expect(result).toContain('5h:10%')
      expect(result).toContain('7d:30%')
    })
  })

  describe('buildGitStatus', () => {
    it('変更なしの場合は空文字を返す', () => {
      expect(buildGitStatus(0, 0)).toBe('')
    })
    it('stagedのみの場合', () => {
      const result = buildGitStatus(3, 0)
      expect(result).toContain('+3')
    })
    it('modifiedのみの場合', () => {
      const result = buildGitStatus(0, 5)
      expect(result).toContain('~5')
    })
    it('両方ある場合', () => {
      const result = buildGitStatus(2, 4)
      expect(result).toContain('+2')
      expect(result).toContain('~4')
    })
  })

  describe('buildContextInfo', () => {
    it('コンテキスト情報をフォーマットする', () => {
      const data = { context_window: { used_percentage: 15 } }
      const result = buildContextInfo(data)
      expect(result).toContain('ctx:15%')
      expect(result).toContain('😊')
    })
    it('context_windowがない場合は0%を返す', () => {
      const result = buildContextInfo({})
      expect(result).toContain('ctx:0%')
    })
  })
}
