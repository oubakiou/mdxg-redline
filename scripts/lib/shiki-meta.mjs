// Shiki bundledLanguagesInfo / bundledLanguages を読んで、
// MDXG Redline で同梱する言語の正規名・エイリアス・grammar JSON を組み立てる pure module。
//
// scripts/generate-shiki-aliases.mjs と vite.config.ts の grammar emit plugin の両方が
// この lib を import することで、SPEC_LANGS のリストと canonicalize ロジックの単一の源を保つ。

import { bundledLanguages, bundledLanguagesInfo } from 'shiki'

// Shiki bundledLanguagesInfo の全言語をサポート対象とする (フル同梱)。
// standalone.html は全 grammar が pre-inline されるため ~41 MB / gzip ~5.5 MB に肥大するが、
// CLI 経路では `--shiki-langs auto` (既定) で markdown スキャン結果に応じて必要分だけ inject
// されるため、配布されるレビュー HTML のサイズは変わらない。
// エイリアス (`bash` / `sh` / `shell` / `zsh` 等) は ALIAS_TO_CANONICAL の経路で同じ正規名に
// マップされる。
export const SPEC_LANGS = bundledLanguagesInfo.map((info) => info.id)

const hasAlias = (info, raw) => Array.isArray(info.aliases) && info.aliases.includes(raw)

const resolveCanonical = (raw) => {
  for (const info of bundledLanguagesInfo) {
    if (info.id === raw) {
      return info.id
    }
    if (hasAlias(info, raw)) {
      return info.id
    }
  }
  return null
}

/**
 * SPEC_LANGS を Shiki 正規名集合に canonicalize する。重複は集約され、結果はソート済みの配列。
 * 未登録の識別子があれば Error を投げ、ビルドを止める (silent regression を防ぐ)。
 */
export const canonicalizeSpec = () => {
  const canonicalSet = new Set()
  const unresolved = []
  for (const raw of SPEC_LANGS) {
    const canonical = resolveCanonical(raw)
    if (canonical === null) {
      unresolved.push(raw)
    } else {
      canonicalSet.add(canonical)
    }
  }
  if (unresolved.length > 0) {
    throw new Error(
      `Shiki bundledLanguagesInfo に未登録の SPEC_LANGS 識別子: ${unresolved.join(', ')}`
    )
  }
  return [...canonicalSet].toSorted((left, right) => left.localeCompare(right))
}

const registerAliasesFor = (aliasMap, canonical) => {
  aliasMap[canonical] = canonical
  const info = bundledLanguagesInfo.find((entry) => entry.id === canonical)
  if (!info || !Array.isArray(info.aliases)) {
    return
  }
  for (const alias of info.aliases) {
    const lower = alias.toLowerCase()
    if (aliasMap[lower] && aliasMap[lower] !== canonical) {
      throw new Error(
        `エイリアス衝突: ${lower} は ${aliasMap[lower]} と ${canonical} の両方にマップされる`
      )
    }
    aliasMap[lower] = canonical
  }
}

export const buildAliasMap = (canonicals) => {
  const aliasMap = {}
  for (const canonical of canonicals) {
    registerAliasesFor(aliasMap, canonical)
  }
  return aliasMap
}

// vp の fmt が prefer single-quote / no-semi で、かつ object key が有効な JS 識別子なら
// quote なし、そうでなければ quote 付き ('c++' など) に揃える。formatter (quoteProps: asNeeded)
// は Unicode 識別子 (例: 文言) からも quote を外すため、ここも ASCII ではなく Unicode の
// ID_Start / ID_Continue で判定しないと生成直後の出力が lint で再整形され差分が出る。
// 文字列値側は ASCII 言語識別子のみでエスケープ不要 (バックスラッシュ / シングルクォート非出現)。
const VALID_JS_IDENTIFIER_RE = /^[\p{ID_Start}$_][\p{ID_Continue}$]*$/u
const formatStringValue = (value) => `'${value}'`
const formatObjectKey = (key) => {
  if (VALID_JS_IDENTIFIER_RE.test(key)) {
    return key
  }
  return `'${key}'`
}

export const formatAliasesTs = ({ aliasMap, canonicals, shikiVersion }) => {
  const aliasEntries = Object.entries(aliasMap)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([alias, canonical]) => `  ${formatObjectKey(alias)}: ${formatStringValue(canonical)},`)
    .join('\n')
  const canonicalEntries = canonicals.map((id) => `  ${formatStringValue(id)},`).join('\n')

  return `// AUTO-GENERATED — DO NOT EDIT.
// 再生成: \`node scripts/generate-shiki-aliases.mjs\` または \`npm run build\`。
// Shiki version: ${shikiVersion}
//
// Shiki bundledLanguagesInfo の全言語 (フル同梱) を正規名へ canonicalize し、エイリアスを
// 併せて吐き出した結果。CLI (--shiki-langs=<csv>) と browser 側 Shiki 初期化、scanFencedLangs
// が同じマップを参照する。

// 言語 ID として "c" のような 1 文字識別子を含む必要があるため id-length を無効化。
/* eslint-disable id-length */

export const SHIKI_SUPPORTED_LANGS = [
${canonicalEntries}
] as const

export type SupportedLang = (typeof SHIKI_SUPPORTED_LANGS)[number]

export const ALIAS_TO_CANONICAL: Readonly<Record<string, SupportedLang>> = {
${aliasEntries}
}
`
}

/**
 * canonical 名から Shiki が動的 import する grammar (LanguageRegistration[]) を取り出す。
 * 結果はそのまま JSON.stringify 可能で、createHighlighterCoreSync の `langs: [...]` に渡せる。
 */
export const loadGrammar = async (canonical) => {
  const loader = bundledLanguages[canonical]
  if (typeof loader !== 'function') {
    throw new Error(`Shiki bundledLanguages に loader が無い: ${canonical}`)
  }
  const mod = await loader()
  return mod.default ?? mod
}
