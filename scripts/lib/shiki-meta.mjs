// Shiki bundledLanguagesInfo / bundledLanguages を読んで、
// MDXG Redline で同梱する言語の正規名・エイリアス・grammar JSON を組み立てる pure module。
//
// scripts/generate-shiki-aliases.mjs と vite.config.ts の grammar emit plugin の両方が
// この lib を import することで、SPEC_LANGS のリストと canonicalize ロジックの単一の源を保つ。

import { bundledLanguages, bundledLanguagesInfo } from 'shiki'

// docs/mdxg-rendering-code-block.archive.md §3.2 が指定する 28 言語。
// `bash` / `shell` は Shiki 内部で `shellscript` に集約されるため、正規化後の正規名は 27 個になる。
// エイリアス側 (`bash` / `sh` / `shell` / `zsh`) は ALIAS_TO_CANONICAL の経路で同じ正規名に
// マップされるので、利用者から見えるサポート範囲は変わらない。
export const SPEC_LANGS = [
  'javascript',
  'typescript',
  'python',
  'bash',
  'json',
  'html',
  'css',
  'markdown',
  'yaml',
  'toml',
  'rust',
  'go',
  'java',
  'c',
  'cpp',
  'ruby',
  'php',
  'sql',
  'shell',
  'diff',
  'jsx',
  'tsx',
  'xml',
  'swift',
  'kotlin',
  'scala',
  'zig',
  'lua',
]

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

// vp の fmt が prefer single-quote / no-semi で、かつ object key は有効な JS 識別子なら
// quote なし、そうでなければ quote 付き ('c++' など) に揃える。SPEC_LANGS / Shiki aliases は
// ASCII の言語識別子しか含まないため、文字列値側はエスケープ不要 (バックスラッシュやシングル
// クォートは出現しない)。
const VALID_JS_IDENTIFIER_RE = /^[a-z_$][\w$]*$/iu
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
// docs/mdxg-rendering-code-block.archive.md §3.2 / §5.j が定める 28 言語の指定を
// Shiki bundledLanguagesInfo の正規名へ canonicalize し、エイリアスを併せて吐き出した結果。
// CLI (--shiki-langs=<csv>) と browser 側 Shiki 初期化、scanFencedLangs が同じマップを参照する。

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
