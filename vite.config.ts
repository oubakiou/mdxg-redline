import {
  buildAliasMap,
  canonicalizeSpec,
  formatAliasesTs,
  loadGrammar,
} from './scripts/lib/shiki-meta.mjs'
import { dirname, resolve } from 'node:path'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
// fmt が `type Plugin` を先頭に並べ替える一方 lint の sort-imports は
// identifier 文字列順 (defineConfig が先) を求める。両者の合意点が無いため当該行のみ無効化する。
// eslint-disable-next-line sort-imports
import { type Plugin, defineConfig } from 'vite-plus'
import { fileURLToPath } from 'node:url'
import { viteSingleFile } from 'vite-plugin-singlefile'

const ROOT_DIR = dirname(fileURLToPath(import.meta.url))

const readShikiVersion = async (): Promise<string> => {
  const pkgPath = resolve(ROOT_DIR, 'node_modules', 'shiki', 'package.json')
  const pkgJson = await readFile(pkgPath, 'utf8')
  const parsed: unknown = JSON.parse(pkgJson)
  if (typeof parsed !== 'object' || parsed === null || !('version' in parsed)) {
    throw new Error('shiki/package.json から version を読み取れませんでした')
  }
  const { version } = parsed
  if (typeof version !== 'string') {
    throw new Error('shiki/package.json の version が string ではありません')
  }
  return version
}

const regenerateAliasesTs = async (): Promise<void> => {
  const shikiVersion = await readShikiVersion()
  const canonicals = canonicalizeSpec()
  const aliasMap = buildAliasMap(canonicals)
  const ts = formatAliasesTs({ aliasMap, canonicals, shikiVersion })
  const outPath = resolve(ROOT_DIR, 'src', 'core', 'shiki-aliases.generated.ts')
  await writeFile(outPath, ts, 'utf8')
}

const emitGrammarJsonFiles = async (): Promise<void> => {
  const canonicals = canonicalizeSpec()
  const outDir = resolve(ROOT_DIR, 'dist', 'shiki-langs')
  await mkdir(outDir, { recursive: true })
  await Promise.all(
    canonicals.map(async (lang: string): Promise<void> => {
      const grammar = await loadGrammar(lang)
      await writeFile(resolve(outDir, `${lang}.json`), JSON.stringify(grammar), 'utf8')
    })
  )
}

// docs/mdxg-rendering-code-block.archive.md §3 / §5.j に従い、Shiki 同梱言語のメタを再生成して
// `src/core/shiki-aliases.generated.ts` に書き出し、各正規名の grammar JSON を
// `dist/shiki-langs/<lang>.json` として個別に emit する。
// - 前者は CLI / browser 双方がコンパイル時に import する固定マップ (commit 対象)
// - 後者は CLI が markdown スキャン結果に応じて配布 HTML に inject する素材 (.gitignore 対象)
//
// closeBundle まで grammar JSON を遅延させる理由: viteSingleFile が中間出力
// (dist/review.html、後段で embed-template.html / standalone.html に分岐) を inline 化する
// 完了タイミングを待つことで、emptyOutDir: false でも並走による書き出し競合を避けられる。
const shikiAssetsPlugin = (): Plugin => ({
  apply: 'build',
  buildStart: regenerateAliasesTs,
  closeBundle: emitGrammarJsonFiles,
  name: 'mdxg-shiki-assets',
})

// embed.ts の EMBEDDED_SHIKI_LANGS_RE / rewriteEmbeddedShikiLangs と同じパターン。
// Node loader が src/core/embed.ts を直接 import できないため、build chain 専用に inline する。
// CLI と shape を揃えるため `<` の Unicode escape (`<`) も同じ書きぶりで行う。
const EMBEDDED_SHIKI_LANGS_RE_BUILD =
  /(<script\b(?=[^>]*\bid="embedded-shiki-langs")(?=[^>]*\btype="application\/json")[^>]*>)([\s\S]*?)(<\/script>)/i

// Mermaid runtime 注入用 (docs/mdxg-diagram-rendering.md §5.l)。CLI 経路は embed.ts の
// rewriteEmbeddedMermaid を使うが、standalone build は build chain 専用にここで inline する。
const EMBEDDED_MERMAID_RE_BUILD =
  /(<script\b(?=[^>]*\bid="embedded-mermaid")(?=[^>]*\btype="module")[^>]*>)([\s\S]*?)(<\/script>)/i

const inlineMermaidIntoHtml = (html: string, runtime: string): string => {
  const match = EMBEDDED_MERMAID_RE_BUILD.exec(html)
  if (!match) {
    throw new Error(
      'review.html に id="embedded-mermaid" の <script> タグが見つかりません (build plugin)'
    )
  }
  const [fullMatch, openingTag, , closingTag] = match
  // bridge コード (`globalThis.__mdxgMermaid = mermaid; document.dispatchEvent(...)`) は
  // src/mermaid-entry.ts に含まれており runtime 末尾に焼き込まれている。ここでは
  // literal </script> だけを escape して書き込む (embed.ts の escapeScriptTagInJs と同じ規約)。
  const escaped = runtime.replace(/<\/script>/gi, String.raw`<\/script>`)
  const replaced = `${openingTag}${escaped}${closingTag}`
  return html.slice(0, match.index) + replaced + html.slice(match.index + fullMatch.length)
}

const inlineGrammarsIntoHtml = (html: string, grammars: Record<string, unknown>): string => {
  const match = EMBEDDED_SHIKI_LANGS_RE_BUILD.exec(html)
  if (!match) {
    throw new Error(
      'review.html に id="embedded-shiki-langs" の <script> タグが見つかりません (build plugin)'
    )
  }
  const [fullMatch, openingTag, , closingTag] = match
  // `<` を JSON Unicode escape `\u003C` (6 文字の literal) に置換することで、HTML パーサが
  // `</script>` を閉じタグとして誤検出する余地をゼロにする。embed.ts の `escapeJsonForScriptTag`
  // と同一パターン。
  //
  // ⚠️ template literal の中身は **literal バックスラッシュ + u003C** (7 バイト) で書く必要がある。
  // ソース上で `<` のように Unicode escape を直接書くと TypeScript lexer が先に `<` 1 文字に
  // 解決してしまい、`String.raw` が raw 形式を保持する余地が無くなって replace が no-op になる
  // 罠がある (将来同じ場所を編集する時は hexdump で `60 5c 75 30 30 33 43 60` を確認)。
  const payload = JSON.stringify(grammars).replace(/</g, String.raw`\u003C`)
  const replaced = `${openingTag}${payload}${closingTag}`
  return html.slice(0, match.index) + replaced + html.slice(match.index + fullMatch.length)
}

// vite build 出力 (`dist/review.html`) を 2 ファイルに分岐させる plugin (DESIGN.md §5.a)。
//   1. dist/embed-template.html  : review-request CLI が読み込んでテンプレートとして rewrite する
//                                  (grammar 注入なしの最小サイズ、現行 review.html 相当)
//   2. dist/standalone.html      : 単独 Open file 用、27 言語の grammar を事前 inline 済み
// shikiAssetsPlugin の closeBundle が dist/shiki-langs/*.json を emit した後に走らせるため、
// plugins 配列でこの plugin を後ろに置く (closeBundle は declaration 順)。
// docs/mdxg-diagram-rendering.md §5.l に従い standalone.html には Mermaid runtime を
// build 時に default で inline する。`dist/mermaid.mjs` が見つからない場合 (npm run build を
// 通さず単体で vite.config.ts を回した場合) は標準エラーに警告だけ出して inline 自体は skip し、
// standalone.html は Shiki ハイライト fallback で動作する形にする (build を fail させない)。
const readMermaidRuntimeIfPresent = async (distDir: string): Promise<string | null> => {
  try {
    return await readFile(resolve(distDir, 'mermaid.mjs'), 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      // eslint-disable-next-line no-console
      console.warn(
        '[mdxg-split-outputs] dist/mermaid.mjs が見つからないため standalone.html への Mermaid inline を skip しました。`vp build --config vite.mermaid.config.ts` を先に実行してください。'
      )
      return null
    }
    throw error
  }
}

const loadShikiGrammars = async (distDir: string): Promise<Record<string, unknown>> => {
  const canonicals = canonicalizeSpec()
  const grammars: Record<string, unknown> = {}
  await Promise.all(
    canonicals.map(async (lang: string): Promise<void> => {
      const grammarJson = await readFile(resolve(distDir, 'shiki-langs', `${lang}.json`), 'utf8')
      grammars[lang] = JSON.parse(grammarJson) as unknown
    })
  )
  return grammars
}

const buildStandaloneHtml = async (distDir: string, html: string): Promise<string> => {
  const grammars = await loadShikiGrammars(distDir)
  const withShiki = inlineGrammarsIntoHtml(html, grammars)
  const mermaidRuntime = await readMermaidRuntimeIfPresent(distDir)
  if (mermaidRuntime === null) {
    return withShiki
  }
  return inlineMermaidIntoHtml(withShiki, mermaidRuntime)
}

const splitOutputsPlugin = (): Plugin => ({
  apply: 'build',
  closeBundle: async (): Promise<void> => {
    const distDir = resolve(ROOT_DIR, 'dist')
    const intermediatePath = resolve(distDir, 'review.html')
    const embedTemplatePath = resolve(distDir, 'embed-template.html')
    const standalonePath = resolve(distDir, 'standalone.html')
    const html = await readFile(intermediatePath, 'utf8')
    const standaloneHtml = await buildStandaloneHtml(distDir, html)
    await Promise.all([
      writeFile(standalonePath, standaloneHtml, 'utf8'),
      rename(intermediatePath, embedTemplatePath),
    ])
  },
  name: 'mdxg-split-outputs',
})

// `root: 'src'` でソース一式 (review.html + review.ts + review.css) を src/ 配下に集約。
// outDir は root からの相対なので '../dist' を指定し、中間出力を repo ルート直下の
// dist/review.html に置く (splitOutputsPlugin が embed-template.html / standalone.html に分岐)。
// `files` field 経由で npm publish 対象になる。
export default defineConfig({
  build: {
    emptyOutDir: false,
    outDir: '../dist',
    rollupOptions: {
      input: 'src/review.html',
    },
  },
  // in-source test (`if (import.meta.vitest) { ... }`) を production bundle から除去する。
  // 除去しないと bundle 内のテストデータ文字列（例: rewriteReviewHtml の baseHtml に含まれる
  // `<script id="embedded-md" type="text/markdown">` リテラル）が本物の埋め込み script タグより
  // 手前に出現し、embed CLI 側の正規表現が誤マッチを起こして埋め込みが壊れる。
  define: {
    'import.meta.vitest': 'undefined',
  },
  fmt: {
    // ビルド成果物はフォーマット対象外。`vp build` で都度上書きされるため。
    ignorePatterns: ['dist/'],
    semi: false,
    singleQuote: true,
    trailingComma: 'es5',
  },
  lint: {
    categories: {
      correctness: 'error',
      perf: 'error',
      restriction: 'error',
      style: 'error',
      suspicious: 'error',
    },
    // ビルド成果物はチェック対象外。`vp build` で都度上書きされるため。
    ignorePatterns: ['dist/'],
    options: { typeAware: true, typeCheck: true },
    rules: {
      'capitalized-comments': 'off',
      'no-array-reduce': 'off',
      'no-magic-numbers': 'off',
      'number-literal-case': 'off',
      'oxc/no-async-await': 'off',
      'oxc/no-rest-spread-properties': 'off',
      'unicorn/no-null': 'off',
    },
  },
  plugins: [viteSingleFile(), shikiAssetsPlugin(), splitOutputsPlugin()],
  root: 'src',
  test: {
    includeSource: ['**/*.ts'],
  },
})
