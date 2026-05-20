import { defineConfig } from 'vite-plus'

// src/review-request.ts (Node CLI) を dist/review-request.mjs にバンドルする専用設定。
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
      input: 'src/review-request.ts',
      output: {
        entryFileNames: 'review-request.mjs',
        format: 'esm',
      },
      preserveEntrySignatures: 'allow-extension',
    },
    ssr: 'src/review-request.ts',
    target: 'node20',
  },
  // in-source test (`if (import.meta.vitest) { ... }`) を production bundle から除去する。
  // CLI として動かす分には import.meta.vitest が undefined で if が false になるため動作は変わらないが、
  // 不要なコード・テストデータをバンドルから dead-code 除去する。
  define: {
    'import.meta.vitest': 'undefined',
  },
})
