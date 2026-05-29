// vite.katex.config.ts の入口。`dist/katex/katex.mjs` として 1 ファイル ESM bundle を出力する。
// インラインされた `<script id="embedded-katex" type="module">` ブロックとしてブラウザで実行され、
// `globalThis.__mdxgKatex` に KaTeX インスタンスを bridge し `mdxg:katex-ready` イベントを
// 発火する (docs/mdxg-math-rendering.archive.md §3.2 / §5.h)。bridge をエントリ側に置くことで、
// CLI / build plugin 側は bundle 出力を `</script>` escape して挿入するだけで済む
// (Mermaid と完全に対称、`src/mermaid-entry.ts` 参照)。
//
// ブラウザ側ロジック (`src/app/katex.ts`、Step 5b で追加) は paint 後 lazy に
// `globalThis.__mdxgKatex` を参照する。未定義時は `mdxg:katex-ready` イベントを待つ。
//
// no-underscore-dangle は global bridge 名の `__` prefix が他コードとの衝突回避のため必須
// (本実装スコープを明示する意図で §5.h で固定された規約、Mermaid と同じ)。

/* eslint-disable no-underscore-dangle */

import katex from 'katex'

declare global {
  // declare global で global 変数を宣言する TS 構文上 var が必須のため両ルールを無効化する。
  // eslint-disable-next-line vars-on-top, no-var
  var __mdxgKatex: typeof katex | undefined
}

globalThis.__mdxgKatex = katex
document.dispatchEvent(new Event('mdxg:katex-ready'))
