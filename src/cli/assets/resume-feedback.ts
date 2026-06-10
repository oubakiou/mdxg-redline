// 同じ <name>-<hash>- プレフィックスの feedback.json があれば <script id="embedded-feedback">
// に注入する resume 経路 (DESIGN.md §8 「既存 feedback.json の取り込み」)。
// stdin 入力時は cwd 偶発一致を避けるため skip。docHash 不一致時は stderr 警告 + skip。

import { deriveFeedbackJsonName, rewriteEmbeddedFeedback, stripMarkdownExt } from '../../core/embed'
import { dirname, resolve } from 'node:path'
import type { EmbedContext } from '../embed-context'
import type { RunArgs } from '../parse-args'
import { commentsFromUnknown } from '../../core/feedback'
import process from 'node:process'
import { readFile } from 'node:fs/promises'
import { sanitizeMdFileName } from '../../core/filename-sanitize'
import { translateCli } from '../i18n'

const STDIN_TOKEN = '-'

const parseFeedbackJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object'

/**
 * `isImportableComment` を通る件数のみ数える。ブラウザ側 boot 経路は壊れた要素を fail-soft に
 * filter するため、raw `payload.comments.length` と「実際に貼り直される件数」が乖離する。
 */
const countComments = (payload: unknown): number => {
  if (!isRecord(payload)) {
    return 0
  }
  return commentsFromUnknown(payload.comments).length
}

const extractDocHash = (payload: unknown): string | null => {
  if (!isRecord(payload)) {
    return null
  }
  if (typeof payload.docHash !== 'string') {
    return null
  }
  return payload.docHash
}

/**
 * `outputPath` と同じディレクトリにある `<mdFileName>-<docHash>-feedback.json` のフルパス。
 * compose-review-html.ts の outputPath 組み立てと同じ sanitize / stripExt ルールに揃える。
 */
const resolveFeedbackPath = (docName: string, docHash: string, outputPath: string): string => {
  const mdFileName = sanitizeMdFileName(stripMarkdownExt(docName))
  return resolve(dirname(outputPath), deriveFeedbackJsonName(mdFileName, docHash))
}

interface FeedbackReadResult {
  raw: string | null
  warning: string | null
}

const extractErrorCode = (error: unknown): string => {
  if (error instanceof Error && 'code' in error) {
    return String(error.code)
  }
  return 'unknown'
}

/**
 * ENOENT (= 初回ラウンドで feedback.json が存在しない) は silent skip。
 * EACCES / EISDIR / ELOOP 等の他 I/O エラーも、resume が失敗するだけで review HTML 生成
 * 自体は続行できるため stderr 警告 + skip にダウングレードする (CLI 全体を落とさない)。
 */
const readFeedbackFile = async (feedbackPath: string): Promise<FeedbackReadResult> => {
  try {
    return { raw: await readFile(feedbackPath, 'utf8'), warning: null }
  } catch (error) {
    const code = extractErrorCode(error)
    if (code === 'ENOENT') {
      return { raw: null, warning: null }
    }
    return {
      raw: null,
      warning: `${translateCli('cli.feedback_read_failed', { code, path: feedbackPath })}\n`,
    }
  }
}

/**
 * feedback payload を検証して注入対象かどうか判定する pure 関数。
 * - invalid JSON / docHash 不一致は warning 用のメッセージを返し、html はそのまま返す
 * - 注入対象なら次段で rewriteEmbeddedFeedback を呼ぶための payload を返す
 */
interface ValidationResult {
  payload: unknown
  warning: string | null
}

const validateFeedbackPayload = (
  raw: string,
  expectedDocHash: string,
  feedbackPath: string
): ValidationResult => {
  const payload = parseFeedbackJson(raw)
  if (payload === null) {
    return {
      payload: null,
      warning: `${translateCli('cli.feedback_invalid_json', { path: feedbackPath })}\n`,
    }
  }
  const payloadDocHash = extractDocHash(payload)
  if (payloadDocHash !== expectedDocHash) {
    return {
      payload: null,
      warning: `${translateCli('cli.feedback_hash_mismatch', {
        expected: expectedDocHash,
        got: payloadDocHash ?? 'null',
        path: feedbackPath,
      })}\n`,
    }
  }
  return { payload, warning: null }
}

/**
 * 注入対象の payload を解決する pure な調整層。
 * - stdin 入力 / ファイル未発見 → null (silent skip)
 * - JSON 不正 / docHash 不一致 → stderr 警告を出して null
 * - 注入対象 → payload + feedbackPath
 */
interface ResumePayload {
  feedbackPath: string
  payload: unknown
}

const readValidatedFeedback = async (
  feedbackPath: string,
  expectedDocHash: string
): Promise<ResumePayload | null> => {
  const { raw, warning: readWarning } = await readFeedbackFile(feedbackPath)
  if (readWarning !== null) {
    process.stderr.write(readWarning)
  }
  if (raw === null) {
    return null
  }
  const { payload, warning } = validateFeedbackPayload(raw, expectedDocHash, feedbackPath)
  if (warning !== null) {
    process.stderr.write(warning)
    return null
  }
  return { feedbackPath, payload }
}

const resolveResumePayload = async (
  args: RunArgs,
  ctx: EmbedContext
): Promise<ResumePayload | null> => {
  if (args.inputPath === STDIN_TOKEN) {
    return null
  }
  const feedbackPath = resolveFeedbackPath(ctx.docName, ctx.docHash, ctx.outputPath)
  return readValidatedFeedback(feedbackPath, ctx.docHash)
}

export const applyResumeFeedback = async (
  html: string,
  args: RunArgs,
  ctx: EmbedContext
): Promise<string> => {
  const resolved = await resolveResumePayload(args, ctx)
  if (resolved === null) {
    return html
  }
  const count = countComments(resolved.payload)
  const rewritten = rewriteEmbeddedFeedback(html, resolved.payload)
  process.stderr.write(
    `${translateCli('cli.feedback_resumed', { count, path: resolved.feedbackPath })}\n`
  )
  return rewritten
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('resolveFeedbackPath', () => {
    it('outputPath と同じディレクトリに <mdFileName>-<docHash>-feedback.json を組み立てる', () => {
      const path = resolveFeedbackPath('spec.md', 'a1b2c3d4e5f6a7b8', '/tmp/reviews/foo.html')
      expect(path).toBe('/tmp/reviews/spec-a1b2c3d4e5f6a7b8-feedback.json')
    })

    it('docName が日本語でもそのまま使う (review HTML と命名規約を揃える)', () => {
      const path = resolveFeedbackPath('仕様書 v2.md', 'a1b2c3d4e5f6a7b8', '/x/y/out.html')
      expect(path).toBe('/x/y/仕様書 v2-a1b2c3d4e5f6a7b8-feedback.json')
    })

    it('docName 内のパス区切り文字 / は _ に sanitize される (パストラバーサル防止)', () => {
      const path = resolveFeedbackPath('a/b.md', 'h0123456789abcdef', '/d/out.html')
      expect(path).toBe('/d/a_b-h0123456789abcdef-feedback.json')
    })
  })

  describe('countComments', () => {
    const validComment = {
      blockId: 'b001',
      comment: 'fix this',
      created: '2026-05-17T00:00:00.000Z',
      endOffset: 4,
      id: 'abc123',
      quote: 'text',
      sourceLine: 1,
      startOffset: 0,
    }

    it('isImportableComment を通る要素だけ数える (ブラウザ側貼付件数と一致)', () => {
      expect(countComments({ comments: [validComment, validComment] })).toBe(2)
    })

    it('壊れた要素は count から除外する (Resumed 件数とブラウザ側で貼り直す件数を揃える)', () => {
      expect(
        countComments({
          comments: [
            validComment,
            { ...validComment, id: '' },
            { ...validComment, sourceLine: 0 },
            'not an object',
          ],
        })
      ).toBe(1)
    })

    it('comments が配列でないなら 0', () => {
      expect(countComments({ comments: 'oops' })).toBe(0)
      expect(countComments({})).toBe(0)
      expect(countComments(null)).toBe(0)
      expect(countComments(42)).toBe(0)
    })
  })

  describe('extractErrorCode', () => {
    it('Error.code があれば文字列化して返す', () => {
      const err = Object.assign(new Error('boom'), { code: 'EACCES' })
      expect(extractErrorCode(err)).toBe('EACCES')
    })

    it('code が無い Error は "unknown"', () => {
      expect(extractErrorCode(new Error('no code'))).toBe('unknown')
    })

    it('Error でない値は "unknown"', () => {
      expect(extractErrorCode('string error')).toBe('unknown')
      expect(extractErrorCode(null)).toBe('unknown')
    })
  })

  describe('extractDocHash', () => {
    it('docHash が文字列なら返す', () => {
      expect(extractDocHash({ docHash: 'h' })).toBe('h')
    })

    it('docHash が無い / 型違いなら null', () => {
      expect(extractDocHash({})).toBeNull()
      expect(extractDocHash({ docHash: 42 })).toBeNull()
      expect(extractDocHash(null)).toBeNull()
    })
  })

  describe('parseFeedbackJson', () => {
    it('valid JSON を parse して返す', () => {
      expect(parseFeedbackJson('{"key":1}')).toEqual({ key: 1 })
    })

    it('不正 JSON は null', () => {
      expect(parseFeedbackJson('{ broken')).toBeNull()
    })
  })

  describe('validateFeedbackPayload', () => {
    it('docHash 一致時は payload を返し warning は null', () => {
      const raw = JSON.stringify({ comments: [], docHash: 'h0123456789abcdef' })
      const result = validateFeedbackPayload(raw, 'h0123456789abcdef', '/x/y.json')
      expect(result.warning).toBeNull()
      expect(result.payload).toEqual({ comments: [], docHash: 'h0123456789abcdef' })
    })

    it('docHash 不一致時は warning を返し payload は null', () => {
      const raw = JSON.stringify({ comments: [], docHash: 'old' })
      const result = validateFeedbackPayload(raw, 'new', '/x/y.json')
      expect(result.payload).toBeNull()
      expect(result.warning).toContain('docHash mismatch')
    })

    it('JSON parse 失敗時は invalid JSON warning', () => {
      const result = validateFeedbackPayload('{ broken', 'h', '/x/y.json')
      expect(result.payload).toBeNull()
      expect(result.warning).toContain('invalid JSON')
    })
  })
}
