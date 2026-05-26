# dist/review.html の用途別分割（standalone.html + embed-template.html） 設計・実装計画

DESIGN.md §3 / §13 / §14 で 1 ファイルが兼任している「① 単独 Open file 用」「② review-request CLI のテンプレート素材」の 2 用途を、それぞれ専用の配布物に分割するための設計判断と実装手順をまとめる。完了時点で本ドキュメントは DESIGN.md §3 / §13 / §14 に分割後の構成を反映し、本ファイルは `docs/html-split-standalone-embed-template.archive.md` にリネームしてアーカイブする想定。

## 1. 対応スコープ

現状の `dist/review.html` が抱える 2 用途の構造的なミスマッチを解消する。具体的には次の要件をすべて満たす。

| 要件                                                                          | 現状 | 完了条件                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [MUST] 単独 Open file 経路で syntax highlight が効く                          | 未   | `dist/standalone.html` を直接ダブルクリックで開いた時、Shiki 27 言語の grammar がすべて inline 済みで、CLI を通さなくても全コードブロックがハイライト表示される                                                                 |
| [MUST] review-request CLI のテンプレート素材が独立して存在する                | 未   | `dist/embed-template.html` を CLI が参照し、`<script id="embedded-md">` の書き換えと `--shiki-langs <auto\|all\|none\|csv>` モードに応じた grammar 注入を行う。grammar は事前 inline されておらず最小サイズ                     |
| [MUST] CLI の既存挙動が回帰しない                                             | ✓    | `node dist/review-request.mjs <input.md>` で生成される `<mdFileName>-<docHash>-review.html` のサイズ・構造・shiki 注入挙動が変更前と同等（注入対象の grammar 集合が一致、`EMBEDDED_MD_RE` の rewrite 成功率が同等）             |
| [MUST] 既存配布契約（clone 直後に `npm run build` 抜きで実行可能）を維持      | ✓    | `dist/standalone.html` / `dist/embed-template.html` / `dist/review-request.mjs` / `dist/shiki-langs/*.json` がすべて commit 対象。partial clone / 手動削除での欠落時は CLI が ENOENT を捕えて案内エラーを出す既存挙動を引き継ぐ |
| [SHOULD] サイズ増分はファイル数分離分のみ（個別ファイルの肥大化を起こさない） | 未   | `dist/standalone.html` ≒ 現行 `dist/review.html` + Shiki grammar all (raw 約 5.2 MB / gzip 約 1.5 MB)、`dist/embed-template.html` ≒ 現行 `dist/review.html`（grammar 注入なしの 314 KB / gzip 95 KB 相当）                      |
| [SHOULD] CSP / inline 不変条件 / 信頼境界が両 HTML で揃う                     | 未   | DESIGN.md §11 の CSP（`script-src 'self' 'unsafe-inline'` 等）・`<meta http-equiv="Content-Security-Policy">` 配置・`<script id="embedded-md">` / `<script id="embedded-feedback">` の構造的不変条件が両ファイルで同一          |
| [SHOULD] CLI 生成 HTML では Open file ボタンが既定で非表示                    | 未   | CLI 経由で生成された embed-template ベースの配布 HTML を開いた時、`#btn-load` と隠し `<input type="file">` が DOM から削除されている。`--show-open-file` フラグ付与時のみ表示。`standalone.html` は常に表示                     |

追加実装（規格上は SHOULD 未満だが UX 上有用）：

- **`standalone.html` 起動時のユーザー案内**：CLI を経由しない単独利用であることを toast / status 等で示す必要はないが、`<title>` / `<meta name="description">` を CLI 出力物と区別できる文言にし、ブラウザのタブやファイル共有先で取り違えが起きないようにする
- **README / ShareOnboardingGuide の更新**：「ダウンロードするのは `standalone.html`、CLI を使う場合は `embed-template.html` には触らない」という導線を明示

スコープ外（別タスクで扱う）：

- **`standalone.html` での `--shiki-langs` 切替**：単独配布物は all 固定で、ユーザー側で `none` / `auto` に絞る経路は提供しない（grammar をサブセット化したい場合は CLI を使う動機が成立するため）。Phase 2 として URL クエリ / `<html data-shiki>` ヒントで切替する余地は残すが、本タスクでは扱わない
- **`standalone.html` の埋め込み markdown / feedback 注入経路**：単独配布物は Open file 経由での読み込みを主眼に置く。`<script id="embedded-md">` ブロック自体は構造的に残すが、CLI を使わずに手作業で埋め込むユースケースは引き続き非サポート（§3 既存記述を維持）
- **`dist/review.html` の互換シンボリックリンク / リダイレクト経路**：旧名 `dist/review.html` を残すかは §5.d で議論し、本タスク内では「残さず削除」を採用する。外部から旧名でリンクしている経路は README で誘導する

## 2. ベースラインアーキテクチャ

本タスクは外部リファレンス実装の参考が無い領域（vercel-labs/mdxg は Next.js SSR で配布形態が根本的に異なる）。本章はベースラインとして現状の `dist/review.html` 構成と CLI 参照経路を整理する。

### 現状の構造（兼任時）

```
dist/
├── review.html              ← 単独配布物 兼 CLI テンプレート
│   ├── <script id="embedded-md"> (空)
│   ├── <script id="embedded-feedback"> (空)
│   ├── <script id="embedded-shiki-langs"> (空)  ※ CLI 経由時のみ注入
│   ├── inline JS / CSS / Shiki core + JS engine + 2 テーマ
│   └── grammar は 0 inline（CLI が auto/all/csv で <script id="embedded-shiki-langs"> に注入）
├── review-request.mjs       ← CLI、dist/review.html を読んで rewrite
└── shiki-langs/<lang>.json  ← CLI の素材
```

| 既存挙動                                                    | 兼任が起こす問題                                                                                                                               |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 単独で `dist/review.html` をダブルクリックで開く            | `<script id="embedded-shiki-langs">` が空のため全コードブロックが plain text fallback。MDXG §2 Code Block Rendering の MUST は満たすが UX 不良 |
| CLI が `dist/review.html` を読んで rewrite                  | 機能上問題なし。`EMBEDDED_MD_RE` が `<script id="embedded-md" type="text/markdown">` に lookahead で match することに依存                      |
| `dist/review.html` のサイズが「兼任のため最小化されている」 | 単独配布物としては最小化が裏目に出る（CLI 用には適切、単独用には grammar 欠落）                                                                |
| README で「ダウンロードして開けばよい」と案内したい         | 案内通りに動かない（grammar が無いため）。実体は CLI を使うか手動 build しないと完成しない                                                     |

### 分割後の構造

```
dist/
├── standalone.html          ← 単独 Open file 用、grammar 27 言語 inline 済み
├── embed-template.html      ← CLI テンプレート、grammar 注入なし最小サイズ
├── review-request.mjs       ← CLI、embed-template.html を読んで rewrite
└── shiki-langs/<lang>.json  ← CLI の素材（embed-template.html に注入される）
```

| 要素                              | standalone.html                                                | embed-template.html                                       |
| --------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------- |
| inline JS / CSS                   | 共通（Vite が同じ bundle を inline）                           | 共通                                                      |
| Shiki core + JS engine + 2 テーマ | 共通                                                           | 共通                                                      |
| 27 言語の grammar                 | **全部 inline**（`<script id="embedded-shiki-langs">` に注入） | **0 inline**（CLI が `--shiki-langs` モードに応じて注入） |
| `<script id="embedded-md">` 中身  | 空（Open file で動的注入）                                     | 空（CLI が rewrite で埋める）                             |
| CSP / 信頼境界                    | 共通                                                           | 共通                                                      |
| `<title>`                         | `MDXG Redline`                                                 | `MDXG Redline (Review Request)` 等、CLI 出力後に上書き    |

両 HTML は共通の `src/review.html` を入力とし、2 つの独立した Vite build config から派生する（§3.1 で詳述）。テンプレートを共有することで JS / CSS / CSP / DOM 構造の不変条件を揃え、build config の差分（`mdxg-inline-shiki-langs` plugin の有無）で grammar 注入の挙動だけを切り替える。

## 3. 構造設計

### 3.1 ビルド構成

`vite.config.ts` を 1 build で 2 出力に拡張するか、`vite.standalone.config.ts` を別ファイル化するかが分岐点。本実装は **後者（独立 config）** を採用（§5.a で比較）。

```
src/review.html  ─┬─► vite.config.ts                ─► dist/embed-template.html
                  │   + viteSingleFile               (grammar 注入なし、現行 review.html 相当)
                  │   + mdxg-shiki-assets (emit only)
                  │
                  └─► vite.standalone.config.ts     ─► dist/standalone.html
                      + viteSingleFile               (grammar 27 言語 inline 済み)
                      + mdxg-shiki-assets (emit only)
                      + mdxg-inline-shiki-langs      (新規 plugin、build 時に
                                                      <script id="embedded-shiki-langs">
                                                      に dist/shiki-langs/*.json を流し込む)
```

| 出力                           | 入力                        | プラグイン構成                                               |
| ------------------------------ | --------------------------- | ------------------------------------------------------------ |
| `dist/embed-template.html`     | `src/review.html`           | viteSingleFile + mdxg-shiki-assets                           |
| `dist/standalone.html`         | `src/review.html`           | viteSingleFile + mdxg-shiki-assets + mdxg-inline-shiki-langs |
| `dist/review-request.mjs`      | `src/cli/review-request.ts` | SSR mode（既存）                                             |
| `dist/shiki-langs/<lang>.json` | mdxg-shiki-assets が emit   | embed-template.html / CLI の素材として継続使用               |

ビルド順序：

1. `vp build` (= `vite.config.ts`) で `dist/embed-template.html` + `dist/shiki-langs/*.json` を生成
2. `vp build --config vite.standalone.config.ts` で `dist/standalone.html` を生成（手順 1 の `dist/shiki-langs/*.json` を読み込んで inline）
3. `vp build --config vite.review-request.config.ts` で `dist/review-request.mjs` を生成

3 ステップを `npm run build` で逐次実行する。並列化は手順 1 → 2 の依存があるため `&&` チェーンとする。

### 3.2 新規 plugin: `mdxg-inline-shiki-langs`

`vite.standalone.config.ts` でのみ使う build-time plugin。役割は次の 2 点に絞る：

- `transformIndexHtml` フックで `<script id="embedded-shiki-langs" type="application/json"></script>` を検出し、`dist/shiki-langs/*.json` 27 ファイルを `{ "<lang>": <grammar-json>, ... }` の形でまとめて中身に埋め込む
- 埋め込み形式は **CLI が注入する形式と完全一致**（同じ JSON シェイプを `src/app/shiki.ts` の grammar reader が解釈できることを保証）

```ts
export function mdxgInlineShikiLangs(): Plugin {
  return {
    name: 'mdxg-inline-shiki-langs',
    transformIndexHtml(html) {
      const grammars = readAllGrammarJson('dist/shiki-langs/')
      const payload = JSON.stringify(grammars)
      return html.replace(
        /<script id="embedded-shiki-langs"[^>]*><\/script>/,
        `<script id="embedded-shiki-langs" type="application/json">${payload}</script>`
      )
    },
  }
}
```

実装ポイント：

- **手順 1 → 2 の順序依存**：plugin が `dist/shiki-langs/*.json` を `fs.readFile` で読むため、`vp build` 完了後でないと動作しない。`npm run build` の `&&` チェーンでこの順序を担保する
- **CLI と同じ JSON シェイプ**：`src/core/embed.ts` で CLI が注入する形式（key: 正規 lang 名 / value: grammar JSON）と一致させる。形式が分岐すると `src/app/shiki.ts` の reader が両用途で分岐する負債を抱えるため、共通の `assembleShikiLangsPayload(langs: string[])` を `src/core/embed.ts` から export して両者で再利用
- **`</script>` エスケープ**：grammar JSON 中に `</script>` リテラルが含まれる可能性は構造的に低い（TextMate grammar は正規表現と scope 名のみ）が、念のため `payload.replace(/<\/script/gi, '<\\/script')` で escape する

### 3.3 CLI の参照先変更

`src/cli/review-request.ts` の `readTemplateHtml` を `dist/review.html` → `dist/embed-template.html` に向け替える。1 箇所の文字列変更だが、関連する箇所を整理：

- `src/cli/review-request.ts` の `__dirname` 基準パス解決を `embed-template.html` に変更
- ENOENT 時の案内メッセージを「`先に npm run build を実行してください`」のまま維持（メッセージ内のファイル名は更新）
- `src/core/embed.ts` の `EMBEDDED_MD_RE` / `rewriteEmbeddedMd` 等の pure ロジックは無変更（embed-template.html も同じ構造を持つため）

### 3.4 サイズ見積もり

| ファイル                       | 現状サイズ           | 分割後サイズ            | gzip 後               |
| ------------------------------ | -------------------- | ----------------------- | --------------------- |
| `dist/review.html`             | 314 KB / gzip 95 KB  | （削除）                | —                     |
| `dist/standalone.html`         | —                    | 約 5.5 MB / gzip 1.6 MB | grammar 27 言語含む   |
| `dist/embed-template.html`     | —                    | 314 KB / gzip 95 KB     | 現行 review.html 相当 |
| `dist/shiki-langs/*.json` 合計 | 5.2 MB / gzip 1.5 MB | 5.2 MB / gzip 1.5 MB    | 不変（commit 対象）   |
| `dist/review-request.mjs`      | 数十 KB              | 数十 KB                 | 不変                  |

リポジトリ容量への影響：分割後の `dist/` 合計は約 11 MB（standalone と shiki-langs/ で grammar を二重に持つため）。実測値は実装後に確定する。

二重化を避ける選択肢（runtime fetch / シンボリックリンク等）は §5.b で議論し、本実装では「シンプルさ優先で二重化を許容」する。

### 3.5 CLI オプション: `--show-open-file`（既定: 非表示）

embed-template ベースの CLI 出力 HTML は「特定の MD をレビューする」固定文脈で配布されるため、ヘッダの Open file ボタンで別 MD を読み込まれると `state.comments` が初期化される事故（DESIGN.md §3 入力 1 「再選択時の挙動」）が起きる。CLI 経路では既定で Open file ボタンを構造的に出さない。

- `--show-open-file` を指定した時のみ Open file ボタンを残す（明示 opt-in）
- 適用範囲は `#btn-load` ボタンと隠し `<input id="file-md" type="file" hidden>` の 2 要素のみ。Comments ▾ メニュー内の Copy / Export / Write feedback.json はすべて常時表示
- `standalone.html` は CLI を経由しないため属性が付かず、常に Open file ボタンが表示される（既存挙動を維持）

CLI からブラウザへの伝達は既存の「`<html data-*>` ヒント属性」パターン（DESIGN.md §7c の `data-theme` / `data-comments-width` / `data-page-nav-width`）に揃える：

| 経路                    | 実装                                                                                                                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/cli/parse-args.ts` | `--show-open-file` を boolean フラグとしてパース。`parseArgs` の戻り値に `showOpenFile: boolean` を追加（既定 `false`）                                                                             |
| `src/core/embed.ts`     | `showOpenFile === false` の時に `<html>` タグへ `data-toolbar-open-file="off"` 属性を注入。`true` の時は属性を追加しない（属性が無いことが「表示」のデフォルト）                                    |
| `src/app/toolbar.ts`    | 起動時に `document.documentElement.dataset.toolbarOpenFile === 'off'` を判定し、`#btn-load` と `#file-md` を `remove()` で DOM から削除。`<head>` inline script で paint 前に消すことで FOUC を防ぐ |
| `localStorage` への保存 | しない（CLI ヒントは「その配布物の起動時のみ有効」で十分。永続化させると次回別の embed-template 起動時に意図せず引き継がれる）                                                                      |
| `standalone.html`       | 属性が付かないため `#btn-load` / `#file-md` はそのまま残る                                                                                                                                          |

値域は `'off'` 1 値のみ。`<html data-theme>` のような複数値は不要なため、入力としても `--show-open-file` フラグ 1 つで十分（`--show-open-file=true|false` 形式は採らない）。ホワイトリスト検証は `dataset.toolbarOpenFile === 'off'` の equality 比較で完結する。

## 4. 実装ステップ

順序は依存関係順。各ステップ完了で in-source test と手動視覚チェックを通す。

### Step 1: 設計判断の確定と CLI 参照点の洗い出し

- 本ドキュメントの §5 設計判断をレビュー
- `dist/review.html` を文字列参照しているコード箇所をすべて grep で列挙（`src/cli/` / `scripts/` / `README.md` / `package.json` 等）
- `dist/standalone.html` 相当の grammar all 注入で起動時 paint が許容範囲（< 1 秒目安）に収まることをローカル PoC で確認

成果物：§5 マッピング表が確定状態、参照点一覧、PoC 動作確認

### Step 2: Vite 設定の分割

- `vite.standalone.config.ts` を新規作成（`vite.config.ts` を ベースに `mdxg-inline-shiki-langs` plugin を追加）
- `vite.config.ts` の `build.rollupOptions.input` の出力名を `review.html` → `embed-template.html` に変更
- `package.json` の `scripts.build` を `vp build && vp build --config vite.standalone.config.ts && vp build --config vite.review-request.config.ts` に更新

成果物：`vite.config.ts` / `vite.standalone.config.ts` / `package.json`

### Step 3: `mdxg-inline-shiki-langs` plugin の実装

- `scripts/lib/inline-shiki-langs.mjs` （または `vite.standalone.config.ts` 内）に plugin 本体を実装
- `src/core/embed.ts` から `assembleShikiLangsPayload(langs: string[])` を export し、CLI 側 (`embed-template.html` への注入) と build plugin (`standalone.html` への注入) で共有
- in-source test：grammar JSON が 27 言語分すべて含まれること / `</script>` エスケープが効くこと / 空入力時の挙動

成果物：plugin 実装 + `src/core/embed.ts` の共通ロジック化 + in-source test

### Step 4: CLI の参照先変更 + `<title>` rewrite

- `src/cli/review-request.ts` の template path を `dist/embed-template.html` に変更
- ENOENT 時の案内メッセージ更新
- `src/core/embed.ts` に `<title>` を rewrite する pure 関数を追加。CLI が `data-name` 属性 rewrite 経路と並列に呼ぶ（§5.e の採用方針）。具体的には `<title>MDXG Redline</title>` を `<title>MDXG Redline — <mdFileName></title>` に置換し、ブラウザタブとファイル共有先で配布物を識別できるようにする。`mdFileName` は HTML escape 必須（DESIGN.md §11 信頼境界）
- in-source test：CLI 引数解析 + template path 解決 + `<title>` rewrite の単体テスト

成果物：CLI が `dist/embed-template.html` を読んで動作し、出力 HTML の `<title>` が CLI 出力物として識別可能になる

### Step 4b: `--show-open-file` オプションの追加

- `src/cli/parse-args.ts` に boolean フラグとしてパースを追加。HELP_TEXT も更新
- `src/core/embed.ts` で `showOpenFile === false` 時に `<html>` タグへ `data-toolbar-open-file="off"` 属性を注入する pure ロジックを追加
- `src/app/toolbar.ts` で起動時に `dataset.toolbarOpenFile === 'off'` を判定し、`#btn-load` / `#file-md` を `remove()`。`<head>` inline script で paint 前に消す経路も同時に追加（FOUC 防止、§7c の theme と同じパターン）
- `src/review.html` 側は構造変更なし（既存の `#btn-load` / `#file-md` のまま）

成果物：CLI 経路で生成された HTML を開いた時に Open file ボタンが既定で消える。`--show-open-file` 指定時は残る。`standalone.html` は影響を受けない

### Step 5: 既存 `dist/review.html` の削除

- `dist/review.html` を git rm
- `.gitignore` の更新は不要（`dist/` は commit 対象）
- README の「ダウンロードする HTML」案内を `dist/standalone.html` に向ける

成果物：`dist/` から `review.html` が消え、`standalone.html` + `embed-template.html` の 2 ファイルになる

### Step 6: README / ShareOnboardingGuide / DESIGN.md の更新

- README の「単独利用」セクションに `standalone.html` を明示
- DESIGN.md §3 / §13 / §14 を分割後の構成に書き換え（後述 Step 7）
- ShareOnboardingGuide で配布する場合の文言を更新

成果物：DESIGN.md 以外のドキュメント更新

### Step 7: DESIGN.md 反映と本ドキュメントの role 切替

- DESIGN.md §3 「review-request CLI 詳細」の参照先を `dist/embed-template.html` に
- DESIGN.md §13 「ビルドパイプライン」の図と表に `vite.standalone.config.ts` / `mdxg-inline-shiki-langs` を追加、`npm run build` の説明を 3 ステップに更新
- DESIGN.md §13 「HTML minify 無効維持と CI スモークテスト指針」を両 HTML 向けに拡張
- DESIGN.md §14 「ファイル構成」の `dist/` 配下を分割後の構成に書き換え
- 本ドキュメントを `docs/html-split-standalone-embed-template.archive.md` にリネーム

成果物：DESIGN.md 更新 + 本ドキュメントの archive

## 5. 設計判断

### a. ビルド構成（1 config / 2 output か、別 config か）

| 候補                                              | 採用 | 理由                                                                                                                                                                             |
| ------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. 1 config で `rollupOptions.input` 2 出力       | ✗    | viteSingleFile が 1 build で複数 input を扱う際の挙動が不安定（経験的に inline 化が一方の HTML にしか効かないケースがある）。1 config の中で plugin を条件分岐させる構造が複雑化 |
| **B. 別 config （`vite.standalone.config.ts`）**  | ✓    | `vite.review-request.config.ts` が既に SSR mode で別 config 化されている既存パターンに揃う。1 config 1 output で挙動が予測しやすく、`viteSingleFile` の挙動も安定                |
| C. ビルド後に Node スクリプトで grammar を inline | ✗    | build chain の外側に処理を持つと build 成果物の再現性が落ちる。`mdxg-inline-shiki-langs` plugin を vite build chain に乗せれば差分ビルドも自然に効く                             |

B 採用時の論点：

- **設定の重複**：`vite.config.ts` と `vite.standalone.config.ts` で plugin 配列や TypeScript 設定が重複する。共通部分を `vite.shared.ts` に切り出して両方が import する形にすると重複を抑えられる。重複が 10 行未満で済むなら共通化せず素直に並べる選択もあり

### b. 配布物サイズの二重化を許容するか

| 候補                                                                                | 採用 | 理由                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. `standalone.html` に grammar all を二重 inline する**                          | ✓    | リポジトリ容量 +5 MB は許容範囲。`file://` で開いた時に外部リクエスト 0 を維持できる（CSP `connect-src 'none'` との整合）。runtime fetch だと file:// で CORS / path 制約が発生し fragile |
| B. `standalone.html` が起動時に `dist/shiki-langs/*.json` を fetch する             | ✗    | `file://` での XHR / fetch は Chromium で path 制約があり、特定パターンで失敗。CSP `connect-src 'none'` を `connect-src 'self'` に緩める必要が生じ信頼境界が広がる                        |
| C. `standalone.html` を symlink で `embed-template.html` + grammar 別ファイルに代替 | ✗    | Windows で symlink 配布が壊れる。npm publish 時の挙動も symlink で不確実。配布物の自己完結性が損なわれる                                                                                  |

A 採用時の論点：

- **リポジトリ容量**：5 MB は git LFS を導入するほどではない。Phase 2 として grammar JSON の minify / 共通 token table 化で 30〜40% 圧縮できる余地はあるが、本タスクでは扱わない
- **配布物の DRY 原則**：grammar が 2 箇所に存在する状態は理想形ではないが、両者の生成元は同じ `dist/shiki-langs/*.json` のため drift しない（build 時に毎回再生成）。「DRY ではないが drift しない」状態は許容できる

### c. `<script id="embedded-md">` ブロックの取り扱い

| 候補                                                                          | 採用 | 理由                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. 両 HTML で同じ構造を維持し、`standalone.html` でも空ブロックとして残す** | ✓    | Open file 経路は `<script id="embedded-md">` を使わない（`toolbar.ts` の隠し input → 動的セット）が、ブロック自体が DOM 上にあっても害がない。両 HTML の構造的不変条件を揃える方が CLI / boot.ts の経路が単純化 |
| B. `standalone.html` からは `<script id="embedded-md">` を削除                | ✗    | `src/review.html` を 2 通りに分岐させる必要が出る。boot.ts も両 HTML で異なる起動順序を扱う羽目になり複雑                                                                                                       |
| C. `standalone.html` に Welcome / Help テキストを embedded-md として埋め込む  | ✗    | 「単独で開いた時の初期表示」を改善する案として魅力的だが、本タスクのスコープを超える。Phase 2 として検討                                                                                                        |

### d. 旧名 `dist/review.html` の互換性

| 候補                                                             | 採用 | 理由                                                                                                                                                                               |
| ---------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. 旧名を残さず削除**                                          | ✓    | 本リポジトリは外部から `dist/review.html` を直接 URL 参照する想定がない（README / DESIGN.md 内のリンクのみ）。残すと「どちらが正規か」の混乱が生じ、grammar の有無で挙動が分岐する |
| B. `dist/review.html` を `standalone.html` のコピーとして残す    | ✗    | 2 ファイルが同内容で commit されリポジトリ容量が無駄。バージョン drift のリスクも残る                                                                                              |
| C. `dist/review.html` を `embed-template.html` の symlink で残す | ✗    | Windows 互換性問題に加え、「旧名で開くと grammar が無く plain text fallback」という現状の問題が温存される                                                                          |

A 採用時の論点：

- **外部参照の確認**：本リポジトリの README / DESIGN.md / docs/ 配下を grep して `dist/review.html` への参照を洗い出し、すべて新名称に更新する。外部リポジトリからのリンクは追跡不可能だが、影響は限定的と判断

### e. `<title>` / メタ情報の分岐

採用方針：**`src/review.html` の `<title>` は共通とし、CLI が `embed-template.html` を rewrite する際に `<title>` を上書きする経路を追加**する。

理由：

- 共通テンプレートを分岐させたくない（§5.c の構造一致原則）
- CLI は既に `data-name` 属性を rewrite する経路を持つため、`<title>` の rewrite を追加する追加コストは小さい
- `standalone.html` は build 時の `<title>` をそのまま使う（`MDXG Redline`）

### f. ビルド成果物の commit 範囲

採用方針：**`dist/standalone.html` / `dist/embed-template.html` / `dist/review-request.mjs` / `dist/shiki-langs/*.json` をすべて commit 対象**とする（現状の配布契約を維持）。

理由：

- DESIGN.md §14 「clone 直後の利用者が `vp build` を実行せずにそのままブラウザで開けるようにし、npm publish 時にも `dist/` が必ず含まれるようにするため」の方針を踏襲
- partial clone / 手動削除での欠落時は CLI の ENOENT 案内エラーで救済される既存挙動を引き継ぐ

### g. Open file ボタンの既定挙動（CLI 経路）

| 候補                                                 | 採用 | 理由                                                                                                                                                                                                          |
| ---------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. 既定 hidden、`--show-open-file` で明示 opt-in** | ✓    | CLI 経路は「特定の MD をレビューする」固定文脈。Open file で別 MD を読み込むと `state.comments` が初期化される（DESIGN.md §3 入力 1）フットガンを構造的に塞ぐ。`standalone.html` は属性が付かないため影響なし |
| B. 既定 visible、`--hide-open-file` で opt-out       | ✗    | 既定挙動が「事故が起きやすい状態」になる。エージェント連携ループの主目的（CLI が生成した HTML 上で固定文書をレビューする）と既定挙動が一致しない                                                              |
| C. CLI 経路では常に hidden（フラグ無し）             | ✗    | 「CLI 経路でも別 MD を比較しながらレビューしたい」レアケースの逃げ道がなくなる。フラグ 1 つの追加コストは小さい                                                                                               |

A 採用時の論点：

- **適用範囲**：`#btn-load` ボタンと隠し `<input id="file-md" type="file" hidden>` の 2 要素のみ。Copy / Export / Write feedback.json は CLI 経路でも常時表示（フィードバック書き出しは CLI 経路の主目的）
- **DOM 削除 vs `display: none`**：`remove()` で DOM から消す。`display: none` だと keyboard tab order や DOM クエリで意図せず触れる経路が残り、信頼境界として弱い
- **永続化なし**：`localStorage` には保存しない。CLI ヒントは「その配布物の起動時のみ有効」。永続化させると次回別の embed-template 起動時に意図せず引き継がれる（`data-theme` は 3 状態の永続的選好だが、Open file の表示有無は配布物単位の固定属性なので扱いが異なる）

### h. `--show-open-file` のフラグ形式

| 候補                                               | 採用 | 理由                                                                                                                    |
| -------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------- |
| **A. boolean フラグ `--show-open-file`（値なし）** | ✓    | `--no-open` と同じスキーマで対称。`<html data-toolbar-open-file>` は `'off'` 1 値のみ取り得るため、入力側も bool で十分 |
| B. `--open-file <on\|off>` の値付き                | ✗    | `--theme` / `--shiki-langs` と揃うが、取り得る値が 2 値しかない場面では冗長。HELP_TEXT も長くなる                       |
| C. inverse `--no-show-open-file`                   | ✗    | 二重否定で読みづらい。既定が hidden のため「show する」を opt-in 表現に揃える方が一貫                                   |

## 6. テスト方針

### in-source test（新規）

- `core/embed.ts` の `assembleShikiLangsPayload`：
  - 27 言語すべて指定した場合、payload に 27 個の key が含まれる
  - 空配列を指定した場合、`{}` を返す
  - `</script>` リテラルを含む grammar に対する escape が効く
  - 未知の lang 名を渡した場合の挙動（ENOENT として throw / skip のどちらを採るか §4 PoC で確定）

- `cli/review-request.ts` の template path 解決：
  - `__dirname` 基準で `dist/embed-template.html` が解決される
  - ファイル不在時に ENOENT を捕えて案内エラーを throw する

- `scripts/lib/inline-shiki-langs.mjs`（または plugin 内テスト）：
  - `transformIndexHtml` が `<script id="embedded-shiki-langs">` を 1 度だけ書き換える（idempotent）
  - 既に payload が入っている場合の挙動（再書き込み / skip）

- `core/embed.ts` の `<title>` rewrite（Step 4）：
  - `<title>MDXG Redline</title>` が `<title>MDXG Redline — <mdFileName></title>` に置換される
  - `mdFileName` 中の `<` / `>` / `&` / `"` / `'` が HTML escape される（XSS 経路を塞ぐ、§11 信頼境界）
  - 既に rewrite 済みの HTML を再注入しても idempotent（`mdFileName` 部分だけが差し替わる）
  - `<title>` タグが見つからない HTML に対しては no-op（ENOENT ではなく warning）

- `core/embed.ts` の `data-toolbar-open-file` 属性注入：
  - `showOpenFile === false` で `<html>` に `data-toolbar-open-file="off"` が付く
  - `showOpenFile === true` で属性が付かない（属性自体が存在しないこと）
  - 既に属性付きの HTML を再注入しても idempotent（重複しない / 値が `'off'` に保たれる）

- `cli/parse-args.ts` の `--show-open-file` パース：
  - `--show-open-file` 付きで `showOpenFile: true`
  - フラグ無しで `showOpenFile: false`（既定値の確認）
  - `--show-open-file=true` 形式は受け付けない（boolean フラグであることの確認）

- `app/toolbar.ts`（happy-dom 環境テストが整っていれば）：
  - `documentElement.dataset.toolbarOpenFile === 'off'` で `#btn-load` / `#file-md` が `remove()` される
  - 属性無しの時は両要素が DOM に残る
  - 削除後も Comments ▾ メニュー内の Copy / Export / Write feedback.json は引き続き動作する（既存機能との非干渉、削除対象は `#btn-load` / `#file-md` の 2 要素に限定されることの確認）

### 手動視覚チェックリスト

`npm run build` 後、以下を確認：

- [ ] `dist/standalone.html` をダブルクリックで開き、`Open file` で適当な markdown を読み込んで全コードブロックが Shiki で highlight される（ts / js / py / sh / yaml / json などをサンプルに）
- [ ] `dist/standalone.html` で dark / light モード切替が効き、コードブロックの highlight 色も追従する
- [ ] `node dist/review-request.mjs <input.md>` で生成される `<mdFileName>-<docHash>-review.html` を開き、CLI が `--shiki-langs auto` で注入した grammar だけで highlight が効く（無関係言語は plain text）
- [ ] `--shiki-langs none` で生成した HTML は全コードブロックが plain text fallback
- [ ] `dist/embed-template.html` を直接ダブルクリックで開いた場合の挙動（grammar 無し plain text fallback で動作。これは想定内の挙動）
- [ ] 既存の Open file / Comment / Write feedback.json / Export / Copy 経路が `standalone.html` で回帰なし
- [ ] サイズが見積もり通り（`standalone.html` ≒ 5.5 MB / `embed-template.html` ≒ 314 KB）
- [ ] VS Code Remote / Codespaces で `node dist/review-request.mjs` 起動時の HTTP サーバー経路が動作し、`http://localhost:51729/...` で `embed-template.html` 由来の HTML が配信される
- [ ] `node dist/review-request.mjs <input.md>`（フラグ無し）で生成された HTML を開き、ヘッダから Open file ボタンが消えている。Copy / Export / Write feedback.json は表示されている
- [ ] `node dist/review-request.mjs --show-open-file <input.md>` で生成された HTML を開き、Open file ボタンが表示されており実際に別 MD を読み込める（既存挙動）
- [ ] `dist/standalone.html` では Open file ボタンが常に表示されている（CLI ヒント属性が付かないため）
- [ ] FOUC：CLI 経由 HTML を開いた瞬間に Open file ボタンが一瞬見えてから消える挙動が起きない（`<head>` inline script で paint 前に削除される経路の確認）

## 7. 受け入れ基準

- §1 対応スコープ表の全要件が ✓
- `dist/standalone.html` を CLI を経由せずに開いた時、27 言語すべてのコードブロックが Shiki で highlight される
- `node dist/review-request.mjs` の CLI 挙動が分割前と **意図的な変更を除いて互換**：出力ファイル名・サイズ・grammar 注入対象・`EMBEDDED_MD_RE` rewrite 成功率は不変。意図的な変更は次の 2 点に限定する
  - Open file ボタンが既定で出力 HTML から消える（§5.g、`--show-open-file` で従来挙動に戻せる）
  - 出力 HTML の `<title>` が `MDXG Redline — <mdFileName>` 形式になる（§5.e）
- `dist/embed-template.html` のサイズが現行 `dist/review.html` と同等（±5 KB 以内）
- DESIGN.md §3 / §13 / §14 が分割後の構成を反映済み
- README の「単独利用」案内が `dist/standalone.html` に更新済み
- 既存 in-source test がすべて通過し、新規追加分も通過
- 既存配布契約（clone 直後に `npm run build` 抜きで CLI 実行可能）が壊れない

## 8. 想定リスクと回避策

| リスク                                                                                   | 回避策                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mdxg-inline-shiki-langs` plugin が `dist/shiki-langs/*.json` を読めない（順序依存違反） | `npm run build` の `&&` チェーンで `vp build` → `vp build --config vite.standalone.config.ts` の順序を強制。plugin 側でも ENOENT 時に明示的にエラーを throw して silent fail を防ぐ |
| `standalone.html` のサイズが見積もり (5.5 MB) を大きく上回る                             | Step 1 の PoC で実測。超過時は grammar JSON の minify（不要な scope name の除去 / 共通 token table 化）を Phase 2 として検討                                                        |
| CLI が `dist/embed-template.html` を読む経路で path 解決が壊れる                         | `__dirname` 基準のパス解決を CLI 側で 1 箇所に集約し、in-source test でカバー                                                                                                       |
| `vite.standalone.config.ts` と `vite.config.ts` の plugin 設定が drift する              | 共通部分を `vite.shared.ts` に切り出し両方が import する。drift しない構造に強制する                                                                                                |
| viteSingleFile が `<script id="embedded-shiki-langs">` を破壊する                        | 既存挙動（`<script id="embedded-md">` / `<script id="embedded-feedback">` が `type` 非 module のため touch されない）と同パターンで安全。Step 2 でビルド後の HTML を grep して確認  |
| 旧名 `dist/review.html` 削除で外部リンクが破綻                                           | README / DESIGN.md / docs/ 配下の参照を grep で網羅し更新。外部リポジトリからの参照は追跡不可だが影響限定と判断（§5.d）                                                             |
| grammar の二重化でリポジトリ容量が肥大化                                                 | 現状の配布契約上は許容範囲。Phase 2 として `dist/standalone.html` を npm publish 時のみ生成し commit 対象から外す選択肢を検討（ただし clone 直後に開けない問題が再発する）          |
| HTML minify が将来有効化される可能性                                                     | DESIGN.md §13 「HTML minify 無効維持」方針を継続。両 HTML 共通の不変条件として明記                                                                                                  |
| `--show-open-file` 既定 hidden が「Open file が見当たらない」と困惑される                | HELP_TEXT / README に「CLI 経路では Open file は既定 hidden、`--show-open-file` で表示」を明示。`standalone.html` を直接開く経路は常時表示なので別経路が常に存在する                |
| `<head>` inline script が `localStorage` 不可環境で例外を出して Open file 削除が漏れる   | inline script を `try {} catch (e) {}` で囲み、属性読み出しのみで完結させる（`localStorage` には依存しない）。失敗時は `app/toolbar.ts` の起動時削除がフォールバックとして効く      |
| キーボード Tab order に削除済みボタンの空欄が残る                                        | `display: none` ではなく `remove()` で DOM から消すため tab order からも構造的に外れる（§5.g の判断）                                                                               |

## 9. 参考

- [DESIGN.md §3 review-request CLI 詳細](./DESIGN.md#3-ユーザーフロー)
- [DESIGN.md §11 セキュリティとプライバシー](./DESIGN.md#11-セキュリティとプライバシー) — CSP / 信頼境界
- [DESIGN.md §12 §2 Code Block Rendering](./DESIGN.md#12-mdxg-準拠ロードマップ今後の拡張) — Shiki upgrade パターン / 配布物サイズ実測
- [DESIGN.md §13 ビルドパイプライン](./DESIGN.md#13-ビルドパイプライン) — 既存 vite config 構成
- [DESIGN.md §14 ファイル構成](./DESIGN.md#14-ファイル構成) — 既存 `dist/` 配下の構成
- [vite-plugin-singlefile](https://github.com/richardtallent/vite-plugin-singlefile) — 採用プラグイン
- [Shiki: bundledLanguagesInfo](https://shiki.style/) — grammar JSON 形式
- [docs/mdxg-rendering-code-block.archive.md](./mdxg-rendering-code-block.archive.md) — Shiki 導入時の設計判断（同等パターンのプラン参考）
