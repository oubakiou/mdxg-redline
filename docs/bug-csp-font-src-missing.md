# [BUG] CSP `font-src data:` ディレクティブが実装に未反映（KaTeX フォント遮断の可能性）

DESIGN.md §11b で「KaTeX 数式フォント用に必須」と明記されている `font-src data:` ディレクティブが、`src/review.html` の CSP `<meta>` タグに含まれていない。CSP Level 3 仕様上、`default-src 'none'` への fallback で data URI 経由の woff2 フォントロードが遮断される構造になっており、設計意図通りに KaTeX が描画されていない可能性が高い。

## 1. 設計と実装の食い違い

| 場所                                       | font-src の状態                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `docs/DESIGN.md` §11b                      | `font-src data:` 必須と明記、CSP Level 3 仕様根拠まで記述                                   |
| `src/review.html:8`（CSP の単一定義箇所）  | **`font-src` ディレクティブなし**                                                           |
| `vite.config.ts` の build plugin           | CSP rewrite 経路は存在せず、`src/review.html` の値が `dist/*.html` にそのまま inline される |
| `dist/standalone.html:8`（build 後成果物） | **`font-src` ディレクティブなし**（src の値をそのまま継承）                                 |
| `dist/embed-template.html:8`               | **`font-src` ディレクティブなし**（同上）                                                   |

DESIGN.md §11b の該当記述（引用）：

> `font-src data:` — KaTeX 数式フォント (20 woff2 family) を `url(data:font/woff2;base64,...)` で inline するため必須。`'self'` / `https:` は追加しない（外部フォント取得経路を持たない `data:` のみで完結、§12 §14 Math Rendering / `docs/archive/mdxg-math-rendering.archive.md` §5.g）。`font-src` ディレクティブを書かないと `default-src 'none'` に fallback して deny される（CSP Level 3 仕様）

## 2. 推定される影響

CSP Level 3 仕様通りなら、現状の配布物では：

- `dist/katex/katex.css` の `@font-face { src: url(data:font/woff2;base64,...) }` がブラウザに block される
- KaTeX 数式は描画ロジック自体は動くが **専用フォント (KaTeX_Main / KaTeX_Math / KaTeX_AMS 等) がロードされない**
- 結果として、ブラウザ既定の serif / sans-serif で代替表示され、Computer Modern 系の数式組版が崩れる
- DevTools Console には CSP violation の警告が出ているはず（`Refused to load the font 'data:...' because it violates the following Content Security Policy directive: "default-src 'none'"`）

数式が「描画はされる」ため、エンドユーザーの目視テストでは見落とされやすい failure mode。本リポジトリの README に表示されている `$i\hbar \frac{\partial}{\partial t}\Psi(\mathbf{r}, t) = \hat{H}\Psi(\mathbf{r}, t)$` も、KaTeX 専用フォントなしで描画されている可能性がある。

ブラウザ実装によって CSP `font-src` の data: 扱いに差異がある可能性は残るため、§3 の再現確認で実機検証が必須。

## 3. 再現確認手順

1. `npm run build` で `dist/standalone.html` を生成（既存ビルドでも可）
2. ブラウザで `dist/standalone.html` を開き、Open file から §3.末尾の検証用 markdown を読み込む（README.md でも一部 family のみで確認可能だが、全 family 網羅性は劣る）
3. **主確認 (Console)**: DevTools Console に CSP violation `Refused to load the font 'data:...' because it violates the following Content Security Policy directive: "default-src 'none'"` が複数件出ていれば bug 発症確定
4. **副確認 (Elements)**: DevTools Elements で `<style id="embedded-katex-css">` を開き、`@font-face { src: url(data:font/woff2;base64,...) }` 宣言が複数存在することを確認（KaTeX CSS / font は build 時に inline され、`katex.css` という独立ネットワークリソースは存在しない。data URI フォントは別 request を発火しないため Network パネルからは追跡できない）
5. **能動 load 確認 (Console から実行)**: 検証用 markdown を開いた状態で以下を実行し、`status: 'rejected'` の family があれば bug 発症確定：

   ```js
   const families = [
     'KaTeX_Main',
     'KaTeX_Math',
     'KaTeX_AMS',
     'KaTeX_Caligraphic',
     'KaTeX_Fraktur',
     'KaTeX_Script',
     'KaTeX_SansSerif',
     'KaTeX_Typewriter',
     'KaTeX_Size1',
     'KaTeX_Size2',
     'KaTeX_Size3',
     'KaTeX_Size4',
   ]
   const results = await Promise.allSettled(families.map((f) => document.fonts.load(`1em ${f}`)))
   console.table(
     results.map((r, i) => ({
       family: families[i],
       status: r.status,
       reason: r.reason?.message ?? '',
     }))
   )
   ```

6. **目視確認**: 数式を要素検証して `.katex` 配下の computed font-family を確認、KaTeX 専用フォントではなく serif fallback (`Times New Roman` 等) が当たっていれば bug 発症

`document.fonts` を単純走査するだけだと、宣言済みだが「使われていない」family は永久に `'unloaded'` のまま残り、bug 発症との区別がつかない（`'unloaded'` は error ではない）。手順 5 のように `document.fonts.load()` で能動的に発火させ、reject されるかを見るのが確定的。

### 検証用 markdown（font family 網羅 fixture）

下記の markdown を `dist/standalone.html` で開くと、KaTeX の主要 family を意図的に全て触れる：

```markdown
# CSP font-src 検証 fixture

- KaTeX_Main: $\text{ABCabc 123}$
- KaTeX_Math: $x_i + y_j = z_k$
- KaTeX_AMS: $\therefore p \because q$
- KaTeX_Caligraphic: $\mathcal{X} \mathcal{Y} \mathcal{Z}$
- KaTeX_Fraktur: $\mathfrak{A} \mathfrak{B} \mathfrak{C}$
- KaTeX_Script: $\mathscr{S} \mathscr{T} \mathscr{U}$
- KaTeX_SansSerif: $\mathsf{abc}$
- KaTeX_Typewriter: $\mathtt{xyz}$
- KaTeX*Size1-4: $\displaystyle\sum*{i=1}^{n} \frac{1}{i^2} = \frac{\pi^2}{6}$
- 複合: $\hat{H}\Psi(\mathbf{r}, t) = i\hbar \frac{\partial}{\partial t}\Psi(\mathbf{r}, t)$
```

bug 発症時は Console に上記 family 数（10 程度）に応じた CSP violation が出る。修正後は 0 件になる。

### 自動化（Playwright 等）

ヘッドレス環境で検出するなら、Console event のうち `Refused to load the font 'data:` を含むメッセージ件数を集計する：

```js
const consoleErrors = []
page.on('console', (msg) => {
  if (msg.type() === 'error' && msg.text().includes('Refused to load the font')) {
    consoleErrors.push(msg.text())
  }
})
// ... 検証 markdown を読み込んで KaTeX upgrade が完了するまで待機
// 修正前: consoleErrors.length > 0
// 修正後: consoleErrors.length === 0
```

## 4. 修正方針

`src/review.html:8` の `<meta http-equiv="Content-Security-Policy">` の `content` 属性に `font-src data:` を追加する。

修正前（現状）：

```html
content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; connect-src 'none';
script-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'"
```

修正後：

```html
content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; font-src data:;
connect-src 'none'; script-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'"
```

`src/review.html` は `dist/standalone.html` / `dist/embed-template.html` 双方の共通入力（DESIGN.md §13）なので、1 箇所の修正で両配布物の CSP に反映される。CLI 経由で生成される `*-review.html` も embed-template から派生するため自動的に修正される。

build plugin / CLI rewrite 側で CSP を書き換える経路は不要。

## 5. 受け入れ基準

- `src/review.html` の CSP に `font-src data:` が含まれる
- `vp build` 後の `dist/standalone.html` / `dist/embed-template.html` 双方に `font-src data:` が含まれる（src 由来でそのまま inline）
- §3 検証用 markdown を `dist/standalone.html` で開いた時、DevTools Console に `Refused to load the font 'data:...'` 形式の CSP violation が **0 件** になる
- §3 手順 5 の `document.fonts.load()` を実行したとき、検証 markdown に含まれる KaTeX family（最低限 `KaTeX_Main` / `KaTeX_Math` / `KaTeX_AMS` / `KaTeX_Caligraphic` / `KaTeX_Fraktur` / `KaTeX_Script` / `KaTeX_SansSerif` / `KaTeX_Typewriter` / `KaTeX_Size1`-`KaTeX_Size4`）の Promise がすべて `fulfilled` で resolve する（reject が 1 件もない）
- 数式が KaTeX 公式の Computer Modern 系フォントで描画される（修正前後の目視比較で `\mathcal{X}` / `\mathfrak{Y}` / `\mathscr{Z}` の字形が serif fallback と明確に異なる）
- 既存 `vp test` / `vp check` がすべて通過する（CSP 変更による副作用がない）

未使用 family の `document.fonts` status が `'unloaded'` のままであることは受け入れ基準に含めない（仕様通りの挙動で、bug 修正の指標にならない）。

## 6. テスト追加方針（任意）

DESIGN.md §13「HTML minify 無効維持と CI スモークテスト指針」で将来 dist 配下の検査をスモークテストで追加する方針が示されている。本 bug 修正と合わせて、以下のテストを追加すると同種の drift を構造的に防げる：

- `dist/standalone.html` / `dist/embed-template.html` の `<meta http-equiv="Content-Security-Policy">` の content に `font-src data:` が含まれることを検査する in-source test
- もしくは `src/review.html` を読んで CSP 文字列を parse し、想定ディレクティブセットと完全一致することを確認

## 7. 関連

- [DESIGN.md §11b セキュリティとプライバシー / Content Security Policy](./DESIGN.md#b-content-security-policy二重保険) — `font-src data:` が必須と明記されている根拠
- [DESIGN.md §12 §14 Math Rendering](./DESIGN.md#14-math-rendering準拠) — KaTeX runtime の配布契約と font 内訳
- [docs/archive/mdxg-math-rendering.archive.md §5.g] — KaTeX font の data URI 化 + CSP `font-src data:` 採用の設計判断（archive、参照用）
- [docs/feature-online-edition.md §3.3](./feature-online-edition.md#33-url-allowlist-と-csp) — 「standalone CSP は connect-src のみ差分」と書いた前提に影響、本 bug 修正後に整合する
