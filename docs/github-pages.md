# GitHub Pages 公開パイプライン 設計・実装計画

DESIGN.md §13 ビルドパイプライン の出口 (`dist/standalone.html` / `dist/review-request.mjs` / `dist/embed-template.html` ほか) を、GitHub Pages 上のデモサイトとして公開するための設計判断と実装手順をまとめる。完了時点で DESIGN.md §13 に「公開パイプライン」サブセクションを追記し、本ドキュメントは `docs/archive/github-pages.archive.md` にアーカイブする想定。

## 1. 対応スコープ

ユーザー要件（事前合意済み）を満たす。

| 要件                                                                        | 現状 | 完了条件                                                                                           |
| --------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------- |
| [MUST] `dist/standalone.html` を Pages の `/`（root）で配信                 | 未   | `https://oubakiou.github.io/mdxg-redline/` を開くと standalone ビューワーが空入力で起動する        |
| [MUST] `README.md` を `dist/review-request.mjs` に通した review HTML を公開 | 未   | `/README-review.html` を開くとコメント機能付きで README 本文が表示される                           |
| [MUST] `README_ja.md` を同様に公開                                          | 未   | `/README_ja-review.html` を開くとコメント機能付きで README_ja 本文が表示される                     |
| [MUST] `main` への push で自動再デプロイされる                              | 未   | `main` に push すると Actions が走り、Pages 上の 3 ファイルが更新される                            |
| [MUST] CLI の `--comments-width` 既定値（コメント機能 ON）で配信            | 未   | review HTML 右側に コメントパネルが開いた状態で起動する                                            |
| [MUST] レビュー HTML の URL は docHash を含まない安定パスにする             | 未   | README の本文が変わっても `/README-review.html` / `/README_ja-review.html` の URL は不変           |
| [MUST] Node 24 でビルドする                                                 | 未   | `actions/setup-node@v4` の `node-version: '24'` で `npm ci` / `npm run build` / CLI 実行が成功する |

追加実装（要件外だが運用上有用）：

- 手動再デプロイ用に `workflow_dispatch` トリガーを足す
- `concurrency` で `main` への高頻度 push 時の同時デプロイを直列化（artifact レースを避ける）

スコープ外（別タスクで扱う / 意図的に割り切る）：

- カスタムドメイン (`CNAME`)：必要になった時点で追加
- PR プレビューデプロイ：別 environment が要るので別 PR
- standalone ビューワーを開いた状態で README を pre-load するランディング：「ルート = standalone (空)」をユーザーが選択済み
- Pages の Source 設定（Settings → Pages → Source: GitHub Actions）の有効化：UI 操作が必要なため、本プランの実装範囲外（ユーザー手動タスクとして §4 Step 3 で言及）

## 2. リファレンス実装と差分

GitHub Actions 公式の Pages デプロイレシピ ([Publishing with a custom GitHub Actions workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)) は次の 3 要素で構成される：

1. **`actions/configure-pages@v5`** — Pages 設定をジョブから読む（カスタムドメイン等の取得用）
2. **`actions/upload-pages-artifact@v3`** — 公開対象ディレクトリを artifact 化
3. **`actions/deploy-pages@v4`** — artifact を Pages にデプロイ、`github-pages` environment と `id-token: write` パーミッションが必須

本実装は **配布物が単一 HTML + CLI 生成 HTML** という構造のため、上記レシピに加えて次の差分を持つ：

| リファレンス（典型 SPA）                    | 本実装での置換                                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `npm run build` → `dist/` をそのまま upload | `npm run build` 後に CLI を 2 回実行して review HTML を生成し、`_site/` にステージング    |
| 出力ファイルが build 時にすべて決定         | review HTML のファイル名は `<basename>-<docHash>-review.html` で hash 込み、後段で rename |
| `dist/index.html` がルート                  | `dist/standalone.html` → `_site/index.html` にコピーしてルートに配置                      |

`configure-pages` は本実装では不要（カスタムドメインやベースパスを使わないため）。`upload-pages-artifact` + `deploy-pages` の最小構成で足りる。

## 3. 公開パイプラインの構成要素

### 3.1 `_site/` ステージング構成

ワークフロー内で組み立てる公開ディレクトリの最終形：

| パス                          | 出自                                                         | 説明                                     |
| ----------------------------- | ------------------------------------------------------------ | ---------------------------------------- |
| `_site/index.html`            | `dist/standalone.html` をコピー                              | ルート (`/`)。空の standalone ビューワー |
| `_site/README-review.html`    | `node dist/review-request.mjs --no-open README.md _site/`    | docHash を剥がした固定名                 |
| `_site/README_ja-review.html` | `node dist/review-request.mjs --no-open README_ja.md _site/` | 同上                                     |

`_site/` 配下にはこの 3 ファイルしか置かない。CLI の出力先指定 (`_site`) によって他の副作用ファイル（feedback.json 等）は発生しないが、念のため Pages にデプロイされるのは `_site/` ステージング後の内容のみとする。

### 3.2 docHash の rename 戦略

CLI 出力は `README-<docHash>-review.html` 形式で、`<docHash>` は本文ハッシュ。README 更新のたびに hash が変わるため、URL を docHash 込みのまま公開するとブックマーク / 外部リンクが切れる。

ワークフロー側で次の 2 段階で固定名に剥がす：

```bash
node dist/review-request.mjs --no-open --document-name README.md README.md _site
mv _site/README-*-review.html _site/README-review.html
```

`--document-name README.md` 明示は、入力ファイル名の basename が安定（リネームしても `README.md` を指す）であることを担保するための保険。glob (`README-*-review.html`) で hash 部分を吸収する。

**docHash を URL から消すことで失う情報**：feedback.json と review HTML の対応付けは docHash 経由で行うが、本パイプラインで生成する review HTML は **公開デモ用途で feedback 回収を想定しない**ため、docHash の対応付けは不要。レビュワーがブラウザでコメントを残しても、ローカルダウンロードする以外の経路はない（Pages サーバーは書き込み不可）。

### 3.3 ワークフローのジョブ分割

`actions/deploy-pages@v4` の要件に従い、build ジョブと deploy ジョブを分割する：

| ジョブ | 役割                                                                                                | 必要なパーミッション               |
| ------ | --------------------------------------------------------------------------------------------------- | ---------------------------------- |
| build  | checkout → setup-node → `npm ci` → `npm run build` → CLI 実行 → `_site/` ステージング → artifact 化 | `contents: read`                   |
| deploy | `actions/deploy-pages@v4`                                                                           | `pages: write` / `id-token: write` |

ジョブ分割理由：`deploy-pages` は専用の `github-pages` environment に書き込む構成で、最小権限の原則として artifact 生成側からデプロイ権限を分離するのが公式パターン。

## 4. 実装ステップ

### Step 1: 設計判断の確定とローカル検証

- 本ドキュメント §5 の設計判断をレビュー / 確定
- ローカルで次のコマンド列が成功することを確認（ワークフロー化前の dry-run）：
  ```bash
  npm ci
  npm run build
  mkdir -p _site
  cp dist/standalone.html _site/index.html
  node dist/review-request.mjs --no-open README.md _site
  node dist/review-request.mjs --no-open README_ja.md _site
  ls _site/README-*-review.html _site/README_ja-*-review.html
  mv _site/README-*-review.html _site/README-review.html
  mv _site/README_ja-*-review.html _site/README_ja-review.html
  ```
- `_site/index.html` / `_site/README-review.html` / `_site/README_ja-review.html` をブラウザで開いて期待どおり表示されることを確認

成果物：ローカル `_site/` 配下の 3 ファイル + 動作確認スクリーンショット（任意）

### Step 2: ワークフロー YAML の追加

`.github/workflows/pages.yml` を新規作成。骨子：

```yaml
name: Deploy GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - name: Stage _site
        run: |
          mkdir -p _site
          cp dist/standalone.html _site/index.html
          node dist/review-request.mjs --no-open README.md _site
          node dist/review-request.mjs --no-open README_ja.md _site
          mv _site/README-*-review.html _site/README-review.html
          mv _site/README_ja-*-review.html _site/README_ja-review.html
      - uses: actions/upload-pages-artifact@v3
        with:
          path: _site

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

成果物：`.github/workflows/pages.yml`

### Step 3: Pages の有効化（ユーザー手動タスク）

リポジトリオーナーが GitHub UI 上で次を実施：

1. **Settings → Pages → Build and deployment → Source** を **GitHub Actions** に変更
2. 初回 deploy 後、Settings → Pages の URL（`https://oubakiou.github.io/mdxg-redline/`）が表示されることを確認

この設定は CLI / Actions API では設定不可（要 UI 操作）。Step 2 の workflow が走っても、Source 設定が `Branch` のままだと 404 になるため、本 step がデプロイ成立の前提。

成果物：Settings → Pages の Source が「GitHub Actions」になっていること

### Step 4: 公開後の手動確認

`main` への push 後、Actions タブで pages ワークフローが green になったら：

- [ ] `https://oubakiou.github.io/mdxg-redline/` で standalone ビューワーが空入力で起動する
- [ ] `https://oubakiou.github.io/mdxg-redline/README-review.html` で英語 README がコメントパネル付きで表示される
- [ ] `https://oubakiou.github.io/mdxg-redline/README_ja-review.html` で日本語 README がコメントパネル付きで表示される
- [ ] コメント機能の Copy as JSON / Export as JSON が機能する
- [ ] Mermaid / 数式 / footnote が描画される（README 本文に含まれるため）

成果物：公開 URL の動作確認

### Step 5: DESIGN.md 反映と本ドキュメントの role 切替

- DESIGN.md §13「ビルドパイプライン」末尾に「公開パイプライン」サブセクションを追記し、本ワークフローの責務（既存 build 出口を `_site/` に集約して Pages に publish）と URL 設計を 1 段落で記述
- 本ドキュメントを `docs/archive/github-pages.archive.md` にリネーム

成果物：DESIGN.md 更新 + 本ドキュメントの archive

## 5. 設計判断

### a. デプロイ方式

| 候補                                | 採用 | 理由                                                                                                              |
| ----------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------- |
| **GitHub Actions + `deploy-pages`** | ✓    | `npm run build` + CLI を CI で再現可能。`dist/` を commit しないため `.gitignore` の `*-review.html` と整合       |
| `main` の `/docs` フォルダ公開      | ✗    | 配布物を git に commit する運用が必要。`dist/standalone.html` (~48 MB) を `/docs` にコピーすると history が肥大化 |
| `gh-pages` ブランチに手動 push      | ✗    | 手作業ループが必要。エイリアスや stale 状態の管理が手間で、Actions ベースに対する優位性なし                       |

採用案の論点：

- **build 時間**: `npm run build` は Mermaid / KaTeX / Shiki / standalone / CLI を順次ビルドするため、CI 時間が ~3〜5 分程度かかる見込み。push 頻度が低いプロジェクトなので問題なし
- **artifact サイズ**: `dist/standalone.html` ~48 MB + review HTML 2 本（数式 / mermaid 入りで ~数 MB 想定）。`upload-pages-artifact` の上限 (1 GB) に対して余裕

### b. URL 構成

| 候補                                                                     | 採用 | 理由                                                                                        |
| ------------------------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------- |
| **ルート = standalone（空）、README は兄弟パス**                         | ✓    | ユーザー選択。トップを「ツール本体」と位置づけ、README は補助的なサンプルとして提示         |
| ルート = ランディングページ（index.html を新規作成して各成果物にリンク） | ✗    | ランディング HTML を新規メンテする負荷。standalone 自体が "ツールのデモ" として完結している |
| サブディレクトリ分割（`/standalone/`、`/readme-en/`、`/readme-ja/`）     | ✗    | ファイル数 3 本でディレクトリを切るのは過剰。URL も冗長                                     |

### c. docHash の URL 露出

| 候補                                               | 採用 | 理由                                                                                                           |
| -------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------- |
| **rename で剥がして固定名 (`README-review.html`)** | ✓    | URL の安定性（ブックマーク / 外部リンクが切れない）。Pages は feedback 回収しないため docHash の対応付けは不要 |
| そのまま hash 込み (`README-<hash>-review.html`)   | ✗    | README 更新のたびに URL が変わる。`/README-latest-review.html` のような alias を別途用意すると二重メンテ       |
| `--document-name` で hash 部分を空にする CLI 改修  | ✗    | CLI の docHash 算出は §8 ファイル命名規約で固定。公開デモ用途のためだけに CLI の不変条件を緩めるのは過剰       |

### d. コメント機能の ON/OFF

| 候補                                           | 採用 | 理由                                                                                                                          |
| ---------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------- |
| **ON（デフォルト `--comments-width` 未指定）** | ✓    | ユーザー選択。「コメント可能なツール」のデモとして機能する。File System Access 非対応ブラウザでも Copy/Download fallback あり |
| OFF (`--comments-width 0`)                     | ✗    | 「単なる markdown ビューワー」に振るデモは standalone 側で代替できる                                                          |

### e. Node バージョン

| 候補   | 採用 | 理由                                                                                      |
| ------ | ---- | ----------------------------------------------------------------------------------------- |
| **24** | ✓    | ユーザー選択。最新 LTS 候補で、`actions/setup-node@v4` の `node-version: '24'` で解決可能 |
| 20     | ✗    | 既存 LTS だが、ユーザー要望に従い 24 を選択                                               |

注意点：ローカル devcontainer の Node バージョンと差異が出る可能性がある。CI で再現性に問題が出た場合は `node-version: '24.x'` から具体的なバージョン (`'24.0.0'` 等) に pin する。

### f. ワークフロー分割（build / deploy）

| 候補                               | 採用 | 理由                                                                                                            |
| ---------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------- |
| **build + deploy の 2 ジョブ分割** | ✓    | `actions/deploy-pages` の公式パターン。最小権限の原則（artifact 生成側に Pages 書き込み権限を持たせない）に合致 |
| 単一ジョブに統合                   | ✗    | ジョブ全体に `pages: write` / `id-token: write` を渡すことになり、不必要に権限が拡大                            |

### g. push トリガーの対象ファイル絞り込み（paths filter）

| 候補                                               | 採用 | 理由                                                                                                                       |
| -------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------- |
| **絞り込まず `main` への全 push でトリガー**       | ✓    | `src/**` / `README*.md` / `vite.config.ts` / `package.json` など影響範囲が広く、漏れがあると意図せず stale な Pages が残る |
| `paths` filter で `src/**` / `README*.md` 等に限定 | ✗    | 漏れリスクが高く、デプロイ抑止のメリットが小さい（push 頻度が低いプロジェクト）                                            |

### h. CLI 出力先のサブパス汚染

| 候補                                                          | 採用 | 理由                                                                                                                         |
| ------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| **CLI 出力先を `_site` 直下にし、生成後に必要分のみリネーム** | ✓    | 中間ファイルが `_site/` 直下に出るが、本タスクの CLI 実行で生まれる副作用ファイルは review HTML 1 個のみで、過剰な掃除は不要 |
| 中間ディレクトリ (`_site/_tmp/`) に出力して必要分のみコピー   | ✗    | 工程が増えるだけ。CLI の出力は単一 HTML で副作用が小さい                                                                     |

## 6. テスト方針

### 自動テスト

本タスクは CI ワークフローの追加でアプリ本体の挙動を変えないため、新規 in-source test は **追加しない**。代わりに以下で担保：

- 既存 `vp check` / `vp test` が変わらず通る（workflow 追加のみで `src/` 変更なし）
- ワークフロー初回実行で build / deploy が green になることを Actions UI で確認

ワークフロー YAML の事前検証は `gh workflow view` で構文確認、または `act` (nektos/act) でローカルドライランするのは任意。act は Pages 専用の deploy API を mock できないため、build ジョブのみ部分検証する形になる。

### 手動視覚チェックリスト

初回デプロイ完了後に確認：

- [ ] `/` で standalone ビューワーが起動し、空入力でも UI が表示される
- [ ] `/` で「Open file」ボタンが押せて、ローカルの markdown を読み込める
- [ ] `/README-review.html` で英語 README が表示され、Mermaid / 数式 / footnote が描画される
- [ ] `/README_ja-review.html` で日本語 README が同様に表示される
- [ ] review HTML 上で範囲選択 → コメント作成 → Copy as JSON / Export as JSON が機能する
- [ ] dark / light テーマ切替が両方の review HTML で動く
- [ ] Chromium 系 / Safari / Firefox それぞれで `/` と review HTML が描画される
- [ ] `main` への新しい push 後、`workflow_dispatch` 不要で Pages が更新される

## 7. 受け入れ基準

- §1 対応スコープ表の全 [MUST] 行が完了条件を満たす
- `.github/workflows/pages.yml` が新規追加され、Actions タブで build + deploy ジョブが両方 green
- `https://oubakiou.github.io/mdxg-redline/` / `/README-review.html` / `/README_ja-review.html` の 3 URL が 200 で開く
- `main` への次回 push で Pages が自動更新される
- DESIGN.md §13 に公開パイプラインの 1 段落が追記される
- 既存 `vp check` / `vp test` が全通過（workflow 追加のみで src/ 不変）

## 8. 想定リスクと回避策

| リスク                                                                                              | 回避策                                                                                                                                             |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pages の Source 設定（GitHub Actions）がユーザー側で有効化されていない                              | §4 Step 3 で UI 操作の必要性を明示。初回 workflow 実行が deploy ジョブで 404 / Forbidden になった場合、Source 設定を最初に疑う                     |
| CLI が Codespaces 検知で HTTP サーバーを立てようとして Actions runner で誤発火                      | `--no-open` を明示。Codespaces 検知は `$CODESPACES` 環境変数に依存するため、Actions runner 上では発火しないが、念のため `--no-open` で抑制         |
| `mv _site/README-*-review.html` の glob が複数マッチで失敗（同一 basename で複数生成された場合）    | 本タスクでは `README.md` / `README_ja.md` を 1 度ずつしか実行しないため発生しない。万一の場合は明示的にファイル名を `find` で取得する              |
| `npm run build` の出口に変更が入り、`dist/standalone.html` / `dist/review-request.mjs` パスが変わる | DESIGN.md §13 で固定されたパスを参照しているため、変更時は本ワークフローも合わせて更新する（ワークフロー YAML 内のパスをコメントで明示）           |
| `dist/standalone.html` のサイズ (~48 MB) が将来 Pages 配信上限に達する                              | 現状 (~48 MB) は GitHub Pages の単一ファイル上限 (100 MB) / リポジトリサイズ上限 (1 GB) に対して余裕。Shiki bundled 全言語を抜く案が将来オプション |
| ブラウザ自動起動先 (`$BROWSER` / `xdg-open`) が Actions runner で意図せず動作                       | `--no-open` で抑制。実装上は `$BROWSER` 未設定かつ Linux 環境では `xdg-open` 試行されるが、`--no-open` が先勝つ                                    |
| `_site/index.html` が標準の Jekyll 処理を受けて壊れる                                               | `actions/deploy-pages` は Jekyll 経路を介さない（artifact をそのまま配信）。`_site/.nojekyll` は不要だが、念のため追加しても害はない               |

## 9. 参考

- [GitHub Pages: Publishing with a custom GitHub Actions workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [`actions/upload-pages-artifact`](https://github.com/actions/upload-pages-artifact)
- [`actions/deploy-pages`](https://github.com/actions/deploy-pages)
- [`actions/setup-node`](https://github.com/actions/setup-node)
- [DESIGN.md §13 ビルドパイプライン](./DESIGN.md#13-ビルドパイプライン)
- [DESIGN.md §8 ワークスペースプロトコル / ファイル命名規約](./DESIGN.md#8-ワークスペースプロトコル) — docHash と review HTML ファイル名の規約
- [README_ja.md / CLI オプション一覧](../README_ja.md#cliオプション) — `--no-open` / `--document-name` の挙動
