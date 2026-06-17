// YAML front matter (`---` … `---`) を検出し、key-value テーブルに変換する。
// VS Code / GitHub と同様に、front matter をメタデータテーブルとして描画するために使う。
// splitIntoPages の手前で適用することで、`---` が setext H2 として誤検出される問題も解消する。
//
// 変換は元 front matter ブロックと同じ改行数を維持する（行数保存変換）。
// テーブル行数が元ブロックより少ない場合は空行をパディングすることで、
// 本文側の sourceLine が元 markdown と一致し feedback JSON の位置情報が正確になる。

interface FrontMatterEntry {
  key: string
  value: string
}

interface ExtractResult {
  body: string
  entries: FrontMatterEntry[]
}

// front matter: 文書先頭の `---` で始まり `---` で閉じるブロック。
// 閉じ `---` の後は改行 or EOF。開き `---` は文書の 1 行目でなければならない。
// \r?\n で CRLF (Windows / paste 経路) にも対応する。
const FRONT_MATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u

const BLOCK_SCALAR_RE = /^[|>][-+]?\s*$/u

const KEY_RE = /^([^\s:][^:]*?)\s*:\s*(.*)/u

const isYamlComment = (line: string): boolean => /^\s*#/u.test(line)

const stripQuotes = (value: string): string => {
  if (value.length < 2) {
    return value
  }
  const [first] = value
  const last = value[value.length - 1]
  if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
    return value.slice(1, -1)
  }
  return value
}

const resolveRawValue = (rawValue: string): string => {
  if (BLOCK_SCALAR_RE.test(rawValue)) {
    return ''
  }
  return stripQuotes(rawValue)
}

const appendContinuation = (entry: FrontMatterEntry, trimmed: string): void => {
  if (entry.value) {
    entry.value = `${entry.value} ${trimmed}`
    return
  }
  entry.value = trimmed
}

const pushNewEntry = (entries: FrontMatterEntry[], key: string, rawValue: string): void => {
  entries.push({ key, value: resolveRawValue(rawValue) })
}

const isIndented = (line: string): boolean => /^\s/u.test(line)

const processLine = (entries: FrontMatterEntry[], line: string): void => {
  if (isYamlComment(line)) {
    return
  }
  const keyMatch = KEY_RE.exec(line)
  if (keyMatch && !isIndented(line)) {
    pushNewEntry(entries, keyMatch[1].trim(), keyMatch[2].trim())
    return
  }
  if (entries.length > 0 && isIndented(line)) {
    appendContinuation(entries[entries.length - 1], line.trim())
  }
}

const parseFrontMatterYaml = (yaml: string): FrontMatterEntry[] => {
  const entries: FrontMatterEntry[] = []
  for (const line of yaml.replace(/\r\n/gu, '\n').split('\n')) {
    if (line.trim() !== '') {
      processLine(entries, line)
    }
  }
  return entries
}

const escapeTableCell = (text: string): string => text.replace(/\|/gu, String.raw`\|`)

const formatTableRow = (entry: FrontMatterEntry): string =>
  `| ${escapeTableCell(entry.key)} | ${escapeTableCell(entry.value)} |`

const frontMatterToMarkdownTable = (entries: readonly FrontMatterEntry[]): string => {
  const rows = entries.map(formatTableRow)
  return ['| Key | Value |', '|---|---|', ...rows, ''].join('\n')
}

const countNewlines = (text: string): number => (text.match(/\n/gu) || []).length

const padToPreserveLineCount = (table: string, originalBlock: string): string => {
  const deficit = countNewlines(originalBlock) - countNewlines(table)
  if (deficit <= 0) {
    return table
  }
  return table + '\n'.repeat(deficit)
}

/**
 * 文書先頭の YAML front matter を検出し、エントリ配列と残り本文に分離する。
 * front matter が無い場合は entries が空配列で body は元テキストそのまま。
 */
export const extractFrontMatter = (markdown: string): ExtractResult => {
  const match = FRONT_MATTER_RE.exec(markdown)
  if (!match) {
    return { body: markdown, entries: [] }
  }
  const entries = parseFrontMatterYaml(match[1])
  if (entries.length === 0) {
    return { body: markdown, entries: [] }
  }
  return { body: markdown.slice(match[0].length), entries }
}

/**
 * front matter をメタデータテーブルに変換した markdown を返す。
 * 元 front matter ブロックと同じ改行数を維持するため、テーブル行数が少ない場合は
 * 空行をパディングする。本文側の sourceLine は元 markdown と一致する。
 * front matter が無い場合は元テキストをそのまま返す。
 */
export const transformFrontMatter = (markdown: string): string => {
  const match = FRONT_MATTER_RE.exec(markdown)
  if (!match) {
    return markdown
  }
  const entries = parseFrontMatterYaml(match[1])
  if (entries.length === 0) {
    return markdown
  }
  const table = frontMatterToMarkdownTable(entries)
  const padded = padToPreserveLineCount(table, match[0])
  return padded + markdown.slice(match[0].length)
}

export { escapeTableCell as _escapeTableCell_forTest }

const findLineIndex = (text: string, target: string): number =>
  text.split('\n').findIndex((line): boolean => line.includes(target))

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('extractFrontMatter: 基本検出', () => {
    it('標準的な YAML front matter を検出してエントリと本文に分離する', () => {
      const md = '---\ntitle: Hello\ntags: a, b\n---\n\n# Body\n'
      const result = extractFrontMatter(md)
      expect(result.entries).toEqual([
        { key: 'title', value: 'Hello' },
        { key: 'tags', value: 'a, b' },
      ])
      expect(result.body).toBe('\n# Body\n')
    })

    it('front matter が無い markdown はそのまま返す', () => {
      const md = '# Hello\n\nbody\n'
      const result = extractFrontMatter(md)
      expect(result.entries).toEqual([])
      expect(result.body).toBe(md)
    })

    it('文書先頭以外の --- は front matter として扱わない', () => {
      const md = '\n---\ntitle: X\n---\n'
      const result = extractFrontMatter(md)
      expect(result.entries).toEqual([])
      expect(result.body).toBe(md)
    })

    it('空の front matter (--- のみ) は無視する', () => {
      const md = '---\n\n---\n# Body\n'
      const result = extractFrontMatter(md)
      expect(result.entries).toEqual([])
      expect(result.body).toBe(md)
    })

    it('closing --- の後に改行が無い (EOF) でも検出する', () => {
      const md = '---\nkey: val\n---'
      const result = extractFrontMatter(md)
      expect(result.entries).toEqual([{ key: 'key', value: 'val' }])
      expect(result.body).toBe('')
    })

    it('CRLF 改行の front matter を検出する (paste 経路)', () => {
      const md = '---\r\ntitle: Hello\r\ntags: a, b\r\n---\r\n\r\n# Body\r\n'
      const result = extractFrontMatter(md)
      expect(result.entries).toEqual([
        { key: 'title', value: 'Hello' },
        { key: 'tags', value: 'a, b' },
      ])
      expect(result.body).toBe('\r\n# Body\r\n')
    })
  })

  describe('extractFrontMatter: 値パース', () => {
    it('クォートされた値のクォートを除去する', () => {
      const md = '---\ntitle: \'Hello World\'\ndesc: "quoted"\n---\n'
      const result = extractFrontMatter(md)
      expect(result.entries).toEqual([
        { key: 'title', value: 'Hello World' },
        { key: 'desc', value: 'quoted' },
      ])
    })

    it('ブロックスカラー (| / >) の後続インデント行を値として結合する', () => {
      const md = '---\ndescription: |\n  Line one.\n  Line two.\ntags: x\n---\n'
      const result = extractFrontMatter(md)
      expect(result.entries).toEqual([
        { key: 'description', value: 'Line one. Line two.' },
        { key: 'tags', value: 'x' },
      ])
    })

    it('値が空のキー (canonical_url: ) を空文字列として扱う', () => {
      const md = '---\ncanonical_url:\ncover_image:\n---\n'
      const result = extractFrontMatter(md)
      expect(result.entries).toEqual([
        { key: 'canonical_url', value: '' },
        { key: 'cover_image', value: '' },
      ])
    })

    it('boolean / 数値の値をそのまま文字列として保持する', () => {
      const md = '---\npublished: false\nversion: 42\n---\n'
      const result = extractFrontMatter(md)
      expect(result.entries).toEqual([
        { key: 'published', value: 'false' },
        { key: 'version', value: '42' },
      ])
    })

    it('YAML コメント行 (# で始まる行) はエントリとして拾わない', () => {
      const md = '---\n# This is a comment\ntitle: Hello\n# deprecated: old\n---\n'
      const result = extractFrontMatter(md)
      expect(result.entries).toEqual([{ key: 'title', value: 'Hello' }])
    })

    it('YAML リスト値 (- item) はインデント行として直前キーの値に結合される', () => {
      const md = '---\ntags:\n  - ai\n  - llm\n---\n'
      const result = extractFrontMatter(md)
      expect(result.entries).toEqual([{ key: 'tags', value: '- ai - llm' }])
    })
  })

  describe('transformFrontMatter: 基本変換', () => {
    it('front matter をメタデータテーブルに変換し本文の前に配置する', () => {
      const md = '---\ntitle: Test\npublished: true\n---\n\n# Body\n'
      const result = transformFrontMatter(md)
      expect(result).toContain('| Key | Value |')
      expect(result).toContain('| title | Test |')
      expect(result).toContain('| published | true |')
      expect(result).toContain('# Body')
      expect(result).not.toMatch(/^---/mu)
    })

    it('front matter が無い場合は元テキストをそのまま返す', () => {
      const md = '# No front matter\n\nbody\n'
      expect(transformFrontMatter(md)).toBe(md)
    })

    it(String.raw`値に | を含む場合は \| にエスケープする`, () => {
      const md = '---\nformula: a | b\n---\n'
      const result = transformFrontMatter(md)
      expect(result).toContain(String.raw`a \| b`)
    })

    it('devto front matter の実例を正しく変換する', () => {
      const md = [
        '---',
        "title: 'The bottleneck'",
        'published: false',
        'description: |',
        '  A fast local review loop.',
        '  Select text and comment.',
        'tags: ai, llm, markdown',
        'canonical_url:',
        '---',
        '',
        '# Intro',
        '',
      ].join('\n')
      const result = transformFrontMatter(md)
      expect(result).toContain('| title | The bottleneck |')
      expect(result).toContain('| published | false |')
      expect(result).toContain(
        '| description | A fast local review loop. Select text and comment. |'
      )
      expect(result).toContain('| tags | ai, llm, markdown |')
      expect(result).toContain('| canonical_url |  |')
      expect(result).toContain('# Intro')
    })
  })

  describe('transformFrontMatter: 行数保存', () => {
    it('単純 key-value のみの front matter では本文行番号が元と一致する', () => {
      const md = '---\ntitle: X\ntags: Y\n---\n\n# Body\n'
      const result = transformFrontMatter(md)
      expect(findLineIndex(result, '# Body')).toBe(findLineIndex(md, '# Body'))
    })

    it('YAML コメント行を含む front matter でも本文行番号が元と一致する', () => {
      const md = '---\n# comment\ntitle: X\n# another comment\n---\n\n# Body\n'
      const result = transformFrontMatter(md)
      expect(findLineIndex(result, '# Body')).toBe(findLineIndex(md, '# Body'))
    })

    it('YAML リスト記法を含む front matter でも本文行番号が元と一致する', () => {
      const md = '---\ntags:\n  - ai\n  - llm\n  - markdown\n---\n\n# Body\n'
      const result = transformFrontMatter(md)
      expect(findLineIndex(result, '# Body')).toBe(findLineIndex(md, '# Body'))
    })

    it('ブロックスカラーを含む front matter でも本文行番号が元と一致する', () => {
      const md = '---\ndesc: |\n  Line one.\n  Line two.\n  Line three.\ntags: x\n---\n\n# Body\n'
      const result = transformFrontMatter(md)
      expect(findLineIndex(result, '# Body')).toBe(findLineIndex(md, '# Body'))
    })

    it('コメント + リスト + ブロックスカラーが混在する複合ケース', () => {
      const md = [
        '---',
        '# metadata',
        'title: X',
        'description: |',
        '  Long desc.',
        '  More desc.',
        'tags:',
        '  - ai',
        '  - llm',
        '# end',
        '---',
        '',
        '# Chapter',
        '',
        'body text',
        '',
      ].join('\n')
      const result = transformFrontMatter(md)
      expect(findLineIndex(result, '# Chapter')).toBe(findLineIndex(md, '# Chapter'))
      expect(findLineIndex(result, 'body text')).toBe(findLineIndex(md, 'body text'))
    })
  })

  describe('escapeTableCell', () => {
    it(String.raw`パイプ文字を \| にエスケープする`, () => {
      expect(escapeTableCell('a|b|c')).toBe(String.raw`a\|b\|c`)
    })

    it('パイプが無い文字列はそのまま返す', () => {
      expect(escapeTableCell('hello world')).toBe('hello world')
    })
  })
}
