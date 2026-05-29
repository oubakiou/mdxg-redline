// markdown 入力をスキャンして、フェンス付きコードブロックの言語識別子を
// Shiki 正規名集合として返す pure module。CLI の `--shiki-langs auto` から呼び出され、
// 取得した集合だけを grammar JSON として配布 HTML に inject する判断に使う。
//
// marked.lexer ベースで実装することで、リスト配下 / 引用配下 / ネストフェンスを含む
// GFM 仕様の細部追従を marked に委譲する (docs/mdxg-rendering-code-block.archive.md §5.k 参照)。
//
// 未サポート言語識別子 (typo や日本語混入、fictional 名など) は警告せず単に集合から除外する。
// レビュー対象 LLM 生成 markdown には言語識別子の typo や日本語混入が頻出するため、
// 検出のたびに stderr 警告を出すと出力が冗長化して本質的なエラーを埋もれさせる。

import { ALIAS_TO_CANONICAL, type SupportedLang } from './shiki-aliases.generated'

import { marked } from 'marked'

interface TokenLike {
  items?: unknown
  lang?: unknown
  tokens?: unknown
  type: string
}

const isTokenLike = (value: unknown): value is TokenLike => {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  return typeof (value as { type?: unknown }).type === 'string'
}

/**
 * フェンスの info string (例: `ts foo=bar`) から先頭の言語識別子だけを取り出して
 * Shiki 正規名にマップする。エイリアス・大文字混入も含めて正規化する。
 * 該当なしの場合は null を返し、呼び出し側で plain text fallback に倒す判断に使う。
 */
export const normalizeLangIdentifier = (raw: string): SupportedLang | null => {
  if (typeof raw !== 'string') {
    return null
  }
  const [head] = raw.trim().split(/\s+/u, 1)
  if (!head) {
    return null
  }
  const lower = head.toLowerCase()
  return ALIAS_TO_CANONICAL[lower] ?? null
}

const collectCodeLang = (token: TokenLike, acc: Set<SupportedLang>): void => {
  if (token.type !== 'code' || typeof token.lang !== 'string') {
    return
  }
  const canonical = normalizeLangIdentifier(token.lang)
  if (canonical !== null) {
    acc.add(canonical)
  }
}

const walkTokens = (tokens: unknown, acc: Set<SupportedLang>): void => {
  if (!Array.isArray(tokens)) {
    return
  }
  for (const token of tokens) {
    if (isTokenLike(token)) {
      collectCodeLang(token, acc)
      walkTokens(token.tokens, acc)
      walkTokens(token.items, acc)
    }
  }
}

/**
 * markdown 全体を走査して、フェンスで指定された言語の Shiki 正規名集合を返す。
 * 入力 markdown が空 / フェンスなし / 全部 plain fallback でも空 Set を返す。
 */
export const scanFencedLangs = (markdown: string): Set<SupportedLang> => {
  const acc = new Set<SupportedLang>()
  const tokens = marked.lexer(markdown)
  walkTokens(tokens, acc)
  return acc
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('normalizeLangIdentifier', () => {
    it('正規名はそのまま正規名で返る', () => {
      expect(normalizeLangIdentifier('typescript')).toBe('typescript')
      expect(normalizeLangIdentifier('python')).toBe('python')
    })

    it('短縮エイリアスを正規名にマップする (ts / js / py / sh / yml / rb)', () => {
      expect(normalizeLangIdentifier('ts')).toBe('typescript')
      expect(normalizeLangIdentifier('js')).toBe('javascript')
      expect(normalizeLangIdentifier('py')).toBe('python')
      expect(normalizeLangIdentifier('sh')).toBe('shellscript')
      expect(normalizeLangIdentifier('yml')).toBe('yaml')
      expect(normalizeLangIdentifier('rb')).toBe('ruby')
    })

    it('bash / shell / zsh は shellscript に集約される', () => {
      expect(normalizeLangIdentifier('bash')).toBe('shellscript')
      expect(normalizeLangIdentifier('shell')).toBe('shellscript')
      expect(normalizeLangIdentifier('zsh')).toBe('shellscript')
    })

    it('大文字 / 大文字小文字混在を lowercase で解釈する', () => {
      expect(normalizeLangIdentifier('JS')).toBe('javascript')
      expect(normalizeLangIdentifier('Python')).toBe('python')
      expect(normalizeLangIdentifier('TypeScript')).toBe('typescript')
    })

    it('info string にスペース・属性が混じっても先頭の単語を識別子として使う', () => {
      expect(normalizeLangIdentifier('ts foo=bar')).toBe('typescript')
      expect(normalizeLangIdentifier('  py   x  ')).toBe('python')
    })

    it('未サポート / 空文字 / 空白のみは null', () => {
      expect(normalizeLangIdentifier('mylang')).toBeNull()
      expect(normalizeLangIdentifier('xxx-fake')).toBeNull()
      expect(normalizeLangIdentifier('')).toBeNull()
      expect(normalizeLangIdentifier('   ')).toBeNull()
    })
  })

  // describe を 3 つに分けているのは max-statements (10) を満たすため。テスト粒度は同じ。
  describe('scanFencedLangs: 基本検出', () => {
    it('言語識別子なしフェンスは集合に含めない', () => {
      const langs = scanFencedLangs('```\nplain\n```\n')
      expect([...langs]).toEqual([])
    })

    it('空 markdown は空集合を返す', () => {
      expect([...scanFencedLangs('')]).toEqual([])
    })

    it('``` フェンスと ~~~ フェンスの両方を検出する', () => {
      const langs = scanFencedLangs('```ts\nlet x = 1\n```\n\n~~~py\nz = 1\n~~~\n')
      expect([...langs].toSorted()).toEqual(['python', 'typescript'])
    })

    it('複数フェンスの正規名集合を返す (重複排除)', () => {
      const md = '```ts\nlet x = 1\n```\n\n```typescript\nlet y = 2\n```\n\n```py\nz = 3\n```\n'
      expect([...scanFencedLangs(md)].toSorted()).toEqual(['python', 'typescript'])
    })

    it('インラインコードはフェンスとして扱わない', () => {
      const langs = scanFencedLangs('Some inline `code` here\n')
      expect([...langs]).toEqual([])
    })
  })

  describe('scanFencedLangs: 正規化と未サポート', () => {
    it('エイリアス短縮形は正規名に正規化される (ts/js/py/sh/yml/rb/bash)', () => {
      const md =
        '```ts\nx\n```\n\n```py\ny\n```\n\n```sh\nz\n```\n\n```bash\nq\n```\n\n```yml\nw\n```\n\n```rb\nr\n```\n'
      expect([...scanFencedLangs(md)].toSorted()).toEqual([
        'python',
        'ruby',
        'shellscript',
        'typescript',
        'yaml',
      ])
    })

    it('未サポート言語識別子は無視する (ホワイトリスト外)', () => {
      const langs = scanFencedLangs('```mylang\nlet x = 1\n```\n\n```ts\nlet y = 1\n```\n')
      expect([...langs]).toEqual(['typescript'])
    })

    it('GFM info string に余分な属性が付いても先頭の言語識別子だけを使う', () => {
      const langs = scanFencedLangs('```ts foo=bar baz\nlet x = 1\n```\n')
      expect([...langs]).toEqual(['typescript'])
    })

    it('大文字混入の lang もマップする', () => {
      const langs = scanFencedLangs('```JS\nconst x = 1\n```\n\n```TypeScript\nlet y\n```\n')
      expect([...langs].toSorted()).toEqual(['javascript', 'typescript'])
    })
  })

  describe('scanFencedLangs: ネスト構造', () => {
    it('リスト配下のインデント付きフェンスも検出する (GFM)', () => {
      const langs = scanFencedLangs('- item\n\n  ```js\n  const y = 2\n  ```\n')
      expect([...langs]).toEqual(['javascript'])
    })

    it('引用配下のフェンスも検出する (GFM)', () => {
      const langs = scanFencedLangs('> quoted\n>\n> ```py\n> z = 3\n> ```\n')
      expect([...langs]).toEqual(['python'])
    })

    it('リスト + 引用の二重ネスト配下のフェンスも検出する', () => {
      const md = '> - inside quoted list\n>\n>   ```rs\n>   fn main() {}\n>   ```\n'
      expect([...scanFencedLangs(md)]).toEqual(['rust'])
    })

    // marked.lexer は外側 4 バッククォートを 1 つの code トークンとして返し (lang=markdown)、
    // 内側のフェンスは code.text の中のリテラルでしかなくトークン化されない。
    // したがって検出されるのは外側の markdown だけ。
    it('markdown フェンス内のネストフェンス (4 バッククォート) は外側のみ検出される', () => {
      const md = '````markdown\n```ts\nlet x = 1\n```\n````\n'
      expect([...scanFencedLangs(md)]).toEqual(['markdown'])
    })
  })

  // shiki-aliases.generated.ts は build (vite closeBundle) が毎回再生成する commit 対象の
  // 生成物。shiki bump / SPEC_LANGS 変更後に再生成・commit を忘れると消費側が古い alias 表で
  // 動くため、build を挟まず再生成内容と commit 済みファイルの一致を検証する。
  describe('shiki-aliases.generated.ts freshness (生成物鮮度)', () => {
    it('インストール済み shiki / SPEC_LANGS から再生成した内容が commit 済みファイルと一致', async () => {
      const [fs, meta, url, path] = await Promise.all([
        import('node:fs'),
        import('../../scripts/lib/shiki-meta.ts'),
        import('node:url'),
        import('node:path'),
      ])
      const here = path.dirname(url.fileURLToPath(import.meta.url))
      const pkgText = fs.readFileSync(
        path.resolve(here, '..', '..', 'node_modules', 'shiki', 'package.json'),
        'utf8'
      )
      const versionMatch = /"version"\s*:\s*"([^"]+)"/.exec(pkgText)
      const canonicals = meta.canonicalizeSpec()
      const regenerated = meta.formatAliasesTs({
        aliasMap: meta.buildAliasMap(canonicals),
        canonicals,
        shikiVersion: (versionMatch ?? ['', ''])[1],
      })
      const committed = fs.readFileSync(path.resolve(here, 'shiki-aliases.generated.ts'), 'utf8')
      expect(versionMatch).not.toBeNull()
      expect(
        regenerated,
        'shiki-aliases.generated.ts が古い。vp build / npm run build で再生成して commit すること'
      ).toBe(committed)
    })
  })
}
