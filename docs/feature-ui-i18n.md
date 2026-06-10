# UI 国際化（英語 / 日本語切替）設計・実装計画

[![MKDN](https://img.shields.io/badge/MKDN-review-red?style=for-the-badge)](https://mkdn.review/?url=https%3A%2F%2Fraw.githubusercontent.com%2Foubakiou%2Fmdxg-redline%2Frefs%2Fheads%2Fmain%2Fdocs%2Ffeature-ui-i18n.md#p:page-1)

DESIGN.md に **§14 UI 国際化**（新設）を追加し、CLI 出力と review HTML の両方で英語 / 日本語の UI を切替可能にするための設計判断と実装手順をまとめる。完了時点で本ドキュメントは DESIGN.md §14 に統合され、本ファイル自体は `docs/archive/feature-ui-i18n.archive.md` にリネームしてアーカイブされる想定。

背景: `docs/archive/mdxg-virtual-pages.archive.md:360-365` で「i18n しない（toolbar / modal 等すべて英語）」と過去に明示的に決めた経緯がある。本プランはその決定を上書きする（理由は §5.i）。

## 1. 対応スコープ

| 要件                                                                                                         | 現状                                                                            | 完了条件                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [MUST] CLI が `--lang <en\|ja\|auto>` で CLI 自体の出力言語を指定可能                                        | 未                                                                              | `--help` / stderr 出力が指定言語で表示される。`auto` 時に `$LC_ALL` / `$LC_MESSAGES` / `$LANG` から推定。HTML 側には影響しない |
| [MUST] review HTML がランタイムで toggle 切替可能                                                            | 未                                                                              | toolbar に EN/JA toggle を追加、`<html lang>` 同期、`localStorage('mdxg-redline.lang')` に永続化                               |
| [MUST] review HTML (CLI 生成 / online 共通) で `localStorage > navigator.language > 'en'` の順で初期言語決定 | 未                                                                              | 初回起動時に `ja-*` ロケールのブラウザで日本語表示、それ以外は英語。CLI 経由生成版も同じ規則                                   |
| [MUST] review HTML UI 全文言が両言語の辞書を持つ                                                             | 未 (全英語、一部日本語混在)                                                     | toolbar / menu / panel / modal / toast / aria-label / placeholder のすべてが `translate()` 経由                                |
| [MUST] CLI help / stderr メッセージが両言語の辞書を持つ                                                      | 未 (全英語)                                                                     | `src/cli/help-text.ts` / `src/cli/error-message.ts` の生成関数が `lang` 引数を受け取り、両言語の出力を返す                     |
| [MUST] 既存の日本語混在を辞書に正規化                                                                        | 部分 (`review.html:389,393` + `boot.ts:130-155` の `formatFetchFailureMessage`) | URL 読み込み失敗 empty state と fetch エラーメッセージを `empty.url_failed.*` キーに集約し、両言語に正規化                     |
| [SHOULD] `<html lang>` 属性が現在表示言語と同期                                                              | 部分 (固定 `lang="ja"`)                                                         | toggle / 初期決定後に `<html lang>` を `en` / `ja` に書き換える。AT 読み上げと CJK フォント描画品質に追従                      |
| [SHOULD] DESIGN.md / README に新方針を追記                                                                   | 未                                                                              | DESIGN.md §14 を新設、`README.md` / `README_ja.md` CLI オプション表に `--lang` 行を追加                                        |

追加実装（UX 上有用だが規格制約はない）:

- toolbar の EN/JA toggle はテーマ toggle と同じ UI パターンで提供する（`aria-label` + `data-tooltip` 付き、3 state ではなく 2 state 単純切替）
- toggle 時に DOM 再構築せず、`textContent` / `aria-label` / `placeholder` のみ更新（コメントの選択状態 / 検索ハイライト / Shiki 描画結果を保持）

スコープ外（別タスクで扱う / 意図的に割り切る）:

- CLI のサブコマンド名・フラグ名（`--clean`, `--lang` 等）の i18n: フラグはマシン契約として英語固定
- ユーザー入力テキスト（コメント本文 / markdown 本体）の自動翻訳: 表示は raw のまま
- 第 3 言語の追加: 本プランは en / ja の 2 言語のみ。辞書ファイル追加だけで拡張できる構造を担保。**対応言語数が 3 以上に増えた段階で、(a) 現状の「全言語を HTML に常時 inline」方式は配布物サイズを線形に押し上げるため Shiki grammar / Mermaid runtime 等の他アセットと同様に「必要な言語だけ後から fetch する」方式（lazy load や別ファイル分割）への移行を検討、(b) `nextStoredLang` の 2 state 循環ロジックを `const order: readonly Lang[]` を回す N state 循環に書き換える、(c) toolbar EN/JA toggle UI を 2 state ボタンから dropdown 等に変更、の 3 点をまとめて対応する。本プランのスコープでは 2 言語のみのため inline + 2 state toggle を採用**
- 翻訳サービス連携 (DeepL / GPT 等): 静的辞書のみ
- `$LANGUAGE` / glibc `setlocale` 等 `$LANG` / `$LC_ALL` 以外の env: 過剰
- 数値 / 日付 / 通貨フォーマットの locale 化: 本ツール内で出力する数値（コメント件数）は単一形のみ
- **markdown 本文 (`#doc` 配下) の AT 読み上げ言語独立**: `<html lang>` は UI (chrome) 言語と同期するため、本文の AT 読み上げ言語も継承される。本文の真の言語に合わせて独立 lang 属性を付与する仕組み (frontmatter / 自動判定 / `--doc-lang` 等) は本プランの対象外。レビュワーが視覚で markdown を読むユースケースが主のため、AT 読み上げの精度劣化は許容範囲と判断 (§5.f)

## 2. ベースラインアーキテクチャ

参考になる i18n 実装はリファレンス側（`vercel-labs/mdxg`）にも存在しないため、リファレンス比較表は割愛し、本実装制約から逆算した骨格を直接記述する。

本実装の制約:

- **単一 HTML 配布**: CDN 取得不可。両言語の辞書をビルド時に必ず inline する
- **ICU 系ライブラリ非導入**: 翻訳対象は約 195 entry（Step 1.5 + 再 Step 1.5 で確定）。`i18next` / `intl-messageformat` 等はサイズ・依存とも過剰
- **既存 DOM のハードコード文言を段階的に辞書化**: `data-i18n` 属性ベースで markup と key を結合し、CSS / 既存挙動（コメントアンカリング / 検索 / Shiki upgrade）に干渉しない
- **`<html lang>` 同期**: AT 読み上げと CJK フォント描画品質、`hyphenate-character` 等の CSS hint に効くため、表示中の lang と一致させる

選択した骨格:

1. **辞書**: `src/app/i18n/messages.en.ts` / `messages.ja.ts` — 素朴な `{ [key]: string }` object
2. **helper**: 3 ファイル分割 — `src/app/i18n/i18n-core.ts` (純粋ロジック、Node/ブラウザ共通) / `src/app/i18n/i18n-browser.ts` (ブラウザ副作用: `setLang` / `applyI18nDataset` / localStorage) / `src/cli/i18n.ts` (CLI state のみ、document/localStorage 非依存)
3. **DOM 連携**: `data-i18n` / `data-i18n-aria-label` / `data-i18n-placeholder` / `data-i18n-title` dataset 属性で markup と key を結合
4. **lang state**: モジュールローカル + `<html lang>` 同期 + listener で動的生成済み要素を再描画
5. **CLI 連携**: `--lang` フラグ + `$LC_ALL` / `$LC_MESSAGES` / `$LANG` env fallback は **CLI 自体の help / stderr 出力にのみ作用**。生成 HTML の初期言語には影響を与えず、HTML 側は localStorage / navigator.language で独立に決定する（CLI と HTML の責務分離、§5.a / §5.b）

## 3. 設計の中核要素

### 3.1 翻訳辞書とランタイム

文言の総数は **約 195 entry**（Step 1.5 + 9 回のセルフレビューを経て確定。実数 191。UI 辞書 155 + CLI 辞書 36）。**辞書は UI 用と CLI 用で物理分割**（セルフレビュー反映: 動的キーアクセスで tree-shake できない単一辞書の問題と、online 版が standalone から派生する点を解消）:

| ファイル                          | 内容                                                                                                               | inline 先                                               | entry 数 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | -------- |
| `src/app/i18n/messages.en.ts`     | UI 辞書 en (toolbar / comments / modal / toast / empty / page_nav / search / dialog / diagram / online / footnote) | standalone / embed-template / online（standalone 派生） | 155      |
| `src/app/i18n/messages.ja.ts`     | UI 辞書 ja（`satisfies Record<MessageKey, string>` で en と key 一致を tsc レベル保証）                            | 同上                                                    | 155      |
| `src/cli/i18n/messages-cli.en.ts` | CLI 辞書 en (`cli.*` のみ。help は block 形式)                                                                     | CLI bundle (`dist/review-request.mjs`) のみ             | 36       |
| `src/cli/i18n/messages-cli.ja.ts` | CLI 辞書 ja（`satisfies Record<CliMessageKey, string>`）                                                           | 同上                                                    | 36       |

**実装モジュールも責務で 3 分割**（セルフレビュー反映: Node 環境で `document` / `localStorage` を触る関数が失敗する問題を解消）:

| ファイル                       | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 環境                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `src/app/i18n/i18n-core.ts`    | **純粋ロジック**: `translate(dict, key, params?)` / `translatePlural(dict, { baseKey, count, params? })` / `detectLangFromEnv` / `detectLangFromNavigator` / `resolveInitialLang`。辞書は `MessageDict = Readonly<Record<string, string>>` で受ける (generic K を取らず `as K` unsafe assertion を回避)                                                                                                                                                                                                             | Node / ブラウザ共通 |
| `src/app/i18n/i18n-browser.ts` | **ブラウザ副作用**: `setLang(lang)` / `getLang()` / `initLangFromBrowser()` (bootstrap で state 確定 + `<html lang>` 再同期。head script の fallback で lang="en" に戻されたケースに備える) / `subscribeLangChange(listener)` / `applyI18nDataset(root)` (CSS custom property `--ui-loading-text` 等の setProperty も含む) / `readStoredLang()` / `writeStoredLang(value)` / `nextStoredLang(current)`。内部で `<html lang>` / `localStorage` / `document` を操作。i18n-core を import して `translate` を再 export | ブラウザのみ        |
| `src/cli/i18n.ts`              | **CLI state**: `setCliLang(lang)` / `getCliLang()` / `translateCli(key, params?)`。module-local state を更新するのみで `document` / `localStorage` には触らない。i18n-core を import                                                                                                                                                                                                                                                                                                                                | Node のみ           |

`MessageKey` / `CliMessageKey` 型はそれぞれの辞書ファイルから `keyof typeof ...` で導出。`PluralBaseKey` 型は UI 辞書側にのみ存在。

| その他                              | 内容                                                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| `<html lang>`                       | 現在表示言語に同期（AT / フォント / CSS hint 用）、ランタイム書き換え              |
| `localStorage('mdxg-redline.lang')` | ユーザーが toggle で選んだ言語の永続化（`'en'` / `'ja'`）、ブラウザ                |
| `<html class="i18n-pending">`       | head script 段階で付与され、`applyI18nDataset` 完了後に解除。FOUC 回避用 (§Step 5) |

既存実装で既に定数化済みの文言（`src/app/chrome/toolbar.ts:120-130` の `THEME_LABEL` / `THEME_ICON` / `THEME_TOOLTIP_NEXT`）は辞書化しやすく、最小限の置換で対応できる。

**辞書 inline と CLI-HTML 責務分離の両立**: CLI は HTML への `<html data-lang-init>` 等の **属性ヒンティングを一切埋め込まない**（§5.a）。辞書も物理分割しているため、CLI bundle と HTML bundle で重複 inline はない。online 版は standalone HTML を派生して生成するため、辞書は standalone に既に inline 済みで **online 版での辞書再 inject は不要**。「CLI は HTML の言語決定ロジックに介入しない / 辞書の搬送経路も触らない」という分担を明示する。

**localStorage key の命名規約**: `'mdxg-redline.<feature>'` prefix で揃える（既存 `'mdxg-redline.theme'`、本実装 `'mdxg-redline.lang'`）。他に `'mdxg-redline.comments-width'` / `'mdxg-redline.page-nav-width'` 等が `<head>` inline script で読まれる（`review.html:38-115` 周辺）。本実装は既存規約に従い key 衝突を避ける。

### 3.2 言語決定の優先順位

CLI 自体と review HTML を別経路として扱い、互いに影響しない（責務分離、§5.a）。

| 経路                                                                  | 優先順位                                                                                                                                                               |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI 自体 (help / stderr)                                              | `--lang` フラグ (en/ja のみ採用、不正値はスキップ) > `$LC_ALL` > `$LC_MESSAGES` > `$LANG` > `'en'`。実装は **二段階解析**（先行抽出 → 通常解析、§3.3）で循環依存を回避 |
| review HTML 起動時（CLI 生成 standalone / online (mkdn.review) 共通） | `localStorage('mdxg-redline.lang')` > `navigator.language` > `'en'`                                                                                                    |
| 起動後の toggle                                                       | toggle で `setLang(lang)`、`localStorage` に保存（次回起動時の最優先）                                                                                                 |

env → lang のマッピング（CLI 自体にのみ適用、POSIX 階層 `$LC_ALL > $LC_MESSAGES > $LANG` で評価）:

各 env 値に対する判定:

| 入力                                                              | 扱い                                                                                                     |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `undefined` / 空文字 (`""`)                                       | **未設定として skip**（POSIX 通り、次の階層 env に fallback）。例: `LC_ALL=""` なら `LC_MESSAGES` を見る |
| `ja`, `ja_JP`, `ja_JP.UTF-8`, `ja-JP` 等の正規表現 `^ja(_\|-\|$)` | `ja` で確定（後段は見ない）                                                                              |
| `en_US.UTF-8` / `C` / `POSIX` / その他                            | `en` で確定（後段は見ない）                                                                              |

階層全てが未設定 / 空文字の場合は最終 fallback として `'en'` を返す。

例:

- `LC_ALL="" LC_MESSAGES=ja_JP.UTF-8 LANG=en_US.UTF-8` → `LC_ALL` 空 skip → `LC_MESSAGES=ja_JP.UTF-8` → `'ja'`
- `LC_ALL=C LANG=ja_JP.UTF-8` → `LC_ALL=C` → `'en'` (後段の `LANG=ja` は見ない、POSIX の override セマンティクス通り)
- `LC_MESSAGES=ja_JP.UTF-8` (他は未設定) → `'ja'`

navigator.language → lang のマッピング:

| 入力                    | lang |
| ----------------------- | ---- |
| `ja` / `ja-JP` / `ja-*` | `ja` |
| 上記以外                | `en` |

### 3.3 CLI オプション

CLI に `--lang` を導入する。**サブパーサ非依存のグローバル メタフラグ**として扱い、`arg-spec.ts` (run parser) と `parse-clean-args.ts` の `CLEAN_FLAG_TABLE` のどちらにも追加しない。代わりに bootstrap の `extractLang` で lang 抽出 + argv strip + エラー検出を 1 パスで行い、サブパーサは `--lang` の存在を知らずに動く（Step 4 参照）。**作用範囲は CLI 自体の help / stderr 出力に限定し、生成 HTML の初期言語には一切影響を与えない**（責務分離、§5.a）。受け付ける値:

| 値             | 挙動                                                                         |
| -------------- | ---------------------------------------------------------------------------- |
| `auto`（既定） | `$LC_ALL` / `$LC_MESSAGES` / `$LANG` から推定。env も空なら `en` で CLI 出力 |
| `en`           | CLI の help / stderr を英語で出力                                            |
| `ja`           | CLI の help / stderr を日本語で出力                                          |

不正値（`fr` 等）の扱いには **二段階解析** が必要（セルフレビュー反映）。理由: エラーメッセージを「現在の lang で表示」するには、その時点で lang が確定している必要があるが、通常の引数解析中に不正値を検出する時点では lang 未確定で循環依存になる。

二段階解析の流れ:

1. **`extractLang(argv, env)`**: raw argv (`process.argv.slice(2)`) を 1 パスで走査し、`{ lang, argv, error }` を返す。lang 確定 / `--lang` 関連 token 除去 / 不正値 / 値欠落のエラー情報をすべて単一関数で扱う（**`--lang` は run / clean のどちらのドメインにも属さないグローバル メタフラグ**として扱い、サブパーサに漏らさない）。次トークンが `--` で始まる場合は既存 flag-parser.ts:248 (`token.startsWith('--')`) と同じ判定で **missing value** とし、次トークンを消費せず保持する。不正値（`fr` / `spec.md` 等）は 2 トークン消費 + **invalid_value** エラーを記録（silent に入力ファイル扱いされる事故を回避）
2. **main() 側の優先順序**: 戻り値を使って (a) `argv.some(t => HELP_FLAGS.has(t))` で **help を最優先** (既存契約 `parse-args.ts:29-35` を維持) → (b) `error !== null` なら `translateCli('cli.error.invalid_lang' | 'cli.error.missing_flag_value', ...)` で reject → (c) 通常モード判定 (`parseArgs` / `parseCleanArgs`) の順で処理。`--lang fr --help` のように lang エラーと help が同時にある場合は help が勝つ。`--lang fr` のような不正値は (b) で **先行抽出で決まった lang** (env fallback or 後勝ちで残った有効値) を使って translateCli が文言生成

```ts
type LangExtractError = { kind: 'invalid_value'; token: string } | { kind: 'missing_value' }

interface LangExtractResult {
  lang: Lang
  argv: string[]
  error: LangExtractError | null
}

// 単一トラバーサルで lang 抽出 + argv strip + エラー検出。後勝ち (=既存値フラグ
// --theme / --shiki-langs の重複時挙動と整合、flag-parser.ts:150-178)。
// 注: `--lang=ja` の `=` 区切り形式は flag-parser.ts:228-256 の pending pattern が
// space 区切り only のため非対応で揃える。
function extractLang(rawArgv: readonly string[], env: NodeJS.ProcessEnv): LangExtractResult {
  let lang: Lang | null = null
  let error: LangExtractError | null = null
  const out: string[] = []

  for (let i = 0; i < rawArgv.length; i++) {
    if (rawArgv[i] !== '--lang') {
      out.push(rawArgv[i])
      continue
    }
    const next = rawArgv[i + 1]
    if (next === undefined || next.startsWith('--') || HELP_FLAGS.has(next)) {
      // 値欠落: `--lang` だけ除去、next (= 別フラグ or undefined) は out に残す。
      // 既存 flag-parser.ts:248 の `--` prefix 判定をベースに、help 最優先契約
      // (parse-args.ts:35) を破らないよう `HELP_FLAGS.has(next)` (= `-h` / `--help`)
      // も値欠落条件に加える。これにより `--lang --clean` の `--clean`、
      // `--lang --help` の `--help`、`--lang -h` の `-h` が argv から消えず、
      // main() の help チェックが lang error reject より先に通る構造的保証になる。
      // 後勝ちで上書きされる可能性があるため continue でループ続行。
      error = { kind: 'missing_value' }
      continue
    }
    // 値あり: 2 トークン消費。`--lang spec.md` のような入力ファイル風 token も
    // ここで `invalid_value` として明示エラーにする (silent に入力ファイル扱いされる事故回避)。
    if (next === 'en' || next === 'ja') {
      lang = next
      error = null
    } else if (next === 'auto') {
      lang = detectLangFromEnv(env)
      error = null
    } else {
      error = { kind: 'invalid_value', token: next }
      // lang は更新しない (前回の有効値 or 最終的に env fallback を使う)
    }
    i += 1
  }

  if (lang === null) lang = detectLangFromEnv(env)
  return { lang, argv: out, error }
}
```

生成 HTML 側は `--lang` を一切受け取らず、`localStorage` / `navigator.language` で初期言語を独立に決定する（§3.2）。レビュー依頼者がレビュワーの表示言語を CLI 側からヒンティングする経路は提供しない（§5.a の設計判断）。

### 3.4 翻訳キー命名規約

名前空間で **12 グループ** に整理する（再 Step 1.5 + 9 回のセルフレビュー + footnote backref aria 対応で確定、総数 ~195 entry / 実数 191）:

| prefix       | 対象                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `toolbar.*`  | `open`, `open_file`, `open_url`, `open_menu_tooltip`, `paste_markdown`, `search_{aria,tooltip,placeholder,bar_aria,input_aria}`, `search_{prev,next,close}_{aria,tooltip}`, `kbd_help_{aria,tooltip}`, `theme_{system,light,dark}_aria`, `theme_switch_{light,dark,system}`, `lang_toggle_{aria,tooltip}`, `skip_to_navigation`, `status_{no_file,written}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `comments.*` | `empty`, `count_label_{zero,one,other}`, `copy`, `export`, `discard`, `write_feedback`, `write_feedback_tooltip_{default,pending,folder}`, `write_feedback_menu_aria`, `change_output_folder`, `toggle_panel_aria`, `floater_label`, `resize_aria`, `action_{edit,delete}_{,aria}`, `edit_label`, `save_button`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `modal.*`    | `comment_{selected_text,label,placeholder,cancel,save,edit_aria,delete_aria}`, `paste_markdown_{title,name_label,name_placeholder,body_label,body_placeholder,cancel,submit,empty_error,load_failed}`, `open_url_{title,label,placeholder,help_lead,cancel,submit}`, `kbd_help_{title,close,desc_*}`, `mermaid_{title,zoom_hint,zoom_in_aria,zoom_out_aria,close}`, `code_{copy,copied,copy_aria}`, `confirm_delete_comments_{one,other}`, `confirm_warn`, `hint_{cancel,close}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `toast.*`    | `exported`, `copied`, `copied_with_count`, `comment_{deleted,updated,added}`, `comments_discarded`, `nothing_to_{export,copy,write,clear}`, `copy_failed`, `copy_failed_with_hint`, `write_failed`, `feedback_written`, `output_folder_set`, `render_failed_{one,other}`, `startup_failed`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `empty.*`    | `no_file_{title,description}`, `url_failed_{title,button}`, `url_failed_{http_error,network,validation,redirect,size,timeout,content_type,unknown}`（`boot.ts:130-155` 由来）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `page_nav.*` | `section_aria`, `title`, `resize_aria`, `toggle_panel_aria`, `prev_button`, `next_button`, `sequential_nav_aria`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `search.*`   | `no_results`, `count_{one,other}`, `current_match`（`core/search.ts` 由来。文言は `{total} matches` / `{current} of {total}` 等）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `dialog.*`   | `ok`, `cancel`（`src/app/dom/dialog.ts` の汎用 dialog 用）, `fs_access_unsupported_{title,body}`（`src/app/workspace/workspace-fs.ts:114` の File System Access API 非対応案内）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `diagram.*`  | `expand_aria`（`renderers/mermaid-svg-interactions.ts` 由来）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `online.*`   | `error.empty_url_input`, `help.url_rewritten`, `label.source`（`src/app/online/*.ts` 由来。online 版専用の URL 入力フォーム / 出典表示）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `footnote.*` | `backref_aria`（`{label}` placeholder。`src/core/footnotes.ts:139` の orphan path と marked-footnote 1.4.0 default backref が生成する `<a data-footnote-backref aria-label="Back to reference {label}">↩</a>` の aria-label を辞書化。textContent (`↩`) は不変で、`[data-footnote-backref]` は既に `src/app/dom/text-segment-skip-rules.ts:44` のアンカリング skip 対象のため §3.5 doc-pane data-i18n 禁止ルールの構造的例外として安全。sr-only `<h2 id="footnote-label">Footnotes</h2>` heading textContent はアンカリング textContent 列に入るため本プランでは英語固定 — 将来 skip rule 追加と組み合わせて対応）                                                                                                                                                                                                                                                                                                                                                                 |
| `cli.*`      | `help.{usage,description,arguments_block,options_block,cleanup_block,examples_block}`（block 形式でセクション全体を 1 key に格納、Step 4 で `translateCli` 呼び出し。`--lang` は他オプションと同じ列 `options_block` 内に統合）, `error.{invalid_arguments,invalid_arguments_no_detail,invalid_lang,invalid_flag_value,missing_flag_value,unknown_option,missing_input_markdown,too_many_positional_args,clean_specified_multiple,browser_launch_failed,asset_missing,unexpected}`, `clean.{no_files_found,dry_run_header,kept_header,run_with_yes_hint,deleted_summary,kept_summary}` (`--clean` の dry-run / 実削除 stdout), `katex_{injection,escaped_script}`, `mermaid_{injection,escaped_script}`, `feedback_{resumed,read_failed,invalid_json,hash_mismatch}`, `port_{invalid,in_use_fallback}`, `serve_{address_failed,remote_started}`（`src/cli/{help-text,flag-parser,parse-run-args,parse-clean-args,clean-format,clean,compose-review-html,assets/*,serve}.ts` 由来） |

**suffix 命名規約** (セルフレビュー C1 で確定):

- `_aria`: HTML 属性 `aria-label` 専用の key（`data-i18n-aria-label` で挿す）
- `_tooltip`: HTML 属性 `data-tooltip` 専用の key（`data-i18n-data-tooltip` で挿す）
- `_placeholder`: HTML 属性 `placeholder` 専用の key（`data-i18n-placeholder` で挿す）
- suffix なし: 要素の `textContent` 用 key（`data-i18n` で挿す）
- **`data-i18n-params`**: placeholder 値を持つ key に対する **JSON-serialized 引数** を埋め込む（例: `data-i18n="toolbar.status_loaded" data-i18n-params="{&quot;docName&quot;:&quot;spec&quot;,&quot;docHash&quot;:&quot;a1b2c3d4e5f6a7b8&quot;}"`）。CLI が html-rewrite で paint 前にステータス文字列を確定する場合などに使う。`applyI18nDataset` は `dataset.i18nParams` を `JSON.parse` してから `translate(key, params)` に渡す。subscribeLangChange でも同じ params で再描画され、toggle 時も追従する

  **CLI 埋め込みの safe rewrite API** (信頼境界、§11): docName 等の **任意 user 由来文字列を含むため**、JSON.stringify 後に HTML 属性 escape が必要。既存 `setOrInsertAttribute` が double quote 形式 (`name="value"`) を前提としているため、それと整合させる:

  ```ts
  // src/core/embed/html-rewrite.ts に追加
  export const formatI18nParamsAttr = (params: Record<string, unknown>): string => {
    const json = JSON.stringify(params)
    // double quote 区切り属性に入れるため、JSON 内の " を &quot; に escape。
    // 加えて & / < / > も HTML escape (信頼境界、§11)。setOrInsertAttribute と
    // 組み合わせる前提で、属性値部分のみを返す (区切り quote は呼び出し側が付ける)。
    return json
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }

  // #status の opening tag に data-i18n + data-i18n-params の 2 属性を upsert する
  // 専用 helper。rewriteInitialStatus と並立し、rewriteReviewHtml で順に呼ぶ。
  export const rewriteStatusI18nAttrs = (
    reviewHtml: string,
    params: { docName: string; docHash: string }
  ): string => {
    const match = STATUS_SPAN_RE.exec(reviewHtml)
    if (!match) throw new Error('rewriteStatusI18nAttrs: #status span not found')
    const [whole, openingTag, body, closingTag] = match
    // setOrInsertAttribute は既存値があれば置換、無ければ挿入する (idempotent)
    const withI18n = setOrInsertAttribute(openingTag, 'data-i18n', 'toolbar.status_loaded')
    const withParams = setOrInsertAttribute(
      withI18n,
      'data-i18n-params',
      formatI18nParamsAttr(params)
    )
    return reviewHtml.replace(whole, `${withParams}${body}${closingTag}`)
  }
  ```

  これにより、`docName = 'it\\'s & <b>"test"</b>'` のような特殊文字を含む docName でも安全に rewrite できる (ブラウザの HTML parser が `&quot;` / `&amp;` / `&lt;` を JSON 内の元文字に decode → `JSON.parse` が元 object を復元)。JS 動的経路 (`src/app/review.ts:50` 等で `el.dataset.i18nParams = JSON.stringify(...)` する場合) はブラウザの dataset setter が自動 escape するので safe rewrite helper は不要。CLI 経路 (HTML 文字列を sed-like に rewrite する場合) のみ手動 escape が必須。

例: `toolbar.search_aria` (aria-label 用) / `toolbar.search_tooltip` (data-tooltip 用) / `toolbar.search_placeholder` (placeholder 用) / `toolbar.open` (textContent 用)。同じ UI 要素で複数属性に値を入れる場合は別 key を切り、属性ごとに `data-i18n-*` で挿す。textContent と aria-label を兼用する場合のみ、`label` 系 suffix なし key 1 つで両者を表現する例外を認める（`modal.comment_label` 等）。

**DOM 構造規約: `data-i18n` は leaf 要素のみ** (セルフレビュー反映で確定): textContent 代入は子要素を全て破棄するため、**`data-i18n` 属性は子要素を持たない leaf 要素にのみ付与する**。複合構造（テキスト + 装飾 span / icon / caret 等）を持つ要素では、テキスト部分を専用の leaf `<span>` で wrap して `data-i18n` をその span に付ける。

```html
<!-- NG: button が複合構造 (caret span を子要素として持つ) -->
<button data-i18n="toolbar.open">Open <span class="menu-caret" aria-hidden="true">▾</span></button>
<!-- ↑ applyI18nDataset が textContent 代入で caret span を破棄する -->

<!-- OK: テキスト部分のみ leaf span で wrap -->
<button>
  <span data-i18n="toolbar.open">Open</span>
  <span class="menu-caret" aria-hidden="true">▾</span>
</button>
```

aria-label / placeholder / title / data-tooltip は属性なので **複合構造の親要素に直接付与可能**（子要素を破壊しない）。例えば `<button data-i18n-aria-label="toolbar.open_menu_tooltip"><span>...</span><span class="caret">▾</span></button>` は OK。

**辞書値は可変部分のみ**: machine contract (キー名 `<kbd>Esc</kbd>` / 数値 / コードシンボル等) は翻訳対象外として DOM に残し、可変部分のみを leaf span で wrap する。例: Esc ヒントの DOM 構造:

```html
<!-- 辞書: modal.hint_cancel = ' to cancel' (en) / ' でキャンセル' (ja) -->
<span class="btn-hint-label" aria-hidden="true">
  <kbd class="btn-key-hint">Esc</kbd>
  <span data-i18n="modal.hint_cancel"> to cancel</span>
</span>
```

`<kbd>Esc</kbd>` 部分は翻訳しない (キー名は machine contract で en/ja で同じ)。可変部分の ` to cancel` / ` でキャンセル` のみが leaf span に入り、辞書値もその部分だけになる。

`applyI18nDataset` の実装には **dev mode assertion** を入れて、`[data-i18n]` 要素が `children.length > 0` の場合に `console.warn` する（regression を実装フェーズで検出）。production build では no-op。

placeholder は `{count}` / `{name}` / `{url}` / `{message}` 等の素朴な `{key}` 置換のみサポート。

**複数形分岐の API は `translatePlural` で分離**: 通常の `translate(key, params?)` は `MessageKey` (suffix 付き完全 key) しか受け付けない。複数形分岐の base key (`comments.count_label` 等) は別 API で扱う:

```ts
export type PluralBaseKey =
  | 'comments.count_label'
  | 'toast.render_failed'
  | 'modal.confirm_delete_comments'
  | 'search.count'

export interface TranslatePluralOptions {
  baseKey: PluralBaseKey
  count: number
  params?: Readonly<Record<string, string | number>>
}

// i18n-browser.ts / cli/i18n.ts の wrapper signature。core 層は dict を引数で受ける。
export const translatePlural = (options: TranslatePluralOptions): string => {
  // suffix を解決して translate に委譲
}
```

呼び出し例: `translatePlural({ baseKey: 'comments.count_label', count: 3 })` → 内部で `'comments.count_label_other'` を MessageKey として lookup → 辞書値 `'{count} comments'` に `{count: 3}` を展開 → `"3 comments"`。

**API signature の options object 化** (Step 2 実装で確定): プロジェクト lint の `max-params` (上限 3) を満たすため、`(baseKey, count, params?)` の 3 引数フラット形式ではなく `{ baseKey, count, params? }` の options object 1 引数 (wrapper) / `(dict, options)` 2 引数 (core) に統一。`translate(key, params?)` (wrapper) は 2 引数なので変更なし。

**複数形分岐が必要な base key は 4 件 + 単一 key 1 件**（再 Step 1.5 で `search.count` を追加、suffix を `_one` / `_other` に統一）:

| base key                        | 分岐                                        | suffix 命名                                                                                                  |
| ------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `comments.count_label`          | 0/1/N の 3 分岐                             | `_{zero,one,other}` (en は `{count} comments` / `{count} comment` / `{count} comments`、ja は「件」固定)     |
| `toast.render_failed`           | 1/N の 2 分岐                               | `_{one,other}` (en は `Failed to render {count} block` / `... blocks`、ja は「個」固定)                      |
| `modal.confirm_delete_comments` | 1/N の 2 分岐                               | `_{one,other}` (en は `Delete this comment?` / `Delete all {count} comments?`、ja は「件」固定)              |
| `search.count`                  | 1/N の 2 分岐                               | `_{one,other}` (en は `{total} match` / `{total} matches`、ja は「件」固定)                                  |
| `toast.feedback_written`        | 単一 key、`{countLabel}` placeholder で受領 | `translate('toast.feedback_written', { countLabel: translatePlural('comments.count_label', n) })` の二段構造 |

それ以外の key は `{count}` 等の数値を単一テンプレートに埋め込むだけで十分（ja は数詞「件」「個」で固定形を取り、en も多くの場面で「Copied · 3」のような副詞形で複数形分岐を避けられる）。

**suffix 統一の探索順**: `_zero` / `_one` / `_other` の 3 種類のみを使う。`translatePlural` の探索順は:

- `count === 0` → `_zero` → 辞書未登録なら `_other` に fall back
- `count === 1` → `_one` → 辞書未登録なら `_other` に fall back
- 上記以外 → `_other`

`Intl.PluralRules` は使わず、`if (count === 0) ... else if (count === 1) ... else ...` の素朴ロジックで実装する。`toast.render_failed` のように `_zero` を持たない base key の場合は `count === 0` のとき `_other` に倒れる。

`Intl.PluralRules` は使わず、`if (count === 0) ... else if (count === 1) ... else ...` の素朴ロジックで実装する。

### 3.5 DOM 連携と再描画

HTML markup には `data-i18n="comments.empty"` 属性を持たせる:

```html
<p class="empty-state" data-i18n="comments.empty">
  Select text in the file to add a review comment
</p>
<button class="lang-toggle" data-i18n-aria-label="toolbar.lang_toggle_aria">EN</button>
<input type="text" data-i18n-placeholder="modal.paste_markdown_body_placeholder" />
```

起動時に `applyI18nDataset(document)` が DOM を 1 回 walk し、各 dataset 属性別に対応するテキスト / 属性を置換する。**walk セレクタは `data-i18n*` 系の基本セレクタ** で textContent 用 key だけでなく aria-label / placeholder / title / data-tooltip 専用 key を持つ要素も漏れなく拾い、**`#doc` 配下の除外フィルタは JS 側で `closest('#doc')` ベースに統一**する (Step 2 実装で確定):

```ts
const I18N_SELECTORS = [
  '[data-i18n]', // textContent
  '[data-i18n-aria-label]', // aria-label
  '[data-i18n-placeholder]', // placeholder
  '[data-i18n-title]', // title
  '[data-i18n-data-tooltip]', // data-tooltip
]
const I18N_BASE_SELECTOR = I18N_SELECTORS.join(', ')

// happy-dom や一部 browser で `:not(#doc *)` の解釈差があるため CSS でのフィルタを避け、
// JS 側で `closest('#doc')` ベースに統一して環境依存を排除する。
const isInsideDocProtectedRoot = (el: Element): boolean => el.closest('#doc') !== null
const isFootnoteBackrefException = (el: Element): boolean =>
  el.hasAttribute('data-footnote-backref') && el.hasAttribute('data-i18n-aria-label')
const shouldTranslate = (el: Element): boolean =>
  !isInsideDocProtectedRoot(el) || isFootnoteBackrefException(el)
```

**JS フィルタ方式を採用した理由** (Step 2 実装で確定): 元計画は `[data-i18n*]:not(#doc *), #doc [data-footnote-backref][data-i18n-aria-label]` の単一 CSS セレクタを想定していたが、happy-dom (test 環境) が `:not(#doc *)` で `#doc` 配下要素を正しく除外しない不具合が確認された。本番 browser では動くが test 環境で壊れるのを避けるため、CSS フィルタを廃止し JS 側で `closest('#doc')` + footnote backref 例外判定する方針に統一。アンカリング保護の意味論 (本文 textContent 不変条件) は同じ。

動的生成（modal / toast / メニュー項目の動的追加）は `translate(key, params)` を直接呼ぶ。生成元モジュールが `subscribeLangChange` でリスナを登録し、再描画タイミングで再生成する。

**動的 UI の購読パターン (汎用規約)** (セルフレビュー反映): 文書を複数回読み込む / モーダルを複数回開閉する等で同じ生成元関数が再呼び出しされるケースで、`subscribeLangChange` を毎回呼ぶと **listener が累積** し、(1) toggle 1 回で同じ要素が複数回上書きされる、(2) GC されない listener が累積してメモリ leak、(3) clear 後も古い state が listener に保持されて toggle 時に復活、という退行が出る。

各モジュールは以下の **4 関数パターン** で実装する (セルフレビュー反映で teardown を追加):

```ts
// module-local state (listener から参照する現在値)
let currentState: StateType | null = null
let langSubscription: (() => void) | null = null
let docSubscription: (() => void) | null = null // document hook の Unsubscribe (該当モジュールのみ)

// 1. setup-once: bootstrap で 1 回だけ呼ぶ。再呼出しは idempotent (二重購読防止)
//    teardown 後に再 setup 可能 (langSubscription が null に戻っているため)
export const setupXxxI18n = (deps?: {
  registerOnDocumentLoad?: DocumentLoader['registerOnDocumentLoad']
}): void => {
  if (langSubscription !== null) return
  langSubscription = subscribeLangChange(() => {
    if (currentState === null) return
    rerenderFromState(currentState)
  })
  // document hook が必要なモジュールは Unsubscribe を保持
  if (deps?.registerOnDocumentLoad !== undefined) {
    docSubscription = deps.registerOnDocumentLoad((source) => {
      // throw しない契約 (副作用は console / state 更新のみ)
      handleDocumentLoad(source)
    })
  }
}

// 2. show/update: state を更新 + 初期描画。listener 登録は伴わない (重複しない)
export const showXxx = (state: StateType): void => {
  currentState = state
  rerenderFromState(state)
}

// 3. clear: state を null にして DOM も空にする (toggle 時の復活を防ぐ)
//    購読は維持されるので setup 後はずっと有効
export const clearXxx = (): void => {
  currentState = null
  clearDom()
}

// 4. teardown: 全 subscription を解除 + state を null + DOM を初期化。
//    再 bootstrap / テスト fixture / モジュール HMR で古い loader への登録残留を防ぐ。
//    2 回連続で呼んでも例外を投げない (idempotent)
export const teardownXxxI18n = (): void => {
  if (langSubscription !== null) {
    langSubscription()
    langSubscription = null
  }
  if (docSubscription !== null) {
    docSubscription()
    docSubscription = null
  }
  currentState = null
  clearDom()
}
```

`subscribeLangChange` の返り値 (Unsubscribe) と `registerOnDocumentLoad` の返り値 (Unsubscribe) はどちらも `langSubscription` / `docSubscription` に保持し、`teardown*I18n` で確実に解除する。実 UI では 1 回 setup したら CLI 終了まで生存するので `teardown` は呼ばないが、test fixture / HMR / 将来の SPA 風文書切替で必須。

このパターンを適用する具体的なモジュールは Step 6 を参照。

**文書ライフサイクル hook と共通ロード API** (セルフレビュー反映): 動的 UI の中には「文書の出自に応じて表示/非表示を切替えるべき」要素がある (例: `#online-source` は online fetch 時のみ表示、Open file / Paste / embedded MD では非表示)。各入力経路 (Open file / Paste / online fetch / embedded MD) で `clearOnlineSource()` / `showOnlineSource(url)` を個別に呼ぶと、新しい入力経路を追加した時に呼び忘れる構造的リスクがある。

**共通ロード API `createDocumentLoader(baseLoader)` factory + `onDocumentLoad` hook** で構造的に解消:

```ts
// src/app/document/load-document.ts (新設、factory パターン)
export type DocumentSource =
  | { kind: 'online'; url: string; docName: string; body: string }
  | { kind: 'local'; docName: string; body: string }

export type Unsubscribe = () => void

export interface DocumentLoader {
  loadDocument: (source: DocumentSource) => Promise<void>
  // hook 登録時に Unsubscribe 関数を返し、teardown で解除可能にする。
  // テスト fixture の再 bootstrap や、別 loader への切替で古い hook が残らない。
  registerOnDocumentLoad: (hook: (source: DocumentSource) => void) => Unsubscribe
}

// factory: baseLoader を引数で受けることで循環依存を回避し、既存 app-wiring.ts の
// online asset decorator (Mermaid / KaTeX / Shiki lazy fetch) が適用済みの loader を
// そのまま注入できる。直接 import に変えると decorator がバイパスされる。
export const createDocumentLoader = (
  baseLoader: (docName: string, body: string) => Promise<void>
): DocumentLoader => {
  const hooks: Array<(source: DocumentSource) => void> = []
  return {
    registerOnDocumentLoad: (hook) => {
      hooks.push(hook)
      // Unsubscribe: クロージャで hook 参照を保持し、indexOf+splice で除去
      return () => {
        const idx = hooks.indexOf(hook)
        if (idx >= 0) hooks.splice(idx, 1)
      }
    },
    loadDocument: async (source) => {
      // 本文ロードはここでだけ throw を通す (失敗時は caller の catch が反応する)
      await baseLoader(source.docName, source.body)
      // hook は失敗隔離: 1 つが throw しても本文ロード成功は変わらず、他 hook は実行される。
      // hook 実装は throw しない契約だが、防御的に try/catch で囲む (フィードバック反映)。
      // 反復中に hook 内から unsubscribe() を呼ばれても次の hook がスキップされないよう
      // 配列をスナップショットしてから反復する (`hooks.splice` で indexing がずれる対策)。
      for (const hook of [...hooks]) {
        try {
          hook(source)
        } catch (e) {
          console.error('[load-document] hook threw, isolated:', e)
        }
      }
    },
  }
}
```

**注入方法**: `src/app/app-wiring.ts` の `BootstrapDeps` 組み立て時に、既存の decorator 適用済み `loadFromMarkdown` を `createDocumentLoader` に渡し、戻り値の `loadDocument` / `registerOnDocumentLoad` を各モジュールに inject する:

```ts
// app-wiring.ts (既存箇所への追記)
const decoratedLoadFromMarkdown = applyOnlineAssetDecorator(rawLoadFromMarkdown)
const { loadDocument, registerOnDocumentLoad } = createDocumentLoader(decoratedLoadFromMarkdown)
// BootstrapDeps に loadDocument / registerOnDocumentLoad を追加し、
// boot.ts / paste-markdown-modal / open-file-input / source-display 等に注入
```

これで (1) 循環依存なし、(2) decorator が確実に適用 (`app-wiring.ts` が単一の合成ポイント)、(3) `createDocumentLoader(mockLoader)` でモック注入したテストが書ける、(4) hook 例外がロード成功を失敗扱いにしない。

**hook の throw 契約**: 各モジュールの hook 実装は **throw しない** ことを契約とする (副作用は console / logger 経由)。`createDocumentLoader` 内の try/catch は防御層であり、実装側の規律違反を構造的に許容する保険。§6 test で「hook A が throw しても hook B が呼ばれる」「`loadDocument` が resolve する」を検証する。

各モジュール側 (source-display を例に):

```ts
// src/app/online/source-display.ts
// registerOnDocumentLoad は app-wiring.ts で組み立てた DocumentLoader から
// BootstrapDeps 経由で注入される (グローバル export ではない)。
let docSubscription: Unsubscribe | null = null

export const setupOnlineSourceI18n = (deps: {
  registerOnDocumentLoad: DocumentLoader['registerOnDocumentLoad']
}): void => {
  if (langSubscription !== null) return
  langSubscription = subscribeLangChange(() => {
    if (currentSourceUrl === null) return
    const el = document.getElementById('online-source')
    if (el) el.replaceChildren(buildSourceLinkElement(currentSourceUrl))
  })
  // 文書切替時に Source 表示を自動更新する hook を登録 (throw しない契約)。
  // 戻り値の Unsubscribe を保持して teardown で解除可能にする。
  docSubscription = deps.registerOnDocumentLoad((source) => {
    if (source.kind === 'online') showOnlineSource(source.url)
    else clearOnlineSource()
  })
}

// teardown: lang + document 両購読を解除 + state + DOM を初期化 (idempotent)
export const teardownOnlineSourceI18n = (): void => {
  if (langSubscription !== null) {
    langSubscription()
    langSubscription = null
  }
  if (docSubscription !== null) {
    docSubscription()
    docSubscription = null
  }
  currentSourceUrl = null
  const el = document.getElementById('online-source')
  if (el) el.replaceChildren()
}
```

これで全 callsite が `loadDocument` 経由になり、新しい入力経路を追加しても hook が自動的に呼ばれて Source 表示が整合する。`loadFromMarkdown` は internal 限定にして直接 export しない (grep で検証可能)。test fixture では `teardownOnlineSourceI18n()` で全 subscription を解除して別 loader で再 setup できる。

`setLang(lang)` の処理順（**`i18n-browser.ts` 専用**、CLI 側からは呼ばない。永続化を最後に置くことで storage 障害時もセッション内 toggle が機能する、Step 2b コード例と整合）:

1. module-local state を更新（`i18n-core.ts` の `getLang()` の戻り値が変わる）
2. `<html lang>` を更新（`document.documentElement.lang = lang`）
3. `applyI18nDataset(document)` で静的 markup を再描画（DOM 再構築なし、`textContent` / 属性のみ + CSS 疑似要素用の custom property も setProperty）
4. `subscribeLangChange` のリスナを呼んで動的生成済み要素を再描画
5. `writeStoredLang(lang)` で `localStorage('mdxg-redline.lang')` に保存（**最後**。内部で try/catch されており、Private モード / Quota / SecurityError でも以前の DOM 反映 / 通知は完了済み）

CLI 側は `setCliLang(lang)` (`src/cli/i18n.ts`) を呼ぶ。これは **state 更新のみ** で `document` / `localStorage` には触らない。Node 環境で `ReferenceError` が出る経路を構造的に排除。

§6 アンカリングと §10 検索ハイライトは `textContent` ベースでアンカーを保持しているため、本実装では:

- `[data-i18n]` 配下にコメント可能な markdown 本文は置かない（chrome / panel / modal 限定）
- toggle 時に doc-pane (`#doc`) は触らない
- toolbar の `lang_toggle` button は `comments/selection.ts` の `textSegments` が skip するセレクタに追加する（既存の `.code-copy-btn` / `.code-lang-label` と同じパターン）

empty state の DOM 構造は Step 1.5 調査で **既に分離済み** であることが確定: `#doc-wrap > {#empty-state-default, #empty-state-online-error, #doc}` の兄弟構造（`review.html:377-398`）。empty state は `#doc` の外側にあるため、`applyI18nDataset` の walk セレクタ全要素に `:not(#doc *)` を付けるだけで、empty state は翻訳対象 / `#doc` 内のレビュー対象本文は除外、という分離が成立する。

**JS による直接書き換え経路の扱い**: `boot.ts:130-155` の `formatFetchFailureMessage` 系は `#empty-state-online-error` の textContent を JS で直接書き換える（属性ベースの `data-i18n` を経由しない）。これらは Step 3 で `translate(key, params)` の戻り値を代入する形に置き換える。書き換え後 `<html lang>` に応じた文言になるが、書き換え時点の lang が固定されるので、`subscribeLangChange` で再描画する必要がある（toast / modal と同じパターン）。

**CSS 疑似要素 (`::before` / `::after` の `content`) の翻訳経路**（セルフレビュー反映）: CSS `content` プロパティは `applyI18nDataset` の `data-i18n` 経路では書き換えできない（疑似要素は DOM ノードではないため `querySelectorAll` で拾えない）。本実装では **CSS custom property + JS `setProperty` 連携** で対応する。

- CSS 側: `content: var(--ui-loading-text, 'Loading…')` のように custom property を参照（fallback として現状の英文を残す）
- JS 側: `applyI18nDataset` 内で `document.documentElement.style.setProperty('--ui-loading-text', "'" + translate('empty.loading_text') + "'")` を実行。値は CSS string リテラル形式（single quote で囲む）で渡す
- `setLang` 時にも `applyI18nDataset` 経由で再 setProperty されるため、toggle に追従する

`src/` 全体での該当箇所は **`src/styles/review.css:1755` の `Loading…` 1 件のみ**（再々セルフレビュー時の grep `content:\s*['"][^'"]+['"]` で確定）。将来 CSS 疑似要素 content の翻訳対象が増えた場合は、同じ custom property + setProperty パターンで `--ui-*` を増やしていく。

```ts
// applyI18nDataset の実装方針 (Step 2 実装準拠)。
// セレクタは I18N_BASE_SELECTOR (= I18N_SELECTORS.join(', ')) のみ。`#doc` 配下の除外は
// CSS 疑似クラス (`:not(#doc *)`) ではなく `closest('#doc')` ベースの JS フィルタで判定する
// (§3.5 の "JS フィルタ方式" 参照)。
export const applyI18nDataset = (root: Document | Element): void => {
  // root 自身が I18N_BASE_SELECTOR にマッチする場合も対象に含める (querySelectorAll は子孫のみ
  // なので、Step 6 の JS 動的経路で applyI18nDataset(#status) を呼んだ際に root 自身が
  // 翻訳されない問題を回避)。
  const targets: Element[] = []
  if (root instanceof Element && root.matches(I18N_BASE_SELECTOR) && shouldTranslate(root)) {
    targets.push(root)
  }
  for (const el of root.querySelectorAll(I18N_BASE_SELECTOR)) {
    if (shouldTranslate(el)) {
      targets.push(el)
    }
  }
  for (const el of targets) {
    if (el instanceof HTMLElement) {
      applyToElement(el)
    }
  }
  // CSS 疑似要素用の custom property も更新 (root === document の初期描画 / setLang 経由の
  // 再描画時)。
  if (root === document) {
    applyCssPseudoBindings()
  }
}

// 要素単位の翻訳適用。`#doc` 配下の構造的例外 (footnote backref 等) では data-i18n が誤って
// 付いても textContent 置換を skip し attribute のみ翻訳する二重防御 (アンカリング不変条件保護)。
const applyToElement = (el: HTMLElement): void => {
  const { dataset } = el
  const params = parseI18nParams(dataset.i18nParams)
  if (!isInsideDocProtectedRoot(el)) {
    applyTextContent(el, dataset.i18n, params)
  }
  applyAttributeBindings(el, dataset, params)
}
```

`parseI18nParams` は `data-i18n-params` の JSON 文字列を安全に parse する (失敗時は null)。`applyTextContent` は `dataset.i18n` を読んで `translate(key, params)` の結果を `textContent` に代入し、dev mode では `children.length > 0` の場合に `console.warn` で leaf 違反を警告する。`applyAttributeBindings` は `aria-label` / `placeholder` / `title` / `data-tooltip` の 4 属性を `ATTR_BINDINGS` テーブル経由で一括処理する (詳細は `src/app/i18n/i18n-browser.ts`)。

### 3.6 サイズ見積もり

| ビルド                       | 現状 (gzip) | 増分見積もり (gzip)              |
| ---------------------------- | ----------- | -------------------------------- |
| `dist/embed-template.html`   | 約 99 KB    | +約 3 KB（辞書 2 言語 + helper） |
| `dist/standalone.html`       | 約 5.9 MB   | +約 3 KB                         |
| online build (`mkdn.review`) | （別途）    | +約 3 KB                         |

辞書 2 言語の raw size は約 6–7 KB（~195 entry × 平均 20 bytes × 2 言語、再 Step 1.5 で entry 数確定。`cli.*` 全文辞書化で Step 3 完了時に +1–2 KB の見込み）。helper (`i18n.ts`) は 1 KB 未満を想定。実測値は Step 8（DESIGN.md 反映時）に確定する。

## 4. 実装ステップ

順序は依存関係順。各ステップ完了で in-source test と手動視覚チェックを通す。

### Step 1: (完了済み) 設計判断の確定と辞書 skeleton

**状態**: **完了済み** — commit `1727be7` で UI 辞書 (`src/app/i18n/messages.{en,ja}.ts`、各 155 entry) と CLI 辞書 (`src/cli/i18n/messages-cli.{en,ja}.ts`、各 36 entry) を追加。`MessageKey` / `CliMessageKey` 型も export 済み。

- 本ドキュメントの §5 設計判断を ultrareview / セルフレビューで確定
- `src/app/i18n/messages.en.ts` の key 命名（§3.4）を確定し、現状 HTML / TS から抽出した約 140 entry の UI 辞書 skeleton を作成（値は現状の英語文言）
- `src/app/i18n/messages.ja.ts` を `satisfies Record<MessageKey, string>` 付きで作成（Step 3 で日本語訳を埋めるため、初期値は en と同値）
- `src/cli/i18n/messages-cli.en.ts` / `messages-cli.ja.ts` で CLI 辞書 skeleton（`cli.*` 約 21 entry）を別ファイルで作成
- `translate(key, params?)` と `translatePlural(baseKey, count, params?)` の placeholder 仕様 / 探索順 / 型を §3.4 で確定

成果物: §5 マッピング表が確定状態、UI 辞書 (`src/app/i18n/messages.{en,ja}.ts`) と CLI 辞書 (`src/cli/i18n/messages-cli.{en,ja}.ts`) の skeleton が揃った状態、`MessageKey` / `CliMessageKey` 型が export される。**実装本体 (`i18n-core.ts` / `i18n-browser.ts` / `cli/i18n.ts`) は Step 2 に分離**（未実装の stub を main にコミットして誰かが import → 例外発生するリスクを避ける）。

### Step 2: (完了済み) i18n 純粋ロジック層 + browser / CLI 分離実装

**状態**: **完了済み** — commit `d60fa4f`。`src/app/i18n/i18n-core.ts` (39 tests) / `src/app/i18n/i18n-browser.ts` (24 tests) / `src/cli/i18n.ts` (8 tests) を新規追加し、`vp check` / `vp test` (全 1354 tests) 通過。実装過程で計画から 3 点の乖離 (§3.1 core 層 signature: `translate(dict, key, params?)` + `MessageDict = Record<string, string>` 統一、§3.4 `translatePlural` の options object 化、§3.5 walk セレクタを `closest('#doc')` ベース JS フィルタに変更) が確定し、それぞれ該当節に追記済み。加えて Step 2 完了後のフィードバック修正 3 点 (translatePlural の count 上書き防止 / footnote 構造的例外での textContent skip 二重防御 / 不正 lang の runtime fallback 契約削除 + 入口経路のみへの限定) を本ドキュメントの該当節に反映済み。

UI / DOM / I/O に依存しないロジックを pure 関数で書き、in-source test を通す。**本 Step で 3 ファイルを新規作成**してコミット (セルフレビュー反映: Node 環境で `document` / `localStorage` を触る関数が失敗する経路を構造的に排除)。

#### 2a. `src/app/i18n/i18n-core.ts` (純粋ロジック、Node/ブラウザ共通)

```ts
export type Lang = 'en' | 'ja'

export type PluralBaseKey =
  | 'comments.count_label'
  | 'toast.render_failed'
  | 'modal.confirm_delete_comments'
  | 'search.count'

// 辞書は MessageDict (= Readonly<Record<string, string>>) で受ける。core 層では generic K を
// 取らず `as K` unsafe assertion を回避し、型安全性は wrapper (i18n-browser / cli/i18n) 側で
// MessageKey / CliMessageKey に絞って保証する。
export type MessageDict = Readonly<Record<string, string>>

export interface TranslatePluralOptions {
  baseKey: PluralBaseKey
  count: number
  params?: Readonly<Record<string, string | number>>
}

export function detectLangFromEnv(env: {
  LC_ALL?: string
  LC_MESSAGES?: string
  LANG?: string
}): Lang
export function detectLangFromNavigator(language: string | null): Lang
export function resolveInitialLang(input: {
  storage?: string | null
  navigatorLanguage?: string | null
}): Lang
export function translate(
  dict: MessageDict,
  key: string,
  params?: Readonly<Record<string, string | number>>
): string
// max-params 3 を満たすため options object 1 引数 (§3.4 の signature 確定経緯参照)。
export function translatePlural(dict: MessageDict, options: TranslatePluralOptions): string
```

- env / navigator / 優先順位ロジック（§3.2）
- 不正値の正規化 — **入口経路に限定**: `resolveInitialLang` の `storage` 引数で `'fr'` 等の不正値は navigator にスキップ、env 値については §3.2 で別途規約: **空文字 / undefined は「未設定」として skip し次階層に fallback**、`'C'` / `'POSIX'` / `^ja(_|-|$)` 非マッチは `en` 確定 (POSIX セマンティクスに沿った 3 段評価)。`setLang` / `setCliLang` には runtime guard を入れない: `Lang = 'en' | 'ja'` 型による型安全性のみに依存し、内部 API として呼び元を信頼する (system boundary は入口経路の `extractLang` / `readStoredLang` / `resolveInitialLang` で吸収済み)
- 未知の key は key 文字列をそのまま返す（dev 時の検出を容易にする）
- placeholder の `{name}` 展開、エスケープなしのプレーン置換
- `translatePlural` の suffix 解決（§3.4 の探索順）
- 辞書を引数で受けるため、UI 辞書と CLI 辞書を同じロジックで処理可能

#### 2b. `src/app/i18n/i18n-browser.ts` (ブラウザ副作用)

```ts
import {
  type Lang,
  type MessageDict,
  type TranslatePluralOptions,
  resolveInitialLang,
  translate as translateCore,
  translatePlural as translatePluralCore,
} from './i18n-core'
import { type MessageKey, messagesEn } from './messages.en'
import { messagesJa } from './messages.ja'

export const LANG_STORAGE_KEY = 'mdxg-redline.lang'

// lang ごとの辞書を Record で持ち、currentLang の lookup を `messagesEn` / `messagesJa` の
// 三項演算ではなく `DICTS[currentLang]` で抽象化する (将来の言語追加に備える)。
const DICTS: Record<Lang, MessageDict> = {
  en: messagesEn,
  ja: messagesJa,
}

let currentLang: Lang = 'en'
const listeners: Array<(lang: Lang) => void> = []

const currentDict = (): MessageDict => DICTS[currentLang]

export const getLang = (): Lang => currentLang

// bootstrap で呼ぶ初期化 API (state 確定 + <html lang> 再同期。localStorage 書き込みや
// subscriber 通知は伴わない軽量初期化)。head script の setTimeout fallback で lang="en"
// に戻されたケース (module 遅延成功) でも DOM と state が整合するよう、<html lang> を再同期する。
export const initLangFromBrowser = (): Lang => {
  const storage = readStoredLang()
  const navigatorLanguage = typeof navigator === 'undefined' ? null : navigator.language
  const lang = resolveInitialLang({ navigatorLanguage, storage })
  currentLang = lang
  document.documentElement.lang = lang
  return lang
}

// 副作用順序: state → DOM 反映 → 通知 → 永続化 (最後)。
// localStorage 失敗 (Private モード / Quota / SecurityError) で writeStoredLang が
// throw しても、それより前の DOM 反映と subscriber 通知は完了済みになる。
// §8 リスク表の「storage 不可でもセッション内 toggle は機能する」を構造的に保証。
export const setLang = (lang: Lang): void => {
  currentLang = lang
  document.documentElement.lang = lang
  applyI18nDataset(document)
  // 反復中に listener 内から unsubscribe() を呼ばれても次の listener がスキップされないよう
  // 配列をスナップショットしてから反復する。
  const snapshot = listeners.slice()
  for (const listener of snapshot) {
    listener(lang)
  }
  writeStoredLang(lang)
}

export function readStoredLang(): Lang | null
// 内部 try/catch で localStorage 例外を握りつぶす (副作用最後に呼ばれる前提だが
// 二重防御として関数自体も throw しない契約にする)。
export const writeStoredLang = (value: Lang): void => {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, value)
  } catch {}
}

export function nextStoredLang(current: Lang): Lang
export function subscribeLangChange(listener: (lang: Lang) => void): () => void
// applyI18nDataset は [data-i18n*] 要素の更新 + closest('#doc') ベース除外フィルタ +
// 構造的例外要素での textContent skip 二重防御 + CSS 疑似要素用 custom property
// (--ui-loading-text 等) の setProperty 同時更新を行う (§3.5 参照)。
export function applyI18nDataset(root: Document | Element): void

// wrapper signature は MessageKey に絞ることで型安全性を保つ。core 層は MessageDict ベース。
export const translate = (
  key: MessageKey,
  params?: Readonly<Record<string, string | number>>
): string => translateCore(currentDict(), key, params)

export const translatePlural = (options: TranslatePluralOptions): string =>
  translatePluralCore(currentDict(), options)
```

UI 辞書のみ load。`document` / `localStorage` 操作を含むため Node では import 不可（実行時にエラー）。

#### 2c. `src/cli/i18n.ts` (CLI state、Node 専用)

```ts
import { type Lang, type MessageDict, translate as translateCore } from '../app/i18n/i18n-core'
import { type CliMessageKey, messagesCliEn } from './i18n/messages-cli.en'
import { messagesCliJa } from './i18n/messages-cli.ja'

const CLI_DICTS: Record<Lang, MessageDict> = {
  en: messagesCliEn,
  ja: messagesCliJa,
}

let currentCliLang: Lang = 'en'

export const setCliLang = (lang: Lang): void => {
  currentCliLang = lang
}
export const getCliLang = (): Lang => currentCliLang
export const translateCli = (
  key: CliMessageKey,
  params?: Readonly<Record<string, string | number>>
): string => translateCore(CLI_DICTS[currentCliLang], key, params)
```

`document` / `localStorage` には触らない。CLI bootstrap で `extractLang(rawArgv, env).lang` を `setCliLang` に渡して 1 回呼ぶだけ。

成果物: 3 ファイル新規 + in-source test（env / navigator / 優先順位 / 不正値 / 未知 key / placeholder / plural suffix 解決）。ブラウザ専用関数 (`setLang` 等) が Node で誤って呼ばれないことは TypeScript 型 + import 経路で構造的に防ぐ

### Step 3: (完了済み) 翻訳対象抽出と辞書本体への適用

**状態**: **完了済み** — commit `6b4a70d`。`src/review.html` の主要な textContent / aria-label / placeholder / data-tooltip を `data-i18n*` 属性で markup し、`src/app/chrome/toolbar.ts` / `paste-markdown-modal.ts` / `src/app/comments/*.ts` / `src/app/document/code-copy-wrap.ts` / `src/app/workspace/workspace.ts` / `workspace-fs.ts` / `src/app/boot.ts` / `src/app/online/open-url-modal.ts` / `src/app/navigation/page-navigation-render.ts` / `src/app/renderers/{mermaid-svg-interactions,katex,mermaid}.ts` / `src/app/app-wiring.ts` の動的文言を `translate(key)` / `translatePlural({...})` に置き換え。`commentCountLabel` を `src/app/comments/comment-count-label.ts`、`formatMatchCount` を `src/app/search/format-match-count.ts` に移動 (HTML bundle 専用、CLI 巻き込み防止)。`KATEX_FAILURE_LABELS` / `MERMAID_FAILURE_LABELS` は汎用 `toast.render_failed_*` キーを流用 (Math expression / Diagram block の区別はユーザー視点で軽微との判断、辞書を 2 セット維持しない)。加えて Step 3 セルフレビュー後の追加フィードバックで、(a) `#status` の textContent 直接書き換え経路 (`src/app/review.ts:loadFromMarkdown` / `src/app/workspace/workspace.ts:finishWrite`) を `dataset.i18n` + `dataset.i18nParams` JSON + `applyI18nDataset(statusEl)` 経路に統一して言語切替時に古い data-i18n 属性で上書きされる退行を解消、(b) `refreshSendButtonTooltip` も同じく `dataset.i18nDataTooltip` + `i18nParams` 経路に統一して未使用だった `comments.write_feedback_tooltip_*` 辞書を活用、を実施。`vp check` / `vp test` (全 1352 tests + 4 skipped) 通過。Step 5 の起動シーケンス (`initLangFromBrowser` + `applyI18nDataset(document)`) が未配線のため、現状はすべて en 辞書を引いて従来表示と一致。

スコープ外として Step 6 に持ち越し:

- `src/app/online/source-display.ts` の `buildSourceLinkHtml` → `buildSourceLinkElement` 書き換え (innerHTML 経路を DOM API に置換 + `online.label.source` 翻訳)
- toolbar 内 `#cmt-count` の textContent 動的更新を subscribeLangChange 連動に変える dataset 化 (現状 `commentCountLabel` 関数で翻訳済み文字列を生成するだけ)
- toast / modal の表示中 toggle 追従 (生存期間ベースの判断、Step 6 §3.5 参照)

- `src/review.html` の文言（約 60 個）を `data-i18n` 属性化して辞書に登録
- `src/app/chrome/*.ts` / `src/app/document/*.ts` の動的文言（約 15 個 / toast / modal）を `translate(key)` 呼び出しに置き換え
- 既存の日本語混在（`review.html:389,393` の URL 読み込み失敗 empty state）を `empty.url_failed.*` キーに集約
- `messages.en.ts` / `messages.ja.ts` の両方を埋める

成果物: 辞書 2 言語 fully populated、`src/review.html` から生英文字列が消える、`grep -nE '"[A-Z][a-z ]+"' src/review.html` が空に近づく

### Step 4: (完了済み) CLI 自体の言語決定（HTML 側には作用させない）

**状態**: **完了済み** — 本 Step の commit (本ファイルの状態行追記を同梱)。`src/cli/preextract-lang.ts` を新規追加 (24 tests) し、`main()` を `bootstrapCliLang` (extractLang → setCliLang → help 最優先 → langError reject) + `dispatchParsedMode` (run / clean / invalid) に 2 段階分割。`help-text.ts` を `HELP_TEXT` 定数から `getHelpText()` 関数化、`cli.help.{usage,description,arguments_block,options_block,cleanup_block,examples_block}` 6 block を改行連結 (`--lang` 行を options に追加)。`flag-parser.ts` / `parse-run-args.ts` / `parse-clean-args.ts` / `review-request.ts` のエラーメッセージ、`open-command.ts` / `serve.ts` / `compose-review-html.ts` / `clean-format.ts` / `assets/{katex,mermaid,resume-feedback,shiki}.ts` の stdout / stderr 経路を `translateCli` 化。README.md / README_ja.md / docs/DESIGN.md の CLI オプション表に `--lang` 行を追加。`vp check` / `vp test` (全 1386 tests + 4 skipped) 通過。実装過程で計画から 1 点の仕様変更 (§3.3 の「invalid → valid 上書きで error クリア」を「不正値を保持する」へ — Step 4 セルフレビューで `--lang fr --lang en` が silent に success して `flag-parser.ts:262` の既存挙動と不整合だと判明) を反映済み。

**bootstrap シーケンス**: CLI entry (`src/cli/review-request.ts` の `main()`、line 53 周辺) で `extractLang(rawArgv, env)` を **モード判定 / `parseArgs` / `parseCleanArgs` より先に** 呼び、戻り値 `{ lang, argv, error }` を以下の優先順序で処理する: (1) `setCliLang(lang)` で state 確定、(2) `argv.some(t => HELP_FLAGS.has(t))` が true なら即 help 表示（`parse-args.ts:29-35` の既存 **help 最優先契約** を維持）、(3) `error !== null` なら `translateCli` で reject (exit 2)、(4) `parseArgs(argv)` / `parseCleanArgs(argv)` のモード判定。`main()` は内部で mode 別に `help` / `invalid` / `clean` / `run` を分岐させるが (`review-request.ts:55-66`)、どの mode に分岐しても以降の `parseArgs` / `runClean` / `runEmbed` / `openOutput` / `serve` は `translateCli(key, params)` を内部で呼ぶ **module-local pattern**（`src/cli/i18n.ts` の state を参照）。CLI は短命プロセスで toggle がないため、bootstrap で 1 回 `setCliLang` してから固定。

- **`--lang` はサブパーサ非依存のグローバル メタフラグ**として扱い、`arg-spec.ts` (run parser) と `parse-clean-args.ts` の `CLEAN_FLAG_TABLE` のどちらにも追加しない。代わりに bootstrap の `extractLang` で argv から除去し、サブパーサは `--lang` の存在を知らずに動く（§3.3）。理由: (a) run / clean のドメインに属さないため両方に no-op 項目を入れる構造的根拠がない、(b) 仮に `arg-spec.ts` だけに追加すると `mdxg-redline --clean ./reviews --lang ja --yes` が `parse-clean-args.ts:93-94` の unknown option チェックで落ちる、(c) 事前 strip と lang 抽出は単一トラバーサルで完結し、追加コードは 30 行程度
- 仕様の意味付け: `--lang` 値は `auto` / `en` / `ja` の 3 値。`auto` の語彙は既存 `--shiki-langs auto` / `--mermaid auto` / `--math auto` と整合（Step 1.5 調査済み）。**ただしセマンティクスは異なる**: 既存 auto は「markdown 内容をスキャンして注入対象を自動判定」だが `--lang auto` は「`$LC_ALL` / `$LC_MESSAGES` / `$LANG` env から自動推定」。help text (`cli.help.options_block` 内 `--lang` 項目) と §3.3 表に両者の差異を明示する
- **不正値 / 値欠落の扱い** (セルフレビュー反映、`extractLang` がエラー情報を返す構造):
  - `--lang fr` / `--lang spec.md` のような **不正値**: 2 トークンを消費し `error = { kind: 'invalid_value', token }` を記録。次トークンが入力ファイル名や別フラグでも silent に流さず、reject パスで気づかせる
  - `--lang` 末尾欠落 / `--lang --clean` / `--lang --help` / `--lang -h` のような **値欠落** (次トークンが undefined / `--` で始まる / `HELP_FLAGS.has(next)` で `-h` / `--help` の場合): `--lang` のみ除去、次トークンは argv に保持。`error = { kind: 'missing_value' }` を記録。**`--lang --help` / `--lang -h` で help フラグが消えないこと**、および help 最優先契約 (`parse-args.ts:35`) により help 表示が error reject に優先することを構造的に保証 (`-h` は `--` prefix を持たない短形式だが HELP_FLAGS 経由で同等に扱う)
  - **後勝ち + 不正値の保持**: 有効値同士の重複は後勝ち (`--lang ja --lang en` → lang=en、error=null)、ただし**一度検出した不正値は後続の有効値で握り潰されず保持される** (`--lang fr --lang en` → lang=en、error=invalid 'fr' → bootstrap で reject、`--lang en --lang fr` も同様に lang=en stays + error=invalid 'fr'、`--lang ja --lang fr --lang en` → lang=en + error=invalid 'fr')。これは `flag-parser.ts:262` の「不正値検出後に解析を停止する (`if (!acc.valid) return acc`)」モデルと整合させるため。Step 4 セルフレビューで「後勝ちで error クリア」する旧仕様だと `--lang fr --lang en` が silent に success してしまう (`flag-parser.ts:150-178` の既存値フラグ群と挙動不整合) と判明したため、この方針に変更
  - **`=` 区切り**: `--lang=ja` は `flag-parser.ts:228-256` の pending pattern が space 区切り only のため本実装でも非対応で揃える
- `src/cli/preextract-lang.ts` を新規追加: `extractLang(argv, env): LangExtractResult` を提供（§3.3 のコード参照）。pure 関数として env を引数で受け、`detectLangFromEnv` を内部で呼ぶ
- `src/cli/review-request.ts` の `main()` 冒頭で次の順序で呼ぶ:

  ```ts
  const rawArgv = process.argv.slice(2)
  const { lang, argv, error } = extractLang(rawArgv, process.env)
  setCliLang(lang)

  // (1) help は最優先 (既存契約 parse-args.ts:29-35 と整合)。
  //     --lang fr --help / --lang --help でも help を表示し、lang error は表示しない。
  if (argv.some((t) => HELP_FLAGS.has(t))) {
    process.stdout.write(getHelpText())
    return
  }

  // (2) --lang 起因のエラーは help が無い場合のみ reject。
  if (error !== null) {
    const message =
      error.kind === 'invalid_value'
        ? translateCli('cli.error.invalid_lang') // 値詳細は別 placeholder で受ける形に拡張可
        : translateCli('cli.error.missing_flag_value', {
            flag: '--lang',
            expected: 'auto, en, ja',
          })
    process.stderr.write(`mdxg-redline: ${message}\n`)
    process.exit(2)
  }

  // (3) 通常モード判定。argv は strip 済みなのでサブパーサに `--lang` が漏れない。
  ```

  `clean-command.ts` という別エントリは存在せず、`clean` モードは同じ `main()` 内の分岐 (`review-request.ts:58-64`) で `clean.ts` の `runClean` を呼ぶ構造

- 通常解析 (`parseArgs`、`src/cli/parse-args.ts`) は CLI state の lang を `translateCli` で参照しつつ、不正値検出時はその lang でエラー文言生成
- `src/cli/help-text.ts` を `HELP_TEXT` 定数から `getHelpText(): string` に変更（module-local state を参照）
- `src/cli/error-message.ts` の `errorMessage` / `formatInvalidArgsMessage`（現状 `review-request.ts:34` 内に inline）も同パターン
- `src/cli/parse-run-args.ts` / `parse-clean-args.ts` の error message も同パターン

**全 stderr / stdout 経路の辞書化**（セルフレビュー反映で網羅）。再 Step 1.5 で抽出した CLI 側辞書 (`cli.*` 配下 21 entry) を以下の経路で使う:

| 経路                                                | 該当ファイル                                                                                                                                                                                                                      | 関連 key                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ブラウザ起動失敗                                    | `src/cli/open-command.ts:70`                                                                                                                                                                                                      | `cli.error.browser_launch_failed`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| KaTeX 検出報告 / script escape 報告                 | `src/cli/assets/katex.ts:81-89`                                                                                                                                                                                                   | `cli.katex_injection`, `cli.katex_escaped_script`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Mermaid 検出報告 / script escape 報告               | `src/cli/assets/mermaid.ts:53-57`                                                                                                                                                                                                 | `cli.mermaid_injection`, `cli.mermaid_escaped_script`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| feedback 再開報告 / 警告                            | `src/cli/assets/resume-feedback.ts:84,106,112,170`                                                                                                                                                                                | `cli.feedback_{resumed,read_failed,invalid_json,hash_mismatch}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ポート警告 (Codespaces fallback)                    | `src/cli/serve.ts:39,85,111,174`                                                                                                                                                                                                  | `cli.port_{invalid,in_use_fallback}`, `cli.serve_{address_failed,remote_started}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 引数 reject エラー (外枠)                           | `src/cli/review-request.ts:34`                                                                                                                                                                                                    | `cli.error.{invalid_arguments,invalid_lang}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 引数 reject エラー (詳細、`{detail}`)               | `src/cli/flag-parser.ts:94-100`, `parse-run-args.ts:121-126`, `parse-clean-args.ts:62-75`                                                                                                                                         | `cli.error.{invalid_flag_value,missing_flag_value,unknown_option,missing_input_markdown,too_many_positional_args,clean_specified_multiple}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| help テキスト                                       | `src/cli/help-text.ts` の `HELP_TEXT` 定数                                                                                                                                                                                        | `cli.help.{usage,description,arguments_block,options_block,cleanup_block,examples_block}` (block 形式。`--lang` は `options_block` 内に他オプションと同一フォーマットで含める)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| online 版 URL 入力フォーム                          | `src/app/online/open-url-modal.ts:94,147`, `source-display.ts:38`                                                                                                                                                                 | `online.{error.empty_url_input,help.url_rewritten,label.source}` (UI 辞書側に配置)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `--clean` の stdout (dry-run / 実削除)              | `src/cli/clean-format.ts:14-37`                                                                                                                                                                                                   | `cli.clean.{no_files_found,dry_run_header,kept_header,run_with_yes_hint,deleted_summary,kept_summary}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| asset 欠落例外 (template / mermaid / shiki / katex) | `src/cli/compose-review-html.ts:44`, `assets/{mermaid,shiki,katex}.ts`                                                                                                                                                            | `cli.error.asset_missing` (`{path}` と `{target}` placeholder で汎用化、4 経路で共通使用)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 想定外の最上位例外 (safety net)                     | `src/cli/review-request.ts:78-80` の `main().catch(...)`                                                                                                                                                                          | `cli.error.unexpected` (`{message}` placeholder。Node 標準の Error.message は英語のまま流し込み、外枠だけ翻訳)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| CLI rewrite で paint 前に確定するステータス表示     | `src/core/embed/html-rewrite.ts:40` の `formatLoadedStatus(docName, docHash)` + 新規 `rewriteStatusI18nAttrs(html, params)` (`#status` opening tag に `data-i18n` + `data-i18n-params` を `setOrInsertAttribute` で upsert、§3.5) | `toolbar.status_loaded` を `data-i18n="toolbar.status_loaded"` + `data-i18n-params="{&quot;docName&quot;:...,&quot;docHash&quot;:...}"` で埋め込み。`rewriteReviewHtml` で既存 `rewriteInitialStatus` (本文書き換え) と `rewriteStatusI18nAttrs` (opening tag 属性 upsert) を順に呼ぶ。起動時 `applyI18nDataset` と toggle 時 `subscribeLangChange` で再描画                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 脚注 backref aria-label                             | `src/core/footnotes.ts:139` の `buildBackrefHtml` (orphan path) + marked-footnote 1.4.0 default backref (通常 path)                                                                                                               | `footnote.backref_aria`（`{label}` placeholder）。**統一 post-process 戦略**: `core/markdown.ts` 経由のフラグメント生成直後に `section[data-footnotes] a[data-footnote-backref]` を querySelectorAll し、各要素から `href="#footnote-ref-<label>"` の `<label>` を抽出して `data-i18n-aria-label="footnote.backref_aria"` + `data-i18n-params='{"label":"<label>"}'` を upsert、native `aria-label` は削除して i18n に委譲。orphan path 側 (`buildBackrefHtml`) も `aria-label` を埋めずに同じ post-process で attribute を付ける。`applyI18nDataset` walker の `[data-i18n*]:not(#doc *)` セレクタを `[data-i18n*]:not(#doc *), #doc [data-footnote-backref][data-i18n-aria-label]` に拡張（`[data-footnote-backref]` は `text-segment-skip-rules.ts:44` で既にアンカリング skip 対象のため textContent 不変条件は壊さない）。起動時 `applyI18nDataset` + toggle 時 `subscribeLangChange` で再描画 |

Shiki grammar 検出は構造的に CLI 側からの static 報告経路がない（再 Step 1.5 で確認）ため i18n 対象外。`flag-parser.ts` の `*_VALUE_HELP` 定数（例: `'system, light, or dark'`）は `{expected}` placeholder で error message に流し込まれるが、本プランでは **value_help 自体は英語固定** とする（arg-spec.ts の値仕様は CLI コマンドライン契約の一部で `--theme system` 等の英語値を指すため、それを説明する文字列も英語の方が直感的）。

**`{detail}` の二段構造（セルフレビュー反映）**: `cli.error.invalid_arguments` の `{detail}` placeholder には、parser 側で `translateCli('cli.error.invalid_flag_value', {flag, token, expected})` 等の専用 key を使って生成した翻訳済み文字列を流し込む。これにより「日本語の枠 + 英語の詳細」混在を解消。

- `src/cli/compose-review-html.ts` には `<html data-lang-init>` 等の lang 関連属性を一切埋め込まない（CLI と HTML の責務分離、§5.a）
- **辞書の物理分割により、online 版への辞書再 inject は不要**: online 版 (`dist/hosting/index.html`) は `buildOnlineHtmlFromStandalone` で standalone HTML を派生して生成される。standalone HTML には UI 辞書 (`messages.en.ts` / `messages.ja.ts`) が既に inline 済みなので、online 派生処理で再度 inject する必要はない（前回計画の二重 inject を解消）。online build plugin は CSP allowlist / asset manifest / shiki/mermaid/katex の空 stub 化のみを担う
- **CLI bundle と HTML bundle の辞書分離**: CLI bundle (`dist/review-request.mjs`) は `src/cli/i18n/messages-cli.{en,ja}.ts` (`cli.*` 36 entry) のみ import、HTML bundle (`dist/standalone.html` / `embed-template.html` 経由) は `src/app/i18n/messages.{en,ja}.ts` (UI 辞書 155 entry、`online.*` / `footnote.*` 含む) のみ import。それぞれ独立した tree なので bundle 重複なし

成果物: `npx mdxg-redline --lang ja --help` で日本語 help、`LANG=ja_JP.UTF-8 npx mdxg-redline path/to/file.md` で KaTeX 検出報告 / port 警告 / feedback 再開報告も全て日本語、生成 HTML は CLI の `--lang` に関わらず常に `localStorage > navigator.language > 'en'` の規則で初期言語を決定する

### Step 5: (完了済み) HTML 側の起動シーケンスと toggle UI

**状態**: **完了済み** — 本 Step の commit (本ファイルの状態行追記を同梱)。`src/review.html` の `<html lang>` を `ja` → `en` に変更し、head inline script で localStorage / navigator / DOM 反映の 3 段独立 try/catch + 3 秒 setTimeout fallback を実装。`<style id="i18n-pending-style">` + `<noscript>` で FOUC 回避用 CSS を inline。toolbar に EN/JA 2 state toggle button (`#btn-lang`) を追加 (`data-i18n-aria-label` / `data-i18n-data-tooltip` 経路、textContent は machine contract で翻訳しない)。`src/styles/review.css` の `content: 'Loading…'` を `content: var(--ui-loading-text, 'Loading…')` に変更し `applyCssPseudoBindings` で言語切替に追従。`src/app/app-wiring.ts` に `bootstrapI18n()` を新設し `bootstrapReviewApp` 冒頭で `initLangFromBrowser` → `applyI18nDataset(document)` → `I18N_PENDING_CLASS` 解除を順に実行 (max-statements 制約のため `setupChromeAndNavigation` を切り出し)。`src/app/chrome/toolbar.ts` に `wireLangToggle` を追加して click ハンドラ + `subscribeLangChange` で button textContent を追従させる。`src/app/dom/text-segment-skip-rules.ts` の `SKIP_RULES` に `.lang-toggle` を加え (toolbar 要素は通常 `#doc` 配下に出ないが防御層として宣言テーブルに含める)。test を 5 件追加 (bootstrapI18n の 3 件 + renderLangButton の 1 件 + SKIP_RULES `.lang-toggle` の 1 件)。bootstrapI18n describe block には beforeEach/afterEach で localStorage / `<html lang>` / class / style / body innerHTML を reset する helper を追加し、cross-test の i18n state リークを構造的に防止。`vp check` / `vp test` (全 1391 tests + 4 skipped) 通過。実装過程でセルフレビュー指摘を 2 件反映 (`wireLangToggle` click handler のコメント文と実装の coherence 修正 / bootstrapI18n の真の idempotency 検証 = i18n-pending class 再付与してから 2 回目呼び出しで再解除を確認)。**動的生成要素の言語切替追従 (theme button textContent / コメントカード / page-nav の Prev/Next / search 件数 / modal 文言 / source-display) は本 Step ではスコープ外で、Step 6 (§3.5 動的 UI 購読パターン) で対応する。**

既存 theme 解決パターン（`review.html:38-52` の inline script、`src/app/chrome/theme.ts` の `readStored* / writeStored* / nextStored* / subscribeSystemTheme`）と同じ shape で揃える（Step 1.5 調査済み）。ただし theme は CSS 変数だけで完結するため `<html.dark>` の付与で FOUC 回避できるのに対し、lang は DOM テキスト差し替えが必要なため **別途 FOUC 戦略が必要**（セルフレビュー 2 反映）。

- `src/review.html:2` の `<html lang="ja">` を **`<html lang="en">` に変更**（§5.e で確定した既定言語 `'en'` と整合させ、inline script が失敗 / ブロックされたケースの fallback も既定言語に倒す）
- `src/review.html` の `<head>` inline `<style>` と `<noscript>` で FOUC 回避用 CSS を定義:

```html
<style id="i18n-pending-style">
  html.i18n-pending body {
    visibility: hidden;
  }
</style>
<noscript>
  <style>
    html.i18n-pending body {
      visibility: visible !important;
    }
  </style>
</noscript>
```

- `<head>` inline `<script>` で **localStorage / navigator / DOM 反映の 3 つの try/catch に分離**（セルフレビュー反映: localStorage 失敗時に navigator fallback が走るようにする）+ **3 秒タイムアウト fallback**（module 読み込み失敗時の永久ホワイトアウトを回避）:

```html
<script>
  ;(function () {
    // 1. localStorage 読み取り (Private モード等の例外を navigator から分離)
    var stored = null
    try {
      var raw = localStorage.getItem('mdxg-redline.lang')
      if (raw === 'en' || raw === 'ja') stored = raw
    } catch (e) {}
    // 2. navigator.language 判定 (localStorage が失敗してもここは走る)
    var nav = 'en'
    try {
      if (navigator.language && /^ja(_|-|$)/i.test(navigator.language)) {
        nav = 'ja'
      }
    } catch (e) {}
    var lang = stored || nav
    // 3. DOM 反映 (i18n-pending 付与 + 3 秒タイムアウト fallback)
    try {
      document.documentElement.lang = lang
      document.documentElement.classList.add('i18n-pending')
      setTimeout(function () {
        // タイムアウト発火時に i18n-pending がまだ付いていれば module 失敗とみなす
        // (正常時は applyI18nDataset 完了で既に class が外れているため if で skip)
        if (document.documentElement.classList.contains('i18n-pending')) {
          // 静的 HTML は en 固定なので、AT 読み上げ言語と表示言語の整合を取るため
          // lang を 'en' に戻す。日本語 UI への期待を AT に与えず、accessibility を保つ
          document.documentElement.lang = 'en'
          document.documentElement.classList.remove('i18n-pending')
        }
      }, 3000)
    } catch (e) {}
  })()
</script>
```

- `noscript` で JS 無効時も visibility:visible にする (CSS specificity で `!important` を勝たせる)
- 既存 critical CSS（theme 変数 / レイアウト計算）は `i18n-pending` の影響を受けないため、レイアウトシフトは発生しない
- `src/app/i18n/i18n-browser.ts` に `readStoredLang()` / `writeStoredLang(value)` / `nextStoredLang(current)` / **`initLangFromBrowser()`** を実装（`theme.ts` と同パターン、localStorage key は `'mdxg-redline.lang'`）
- `<body>` の `<script type="module">` 経由で **`initLangFromBrowser()` を最優先で呼んで module-local の `currentLang` state を確定 + `<html lang>` を再同期**（セルフレビュー反映: head script は `<html lang>` を設定するだけで `i18n-browser.ts` の state には反映されないため、bootstrap で明示的に state を同期する。加えて head script の setTimeout fallback で lang="en" に戻されたケース (module 遅延成功) でも整合させるため、`<html lang>` も再同期する）。localStorage 書き込み / subscriber 通知は走らず idempotent
- `initLangFromBrowser()` の直後に **各動的 UI モジュールの `setupXxxI18n()` を 1 回ずつ呼ぶ** (`setupOnlineSourceI18n()` 等、Step 6 の対象モジュール分。§3.5 の動的 UI 購読パターン参照)。これにより各モジュールが `subscribeLangChange` を 1 回だけ登録し、文書を何度読み込んでも listener が累積しない
- 続けて `applyI18nDataset(document)` を実行（walk セレクタは §3.5 の複合セレクタ）+ **CSS 疑似要素の content を CSS custom property 経由で更新**（`document.documentElement.style.setProperty('--ui-loading-text', "'" + translate('empty.loading_text') + "'")`、§3.5 の CSS 疑似要素経路を参照）
- `applyI18nDataset` 完了直後に `document.documentElement.classList.remove('i18n-pending')` を呼んで visibility を解除（タイムアウトより早い）
- toolbar に EN/JA toggle button を追加（`toolbar.ts:173-183` の theme toggle click ハンドラと同じパターン、`nextStoredLang` で 2 state 循環）
- toggle 押下で `setLang(next)` を呼ぶ。`setLang` 内の処理順は §3.5 / Step 2b 参照 (state → `<html lang>` → `applyI18nDataset` → subscribers 通知 → `writeStoredLang` の順。永続化は最後で、storage 障害時もセッション内 toggle が機能する)。toggle 時は既に visible なので `i18n-pending` 付与は不要
- comments/selection の textSegments skip セレクタに `.lang-toggle` を追加

**FOUC 回避戦略の前提と失敗パターン**:

- `applyI18nDataset` の所要時間は `querySelectorAll` 1 回 + 約 165 要素の dataset 読み + 属性 / textContent 書き換えで合計 1ms 未満を想定。`visibility:hidden` 期間は人間が知覚できないレベル
- `<script type="module">` の defer 相当の起動順序により、HTML parse 完了直後に i18n が適用される
- **module 失敗時の保険**: 3 秒タイムアウトで強制的に `i18n-pending` を解除。CSP block / 404 / parse error / JS error いずれでも 3 秒後には英語 UI が表示され、画面が真っ白なまま固まらない。**さらに `i18n-pending` がまだ付いていれば `<html lang>` を `'en'` に戻す**（セルフレビュー反映: 日本語ブラウザで module が失敗すると静的 HTML の英語 UI が `<html lang="ja">` のまま表示され、AT 読み上げが「英語テキストを日本語として発音」する不整合を解消）
- **JS 無効時の保険**: `<noscript>` 内の `visibility: visible !important` で初期描画時に hidden を打ち消す。i18n は効かないが英語 UI が静的に表示される
- 3 秒の根拠: 典型的な module fetch は 100ms 以下、最悪のネットワーク遅延でも 1 秒程度。3 秒は「失敗確定」の判定として人間の体感（「壊れた」と感じ始める閾値、約 5 秒）より短く、正常時には絶対に発火しない安全域

成果物: 起動時に正しい言語で UI が出る（英語→日本語のチラつきなし）、toggle 押下で全 UI が切替わる、リロード後も維持される、**JS エラー / CSP block / JS 無効いずれの場合も画面が真っ白にならない**

### Step 6: 動的生成要素の言語切替対応

**前提**: 本 Step で `src/app/document/load-document.ts` を **factory パターン** で新設し、文書ロード経路を共通 API に統一する (§3.5 文書ライフサイクル hook)。具体的には:

1. `createDocumentLoader(baseLoader)` factory を新設 (§3.5 擬似コード参照)
2. **`src/app/app-wiring.ts` の `BootstrapDeps` 組み立て**で、既存の **online asset decorator (Mermaid / KaTeX / Shiki lazy fetch) 適用済みの `loadFromMarkdown`** を `createDocumentLoader` に渡して loader を作成
3. 戻り値の `loadDocument` / `registerOnDocumentLoad` を `BootstrapDeps` に追加し、`boot.ts` / `paste-markdown-modal.ts` / Open file ハンドラ / embedded MD フォールスルーの各 callsite に **inject**
4. `loadFromMarkdown` を `src/app/review.ts` から直接 export しない (internal 限定、`app-wiring.ts` のみが参照する)。Step 6 完了後に `grep -rn "loadFromMarkdown(" src/` で「app-wiring.ts と review.ts 内部呼び出し以外で参照ゼロ」を検証

これで (a) 循環依存回避 (`load-document.ts → review.ts` の direct import なし)、(b) decorator バイパス防止、(c) 動的 UI モジュール (source-display 等) が `registerOnDocumentLoad` で文書切替を購読、(d) 各入力経路で個別に `clearOnlineSource()` / `showOnlineSource(url)` を呼ぶ必要がなくなる。Step 6 着手時の最初の作業として実施。

- `src/app/chrome/toolbar.ts` の `THEME_LABEL` 等を辞書化（既に定数化されているので置き換えやすい）
- `src/app/comments.ts` / `comment-modal.ts` / `workspace.ts` / `code-copy-wrap.ts` の各 toast / modal 動的生成を `translate()` 呼び出しに置き換え
- **`src/app/chrome/paste-markdown-modal.ts`**: 読み込み失敗 (`modal.paste_markdown_load_failed`) と空入力エラー (`modal.paste_markdown_empty_error`) の `showInputError` 呼び出しを `translate()` 化、`subscribeLangChange` で表示中エラー文言も追従 (modal が開いたままバリデーション失敗が出るケース)。**§3.5 の動的 UI 購読パターン (4 関数) を適用**: `setupPasteMarkdownModalI18n()` を bootstrap で 1 回呼び、`currentError: {key, params?} | null` state を保持、modal close 時 / エラークリア時に state も clear。`teardownPasteMarkdownModalI18n()` で lang 購読解除 + state null + DOM 初期化 (test fixture / HMR 対応)
- **`src/app/workspace/workspace-fs.ts`**: File System Access API 非対応ダイアログ (`dialog.fs_access_unsupported_{title,body}`) の `noticeDialog` 呼び出しを `translate()` 化
- **`src/core/review-export.ts:73` の `commentCountLabel(n)` を辞書化** (セルフレビュー反映で計画漏れを解消): 現状の英語固定実装 (`1 comment` / `N comments`) を `translatePlural('comments.count_label', n)` に置換。callsite は `src/app/review.ts` / `src/app/workspace/workspace.ts` / `src/app/chrome/toolbar.ts` / `src/app/boot.ts` 等。**core/app 責務境界の判断**: `commentCountLabel` は HTML / CLI 両方の bundle に乗る可能性があるが、本実装では CLI から呼ばれない (toast / status 表示用) ため `src/app/comments/comment-count-label.ts` に **移動** し、HTML bundle 専用とする (CLI bundle に巻き込まない)。`src/core/review-export.ts` には他の純粋関数 (export 整形等) のみ残す
- **boot.ts の `formatFetchFailureMessage` 内の validation 経路**: `{reason}` placeholder に流す値を `translate('empty.validation_reason_${reason}')` で日本語訳に変換してから `translate('empty.url_failed_validation', {reason: ..., url})` に渡す二段構造 (`{detail}` の二段構造と同じパターン)。reason は `malformed` / `scheme_not_https` / `host_not_allowlisted` の 3 種類 (再々々セルフレビューで確定)
- **`src/app/boot.ts:297` の `showOnlineError('online edition は http(s)...')` を辞書化** (セルフレビュー反映): 既存日本語ハードコードを `translate('online.error.not_http_hosted')` に置換、`subscribeLangChange` で `#empty-state-online-error` を再描画
- **`src/app/online/source-display.ts:35` を `buildSourceLinkHtml` → `buildSourceLinkElement` に書き換え** (セルフレビュー反映で §11 セキュリティ方針との整合): 現状の innerHTML 文字列構築は **辞書値を innerHTML 経路に流す** 設計違反 (§3.5「辞書値は textContent / attribute 経路でのみ書き込み」)。修正案:

  ```ts
  // buildSourceLinkHtml (string 返却) → buildSourceLinkElement (HTMLSpanElement 返却) に置換
  export const buildSourceLinkElement = (url: string): HTMLSpanElement => {
    const wrapper = document.createElement('span')
    // 辞書値は textContent 経路で安全に挿入 (innerHTML 非経由)
    wrapper.appendChild(document.createTextNode(translate('online.label.source')))
    if (isHttpsUrl(url)) {
      const a = document.createElement('a')
      a.className = 'toolbar-source-link'
      a.href = url // setAttribute と同等、属性経路で安全
      a.rel = SOURCE_LINK_REL
      a.referrerPolicy = SOURCE_LINK_REFERRER_POLICY
      a.target = SOURCE_LINK_TARGET
      a.textContent = url // textContent 経路 (defense-in-depth)
      wrapper.appendChild(a)
    } else {
      wrapper.appendChild(document.createTextNode(url))
    }
    return wrapper
  }
  ```

  caller `showOnlineSource` は `el.replaceChildren(buildSourceLinkElement(url))` で `#online-source` を更新。**全 key で同じ信頼境界 (textContent / attribute 経路のみ) を保ち**、key 単位の例外管理が不要になる。

  **状態管理と購読パターン**: **§3.5 の正規例 (`setup` / `show` / `clear` / `teardown` の 4 関数 + `registerOnDocumentLoad` 経由の文書切替購読) を参照**。Step 6 ではコード例を二重管理しない (ドキュメントの単一情報源原則)。bootstrap (`boot.ts` の `initLangFromBrowser()` 直後) で `setupOnlineSourceI18n({registerOnDocumentLoad})` を 1 回だけ呼ぶ。**`setupOnlineSourceI18n` 内で `subscribeLangChange` (lang toggle 用) + `registerOnDocumentLoad` (文書切替用) の 2 経路を登録**。文書切替時の `showOnlineSource(url)` / `clearOnlineSource()` 呼び出しは **`loadDocument` 経由の hook が自動的に行う** (§3.5 文書ライフサイクル hook 参照)。これで listener leak / state リーク / toggle 時の古い URL 復活 / **URL 文書後にローカル文書を開いた時の Source 残留** を構造的に防ぐ

- **`src/app/review.ts:50` の JS 動的読み込み経路** (セルフレビュー反映で計画漏れを解消): 現状 `formatLoadedStatus(docName, docHash)` の戻り値を `#status` span の textContent に直接代入していたが、Open file / Paste markdown / online 読み込み完了時に英語固定 + toggle 無追従になる。修正: (1) JS から `#status` 要素の dataset を更新する (`el.dataset.i18n = 'toolbar.status_loaded'; el.dataset.i18nParams = JSON.stringify({docName, docHash})`)、(2) その直後に `applyI18nDataset(el)` を呼んで初期描画 (§3.5 の root 包含対応で `el` 自身も翻訳対象になる)、(3) `subscribeLangChange` リスナで toggle 時に同じ要素を再描画。CLI rewrite 経路 (paint 前 dataset 埋め込み) と JS 動的経路 (起動後 dataset 更新) で **同じ `#status` 要素を共有** するため、両経路で同一 dataset 構造を使い構造的整合を保つ
- **`src/app/navigation/page-navigation-render.ts`**: Prev / Next ボタンの textContent (`page_nav.{prev,next}_button`) と aria-label (`page_nav.sequential_nav_aria`) を `translate()` 化、`subscribeLangChange` でレンダリング済み Prev/Next を再描画（セルフレビュー反映: page-nav が動的生成にもかかわらず購読対象から漏れていた）。**§3.5 の動的 UI 購読パターン (4 関数) を適用**: `setupPageNavI18n()` を bootstrap で 1 回呼び、`currentPages: readonly Page[] | null` state を保持、`clearPageNav()` で state クリア。文書を複数回開く場合の listener 重複を構造的に防止。`teardownPageNavI18n()` で全 subscription 解除 (test 用)
- **`src/app/search/search-dom.ts`**: 検索件数表示 (`search.no_results` / `search.count_{one,other}` / `search.current_match`) を `translate()` / `translatePlural('search.count', total)` で生成、`subscribeLangChange` で表示済み件数を再描画（セルフレビュー反映: 検索 UI 動的生成も購読対象から漏れていた）。**§3.5 の動的 UI 購読パターン (4 関数) を適用**: `setupSearchI18n()` を bootstrap で 1 回呼び、`currentSearch: {total, current} | null` state を保持、検索クローズ時に `clearSearch()` で state クリア (検索を複数回開閉する利用パターンで listener が累積しない)。`teardownSearchI18n()` で全 subscription 解除 (test 用)
- 各モジュールに `subscribeLangChange` リスナを 1 つずつ追加し、**開いている modal / page-nav の Prev/Next / 検索件数は再描画** (持続的に表示される動的 UI は追従必要)、**表示中 toast は追従しない** (1.5-3 秒で自動消滅するため次回表示分から翻訳反映で十分、実装コスト vs UX 価値の判断)。動的 UI / toast の境界は **生存期間** で線引き

成果物: toggle 時に動的生成済み UI も追従、modal を開いたまま toggle しても破綻しない

### Step 7: 既存設計との整合確認

- DESIGN.md §6 アンカリング: `<html lang>` 切替でアンカリングの textContent 計算が変わらないことを確認（CLI からの追加属性は埋め込まないので考慮外）
- DESIGN.md §10 検索: 検索ハイライト中に toggle しても検索結果が壊れないことを確認（chrome 側の文言が変わるだけで `#doc` は不変なので、検索 mark は影響を受けないはず）
- DESIGN.md §1 Theming: lang toggle / theme toggle の併用で `<html data-theme>` / `<html lang>` がそれぞれ独立に動くことを確認
- DESIGN.md §9 起動シーケンス: lang 解決が paint 前に終わって FOUC（言語チラつき）が起きないことを確認

成果物: 既存 in-source test 全通過 + 新規 regression テスト（アンカリング / 検索 / theme との共存）

### Step 8: DESIGN.md / README 反映と本ドキュメントの archive

- DESIGN.md に **§14 UI 国際化** を新設し、§3.1〜3.6 の内容を統合
- DESIGN.md §9 起動シーケンスに「lang 解決」のステップを追記（theme 解決の直後 / paint 前）
- DESIGN.md §13 ビルドパイプラインに「CLI は HTML への lang 関連属性埋め込みを行わず、HTML 側で localStorage / navigator.language により独立に決定する」旨を追記（CLI と HTML の責務分離を明示）
- DESIGN.md §11 セキュリティとプライバシーに「辞書値は textContent / attribute 経路でのみ書き込み、innerHTML には注入しない」旨 (source-display の `buildSourceLinkElement` も DOM API 構築で本方針に従う、§Step 6) と、**`data-i18n-params` の CLI 埋め込みでは `formatI18nParamsAttr` で `JSON.stringify` 後に HTML escape (`"` → `&quot;`, `<` / `>` / `&`) を施し double quote 区切り属性に埋め込み (既存 `setOrInsertAttribute` と整合)、`docName` 等の user 由来文字列が属性パース破綻 / XSS 経路にならないこと** を追記
- `README.md` / `README_ja.md` の CLI オプション表に `--lang` 行を追加、online 版の言語自動判定の説明を追記
- `docs/archive/mdxg-virtual-pages.archive.md` の「i18n しない」記述に「§14 で上書き決定」のメモを足す（archive は基本書き換えないが、参照される可能性があるため例外的に追記）
- 本ドキュメントを `docs/archive/feature-ui-i18n.archive.md` にリネーム

成果物: DESIGN.md §14 が live、本ドキュメントが archive 化

## 5. 設計判断

### a. 言語切替の手段（CLI と HTML の責務分離）

| 候補                                                                | 採用 | 理由                                                                                                                                                                                                  |
| ------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. ランタイム toggle のみ（CLI は CLI 出力のみ制御）**            | ✓    | CLI は CLI 自体の体験（help / stderr）だけに責務を絞り、HTML はブラウザ環境とユーザー選択で独立決定。CLI と HTML を疎結合に保てる。CLI 生成版と online 版で挙動が揃う                                 |
| B. ハイブリッド（CLI が `<html data-lang-init>` 埋め込み + toggle） | ✗    | CLI と HTML を結合する分、`<html data-lang-init>` 属性の追加・compose-review-html.ts の upsert ロジック・優先順位設計が必要になる。レビュー依頼者が初期言語を伝える効果に対し、責務分離の犠牲が大きい |
| C. CLI 経由でビルド時固定（toggle なし）                            | ✗    | レビュワーが受け取った review HTML を母語で見られない。配布元の意図に縛られる                                                                                                                         |

採用案の論点と mitigation:

- **レビュー依頼者がレビュワーの初期言語を制御できない**: B 案（ハイブリッド）を採らなかった代償。代わりに、レビュワー側で 1 回 toggle すれば localStorage に保存されて以降は永続するので、初回の若干のミスマッチを許容する設計とする
- **CLI 生成 HTML と online 版で言語決定ロジックが揃う**: `localStorage > navigator.language > 'en'` の 3 層に統一されるため、起動経路の差異を考慮するコードが消える（§3.2 / §5.b）
- **両言語 inline によるサイズ増**: 約 2 KB gzip と見積もり、配布物の他の部分（standalone は 5.9 MB gzip、Shiki grammar が支配的）と比べて無視可能。対応言語数が 3 以上に増えた段階で他アセットと同様の lazy fetch 方式への移行を検討する（§1 スコープ外）

### b. HTML 側の初期言語の優先順位

| 候補                                              | 採用 | 理由                                                                                                                                  |
| ------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **A. `localStorage > navigator.language > 'en'`** | ✓    | ユーザーの過去選択 > ブラウザ環境 > 最終 fallback の 3 層。CLI 生成版と online 版で共通の規則になり、起動経路で分岐するロジックが不要 |
| B. `navigator.language > localStorage > 'en'`     | ✗    | ブラウザ言語を最優先するとユーザーの toggle 選択が次回起動で無視される。toggle UI の意味が薄れる                                      |
| C. `localStorage` のみ（navigator は見ない）      | ✗    | 初回起動が必ず `'en'` 既定になり、日本語ブラウザ環境のユーザー体験が悪化                                                              |

採用案の論点と mitigation:

- **初回起動の言語決定が CLI 依頼者の意図を反映しない**: 仕様として割り切る（§5.a の責務分離方針）。レビュワー側の `navigator.language` / 過去の toggle 選択を優先する
- **localStorage 不可環境 (Private モード等)**: `try/catch` で握りつぶし、`navigator.language` に素直 fallback。永続化はできなくなるがセッション内 toggle は機能する
- **CLI 生成 standalone と online 版でロジック共通化**: `resolveInitialLang({storage, navigatorLanguage})` 1 関数で両者をカバーする。CLI 生成版に特有の入力（旧 `dataLangInit`）は存在しないため、関数 signature がシンプルになる

### c. CLI 自体の言語決定ロジック

| 候補                                          | 採用 | 理由                                                                              |
| --------------------------------------------- | ---- | --------------------------------------------------------------------------------- |
| **A. `--lang` フラグ + `$LANG` env fallback** | ✓    | 明示フラグ優先、未指定なら OS ロケールを尊重。Unix CLI ツールの一般的な挙動       |
| B. `--lang` フラグのみ                        | ✗    | env を見ないと「日本語環境で `npx mdxg-redline --help` が常に英語」となり配慮不足 |
| C. env のみ（フラグなし）                     | ✗    | CI / sandbox で env を整える前提になり、フラグでの上書き口がないと不便            |

採用案の論点と mitigation:

- **`$LC_ALL` / `$LC_MESSAGES` / `$LANG` の優先順位** (セルフレビュー反映で `$LC_MESSAGES` 採用): POSIX 仕様どおり `$LC_ALL` が設定されていれば他の `$LC_*` カテゴリを全て override し、未設定なら `$LC_MESSAGES` が messages カテゴリの値を決定、それも未設定なら `$LANG` が default になる。本実装は **POSIX 通りの 3 段 `$LC_ALL` > `$LC_MESSAGES` > `$LANG`** を採用する。`detectLangFromEnv` の signature は `{LC_ALL?, LC_MESSAGES?, LANG?}` の 3 keys。`LC_MESSAGES=ja_JP.UTF-8 LANG=en_US.UTF-8` のような「他カテゴリは en で messages だけ ja」構成 (CI / 個人 dotfile で珍しくない) でも CLI が日本語表示される
- **不正な env 値**: `^ja(_|-|$)` にマッチしないものは `en` 扱い (`C` / `POSIX` / `en_US.UTF-8` 等)。**空文字 (`""`) / `undefined` は「未設定」として skip し次の env 階層に fallback**（POSIX 通り、§3.2 参照）。3 段全てが未設定 / 空文字なら最終 fallback として `'en'`

### d. 辞書ライブラリ選定

| 候補                                    | 採用 | 理由                                                                                   |
| --------------------------------------- | ---- | -------------------------------------------------------------------------------------- |
| **A. 素朴 object + 自作 `translate()`** | ✓    | 約 195 entry に対して ICU 系は過剰。配布物サイズ + 依存をゼロに抑え、key→string で十分 |
| B. `i18next`                            | ✗    | 30+ KB gzipped で本体より重い。複数形 / namespace / lazy load を備えるが本ツールで不要 |
| C. `intl-messageformat`                 | ✗    | ICU MessageFormat parser だけで 10 KB 程度。`{count}` 程度の置換に対して過剰           |

採用案の論点と mitigation:

- **複数形 (plural) 非対応**: セルフレビューで複数形分岐の必要 base key は 4 件（`comments.count_label` / `toast.render_failed` / `modal.confirm_delete_comments` / `search.count`）+ 単一 key 1 件（`toast.feedback_written`、`{countLabel}` 二段構造）と確定。`translatePlural(baseKey, count, params?)` API で `_zero` / `_one` / `_other` の 3 種 suffix を `if/else` 解決する。残り ~155 entry は通常の `translate(key, params)` で済む
- **TypeScript の型安全**: 辞書 key を `keyof typeof messagesEn` で型付けし、`translate()` の引数型を絞る。未知の key を渡すと tsc がエラーにする。**ja 辞書側は `export const messagesJa = { ... } satisfies Record<MessageKey, string>` で固定し、key が 1 つでも欠けると tsc レベルで検出する**（§6 in-source test の集合 diff より早期に検出できる二重保険）

### e. 既定言語

| 候補       | 採用 | 理由                                                                                                         |
| ---------- | ---- | ------------------------------------------------------------------------------------------------------------ |
| **`'en'`** | ✓    | 国際公開ツール（npm / GitHub Releases）の最終 fallback として一般的。`'C'` ロケール / 不明環境を英語に寄せる |
| `'ja'`     | ✗    | 日本語環境向けに最適化しすぎ。npm / GitHub Releases で en speaker が偶発的に拾った時に最初の体験が壊れる     |

理由:

- リポジトリの主要ドキュメントは英日両方提供しているが、ツール自体の最終 fallback は en が望ましい（README.md / README_ja.md の併走、英語版 Zenn 紹介記事の存在）
- 「日本語環境のユーザーは `$LANG` 経由 or `navigator.language` 経由で自動的に ja になる」ので、デフォルトを en にしても実害は小さい

### f. `<html lang>` 属性の同期

| 候補                             | 採用 | 理由                                                                                                          |
| -------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------- |
| **A. 表示言語と常時同期**        | ✓    | AT 読み上げ精度（en と ja で発音規則が異なる）/ CJK フォントの選択 / CSS `hyphens` 等の locale 依存挙動に効く |
| B. 固定 (`lang="en"` のまま)     | ✗    | 日本語表示中も AT が英語として読み上げる、フォント選択が `font-family` 第一候補の en 用に偏る                 |
| C. 初回のみ同期、toggle 時は不変 | ✗    | toggle 後に AT 読み上げが追従しない                                                                           |

採用案の追加論点:

- markdown 本文（`#doc` 配下）の AT 読み上げ言語の独立は **本プランのスコープ外** (§1 参照)。`<html lang>` は UI (chrome) 言語に同期し、本文も継承する制約を受け入れる。本文の AT 読み上げ言語独立 (frontmatter / 自動判定 / `--doc-lang` 等) は別タスクで扱う
- HTML 側の lang 状態は `<html lang>` 1 属性に集約する。CLI からの初期言語ヒンティング属性（旧設計の `data-lang-init`）は提供しないため、`<html lang>` のみが信頼源（§5.a）

### g. 翻訳キー命名規約（フラット vs 名前空間）

| 候補                                              | 採用 | 理由                                                            |
| ------------------------------------------------- | ---- | --------------------------------------------------------------- |
| **A. ドット区切り名前空間 (`toolbar.open_file`)** | ✓    | 約 195 entry で grep / 整理がしやすい、未使用 key 検出も簡単    |
| B. フラット (`toolbar_open_file`)                 | ✗    | 165 entry 規模で名前空間なしは可読性が落ちる                    |
| C. ネスト object (`{toolbar: {open_file: ...}}`)  | ✗    | tree-shake が効きにくい、`translate()` のキー型推論が複雑になる |

### h. CLI フラグの綴り (`--lang` vs `--locale` vs `--language`)

| 候補         | 採用 | 理由                                                                                          |
| ------------ | ---- | --------------------------------------------------------------------------------------------- |
| **`--lang`** | ✓    | 短い、`git --lang` / `npm --lang` のような既存 OSS の慣行と合致、type-coercion を必要としない |
| `--locale`   | ✗    | locale は数値 / 通貨フォーマットの含意があるが本実装は UI 文言だけ。誤誘導                    |
| `--language` | ✗    | タイピング長、慣行から外れる                                                                  |

### i. archive ドキュメントの「i18n しない」決定の上書き

`docs/archive/mdxg-virtual-pages.archive.md:360-365` で「本ツール全体で i18n を導入していない（toolbar / modal 等すべて英語）」と明示的に決めている。本プランはこの決定を上書きする。

理由:

- 当時の判断は「Virtual Pages の暗黙ページ名 (`Introduction`) を翻訳しないため、その周辺もまとめて英語で揃える」という波及範囲の話で、レビュワーの体験そのものを否定したものではない
- 英語版 / 日本語版 README の両立、紹介記事の英語版 / 日本語版の両立、md-review skill が日本語環境で使われる頻度を踏まえると、UI 英語固定は機会損失
- archive ドキュメントの該当箇所は「§14 で上書き決定」のメモを 1 行足すに留め、archive 本体は書き換えない（archive 不変の原則を保ちつつ最低限の追跡性を確保）

**上書きの影響範囲（i18n の対象 / 非対象を明示）**:

- **i18n 対象**: 本プラン §3.4 で列挙した 12 名前空間（toolbar / comments / modal / toast / empty / page_nav / search / dialog / diagram / online / footnote / cli）、約 195 entry（UI 辞書 155 + CLI 辞書 36）。chrome / panel / modal / CLI 出力 (help / stderr / `--clean` stdout / asset 欠落例外) / 検索 UI / 汎用ダイアログ / 図表アクセシビリティ / online 版 URL 入力フォーム / 脚注 backref aria-label の全 UI 文言
- **i18n 非対象**: 以下は本プランで翻訳しない:
  - **Virtual Pages の暗黙ページ名 (`Introduction`, `Footnotes` 等)**: `#doc` 配下に挿入される H1 / H2 由来のページ見出しで、アンカリング (textContent ベースのオフセット計算) に直接影響する。元 markdown の言語に従うべきで、chrome の表示言語と独立 (§3.5 で `[data-i18n]:not(#doc *)` の skip セレクタが構造的に保証)
  - **元 markdown 本文**: ユーザー入力なので raw のまま
  - **コメント本文 / quote**: 同上
  - **CLI フラグ名 (`--lang`, `--clean` 等)**: マシン契約として英語固定 (§1 スコープ外)
  - **ブランド名 (`MDXG Redline`)**: 固有名詞

## 6. テスト方針

### in-source test（新規）

- `src/app/i18n/i18n-core.ts`（pure 関数のみ、Node / ブラウザ共通）:
  - `detectLangFromEnv`: `{LANG: 'ja_JP.UTF-8'}` → `'ja'` / `{LANG: 'en_US.UTF-8'}` → `'en'` / `{LANG: 'C'}` → `'en'` / `{LC_ALL: 'ja', LANG: 'en'}` → `'ja'`（LC_ALL 優先）/ `{LC_MESSAGES: 'ja_JP.UTF-8', LANG: 'en_US.UTF-8'}` → `'ja'`（LC_MESSAGES が LANG を override、POSIX 3 段）/ `{LC_ALL: 'en', LC_MESSAGES: 'ja', LANG: 'ja'}` → `'en'`（LC_ALL が全てを override）/ **`{LC_ALL: '', LC_MESSAGES: 'ja_JP.UTF-8', LANG: 'en_US.UTF-8'}` → `'ja'`（空文字 skip → LC_MESSAGES fallback、セルフレビュー反映）** / **`{LC_ALL: '', LC_MESSAGES: '', LANG: 'ja_JP.UTF-8'}` → `'ja'`（空文字 2 段 skip → LANG fallback）** / **`{LC_ALL: '', LC_MESSAGES: '', LANG: ''}` → `'en'`（全空文字 → 最終 fallback）** / `{}` → `'en'`
  - `detectLangFromNavigator`: `'ja'` / `'ja-JP'` / `'ja-Hira-JP'` → `'ja'` / `'en-US'` / `'en'` / `'fr'` / `'zh-CN'` / `'ko-KR'` / `'JA-JP'` (大文字、`/^ja(_|-|$)/i` で正規化) → 各々の期待値 / `' ja '` (空白付き) / `''` / `undefined` → `'en'`。sub-tag マッチングは `/^ja(_|-|$)/i` 正規表現で en と ja のみ区別、それ以外は `'en'` に fallback。**`navigator.language` 値を pure に受け取る**シグネチャ（DOM 非依存）として `i18n-core.ts` に配置し、ブラウザ側 `i18n-browser.ts` の `initLangFromBrowser` から `navigator.language` を渡して呼ぶ構造で Node test を可能にする
  - `resolveInitialLang`: 優先順位（`storage` > `navigator`）、null / 空文字スキップ、不正値スキップ、両方 null/不正なら `'en'` fallback
  - `translateCore(dict, key, params)` / `translatePluralCore(dict, baseKey, count, params)`: 既知 key の en / ja 出力、未知 key は key 文字列を返す、`{name}` placeholder 展開、参照されない placeholder は無視。pure 関数として辞書を引数で受けるため CLI / UI / Node test 全経路で再利用可能（§3.1）。`comments.count_label` で `count=0` → `_zero`、`count=1` → `_one`、`count=3` → `_other` を選択し、辞書値の `{count}` が展開される（`'3 comments'`）/ `toast.render_failed` で `count=0` → `_other` に fall back（`_zero` 不在）/ 各 base key で suffix 解決ロジックが探索順どおり動く

- `src/app/i18n/i18n-browser.ts`（ブラウザ副作用、JSDOM fixture が必要）:
  - `initLangFromBrowser`: localStorage 値 / `navigator.language` / fallback の優先順位どおり `<html lang>` が更新される。localStorage 例外（Private モード / Quota / SecurityError）でも throw せず env / navigator にフォールバックする
  - `setLang`: state → DOM 反映 → listener 通知 → 永続化の順序が保たれる。`writeStoredLang` 失敗（localStorage 不可）でも DOM / listener は完了済み（§8 リスク表の保証）。**反復中 unsubscribe 耐性**: listener A 内で自身を unsubA() で解除 → listener B, C も今回呼ばれる（snapshot `[...listeners]` で反復する効果、`createDocumentLoader` と同じ防御）
  - `subscribeLangChange`: 同一 listener を 2 回登録すると 2 回呼ばれる（dedupe しない契約）。unsubscribe の戻り値を 2 回呼んでも例外を投げない
  - `applyI18nDataset(root)`: `data-i18n` / `data-i18n-aria-label` / `data-i18n-placeholder` / `data-i18n-data-tooltip` 各 dataset の更新、`closest('#doc')` ベースの除外フィルタ (§3.5)、**`#doc [data-footnote-backref][data-i18n-aria-label]` の構造的例外包含**（§3.4 footnote.\* 行参照）、**構造的例外要素では `data-i18n` が誤って付いても textContent 置換を skip し attribute のみ翻訳する二重防御**（アンカリング不変条件保護、Step 2 セルフレビュー反映）、CSS custom property (`--ui-loading-text` 等) の setProperty 同時更新
  - `translate(key, params)` / `translatePlural(...)` の薄いラッパが現在の `currentLang` と適切な辞書を引数で `translateCore` / `translatePluralCore` に渡している（i18n-core.ts の test では辞書直渡し、こちらでは module-local state 経由を検証）

- `src/cli/help-text.ts`:
  - `setCliLang('en'); getHelpText()` が `Usage:` を含む (module-local state を切替えてから呼ぶ、§3.1 / Step 4 の bootstrap pattern と整合)
  - `setCliLang('ja'); getHelpText()` が `使い方:` 相当の日本語文字列を含む
  - test fixture で `beforeEach(() => setCliLang('en'))` により state リークを防止 (test 間で getCliLang() の戻り値が引きずられないこと)
  - 両言語で改行構造が崩れない（先頭 / 末尾の空白行の不変条件）
  - **主要キーワード網羅チェック**（セルフレビュー反映、help 圧縮による情報損失の regression を検出）: 両言語の help text に以下のキーワードが残っているか検証
    - 各オプション名: `--theme`, `--shiki-langs`, `--comments-width`, `--page-nav-width`, `--mermaid`, `--math`, `--math-fonts`, `--markdown-css`, `--no-open`, `--show-open-file`, `--show-paste-markdown`, `--lang`, `--clean`, `--yes`, `--keep`, `-r`, `--recursive`, `-h`, `--help`
    - 各モード値: `system`, `light`, `dark`, `auto`, `all`, `none`, `on`, `off`, `minimal`
    - 詳細動作キーワード: `localStorage`, `<html data-theme>`, `<html data-comments-width>`, `<html data-page-nav-width>`, `precedence` / `優先`, `280-640`, `180-480`, `~235 languages` / `約 235 言語`, `5.5 MB`, `700 KB`, `~250 KB`, `\\mathcal`, `\\mathfrak`, `MDXG §14`, `MDXG §15`
  - **regression assertion**: 両言語の `cli.help.options_block` の文字数が現状 `HELP_TEXT` 定数 Options セクションの **95% 以上** であることを assert（block 形式の圧縮で詳細が落ちる退行を検出）
  - 全 help block を結合した結果が現状 `HELP_TEXT` 定数とトークン構造で同等であること（行数 / セクション header 一致）

- `src/cli/preextract-lang.ts` の `extractLang(argv, env)` （§3.3 二段階解析、サブパーサ非依存のグローバル メタフラグ処理）。`{ lang, argv, error }` を 1 パスで返す:
  - **valid 値**: `['--lang', 'en']` → `{ lang: 'en', argv: [], error: null }` / `['--lang', 'ja']` → ja / `['--lang', 'auto'], {LANG: 'ja_JP'}` → ja
  - **不指定**: `[], {LANG: 'en_US'}` → `{ lang: 'en', argv: [], error: null }`
  - **不正値 (silent な事故を防ぐ)**:
    - `['--lang', 'fr']` → `{ lang: env-fallback, argv: [], error: { kind: 'invalid_value', token: 'fr' } }`
    - **`['--lang', 'spec.md']`** → `{ lang: env-fallback, argv: [], error: invalid_value 'spec.md' }`。入力ファイル名を value として silent 消費せず invalid_value エラーで明示。reject パスで「`--lang must be one of: auto, en, ja`」を表示してユーザーに気づかせる
  - **値欠落 (`--` prefix または `HELP_FLAGS` の次トークンを value として誤消費しない)**:
    - 末尾 `['--lang']` → `{ lang: env-fallback, argv: [], error: { kind: 'missing_value' } }`
    - **`['--lang', '--clean']`** → `{ lang: env-fallback, argv: ['--clean'], error: missing_value }`（`--clean` が argv から消えない）
    - **`['--lang', '--help']`** → `{ lang: env-fallback, argv: ['--help'], error: missing_value }`（`--help` が argv から消えない、main() の help 最優先で help 表示が error reject に優先）
    - **`['--lang', '-h']`** → `{ lang: env-fallback, argv: ['-h'], error: missing_value }`（`-h` は `--` prefix を持たない短形式だが `HELP_FLAGS.has('-h')` で値欠落判定に含まれ、argv に保持されて main() の help 表示が勝つ）
    - `['--clean', '--lang']` → `{ lang: env-fallback, argv: ['--clean'], error: missing_value }`
  - **後勝ち + 不正値の保持** (Step 4 セルフレビューで仕様変更):
    - `['--lang', 'ja', '--lang', 'en']` → `{ lang: 'en', error: null }` (有効値同士は後勝ち)
    - **`['--lang', 'fr', '--lang', 'en']`** → `{ lang: 'en', error: invalid_value 'fr' }` (一度検出した不正値は保持、bootstrap で reject)
    - **`['--lang', 'en', '--lang', 'fr']`** → `{ lang: 'en', error: invalid_value 'fr' }` (valid → invalid: lang は最後の有効値、error は最後の不正値を記録)
    - **`['--lang', 'ja', '--lang', 'fr', '--lang', 'en']`** → `{ lang: 'en', error: invalid_value 'fr' }` (中間の不正値も保持)
  - **idempotent / 安定性**: `extractLang(extractLang(x).argv, env)` の `.argv` が 1 回適用と一致（再呼び出ししても安定）
  - **clean モード統合**: `['--clean', './reviews', '--lang', 'ja', '--yes']` → `{ lang: 'ja', argv: ['--clean', './reviews', '--yes'], error: null }`。`parseCleanArgs` が `CLEAN_FLAG_TABLE` 検査を通過する
  - **`--lang` 先行の clean モード**: `['--lang', 'ja', '--clean']` → `{ lang: 'ja', argv: ['--clean'], error: null }`
  - **run 経路で従来動作維持**: `['--lang', 'ja', 'spec.md', './reviews']` → `{ lang: 'ja', argv: ['spec.md', './reviews'], error: null }`
  - **help と error の同時発生** (main() の help 最優先契約と組み合わせて検証):
    - `extractLang(['--lang', 'fr', '-h'], env)` → `{ argv: ['-h'], error: invalid_value 'fr' }` を返し、main() 側で `argv.some(t => HELP_FLAGS.has(t))` チェックが先に通って help 表示
    - `extractLang(['--lang', '--help'], env)` → `{ argv: ['--help'], error: missing_value }`、同様に help が勝つ
    - **`extractLang(['--lang', '-h'], env)`** → `{ argv: ['-h'], error: missing_value }`（短形式 `-h` でも HELP_FLAGS 経由で値欠落判定が効き、`-h` が argv に保持されて help 表示が勝つ。本テストが無いと `-h` を invalid_value として誤消費する退行を検出できない）
  - env fallback の挙動は `detectLangFromEnv` 単体テストと重複しないよう mock で固定

- `src/app/i18n/messages.{en,ja}.ts`（sanity check）:
  - en と ja の key 集合が完全一致（diff が空であること）
  - 値が空文字でない
  - placeholder を使う key は両言語で同じ placeholder 名を使う（`{count}` を ja で `{cnt}` にしていない）

- `src/core/embed/html-rewrite.ts`:
  - `formatI18nParamsAttr({docName, docHash})` round-trip: 通常 docName (`"spec.md"`) で `{&quot;docName&quot;:&quot;spec.md&quot;,&quot;docHash&quot;:&quot;a1b2c3d4e5f6a7b8&quot;}` 形式の属性値を生成、ブラウザ parser で dataset 読み出し → `JSON.parse` → 元 object と一致
  - 特殊文字 docName (`'it\'s & <b>"test"</b>'`) で round-trip。生成属性に `"` が直接含まれず `&quot;` にエスケープされる、`<` が `&lt;`、`&` が `&amp;` になる、`JSON.parse` 後に元の特殊文字が完全復元される
  - 属性に `<script>` のような XSS payload を仮の docName に入れても DOM parser が text として扱う (XSS が成立しない)
  - 既存 `rewriteReviewHtml` の他属性 (data-name 等) と同じ escape ポリシー (§11) で整合
  - `rewriteStatusI18nAttrs(html, params)` の **idempotent** 性: 同じ HTML を 2 回 rewrite しても `data-i18n` / `data-i18n-params` 属性が重複せず、2 回目の値が 1 回目を上書き (既存 `setOrInsertAttribute` の仕様確認)
  - `rewriteStatusI18nAttrs` + `rewriteInitialStatus` の **順序入れ替え** で結果が変わらないこと (本文書き換えと opening tag 属性 upsert が独立)
  - 既存 `STATUS_SPAN_RE` で `#status` span が見つからない HTML で `rewriteStatusI18nAttrs` を呼ぶと throw する (`rewriteInitialStatus` の既存挙動と整合)

- 既存テストに追加:
  - `app/document/doc-renderer.ts`: lang toggle 後にコメントアンカリングが壊れない（toggle 前後で `getSelection()` の結果と blockOriginalHTML が一致）
  - `app/chrome/toolbar.ts`: lang toggle button が idempotent（2 回呼んでも DOM が重複しない）
  - `app/review.ts`: JS 動的読み込み (Open file / Paste / online) で `#status` 要素の dataset (`i18n` / `i18nParams`) が正しく更新され、`applyI18nDataset(el)` が **root 要素自身も翻訳対象に含める** (root.matches() 判定、§3.5)、`subscribeLangChange` で toggle 時に再描画される
  - `app/online/source-display.ts`: `buildSourceLinkElement(url)` が **innerHTML を使わず DOM API で構築** され、戻り値の Element ツリーに `innerHTML` access 経路の汚染がないこと (createElement / appendChild / textContent / setAttribute のみ使用)。XSS payload を含む URL (`'javascript:alert(1)'` 等の非 HTTPS) でも `document.createTextNode` 経路で inert text として扱われる。`translate('online.label.source')` の戻り値が `textContent` 経路で挿入され innerHTML には流れない (`<` を含む辞書値を仮置きしても script 実行されない、§11 セキュリティ方針との整合)
  - `app/online/source-display.ts` の **購読パターン** (§3.5): `setupOnlineSourceI18n()` を 2 回連続で呼んでも `subscribeLangChange` の listener が 1 個しか登録されない (idempotent、二重購読防止)。`showOnlineSource('https://a/')` → `setLang('ja')` で listener が呼ばれて Source ラベルが日本語化 / URL は保持。`clearOnlineSource()` 後の `setLang('en')` で listener が呼ばれても `#online-source` が空のまま (古い URL が復活しない)。`showOnlineSource('A')` → `showOnlineSource('B')` → `setLang('ja')` で listener は 1 回だけ呼ばれ B の URL で再描画 (state 上書きが正しく反映)
  - `app/document/load-document.ts` の **文書ライフサイクル hook** (§3.5):
    - `loadDocument({kind: 'online', url: 'https://a/'})` → `loadDocument({kind: 'local', docName: 'x.md'})` を順次 → `#online-source` が空、`currentSourceUrl === null` (URL 文書 → ローカル文書で Source 消滅)
    - `loadDocument({kind: 'local'})` → `loadDocument({kind: 'online', url: 'https://b/'})` を順次 → `#online-source` に B の Source link、`currentSourceUrl === 'https://b/'` (ローカル → URL で Source 出現)
    - `loadDocument({kind: 'online', url: 'A'})` → `loadDocument({kind: 'local'})` → `setLang('ja')` → A の Source link が **復活しない** (currentSourceUrl が clear 済み、これが本セルフレビューの主要シナリオ)
    - `loadDocument({kind: 'online', url: 'A'})` → `loadDocument({kind: 'online', url: 'B'})` → `setLang('ja')` → B の Source link で日本語ラベル再描画 (A は残らない)
    - `registerOnDocumentLoad` を 2 回呼ぶと hook が 2 回登録される (`Array.push` の素朴な実装)。各モジュールが `setup*I18n` の idempotent guard で二重登録を防ぐ責任を持つ (`setupOnlineSourceI18n` を 2 回呼んでも hook は 1 回しか register されない)
  - `app/document/load-document.ts` の **factory + hook 例外隔離** (セルフレビュー反映):
    - `createDocumentLoader(mockLoader)` で mock 注入してテスト可能、`loadDocument({...})` が `mockLoader(docName, body)` を 1 回呼ぶ
    - **hook A が throw しても hook B が呼ばれる**: 3 つの hook を register、A は throw、B / C は通常実行。`loadDocument(source)` 呼び出し後、B / C が両方とも source を受け取って実行された記録が残る、A の例外は console.error に出る
    - **hook throw が `loadDocument` を reject しない**: `await loadDocument({...})` が **resolve** する (hook 例外がロード成功を失敗扱いしない)
    - **caller の catch が反応しない**: paste-markdown-modal の `loadOrShowError` パターン (`try { await loadDocument(...) } catch { showInputError(...) }`) で、hook throw 時に catch ブロックが実行されない (`showInputError` が呼ばれない)
    - **baseLoader が reject すると loadDocument も reject**: hook は実行されない (本文ロード自体が失敗した場合のフェイルファスト)
  - `app/document/load-document.ts` の **`loadFromMarkdown` 直接呼び出し検出**: 実装完了後に `grep -rn "loadFromMarkdown(" src/` で `boot.ts` / `paste-markdown-modal.ts` / `open-file-input.ts` 等の callsite が **`loadDocument` 経由のみ** になっていること (`load-document.ts` の `createDocumentLoader` 内部 1 箇所 + `app-wiring.ts` での decorator 適用部分のみが直接呼ぶ)。新規入力経路を追加した時の呼び忘れを構造的に検出
  - `app/document/load-document.ts` の **app-wiring.ts 統合検証**: `applyOnlineAssetDecorator` を経由した `loadFromMarkdown` が `createDocumentLoader` に渡されていること、生の (decorator 未適用の) `loadFromMarkdown` が直接 factory に渡されていないこと (decorator バイパス回帰の検出)
  - `app/document/load-document.ts` の **`registerOnDocumentLoad` Unsubscribe** (セルフレビュー反映): `register` の戻り値 (`Unsubscribe`) を呼ぶと、後続の `loadDocument(...)` で該当 hook が呼ばれなくなる。複数 hook を登録 → 中 1 件を unsubscribe → 残り 2 件は引き続き呼ばれる。同じ Unsubscribe を 2 回連続で呼んでも例外を投げない (`indexOf` が `-1` を返して splice が no-op)
  - `app/document/load-document.ts` の **反復中の `unsubscribe` 耐性** (セルフレビュー反映): hook A, B, C を順に登録、hook A が呼ばれた時に **自身を `unsubA()` で解除** → hook B, C が **今回の `loadDocument` 呼び出しでも呼ばれる** (スナップショット `[...hooks]` で反復する効果)。次回の `loadDocument` では A は呼ばれず B, C のみが呼ばれる。同様に **hook A が hook B を解除しても、今回の呼び出しでは B が呼ばれる**、次回の呼び出しから B は呼ばれない
  - `app/online/source-display.ts` の **teardown lifecycle** (セルフレビュー反映の主要シナリオ): `setup → teardown → setup(deps2)` で deps2 の loader に hook が登録され、`loader1.loadDocument({...})` が hook を呼ばない (解除済み)、`loader2.loadDocument({...})` が source-display を更新する。`teardownOnlineSourceI18n()` 後の `setLang('ja')` で source-display が反応しない (`langSubscription` も解除済み)。teardown 後 `currentSourceUrl === null` / `#online-source` が空 (state も DOM も初期化)。teardown を 2 回連続で呼んでも例外を投げない (`langSubscription` / `docSubscription` が null チェック)
  - `app/navigation/page-navigation-render.ts` / `app/search/search-dom.ts` / `app/chrome/paste-markdown-modal.ts` も同じ「`setupXxxI18n` idempotent + `clearXxx` 後 state 消滅 + 連続 show で listener 1 回のみ + **`teardownXxxI18n` で全 subscription 解除 + idempotent**」の test を網羅

### 手動視覚チェックリスト

`npm run build` 後、以下を確認:

- [ ] `npx ./dist/review-request.mjs --help` で英語 help が出る
- [ ] `npx ./dist/review-request.mjs --lang ja --help` で日本語 help が出る
- [ ] `LANG=ja_JP.UTF-8 npx ./dist/review-request.mjs --help` で日本語 help が出る
- [ ] `LANG=C npx ./dist/review-request.mjs --help` で英語 help が出る
- [ ] `npx ./dist/review-request.mjs --lang ja sample.md` を実行: CLI の stdout / stderr は日本語、**生成 HTML は CLI の `--lang` に影響されず**ブラウザ環境 (`navigator.language`) に従って初期表示される（責務分離、§5.a）。例: en ブラウザで開けば英語表示
- [ ] `navigator.language=ja-JP` のブラウザで生成 HTML を開くと初期日本語表示、`en-US` ブラウザで開くと初期英語表示（CLI 側の `--lang` 値に関わらず）
- [ ] 起動時に **英語→日本語のチラつきがない**（`<body>` が `i18n-pending` で visibility:hidden、`applyI18nDataset` 完了後に解除される FOUC 回避が機能）
- [ ] toolbar の EN/JA toggle で **toast 以外の全 UI が切替わる** (toolbar / panel / 開いている modal / aria-label / placeholder)。toast は表示中の追従は仕様外 (次回表示分から翻訳反映、Step 6 の生存期間ベース判断)
- [ ] toggle 後にリロードしても言語が保持される（localStorage）
- [ ] toggle 中にコメントが消えない / 検索ハイライトが消えない / Shiki ハイライトが消えない
- [ ] dark / light モード切替と lang toggle が独立に動作する
- [ ] online 版（`vp dev` で起動）で `navigator.language` が `ja-JP` のブラウザだと初期日本語表示
- [ ] online 版で localStorage が設定済みなら navigator より優先される
- [ ] modal を開いたまま lang toggle しても modal 内テキストが追従する
- [ ] スクリーンリーダー（VoiceOver / NVDA いずれか）で `<html lang>` が変わって読み上げ言語が切替わる
- [ ] file:// 経由で開いても初期 lang 解決が動く
- [ ] `dist/standalone.html` 単独でも全機能が動く（CLI 経路を通らないルートでの確認）

## 7. 受け入れ基準

- §1 の対応スコープ表が全て ✓ になる
- 既存挙動の視覚回帰がない（コメントアンカリング / 検索ハイライト / Shiki upgrade / theme toggle が既存と同等）
- 配布物サイズ増分が **gzipped で +5 KB 以内**（見積もり +2 KB に対する余裕）
- アンカリングの不変条件（`textContent` ベースのオフセット計算）が維持される（既存 in-source test 全通過 + 新規追加 regression テスト通過）
- theme toggle / 検索 / コメント編集が lang toggle と DOM 再構築なしで連動する
- lang toggle 時の追従範囲は **toast 以外の全 UI** (toolbar / panel / 開いている modal / aria-label / placeholder / CSS 疑似要素)。toast は **表示中の追従は対象外**（生存期間 1.5-3 秒なので次回表示分から翻訳反映、Step 6 の生存期間ベース判断）
- DESIGN.md §14 が新設され、§9 起動シーケンス / §13 ビルドパイプライン / §11 セキュリティ への参照が貼られる
- README.md / README_ja.md の CLI オプション表に `--lang` 行が追加される
- `docs/archive/mdxg-virtual-pages.archive.md` の該当箇所に「§14 で上書き決定」のメモが追記される

## 8. 想定リスクと回避策

| リスク                                                                | 回避策                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 翻訳キーの未使用 / 未定義の見落とし                                   | en / ja の key 集合 diff を in-source test で fail させる、未知 key は `translate()` が key 文字列を返して dev 時に目視で気付ける                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `<html lang>` 切替で CJK フォント描画が瞬間的にチラつく               | toggle 時に `textContent` / 属性のみ更新で DOM 再構築せず、CSS は `:lang(ja)` / `:lang(en)` で先回り適用しておく                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| アンカリングの textContent 計算が辞書 toggle で変化する               | doc-pane (`#doc`) には `data-i18n` を絶対に置かない、chrome / panel / modal 限定。`textSegments` の skip セレクタに `.lang-toggle` 追加。empty state は Step 1.5 調査で `#doc` の外側（`#doc-wrap` の兄弟）にあることを確認済みのため、walk セレクタ `[data-i18n]:not(#doc *)` で構造的に安全。**構造的例外**: `[data-footnote-backref]` 要素は `text-segment-skip-rules.ts:44` でアンカリング skip 対象に登録済みのため、`#doc [data-footnote-backref][data-i18n-aria-label]` だけは walker の包含対象とする。textContent (`↩`) は不変、aria-label のみ翻訳で textContent シーケンス不変条件は維持 |
| lang 解決が paint 後にずれて FOUC（英→日のチラつき）が起きる          | `<head>` inline script で `resolveInitialLang` を同期実行し、`<html lang>` と body 描画前の `<style>` 用 attribute を確定させる                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| CLI の env 解釈で OS 差異（Windows / macOS / Linux）が出る            | `$LANG` / `$LC_ALL` は POSIX env で 3 OS 共通。Windows の代替 (`Get-Culture`) は対応せず `--lang` フラグで明示してもらう運用                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| online 版で localStorage が disabled なら navigator fallback が壊れる | `try/catch` で localStorage 失敗を握りつぶし、`navigator.language` にスムーズ fallback                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 翻訳の品質ばらつき（直訳すぎ / 文化不適合）                           | コードレビュー時にネイティブ視点で確認、PR description に翻訳一覧の diff を貼って合議                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ICU 系を使わないことで複数形が破綻する場面が出る                      | セルフレビューで複数形分岐の base key は **4 件 + 単一 key 1 件** に確定（`comments.count_label` / `toast.render_failed` / `modal.confirm_delete_comments` / `search.count` + `toast.feedback_written`）。`_zero` / `_one` / `_other` 3 種 suffix に統一し、`translatePlural(baseKey, count)` API で内部解決（§3.4）                                                                                                                                                                                                                                                                                |
| archive ドキュメントの「i18n しない」決定との矛盾                     | §5.i で上書き決定の根拠を明記、archive 該当行に「§14 で上書き」メモを 1 行追記                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| CLI 依頼者がレビュワー側 HTML の初期言語を伝達できない                | §5.a の責務分離方針として割り切り。レビュワーが 1 回 toggle すれば localStorage に永続化され以降は維持される。初回の若干のミスマッチを許容                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Sub-tag (`zh-CN` / `ko-KR` 等) の混入で予期せぬ言語が選ばれる         | `detectLangFromNavigator` は `ja` / `ja-*` のみ ja、それ以外は全て en にフォールバック（明示）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## 9. 参考

- [DESIGN.md §3 ユーザーフロー](./DESIGN.md#3-ユーザーフロー) — CLI 起動経路 / online 経路の現状フロー
- [DESIGN.md §9 起動シーケンス](./DESIGN.md#9-起動シーケンス) — paint 前 inline script による初期状態解決パターン（theme と同じ位置に lang を追加）
- [DESIGN.md §11 セキュリティとプライバシー](./DESIGN.md#11-セキュリティとプライバシー) — textContent / attribute 経路でのみ書き込む方針との整合
- [DESIGN.md §12 MDXG 準拠ロードマップ・今後の拡張](./DESIGN.md#12-mdxg-準拠ロードマップ今後の拡張) — UI 国際化は MDXG 規格外の独自拡張
- [DESIGN.md §13 ビルドパイプライン](./DESIGN.md#13-ビルドパイプライン) — CLI の HTML rewrite 経路。本プランは lang 関連属性を埋め込まないため、ビルドパイプラインには新規 upsert を追加しない（CLI と HTML の責務分離の根拠位置として参照）
- [docs/archive/mdxg-virtual-pages.archive.md](./archive/mdxg-virtual-pages.archive.md) — 「i18n しない」過去決定（§5.i で上書き）
- [POSIX Locale env (LANG / LC_ALL)](https://pubs.opengroup.org/onlinepubs/9699919799/basedefs/V1_chap07.html) — env 解釈の根拠
- [BCP 47 / navigator.language](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/language) — sub-tag マッチング規則
