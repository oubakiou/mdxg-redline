import type { CliMessageKey } from './messages-cli.en'

export const messagesCliJa = {
  'cli.clean.deleted_summary': '{dir} 内の {count} 個のファイルを削除しました。',
  'cli.clean.dry_run_header': '[dry-run] {dir} 内の以下 {count} 個のファイルを削除します:',
  'cli.clean.kept_header': '--keep に一致する以下 {count} 個のファイルを温存します:',
  'cli.clean.kept_summary': '--keep に一致する {count} 個のファイルを温存しました。',
  'cli.clean.no_files_found': '{dir} 内にレビュー / フィードバック成果物は見つかりませんでした。',
  'cli.clean.run_with_yes_hint': '実削除には --yes を付けて再実行してください。',
  'cli.error.asset_missing':
    '{path} が見つかりません。先に `npm run build` を実行して {target} を生成してください。',
  'cli.error.browser_launch_failed':
    'review-request: ブラウザを起動できませんでした ({command}: {message})。上記のパスを手動で開いてください。',
  'cli.error.clean_specified_multiple':
    '{flag}: 複数回指定されています (誤って別ディレクトリを削除する事故を避けるため 1 回のみ指定可能)',
  'cli.error.invalid_arguments':
    'mdxg-redline: 引数が不正です: {detail}。`mdxg-redline --help` で使い方を確認してください。',
  'cli.error.invalid_arguments_no_detail':
    'mdxg-redline: 引数が不正です。`mdxg-redline --help` で使い方を確認してください。',
  'cli.error.invalid_flag_value': "{flag}: 不正な値 '{token}' (期待値: {expected})",
  'cli.error.invalid_lang': '--lang は auto / en / ja のいずれかを指定してください',
  'cli.error.missing_flag_value': '{flag}: 値が指定されていません (期待値: {expected})',
  'cli.error.missing_input_markdown':
    '入力 markdown が指定されていません (期待形式: <input.md|-> [output-dir])',
  'cli.error.too_many_positional_args':
    '位置引数が多すぎます: {count} 個 (最大 2 個まで: <input.md|-> [output-dir])',
  'cli.error.unexpected': 'review-request: 想定外のエラー: {message}',
  'cli.error.unknown_option': '不明なオプション: {token}',
  'cli.feedback_hash_mismatch':
    '({path} の再開をスキップ: docHash が一致しません — 実際 {got}, 期待 {expected})',
  'cli.feedback_invalid_json': '({path} の再開をスキップ: JSON が不正です)',
  'cli.feedback_read_failed': '({path} の再開をスキップ: 読み取り失敗 {code})',
  'cli.feedback_resumed': '{path} から {count} 件のコメントを復元しました。',
  'cli.help.arguments_block': `引数:
  <input.md>             markdown ファイルのパス。\`-\` を指定すると標準入力から読み込み。
  [output-dir]           出力ディレクトリ。省略時は入力ファイルと同じディレクトリ
                         (標準入力の場合はカレントディレクトリ)。出力ファイル名は
                         <mdFileName>-<docHash>-review.html の形式で自動決定。`,
  'cli.help.cleanup_block': `クリーンアップモード:
  --clean [dir]          <dir> 直下の *-<docHash>-review.html と
                         *-<docHash>-feedback.json をすべて削除。<dir> を省略
                         するとカレントディレクトリ。既定は dry-run で削除候補を
                         表示するのみ。実削除には --yes を指定。
  --yes                  --clean と併用して実削除を行う (確認なし)。未指定時は
                         dry-run。
  --keep <docHash>       --clean と併用して、16 桁 hex の docHash が一致する
                         ファイルを温存する (繰り返し指定可)。
  -r, --recursive        --clean と併用してサブディレクトリも再帰的に対象に
                         する (既定: 直下のみ)。`,
  'cli.help.description':
    'markdown を埋め込んだレビュー依頼用 HTML を生成し、標準ブラウザで開きます。',
  'cli.help.examples_block': `例:
  mdxg-redline spec.md
  mdxg-redline spec.md ./reviews
  mdxg-redline --no-open spec.md
  mdxg-redline --theme dark spec.md
  cat spec.md | mdxg-redline - --document-name spec.md
  mdxg-redline --clean
  mdxg-redline --clean ./reviews
  mdxg-redline --clean ./reviews --yes
  mdxg-redline --clean ./reviews --keep a1b2c3d4e5f6a7b8 --yes
  mdxg-redline --clean ./reviews --recursive --yes`,
  'cli.help.options_block': `オプション:
  --document-name <name> data-name 属性と出力ファイル名 prefix に使うドキュメント
                         名を上書き。標準入力時に意味のあるファイル名を付けたい
                         場合に推奨。
  --theme <value>        生成 HTML の初期テーマヒント。system | light | dark の
                         いずれか。<html data-theme> 属性として書き込まれ、
                         viewer の localStorage に対しリロード時に毎回優先される
                         (CLI ヒントが初回 paint で必ず勝つ。UI toggle 操作は
                         現在のセッション内でのみ上書きでき、リロード時には CLI
                         ヒントが再適用される)。省略時は属性ごと付与しない。
  --shiki-langs <value>  シンタックスハイライト用に HTML に埋め込む Shiki grammar
                         を選択する。以下のいずれか:
                           auto  入力 markdown を走査し、フェンスブロックで使われ
                                 ている grammar のみを埋め込む (既定)。
                           all   Shiki 同梱の全 grammar を埋め込む (最大、
                                 約 235 言語、約 5.5 MB gzipped)。
                           none  grammar を一切埋め込まない (全コードブロックは
                                 plain text として描画)。
                           <csv> 言語識別子のカンマ区切り (例: ts,js,py)。エイリ
                                 アスは正規名に正規化、未対応の識別子は黙って
                                 無視される。
  --comments-width <px>   生成 HTML のコメントパネル初期幅ヒント。以下のいずれか:
                           0         コメントパネルを閉じた状態で開始 (ユーザーが
                                     開くまでエッジタブのみ表示)。
                           280–640   指定 px 幅で開いた状態で開始。
                         <html data-comments-width> 属性として書き込まれ、viewer
                         の localStorage に対しリロード時に毎回優先される (UI
                         ドラッグ / toggle タブクリックは現在のセッション内での
                         み上書きでき、リロード時には CLI ヒントが再適用される)。
                         省略時は属性ごと付与しない。
  --page-nav-width <px>  ドキュメントページパネル (左 TOC) の初期幅ヒント。以下
                         のいずれか:
                           0         パネルを閉じた状態で開始 (左エッジタブのみ
                                     表示)。
                           180–480   指定 px 幅で開いた状態で開始。
                         <html data-page-nav-width> 属性として書き込まれ、
                         --comments-width と同じ優先順位ルールに従う。
  --mermaid <value>      \`\`\`mermaid ブロックに対する Mermaid ランタイム注入の制御。
                         以下のいずれか:
                           auto  markdown に \`\`\`mermaid ブロックが 1 つ以上ある
                                 場合のみ注入 (既定)。使用していない場合の配布
                                 サイズを最小に保つ。
                           on    常に注入。配布 HTML に約 700 KB gzipped を追加。
                           off   注入しない。\`\`\`mermaid ブロックは Shiki ハイライ
                                 トされたコードブロックに fallback (MDXG §15 [MUST])。
  --math <value>         $...$ / $$...$$ 数式 (MDXG §14) に対する KaTeX ランタイム
                         注入の制御。以下のいずれか:
                           auto  markdown に数式が 1 つ以上ある場合のみ注入
                                 (既定)。
                           on    常に注入。--math-fonts に応じて約 250 / 約 350 KB
                                 gzipped 追加。
                           off   注入しない。$...$ / $$...$$ は raw markdown
                                 テキストとして描画 (MDXG §14 [MUST])。
  --math-fonts <value>   data URI として埋め込む KaTeX woff2 フォントセットを選択
                         (KaTeX 注入時のみ意味あり)。以下のいずれか:
                           minimal  Main / AMS / Math / Size1-4 のみ、約 110 KB
                                    gzipped 追加 (既定)。\\mathcal / \\mathfrak /
                                    \\mathscr / SansSerif / Typewriter はホスト
                                    のシステムフォントに fallback。
                           all      全 20 woff2 ファミリを埋め込み、約 220 KB
                                    gzipped 追加。文書が稀な数式グリフ
                                    (\\mathcal{X}, \\mathfrak{X}, ...) に依存する
                                    場合に使用。
  --markdown-css <path>  本文プレビュー用の同梱 CSS を <path> のファイルで差し替
                         える。markdown プレビュー (#doc スコープ) のみが対象で、
                         レイアウト / chrome (review.css) は変更されない。カスタム
                         タイポグラフィテーマで review HTML を配布したい場合に
                         有用。
  --lang <value>         CLI の help / エラーメッセージの出力言語を指定する。
                         auto (env $LC_ALL > $LC_MESSAGES > $LANG から推定、
                         既定) / en / ja のいずれか。CLI 出力にのみ作用し、
                         生成 HTML の表示言語はブラウザ環境 (localStorage /
                         navigator.language) で独立に決定される (CLI ヒントは
                         埋め込まれない)。--shiki-langs / --mermaid / --math と
                         異なり、ここでの "auto" は markdown 本文の走査ではなく
                         env からの推定を意味する。
  --no-open              HTML を生成するがブラウザは起動しない。
  --show-open-file       生成 HTML の Open ▾ メニューに "Open file" 項目を表示
                         したままにする。既定 (本フラグなし) では、誤って別の
                         markdown を読み込んで現在のコメントを破棄する事故を防ぐ
                         ため、CLI 出力は本項目を非表示にする。standalone HTML —
                         CLI を経由せずに直接開いた場合 — は常に本項目を表示。
  --show-paste-markdown  生成 HTML の Open ▾ メニューに "Paste markdown" 項目を
                         表示したままにする。既定 (本フラグなし) では、--show-
                         open-file と同じ理由で CLI 出力は本項目を非表示にする
                         (paste も現在の markdown を上書きしてコメントを破棄する
                         ため)。standalone HTML は常に本項目を表示。
  -h, --help             このヘルプを表示して終了。指定時は他のすべての引数 /
                         フラグより優先される。`,
  'cli.help.usage': '使い方: mdxg-redline [options] <input.md|-> [output-dir]',
  'cli.katex_escaped_script': '(KaTeX ランタイム内の生の </script> {count} 件をエスケープしました)',
  'cli.katex_injection':
    '{count} 件の数式を検出。KaTeX ランタイムを埋め込みます (fonts={mode}, {size} gzipped)。',
  'cli.mermaid_escaped_script':
    '(mermaid ランタイム内の生の </script> {count} 件をエスケープしました)',
  'cli.mermaid_injection':
    '{count} 件の mermaid ブロックを検出。mermaid ランタイムを埋め込みます (+~700 KB gzipped)。',
  'cli.port_in_use_fallback':
    'review-request: ポート {preferred} が使用中のため {random} を使います。{var} でデフォルトを上書きできます。今回はブラウザ側 IndexedDB のサイレント復元 (Write feedback.json の保存先記憶) が効かない可能性があります。',
  'cli.port_invalid':
    'review-request: {var}="{value}" は有効なポート番号ではないため {default} を使います。',
  'cli.serve_address_failed': 'HTTP サーバーのアドレス取得に失敗しました。',
  'cli.serve_remote_started':
    'review-request: VS Code Remote 環境を検知。HTTP サーバーを {url} で起動しました。初回アクセス後 {seconds1} 秒、リクエストが無ければ {seconds2} 秒で自動停止します。',
} as const satisfies Record<CliMessageKey, string>
