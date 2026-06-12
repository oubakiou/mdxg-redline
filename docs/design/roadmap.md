# MDXG Redline 拡張候補ロードマップ

本ドキュメントは MDXG Redline の **今後の拡張候補** を整理する。現状設計の記述は [docs/design/DESIGN.md](./DESIGN.md) に置き、本書はまだ実装していない将来機能の検討メモに限定する（DESIGN.md を「現状」、本書を「未来」として分離する方針）。

各候補は実装に着手した時点で、確定した設計を DESIGN.md 本体へ移し、本書からは削除する。着手・見送りの履歴は `git log` で辿れる。

> コードベースの保守性向上を目的とした「挙動不変のリファクタリング候補」は別途 [docs/refactoring/refactoring-plan.md](../refactoring/refactoring-plan.md) に分ける。本書は新機能・新挙動の追加候補を扱う。

## 相対画像パスの対応（Safe モードの無効化）

MDXG §4 [MUST]「相対画像パスをドキュメント位置基準で解決」に準拠するため、現状の Safe モード（常時 ON、§11 URL allowlist による相対 URL 拒否）を opt-out 可能にする拡張。現状の割り切り（対応外）は DESIGN.md §12「対応外として割り切る項目」を参照。実装には次の 3 点が必要：

- **review-request CLI への Safe モード無効化オプション追加**：例 `--unsafe-images` を CLI の arg-spec / run-args partition に追加し、明示指定時のみ Safe OFF で配布 HTML を生成する。embed 層がフラグを受け取り、生成 HTML 側にフラグ（例：`<script id="embedded-md" data-safe="off">` のデータ属性、または独立した `<meta>` タグ）として書き出す。既定は Safe ON 維持（フラグ未指定なら現状の挙動）。既存配布 HTML を OS のファイラから単に開いた場合は遡って Safe OFF にならず、CLI で明示生成した HTML だけが Safe OFF として動作する
- **CSP 緩和とブラウザ側 allowlist の更新**：配布 HTML の `<meta http-equiv="Content-Security-Policy">` の `img-src` に `file:` を追加（`file://` 起動時のみ有効）。ブラウザ側 boot が埋め込み HTML の `data-safe` 属性を読み取り、markdown renderer の Safe モード状態を切り替える。Safe OFF 時は `<img>` 生成側で `new URL(href, location.href)` により相対 URL を解決し、絶対 `file:` パス（`![](/etc/passwd)` / `![](file:///…)` 等）は引き続き allowlist で弾く
- **DevContainer / Codespaces 向けフォールバック用 HTTP サーバーでの画像配信機能の追加**：HTTP モード（`$BROWSER` が `file://` を扱えない環境）でも相対画像が解決できるよう、CLI の serve を拡張して元 MD と同じディレクトリ配下の画像ファイル（`*.png` / `*.jpg` / `*.gif` / `*.svg` / `*.webp` 等）を配信できるようにする。配信スコープを **元 MD のディレクトリ配下に限定** し、`..` を含むパスを正規化後にディレクトリ外を指していたら 404、シンボリックリンク先がディレクトリ外でも 404 とする（パストラバーサル対策）。リクエストパスは現状「無視して固定 HTML を返す」設計なので、画像配信を追加する場合は MIME type 判定 + パス正規化 + 配信スコープチェックを積む必要がある

実装上の追加考慮：レビュー対象 markdown が信頼できない前提では、相対 URL を許可することで `<img onload>` を介した任意 file 存在確認の経路が開く（CSP で `<script>` は塞げても画像取得の成否は副作用として残る）。Safe OFF は「信頼済み markdown を手元で確認する」ユースケースに限定する旨を UI / ドキュメントに明示する必要がある

## プロンプトインジェクション対策のマークダウンサニタイズ導入

レビュー対象 markdown は LLM 生成物であることが多く、ChatML sigil（`<|im_start|>` 等）/ Harmony フォーマット（`<|start|>` / `<|message|>` / `<|channel|>` 等）/ HTML 風ロールタグ（`<system>` / `<developer>` / `<untrusted_content>` 等）/ 行頭ロール宣言（`human:` / `developer:` 等）/ instruction override 表現（`ignore previous instructions` / `you are now …` 等）/ 不可視 Unicode（zero-width / bidi override / tag chars / 制御文字）が紛れ込むと、`feedback.json` を読み込む後段 LLM のコンテキストで意図しない権限上書きを誘発し得る。

[oubakiou/skills の guarded-webfetch-codex の sanitize.ts](https://github.com/oubakiou/skills/blob/main/skills/guarded-webfetch-codex/scripts/sanitize.ts) を参考に、次のサニタイズロジックを `src/core/sanitize.ts` として導入する：

- **Unicode 層**：NFKC 正規化 + tag chars (U+E0000–U+E007F) / zero-width (U+200B–U+200F, U+2060, U+FEFF) / bidi override (U+202A–U+202E, U+2066–U+2069) / 制御文字を除去
- **LLM マーカー層**：上記 sigil / ロールタグ / 行頭ロール宣言 / instruction override 表現を `[FILTERED:<category>]` プレースホルダに置換（カテゴリ: `chat_template` / `role_declaration` / `instruction_override`）
- **再帰防御**：入力に既に含まれる `[FILTERED` / `[ESCAPED:` パターンを `[ESCAPED:` でラップしてから置換し、攻撃者がプレースホルダ自体を偽装する再帰注入を塞ぐ
- **検出フラグの返却**：`suspicious_patterns`（カテゴリ別件数）/ `had_invisible_chars` / `truncated`（入力サイズ上限を超えた場合）を構造化して返す。攻撃文言そのものは件数だけに正規化し、生文字列を上位ロジックに渡さない

統合ポイント：

- **boot（埋め込み markdown 読み込み）**: sanitize を通し、結果を `state.markdown` にセット。`flags.suspicious_patterns` のカテゴリ別件数 + `had_invisible_chars` をステータスバー / toast に表示し、レビュワーに「injection 風パターンを N 件中和した」旨を可視化
- **review-export（feedback.json 抽出）**: `quote` / `comment` 抽出時にも sanitize を通し、後段 LLM に渡る経路で injection が伝播するのを構造的に防ぐ
- **review-request CLI**: CLI 経由で配布 HTML を生成する段で markdown をサニタイズしてから embed（既定 ON）。技術文書として原文の sigil をそのまま表示したいケースのために `--raw-markdown` で opt-out 可能とし、その場合は HTML 側 `data-safe-markdown="off"` 属性を立て、ブラウザ起動時にステータスバーへ「Safe markdown OFF」を恒常表示する

トレードオフ：サニタイズはレビュー対象の原文を改変するため、LLM チャットテンプレートの解説記事や ChatML 仕様書のように **意図的に sigil 文字列を含む技術文書** は `[FILTERED:chat_template]` 置換で読みづらくなる。Safe markdown OFF で原文維持に切り替えられるが、その場合は feedback.json への伝播経路が再び開くため、後段 LLM パイプラインを持つユーザーが意識的に判断する必要がある

## その他の候補

- **型境界の共有強化**：外部 JSON ガード（feedback）と各 UI モジュールのローカル DOM 型を保ちつつ、将来は共通型の重複を減らす
- **差分ビュー**：連続する `<name>-<hash>-review.html` バージョン間の変更を表示
- **ネイティブなファイル変更通知**：オプションの CLI コンパニオン（30 行程度の Node WebSocket サーバーなど）で重ワークフロー時のサブ秒応答
- **review-request CLI のブラウザ起動チェーンを Linux でフルセットまで伸ばす**：現状のブラウザ起動は `$BROWSER` → `xdg-open` の 2 段までで、主要 desktop 環境ではこれで通る前提。`gh` CLI 相当の `$BROWSER` → `xdg-open` → `wslview` (WSL) → `sensible-browser` → `x-www-browser` のフルチェーンに拡張すると、最小 Linux イメージや Debian/Ubuntu の特殊構成でも `xdg-open` 欠落時にフォールバックでブラウザが立ち上がる。各候補の存在判定（PATH 探索）と起動成否の判定を分けて実装する必要があり、検証コスト・テストマトリクスが増えるため現状は採用していない
