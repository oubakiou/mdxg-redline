import { defineConfig } from 'vite-plus'

// src/embed.ts (Node CLI) を dist/embed.mjs にバンドルする専用設定。
// vite.config.ts (review.html 用) と並走させるため、別 config として分離している。
// Node 組み込みモジュールは external にして、自前コード (embed-core.ts) だけを 1 つの ESM に統合する。
// SSR ビルドにすることで Node ターゲットの解決と top-level side effect の保持が両立する。
export default defineConfig({
  build: {
    emptyOutDir: false,
    minify: false,
    outDir: 'dist',
    rollupOptions: {
      external: [/^node:/],
      input: 'src/embed.ts',
      output: {
        entryFileNames: 'embed.mjs',
        format: 'esm',
      },
      preserveEntrySignatures: 'allow-extension',
    },
    ssr: 'src/embed.ts',
    target: 'node20',
  },
})
