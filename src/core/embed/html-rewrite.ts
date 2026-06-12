// template HTML (dist/embed-template.html / dist/standalone.html) の <script id="embedded-md"> /
// <html> 属性 / <span id="status"> / <title> / <head> 直下 meta などを書き換える pure logic 群。
// embedded-md の本文書き換え (rewriteReviewHtml) と、HTML 属性 hint / status / title / meta upsert を担う。

import {
  encodeEmbeddedFeedback,
  encodeEmbeddedMarkdown,
  encodeEmbeddedShikiLangs,
} from './script-encoding'
import { escapeHtml } from '../escape'
import { setOrInsertAttribute, upsertHtmlDataAttribute } from './html-attribute-rewriter'
import { inlineMarkdownCssIntoHtml } from '../../build/inline-markdown-css'

// 属性順や空白の揺らぎを許容するため、id="embedded-md" と type="text/markdown" の両方を
// 含む <script ...> の開きタグ全体、コンテンツ、閉じタグの 3 グループに分けて捕まえる。
// 両属性を lookahead で要求することで、HTML コメント等の説明テキスト内に出現する
// `<script id="embedded-md">` のような literal にマッチしてしまうのを防ぐ。
const EMBEDDED_MD_RE =
  /(<script\b(?=[^>]*\bid="embedded-md")(?=[^>]*\btype="text\/markdown")[^>]*>)([\s\S]*?)(<\/script>)/i

// embedded-md と同じパターン。id="embedded-shiki-langs" + type="application/json" の両属性を
// lookahead で要求し、説明文中の literal `<script id="embedded-shiki-langs">` に誤マッチしないようにする。
const EMBEDDED_SHIKI_LANGS_RE =
  /(<script\b(?=[^>]*\bid="embedded-shiki-langs")(?=[^>]*\btype="application\/json")[^>]*>)([\s\S]*?)(<\/script>)/i

// embedded-md / embedded-shiki-langs と同じパターン。resume 経路 (CLI が <name>-<hash>-feedback.json
// を見つけたら注入) で使う。
const EMBEDDED_FEEDBACK_RE =
  /(<script\b(?=[^>]*\bid="embedded-feedback")(?=[^>]*\btype="application\/json")[^>]*>)([\s\S]*?)(<\/script>)/i

const STATUS_SPAN_RE = /(<span\b(?=[^>]*\bid="status")[^>]*>)([\s\S]*?)(<\/span>)/i

const HEAD_OPEN_RE = /<head\b[^>]*>/i
const EMBEDDED_MD_META_RE = /\s*<meta\b[^>]*\bname="mdxg-redline:embedded-md"[^>]*\/?>/i

/**
 * 「ロード済み」状態のステータステキストを組み立てる。CLI 経由配布物の paint 前確定と、
 * JS 起動後の loadFromMarkdown 完了表示で同じ文字列を使うことで初期描画と JS 描画が一致する。
 */
export const formatLoadedStatus = (docName: string, docHash: string): string =>
  `${docName} (${docHash}) · loaded`

// 3 グループ regex (opening / body / closing) を pre-condition とする region 置換。
// caller は body のみを置き換え、不一致は `null` で受け取り throw / no-op を選択する。
// rewriteReviewHtml は opening tag 内属性も触るため本 helper の対象外。
const replaceMatchedHtmlRegion = (
  html: string,
  regex: RegExp,
  buildBody: () => string
): string | null => {
  const match = regex.exec(html)
  if (!match) {
    return null
  }
  const [fullMatch, openingTag, , closingTag] = match
  const replaced = `${openingTag}${buildBody()}${closingTag}`
  return html.slice(0, match.index) + replaced + html.slice(match.index + fullMatch.length)
}

/**
 * `<span id="status">` の中身を CLI が書き換える。paint 前から最終状態を見せることで、
 * JS の loadFromMarkdown が走るまで「No file」が一瞬見える FOUC を構造的に防ぐ。
 */
export const rewriteInitialStatus = (reviewHtml: string, statusText: string): string => {
  const result = replaceMatchedHtmlRegion(reviewHtml, STATUS_SPAN_RE, () => escapeHtml(statusText))
  if (result === null) {
    throw new Error('template HTML に id="status" の <span> タグが見つかりません')
  }
  return result
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
    throw new Error('template HTML に <head> タグが見つかりません')
  }
  const insertPos = headMatch.index + headMatch[0].length
  const meta = '\n    <meta name="mdxg-redline:embedded-md" content="1" />'
  return cleaned.slice(0, insertPos) + meta + cleaned.slice(insertPos)
}

const TITLE_RE = /(<title\b[^>]*>)([\s\S]*?)(<\/title>)/i

/**
 * `<html>` 開きタグに `data-theme="<themeHint>"` を挿入する。属性が既にあれば上書き。
 * inline script はこの属性を localStorage より高い優先度で初期値ヒントとして使う
 * (CLI 明示指定があれば毎回必ず paint を上書きする)。
 * 未指定時は属性を付けないため、呼び出し側で themeHint の有無を判断してから呼ぶ
 * (CLI 既定では --theme 未指定時はこの関数を呼ばない方針)。
 */
export const upsertHtmlDataTheme = (reviewHtml: string, themeHint: string): string =>
  upsertHtmlDataAttribute(reviewHtml, 'data-theme', themeHint)

/**
 * `<html>` 開きタグに `data-comments-width="<value>"` を挿入する。属性が既にあれば上書き。
 * inline script はこの属性を localStorage より高い優先度で初期値ヒントとして使う
 * (CLI 明示指定があれば毎回必ず paint を上書きする)。
 * 値の正当性 (0 or 240–640) は CLI 側でバリデーション済み前提だが、属性 escape 経路は
 * data-theme と揃える。
 */
export const upsertHtmlDataCommentsWidth = (reviewHtml: string, value: number): string =>
  upsertHtmlDataAttribute(reviewHtml, 'data-comments-width', String(value))

/**
 * `<html>` 開きタグに `data-page-nav-width="<value>"` を挿入する。属性が既にあれば上書き。
 * 値の正当性 (0 or 180–480) は CLI 側でバリデーション済み前提。data-comments-width と対称。
 */
export const upsertHtmlDataPageNavWidth = (reviewHtml: string, value: number): string =>
  upsertHtmlDataAttribute(reviewHtml, 'data-page-nav-width', String(value))

/**
 * `<html>` 開きタグに `data-toolbar-open-file="off"` を挿入する (idempotent)。
 * CLI が --show-open-file を指定していない時にだけ呼び、ブラウザ側 toolbar.ts はこの属性で
 * Open file ボタンと隠し input を起動時に DOM から削除する (DESIGN.md §3 入力 1 のフットガン
 * を CLI 経路で構造的に塞ぐ意図)。値は `'off'` のみで運用するため型でも literal に絞る。
 */
export const upsertHtmlDataToolbarOpenFile = (reviewHtml: string, value: 'off'): string =>
  upsertHtmlDataAttribute(reviewHtml, 'data-toolbar-open-file', value)

/**
 * `<html>` 開きタグに `data-toolbar-paste-markdown="off"` を挿入する (idempotent)。
 * CLI が --show-paste-markdown を指定していない時にだけ呼び、ブラウザ側
 * paste-markdown-modal.ts はこの属性で Paste markdown menu-item と modal backdrop を
 * 起動時に DOM から削除する (DESIGN.md §3 入力 1 と同じフットガンを paste 経路にも適用)。
 */
export const upsertHtmlDataToolbarPasteMarkdown = (reviewHtml: string, value: 'off'): string =>
  upsertHtmlDataAttribute(reviewHtml, 'data-toolbar-paste-markdown', value)

/**
 * `<title>` の中身を書き換える (idempotent)。ブラウザタブ・ファイル共有先で配布物を識別できるよう、
 * CLI 経路では `"MDXG Redline — <docName>"` 形式で上書きする (DESIGN.md §3)。
 * <title> タグが見つからない場合は no-op (フェイタルではなく warning 相当)。
 * <title> 中の特殊文字は HTML escape される (信頼境界、DESIGN.md §11)。
 */
export const rewriteTitle = (reviewHtml: string, newTitle: string): string =>
  replaceMatchedHtmlRegion(reviewHtml, TITLE_RE, () => escapeHtml(newTitle)) ?? reviewHtml

/**
 * `<script id="embedded-shiki-langs">` の中身を grammars の JSON で書き換える。
 * - `grammars` が空オブジェクト `{}` でも JSON `{}` が書き込まれる (browser は空 langs として扱う)
 * - 該当 `<script>` タグが template HTML に無ければ Error を投げる (呼び出し側が CLI エラーに変換)
 *
 * embedded-md のように属性経由の上書きはなく、コンテンツ置換のみ。
 */
export const rewriteEmbeddedShikiLangs = (
  reviewHtml: string,
  grammars: Record<string, unknown>
): string => {
  const result = replaceMatchedHtmlRegion(reviewHtml, EMBEDDED_SHIKI_LANGS_RE, () =>
    encodeEmbeddedShikiLangs(grammars)
  )
  if (result === null) {
    throw new Error('template HTML に id="embedded-shiki-langs" の <script> タグが見つかりません')
  }
  return result
}

/**
 * `<script id="embedded-feedback">` の中身を feedback payload の JSON で書き換える。
 * CLI が同じ <name>-<hash>- プレフィックスの feedback.json を見つけた resume 経路で呼ばれる。
 * 該当 `<script>` タグが template HTML に無ければ Error (template 不整合)。
 */
export const rewriteEmbeddedFeedback = (reviewHtml: string, payload: unknown): string => {
  const result = replaceMatchedHtmlRegion(reviewHtml, EMBEDDED_FEEDBACK_RE, () =>
    encodeEmbeddedFeedback(payload)
  )
  if (result === null) {
    throw new Error('template HTML に id="embedded-feedback" の <script> タグが見つかりません')
  }
  return result
}

/**
 * `<style id="markdown-css">` の中身をユーザー指定の CSS で書き換える。デフォルトでは build 時に
 * `src/styles/markdown.css` の内容が inline されており、CLI `--markdown-css <path>` が指定された
 * ときだけ呼ばれる (DESIGN.md §3 / §12 §1 Theming)。
 *
 * 中核ロジックは src/build/inline-markdown-css.ts に集約 (build 時 inline と CLI rewrite で
 * 同一実装を共有)。回帰防止テスト (HTML コメント中の literal を無視する等) も同ファイルに
 * 集約済み。embed.ts 側は他の rewrite* 関数群との並びを保つための薄い public alias。
 */
export const rewriteEmbeddedMarkdownCss = inlineMarkdownCssIntoHtml

/**
 * template HTML の文字列を受け取り、`<script id="embedded-md">` の中身と data-name 属性を
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
    throw new Error('template HTML に id="embedded-md" の <script> タグが見つかりません')
  }

  const [fullMatch, openingTag, , closingTag] = match
  const newOpeningTag = setOrInsertAttribute(openingTag, 'data-name', escapeHtml(docName))
  const replaced = `${newOpeningTag}${encodeEmbeddedMarkdown(markdown)}${closingTag}`
  return (
    reviewHtml.slice(0, match.index) + replaced + reviewHtml.slice(match.index + fullMatch.length)
  )
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

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

  describe('rewriteEmbeddedFeedback', () => {
    const baseHtml =
      '<html><body><script id="embedded-feedback" type="application/json"></script></body></html>'

    it('payload を script タグに書き込み、JSON.parse で復元できる', () => {
      const payload = {
        comments: [{ blockId: 'b001', endOffset: 4, id: 'a', quote: 'text', startOffset: 0 }],
        docHash: 'a1b2c3d4e5f6a7b8',
      }
      const out = rewriteEmbeddedFeedback(baseHtml, payload)
      const opening = out.indexOf('<script id="embedded-feedback"')
      const tagOpenEnd = out.indexOf('>', opening) + 1
      const closing = out.indexOf('</script>', tagOpenEnd)
      const body = out.slice(tagOpenEnd, closing)
      expect(body.includes('<')).toBe(false)
      expect(JSON.parse(body)).toEqual(payload)
    })

    it('既存コンテンツを置き換える', () => {
      const html =
        '<html><body><script id="embedded-feedback" type="application/json">{"old":"yes"}</script></body></html>'
      const out = rewriteEmbeddedFeedback(html, { comments: [], docHash: 'h' })
      expect(out).not.toContain('"old":"yes"')
      expect(out).toContain('"docHash":"h"')
    })

    it('embedded-feedback タグが無いと Error を投げる', () => {
      expect(() => rewriteEmbeddedFeedback('<html></html>', { comments: [] })).toThrow(
        /embedded-feedback/
      )
    })

    it('type="application/json" が無い script タグは対象外', () => {
      const html = '<script id="embedded-feedback"></script>'
      expect(() => rewriteEmbeddedFeedback(html, { comments: [] })).toThrow(/embedded-feedback/)
    })

    it('元文字列を破壊しない', () => {
      const html = baseHtml
      rewriteEmbeddedFeedback(html, { comments: [] })
      expect(html).toBe(baseHtml)
    })
  })

  describe('rewriteEmbeddedMarkdownCss', () => {
    // 詳細テストは src/build/inline-markdown-css.ts の in-source test 群に集約。
    // ここは embed.ts 経由の public alias が機能していることだけを確認する smoke test。
    it('alias として inlineMarkdownCssIntoHtml と同一の挙動 (smoke)', () => {
      const html =
        '<html><head><style id="markdown-css">/* default */</style></head><body></body></html>'
      const out = rewriteEmbeddedMarkdownCss(html, '#doc { color: red; }')
      expect(out).toContain('<style id="markdown-css">#doc { color: red; }</style>')
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

  describe('upsertHtmlDataCommentsWidth', () => {
    it('data-comments-width 属性を <html> タグに挿入する', () => {
      const html = '<html lang="ja"><body></body></html>'
      const out = upsertHtmlDataCommentsWidth(html, 320)
      expect(out).toContain('<html lang="ja" data-comments-width="320">')
    })

    it('0 (closed 指定) も書き込める', () => {
      const html = '<html></html>'
      const out = upsertHtmlDataCommentsWidth(html, 0)
      expect(out).toContain('data-comments-width="0"')
    })

    it('既存の data-comments-width 属性を上書きする', () => {
      const html = '<html lang="ja" data-comments-width="240"><body></body></html>'
      const out = upsertHtmlDataCommentsWidth(html, 480)
      expect(out).toContain('data-comments-width="480"')
      expect(out).not.toContain('data-comments-width="240"')
    })

    it('<html> タグが無いと Error を投げる', () => {
      expect(() => upsertHtmlDataCommentsWidth('<body></body>', 320)).toThrow(/<html>/)
    })

    it('元文字列を破壊しない', () => {
      const html = '<html><body></body></html>'
      upsertHtmlDataCommentsWidth(html, 360)
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

  describe('upsertHtmlDataToolbarOpenFile', () => {
    it('data-toolbar-open-file="off" を <html> タグに挿入する', () => {
      const html = '<html lang="ja"><body></body></html>'
      const out = upsertHtmlDataToolbarOpenFile(html, 'off')
      expect(out).toContain('<html lang="ja" data-toolbar-open-file="off">')
    })

    it('既存の data-toolbar-open-file 属性を上書きする (idempotent)', () => {
      const html = '<html lang="ja" data-toolbar-open-file="off"><body></body></html>'
      const out = upsertHtmlDataToolbarOpenFile(html, 'off')
      const matches = out.match(/data-toolbar-open-file/g) ?? []
      expect(matches.length).toBe(1)
      expect(out).toContain('data-toolbar-open-file="off"')
    })

    it('<html> タグが無いと Error を投げる', () => {
      expect(() => upsertHtmlDataToolbarOpenFile('<body></body>', 'off')).toThrow(/<html>/)
    })

    it('元文字列を破壊しない', () => {
      const html = '<html><body></body></html>'
      upsertHtmlDataToolbarOpenFile(html, 'off')
      expect(html).toBe('<html><body></body></html>')
    })
  })

  describe('upsertHtmlDataToolbarPasteMarkdown', () => {
    it('data-toolbar-paste-markdown="off" を <html> タグに挿入する', () => {
      const html = '<html lang="ja"><body></body></html>'
      const out = upsertHtmlDataToolbarPasteMarkdown(html, 'off')
      expect(out).toContain('<html lang="ja" data-toolbar-paste-markdown="off">')
    })

    it('既存の data-toolbar-paste-markdown 属性を上書きする (idempotent)', () => {
      const html = '<html lang="ja" data-toolbar-paste-markdown="off"><body></body></html>'
      const out = upsertHtmlDataToolbarPasteMarkdown(html, 'off')
      const matches = out.match(/data-toolbar-paste-markdown/g) ?? []
      expect(matches.length).toBe(1)
      expect(out).toContain('data-toolbar-paste-markdown="off"')
    })

    it('<html> タグが無いと Error を投げる', () => {
      expect(() => upsertHtmlDataToolbarPasteMarkdown('<body></body>', 'off')).toThrow(/<html>/)
    })

    it('元文字列を破壊しない', () => {
      const html = '<html><body></body></html>'
      upsertHtmlDataToolbarPasteMarkdown(html, 'off')
      expect(html).toBe('<html><body></body></html>')
    })
  })

  describe('rewriteTitle', () => {
    it('<title> の中身を新しいタイトルに置換する', () => {
      const html = '<html><head><title>MDXG Redline</title></head></html>'
      const out = rewriteTitle(html, 'MDXG Redline — spec.md')
      expect(out).toContain('<title>MDXG Redline — spec.md</title>')
      expect(out).not.toContain('<title>MDXG Redline</title>')
    })

    it('新タイトル中の < / > / & / " / \' を HTML escape する (XSS 経路を塞ぐ)', () => {
      const html = '<html><head><title>old</title></head></html>'
      const out = rewriteTitle(html, '<script>"&\'</script>')
      expect(out).toContain('<title>&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;</title>')
    })

    it('再適用しても idempotent (rewrite 結果に再度かけて同じ最終文字列)', () => {
      const html = '<html><head><title>初期</title></head></html>'
      const once = rewriteTitle(html, 'MDXG Redline — spec.md')
      const twice = rewriteTitle(once, 'MDXG Redline — spec.md')
      expect(twice).toBe(once)
    })

    it('<title> タグが無い HTML は no-op (warning 相当、Error にしない)', () => {
      const html = '<html><head></head></html>'
      expect(rewriteTitle(html, 'x')).toBe(html)
    })

    it('元文字列を破壊しない', () => {
      const html = '<html><head><title>x</title></head></html>'
      rewriteTitle(html, 'y')
      expect(html).toBe('<html><head><title>x</title></head></html>')
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
