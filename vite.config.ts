import { defineConfig } from 'vite-plus'
import { viteSingleFile } from 'vite-plugin-singlefile'

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
  plugins: [viteSingleFile()],
  root: 'src',
  test: {
    includeSource: ['**/*.ts'],
  },
})
