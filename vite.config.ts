import {
  buildAliasMap,
  canonicalizeSpec,
  formatAliasesTs,
  loadGrammar,
} from './scripts/lib/shiki-meta.ts'
import { dirname, resolve } from 'node:path'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { buildOnlineAllowlist } from './src/build/online-allowlist.ts'
import { buildOnlineHeadersFile } from './src/build/online-headers.ts'
import { buildOnlineHtml } from './src/build/online-html.ts'
import { buildOnlineRedirectsFile } from './src/build/online-redirects.ts'
import { inlineMarkdownCssIntoHtml } from './src/build/inline-markdown-css.ts'
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

// KaTeX runtime / CSS / fonts-extra CSS 注入用 (docs/mdxg-math-rendering.md §5.k / §5.l)。
// CLI 経路は embed.ts の rewriteEmbeddedKatex (Step 4 で追加) を使うが、standalone build は
// build chain 専用にここで inline する。standalone はフォント範囲 `all` 固定なので
// fonts-extra も無条件に書き込む。Mermaid と完全に対称。
const EMBEDDED_KATEX_JS_RE_BUILD =
  /(<script\b(?=[^>]*\bid="embedded-katex")(?=[^>]*\btype="module")[^>]*>)([\s\S]*?)(<\/script>)/i
const EMBEDDED_KATEX_CSS_RE_BUILD =
  /(<style\b(?=[^>]*\bid="embedded-katex-css")[^>]*>)([\s\S]*?)(<\/style>)/i
const EMBEDDED_KATEX_FONTS_EXTRA_CSS_RE_BUILD =
  /(<style\b(?=[^>]*\bid="embedded-katex-fonts-extra-css")[^>]*>)([\s\S]*?)(<\/style>)/i

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

const inlineKatexJsIntoHtml = (html: string, runtime: string): string => {
  const match = EMBEDDED_KATEX_JS_RE_BUILD.exec(html)
  if (!match) {
    throw new Error(
      'review.html に id="embedded-katex" の <script> タグが見つかりません (build plugin)'
    )
  }
  const [fullMatch, openingTag, , closingTag] = match
  // bridge コード (`globalThis.__mdxgKatex = katex; document.dispatchEvent(...)`) は
  // src/katex-entry.ts に含まれており runtime 末尾に焼き込まれている。
  // literal </script> だけ escape (Mermaid と同じ規約)。
  const escaped = runtime.replace(/<\/script>/gi, String.raw`<\/script>`)
  const replaced = `${openingTag}${escaped}${closingTag}`
  return html.slice(0, match.index) + replaced + html.slice(match.index + fullMatch.length)
}

interface CssInlineTarget {
  blockId: string
  re: RegExp
}

const inlineCssBlock = (html: string, css: string, target: CssInlineTarget): string => {
  const match = target.re.exec(html)
  if (!match) {
    throw new Error(
      `review.html に id="${target.blockId}" の <style> タグが見つかりません (build plugin)`
    )
  }
  const [fullMatch, openingTag, , closingTag] = match
  // literal </style> を <\/style> に escape (markdown-css inline と同じ規約、
  // CSS コメントや content: 値に閉じタグ文字列が混入してもパースが壊れないため)。
  const escaped = css.replace(/<\/style>/gi, String.raw`<\/style>`)
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
      console.warn(
        '[mdxg-split-outputs] dist/mermaid.mjs が見つからないため standalone.html への Mermaid inline を skip しました。`vp build --config vite.mermaid.config.ts` を先に実行してください。'
      )
      return null
    }
    throw error
  }
}

interface KatexAssets {
  fontsExtraCss: string
  js: string
  minimalCss: string
}

// docs/mdxg-math-rendering.md §5.k に従い standalone.html には KaTeX runtime / CSS /
// fonts-extra CSS を build 時に default で inline する (フォント範囲は `all` 相当固定)。
// 3 ファイルのいずれかが見つからない場合 (npm run build を通さず単体で vite.config.ts を
// 回した場合) は標準エラーに警告だけ出して inline 自体を skip し、standalone.html は raw
// `$...$` plain text fallback で動作する形にする (build を fail させない、Mermaid と同じ規約)。
const readKatexAssetsIfPresent = async (distDir: string): Promise<KatexAssets | null> => {
  try {
    const [js, minimalCss, fontsExtraCss] = await Promise.all([
      readFile(resolve(distDir, 'katex', 'katex.mjs'), 'utf8'),
      readFile(resolve(distDir, 'katex', 'katex.css'), 'utf8'),
      readFile(resolve(distDir, 'katex', 'katex-fonts-extra.css'), 'utf8'),
    ])
    return { fontsExtraCss, js, minimalCss }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      console.warn(
        '[mdxg-split-outputs] dist/katex/* が見つからないため standalone.html への KaTeX inline を skip しました。`vp build --config vite.katex.config.ts && node scripts/build-katex-css.ts` を先に実行してください。'
      )
      return null
    }
    throw error
  }
}

const loadShikiGrammars = async (distDir: string): Promise<Record<string, unknown>> => {
  const canonicals = canonicalizeSpec()
  // Promise.all は入力配列順に結果を返すため、entries を canonicals 順に組み直してから
  // オブジェクトへ挿入する。直接 grammars[lang] = ... を Promise.all 内で行うと readFile の
  // 解決順 (= I/O タイミング依存) でキー順が変わり、JSON.stringify 出力がビルドごとに揺れて
  // standalone.html が非決定的になる。
  const entries = await Promise.all(
    canonicals.map(async (lang: string): Promise<readonly [string, unknown]> => {
      const grammarJson = await readFile(resolve(distDir, 'shiki-langs', `${lang}.json`), 'utf8')
      return [lang, JSON.parse(grammarJson) as unknown]
    })
  )
  const grammars: Record<string, unknown> = {}
  for (const [lang, grammar] of entries) {
    grammars[lang] = grammar
  }
  return grammars
}

const inlineKatexAssets = (html: string, assets: KatexAssets): string => {
  const withJs = inlineKatexJsIntoHtml(html, assets.js)
  const withMinimal = inlineCssBlock(withJs, assets.minimalCss, {
    blockId: 'embedded-katex-css',
    re: EMBEDDED_KATEX_CSS_RE_BUILD,
  })
  // standalone は `--math-fonts all` 相当固定 (docs/mdxg-math-rendering.md §5.k) なので
  // fonts-extra も無条件に書き込む。CLI 経路は --math-fonts minimal のとき書かない。
  return inlineCssBlock(withMinimal, assets.fontsExtraCss, {
    blockId: 'embedded-katex-fonts-extra-css',
    re: EMBEDDED_KATEX_FONTS_EXTRA_CSS_RE_BUILD,
  })
}

const buildStandaloneHtml = async (distDir: string, html: string): Promise<string> => {
  const grammars = await loadShikiGrammars(distDir)
  let result = inlineGrammarsIntoHtml(html, grammars)
  const mermaidRuntime = await readMermaidRuntimeIfPresent(distDir)
  if (mermaidRuntime !== null) {
    result = inlineMermaidIntoHtml(result, mermaidRuntime)
  }
  const katexAssets = await readKatexAssetsIfPresent(distDir)
  if (katexAssets !== null) {
    result = inlineKatexAssets(result, katexAssets)
  }
  return result
}

// `<style id="markdown-css">` の中身を src/styles/markdown.css で埋める build / dev 共通 plugin。
// 中核ロジック (HTML コメント mask + regex match + `</style>` escape) は
// src/build/inline-markdown-css.ts に集約済みで、CLI 経路 (--markdown-css / embed.ts の
// rewriteEmbeddedMarkdownCss) と build inline が同一の関数を通る。回帰防止テスト
// (HTML コメント中の literal を無視する等) は同ファイルの in-source test 群で担保されるため、
// ここでは plugin の I/O (markdown.css 読み込み + transformIndexHtml hook への接続) だけを書く。
const markdownCssInlinePlugin = (): Plugin => ({
  name: 'mdxg-markdown-css-inline',
  transformIndexHtml: {
    handler: async (html: string): Promise<string> => {
      const css = await readFile(resolve(ROOT_DIR, 'src', 'styles', 'markdown.css'), 'utf8')
      return inlineMarkdownCssIntoHtml(html, css)
    },
    order: 'pre',
  },
})

// dist/online.html は standalone と同等の依存内容物 (Shiki 全 grammar / Mermaid / KaTeX inline) を
// 持ち、その上で 3 つの mutation だけ差分 apply する (docs/archive/feature-online-edition.archive.md §3.1):
//   1. <html data-mdxg-online="1">
//   2. CSP `connect-src 'none'` → `connect-src <allowlist origins>`
//   3. <head> に <script type="application/json" id="online-allowlist">[...]</script>
// allowlist は MDXG_ONLINE_CONNECT_SRC env (CSV) を DEFAULT に union + 正規化 + 重複排除した結果。
const buildOnlineHtmlFromStandalone = (standaloneHtml: string): string => {
  const allowlist = buildOnlineAllowlist(process.env, {
    warn: (msg: string): void => {
      console.warn(msg)
    },
  })
  // build の再現性に env が影響するため、解決済み allowlist を必ず stdout に emit する。
  // CI ログ / 開発者の手元両方で「この build がどの allowlist を採用したか」が後追いできる。
  console.log(
    `[mdxg-online] dist/online.html allowlist (${allowlist.length}): ${allowlist.join(' ')}`
  )
  return buildOnlineHtml(standaloneHtml, { allowlist })
}

// Cloudflare Pages hosting 用の静的設定ファイルを dist/ に emit する
// (docs/archive/feature-online-edition.archive.md §5.g):
// - _headers: online.html / `/` に allowlist 適用後 CSP を HTTP response header として返す
//   (meta CSP との single source of truth は extractCspContent 経由で構造的に担保)
// - _redirects: `/` への request を /online.html の content として rewrite (status 200)。
//   URL バーは `/` のまま保たれ、`?url=...` クエリも保持される。
const emitHostingConfigFiles = async (distDir: string, onlineHtml: string): Promise<void> => {
  await Promise.all([
    writeFile(resolve(distDir, '_headers'), buildOnlineHeadersFile(onlineHtml), 'utf8'),
    writeFile(resolve(distDir, '_redirects'), buildOnlineRedirectsFile(), 'utf8'),
  ])
}

const splitOutputsPlugin = (): Plugin => ({
  apply: 'build',
  closeBundle: async (): Promise<void> => {
    const distDir = resolve(ROOT_DIR, 'dist')
    const intermediatePath = resolve(distDir, 'review.html')
    const embedTemplatePath = resolve(distDir, 'embed-template.html')
    const standalonePath = resolve(distDir, 'standalone.html')
    const onlinePath = resolve(distDir, 'online.html')
    const html = await readFile(intermediatePath, 'utf8')
    const standaloneHtml = await buildStandaloneHtml(distDir, html)
    const onlineHtml = buildOnlineHtmlFromStandalone(standaloneHtml)
    await Promise.all([
      writeFile(standalonePath, standaloneHtml, 'utf8'),
      writeFile(onlinePath, onlineHtml, 'utf8'),
      emitHostingConfigFiles(distDir, onlineHtml),
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
    overrides: [
      {
        // 言語 ID として "c" 等の 1 文字識別子を含む必要がある生成物。
        files: ['**/*.generated.ts'],
        rules: { 'id-length': 'off' },
      },
      {
        // ビルドスクリプト / vite config では stdout・stderr が正規の出力チャネルなので
        // no-console を off にする。出荷される browser コード (src/app 等) には適用しない。
        files: ['scripts/**', '*.config.ts'],
        rules: { 'no-console': 'off' },
      },
    ],
    rules: {
      'capitalized-comments': 'off',
      'no-array-reduce': 'off',
      'no-magic-numbers': 'off',
      'number-literal-case': 'off',
      'oxc/no-async-await': 'off',
      'oxc/no-rest-spread-properties': 'off',
      // import の並びは fmt (oxfmt sortImports) が所有する。lint の sort-imports は
      // member 構文順 (none→all→multiple→single) という別アルゴリズムで衝突するため off。
      'sort-imports': 'off',
      'unicorn/no-null': 'off',
    },
  },
  plugins: [markdownCssInlinePlugin(), viteSingleFile(), shikiAssetsPlugin(), splitOutputsPlugin()],
  root: 'src',
  test: {
    environment: 'happy-dom',
    includeSource: ['**/*.ts'],
  },
})
