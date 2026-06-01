---
name: md-review
description: |
  mdxg-redline CLI で人間レビュワーに markdown レビュー依頼を出し、feedback.json を Bash ポーリングで待ち、コメントを取り込んで markdown を改訂する標準レビューループを 1 経路でまわす skill。「この仕様書をレビューに出して」「人間にレビューしてもらってから次に進めたい」「レッドラインを引いてもらおう」のように、markdown を人間レビュワーに見せて構造化 JSON のフィードバックを受け取りたい意図がある発話には必ず使う。ファイル名やツール名への直接言及がなくても、「人間のチェックを挟む」「レビューラウンドを回す」「ヒューマンレビュー」を含む依頼で本 skill を使えるか積極的に検討する。ユーザーが `/md-review <path>` のように slash command で起動した場合も同じワークフローを適用する。
argument-hint: <path/to/markdown.md>
license: MIT
---

# md-review

mdxg-redline CLI を使った標準レビューループを Claude が単独で回せるようにする skill。1 ラウンドの内訳は次のとおり：

1. レビュー対象 markdown を準備する (既存 .md を読む、または Claude が生成する、またはユーザーから指定された `$ARGUMENTS`)
2. `scripts/request-review.sh <input.md>` で配布 HTML を生成しブラウザを起動、stdout から `REVIEW_HTML` / `FEEDBACK_JSON` の 2 行を取得する
3. `scripts/wait-feedback.sh <feedback.json>` で feedback.json の出現をポーリング待機する
4. 検出した feedback.json を読み、コメントを markdown に反映する
5. 更新された markdown で再レビュー依頼を出す
6. ユーザーに「次ラウンドへ進む / レビュー生成物をクリーニングして終了 / そのまま終了」のどれにするかを確認する

レビュワーがコメントを書く時間 (数分〜数時間) は Claude のターンが空くので、ポーリング期間中に他のタスクをするか sleep して待つ。

## 起動パターン

- **自動 triggering**: ユーザーが「レビュー依頼」「人間レビューを挟みたい」「mdxg-redline」「レッドライン」等を含む発話をしたとき、description に従って Claude が自動的に本 skill を選ぶ
- **slash command 起動**: ユーザーが `/md-review path/to/markdown.md` のように明示起動した場合、その引数を `INPUT_MD` として使う。引数が空 or 自然言語の場合は、Claude がコンテキストから markdown を特定する
- **自然言語でパス指定**: ユーザーが「`docs/spec.md` をレビューに出して」のようにパスを含めて発話した場合も、そのパスを `INPUT_MD` として使う

## いつ使うか / 使わないか

**使う**

- 「この仕様書を人間にレビューしてほしい」「mdxg-redline でコメント入れてもらって」のように、人間からの構造化フィードバックを **明示的に求めている** とき
- レビュー → 改訂 → 再レビューのラウンドを **複数回** 回したいとき
- Claude が markdown を生成した後、自己レビューではなく人間チェックを挟みたいとき

**使わない**

- レビュワーが人間ではなく LLM の場合 (本 skill は人間レビュワーが書く構造化 JSON フィードバックを処理する skill であり、LLM-as-judge のような自動評価には使わない)
- 「この markdown を要約して」「フォーマット直して」のように、人間レビューが介在しない単純な markdown 操作

## ワークフロー全体図

```text
[ユーザー指示]
   └─ Claude が markdown を準備 (生成 or 既存ファイル読み込み)
        └─ Bash: npx mdxg-redline <input.md> [output-dir]
             └─ stdout から <name>-<docHash>-review.html のパスを取得
                  └─ ブラウザがレビュワー側で起動 (環境依存)
                       └─ Bash: feedback.json の出現をポーリング
                            └─ feedback.json を読み込み・パース
                                 └─ comments[] を markdown に反映
                                      └─ ユーザーに「次ラウンド / クリーニング / そのまま終了」を確認
                                           └─ Round N+1 or クリーニング or 終了
```

## ステップ詳細

### 1. レビュー対象 markdown の準備

レビュー対象 markdown のパスを `INPUT_MD` として確定する。

- ユーザーが既存 .md のパスを示している場合 (slash command 引数 / 自然言語のいずれでも): そのパスを使う
- Claude がこれから markdown を生成する場合: 適切なディレクトリに Write ツールで保存してパスを確定する。生成物の出力先はユーザーと相談して決めるか、入力 .md と同じディレクトリに合わせる

### 2. CLI でレビュー依頼 HTML を生成 & ブラウザ起動

`scripts/request-review.sh` ラッパーを呼び出す。内部で `npx mdxg-redline` を起動し、レビュー HTML と対応する feedback.json の絶対パスを stdout に書き出す：

```bash
bash .claude/skills/md-review/scripts/request-review.sh <INPUT_MD> [output-dir]
```

ラッパーは `bash` 経由で呼び出す。`gh skill install` は scripts/ 配下のファイルから実行ビットを落としてコピーするため、`./script.sh` 形式の直接実行は `Permission denied` で失敗する。`bash script.sh` ならインストール側の実行ビット有無に依存しない。

stdout には以下 2 行が出るので、Claude はこれをパースして以降のステップに渡す：

```
REVIEW_HTML=/path/to/spec-a1b2c3d4e5f6a7b8-review.html
FEEDBACK_JSON=/path/to/spec-a1b2c3d4e5f6a7b8-feedback.json
```

`output-dir` を省略すると入力 .md と同じディレクトリに出力される。docHash を別途切り出す必要はなく、ラッパーがファイル名サフィックスの差し替えで対応 feedback パスを決定する。

**ブラウザ起動**

CLI は標準ブラウザの自動起動を試みる。ヘッドレス CI / SSH リモート等で起動できないときは、ラッパーの第 1 引数として `--no-open` を渡して抑止する：

```bash
bash .claude/skills/md-review/scripts/request-review.sh --no-open <INPUT_MD>
```

ラッパー内部で `npx mdxg-redline --no-open` に展開されるため、permissions.allow は既存のラッパー prefix 許可のままで済む。

### 3. feedback.json をポーリングで待つ

レビュワーがブラウザで `Write feedback.json` を押すと、`output-dir` に `<mdFileName>-<docHash>-feedback.json` が出現する。これを `scripts/wait-feedback.sh` ラッパー経由で `run_in_background` ポーリング待機する：

```bash
bash .claude/skills/md-review/scripts/wait-feedback.sh "$FEEDBACK_JSON"
```

第 2 引数でタイムアウト秒を上書きできる (既定 1800 秒 / 30 分)。

**ブラウザ要件 (重要)**

`Write feedback.json` ボタンは File System Access API を使うため **Chromium 系ブラウザ (Chrome / Edge / Arc / Brave / Opera) のみ対応**。Safari / Firefox のレビュワーには `Comments ▾ → Export as JSON` (ダウンロード) または `Copy as JSON` (クリップボード) で代替してもらう。ダウンロードした feedback.json のパスをユーザーから受け取り、本 skill のステップ 4 から再開する。

**ポーリングの設計判断**

- 間隔は `sleep 5` (5 秒)。レビュワーが書き出してから検出までの最大遅延は 5 秒で許容範囲
- タイムアウトは 30 分 (`timeout 1800`) を既定。レビューが長引くケースもあるが、Claude のターンが永遠に空くのを避けるため上限を切る。タイムアウト後はユーザーに「もう少し待ちますか？」と確認する
- `run_in_background: true` を使うことで Claude のメインターンは待たず、他の作業をしたり手放したりできる。完了は通知される

**ユーザーへの案内**

ポーリングを始めたら、ユーザーに今の状況を 1 文で伝える：

> mdxg-redline でブラウザを起動しました。レビュワーがコメントを記入し、「Write feedback.json」ボタンを押すまで待機します (最大 30 分)。完了したら自動で取り込みに進みます。

### 4. feedback.json を読み込み、markdown を更新する

ポーリングが完了したら、Read ツールで feedback.json を読む。スキーマ：

```jsonc
{
  "document": "spec.md",
  "docHash": "a1b2c3d4e5f6a7b8",
  "exportedAt": "2026-05-15T10:30:00.000Z",
  "comments": [
    {
      "id": "...",
      "quote": "選択されたテキスト原文",
      "comment": "レビュワーのコメント",
      "created": "...",
      "headingPath": ["## 3. 入力経路と出力経路", "### 3.2 ファイル選択"],
      "sourceLine": 42,
    },
  ],
}
```

**コメントを markdown に反映する手順**

1. 各コメントの `sourceLine` で markdown の該当行を特定 (`Read` の `offset` 引数が使える)
2. `quote` をその行付近で grep してフォールバック確認 (markdown 編集中に行ズレが起きていたら quote 検索で再特定)
3. `comment` の指示を解釈して、Edit ツールで markdown を書き換える
4. 全コメントを反映し終わったら、書き換え結果のサマリ (どのコメントを反映 / 保留したか) をユーザーに 3-5 行で報告

**sourceLine が信頼できないケース**

`docHash` がレビュー時点のものなので、Claude がラウンド中に手動で markdown を編集していた場合は `sourceLine` がずれる。安全のため、各コメントの位置確定は **`sourceLine` を起点に、`quote` を grep して整合性を確認** する 2 段構えにする。`quote` が見つからない場合は `headingPath` で該当セクションまで絞り込んでから手動マッチング。

**反映ポリシー**

レビュワーのコメントは「直してほしい」場合と「ここどうなってるの？」のような質問の場合がある：

- 修正指示 → そのまま markdown を書き換える
- 質問 / 議論喚起 → 即座に書き換えるのは時期尚早。ユーザーに「これは質問のようなので、回答を考えてから反映するか、ここはユーザー判断に任せる」と提示する
- 矛盾するコメント → 同じ箇所に複数コメントが付いて指示が衝突する場合は、両方を提示してユーザーに判断を仰ぐ

迷ったら反映前にユーザーに確認するほうが安全。一気に書き換えて diff だけ提示すると、レビュワーの意図とずれていた場合の手戻りが大きい。

### 5. 次ラウンドへ進むか / クリーニングするか / そのまま終了するかをユーザーに確認

markdown 更新が終わったら、更新された markdown で再レビュー依頼を出した後に、ユーザーに以下 3 つの選択肢を提示する：

- **次ラウンドへ**: 出したばかりの再レビュー依頼の feedback.json 出現をステップ 3 (ポーリング) で待つ
- **クリーニングして終了**: 古い review.html / feedback.json を削除してから終了 (下記)
- **そのまま終了**: 古いファイルを残したまま完了報告

ユーザーが「もう 1 ラウンド」と言ったら、**改訂後の markdown は内容が変わったので docHash も変わる**ことに注意する。新しい review.html と feedback.json は別ファイル名になり、古いものとは自動的に分離される。

**クリーニング**

mdxg-redline CLI に `--clean` サブコマンドがある：

```bash
# dry-run で削除候補を表示
npx mdxg-redline --clean <output-dir>

# 実削除
npx mdxg-redline --clean <output-dir> --yes
```

複数ラウンド回した最終ラウンドの後だけでなく、1 ラウンドで終わる場合でもユーザーに「クリーニングして終了するか」を毎回聞く。

## 1 コマンドで通すサンプル

実用上は次のような形になる (パスは例)：

```bash
# Round 1: 生成 → レビュー HTML 起動 → 出力パス取得
bash .claude/skills/md-review/scripts/request-review.sh path/to/draft.md path/to/output
# stdout に REVIEW_HTML=... と FEEDBACK_JSON=... の 2 行が出る

# レビュワー作業中はここでポーリング (run_in_background 推奨)
bash .claude/skills/md-review/scripts/wait-feedback.sh /path/to/draft-XXXX-feedback.json

# feedback.json を読んで markdown 編集に進む (Read / Edit ツール)
```

ユーザーから「もう 1 ラウンド」と言われたら、改訂後の markdown を同じ `output-dir` に置いたまま 1 行目から再実行する。docHash が変わるので、新しい review HTML と feedback.json のペアが別ファイル名で生成され、過去ラウンドとは構造的に分離される。

## トラブルシューティング

**ブラウザが起動しない (ヘッドレス / SSH リモート)**

CLI が起動失敗しても exit 0 で stdout に絶対パスが出るので、ユーザーに「stdout のパスを手動でブラウザで開いてください」と伝える。VS Code Codespaces / Remote Containers では CLI が自動的に HTTP サーバーモードに切り替わるので、フォワードされた `http://localhost:51729` を開く案内になる。

**ポーリングがタイムアウトした**

`timeout 1800` で 30 分待っても feedback.json が出てこなかったケース。ユーザーに「レビュー進行中ですか？ もう少し待ちますか？」と確認する。延長する場合は同じパスで再度ポーリングを起動する。レビュワーが Chromium 系以外で書き出せない状況なら、Export as JSON のダウンロードでも代替可能なので、ダウンロードした feedback.json のパスを教えてもらう。

**Safari / Firefox のレビュワー**

`Write feedback.json` は Chromium 系のみ対応。Safari / Firefox のレビュワーには `Comments ▾ → Export as JSON` (ダウンロード) または `Copy as JSON` (クリップボード) で代替してもらう。ダウンロードした feedback.json のパスをユーザーから受け取り、本 skill のステップ 4 から再開する。

## なぜこの形か (設計の意図)

- **CLI 経路を skill 化するメリット**: mdxg-redline の標準ループを Claude 単独で回すには、CLI 起動 → stdout からの docHash 取得 → ポーリング → feedback 読み込みという複数ステップを毎回手作業で組むのは過剰。これを skill にまとめておくことで、ユーザーは「レビュー依頼出して」と言うだけで一連のループを回せる
- **stdout からファイル名を取る理由**: docHash は SHA-256(markdown) の先頭 16 桁 hex で、Claude が再計算することもできるが、CLI が確定的に書き出した値を使うほうが命名規約に対する drift が構造的に発生しない
- **ポーリングを `run_in_background` で回す理由**: feedback 記入は数分〜数時間掛かることがある。前景で sleep ループを回すと Claude のメインターンが完全に止まるが、`run_in_background` ならその間に他のタスクを並行処理したり、ユーザーに手放したりできる
- **sourceLine と quote の 2 段構え**: `sourceLine` は markdown ソースの行番号で、レビュー時点の docHash と現バージョンの docHash が一致しているときだけ信頼できる。Claude がラウンド中に独自に編集していた場合に備え、`quote` の grep フォールバックを必ず持つ
- **Bash 操作を scripts/ 配下のラッパーに閉じ込める理由**: `npx mdxg-redline` 直叩きや `timeout 1800 bash -c '...'` を SKILL.md に直接書くと、利用者が `.claude/settings.local.json` の `permissions.allow` に許可ルールを書くときに、可変引数やシェル展開を含む長い prefix を書かざるを得ず prefix match と相性が悪い。`scripts/request-review.sh` / `scripts/wait-feedback.sh` の 2 本に閉じ込めることで、ラッパーのパス prefix だけで 1 ラウンド全工程を許可できる

## 設定例: permissions.allow

本 skill の Bash 操作を `.claude/settings.local.json` で許可するときは、以下のルールがあれば 1 ラウンド全工程をカバーできる：

```json
{
  "permissions": {
    "allow": [
      "Bash(bash .claude/skills/md-review/scripts/request-review.sh:*)",
      "Bash(bash .claude/skills/md-review/scripts/wait-feedback.sh:*)",
      "Bash(npx mdxg-redline --clean:*)"
    ]
  }
}
```

`npx mdxg-redline` 本体の起動は `scripts/` 配下のラッパーに閉じ込めているため、ラッパー単位の prefix 許可で済む。`--clean` だけはクリーンアップ時に CLI を直接叩くため別途許可ルールを追加している。CLI 直接実行を skill 外で併用したい場合は `Bash(npx mdxg-redline:*)` を追加する。
