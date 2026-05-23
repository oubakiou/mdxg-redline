// AUTO-GENERATED — DO NOT EDIT.
// 再生成: `node scripts/generate-shiki-aliases.mjs` または `npm run build`。
// Shiki version: 4.0.2
//
// docs/mdxg-rendering-code-block.archive.md §3.2 / §5.j が定める 28 言語の指定を
// Shiki bundledLanguagesInfo の正規名へ canonicalize し、エイリアスを併せて吐き出した結果。
// CLI (--shiki-langs=<csv>) と browser 側 Shiki 初期化、scanFencedLangs が同じマップを参照する。

// 言語 ID として "c" のような 1 文字識別子を含む必要があるため id-length を無効化。
/* eslint-disable id-length */

export const SHIKI_SUPPORTED_LANGS = [
  'c',
  'cpp',
  'css',
  'diff',
  'go',
  'html',
  'java',
  'javascript',
  'json',
  'jsx',
  'kotlin',
  'lua',
  'markdown',
  'php',
  'python',
  'ruby',
  'rust',
  'scala',
  'shellscript',
  'sql',
  'swift',
  'toml',
  'tsx',
  'typescript',
  'xml',
  'yaml',
  'zig',
] as const

export type SupportedLang = (typeof SHIKI_SUPPORTED_LANGS)[number]

export const ALIAS_TO_CANONICAL: Readonly<Record<string, SupportedLang>> = {
  bash: 'shellscript',
  c: 'c',
  'c++': 'cpp',
  cjs: 'javascript',
  cpp: 'cpp',
  css: 'css',
  cts: 'typescript',
  diff: 'diff',
  go: 'go',
  html: 'html',
  java: 'java',
  javascript: 'javascript',
  js: 'javascript',
  json: 'json',
  jsx: 'jsx',
  kotlin: 'kotlin',
  kt: 'kotlin',
  kts: 'kotlin',
  lua: 'lua',
  markdown: 'markdown',
  md: 'markdown',
  mjs: 'javascript',
  mts: 'typescript',
  php: 'php',
  py: 'python',
  python: 'python',
  rb: 'ruby',
  rs: 'rust',
  ruby: 'ruby',
  rust: 'rust',
  scala: 'scala',
  sh: 'shellscript',
  shell: 'shellscript',
  shellscript: 'shellscript',
  sql: 'sql',
  swift: 'swift',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  typescript: 'typescript',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zig: 'zig',
  zsh: 'shellscript',
}
