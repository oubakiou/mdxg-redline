# オンライン版ミニマル shell + 動的アセット注入 設計・実装計画

DESIGN.md §3 入力 / §9 起動シーケンス / §11.b CSP / §13 ビルドパイプライン に対応するための、オンライン版 (`dist/online.html`) の **「ミニマル shell + runtime 動的 fetch」** 化の設計判断と実装手順をまとめる。完了時点で本ドキュメントは `docs/archive/feature-online-runtime-assets.archive.md` にアーカイブされ、DESIGN.md §3 / §9 / §11.b / §13 の対応箇所が新方針で書き直される想定。

経緯と Step 1–7 の継承関係は [`docs/feature-online-edition.md`](./feature-online-edition.md) §8 を参照。本ドキュメントは §8 で告知された方針反転を **独立した実装計画** として書き起こす。

## 1. 対応スコープ

`dist/online.html` の現状サイズ (~46.6 MiB raw) を Cloudflare Pages の per-file 25 MiB 制限内に収め、かつスマートフォン回線でも実用に耐える初回 download size に縮めることが本プランの主目的。

| 要件                                                                                                     | 現状 | 完了条件                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [MUST] `dist/online.html` を Cloudflare Pages の **per-file 25 MiB 制限内** に収める                     | ✗    | `npm run build` 後の `dist/online.html` が 25 MiB 未満（Phase A 単独で達成）                                                                                                                                   |
| [MUST] スマートフォン初回 download を **gzip ~200 KB 以下** に                                           | ✗    | Phase A+B+C 完了で `dist/online.html` が gzip 200 KB 以下                                                                                                                                                      |
| [MUST] 「数式 / Mermaid を含まない markdown はアセット fetch ゼロ」を保証                                | ✗    | `scanFencedLangs` が `[]`、`scanMermaidFences` が `0`、`countMath` が `{ inline: 0, display: 0 }` を返すケースで `loadOnlineAssets` が `fetch` / `import()` を発火させない                                     |
| [MUST] 既存 Step 2–5 のコードが回帰しない                                                                | ✓    | `core/online-url.ts` / boot.ts の `?url=` 経路 / UI 層 (Open URL modal / Source link / error UI) はそのまま動く                                                                                                |
| [MUST] 同一オリジン fetch を CSP で許可する `connect-src 'self'` を追加                                  | ✗    | `dist/online.html` の `<meta CSP>` と `_headers` の HTTP header CSP の両方に `connect-src 'self'` が含まれる（single source of truth）                                                                         |
| [MUST] fetch 失敗時の **個別エラー graceful degradation**                                                | ✗    | Shiki 1 言語の fetch 失敗で他言語の grammar はそのまま載り、その言語のフェンスコードは plain text fallback。Mermaid 失敗で KaTeX は動作                                                                        |
| [SHOULD] **silent + progressive upgrade** の UX                                                          | ✗    | `loadOnlineAssets` 中もブロックせずに plain text 描画を進め、bridges 立つ順に Shiki ハイライト → Mermaid SVG → KaTeX 数式と順次 upgrade                                                                        |
| [MUST] 同一 URL の再 load で **実 fetch を回避** (HTTP cache + immutable hash 経由)                      | ✗    | manifest 経由 hash 付き URL に `Cache-Control: max-age=31536000, immutable` が付与、`?url=` 再 submit + reload でも browser HTTP cache から返り実 fetch ゼロ (Item 4 対応)                                     |
| [SHOULD] 同一 session の **Open file 経路** で in-memory cache が効く                                    | ✗    | Open file で別 markdown を読んだ際、既ロードの grammar は in-memory Set / Flag で fetch skip。reload で破棄される性質は HTTP cache 経路で補完される (Item 4 対応)                                              |
| [SHOULD] **asset failure を markdown 描画後にも通知** できる                                             | ✗    | `#online-source` (Source link 行) を 2 段構成に拡張し asset status を永続表示。markdown 描画後は既存 `#empty-state-online-error` が CSS で hide されるため empty-state は使えない (Item 1 対応、§5.l)          |
| [MUST] **deploy 世代ずれの過渡期で online edition が壊れない**                                           | ✗    | 古い HTML cache + 古い manifest + 古い hash 付き URL の組み合わせでも online edition が動く。canonical no-hash copy の常時 emit + loader の 404 retry + HTML max-age 短縮の 3 段 fail-safe (Item 5 対応、§5.i) |
| [SHOULD] CLI auto モード (`--shiki-langs auto` / `--mermaid auto` / `--math auto`) との **挙動の対称性** | ✗    | scan 関数 (`core/scan-fenced-langs.ts` / `core/scan-mermaid.ts` / `core/math.ts countMath`) を browser runtime で再利用、CLI auto と挙動の差分は「タイミング (build vs runtime)」のみ                          |

追加実装（要件外だが UX 上有用）：

- asset partial failure は `#online-source` の 2 段目に `Assets: X/Y loaded · Z failed` を永続表示、click で詳細 modal (§5.l)
- markdown 読み込み中の最小 spinner や toast は出さない（silent 方針、status 行は完了後に出る）
- `MDXG_ONLINE_CONNECT_SRC` env var で追加 allowlist origin を指定する経路は既存維持（同一オリジン `'self'` とは別軸）

スコープ外（別タスクで扱う / 意図的に割り切る）：

- **iframe / cross-origin での online.html 利用**: hosting origin = asset origin の前提を維持（assets は同一オリジン同梱のため）
- **Service Worker でのアセット pre-cache**: Phase A+B+C 完了後の最適化として別途検討
- **Mermaid / KaTeX の分割注入** (例: KaTeX font だけ別 fetch): Phase C は runtime 1 ファイルでの注入を採用し、内部 chunk 分割は scope 外
- **CLI 経路への動的 fetch 適用**: CLI は build 時 inline の現行設計を維持（auto モード自体は build 時に動く、本プランの runtime fetch は online edition 専用）

## 2. リファレンス実装と差分

「読み込み markdown の内容に応じて必要なランタイムを動的注入する」設計は、**本プロジェクト内に既に CLI auto モードという同等の前例** がある：

1. **`--shiki-langs auto`** — `parse-run-args.ts` が markdown を `marked.lexer` で前処理し、`scanFencedLangs` で出現フェンス言語を抽出 → 必要な grammar JSON のみ build 時に `<script id="embedded-shiki-langs">` に inline
2. **`--mermaid auto`** — `scanMermaidFences(text) > 0` (戻り値 `number`) で Mermaid runtime (`dist/mermaid.mjs`) を `<script id="embedded-mermaid">` に inline
3. **`--math auto`** — `const m = countMath(text); (m.inline + m.display) > 0` (戻り値 `{ inline, display }`) で KaTeX runtime (`dist/katex/katex.mjs`) と CSS を `<script id="embedded-katex">` / `<style id="embedded-katex-css">` に inline

本実装はこれを **runtime に持ち上げる**：CLI が build 時に行う「scan → 必要分 inline」を、ブラウザの起動シーケンスで「scan → 必要分 fetch → bridges に merge」に置き換える。

| CLI auto モード (build 時)                                         | 本実装 (runtime)                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `parse-run-args.ts` が markdown を `marked.lexer` で前処理         | `src/app/online/asset-loader.ts` (新規) が markdown 文字列を受け取って scan                                                                                                                                                                                                          |
| `core/scan-fenced-langs.ts` をそのまま呼ぶ                         | 同じ関数を browser runtime で再利用                                                                                                                                                                                                                                                  |
| 必要 grammar を `<script id="embedded-shiki-langs">` に **inline** | 必要 grammar を `/fingerprinted/shiki-langs/<lang>.<hash>.json` から **並行 fetch** → `installShikiGrammars(grammars)` で `<script id="embedded-shiki-langs">` の textContent を merge update + `cachedHighlighter = false` reset (§3.3 で確定、Shiki に bridge global は存在しない) |
| Mermaid runtime を `<script>` に inline                            | `await import('/mermaid.mjs')` で dynamic import → bridge コードが自動発火                                                                                                                                                                                                           |
| KaTeX runtime / CSS を inline                                      | `import('/katex/katex.mjs')` + `fetch('/katex/katex.css').then(style.textContent = css)`                                                                                                                                                                                             |
| 失敗ケースはなし（build 失敗 = エラー）                            | `Promise.allSettled` で個別エラー許容、未取得アセットの該当ブロックは plain text fallback                                                                                                                                                                                            |

CLI auto との **核となる差分は 1 点のみ**：scan のタイミングが「build 時 (CLI)」か「runtime 起動時 (online edition)」か。scan 関数自体は `src/core/` に集約された既存 pure 関数を共通で呼ぶため、ロジックの DRY は維持される。

他主要 SPA フレームワーク (Next.js `dynamic` / React.lazy 等) は code splitting + lazy load を提供するが、本実装は **単一 HTML + 外部依存ゼロ + 同一オリジン同梱** の制約を継承するため、bundler 統合の lazy load ではなく **plain `fetch` / `import()` + bridges merge** という素朴な経路を採る。

## 3. 設計の中核要素

### 3.1 配布物の差分

| 配布物                     | 全 grammar inline     | Mermaid inline         | KaTeX inline           | size (raw)       | size (gzip)      |
| -------------------------- | --------------------- | ---------------------- | ---------------------- | ---------------- | ---------------- |
| `dist/standalone.html`     | ✓ (現状維持)          | ✓                      | ✓                      | ~48 MiB          | ~6.9 MiB         |
| `dist/embed-template.html` | ✗ (CLI 注入)          | ✗                      | ✗                      | ~334 KiB         | ~101 KiB         |
| `dist/online.html` (新)    | **✗ (runtime fetch)** | **✗ (dynamic import)** | **✗ (dynamic import)** | **~300–500 KiB** | **~100–150 KiB** |

外部資材は **同一オリジン同梱** (Step 3 で既に build artifact として emit 済み)：

- `/shiki-langs/<lang>.json` (~235 ファイル、各 50–200 KiB raw / 各 gzip 10–50 KiB)
- `/mermaid.mjs` (~3.1 MiB raw / gzip ~860 KiB)
- `/katex/katex.mjs` (~260 KiB / gzip ~77 KiB)
- `/katex/katex.css` (~242 KiB / gzip ~171 KiB)
- `/katex/katex-fonts-extra.css` (~128 KiB / gzip ~95 KiB)

`dist/online.html` の `<script id="embedded-shiki-langs">` / `<script id="embedded-mermaid">` / `<script id="embedded-katex">` / `<style id="embedded-katex-css">` / `<style id="embedded-katex-fonts-extra-css">` の各ブロックは **空のまま** build される（embed-template.html と同じ shape）。

### 3.2 `loadOnlineAssets` プロトコル + asset manifest

`src/app/online/asset-loader.ts` (新規) が次のシグネチャで提供：

```ts
export const loadOnlineAssets = async (
  markdown: string,
  baseUrl: URL,
  cache: OnlineAssetCache
): Promise<OnlineAssetLoadResult>
```

| 引数 / 戻り値                  | 型 / 内容                                                                                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `markdown`                     | fetch / Open file で取得した markdown 本文（scan 対象）                                                                                                                                                                   |
| `baseUrl`                      | `document.baseURI` 相当 (§5.h)。manifest 経由で解決した asset URL の base                                                                                                                                                 |
| `cache`                        | 既に load 済みのアセットを追跡する in-memory state (`{ langs: Set<SupportedLang>, mermaid: boolean, katex: boolean, generation: number, currentAbortController, inFlight }`)。 呼び出し側 (decorator) が確保した instance |
| 戻り値 `OnlineAssetLoadResult` | `{ loadedLangs: SupportedLang[]; mermaidLoaded: boolean; katexLoaded: boolean; failures: AssetLoadFailure[]; generation: number }`                                                                                        |

#### asset manifest (build 時生成 / runtime 解決)

build 時に content hash を URL に焼き込むため (CDN cache busting、§5.i)、`<lang>.<hash>.json` / `mermaid.<hash>.mjs` 等の hash 入りファイル名と canonical 名の対応表を **manifest** として持つ。loader は起動時に 1 度 manifest を parse して URL を解決する：

```html
<!-- online.html の <head> に build 時 inline (既存の <script id="online-allowlist"> と同じ規約) -->
<script type="application/json" id="online-asset-manifest">
  {
    "shikiLangs": {
      "typescript": "fingerprinted/shiki-langs/typescript.abcd1234.json",
      "javascript": "fingerprinted/shiki-langs/javascript.ef567890.json"
    },
    "mermaid": "fingerprinted/mermaid.fedcba98.mjs",
    "katex": {
      "js": "fingerprinted/katex/katex.11223344.mjs",
      "css": "fingerprinted/katex/katex.55667788.css",
      "fontsExtraCss": "fingerprinted/katex/katex-fonts-extra.99aabbcc.css"
    }
  }
</script>
```

manifest 内の path は **fingerprinted 配下** (immutable cache 対象、§5.i Item 1 / 3)。404 retry 時の **canonical 配下** は loader が path 規則 (`fingerprinted/X` → `canonical/X` で `<hash>.` を strip) で導出するか、manifest 内に明示する。本プランは前者 (path 規則で導出) を採用してデータ重複を避ける。

`src/core/online-asset-manifest.ts` (新規 pure 関数) で manifest を parse + 型ガード：

```ts
export interface OnlineAssetManifest {
  shikiLangs: Readonly<Partial<Record<SupportedLang, string>>>
  mermaid: string | null
  katex: { js: string; css: string; fontsExtraCss: string } | null
}
export const parseOnlineAssetManifest = (json: string): OnlineAssetManifest
export const resolveShikiLangPath = (manifest: OnlineAssetManifest, lang: SupportedLang): string
// fingerprinted パス: manifest 内の path を直接返す
// canonical パス (404 retry 先): resolveCanonicalShikiLangPath(lang) → `canonical/shiki-langs/<lang>.json` を返す
export const resolveCanonicalShikiLangPath = (lang: SupportedLang): string
// Mermaid / KaTeX も同様: resolveCanonicalMermaidPath() / resolveCanonicalKatexPaths()
// manifest 自体が欠落 / 壊れていれば各 resolve が canonical path を返す (manifest 欠落 fail-safe)
```

asset-loader は起動時に `document.getElementById('online-asset-manifest')` を 1 度読み、parse 結果を module-private にキャッシュ。manifest が欠落 / 壊れている場合は **fail-safe で canonical パス** (`canonical/shiki-langs/<lang>.json`、`canonical/mermaid.mjs` 等) に fallback し、警告を `console.warn` で 1 回出す (新規 deploy 後の古い HTML キャッシュとの過渡期を救う)。

内部処理：

1. 起動時 1 度: `<script id="online-asset-manifest">` を parse → module cache
2. `scanFencedLangs(markdown)` → `ALIAS_TO_CANONICAL` で正規化 → 未読み込み subset を抽出
3. `scanMermaidFences(markdown) > 0 && !cache.mermaid` で Mermaid 必要性を判定 (`scanMermaidFences` は ` ```mermaid ` ブロック数 `number` を返す)
4. `const math = countMath(markdown); (math.inline + math.display) > 0 && !cache.katex` で KaTeX 必要性を判定 (`countMath` は `{ inline: number, display: number }` を返す)
5. 各 asset の URL を manifest 経由 (`resolveShikiLangPath` 等) で解決
6. 必要なタスクを `Promise.allSettled([...])` で並行発火
7. 各 settled 結果を集約して `OnlineAssetLoadResult` を返す（reject は `failures` に集約、throw しない）
8. fulfilled なタスクはそれぞれ bridges に merge + `document.dispatchEvent(new Event('mdxg:<asset>-ready'))` を発火

### 3.3 既存 renderer への runtime 後追い注入経路

実コード調査の結果、3 つの renderer は **異なる bridge パターン** を持つことが判明した。asset-loader は各 renderer の既存パターンに合わせた最小限の経路で「runtime 後追い」を実現する。

#### Shiki — embedded-shiki-langs `<script>` 直読み式

`src/app/renderers/shiki.ts` は `document.getElementById('embedded-shiki-langs')` の textContent を `JSON.parse` して `createHighlighterCoreSync({ langs })` に渡す設計で、**bridge global は持たない**。さらに `cachedHighlighter` は lazy singleton で 1 度確定すると以降 reuse される (`createHighlighterCoreSync` の API 制約で `langs` は init 時にしか渡せない)。

このため runtime 後追い注入には **以下の最小修正を `shiki.ts` / `shiki-upgrade.ts` に加える**:

1. **`shiki.ts`** に `installShikiGrammars(newGrammars: Record<string, unknown>)` を新規 export 追加:
   - `<script id="embedded-shiki-langs">` の textContent を既存 + 新規で merge update (`JSON.stringify({ ...existing, ...new })`)
   - `cachedHighlighter = false` で reset (次回 `getOrCreateHighlighter()` が再 init される)
2. **`shiki-upgrade.ts`** に `mdxg:shiki-langs-ready` event listener を新規追加し、発火時に `scheduleShikiUpgrade(state.docPaneEl)` を再呼び出し

asset-loader は `installShikiGrammars(grammars)` を呼んだ後 `document.dispatchEvent(new Event('mdxg:shiki-langs-ready'))` を発火する。

#### Mermaid / KaTeX — sentinel 注入 + 永続 listener

`src/app/renderers/runtime-bridge.ts` の `waitForRuntime` は次の 3 段で動く: (1) `<script id="embedded-<x>">` の textContent が **空でない** ことを確認 (`hasEmbeddedScript` gate)、(2) `globalThis.__mdxg<X>` を読む、(3) なければ `mdxg:<x>-ready` event を待つ。ただし **listener は `DEFAULT_READY_TIMEOUT_MS = 2000` の使い捨て** で、2 秒後に解除されて `resolve(null)` する設計 (`runtime-bridge.ts:63`、boot 直後の 1 回限り試行を想定)。

3G/4G 回線では Mermaid runtime (~3 MB) や KaTeX runtime (~260 KB + CSS) の dynamic import が 5–10 秒かかり得るため、**`waitForRuntime` だけでは event を取りこぼす**。Shiki と同様に **永続 listener** を renderer 側に追加して runtime 後追い注入を完成させる:

1. asset-loader: `<script id="embedded-mermaid">` の textContent に sentinel (`'/* runtime-loaded */'`) を注入 (boot 時 `waitForRuntime` 試行の gate 通過用)
2. asset-loader: `await import(new URL('mermaid.<hash>.mjs', baseUrl).href)` (URL は §3.2 manifest 経由で解決、§5.i)
3. import 評価で `src/mermaid-entry.ts` の末尾コードが自動実行され、`globalThis.__mdxgMermaid = mermaid` 代入 + `document.dispatchEvent(new Event('mdxg:mermaid-ready'))` を発火
4. ★ **`mermaid-upgrade.ts` に追加した永続 listener** (`document.addEventListener('mdxg:mermaid-ready', onReady, { once: false })`) が pickup し、`scheduleMermaidUpgrade(state.docPaneEl)` を再呼び出し

KaTeX も `<script id="embedded-katex">` に対して完全に対称な手順 + `katex-upgrade.ts` への永続 listener 追加。CSS は別途 `fetch('/katex/katex.<hash>.css').then(...)` で `<style id="embedded-katex-css">` の textContent に注入 (KaTeX render の前提に CSS が必要)。

`waitForRuntime` の 2 秒 timeout は **boot 直後の 1 回試行用途** に限定し、後追い注入経路は 3 renderer すべてが永続 listener で統一される (Shiki / Mermaid / KaTeX の対称性)。CLI 経路 (`*-review.html` で runtime が既に inline 済み) では永続 listener が即時 readBridge で `null` を返して no-op になり、影響なし。

#### Shiki と Mermaid/KaTeX の bridge 戦略まとめ

| アセット        | gate 通過の方法                                            | bridge 注入                           | upgrade 再走の発火                                                                     |
| --------------- | ---------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------- |
| Shiki grammar   | `installShikiGrammars` で textContent merge update + reset | `cachedHighlighter` 経由で次回 init   | asset-loader が `mdxg:shiki-langs-ready` dispatch、永続 listener が pickup             |
| Mermaid runtime | dynamic import の前に sentinel テキスト注入                | mermaid-entry が自動代入 + event 発火 | ★ **永続 listener** を `mermaid-upgrade.ts` に新規追加、`mdxg:mermaid-ready` で pickup |
| KaTeX runtime   | 同上 + `<style id="embedded-katex-css">` に CSS 注入       | katex-entry が自動代入 + event 発火   | ★ **永続 listener** を `katex-upgrade.ts` に新規追加、`mdxg:katex-ready` で pickup     |

### 3.4 起動シーケンス + CSP

#### 起動シーケンスへの組み込み (fire-and-forget)

DESIGN.md §9 の online 経路 (現状 Step 4 実装) に **2d.5 fire-and-forget** ステージを追加する:

```
2d.  fetchMarkdownFromUrl で markdown 取得 (成功)
2d.5. ★ NEW: loadOnlineAssets(text, baseUrl, cache) を発火 (await しない)
       - 内部で scan → Promise.allSettled で並行 fetch / dynamic import
       - 各 task fulfilled で installShikiGrammars / mermaid entry / katex entry が
         bridges を立ち上げ、shiki-upgrade / mermaid-upgrade / katex-upgrade が
         progressive upgrade を走らせる
       - boot.ts は asset 完了を待たずに次へ進む (silent + progressive upgrade)
2e.  loadFromMarkdown(deriveDocNameFromUrl(url), text)
       - 既存通り plain text 描画
       - paint 後 scheduleAfterPaint で Shiki / Mermaid / KaTeX upgrade が走る (既存)
       - asset 未到達ブロックは plain text fallback、到達順に上書き upgrade
```

`await` を付けて asset 全完了まで block すると Mermaid (~5 秒) を最大 wait し「silent + progressive upgrade」と矛盾するため、**fire-and-forget が設計の核**。

Open URL modal 経由の reload・Open file (toolbar)・boot.ts の `?url=` 経路で **全入力経路** が同じ asset-loader を経由するよう、**runtime decorator** を `src/app/app-wiring.ts` の 1 点で適用する。boot.ts inline wrapper は不可 (Open file は `chrome/toolbar.ts:219` が直接 runtime を呼ぶため届かない、Item 3 対応)。

実装方針メモ (Step 2 / Phase A.1 で確定): 計画 doc 初版では `AppRuntime` interface を装飾する形を想定していたが、現状の実コードは `bootstrapReviewApp(deps)` + `launchBoot(deps.loadFromMarkdown)` で `loadFromMarkdown` を deps 経由で直接渡す構造のため、装飾対象を **`loadFromMarkdown` 単体** に揃える (`decorateLoadFromMarkdownForOnline(base, cache): LoadFromMarkdown`)。runtime 抽象を新規導入するより Phase A.1 のスコープに収まる:

```ts
// src/app/online/runtime-decorator.ts (Phase A.1 で実装済み)
export type LoadFromMarkdown = (name: string, text: string) => Promise<void>

export const decorateLoadFromMarkdownForOnline = (
  base: LoadFromMarkdown,
  cache: OnlineAssetCache
): LoadFromMarkdown => {
  return (name: string, text: string): Promise<void> => {
    // §5.m Item 2: 前世代の fetch を abort + Map.clear() + 世代 ID を inc
    // ★ Item 1 修正: abort 済み Promise が inFlight Map に残ると、次世代が再利用して
    // 即座に AbortError で reject される競合がある。Map.clear() で abort 済み Promise を
    // 取り除き、次世代の同一 URL 要求が新規 Promise を作成するようにする
    if (cache.currentAbortController !== null) {
      cache.currentAbortController.abort()
    }
    cache.inFlight.clear()
    cache.currentAbortController = new AbortController()
    cache.generation += 1
    // asset-loader は fire-and-forget。失敗は内部で source-display に通知 (Phase A.3 で wiring)
    loadOnlineAssets(text, getOnlineBaseUrl(), cache).catch((error) => {
      Reflect.set(globalThis, '__mdxgOnlineAssetLoaderRejection', error)
    })
    return base(name, text)
  }
}

// src/app/app-wiring.ts (Phase A.3 / Step 4 で組み込み予定)
const baseLoadFromMarkdown = ... // bootstrapReviewApp の deps.loadFromMarkdown を解決
const loadFromMarkdown = isOnlineEdition()
  ? decorateLoadFromMarkdownForOnline(baseLoadFromMarkdown, onlineAssetCache)
  : baseLoadFromMarkdown
// toolbar / boot / openUrlModal すべてが同じ loadFromMarkdown を経由
```

これで toolbar / Open URL / boot.ts の **どの入力経路でも同じ装飾 `loadFromMarkdown`** が使われ、asset-loader が一意に走る。decorator 関数自体は pure で、入力経路ごとに wrapper を散らさず DRY を保つ。詳細は §5.k。

#### asset failure / 進行状況の表示経路 (status bar の DOM 分割)

URL fetch 成功後は `has-embedded-md` クラスにより `#empty-state-container` (の親) が `display: none` になるため、既存の `showOnlineError` 経由 `#empty-state-online-error` empty-state は **物理的に不可視** になる (Item 1)。さらに既存 `#online-source` は Step 5 の `showOnlineSource(finalUrl)` 経由で URL fetch 成功時にだけ visible 化されるため、**Open file 経路ではそもそも DOM が hidden** で asset failure を表示できない (Item 4)。

両経路で機能する形にするため `#online-source` (Step 5 で実装済み) を **2 部分に DOM 分割** する:

```html
<div id="online-source-bar" hidden>
  <!-- 親 container: いずれかの子が visible なら表示 -->
  <span id="online-source-link" hidden>
    <!-- URL fetch 成功時のみ visible (既存 showOnlineSource) -->
    Source: <a rel="noreferrer noopener" ...>...</a>
  </span>
  <span id="online-asset-status" role="status" aria-live="polite" hidden>
    <!-- URL fetch / Open file 両経路で independent visible -->
    Assets: 5/6 loaded · 1 grammar failed (click for details)
  </span>
</div>
```

visibility ロジック (3 独立 toggle、親は OR):

| 関数                              | 操作対象                                         | 副作用                                                         |
| --------------------------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| `showOnlineSource(url)`           | `#online-source-link` を visible + URL を inject | 親 `#online-source-bar` も visible (OR)                        |
| `updateOnlineAssetStatus(result)` | `#online-asset-status` の textContent と visible | failures が空なら hidden、非空なら visible + 親も visible (OR) |
| `clearOnlineSource()` (existing)  | `#online-source-link` を hidden                  | `#online-asset-status` がまだ visible なら親は visible のまま  |
| `clearOnlineAssetStatus()` (新規) | `#online-asset-status` を hidden                 | `#online-source-link` がまだ visible なら親は visible のまま   |

これにより:

- **URL fetch 成功 + asset 部分失敗**: 両子が visible
- **URL fetch 成功 + asset 全成功**: `#online-source-link` のみ visible
- **Open file + asset 部分失敗**: `#online-asset-status` のみ visible (Item 4 対応、Open file でも表示される)
- **Open file + asset 全成功 (もしくは asset 未発火)**: 両子 hidden = 親 hidden (素の空状態)

`src/app/online/source-display.ts` (Step 5 で実装済み) を拡張: 既存 `showOnlineSource` は `#online-source-link` のみ操作するよう変更、新規 `updateOnlineAssetStatus(result)` / `clearOnlineAssetStatus()` を追加。クリックで modal を開く handler は別 module (asset-loader からの dispatch を listen)。表示自体は silent (`status` 行に静かに数字を出すだけ)。詳細は §5.l。

#### CSP の差分

`dist/online.html` の `<meta CSP>` と `_headers` の HTTP header CSP の両方に `connect-src 'self'` を追加:

```diff
- connect-src https://raw.githubusercontent.com https://gist.githubusercontent.com
+ connect-src 'self' https://raw.githubusercontent.com https://gist.githubusercontent.com
```

**CSP 評価対象の整理** (CSP Level 3 仕様):

| 経路                                                    | 評価される CSP ディレクティブ      | 既存 / 追加                            |
| ------------------------------------------------------- | ---------------------------------- | -------------------------------------- |
| `fetch('/shiki-langs/*.json')`                          | `connect-src`                      | **`'self'` 追加が必要**                |
| `fetch('/katex/*.css')`                                 | `connect-src`                      | **`'self'` 追加が必要**                |
| `import('/mermaid.mjs')` / `import('/katex/katex.mjs')` | `script-src` (+ `script-src-elem`) | 既存 `'self' 'unsafe-inline'` でカバー |
| KaTeX CSS の `style.textContent = css` 注入             | `style-src` (inline style)         | 既存 `'unsafe-inline'` でカバー        |

`_headers` の HTTP header CSP は `extractCspContent(onlineHtml)` 経由で single source of truth、`<meta CSP>` の更新で自動追従する (既存 §11.b 設計を継承)。

Phase A/B/C 完了時の配布物サイズは §1 対応スコープ表で示した目標 (Phase A < 25 MiB / Phase A+B+C < 1 MiB raw・gzip < 200 KiB) に従う。各 Phase の中間値は §6 in-source test の `dist/online.html` size 計測アサーションで確定する。

## 4. 実装ステップ

順序は依存関係順。Phase A / B / C は **それぞれ独立 PR / commit** として段階的に push する。各 Step 完了で in-source test と手動視覚チェックを通す。

### Step 1: 設計検証と PoC (renderer 後追い注入の実機確認)

§3.3 で書いた 3 つの bridge 経路 (Shiki / Mermaid / KaTeX) が実コードで動くことを実機で確認する。

- **Shiki 後追い注入**: 手動ビルドした `dist/online.html` で `<script id="embedded-shiki-langs">{}</script>` 空ブロック起動 → 開発者コンソールから `installShikiGrammars(fetchedGrammars)` を手で実行 → `dispatchEvent('mdxg:shiki-langs-ready')` 発火 → ハイライトが走るか確認
- **Mermaid 後追い注入**: `<script id="embedded-mermaid">` を空にしたまま、コンソールから `document.getElementById('embedded-mermaid').textContent = '/* runtime-loaded */'` + `await import('/mermaid.mjs')` → 既存の `waitForRuntime` 経路 (`mermaid-upgrade`) で SVG 描画が走るか確認
- **KaTeX 後追い注入**: 同じく `<script id="embedded-katex">` 経路 + CSS 注入 (`<style id="embedded-katex-css">` への textContent 直書き) で数式 upgrade が走るか確認
- 失敗パターン (CORS / 404 / 不正 JSON) も手で再現し、既存 renderer が静かに plain text fallback に倒れることを確認
- ローカル `npx wrangler pages dev dist` でも CSP HTTP header と同時に動作確認

成果物：PoC で 3 経路すべてが動くことを確認、§3.3 の bridge 戦略が確定

### Step 2 ✅ 完了: Phase A.1 — asset-loader pure 関数 + renderer 後追い注入 API

新規 `src/app/online/asset-loader.ts` (pure 関数中心) と、既存 renderer (`shiki.ts` / `shiki-upgrade.ts`) への最小修正を 1 PR にまとめる。

```ts
// src/app/online/asset-loader.ts (新規)
export interface OnlineAssetCache {
  langs: Set<SupportedLang>
  katex: boolean
  mermaid: boolean
  // 世代 ID: decorator が loadFromMarkdown 呼ぶ度に +1。
  // asset-loader 完了時に開始時の myGen と比較して status 更新を gate (§5.m Item 2)
  generation: number
  // 前世代の fetch を abort するための controller。decorator が次世代開始時に abort() を呼ぶ
  currentAbortController: AbortController | null
  // 同一 URL の重複取得を集約する in-flight Promise cache (§5.m Item 2)
  inFlight: Map<string, Promise<unknown>>
}
export interface AssetLoadFailure {
  asset: 'shiki' | 'mermaid' | 'katex'
  // 原因の細分化 (Item 3 対応): fetch ベースは HTTP status、import ベースは reject 種別
  cause:
    | 'shiki-fetch-404'
    | 'shiki-fetch-network'
    | 'shiki-parse-error'
    | 'mermaid-import-reject'
    | 'katex-import-reject'
    | 'katex-css-fetch-404'
    | 'katex-css-fetch-network'
    | 'aborted-by-newer-generation' // §5.m Item 2
  // canonical retry 結果の reason (Item 3 / §5.i)
  reason?: 'recovered-from-404' | 'recovered-from-load-failure'
  detail: string
  lang?: SupportedLang
}
export interface OnlineAssetLoadResult {
  failures: AssetLoadFailure[]
  katexLoaded: boolean
  loadedLangs: SupportedLang[]
  mermaidLoaded: boolean
  // この結果が生成された時点の世代 ID。status 更新の gate に使う
  generation: number
}
export const createOnlineAssetCache = (): OnlineAssetCache
export const loadOnlineAssets = (
  markdown: string,
  baseUrl: URL,
  cache: OnlineAssetCache
): Promise<OnlineAssetLoadResult>
```

- Phase A.1 の実装範囲: `loadShikiGrammars(langs, baseUrl)` + asset manifest 読み込み (§3.2 / §5.i)。Mermaid / KaTeX は cache.loadedFlag を `true` で初期化したスタブ (Phase B/C で置換)
- `src/core/online-asset-manifest.ts` (新規 pure 関数): `parseOnlineAssetManifest(json)` / `resolveShikiLangPath(manifest, lang)` / 型ガード + manifest 欠落・壊れ時の fail-safe (no-hash パス fallback)
- `loadShikiGrammars` 内で fetch 404 時に no-hash パスに 1 度 retry する経路を追加 (§5.i Item 5)
- `src/app/online/runtime-decorator.ts` (新規 pure 関数、§5.k Item 3 対応): `decorateLoadFromMarkdownForOnline(base, cache)` を export。app-wiring への組み込みは Step 4 (Phase A.3) で行うため、Step 2 ではエクスポートと in-source test のみ
- `src/app/renderers/shiki.ts` に `installShikiGrammars(newGrammars)` / `resetShikiHighlighter()` を新規 export 追加
- `src/app/renderers/shiki-upgrade.ts` に `mdxg:shiki-langs-ready` event listener を追加 (`state.docPaneEl` に対して `scheduleShikiUpgrade` を再呼び出し)
- in-source test: scan → manifest 経由 URL 解決 / manifest 欠落・壊れ時の fallback / `Promise.allSettled` 部分失敗 / cache 更新 / `ALIAS_TO_CANONICAL` 経由の alias 正規化 / `installShikiGrammars` の merge update / `resetShikiHighlighter` が旧 instance を dispose してから reset / `decorateLoadFromMarkdownForOnline` の base 非 mutate / 装飾後の `loadFromMarkdown` 呼び出しで cache 世代 inc + 前世代 abort + inFlight clear

成果物：`src/app/online/asset-loader.ts` + `src/core/online-asset-manifest.ts` + `src/app/online/runtime-decorator.ts` 新規 + `shiki.ts` / `shiki-upgrade.ts` 最小拡張 + in-source test (16-18 ケース)

### Step 3 ✅ 完了: Phase A.2 — build pipeline + manifest + CSP の修正 (commit `89feefd`)

`vite.config.ts` の `splitOutputsPlugin` で online.html の Shiki inline を skip + asset manifest を生成、CSP に `'self'` を追加する 1 PR。

- `vite.config.ts`: standalone.html では引き続き全 grammar inline、online.html では `<script id="embedded-shiki-langs">{}</script>` を空のまま build (Mermaid / KaTeX は Phase A では inline 維持)
- `mdxg-shiki-assets` plugin (または新規 `mdxg-online-manifest` plugin): grammar JSON ごとに content hash を計算し、**`dist/fingerprinted/shiki-langs/<lang>.<hash>.json` (fingerprinted) と `dist/canonical/shiki-langs/<lang>.json` (canonical) の両方を同時 emit** (§5.i Item 1 / 3 対応、ディレクトリ分離 + canonical 常時 emit)。manifest は `{ shikiLangs: { <lang>: "fingerprinted/shiki-langs/<lang>.<hash>.json" } }` を online.html の `<script type="application/json" id="online-asset-manifest">` に inline
- `dist/_headers` に Cache-Control を path 単位で分離設定 (§5.f / §5.i):
  - `/online.html` / `/` → `Cache-Control: public, max-age=300` (5 分)
  - `/fingerprinted/*` → `Cache-Control: public, max-age=31536000, immutable` (永久 cache)
  - `/canonical/*` → `Cache-Control: public, max-age=300` (新版 deploy で内容更新、immutable は禁止)
  - 既存の `/shiki-langs/*` (Step 2 以前の path) は廃止し fingerprinted / canonical に置き換え
- `src/build/online-html.ts`: CSP の `connect-src` に `'self'` を allowlist origins の前に prepend
- `buildOnlineHtml` の既存 in-source test を `'self'` 付き値で更新、manifest inject の test を新規追加
- `_headers` (`src/build/online-headers.ts`) は `extractCspContent` 経由で自動追従。テストの assert 値だけ更新
- standalone.html / embed-template.html は manifest を inject **しない** (信頼境界の分離維持、§3.1)
- `npm run build` で `dist/online.html` raw が ~6.6 MiB (Phase A 想定)、`dist/shiki-langs/*.<hash>.json` が hash 付きで emit されることを確認

成果物：`dist/online.html` raw が < 25 MiB (実測 4.16 MiB)、CSP / `_headers` 両方に `connect-src 'self'`、`<script id="online-asset-manifest">` が inline、grammar JSON が hash 付き

#### 実装中に追加された設計判断 (レビュー指摘で補強)

Phase A.2 の本作業中、 計画書の本文には書かれていなかった 4 つの設計判断を追加で導入した。 Phase B / C / Step 4 以降で `splitOutputsPlugin` 周辺を触る人が前提を知らずに不変条件を壊すことがないよう、 commit 履歴より参照しやすい形でここに残す。 詳細はすべて `vite.config.ts` 内のコメントに集約済み。

1. **退避ロールバック + AggregateError + bak 保全** — grammar emit の swap (旧 dist → 新 dist) を「旧 dir を `dist/.bak-shiki-<random>/` に退避 → tmp dir を rename で promote → 全成功で bak rm」の atomic パターンに変更。 promote 失敗時は `rollbackSwap` (完了 rename を逆順取消 + bak から復元)、 退避失敗時は `restoreBakToFinal`。 復元自体が失敗したら `handleSwapStepFailure` が **bak.root を保全して `AggregateError(originalError, rollbackError)` を throw** する (旧成果物の最後のコピーを失わない原則、 メッセージに bak path を含めて手動回復可能に)。 関連 helper: `tryRenameCollectingFailures` / `restoreBakToFinal` / `rollbackSwap` / `handleSwapStepFailure`。
2. **file lock + 厳密 parse + token 照合** — 同 ROOT で並列 build (例: `vp build --watch` + 単発 `vp build`) が swap 区間で互いに干渉するのを防ぐため、 `dist/.shiki-build.lock` で排他制御。 lock 内容は **`PID\n<32 桁 lowercase hex>\n` を正規表現で厳密 parse** し、 trailing garbage / 余分な行を受理しない (`LOCK_CONTENT_RE = /^(\d+)\n([0-9a-f]{32})\n?$/u`)。 `process.kill(pid, 0)` の **EPERM は生存扱い**。 **stale lock の自動削除は行わず常に fail-fast** で、 「完了を待つ / 確認後 rm」と案内を分岐。 解放時は取得時 token と現在の lock 内容を照合し、 一致時のみ削除 (理論上の TOCTOU は残るが通常運用での誤削除を防ぐ)。 関連 helper: `parseLockContent` / `acquireGrammarBuildLock` / `failOnExistingLock` / `releaseGrammarBuildLock`。
3. **lock 取得を `buildStart` に移動** — Vite/Rolldown は `writeBundle` で共有の `dist/review.html` を書くため、 lock を `closeBundle` で取ると lock 取得前に並列 build が review.html を上書きする race が残る。 lock は `splitOutputsPlugin.buildStart` で acquire し、 success path (`closeBundle`) と failure path (`buildEnd(error)`) の両方で release を保証。 token は module-level state (`ownedLockToken`) で hook 間共有。
4. **`process.exit(1)` で abrupt termination** — `vite-plus` が plugin の async throw を握って build を `closeBundle` まで進行させる挙動が実機検証で観測されたため、 `buildStart` の lock 取得失敗を catch して **`process.exit(1)` で確実に build を止める**。 lint 設定 `unicorn/no-process-exit` は `*.config.ts` で off に override (build pipeline 用途として正規)。

これらの不変条件 (sequential rename / bak 保全 / 厳密 parse / buildStart 取得 / abrupt termination) を Phase B / C の `splitOutputsPlugin` 改修で破らないこと。

### Step 4 ✅ 完了: Phase A.3 — runtime decorator を app-wiring に組み込み + hosting target 切り出し (commit `1187cc6` + 後続 commit)

§5.k の runtime decorator を `src/app/app-wiring.ts` に組み込み、全入力経路 (toolbar / Open URL modal / boot) で装飾 runtime が使われるようにする 1 PR (Item 3 対応)。 加えて Cloudflare Pages 実機セットアップに着手した結果、 dist 直下 (CLI / Releases 配布) と Pages 配信 subset を物理的に分離する hosting target 切り出しを行った (下記「実装中に追加された設計判断」参照)。

- `src/app/app-wiring.ts`: `isOnlineEdition()` true なら `decorateLoadFromMarkdownForOnline(baseRuntime, createOnlineAssetCache())` を一度だけ呼んで装飾、toolbar / boot / Open URL modal すべての attach 先に同じ装飾 runtime を渡す
- `boot.ts` / `chrome/toolbar.ts` / `app/online/open-url-modal.ts` の側は変更なし (`runtime.loadFromMarkdown` を呼ぶ既存コードのまま、装飾 runtime が透過的に asset-loader 経路を走らせる)
- `boot.ts` 側に inline で書いていた wrapper は削除 (decorator に集約)
- `npx wrangler pages dev dist/hosting` でローカルエミュレーション、`/?url=...` / **Open file 経路** / Open URL modal 経由のいずれでも asset-loader が走ることを DevTools Network パネルで確認
- main に push → Cloudflare Pages 自動 redeploy → deploy 成立 + 実機 markdown 描画を確認
- `https://<project>.pages.dev/?url=https://raw.githubusercontent.com/oubakiou/mdxg-redline/main/README_ja.md` で grammar fetch が DevTools Network パネルに見えることを確認

成果物：Phase A 完了 (commit が main に push されて Cloudflare Pages で deploy 成立、全 4 入力経路で asset-loader が走る、 Pages の Build output directory に `dist/hosting` を指定)

#### 実装中に追加された設計判断 (Pages deploy セットアップ補強)

Phase A.3 の本作業中、 Cloudflare Pages 実機セットアップに着手した結果、 計画書の本文には書かれていなかった 5 つの設計判断を追加で導入した。 計画 §1 [MUST] 受け入れ基準「Cloudflare Pages で deploy が per-file size error なし で成立する」を満たすために必要な作業で、 Phase B / C で `splitOutputsPlugin` 周辺を触る人が前提を知らずに不変条件を壊すことがないよう、 commit 履歴より参照しやすい形でここに残す。 詳細はすべて `vite.config.ts` / `src/build/online-headers.ts` 内のコメントに集約済み。

1. **`dist/hosting/` を Pages 配信 subset として source-of-truth 化** — `dist/standalone.html` (47 MB、 Pages の per-file 25 MiB 制限超) / `dist/embed-template.html` / `dist/review-request.mjs` / `dist/mermaid.mjs` / `dist/katex/` / `dist/shiki-langs/` は CLI または GitHub Releases 配布専用で hosting には不要なため、 Pages の Build output directory を `dist/hosting` に向けて構造的に除外する。 dist 直下 = CLI / Releases 配布用、 `dist/hosting/` = ホスティング配信用 の境界が物理的に明確 (subset コピー方式ではなく **最初から `dist/hosting/` 配下に直接 emit** することで重複ゼロ + transform 不要)。 含める entry: `index.html` (online.html リネーム) / `_headers` (path 書き直し済み) / `fingerprinted/` / `canonical/`。 `vite.config.ts` の `resolveFinalGrammarDirs` / `resolveSplitOutputPaths` / `emitHostingHeaders` で構造的に保証。
2. **vendor-neutral 命名 (`hosting/`)** — Cloudflare 固有名 (`cf-pages` / `pages` / `cloudflare`) を避け、 Vercel / Netlify 等の別ホスティングへ将来切り替えても dir 名を変える必要がない設計。
3. **`online.html` → `index.html` リネーム + `_redirects` 廃止** — Pages 慣習で `/` への request は自動的に `index.html` を返すため、 `dist/hosting/index.html` という命名にすると `_redirects` (`/ /online.html 200`) が不要になる。 `dist/_redirects` 自体を `git rm` し、 `src/build/online-redirects.ts` も削除。 `buildOnlineHtml` の出力先を `dist/hosting/index.html` に直結。
4. **`_headers` の path section を `/index.html` に書き換え** — `src/build/online-headers.ts` の path section `/online.html` を `/index.html` に変更。 `/` (Pages の default index 配信) と `/index.html` (直接 URL アクセス) の両方に同じ CSP / Cache-Control を返す防御。 in-source test の expectation も `/index.html` に更新、 旧名残の混入回帰防止として「`/online.html` が結果に残らない」assert を追加。
5. **subset コピー方式の廃止 (中間案 B の却下)** — Phase A.3 初期検討では「dist 直下に旧仕様の online.html / `_headers` / fingerprinted / canonical を残し、 `src/build/hosting-target.ts` の `emitHostingTarget` で `dist/hosting/` に subset コピーする」中間案 B も検討したが、 「source-of-truth が 1 つで重複なし / transform 関数不要 / `_redirects` の存在自体が消える / CLI と Pages の境界が物理的に明確」の利点を取って **最初から `dist/hosting/` に直接 emit する C 設計** を採用。 `hosting-target.ts` / `online-redirects.ts` は実装しない (作っていた場合は削除)。

これらの不変条件 (subset 切り出し / vendor-neutral 命名 / index.html リネーム / `_headers` の path 整合 / 直接 emit) を Phase B / C で hosting target に Mermaid / KaTeX 追加する際に破らないこと。 Phase B で `mermaid.<hash>.mjs` が `dist/hosting/fingerprinted/` 配下に直接 emit されれば自動的に Pages 配信 subset に含まれる。 Phase C も同様。

DESIGN.md §3 / §9 / §11.b / §13 の path 名 (`dist/online.html` → `dist/hosting/index.html` 等) は §13 の build pipeline 周辺のみ最小修正し、 詳細議論 (§11.b CSP / §3 入力 3 / §9 起動シーケンス) は Step 7 でまとめて C 設計に合わせて書き直す。

### Step 5 ✅ 完了: Phase B — Mermaid の dynamic import + 永続 listener + load failure retry

- `asset-loader.ts` の `loadMermaidRuntime(baseUrl)` を本実装に置換 (Phase A.1 のスタブを差し替え)
- 手順: (1) `<script id="embedded-mermaid">` に sentinel 注入 → (2) `await import(new URL('fingerprinted/mermaid.<hash>.mjs', baseUrl).href)` (manifest 経由) → entry が bridge 立て + event 発火 (§3.3)
- **任意 load failure retry** (Item 3 対応): dynamic `import()` の reject は HTTP status を公開しない (CORS / セキュリティ仕様、404 / CSP / MIME / 構文エラー / network 障害すべて同じ TypeError で reject される)。fingerprinted import が **reject された場合 (理由問わず)**、`await import(new URL('canonical/mermaid.mjs', baseUrl).href)` に retry。Shiki の fetch ベース「404 retry」とは非対称な「load failure retry」設計。retry 結果は `OnlineAssetLoadResult.failures` に `recovered-from-load-failure` で集約 (reason は Mermaid/KaTeX 用、Shiki は `recovered-from-404` のまま)
- `failures[].cause` を新規追加して原因を細分化: `'shiki-fetch-404'` (Shiki fetch 404) / `'shiki-fetch-network'` (Shiki fetch CORS/network) / `'shiki-parse-error'` (JSON 解析失敗) / `'mermaid-import-reject'` (Mermaid import reject、理由不明) / `'katex-import-reject'` / `'katex-css-fetch-fail'`。DevTools console.warn には raw error.message を保持して原因追跡可能に
- **`mermaid-upgrade.ts` に永続 listener を追加**: `document.addEventListener('mdxg:mermaid-ready', () => scheduleMermaidUpgrade(state.docPaneEl), { once: false })` を online edition でのみ attach (§3.3 の Item 1 対応)
- `vite.config.ts` で online.html では Mermaid を inline しないように分岐、`dist/fingerprinted/mermaid.<hash>.mjs` と `dist/canonical/mermaid.mjs` を同時 emit
- in-source test 追加: Mermaid load 成功 / 失敗 / idempotent (2 回呼んでも 1 度だけ load) / theme 切替後の re-render との non-干渉 / **永続 listener が 5 秒以上の遅延後でも upgrade を発火する** / CLI 経路 (`waitForRuntime` だけ) で永続 listener が no-op になる / **fingerprinted import reject → canonical import 成功で `recovered-from-load-failure` 集約** / canonical も reject で `failures` に集約 (cause は `'mermaid-import-reject'`)
- `dist/online.html` raw が ~3.5 MiB (Phase B 想定) であることを確認
- main に push → Cloudflare Pages redeploy

成果物：online.html から Mermaid が剥がれ ~3.1 MiB 削減 + 5–10 秒の遅延 load でも upgrade + deploy 世代ずれ過渡期で canonical retry が救う

#### 実装サマリ (commit 予定分)

- `vite.config.ts`: `emitMermaidRuntimeFiles` 追加 (sha256Prefix で hash 計算 + `dist/hosting/fingerprinted/mermaid.<hash>.mjs` + `dist/hosting/canonical/mermaid.mjs` 同時 emit)、 `buildManifestPayload` の入力を `AssetEmission` に拡張して `mermaid` フィールドを埋める、 `runSplitOutputs` から `emitMermaidRuntimeFiles` 呼び出し
- `src/build/online-html.ts`: `emptyMermaidBlock` を追加し `buildOnlineHtml` の pipeline で `<script id="embedded-mermaid">` の textContent を空に上書き (素材契約として block 不在は fail-fast、 Shiki と対称)
- `src/app/online/asset-loader.ts`: `loadMermaidRuntime` 本実装 (sentinel 注入 + fingerprinted dynamic import + canonical retry + dedupeFetch + 世代/abort 統合)、 `cache.mermaid` を `true` 初期化から `false` 初期化に切替、 `loadOnlineAssets` で Shiki/Mermaid を Promise.all 並行、 dynamic import を test から差し替え可能にする `MermaidImporter` 注入経路を追加
- `src/app/renderers/mermaid.ts`: `attachMermaidReadyListener` + `resetMermaidReadyListenerForTest` を新規追加 (Shiki `attachShikiLangsReadyListener` と対称、 永続 listener で `waitForRuntime` 2 秒 timeout を補完)
- `src/app/app-wiring.ts`: online edition で `attachOnlineRuntimeListeners` 経由で Mermaid 永続 listener も attach
- in-source test 9 ケース追加 (asset-loader.ts) + 4 ケース (mermaid.ts 永続 listener) + 3 ケース (online-html.ts emptyMermaidBlock)
- `dist/hosting/index.html` 実測: 1.01 MiB (Phase A の 4.16 MiB から **~3.1 MiB 削減**、 計画の ~3.5 MiB 想定内)、 `dist/hosting/fingerprinted/mermaid.ebf601f8.mjs` + `dist/hosting/canonical/mermaid.mjs` (各 3.14 MiB) emit 確認、 manifest に `"mermaid":"fingerprinted/mermaid.<hash>.mjs"` 注入確認、 `<script id="embedded-mermaid">` 空 textContent 確認
- `vp check` (lint/format/type-check) 全 133 files pass、 `vp test` 全 1177 tests pass

### Step 6: Phase C — KaTeX の dynamic import + 永続 listener + load failure retry (JS) / 404 retry (CSS)

- `asset-loader.ts` の `loadKatexRuntime(baseUrl)` を本実装に置換
- 手順: (1) `<script id="embedded-katex">` / `<style id="embedded-katex-css">` に sentinel 注入 → (2) `await import(new URL('fingerprinted/katex/katex.<hash>.mjs', baseUrl).href)` (manifest 経由) → entry が bridge 立て (3) `fetch('fingerprinted/katex/katex.<hash>.css').then(...style.textContent = css)`、fonts-extra も同様
- **JS は load failure retry (Mermaid と対称、Item 3 対応)**: `import()` reject (理由問わず) で canonical に retry、`failures[].cause = 'katex-import-reject'`
- **CSS / fonts-extra は 404 retry**: `fetch()` ベースなので `response.status === 404` で判別可能、Shiki と同じく 404 のみで canonical retry。`failures[].cause = 'katex-css-fetch-404'` 等
- 3 ファイル (JS / CSS / fonts-extra) の retry は互いに独立し、1 つの canonical retry 成功で他の失敗を救わない (§5.i Item 2 / 4 対応)
- **`katex-upgrade.ts` に永続 listener を追加**: Mermaid と対称の `mdxg:katex-ready` listener
- `vite.config.ts` で online.html では KaTeX を inline しないように分岐、`dist/fingerprinted/katex/*.{<hash>.mjs,<hash>.css}` と `dist/canonical/katex/*.{mjs,css}` を同時 emit
- in-source test 追加: KaTeX load 成功 / 失敗 / CSS 注入の idempotent (2 重 inject 防止) / fonts-extra の遅延 load / **永続 listener の遅延 upgrade** / CLI 経路で no-op / **JS / CSS / fonts-extra それぞれの fingerprinted 404 → canonical retry** / 3 ファイルの retry が独立
- `dist/online.html` raw が ~300–500 KiB (Phase C 完了)、gzip ~100–150 KiB を確認
- main に push → Cloudflare Pages redeploy

成果物：online.html から KaTeX も剥がれ最終形 (~300–500 KiB raw / gzip ~100–150 KiB) に到達 + 3 asset 経路すべてで canonical retry が機能

### Step 7: DESIGN.md 反映 + 本ドキュメント archive

- `vp test` / `vp check` 全通過
- DESIGN.md §3 入力 経路 3 を「online.html は最小 shell、必要なアセットを runtime で動的注入」に書き直し
- DESIGN.md §9 起動シーケンスに 2d.5 fire-and-forget ステージを追加
- DESIGN.md §11.b CSP に `connect-src 'self'` 追加と「同一オリジン asset fetch のため」の説明
- DESIGN.md §13 ビルドパイプライン: online.html の依存内容物表を「shell のみ inline、grammar / Mermaid / KaTeX は同一オリジン外部資材」に書き直し
- `docs/feature-online-edition.md` を `docs/archive/feature-online-edition.archive.md` にリネーム
- 本ドキュメントを `docs/archive/feature-online-runtime-assets.archive.md` にリネーム

成果物：DESIGN.md 更新 + 2 つの planning doc が archive 化される

## 5. 設計判断

### a. renderer の bridge 待ちパターン

| 候補                                       | 採用 | 理由                                                                                                                                                                                                                        |
| ------------------------------------------ | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. 既存 bridge event listener を再利用** | ✓    | `mermaid-upgrade.ts` / `katex.ts` は既に `mdxg:mermaid-ready` / `mdxg:katex-ready` を listen する設計（CLI `--mermaid off` で後注入する CLI 経路と同じ）。Shiki も `embedded-shiki-langs` 注入完了を待つ event があれば同型 |
| B. asset-loader で render を直接呼び出す   | ✗    | renderer の責務（DOM 走査 / 状態管理）を asset-loader 側に漏らす。SRP 違反                                                                                                                                                  |
| C. polling                                 | ✗    | event-driven の既存設計を壊す                                                                                                                                                                                               |

採用案の論点と mitigation：

- **既存 renderer に Shiki bridge event がない場合 (実コード調査で確定済み)**: §3.3 で確定: Shiki に bridge global は存在せず、`shiki.ts` が `<script id="embedded-shiki-langs">` の textContent を直読みする設計。`shiki.ts` に `installShikiGrammars(grammars)` / `resetShikiHighlighter()` を新規 export 追加し、textContent を merge update + `cachedHighlighter = false` reset 後に `dispatchEvent('mdxg:shiki-langs-ready')` を発火、`shiki-upgrade.ts` 側に新規 event listener を追加して `scheduleShikiUpgrade` を再呼び出し (renderer の最小修正で済む)
- **イベント発火タイミング**: 各アセット fulfilled の **その瞬間** に発火する。複数アセットが同時 fulfilled でも、それぞれ独立した event として発火（renderer 側で 1 度だけ走るか idempotent 化されているかは renderer の責務）

### b. fetch 失敗時の graceful degradation 粒度

| 候補                                                   | 採用 | 理由                                                                                                                     |
| ------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------ |
| **A. 個別エラーを部分的に許容 (`Promise.allSettled`)** | ✓    | Shiki 1 言語の fetch 失敗で他言語の grammar は載る。Mermaid 失敗で KaTeX は動く。UX の「一部欠けるが全体は見える」が優先 |
| B. 1 つでも失敗したら persistent error empty-state     | ✗    | デバッグしやすいが UX 悪化。online edition の体験版的位置付けに合わない                                                  |
| C. silent fail で plain 描画のみ                       | ✗    | エラー原因がユーザーから不可視、support コストが上がる                                                                   |

採用案の論点と mitigation：

- **失敗のユーザー通知 (相対閾値)**: 絶対件数 (例: 5 件以上) は典型 markdown のフェンス数 (1–3) に対して大きすぎ、3 件全失敗でも silent fail になる。**相対閾値** (試行件数 N に対し失敗が 50% 以上、または Mermaid / KaTeX 全 runtime が失敗) で通知。通知経路は `#online-source` 行の **asset status 部分** に永続表示 (§5.l)。markdown 描画後は `#doc-wrap` が visible になり既存 `#empty-state-online-error` empty-state は CSS で hide されるため、empty-state 経由の `showOnlineError` は使えない (Item 1 対応)。1–2 件は `console.warn` のみ + status 行に小さく件数表示
- **DevTools での発見性**: 各失敗は `console.warn` で 1 行 stack trace なし。スマホでも DevTools で原因追跡可能

### c. asset load 中の視覚フィードバック

| 候補                                                | 採用 | 理由                                                                                                                               |
| --------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **A. silent で描画進行、upgrade を progressive に** | ✓    | 既存 CLI `--shiki-langs none` で開いた markdown が後から Shiki 注入で上書きされるパターンと同じ。renderer の bridge 待ち設計と整合 |
| B. トーストで "Loading runtime…" を出す             | ✗    | スマホスクリーンを潰す。情報量に対して UX ノイズが大きい                                                                           |
| C. スケルトン / プレースホルダー                    | ✗    | 実装重い、UX 改善幅が限定的                                                                                                        |

採用案の論点と mitigation：

- **3G/4G 回線で Mermaid load が 5–10 秒かかる場合の UX**: plain text 描画は即時、Mermaid ブロックは ` ```mermaid ` のコードフェンス表示で待ち、bridges 立ったら SVG 描画に上書き。視覚的に「処理中」と判別可能
- **race condition**: `loadOnlineAssets` の await と `loadFromMarkdown` の plain 描画の順序は、まず asset-loader が `await Promise.allSettled` で **発火させるだけ**（Shiki 数言語 fetch は ~100ms で fulfilled、Mermaid は ~5 秒）。`loadFromMarkdown` はその後すぐに plain 描画。renderer は bridges 立つ順に upgrade

### d. Phase A / B / C の分割 vs 一括

| 候補                                           | 採用 | 理由                                                                                                                       |
| ---------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------- |
| **A. Phase A 単独 PR を先行、B / C は後続 PR** | ✓    | Cloudflare Pages 25 MiB 制限を **すぐに** 切り、deploy 成立を確認した上で次に進める。各 Phase が独立 commit でレビュー可能 |
| B. A+B+C を 1 PR で一括                        | ✗    | デバッグスコープが広い、deploy 検証が一度に来る、中途で詰まると全体が止まる                                                |
| C. PoC → 一括設計見直し                        | ✗    | 進行が遅い、Phase A の動作確認後に B / C の設計が変わる可能性が低い                                                        |

採用案の論点と mitigation：

- **Phase A 単独で online.html が ~6.6 MiB（Cloudflare Pages 25 MiB 制限内だが「スマホ初回 download 重い」状態）**: deploy 成立を優先し、UX 完成度は Phase B / C で達成
- **Phase B / C の延期リスク**: Phase A の動作確認後すぐ Phase B / C に着手する想定。仮に B / C が延期されても Phase A 単独で hosting 成立は維持

### e. 同一オリジン fetch vs 別 CDN

| 候補                             | 採用 | 理由                                                                                                                                                       |
| -------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. 同一オリジン同梱**          | ✓    | hosting で online.html と同じ dist/ 配下に置く。CSP `connect-src 'self'` で許可、追加 origin 不要。「単一 HTML + 外部依存ゼロ」原則を runtime 経路でも維持 |
| B. jsdelivr / unpkg 等の公開 CDN | ✗    | 外部依存が増える、CSP allowlist 拡張が必要、CDN 障害で online edition が壊れる                                                                             |
| C. Cloudflare R2 + Worker proxy  | ✗    | 過剰設計。dist/ 同梱で十分                                                                                                                                 |

採用案の論点と mitigation：

- **dist/ 配下が肥大化する**: `shiki-langs/*.json` は計 ~40 MiB raw だが Cloudflare Pages の per-file 制限は **ファイルごと** で、合計サイズは別制約（Pages 無料枠は計 20,000 ファイル / 25 MiB/file）。各 grammar が 200 KiB 程度なので余裕
- **同一オリジン仮定が崩れる場合**: hosting と asset 配信を分離したいケース（社内 wiki 経由配信等）は将来オプション化する余地があるが、本プランでは同一オリジン前提に閉じる

### f. アセット cache の粒度 (in-memory + HTTP cache の 2 層、Item 4 対応)

`?url=` 再 submit で reload が走るため in-memory cache だけでは MUST 要件 (同一 URL 再 load で実 fetch ゼロ) を満たせない。**in-memory cache (Open file 用) + browser HTTP cache (reload 後の再 fetch 用)** の 2 層で責務を分担する。

| 候補                                                                                         | 採用 | 理由                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A. in-memory cache (Set / Flag) + HTTP cache (immutable hash + `Cache-Control: max-age`)** | ✓    | in-memory は同一 session 内の Open file 経路で fetch skip、HTTP cache は `?url=` reload + immutable hash で 304 / cache hit を狙う。SHOULD と MUST を 2 層で両立 (Item 4 対応) |
| B. in-memory cache のみ                                                                      | ✗    | `?url=` 再 submit が reload を起こすため in-memory cache が破棄され、同一 URL 再 load で実 fetch が走る。MUST 要件と矛盾                                                       |
| C. localStorage で persistent cache                                                          | ✗    | grammar JSON は ~200 KiB / 個、20 言語で 4 MiB。localStorage の 5 MiB 制限に近い。HTTP cache の方が CDN / browser の最適化を活かせる                                           |
| D. Service Worker                                                                            | ✗    | Phase A+B+C のスコープ外。完了後の追加最適化として別タスク                                                                                                                     |

採用案の論点と mitigation：

- **in-memory cache (SHOULD)**: 同一 session の Open file 経路で「別 markdown を読んだ時に既ロードの grammar を再 fetch しない」を担う。Set / boolean の小さいデータのみ。**ライフサイクルは page lifetime に閉じる** (reload / タブクローズで破棄、`onlineAssetCache` が module-level で確保される `Set<SupportedLang>` / boolean フラグ / `Map<URL, Promise>` のいずれも JS heap に存在する間だけ生存、§5.m の世代 ID も同様)
- **HTTP cache (MUST)**: fingerprinted (`/fingerprinted/*`) パスに対し `_headers` で `Cache-Control: max-age=31536000, immutable` を設定 (§5.i)。`?url=` 再 submit + reload でも browser は cache から hit、実 fetch ゼロ。**粒度は asset 1 ファイル = cache 1 エントリ** (`<lang>.<hash>.json` 1 ファイル、`mermaid.<hash>.mjs` 1 ファイル、KaTeX の JS / CSS / fonts-extra も独立 3 エントリ)
- **HTTP cache のセッション境界をまたいだ生存**: browser の disk cache に格納されるため **タブ / セッション / ブラウザ再起動をまたいで永続化** (`max-age=31536000` = 1 年、`immutable` で revalidation も発生しない)。前セッションで fetch 済みの `typescript.<hash>.json` は次セッションで `?url=` を再 submit しても、別 markdown が同じ言語のフェンスを含んでも、**同一 hash パスである限り fetch ゼロ**。**破棄条件は限定的**: (1) browser cache 手動消去、(2) DevTools の Disable cache、(3) シークレット / プライベートブラウジング、(4) browser の cache eviction (容量逼迫 / LRU、稀)、(5) 新版 deploy で grammar 内容が変わって hash が変わった場合 (旧 hash entry は disuse で eviction 対象)
- **canonical は短寿命**: `/canonical/*` は新版 deploy で内容更新されるため `Cache-Control: max-age=300` (§5.i Item 1 対応)。fingerprinted と canonical で異なる Cache-Control を持つよう **ディレクトリ分離** が前提。canonical entry は 5 分で revalidation 対象になるため deploy 直後の世代ずれ過渡期で確実に新版が返る
- **HTML cache の短寿命化**: `dist/online.html` は manifest を持つため deploy で hash 表が変わる。HTML 自体は `Cache-Control: max-age=300` 程度 (§5.i Item 5 対応) で deploy 世代ずれの過渡期を最小化
- **in-memory cache と HTTP cache の重複は許容**: page reload 時に in-memory cache は破棄され、reload 後の boot で再度 asset-loader が走るが、HTTP cache で実 fetch がゼロのため performance loss なし
- **DevTools での挙動確認**: 「Disable cache」を有効にした場合は in-memory cache のみで動作 (`?url=` 再 submit で実 fetch される)。手動視覚チェックでこの挙動を別途確認

### g. CSP `connect-src` への `'self'` 追加

採用方針: `dist/online.html` の `<meta CSP>` と `_headers` の HTTP header CSP の両方で `connect-src 'self' <allowlist origins>` の形にする。`'self'` は allowlist origins と並立。

理由：

- 同一オリジン fetch のため `'self'` は必須（CSP Level 3 仕様、`default-src 'none'` だと deny）
- allowlist origins (`https://raw.githubusercontent.com` 等) は `?url=` 経路のため引き続き必要
- `'self'` を `_headers` に書き忘れると HTTP response header の方が拒否する drift が発生 → `extractCspContent(onlineHtml)` 経由で single source of truth、build plugin で構造的に防ぐ

### h. アセット fetch URL の組み立て (hosting prefix 対応)

| 候補                                                                   | 採用 | 理由                                                                                                                                |
| ---------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **A. `new URL('shiki-langs/...', document.baseURI)` で base-relative** | ✓    | `<host>/mdxg-redline/online.html` のようなサブパス配信でも `<host>/mdxg-redline/shiki-langs/...` に解決される。`<base href>` も尊重 |
| B. `new URL('/shiki-langs/...', location.href)` で absolute root       | ✗    | サブパス配信時に `<host>/shiki-langs/...` (root) を見に行き 404。レビューで「hosting prefix の落とし穴」として指摘された経路        |
| C. 相対 URL `'./shiki-langs/...'` を `fetch` に直渡し                  | ✗    | `<a>` の相対パス解釈と混ざる可能性、URL 正規化が fetch 実装依存                                                                     |

採用案の論点と mitigation：

- **`document.baseURI` の使用**: 標準仕様で `<base href>` を尊重しつつ、`<base>` 不在時は `document.URL` (= `location.href`) を返す。online.html 自体に `<base>` を埋めていないため通常は `location.href` 等価だが、将来サブパス配信時に `<base href="/mdxg-redline/">` を埋めるだけで全 fetch が追従する
- **`?url=...` クエリの影響**: `document.baseURI` はクエリ文字列を含むが `new URL(relative, base)` がクエリを drop して解決するため fetch URL 側に `?url=...` が漏れない
- **path 末尾の slash**: `new URL('shiki-langs/x.json', 'https://host/mdxg-redline')` は `https://host/shiki-langs/x.json` に解決される (URL spec)。online.html の path が dir で終わるよう `<base href="/mdxg-redline/">` (末尾 slash) を要求する

### i. cache invalidation と CDN cache busting (manifest 方式)

| 候補                                                                     | 採用 | 理由                                                                                                                                                                    |
| ------------------------------------------------------------------------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. fingerprint (build hash) を URL に付与 + manifest で runtime 解決** | ✓    | `<lang>.<hash>.json` 形式で hash 焼き込み + asset manifest を online.html に inline、loader が manifest 経由でファイル名を解決。動的 URL 組み立てとの整合 (Item 2 対応) |
| B. fingerprint のみ (manifest なし、loader が hash を直接生成)           | ✗    | loader 側が runtime で hash 値を持つ手段がない (`<lang>` は markdown scan で動的決定)。URL を組み立てられない                                                           |
| C. クエリ string `?v=<hash>` で cache busting                            | ✗    | 一部 CDN がクエリ string を cache key から除外する。Cloudflare Pages 動作は要確認だが manifest 方式が robust                                                            |
| D. `Cache-Control: max-age=0, must-revalidate` で都度検証                | ✗    | hosting 帯域コスト、初回 fetch 遅延                                                                                                                                     |
| E. cache 戦略なし (Cloudflare CDN 既定に任せる)                          | ✗    | grammar が更新されても古い cache が返り続ける                                                                                                                           |

採用案の論点と mitigation：

- **build 時 hash 焼き込み**: `mdxg-shiki-assets` plugin (および mermaid / katex の build plugin) の closeBundle で content hash を計算してファイル名を `<base>.<hash>.<ext>` に rename、同時に manifest を生成。hash は SHA-256 先頭 8 桁 hex (cache key として一意)
- **manifest の inline**: `online.html` の `<head>` に `<script type="application/json" id="online-asset-manifest">` で inline (§3.2)。loader は起動時 1 度 parse して module cache。`<base href>` (§5.h) と組み合わせてサブパス hosting でも追従
- **standalone.html への影響**: standalone は inline 済みのため hash / manifest 不要。online build を派生する経路で manifest を inline するだけ。CLI 経路 (embed-template / review-request) も不要
- **本プランでのスコープ**: Phase A.2 (build pipeline) で Shiki grammar の hash + manifest を実装。Phase B / C で mermaid / katex の entry を manifest に追加。Phase A.1 の asset-loader 実装時点で manifest 読み込み + fail-safe は同時に作る (Phase A.1 の `loadShikiGrammars` は manifest 解決済み URL を fetch する設計のため)

#### deploy 世代ずれ救済の 3 段 fail-safe (Item 5 対応)

「正常 parse できる manifest だが entry の hash 付き URL が 404」というシナリオ (古い HTML cache + 古い manifest + 新 deploy で旧 hash 資材が消えた状態) は manifest 欠落 fallback だけではカバーできない。次の 3 段 defense-in-depth で救済する:

1. **fingerprinted / canonical の path 分離 + canonical を常時 emit** (Item 1 / 3 対応): build pipeline (Phase A.2) で **fingerprinted 資材を `dist/fingerprinted/` 配下** に、**canonical を `dist/canonical/` 配下** に分離して emit する。例:
   - `dist/fingerprinted/shiki-langs/<lang>.<hash>.json` (manifest が参照する hash 付き)
   - `dist/canonical/shiki-langs/<lang>.json` (loader の 404 retry / 古い HTML が直接 fetch する no-hash)
   - Phase B では `dist/fingerprinted/mermaid.<hash>.mjs` / `dist/canonical/mermaid.mjs`
   - Phase C では `dist/fingerprinted/katex/katex.<hash>.mjs` / `dist/canonical/katex/katex.mjs` (CSS / fonts-extra も同様)
   - path 分離する理由: Cloudflare Pages の `_headers` glob は中間 wildcard (`/mermaid.*.mjs` 等) を解釈できないため、Cache-Control を path 単位で別設定するためにディレクトリで明示分離する (Item 3 対応)
2. **3 asset 全経路で loader の load failure retry** (Item 2 / 3 対応): retry の trigger は asset によって非対称:
   - **Shiki grammar (`fetch()` ベース)**: `response.status === 404` を判別して canonical に retry → `failures[].cause = 'shiki-fetch-404'` + `failures[].reason = 'recovered-from-404'`
   - **Mermaid runtime (`import()` ベース)**: `import()` の reject は HTTP status を公開しないため、**任意の reject** で canonical に retry → `failures[].cause = 'mermaid-import-reject'` + `reason = 'recovered-from-load-failure'`
   - **KaTeX**: JS は `import()` ベース (Mermaid と同じ load failure retry)、CSS / fonts-extra は `fetch()` ベース (Shiki と同じ 404 retry)
   - dynamic import の reject 原因 (CSP / MIME / 構文エラー / network 障害) はすべて canonical retry の対象になる。canonical も同じ問題で reject されれば永続失敗、原因は `cause` の raw error message から DevTools で追跡可能
3. **path 単位の Cache-Control 設定** (Item 1 / 3 対応): Cloudflare Pages の `_headers` で path 単位に Cache-Control を分離:
   - `/online.html` / `/` → `Cache-Control: public, max-age=300` (5 分、HTML cache 短寿命)
   - `/fingerprinted/*` → `Cache-Control: public, max-age=31536000, immutable` (immutable hash で永久 cache 可)
   - `/canonical/*` → `Cache-Control: public, max-age=300` (新版 deploy で内容が更新されるため短寿命、Item 1 「canonical に immutable は本末転倒」の対応)

3 段は独立して機能する。**いずれか 1 つが機能すれば online edition が動く**:

- (1) 動く: 古い loader が新 HTML を読み、canonical path (`/canonical/...`) を直接 fetch (canonical は短寿命 cache のため新版が返る)
- (2) 動く: 新 loader が古い manifest を読み、fingerprinted hash 付き URL で 404 → canonical path に retry
- (3) 過渡期窓自体が短くなり、(1)(2) を発動させる頻度を抑える

受け入れ基準 (§7) に「deploy 世代ずれ過渡期で online edition が壊れない」を追加し、§6 in-source test で 3 シナリオ + 3 asset (Shiki / Mermaid / KaTeX) すべてを検証する。

- **manifest 欠落 / 壊れ時の fail-safe (4 段目)**: `parseOnlineAssetManifest` が型ガード失敗時に `OnlineAssetManifest` の各 entry を `null` / 空 object として返し、`resolveShikiLangPath` 等が canonical パスに fallback。manifest 自体が破損 / 欠落しているレアケースの保険

### j. fetch failure に対する retry / backoff

| 候補                                                 | 採用 | 理由                                                                                                                                                           |
| ---------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. retry なし、失敗は plain text fallback + warn** | ✓    | スマホ回線で 1 度 fail したアセットを即 retry しても成功率は低い (ネットワーク事情)、ユーザー操作 (URL 再 submit / reload) で fresh start に乗せる方が UX 自然 |
| B. exponential backoff で 3 回 retry                 | ✗    | Mermaid / KaTeX runtime ~3 MB を 3 回試すと回線負荷が過大、最後の失敗まで wait が長い                                                                          |
| C. 失敗時に「Retry」ボタンを toolbar に出す          | ✗    | UI 追加コスト、silent + progressive UX に反する                                                                                                                |

採用案の論点と mitigation：

- **transient 失敗の救済経路**: Open URL modal の re-submit で `?url=` 更新 + reload が走り、`onlineAssetCache` がリセットされて再 fetch。ユーザー側の「操作 1 回 = 全 retry」が成立する
- **永続失敗の検知**: §5.b の相対閾値 (Mermaid / KaTeX 全 runtime 失敗、または Shiki 失敗率 50% 超) で `#online-source` の asset status 行に表示 (§5.l)、クリックで詳細 modal → ユーザーに reload を促す導線を残す
- **将来の Service Worker**: 本プランのスコープ外だが、Service Worker で stale-while-revalidate 経路を追加すれば transient 失敗の救済を CDN 層で吸収できる

### k. 全入力経路で asset-loader を保証する集約点 (runtime decorator)

| 候補                                                                                       | 採用 | 理由                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------ | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. `decorateLoadFromMarkdownForOnline(base, cache)` を `app-wiring.ts` で 1 度だけ適用** | ✓    | toolbar (Open file) / Open URL modal (reload 経由) / boot.ts (?url=) の **全入力経路** が同じ装飾 `loadFromMarkdown` を経由。経路追加時の見落としが構造的に起きない (Item 3 対応) |
| B. boot.ts に inline wrapper (`loadFromMarkdownOnline`)                                    | ✗    | Open file は `chrome/toolbar.ts:219` が直接 runtime を呼ぶため届かない。新経路追加時に同じバグを再生産                                                                            |
| C. 各入力経路 (toolbar / Open URL / boot) ごとに wrapper を散らす                          | ✗    | DRY 違反、新経路追加時の見落としリスクが残る                                                                                                                                      |
| D. `runtime.loadFromMarkdown` の inner で `isOnlineEdition()` 判定                         | ✗    | runtime の責務 (markdown を state に乗せる) と online edition の責務 (asset を fetch する) を混ぜる。SRP 違反                                                                     |

採用案の論点と mitigation：

- **decorator 関数の pure 性**: `decorateLoadFromMarkdownForOnline(base, cache)` は副作用ゼロの pure 関数で、入力 `loadFromMarkdown` を変更せず新関数を返す。in-source test で base が mutate されないことを検証
- **`onlineAssetCache` の生存範囲**: `app-wiring.ts` で 1 度だけ `createOnlineAssetCache()` を呼んで装飾に渡す。module-level singleton と同等で、page reload まで生存
- **CLI 経路 (standalone / embed-template) での影響ゼロ**: `isOnlineEdition()` false なら装飾せず base `loadFromMarkdown` をそのまま使う。standalone / embed-template の挙動は完全に不変
- **新入力経路の追加への耐性**: 将来の input 経路 (例: drag & drop / clipboard paste / 別 modal) も `loadFromMarkdown(name, text)` を呼ぶ限り asset-loader が走る。decorator は app-wiring の 1 点で適用される構造的不変条件
- **Phase 分割への影響**: Phase A.1 の asset-loader 実装と一緒に decorator も export (Step 2 で実装済み)、Phase A.3 で app-wiring に組み込む。Phase A.1 だけだと decorator が使われずに end-to-end で動かないため、A.1 と A.3 のスコープ境界に注意
- **AppRuntime 抽象を導入しない理由**: 計画 doc 初版は `AppRuntime` を装飾する案だったが、実コードでは `bootstrapReviewApp(deps: BootstrapDeps)` + `launchBoot(deps.loadFromMarkdown)` で `loadFromMarkdown` が deps 経由で直接 wiring される構造。`AppRuntime` を新規導入すると Phase A.1 のスコープを越え boot.ts の wiring 全面改修が必要になるため、装飾対象を **`LoadFromMarkdown` 関数型単体**に揃え minimal な改修にとどめた (Step 2 / Phase A.1 で確定)

### l. asset failure / 進行状況の通知方式 (Item 1 / 4 対応)

| 候補                                                                                                             | 採用 | 理由                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. `#online-source-bar` 親 + `#online-source-link` / `#online-asset-status` の 2 子 DOM、independent visible** | ✓    | URL fetch 経路 (link) と Open file 経路 (status のみ) の **両方で動作**。markdown 描画後 (`has-embedded-md`) でも visible。子は独立切替、親は OR で visible (Item 1 + Item 4 対応) |
| B. `#online-source` (Step 5 単一 DOM) を `showOnlineSource` のみで visible 化                                    | ✗    | URL fetch 成功時しか visible にならない。**Open file 経路では asset failure を表示する DOM がない** (Item 4 P2 バグ)                                                               |
| C. 既存 `#empty-state-online-error` で `showOnlineError`                                                         | ✗    | URL 取得成功 → `has-embedded-md` で empty-state container が `display: none`、物理的に不可視 (Item 1 P1 バグ)。empty-state は **markdown 描画前のみ** 動く                         |
| D. toast (短時間表示)                                                                                            | ✗    | スマホで小型 UI が見落とされる、scroll や操作で気付けない、永続性なし                                                                                                              |
| E. status bar に表示 + 一定閾値超で modal を強制 open                                                            | ✗    | modal 強制 open は UX 強引、「silent + progressive upgrade」と矛盾                                                                                                                 |

採用案の論点と mitigation：

- **2 子 DOM の独立切替 (Item 4 対応)**: `#online-source-link` は `showOnlineSource(url)` / `clearOnlineSource()` で URL fetch 経路だけが操作、`#online-asset-status` は `updateOnlineAssetStatus(result)` / `clearOnlineAssetStatus()` で全経路 (URL fetch / Open file / Open URL modal) から操作。親 `#online-source-bar` の visible は **子のいずれかが visible なら visible** (OR 条件、CSS or 動的 toggle)
- **詳細 modal**: `#online-asset-status` クリックで `<dialog>` を open し、失敗した lang / runtime / 推定原因 (404 / CORS / parse error 等) を一覧表示。再 Open URL submit / reload を促すボタンを併設
- **`source-display.ts` の責務拡張**: 既存 `showOnlineSource(finalUrl)` (Step 5) を `#online-source-link` のみ操作するよう **scope を狭める** + 新規 `updateOnlineAssetStatus(result)` / `clearOnlineAssetStatus()` を追加。pure 関数 (`buildAssetStatusHtml(result)`) と DOM 更新を分離して in-source test しやすくする。親の visibility は 2 子状態を見て独立に決める helper `recomputeOnlineSourceBarVisibility()` を内部で呼ぶ
- **silent 性の維持**: status 行は **永続表示** だが、boot 直後 (loadOnlineAssets が走り終わるまで) は `Loading…` ではなく **何も表示しない** (描画開始までに行を出さないことで「処理中の画面遷移」感を出さない)。`Promise.allSettled` 完了で初めて status 行を出す
- **アクセシビリティ**: `#online-asset-status` に `role="status"` / `aria-live="polite"` を付与し、screen reader でも認識可能に
- **複数経路での集約**: 通知発火源は decorator (asset-loader 完了時) のみ。boot.ts / toolbar / Open URL modal は status 更新コードを持たず、source-display 経由の 1 点に集約 (§5.k decorator pattern と整合)
- **Open file 経路の特殊性 (Item 4 P2 対応)**: Open file では URL がないので `#online-source-link` は hidden のまま。`#online-asset-status` だけ visible で「Source なし + Assets: X/Y loaded」の表示。in-source test で「URL fetch 成功 + asset 失敗」「Open file + asset 失敗」「Open file + asset 成功 (status は何も表示しない)」「URL fetch 成功 + asset 成功 (link のみ)」の 4 ケースを網羅

### m. 複数文書ロード時の世代管理 + in-flight cache (Item 2 対応)

fire-and-forget の asset-loader (§3.4) は **連続して別文書を開いた時の競合** が問題になる: (1) 文書 A の遅延した完了が文書 B の status を上書き、(2) 同一 grammar (例: `typescript.json`) を文書 A と文書 B で並行 fetch して重複取得、(3) 古い文書 A の grammar が新文書 B には不要なのに bridge merge される (これは benign だが帯域浪費)。

| 候補                                                       | 採用 | 理由                                                                                                                                                                                |
| ---------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. 世代 ID + in-flight Promise cache + AbortController** | ✓    | 世代 ID で status の競合を gate、in-flight cache で同一 URL の重複取得を集約、AbortController で前世代 fetch を abort して帯域節約。3 段で fire-and-forget の負の側面を構造的に塞ぐ |
| B. asset-loader を await する (block する)                 | ✗    | Mermaid 5–10 秒の遅延で plain 描画開始まで待たされ、§3.4 fire-and-forget 設計 + §5.c silent + progressive upgrade と矛盾                                                            |
| C. 文書切替時に in-memory cache を全クリア                 | ✗    | grammar が文書間で共通の場合 (`typescript.json` 等) に意味なく重複取得が起きる。SHOULD 要件 (Open file 経路で fetch skip、§5.f) と矛盾                                              |
| D. status の上書きを許容 (silent fail)                     | ✗    | Open file 経路で文書 A の失敗を文書 B 表示中に見せる UX が混乱を招く                                                                                                                |

採用案の論点と mitigation：

- **世代 ID の管理**: `OnlineAssetCache` に `generation: number` を追加。decorator が `loadFromMarkdown` 呼ぶ度に `cache.generation += 1`。`loadOnlineAssets(markdown, baseUrl, cache)` 内で開始時の `myGen = cache.generation` を closure に保持
- **status 更新の gate**: `Promise.allSettled` 完了時に `cache.generation === myGen` を確認。不一致なら `updateOnlineAssetStatus` を **skip** (現世代の status が古い世代に上書きされない)。bridge merge (`installShikiGrammars` / Mermaid import / KaTeX import) は **gate せず継続** (grammar は文書非依存で merge 安全、bridge が立っていれば次世代でも再利用可能)
- **in-flight Promise cache**: `Map<string, Promise<unknown>>` (`cache.inFlight`) で URL → in-flight Promise を追跡。同一 URL の 2 度目の fetch 要求は既存 Promise を返す。完了時に Map から entry を削除 (cache 自体は不要、fulfilled になれば次回は manifest hit + browser HTTP cache hit で fetch ゼロ、§5.f)
- **abort 時の Map.clear() (Item 1 対応、最重要)**: `currentAbortController.abort()` 直後に **`cache.inFlight.clear()` を呼ぶ**。これをしないと、abort 済み Promise が Map に残り、次世代の同一 URL 要求がそれを再利用 → 即座に `AbortError` で reject → 必要な grammar が読み込めない競合が起きる。abort 後の Map.clear() で旧世代 Promise を完全に切り離し、新世代の同一 URL は **新規 Promise を作成して新規 fetch** に進む
- **AbortController での abort**: 前世代の asset-loader が抱える `AbortController` を decorator が次世代開始時に abort。途中の fetch が中断されて帯域を節約。abort された task は `failures[].cause = 'aborted-by-newer-generation'` で集約 (DevTools 追跡用、retry はしない)
- **bridge merge の文書非依存性**: Shiki grammar は `installShikiGrammars(grammars)` で `<script id="embedded-shiki-langs">` の textContent を spread merge update (§3.3 確定設計、Shiki に bridge global は存在しない)、Mermaid / KaTeX は `globalThis.__mdxgMermaid` / `globalThis.__mdxgKatex` への代入で idempotent (Step 5/6 entry が自動代入)。古い世代の merge 完了でも新世代に害なし (どの grammar / runtime も文書間で共通利用可能)
- **status と bridge の非対称性**: status は文書依存 (どの言語が失敗したかは文書ごとに違う) なので世代 gate が必要、bridge は文書非依存 (grammar / runtime は once-loaded で再利用) なので gate 不要。この非対称設計が本論点の核
- **「bridge merge は継続」の正しい解釈 (Item 1 修正)**: 「世代 gate せず継続」とは「世代に関係なく Promise を再利用する」意味ではなく、「**成功した Promise (新世代でも同世代でも) が fulfilled になれば bridge merge を実行する**」意味。abort 済み Promise は failed なので bridge merge は到達しない (正常)。新世代が同一 URL を要求した時は、Map.clear() 後の新規 Promise が fulfilled になれば bridge merge する
- **localStorage や永続化との関係**: cache はすべて module-level の in-memory (page reload で破棄)。世代 ID も page reload でリセット。localStorage は使わない (§5.f Item 4 で確定済み)

## 6. テスト方針

### in-source test（新規）

- `app/online/asset-loader.ts`:
  - `loadOnlineAssets`: scan → URL 組み立て / `Promise.allSettled` で 1 件 reject 時の他成功 / fulfilled の bridges merge / 既に cache hit 済みの skip
  - `loadShikiGrammars`: 言語 alias の `ALIAS_TO_CANONICAL` 経由正規化 / 不正 lang は skip + failure 追記 / 並行 fetch の順序非依存 / cache.langs への追加
  - `loadMermaidRuntime` (Phase B): cache.mermaid hit 時の skip / `import()` reject 時の failure 追記 / idempotent (2 回呼んでも 1 度だけ load) / sentinel 注入の前段確認
  - `loadKatexRuntime` (Phase C): 同上 + CSS injection の idempotent 性 (`<style id="embedded-katex-css">` が 2 重 inject されない)
  - `createOnlineAssetCache`: fresh cache の初期値 / Set / boolean / `generation === 0` / `currentAbortController === null` / `inFlight` が空 Map で正しい
  - URL 組み立て: `document.baseURI` ベースで `<base href>` 付きサブパス hosting でも正しい URL を出す (§5.h)
  - 失敗の相対閾値 (§5.b): 試行 N 件のうち 50% 超失敗で `OnlineAssetLoadResult.failures` が閾値超を返す
  - **世代 ID + status gate (§5.m Item 2)**: `loadOnlineAssets` 開始時に `myGen = cache.generation` を closure で保持 / `Promise.allSettled` 完了時に `cache.generation === myGen` なら status 更新を進める、`cache.generation > myGen` なら status 更新を skip / bridge merge (Shiki / Mermaid / KaTeX いずれも) は世代 gate せずに継続 (文書非依存)
  - **in-flight Promise cache (§5.m Item 2)**: 同一 URL の 2 度目の fetch 要求で既存 Promise を返す / 完了時に Map から entry を削除 / cache が異なれば別 Map なので並列実行
  - **AbortController で前世代 abort (§5.m Item 2)**: decorator が次世代開始時に `cache.currentAbortController?.abort()` → 前世代 fetch が `AbortError` で reject → `failures[].cause = 'aborted-by-newer-generation'` で集約 / abort された task は retry されない
  - **abort 時の Map.clear() (§5.m Item 1 修正、最重要)**: `cache.currentAbortController?.abort()` 直後に `cache.inFlight.clear()` を呼ぶ / **abort → 同一 URL re-request → 新規 Promise 作成 → 新規 fetch 開始** の経路を検証 / `Map.clear()` なしだと next world で abort 済み Promise が再利用されて即 `AbortError` で reject される回帰テストも追加 (regression guard)
  - **bridge merge は成功 Promise のみ実行 (Item 1 解釈)**: 旧世代の abort 済み Promise から bridge merge が実行されない / 新世代の新規 Promise が fulfilled で bridge merge が実行される / 同一文書内で同一 URL 連続要求は同じ Promise を返す (Map にあれば再利用)
  - **decorator の世代 inc**: `loadFromMarkdown` 呼び出しごとに `cache.generation += 1`、status 更新は新世代だけ通る

- `app/renderers/shiki.ts` (既存テストに追加):
  - `installShikiGrammars`: `<script id="embedded-shiki-langs">` の textContent を既存と新規の merge で update / `cachedHighlighter = false` reset / 既存空 + 新規追加で textContent が `JSON.stringify(new)` になる
  - `resetShikiHighlighter`: `cachedHighlighter` の状態をリセット / 連続呼び出しの idempotent
  - 既存テスト (`readEmbeddedShikiLangs` 等) との非干渉

- `app/renderers/shiki-upgrade.ts` (既存テストに追加):
  - `mdxg:shiki-langs-ready` event 発火で `scheduleShikiUpgrade(state.docPaneEl)` が再呼び出しされる
  - 連続発火しても idempotent (重複 upgrade で DOM が崩れない)

- `app/renderers/mermaid.ts` / `app/renderers/mermaid-upgrade.ts` (既存テストに追加):
  - theme 切替後の re-render が runtime 後追い注入 (`mermaidInitialized` reset 経路) と共存する non-干渉
  - **永続 listener** が 5 秒以上の遅延 `mdxg:mermaid-ready` 発火でも `scheduleMermaidUpgrade` を再呼び出しする (Item 1: `waitForRuntime` 2 秒 timeout の補完)
  - 永続 listener が複数回発火しても idempotent (theme 切替 + dynamic import が連続する場合のレース)
  - CLI 経路 (`<script id="embedded-mermaid">` に runtime 既 inline) では永続 listener が attach されない、または attach されても no-op

- `app/renderers/katex.ts` / `app/renderers/katex-upgrade.ts` (既存テストに追加):
  - Mermaid と対称の永続 listener test (遅延 upgrade / idempotent / CLI 経路 no-op)

- `build/online-html.ts` (既存テストに追加):
  - `connect-src 'self'` が allowlist origins の前に prepend される
  - `dist/standalone.html` / `dist/embed-template.html` の CSP は `'self'` を含まない (信頼境界の分離維持)
  - online build で `<script id="embedded-shiki-langs">` の textContent が空 `{}` で出力される (Phase A.2)
  - Mermaid / KaTeX 用 sentinel `<script>` ブロックも online build では空 (Phase B / C)

- `build/online-headers.ts` (既存テストに追加):
  - HTTP header CSP の `connect-src` にも `'self'` が含まれる (meta CSP と single source of truth)

- `core/online-asset-manifest.ts` (新規 pure 関数、§3.2 / §5.i):
  - `parseOnlineAssetManifest`: 有効 JSON / 型ガード passing / 欠落 entry (`shikiLangs: {}` / `mermaid: null` / `katex: null`) / 不正 JSON で OnlineAssetManifest の各 entry が安全値で返る
  - `resolveShikiLangPath`: manifest にある lang は hash 付きパス / manifest に無い lang は no-hash `shiki-langs/<lang>.json` に fail-safe / 不正な lang は no-hash パス
  - `<script id="online-asset-manifest">` 欠落時の fail-safe: `parseOnlineAssetManifest('')` が空 manifest を返す
  - manifest 型の決定性: build 入力 → manifest 出力が決定論的 (同じ grammar JSON → 同じ hash)

- `vite.config.ts` の manifest plugin (§4 Step 3、新規 or 既存 plugin 拡張):
  - grammar JSON の content hash 計算が決定論的 (同じ入力 → 同じ hash)
  - hash 8 桁 hex (SHA-256 先頭) の一意性 (build 1 回内で重複なし)
  - online.html の `<script id="online-asset-manifest">` に有効 JSON が inline される
  - **standalone.html / embed-template.html には manifest が inline されない** (信頼境界の分離維持)
  - **canonical no-hash copy が同時 emit される** (§5.i Item 5): `dist/shiki-langs/<lang>.json` が `<hash>` 版と並んで存在

- `app/online/asset-loader.ts` の load failure retry (§5.i / Item 3 対応、3 asset 別の非対称設計):
  - **Shiki (fetch ベース)**: fingerprinted パスで `response.status === 404` 受け取り時、canonical パスに 1 度 retry。`failures[].cause = 'shiki-fetch-404'`、reason = `'recovered-from-404'`。non-404 のエラー (network / parse) では retry しない (`'shiki-fetch-network'` / `'shiki-parse-error'` のいずれかで集約)
  - **Mermaid (import ベース)**: fingerprinted の `import()` reject 時、canonical の `import()` に retry (理由問わず、404 / CSP / MIME / 構文 / network すべて対象)。`failures[].cause = 'mermaid-import-reject'`、reason = `'recovered-from-load-failure'`。raw error.message も保持
  - **KaTeX**: JS は Mermaid と同じ `import()` load failure retry。CSS / fonts-extra は Shiki と同じ `fetch()` 404 retry
  - retry も失敗した場合は `failures` に集約 (無限 retry しない)
  - canonical retry した entry は `OnlineAssetLoadResult.loadedLangs` / `mermaidLoaded` / `katexLoaded` に含めるが `failures` には `reason` 付きで残す (DevTools での発見性、Item 3 対応)
  - hash 付きで成功した場合は retry が発火しない (正常パスの非干渉、Shiki / Mermaid / KaTeX 全 3 経路で検証)
  - hash 付きで 200 が返るケースでは retry が発火しない (正常パスの非干渉)

- `app/online/source-display.ts` (Step 5 拡張、§5.l Item 1 / 4 対応):
  - `buildAssetStatusHtml(result)` pure 関数: 正常完了 (failures 0) で空文字 / 部分失敗で `Assets: X/Y loaded · Z failed` / 全成功で何も表示しない / Promise.allSettled 未完了は空文字
  - `updateOnlineAssetStatus(result)`: `#online-asset-status` の textContent と visible を update、failures 非空で visible / failures 空で hidden / `role="status"` + `aria-live="polite"`
  - `clearOnlineAssetStatus()`: `#online-asset-status` を hidden、`recomputeOnlineSourceBarVisibility` を呼ぶ
  - `showOnlineSource(url)` (Step 5 既存): `#online-source-link` のみ操作するよう **scope を狭める** (親 bar の visible は別関数に委譲)
  - `recomputeOnlineSourceBarVisibility()`: 2 子の visible 状態を OR で親 `#online-source-bar` の visible を再計算 (子の独立切替で親が自動 sync)
  - markdown 描画後 (`has-embedded-md` がセットされた状態) でも `#online-asset-status` が visible (Item 1 P1 バグ回避の検証)
  - **Open file 経路シミュレーション (Item 4 P2 対応)**: `#online-source-link` を hidden のまま (URL なし) で `updateOnlineAssetStatus` を呼ぶと `#online-asset-status` だけ visible + 親も visible
  - **URL fetch 成功 + asset 全成功**: `showOnlineSource` で `#online-source-link` visible / `updateOnlineAssetStatus(result)` (failures 0) で `#online-asset-status` hidden / 親は link 経由で visible
  - **URL fetch 成功 + asset 部分失敗**: 両子 visible + 親 visible
  - **Open file + asset 全成功**: 両子 hidden + 親 hidden (素の空状態)
  - **Open file + asset 部分失敗**: `#online-asset-status` のみ visible + 親 visible (Item 4 受け入れケース)
  - 連続呼び出しで idempotent (同じ result で 2 度呼んでも DOM が崩れない)

- `dist/_headers` の Cache-Control (§4 Step 3、§5.f / §5.i):
  - `/online.html` / `/` の Cache-Control が `max-age=300` 程度
  - `/fingerprinted/*` の Cache-Control が `public, max-age=31536000, immutable`
  - `/canonical/*` の Cache-Control が `public, max-age=300` (immutable は **付かない**、Item 1 対応)
  - standalone.html / embed-template.html には immutable Cache-Control が適用されない (online 専用)
  - standalone.html / embed-template.html には immutable Cache-Control が適用されない (online 専用)

- `app/online/runtime-decorator.ts` (新規、§5.k Item 3 対応):
  - `decorateLoadFromMarkdownForOnline`: base runtime を mutate しない (pure 関数の不変条件) / 装飾 runtime の `loadFromMarkdown` 呼び出しで asset-loader が `void` で fire-and-forget 発火 + base.loadFromMarkdown の `Promise<void>` を **return** する (await chain を壊さない)
  - 装飾 runtime の戻り値型が `Promise<void>` で base 契約と同型 (型 assert)
  - `loadOnlineAssets` が reject しても装飾 runtime の Promise は base のものをそのまま返し、base resolve / reject の挙動が透過 (graceful)
  - base runtime の他メソッド (loadFromMarkdown 以外) は spread でそのまま透過

- `app/app-wiring.ts` (既存テストに追加):
  - `isOnlineEdition()` true なら `decorateLoadFromMarkdownForOnline` が 1 度だけ呼ばれて装飾 runtime が toolbar / boot / openUrlModal の全 attach 先に同じ instance で渡される
  - `isOnlineEdition()` false なら baseRuntime をそのまま使う (standalone / embed-template への副作用ゼロ)
  - `onlineAssetCache` が app-wiring の lifecycle 内で 1 度だけ生成され reuse される

### 手動視覚チェックリスト

`npm run build` 後、`npx wrangler pages dev dist` でローカルエミュレーション、または Cloudflare Pages デプロイ後に確認：

- [ ] `/` または `/online.html` を素の状態で開くと toolbar Open URL ボタンが visible
- [ ] `?url=https://raw.githubusercontent.com/oubakiou/mdxg-redline/main/README_ja.md` で実 markdown が描画される
- [ ] DevTools Network パネルで `/shiki-langs/*.json` が markdown の出現言語分だけ並行 fetch される
- [ ] DevTools Network パネルで `?url=` 起動時に `/mermaid.mjs` / `/katex/*` も markdown 内容に応じて条件 fetch される (Phase B+C 完了後)
- [ ] フェンス言語のないシンプルな markdown では `/shiki-langs/*.json` の fetch が 0 件
- [ ] `?url=` に Mermaid を含む markdown を指定すると Mermaid runtime が dynamic import で読まれ、SVG 描画に upgrade される (Phase B 完了後)
- [ ] 数式を含む markdown で KaTeX runtime + CSS が読まれて upgrade される (Phase C 完了後)
- [ ] 同一 session で Open file から別 markdown を開いた時、既に load 済みの grammar は再 fetch されない
- [ ] Open URL modal から submit すると `?url=` が更新されて reload、新 markdown に対する asset-loader が再走する
- [ ] 存在しない言語 (`?url=` に `\`\`\`fakelang` を含む markdown) で他言語は正常に load、fakelang は plain text fallback
- [ ] スマホエミュレーション (DevTools の device toolbar Slow 3G) で online.html 初回 download が gzip 200 KiB 以下 (Phase C 完了後)
- [ ] dark / light テーマ切替が動く
- [ ] コメント追加 → Write feedback.json / Copy as JSON / Export as JSON が動く
- [ ] CSP HTTP header に `connect-src 'self' https://raw.githubusercontent.com https://gist.githubusercontent.com` が含まれる
- [ ] standalone.html の CSP は `connect-src 'none'` のまま回帰なし
- [ ] embed-template.html の CSP は `connect-src 'none'` のまま回帰なし

## 7. 受け入れ基準

- §1 対応スコープ表の全 [MUST] 行が完了条件を満たす
- `dist/online.html` のサイズが Phase A 完了で **< 25 MiB**、Phase A+B+C 完了で **< 1 MiB raw / gzip < 200 KiB**
- Cloudflare Pages で deploy が **per-file size error なし** で成立する
- 既存 standalone.html / embed-template.html のサイズ・CSP・挙動が一切回帰しない
- `core/online-url.ts` の二段防御（`validateOnlineUrl` + `checkFinalUrl`）、Step 5 の UI 層（Open URL modal / Source link / error UI）が変更なしで動く
- `dist/online.html` の `<meta CSP>` と `dist/_headers` の HTTP header CSP の `connect-src` 値が完全一致（既存 single source of truth invariant）
- `Promise.allSettled` で個別 fetch 失敗が他のアセット load を妨げない（Shiki 1 言語失敗で他言語は載る、Mermaid 失敗で KaTeX は動く）
- `loadOnlineAssets` の in-memory cache が同一 session 内 (Open file 経路) で fetch skip を機能させる
- **[MUST] 同一 URL の再 submit (`?url=` reload) で fingerprinted 資材は browser cache から hit してネットワークリクエストゼロ**: DevTools Network パネルで `(disk cache)` / `(memory cache)` 表示が確認できる。`immutable, max-age=31536000` が正しく設定されていれば revalidation も発生しない (304 は許容しない、Item 4 対応)
- **[SHOULD] HTML (`/online.html`) は `max-age=300` 切れ後の revalidation で 304 (body 転送なし)**: HTML cache は短寿命で deploy 世代ずれ過渡期最小化のため revalidation は自然挙動。fingerprinted 資材とは扱いを分ける
- **deploy 世代ずれの過渡期で online edition が壊れない**: 古い HTML + 古い manifest + 新 deploy の組み合わせで、3 asset 経路 (Shiki / Mermaid / KaTeX) すべてが (1) canonical 直接 fetch、(2) loader の 404 retry、(3) 短寿命 HTML cache のいずれかで救われる (§5.i Item 2 / 5)
- **fingerprinted / canonical の Cache-Control 分離**: `/fingerprinted/*` は immutable で永久 cache、`/canonical/*` は max-age=300 で deploy 更新を反映 (§5.f / §5.i Item 1)
- **`_headers` の glob が中間 wildcard なしで全 fingerprinted 資材をカバー**: ディレクトリ分離により `/fingerprinted/*` 1 行で全 hash 付き資材に Cache-Control が適用される (§4 Step 3 Item 3)
- **asset partial failure が markdown 描画後でも見える**: `#online-source-bar` の 2 子 DOM 構造で `#online-asset-status` が独立 visible、`has-embedded-md` 後も表示される (§5.l Item 1)
- **Open file 経路でも asset status が表示される**: URL fetch 経路だけでなく Open file (toolbar 経由) でも `#online-asset-status` が visible、`#online-source-link` は hidden のまま (§5.l Item 4)
- decorator の戻り値型 `Promise<void>` が base runtime 契約と一致する (Item 3)
- DESIGN.md §3 / §9 / §11.b / §13 が新方針で書き直される
- `docs/feature-online-edition.md` と本ドキュメントが `docs/archive/` 配下に archive 化される
- 第 1 候補ホスティング先 (Cloudflare Pages) でスマホ実機検証も成立

## 8. 想定リスクと回避策

| リスク                                                                                                                               | 回避策                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Shiki に bridge global が存在しない** (実コード調査で判明、`shiki.ts` は `<script>` 直読み式)                                      | §3.3 で確定: `shiki.ts` に `installShikiGrammars` を新規 export 追加、textContent を merge update + `cachedHighlighter = false` reset。Step 2 (Phase A.1) で実装                                                                                |
| **`cachedHighlighter` が lazy singleton で freeze** (`createHighlighterCoreSync` は init 時 langs 固定)                              | §3.3 で確定: `resetShikiHighlighter()` で `cachedHighlighter = false` に戻し、次回 `getOrCreateHighlighter()` で merge 済み textContent から再 init。Shiki API の `loadLanguage()` は使わない選択                                               |
| **`waitForRuntime` の `hasEmbeddedScript` gate** (`<script id="embedded-mermaid">` 空のままだと即 null 返却)                         | §3.3 で確定: asset-loader が dynamic import の **前** に sentinel テキスト (`'/* runtime-loaded */'`) を `<script>` の textContent に注入し、gate を通過させる                                                                                  |
| **`waitForRuntime` の 2 秒 timeout で listener が解除** (3G/4G の 5–10 秒遅延でも event を取りこぼす)                                | §3.3 で確定: `mermaid-upgrade.ts` / `katex-upgrade.ts` に **永続 listener** を新規追加し `mdxg:<x>-ready` 発火で `scheduleXUpgrade(state.docPaneEl)` を再呼び出し。`waitForRuntime` は boot 直後 1 回試行用途に限定                             |
| `import('/mermaid.mjs')` が CSP で block                                                                                             | CSP Level 3 で ES module dynamic import は **`script-src`** の評価対象 (`connect-src` ではない)。既存 `script-src 'self' 'unsafe-inline'` の `'self'` で同一オリジン import がカバーされる (§3.4 整理表)                                        |
| **hosting prefix 環境 (サブパス配信) で `/shiki-langs/...` が 404**                                                                  | §5.h で確定: `new URL('shiki-langs/...', document.baseURI)` で base-relative 解決。`<base href="/mdxg-redline/">` を将来書けば追従。in-source test でサブパス hosting ケースを検証                                                              |
| **CDN cache が古い grammar JSON を返し続ける**                                                                                       | §5.i で確定: build 時に content hash を URL に焼き込み + asset manifest を online.html に inline、loader が manifest 経由で URL 解決。新版 deploy で hash が変わり cache が自動 bust。Phase A.2 で実装                                          |
| **fingerprint だけでは runtime が動的 lang 名から hash 付きパスを組み立てられない** (Item 2)                                         | §3.2 / §5.i で確定: build 時に `<script type="application/json" id="online-asset-manifest">` を online.html に inline。loader が `resolveShikiLangPath(manifest, lang)` で解決。manifest 欠落・壊れ時は no-hash パスへ fail-safe                |
| **deploy 世代ずれ過渡期で manifest と実ファイルが不整合** (古い HTML + 古い manifest + 新 deploy で旧 hash 資材が消えた状態、Item 5) | §5.i で確定: **3 段 defense-in-depth** で救済。(1) canonical no-hash copy を常時 emit、(2) loader が 404 時に no-hash パスへ 1 度 retry、(3) `_headers` で HTML max-age=300 / assets max-age=31536000 immutable                                 |
| **Open file 経路が boot.ts wrapper を通らない** (`chrome/toolbar.ts:219` が直接 runtime を呼ぶ、Item 3)                              | §5.k で確定: `app-wiring.ts` で `decorateLoadFromMarkdownForOnline` を 1 度だけ適用し、toolbar / boot / Open URL modal の全 attach 先に装飾 runtime を配る。boot.ts inline wrapper は不可、入力経路追加時の見落としを構造的に防ぐ               |
| **asset partial failure を markdown 描画後に通知できない** (`#empty-state-online-error` は `has-embedded-md` で hide、Item 1)        | §5.l で確定: `#online-source` (Source link 行) を 2 段構成に拡張し `Assets: X/Y loaded · Z failed` を永続表示。markdown 描画後も常に visible、`role="status"` + `aria-live="polite"` で screen reader 対応                                      |
| **`?url=` 再 submit で in-memory cache 破棄、MUST 要件 (実 fetch 回避) が満たせない** (Item 4)                                       | §5.f で確定: **HTTP cache (immutable hash) で reload 後も実 fetch ゼロ** を担保。in-memory cache は Open file 経路の SHOULD 要件のみ。 2 層で MUST / SHOULD を分担                                                                              |
| **`scanMermaidFences().length` / `countMath() > 0` の型エラー** (Item 2、レビュー指摘で判明)                                         | §3.2 で確定: 実コードのシグネチャに合わせて `scanMermaidFences(md) > 0` (number 直接) / `(countMath(md).inline + countMath(md).display) > 0` (object フィールド合算) に修正。設計書の擬似コードを実コード API に揃える                          |
| **runtime decorator の戻り値が void だと AppRuntime 契約と非互換** (Item 3、レビュー指摘で判明)                                      | §3.4 / §5.k で確定: decorator の `loadFromMarkdown` は `Promise<void>` を返し、`return runtime.loadFromMarkdown(name, text)` で base の Promise をそのまま透過。asset-loader だけ `void` で fire-and-forget                                     |
| **canonical 資材に immutable Cache-Control を付けると更新できなくなり fallback の目的と矛盾** (Item 1)                               | §5.f / §5.i / §4 Step 3 で確定: fingerprinted / canonical を **ディレクトリ分離** し、`/fingerprinted/*` は `immutable, max-age=31536000`、`/canonical/*` は `max-age=300` (immutable なし) で独立設定                                          |
| **Mermaid / KaTeX の dynamic import で hash 付き URL が 404 になっても retry 経路がない** (Item 2)                                   | §5.i Item 2 で確定: `loadShikiGrammars` だけでなく `loadMermaidRuntime` / `loadKatexRuntime` (JS / CSS / fonts-extra) すべてで fingerprinted 404 → canonical retry。3 asset 経路で対称な fail-safe                                              |
| **`_headers` の path glob `/mermaid.mjs` は fingerprinted `mermaid.<hash>.mjs` にマッチせず Cache-Control 未適用** (Item 3)          | §5.i / §4 Step 3 で確定: ディレクトリ分離で `/fingerprinted/*` glob が hash 付きファイルすべてを 1 行でカバー。中間 wildcard 不要                                                                                                               |
| **Open file 経路では `#online-source` 自体が hidden で asset failure が表示されない** (Item 4 P2)                                    | §3.4 / §5.l Item 4 で確定: `#online-source-bar` を `#online-source-link` (URL fetch のみ) + `#online-asset-status` (全経路) の 2 子に分割、independent visible。Open file でも status だけ visible で親も visible                               |
| **連続文書ロードで遅延した完了が現世代の status を上書き / 同一 URL 並行 fetch で重複取得** (Item 2)                                 | §5.m で確定: **世代 ID + AbortController + in-flight Promise cache** の 3 段で対処。status 更新は世代 gate で skip、bridge merge は文書非依存なので継続、in-flight cache で同一 URL を 1 Promise に集約、前世代 fetch は abort                  |
| **abort 後も inFlight Map に旧 Promise が残ると、次世代が再利用して即 AbortError で reject される** (Item 1、レビュー指摘で判明)     | §5.m / §3.4 で確定: `currentAbortController.abort()` 直後に `cache.inFlight.clear()` を呼ぶ。abort 済み Promise を Map から完全に切り離し、新世代の同一 URL 要求は新規 Promise を作成。§6 in-source test で回帰防止                             |
| **CLI auto モードの説明 (§2 リファレンス) と Shiki bridge 記述が §3.3 確定設計と矛盾** (Item 3、レビュー指摘で判明)                  | §2 / §3.3 / §5.a / §5.m で確定: `scanMermaidFences(text) > 0` (number 直接) と `(countMath(text).inline + countMath(text).display) > 0` (object 合算) に揃える。Shiki bridge は `installShikiGrammars` 経路 (bridge global なし) に統一         |
| **`fetch` 404 retry を Mermaid/KaTeX に流用しようとして `import()` の reject 原因を判別できない** (Item 3、レビュー指摘で判明)       | §5.i Item 3 で確定: Mermaid / KaTeX (JS) は **「任意 load failure retry」** (理由問わず canonical に retry、`reason = 'recovered-from-load-failure'`)。Shiki / KaTeX (CSS) は **「404 retry」** (`response.status === 404` で判別) で非対称設計 |
| **HTTP cache 受け入れ基準で 304 を「実 fetch ゼロ」に含めると revalidation 往復を見落とす** (Item 4)                                 | §7 で確定: MUST は `(disk cache)` / `(memory cache)` ヒットでネットワークリクエストゼロ。304 は revalidation 往復が発生するため fingerprinted では許容しない (HTML cache は SHOULD で許容)                                                      |
| **§1 対応スコープの擬似記述 (`countMath が 0 を返す`) が実コード API と不一致** (Item 5、レビュー指摘で判明)                         | §1 で確定: 実コード API シグネチャ (`scanFencedLangs: string => []`、`scanMermaidFences: string => number`、`countMath: string => { inline, display }`) に揃える                                                                                |
| **新規修正が staged されず commit に含まれない** (Item 1、レビュー指摘で判明)                                                        | Item 2-5 修正後に `git add docs/feature-online-runtime-assets.md` で staged と作業ツリーを再同期。`vp check` 通過確認の上で 1 commit にまとめる                                                                                                 |
| **fetch transient 失敗で 1 度切り fail**                                                                                             | §5.j で確定: retry なし、`console.warn` + plain text fallback。ユーザーは Open URL modal の re-submit (reload + cache reset) で全 retry。スマホ 3G/4G で何度も retry するより UX 自然                                                           |
| 失敗閾値が絶対件数 (5 件等) だと典型 markdown (1–3 言語) で sile fail                                                                | §5.b で確定: **相対閾値** (試行 N 件のうち 50% 超失敗、または Mermaid / KaTeX 全 runtime 失敗) で `showOnlineError` を発火。1–2 件の Shiki 失敗は silent                                                                                        |
| `Promise.allSettled` の各 reject がエラー集約で漏れる                                                                                | `OnlineAssetLoadResult.failures` に必ず詰める設計。in-source test で「全 reject」「部分 reject」両方を網羅                                                                                                                                      |
| Cloudflare Pages の **per-file 25 MiB 制限 以外** の制限 (合計サイズ / ファイル数)                                                   | Phase A.3 で実機 deploy 検証。`shiki-langs/` 約 235 ファイル + その他 ~20 ファイルで余裕 (Pages 無料枠は ~20,000 ファイル)                                                                                                                      |
| スマホで動作する Mermaid / KaTeX のメモリ使用量が大きい                                                                              | 既存 standalone.html でスマホブラウザでも動作している前例。runtime fetch にしてもメモリ使用量は変わらない                                                                                                                                       |
| 同一オリジン仮定が iframe / 別 hosting で崩れる                                                                                      | スコープ外明示 (§1)。将来のオプション化として `_redirects` / `_headers` で asset prefix を hosting URL に書き換える経路は別タスク                                                                                                               |
| `fetch('/shiki-langs/<lang>.json')` の MIME type が `application/json` でない                                                        | Cloudflare Pages は `.json` を `application/json` で返す既定挙動。`fetch.then(r => r.json())` は MIME に厳格でないため失敗しない                                                                                                                |
| `dist/_headers` で Content-Type 上書きが必要                                                                                         | 必要なら `_headers` に `/shiki-langs/*` → `Content-Type: application/json` を追加。既定挙動で問題なければ書かない                                                                                                                               |
| asset-loader の cache が **同一 session 内で memory leak**                                                                           | Set / boolean の小さいデータのみ持つため leak は微小。page reload で必ずリセット                                                                                                                                                                |
| Phase B / C の Mermaid / KaTeX dynamic import が **bundler の chunk 解決** で詰まる                                                  | `vite.mermaid.config.ts` / `vite.katex.config.ts` で既に 1 ファイル ESM (`codeSplitting: false`) で出力済み。`dist/mermaid.mjs` / `dist/katex/katex.mjs` がそのまま dynamic import 可能                                                         |
| **theme 切替時の Mermaid 再生成が runtime 後追い注入と非干渉**                                                                       | 既存 `mermaid.ts` の `mermaidInitialized` reset 経路はそのまま動く。in-source test (`app/renderers/mermaid.ts`) で theme toggle 後の再 render を確認                                                                                            |

## 9. 参考

- [DESIGN.md §3 ユーザーフロー / 入力](./DESIGN.md#3-ユーザーフロー) — 既存 3 入力経路（ファイル選択 / 埋め込み / URL クエリ）
- [DESIGN.md §9 起動シーケンス](./DESIGN.md#9-起動シーケンス) — boot.ts の優先順チェーン
- [DESIGN.md §11.b CSP](./DESIGN.md#b-content-security-policy二重保険) — 配布物別 CSP の差分原則
- [DESIGN.md §13 ビルドパイプライン](./DESIGN.md#13-ビルドパイプライン) — `mdxg-split-outputs` plugin と 4 配布物
- [docs/feature-online-edition.md](./feature-online-edition.md) §8 — 本プランの方針反転告知と Step 1–7 の経緯
- [docs/archive/mdxg-diagram-rendering.archive.md](./archive/mdxg-diagram-rendering.archive.md) — Mermaid bridge 設計 (`__mdxgMermaid` / `mdxg:mermaid-ready`)
- [docs/archive/mdxg-math-rendering.archive.md](./archive/mdxg-math-rendering.archive.md) — KaTeX bridge 設計 (`__mdxgKatex` / `mdxg:katex-ready`) と font 取り扱い
- [Cloudflare Pages: Limits](https://developers.cloudflare.com/pages/platform/limits/) — per-file 25 MiB 制限
- [MDN: Dynamic import()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import) — bundler 非依存の runtime import
- [MDN: Promise.allSettled](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled) — 個別エラー graceful の標準パターン
