import { defineConfig } from 'vite-plus'

// KaTeX runtime を単一 ESM (`dist/katex/katex.mjs`) として bundle する専用設定。
// 公式 `katex/dist/katex.mjs` (raw ~600 KB) を esbuild minify で ~280 KB raw / ~90 KB gzipped
// まで圧縮する (Step 1 PoC 実測ベース、docs/mdxg-math-rendering.md §3.3)。
// Mermaid runtime と同じく `inlineDynamicImports: true` で `<script id="embedded-katex"
// type="module">` への inline 注入で動かす前提。
//
// docs/mdxg-math-rendering.md §3 / §5.k の配布契約:
//   - dist/katex/katex.mjs はそれ自体が CLI / standalone build plugin の入力素材
//   - commit 対象 (clone 直後の利用者が `npm run build` 抜きで CLI / standalone を動かすため)
//   - bridge 規約は src/katex-entry.ts に含まれており bundle 末尾に焼き込まれる
//     (`globalThis.__mdxgKatex` セット + `mdxg:katex-ready` 発火)
export default defineConfig({
  build: {
    emptyOutDir: false,
    minify: true,
    outDir: 'dist/katex',
    rollupOptions: {
      input: 'src/katex-entry.ts',
      output: {
        codeSplitting: false,
        entryFileNames: 'katex.mjs',
        format: 'esm',
      },
      preserveEntrySignatures: 'allow-extension',
    },
    target: 'es2020',
  },
  define: {
    'import.meta.vitest': 'undefined',
  },
})
