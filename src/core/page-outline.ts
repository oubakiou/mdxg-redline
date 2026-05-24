// 1 ページ分の markdown から H3–H6 見出し列を抽出する pure module。
// page-split.ts 側 (H1/H2 境界検出) と共通の low-level scanner `scanHeadings` を持ち、
// outline 用には depth 3–6 を残して slug を一意化した `Heading[]` を返す。
//
// setext 形式は CommonMark §4.3 が H1 (===) / H2 (---) のみ規定しており H3 以降は存在しない。
// したがって outline (H3–H6) では ATX 形式だけを拾う。低 level の scanHeadings は両形式を扱う。
//
// コードフェンス内の `#` を見出しとして拾わないために、CommonMark §4.5 のフェンス追跡を
// 行単位で実装する。`marked.lexer` を使わない理由: lexer は H1/H2 を depth で返すが、
// 元 markdown の 0-origin 行オフセット (Heading.sourceLineOffset / page boundary 位置) を
// 取り出すには行単位 scan が直接的で副作用が少ない。

import { resolveUniqueSlug, slugifyOrFallback } from './slugify'

/**
 * ページ内 H3–H6 見出しの outline 用表現。
 * slug は同一 page 内で一意。URL fragment は `<page-slug>__<heading-slug>` で組み立てる
 * (区切りは `__` 二連 underscore で衝突回避、本実装独自規約)。
 */
export interface Heading {
  level: 3 | 4 | 5 | 6
  slug: string
  sourceLineOffset: number
  text: string
}

/** scanHeadings の出力。ATX / setext いずれも `lineIndex` は見出し起点 (setext は title 行) */
export interface HeadingHit {
  depth: 1 | 2 | 3 | 4 | 5 | 6
  lineIndex: number
  title: string
}

interface FenceState {
  char: '`' | '~'
  length: number
}

// CommonMark §4.5: backtick fence の info string には ` を含められない。
// tilde fence には任意の info string を許す。
const BACKTICK_FENCE_OPEN_RE = /^ {0,3}(`{3,})([^`]*)$/u
const TILDE_FENCE_OPEN_RE = /^ {0,3}(~{3,})/u

const detectFenceOpen = (line: string): FenceState | null => {
  const backtick = BACKTICK_FENCE_OPEN_RE.exec(line)
  if (backtick) {
    return { char: '`', length: backtick[1].length }
  }
  const tilde = TILDE_FENCE_OPEN_RE.exec(line)
  if (tilde) {
    return { char: '~', length: tilde[1].length }
  }
  return null
}

const detectFenceClose = (line: string, open: FenceState): boolean => {
  // open.char はすでに `'`' | '~'` に narrow されているので、そのまま regex source に埋めて良い
  // (バックスラッシュエスケープが要らない 2 文字に限定されているため安全)。
  const closeRe = new RegExp(`^ {0,3}${open.char}{${open.length},}[ \\t]*$`, 'u')
  return closeRe.test(line)
}

// ATX heading: 0–3 leading spaces, 1–6 #, 後ろは EOL か space/tab。
// `#hello` のような無空白続きは非対象 (CommonMark §4.2)。
const ATX_OPENING_RE = /^ {0,3}(#{1,6})(?=$|[ \t])/u
const ATX_CLOSING_RE = /[ \t]+#+[ \t]*$/u

interface AtxHit {
  depth: 1 | 2 | 3 | 4 | 5 | 6
  title: string
}

const isAtxDepth = (depth: number): depth is 1 | 2 | 3 | 4 | 5 | 6 => depth >= 1 && depth <= 6

const detectAtxHeading = (line: string): AtxHit | null => {
  const match = ATX_OPENING_RE.exec(line)
  if (!match) {
    return null
  }
  const depth = match[1].length
  if (!isAtxDepth(depth)) {
    return null
  }
  const tail = line.slice(match[0].length).replace(/^[ \t]+|[ \t]+$/gu, '')
  const title = tail.replace(ATX_CLOSING_RE, '').trim()
  return { depth, title }
}

const SETEXT_H1_RE = /^ {0,3}=+[ \t]*$/u
const SETEXT_H2_RE = /^ {0,3}-+[ \t]*$/u

const detectSetextDepth = (line: string): 1 | 2 | null => {
  if (SETEXT_H1_RE.test(line)) {
    return 1
  }
  if (SETEXT_H2_RE.test(line)) {
    return 2
  }
  return null
}

// 直前行が「paragraph 相当の non-blank, 非見出し」なら setext underline で見出しが成立する。
// list / blockquote 等の他 block type かどうかの厳密判定は本実装では行わず、
// 「直前行が非空白かつ ATX 見出し / フェンス open でない」ことを setext-eligible と扱う簡易判定にする。
// CommonMark の正確な block 判定までは追わないため、ごく稀な edge case (リスト直下の `---` 等) で
// 設計上ズレが残り得るが、レビュー対象 markdown でほぼ問題にならない (mdxg-virtual-pages.md §13.3)。
interface PrevLineState {
  setextEligible: boolean
  title: string
}

const PREV_NOT_ELIGIBLE: PrevLineState = { setextEligible: false, title: '' }

const advancePrev = (line: string): PrevLineState => {
  const trimmed = line.trim()
  if (trimmed.length === 0) {
    return PREV_NOT_ELIGIBLE
  }
  return { setextEligible: true, title: trimmed }
}

interface ScanState {
  fence: FenceState | null
  hits: HeadingHit[]
  prev: PrevLineState
}

const stepInsideFence = (state: ScanState, line: string): void => {
  if (state.fence !== null && detectFenceClose(line, state.fence)) {
    state.fence = null
  }
  state.prev = PREV_NOT_ELIGIBLE
}

const stepFenceOpen = (state: ScanState, fence: FenceState): void => {
  state.fence = fence
  state.prev = PREV_NOT_ELIGIBLE
}

const stepAtx = (state: ScanState, atx: AtxHit, lineIndex: number): void => {
  state.hits.push({ depth: atx.depth, lineIndex, title: atx.title })
  state.prev = PREV_NOT_ELIGIBLE
}

const stepSetext = (state: ScanState, depth: 1 | 2, lineIndex: number): void => {
  state.hits.push({ depth, lineIndex: lineIndex - 1, title: state.prev.title })
  state.prev = PREV_NOT_ELIGIBLE
}

// stepLine 全体を 1 関数に詰めると max-statements (10) を超えるため、各 token type の
// 検出 + 適用 ペアを 4 つの try-step に分けて boolean (= 当てはまったか) を返す形にし、
// stepLine 本体は順次 short-circuit する 5 行のディスパッチに留める。
const tryStepFenceContext = (state: ScanState, line: string): boolean => {
  if (state.fence === null) {
    return false
  }
  stepInsideFence(state, line)
  return true
}

const tryStepFenceOpen = (state: ScanState, line: string): boolean => {
  const fenceOpen = detectFenceOpen(line)
  if (fenceOpen === null) {
    return false
  }
  stepFenceOpen(state, fenceOpen)
  return true
}

const tryStepAtx = (state: ScanState, line: string, lineIndex: number): boolean => {
  const atx = detectAtxHeading(line)
  if (atx === null) {
    return false
  }
  stepAtx(state, atx, lineIndex)
  return true
}

const tryStepSetext = (state: ScanState, line: string, lineIndex: number): boolean => {
  if (!state.prev.setextEligible) {
    return false
  }
  const setextDepth = detectSetextDepth(line)
  if (setextDepth === null) {
    return false
  }
  stepSetext(state, setextDepth, lineIndex)
  return true
}

const stepLine = (state: ScanState, line: string, lineIndex: number): void => {
  if (tryStepFenceContext(state, line)) {
    return
  }
  if (tryStepFenceOpen(state, line)) {
    return
  }
  if (tryStepAtx(state, line, lineIndex)) {
    return
  }
  if (tryStepSetext(state, line, lineIndex)) {
    return
  }
  state.prev = advancePrev(line)
}

/**
 * markdown 全体を行単位で走査し、コードフェンス外の ATX (depth 1–6) と
 * setext (depth 1–2) の見出し位置を集める low-level scanner。
 * page-split.ts は depth ≤ 2 をフィルタしてページ境界に、
 * page-outline.ts は 3 ≤ depth ≤ 6 をフィルタして outline に利用する。
 */
export const scanHeadings = (markdown: string): HeadingHit[] => {
  const lines = markdown.split('\n')
  const state: ScanState = { fence: null, hits: [], prev: PREV_NOT_ELIGIBLE }
  for (const [index, line] of lines.entries()) {
    stepLine(state, line, index)
  }
  return state.hits
}

const isOutlineLevel = (depth: number): depth is 3 | 4 | 5 | 6 => depth >= 3 && depth <= 6

/**
 * 1 ページ分の markdown から H3–H6 見出しを抽出して、page 内で一意な slug を付与する。
 * `sourceLineOffset` は page markdown 内での 0-origin 行オフセット。
 * setext 見出しは H1/H2 のみ存在するため outline には現れない (MDXG §8.1)。
 */
export const extractPageHeadings = (pageMarkdown: string): Heading[] => {
  const used = new Set<string>()
  const headings: Heading[] = []
  const pushIfOutline = (hit: HeadingHit, headingIndex: number): void => {
    if (!isOutlineLevel(hit.depth)) {
      return
    }
    const base = slugifyOrFallback(hit.title, `heading-${headingIndex + 1}`)
    const slug = resolveUniqueSlug(base, used)
    headings.push({
      level: hit.depth,
      slug,
      sourceLineOffset: hit.lineIndex,
      text: hit.title,
    })
  }
  for (const [headingIndex, hit] of scanHeadings(pageMarkdown).entries()) {
    pushIfOutline(hit, headingIndex)
  }
  return headings
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('scanHeadings: ATX 検出', () => {
    it('# / ## / ### / #### / ##### / ###### を depth 1–6 として検出する', () => {
      const md = '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6\n'
      const hits = scanHeadings(md)
      expect(hits.map((hit): number => hit.depth)).toEqual([1, 2, 3, 4, 5, 6])
      expect(hits.map((hit): string => hit.title)).toEqual(['H1', 'H2', 'H3', 'H4', 'H5', 'H6'])
    })

    it('lineIndex は 0-origin で振られる', () => {
      const md = 'intro\n\n# H1\n\n## H2\n'
      const hits = scanHeadings(md)
      expect(hits.map((hit): number => hit.lineIndex)).toEqual([2, 4])
    })

    it('# Title # の末尾 # は除去される', () => {
      const md = '## Title ##\n'
      expect(scanHeadings(md)[0].title).toBe('Title')
    })

    it('#hello のような無空白続きは見出しとして扱わない', () => {
      const md = '#hello\n## Real\n'
      const hits = scanHeadings(md)
      expect(hits).toHaveLength(1)
      expect(hits[0].title).toBe('Real')
    })

    it('インデントが 4 以上の `# x` は見出しではない (コードブロック扱い)', () => {
      const md = '    # not a heading\n# real\n'
      const hits = scanHeadings(md)
      expect(hits).toHaveLength(1)
      expect(hits[0].title).toBe('real')
    })
  })

  describe('scanHeadings: setext 検出', () => {
    it('=== は depth 1, --- は depth 2 として直前行を title にする', () => {
      const md = 'Title One\n========\n\nTitle Two\n--------\n'
      const hits = scanHeadings(md)
      expect(hits).toEqual([
        { depth: 1, lineIndex: 0, title: 'Title One' },
        { depth: 2, lineIndex: 3, title: 'Title Two' },
      ])
    })

    it('直前行が空行なら setext underline ではなく無視 (thematic break として扱われ marker 出さない)', () => {
      const md = '\n---\n'
      expect(scanHeadings(md)).toEqual([])
    })

    it('直前行が ATX 見出しなら setext eligibility は無し (連続 underline 無し)', () => {
      const md = '# H1\n===\n'
      const hits = scanHeadings(md)
      expect(hits).toEqual([{ depth: 1, lineIndex: 0, title: 'H1' }])
    })
  })

  describe('scanHeadings: フェンス追跡', () => {
    it('``` フェンス内の # は見出しとして拾わない', () => {
      const md = '```\n# inside\n```\n# outside\n'
      const hits = scanHeadings(md)
      expect(hits).toEqual([{ depth: 1, lineIndex: 3, title: 'outside' }])
    })

    it('~~~ フェンス内の ## も見出しとして拾わない', () => {
      const md = '~~~py\n## inside\n~~~\n## outside\n'
      const hits = scanHeadings(md)
      expect(hits).toEqual([{ depth: 2, lineIndex: 3, title: 'outside' }])
    })

    it('フェンスが close されないまま EOF でもエラーにならない', () => {
      const md = '```\n# inside\n# still inside\n'
      expect(scanHeadings(md)).toEqual([])
    })

    it('4+ バッククォートのフェンスは 4+ バッククォートで close する (3 つでは閉じない)', () => {
      const md = '````\n```\n# still inside\n````\n# outside\n'
      const hits = scanHeadings(md)
      expect(hits).toEqual([{ depth: 1, lineIndex: 4, title: 'outside' }])
    })

    it('backtick info string に ` が混じる行はフェンス open として扱わない (CommonMark §4.5)', () => {
      const md = '```foo`bar\n# this stays a heading\n```\n'
      const hits = scanHeadings(md)
      expect(hits[0].title).toBe('this stays a heading')
    })
  })

  describe('extractPageHeadings', () => {
    it('H3–H6 のみ抽出する (H1 / H2 はページ境界として skip)', () => {
      const md = '# H1\n\n## H2\n\n### H3\n\n#### H4\n'
      const headings = extractPageHeadings(md)
      expect(headings.map((heading): number => heading.level)).toEqual([3, 4])
      expect(headings.map((heading): string => heading.text)).toEqual(['H3', 'H4'])
    })

    it('sourceLineOffset は page markdown 内の 0-origin 行オフセット', () => {
      const md = '## Page\n\n### Section A\n\n### Section B\n'
      const headings = extractPageHeadings(md)
      expect(headings.map((heading): number => heading.sourceLineOffset)).toEqual([2, 4])
    })

    it('同じテキストの H3 が複数あっても slug が -2, -3 で一意化される', () => {
      const md = '### Notes\n\n### Notes\n\n### Notes\n'
      const headings = extractPageHeadings(md)
      expect(headings.map((heading): string => heading.slug)).toEqual([
        'notes',
        'notes-2',
        'notes-3',
      ])
    })

    it('非 ASCII のみのタイトルは heading-<n> fallback になる', () => {
      const md = '### 概要\n\n### Details\n\n### 結論\n'
      const headings = extractPageHeadings(md)
      expect(headings.map((heading): string => heading.slug)).toEqual([
        'heading-1',
        'details',
        'heading-3',
      ])
    })

    it('コードフェンス内の ### は見出しとして拾わない', () => {
      const md = '```md\n### inside\n```\n\n### outside\n'
      const headings = extractPageHeadings(md)
      expect(headings).toHaveLength(1)
      expect(headings[0].text).toBe('outside')
    })

    it('H3–H6 が無いページは空配列を返す (MDXG §8 [MAY] outline 非表示の根拠)', () => {
      expect(extractPageHeadings('Just a paragraph.\n')).toEqual([])
      expect(extractPageHeadings('# H1 only\n')).toEqual([])
    })
  })
}
