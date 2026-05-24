// review.html の <script id="embedded-md"> に markdown を埋め込むための pure logic。
// Node CLI からも、将来のブラウザ側 UI からも使えるよう、I/O や Node 専用 API は持たない。
// `crypto.subtle` は Node 20+ / モダンブラウザ双方で globalThis.crypto として利用可能。

import { escapeHtml } from './escape'

/**
 * markdown 本文の SHA-256 を計算し、先頭 8 バイトを 16 文字の hex 文字列で返す。
 * docHash としてファイル命名規約 (`<mdFileName>-<docHash>-...`) や
 * Workspace の差分検知に使う。CLI とブラウザの双方からこの関数を直接呼ぶことで、
 * docHash の計算結果がプロセスを跨いで一致することを保証する。
 */
export const computeDocHash = async (markdown: string): Promise<string> => {
  const buf = new TextEncoder().encode(markdown)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(hash)]
    .slice(0, 8)
    .map((byte): string => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * MD ファイル名から `.md` / `.markdown` 拡張子を除いた basename を返す。
 * 大文字小文字無視。拡張子が無いファイル名はそのまま返す。
 * ファイル命名規約 §8 の `mdFileName` 部分を組み立てるベース。
 */
export const stripMarkdownExt = (filename: string): string =>
  filename.replace(/\.(?:markdown|md)$/i, '')

/** ファイル命名規約 §8 に従って配布用 HTML のファイル名を組み立てる */
export const deriveReviewHtmlName = (mdFileName: string, docHash: string): string =>
  `${mdFileName}-${docHash}-review.html`

/** ファイル命名規約 §8 に従ってエージェント→人間方向の MD ファイル名を組み立てる */
export const deriveReviewMdName = (mdFileName: string, docHash: string): string =>
  `${mdFileName}-${docHash}-review.md`

/** ファイル命名規約 §8 に従って人間→エージェント方向の JSON ファイル名を組み立てる */
export const deriveFeedbackJsonName = (mdFileName: string, docHash: string): string =>
  `${mdFileName}-${docHash}-feedback.json`

/** `<mdFileName>-<16桁hex>-review.md` 形式のファイル名を識別する正規表現 */
export const REVIEW_MD_PATTERN = /^(.+)-([0-9a-f]{16})-review\.md$/i

export interface ReviewMdFilenameParts {
  docHash: string
  mdFileName: string
}

/**
 * Watch folder 内のファイル名から `mdFileName` と `docHash` を抽出する。
 * パターンに合致しないファイル名は null（呼び出し側で skip）。
 * hash は照合のしやすさのため小文字に正規化する（命名規約は本来小文字を想定）。
 */
export const parseReviewMdFilename = (filename: string): ReviewMdFilenameParts | null => {
  const match = REVIEW_MD_PATTERN.exec(filename)
  if (!match) {
    return null
  }
  return { docHash: match[2].toLowerCase(), mdFileName: match[1] }
}

// `<script>` タグの中身に JSON を埋め込む共通ロジック。`<` を JSON の Unicode escape
// `<` に置換することで、HTML パーサが `</script>` を閉じタグとして誤検出する余地を
// ゼロにする。復元側は `JSON.parse` のみで Unicode escape も含めて元の値に戻る。
// embedded-md / embedded-shiki-langs / embedded-feedback など複数の埋め込み経路で共有する。
const escapeJsonForScriptTag = (jsonString: string): string =>
  jsonString.replace(/</g, String.raw`\u003C`)

/**
 * markdown 本文を `<script id="embedded-md">` に埋め込み可能な JSON 文字列にエンコードする。
 * 復元は `JSON.parse` のみで完結する。
 */
export const encodeEmbeddedMarkdown = (markdown: string): string =>
  escapeJsonForScriptTag(JSON.stringify(markdown))

/**
 * Shiki grammar の集合を `<script id="embedded-shiki-langs">` に埋め込み可能な JSON 文字列に
 * エンコードする。grammars は `{ <canonical>: LanguageRegistration[] }` 形式の plain object で、
 * 復元側 (browser) は `JSON.parse` した後 createHighlighterCoreSync の `langs` に値を渡す。
 */
export const encodeEmbeddedShikiLangs = (grammars: Record<string, unknown>): string =>
  escapeJsonForScriptTag(JSON.stringify(grammars))

// 属性順や空白の揺らぎを許容するため、id="embedded-md" と type="text/markdown" の両方を
// 含む <script ...> の開きタグ全体、コンテンツ、閉じタグの 3 グループに分けて捕まえる。
// 両属性を lookahead で要求することで、HTML コメント等の説明テキスト内に出現する
// `<script id="embedded-md">` のような literal にマッチしてしまうのを防ぐ。
const EMBEDDED_MD_RE =
  /(<script\b(?=[^>]*\bid="embedded-md")(?=[^>]*\btype="text\/markdown")[^>]*>)([\s\S]*?)(<\/script>)/i

const STATUS_SPAN_RE = /(<span\b(?=[^>]*\bid="status")[^>]*>)([\s\S]*?)(<\/span>)/i

const HEAD_OPEN_RE = /<head\b[^>]*>/i
const EMBEDDED_MD_META_RE = /\s*<meta\b[^>]*\bname="mdxg-redline:embedded-md"[^>]*\/?>/i

/**
 * 「ロード済み」状態のステータステキストを組み立てる。CLI 経由配布物の paint 前確定と、
 * JS 起動後の loadFromMarkdown 完了表示で同じ文字列を使うことで初期描画と JS 描画が一致する。
 */
export const formatLoadedStatus = (docName: string, docHash: string): string =>
  `${docName} (${docHash}) · loaded`

/**
 * `<span id="status">` の中身を CLI が書き換える。paint 前から最終状態を見せることで、
 * JS の loadFromMarkdown が走るまで「No file」が一瞬見える FOUC を構造的に防ぐ。
 */
export const rewriteInitialStatus = (reviewHtml: string, statusText: string): string => {
  const match = STATUS_SPAN_RE.exec(reviewHtml)
  if (!match) {
    throw new Error('review.html に id="status" の <span> タグが見つかりません')
  }
  const [fullMatch, openingTag, , closingTag] = match
  const replaced = `${openingTag}${escapeHtml(statusText)}${closingTag}`
  return (
    reviewHtml.slice(0, match.index) + replaced + reviewHtml.slice(match.index + fullMatch.length)
  )
}

/**
 * paint 前介入用の <meta> を <head> 直下に挿入する (既存があれば置換、idempotent)。
 * <head> 内 inline script がこの meta を検出して `<html>.has-embedded-md` を付ける仕組みで、
 * body 内の `<script id="embedded-md">` 直後で判定する方式より早期に介入できる。
 */
export const upsertEmbeddedMdMeta = (reviewHtml: string): string => {
  const cleaned = reviewHtml.replace(EMBEDDED_MD_META_RE, '')
  const headMatch = HEAD_OPEN_RE.exec(cleaned)
  if (!headMatch) {
    throw new Error('review.html に <head> タグが見つかりません')
  }
  const insertPos = headMatch.index + headMatch[0].length
  const meta = '\n    <meta name="mdxg-redline:embedded-md" content="1" />'
  return cleaned.slice(0, insertPos) + meta + cleaned.slice(insertPos)
}

// embedded-md と同じパターン。id="embedded-shiki-langs" + type="application/json" の両属性を
// lookahead で要求し、説明文中の literal `<script id="embedded-shiki-langs">` に誤マッチしないようにする。
const EMBEDDED_SHIKI_LANGS_RE =
  /(<script\b(?=[^>]*\bid="embedded-shiki-langs")(?=[^>]*\btype="application\/json")[^>]*>)([\s\S]*?)(<\/script>)/i

const DATA_NAME_RE = /\bdata-name="[^"]*"/
const HTML_TAG_RE = /<html\b[^>]*>/i
const DATA_THEME_RE = /\bdata-theme="[^"]*"/
const DATA_SIDEBAR_WIDTH_RE = /\bdata-sidebar-width="[^"]*"/

// data-name が無い既存テンプレートでも安全に補えるように、置換と挿入を関数として分離する。
// 関数化により rewriteReviewHtml 側を no-ternary / prefer-ternary 双方に抵触せず保てる。
const replaceDataName = (openingTag: string, escapedName: string): string => {
  if (DATA_NAME_RE.test(openingTag)) {
    return openingTag.replace(DATA_NAME_RE, `data-name="${escapedName}"`)
  }
  return openingTag.replace(/>$/, ` data-name="${escapedName}">`)
}

// <html> 開きタグに data-theme 属性を挿入 / 上書きする。CLI バリデーション済み値が前提だが、
// 念のため escapeHtml を通して属性 escape 経路を data-name と揃える。
const replaceDataTheme = (openingTag: string, escapedTheme: string): string => {
  if (DATA_THEME_RE.test(openingTag)) {
    return openingTag.replace(DATA_THEME_RE, `data-theme="${escapedTheme}"`)
  }
  return openingTag.replace(/>$/, ` data-theme="${escapedTheme}">`)
}

const replaceDataSidebarWidth = (openingTag: string, escapedValue: string): string => {
  if (DATA_SIDEBAR_WIDTH_RE.test(openingTag)) {
    return openingTag.replace(DATA_SIDEBAR_WIDTH_RE, `data-sidebar-width="${escapedValue}"`)
  }
  return openingTag.replace(/>$/, ` data-sidebar-width="${escapedValue}">`)
}

/**
 * `<html>` 開きタグに `data-theme="<themeHint>"` を挿入する。属性が既にあれば上書き。
 * inline script はこの属性を localStorage より低い優先度で初期値ヒントとして使う。
 * 未指定時は属性を付けないため、呼び出し側で themeHint の有無を判断してから呼ぶ
 * (CLI 既定では --theme 未指定時はこの関数を呼ばない方針)。
 */
export const upsertHtmlDataTheme = (reviewHtml: string, themeHint: string): string => {
  const match = HTML_TAG_RE.exec(reviewHtml)
  if (!match) {
    throw new Error('review.html に <html> タグが見つかりません')
  }
  const [tag] = match
  const newTag = replaceDataTheme(tag, escapeHtml(themeHint))
  return reviewHtml.slice(0, match.index) + newTag + reviewHtml.slice(match.index + tag.length)
}

/**
 * `<html>` 開きタグに `data-sidebar-width="<value>"` を挿入する。属性が既にあれば上書き。
 * inline script はこの属性を localStorage より低い優先度で初期値ヒントとして使う。
 * 値の正当性 (0 or 240–640) は CLI 側でバリデーション済み前提だが、属性 escape 経路は
 * data-theme と揃える。
 */
export const upsertHtmlDataSidebarWidth = (reviewHtml: string, value: number): string => {
  const match = HTML_TAG_RE.exec(reviewHtml)
  if (!match) {
    throw new Error('review.html に <html> タグが見つかりません')
  }
  const [tag] = match
  const newTag = replaceDataSidebarWidth(tag, escapeHtml(String(value)))
  return reviewHtml.slice(0, match.index) + newTag + reviewHtml.slice(match.index + tag.length)
}

/**
 * `<script id="embedded-shiki-langs">` の中身を grammars の JSON で書き換える。
 * - `grammars` が空オブジェクト `{}` でも JSON `{}` が書き込まれる (browser は空 langs として扱う)
 * - 該当 `<script>` タグが review.html に無ければ Error を投げる (呼び出し側が CLI エラーに変換)
 *
 * embedded-md のように属性経由の上書きはなく、コンテンツ置換のみ。
 */
export const rewriteEmbeddedShikiLangs = (
  reviewHtml: string,
  grammars: Record<string, unknown>
): string => {
  const match = EMBEDDED_SHIKI_LANGS_RE.exec(reviewHtml)
  if (!match) {
    throw new Error('review.html に id="embedded-shiki-langs" の <script> タグが見つかりません')
  }
  const [fullMatch, openingTag, , closingTag] = match
  const replaced = `${openingTag}${encodeEmbeddedShikiLangs(grammars)}${closingTag}`
  return (
    reviewHtml.slice(0, match.index) + replaced + reviewHtml.slice(match.index + fullMatch.length)
  )
}

/**
 * review.html の文字列を受け取り、`<script id="embedded-md">` の中身と data-name 属性を
 * 書き換えた新しい HTML 文字列を返す。元文字列は変更しない。
 * embedded-md タグが見つからない場合は Error を投げる（呼び出し側が CLI エラーに変換）。
 *
 * theme 属性の付与は `upsertHtmlDataTheme` を別途呼ぶ責務分担にしている。
 */
export const rewriteReviewHtml = (
  reviewHtml: string,
  markdown: string,
  docName: string
): string => {
  const match = EMBEDDED_MD_RE.exec(reviewHtml)
  if (!match) {
    throw new Error('review.html に id="embedded-md" の <script> タグが見つかりません')
  }

  const [fullMatch, openingTag, , closingTag] = match
  const newOpeningTag = replaceDataName(openingTag, escapeHtml(docName))
  const replaced = `${newOpeningTag}${encodeEmbeddedMarkdown(markdown)}${closingTag}`
  return (
    reviewHtml.slice(0, match.index) + replaced + reviewHtml.slice(match.index + fullMatch.length)
  )
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('encodeEmbeddedShikiLangs', () => {
    it('grammars object を JSON.parse で完全復元できる', () => {
      const grammars = {
        python: [{ name: 'py' }],
        typescript: [{ name: 'ts', scope: 'source.ts' }],
      }
      const encoded = encodeEmbeddedShikiLangs(grammars)
      expect(JSON.parse(encoded)).toEqual(grammars)
    })

    it('grammars に含まれる literal < は Unicode escape されて raw < が一切現れない', () => {
      const grammars = { html: [{ name: '<html>', pattern: '</script>' }] }
      const encoded = encodeEmbeddedShikiLangs(grammars)
      expect(encoded.includes('<')).toBe(false)
      expect(JSON.parse(encoded)).toEqual(grammars)
    })

    it('空オブジェクトは "{}" を返す', () => {
      expect(encodeEmbeddedShikiLangs({})).toBe('{}')
    })
  })

  describe('rewriteEmbeddedShikiLangs', () => {
    const baseHtml =
      '<html><body><script id="embedded-shiki-langs" type="application/json"></script></body></html>'

    it('grammars を script タグの中身として書き込み、JSON.parse で復元できる', () => {
      const grammars = { typescript: [{ name: 'ts' }] }
      const out = rewriteEmbeddedShikiLangs(baseHtml, grammars)
      const opening = out.indexOf('<script id="embedded-shiki-langs"')
      const tagOpenEnd = out.indexOf('>', opening) + 1
      const closing = out.indexOf('</script>', tagOpenEnd)
      const body = out.slice(tagOpenEnd, closing)
      expect(body.includes('<')).toBe(false)
      expect(JSON.parse(body)).toEqual(grammars)
    })

    it('既存コンテンツを置き換える', () => {
      const html =
        '<html><body><script id="embedded-shiki-langs" type="application/json">{"old":"yes"}</script></body></html>'
      const out = rewriteEmbeddedShikiLangs(html, { typescript: [] })
      expect(out).not.toContain('"old":"yes"')
      expect(out).toContain('"typescript"')
    })

    it('embedded-shiki-langs タグが無いと Error を投げる', () => {
      expect(() => rewriteEmbeddedShikiLangs('<html></html>', {})).toThrow(/embedded-shiki-langs/)
    })

    it('type="application/json" が無い script タグは対象外', () => {
      const html = '<script id="embedded-shiki-langs"></script>'
      expect(() => rewriteEmbeddedShikiLangs(html, {})).toThrow(/embedded-shiki-langs/)
    })

    it('元文字列を破壊しない', () => {
      const html = baseHtml
      rewriteEmbeddedShikiLangs(html, { typescript: [] })
      expect(html).toBe(baseHtml)
    })
  })

  describe('encodeEmbeddedMarkdown', () => {
    it('JSON.parse で元 markdown に戻せる (round-trip)', () => {
      const md = '# hello\nworld\n'
      expect(JSON.parse(encodeEmbeddedMarkdown(md))).toBe(md)
    })

    it('encoded には raw < が一切現れない（HTML パーサが閉じタグを検出しない）', () => {
      const encoded = encodeEmbeddedMarkdown('before </script> after <div>')
      expect(encoded.includes('<')).toBe(false)
    })

    it('</script> を含む markdown も JSON.parse で完全復元される', () => {
      const md = 'before </script> after </Script> and <div>'
      expect(JSON.parse(encodeEmbeddedMarkdown(md))).toBe(md)
    })

    it('バックスラッシュ・末尾改行・絵文字も保持される (docHash 一致のため)', () => {
      const md = `${String.raw`\n \\ 仕様書 🚀`}\n`
      expect(JSON.parse(encodeEmbeddedMarkdown(md))).toBe(md)
    })
  })

  describe('rewriteReviewHtml', () => {
    const baseHtml =
      '<html><body><script id="embedded-md" type="text/markdown" data-name="document.md"></script></body></html>'

    it('既存テンプレートに markdown と data-name を埋め込める', () => {
      const out = rewriteReviewHtml(baseHtml, '# hello', 'spec.md')
      expect(out).toContain('data-name="spec.md"')
      expect(out).toContain('>"# hello"</script>')
      expect(out).not.toContain('data-name="document.md"')
    })

    it('markdown 中の </script> は閉じタグ生成を防ぐ形で埋め込まれ、JSON.parse で復元できる', () => {
      const md = 'before </script> after'
      const out = rewriteReviewHtml(baseHtml, md, 'a.md')
      const opening = out.indexOf('<script id="embedded-md"')
      const tagOpenEnd = out.indexOf('>', opening) + 1
      const closing = out.indexOf('</script>', tagOpenEnd)
      const embeddedBody = out.slice(tagOpenEnd, closing)
      expect(embeddedBody.includes('<')).toBe(false)
      expect(JSON.parse(embeddedBody)).toBe(md)
    })

    it('data-name に含まれる " や & がエスケープされる', () => {
      const out = rewriteReviewHtml(baseHtml, 'x', 'My "report" & log.md')
      expect(out).toContain('data-name="My &quot;report&quot; &amp; log.md"')
    })

    it('属性順が異なっても (data-name が先) 書き換えられる', () => {
      const html = '<script data-name="old.md" id="embedded-md" type="text/markdown"></script>'
      const out = rewriteReviewHtml(html, 'body', 'new.md')
      expect(out).toContain('data-name="new.md"')
      expect(out).toContain('id="embedded-md"')
      expect(out).toContain('>"body"</script>')
    })

    it('data-name 属性が無い場合は補って挿入する', () => {
      const html = '<script id="embedded-md" type="text/markdown"></script>'
      const out = rewriteReviewHtml(html, 'body', 'new.md')
      expect(out).toContain('data-name="new.md"')
      expect(out).toContain('>"body"</script>')
    })

    it('既存コンテンツがあっても置き換える', () => {
      const html =
        '<script id="embedded-md" type="text/markdown" data-name="x.md">old body</script>'
      const out = rewriteReviewHtml(html, 'new body', 'y.md')
      expect(out).toContain('>"new body"</script>')
      expect(out).not.toContain('old body')
    })

    it('markdown に $ を含んでも replace の特殊置換扱いを受けない', () => {
      const out = rewriteReviewHtml(baseHtml, '$1 $& $`', 'a.md')
      expect(out).toContain('>"$1 $& $`"</script>')
    })

    it('元文字列を破壊しない', () => {
      const html = baseHtml
      rewriteReviewHtml(html, 'x', 'y.md')
      expect(html).toBe(baseHtml)
    })
  })

  describe('upsertHtmlDataSidebarWidth', () => {
    it('data-sidebar-width 属性を <html> タグに挿入する', () => {
      const html = '<html lang="ja"><body></body></html>'
      const out = upsertHtmlDataSidebarWidth(html, 320)
      expect(out).toContain('<html lang="ja" data-sidebar-width="320">')
    })

    it('0 (closed 指定) も書き込める', () => {
      const html = '<html></html>'
      const out = upsertHtmlDataSidebarWidth(html, 0)
      expect(out).toContain('data-sidebar-width="0"')
    })

    it('既存の data-sidebar-width 属性を上書きする', () => {
      const html = '<html lang="ja" data-sidebar-width="240"><body></body></html>'
      const out = upsertHtmlDataSidebarWidth(html, 480)
      expect(out).toContain('data-sidebar-width="480"')
      expect(out).not.toContain('data-sidebar-width="240"')
    })

    it('<html> タグが無いと Error を投げる', () => {
      expect(() => upsertHtmlDataSidebarWidth('<body></body>', 320)).toThrow(/<html>/)
    })

    it('元文字列を破壊しない', () => {
      const html = '<html><body></body></html>'
      upsertHtmlDataSidebarWidth(html, 360)
      expect(html).toBe('<html><body></body></html>')
    })
  })

  describe('upsertHtmlDataTheme', () => {
    it('data-theme 属性を <html> タグに挿入する', () => {
      const html = '<html lang="ja"><body></body></html>'
      const out = upsertHtmlDataTheme(html, 'dark')
      expect(out).toContain('<html lang="ja" data-theme="dark">')
    })

    it('既存の data-theme 属性を上書きする', () => {
      const html = '<html lang="ja" data-theme="light"><body></body></html>'
      const out = upsertHtmlDataTheme(html, 'dark')
      expect(out).toContain('data-theme="dark"')
      expect(out).not.toContain('data-theme="light"')
    })

    it('属性値は HTML 属性 escape を通る (data-name と同じ経路)', () => {
      // CLI バリデーション済み値が前提だが、念のため escape 動作を確認
      const html = '<html></html>'
      const out = upsertHtmlDataTheme(html, '"&<>')
      expect(out).toContain('data-theme="&quot;&amp;&lt;&gt;"')
    })

    it('<html> タグが無いと Error を投げる', () => {
      expect(() => upsertHtmlDataTheme('<body></body>', 'dark')).toThrow(/<html>/)
    })

    it('元文字列を破壊しない', () => {
      const html = '<html><body></body></html>'
      upsertHtmlDataTheme(html, 'dark')
      expect(html).toBe('<html><body></body></html>')
    })
  })

  describe('rewriteReviewHtml: match scoping', () => {
    it('embedded-md タグが無いと Error を投げる', () => {
      expect(() => rewriteReviewHtml('<html></html>', 'x', 'a.md')).toThrow(/embedded-md/)
    })

    // 既存 dist/review.html では本物の <script> の前に説明用コメント内に
    // `<script id="embedded-md">` という literal が登場する。type="text/markdown" 属性が
    // 無い偽マッチを無視できることを確かめる。
    it('HTML コメント内の literal <script id="embedded-md"> を無視する', () => {
      const html =
        '<!-- the <script id="embedded-md"> block --><script id="embedded-md" type="text/markdown" data-name="document.md"></script>'
      const out = rewriteReviewHtml(html, '# body', 'spec.md')
      expect(out).toContain('<!-- the <script id="embedded-md"> block -->')
      expect(out).toContain('data-name="spec.md"')
      expect(out).toContain('>"# body"</script>')
      expect(out).not.toContain('data-name="document.md"')
    })

    it('type="text/markdown" が無い script タグは対象外', () => {
      const html = '<script id="embedded-md"></script>'
      expect(() => rewriteReviewHtml(html, 'x', 'a.md')).toThrow(/embedded-md/)
    })
  })

  describe('computeDocHash', () => {
    it('同じ markdown は同じ hash を返す（決定性）', async () => {
      const first = await computeDocHash('# hello\n')
      const second = await computeDocHash('# hello\n')
      expect(first).toBe(second)
    })

    it('内容が 1 文字でも変われば異なる hash になる', async () => {
      const first = await computeDocHash('# hello\n')
      const second = await computeDocHash('# hellp\n')
      expect(first).not.toBe(second)
    })

    it('長さ 16 の小文字 hex 文字列を返す', async () => {
      const hash = await computeDocHash('arbitrary content')
      expect(hash).toMatch(/^[0-9a-f]{16}$/)
    })

    it('日本語・絵文字を含む UTF-8 でも安定して計算できる', async () => {
      const first = await computeDocHash('仕様書 🚀\n')
      const second = await computeDocHash('仕様書 🚀\n')
      expect(first).toBe(second)
      expect(first).toMatch(/^[0-9a-f]{16}$/)
    })
  })

  describe('stripMarkdownExt', () => {
    it('.md 拡張子を除去する', () => {
      expect(stripMarkdownExt('spec.md')).toBe('spec')
    })

    it('.markdown 拡張子を除去する', () => {
      expect(stripMarkdownExt('spec.markdown')).toBe('spec')
    })

    it('大文字拡張子 (.MD / .Markdown) も除去する', () => {
      expect(stripMarkdownExt('spec.MD')).toBe('spec')
      expect(stripMarkdownExt('Notes.Markdown')).toBe('Notes')
    })

    it('拡張子が無い場合はそのまま返す', () => {
      expect(stripMarkdownExt('README')).toBe('README')
    })

    it('複数ドットがあっても最後の md/markdown 拡張子だけ除く', () => {
      expect(stripMarkdownExt('foo.bar.md')).toBe('foo.bar')
    })

    it('日本語・スペースを含むファイル名もそのまま basename として保持する', () => {
      expect(stripMarkdownExt('仕様書 v2.md')).toBe('仕様書 v2')
    })

    it('.txt のような関係ない拡張子は除去しない', () => {
      expect(stripMarkdownExt('notes.txt')).toBe('notes.txt')
    })
  })

  describe('deriveReviewHtmlName / deriveReviewMdName / deriveFeedbackJsonName', () => {
    it('HTML / MD / JSON のファイル名を命名規約どおりに組み立てる', () => {
      expect(deriveReviewHtmlName('spec', 'a1b2c3d4e5f6a7b8')).toBe(
        'spec-a1b2c3d4e5f6a7b8-review.html'
      )
      expect(deriveReviewMdName('spec', 'a1b2c3d4e5f6a7b8')).toBe('spec-a1b2c3d4e5f6a7b8-review.md')
      expect(deriveFeedbackJsonName('spec', 'a1b2c3d4e5f6a7b8')).toBe(
        'spec-a1b2c3d4e5f6a7b8-feedback.json'
      )
    })

    it('日本語 mdFileName でもそのまま埋め込む（サニタイズしない）', () => {
      expect(deriveReviewHtmlName('仕様書 v2', 'a1b2c3d4e5f6a7b8')).toBe(
        '仕様書 v2-a1b2c3d4e5f6a7b8-review.html'
      )
    })
  })

  describe('parseReviewMdFilename', () => {
    it('規約に従ったファイル名から mdFileName と docHash を抽出する', () => {
      expect(parseReviewMdFilename('spec-a1b2c3d4e5f6a7b8-review.md')).toEqual({
        docHash: 'a1b2c3d4e5f6a7b8',
        mdFileName: 'spec',
      })
    })

    it('大文字 hex も小文字に正規化して返す', () => {
      expect(parseReviewMdFilename('spec-A1B2C3D4E5F6A7B8-review.md')).toEqual({
        docHash: 'a1b2c3d4e5f6a7b8',
        mdFileName: 'spec',
      })
    })

    it('mdFileName にハイフンが含まれていても正しく分解できる', () => {
      // mdFileName 部分は greedy で最後の -<16桁hex>-review.md の手前まで取る
      expect(parseReviewMdFilename('part-1-pre-release-a1b2c3d4e5f6a7b8-review.md')).toEqual({
        docHash: 'a1b2c3d4e5f6a7b8',
        mdFileName: 'part-1-pre-release',
      })
    })

    it('hash が 16 桁でない場合は null', () => {
      expect(parseReviewMdFilename('spec-abc-review.md')).toBeNull()
    })

    it('-review.md で終わらない場合は null', () => {
      expect(parseReviewMdFilename('spec-a1b2c3d4e5f6a7b8-feedback.json')).toBeNull()
      expect(parseReviewMdFilename('spec.md')).toBeNull()
    })

    it('hash 部分に非 hex 文字を含む場合は null', () => {
      expect(parseReviewMdFilename('spec-zzzzzzzzzzzzzzzz-review.md')).toBeNull()
    })
  })

  describe('formatLoadedStatus', () => {
    it('docName (docHash) · loaded の形式で組み立てる', () => {
      expect(formatLoadedStatus('spec.md', 'a1b2c3d4e5f6a7b8')).toBe(
        'spec.md (a1b2c3d4e5f6a7b8) · loaded'
      )
    })

    it('日本語 docName でもそのまま埋め込む (サニタイズなし)', () => {
      expect(formatLoadedStatus('仕様書 v2.md', 'a1b2c3d4e5f6a7b8')).toBe(
        '仕様書 v2.md (a1b2c3d4e5f6a7b8) · loaded'
      )
    })
  })

  describe('rewriteInitialStatus', () => {
    const baseHtml = '<header><span id="status" class="label">No file</span></header>'

    it('既存テキストを最終状態の文字列に書き換える', () => {
      const out = rewriteInitialStatus(baseHtml, 'spec.md (a1b2c3d4e5f6a7b8) · loaded')
      expect(out).toContain('>spec.md (a1b2c3d4e5f6a7b8) · loaded</span>')
      expect(out).not.toContain('>No file<')
    })

    it('属性順が異なっても書き換える', () => {
      const html = '<span class="label" id="status">old</span>'
      const out = rewriteInitialStatus(html, 'new')
      expect(out).toContain('>new</span>')
    })

    it('& や < などを HTML エスケープする', () => {
      const out = rewriteInitialStatus(baseHtml, 'a & b < c.md')
      expect(out).toContain('a &amp; b &lt; c.md')
    })

    it('id="status" の <span> タグが無いと Error を投げる', () => {
      expect(() => rewriteInitialStatus('<html></html>', 'x')).toThrow(/id="status"/)
    })

    it('元文字列を破壊しない', () => {
      const html = baseHtml
      rewriteInitialStatus(html, 'x')
      expect(html).toBe(baseHtml)
    })
  })

  describe('upsertEmbeddedMdMeta', () => {
    it('<head> 直下に meta タグを挿入する', () => {
      const html = '<html><head><meta charset="UTF-8" /></head><body></body></html>'
      const out = upsertEmbeddedMdMeta(html)
      expect(out).toContain('<meta name="mdxg-redline:embedded-md" content="1" />')
    })

    it('既存の同名 meta があっても重複させない (idempotent)', () => {
      const html = '<html><head><meta name="mdxg-redline:embedded-md" content="1" /></head></html>'
      const out = upsertEmbeddedMdMeta(html)
      const matches = out.match(/mdxg-redline:embedded-md/g) ?? []
      expect(matches.length).toBe(1)
    })

    it('<head> タグが無いと Error を投げる', () => {
      expect(() => upsertEmbeddedMdMeta('<body></body>')).toThrow(/<head>/)
    })

    it('元文字列を破壊しない', () => {
      const html = '<html><head></head><body></body></html>'
      upsertEmbeddedMdMeta(html)
      expect(html).toBe('<html><head></head><body></body></html>')
    })
  })
}
