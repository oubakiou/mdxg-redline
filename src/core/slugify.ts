// Page / heading の slug 生成プリミティブ。
// MDXG §6.4 の URL セーフ slug + 重複時の曖昧性解消を、ASCII 限定方針 (DESIGN.md §12 §6 Virtual Pages)
// に従って実装する。
// - 非 ASCII (日本語等) は ASCII 化結果が空になるため呼び出し側 fallback (例: page-3) に倒す
// - 重複時は `-2`, `-3`, ... のサフィックスを文書順に付与する

const ASCII_SLUG_INVALID = /[^a-z0-9]+/gu
const SLUG_EDGE_HYPHEN = /^-+|-+$/gu

const slugifyAsciiOnly = (text: string): string =>
  text.toLowerCase().replace(ASCII_SLUG_INVALID, '-').replace(SLUG_EDGE_HYPHEN, '')

/**
 * 入力テキストを ASCII 英数字 + ハイフンの slug にする。
 * ASCII 化結果が空 (非 ASCII のみ / 空文字 / 記号のみ) なら `fallback` を返す。
 */
export const slugifyOrFallback = (text: string, fallback: string): string => {
  const ascii = slugifyAsciiOnly(text)
  if (ascii.length > 0) {
    return ascii
  }
  return fallback
}

// GitHub 互換 slug 用: Unicode の "letter" / "number" カテゴリ + `_` + `-` のみ残す。
// `\p{L}` は CJK 含む全 letter、`\p{N}` は数字。これらを残し、句読点 / 記号 (`. / ( ) ・ § 等`)
// を削除することで `## 1. 概要` → `1-概要` のような GitHub と同じ結果を得る。
const GITHUB_SLUG_INVALID = /[^\p{L}\p{N}_-]+/gu

/**
 * GitHub の README.md 目次 (`[text](#slug)`) で使われる slug 形式に近い文字列を生成する。
 * 同ページ内 anchor hash (`<a href="#...">`) のジャンプ先 id として H1-H6 に付与する用途。
 *
 * GitHub の挙動 (github-slugger) を完全には再現せず、次の規則だけを採用する:
 * - lowercase
 * - 空白を `-` に置換
 * - Unicode letter / number / `_` / `-` 以外を削除 (CJK 等は保持される)
 * - 連続ハイフンを 1 つに圧縮し、端のハイフンを除去
 * - 結果が空なら空文字を返す (caller 側で fallback / `null` 化する)
 *
 * MDXG §6.4 URL セーフ slug は別途 `slugifyOrFallback` で ASCII 限定方針を維持する。
 * 本関数の出力は **DOM id 属性専用** で、page-navigation の page slug には流用しない。
 */
export const slugifyGithubCompatible = (text: string): string =>
  text
    .toLowerCase()
    .replace(/\s+/gu, '-')
    .replace(GITHUB_SLUG_INVALID, '')
    .replace(/-+/gu, '-')
    .replace(SLUG_EDGE_HYPHEN, '')

/**
 * `base` が `usedSlugs` に存在しなければそのまま、衝突する場合は `-2`, `-3`, ... と
 * 文書順に suffix を付与して一意化する。確定した slug を `usedSlugs` に追加して返す
 * (caller が更に別の slug を生成する際の累積として再利用する)。
 */
export const resolveUniqueSlug = (base: string, usedSlugs: Set<string>): string => {
  if (!usedSlugs.has(base)) {
    usedSlugs.add(base)
    return base
  }
  let suffix = 2
  let candidate = `${base}-${suffix}`
  while (usedSlugs.has(candidate)) {
    suffix += 1
    candidate = `${base}-${suffix}`
  }
  usedSlugs.add(candidate)
  return candidate
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('slugifyOrFallback: ASCII 入力', () => {
    it('英字をそのまま lowercase の slug にする', () => {
      expect(slugifyOrFallback('Hello', 'fb')).toBe('hello')
    })

    it('スペースと記号を単一ハイフンに圧縮する', () => {
      expect(slugifyOrFallback('Hello World!', 'fb')).toBe('hello-world')
      expect(slugifyOrFallback('a  --  b', 'fb')).toBe('a-b')
    })

    it('前後のハイフンを除去する', () => {
      expect(slugifyOrFallback('  Hello  ', 'fb')).toBe('hello')
      expect(slugifyOrFallback('---abc---', 'fb')).toBe('abc')
    })

    it('数字も保持する', () => {
      expect(slugifyOrFallback('Step 2: install', 'fb')).toBe('step-2-install')
    })

    it('既にハイフン区切りの ASCII slug はそのまま返す', () => {
      expect(slugifyOrFallback('page-2', 'fb')).toBe('page-2')
    })
  })

  describe('slugifyOrFallback: 非 ASCII / 空入力', () => {
    it('日本語のみのタイトルは fallback を返す', () => {
      expect(slugifyOrFallback('概要', 'page-3')).toBe('page-3')
      expect(slugifyOrFallback('日本語の見出し', 'page-7')).toBe('page-7')
    })

    it('空文字 / 空白のみ / 記号のみは fallback を返す', () => {
      expect(slugifyOrFallback('', 'fb')).toBe('fb')
      expect(slugifyOrFallback('   ', 'fb')).toBe('fb')
      expect(slugifyOrFallback('---', 'fb')).toBe('fb')
      expect(slugifyOrFallback('!!!', 'fb')).toBe('fb')
    })

    it('ASCII と非 ASCII の混合は ASCII 部分だけ残す', () => {
      expect(slugifyOrFallback('§ 1. Overview', 'fb')).toBe('1-overview')
      expect(slugifyOrFallback('概要 Overview', 'fb')).toBe('overview')
    })

    it('絵文字は非 ASCII として扱われる', () => {
      expect(slugifyOrFallback('🚀', 'fb')).toBe('fb')
      expect(slugifyOrFallback('Launch 🚀', 'fb')).toBe('launch')
    })
  })

  describe('slugifyGithubCompatible: DOM id 用 (CJK 保持)', () => {
    it('ASCII 入力は slugifyOrFallback と同じ結果になる', () => {
      expect(slugifyGithubCompatible('Hello World')).toBe('hello-world')
      expect(slugifyGithubCompatible('Step 2: install')).toBe('step-2-install')
    })

    it('日本語の見出しは CJK 文字を保持したまま slug 化される', () => {
      expect(slugifyGithubCompatible('概要')).toBe('概要')
      expect(slugifyGithubCompatible('日本語の見出し')).toBe('日本語の見出し')
    })

    it('「1. 概要」のような数字 + 日本語の混合は GitHub 目次形式の slug になる', () => {
      expect(slugifyGithubCompatible('1. 概要')).toBe('1-概要')
      expect(slugifyGithubCompatible('13. ビルドパイプライン')).toBe('13-ビルドパイプライン')
    })

    it('句読点 / 記号 / 全角括弧は削除される (連続ハイフンは圧縮)', () => {
      expect(slugifyGithubCompatible('§ 1. Overview')).toBe('1-overview')
      expect(slugifyGithubCompatible('概要 (overview)')).toBe('概要-overview')
      expect(slugifyGithubCompatible('a / b / c')).toBe('a-b-c')
    })

    it('結果が空になる入力 (記号のみ / 絵文字のみ) は空文字を返す', () => {
      expect(slugifyGithubCompatible('')).toBe('')
      expect(slugifyGithubCompatible('---')).toBe('')
      expect(slugifyGithubCompatible('!!!')).toBe('')
      expect(slugifyGithubCompatible('🚀')).toBe('')
    })

    it('前後のハイフン / 連続ハイフンは圧縮される', () => {
      expect(slugifyGithubCompatible('  Hello  ')).toBe('hello')
      expect(slugifyGithubCompatible('a  --  b')).toBe('a-b')
    })
  })

  describe('resolveUniqueSlug: 重複解消', () => {
    it('既存集合に無ければ base をそのまま返し集合に追加する', () => {
      const used = new Set<string>()
      expect(resolveUniqueSlug('hello', used)).toBe('hello')
      expect(used.has('hello')).toBe(true)
    })

    it('衝突時は -2, -3 と文書順にサフィックスを付ける', () => {
      const used = new Set<string>()
      expect(resolveUniqueSlug('hello', used)).toBe('hello')
      expect(resolveUniqueSlug('hello', used)).toBe('hello-2')
      expect(resolveUniqueSlug('hello', used)).toBe('hello-3')
    })

    it('既に -2 が使われていれば -3 にスキップする', () => {
      const used = new Set<string>(['hello', 'hello-2'])
      expect(resolveUniqueSlug('hello', used)).toBe('hello-3')
    })

    it('別 base は独立に管理される', () => {
      const used = new Set<string>()
      expect(resolveUniqueSlug('a', used)).toBe('a')
      expect(resolveUniqueSlug('b', used)).toBe('b')
      expect(resolveUniqueSlug('a', used)).toBe('a-2')
    })

    it('fallback "page-3" を base にしても他の "page-3-2" 衝突回避ロジックは同じ', () => {
      const used = new Set<string>(['page-3'])
      expect(resolveUniqueSlug('page-3', used)).toBe('page-3-2')
    })
  })
}
