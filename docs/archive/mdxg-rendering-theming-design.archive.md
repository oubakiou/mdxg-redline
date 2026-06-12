# MDXG §1 Theming 対応 設計・実装計画

DESIGN.md §12 の優先順序 1「§1 host theme adaptation」に対応するための設計判断と実装手順をまとめる。完了時点で本ドキュメントは DESIGN.md §12 表の「§1 Theming = 準拠」に置換され、本ファイルはアーカイブされる想定。

## 1. 対応スコープ

MDXG [§1 Theming](./mdxg/01-rendering.md#1-themingテーマ) の 4 要件を全て満たす。

| 要件                                                          | 現状 | 完了条件                                                                                          |
| ------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------- |
| [MUST] ツールの外観をホスト環境に適応させる                   | 未   | `prefers-color-scheme` を既定値として参照し、ユーザー上書きを localStorage で記憶                 |
| [SHOULD] 背景・前景・アクセント・ボーダーをホスト/OS から導出 | 未   | DADS プリミティブから semantic 層を自前定義し、`.dark` クラスで切替                               |
| [MUST NOT] 使える外観を得るためにユーザー設定必須にしない     | ✓    | 既定で `system` 追従。`localStorage("mdxg-redline.theme")` 未設定時は OS 設定がそのまま反映される |
| [MUST] ライト / ダーク両ホストテーマ対応                      | 未   | dark 配色を全 UI / `#doc` プレビュー / `<mark class="cmt">` ハイライトまで網羅                    |

スコープ外（別タスクで扱う）：

- §2 のコードブロック配色 dark 対応（Shiki 導入時に dual theme で吸収。本タスクでは `<pre>` の背景・前景だけ dark トークンに合わせる）
- §4 画像の dark 対応（画像自体は描画されたまま、背景色だけ dark で読みやすくする）
- システムフォントの dark 専用変更（DADS は配色トークンのみで font は light/dark 共通のため不要）

## 2. リファレンス実装と差分

[vercel-labs/mdxg `apps/web`](https://github.com/vercel-labs/mdxg/tree/main/apps/web) の dark 対応は次の 4 要素で構成される：

1. **CSS variables を `:root`（light）と `.dark`（dark）で切替** — Tailwind v4 のカラートークン定義
2. **`app/layout.tsx` 冒頭の inline script で FOUC 防止** — `localStorage("theme")` を優先、未設定なら `prefers-color-scheme` で初回判定
3. **`components/header.tsx` の Sun/Moon トグルボタン** — `html.dark` クラスを切り替え、`localStorage` に永続化
4. **`apps/web/src/app/globals.css`** で Tailwind カラートークンを semantic に再エクスポート

MDXG Redline は React/Next.js を使わないので、上記を pure DOM + vanilla TS で書き直す。具体的な置換：

| リファレンス実装                  | MDXG Redline での置換                                                                           |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| `app/layout.tsx` の inline script | `src/review.html` の `<head>` 内 inline `<script>`                                              |
| Tailwind v4 のカラートークン      | `src/styles/review.css` / `markdown.css` の `:root` + `:root.dark` CSS variables                |
| `header.tsx` の Sun/Moon ボタン   | `src/app/toolbar.ts` に theme toggle button を追加（既存 `Comments ▾` の左隣）                  |
| `localStorage("theme")`           | `localStorage("mdxg-redline.theme")` （他ツールとのキー衝突回避で prefix）                      |
| React state での `html.dark` 切替 | `src/app/theme.ts` （新規）の `applyTheme(mode)` が `document.documentElement.classList` を操作 |

DADS には **light / dark の semantic トークンが公開されていない**（[digital-go-jp/design-tokens](https://github.com/digital-go-jp/design-tokens) は primitive + Success/Error/Warning のみ）。そのため、リファレンス実装の Tailwind カラートークン構造をそのまま流用するのではなく、**MDXG Redline 側で DADS primitive から自前 semantic を定義する**。

## 3. dark カラートークン設計（暫定値）

DADS 公式の dark semantic トークン公開を待たず、`digital-go-jp/design-tokens` の primitive パレット（`solid-gray-{50..900}` / `blue-{50..1200}` / `light-blue-{50..1200}`）から WCAG AA 以上のコントラスト比を目安に自前マッピングする。DADS 公式トークン公開時に値を差し替える前提で、CSS variables 名は semantic（用途）で命名する。

### light → dark マッピング表

CSS variables 名は `src/styles/review.css` 現行のものを継承する。dark 値は DADS primitive から選定し、隣接列に「primitive ID」を付記しておく（公式 dark トークン公開時に対応関係を機械的に再マッピングできるよう）。

| variable           | light（現行） | dark（暫定） | dark primitive ID           | 用途                                                    |
| ------------------ | ------------- | ------------ | --------------------------- | ------------------------------------------------------- |
| `--paper`          | `#ffffff`     | `#1a1a1a`    | `neutral-solid-gray-900`    | 本文背景・モーダル背景                                  |
| `--paper-edge`     | `#f6f8fa`     | `#262626`    | （`#1a1a1a` から +8% lift） | サイドバー背景・コードインライン                        |
| `--ink`            | `#1f2328`     | `#f2f2f2`    | `neutral-solid-gray-50`     | 本文テキスト                                            |
| `--ink-soft`       | `#656d76`     | `#b3b3b3`    | `neutral-solid-gray-300`    | サブテキスト・引用                                      |
| `--ink-faint`      | `#8c959f`     | `#999999`    | `neutral-solid-gray-400`    | プレースホルダ・メタ                                    |
| `--accent`         | `#0969da`     | `#9db7f9`    | `primitive-blue-300`        | リンク・focus ring                                      |
| `--accent-soft`    | `#ddf4ff`     | `#00316a`    | `primitive-light-blue-1100` | アクセント背景                                          |
| `--highlight`      | `#fae17d`     | `#ffc700`    | `primitive-yellow-400`      | コメントハイライト（active）                            |
| `--highlight-soft` | `#fff8c5`     | `#806300`    | `primitive-yellow-1000`     | コメントハイライト（既定）                              |
| `--rule`           | `#d0d7de`     | `#4d4d4d`    | `neutral-solid-gray-700`    | 罫線・ボーダー                                          |
| `--rule-muted`     | `#d8dee4`     | `#333333`    | `neutral-solid-gray-800`    | 薄い区切り線                                            |
| `--success`        | `#1f883d`     | `#2cac6e`    | `primitive-green-500`       | primary button 背景                                     |
| `--success-hover`  | `#1a7f37`     | `#259d63`    | `primitive-green-600`       | primary button hover                                    |
| `--btn-primary-fg` | `#ffffff`     | `#1a1a1a`    | `neutral-solid-gray-900`    | primary button 文字色（dark 反転で AA 確保、§5.f 参照） |
| `--danger`         | `#cf222e`     | `#ff5454`    | `primitive-red-500`         | コメント下線・削除アクション                            |

### `#doc` スコープのトークン（`markdown.css`）

現状 `#doc` は色を CSS variables 化しておらず生 hex を直書きしている。dark 対応にあたり以下を semantic CSS variables 化する。

**カスタマイズ機能との両立**：`markdown.css` は将来、ユーザーが 1 ファイルで差し替えてプレビュー外観をカスタマイズできる機能を提供する予定がある（現行ファイル冒頭コメント参照）。そのため dark トークンの上書きルールは `:root.dark` のような外部スコープ依存ではなく `markdown.css` 内に併置し、`:where(.dark)` で詳細度ゼロにしてユーザー側上書きを許容する。詳細は §5.d。

| 新規 variable           | light 値  | dark 値   | 既存記述箇所                            |
| ----------------------- | --------- | --------- | --------------------------------------- |
| `--doc-ink`             | `#1a1a1a` | `#f2f2f2` | `#doc` / 見出し / strong                |
| `--doc-paper`           | `#ffffff` | `#1a1a1a` | `#doc` 背景                             |
| `--doc-rule`            | `#e6e6e6` | `#333333` | 見出し下線 / `hr` / table border        |
| `--doc-border`          | `#d0d7de` | `#4d4d4d` | `#doc` 外枠                             |
| `--doc-link`            | `#0031d8` | `#9db7f9` | `a`                                     |
| `--doc-link-hover`      | `#002db6` | `#7096f8` | `a:hover`                               |
| `--doc-mute`            | `#4d4d4d` | `#b3b3b3` | `h6` / `blockquote` 前景                |
| `--doc-quote-bg`        | `#f2f2f2` | `#262626` | `blockquote` / `code` 背景              |
| `--doc-quote-rule`      | `#cccccc` | `#4d4d4d` | `blockquote` 左罫線                     |
| `--doc-code-bg`         | `#1e1e1e` | `#0d0d0d` | `pre` 背景（dark でも明確な差を付ける） |
| `--doc-code-rule`       | `#333333` | `#4d4d4d` | `pre` ボーダー                          |
| `--doc-code-ink`        | `#d4d4d4` | `#d4d4d4` | `pre code` 前景（VS Code 既定色を流用） |
| `--doc-thead-bg`        | `#f2f2f2` | `#262626` | `thead`                                 |
| `--doc-checkbox-accent` | `#0031d8` | `#9db7f9` | `input[type=checkbox]` accent-color     |

### コントラスト確認の責務

各 dark 値は WCAG 2.1 AA（normal text 4.5:1 / large text 3.0:1）を目標値とする。実装後に手動で代表組み合わせを計測する：

- `--ink` × `--paper` = `#f2f2f2` × `#1a1a1a` （目標 12.0:1 以上）
- `--ink-soft` × `--paper` = `#b3b3b3` × `#1a1a1a` （目標 6.0:1 以上）
- `--accent` × `--paper` = `#9db7f9` × `#1a1a1a` （目標 8.0:1 以上）
- `--doc-link` × `--doc-paper` = `#9db7f9` × `#1a1a1a` （同上）
- primary button（light: 背景 `--success` `#1f883d` × 文字 `--btn-primary-fg` `#ffffff` = **4.51:1**、AA ギリギリ通過 / dark: 背景 `--success` `#2cac6e` × 文字 `--btn-primary-fg` `#1a1a1a` = **6.30:1**、AA 余裕通過）。dark で文字色を反転するのは `#2cac6e` × `#ffffff` が 2.77:1 で AA を大幅に下回るため。詳細は §5.f
- `--highlight-soft` × `--ink` = `#806300` × `#f2f2f2` （`<mark class="cmt">` 内のテキストは元の `--ink` を継承するため、ハイライト背景の上で本文色が読めること）

未達のものは primitive スケールを 1 段ずらして再選定する。

## 4. 実装ステップ

順序は依存関係順。各ステップ完了で in-source test と手動視覚チェックを通す。

### Step 1: 設計判断の確定とトークン値レビュー

- 本ドキュメントの §3 マッピング表をレビュー
- 暫定値で実装に進むか、コントラスト計測を先行するかを判断
- DADS 公式 dark トークン待ち戦略を採るか、暫定値で先行公開するかを判断

成果物：本ドキュメントの §3 マッピング表が確定状態

### Step 2: 純粋ロジック層（`src/app/theme.ts` 新規）

UI / DOM に依存しない決定ロジックを純粋関数で先に書き、in-source test を通す。

```ts
export type StoredTheme = 'light' | 'dark' | 'system'
export type AppliedTheme = 'light' | 'dark'

export function resolveAppliedTheme(stored: StoredTheme, systemPrefersDark: boolean): AppliedTheme
export function nextStoredTheme(current: StoredTheme): StoredTheme
```

- `resolveAppliedTheme('system', true)` → `'dark'`
- `resolveAppliedTheme('light', true)` → `'light'`（明示優先）
- `nextStoredTheme` は toggle button 押下時の循環順序を返す（`system → light → dark → system`）

成果物：`src/app/theme.ts` + `if (import.meta.vitest)` ブロックでの in-source test

### Step 3: DOM 操作層と FOUC 防止 inline script

- `src/app/theme.ts` に DOM 側関数を追加：
  - `applyAppliedTheme(theme: AppliedTheme)`: `document.documentElement.classList` の `.dark` を toggle
  - `readStoredTheme()` / `writeStoredTheme()`: `localStorage("mdxg-redline.theme")` の read/write
  - `readCliHint()`: `document.documentElement.getAttribute('data-theme')` から CLI 注入値を読む
  - `resolveEffectiveTheme(stored, cliHint, systemPrefersDark)`: §5.g の優先順位 P1 に沿って最終 `AppliedTheme` を決定する純粋関数（in-source test 対象）
  - `subscribeSystemTheme(cb)`: `window.matchMedia('(prefers-color-scheme: dark)')` の `change` を購読し、effective が `system` 由来の間だけ追従
- `src/review.html` の `<head>` 内、`<link rel="stylesheet">` より **前** に inline script を追加（FOUC 防止のため pre-paint で `.dark` を付ける必要がある）。優先順位は §5.g P1 (`localStorage` > CLI hint > `prefers-color-scheme`)：

```html
<script>
  try {
    var stored = localStorage.getItem('mdxg-redline.theme')
    var hint = document.documentElement.getAttribute('data-theme')
    var effective = stored || hint || 'system'
    var dark =
      effective === 'dark' ||
      (effective === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    if (dark) document.documentElement.classList.add('dark')
  } catch (e) {}
</script>
```

inline script は singlefile bundle で触られない（既存 `embedded-md` と同じく `type` 非 module）。CSP `script-src 'self' 'unsafe-inline'` で許可済み。CLI が `--theme` を指定しなかった場合、`<html>` に `data-theme` 属性は付かず、`getAttribute` は `null` を返して inline script は従来挙動（`localStorage` / `prefers-color-scheme` のみ）で動く。

成果物：`src/app/theme.ts` 完成 + `src/review.html` の inline script

### Step 4: CSS トークンの semantic 化と `.dark` 上書き

- `src/styles/review.css` の `:root { ... }` ブロックは light 値のまま維持し、ファイル末尾に `:root.dark { ... }` を追加して §3 表の dark 値で上書き
- `src/styles/markdown.css` の `#doc` から色直書きを CSS variables 参照に置換し、**同ファイル内に `:where(.dark) #doc { ... }` ブロックを併置**（外部スコープ依存を避けて自己完結性を維持、`:where()` で詳細度ゼロにしユーザー差し替え CSS の `#doc { ... }` ルールが dark 状態でも上書き勝ちできるようにする。詳細は §5.d）
- `src/styles/markdown.css` の冒頭コメントに **「`<html>` の `.dark` クラス契約」** を明記（カスタマイズ機能利用者が dark 対応の要否を判断できるよう）
- `.cmt-card` の `background: #ffffff` などハードコード値を `var(--paper)` に置換
- `.btn:hover` の `background: #f3f4f6` を新規トークン `--btn-hover` 化（light: `#f3f4f6` / dark: `#333333`）
- `.btn-primary` の `color: #ffffff` を新規トークン `--btn-primary-fg` 参照に置換（light: `#ffffff` / dark: `#1a1a1a`、dark でのコントラスト確保のため反転。詳細は §5.f）
- `#floater` / `#toast` の `color: #ffffff` を新規トークン `--floater-fg` / `--toast-fg` 化（同様に dark で反転、§5.f）
- `.modal-backdrop` の `rgba(31, 35, 40, 0.5)` は dark でも視認性 OK なのでハードコード許容

成果物：`src/styles/review.css` / `markdown.css` の更新、light での視覚回帰なし

### Step 5: トグルボタン UI と review-request CLI `--theme` オプション

#### 5-a. トグルボタン UI

- `src/app/toolbar.ts` に theme toggle button を追加：
  - 配置: `app-header` の `toolbar-actions` 内、`Comments ▾` の左隣
  - 表現: アイコン only ボタン（Sun / Moon / Monitor の 3 状態を SVG inline、`stored` 値に応じて切替）
  - `aria-label`: 「Theme: system」「Theme: light」「Theme: dark」（DESIGN.md §12 [§13] のアクセシブル名要件にも貢献）
  - `data-tooltip`: 「Switch to light」等、次の遷移先を表示
  - click ハンドラ: `nextStoredTheme(current)` → `writeStoredTheme(next)` → `applyAppliedTheme(resolveEffectiveTheme(next, cliHint, systemPrefersDark))` → ボタンの表示更新

- 起動時の wiring を `src/app/boot.ts` に追加：
  - `subscribeSystemTheme` を購読し、effective が `system` 由来の間だけ system 変化に追従
  - inline script で既に `.dark` 付与済みのため、boot 時点で DOM 再適用は不要（stored 値の読み戻しと UI 表示更新のみ）

#### 5-b. review-request CLI `--theme` オプション

- `src/cli/parse-args.ts` に `--theme <system|light|dark>` を追加（バリデーション含む、不正値は exit 1 + stderr）
- `src/core/embed.ts` の rewrite ロジックに `themeHint?: 'system' | 'light' | 'dark'` 引数を追加
  - 指定あり: `<html>` タグの `data-theme` 属性として埋め込む（既存 `data-name` と同じ属性 escape 経路を再利用）
  - 指定なし: `data-theme` 属性は付けない（既存配布物との互換性、§5.g 既定）
- `src/cli/review-request.ts` のエントリで `--theme` 値を embed に渡す
- HELP_TEXT 更新：「`--theme <system|light|dark>` 配布 HTML 初回起動時の theme ヒントを指定。ユーザーが UI でトグルした履歴 (`localStorage`) があればそちらが優先される（詳細は DESIGN.md / mdxg-rendering-theming-design.md §5.g）」

成果物：toolbar に theme toggle 追加、CLI `--theme` オプション追加、in-source test で button label / tooltip 遷移 + `parse-args` の `--theme` バリデーション + `embed` の `data-theme` 属性書き込みを検証

### Step 6: コメントハイライトの dark 検証

- `<mark class="cmt">` は `var(--highlight-soft)` 背景 + `var(--danger)` 下線
- dark 時に `#806300`（暗い yellow）背景の上で本文 `#f2f2f2` が読めるか確認
- active 時の `var(--highlight)` = `#ffc700` 背景の上では本文を暗色（`var(--ink)` の dark = `#f2f2f2`）にすると逆に読みにくくなる可能性 → active 時のみ前景を `#1a1a1a` に固定するか、dark の `--highlight` を別パレットに振り直す

成果物：`mark.cmt` / `mark.cmt.active` の dark 配色確定、視覚チェック完了

### Step 7: DESIGN.md 反映と本ドキュメントの role 切替

- DESIGN.md §12 表の「§1 Theming」行を「準拠」に書き換え
- DESIGN.md §3 review-request CLI コマンド仕様に `--theme <system|light|dark>` を追記
- DESIGN.md §7 永続化に `localStorage("mdxg-redline.theme")` の存在を追記（IndexedDB は引き続き `workspace-handle` 1 件のみ、theme は localStorage を別途使う旨を明示）。複数レビューラウンド間の引き継ぎは workspace-handle と同じ origin 安定性に依存する旨を明記
- DESIGN.md §8 ワークスペースプロトコル「HTTP モードの origin 安定性」の段落に「theme の `localStorage` 値も同じ origin 安定性に依存」を 1 行追記
- DESIGN.md §11 セキュリティ: `<head>` の theme inline script が `localStorage` と `<html data-theme>` を read する旨を 1 行追記
- 本ドキュメントは「completed」マーカー付きで残すか、git ログだけ残して削除するかを判断

成果物：DESIGN.md 更新 + 本ドキュメントの今後の扱い決定

## 5. 設計判断

### a. theme の永続化先：localStorage を採用

| 候補             | 採用 | 理由                                                                                     |
| ---------------- | ---- | ---------------------------------------------------------------------------------------- |
| `localStorage`   | ✓    | 同期 read 可能で FOUC 防止 inline script から扱える                                      |
| IndexedDB        | ✗    | 非同期 API のため `<head>` 内 inline script の決定タイミングに間に合わず FOUC が発生する |
| `sessionStorage` | ✗    | タブを閉じると消えるため「次回起動時にも同じテーマ」を満たせない                         |
| cookie           | ✗    | `file://` で cookie が動かない / バックエンドがないため動機が薄い                        |

DESIGN.md §7 は「ブラウザ側の永続化は最小限」と明記しており、`localStorage` を追加することは原則違反に見える。ただし IndexedDB の唯一の用途は `FileSystemDirectoryHandle` の直シリアライズ（JSON 化不能なため IDB しか手段がない）であり、`localStorage` の追加は別目的・別ストアであり原則を破らない。DESIGN.md §7 / §11 に「テーマ設定は `localStorage("mdxg-redline.theme")` を別途使う」旨を明記して整合を取る。

### b. 既定値は `'system'`：MUST NOT 違反の回避

MDXG §1 の `[MUST NOT] ツールは、使える外観を得るためにユーザーが色を設定しなければならないようにしてはならない` を満たすため、`localStorage` 未設定時は `prefers-color-scheme` をそのまま反映し、ユーザーが何もしなくても OS テーマに従う。ユーザーが明示的にトグルを操作したら `'light'` / `'dark'` を `localStorage` に保存し、以降は明示優先。

### c. 切替循環は `system → light → dark`：3 状態を維持

リファレンス実装 (`apps/web`) は light/dark の 2 状態切替だが、MDXG Redline は `system` 追従モードを明示状態として持つ：

- 2 状態だと、一度トグルすると `system` に戻れない（`localStorage` clear が必要になる）
- 3 状態にすると、ユーザーが「OS 設定に戻したい」を 1 クリックで表現できる
- アイコン Sun / Moon / Monitor の 3 つで識別可能
- 起動後の OS テーマ変更（夕方の自動 dark mode 等）にも `system` の間だけリアクティブに追従可能（リファレンス実装は起動時スナップショットのみで追従しない）

**UI 表記方針**：内部状態名と UI 表記は分離する。

- 内部 (`StoredTheme` 型 / `localStorage` 値): `'system' | 'light' | 'dark'`（GitHub / VS Code / Shadcn / Tailwind と揃う業界標準語彙）
- ボタン `aria-label`: `Theme: system` / `Theme: light` / `Theme: dark`
- `data-tooltip`: 次の遷移先を表示（既存トグル UI の慣例に揃え、`Switch to light` / `Switch to dark` / `Switch to system`）

### d. CSS scope：`:root.dark` + `:where(.dark) #doc` の二段構え

#### d-1. アプリ全体 (`review.css`): `:root.dark` を採用（`@media (prefers-color-scheme: dark)` は使わない）

```css
:root { --paper: #ffffff; ... }
:root.dark { --paper: #1a1a1a; ... }
```

- `@media (prefers-color-scheme: dark)` だけだと OS 設定を強制反映してしまい、ユーザーが light に明示指定しても上書きできない
- inline script で `.dark` を付ける一元管理にすることで、light/dark/system の 3 状態を 1 つの class フラグで表現できる

#### d-2. `#doc` スコープ (`markdown.css`): `:where(.dark) #doc` を採用（カスタマイズ機能との両立）

`markdown.css` は将来、ユーザーが 1 ファイルで差し替えてプレビュー外観をカスタマイズできる機能を提供する予定がある（現行ファイル冒頭コメントの設計意図）。dark トークン上書きをアプリ側 `review.css` に置くと、ユーザーが `markdown.css` を差し替えた瞬間に dark 配色だけ消えて light/dark が分裂する。これを避けるため、light/dark のトークン定義を `markdown.css` 内に併置する：

```css
/* markdown.css */
#doc {
  --doc-paper: #ffffff;
  --doc-ink: #1a1a1a; /* ... light values ... */
}

/* HTML 側 .dark との契約。markdown.css 差し替え時もこの契約を踏襲することを推奨。 */
:where(.dark) #doc {
  --doc-paper: #1a1a1a;
  --doc-ink: #f2f2f2; /* ... dark values ... */
}
```

設計判断ポイント：

- **同一ファイル併置**：light/dark を `markdown.css` 1 ファイル内で完結させ、ユーザーが差し替える時は light/dark セットでまるごと差し替えられる
- **`:where()` で詳細度ゼロ化**：ユーザーが「自分のテーマは light 専用、dark 切替に追従させない」と書いた CSS で `#doc { background: #fafafa; }` のような通常ルールを書いた場合、それが dark 状態でも普通に上書き勝ちする（`.dark #doc` の詳細度は `#doc` より高いが、`:where(.dark) #doc` は `#doc` 単独と同じ詳細度）
- **アプリ側との契約は最小**：`<html>` に `.dark` クラスが付く / 外れるという 1 点だけがアプリ ↔ markdown.css の契約。`markdown.css` 冒頭コメントにこの契約と「dark 配色を省略した場合、dark モードでも `#doc` は light 配色のまま」という挙動を明記
- **`#doc` スコープ自己完結性の維持**：`markdown.css` は `:root` トークンを参照しないという既存方針を継承（`var(--paper)` 等は `review.css` 側専用、`var(--doc-paper)` 等は `markdown.css` 側専用）

### e. dark 配色は WCAG AA 目標 / 公式 DADS dark トークン待ちで暫定値

- DADS は primitive + Success/Error/Warning のみ公開、light/dark semantic は未公開（2026-05-22 時点）
- 公式公開を待つと無期限ブロックになるため、primitive から自前マッピングで先行実装
- `:root.dark` および `:where(.dark) #doc` の値は semantic 名で参照、primitive ID を §3 表に付記しておくことで公式 dark トークン公開時に機械的に差し替え可能

### f. primary button / floater / toast の文字色は dark で反転する

dark 切替で再評価が必要な要素：

- **`.btn-primary` の文字色は light/dark で切替**：light の `--success` `#1f883d` × 白文字は 4.51:1 で AA をギリギリ通過する GitHub Primer 由来のラインだが、dark の `--success` `#2cac6e`（primitive-green-500）× 白文字は **2.77:1 で AA を大幅に下回る**。dark の primary button を AA 通過させる選択肢は次の 3 案を比較した：
  - A 案：dark で文字色を反転（`#2cac6e` × `#1a1a1a` = 6.30:1 で AA 余裕通過、Material/Tailwind/Linear など dark mode primary button の慣行と一致）
  - B 案：dark で `--success` を暗色 (`#197a4b`) に振り直し白文字維持（`#197a4b` × `#ffffff` = 5.34:1 通過だが button が背景に沈む）
  - C 案：dark で `--success` を更に明色 (`#51b883`) にし暗文字反転（約 8.5:1 で AAA、ただし dark で button が目立ちすぎる）

  **A 案を採用**。light は既存挙動を維持しつつ dark UX として自然な慣行に合わせ、視覚回帰を最小化する。実装は `.btn-primary` の `color: #ffffff` ハードコードを `color: var(--btn-primary-fg)` に置換し、`--btn-primary-fg` を §3 表のとおり light `#ffffff` / dark `#1a1a1a` として定義する。

- `#floater` / `#toast` は `var(--ink)` 背景 + `#ffffff` 文字 → dark では背景が `#f2f2f2` に反転するため文字色も反転が必要 → `--floater-bg` / `--floater-fg` を新規 semantic トークン化し、dark で `#262626` 背景 + `#f2f2f2` 文字にする
- `.modal-backdrop` の `rgba(31, 35, 40, 0.5)` は light/dark どちらでも視認性 OK なのでハードコード許容

### g. review-request CLI `--theme` オプションと優先順位

複数レビューラウンドにまたがる theme 引き継ぎは `localStorage` だけでは origin 制約（HTTP モードの random fallback / `file://` のファイル単位 origin 分離）で失われ得るため、配布者（LLM エージェント）が初期値ヒントを HTML に埋め込めるよう CLI オプションを提供する。

#### 優先順位（P1 採用）

inline script は次の順で effective theme を決定する：

1. `localStorage('mdxg-redline.theme')` に値があればそれを採用（ユーザーが UI でトグルした履歴を最優先）
2. `<html>` の `data-theme` 属性に値があればそれを採用（CLI `--theme` の指定値）
3. どちらもなければ `'system'` 既定（`prefers-color-scheme` を反映）

#### CLI 既定値

`--theme` 未指定時は HTML に `data-theme` 属性を **付けない**。既存配布物との互換性を保ち、配布者が明示指定したケースだけ追加挙動が乗る。`--theme system` を明示指定すると `data-theme="system"` が付くが、挙動は未指定時と同じ（明示性は CLI / 配布物の自己記述性のために残す）。

#### 設計判断ポイント

- **`localStorage` を最優先する理由**：ユーザーが UI でトグルした選択を CLI が常に上書きすると押し付けがましく、MDXG §1 [MUST NOT]「使える外観を得るためにユーザーが色を設定しなければならないようにしてはならない」の精神（ユーザー自律性の尊重）に反する
- **CLI ヒントを `prefers-color-scheme` より優先する理由**：配布者が `--theme dark` を指定したケースは「配布物がそういう前提で書かれている」という意思表示で、初回起動時はその意思を尊重する方が素直
- **HTML 属性経路を採用する理由**：inline script が同期で読める必要があるため `<html data-theme>` 属性が最適。`embedded-md` / `embedded-feedback` と同じ「HTML 静的属性で配布者が宣言、inline script が起動時に読む」パターンに揃う
- **責務分担**：CLI / HTML は「初期値ヒント」だけを持ち、ユーザー個人の継続的な好みは持たない。これにより review-request CLI が個人状態を持つ責務違反を避けられる

#### この設計でカバーできる / カバーできないこと

| シナリオ                                                                                  | カバー | 備考                                                                                       |
| ----------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| 配布者がレビュー依頼ごとに theme を指定したい                                             | ✓      | `--theme dark` で配布                                                                      |
| CI / ヘッドレスで決定的に theme を固定したい                                              | ✓      | CLI オプションで決定                                                                       |
| ユーザーが UI でトグル → 同一 origin の次の HTML でも維持                                 | ✓      | `localStorage` が最優先                                                                    |
| ユーザーが UI でトグル → 異なる origin (random fallback / `file://`) の次の HTML でも維持 | ✗      | `localStorage` 分離により失われる。CLI 指定があればそれに fallback、なければ `system` 既定 |
| LLM エージェントが「前回 `dark` を選んだから次も `dark` で出して」と覚える                | △      | エージェントが状態を持つ必要があり現実的に難しい。CLI で毎回明示する運用なら可能           |

## 6. テスト方針

### in-source test（新規）

- `app/theme.ts`：
  - `resolveAppliedTheme` の全組み合わせ（stored 3 × system 2 = 6 ケース）
  - `resolveEffectiveTheme` の優先順位 P1 全組み合わせ（stored 4 値 [3 + null] × cliHint 4 値 × system 2 値 = 32 ケース、または代表 8 ケース）
  - `nextStoredTheme` の循環（system → light → dark → system）
  - `readStoredTheme` の localStorage 不正値 / クォータ超過時の fallback
  - `readCliHint` の `data-theme` 属性不正値 / 欠落時の fallback

- `app/toolbar.ts`：
  - theme toggle button の `aria-label` / `data-tooltip` が stored 値に応じて変わる
  - click 時に `writeStoredTheme` と `applyAppliedTheme` が呼ばれる

- `cli/parse-args.ts`：
  - `--theme system` / `--theme light` / `--theme dark` がパースされる
  - `--theme invalid` で exit 1 + stderr メッセージ
  - `--theme` 未指定時は `themeHint` が `undefined`

- `core/embed.ts`：
  - `themeHint` 指定時に `<html data-theme="...">` 属性が書き込まれる
  - `themeHint` 未指定時に `data-theme` 属性が付かない
  - 属性値は HTML 属性 escape を通る（既存 `data-name` と同じ経路）

### 手動視覚チェックリスト

`npm run build` 後の `dist/review.html` を Chromium で開き、以下をすべて確認：

- [ ] OS dark で初回起動 → dark で表示される（FOUC なし）
- [ ] OS light で初回起動 → light で表示される
- [ ] トグル `system → light` で OS が dark でも light が維持される
- [ ] トグル `light → dark` でリロード後も dark が維持される
- [ ] トグル `dark → system` 後、OS テーマ変更がリアルタイムで追従する
- [ ] `Open file` でレビュー対象 markdown を読み込み、`#doc` 内（見出し / リンク / blockquote / code / pre / table / hr / checkbox）の全要素が dark で視認できる
- [ ] テキストを選択して floater を表示、`#floater` が dark で視認できる
- [ ] コメント入力モーダルが dark で視認できる
- [ ] サイドバーのコメントカード（idle / hover / active）が dark で視認できる
- [ ] `<mark class="cmt">` の idle / active 両状態で本文テキストが読める
- [ ] toast 通知（`Copied!` 等）が dark で視認できる
- [ ] DevTools の axe extension で対象組み合わせの contrast 違反がない
- [ ] Embedded markdown 同梱の HTML をダブルクリック起動した時にも FOUC が出ない
- [ ] `node dist/review-request.mjs --theme dark <input.md>` で生成した HTML を初回起動 → dark で表示される
- [ ] 上記 HTML で UI トグルで light にしてリロード → light が維持される（`localStorage` が CLI ヒントより優先）
- [ ] `--theme` 未指定で生成した HTML には `<html>` に `data-theme` 属性が **付かない**
- [ ] `node dist/review-request.mjs --theme invalid` で exit 1 + stderr にエラーメッセージ

## 7. 受け入れ基準

- MDXG §1 の 4 要件をすべて満たす（§1 冒頭の対応スコープ表が全て ✓）
- 既存の light モード見た目に視覚回帰がない（in-source test 失敗なし + 手動チェック通過）
- `dist/review.html` のサイズ増分が +5 KB 以内（CSS variables 追加 + inline script + theme.ts 分のみ）
- WCAG AA contrast 要件を §3「コントラスト確認の責務」で挙げた代表組み合わせで満たす
- DESIGN.md §12 表の「§1 Theming」が「準拠」に書き換わる

## 8. 想定リスクと回避策

| リスク                                                              | 回避策                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| inline script が CSP `script-src 'self' 'unsafe-inline'` で弾かれる | DESIGN.md §11 で `'unsafe-inline'` 既に許可済み、追加変更不要。`'unsafe-inline'` は singlefile inline bundle のためそもそも必要                                                                                                                                                                                                                                                                                           |
| `localStorage` が disable された環境（プライバシーモード）          | inline script を `try {} catch (e) {}` で囲み、失敗時は `prefers-color-scheme` だけで動作                                                                                                                                                                                                                                                                                                                                 |
| 既存 `dist/review.html` への CSS 増分が大きい                       | dark 値はテキスト hex のみで圧縮率が高い。gzip 後 +1 KB 以下の見積もり                                                                                                                                                                                                                                                                                                                                                    |
| dark で `<mark class="cmt">` の前景色が読めなくなる                 | Step 6 で `<mark>` 内テキスト色を dark 専用に固定するか、`--highlight` を別パレットに振り直す                                                                                                                                                                                                                                                                                                                             |
| DADS 公式 dark トークン公開時に値が大きく変わる                     | §3 表で primitive ID を併記しているため、機械的差し替えが可能。semantic variable 名は変更不要                                                                                                                                                                                                                                                                                                                             |
| FOUC inline script が `marked` の bundle と読み込み順で衝突         | inline script は `<head>` 内 stylesheet `<link>` より前、`<script type="module">` より前に配置                                                                                                                                                                                                                                                                                                                            |
| 複数レビューラウンド間で theme 値が引き継がれない（origin 制約）    | `localStorage` は origin スコープ。HTTP モードのデフォルトポート (`51729`) が確保できれば同一 origin で共有、random fallback / `file://` のファイル単位 origin 分離では失われる。`workspace-handle` (§7) と同じ制約で、§8 ワークスペースプロトコルの「HTTP モードの origin 安定性」の枠組みで整理。CLI `--theme` ヒント (§5.g) と `system` 既定 (§5.b) が緩衝材として働き、明示指定をしていないユーザーには違和感が出ない |

## 9. 参考

- [MDXG §1 Theming（日本語訳）](./mdxg/01-rendering.md#1-themingテーマ)
- [vercel-labs/mdxg リファレンス実装](https://github.com/vercel-labs/mdxg)
- [digital-go-jp/design-tokens](https://github.com/digital-go-jp/design-tokens) — primitive カラーパレット
- [digital-go-jp/tailwind-theme-plugin](https://github.com/digital-go-jp/tailwind-theme-plugin) — DADS の Tailwind 統合例（dark semantic は未定義）
- [DESIGN.md §12 MDXG 準拠状況と設計判断](./DESIGN.md#12-mdxg-準拠状況と設計判断)
- [DESIGN.md §7 永続化レイヤー](./DESIGN.md#7-永続化レイヤー)
- [DESIGN.md §11 セキュリティとプライバシー](./DESIGN.md#11-セキュリティとプライバシー)
