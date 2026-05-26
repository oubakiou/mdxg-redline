import { defineConfig } from 'vite-plus'

// Mermaid runtime を単一 ESM (`dist/mermaid.mjs`) として bundle する専用設定。
// 公式 `mermaid/dist/mermaid.esm.min.mjs` は内部に大量の dynamic import (各 diagram chunk) を持ち、
// `<script id="embedded-mermaid" type="module">` への inline 注入で動かすには 1 ファイルに統合する
// 必要がある。`inlineDynamicImports: true` で全 chunk を本体に焼き込む。
//
// docs/mdxg-diagram-rendering.md §3 / §5.l の配布契約:
//   - dist/mermaid.mjs はそれ自体が CLI / standalone build plugin の入力素材
//   - commit 対象 (clone 直後の利用者が `npm run build` 抜きで CLI / standalone を動かすため)
//   - bridge 規約は CLI / build plugin 側で末尾に追記される (`globalThis.__mdxgMermaid` セット)
export default defineConfig({
  build: {
    emptyOutDir: false,
    minify: true,
    outDir: 'dist',
    rollupOptions: {
      input: 'src/mermaid-entry.ts',
      output: {
        codeSplitting: false,
        entryFileNames: 'mermaid.mjs',
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
