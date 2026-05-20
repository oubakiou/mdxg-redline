// review.html の <script id="embedded-md"> に markdown を埋め込むための pure logic。
// Node CLI からも、将来のブラウザ側 UI からも使えるよう、I/O や Node 専用 API は持たない。
// `crypto.subtle` は Node 20+ / モダンブラウザ双方で globalThis.crypto として利用可能。

/**
 * markdown 本文の SHA-256 を計算し、先頭 8 バイトを 16 文字の hex 文字列で返す。
 * docHash としてファイル命名規約 (`<mdFileName>-<docHash>-...`) や
 * Workspace の差分検知に使う。同一ロジックを review.ts でも `hashStr` として呼び出すため、
 * 文字列化アルゴリズムは両者で一致させる必要がある。
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

/**
 * markdown 本文中の `</script>` を `<\/script>` に置換する。
 * script は raw text element のため、これだけで script タグの早期終了を回避できる。
 * 大文字小文字を区別せずに `</SCRIPT...` などもまとめて捕まえつつ、原文の case は保持する。
 */
export const escapeScriptContent = (markdown: string): string =>
  markdown.replace(/<(\/script)/gi, String.raw`<\$1`)

/**
 * data-name 属性に書き込む値を HTML 属性文脈用にエスケープする。
 * 属性はダブルクォートで囲む前提に固定しているため、ダブルクォートと特殊文字のみ対象。
 * ブラウザは dataset.name 経由で自動デコードするため、boot.ts 側は無変更で良い。
 */
export const escapeHtmlAttribute = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;')

// 属性順や空白の揺らぎを許容するため、id="embedded-md" と type="text/markdown" の両方を
// 含む <script ...> の開きタグ全体、コンテンツ、閉じタグの 3 グループに分けて捕まえる。
// 両属性を lookahead で要求することで、HTML コメント等の説明テキスト内に出現する
// `<script id="embedded-md">` のような literal にマッチしてしまうのを防ぐ。
const EMBEDDED_MD_RE =
  /(<script\b(?=[^>]*\bid="embedded-md")(?=[^>]*\btype="text\/markdown")[^>]*>)([\s\S]*?)(<\/script>)/i

const DATA_NAME_RE = /\bdata-name="[^"]*"/

// data-name が無い既存テンプレートでも安全に補えるように、置換と挿入を関数として分離する。
// 関数化により rewriteReviewHtml 側を no-ternary / prefer-ternary 双方に抵触せず保てる。
const replaceDataName = (openingTag: string, escapedName: string): string => {
  if (DATA_NAME_RE.test(openingTag)) {
    return openingTag.replace(DATA_NAME_RE, `data-name="${escapedName}"`)
  }
  return openingTag.replace(/>$/, ` data-name="${escapedName}">`)
}

/**
 * review.html の文字列を受け取り、`<script id="embedded-md">` の中身と data-name 属性を
 * 書き換えた新しい HTML 文字列を返す。元文字列は変更しない。
 * embedded-md タグが見つからない場合は Error を投げる（呼び出し側が CLI エラーに変換）。
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
  const newOpeningTag = replaceDataName(openingTag, escapeHtmlAttribute(docName))
  const replaced = `${newOpeningTag}${escapeScriptContent(markdown)}${closingTag}`
  return (
    reviewHtml.slice(0, match.index) + replaced + reviewHtml.slice(match.index + fullMatch.length)
  )
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('escapeScriptContent', () => {
    it('小文字の </script> をエスケープする', () => {
      expect(escapeScriptContent('a </script> b')).toBe(String.raw`a <\/script> b`)
    })

    it('大文字混在 </Script> もエスケープする', () => {
      expect(escapeScriptContent('x </Script>y</SCRIPT z')).toBe(
        String.raw`x <\/Script>y<\/SCRIPT z`
      )
    })

    it('他の文字 (<, &, " など) はそのまま残す', () => {
      expect(escapeScriptContent('a < b & c " d')).toBe('a < b & c " d')
    })

    it('</script> が無い markdown はそのまま返す', () => {
      const md = '# hello\n\nworld'
      expect(escapeScriptContent(md)).toBe(md)
    })
  })

  describe('escapeHtmlAttribute', () => {
    it('& " < > \' を実体参照に置換する', () => {
      expect(escapeHtmlAttribute(`& " < > '`)).toBe('&amp; &quot; &lt; &gt; &#39;')
    })

    it('& が他のエスケープ結果を二重エスケープしないよう先に処理されている', () => {
      expect(escapeHtmlAttribute('A&B"C')).toBe('A&amp;B&quot;C')
    })

    it('特殊文字を含まない値はそのまま返す', () => {
      expect(escapeHtmlAttribute('spec.md')).toBe('spec.md')
    })
  })

  describe('rewriteReviewHtml', () => {
    const baseHtml =
      '<html><body><script id="embedded-md" type="text/markdown" data-name="document.md"></script></body></html>'

    it('既存テンプレートに markdown と data-name を埋め込める', () => {
      const out = rewriteReviewHtml(baseHtml, '# hello', 'spec.md')
      expect(out).toContain('data-name="spec.md"')
      expect(out).toContain('># hello</script>')
      expect(out).not.toContain('data-name="document.md"')
    })

    it('markdown 中の </script> がエスケープされる', () => {
      const out = rewriteReviewHtml(baseHtml, 'before </script> after', 'a.md')
      expect(out).toContain(String.raw`before <\/script> after</script>`)
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
      expect(out).toContain('>body</script>')
    })

    it('data-name 属性が無い場合は補って挿入する', () => {
      const html = '<script id="embedded-md" type="text/markdown"></script>'
      const out = rewriteReviewHtml(html, 'body', 'new.md')
      expect(out).toContain('data-name="new.md"')
      expect(out).toContain('>body</script>')
    })

    it('既存コンテンツがあっても置き換える', () => {
      const html =
        '<script id="embedded-md" type="text/markdown" data-name="x.md">old body</script>'
      const out = rewriteReviewHtml(html, 'new body', 'y.md')
      expect(out).toContain('>new body</script>')
      expect(out).not.toContain('old body')
    })

    it('markdown に $ を含んでも replace の特殊置換扱いを受けない', () => {
      const out = rewriteReviewHtml(baseHtml, '$1 $& $`', 'a.md')
      expect(out).toContain('>$1 $& $`</script>')
    })

    it('元文字列を破壊しない', () => {
      const html = baseHtml
      rewriteReviewHtml(html, 'x', 'y.md')
      expect(html).toBe(baseHtml)
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
      expect(out).toContain('># body</script>')
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
}
