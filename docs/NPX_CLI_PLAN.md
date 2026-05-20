# `npx mdxg-redline <markdown-file>` 対応計画

## 0. 進捗ステータス

| Phase                       | 内容                                                                                                                                                                                                                                                                                                | 状態   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **Phase 1: embedding core** | `</script>` / `data-name` のエスケープ、`<script id="embedded-md">` の rewrite、最小 CLI (`input.md` + 任意 `output-dir`、§8 ファイル命名規約による自動命名)、生成後の既定ブラウザ自動起動と `--no-open`、VS Code Remote / Codespaces 検知時のみ軽量 HTTP サーバー fallback (10 秒 / 60 秒自動停止) | 実装済 |
| **Phase 2: npx 起動 UX**    | `bin` エントリ追加、一時 HTML 生成、stdin 対応、`--document-name` / `--print-temp-path` フラグ、TTL クリーンアップ                                                                                                                                                                                  | 未実装 |

Phase 1 の実体：

- `src/embed-core.ts` … pure ロジック（Node / browser 両対応）。in-source test 16 件
- `src/embed.ts` … Node CLI ラッパー（shebang 付き、`[--no-open] <input.md> [output-dir]` 引数、§8 ファイル命名規約に従って出力ファイル名を自動決定、ENOENT を親切なメッセージに差し替え、生成後の既定ブラウザ起動、VS Code Remote 検知時のみ軽量 HTTP サーバー fallback）。`parseArgs` / `buildOpenCommand` / `isHostBrowserUnreachableViaFile` を in-source test 対象として export
- `vite.embed.config.ts` … SSR mode で `dist/embed.mjs` を生成するビルド設定
- `npm run build:embed` … embed CLI のみの差分ビルド、`npm run build` は review.html と一緒に再生成

実装上の意思決定で本文と差分があるものは §5.1.1 / §10.1 の注記を参照。

## 1. 背景

現状の `mdxg-redline` は、エンドユーザーに **単一 HTML ファイル**（`dist/review.html`）を配布し、ブラウザで開いて使う前提で設計されている。
一方で、利用者の導線としては `npx mdxg-redline <markdown-file>` のように markdown ファイルを直接渡して起動できる形が分かりやすい。

本計画書は、この CLI 形式の起動導線を追加する場合の実装方針を整理する。

## 2. 現状整理

- 配布の中心は `dist/review.html`
- 入力経路はすでに複数あり、主に以下を利用できる
  - `Open file` によるローカルファイル選択
  - HTML への markdown 埋め込み（`<script id="embedded-md" type="text/markdown" data-name="...">` パターン。`src/boot.ts` の `loadEmbeddedMarkdown` で読み込まれる）
  - URL ハッシュ `#md=...&name=...`
  - ワークスペース監視（`<name>-<hash>-review.md` / `<name>-<hash>-feedback.json`、詳細は `docs/DESIGN.md §8`）
- `package.json` には現時点で CLI 用の `bin` エントリがない
- `package.json` は `"type": "module"` であり、追加実装は ESM 前提となる
- 依存は `marked` 1 個のみのシンプルな構成

このため、レビュー UI を作り直すのではなく、**既存の `review.html` を起動する薄い CLI ラッパーを追加する**のが最小変更になる。
埋め込み経路としては `<script type="text/markdown">` パターンを再利用する。これは HTML の raw text element であり、`<textarea>` と異なり HTML エンティティのデコードが起きないため、markdown のバイト列を忠実に保持できる。

## 3. 目標

- `npx mdxg-redline <markdown-file>` でレビュー画面を起動できるようにする
- 既存の browser-first な利用方法を壊さない
- 長文の markdown でも安定して扱える
- npm 配布物として自然に利用できる構成にする

## 4. 非目標

- レビュー UI 自体の大幅な再設計
- markdown 編集機能の追加
- 共同編集やサーバー機能の追加
- ワークスペース監視の CLI 完全置き換え

## 5. 推奨アプローチ

### 5.1 第一候補: 一時 HTML 生成 + 埋め込み起動

Node 側の CLI で指定された markdown ファイルを読み込み、`dist/review.html` をベースに **markdown を埋め込んだ一時 HTML** を生成して既定ブラウザで開く方式を第一候補とする。

この方式の利点:

- 既存の埋め込み起動経路を再利用しやすい
- URL 長制限の影響を受けにくい
- 長い markdown を扱う本ツールの用途と相性がよい
- 起動後のレビュー UI は既存実装をそのまま利用できる

#### 5.1.1 差し込み方式

`dist/review.html` 内の既存 `<script id="embedded-md" type="text/markdown" data-name="...">...</script>` を正規表現でマッチし、中身と `data-name` 属性を書き換える方式を採用する。
`review.html` 側に新たなプレースホルダを増やさないため、ファイル単体の自然さを維持できる。

ビルドが将来 HTML minify を有効化して属性順や空白を変える場合、この方式は脆くなる。
その場合は HTML minify を無効化する方針で対応する（CLI 側の保守を増やすより、ビルド設定で安定性を確保するほうが望ましい）。

**実装注記（Phase 1）**: `dist/review.html` には説明用 HTML コメント内に literal `<script id="embedded-md">` というテキストが先行する。`id="embedded-md"` だけで正規表現マッチさせると、このコメント内テキストから本物の `</script>` までを丸ごと置換してしまい本文が破壊される。これを回避するため、`embed-core.ts` の `EMBEDDED_MD_RE` は **`id="embedded-md"` と `type="text/markdown"` の両方を lookahead で要求**する形にしている：

```ts
const EMBEDDED_MD_RE =
  /(<script\b(?=[^>]*\bid="embedded-md")(?=[^>]*\btype="text\/markdown")[^>]*>)([\s\S]*?)(<\/script>)/i
```

`type="text/markdown"` 属性は本物の `<script>` タグだけが持つため、コメント内 literal は確実に弾ける。属性順は lookahead により非依存。

#### 5.1.2 埋め込み時のエスケープ要件

CLI 側で書き込む直前に、以下の 2 種類のエスケープを適用する。**boot.ts 側は無変更**で、ブラウザの HTML パーサ・DOM API（`textContent` / `dataset.name`）の自動デコードに委ねる。

**(a) script 内 markdown 本文の `</script>` エスケープ**

- markdown 本文中に `</script>` が含まれると script タグが先に閉じてしまう
- CLI 側で `</script>` → `<\/script>` への置換を行う（大文字小文字を区別しない比較で `</SCRIPT>` 等も対象）
- script は raw text element であり、他の文字（`<`, `&` 等）はエスケープ不要

**(b) `data-name` 属性値の HTML 属性エスケープ**

- `--document-name` だけでなく、ファイル名由来の basename も対象（POSIX ファイル名は `"`, `<`, `>`, `&`, `'` を許容するため `My "report".md` のようなケースで属性破壊が起きる）
- エスケープ対象と置換: `&` → `&amp;`、`"` → `&quot;`、`<` → `&lt;`、`>` → `&gt;`、`'` → `&#39;`
- `data-name` 属性はダブルクォートで囲む前提に固定する
- ブラウザは `dataset.name` 経由で読み出す際に自動デコードするため、boot.ts 側は無変更で正しい文字列を受け取れる

### 5.2 第二候補: URL ハッシュ起動

`#md=<base64url>&name=<file>` 形式で markdown を渡す方式も可能だが、長文では URL 長制限や共有環境依存の問題が出やすい。
そのため、CLI の主要導線としては補助案に留めるのが望ましい。

## 6. CLI 仕様案

最低限、以下のインターフェースを対象とする。

```bash
npx mdxg-redline <markdown-file>
cat foo.md | npx mdxg-redline -
npx mdxg-redline <markdown-file> --print-temp-path
```

初期仕様で定める項目:

- 引数 1 個で markdown ファイルを受け取る
- 引数が `-` の場合は stdin から markdown を読み込む
- 引数なし時はヘルプを表示する
- 拡張子チェックは行わない（任意拡張子を許容する。読み込み可否のみで判定）
- 存在しないパス、ディレクトリ指定、読み取り不可時は明確なエラーを返す
- 既定ブラウザ起動に失敗した場合は、生成した一時 HTML の絶対パスを stdout に表示し、ユーザーが手動で `file://` で開ける状態にする。CLI は exit 0 を維持し、stderr に警告を出す
- `--no-open`: ブラウザ起動を抑止する。CI / エージェント自動実行・ヘッドレス環境で意図せずブラウザを起こさないための opt-out（Phase 1 で `dist/embed.mjs` に実装済）
- `--print-temp-path`: 一時 HTML 生成モード（Phase 2）でブラウザ起動をスキップし、生成した一時 HTML のパスを stdout に出して終了する（スクリプト連携・手動掃除用）

#### document 名の規約

- ファイル引数の **basename のみ**をレビュー画面に引き継ぐ（例: `/path/to/spec.md` → `spec.md`）
- stdin (`-`) の場合のデフォルトは `stdin.md`
- `--document-name <name>` フラグで上書き可能とする
- どの経路で得られた値も、§5.1.2 (b) の HTML 属性エスケープを通過させた上で `data-name` に書き込む
- 引き継いだ名前は埋め込み HTML の `data-name` 属性に設定され、エクスポート JSON の `document` フィールドに反映される

将来拡張候補:

- `--help`
- `--browser`
- `--watch <dir>` などの高度な連携

## 7. パッケージ構成の変更案

### 7.1 CLI 実装の置き場所

- `src/cli.ts` に TypeScript で実装し、ビルドで出力する
- `bin/` を別途設けず、既存の `src/` 配下の一貫性を保つ
- shebang (`#!/usr/bin/env node`) を冒頭に付与する
- `__dirname` 相当は `import.meta.url` 経由で `fileURLToPath` を使って解決する

### 7.2 `package.json` の変更点

- `bin` フィールドに `mdxg-redline` → ビルド出力された CLI ファイルのパス（例: `dist/cli.mjs`）を追加
- `files` にビルド出力先（既に `dist/` を含んでいるためそのまま、ただし CLI 出力が確実に含まれることを確認）
- `engines.node` を `>=20.0.0` 程度に明示する（ESM、`fs/promises`、安定した `child_process` 機能を要件とするため）

### 7.3 ビルドパイプライン

- 現状の Vite + vite-plugin-singlefile は `review.html` の単一ファイル化が対象
- CLI 用に Node 向け ESM ビルドのターゲットを追加する必要がある（tsc 直叩き、もしくは Vite の lib モード）
- どちらにするかは実装段階で決める（依存追加の少ない tsc 直叩きが候補）

**実装注記（Phase 1）**: Vite の SSR モードを別 config (`vite.embed.config.ts`) で運用する方式を採用した。Rolldown が `src/embed.ts` 冒頭の shebang を自動で保持し、`node:*` モジュールを external にするだけで Node 20+ で実行可能な ESM が出力される。`lib` モードは top-level side-effect しか持たない CLI エントリと相性が悪く、tree-shake で本体が空になる挙動が出たため SSR モードを選択した。

## 8. 実装ステップ案

凡例: [x] 実装済 / [部分] Phase 1 で一部実装、Phase 2 で拡張 / [ ] 未着手

1. [部分] CLI エントリポイントを実装する（引数パース、`-`/stdin 対応、`--document-name` / `--print-temp-path` フラグ、エラー処理）
   - Phase 1: `[--no-open] <input.md> [output-dir]` の引数。出力ファイル名は §8 ファイル命名規約（`<mdFileName>-<docHash>-review.html`）で自動決定。`src/embed.ts` として実装（当初の `src/cli.ts` という命名から変更）。フラグと位置引数の混在順序を許容する `parseArgs` を in-source test 対象として export
   - Phase 2: stdin、`--document-name`、`--print-temp-path` を追加
2. [部分] 指定ファイル/stdin の読み込み、ファイル存在チェック、エラー処理を実装する
   - Phase 1: ファイル読み込みと ENOENT 処理（`dist/review.html` 欠落時は `npm run build` を案内する親切なメッセージに差し替え）
   - Phase 2: stdin パイプ入力、EACCES / EISDIR の区別
3. [x] document 名（basename）に §5.1.2 (b) の HTML 属性エスケープを適用する処理を実装する（`embed-core.ts` の `escapeHtmlAttribute`）
   - Phase 2: stdin デフォルト名と `--document-name` 上書きの追加
4. [x] markdown 本文に §5.1.2 (a) の `</script>` エスケープを適用する処理を実装する（`embed-core.ts` の `escapeScriptContent`）
5. [x] `dist/review.html` を読み込み、`embedded-md` タグの中身と `data-name` 属性を書き換えて HTML を生成する処理を実装する（`embed-core.ts` の `rewriteReviewHtml`）
6. [ ] `os.tmpdir()/mdxg-redline/` 配下に一時 HTML を書き出し、起動時に同ディレクトリ内の TTL 7 日超ファイルをクリーンアップする処理を実装する（Phase 2 で着手）
7. [x] プラットフォーム判定で `execFile` + 引数配列ベースでブラウザを起動する処理を実装する（`shell: true` 禁止、起動失敗時は一時 HTML パスを stdout に表示）
   - Phase 1: `src/embed.ts` の `buildOpenCommand`（pure helper、in-source test 対象）+ `openInBrowser`（実起動）として実装。優先順は `$BROWSER` → darwin: `open` → win32: `cmd.exe /c start` → その他: `xdg-open`。`$BROWSER` を最優先することで VS Code Remote Containers / Codespaces などのヘルパースクリプト経由でホスト側ブラウザに転送できる（`gh` CLI などと同じ慣習）。既定で起動、`--no-open` で抑止。失敗時は stderr に警告を出して exit 0 を維持
   - Phase 1 追加: `isHostBrowserUnreachableViaFile`（pure helper）で `REMOTE_CONTAINERS=true` / `CODESPACES=true` / `$BROWSER` が `vscode-server/.../helpers/browser.sh` を指すケースを検知し、true の場合のみ `serveOnceAndAutoStop` で `127.0.0.1` のランダムポートに軽量 HTTP サーバーを立てて `http://localhost:<port>/...` を `$BROWSER` に渡す。停止条件は二段構え（初回リクエスト後 10 秒 / 未着なら 60 秒で諦め）、レスポンスは `Connection: close` で keep-alive を無効化して `server.close()` のハングを防ぐ。配信は固定 HTML 1 ファイルのみ・リクエストパス無視でパストラバーサル不能
   - Phase 2: 一時 HTML ディレクトリと組み合わせて `npx` 起動に統合（タスク 6 と連動）
8. [x] CLI 向けの Node ESM ビルドを `package.json` の scripts に追加し、出力を `dist/` に配置する（`vite.embed.config.ts` + `npm run build:embed`）
9. [ ] `package.json` の `bin` / `engines` を追加し、`files` の整合を確認する（Phase 2 で着手）
10. [ ] README に CLI 利用方法を追記する（Phase 2 で着手）
11. [部分] 正常系・異常系の確認を行う
    - Phase 1: in-source test 16 件（escape / rewrite / コメント内 literal の無視 / `type="text/markdown"` 要件 など）+ 手動実行で `review.html` 欠落時のメッセージ確認
    - Phase 2: §10.2 の E2E ケースを追加

## 9. リスクと検討事項

### 9.1 一時ファイル管理

- 生成場所: `os.tmpdir()/mdxg-redline/` 配下に統一する
  - 自分が生成したファイルを安全に識別でき、他ツールの一時ファイルを誤って消すリスクを排除
- 命名: 衝突回避のため `<random>.html` 形式（プロセスID + ランダム要素）
- 後始末方針:
  - **プロセス終了時の削除は行わない**（ブラウザ起動と非同期のため早期削除は壊れる）
  - **CLI 起動時に同ディレクトリ内をスキャンし、`mtime` が 7 日より古いファイルを削除**する TTL ベースのクリーンアップを実装
  - 削除失敗（権限不足等）は警告も出さず無視する（致命的でないため）
- 手動掃除導線として `--print-temp-path` を初期仕様に含める

### 9.2 既定ブラウザ起動

- `child_process` で OS ごとに以下を起動する。**`shell: true` は使わず、必ず引数配列を渡す**
  - macOS: `execFile('open', [path])`
  - Linux: `execFile('xdg-open', [path])`
  - Windows: `spawn('cmd.exe', ['/c', 'start', '""', path])`
    - `start` は `cmd.exe` のビルトインのため外部 EXE として直接呼べない
    - `""` は start のウィンドウタイトル位置の空文字列プレースホルダ（これが無いと path がタイトルとして解釈される）
    - `windowsVerbatimArguments` の挙動は実装段階で実機検証する
- 外部依存（`open` パッケージ等）は追加しない（`marked` のみのシンプルな依存構成を維持）
- headless 環境や GUI 非搭載環境（devcontainer / Codespaces 等を含む）では起動が失敗しうる
- 失敗時は生成した一時 HTML の絶対パスを stdout に表示し、ユーザーが手動で `file://` プロトコルで開ける導線を残す

### 9.3 セキュリティとエスケープ

§5.1.2 で定義したエスケープ要件を実装上の必須要件として扱う。

- markdown 中の `</script>` を `<\/script>` にエスケープしてから埋め込む（CLI 側で実施）
- `data-name` に書き込む値（basename / stdin デフォルト / `--document-name` のいずれも）に HTML 属性エスケープを適用する
- `data-name` には basename のみを入れ、絶対パス情報の漏れを防ぐ
- 任意パス読み込み時のエラーは明確なメッセージで返す（ENOENT / EACCES / EISDIR の区別）

### 9.4 ビルドとの結合

- `dist/review.html` の HTML minify は将来も無効のままにする（5.1.1 の正規表現マッチング前提を守るため）
- CI で「ビルド後の `dist/review.html` に `id="embedded-md"` **かつ** `type="text/markdown"` を併せ持つ script タグが含まれること」をスモークテストとして検査する（§5.1.1 の実装注記の通り、両属性を必須要件とするマッチング前提）

## 10. 検証観点

### 10.1 単体テスト（vitest）

Phase 1 実装済（`src/embed-core.ts` の in-source test、計 16 件）：

- [x] `</script>` エスケープ関数（大文字小文字混在 / 原文 case 保持 / 出現なしのパススルー）
- [x] `data-name` HTML 属性エスケープ関数（`"`, `&`, `<`, `>`, `'` を含む値、二重エスケープ防止）
- [x] `embedded-md` タグ書き換え関数（属性順違い、`data-name` 欠落時の補完、コンテンツ置換、`$` を含む markdown の特殊置換扱いの回避、元文字列を破壊しないこと）
- [x] マッチ対象判定（HTML コメント内の literal `<script id="embedded-md">` の無視、`type="text/markdown"` 欠落時のスキップ、タグ不在時の Error）

Phase 2 で追加予定：

- [ ] 引数パース（ファイルパス / `-` / `--document-name` / `--print-temp-path` / 不正引数）
- [ ] document 名解決（basename / stdin デフォルト / `--document-name` 上書き）
- [ ] TTL クリーンアップ関数（mtime が境界の前後でファイルを残す/消すケース）
- [ ] プラットフォーム判定とブラウザ起動コマンド組み立て（引数配列の組み立てのみ検証、実起動はモック）

### 10.2 手動 E2E

Phase 1 で `node dist/embed.mjs` を直接叩いて確認済（命名規約導入前の `<input.md> <output.html>` 形式での記録）：

- [x] 短い markdown で生成できること
- [x] 日本語・絵文字・記号を含む markdown を壊さないこと（HTML エンティティ的な文字列も含む）
- [x] markdown 本文中に `</script>` を含む場合でも壊れないこと
- [x] `dist/review.html` 欠落時に親切なエラーメッセージで失敗すること
- [x] 既存の `review.html` 単独利用フローを壊さないこと

命名規約 (`<mdFileName>-<docHash>-review.html`) 対応の追加検証項目：

- [ ] `<input.md>` 単独実行で入力 MD と同じディレクトリに `<mdFileName>-<docHash>-review.html` が出力されること
- [ ] `<input.md> <output-dir>` 形式で指定ディレクトリに正しい命名で出力されること
- [ ] 同じ MD を 2 回実行しても同じ出力ファイル名になること（hash 決定性）
- [ ] 本文を 1 文字変えて実行すると別の出力ファイル名になること（hash の差分検知）
- [ ] スペース・日本語を含む MD ファイル名でも正しく組み立てられること

Phase 2 で追加確認：

- [ ] 長い markdown でも起動できること
- [ ] ファイル名に `"`, `<`, `&`, スペース、日本語を含むケースで `data-name` が壊れないこと
- [ ] パスに `&`, スペース、日本語を含むケースでブラウザ起動が壊れないこと（macOS / Linux / Windows それぞれ）
- [ ] stdin パイプ入力で正常に起動できること
- [ ] ブラウザ起動失敗環境（devcontainer 等）で一時 HTML パスが stdout に出ること
- [ ] `--print-temp-path` でブラウザを起動せずパスのみ出力されること
- [ ] 7 日超の一時ファイルが起動時にクリーンアップされること

## 11. 結論

`npx mdxg-redline <markdown-file>` の利用形態は **十分に実現可能** であり、既存実装との整合性を保ちながら進められる。
最も自然でリスクが低いのは、**既存の `review.html` を活かしつつ、一時 HTML を生成して起動する薄い CLI を追加する方針** である。

**Phase 1 で完了したのは、この CLI の中核である「embedding core（エスケープ + rewrite）+ 最小 CLI」までで、`dist/embed.mjs` として配布できる状態になっている。** CLI のインターフェースは §8 ファイル命名規約の導入に合わせて `<input.md> [output-dir]` に変更され、出力ファイル名は規約から自動決定される。`npx mdxg-redline` 化（Phase 2）は §0 の進捗ステータス参照。
