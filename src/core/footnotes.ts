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
//   さらに **lexer() のみを連続呼び出ししても 2 回目以降で同じ crash が発生する**
//   (marked-footnote 1.4.0 references.ts:33 で `state.tokens.filter` が undefined 参照になる)。
//   したがって用途ごとに `new Marked()` を生成して cross-call state を持ち越さない構造が
//   安全側の必須要件である。
//   global `marked` singleton にも footnote 拡張は use しない (block-anchors 等が共有しており
//   top-level token に synthetic placeholder が混入して壊れるため。core/markdown.ts 参照)。

import { Marked } from 'marked'
import footnote from 'marked-footnote'

import { escapeHtml } from './escape'
import { renderInlineSafely } from './markdown'

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

// orphan の本文を inline markdown としてレンダリングする。
//
// 以前は fresh Marked instance の `parseInline` を呼んでいたが、本実装の Renderer override
// (raw HTML escape / link allowlist / image allowlist) を経由せず、`[^orphan]: <img src=x
// onerror=...>` のような markdown が任意 JS 実行に化ける XSS 経路になっていた
// (review feedback Critical 指摘)。`core/markdown.ts` の `renderInlineSafely` 経由で
// 同じ Renderer override を共通化し、信頼境界を 1 箇所に集中させる (DESIGN.md §11)。
const renderInlineMarkdown = (markdown: string): string => renderInlineSafely(markdown)

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

const buildBackrefHtml = (label: string): string => {
  const safeLabel = escapeHtml(label)
  // backref は orphan に対応する `<a id="footnote-ref-<label>">` が DOM 上に存在しないため
  // クリックしても no-op になる (handleFootnoteHashClick の getElementById null チェックで吸収)。
  // 視覚的に他定義と同じ形を保つ目的で href 自体は残す。
  return `<a href="#footnote-ref-${safeLabel}" data-footnote-backref aria-label="Back to reference ${safeLabel}">↩</a>`
}

/**
 * orphan `<li>` の innerHTML を組み立てる pure helper。`bodyHtml` の形状によって 2 経路に
 * 分岐する (review feedback Medium 指摘への対応):
 *
 * - **inline-only** (`<p>` 開きタグを含まない、`renderInlineSafely` が outer `<p>` を剥がした単一
 *   段落): `<p>{body} {backref}</p>` で包む
 * - **block-level** (`<p>...</p>` を 1 つ以上含む複数段落): bodyHtml をそのまま採用し、最後の
 *   `</p>` の直前に backref を埋め込む (marked-footnote の通常出力と同じ「最後の段落末尾に
 *   backref」形状に揃える)
 *
 * 単純に `<p>{body} {backref}</p>` で常に包むと、複数段落 body のときに `<p><p>...</p>...</p>`
 * の入れ子が発生し、HTML5 パーサの p-element auto-close で `<p></p><p>...</p>...` に
 * 平坦化されて DOM 構造が壊れる (review feedback で指摘された回帰)。
 */
const composeOrphanItemInnerHtml = (bodyHtml: string, label: string): string => {
  const backref = buildBackrefHtml(label)
  if (!bodyHtml.includes('<p>')) {
    return `<p>${bodyHtml} ${backref}</p>`
  }
  const lastClosingP = bodyHtml.lastIndexOf('</p>')
  if (lastClosingP === -1) {
    // `<p>` 開きはあるが `</p>` 閉じが無い予期しない形。renderInlineSafely の挙動上は
    // 起き得ないが、防御的に backref を末尾追加するフォールバック経路を用意する。
    return `${bodyHtml} ${backref}`
  }
  return `${bodyHtml.slice(0, lastClosingP)} ${backref}${bodyHtml.slice(lastClosingP)}`
}

const buildOrphanItem = (doc: Document, label: string, raw: string): HTMLLIElement => {
  const bodyHtml = renderInlineMarkdown(stripFootnoteMarker(raw, label))
  const li = doc.createElement('li')
  li.id = `footnote-${label}`
  li.setAttribute('data-footnote-orphan', '1')
  li.innerHTML = composeOrphanItemInnerHtml(bodyHtml, label)
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

const buildFragmentWithSection = (innerHtml: string): DocumentFragment => {
  const fragment = document.createDocumentFragment()
  const host = document.createElement('div')
  host.innerHTML = innerHtml
  while (host.firstChild) {
    fragment.appendChild(host.firstChild)
  }
  return fragment
}

const expectElement = <Element_ extends Element>(value: Element_ | null): Element_ => {
  if (value === null) {
    throw new Error('expected non-null element')
  }
  return value
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

  // review feedback Medium 指摘: `renderInlineSafely` が複数段落 markdown に対して
  // block-level HTML を返したとき、buildOrphanItem が常に `<p>` で包む実装だと
  // `<p><p>...</p>...</p>` の入れ子が p-element auto-close で `<p></p><p>...</p>...` に
  // 平坦化されて DOM 構造が壊れる。`composeOrphanItemInnerHtml` の分岐ロジックで
  // marked-footnote の通常出力 (最後の段落末尾に backref) と同じ形状に揃える契約をテストで pin する。
  describe('composeOrphanItemInnerHtml (orphan li innerHTML 組み立て)', () => {
    it('単一段落 (inline-only) bodyHtml は <p>{body} {backref}</p> で包む', () => {
      const html = composeOrphanItemInnerHtml('hello world', '1')
      expect(html).toBe(
        '<p>hello world <a href="#footnote-ref-1" data-footnote-backref aria-label="Back to reference 1">↩</a></p>'
      )
    })

    it('inline 装飾 (<strong> 等) を含む単一段落も <p> 内に保持される', () => {
      const html = composeOrphanItemInnerHtml('see <strong>bold</strong>', 'x')
      expect(html).toContain('<p>see <strong>bold</strong> ')
      expect(html).toContain('data-footnote-backref')
      expect(html).toMatch(/<\/p>$/u)
    })

    it('複数段落 bodyHtml は外側を包まず、最後の <p> 内末尾に backref を埋め込む', () => {
      const body = '<p>para a</p>\n<p>para b</p>\n'
      const html = composeOrphanItemInnerHtml(body, 'x')
      // 最初の <p> はそのまま、最後の <p> の `</p>` 直前に backref が入る
      expect(html).toBe(
        '<p>para a</p>\n<p>para b <a href="#footnote-ref-x" data-footnote-backref aria-label="Back to reference x">↩</a></p>\n'
      )
      // 入れ子 (<p><p>) を作っていないこと
      expect(html).not.toMatch(/<p>\s*<p>/u)
    })

    it('label は HTML escape される (属性インジェクション防止)', () => {
      const html = composeOrphanItemInnerHtml('body', 'x"y<z')
      expect(html).toContain('href="#footnote-ref-x&quot;y&lt;z"')
      expect(html).toContain('aria-label="Back to reference x&quot;y&lt;z"')
      // 生の `<` `>` `"` が属性値内に漏れていない
      expect(html).not.toContain('href="#footnote-ref-x"y<z"')
    })

    it('3 段落以上でも最後の </p> 直前にだけ backref が入る', () => {
      const body = '<p>a</p>\n<p>b</p>\n<p>c</p>\n'
      const html = composeOrphanItemInnerHtml(body, '1')
      const backrefMatches = html.match(/data-footnote-backref/gu) ?? []
      expect(backrefMatches.length).toBe(1)
      // 最後の段落 c の </p> 直前に入っている
      expect(html).toContain('<p>c <a href="#footnote-ref-1"')
    })

    it('予期しない `<p>` 開きあり / `</p>` 閉じ無しのケースは末尾に backref をフォールバック', () => {
      // 本来 renderInlineSafely 経路ではあり得ない形 (防御的 fallback の挙動を pin)
      const html = composeOrphanItemInnerHtml('<p>broken without close', '1')
      expect(html).toBe(
        '<p>broken without close <a href="#footnote-ref-1" data-footnote-backref aria-label="Back to reference 1">↩</a>'
      )
    })
  })

  describe('extractFootnoteSection (DOM)', () => {
    it('<section data-footnotes> を fragment から切り出して返す', () => {
      const fragment = buildFragmentWithSection(
        '<p>body</p><section data-footnotes><ol><li>x</li></ol></section>'
      )
      const section = expectElement(extractFootnoteSection(fragment))
      expect(section.hasAttribute('data-footnotes')).toBe(true)
      // 副作用: fragment から remove されている
      expect(fragment.querySelector('section[data-footnotes]')).toBeNull()
      // 他のノードは残っている
      expect(fragment.querySelector('p')).not.toBeNull()
    })

    it('該当 section が無ければ null を返し、fragment も変化しない', () => {
      const fragment = buildFragmentWithSection('<p>only body</p>')
      expect(extractFootnoteSection(fragment)).toBeNull()
      expect(fragment.querySelector('p')).not.toBeNull()
    })
  })

  describe('renderOrphanFootnoteItems (DOM)', () => {
    it('orphan ゼロなら section をそのまま返す (副作用なし)', () => {
      const fragment = buildFragmentWithSection(
        '<section data-footnotes><ol><li>existing</li></ol></section>'
      )
      const section = expectElement(extractFootnoteSection(fragment))
      const before = section.innerHTML
      const result = renderOrphanFootnoteItems(
        'plain.\n\n[^used]: u\n\nuse[^used].\n',
        section,
        document
      )
      expect(result).toBe(section)
      expect(section.innerHTML).toBe(before)
    })

    it('既存 <section> 配下の <ol> に orphan li を append する', () => {
      const fragment = buildFragmentWithSection(
        '<section data-footnotes><ol><li id="footnote-used">u</li></ol></section>'
      )
      const section = expectElement(extractFootnoteSection(fragment))
      const result = expectElement(
        renderOrphanFootnoteItems(
          'use[^used].\n\n[^used]: u\n[^orphan]: lonely\n',
          section,
          document
        )
      )
      expect(result).toBe(section)
      const items = [...result.querySelectorAll('ol > li')]
      expect(items.map((li): string => li.id)).toEqual(['footnote-used', 'footnote-orphan'])
      const orphan = expectElement(items.find((li): boolean => li.id === 'footnote-orphan') ?? null)
      expect(orphan.getAttribute('data-footnote-orphan')).toBe('1')
    })

    it('section に <ol> が無ければ ensureOrphanOl が <ol> を合成する', () => {
      const fragment = buildFragmentWithSection(
        '<section data-footnotes><h2 class="sr-only">Footnotes</h2></section>'
      )
      const section = expectElement(extractFootnoteSection(fragment))
      const result = expectElement(
        renderOrphanFootnoteItems('plain.\n\n[^a]: A\n', section, document)
      )
      expect(result).toBe(section)
      const ol = expectElement(result.querySelector(':scope > ol'))
      const items = [...ol.querySelectorAll('li')]
      expect(items.map((li): string => li.id)).toEqual(['footnote-a'])
    })

    it('section が null なら createSyntheticFootnotesSection で骨格を組み立てる', () => {
      const result = expectElement(
        renderOrphanFootnoteItems('plain.\n\n[^lonely]: x\n', null, document)
      )
      expect(result.tagName).toBe('SECTION')
      expect(result.hasAttribute('data-footnotes')).toBe(true)
      // sr-only な合成見出しが先頭に挿入されている (textSegments の SKIP_RULES `.sr-only` 連動)
      const heading = expectElement(result.querySelector('h2'))
      expect(heading.id).toBe('footnote-label')
      expect(heading.classList.contains('sr-only')).toBe(true)
      // orphan li が <ol> 直下に並ぶ
      const items = [...result.querySelectorAll('ol > li')]
      expect(items.map((li): string => li.id)).toEqual(['footnote-lonely'])
    })

    it('backref <a> の href / aria-label が composeOrphanItemInnerHtml と一致する', () => {
      const result = expectElement(
        renderOrphanFootnoteItems('plain.\n\n[^note]: body\n', null, document)
      )
      const backref = expectElement(result.querySelector('a[data-footnote-backref]'))
      expect(backref.getAttribute('href')).toBe('#footnote-ref-note')
      expect(backref.getAttribute('aria-label')).toBe('Back to reference note')
    })

    it('orphan 定義複数件は markdown 出現順で並ぶ', () => {
      const result = expectElement(
        renderOrphanFootnoteItems('plain.\n\n[^z]: zeta\n[^a]: alpha\n[^m]: mu\n', null, document)
      )
      const items = [...result.querySelectorAll('ol > li')]
      expect(items.map((li): string => li.id)).toEqual(['footnote-z', 'footnote-a', 'footnote-m'])
    })

    it('既存 section の li 順序を保ったまま orphan を末尾に追加する (merge で並び順崩れず重複もしない)', () => {
      const fragment = buildFragmentWithSection(
        '<section data-footnotes><ol>' +
          '<li id="footnote-first">first</li>' +
          '<li id="footnote-second">second</li>' +
          '</ol></section>'
      )
      const section = expectElement(extractFootnoteSection(fragment))
      const result = expectElement(
        renderOrphanFootnoteItems(
          'use[^first] then[^second].\n\n[^first]: f\n[^second]: s\n[^orphan]: o\n',
          section,
          document
        )
      )
      const items = [...result.querySelectorAll('ol > li')]
      expect(items.map((li): string => li.id)).toEqual([
        'footnote-first',
        'footnote-second',
        'footnote-orphan',
      ])
      // 既存 li が二重に出ていない (orphan のみが追加)
      const orphanFlags = items.filter((li): boolean => li.hasAttribute('data-footnote-orphan'))
      expect(orphanFlags.map((li): string => li.id)).toEqual(['footnote-orphan'])
    })
  })
}
