import {
  buildAliasMap,
  canonicalizeSpec,
  formatAliasesTs,
  loadGrammar,
} from './scripts/lib/shiki-meta.mjs'
import { dirname, resolve } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
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

// docs/mdxg-rendering-code-block.md §3 / §5.j に従い、Shiki 同梱言語のメタを再生成して
// `src/core/shiki-aliases.generated.ts` に書き出し、各正規名の grammar JSON を
// `dist/shiki-langs/<lang>.json` として個別に emit する。
// - 前者は CLI / browser 双方がコンパイル時に import する固定マップ (commit 対象)
// - 後者は CLI が markdown スキャン結果に応じて配布 HTML に inject する素材 (.gitignore 対象)
//
// closeBundle まで grammar JSON を遅延させる理由: viteSingleFile が dist/review.html を
// inline 化する完了タイミングを待つことで、emptyOutDir: false でも並走による
// 書き出し競合を避けられる。
const shikiAssetsPlugin = (): Plugin => ({
  apply: 'build',
  buildStart: regenerateAliasesTs,
  closeBundle: emitGrammarJsonFiles,
  name: 'mdxg-shiki-assets',
})

// `root: 'src'` でソース一式 (review.html + review.ts + review.css) を src/ 配下に集約。
// outDir は root からの相対なので '../dist' を指定し、生成物を repo ルート直下の
// dist/review.html に置く。`files` field 経由で npm publish 対象になる。
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
  plugins: [viteSingleFile(), shikiAssetsPlugin()],
  root: 'src',
  test: {
    includeSource: ['**/*.ts'],
  },
})
