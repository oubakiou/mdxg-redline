# ビルドパイプライン

> 本書は [DESIGN.md](./DESIGN.md) の旧 §13「ビルドパイプライン」を独立ドキュメントとして切り出したもの。参照互換のため見出し番号 §13 を維持する。記述は DESIGN.md と同じ[編集規約](./DESIGN.md#12-mdxg-準拠状況と設計判断)（設計レイヤーの WHY に絞り、実装スナップショット = file:symbol / 行数 / 実測サイズ はコードと archive へ委譲）に準拠する。**`mdxg-split-outputs` plugin の処理は本節「全体像」の 9 ステップを正典**とし、責務分担表はそれを要約する。

エンドユーザーには単一 HTML を配布するが、開発者は TypeScript で書く。両者の橋渡しが [Vite+ (vp)](https://viteplus.dev/) ベースのビルドパイプライン。vp は Vite 8 + Rolldown + vitest を統合し、`vp build` / `vp dev` / `vp test` の単一 CLI として提供する。

## 全体像

ビルドの出口は 4 つ。エンドユーザーが直接開く配布物 `dist/standalone.html`、review-request CLI が rewrite テンプレートとして読み込む `dist/embed-template.html`、ホスティング配信用の `dist/hosting/index.html`（URL fetch viewer、DESIGN.md §3 入力 3）、配布者向け CLI ツール `dist/review-request.mjs`。加えてホスティング先 (Cloudflare Pages 等) 用の静的設定ファイル `dist/hosting/_headers` が build 時に emit される (Cloudflare Pages の Build output directory に `dist/hosting` を指定する設計、archive 化された `docs/archive/feature-online-runtime-assets.archive.md` Step 4)。

ビルドチェーンは 4 系統が並列で走り、互いに **mermaid → katex → standalone/online inline → CLI bundle** の依存順がある。実行順序の制約は本節末尾「`npm run build` script の実行順」を参照。

```mermaid
flowchart LR
    subgraph C1["vp build (vite.config.ts)"]
        direction LR
        I1["src/app/*.ts<br/>src/core/*.ts<br/>src/styles/*.css<br/>src/review.html<br/>vite.config.ts<br/>scripts/lib/shiki-meta.ts"]
        B1["vite + Rolldown<br/>+ viteSingleFile<br/>+ mdxg-shiki-aliases<br/>+ mdxg-split-outputs"]
        I1 --> B1
        B1 --> O1a["dist/embed-template.html"]
        B1 --> O1b["dist/standalone.html"]
        B1 --> O1e["dist/hosting/index.html"]
        B1 --> O1f["dist/hosting/_headers"]
        B1 --> O1c["dist/shiki-langs/&lt;lang&gt;.json"]
        B1 --> O1g["dist/hosting/canonical/shiki-langs/&lt;lang&gt;.json"]
        B1 --> O1h["dist/hosting/fingerprinted/shiki-langs/&lt;lang&gt;.&lt;hash&gt;.json"]
        B1 --> O1d["src/core/shiki-aliases.generated.ts"]
    end
    subgraph C2["vp build --config vite.mermaid.config.ts"]
        direction LR
        I2["src/mermaid-entry.ts<br/>vite.mermaid.config.ts"]
        B2["vite + Rolldown<br/>(codeSplitting:false)"]
        I2 --> B2 --> O2["dist/mermaid.mjs"]
    end
    subgraph C3["vp build --config vite.katex.config.ts<br/>+ node scripts/build-katex-css.ts"]
        direction LR
        I3["src/katex-entry.ts<br/>vite.katex.config.ts<br/>scripts/build-katex-css.ts"]
        B3["vite + Rolldown +<br/>build-katex-css.ts"]
        I3 --> B3
        B3 --> O3a["dist/katex/katex.mjs"]
        B3 --> O3b["dist/katex/katex.css"]
        B3 --> O3c["dist/katex/katex-fonts-extra.css"]
    end
    O2 -. "split-outputs<br/>でコピー<br/>(hash 焼き込み)" .-> O1i["dist/hosting/fingerprinted/mermaid.&lt;hash&gt;.mjs<br/>dist/hosting/canonical/mermaid.mjs"]
    O3a -. "split-outputs<br/>でコピー" .-> O1j["dist/hosting/fingerprinted/katex/katex.&lt;hash&gt;.mjs<br/>dist/hosting/canonical/katex/katex.mjs"]
    O3b -. "split-outputs<br/>でコピー" .-> O1k["dist/hosting/fingerprinted/katex/katex.&lt;hash&gt;.css<br/>dist/hosting/canonical/katex/katex.css"]
    O3c -. "split-outputs<br/>でコピー" .-> O1l["dist/hosting/fingerprinted/katex/katex-fonts-extra.&lt;hash&gt;.css<br/>dist/hosting/canonical/katex/katex-fonts-extra.css"]
    subgraph C4["vp build --config vite.review-request.config.ts"]
        direction LR
        I4["src/cli/*.ts<br/>src/core/embed.ts<br/>vite.review-request.config.ts"]
        B4["vite + Rolldown<br/>(SSR mode, Node ESM)"]
        I4 --> B4 --> O4["dist/review-request.mjs"]
    end
```

各出力成果物の役割と実測サイズ（概数、すべて commit 対象）：

| 成果物                                                                                           | 系統 | 役割                                                                                                                                                                                                                                                                                                                               | サイズ（概数）                     |
| ------------------------------------------------------------------------------------------------ | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `dist/embed-template.html`                                                                       | C1   | CLI rewrite テンプレート、grammar / Mermaid / KaTeX 注入なし最小サイズ                                                                                                                                                                                                                                                             | ~334 KB / gzip ~101 KB             |
| `dist/standalone.html`                                                                           | C1   | 単独 Open file / Paste markdown 用、Shiki bundled 全言語（約 235）+ Mermaid + KaTeX (`all` 相当) inline 済み                                                                                                                                                                                                                       | ~48 MB / gzip ~6.9 MB              |
| `dist/hosting/index.html`                                                                        | C1   | ホスティング配信用の URL fetch viewer（DESIGN.md §3 入力 3）。最小 shell として grammar / Mermaid / KaTeX runtime はすべて空 textContent / 空 style に上書き済みで、`<script id="online-asset-manifest">` 経由で runtime が必要分だけ動的取得する（archive 化された `docs/archive/feature-online-runtime-assets.archive.md` 参照） | ~402 KB / gzip ~124 KB             |
| `dist/hosting/_headers`                                                                          | C1   | Cloudflare Pages 用静的設定。`/` と `/index.html` (Pages の default index 配信と直接 URL アクセスの両経路) に CSP を HTTP response header として返し (`max-age=300`)、`/fingerprinted/*` に `immutable, max-age=31536000`、`/canonical/*` に `max-age=300` の Cache-Control を path 単位で設定                                     | 数百バイト                         |
| `dist/shiki-langs/<lang>.json`                                                                   | C1   | Shiki bundled 全言語の grammar JSON、CLI / standalone の双方が読み込む素材                                                                                                                                                                                                                                                         | (言語ごとに分割)                   |
| `dist/hosting/canonical/shiki-langs/<lang>.json`                                                 | C1   | online edition の runtime fetch 用 (hash 無し)。新 deploy 過渡期の 404 retry 先 (archive doc §5.i の 3 段 fail-safe)                                                                                                                                                                                                               | (言語ごとに分割)                   |
| `dist/hosting/fingerprinted/shiki-langs/<lang>.<hash>.json`                                      | C1   | online edition の runtime fetch 用 (content hash 焼き込み済み)。`Cache-Control: immutable` で永久 cache 可。`<script id="online-asset-manifest">` 経由で loader が解決                                                                                                                                                             | (言語ごとに分割)                   |
| `src/core/shiki-aliases.generated.ts`                                                            | C1   | `mdxg-shiki-aliases` plugin の buildStart で再生成、CLI / browser 双方が import                                                                                                                                                                                                                                                    | —                                  |
| `dist/mermaid.mjs`                                                                               | C2   | 1 ファイル ESM、bridge `globalThis.__mdxgMermaid` を末尾で発火、CLI / standalone build の入力                                                                                                                                                                                                                                      | ~3.1 MB / gzip ~859 KB             |
| `dist/hosting/fingerprinted/mermaid.<hash>.mjs` / `dist/hosting/canonical/mermaid.mjs`           | C1   | C2 出力を `mdxg-split-outputs` が hash 計算 + 2 系統 emit。online edition が runtime に dynamic import する (fingerprinted は `import('/fingerprinted/...')`、reject 時に canonical へ load failure retry)                                                                                                                         | 各 ~3.1 MB / gzip ~859 KB          |
| `dist/katex/katex.mjs`                                                                           | C3   | 1 ファイル ESM、bridge `globalThis.__mdxgKatex` を末尾で発火、CLI / standalone build の入力                                                                                                                                                                                                                                        | ~259 KB / gzip ~77 KB              |
| `dist/katex/katex.css`                                                                           | C3   | minimal: Main / AMS / Math / Size1-4 の 9 woff2 family を data URI 化 + 全 `.katex` CSS                                                                                                                                                                                                                                            | ~242 KB / gzip ~171 KB             |
| `dist/katex/katex-fonts-extra.css`                                                               | C3   | extra: Caligraphic / Fraktur / Script / SansSerif / Typewriter の 11 family の `@font-face` のみ。CLI `--math-fonts all` / standalone build で追加注入                                                                                                                                                                             | ~128 KB / gzip ~95 KB              |
| `dist/hosting/fingerprinted/katex/katex.<hash>.{mjs,css}` ほか / `dist/hosting/canonical/katex/` | C1   | C3 出力 3 ファイル (JS / CSS / fonts-extra CSS) を `mdxg-split-outputs` が hash 計算 + 2 系統 emit。online edition が JS は dynamic import、CSS / fonts-extra は fetch で取得し、3 ファイル独立で fingerprinted → canonical retry                                                                                                  | 各サイズは dist 直下の C3 出力と同 |
| `dist/review-request.mjs`                                                                        | C4   | Node 実行可能、shebang 付き、`embed-template.html` / `mermaid.mjs` / `dist/katex/*` を読む                                                                                                                                                                                                                                         | —                                  |

**`mdxg-split-outputs` plugin**: viteSingleFile が中間出力 `dist/review.html` を生成した後、本 plugin の closeBundle が走る。Rollup / Vite の `closeBundle` は parallel hook で plugin 間順序が保証されないため、grammar JSON emit / Mermaid・KaTeX runtime のコピー emit (Shiki bundled 全言語 約 235 個 × 3 系統 + Mermaid × 2 系統 + KaTeX 3 ファイル × 2 系統) も本 plugin の closeBundle 内で逐次実行する (`mdxg-shiki-aliases` plugin は `src/core/shiki-aliases.generated.ts` の再生成のみを buildStart で行い、grammar emit は持たない)。役割は次の 9 点：

1. `emitGrammarJsonFiles()` で Shiki bundled 全言語の grammar JSON を生成。生成前に 3 ディレクトリ (`dist/shiki-langs/` / `dist/hosting/canonical/shiki-langs/` / `dist/hosting/fingerprinted/shiki-langs/`) を `rm({recursive,force})` で clean し、shiki package 更新時の hash 蓄積と SPEC_LANGS 縮小時の孤立ファイルを構造的に排除する。grammar の content hash (SHA-256 先頭 8 桁) を URL に焼き込み、`dist/hosting/fingerprinted/shiki-langs/<lang>.<hash>.json` (immutable cache 対象) / `dist/hosting/canonical/shiki-langs/<lang>.json` (新 deploy 過渡期の 404 retry 先) / `dist/shiki-langs/<lang>.json` (CLI 配布物用、 dist 直下の従来パス) の **3 系統** に同時 emit、戻り値の `AssetEmission` payload の `shikiLangs` フィールドを埋める
2. `emitMermaidRuntimeFiles()` で C2 出力 `dist/mermaid.mjs` を読み、SHA-256 先頭 8 桁の content hash を計算したうえで `dist/hosting/fingerprinted/mermaid.<hash>.mjs` (immutable cache 対象) と `dist/hosting/canonical/mermaid.mjs` (load failure retry 先) の **2 系統** に同時 emit。 dist 直下の `dist/mermaid.mjs` は C2 ステップが既に書いているのでここでは触らない (CLI / standalone build 用の素材としてそのまま利用)。 `AssetEmission` payload の `mermaid` フィールドを埋める
3. `emitKatexAssetFiles()` で C3 出力 3 ファイル (`dist/katex/katex.mjs` / `dist/katex/katex.css` / `dist/katex/katex-fonts-extra.css`) を読み、ファイルごとに hash を計算して `dist/hosting/fingerprinted/katex/katex.<hash>.{mjs,css}` + `dist/hosting/fingerprinted/katex/katex-fonts-extra.<hash>.css` と `dist/hosting/canonical/katex/` 配下の no-hash 版を **2 系統** に同時 emit。 JS は `import()` ベース・CSS / fonts-extra は `fetch()` ベースなので 3 ファイル独立で fingerprinted → canonical retry できる。 `AssetEmission` payload の `katex` フィールドを `{ js, css, fontsExtraCss }` で埋める
4. `dist/shiki-langs/*.json` を全部読んで grammar の `Record<lang, json>` を組み立て、中間出力 `dist/review.html` の `<script id="embedded-shiki-langs">` に inline
5. `dist/mermaid.mjs` が存在すれば読み込み、`</script>` を `<\/script>` に escape したうえで `<script id="embedded-mermaid" type="module">` に inline（不在時は stderr に警告を出して skip し、Shiki ハイライト fallback のみが残る形で `dist/standalone.html` を書き出す）
6. `dist/katex/katex.mjs` / `dist/katex/katex.css` / `dist/katex/katex-fonts-extra.css` の 3 ファイルが揃っていれば読み込み、`<script id="embedded-katex" type="module">` / `<style id="embedded-katex-css">` / `<style id="embedded-katex-fonts-extra-css">` に inline する（standalone は `--math-fonts all` 相当固定、DESIGN.md §12 §14 Math Rendering / `docs/archive/mdxg-math-rendering.archive.md` §5.k）。いずれかが ENOENT のときは stderr に警告を出して skip し、raw `$...$` plain text fallback のみが残る形で書き出す
7. `dist/standalone.html` から `buildOnlineHtml(standaloneHtml, { allowlist, manifest })` で `dist/hosting/index.html` を派生 (Pages 慣習に合わせて `online.html` → `index.html` リネーム、archive 化された `docs/archive/feature-online-runtime-assets.archive.md` Step 4 の C 設計判断)。次の 8 mutation を apply: (a) `<html data-mdxg-online="1">` upsert、(b) CSP `connect-src 'none'` → `connect-src 'self' <allowlist origins>` 置換 (`'self'` は同一オリジン同梱資材 fetch / dynamic import 用、DESIGN.md §11.b)、(c) `<script id="online-allowlist">` JSON 注入、(d) `<script id="online-asset-manifest">` JSON 注入 (manifest 経由で loader が fingerprinted パスを解決、archive doc §3.2)、(e) `<script id="embedded-shiki-langs">` の textContent を空 `{}` に上書き、(f) `<script id="embedded-mermaid">` の textContent を空に上書き、(g) `<script id="embedded-katex">` の textContent を空に上書き、(h) `<style id="embedded-katex-css">` / `<style id="embedded-katex-fonts-extra-css">` の textContent を空に上書き (素材契約として block 不在は fail-fast、Shiki と対称)。これにより `dist/hosting/index.html` が「最小 shell」となり、必要なアセットはすべて runtime fetch / dynamic import で動的取得される。allowlist は `buildOnlineAllowlist(process.env)` で env var `MDXG_ONLINE_CONNECT_SRC` を読んで正規化、解決済み allowlist を stdout に emit して build 再現性を保証する
8. `buildOnlineHeadersFile(onlineHtml)` で `dist/hosting/_headers` を emit（Cloudflare Pages 用静的設定。 index.html の meta CSP と HTTP header CSP は `extractCspContent(onlineHtml)` 経由で single source of truth、DESIGN.md §11.b）。`_headers` の Cache-Control は path 単位で 3 分離: `/` / `/index.html` は `max-age=300`、`/fingerprinted/*` は `immutable, max-age=31536000`、`/canonical/*` は `max-age=300`。 `_redirects` は不要 (Pages が `/` request に対して自動的に `index.html` を返すため)
9. 中間出力 `dist/review.html` を `dist/embed-template.html` にリネーム（こちらは grammar / Mermaid / KaTeX いずれも注入なし、CLI が `--shiki-langs` / `--mermaid` / `--math` / `--math-fonts` モードに応じて動的に注入する）

なお `dist/mermaid.mjs` と `dist/katex/*` は `vite.mermaid.config.ts` / `vite.katex.config.ts` / `scripts/build-katex-css.ts` 側で別途生成されるため、`npm run build` script は `vp build --config vite.mermaid.config.ts && vp build --config vite.katex.config.ts && node scripts/build-katex-css.ts && vp build && vp build --config vite.review-request.config.ts` の順で実行する（mermaid → katex → standalone inline → CLI bundle の依存順）。

**配布物サイズの変動**: dist 直下 / hosting の各成果物サイズは上の成果物表を参照（いずれも概数）。CLI 生成 `*-review.html` のサイズは `--mermaid` / `--math` / `--math-fonts` の組合せで段階的に変動する（典型は `--math off` で baseline ~99 KB gzipped、`--math auto --math-fonts minimal` 注入で ~346 KB gzipped、`--math-fonts all` 注入で ~440 KB gzipped）。「数式を含まない markdown はサイズが baseline と変わらず、含む markdown だけ自動で runtime が乗る」配布物サイズ最適化の核となる挙動 (DESIGN.md §12 §14 / §15 / §3 `--mermaid` / `--math`)。

設計判断として `vite.standalone.config.ts` を別ファイル化する案も検討したが、独立 plugin 1 個で完結することと、grammar JSON の生成順序依存を 1 つの vite build 内で satisfied にできる利点から、同一 config 内に統合した。

**ランタイム素材の多重生成を許容する根拠**: build 後の `dist/` 配下では Shiki grammar / Mermaid runtime / KaTeX 3 ファイルがそれぞれ **CLI 配布物用 (dist 直下) + online edition の fingerprinted + canonical + standalone への inline** の最大 4 系統に同じ内容で展開される (上の split-outputs plugin 役割 1-3)。DRY ではないが、すべて同じ build pipeline (`emitGrammarJsonFiles()` / `emitMermaidRuntimeFiles()` / `emitKatexAssetFiles()`) の単一呼び出しから生成され、毎 build 冒頭で hosting/fingerprinted ディレクトリを clean してから書き出すため drift は構造的に起こらない。 dist 直下 (CLI / Releases 配布用) と `dist/hosting/` (Pages 配信用 subset) の境界が物理的に明確 (Pages の Build output directory に `dist/hosting` を指定する設計、archive 化された `docs/archive/feature-online-runtime-assets.archive.md` Step 4)。 standalone は `file://` での fetch path 制約と CSP `connect-src 'none'` を保つため inline 維持、online edition だけが `connect-src 'self'` を許可して runtime fetch / dynamic import する分岐構造（同 archive doc）。symlink 案は Windows / npm publish 互換性が落ちるため不採用。

**両 HTML の構造的不変条件**: `dist/standalone.html` と `dist/embed-template.html` は共通の `src/review.html` を入力に派生するため、`<script id="embedded-md">` / `<script id="embedded-feedback">` / `<script id="embedded-shiki-langs">` / `<script id="embedded-mermaid">` / `<script id="embedded-katex">` / `<style id="embedded-katex-css">` / `<style id="embedded-katex-fonts-extra-css">` / `<meta http-equiv="Content-Security-Policy">` などの構造的タグ位置はすべて同一に保つ。standalone.html では `<script id="embedded-md">` が空のままだが、ブロック自体を残すことで `boot.ts` の起動シーケンス（DESIGN.md §9）が両 HTML で共通経路を辿れる。standalone.html から空ブロックを削除する変更は構造分岐を生むため避ける。

**online edition の hosting 制約 (Cloudflare Pages を第 1 候補とする理由)**: online edition の deploy 先には次の 2 つの hosting 側制約への適合が要求される: (1) **HTTP CSP header カスタマイズ可能** (`_headers` ファイル等で hosting 側が `Content-Security-Policy` header を返せる) — meta CSP と HTTP header CSP の二重設定 (DESIGN.md §11.b) で hosting 側 server config による剥がし事故を防ぐ必須要件、(2) **per-file 1 MiB 超のアセット配信** — Cloudflare Pages の per-file 制限は 25 MiB で、Phase A 完了時の `dist/hosting/index.html` 4.16 MiB / Mermaid runtime 3.1 MiB / KaTeX assets 計 607 KiB すべてが収まる。GitHub Pages は (1) の HTTP header カスタマイズが不可、Vercel / Netlify は (1)(2) ともに Cloudflare Pages と同等だが運用実績で第 1 候補にしない。`docs/archive/feature-online-runtime-assets.archive.md` Step 1-6 の段階では online edition を「standalone と同等の依存内容物 (~48 MB)」で配布する設計だったが、Cloudflare Pages の per-file 25 MiB 制限に抵触し deploy 失敗、同 Step 8 で「最小 shell + runtime 動的注入」設計に反転した経緯がある。**現在の `dist/hosting/index.html` 402 KiB / gzip 124 KiB は per-file 制限に対する余裕ではなくスマートフォン回線での初回 download UX 要件 (gzip ~200 KiB 以下) からの逆算値** で、hosting 制約の物理上限まで使い切る設計ではない。

## ビルドの責務分担

各 config の役割を要約する。`mdxg-split-outputs` plugin の処理内容は上の「全体像」の 9 ステップを正典とし、ここでは入口を示すに留める。

**standalone.html / embed-template.html 用（`vite.config.ts`）**

| レイヤー                    | ツール                 | 役割                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript 型チェック・変換 | `tsc`（vite 経由）     | TS → JS 変換、型エラー検出                                                                                                                                                                                                                                                                                                                               |
| バンドル                    | Rolldown（Vite 内蔵）  | `src/app/review.ts` を入口に `app/` 配下と `core/` 配下 + npm 依存 (`marked`) を 1 つの JS チャンクに統合                                                                                                                                                                                                                                                |
| HTML 処理                   | Vite                   | `<script type="module" src="./app/review.ts">` と `<link rel="stylesheet" href="./styles/*.css">`（src 内相対）を bundle 結果への参照に書き換え                                                                                                                                                                                                          |
| CSS bundle                  | Vite                   | `src/styles/*.css` (review.css + markdown.css) を CSS チャンクに統合                                                                                                                                                                                                                                                                                     |
| inline 化                   | vite-plugin-singlefile | bundle された JS チャンク・CSS を `<script>` / `<style>` として HTML 内に inline                                                                                                                                                                                                                                                                         |
| Shiki aliases 再生成        | mdxg-shiki-aliases     | buildStart で `src/core/shiki-aliases.generated.ts` を再生成。**grammar JSON の emit はこの plugin では行わない** (closeBundle parallel race を避けるため `mdxg-split-outputs` に集約)。共通ロジックは `scripts/lib/shiki-meta.ts`                                                                                                                       |
| 出力分岐                    | mdxg-split-outputs     | closeBundle 内で逐次 await: grammar JSON を 3 系統 emit → Mermaid / KaTeX runtime を hosting に hash 焼き込み 2 系統 emit → standalone へ各 embed inline → standalone から online (`dist/hosting/index.html`) を 8 mutation で派生 → `_headers` emit → 中間出力を `dist/embed-template.html` にリネーム。各ステップの詳細は「全体像」の 9 ステップを参照 |

**Mermaid runtime 用（`vite.mermaid.config.ts`）**

| レイヤー    | ツール                | 役割                                                                                                                                                                                                                                                     |
| ----------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| バンドル    | Rolldown（Vite 内蔵） | `src/mermaid-entry.ts` を入口に `mermaid` npm パッケージを 1 つの ESM (`dist/mermaid.mjs`) に統合。Mermaid 公式 ESM が持つ大量の動的 `import()` を `codeSplitting: false` で全部本体に inline する                                                       |
| bridge 追記 | エントリソース        | `src/mermaid-entry.ts` 末尾で `globalThis.__mdxgMermaid = mermaid; document.dispatchEvent(new Event('mdxg:mermaid-ready'))` を実行。bundle 出力末尾にこの bridge が焼き込まれるため、CLI / build plugin 側は `</script>` escape のみで HTML に貼り込める |
| ターゲット  | es2020                | ブラウザの `<script type="module">` 内で実行される水準（Node ターゲットではない）                                                                                                                                                                        |

**KaTeX runtime 用（`vite.katex.config.ts` + `scripts/build-katex-css.ts`）**

| レイヤー    | ツール                            | 役割                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| バンドル    | Rolldown（Vite 内蔵）             | `src/katex-entry.ts` を入口に `katex` npm パッケージを 1 つの ESM (`dist/katex/katex.mjs`) に統合。`build.minify: 'esbuild'` で raw 600 KB → ~260 KB / gzip ~77 KB まで圧縮                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| bridge 追記 | エントリソース                    | `src/katex-entry.ts` 末尾で `globalThis.__mdxgKatex = katex; document.dispatchEvent(new Event('mdxg:katex-ready'))` を実行。Mermaid と同じ規約で bundle 末尾に bridge を焼き込む                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| CSS 生成    | scripts/build-katex-css.ts (Node) | `katex/dist/katex.min.css` を読み、`@font-face url(fonts/*.woff2)` を `url(data:font/woff2;base64,...)` に書き換え、`url(*.ttf)` / `url(*.woff)` は `local("")` (CSS Level 3 仕様で常に miss、次の src へフォールスルー) に潰して woff2 へ収束させる。 旧設計の `url(about:blank)` は CSP `font-src data:` の評価で 1 つ目の試行が block され Console violation noise を出すため不採用。family root 名で 2 系統に分離: `dist/katex/katex.css` (minimal = 9 family + 全 `.katex` ルール) と `dist/katex/katex-fonts-extra.css` (extra 11 family の `@font-face` のみ)。冒頭で KaTeX version (`0.17.0`) を assert し、想定外バージョンで build を fail させる。バージョン更新時はアーカイブ doc を参照せずとも済むよう、`build-katex-css.ts` 冒頭に再評価チェックリスト（1.`trust:false` セキュリティ境界 / 2.フォントセット / 3.`renderToString` API 契約 / 4.`</script>` sanity）を inline 済み |
| ターゲット  | es2020                            | ブラウザの `<script type="module">` 内で実行される (Mermaid と同じ水準)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

**review-request CLI 用（`vite.review-request.config.ts`）**

| レイヤー        | ツール                | 役割                                                                                                                                                                                                                               |
| --------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| バンドル        | Rolldown（Vite 内蔵） | `src/cli/review-request.ts` を入口に `src/cli/*.ts` と `src/core/embed.ts` + `src/core/filename-sanitize.ts` + `src/core/math.ts` を 1 つの ESM (`dist/review-request.mjs`) に統合。Node 組み込みモジュール (`node:*`) は external |
| Node ターゲット | Vite SSR mode         | Node 24+ をターゲットにし、`process` / `fs/promises` / `path` / `url` 等の Node API をそのまま参照する形で出力                                                                                                                     |
| shebang 保持    | Rolldown 標準挙動     | `src/cli/review-request.ts` 冒頭の `#!/usr/bin/env node` を出力先に保持し、`chmod +x` 不要で実行可能な状態にする                                                                                                                   |

ランタイム（`dist/standalone.html` / CLI が生成する `*-review.html`）は Vite / Rolldown を一切知らない。出力 HTML は通常の `<script>` を含むだけ。`dist/review-request.mjs` も Node 標準 ESM として直接実行できる。

## テスト

主要な TypeScript ソースは **in-source testing** を採用する。実装と同じファイル末尾に `if (import.meta.vitest)` ブロックでテストを併記し、`vite.config.ts` の `test.includeSource` でビルド時に分離 → `vp test` で実行する。pure module の境界条件 (型ガード / オフセット計算 / state 集約 / 引数パース 等) を、実装と物理的に隣接させて drift を抑える設計判断。DOM / ブラウザ API に依存するランタイム挙動は happy-dom 環境のテストで補う。テスト対象ファイルの具体的な列挙は実装側の `import.meta.vitest` 出現箇所を grep するのが一次情報源で、本ドキュメントでは追わない。

## `vite-plugin-singlefile` の挙動

- emit された JS バンドル（自前コード + `marked`）と CSS は `<script>` / `<style>` として HTML 内に inline
- HTML 内に直接書かれた `<script id="embedded-md" type="text/markdown">` や `<script id="embedded-feedback" type="application/json">` は **触られない**（`type` がモジュールではないため Vite の処理対象外）
- `src/review.html` には外部 CDN への `<link>` / `<script src="https://...">` を含まない。`<head>` の `<link rel="stylesheet" href="./styles/review.css">` / `<link rel="stylesheet" href="./styles/markdown.css">` も bundle 結果に inline される
- 配布物 `dist/standalone.html` と `dist/embed-template.html` はどちらも **起動に必要なものをすべて内包し、外部依存ゼロ** で動作する

## HTML minify 無効維持と CI スモークテスト指針

review-request CLI は `dist/embed-template.html` の `<script id="embedded-md" type="text/markdown">` を正規表現で書き換える方式を採っているため、HTML minify を有効化して属性順や空白を変えると `core/embed.ts` の `EMBEDDED_MD_RE` (`id="embedded-md"` と `type="text/markdown"` の両方を lookahead で要求) が脆くなる。属性順の揺らぎは lookahead で吸収しているが、属性自体が削除される minify は救済できない。**HTML minify は将来も無効のまま維持する** ことで、CLI 側の保守コストを増やさずに rewrite の安定性を確保する。`mdxg-split-outputs` plugin が `dist/standalone.html` を生成する際も同じ `<script id="embedded-shiki-langs">` への正規表現マッチに依存するため、両 HTML 共通の不変条件としても効く。

将来 CI を強化する場合は、ビルド後の `dist/embed-template.html` と `dist/standalone.html` の両方に **`id="embedded-md"` と `type="text/markdown"` を併せ持つ `<script>` タグが含まれていること**、および `dist/standalone.html` に `<script id="embedded-shiki-langs">` が空でないこと、をスモークテストで検査するのが望ましい（`core/embed.ts` の前提と `splitOutputsPlugin` の不変条件を守るため）。現状は in-source test が dist 配下の構造を直接検査していないため、配布前の手作業確認に依存している。

## i18n 経路の責務分離

CLI と HTML は **言語決定について疎結合に保つ**（[i18n.md §14.1 / §14.3](./i18n.md#143-言語決定の優先順位)）。CLI は HTML への lang 関連属性 (旧設計案の `<html data-lang-init>` 等) を一切埋め込まず、HTML 側は `localStorage > navigator.language > 'en'` で独立に決定する。`src/cli/compose-review-html.ts` の rewrite チェーンには lang 関連の upsert を追加せず、CLI 自身の `--lang`（i18n.md §14.4）は `setCliLang` 経由で stdout / stderr / help 出力にのみ作用させる。

辞書も **CLI bundle と HTML bundle で物理分割** する（i18n.md §14.2）：

- CLI bundle (`dist/review-request.mjs`) は `src/cli/i18n/messages-cli.{en,ja}.ts` (`cli.*` 約 36 entry) のみ import
- HTML bundle (`dist/standalone.html` / `dist/embed-template.html` / `dist/hosting/index.html`) は `src/app/i18n/messages.{en,ja}.ts` (UI 辞書 約 170 entry、`online.*` / `footnote.*` 含む) のみ import

それぞれ独立した import tree なので bundle 重複なし。`dist/hosting/index.html` は `dist/standalone.html` から派生 (`buildOnlineHtml`、上の `mdxg-split-outputs` plugin の手順 7) するため、UI 辞書は派生元に既に inline 済みで online 派生処理での辞書再 inject は不要。

## ソース構成の責務境界

`src/` 配下は 3 層に分かれ、依存方向は `core ← app` / `core ← cli` の一方向のみ：

- **`src/core/`** — 環境非依存の pure module。Node CLI / ブラウザ双方から import される（markdown / block-anchors / page-split / page-outline / slugify / search / embed / escape / feedback / filename-sanitize / review-export / scan-fenced-langs / scan-mermaid / math / footnotes / shiki-aliases.generated / types / `i18n/i18n-core`）
- **`src/app/`** — Browser DOM / Web API 専用のランタイム。直下に entry の `review.ts` / `boot.ts` を置き、残りは機能クラスタ単位のサブディレクトリに分割する：
  - `state/` — `app-state`
  - `dom/` — `dom-utils` / `dialog` / `menu` / `text-range` / `text-segment-skip-rules`
  - `document/` — `doc-mount` / `doc-renderer` / `block-cache` / `code-copy-wrap` / `pages` / `scroll` / `scroll-spy`
  - `comments/` — `comments` / `comment-modal` / `comments-resize` / `comments-width` / `mark-engine` / `selection` / `floater`
  - `navigation/` — `page-navigation` / `page-scroll-spy` / `page-nav-resize` / `page-nav-width` / `keyboard-shortcuts`
  - `renderers/` — `shiki` / `shiki-upgrade` / `mermaid` / `mermaid-modal` / `katex` / `upgrade-utils`
  - `chrome/` — `toolbar` / `theme` / `sidebar-resize` / `help-modal`
  - `layout/` — `sidebar-width`
  - `workspace/` — `workspace` / `workspace-fs` / `storage`
  - `search/` — `search`
- **`src/cli/`** — Node CLI 専用（review-request エントリ / arg-spec / parse-args（dispatch）/ parse-clean-args / parse-run-args / clean / input-source / open-command / serve / assets/{shiki,mermaid,katex,resume-feedback}）

エントリ素材は `src/review.html` / `src/styles/*.css` / `src/mermaid-entry.ts` (vite.mermaid.config.ts の入口、`globalThis.__mdxgMermaid` bridge をエクスポート) / `src/katex-entry.ts` (vite.katex.config.ts の入口、`globalThis.__mdxgKatex` bridge をエクスポート)。`scripts/build-katex-css.ts` は KaTeX CSS のフォント data URI 化 + minimal / extra 分離を行う Node スクリプト (`scripts/lib/shiki-meta.ts` と同じ「ビルドツール側で完結する pure な変換」の位置付け)。`app` / `cli` の型を `core` に持ち込まない。`dist/` 配下（`standalone.html` / `embed-template.html` / `review-request.mjs` / `shiki-langs/*.json` / `mermaid.mjs` / `katex/katex.mjs` / `katex/katex.css` / `katex/katex-fonts-extra.css`）は `vp build` / `node scripts/build-katex-css.ts` の生成物で、commit 対象だが手では編集しない。
