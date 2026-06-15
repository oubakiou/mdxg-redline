# assets/

online edition (mkdn.review) の OGP カード画像とそのソース。

| ファイル       | 役割                                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `og-image.svg` | カード画像の編集ソース (設計の single source)                                                                                                                                                          |
| `og-image.png` | `og-image.svg` を rasterize した配信用 1200×630 PNG。`og:image` / `twitter:image` の実体。配信ビルドは本 PNG をコピーするだけ ([build-pipeline.md](../docs/design/build-pipeline.md) split-outputs §9) |

OGP crawler (X / Slack / Discord / Facebook) は SVG の `og:image` を描画しないため PNG を配信物に含める。`og-image.png` は `og-image.svg` の生成物なので、**SVG を変更したら PNG を再生成してコミットする**こと。

## og-image.png の再生成

PNG はブランド / 文言 / canonical ドメイン変更時くらいしか変わらないため、rasterizer は宣言依存にも `package.json` の script にもしていない。**特定の rasterizer パッケージを推奨しない**: 利用者が安全性を検証したツールを各自選ぶこと。

ブラウザで SVG を開いて書き出す方式は使わない。本 SVG は web font ではない `KaTeX_SansSerif` (リポジトリ同梱の KaTeX TTF) を前提に組まれており、フォントを固定しないと字形・字幅が変わって再現しない。

再生成は **TTF フォントファイルを明示指定できる** SVG→PNG rasterizer で、次の条件を固定して行う:

- フォント: `node_modules/katex/dist/fonts/KaTeX_SansSerif-Regular.ttf` / `-Bold.ttf` のみ。システムフォント無効、`defaultFontFamily = KaTeX_SansSerif`。
- 出力幅: 1200 (viewBox から 1200×630)。
- SVG 内テキストは上記字形でカバーできる **ASCII のみ**に保つ。日本語の説明文は画像ではなく `src/build/online-html.ts` の `og:description` に置く。
