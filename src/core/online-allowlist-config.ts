import { DEFAULT_ONLINE_ALLOWLIST } from './online-url'

// `<script type="application/json" id="online-allowlist">[...]</script>` の textContent を
// パースして runtime 側で使う allowlist を返す。build pipeline (src/build/online-allowlist.ts)
// が生成した同じ origin 配列が DOM 経由で渡される (§3.3 単一情報源)。
//
// fail-safe 方針: テキスト欠落 / JSON 不正 / 配列でない / 空配列 / 非 string 要素のみ →
// `DEFAULT_ONLINE_ALLOWLIST` に fallback。build artifact の壊れたケースでも allowlist 拡張に
// 倒れることはなく、最小 security baseline を維持する。
const tryParseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

const filterStringArray = (parsed: unknown): readonly string[] | null => {
  if (!Array.isArray(parsed)) {
    return null
  }
  const items: string[] = []
  for (const item of parsed) {
    if (typeof item === 'string') {
      items.push(item)
    }
  }
  return items
}

export const resolveOnlineAllowlistFromJson = (rawText: string): readonly string[] => {
  if (rawText.trim() === '') {
    return DEFAULT_ONLINE_ALLOWLIST
  }
  const parsed = tryParseJson(rawText)
  const filtered = filterStringArray(parsed)
  if (filtered === null || filtered.length === 0) {
    return DEFAULT_ONLINE_ALLOWLIST
  }
  return filtered
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('resolveOnlineAllowlistFromJson: 正常系', () => {
    it('build pipeline 由来の有効な JSON 配列をそのまま返す', () => {
      const json = '["https://raw.githubusercontent.com","https://gist.githubusercontent.com"]'
      expect(resolveOnlineAllowlistFromJson(json)).toEqual([
        'https://raw.githubusercontent.com',
        'https://gist.githubusercontent.com',
      ])
    })

    it('env で追加 host が混じった JSON も配列ごと返す', () => {
      const json =
        '["https://raw.githubusercontent.com","https://gist.githubusercontent.com","https://wiki.internal"]'
      expect(resolveOnlineAllowlistFromJson(json)).toEqual([
        'https://raw.githubusercontent.com',
        'https://gist.githubusercontent.com',
        'https://wiki.internal',
      ])
    })
  })

  describe('resolveOnlineAllowlistFromJson: fail-safe (DEFAULT fallback)', () => {
    it('空テキスト → DEFAULT', () => {
      expect(resolveOnlineAllowlistFromJson('')).toEqual([...DEFAULT_ONLINE_ALLOWLIST])
    })

    it('空白のみ → DEFAULT', () => {
      expect(resolveOnlineAllowlistFromJson('  \n  ')).toEqual([...DEFAULT_ONLINE_ALLOWLIST])
    })

    it('JSON parse 失敗 → DEFAULT (壊れた build artifact)', () => {
      expect(resolveOnlineAllowlistFromJson('not json')).toEqual([...DEFAULT_ONLINE_ALLOWLIST])
    })

    it('配列ではない JSON (object) → DEFAULT', () => {
      expect(resolveOnlineAllowlistFromJson('{"x": 1}')).toEqual([...DEFAULT_ONLINE_ALLOWLIST])
    })

    it('配列ではない JSON (number) → DEFAULT', () => {
      expect(resolveOnlineAllowlistFromJson('42')).toEqual([...DEFAULT_ONLINE_ALLOWLIST])
    })

    it('空配列 → DEFAULT (build 失敗時に allowlist 0 で deny-all になる事故を避ける)', () => {
      expect(resolveOnlineAllowlistFromJson('[]')).toEqual([...DEFAULT_ONLINE_ALLOWLIST])
    })

    it('全要素が非 string → DEFAULT', () => {
      expect(resolveOnlineAllowlistFromJson('[1, null, true]')).toEqual([
        ...DEFAULT_ONLINE_ALLOWLIST,
      ])
    })
  })

  describe('resolveOnlineAllowlistFromJson: 部分的不正', () => {
    it('string 要素と非 string 要素が混在 → string のみ残す', () => {
      const json = '["https://valid.example", 42, null, "https://other.example"]'
      expect(resolveOnlineAllowlistFromJson(json)).toEqual([
        'https://valid.example',
        'https://other.example',
      ])
    })
  })
}
