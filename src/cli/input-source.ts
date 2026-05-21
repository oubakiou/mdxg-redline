// stdin / file 入力の両対応で、markdown 本文と docName・既定の出力先を組み立てる薄い層。

import { basename, dirname } from 'node:path'
import process from 'node:process'
import { readFile } from 'node:fs/promises'

const STDIN_TOKEN = '-'
const STDIN_DEFAULT_DOC_NAME = 'stdin.md'

export interface InputSource {
  defaultOutputDir: string
  docName: string
  markdown: string
}

// process.stdin の async iterator は any を yield するため、Buffer / string の双方を
// バイト列に正規化してから連結する。no-ternary 規約に抵触しないよう関数化。
const toBuffer = (chunk: unknown): Buffer => {
  if (Buffer.isBuffer(chunk)) {
    return chunk
  }
  return Buffer.from(String(chunk), 'utf8')
}

// stdin に流れてきた全バイトを UTF-8 文字列として読み切る。
// パイプ入力の終端まで待つ async iterator を使う標準的なパターン。
const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(toBuffer(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

// docName は --document-name 指定があれば最優先。stdin の場合は STDIN_DEFAULT_DOC_NAME を
// docName のフォールバックに、cwd を defaultOutputDir に使う。
export const resolveInput = async (
  inputPath: string,
  documentName?: string
): Promise<InputSource> => {
  if (inputPath === STDIN_TOKEN) {
    const markdown = await readStdin()
    return {
      defaultOutputDir: process.cwd(),
      docName: documentName ?? STDIN_DEFAULT_DOC_NAME,
      markdown,
    }
  }
  const markdown = await readFile(inputPath, 'utf8')
  return {
    defaultOutputDir: dirname(inputPath),
    docName: documentName ?? basename(inputPath),
    markdown,
  }
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  // fs / os / path は production では別ライン (readFile / path) しか使わないため、
  // テスト専用の helper はバンドルに含めないよう dynamic import で評価を遅延する。
  // vite config の define が `if (import.meta.vitest)` を `if (undefined)` に潰すため、
  // 内側の `await import` ごと production bundle から dead-code 除去される。
  describe('toBuffer', () => {
    it('Buffer はそのまま (参照同一性を保って) 返す', () => {
      const buf = Buffer.from('hello', 'utf8')
      expect(toBuffer(buf)).toBe(buf)
    })

    it('文字列は UTF-8 Buffer に変換する (マルチバイトを含む)', () => {
      expect(toBuffer('日本語').toString('utf8')).toBe('日本語')
    })

    it('Buffer でも string でもない値は String() を介してから UTF-8 化する', () => {
      expect(toBuffer(42).toString('utf8')).toBe('42')
    })
  })

  // モジュールスコープに上げれば lint 的にはより整うが、`if (import.meta.vitest)` の外側に
  // 出すと vite の dead-code 除去で消えなくなり production bundle に helper が残る。
  // テスト専用 helper のため、production bundle に含めないことを優先して in-block 定義のままにする。
  // eslint-disable-next-line unicorn/consistent-function-scoping
  const makeFixture = async (
    contents: string,
    fileName = 'spec.md'
  ): Promise<{ cleanup: () => Promise<void>; dir: string; filePath: string }> => {
    const fs = await import('node:fs/promises')
    const os = await import('node:os')
    const path = await import('node:path')
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdxg-resolveInput-'))
    const filePath = path.join(dir, fileName)
    await fs.writeFile(filePath, contents, 'utf8')
    return {
      cleanup: async (): Promise<void> => {
        await fs.rm(dir, { force: true, recursive: true })
      },
      dir,
      filePath,
    }
  }

  describe('resolveInput (file 入力)', () => {
    it('--document-name 未指定時は basename(inputPath) を docName に、dirname(inputPath) を defaultOutputDir に使う', async () => {
      const { cleanup, dir, filePath } = await makeFixture('# Hello\n')
      try {
        const result = await resolveInput(filePath)
        expect(result.docName).toBe('spec.md')
        expect(result.defaultOutputDir).toBe(dir)
        expect(result.markdown).toBe('# Hello\n')
      } finally {
        await cleanup()
      }
    })

    it('--document-name 指定時は docName を上書きするが defaultOutputDir は dirname(inputPath) のまま', async () => {
      const { cleanup, dir, filePath } = await makeFixture('body', 'orig.md')
      try {
        const result = await resolveInput(filePath, 'override.md')
        expect(result.docName).toBe('override.md')
        expect(result.defaultOutputDir).toBe(dir)
      } finally {
        await cleanup()
      }
    })

    it('UTF-8 マルチバイト本文を文字化けなく読み込む', async () => {
      const { cleanup, filePath } = await makeFixture('日本語の本文\n')
      try {
        const result = await resolveInput(filePath)
        expect(result.markdown).toBe('日本語の本文\n')
      } finally {
        await cleanup()
      }
    })
  })
}
