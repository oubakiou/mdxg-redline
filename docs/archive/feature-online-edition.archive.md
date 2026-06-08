# オンライン版 (URL fetch viewer) 設計・実装計画

DESIGN.md §3 入力 / §9 起動シーケンス / §11 信頼境界 / §13 ビルドパイプライン に対応するための設計判断と実装手順をまとめる。本計画では既存の standalone.html / embed-template.html を変更せず、第 3 の配布物として `dist/online.html` を追加し、URL クエリ `?url=<https://...>` から markdown を fetch して描画する経路を導入する。完了時点で DESIGN.md §3 / §9 / §11 / §13 に「オンライン版」を表す節を追記し、本ドキュメントは `docs/archive/feature-online-edition.archive.md` にアーカイブする想定。

> ⚠️ **方針変更あり (§8 参照)**: Step 1–7 は「online.html は standalone と同等の依存内容物 (Shiki bundled 全 grammar / Mermaid / KaTeX inline) を持つ」前提で書かれているが、Step 6 の実機検証で **Cloudflare Pages の per-file 25 MiB 制限** に抵触したため §8 で設計を反転した。以降は **「online.html は最小 shell として配布し、読み込んだ markdown の内容に応じて必要なアセットを runtime で動的 fetch する」** 方針に切り替わる。Step 1–7 の記述のうち「standalone と同等」「~48 MB / gzip ~7 MB」等の前提は §8 で上書きされたものとして読むこと。

## 1. 対応スコープ

「standalone.html ベースで、URL クエリで対象 markdown の URL を受け取って表示できるオンライン版」というユーザー要件を満たす。

| 要件                                                                                  | 現状 | 完了条件                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [MUST] `dist/online.html` を第 3 の配布物として追加 (配布チャネルは §3.1)             | ✓    | `vp build` で `dist/online.html` が出力され、ホスティング先で `/online.html` を開くとビューワーが起動する。配布は git tracked + GitHub Releases / hosting デプロイ経由（npm package には含めない: standalone と同じ運用、§3.1 配布チャネル境界表） |
| [MUST] `?url=<https://...>` で markdown を fetch して描画                             | ✓    | `?url=https://raw.githubusercontent.com/.../README.md` で開くと該当 markdown が描画される                                                                                                                                                          |
| [MUST] 画面上から URL を指定する UI を提供                                            | ✓    | toolbar 等から常時アクセス可能な「Open URL」UI で URL を入力すると、その URL がクエリに反映された状態で再描画される                                                                                                                                |
| [MUST] standalone.html / embed-template.html の信頼境界（`connect-src 'none'`）を維持 | ✓    | 既存 2 HTML の CSP 文字列が一切変わらないことを構造的に保証する                                                                                                                                                                                    |
| [MUST] オンライン版独自の CSP で URL fetch 対象を allowlist 化                        | ✓    | `dist/online.html` の `<meta http-equiv="Content-Security-Policy">` が `connect-src` に明示 allowlist を持つ                                                                                                                                       |
| [MUST] fetch 失敗時の graceful fallback                                               | ✓    | 404 / CORS エラー / timeout / 非 text レスポンスのそれぞれで、persistent な inline error empty-state + 「別 URL を試す」ボタンで Open URL modal を再 open する経路に落ちる (§5.d / Step 5)                                                         |
| [MUST] `file://` 起動時はオンライン版機能を発火させない                               | ✓    | `?url=` 指定時のみ URL fetch を skip し、エラー画面 + "online edition は http(s) 必須" + Open file fallback。`?url=` 未指定時は standalone と等価な空状態で起動（§3.4 / §5.e）                                                                     |
| [SHOULD] fetch 元 URL をステータスバーに常時表示                                      | ✓    | fetch 成功後、画面上部または下部のステータス領域に `Source: <url>` を表示し、`rel="noreferrer noopener"` / `referrerpolicy="no-referrer"` / `target="_blank"` 付き `<a>` でクリック可能（§5.f / §5.h、Referer leak 防止）                          |
| [SHOULD] オンライン版でも Write feedback.json / Copy as JSON / Export as JSON が動く  | ✓    | 既存出力経路 (§3 出力) はそのまま動く（File System Access の workspace-handle はホスティング origin に紐づく）                                                                                                                                     |

追加実装（要件外だが UX 上有用）：

- ホスティング先での CSP ヘッダ (HTTP response header) を meta と二重に設定する考慮（meta だけだと server-side で剥がれる事故を避ける目的）

スコープ外（別タスクで扱う / 意図的に割り切る）：

- 複数ユーザー / リアルタイム共同編集 — DESIGN.md §1 スコープ外を継承
- feedback.json のサーバー保存 / 共有 — 同上、出力はクライアント側のみ
- 認証 / アクセス制限
- 任意 URL のサーバーサイドプロキシ経由 fetch（CORS 回避のための独自サーバー）

## 2. リファレンス実装と差分

URL クエリで外部リソースを受け取って描画する単一 HTML ツールは Web 上に複数存在する。代表的なパターンを 3 つ挙げる：

1. **[mermaid.live](https://mermaid.live/)** — URL クエリ `?code=<base64>` または fragment `#pako:<compressed>` で diagram source を受け、SVG 描画する単一 SPA
2. **[draw.io](https://app.diagrams.net/)** — URL クエリ `?url=<https://...>` で外部 XML を fetch して開く経路を持つ（Google Drive 連携などのバックエンドも別途あり）
3. **[gist.io](https://gist.io/)** — URL pathname `/<gist-id>` で Gist の markdown を fetch して描画

本実装は **配布物が単一 HTML + 外部依存ゼロ + 信頼境界を狭く保つ** という制約のため、上記のうち最もシンプルな draw.io 型（クエリで URL を受けて fetch）の流れを採用しつつ、次の差分を持つ：

| リファレンス実装の典型                           | 本実装での置換                                                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 任意 https URL を fetch（オープン CORS 前提）    | **URL allowlist で fetch 対象を制限**（`raw.githubusercontent.com` 等）                                                               |
| バックエンドプロキシで CORS 回避                 | バックエンドを持たないためプロキシなし。CORS 失敗時はエラー画面に落とす                                                               |
| 配布物が SPA framework（React/Vue/Svelte）で複雑 | 既存 viteSingleFile bundle に第 3 出口を追加するだけで、フレームワーク非依存維持                                                      |
| クエリで code 本文を base64 / 圧縮埋め込み       | 本実装は **URL fetch のみサポート**。本文埋め込みは別途見送り（URL 長制限 / 圧縮込みでも DESIGN.md サイズ級 markdown は破綻するため） |
| CSP は緩い（任意 https に到達可能）              | オンライン版独自 CSP で `connect-src` を allowlist 化                                                                                 |

リファレンス実装群は CORS / SSRF 的攻撃面 / プライバシーへの配慮を「ユーザー責任」に寄せる傾向があるが、本実装は **「LLM 生成 markdown も読み込む」前提 (DESIGN.md §11)** を継承するため、allowlist 経路を採る。詳細は §5.b。

**なぜ allowlist が必要か（補足）**: ブラウザの fetch は CORS 制約により「サーバが `Access-Control-Allow-Origin` ヘッダで明示的に許可している URL」しか取得できないため、allowlist を取らずに `connect-src https:` まで広げてもユーザーが任意 URL を貼って成功するわけではない。それでも allowlist を明示的に設計上の制約として据える理由は、(1) 攻撃面（クエリ経由で任意 GET をブラウザに行わせる経路）を CSP レベルで構造的に閉じる、(2) "どこから取得した markdown か" のレビュワー側の認識を「対応リスト内のホスト」に絞ることでフィッシング的コンテンツの誘導余地を減らす、(3) `dist/online.html` を配置するホスティング側で `_headers` 等の HTTP CSP と一致した期待挙動を保証する、の 3 点。CORS 単独では (1)〜(3) を満たせない（CSP は受動的制約として効くが、CORS はサーバ任意の挙動）。

**CORS が失敗する典型ケース**:

- 認証必須エンドポイント（private GitHub repo の raw / 社内 wiki / Google Drive Direct URL 等）: `Access-Control-Allow-Origin` ヘッダが付かない、または `*` 以外の制限的な値
- 一部 OSS hosting（GitLab self-hosted の素の構成 / Bitbucket raw URL 等）: 既定で CORS ヘッダが付かないことが多い
- ブラウザの "redirect chase" 中に途中の hop が CORS NG（リダイレクト経路の一つでも `Access-Control-Allow-Origin` が欠ければ全体が失敗）
- `https://` 以外のスキーム（`http://` / `ftp://` / `file://` 等）: そもそも `connect-src https://...` allowlist の対象外
- preflight が走るリクエスト（カスタムヘッダ付与時等）に `OPTIONS` メソッドのレスポンスが欠ける

本実装は GET / 標準ヘッダのみで markdown を取りに行く設計のため preflight 経路は基本走らないが、allowlist のホストが将来 CORS ポリシーを変えた場合の検知のため、Step 6 ホスティング検証時に対応ホストごとに実機 fetch を回す（§5.d エラーカテゴリ参照）。

## 3. 設計の中核要素

### 3.1 配布物の 3 系統化

既存の 2 出口に第 3 の `dist/online.html` を追加する。3 出口は共通の `src/review.html` を入力に派生し、構造的不変条件（`<script id="embedded-md">` 等のタグ位置、§13）は同じ。差は **埋め込みコンテンツ / CSP / `data-mdxg-online` 属性経由の gated UI のみ**：

| 配布物                     | 用途                      | embedded-md    | CSP `connect-src`                                   | URL fetch 経路 | Open URL UI               | ホスティング前提  |
| -------------------------- | ------------------------- | -------------- | --------------------------------------------------- | -------------- | ------------------------- | ----------------- |
| `dist/standalone.html`     | ローカル Open file        | 空             | `'none'`                                            | 無効           | hidden（CSS + JS gating） | `file://` メイン  |
| `dist/embed-template.html` | CLI rewrite テンプレート  | 空（CLI 注入） | `'none'`                                            | 無効           | hidden（CSS + JS gating） | CLI 経由のみ      |
| `dist/online.html` (新規)  | オンライン版（URL fetch） | 空             | allowlist (例: `https://raw.githubusercontent.com`) | **有効**       | visible（toolbar に表示） | `http(s)://` 専用 |

ビルドは `vite.online.config.ts` を新規追加するか、既存 `vite.config.ts` の `mdxg-split-outputs` plugin に第 3 経路を追加する。設計判断は §5.a。

**Open URL UI の gating 不変条件**: `src/review.html` は 3 配布物の共通入力なので、Open URL ボタン / Open URL modal の DOM 要素は HTML レベルで 3 配布物すべてに含まれる。standalone / embed-template に "壊れた URL UI" が混入することを防ぐため、以下の 2 層 gating を必須とする：

- **CSS gating**: 既定 `.toolbar-open-url { display: none }` + `:root[data-mdxg-online] .toolbar-open-url { display: inline-flex }` を `src/styles/review.css` に書く。`data-mdxg-online` 属性が立っていない配布物では DOM 上は存在しても完全に hidden
- **JS gating**: `src/app/online/open-url-modal.ts` の event handler attach 経路を `document.documentElement.hasAttribute('data-mdxg-online')` で gate。属性なしでは modal を開く経路が boot.ts レベルで存在しない

この invariant は §6 in-source test で「standalone.html / embed-template.html の build 後 HTML 内に `data-mdxg-online` 属性が存在しないこと」「`<style>` 内に `.toolbar-open-url { display: none }` が含まれること」を検査する形で構造的に担保する。

**配布チャネルの境界**: 3 配布物は配布経路が異なる。

| 配布物                     | git tracked | `package.json` の `files`       | 主な配布経路                                                       |
| -------------------------- | ----------- | ------------------------------- | ------------------------------------------------------------------ |
| `dist/embed-template.html` | ✓           | ✓                               | npm package (`npx mdxg-redline` CLI が読み込んで rewrite)          |
| `dist/standalone.html`     | ✓           | ✗（巨大すぎる、CLI 不要のため） | GitHub Releases から手動ダウンロード、`file://` で直接 open        |
| `dist/online.html` (新規)  | ✓           | ✗（standalone と同じ運用）      | ホスティング (Cloudflare Pages 等) にアップロードして http(s) 配信 |

online.html を `files` に **追加しない理由**: standalone と同じく ~46 MB あり npm package size を不要に肥大化させる。online edition のユーザーは hosting デプロイのために手動で取得するのが想定パターン (CLI 経路では使わない)。git tracked にする理由: standalone と同じく source-of-truth として PR レビュー時に diff を確認できる必要があるため (build artifact を branch 間で比較する用途)。

### 3.2 URL クエリスキーマ

`dist/online.html` 起動時に `location.search` をパースし、次のクエリパラメータを解釈する：

| キー  | 値            | 必須 | 挙動                                                   |
| ----- | ------------- | ---- | ------------------------------------------------------ |
| `url` | `https://...` | -    | allowlist 検証後 fetch、成功すれば markdown として描画 |

`state.docName` は URL pathname の末端から推定する（例: `.../docs/SPEC.md` → `SPEC.md`）。クエリでの上書き経路は持たない。

`url` 未指定で開かれた場合は標準版と同じ空状態で起動し、ユーザーは toolbar の「Open URL」UI または既存の Open file 経路から markdown を読み込む（§3.4 / §5.f）。

### 3.3 URL allowlist と CSP

オンライン版独自の CSP は標準版（`src/review.html:8` の現状値）を継承しつつ `connect-src` のみ差分を持つ：

```
default-src 'none';
script-src 'self' 'unsafe-inline';
style-src 'unsafe-inline';
img-src https: data:;
connect-src https://raw.githubusercontent.com https://gist.githubusercontent.com;
base-uri 'none';
form-action 'none';
```

`connect-src` allowlist は次の 2 ドメインを default とする：

- `raw.githubusercontent.com` — GitHub repo の raw markdown（最も典型的なユースケース）
- `gist.githubusercontent.com` — Gist の raw markdown

ビルド時に環境変数 `MDXG_ONLINE_CONNECT_SRC` でホスティング先ごとに追加 allowlist を指定できる設計（既定は上記 2 ドメイン）。詳細は §5.b。値は CSV 形式（`https://host1.example,https://host2.example,...`）で、`vite.config.ts` の `mdxg-split-outputs` plugin（または新規 plugin）が `process.env.MDXG_ONLINE_CONNECT_SRC` を読んで build 時に CSP 文字列に展開する。既存 `MDXG_REDLINE_PORT` (DESIGN.md §3 / `src/cli/serve.ts`) と命名一貫。

**allowlist の単一情報源化（重要）**: env var から展開されるのは CSP `connect-src` だけではない。同じ env var を build plugin が 2 系統に分配する：

1. **CSP `connect-src` ディレクティブ** — `<meta http-equiv="Content-Security-Policy">` に文字列展開（ブラウザ層での強制）
2. **JSON config ブロック** — `<script type="application/json" id="online-allowlist">["https://raw.githubusercontent.com","https://gist.githubusercontent.com",...]</script>` を `online.html` のみに inline（JS 層の `validateOnlineUrl` が起動時に `JSON.parse` して読む）

`<script type="application/json">` は実行されない pure data ブロックなので XSS 経路を増やさず、既存の `<script id="embedded-md">` / `<script id="embedded-feedback">` と同じ規約（DESIGN.md §13 構造的不変条件）に従う。`boot.ts` が `data-mdxg-online="1"` を検出した経路のみ JSON config を読み、standalone / embed-template には JSON config 自体を inline しない（CSS / JS gating と整合）。

これにより、`MDXG_ONLINE_CONNECT_SRC=https://example.com` で build した場合：CSP が `https://example.com` を `connect-src` で許可、JSON config にも `https://example.com` が含まれ、`validateOnlineUrl(?url=https://example.com/...)` が accept する、という整合が構造的に成立する。drift 検出は §6 in-source test で行う。

**`font-src` ディレクティブの扱い（既存乖離との関係）**: 標準版の現状 CSP には `font-src data:` が含まれていないため、本オンライン版 CSP からも `font-src` は省く（差分原則の維持）。ただし DESIGN.md §11b が「KaTeX 数式フォント用に `font-src data:` 必須」と明記しており、これは現状 src/review.html と DESIGN.md の間の既存乖離である。詳細と修正計画は [`docs/bug-csp-font-src-missing.md`](./bug-csp-font-src-missing.md) に切り出し済みで、その bug 修正後にオンライン版 CSP も `font-src data:` を追加する形で自動追従する。

**CSP `connect-src` の照合単位**: ディレクティブの値は scheme + host + port の origin 単位で評価され、path 部分は照合対象外（CSP Level 3 仕様）。つまり `raw.githubusercontent.com` を allowlist に含めた時点で、同 host 配下の任意 path（任意 user / repo / ref / file）が fetch 可能になる。「特定 repo / branch だけ許可」のような path-level の絞り込みは CSP では実現できないため、クライアント側の検証 (`src/core/online-url.ts`) や UI 上の警告で補う必要がある場合は §5.b で別途設計する。

ブラウザ側のクライアント検証ロジック (`src/core/online-url.ts` 新規) も同じ allowlist を持ち、fetch 前に URL を検証する。CSP と二重防御：CSP は技術的な強制、クライアント検証はエラーメッセージを早めに出す UX 目的。

### 3.4 起動シーケンス分岐

DESIGN.md §9 の起動シーケンスに URL クエリ経路を追加する：

```
0. IndexedDB から workspace-handle をサイレント復元（既存）

1. オンライン版判定（dist/online.html 由来か）
   1a. <html data-mdxg-online="1"> が設定済みか確認（ビルド時に online.html だけ付与）
   1b. オンライン版なら 2 へ、それ以外は 3 へ（既存の embedded-md 経路）

2. URL クエリ ?url= の処理（オンライン版のみ）
   2a. URLSearchParams で url を取得
   2b. url 未指定なら 4 へ（無音 fallthrough、error UI も出さない）
   2c. url 指定ありで location.protocol が http(s) でない場合、
       showOnlineError "online edition は http(s) でホスティングされた環境でのみ機能します"
       (= persistent empty-state、§5.d) + 4 へ fallthrough
       (file:// では Open file 経路を残す、§5.e)
   2d. url 指定ありで http(s) なら fetchMarkdownFromUrl(url, opts, allowlist) を呼ぶ
       (allowlist 検証は fetchMarkdownFromUrl が内部で fetch 前・fetch 後の
        2 回実施する。詳細は Step 2 の「allowlist 検証の二段防御」参照)
       - ok: <html>.has-embedded-md class を追加して default empty-state を隠す
                       → showOnlineSource(finalUrl) で Source link を toolbar に表示
                       → loadFromMarkdown(deriveDocNameFromUrl(url), text)
                       → DESIGN.md §9 既存経路 1c (embedded-feedback 適用) 1d (render) に合流
       - エラー: showOnlineError(§5.d カテゴリ別メッセージ) で persistent empty-state を表示
                + 「別 URL を試す」ボタンで Open URL modal を再 open する経路 + 4 へ fallthrough
                (pre_validation_failed / redirected_off_allowlist /
                 http_error / timeout / network_error / size_exceeded /
                 unsupported_content_type)
   2e. online edition では 2 の結果に関わらず 3 (embedded-md) を skip
       (online.html に placeholder embedded-md が事故注入された場合の
        「無関係 doc 描画」経路を構造的に塞ぐ)

3. embedded-md (<script id="embedded-md">) があれば適用（既存、online.html では到達しない）

4. それ以外は空状態のまま Open file / toolbar の Open URL ボタン待ち
```

**実装関数対応** (Step 4 / Step 5 で実装済み):

| 擬似コードステップ        | 実装関数                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1a                        | `boot.ts:isOnlineEdition()`                                                                                        |
| 2a, 2b                    | `boot.ts:readUrlQuery()`                                                                                           |
| 2c                        | `boot.ts:isHttpProtocol(globalThis.location.protocol)` 判定                                                        |
| 2d (allowlist 読み込み)   | `boot.ts:readOnlineAllowlistFromDom()` (`src/core/online-allowlist-config.ts:resolveOnlineAllowlistFromJson` 経由) |
| 2d (fetch)                | `tryFetchAndLoad()` → `fetchMarkdownFromUrl()`                                                                     |
| 2d (成功 → 描画 + Source) | `runtime.loadFromMarkdown()` + `source-display.ts:showOnlineSource(finalUrl)` (Step 5)                             |
| 2d (失敗 → error UI)      | `formatFetchFailureMessage(failure)` + `error-display.ts:showOnlineError(message)` (Step 5、persistent inline)     |
| 1a + 2 全体               | `boot.ts:loadFromOnlineUrlQuery(runtime)` (orchestrator)                                                           |
| 2e                        | `boot()` の `isOnlineEdition()` ガード後の `return`                                                                |
| toolbar Open URL ボタン   | `open-url-modal.ts:wireOpenUrlModal()` (Step 5、§3.1 二層 gating で online のみ wire)                              |
| modal submit → reload     | `open-url-modal.ts:buildReloadHref` + `globalThis.location.assign` (encodeURIComponent で `&` / `?` 注入回避)      |
| 「別 URL を試す」ボタン   | `error-display.ts:wireOnlineErrorRetry()` → `openOpenUrlModal()` (Step 5)                                          |
| Esc で modal を閉じる     | `global-keyboard.ts:handleEscapeKey` → `closeOpenUrlModal()` (他 modal と同列、Step 5)                             |

**順序の根拠**: `?url=` 未指定で `file://` から online.html を開いた場合、ユーザーは URL fetch を発火していないため、protocol 警告を出すのは過剰。`?url=` 指定時のみ protocol 警告を発火させ、それ以外は standalone と等価な空状態にすることで、§5.e の「`file://` 起動時にも Open file 経路は動かす」方針と整合する。Open URL ボタン経由の protocol 警告は modal の送信ハンドラ内で再チェックする (Step 5 で実装)。

オンライン版判定フラグ `data-mdxg-online="1"` をビルド時に `online.html` のみに付与する理由：boot.ts の単一エントリで全 3 配布物を扱うため、HTML 側のマーカーで分岐を切る。standalone.html / embed-template.html は属性なし、boot.ts は属性 nil なら従来経路を辿る。

**既存 §9 経路との合流ポイント**:

- **embedded-feedback の扱い**: online.html は CLI rewrite を経由しないため `<script id="embedded-feedback">` ブロックは常に空。よって §9 1c の resume 経路は実質的に no-op になる（型ガードを通って空配列を返すだけ）。前ラウンドの feedback.json から復元したい場合は Open file で `<basename>-<docHash>-feedback.json` を別途読み込ませる UI 経路を将来検討（本プランではスコープ外）
- **workspace-handle の origin スコープ**: §9 0. の `workspace-handle` 復元は IndexedDB ベースで、origin (`https://<host>`) に紐づく（DESIGN.md §7a）。ホスティング先 origin が同一なら同じユーザーのブラウザは picker 無しで再開できるが、**複数ユーザー間では各自のブラウザ IDB に独立して保存され共有はされない**（オンライン版は "1 人レビュワー" モデルを継承）
- **docHash の再現性**: fetch 取得した markdown も `loadFromMarkdown` 内で SHA-256 を計算するため、同一 markdown であれば standalone / CLI 経路と完全に同じ `docHash` が得られる（§5 データモデル invariant）。これにより同じ `<mdFileName>-<docHash>-feedback.json` 命名規約 (DESIGN.md §8) が成立し、後段 LLM が経路を問わず対応付けられる

### 3.5 信頼境界の継承と境界線

オンライン版でも次の既存信頼境界 (§11.a) はすべて維持する：

- raw HTML は escape all（renderer 層で文字エスケープ、`<script>` / event handler は DOM として出ない）
- リンク / 画像の URL スキーム allowlist（`http(s):` / `data:` / 同ページ anchor 限定）
- Shiki / Mermaid / KaTeX の sanitize 設定（`securityLevel:'strict'` / `trust:false` 等）
- embedded feedback の型ガード

**fetch 取得 markdown の信頼境界経路（最重要 invariant）**: §3.4 の擬似コード 2d で fetch 成功した markdown 本文は、**既存の embedded-md / Open file 経路と完全に同じ `loadFromMarkdown(text, name)` を経由する**。すなわち：

- fetch → `state.markdown` への代入
- `core/markdown.ts` の renderer 経由で marked が parse（raw HTML escape / `Renderer.link` / `Renderer.image` の URL allowlist が同じパスで適用される）
- Shiki / Mermaid / KaTeX upgrade も既存経路（`securityLevel:'strict'` / `trust:false`）
- embedded feedback の型ガード (`feedback.ts`) も同じ関数

fetch 起源で独自の rendering / sanitize 経路を持たないことを構造的に保証する（boot.ts に分岐を追加する際の不変条件 — 新規 renderer / 別 escape 関数を作らない）。

オンライン版で新たに開く攻撃面：

1. **fetch 経路の SSRF 的悪用** → CSP `connect-src` allowlist で構造的に塞ぐ
2. **URL クエリ経由でフィッシング的コンテンツを「信頼された UI」に乗せる** → raw HTML escape all が継続的に有効。ただしユーザーに対して「この markdown は外部 URL 経由」であることをステータスバー等で可視化する案を §5.f で検討
3. **URL がサーバアクセスログに残る** → §5.h で扱う

### 3.6 配布物サイズ見積もり

`dist/online.html` の見積もりサイズ：

| 構成                                                                | 配布物サイズ          | 増分（standalone 比） |
| ------------------------------------------------------------------- | --------------------- | --------------------- |
| standalone.html (現状)                                              | ~48 MB / gzip ~6.9 MB | —                     |
| online.html (URL fetch + Open URL modal + エラー画面 + Source 表示) | ~48 MB / gzip ~7.0 MB | +約 3-5 KB gzipped    |

増分の内訳見積もり：

- `core/online-url.ts`（URL 検証 / fetch ラッパ）: ~1-2 KB gzipped
- `app/online/open-url-modal.ts`（toolbar Open URL ボタン + modal + 入力 UI）: ~1-2 KB gzipped
- エラー画面（カテゴリ別メッセージ + 再試行 UI）: ~0.5-1 KB gzipped
- ステータスバー Source 表示: ~0.3-0.5 KB gzipped
- CSP / `data-mdxg-online` 属性 / boot.ts 分岐: ~0.2 KB gzipped

合計 3-5 KB gzipped を上限と見込む。Shiki / Mermaid / KaTeX runtime は standalone と同じく事前 inline するため、サイズの大部分はそちらが占める。`§7` 受け入れ基準の +5 KB gzipped 上限はこの見積もりの最大値に合わせている。

ホスティング先での gzip 配信に対応していれば、初回ロード ~7 MB の体感は ~2-3 秒。一度キャッシュされれば即時。

## 4. 実装ステップ

順序は依存関係順。各ステップ完了で in-source test と手動視覚チェックを通す。

### Step 1: 設計判断確定と PoC — 実装済み

- 本ドキュメント §5 の設計判断をレビュー
- `raw.githubusercontent.com` への fetch + CORS が想定通り動くかを localhost で実機検証
- ホスティング先候補（Cloudflare Pages / Vercel / Netlify）の CSP ヘッダ挙動を 1 つ選んで実測

成果物：§5 マッピング表が確定、PoC で `fetch('https://raw.githubusercontent.com/.../README.md')` が CORS パスする確認

#### Step 1 PoC 実測結果

- `raw.githubusercontent.com` / `gist.githubusercontent.com` ともに GET 応答に `Access-Control-Allow-Origin: *` を返す（任意 origin から CORS 可）
- `Content-Type` は両者とも `text/plain; charset=utf-8` → §5 既定 `acceptedContentTypes` の `text/plain` でカバー
- `Content-Length` ヘッダが付与される → `fetchMarkdownFromUrl` の 2 段防御 1 段目（事前チェック）が機能する
- `OPTIONS` preflight は `403` を返す（GET 本体は許可）。`fetch()` を simple request（GET + カスタムリクエストヘッダ無し）で発行することで preflight を回避する。詳細は Step 2 の **CORS preflight 制約** を参照
- Cloudflare Pages の HTTP response header カスタマイズは `_headers` ファイル経由で `Content-Security-Policy` を含む任意 header を上書き可能。Step 6 で実機デプロイ時に最終検証する

### Step 2: pure ロジック層（URL 検証 / fetch ラッパ） — 実装済み

UI / DOM に依存しない pure 関数を `src/core/online-url.ts` として実装し、in-source test を通す。

```ts
export function validateOnlineUrl(input: string, allowlist: readonly string[]): ValidationResult
export async function fetchMarkdownFromUrl(
  url: string,
  opts: FetchOpts,
  allowlist: readonly string[]
): Promise<FetchResult>
```

- `validateOnlineUrl`: URL parse → protocol https チェック → **origin** allowlist 照合 → 結果型を返す。`URL#origin` (`<scheme>://<host>[:<port>]`) と allowlist エントリの完全一致で比較するため、`DEFAULT_ONLINE_ALLOWLIST` / `MDXG_ONLINE_CONNECT_SRC` も同じ origin 形式（例: `https://raw.githubusercontent.com`）で持つ。CSP `connect-src` ディレクティブの値表記および §3.3 の JSON config と同形にすることで drift を構造的に避ける。pure 関数として独立提供し、UI 層 (toolbar の Open URL submit handler 等) からも呼べる
- `fetchMarkdownFromUrl`: 同じ allowlist を引数に取り、**fetch 前後で 2 回 allowlist 検証する境界関数**。fetch 前は `validateOnlineUrl` を内部呼び出し、fetch 後は `Response.url`（最終 URL）の origin を再検証する。AbortController 付き fetch → status / content-type / body サイズ上限 → 統一エラー型を返す。caller (boot.ts) は `fetchMarkdownFromUrl(url, opts, allowlist)` を呼ぶだけで両層の防御が成立する
- 境界条件: 不正 URL / scheme 不一致 / origin allowlist 外（fetch 前検証） / 404 / CORS / timeout / 非テキストレスポンス / サイズ超過 / **redirect 後の最終 URL が allowlist 外（fetch 後検証）**

**allowlist 検証の二段防御**: `fetchMarkdownFromUrl` は同じ allowlist 引数に対して fetch 前後で 2 回検証する。

1. **fetch 前検証（`validateOnlineUrl` 内部呼び出し）**: caller の validate 呼び忘れ防止と、`https://attacker.example/redirect-to-raw` のように初回 GET だけ allowlist 外に飛ばす攻撃を内部完結で塞ぐ。fetch を発火させずに `pre_validation_failed`（`reason: malformed | scheme_not_https | host_not_allowlisted`）を返す
2. **fetch 後検証（`checkFinalUrl`）**: `FetchOpts.redirect: 'follow'` の根拠で「CSP `connect-src` がリダイレクト各 hop を再評価するため allowlist 外への 302 はブラウザ層で block される」と書いた通り、CSP が正しく効く前提では追加追跡不要。ただし CSP 設定ミス / `<meta>` タグだけが効いて HTTP response header が剥がれた等のシナリオに備え、`Response.url`（最終 URL）の origin が allowlist にあるかを再検証し、外れていれば `redirected_off_allowlist` を返す（defense-in-depth）

役割分担: **fetch 前検証 = caller 契約の不可分化 + 初回 GET 漏出防止**、**fetch 後検証 = CSP drift の保険**。caller (§3.4 boot.ts) は `fetchMarkdownFromUrl` を呼ぶだけで両層がカバーされる。UI 層が `validateOnlineUrl` を別途呼ぶのは早期 UX フィードバック目的（submit 前にボタンを disabled にする等）で security 上の必須事項ではない。エラー画面のメッセージは §5.d のエラーカテゴリで扱う。

**CORS preflight 制約**: 既定 allowlist の `raw.githubusercontent.com` / `gist.githubusercontent.com` は GET 応答に `Access-Control-Allow-Origin: *` を返す一方、`OPTIONS` preflight には `403` を返す（Step 1 PoC 実測）。`fetchMarkdownFromUrl` は `fetch()` を simple request の条件で発行し preflight を回避する。`Accept` / `Accept-Language` / `Content-Language` などの [CORS-safelisted request header](https://developer.mozilla.org/en-US/docs/Glossary/CORS-safelisted_request_header) は値が safelisted の制約を満たす限り simple request のまま維持される（preflight は走らない）ので、必要なら content negotiation 目的で `Accept` を付けてよい。一方 `Authorization` や独自 `X-*` ヘッダなど safelist 外のヘッダを付けると preflight が走り 403 で破綻するので、実装上は safelist 外ヘッダを付けない。allowlist 拡張時に同条件を満たさないホストを追加する場合は、そのホストの preflight 挙動を個別に再確認すること（in-source test で host ごとの分岐をハードコードしない）。

**`FetchOpts` の既定値（実装閾値）**:

| パラメータ             | 既定値                                                                                     | 根拠                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `timeoutMs`            | 15000 (15 秒)                                                                              | OSS hosting からの典型 fetch は ~1 秒、CDN 経由で遅くても ~5 秒。15 秒は再試行 UI に倒す前のユーザー忍耐上限                                                                                                                                                                                                                                                                |
| `maxBodyBytes`         | 5 \* 1024 \* 1024 (5 MB)                                                                   | DESIGN.md 級 (~180 KB) の 25 倍余裕、book 級も射程内。配布物 HTML 7 MB と均衡を取る上限。**強制タイミングは §下記「サイズ上限の 2 段防御」を参照**                                                                                                                                                                                                                          |
| `acceptedContentTypes` | `text/markdown` / `text/plain` / `text/x-markdown` / `application/octet-stream` / 空文字列 | raw.githubusercontent.com は `text/plain`、`gist.githubusercontent.com` は `text/plain`、GitLab raw は `text/markdown` を返す。`application/octet-stream` は CORS 経由の bare 文字列に対する保険、空文字列は古いプロキシ対策                                                                                                                                                |
| `redirect`             | `'follow'`（ブラウザ既定）                                                                 | cross-origin で `'manual'` を指定すると opaqueredirect レスポンスになり `Location` / `Response.url` / status を JS から読めず、本実装側で hop 数を追跡する経路が成立しない（W3C Fetch 仕様）。CSP `connect-src` はリダイレクト各 hop ごとに再評価される（CSP Level 3 仕様）ため、allowlist 外への 302 はブラウザ層で block される。本実装側追跡なしで security は担保される |

これらは Step 1 PoC で実測のうえ確定済み。`acceptedContentTypes` allowlist は wildcard を使わず明示列挙にする（攻撃面の縮小）。

**サイズ上限の 2 段防御**: `Response.text()` で全 body を読んでからサイズ判定すると、悪意ある 100 MB レスポンスをすべてメモリに乗せた後に reject することになり、上限の意味が薄い。`fetchMarkdownFromUrl` は次の 2 段で `maxBodyBytes` を強制する：

1. **`Content-Length` 事前チェック**: レスポンスヘッダの `content-length` が `maxBodyBytes` を超えるなら `AbortController.abort()` + 即 reject（body を読まずに済む最軽量経路）
2. **stream 読み出し中の累積監視**: `Content-Length` がない / 嘘の場合に備え、`response.body.getReader()` で逐次読み出し。各 chunk ごとに累積バイト数を加算、`maxBodyBytes` を超えた時点で `AbortController.abort()` + reject

実装スケッチ：

```ts
async function fetchMarkdownFromUrl(url, opts) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs)
  try {
    const res = await fetch(url, { signal: ac.signal, redirect: 'follow' })
    if (!res.ok) return { error: 'http_error', status: res.status }

    // 1. Content-Length pre-check
    const cl = res.headers.get('content-length')
    if (cl && Number(cl) > opts.maxBodyBytes) {
      ac.abort()
      return { error: 'size_exceeded', reportedBytes: Number(cl) }
    }

    // 2. Streaming with cumulative limit
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let received = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.length
      if (received > opts.maxBodyBytes) {
        ac.abort()
        return { error: 'size_exceeded', receivedBytes: received }
      }
      chunks.push(value)
    }

    return { text: new TextDecoder().decode(concat(chunks)) }
  } finally {
    clearTimeout(timer)
  }
}
```

成果物：`src/core/online-url.ts` + in-source test（正常系 / allowlist hit/miss / scheme チェック / 各 fetch 失敗ケース / 空 URL / timeout / **`Content-Length` 事前チェックでの size_exceeded** / **`Content-Length` が嘘で stream 中に size_exceeded** / **`Content-Length` 不在で stream 中に size_exceeded** / 非対応 content-type / CSP block 経由のリダイレクト失敗 / **redirect 後の最終 URL allowlist 外で `redirected_off_allowlist`** / **fallback path の `receivedBytes` が UTF-8 byteLength** / **fetch 前検証で `pre_validation_failed` (allowlist 外初回 URL は fetch されない)**）

### Step 3: ビルドパイプライン拡張 — 実装済み

`vite.config.ts` + `mdxg-split-outputs` plugin を拡張し、`dist/online.html` を 3 つ目の出口として生成する。

- 中間出力 `dist/review.html` から `dist/online.html` を派生（既存の standalone / embed-template と同様の rewrite 経路）
- `<html data-mdxg-online="1">` 属性を付与
- `<meta http-equiv="Content-Security-Policy">` を online 版用に書き換え（`connect-src` を allowlist に差し替え）
- **allowlist の単一情報源を build plugin に閉じ込める**: pure 関数 `buildOnlineAllowlist(env: NodeJS.ProcessEnv): readonly string[]` で env var (`MDXG_ONLINE_CONNECT_SRC`) を読み正規化、`process.env` の不在 / 空 / 不正値で既定 2 ドメインに落とす。戻り値を build plugin が 2 系統に派生：
  - CSP `connect-src` ディレクティブの文字列に展開
  - `<script type="application/json" id="online-allowlist">[...]</script>` ブロックを生成し、`online.html` の `<head>` に inline（standalone / embed-template には inline しない）

**`buildOnlineAllowlist` の正規化規則**:

| 入力                                | 挙動                                                                 |
| ----------------------------------- | -------------------------------------------------------------------- |
| env 未設定 / 空文字 / 空白のみ      | `DEFAULT_ONLINE_ALLOWLIST` (raw / gist の 2 origin) をそのまま返す   |
| `https://example.com`               | accept (DEFAULT に union)                                            |
| `https://example.com/`              | trailing slash を strip して accept (`https://example.com` に正規化) |
| `https://Example.COM.`              | 大文字小文字 + 末尾ドットを正規化して accept (`https://example.com`) |
| `https://wiki.internal:8443`        | port を保持                                                          |
| DEFAULT に既出の entry              | dedupe (出力順は DEFAULT 先頭、env 追加が後ろ)                       |
| 空 entry (連続カンマ `a,,b`)        | silent skip (warn 無し)                                              |
| `http://x` / scheme なし / 不正 URL | warn + skip                                                          |
| `https://x/path` (pathname 付き)    | warn + skip (origin 形式のみ accept)                                 |
| `https://x?q=1` / `https://x#h`     | warn + skip                                                          |

`process.env` 直参照のため同一 git commit でも env 違いで `dist/online.html` が変わる。build 再現性確保のため、splitOutputsPlugin は解決済み allowlist を `[mdxg-online] dist/online.html allowlist (N): <origins>` の形で必ず stdout に emit する。

ビルド系統チェーンへの影響：`dist/online.html` は `standalone.html` と同等で Shiki bundled 全言語 + Mermaid + KaTeX (`all` 相当) を inline する（オンライン版を開いたユーザーが任意の markdown を流し込めるよう、依存範囲も最大にしておく）。

成果物：`vp build` で 3 つの HTML が `dist/` に出力される。CSP / `data-mdxg-online` 属性 / `<script id="online-allowlist">` JSON の差分が in-source test で検証される。drift 検出のため CSP `connect-src` の host 集合と JSON config の host 集合が完全一致することも検査する。

**実機実測 (Step 3 build-only, env 未設定時)**: `dist/online.html` 46.6 MB / `dist/standalone.html` 46.6 MB、差分は **+227 bytes**（§7 受け入れ基準 +5 KB gzipped 上限を大きく下回る）。boot.ts / UI / Source 表示の注入は未済なので Step 4-6 完了時に再計測する。

### Step 4: 起動シーケンス分岐（boot.ts） — 実装済み

`src/app/boot.ts` に §3.4 の優先順チェーンを追加する。

- オンライン版判定（`document.documentElement.dataset.mdxgOnline === '1'`、`isOnlineEdition()` ヘルパ）
- URL クエリ取得（`URLSearchParams(location.search)` の `?url=`、`readUrlQuery()` ヘルパ）
- `location.protocol` 検証（`http:` / `https:` 以外は showOnlineError、Step 4 当初は toast → Step 5 で persistent empty-state に置換済み）
- DOM の `<script id="online-allowlist">` 読み出し（`resolveOnlineAllowlistFromJson(elementText(el))`、build 由来 JSON が壊れていれば `DEFAULT_ONLINE_ALLOWLIST` に fallback）
- fetch 実行（`fetchMarkdownFromUrl(url, opts, allowlist)`、allowlist 検証は wrapper 内で fetch 前後の二段防御）
- 結果を `runtime.loadFromMarkdown(deriveDocNameFromUrl(url), result.text)` に流す（既存の入力経路 1 / 2 と合流）
- 各 fetch 失敗は `formatFetchFailureMessage(failure)` でカテゴリ別メッセージを生成し、Step 4 当初は toast → Step 5 で `showOnlineError()` 経由の persistent empty-state + 「別 URL を試す」ボタンに置換済み (§5.d)

成果物：

- `?url=<valid>` を allowlist 内 origin で開くと markdown が描画される
- `?url=` **未指定** → 無音 fallthrough で空状態 (toast なし、Open file 経路は残る)
- `?url=` **指定 + protocol 不一致 / 無効 URL / allowlist 外 / fetch 失敗** → §5.d カテゴリ別の persistent empty-state + 「別 URL を試す」ボタン (Step 4 当初は toast → Step 5 で置換済み)

### Step 5: UI 層（toolbar Open URL ボタン / エラー画面 / Source link） — 実装済み

オンライン版で常時 URL 指定経路にアクセスできるよう、`src/app/online/` 配下に最小 UI を実装した。

- 既存 toolbar (`src/review.html` 静的配置) に **Open URL ボタン** (`#btn-open-url`) を Open file ボタン近傍に追加。`data-mdxg-online="1"` 配下のみ visible (`.toolbar-open-url` CSS gating)、`wireOpenUrlModal()` も同条件で JS gating する二層防御
- クリックで modal (`#open-url-modal-backdrop`) を開き、Markdown URL の入力フィールド + 送信ボタンを表示。modal は `createStaticModalController` 経由で focus 復元 / backdrop click / Cancel / Esc (global-keyboard 統合) を共通実装に委譲
- submit 時に `buildReloadHref(origin, pathname, input)` で `?url=<encodeURIComponent(input)>` を構築し `globalThis.location.assign` で同一ページを reload。`encodeURIComponent` で `&` / `?` / `#` / 非 ASCII を escape し、本ページのクエリと混線しない
- 既存の Open file ボタン経路 (§3 入力 1) はそのまま併存（ローカルファイル選択もオンライン版で使える）
- **fetch 失敗時の persistent error UI**: `#empty-state-online-error` (Step 5 で追加) に `formatFetchFailureMessage(failure)` のメッセージを inject + `#empty-state-default` を hide。「別 URL を試す」ボタン (`#online-error-retry`) で Open URL modal を再 open する経路を提供 (1.8s で消える toast ではなく persistent な empty-state を採用、§5.d)
- **Source link 表示**: `tryFetchAndLoad` 成功時に `showOnlineSource(result.finalUrl)` を呼び、`#online-source` span に `<a rel="noreferrer noopener" referrerpolicy="no-referrer" target="_blank">` 3 属性付きの link を inject (§5.f Referer leak 防止)。`buildSourceLinkHtml` は `https:` 以外を inert text に倒す defense-in-depth 検証を含む

新規ファイル: `src/app/online/{open-url-modal,source-display,error-display}.ts` (各 4 件の in-source test) + `src/review.html` / `src/styles/review.css` の静的配置と CSS gating + `src/app/app-wiring.ts` の `setupOnlineEditionUi` wire + `src/app/chrome/global-keyboard.ts` の Esc handler 統合。

成果物：online.html 起動時に toolbar から URL 指定ができ、エラー時にも persistent な復帰経路がある。実装関数の擬似コードステップ対応は §3.4「実装関数対応」表を参照。

### Step 6: ホスティング設定 — 配信ファイル emit 実装済み / 実機配信は未着手

最初のホスティング先を 1 つ選んで実機配信を行い、CSP / CORS / gzip 配信が想定通り動くことを確認する。

- ホスティング先選定: §5.g で判断（Cloudflare Pages を第 1 候補とする）
- CSP の HTTP response header での補強（meta との二重設定）
- gzip / brotli の配信確認
- ドメイン: 既存 `oubakiou.github.io` 系統に揃えるか、独自ドメインを取るかは別判断（本プランでは hosting prefix のみ確定）

成果物：選定ホスティング先で `https://<host>/?url=<sample>` または `https://<host>/online.html?url=<sample>` が描画される

#### Step 6 実装済み: `dist/_headers` / `dist/_redirects` の build 時 emit

`vp build` / `npm run build` で次の 2 つの Cloudflare Pages 設定ファイルが `dist/` に自動生成される（`src/build/online-headers.ts` / `src/build/online-redirects.ts` を `splitOutputsPlugin` に統合）。

- **`dist/_headers`**: 全リソースに `Referrer-Policy: no-referrer` / `X-Content-Type-Options: nosniff` を返し、**`/online.html` と `/`** にのみ allowlist 適用後の CSP を `Content-Security-Policy:` HTTP response header として返す。`/online.html` の `<meta http-equiv="Content-Security-Policy">` と完全に同じ文字列を `extractCspContent(onlineHtml)` で抽出して使うため、meta CSP と HTTP header CSP は構造的に drift しない（single source of truth）。`standalone.html` / `embed-template.html` 等が同じホスティングに置かれた場合でも、それらには online 用 CSP が返らず、`<meta>` 側の `connect-src 'none'` がそのまま効く（§3.1 信頼境界の分離原則）。
- **`dist/_redirects`**: `/ /online.html 200` の 1 行のみ。Cloudflare Pages 仕様で status 200 は **rewrite**（URL バーは `/` のまま、内部で `/online.html` の content を配信、クエリ文字列 `?url=...` は保持）。`/online.html?url=...` 形式での直接アクセスも並立して動作する（rewrite 方向は `/` → `/online.html` のみ）。

これにより、ユーザーは Cloudflare Pages ダッシュボードで GitHub repo を連携し、build command `npm run build` / output dir `dist` を指定するだけで、

- `https://<host>/?url=<sample>`（URL バーは `/` のまま）
- `https://<host>/online.html?url=<sample>`（明示パス）

の両方が動作する状態がデプロイされる。CSP header / 基本セキュリティヘッダも自動で配信される。

**配布チャネル境界の更新**: `dist/_headers` / `dist/_redirects` は `dist/standalone.html` / `dist/online.html` と同じく **git tracked** にし、`package.json` の `files`（npm publish 対象）には **含めない**（CLI 経路では使わないため）。

#### Step 6 未着手: 実機 Cloudflare Pages 連携

CLI 側で完結しない作業はユーザー側で実施する：

1. Cloudflare Pages ダッシュボードで `oubakiou/mdxg-redline` repo を連携
   - Framework preset: None
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory: `/`
   - Environment variables: 既定では未設定（DEFAULT 2 ドメインのみ allowlist）。追加 allowlist が必要なら `MDXG_ONLINE_CONNECT_SRC=https://host1,https://host2` を設定
2. デプロイ後に `https://<project>.pages.dev/?url=<sample>` で実機検証（§6 手動視覚チェックリスト全項目）
3. CSP / `_headers` / `_redirects` の挙動が想定通りか devtools Network パネルで確認
4. gzip / brotli の Content-Encoding が付くか確認

### Step 7: DESIGN.md 反映と本ドキュメントの role 切替 — 部分着手 (§8 で再見直し)

- ✅ DESIGN.md §3 入力に「経路 3. URL クエリ (オンライン版)」を追加（実装済み、ただし §8 の方針変更で online.html のサイズ表記と「standalone と同等」記述は要書き換え）
- ✅ DESIGN.md §9 起動シーケンスに §3.4 の分岐を追記（実装済み、ただし §8 で `loadOnlineAssets` ステージ追加が必要）
- ✅ DESIGN.md §11 信頼境界に「オンライン版 CSP の差分」と「URL allowlist のクライアント検証」を追記（実装済み、ただし §8 の `connect-src 'self'` 追加で CSP 表が更新必要）
- ✅ DESIGN.md §13 ビルドパイプラインの「ビルドの出口は 3 つ」記述を 4 つに更新、`dist/online.html` の役割表に追加（実装済み、ただし §8 で online.html サイズ・依存内容物・mdxg-split-outputs plugin 役割が変わる）
- ❌ 本ドキュメントを `docs/archive/feature-online-edition.archive.md` にリネーム（§8 の方針変更を取り込んで「実装計画」が継続中のため archive は保留、§8 完了後に改めて archive する）

成果物：DESIGN.md 部分更新（要再見直し） + archive 化は §8 完了まで保留

### Step 8: 方針変更 — Cloudflare Pages 25 MiB 制限を受けた設計反転 — 未着手

Step 6 の Cloudflare Pages 実機検証で **per-file 25 MiB 制限** に抵触し (`online.html` が 46.6 MiB)、deploy 失敗。スマートフォン回線での初回 download UX も raw ~48 MB / gzip ~7 MB では非現実的。

`dist/online.html` を **embed-template.html 相当の最小 shell** として配布し、`?url=` で markdown を取得した直後に内容を scan、必要なアセット (Shiki grammar / Mermaid / KaTeX) だけを同一オリジンから動的 fetch して bridges に merge する設計に反転する。CLI の `--shiki-langs auto` / `--mermaid auto` / `--math auto` モードを runtime に持ち上げる位置付け。

新設計の要旨：

- `dist/online.html` ~300–500 KiB raw / gzip ~100–150 KiB（Phase A+B+C 完了時）
- 起動時 `loadOnlineAssets(text, baseUrl)` で scan → `Promise.allSettled` 並行 fetch → bridges merge
- silent + progressive upgrade（既存 renderer の bridge 待ちパターンを再利用）
- 個別エラー graceful degradation（Shiki 1 言語失敗で他は載る）
- CSP `connect-src 'self'` 追加（allowlist origins と並立）
- Phase A (Shiki dynamic fetch) で 25 MiB 制限を切り、Phase B (Mermaid) + Phase C (KaTeX) で ~300 KiB に到達

実装計画・設計判断・テスト方針・想定リスクは [`docs/feature-online-runtime-assets.md`](./feature-online-runtime-assets.md) に独立した planning doc として書き起こした。本ドキュメント (Step 1–7) は「standalone と同等の依存内容物」前提で書かれているため、§8 以降の作業は新 planning doc を主とし、本ドキュメントは経緯記録として §8 完了後に archive 化する。

## 5. 設計判断

### a. 配布物の分離方式

| 候補                                                       | 採用 | 理由                                                                                                                              |
| ---------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------- |
| **A. `dist/online.html` を第 3 配布物として独立**          | ✓    | standalone の `connect-src 'none'` を絶対的に維持できる。CSP / 起動分岐 / UI が物理的に分離するため drift が構造的に起きない      |
| B. standalone と同一 HTML で動作モード切替                 | ✗    | CSP を緩めた時点で「standalone は完全オフライン」の保証が壊れる。ローカル開いたユーザーが意図せず外部到達経路を持つことになる     |
| C. standalone はそのまま、別リポジトリにオンライン版を作る | ✗    | コードベース重複・ビルド資材二重管理。本実装の `vite.config.ts` + `mdxg-split-outputs` plugin で 3 つ目の出口を足すコストは小さい |

採用案の論点：

- **3 出口は共通入力 (`src/review.html`) から派生する不変条件**を維持する（DESIGN.md §13 末尾）。`<script id="embedded-md">` 等のタグ位置はすべて同一に保つ
- **boot.ts の分岐は HTML 属性 1 個（`data-mdxg-online`）で判定**。実装の差分は最小限に抑える
- 将来 online 版独自の機能（共有 URL 短縮、履歴）を追加する余地は残るが、初版は URL fetch + 表示のみ

### b. URL allowlist の方針

| 候補                                         | 採用 | 理由                                                                                                                                            |
| -------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. ドメイン allowlist（既定 2 ドメイン）** | ✓    | CORS が確実、SSRF 様の意図しないアクセスを構造的に塞ぐ。raw.githubusercontent.com / gist.githubusercontent.com で OSS markdown の大部分をカバー |
| B. 任意の https URL を許可                   | ✗    | CORS 失敗が頻発する UX、攻撃面拡大（クエリ経由で任意 GET をブラウザに行わせる）                                                                 |
| C. 動的に URL 検証（CORS preflight）         | ✗    | 失敗まで判定できず UX が悪い、攻撃面も任意 https と同じ                                                                                         |

採用案の論点と mitigation：

- **allowlist の拡張経路**: ビルド時に環境変数 `MDXG_ONLINE_CONNECT_SRC`（CSV 形式）で追加可能。ホスティング者が必要に応じて拡張でき、CI / Cloudflare Pages の env settings から渡しやすい。`vp build` の流儀（npm script → `package.json:41` 経由）と整合し、`review-request` CLI 系統とは別経路に閉じる
- **CORS と allowlist の役割分担**: CORS はサーバ側の任意の挙動で許可を絞る受動的制約、allowlist はクライアント / CSP で許可を狭く保つ能動的制約。CORS だけだと「サーバが緩く許可している任意 URL」がクエリ経由でブラウザに到達でき、攻撃面が広がる（§2「なぜ allowlist が必要か」参照）
- **既知の制限**: 自社 wiki / 認証必須エンドポイントは allowlist 拡張で対応するか、別途プロキシ経由のアプローチを検討する必要がある

### c. クエリ vs ハッシュ

| 候補                       | 採用 | 理由                                                                                                             |
| -------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------- |
| **A. クエリ (`?url=...`)** | ✓    | 既存 DESIGN.md §9 の hash 経由ナビゲーション (`#<page-slug>__<heading-slug>`) と衝突しない。共有時の透明性が高い |
| B. ハッシュ (`#url=...`)   | ✗    | §9 の hash 解決経路に分岐追加が必要で複雑化。`location.hash` は page 内ナビでも書き換わるため永続性が弱い        |
| C. クエリとハッシュ両対応  | ✗    | スキーマが二重化し UX とドキュメントが煩雑になる                                                                 |

採用案の論点：

- **プライバシー上の懸念**: クエリ文字列はホスティング先のアクセスログに残る。これは §5.h で扱うが、ユーザー教育で対処する方針
- **クエリは共有 URL として安定**: `location.search` は page 内ナビで書き換わらず、ブックマークや Slack シェアに耐える

### d. fetch 失敗時のフォールバック

| 候補                                      | 採用 | 理由                                                                                                     |
| ----------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------- |
| **A. エラー画面 + 再試行 / 別 URL UI**    | ✓    | バックエンド不要、ユーザーが状況を把握して別アクションに移れる。失敗カテゴリごとにメッセージを出し分ける |
| B. サーバーサイドプロキシ経由で CORS 回避 | ✗    | バックエンド導入が要求され、本実装の「単一 HTML、サーバーなし」原則 (DESIGN.md §1 / §11) と衝突          |
| C. 失敗時は silent fallback で空状態に    | ✗    | ユーザーが「なぜ描画されないか」を理解できず、サポート問い合わせ的体験になる                             |

採用案のエラーカテゴリ：

- **pre_validation_failed (fetch 前検証で reject、`fetchMarkdownFromUrl` 内部の `validateOnlineUrl` 呼び出しで発火)**:
  - `host_not_allowlisted`: 「この origin (scheme + host + port) は対応 URL リストに含まれていません」+ allowlist の一覧表示
  - `scheme_not_https`: 「https 以外の URL は受け付けません」
  - `malformed`: 「URL の形式が不正です」
- **CORS error / network error**: 「このホストは CORS 対応していません。raw.githubusercontent.com 等の対応ホストを試してください」
- **404 / http_error**: 「URL が見つかりません。スペル / ブランチ名を確認してください」
- **timeout**: 「fetch がタイムアウトしました。ネットワーク状況を確認のうえ再試行してください」
- **unsupported_content_type / size_exceeded**: 「対応形式または対応サイズではありません」
- **redirected_off_allowlist (fetch 後検証で reject、`checkFinalUrl` で発火)**: 「リダイレクト先が対応 URL リスト外でした」+ 最終 URL の表示 + allowlist の一覧表示（Step 2 §「allowlist 検証の二段防御」で発火）

**表示形態 (Step 5 で実装)**: いずれも `<div id="empty-state-online-error">` 内の persistent な inline message として表示し、「別 URL を試す」ボタンで Open URL modal を再 open する経路を提供する。toast (1.8s で消える) ではなく empty-state 形式にすることで、ユーザーが時間を取って状況を理解し別アクションに移れる UX を担保する。Esc / Cancel / 背景クリックで modal を閉じれば error empty-state は残ったままで、再度「別 URL を試す」可能。

### e. `file://` 起動時の挙動

| 候補                                            | 採用   | 理由                                                                                                                                     |
| ----------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **A. URL fetch を skip、警告 + Open file 経路** | ✓      | `file://` では fetch が CORS で必ず失敗するため、機能を出すこと自体が嘘になる。standalone と等価動作 (URL クエリは無視 + Open file 待ち) |
| B. オンライン版は `file://` で動作不可とする    | ✗      | 配布物は HTML 1 個なので、ダブルクリックで開いた時に「動かない」と表示するのは UX が悪い                                                 |
| C. クエリのみエラー、本文 (Open file) は使える  | ✓ 同等 | A と実質同じ                                                                                                                             |

採用案: A = C。`file://` 起動時にも Open file 経路 (§3 入力 1) は動かしたままにする。URL クエリ部分だけ「http(s) 起動時にのみ機能します」のヒントを出す。

### f. オンライン版コンテンツの可視化

| 候補                                                   | 採用 | 理由                                                                                                                  |
| ------------------------------------------------------ | ---- | --------------------------------------------------------------------------------------------------------------------- |
| **A. ステータスバーに fetch 元 URL を常時表示**        | ✓    | レビュワーが「この markdown は外部 URL 経由で取得されたもの」を一目で判別できる。フィッシング的コンテンツへの第一防御 |
| B. fetch 元情報を出さない                              | ✗    | 信頼境界の expansion に対する UX 上の補強が無い                                                                       |
| C. モーダルで毎回確認を出す（OK を押すまで描画しない） | ✗    | UX が重い、ブックマーク経由の再アクセスで毎回確認は冗長                                                               |

採用案の補強：

- 表示形式: `Source: https://raw.githubusercontent.com/.../README.md` のような単行表示
- リンクとして click 可能（オリジナル URL を直接開ける）
- **Referer leak 対策（重要）**: `<a href="<url>" rel="noreferrer noopener" referrerpolicy="no-referrer" target="_blank">` の 3 属性すべてを必須。これらが無いと、Source link クリック時に Referer ヘッダで現在のページ URL（`?url=<secret-url>` を含む全 URL）が click 先に漏れる。`noreferrer` は `noopener` を包含するが両方明示することで意図を明確にし、`referrerpolicy="no-referrer"` は標準 `<a>` の rel と独立に効くので追加防御として併記する。既存 DESIGN.md §11c が `<img>` に `referrerpolicy="no-referrer"` を付ける方針と対称
- 出自情報は runtime UI（ステータスバー）に閉じる。feedback.json schema (`src/core/types.ts` の `ExportPayload`) には追加しない — 既存の `comments` / `docHash` / `document` / `exportedAt` で後段 LLM の処理に十分で、schema 変更は `lastWrittenSignature` (dirty 検知) / Copy / Export / Write の各テスト / 後方互換にカスケードするため本プランスコープ外

### g. ホスティング先選定

| 候補                    | 採用 | 理由                                                                                                                      |
| ----------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------- |
| **A. Cloudflare Pages** | ✓    | 静的配信 + HTTP header カスタマイズ (`_headers` ファイル) + gzip/brotli 自動、無料枠で安定運用。CSP header 二重設定が可能 |
| B. GitHub Pages         | ✗    | プロジェクトはこれまで GitHub Pages デモを検討していたが、HTTP response header の柔軟性が低い。CSP header の追加は不可    |
| C. Vercel               | ✗    | Cloudflare Pages とほぼ同等の機能。選定上の決定打が無いため第 1 候補にしない                                              |
| D. Netlify              | ✗    | Cloudflare Pages とほぼ同等。同上                                                                                         |

採用案の論点：

- **CSP は meta タグだけでなく HTTP header にも入れる**（二重防御）。Cloudflare Pages は `_headers` ファイルで簡単に設定可能
- **将来カスタムドメイン**: 検討する場合は Cloudflare Pages + Cloudflare DNS の組合せが運用しやすい
- **デプロイ自動化**: GitHub Actions から Cloudflare Pages にデプロイする標準 action があるため、CI 連携は既存パターンで足りる

### h. プライバシー（URL がサーバログに残る）

採用方針: **ユーザー教育 + ステータスバー表示で対処。技術的に hash 経路への切り替えはしない**

理由：

- 機密 URL を共有する想定がない（公開リポジトリの README / 公開仕様書が主用途）
- ユーザーが機密扱いしたい場合は standalone.html を local で開く経路を使ってもらう

README / 配布物の説明にこの境界を明示する。「オンライン版は公開 markdown URL の共有を想定。機密文書は standalone を local で使ってください」のような形。

**Referer 経由の追加漏出経路**: 上記のホスティング側ログとは別に、ステータスバー Source link クリック時の Referer ヘッダで現在のページ URL（`?url=<fetched-url>` を含む）が click 先サーバに送られる経路がある。これは §5.f で扱う通り `<a rel="noreferrer noopener" referrerpolicy="no-referrer" target="_blank">` の 3 属性すべてで構造的に塞ぐ。markdown 本文内の外部リンクも同様の漏出経路を持つが、こちらは既存 DESIGN.md §11c の `<img referrerpolicy="no-referrer">` 方針との対称性で `Renderer.link` 側に `rel` / `referrerpolicy` 付与を別途検討する（本プランスコープ外、フォローアップ）。

### i. 配布物サイズと runtime 内容物

| 候補                                      | 採用 | 理由                                                                                                                   |
| ----------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------- |
| **A. standalone と同等（全部入り）**      | ✓    | 任意の markdown が流し込まれるため、Shiki bundled 全言語 + Mermaid + KaTeX `all` を inline する必要がある              |
| B. 軽量版（必要時に動的注入）             | ✗    | オンライン版で fetch した markdown のフェンス言語 / Mermaid / 数式の有無を起動時に予測できないため、動的注入は実装困難 |
| C. CLI 経路と同じ最小版（言語抽出後注入） | ✗    | オンライン版は CLI を介さないため、注入経路を別途実装する必要があり過剰                                                |

採用案: standalone と完全に等価な内容物を inline する。差は CSP / URL fetch ロジック / URL 入力 UI のみ。

## 6. テスト方針

### in-source test（新規）

- `core/online-url.ts`：
  - `validateOnlineUrl`: 正常系（allowlist hit） / scheme 不一致 / origin allowlist 外 / malformed URL / 空文字 / subdomain spoofing
  - `fetchMarkdownFromUrl`: success / 404 / CORS error / timeout / 非テキスト Content-Type / network error
  - **`Content-Length` 事前チェックでの `size_exceeded`**（ヘッダ値が `maxBodyBytes` 超過で body を読まずに reject）
  - **`Content-Length` が嘘で stream 中に `size_exceeded`**（ヘッダ値が小さいが実体が大きい、累積監視で abort）
  - **`Content-Length` 不在で stream 中に `size_exceeded`**（chunked transfer 等、累積監視のみで abort）
  - **redirect 後の最終 URL が allowlist 外 → `redirected_off_allowlist`**（fetch 後検証、`Response.url` を mock で書き換え）
  - **fetch 前検証で `pre_validation_failed`**: allowlist 外 / 不正 URL / http:// / 攻撃シナリオ (初回 URL が allowlist 外で最終 URL が allowlist 内へ redirect される擬装) で `globalThis.fetch` が一度も呼ばれない (`expect(fetchSpy).not.toHaveBeenCalled()`)
  - **fallback path（`res.body === null`）の `receivedBytes` が UTF-8 byteLength**（マルチバイト文字で `text.length` ではなく `byteLength` を返す回帰）
  - allowlist の正規化（trailing slash / port 含む / 大文字小文字）
  - **build plugin 由来の JSON config を受け取った `validateOnlineUrl` が env 追加 host を accept する**（buildOnlineAllowlist の戻り値を直接渡したケース）

- `build/online-allowlist.ts`（新規 pure ロジック、実装済み）：
  - `buildOnlineAllowlist(env)`: env 未設定 / 空文字 / 空白のみ → DEFAULT_ONLINE_ALLOWLIST / CSV 単一・複数 host を追加 / DEFAULT との重複 dedupe / trailing slash + 大文字 + 末尾ドット正規化 / port 保持 / http:// + scheme なし + 不正 URL + pathname 付き + search 付き + hash 付き → warn + skip / 空 entry (連続カンマ) は silent skip
- `build/online-html.ts`（新規 pure ロジック、実装済み）：
  - `buildOnlineHtml(standaloneHtml, { allowlist })`: `<html data-mdxg-online="1">` upsert（既存 `lang` 等は保持）/ CSP `connect-src 'none'` → `connect-src <allowlist joined>` 置換 / `<head>` 直前に `<script type="application/json" id="online-allowlist">` を inject
  - 必須前提の喪失で throw: `<html>` タグ無し / CSP meta タグ無し / `connect-src 'none'` 無し / `</head>` 無し / allowlist が空配列

- `core/embed.ts`（既存テストに追加）：
  - 3 配布物の HTML 構造的不変条件（`<script id="embedded-md">` 等のタグ位置が standalone と online で同じ）
  - online.html の `<html data-mdxg-online="1">` 属性
  - online.html の CSP `connect-src` allowlist が想定値で書き出される
  - **standalone.html / embed-template.html の `<html>` 要素に `data-mdxg-online` 属性が存在しない**こと（Open URL UI gating の構造的不変条件、§3.1）
  - **`MDXG_ONLINE_CONNECT_SRC` 環境変数の経路**: 未設定時は既定の 2 ドメインのみ、CSV 設定時は追加 host が CSP 文字列に展開され重複排除される
  - **CSP `connect-src` の host 集合と `<script id="online-allowlist">` JSON の host 集合が完全一致**（同じ `buildOnlineAllowlist` 戻り値から派生していることを drift 検出として検査）
  - **standalone.html / embed-template.html に `<script id="online-allowlist">` が存在しない**こと（gating 対称性）

- `core/online-allowlist-config.ts`（新規 pure ロジック、実装済み）:
  - `resolveOnlineAllowlistFromJson`: build pipeline 由来の有効 JSON 配列をそのまま返す / env 追加 host が混じった JSON も配列ごと返す / 空テキスト・空白・JSON parse 失敗・配列ではない・空配列・全要素が非 string → DEFAULT_ONLINE_ALLOWLIST fallback / string と非 string が混在は string のみ残す (fail-safe で allowlist 拡張に倒れることを構造的に防ぐ)

- `app/boot.ts`（既存テストに追加、Step 4 で実装済み）:
  - `isOnlineEdition`: `data-mdxg-online="1"` で true / 属性なしで false / "0" や空文字では false
  - `deriveDocNameFromUrl`: pathname 末端を返す / trailing slash 付き / pathname なしは fallback / 連続 slash filter / parse 不能 URL は fallback
  - `formatFetchFailureMessage`: 7 variant (http_error / network_error / pre_validation_failed / redirected_off_allowlist / size_exceeded / timeout / unsupported_content_type) それぞれが必要情報 (status / message / reason / url / finalUrl / contentType) を含む
  - `loadFromOnlineUrlQuery`: `?url=` 未指定で false (fallthrough) / file:// + `?url=` 指定で false + fetch 発火しない / allowlist 外 URL は fetch せず false (pre_validation_failed) / http(s) + 有効 URL で `loadFromMarkdown(deriveDocNameFromUrl(url), text)` 呼び出し / fetch 404 で false + loadFromMarkdown 呼ばれない
- `app/online/open-url-modal.ts`（新規、Step 5 で実装済み）:
  - `buildReloadHref`: 単純 https URL を encodeURIComponent して `?url=` に乗せる / input に `&` / `?` / `#` を含んでも本ページクエリと混線せず単一 `url=` 値として encode / 非 ASCII / 空白も encodeURIComponent で escape / 既存 pathname を保持

- `app/online/source-display.ts`（新規、Step 5 で実装済み）:
  - `buildSourceLinkHtml`: 3 属性 (`rel="noreferrer noopener"` / `referrerpolicy="no-referrer"` / `target="_blank"`) をすべて含む (Referer leak 防止、§5.f / §5.h) / href と表示テキストに URL を埋め込む / XSS payload (`<script>` / `"` / `&`) を escapeHtml で実体参照化 / "Source: " prefix を含む

- `app/online/error-display.ts`（新規、Step 5 で実装済み）:
  - `showOnlineError`: online edition で default empty-state を隠し error empty-state を visible にして message を埋める / `clearOnlineError` で default visible / error hidden に戻す / `data-mdxg-online` 属性なしでは no-op (JS gating §3.1) / DOM 要素が無くても throw しない (fail-soft)

### 手動視覚チェックリスト

`npm run build` 後、Cloudflare Pages（または PoC ローカルサーバー）にデプロイして以下を確認：

- [ ] `https://<host>/online.html` を素の状態で開くと toolbar に Open URL ボタンが出る
- [ ] `?url=https://raw.githubusercontent.com/.../README.md` で実 markdown が描画される
- [ ] ステータスバーに `Source: <url>` が表示される
- [ ] Source link を Elements で検証して `rel="noreferrer noopener"` / `referrerpolicy="no-referrer"` / `target="_blank"` の 3 属性すべてが付いている
- [ ] dark / light テーマ切替が動く
- [ ] コメント追加 → Copy as JSON / Export as JSON で出力できる
- [ ] Write feedback.json で workspace-handle 経由のローカル保存ができる
- [ ] `?url=` に allowlist 外ドメインを渡すと **fetch を発火させずに** `pre_validation_failed` エラー画面 + allowlist 一覧（Network パネルで該当 URL への HTTP request が出ていないこと）
- [ ] `?url=` に 404 URL を渡すと persistent な error empty-state + 「別 URL を試す」ボタンが出て、ボタンクリックで Open URL modal が再 open する
- [ ] toolbar の Open URL ボタンから URL を送信すると `?url=...` がクエリに反映 (encodeURIComponent 経由で `&` / `?` / `#` も安全に encode) されて描画される
- [ ] Esc / Cancel / 背景クリックで Open URL modal が閉じる (input 状態は次回 open 時にも残る)
- [ ] **`file://` で `dist/online.html` を `?url=` 未指定で開いた時、エラー画面に落ちず空状態で起動して Open file が動く**
- [ ] **`file://` で `?url=...` 付き URL を開いた時のみエラー画面 + Open file fallback**
- [ ] **`MDXG_ONLINE_CONNECT_SRC=https://example.com,...` で build → CSP / JSON config 両方に追加 host が反映され、`?url=https://example.com/...` で fetch が成功**
- [ ] **5 MB 超の markdown を返すモック URL で fetch すると、Content-Length 事前チェック / stream 中累積監視のいずれかで `size_exceeded` エラー画面に落ちる**
- [ ] **allowlist 内 URL からの fetch が allowlist 外 origin に redirect される擬装 (mock) で、`redirected_off_allowlist` エラー画面 + 最終 URL 表示に落ちる（二重防御の動作確認、§5.d / Step 2）**
- [ ] standalone.html の CSP が `connect-src 'none'` のまま回帰していない
- [ ] embed-template.html（CLI 経由）の CSP が `connect-src 'none'` のまま回帰していない
- [ ] サイズ増分が見積もり通り（gzip ~7.0 MB 程度）

## 7. 受け入れ基準

- §1 対応スコープ表の全 [MUST] 行が完了条件を満たす
- `dist/online.html` が `vp build` で出力され、URL fetch + 描画が動く
- 既存 standalone.html / embed-template.html の CSP / 挙動が一切変わらない（in-source test で構造的に保証）
- standalone.html / embed-template.html の build 後 HTML 内で Open URL ボタンが CSS / JS 両層で hidden になる（§3.1 gating 不変条件、§6 in-source test）
- **env var → CSP / JSON config の単一情報源化が成立**: `MDXG_ONLINE_CONNECT_SRC` で追加した host が CSP `connect-src` と `<script id="online-allowlist">` JSON の両方に展開され、`validateOnlineUrl` で accept される（§6 drift 検出 test）
- **`maxBodyBytes` が `Content-Length` 事前チェック + stream 累積監視の 2 段で強制される**: 5 MB を超えるレスポンスを全量メモリに乗せる経路がない（§6 fetch ラッパ test）
- **Source link が Referer leak 防止 3 属性を持つ**: `rel="noreferrer noopener"` / `referrerpolicy="no-referrer"` / `target="_blank"`（§5.f / §6 source-display test）
- **`fetchMarkdownFromUrl` が同じ allowlist 引数に対して fetch 前後で 2 回検証する**: fetch 前は `validateOnlineUrl` を内部呼び出しして allowlist 外 URL では `globalThis.fetch` を発火させずに `pre_validation_failed` を返す（caller 契約の不可分化 + 初回 GET 漏出防止）。fetch 後は CSP 設定ミス / `<meta>` のみ有効環境でも、最終 URL allowlist 外への redirect を `redirected_off_allowlist` で render 前に拒否する（§5.d / Step 2 / §6 in-source test）
- **`boot.ts` の online 経路が data-mdxg-online ガード下でのみ発火する**: `isOnlineEdition()` が false なら従来 embedded-md 経路に直行 (standalone / embed-template での副作用ゼロ)。`<script id="online-allowlist">` が壊れていても `resolveOnlineAllowlistFromJson` の fail-safe で DEFAULT に倒れ allowlist 拡張事故を防ぐ（§3.4 / §6 boot.ts test）
- **Open URL UI が data-mdxg-online ガード下でのみ visible + interactive**: standalone / embed-template の build 後 HTML 内で `.toolbar-open-url` / `.toolbar-source` / `.open-url-modal-backdrop` / `.online-edition-only` が CSS `display: none` で確実に hidden、`wireOpenUrlModal` / `wireOnlineErrorRetry` も冒頭で no-op return する (§3.1 二層 gating、Step 5)
- **Open URL modal の submit が `?url=<encodeURIComponent(input)>` で同一ページを reload する**: ユーザー入力 URL に `&` / `?` / `#` を含んでも本ページのクエリと混線せず、reload 後に boot.ts の online 経路で再 fetch される (§5.d / Step 5、`buildReloadHref` test)
- **fetch 失敗時に persistent な inline error empty-state が表示される**: 1.8s で消える toast ではなく `<div id="empty-state-online-error">` に message + 「別 URL を試す」ボタンが残り、ボタンクリックで Open URL modal が再 open する (§5.d / Step 5)
- **Esc / Cancel / 背景クリックで Open URL modal が閉じる**: 他の modal (help / mermaid / comment) と同列に `global-keyboard.ts:handleEscapeKey` から `closeOpenUrlModal` が呼ばれ、`createStaticModalController` の共通実装で focus 復元まで処理される (Step 5)
- 配布物サイズ増分が standalone 比 +5 KB gzipped 以内
- in-source test 全通過（既存 + §6 新規）
- DESIGN.md §3 / §9 / §11 / §13 が更新される
- 第 1 候補ホスティング先（Cloudflare Pages）で実機配信が成立する
- ステータスバーに fetch 元 URL が常時表示される

## 8. 想定リスクと回避策

| リスク                                                                                            | 回避策                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `raw.githubusercontent.com` の CORS ポリシーが将来変更され fetch が失敗する                       | Step 1 PoC で `Access-Control-Allow-Origin: *` を実機確認。allowlist 拡張で別ミラーを足す経路を準備                                                             |
| allowlist 外 URL を要望されてユーザー要件が広がる                                                 | 環境変数 `MDXG_ONLINE_CONNECT_SRC` でホスティング者が拡張できる経路を Step 3 で準備                                                                             |
| URL クエリがサーバアクセスログに残ってプライバシー懸念が出る                                      | §5.h: ユーザー教育で対処、機密用途は standalone.html を local 起動で誘導                                                                                        |
| `dist/online.html` の追加でビルド時間 / 配布物サイズが大きく増える                                | §3.6 / §5.i: 増分は ~3-5 KB gzipped で受け入れ基準 (§7) の上限内。CI ビルド時間は ~5 秒程度の増加見込み                                                         |
| standalone.html の CSP が誤って緩む（drift）                                                      | §3.1: 3 出口の差を `mdxg-split-outputs` plugin で構造的に分離。in-source test で CSP 文字列を検証                                                               |
| Open URL UI が standalone / embed-template に混入する                                             | §3.1: `data-mdxg-online` 属性ガード + CSS/JS の 2 層 gating。§6 in-source test で属性なし時 `display: none` 維持を検証                                          |
| 既存 src/review.html の CSP が DESIGN.md §11b と乖離（font-src 欠落）                             | 別 issue として [`docs/bug-csp-font-src-missing.md`](./bug-csp-font-src-missing.md) に切り出し。本プランは標準版 CSP の現状値に追従し、bug 修正後に自動整合する |
| boot.ts のオンライン版分岐がローカル版に影響する                                                  | §3.4: `data-mdxg-online` 属性ガードで分岐。in-source test で属性なし時に従来経路を辿ることを検証                                                                |
| fetch 失敗時に空状態のまま体験が悪い                                                              | §5.d: 失敗カテゴリごとのエラーメッセージ + 再試行 / 別 URL UI を出す                                                                                            |
| URL allowlist が UX を狭めすぎる                                                                  | エラー画面で allowlist 一覧を提示、ユーザーが対応 URL に誘導される。`MDXG_ONLINE_CONNECT_SRC` ビルド時拡張で対応                                                |
| CORS / network error で再現性のない失敗                                                           | Step 1 PoC + Step 6 実機検証で典型ホストの動作を確定。エラーカテゴリごとに復帰経路を実装                                                                        |
| Cloudflare Pages の CSP header と meta CSP が drift する                                          | §5.g: `_headers` ファイルでビルド出力と同じ CSP を配信。in-source test と CD 時の sanity チェックで diff 検出                                                   |
| env var で追加した host が CSP では通るが `validateOnlineUrl` で reject される（allowlist drift） | §3.3 / Step 3: build plugin が pure 関数 `buildOnlineAllowlist` 経由で CSP と `<script id="online-allowlist">` JSON の両方を派生。§6 で集合一致を検査           |
| `maxBodyBytes` が `Response.text()` 後判定で発動が遅れ巨大レスポンスでメモリ枯渇                  | Step 2: `Content-Length` 事前チェック + `response.body.getReader()` の累積監視で abort。3 種の超過パターンを §6 in-source test で検証                           |
| Source link クリックで Referer 経由に `?url=` が外部漏出する                                      | §5.f: `rel="noreferrer noopener"` / `referrerpolicy="no-referrer"` / `target="_blank"` の 3 属性必須。§5.h 内で追加漏出経路として扱い、§6 test で属性検査       |

## 9. 参考

- [DESIGN.md §3 ユーザーフロー / 入力](./DESIGN.md#3-ユーザーフロー) — 既存 2 入力経路（ファイル選択 / 埋め込み）
- [DESIGN.md §9 起動シーケンス](./DESIGN.md#9-起動シーケンス) — boot.ts の優先順チェーン
- [DESIGN.md §11 セキュリティとプライバシー](./DESIGN.md#11-セキュリティとプライバシー) — 信頼境界 + CSP + プライバシー設計
- [DESIGN.md §13 ビルドパイプライン](./DESIGN.md#13-ビルドパイプライン) — 既存 2 出口と `mdxg-split-outputs` plugin
- [Cloudflare Pages docs: `_headers` file](https://developers.cloudflare.com/pages/configuration/headers/) — HTTP header カスタマイズ
- [MDN: Content-Security-Policy `connect-src`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/connect-src)
- [raw.githubusercontent.com CORS policy](https://docs.github.com/en/repositories/working-with-files/using-files/downloading-source-code-archives#downloading-source-code-archives-from-the-repository-view)
- [mermaid.live](https://mermaid.live/) — URL クエリで diagram source を受ける単一 HTML ツール（参考実装）
- [docs/github-pages.md](./github-pages.md) — 静的デモ公開プラン（本プランの前段で見送り、オンライン版に移行）
