// vite.mermaid.config.ts の入口。`dist/mermaid.mjs` として 1 ファイル ESM bundle を出力する。
// インラインされた `<script id="embedded-mermaid" type="module">` ブロックとしてブラウザで実行され、
// `globalThis.__mdxgMermaid` に Mermaid インスタンスを bridge し `mdxg:mermaid-ready` イベントを
// 発火する (docs/mdxg-diagram-rendering.md §3.2 / §5.k)。bridge をエントリ側に置くことで、
// CLI / build plugin 側は bundle 出力を `</script>` escape して挿入するだけで済む。
//
// ブラウザ側ロジック (`src/app/mermaid.ts`) は paint 後 lazy に `globalThis.__mdxgMermaid` を
// 参照する。未定義時は `mdxg:mermaid-ready` イベントを待つ。
//
// no-underscore-dangle は global bridge 名の `__` prefix が他コードとの衝突回避のため必須
// (本実装スコープを明示する意図で §5.k で固定された規約)。

/* eslint-disable no-underscore-dangle */

import mermaid from 'mermaid'

declare global {
  // eslint-disable-next-line vars-on-top, no-var
  var __mdxgMermaid: typeof mermaid | undefined
}

globalThis.__mdxgMermaid = mermaid
document.dispatchEvent(new Event('mdxg:mermaid-ready'))
