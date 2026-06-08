import { DEFAULT_ONLINE_ALLOWLIST, normalizeOriginForCompare } from '../core/online-url.ts'

// `MDXG_ONLINE_CONNECT_SRC` env var (CSV 形式の origin リスト) を読み、DEFAULT_ONLINE_ALLOWLIST
// との和集合を正規化 + 重複排除して返す。build plugin が CSP `connect-src` ディレクティブと
// `<script id="online-allowlist">` JSON の両方の単一情報源として使う (DESIGN.md §11.b)。
//
// 規約:
// - env 未設定 / 空文字 → DEFAULT_ONLINE_ALLOWLIST をそのまま返す
// - CSV の各エントリは `new URL(entry).origin` 形式 (例: `https://example.com`) でなければならない
// - https 以外 / pathname 付き / search 付き / hash 付きは reject + warn して entry skip
// - 出力順: DEFAULT を先頭、env からの追加を後ろに、Set で重複排除 (DEFAULT との重複は DEFAULT 側を採用)
//
// 追加ホスト適合性 (allowlist 拡張時の見落としやすい invariant):
// `fetchMarkdownFromUrl` (src/core/online-url.ts) は CORS preflight を回避するため
// simple request 条件 (GET + safelisted ヘッダのみ、Authorization / 独自 X-* 不可) で発火する。
// したがって追加するホストは次の 2 条件を満たさなければならない:
//   1. GET レスポンスに `Access-Control-Allow-Origin` ヘッダを返す (CORS 許可)
//   2. simple request 経路で fetch 可能 (preflight 不要、または preflight に `204`/`200` を返す)
// 既定の raw.githubusercontent.com / gist.githubusercontent.com は条件 1 を `*` で満たす一方、
// `OPTIONS` preflight には `403` を返す (Step 1 PoC 実測)。本実装は simple request 厳守で
// preflight を発火させないため運用できているが、preflight を要求するホストを追加すると
// 403 で破綻する。新規ホスト追加時は当該ホストの GET / OPTIONS 挙動を実機確認すること。
export const ONLINE_ALLOWLIST_ENV_VAR = 'MDXG_ONLINE_CONNECT_SRC'

const tryParseUrl = (entry: string): URL | null => {
  try {
    return new URL(entry)
  } catch {
    return null
  }
}

const tryParseOriginEntry = (entry: string): string | null => {
  const parsed = tryParseUrl(entry)
  if (parsed === null) {
    return null
  }
  if (parsed.protocol !== 'https:') {
    return null
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    return null
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    return null
  }
  return normalizeOriginForCompare(parsed)
}

const parseCsvEntries = (csv: string, warn: (msg: string) => void): readonly string[] => {
  const result: string[] = []
  for (const raw of csv.split(',')) {
    const trimmed = raw.trim()
    if (trimmed !== '') {
      const normalized = tryParseOriginEntry(trimmed)
      if (normalized === null) {
        warn(`[buildOnlineAllowlist] 不正な entry を無視: ${trimmed}`)
      } else {
        result.push(normalized)
      }
    }
  }
  return result
}

export interface BuildOnlineAllowlistOpts {
  warn?: (msg: string) => void
}

export const buildOnlineAllowlist = (
  env: NodeJS.ProcessEnv,
  opts: BuildOnlineAllowlistOpts = {}
): readonly string[] => {
  const csv = env[ONLINE_ALLOWLIST_ENV_VAR]
  if (typeof csv !== 'string' || csv.trim() === '') {
    return DEFAULT_ONLINE_ALLOWLIST
  }
  // 既定は silent。build plugin の caller (vite.config.ts) が console.warn を明示的に渡す。
  const warn =
    opts.warn ??
    ((_msg: string): void => {
      /* default: silent */
    })
  const additions = parseCsvEntries(csv, warn)
  const merged = [...DEFAULT_ONLINE_ALLOWLIST, ...additions]
  return [...new Set(merged)]
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('buildOnlineAllowlist: env 未設定 / 空文字', () => {
    it('env 未設定なら DEFAULT_ONLINE_ALLOWLIST をそのまま返す', () => {
      expect(buildOnlineAllowlist({})).toEqual([...DEFAULT_ONLINE_ALLOWLIST])
    })

    it('env 空文字なら DEFAULT', () => {
      expect(buildOnlineAllowlist({ [ONLINE_ALLOWLIST_ENV_VAR]: '' })).toEqual([
        ...DEFAULT_ONLINE_ALLOWLIST,
      ])
    })

    it('env 空白のみなら DEFAULT', () => {
      expect(buildOnlineAllowlist({ [ONLINE_ALLOWLIST_ENV_VAR]: '   ' })).toEqual([
        ...DEFAULT_ONLINE_ALLOWLIST,
      ])
    })
  })

  describe('buildOnlineAllowlist: CSV 解釈と正規化', () => {
    it('単一の origin を追加', () => {
      const result = buildOnlineAllowlist({
        [ONLINE_ALLOWLIST_ENV_VAR]: 'https://example.com',
      })
      expect(result).toEqual([...DEFAULT_ONLINE_ALLOWLIST, 'https://example.com'])
    })

    it('複数の origin を CSV で追加', () => {
      const result = buildOnlineAllowlist({
        [ONLINE_ALLOWLIST_ENV_VAR]: 'https://example.com,https://wiki.internal',
      })
      expect(result).toEqual([
        ...DEFAULT_ONLINE_ALLOWLIST,
        'https://example.com',
        'https://wiki.internal',
      ])
    })

    it('DEFAULT と重複するエントリは dedupe される', () => {
      const result = buildOnlineAllowlist({
        [ONLINE_ALLOWLIST_ENV_VAR]: 'https://raw.githubusercontent.com,https://example.com',
      })
      expect(result).toEqual([...DEFAULT_ONLINE_ALLOWLIST, 'https://example.com'])
    })

    it('末尾ドット / 大文字混入は normalize で吸収', () => {
      const result = buildOnlineAllowlist({
        [ONLINE_ALLOWLIST_ENV_VAR]: 'https://Example.COM.,https://example.com',
      })
      expect(result).toEqual([...DEFAULT_ONLINE_ALLOWLIST, 'https://example.com'])
    })

    it('trailing slash 付き origin (https://x/) も正規化して accept', () => {
      const result = buildOnlineAllowlist({
        [ONLINE_ALLOWLIST_ENV_VAR]: 'https://example.com/',
      })
      expect(result).toEqual([...DEFAULT_ONLINE_ALLOWLIST, 'https://example.com'])
    })

    it('port 付き origin は port を保持', () => {
      const result = buildOnlineAllowlist({
        [ONLINE_ALLOWLIST_ENV_VAR]: 'https://wiki.internal:8443',
      })
      expect(result).toEqual([...DEFAULT_ONLINE_ALLOWLIST, 'https://wiki.internal:8443'])
    })
  })

  describe('buildOnlineAllowlist: reject + warn', () => {
    it('http:// は reject + warn (skip して他 entry は処理続行)', () => {
      const warnings: string[] = []
      const result = buildOnlineAllowlist(
        { [ONLINE_ALLOWLIST_ENV_VAR]: 'http://example.com,https://valid.example' },
        {
          warn: (msg: string): void => {
            warnings.push(msg)
          },
        }
      )
      expect(result).toEqual([...DEFAULT_ONLINE_ALLOWLIST, 'https://valid.example'])
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain('http://example.com')
    })

    it('scheme なし / 不正 URL は reject + warn', () => {
      const warnings: string[] = []
      const result = buildOnlineAllowlist(
        { [ONLINE_ALLOWLIST_ENV_VAR]: 'example.com,not a url,https://valid.example' },
        {
          warn: (msg: string): void => {
            warnings.push(msg)
          },
        }
      )
      expect(result).toEqual([...DEFAULT_ONLINE_ALLOWLIST, 'https://valid.example'])
      expect(warnings).toHaveLength(2)
    })

    it('pathname 付き (https://x/foo) は reject + warn', () => {
      const warnings: string[] = []
      const result = buildOnlineAllowlist(
        { [ONLINE_ALLOWLIST_ENV_VAR]: 'https://example.com/foo' },
        {
          warn: (msg: string): void => {
            warnings.push(msg)
          },
        }
      )
      expect(result).toEqual([...DEFAULT_ONLINE_ALLOWLIST])
      expect(warnings).toHaveLength(1)
    })

    it('search 付き / hash 付きは reject + warn', () => {
      const warnings: string[] = []
      const result = buildOnlineAllowlist(
        { [ONLINE_ALLOWLIST_ENV_VAR]: 'https://example.com?x=1,https://example.com#h' },
        {
          warn: (msg: string): void => {
            warnings.push(msg)
          },
        }
      )
      expect(result).toEqual([...DEFAULT_ONLINE_ALLOWLIST])
      expect(warnings).toHaveLength(2)
    })

    it('空 entry (連続カンマ) は warn なしで skip', () => {
      const warnings: string[] = []
      const result = buildOnlineAllowlist(
        { [ONLINE_ALLOWLIST_ENV_VAR]: 'https://valid.example,,,https://other.example' },
        {
          warn: (msg: string): void => {
            warnings.push(msg)
          },
        }
      )
      expect(result).toEqual([
        ...DEFAULT_ONLINE_ALLOWLIST,
        'https://valid.example',
        'https://other.example',
      ])
      expect(warnings).toHaveLength(0)
    })
  })
}
