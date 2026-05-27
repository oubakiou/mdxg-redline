// MDXG §16 Footnotes 対応の pure module。
//
// marked-footnote 1.4.0 は **未参照定義 (orphan) を完全に隠蔽**する挙動を持つことが
// Step 1 PoC で確定している (docs/mdxg-footnotes.md §3.1 / §5.j / Step 2)。MDXG §16
// [MUST NOT] 「ストリップ / 隠蔽してはならない」と整合させるため、本モジュールが
// markdown を lexer で走査して orphan を検出し、parse 後の DOM に手動 append する
// post-processing 経路を提供する。
//
// instance 分離 (重要):
//   Step 1 PoC で「同一 Marked instance で lexer() 呼び出し後に parse() を呼ぶと
//   `Cannot read properties of undefined (reading 'filter')` で crash する」現象を確認済み。
//   本モジュールでは用途ごとに `new Marked()` を生成して cross-call state を持ち越さない。
//   global `marked` singleton にも footnote 拡張は use しない (block-anchors 等が共有しており
//   top-level token に synthetic placeholder が混入して壊れるため。core/markdown.ts 参照)。

import { Marked } from 'marked'
import footnote from 'marked-footnote'

/* eslint-disable sort-imports */
import { escapeHtml } from './escape'
/* eslint-enable sort-imports */

const createMarkedWithFootnote = (): Marked => {
  const instance = new Marked()
  instance.use(footnote())
  return instance
}

interface FootnoteToken {
  label: string
  raw: string
  refs: readonly unknown[]
  type: 'footnote'
}

const isFootnoteToken = (value: unknown): value is FootnoteToken => {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as { label?: unknown; raw?: unknown; refs?: unknown; type?: unknown }
  return (
    candidate.type === 'footnote' &&
    typeof candidate.label === 'string' &&
    typeof candidate.raw === 'string' &&
    Array.isArray(candidate.refs)
  )
}

const collectFootnoteTokens = (markdown: string): readonly FootnoteToken[] => {
  const tokens: unknown[] = createMarkedWithFootnote().lexer(markdown)
  // 重複定義 `[^d]: a` `[^d]: b` は lexer 段階では別 token として 2 つ残るが、
  // marked-footnote 1.4.0 は render 段階で先勝ち (first wins) を適用する
  // (Step 1 PoC `.temp/footnote-poc.mjs` Case 6 で確認)。本モジュールの戻り値が
  // render 後の DOM と一貫するよう、label で dedupe して最初の出現だけを残す。
  const seenLabels = new Set<string>()
  const collected: FootnoteToken[] = []
  for (const token of tokens) {
    if (isFootnoteToken(token) && !seenLabels.has(token.label)) {
      seenLabels.add(token.label)
      collected.push(token)
    }
  }
  return collected
}

/** markdown 内に出現する脚注定義の数。`Page[]` 末尾に synthetic page を追加するかの判定に使う。 */
export const countFootnoteDefinitions = (markdown: string): number =>
  collectFootnoteTokens(markdown).length

/** 脚注定義のラベル集合を出現順で返す。 */
export const extractFootnoteIds = (markdown: string): readonly string[] =>
  collectFootnoteTokens(markdown).map((token): string => token.label)

/**
 * 本文で参照されていない (refs.length === 0) 脚注定義のラベル集合。
 * marked-footnote 1.4.0 はこの種の定義を出力 HTML から完全に省くため、
 * 本実装で `renderOrphanFootnoteItems` を経由して復活描画する。
 */
export const getOrphanFootnoteIds = (markdown: string): readonly string[] =>
  collectFootnoteTokens(markdown)
    .filter((token): boolean => token.refs.length === 0)
    .map((token): string => token.label)

const FOOTNOTE_SECTION_SELECTOR = 'section[data-footnotes]'

/**
 * `marked.parse` 出力を流し込んだ DocumentFragment から `<section[data-footnotes]>` を切り出す。
 * 該当 section が存在しない (orphan のみ、参照ゼロ等で marked-footnote が section を出さない)
 * 場合は null を返す。呼び出し側は `renderOrphanFootnoteItems` 経由で synthetic な骨格を
 * 作る経路に乗せること。
 */
export const extractFootnoteSection = (fragment: DocumentFragment): HTMLElement | null => {
  const section = fragment.querySelector<HTMLElement>(FOOTNOTE_SECTION_SELECTOR)
  if (section === null) {
    return null
  }
  section.remove()
  return section
}

const stripFootnoteMarker = (raw: string, label: string): string => {
  const marker = `[^${label}]:`
  const idx = raw.indexOf(marker)
  if (idx === -1) {
    return raw.trim()
  }
  return raw.slice(idx + marker.length).trim()
}

// orphan の本文を inline markdown としてレンダリングする。Step 2 PoC
// (.temp/footnote-poc-step2.mjs) で fresh Marked instance の `parseInline` が
// crash しないことを確認済み。
const renderInlineMarkdown = (markdown: string): string => {
  const result = createMarkedWithFootnote().parseInline(markdown)
  if (typeof result === 'string') {
    return result
  }
  return ''
}

const createSyntheticFootnotesSection = (doc: Document): HTMLElement => {
  const section = doc.createElement('section')
  section.className = 'footnotes'
  section.setAttribute('data-footnotes', '')
  const heading = doc.createElement('h2')
  heading.id = 'footnote-label'
  heading.className = 'sr-only'
  heading.textContent = 'Footnotes'
  section.appendChild(heading)
  section.appendChild(doc.createElement('ol'))
  return section
}

const buildOrphanItem = (doc: Document, label: string, raw: string): HTMLLIElement => {
  const bodyHtml = renderInlineMarkdown(stripFootnoteMarker(raw, label))
  const li = doc.createElement('li')
  li.id = `footnote-${label}`
  li.setAttribute('data-footnote-orphan', '1')
  const para = doc.createElement('p')
  const safeLabel = escapeHtml(label)
  // backref は orphan に対応する `<a id="footnote-ref-<label>">` が DOM 上に存在しないため
  // クリックしても no-op になる (handleFootnoteHashClick の getElementById null チェックで吸収)。
  // 視覚的に他定義と同じ形を保つ目的で href 自体は残す。
  para.innerHTML = `${bodyHtml} <a href="#footnote-ref-${safeLabel}" data-footnote-backref aria-label="Back to reference ${safeLabel}">↩</a>`
  li.appendChild(para)
  return li
}

const ensureOrphanOl = (section: HTMLElement, doc: Document): HTMLOListElement => {
  const existing = section.querySelector<HTMLOListElement>(':scope > ol')
  if (existing !== null) {
    return existing
  }
  const ol = doc.createElement('ol')
  section.appendChild(ol)
  return ol
}

/**
 * marked-footnote 1.4.0 が隠蔽する未参照定義を `<li data-footnote-orphan="1">` として
 * 復活描画する。`section` が null の場合 (orphan のみで参照ゼロ → marked-footnote が
 * `<section[data-footnotes]>` 自体を出さない) は synthetic な骨格を組み立てて返す。
 *
 * orphan が 0 個なら `section` をそのまま (null も含めて) 返し副作用ゼロ。
 */
export const renderOrphanFootnoteItems = (
  markdown: string,
  section: HTMLElement | null,
  doc: Document
): HTMLElement | null => {
  const orphans = collectFootnoteTokens(markdown).filter(
    (token): boolean => token.refs.length === 0
  )
  if (orphans.length === 0) {
    return section
  }
  const targetSection = section ?? createSyntheticFootnotesSection(doc)
  const ol = ensureOrphanOl(targetSection, doc)
  for (const token of orphans) {
    ol.appendChild(buildOrphanItem(doc, token.label, token.raw))
  }
  return targetSection
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('countFootnoteDefinitions', () => {
    it('脚注定義が無い markdown では 0', () => {
      expect(countFootnoteDefinitions('plain paragraph')).toBe(0)
    })

    it('単一定義 (参照付き) で 1', () => {
      expect(countFootnoteDefinitions('See[^1].\n\n[^1]: one\n')).toBe(1)
    })

    it('複数定義で件数分だけ返る', () => {
      expect(countFootnoteDefinitions('a[^a] b[^b].\n\n[^a]: A\n[^b]: B\n')).toBe(2)
    })

    it('orphan (未参照) 定義も件数に含まれる', () => {
      expect(countFootnoteDefinitions('plain.\n\n[^orphan]: only def.\n')).toBe(1)
    })

    it('未定義参照 (定義無し) は件数に含まれない', () => {
      expect(countFootnoteDefinitions('See [^missing] here.\n')).toBe(0)
    })

    it('重複定義は最初のみ (marked-footnote 1.4.0 標準挙動: first wins)', () => {
      expect(countFootnoteDefinitions('use[^d].\n\n[^d]: first\n[^d]: second\n')).toBe(1)
    })
  })

  describe('extractFootnoteIds', () => {
    it('ラベル集合を出現順で返す', () => {
      expect(extractFootnoteIds('a[^a] b[^b].\n\n[^a]: A\n[^b]: B\n')).toEqual(['a', 'b'])
    })

    it('名前付きラベル (`note` 等) もそのまま返る', () => {
      expect(extractFootnoteIds('See[^note].\n\n[^note]: named.\n')).toEqual(['note'])
    })

    it('脚注定義が無ければ空配列', () => {
      expect(extractFootnoteIds('plain.\n')).toEqual([])
    })
  })

  describe('getOrphanFootnoteIds', () => {
    it('参照と定義がペアで揃っているケースは orphan ゼロ', () => {
      expect(getOrphanFootnoteIds('See[^1].\n\n[^1]: one\n')).toEqual([])
    })

    it('本文で参照されていない定義を orphan として返す', () => {
      expect(getOrphanFootnoteIds('plain.\n\n[^x]: lonely\n')).toEqual(['x'])
    })

    it('混在ケースで orphan だけを抽出する', () => {
      const markdown = 'See[^used].\n\n[^used]: u\n[^orphan]: o\n'
      expect(getOrphanFootnoteIds(markdown)).toEqual(['orphan'])
    })

    it('未定義参照 (本文にだけ存在) は orphan に含めない (定義そのものが無いため)', () => {
      expect(getOrphanFootnoteIds('See [^missing] here.\n')).toEqual([])
    })
  })

  // extractFootnoteSection / renderOrphanFootnoteItems の本体は DocumentFragment / HTMLElement
  // 操作を含むため、本プロジェクト未導入の happy-dom 環境が必要となる
  // (DESIGN.md §12 拡張候補参照、`src/app/search.ts` / `src/app/page-scroll-spy.ts` と同じ規約)。
  // 別途 happy-dom 導入時にテストを足す。Step 2 では lexer 走査ベースの pure 関数を
  // カバーし、DOM 経路は手動視覚チェックリスト (docs/mdxg-footnotes.md §6) に委ねる。

  describe('Marked instance 状態汚染回避 (Step 1 PoC で確定した bug への構造的対策)', () => {
    it('countFootnoteDefinitions を連続呼び出しても crash しない', () => {
      // 同一 Marked instance を共有していると 2 回目以降の lexer 呼び出しが
      // marked-footnote 1.4.0 の state cache 経路で crash する。
      // 本モジュールは fresh instance を毎回生成することで構造的に回避している。
      expect((): void => {
        countFootnoteDefinitions('a[^1].\n\n[^1]: A\n')
        countFootnoteDefinitions('b[^2].\n\n[^2]: B\n')
        countFootnoteDefinitions('c[^3].\n\n[^3]: C\n')
      }).not.toThrow()
    })
  })
}
