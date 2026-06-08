// online edition の `?url=` 経路で、人間が普段ブラウザで開く GitHub の表示用 URL を
// raw 配信 URL に書き換えるための pre-fetch 正規化レイヤ。
//
// allowlist (`raw.githubusercontent.com` / `gist.githubusercontent.com`) は
// fetch 経路の信頼境界として固定したまま、入力 UX としてだけ github.com / gist.github.com
// を受け付ける。allowlist 自体は変更せず、URL を allowlist 内 origin に変換してから
// `fetchMarkdownFromUrl` に渡すことで、§11.b の二段防御 (pre-validation + final URL re-check)
// と CSP `connect-src` の制約は触らない。
//
// 対応パターン:
//   1. `https://github.com/<owner>/<repo>/blob/<rest>`        → `https://raw.githubusercontent.com/<owner>/<repo>/<rest>`
//   2. `https://github.com/<owner>/<repo>/raw/<rest>`         → `https://raw.githubusercontent.com/<owner>/<repo>/<rest>`
//   3. `https://gist.github.com/<user>/<id>` (2 segments)     → `https://gist.githubusercontent.com/<user>/<id>/raw`
//      gist のメインページ URL は HTML を返すため、host 置換だけでは raw markdown が取れない
//      (`gist.githubusercontent.com/<user>/<id>` は 404)。`/raw` パスを補完して
//      `gist.github.com/<user>/<id>/raw` 相当 (gist server が `<commit>/<file>` 付きの最終 URL に
//      302 redirect) に倒すことで、最終 URL が gist raw 配信に着地する経路に乗せる。
//   4. `https://gist.github.com/<user>/<id>/raw[/...]`        → `https://gist.githubusercontent.com/<user>/<id>/raw[/...]`
//      既に raw 配信パスを含む URL は host 置換のみ。
//
// 非対応 / 素通り:
//   - http:// (allowlist の pre-validation で `scheme_not_https` に倒れる経路に乗せる)
//   - github.com 配下の他パス (例: `/tree/`、`/pull/`、`/issues/`) はそのまま返す
//   - gist.github.com の `/discover`、`/login`、`/<user>/<id>/revisions`、
//     `/<user>/<id>/<commit_sha>` (raw でないリビジョン HTML ページ) なども素通り。
//     これらは raw に対応エンドポイントが無い / `host_not_allowlisted` エラー UI に倒す方が
//     状況を正確に伝えられる。
//   - parse 不能な入力はそのまま返す (caller 側で同じ pre-validation を走らせる)

const GITHUB_BLOB_OR_RAW_PATH_MIN_SEGMENTS = 4
const GIST_MAIN_PAGE_SEGMENTS = 2

/**
 * 入力 UX として受理し、fetch 直前に raw 配信 host に書き換える対象の一覧。
 * UI (Open URL modal の help block) や docs で同じ情報を引くため、normalize 対応 host を
 * 単一情報源として export する (rewriteByHost の hardcoded 分岐と並列に持つが、
 * 整合は in-source test の振る舞い test と本配列の固定 test の両方で担保する)。
 */
export interface RewrittenInputHost {
  readonly input: string
  readonly target: string
}
export const REWRITTEN_INPUT_HOSTS: readonly RewrittenInputHost[] = Object.freeze([
  Object.freeze({ input: 'github.com', target: 'raw.githubusercontent.com' }),
  Object.freeze({ input: 'gist.github.com', target: 'gist.githubusercontent.com' }),
])

const tryParseUrl = (input: string): URL | null => {
  try {
    return new URL(input)
  } catch {
    return null
  }
}

const rewriteGithubBlobOrRaw = (parsed: URL): string | null => {
  const segments = parsed.pathname.split('/').filter((segment): boolean => segment !== '')
  if (segments.length < GITHUB_BLOB_OR_RAW_PATH_MIN_SEGMENTS) {
    return null
  }
  const [owner, repo, kind, ...rest] = segments
  if (kind !== 'blob' && kind !== 'raw') {
    return null
  }
  return `https://raw.githubusercontent.com/${owner}/${repo}/${rest.join('/')}${parsed.search}${parsed.hash}`
}

// github.com 側と対称に、テンプレートで authority を raw origin に固定し直す。
// `new URL` 経由の hostname 上書きだと user info / port / username:password が引き継がれ、
// allowlist (port なし origin) との比較で reject UX に倒れたり、fetch に余計な authority が
// 載る経路が開く。pathname / search / hash だけを raw 側に渡す。
//
// path 構造で扱いを分岐:
//   - `/<user>/<id>` (2 segments)        → `/<user>/<id>/raw` 補完 (gist server が最終 raw URL に redirect)
//   - `/<user>/<id>/raw[/...]`           → そのまま host 置換 (raw 配信パスを既に指している)
//   - `/discover`、`/<user>/<id>/revisions`、`/<user>/<id>/<commit_sha>` など → null (素通り)
const rewriteGist = (parsed: URL): string | null => {
  const segments = parsed.pathname.split('/').filter((segment): boolean => segment !== '')
  if (segments.length < GIST_MAIN_PAGE_SEGMENTS) {
    return null
  }
  const [user, id, ...rest] = segments
  if (rest.length === 0) {
    return `https://gist.githubusercontent.com/${user}/${id}/raw${parsed.search}${parsed.hash}`
  }
  if (rest[0] === 'raw') {
    return `https://gist.githubusercontent.com/${user}/${id}/${rest.join('/')}${parsed.search}${parsed.hash}`
  }
  return null
}

const rewriteByHost = (parsed: URL): string | null => {
  const host = parsed.hostname.toLowerCase().replace(/\.$/u, '')
  if (host === 'github.com') {
    return rewriteGithubBlobOrRaw(parsed)
  }
  if (host === 'gist.github.com') {
    return rewriteGist(parsed)
  }
  return null
}

export const normalizeGithubViewUrl = (input: string): string => {
  const parsed = tryParseUrl(input)
  if (parsed === null || parsed.protocol !== 'https:') {
    return input
  }
  return rewriteByHost(parsed) ?? input
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('normalizeGithubViewUrl: github.com/blob → raw.githubusercontent.com', () => {
    it('単純な blob URL をブランチ名付きで変換する', () => {
      expect(
        normalizeGithubViewUrl('https://github.com/oubakiou/mdxg-redline/blob/main/README_ja.md')
      ).toBe('https://raw.githubusercontent.com/oubakiou/mdxg-redline/main/README_ja.md')
    })

    it('refs/heads/<branch> 形式の blob URL もそのまま raw に渡す (segments 維持)', () => {
      expect(
        normalizeGithubViewUrl(
          'https://github.com/oubakiou/mdxg-redline/blob/refs/heads/main/README_ja.md'
        )
      ).toBe('https://raw.githubusercontent.com/oubakiou/mdxg-redline/refs/heads/main/README_ja.md')
    })

    it('ネストしたパスを保持する', () => {
      expect(
        normalizeGithubViewUrl('https://github.com/owner/repo/blob/main/docs/sub/dir/file.md')
      ).toBe('https://raw.githubusercontent.com/owner/repo/main/docs/sub/dir/file.md')
    })

    it('commit SHA 指定の blob URL も変換する', () => {
      expect(
        normalizeGithubViewUrl(
          'https://github.com/owner/repo/blob/abc1234567890abcdef1234567890abcdef12345/README.md'
        )
      ).toBe(
        'https://raw.githubusercontent.com/owner/repo/abc1234567890abcdef1234567890abcdef12345/README.md'
      )
    })

    it('行範囲 hash (#L10-L20) は保持する (raw 側では無害だが破壊しない)', () => {
      expect(
        normalizeGithubViewUrl('https://github.com/owner/repo/blob/main/file.md#L10-L20')
      ).toBe('https://raw.githubusercontent.com/owner/repo/main/file.md#L10-L20')
    })

    it('query string も保持する', () => {
      expect(
        normalizeGithubViewUrl('https://github.com/owner/repo/blob/main/file.md?foo=bar')
      ).toBe('https://raw.githubusercontent.com/owner/repo/main/file.md?foo=bar')
    })
  })

  describe('normalizeGithubViewUrl: github.com/raw → raw.githubusercontent.com', () => {
    it('新 UI の /raw/ ビュー URL を raw に書き換える', () => {
      expect(
        normalizeGithubViewUrl('https://github.com/oubakiou/mdxg-redline/raw/main/README_ja.md')
      ).toBe('https://raw.githubusercontent.com/oubakiou/mdxg-redline/main/README_ja.md')
    })
  })

  describe('normalizeGithubViewUrl: github.com の素通りパス', () => {
    it('tree URL は変換しない (raw に対応エンドポイントが無い)', () => {
      const input = 'https://github.com/owner/repo/tree/main/docs'
      expect(normalizeGithubViewUrl(input)).toBe(input)
    })

    it('pulls / issues などは変換しない', () => {
      const input = 'https://github.com/owner/repo/pull/123'
      expect(normalizeGithubViewUrl(input)).toBe(input)
    })

    it('セグメント不足 (owner/repo のみ) は変換しない', () => {
      const input = 'https://github.com/owner/repo'
      expect(normalizeGithubViewUrl(input)).toBe(input)
    })

    it('blob だが ref まで無い (segments=3) は変換しない', () => {
      const input = 'https://github.com/owner/repo/blob'
      expect(normalizeGithubViewUrl(input)).toBe(input)
    })
  })

  describe('normalizeGithubViewUrl: gist.github.com の /raw 補完経路', () => {
    it('gist メインページ URL (/<user>/<id>) は /raw を補完する', () => {
      expect(normalizeGithubViewUrl('https://gist.github.com/user/abc123def456')).toBe(
        'https://gist.githubusercontent.com/user/abc123def456/raw'
      )
    })

    it('既に /raw を含むパスはそのまま host 書き換えのみ', () => {
      expect(normalizeGithubViewUrl('https://gist.github.com/user/abc123/raw/file.md')).toBe(
        'https://gist.githubusercontent.com/user/abc123/raw/file.md'
      )
    })

    it('/raw 単独 (ファイル指定なし) も host 書き換えのみで通す', () => {
      expect(normalizeGithubViewUrl('https://gist.github.com/user/abc123/raw')).toBe(
        'https://gist.githubusercontent.com/user/abc123/raw'
      )
    })

    it('hash (#file-foo) は補完経路でも保持する (raw 側で無害だが破壊しない)', () => {
      expect(normalizeGithubViewUrl('https://gist.github.com/user/abc123#file-foo-md')).toBe(
        'https://gist.githubusercontent.com/user/abc123/raw#file-foo-md'
      )
    })

    it('non-default port は剥がして port なし raw origin に倒す (allowlist と一致させる)', () => {
      expect(normalizeGithubViewUrl('https://gist.github.com:8443/user/abc123/raw/file.md')).toBe(
        'https://gist.githubusercontent.com/user/abc123/raw/file.md'
      )
    })

    it('user info (user:pass@) は剥がす (simple request 厳守のため authority に持ち込まない)', () => {
      expect(normalizeGithubViewUrl('https://user:pass@gist.github.com/user/abc123')).toBe(
        'https://gist.githubusercontent.com/user/abc123/raw'
      )
    })
  })

  describe('normalizeGithubViewUrl: gist.github.com の素通りパス', () => {
    it('/discover (segments < 2) は変換しない', () => {
      const input = 'https://gist.github.com/discover'
      expect(normalizeGithubViewUrl(input)).toBe(input)
    })

    it('/login (segments < 2) は変換しない', () => {
      const input = 'https://gist.github.com/login'
      expect(normalizeGithubViewUrl(input)).toBe(input)
    })

    it('ルートパス (segments=0) は変換しない', () => {
      const input = 'https://gist.github.com/'
      expect(normalizeGithubViewUrl(input)).toBe(input)
    })

    it('/<user>/<id>/revisions は変換しない (raw に対応エンドポイントが無い)', () => {
      const input = 'https://gist.github.com/user/abc123/revisions'
      expect(normalizeGithubViewUrl(input)).toBe(input)
    })

    it('/<user>/<id>/<commit_sha> (リビジョン HTML) は変換しない', () => {
      const input = 'https://gist.github.com/user/abc123/abc1234567890abcdef'
      expect(normalizeGithubViewUrl(input)).toBe(input)
    })
  })

  describe('normalizeGithubViewUrl: 素通りすべき入力 (allowlist pre-validation に委ねる)', () => {
    it('既に raw.githubusercontent.com の URL はそのまま返す', () => {
      const input = 'https://raw.githubusercontent.com/owner/repo/main/file.md'
      expect(normalizeGithubViewUrl(input)).toBe(input)
    })

    it('既に gist.githubusercontent.com の URL はそのまま返す', () => {
      const input = 'https://gist.githubusercontent.com/user/abc123/raw/file.md'
      expect(normalizeGithubViewUrl(input)).toBe(input)
    })

    it('allowlist 外 host (example.com) はそのまま返す', () => {
      const input = 'https://example.com/blob/main/file.md'
      expect(normalizeGithubViewUrl(input)).toBe(input)
    })

    it('http:// (github.com) はそのまま返す (scheme_not_https 経路に倒す)', () => {
      const input = 'http://github.com/owner/repo/blob/main/file.md'
      expect(normalizeGithubViewUrl(input)).toBe(input)
    })

    it('parse 不能な文字列はそのまま返す', () => {
      expect(normalizeGithubViewUrl('not a url')).toBe('not a url')
    })

    it('空文字はそのまま返す', () => {
      expect(normalizeGithubViewUrl('')).toBe('')
    })

    it('大文字混じり host (GITHUB.COM) も変換する', () => {
      expect(normalizeGithubViewUrl('https://GITHUB.com/owner/repo/blob/main/file.md')).toBe(
        'https://raw.githubusercontent.com/owner/repo/main/file.md'
      )
    })

    it('末尾ドット付き host (github.com.) も変換する', () => {
      expect(normalizeGithubViewUrl('https://github.com./owner/repo/blob/main/file.md')).toBe(
        'https://raw.githubusercontent.com/owner/repo/main/file.md'
      )
    })

    it('subdomain spoofing (evil.github.com) は変換しない', () => {
      const input = 'https://evil.github.com/owner/repo/blob/main/file.md'
      expect(normalizeGithubViewUrl(input)).toBe(input)
    })
  })

  // describe を 2 つに分けているのは max-statements (10) を満たすため。テスト粒度は同じ。
  describe('normalizeGithubViewUrl: authority の正規化 (port / user info を剥がす)', () => {
    it('github.com に port 指定があっても raw 側は port なしで再構築', () => {
      expect(normalizeGithubViewUrl('https://github.com:443/owner/repo/blob/main/file.md')).toBe(
        'https://raw.githubusercontent.com/owner/repo/main/file.md'
      )
    })

    it('github.com の user info (user:pass@) は剥がす (raw URL に持ち込まない)', () => {
      expect(
        normalizeGithubViewUrl('https://user:pass@github.com/owner/repo/blob/main/file.md')
      ).toBe('https://raw.githubusercontent.com/owner/repo/main/file.md')
    })
  })

  describe('REWRITTEN_INPUT_HOSTS: UI / docs 向けの単一情報源', () => {
    it('rewriteByHost の分岐と一致する 2 entry (github.com → raw, gist.github.com → gist raw)', () => {
      expect([...REWRITTEN_INPUT_HOSTS]).toEqual([
        { input: 'github.com', target: 'raw.githubusercontent.com' },
        { input: 'gist.github.com', target: 'gist.githubusercontent.com' },
      ])
    })
  })
}
