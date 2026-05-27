# MDXG §16 Footnotes 対応 設計・実装計画

DESIGN.md §12「その他の拡張候補」の「MDXG §16 Footnotes の対応」項目を実装に落とすための設計判断と実装手順をまとめる。完了時点で本ドキュメントは DESIGN.md §12 表に「§16 Footnotes」行を追加して「準拠」に塗り替え、本ファイルは `docs/mdxg-footnotes.archive.md` にリネームしてアーカイブする想定（`docs/mdxg-rendering-code-block.archive.md` と同じ扱い）。

## 1. 対応スコープ

[MDXG §16 Footnotes](./mdxg/05-extensions.md#16-footnotes脚注) の 4 要件を、GFM 互換の `[^id]` / `[^id]: ...` 文法に対して満たす。

| 要件                                                                                  | 現状   | 完了条件                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [SHOULD] 脚注参照（`[^1]` / `[^note]`）が脚注定義へジャンプする上付きリンクとして描画 | 未     | marked-footnote 1.4.0 を導入し、`<sup><a id="footnote-ref-<id>" href="#footnote-<id>" data-footnote-ref aria-describedby="footnote-label">N</a></sup>` として inline 描画（marked-footnote の実出力に従う）                                                                                                         |
| [SHOULD] 脚注定義（`[^1]: ...`）が各参照への後方リンクとともにページ末に描画          | 未     | 文書末に synthetic な `<section class="footnotes" data-footnotes>` を生成。各定義 (`<li id="footnote-<id>">`) に `<a href="#footnote-ref-<id>" data-footnote-backref aria-label="Back to reference <id>">↩</a>` の backref を付与。Stacked View では最終 page の後に独立 section として配置                         |
| [MUST] 脚注未サポート時に生の文法を保持                                               | ✓      | marked デフォルトは `[^1]` を plain text として出力するため既に satisfied。回帰させない                                                                                                                                                                                                                             |
| [MUST NOT] ストリップ / 隠蔽                                                          | 要対応 | **marked-footnote 1.4.0 は未参照定義 `[^orphan]: text` を完全に隠蔽する** ことが Step 1 PoC で確定 (`.temp/footnote-poc-extra.mjs` Case D)。`core/footnotes.ts` に lexer 走査ベースの post-processing を実装し、orphan を `<section.footnotes>` の `<ol>` に手動 append して隠蔽を防ぐ（§3.1 / §5.j / Step 2 詳細） |

追加実装（規格上は SHOULD 未満だが UX 上有用）：

- **キーボードナビゲーションでの jump / back-jump**：footnote-ref を Enter で発火させると `#footnote-<id>` に scroll + focus、backref を Enter で `#footnote-ref-<id>` に戻る。`navigateToTarget` の hash 解決経路に脚注 hash パターン (`footnote-<id>` / `footnote-ref-<id>`) を追加（DESIGN.md §12 §13 Keyboard Navigation との整合）。**ID prefix が marked-footnote 1.4.0 の実出力（`footnote-` / `footnote-ref-`）であることに注意**。docs 草案で参照していた `fn-` / `fnref-` は GFM 慣用上の仮 prefix で、本実装では採用しない
- **複数参照時の backref 分岐**：同じ `[^id]` が複数回参照されている場合、定義側に複数の backref を並べて配置（1 番目は `↩`、2 番目以降は `↩<sup>N</sup>`）。クリックすると対応する参照位置に戻れる（marked-footnote の標準出力に追従）

スコープ外（別タスクで扱う）：

- **§16.2 [MAY] hover でのツールチップ / ポップオーバープレビュー**：UX としては有用だが、実装には popper.js 等のポジショニングライブラリが必要で配布物サイズへの影響と footnote 全体の優先度を考慮し、本タスクでは扱わない。Phase 2 として将来追加する余地を残す
- **§16.2 [MAY] ワイドレイアウトでのサイドノート**：本実装の `#doc` 幅 (max 860px) ではサイドノート専用の余白を確保しておらず、レイアウト構造の見直しを伴う。本タスクでは扱わない
- **MDX 風の名前付き脚注 syntax**（`[^note]: ...` の `note` を任意文字列に許容）：marked-footnote の標準対応範囲なので自動で機能する。本ドキュメントでは特記しない

## 2. リファレンス実装と差分

[vercel-labs/mdxg `apps/web`](https://github.com/vercel-labs/mdxg/tree/main/apps/web) は §16 を実装していない（脚注は marked デフォルトの plain text として表示される）。本実装はリファレンス実装の先行参考が無い領域となるため、本章は「ベースラインアーキテクチャ」として既存実装と marked-footnote 公式の組み合わせを記述する。

| 既存実装の構成要素                                     | 本実装の置換 / 追加                                                                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| marked の `extensions` 機構                            | `marked-footnote` extension を `core/markdown.ts` の marked 設定に追加。`use(footnote())` を 1 行加えるだけ                          |
| Shiki / Mermaid / KaTeX の upgrade パターン            | 採用しない。脚注は同期 marked render の中で完結し、paint 後 lazy upgrade を必要としない（DOM 生成コストが軽量）                      |
| CLI `--shiki-langs` / `--mermaid` / `--math` の opt-in | 採用しない（§5.b デフォルト ON）。脚注機能の bundle サイズ影響が軽微で、自然言語との誤検出リスクも無い                               |
| 単一 HTML 配布物のサイズ                               | `marked-footnote` の bundle サイズ +3〜5 KB raw / +1〜2 KB gzipped。実用上 ゼロ近似                                                  |
| 仮想ページ (`Page[]`) との統合                         | `core/page-split.ts` の出力後に脚注定義を synthetic page (`slug: 'footnotes'`, `depth: 1`, `title: 'Footnotes'`) として末尾に append |
| DESIGN.md §12 §13 Keyboard Navigation                  | footnote-ref / footnote-backref を `FOCUSABLE_LINK_SELECTOR` に追加し既存の Tab 巡回経路に乗せる                                     |

リファレンス実装が §16 を実装していない理由は推測になるが、`@tailwindcss/typography` の `prose` クラスが footnote 描画を持たず、carrying cost が見合わなかった可能性。本実装は GFM 慣習に揃え marked-footnote の標準出力をそのまま受け入れる方針を採る。

## 3. 構造設計

### 3.1 marked-footnote 拡張の導入

`src/core/markdown.ts` の marked 初期化に拡張を追加：

```ts
import { marked } from 'marked'
import footnote from 'marked-footnote'

marked.use(footnote())
```

これにより（marked-footnote 1.4.0 の実出力、Step 1 PoC `.temp/footnote-poc.mjs` で実測）：

- インライン参照 `[^1]` → `<sup><a id="footnote-ref-1" href="#footnote-1" data-footnote-ref aria-describedby="footnote-label">1</a></sup>`
  - クラスは付かず、判定は `[data-footnote-ref]` 属性で行う
  - id prefix は `footnote-ref-`（docs 草案の `fnref-` は使われない）
- 定義 `[^1]: text` → marked の AST 上で独立した `footnote` トークンとして集約され、レンダリング末尾で次の構造で一括出力：

  ```html
  <section class="footnotes" data-footnotes>
    <h2 id="footnote-label" class="sr-only">Footnotes</h2>
    <ol>
      <li id="footnote-1">
        <p>
          text
          <a href="#footnote-ref-1" data-footnote-backref aria-label="Back to reference 1">↩</a>
        </p>
      </li>
    </ol>
  </section>
  ```

  - section に `data-footnotes` 属性、`class="footnotes"` の両方
  - 強制挿入される `<h2 class="sr-only">Footnotes</h2>` (a11y 用の見えない見出し)。CSS の `sr-only` を本実装側で用意する必要がある（DESIGN.md §12 §1 Theming の `.sr-only` ルールが未提供なら Step 8 で追加）
  - backref は class なし、`[data-footnote-backref]` 属性で判定。複数参照時は 1 番目が `↩`、2 番目以降は `↩<sup>N</sup>` のテキスト
  - id prefix は `footnote-`（docs 草案の `fn-` は使われない）

marked-footnote 1.4.0 は ID 衝突解消（同じ `[^id]` の重複定義は最初を採用）/ 未定義参照の plain text fallback（`[^missing]` が解決されなければそのまま残る）/ 複数参照時の backref 採番（`footnote-ref-1` / `footnote-ref-1-2` / ...）を標準で備える。**ただし未参照定義 `[^orphan]: text` は完全に隠蔽されることが Step 1 PoC `.temp/footnote-poc-extra.mjs` Case D で確定した**。MDXG §16 [MUST NOT] 「ストリップ / 隠蔽してはならない」と矛盾するため、本実装は次の post-processing を `core/footnotes.ts` に持つ：

1. `core/markdown.ts` の全文 parse 前に同じ markdown を `marked.lexer` で走査して `type: 'footnote'` トークンを収集（`label` / `refs` を取得）
2. `refs: []` （= 未参照）のラベル集合を `getOrphanFootnoteIds(markdown)` として返す
3. parse 後の DOM 上の `<section.footnotes><ol>` に対し、各 orphan ラベルについて marked-footnote の出力と同形式の `<li id="footnote-<id>"><p>{content} <a href="#footnote-ref-<id>" data-footnote-backref aria-label="Back to reference <id>">↩</a></p></li>` を append する（backref は **対応する `<a id="footnote-ref-<id>">` が DOM 内に存在しないため click しても飛ばないが、視覚的に他定義と同形式を保つ目的で残す**。orphan を機械的に区別したい場合は `<li>` に `data-footnote-orphan="1"` を付与）
4. もし orphan は存在するが marked-footnote が `<section.footnotes>` 自体を出力していない状況（脚注定義が orphan のみ、参照ゼロ）では、本実装が空の `<section class="footnotes" data-footnotes>` 骨格を synthetic に生成する経路を追加する

この post-processing は `app/doc-renderer.ts` 側ではなく `core/footnotes.ts` に閉じた pure 関数 (`renderOrphanFootnoteItems(markdown, fragment)`) として実装し、doc-renderer からは Step 4.3 の `extractFootnoteSection` 経路と連携する形で呼ぶ。

> **Marked instance state 汚染**：Step 1 PoC で同一 Marked instance で `lexer()` 呼び出し後に `parse()` を呼ぶと `Cannot read properties of undefined (reading 'filter')` でクラッシュすることが確定した（marked-footnote 1.4.0 の lexer/parse 共有 state バグ）。本実装は `core/footnotes.ts` の orphan 検出用 lexer 呼び出しと `core/markdown.ts` の全文 parse 呼び出しで **別 Marked instance を使う** か、または **lexer 結果のキャッシュを廃棄してから parse する** 設計を取る（Step 2 で確定）。

### 3.2 仮想ページとの統合

Stacked View（DESIGN.md §12 §7 Page Navigation）で全 virtual-page section が連続表示される構造に脚注セクションをどう乗せるかが論点。本実装は **synthetic page 方式** を採用（§5.c で比較）：

- `core/page-split.ts` で markdown を `Page[]` に分割した後、`buildFootnotesPage(markdown)` で脚注定義の有無を判定
- 1 個以上の脚注定義があれば、`Page[]` 末尾に次の synthetic page を append：
  ```ts
  {
    slug: 'footnotes', // 本物の H1「Footnotes」と衝突する場合は resolveUniqueSlug で 'footnotes-2' 等に解決
    title: 'Footnotes',
    depth: 1,
    sourceLineStart: -1, // synthetic sentinel
    sourceLineEnd: -1,
    markdown: '', // 文書由来の本文行を持たない sentinel。脚注セクション本体は別経路 (Step 4.3) で挿入する
    ancestorHeadingPath: [],
    headings: [],
  }
  ```
- `doc-renderer.ts` の Stacked View 描画ループは通常の page と同様に `<section class="virtual-page" data-page-slug="<resolved-slug>">` として描画する。**この section の中身は synthetic page の `markdown: ''` を marked に渡して生成するのではなく、Step 4 の「全文 1 回 parse + 配賦」フローで `marked.parse(fullMarkdown)` の出力末尾から `<section[data-footnotes]>` を `extractFootnoteSection` で切り出して appendChild する**（空 markdown を marked に再度渡しても脚注セクションは出力されないため、この経路でしか脚注 DOM は挿入されない）。詳細は Step 4.3
- **orphan のみ（参照ゼロ）のケースでは marked-footnote が `<section[data-footnotes]>` 自体を出力しない**（Step 1 PoC で確定）。この場合 `extractFootnoteSection` は null を返し、`renderOrphanFootnoteItems` が synthetic に section 骨格を組み立てて返す経路に乗る（§5.j A 案 で確定）。`countFootnoteDefinitions >= 1` の判定は orphan も数えるため synthetic page 追加判定はこのケースもカバーする

**round-trip 不変条件の再定義**：DESIGN.md §12 §6 Virtual Pages は「全ページの `markdown` を連結すると元 markdown と完全一致する」不変条件を持つが、footnotes synthetic page は文書由来ではないため `markdown: ''` でこれを破る。本実装ではこの不変条件を「**文書由来 page (`sourceLineStart !== -1`) のみ対象**」に再定義する。`page-split.ts` のテストにこの sentinel 判定を追加し、synthetic page を round-trip 検査から除外する。Step 9 で DESIGN.md §12 §6 にこの再定義を追記する

### 3.3 ハッシュナビゲーションと URL 同期

DESIGN.md §12 §7 `navigateToTarget` / `resolveTargetFromHash` が `#p:<page-slug>` / `#p:<page-slug>__<heading>` を解釈する経路に、脚注 hash パターンを追加：

- `#footnote-<id>` （参照クリック → 定義へジャンプ）
- `#footnote-ref-<id>` / `#footnote-ref-<id>-<n>` （backref クリック → 参照位置へ戻る、複数参照時は `-2` / `-3` ... suffix が付く）

これらは `p:` prefix を持たない要素 ID 形式のため、page slug 経路と構造的に分離できる。`resolveTargetFromHash` の現状の戻り型は `NavigateTarget`（不正 hash でも `{ pageIndex: 0, headingSlug: null }` を返す non-nullable 設計）なので、null フォールバックの分岐を増やすのではなく、**review.ts の click delegate 側で hash prefix を先に判定して経路を分ける**：

1. `a[data-footnote-ref]` / `a[data-footnote-backref]` を click delegate で捕捉（あるいは `a[href^="#footnote-"]` の正規表現マッチでも等価。属性ベースの方が marked-footnote 出力の変更に追従しやすい）
2. `document.getElementById(elementId)` で対象要素を解決
3. 祖先 `<section class="virtual-page">` から `data-page-index` を読んで `pageIndex` を得る
4. `navigateToTarget({ pageIndex, headingSlug: null }, true)` で page 切替 + 同期スクロール、その後に `element.scrollIntoView()` + `focus()` を呼ぶ

これにより `resolveTargetFromHash` 本体の戻り型を変えず、footnote 専用経路として独立した hash handler を `app/review.ts` に追加する形になる。

- 参照クリック (`#footnote-<id>`) → footnotes synthetic page (`pageIndex = pages.length - 1`) に scroll、定義要素に focus
- backref クリック (`#footnote-ref-<id>` / `#footnote-ref-<id>-<n>`) → 参照を含む元 page に scroll、参照要素に focus

### 3.4 配布物サイズ影響

Mermaid / KaTeX と異なり `marked-footnote` は marked 拡張として build 本体に組み込むため、CLI 経路 / standalone 経路の両方（`dist/embed-template.html` / `dist/standalone.html` 双方）に bundle される。基準値は DESIGN.md §12 §2 Code Block Rendering / §13 ビルドパイプラインに記載の embed-template ~334 KB / gzip ~102 KB（KaTeX 空タグ込み）、standalone ~48 MB / gzip ~6.9 MB（Mermaid + KaTeX `all` 相当 inline 込み）：

| ケース     | embed-template.html (raw / gzip) | standalone.html (raw / gzip) | marked-footnote 増分            |
| ---------- | -------------------------------- | ---------------------------- | ------------------------------- |
| 現行       | ~334 KB / ~102 KB                | ~48 MB / ~6.9 MB             | -                               |
| 脚注対応後 | ~338 KB / ~104 KB                | ~48 MB / ~6.9 MB             | +3〜5 KB raw / +1〜2 KB gzipped |

実用上ゼロ近似（特に standalone は元のサイズが大きいため割合インパクトは無視できる）。CLI フラグでの opt-in を不要とする根拠（§5.b）。

## 4. 実装ステップ

順序は依存関係順。各ステップ完了で in-source test と手動視覚チェックを通す。

### Step 1: ライブラリ選定の検証と PoC ✅ 完了

実装 commit / 成果物：

- `marked-footnote@1.4.0` を `package.json` の `dependencies` に exact pin 追加（適用済み）
- PoC 実行スクリプト `.temp/footnote-poc.mjs` / `.temp/footnote-poc-extra.mjs` で次を実測：
  - **DOM 構造**：marked-footnote 1.4.0 の実出力は docs 草案で想定していた `<sup class="footnote-ref">` / `id="fnref-<id>"` / `id="fn-<id>"` ではなく、`<sup><a data-footnote-ref id="footnote-ref-<id>" href="#footnote-<id>" aria-describedby="footnote-label">`、`<li id="footnote-<id>">`、`<a data-footnote-backref href="#footnote-ref-<id>">↩</a>` であることを確定。section も `<section class="footnotes" data-footnotes>` + 強制挿入 `<h2 id="footnote-label" class="sr-only">Footnotes</h2>` を含む。§3.1 / §3.3 / §5.e / §6 / §8 のセレクタ・ID prefix を全部この実出力に書き換え済み
  - **未参照定義は隠蔽される**：`[^orphan]: text` を本文で参照しないと出力 HTML に痕跡ゼロで消える（MDXG §16 [MUST NOT] 違反）。ただし `marked.lexer` 段階では `type: 'footnote'` トークンが `refs: []` 状態で AST に乗るため検出可能。本実装側で post-processing を追加する経路を §3.1 / §5.j / Step 2 に確定（§1 冒頭の対応スコープ表も「要対応」に塗り替え済み）
  - **未定義参照**は plain text `[^missing]` のまま残る（OK、docs 通り）
  - **重複定義**は first wins（OK、docs 通り）
  - **複数参照時の backref**は `↩` / `↩<sup>2</sup>` 形式（docs 草案の `↩₁ / ↩₂` とは異なる、marked-footnote 標準に追従）
  - **token.line 等の sourceLine API は存在しない**。`token.raw` の改行カウント累積で算出可能（`core/block-anchors.ts` 流）。**ただし lexer 出力先頭に `type: 'footnotes'`（複数形）の synthetic placeholder token (`raw: 'Footnotes'`) が必ず挿入されるため、cursor 加算からは skip 必須**
  - **Marked instance 状態汚染**：同一 Marked instance で `lexer()` 呼び出し後に `parse()` を呼ぶと `Cannot read properties of undefined (reading 'filter')` でクラッシュすることが確定。`core/footnotes.ts` の orphan 検出用 lexer 呼び出しと `core/markdown.ts` の全文 parse 呼び出しで別 Marked instance を使う設計に確定（Step 2 / §3.1 末尾の注記）

成果物：§5 マッピング表が確定状態、PoC で marked-footnote が動くこと、未参照定義が隠蔽されることが確定、token sourceLine は raw 累積で取得可能（placeholder skip 込み）、Marked instance 分離設計の必要性が確定

### Step 2: `core/markdown.ts` 拡張と `core/footnotes.ts`（新規）の追加

- `core/markdown.ts` の marked 初期化に `marked.use(footnote())` を追加（既存 `marked` の `Marked` インスタンスをそのまま使う場合と、本処理用に別インスタンスを作る場合で挙動が変わる点に注意。Step 1 PoC で確定した instance 状態汚染問題のため、**lexer 専用と parse 専用で別 instance を用意する**）
- `core/footnotes.ts`（新規）で次の pure 関数を実装：

  ```ts
  // markdown 内の脚注定義の数を数える（synthetic page 追加判定用）
  export function countFootnoteDefinitions(markdown: string): number

  // 脚注定義の ID 集合を抽出（synthetic page 用の DOM 生成や ID 衝突検出に使う）
  export function extractFootnoteIds(markdown: string): string[]

  // 本文で参照されていない (refs: []) 脚注定義 ID の集合を返す。
  // marked-footnote 1.4.0 は未参照定義を出力 HTML から完全に隠蔽するため
  // (Step 1 PoC で確定、MDXG §16 [MUST NOT] 違反)、これを post-processing 経路で
  // 描画する必要がある。lexer 出力の `type: 'footnote'` トークンで `refs.length === 0`
  // のものが対象。
  export function getOrphanFootnoteIds(markdown: string): readonly string[]

  // 各 orphan 定義のコンテンツを取得して <li id="footnote-<id>"> を組み立て、
  // 既存の <section.footnotes> > <ol> に追加する。section が存在しない (脚注定義が
  // orphan のみ、参照ゼロ) ケースでは synthetic な section 骨格を組み立てて返す。
  export function renderOrphanFootnoteItems(
    markdown: string,
    section: HTMLElement | null
  ): HTMLElement | null

  // marked.parse 出力の DocumentFragment 末尾から <section class="footnotes">
  // (= [data-footnotes]) を切り出す。Step 4.3 で footnotes synthetic page に
  // appendChild するためのヘルパ。
  export function extractFootnoteSection(fragment: DocumentFragment): HTMLElement | null
  ```

- `marked.lexer` から `footnote` トークンを収集する経路で実装（marked-footnote が AST に追加するトークン型 `'footnote'`、および先頭 placeholder `'footnotes'` の 2 種類が存在する点に注意）

成果物：`src/core/footnotes.ts` + in-source test（脚注定義なし / 1 個 / 複数 / 未参照定義（orphan）/ 重複定義の最初採用挙動 / `renderOrphanFootnoteItems` で orphan が `<li id="footnote-<id>">` として追加されること / `extractFootnoteSection` が `[data-footnotes]` の section を切り出すこと）

### Step 3: 仮想ページとの統合（`core/page-split.ts` 拡張）

- `core/page-split.ts` の `splitIntoPages` 出力後に `appendFootnotesPage(pages, markdown)` を実行：
  ```ts
  function appendFootnotesPage(pages: Page[], markdown: string): Page[] {
    if (countFootnoteDefinitions(markdown) === 0) return pages
    return [...pages, buildFootnotesSyntheticPage()]
  }
  ```
- synthetic page の `slug` は文書中の通常 page slug と衝突しないよう、`'footnotes'` が既に使われていたら `'footnotes-2'` ... の suffix を `resolveUniqueSlug`（§6.4 既存ロジック）で付与
- `Page.sourceLineStart` / `sourceLineEnd` は `-1` 固定。export feedback.json の `sourceLine` 解決時に footnotes synthetic page 起源のブロックは除外する経路を `findPageIndexBySourceLine` に追加

成果物：脚注を含む markdown が footnotes synthetic page 追加付きで `Page[]` を返すこと（in-source test）

### Step 4: `doc-renderer.ts` での描画戦略変更 — 全文 parse + virtual page 配賦

**page 単位 parse は廃止し、全文 1 回 parse + 各 top-level block を所属 virtual page に配賦する戦略に切り替える。** これは脚注の `footnote-ref-*` / `footnote-*` 採番が「単一 parse 呼び出し内でのみ一貫」する制約に対応するための構造変更（§5.h で詳細）。

#### 4.1 新しい描画フロー

1. `marked.parse(fullMarkdown)` を 1 回だけ呼ぶ（脚注 ID の採番がこの 1 回で確定）
2. 出力 HTML 文字列を `<template>` でパースして DocumentFragment 化
3. DocumentFragment の top-level child を順に walk し、各 block の sourceLine を取得（marked.lexer のトークン列と `marked.parse` の出力を対応付ける `parseAndAnnotate(markdown)` ヘルパを `core/markdown.ts` に追加）
4. 各 block について `findPageIndexBySourceLine(state.pages, sourceLine)` で所属 page を解決
5. その page の `<section class="virtual-page">` に block を `appendChild` で配置
6. 末尾の `<section class="footnotes">` （= `[data-footnotes]`）を footnotes synthetic page (`pages[pages.length - 1]`) に配置。この section 内に対して `core/footnotes.ts` の `renderOrphanFootnoteItems` を呼んで未参照定義の `<li>` を append する（MDXG §16 [MUST NOT] 救済、Step 2）

これにより：

- `footnote-ref-*` / `footnote-*` 採番が文書全体で一貫
- HTML 仕様上の id 重複が構造的に発生しない（同じ id を持つ DOM ノードが 1 個に保証される）
- backref が必ず到達する
- 2 回 parse の冗長性も解消（page 数 N に対して O(N) → O(1) パース呼び出し）

#### 4.2 sourceLine 注釈の取得経路

marked 標準では各 token の sourceLine は安定 API ではないため、本実装は `parseAndAnnotate(markdown)` を次のとおり実装する：

1. `marked.lexer(markdown)` で AST を取得（**lexer 専用 Marked instance を使う**。Step 1 PoC で確定した state 汚染対策。同一 instance で lexer 後に parse すると crash する）
2. AST の top-level token を順に走査し、`token.raw` の累積長から行番号を計算（既存 `core/block-anchors.ts` が同じパターンで sourceLine を解決済み）。**lexer 出力先頭の `type: 'footnotes'` placeholder token は raw 累積から除外する**（Step 1 PoC で確認、`raw: 'Footnotes'` は文書上の行を消費しない synthetic token）
3. 各 token に対して個別 `marked.parser([token])` を呼び、出力 HTML に `data-source-line="<n>"` 属性を marked のレンダラーフック経由で注入
4. ただし footnote 定義 (`type: 'footnote'`) は AST 上 inline 含む特殊トークンで、本処理では skip（脚注セクション全体を末尾でまとめて取り扱う）
5. 全文 `marked.parse(fullMarkdown)` は parse 専用 Marked instance で別途呼んで `<section.footnotes>` を生成（lexer instance とは分離）

これにより block と sourceLine の対応が `data-source-line` 属性で DOM に焼き込まれ、配賦時に同属性を読むだけで所属 page を解決できる。

#### 4.3 footnotes synthetic page の特例

footnotes synthetic page は markdown 上に対応行を持たないため、配賦ルールは「`<section class="footnotes" data-footnotes>` を末尾 page にハードコード配置」とする。`extractFootnoteSection(fragment): HTMLElement | null` を `core/footnotes.ts` に追加：

- DocumentFragment の最後の子が `<section[data-footnotes]>`（= `class="footnotes"`）であれば extract（属性ベース判定のほうが marked-footnote 出力の class 命名変更に追従しやすい）
- 無ければ null（脚注定義が **参照付きで** 0 個の文書。orphan のみのケースでは marked-footnote が section 自体を出力しないため、`renderOrphanFootnoteItems` が synthetic に section 骨格を生成して返す）

extract した section は footnotes synthetic page の `<section class="virtual-page">` に配置。各定義 `<li id="footnote-<id>">` には通常通り `data-block-id` を付与し、textSegments / コメント / 検索の対象に乗せる。strong assertion の前提として **強制挿入される `<h2 id="footnote-label" class="sr-only">Footnotes</h2>` も `<li>` と同列の DOM 上に出現する**ため、textSegments 経路でこの sr-only 見出しを walk skip する（§5.j の決定に従う：a11y 用 visible-hidden 要素を選択 / 検索対象から外して UX を保つ）。

extract 後の section に対して `renderOrphanFootnoteItems(markdown, section)` を呼び、Step 1 PoC で確定した「未参照定義は marked-footnote 1.4.0 で隠蔽される」問題への post-processing 救済を適用する（§5.j A 案）。orphan は `<li id="footnote-<id>" data-footnote-orphan="1">` として `<ol>` に append される。

#### 4.4 既存 page 単位 parse 経路の廃止

現状の `doc-renderer.ts` は page ごとに `marked.parse(page.markdown)` を呼んでいるが、これを **footnotes の有無に関わらず常に「全文 parse + 配賦」に統一** する。理由：

- コードパスを 2 系統持つ保守コストを避ける（脚注未使用文書では旧経路、脚注使用文書では新経路、という分岐は将来の拡張を複雑化する）
- 全文 parse は性能上も劣化しない（marked は十分高速で、典型 markdown 文書 1 回の parse は 1〜10ms）
- §5.h の split 順序と整合（`splitIntoPages` の責務を維持し、parse / render は別レイヤーで管理）

成果物：脚注セクションが文書末の synthetic page として描画されること、各定義にコメント / 検索が付くこと、`footnote-ref-*` / `footnote-*` id が文書内で一意であること、`data-source-line` 属性経由で block の page 配賦が動くこと、未参照定義が `renderOrphanFootnoteItems` 経路で `<li>` として復活描画されること

### Step 5: ハッシュナビゲーションと URL 同期

- `app/review.ts` の click delegate で `a[data-footnote-ref]` / `a[data-footnote-backref]`（あるいは等価な `a[href^="#footnote-"]`）を捕捉する footnote 専用 hash handler を追加：

  ```ts
  function handleFootnoteHashClick(hash: string): boolean {
    if (!/^#footnote(-ref)?-/.test(hash)) return false
    const elementId = hash.replace(/^#/, '')
    const el = document.getElementById(elementId)
    if (!el) return false
    const section = el.closest('section.virtual-page')
    if (!section) return false
    const pageIndex = Number(section.getAttribute('data-page-index'))
    navigateToTarget({ pageIndex, headingSlug: null }, true)
    el.scrollIntoView({ behavior: 'auto', block: 'center' })
    if (el instanceof HTMLElement) el.focus({ preventScroll: true })
    return true
  }
  ```

- `resolveTargetFromHash` 本体（戻り型 `NavigateTarget`、不正 hash でも `{ pageIndex: 0, headingSlug: null }` を返す non-nullable 設計）には触らず、click delegate と hashchange listener の前段で `handleFootnoteHashClick` を呼んで footnote 経路を切り出す。これにより page slug (`#p:<slug>`) の解決経路と footnote の element ID 解決経路が **hash prefix で構造的に分離** される
- backref クリックも同じ経路で動く（href が `#footnote-ref-<id>` または `#footnote-ref-<id>-<n>` を指す）

成果物：脚注参照クリックで定義へ jump、backref クリックで元参照に戻ること（手動チェック）

### Step 6: §6 アンカリングと §10 Search の維持確認

- 脚注定義 `<li id="footnote-<id>">` は通常段落と同じく `data-block-id` を持つブロックとして textSegments / コメント / 検索の対象になる
- インライン参照 `<sup><a data-footnote-ref>` は textContent が `1` のような番号文字列で、source markdown の `[^1]` (4 文字) と長さが異なる。これは Math (§14) の `[data-math]` と同じ問題で、同じパターンで解決する：
  - `selection.ts` の `textSegments` が `<sup>` 配下に `[data-footnote-ref]` を持つ `<a>` を含む要素に到達したら、子孫を walk せず raw `[^<id>]` 文字列を 1 セグメントとして返す（判定単位は `<sup>` 全体。marked-footnote 1.4.0 では `<sup>` 配下に必ず単一の `<a data-footnote-ref>` だけが入る）
  - `<a data-footnote-ref>` の `id` 属性（`footnote-ref-<id>` または `footnote-ref-<id>-<n>`）から `<id>` 部分を slice して `[^<id>]` を再構成（`-<n>` suffix は同一 id の複数参照判定用で id 抽出時には削る）
  - これにより文書中で脚注参照を含む段落のコメント / 検索オフセットが source markdown と一致する
- §10 Search の `<mark class="search-hl">` も同様に `<sup>` (footnote-ref を含むもの) を 1 単位として扱い、検索クエリが raw `[^<id>]` 文字列にマッチする
- in-source test に追加：
  - footnote-ref を含む段落の `textSegments` が raw `[^<id>]` を返すこと
  - 脚注定義へのコメント付与が動作すること
  - 検索クエリ `[^1]` で参照位置にヒットし、定義テキストにもヒットすること

成果物：脚注 を含む markdown で §6 / §10 が壊れないこと

### Step 7: §13 Keyboard Navigation との統合

- `app/page-navigation.ts` の `FOCUSABLE_LINK_SELECTOR` に `a[data-footnote-ref]`, `a[data-footnote-backref]` を追加（あるいは別の `FOOTNOTE_LINK_SELECTOR` として独立 group に）
- 文書本文中での Tab 巡回は既存の `<a>` 標準挙動でカバーされ、Enter で `navigateToTarget` が発火する
- footnotes synthetic page が TOC に表示されるため、TOC からの遷移も既存 keyboard nav 経路でカバー

成果物：Tab / Enter で footnote ref → 定義 → backref → 元参照の往復が動くこと

### Step 8: DESIGN.md §12 §1 Theming との連動

- 脚注セクション / 参照 / backref に CSS variables を適用（marked-footnote 1.4.0 は class を使わず属性ベースで描画するため、本実装の CSS も属性セレクタで書く）：
  ```css
  #doc .footnotes,
  #doc [data-footnotes] {
    border-top: 1px solid var(--rule);
    margin-top: 2em;
    padding-top: 1em;
    color: var(--ink);
    font-size: 0.9em;
  }
  #doc [data-footnote-ref] {
    color: var(--accent);
    text-decoration: none;
  }
  #doc [data-footnote-backref] {
    color: var(--accent);
    text-decoration: none;
    margin-left: 0.3em;
  }
  /* marked-footnote が必ず挿入する sr-only な見出しを視覚的に隠す */
  #doc .footnotes .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  ```
- `--ink` / `--accent` / `--rule` の値は DESIGN.md §12 §1 Theming で light / dark に追従するため、テーマトグル時の再描画は不要
- **`.sr-only` ルールは本実装の既存 CSS には未提供** のため、本 Step で `src/styles/review.css` または `src/styles/markdown.css` に上記ルールを追加する。Tailwind の `sr-only` と同等の値で a11y 慣習に揃える

成果物：light / dark どちらのテーマでも脚注セクションが配色追従、トグルで再描画なし

### Step 9: DESIGN.md 反映と本ドキュメントの role 切替

- DESIGN.md §12 表に「Extensions / §16 Footnotes」行を追加し「準拠」に塗る（既存の §14 Math / §15 Diagram と並ぶ位置）
- DESIGN.md §6 コメントのアンカリング：footnote-ref の textSegments 経路を Math と並列に 1 段落で追記
- DESIGN.md §12 §6 Virtual Pages：round-trip 不変条件を「文書由来 page (`sourceLineStart !== -1`) のみ対象」に再定義し、synthetic page の存在を明記
- DESIGN.md §12 §7 Page Navigation：footnotes synthetic page の存在と TOC への現れ方を 1 段落で追記
- DESIGN.md §12 §13 Keyboard Navigation：footnote-ref / backref の Tab 巡回と Enter で navigate を 1 段落で追記
- DESIGN.md §13 ビルドパイプライン「ソース構成の責務境界」：`src/core/footnotes.ts` を `core/` の列挙に追加
- DESIGN.md §12「その他の拡張候補」の MDXG §16 項目を削除（実装済みになるため）
- 本ドキュメントは `docs/mdxg-footnotes.archive.md` にリネーム

成果物：DESIGN.md 更新 + 本ドキュメントの archive

## 5. 設計判断

### a. ライブラリ選定：marked-footnote（vs 自前実装 / remark-footnotes 等）

| 候補                       | 採用 | 理由                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **marked-footnote**        | ✓    | 既存の marked エコシステムにそのまま乗る（`marked.use(footnote())` の 1 行）。GFM 互換出力で、ID 衝突解消（重複定義は first wins）/ 複数参照時の ID 採番（`footnote-ref-<id>-<n>`）/ 未定義参照の plain text fallback が標準で備わる。bundle +3〜5 KB raw。ただし **未参照定義 (orphan) は完全に隠蔽される**（Step 1 PoC で確定、MDXG §16 [MUST NOT] 違反）ため、本実装は `core/footnotes.ts` の post-processing で救済する（§5.j）。代替候補と比較してもなお marked-footnote の総合コストが最も低い |
| 自前実装                   | ✗    | 文法解析を 1 から書く必要があり、GFM 仕様（ID 衝突 / ネスト / エスケープ）の細部追従コストが恒久的に発生。リファレンス実装に対する挙動差異リスクが高まる                                                                                                                                                                                                                                                                                                                                             |
| remark-footnotes（remark） | ✗    | 本実装は marked ベースのため remark 系を取り込むには parser 全体の差し替えが必要で実用的でない                                                                                                                                                                                                                                                                                                                                                                                                       |
| markdown-it-footnote       | ✗    | 同上（markdown-it 系への乗り換えコスト大）                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### b. デフォルト ON（vs Shiki と同じ `auto` / CLI opt-in）

| 候補                       | 採用 | 理由                                                                                                                                                                                     |
| -------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **常時 ON**                | ✓    | bundle サイズ増が +1〜2 KB gzipped と無視できる範囲。脚注 syntax は `[^id]` の明示的識別子で自然言語と衝突せず、誤検出リスクが無い。CLI フラグを増やさず、配布者が何も考えずに脚注が動く |
| `auto`（スキャン検出）     | ✗    | スキャンしても結果は「常時 ON」と等価（bundle 増がゼロに近いため、無条件で乗せても問題ない）。スキャンコストだけ増える                                                                   |
| CLI opt-in (`--footnotes`) | ✗    | `--mermaid` / `--math` がサイズ理由で opt-in なのと異なり、脚注はサイズ理由が成立しない。配布者の意思決定を増やす意味がない                                                              |

`--mermaid` / `--math` のフラグと対称な「opt-out フラグ (`--no-footnotes`)」も提供しない。脚注が不要な配布者は markdown に `[^id]` を書かないだけで済む（無 cost）。

### c. 脚注セクションの配置：文書末 synthetic page（vs 各 page 末 / 末尾段落）

| 候補                                      | 採用 | 理由                                                                                                                                                                                                                                                                       |
| ----------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. 文書末 synthetic page**              | ✓    | 構造的に Stacked View / TOC / §9 Sequential Navigation すべてと整合的。`Page[]` 末尾に append するだけで既存ロジック（page scroll-spy / sequential nav / keyboard nav）がそのまま動く。TOC に「Footnotes」が現れ、レビュアーが脚注一覧へ即座にジャンプできる導線も得られる |
| B. 各 virtual page 末尾に分散             | ✗    | `[^id]` が複数 page に跨って参照される場合、各 page の footnote セクションは部分集合になる。同じ定義が複数 page に重複表示される / page 跨ぎの backref が複雑化するため不採用                                                                                              |
| C. 最終 virtual page 末尾に段落として混入 | ✗    | TOC に独立項目が出ず、最終 page を開かないと脚注に到達できない。MDXG §16 [SHOULD] 「ページ末に描画」の "ページ末" を文書末と解釈する選択肢としては合理的だが、UX 上のアクセシビリティが劣る                                                                                |

A 案の追加考慮：

- synthetic page の `slug` は `'footnotes'` を予約。文書中の本物の H1 / H2 が「Footnotes」だった場合に slug 衝突する可能性があるため、`resolveUniqueSlug` 経由で `-2` suffix を付ける（§6.4 既存ロジックの再利用）
- TOC 表示では他の page と同じく `depth: 1` でインデント。Page Outline (§8) には脚注定義の H3〜H6 が無いため outline 表示はなし
- `sourceLineStart: -1` / `sourceLineEnd: -1` の sentinel で「文書由来の page ではない」ことを表現。export feedback.json で脚注定義へのコメントが `sourceLine` を持たない場合の挙動を §5.d で定義

### d. 脚注定義へのコメント export 時の `sourceLine` 解決

脚注定義は markdown 上に `[^1]: text` の形で 1 行（あるいは複数行）として存在する。Step 1 PoC で **marked-footnote 1.4.0 の `footnote` トークンには `line` / `startLine` 等の sourceLine API は存在しない**ことが確定したため、本実装は手動算出経路に統一する：

- `core/markdown.ts` の `parseAndAnnotate(markdown)` 経路で `marked.lexer(markdown)` の top-level token を走査し、`token.raw` の改行数を累積して各 token の startLine を計算（既存 `core/block-anchors.ts` と同じパターン）
- **lexer 出力先頭の `type: 'footnotes'` placeholder token (`raw: 'Footnotes'`) は cursor 加算から skip する**（Step 1 PoC `.temp/footnote-poc-extra.mjs` Case F で確認した synthetic token、文書上の行を消費しない）
- 脚注定義 (`type: 'footnote'`) も top-level token として AST 上に乗るため、同じ累積経路で `<li id="footnote-<id>">` の sourceLine を解決し `Comment.sourceLine` に渡せる
- 計算不能な例外（lexer 失敗 / 並行編集等）では `sourceLine: -1` を export し、後段 LLM 側で `quote` 文字列での grep フォールバックに委ねる

`headingPath` は脚注定義が「文書末」に集約されるため、source markdown 上の見出し階層に従う（脚注が `## Section A` 配下の段落から参照されていたとしても、定義自体は markdown のどこに書いてもよく、定義位置の見出し階層に従う）。lexer 走査で得た sourceLine を `core/block-anchors.ts` の祖先見出し解決経路に渡すだけで、既存ロジックで完結する。

### e. footnote-ref / backref の textSegments 経路：raw `[^<id>]` を返す（§14 Math と同じパターン）

footnote-ref `<sup><a data-footnote-ref id="footnote-ref-<id>" ...>1</a></sup>` の textContent は `1`、source markdown の `[^1]` は 4 文字。この長さ差が §6 アンカリングの startOffset / endOffset を狂わせるため、`<a data-footnote-ref>` を含む `<sup>` 要素を 1 セグメントとして扱い、raw `[^<id>]` を返す。

- ID 抽出：`<a data-footnote-ref>` の `id` 属性 (`footnote-ref-<id>` または複数参照時の `footnote-ref-<id>-<n>`) から `<id>` 部分を slice（`-<n>` suffix は drop）
- ラップ：`[^<id>]` を再構成して return
- §14 Math の `[data-math]` 経路と並列の判定。`selection.ts` の textSegments で同じ pattern matching helper (`getRawSegmentForElement(el)`) を共有することで、将来追加される DOM 拡張（KaTeX / Mermaid / Math / Footnote ...）への対応を 1 箇所に集約

backref `<a data-footnote-backref>` は textContent が `↩` の単一文字（複数参照時は `↩` + `<sup>N</sup>`）。これは source markdown には存在しない synthetic な UI 要素のため、textSegments で **空文字列を返す** か **walk skip する** ことで源文字列のオフセットを保つ。本実装は後者（walk skip）を採用：backref を子孫として持つ `<li id="footnote-<id>">` の textSegments 計算で `<a data-footnote-backref>` 配下を skip する。同様に `<section.footnotes>` 直下の `<h2 class="sr-only">Footnotes</h2>` も DOM 上は存在するが、a11y 用の visible-hidden な要素のため textSegments / 検索の対象から walk skip 対象として扱う（§5.j で確定）。

### f. CSS の脚注配色：DESIGN.md §12 §1 Theming トークンに完全依存

脚注は通常テキストと比べて補助的な情報のため、`color: var(--ink); font-size: 0.9em` で本文より小さく / 同色で描画する。`--accent` をリンク色として使い、`--rule` を文書末との区切り border に使う。

- KaTeX (§14) / Mermaid (§15) と異なり、脚注はホスト DOM の構造をそのまま使うため、テーマトグル時の再描画は **不要**（CSS variables 経由で自動追従）
- light モードのリンク色 (`--accent: #2cac6e`) と dark モードのリンク色（同じ `#2cac6e` でコントラスト確保）どちらも AA 達成済み（DESIGN.md §12 §1 Theming で確認済み）

### g. tooltip / ポップオーバープレビュー（§16.2 [MAY]）：未採用

MDXG §16.2 実装例の「hover でのツールチップ / ポップオーバープレビュー」は UX として有用だが、本タスクでは扱わない：

- popper.js / floating-ui 等のポジショニングライブラリ追加で +10〜30 KB raw
- 既存の `floater.ts`（選択範囲追従の「＋ Comment」フローター）と座標計算ロジックが分裂する
- 脚注はクリックで定義位置へジャンプできるため、SHOULD 要件の代替経路として十分

Phase 2 として将来追加する場合：`floater.ts`（選択範囲追従の「＋ Comment」ボタン専用）を generalize して footnote / comment 共通のフローター抽象を抜き出し、両用途で再利用する設計を採る。なお modal 系（中央表示・背景クリック / Esc で閉じる）は既に `app/dialog.ts` / `app/comment-modal.ts` / `app/mermaid-modal.ts` / `app/help-modal.ts` が共通パターンを持つため、tooltip 用の抽象とは別系統として扱う。優先度は低。

### h. 仮想ページ split との順序：split 後に footnotes append、render は全文 parse + 配賦

責務を 2 段に分ける：

1. **`core/page-split.ts` の `splitIntoPages` 後段で `appendFootnotesPage` を呼ぶ**（Page[] の構築）
2. **`doc-renderer.ts` は page 単位 parse を廃止し、全文 1 回 parse + 各 block を sourceLine から所属 page に配賦する**（DOM の構築、Step 4 詳細）

| 候補                                                | 採用 | 理由                                                                                                                                                                                                                                                                         |
| --------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. split 後 post-processing + 全文 parse + 配賦** | ✓    | `splitIntoPages` の責務は H1 / H2 境界による分割のみ。脚注 page 追加は `buildPages` builder の責務。render 側は marked-footnote の「`footnote-ref-*` / `footnote-*` 採番は単一 parse 内で一貫」制約に対応するため全文 parse + 配賦に統一（page 単位 parse 戦略は廃止、§5.i） |
| B. `splitIntoPages` 内部で append                   | ✗    | 関数の責務が 2 つになり、ATX / setext / fence 追跡ロジックと脚注検出ロジックが同じスコープに混ざる。テストマトリクスが膨らむ                                                                                                                                                 |
| C. doc-renderer で `Page[]` を動的に作る            | ✗    | `Page[]` が renderer 内部で動的に変わると、TOC / sequential nav が「文書由来 vs synthetic」を区別する責務を負う。state の一貫性が崩れるため不採用                                                                                                                            |

`buildPages(markdown)` の呼び出し経路で `splitIntoPages(markdown).then(appendFootnotesPage)` のような並びとし、`buildPages` 自体を `state.pages` の builder として位置付ける。

### i. レンダリング戦略：全文 1 回 parse + 配賦（vs page 単位 parse）

| 候補                                                          | 採用 | 理由                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. 全文 1 回 parse + sourceLine 配賦**                      | ✓    | marked-footnote の `footnote-ref-*` / `footnote-*` 採番は **単一 parse 呼び出し内でのみ一貫**。全文 1 回 parse で文書全体の id を一意に確定させてから、各 block を所属 page に配賦することで、同一 `[^id]` の複数ページ参照や ID 衝突を構造的に防ぐ。`<a id="footnote-ref-1">` の重複（HTML 仕様違反）を発生させない        |
| B. page 単位 parse + footnote section だけ全文 parse から抽出 | ✗    | mixed strategy。ページ A・B 双方が `[^1]` を参照する場合、page parse 側は両方とも `<a id="footnote-ref-1">` を生成して **id 重複** が発生する。一方 footnote section の backref は全文 parse 側で `footnote-ref-1` / `footnote-ref-1-2` と採番するため、`#footnote-ref-1-2` が DOM 上に存在せず **戻りリンク切れ** を起こす |
| C. page 単位 parse + 定義行 pre-strip + 採番後処理            | ✗    | 各 page から `[^id]:` 行を取り除いて parse し、別途 fnref ID を採番し直す経路。`>` 引用配下 / フェンスコード内の `[^id]:` 文字列の誤削除リスク、採番ロジックの再実装コストが大きく、A 案より複雑化する                                                                                                                      |

A 案の論点と mitigation：

- **sourceLine 取得経路**：marked 標準では各 token の sourceLine は安定 API ではない。`core/markdown.ts` の `parseAndAnnotate(markdown)` で marked.lexer の token と marked.parse 出力を対応付け、`data-source-line` 属性として DOM に焼き込む。既存 `core/block-anchors.ts` が同じパターンで sourceLine を解決済み（実装の先行例あり）
- **footnotes section の配賦特例**：脚注セクションは markdown 上に行を持たないため、`data-source-line` 経由の配賦ルールを適用できない。`<section class="footnotes" data-footnotes>` を末尾 page にハードコードで配置する 1 行特例を追加（Step 4.3）
- **page 単位 parse 経路の廃止**：脚注未使用文書でも全文 parse + 配賦に統一する。コードパスを 2 系統持つ保守コストを避けるためで、性能上の劣化はない（marked の全文 parse は 1〜10ms / 1 文書）
- **page 描画の中間状態**：従来 page 単位 parse は「ページ A が render 完了 → ページ B の render 開始」という段階性があったが、全文 parse + 配賦は「全 page を一度に DOM に挿入」となる。Stacked View では全 page が同時に DOM 上に並ぶため UX 上の差はない

### j. 未参照定義の post-processing 救済（vs marked-footnote 標準挙動の受け入れ / pre-processing dummy ref 注入）

Step 1 PoC で marked-footnote 1.4.0 が未参照定義 `[^orphan]: text` を完全に隠蔽することが確定した。これは MDXG §16 [MUST NOT] 「ストリップ / 隠蔽してはならない」と矛盾するため、本実装は救済経路を持つ必要がある。

| 候補                                           | 採用 | 理由                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. parse 後 post-processing で `<li>` 追加** | ✓    | `core/footnotes.ts` の `getOrphanFootnoteIds(markdown)` を `marked.lexer` の `footnote` トークンで `refs: []` のものを集める経路で実装。parse 後の `<section[data-footnotes]> > <ol>` に `<li id="footnote-<id>" data-footnote-orphan="1">` を append する `renderOrphanFootnoteItems(markdown, section)` を `doc-renderer.ts` から呼ぶ。orphan ラベルは `data-footnote-orphan="1"` で識別可能。section 自体が無いケース（orphan のみ、参照ゼロ）は synthetic に骨格を生成 |
| B. pre-processing で hidden ref を注入         | ✗    | markdown 末尾に `<span hidden>[^orphan]</span>` を注入して marked-footnote の通常経路に乗せる方法（PoC E で動作確認済み）。ただし HTML 内に hidden span が残って意味論が汚れ、選択範囲・検索のオフセット計算にも影響する。文書改変の見た目を持たせない post-processing の方が clean                                                                                                                                                                                        |
| C. 受け入れ（隠蔽容認）                        | ✗    | MDXG §16 [MUST NOT] 違反。実装簡略化と仕様準拠のトレードオフが成立せず採用不可                                                                                                                                                                                                                                                                                                                                                                                             |

A 案の追加考慮：

- **backref の到達性**：orphan には対応する `<a id="footnote-ref-<id>">` が存在しないため、`renderOrphanFootnoteItems` が出力する `<li>` 内の backref `<a href="#footnote-ref-<id>" data-footnote-backref>` をクリックしても飛び先が無い。視覚的に他定義と同形式を保つ目的で `<a>` 自体は出力するが、`href` を `#` に固定する選択肢もある。本実装は **href を残しつつ DOM 不在で no-op 化** を採用（既存の `handleFootnoteHashClick` が `document.getElementById` で null チェックする経路でカバー）
- **a11y 用 sr-only 見出しの扱い**：marked-footnote は section 冒頭に強制的に `<h2 id="footnote-label" class="sr-only">Footnotes</h2>` を挿入する。本実装はこの見出しを残しつつ、`selection.ts` の textSegments / 検索経路で **walk skip** する（visible-hidden な要素を選択 / 検索対象から除外することで UX を保つ）。CSS の `.sr-only` ルールが既存に無いため Step 8 で追加
- **`data-footnote-orphan` 属性の用途**：未参照定義であることを CSS / a11y / debug 経路で識別できるよう DOM に焼き込む。CSS 側で `[data-footnote-orphan]` に `opacity: 0.85` などのヒント表示を入れる選択肢もあるが、本実装は装飾を入れず ID prefix と同様の機械可読 hint に留める

## 6. テスト方針

### in-source test（新規）

- `core/footnotes.ts`：
  - 脚注定義なし → `countFootnoteDefinitions = 0` / `extractFootnoteIds = []` / `getOrphanFootnoteIds = []`
  - 単一定義 `[^1]: text`（参照付き）→ `countFootnoteDefinitions = 1` / `extractFootnoteIds = ['1']` / `getOrphanFootnoteIds = []`
  - 複数定義 `[^a]: ...` / `[^b]: ...` → `countFootnoteDefinitions = 2` / `extractFootnoteIds = ['a', 'b']`
  - 名前付き ID `[^note]: ...` → `extractFootnoteIds = ['note']`
  - 未参照定義（本文で `[^x]` が使われていないが `[^x]: ...` がある）→ `getOrphanFootnoteIds = ['x']` を返す。marked-footnote 1.4.0 標準では出力 HTML に含まれない（Step 1 PoC で確定、`.temp/footnote-poc-extra.mjs` Case D）ため、`renderOrphanFootnoteItems` で復活描画する経路がカバー
  - 重複定義の最初採用挙動（`[^1]: a` `[^1]: b` で `[^1]` の中身は `a`）
  - 未定義参照（本文で `[^x]` を使うが定義が無い）→ marked-footnote の plain text fallback 挙動（`[^x]` が描画後の DOM 上に literal 文字列として残る）
  - `extractFootnoteSection(fragment)` が marked.parse 出力末尾の `<section[data-footnotes]>` を正しく切り出す（属性ベース判定）
  - `renderOrphanFootnoteItems(markdown, section)` が orphan ラベルを `<li id="footnote-<id>" data-footnote-orphan="1">` として既存 section の `<ol>` に append すること、orphan のみ（参照ゼロ）のケースでは synthetic section 骨格を新規生成して返すこと

- `core/page-split.ts`（既存テストに追加）：
  - 脚注定義を含む markdown が footnotes synthetic page 追加付きで `Page[]` を返す
  - 脚注定義なし markdown では synthetic page が追加されない
  - 本物の H1「Footnotes」と synthetic slug の衝突解消（synthetic 側に `-2` が付く）

- `app/review.ts`（新規テスト）：
  - `handleFootnoteHashClick('#footnote-1')` が対象 `<li id="footnote-1">` を含む footnotes page へ `navigateToTarget` を呼び、`true` を返す
  - `handleFootnoteHashClick('#footnote-ref-1')` および `'#footnote-ref-1-2'`（複数参照時の suffix 付き）が参照を含む元 page へ navigate し、`true` を返す
  - 該当 ID が存在しない `#footnote-unknown` / page slug 形式 `#p:overview` では `false` を返し、`navigateToTarget` を呼ばない（page slug 経路と構造的に分離されていることの確認）
- `app/pages.ts`：既存の `resolveTargetFromHash` は戻り型 `NavigateTarget` のまま不変（footnote 経路の追加で本体には触れない）

- `app/selection.ts`（既存テストに追加）：
  - `<sup>` 配下に `[data-footnote-ref]` を持つ `<a>` を含む要素の textSegments が raw `[^<id>]` を返す
  - `<a data-footnote-backref>` 配下の textSegments が walk skip される（空セグメント）
  - `<section.footnotes>` 直下の `<h2 class="sr-only">` も walk skip される（a11y 用 sr-only 見出し）

- `core/markdown.ts`（既存テストに追加）：
  - `[^1]` が `<sup><a id="footnote-ref-1" href="#footnote-1" data-footnote-ref aria-describedby="footnote-label">1</a></sup>` として出力される（marked-footnote 1.4.0 の実出力に合わせる）
  - `[^1]: text` が文書末の `<section class="footnotes" data-footnotes>` に集約され、`<h2 id="footnote-label" class="sr-only">Footnotes</h2>` が含まれる
  - 同じ `[^1]` の複数参照で `id="footnote-ref-1"` と `id="footnote-ref-1-2"` の連番 ID が付く（marked-footnote の標準挙動を確認）
  - `parseAndAnnotate(markdown)` が各 top-level block に `data-source-line="<n>"` 属性を注入する。lexer 先頭の `type: 'footnotes'` placeholder token は cursor 加算から skip されていること
  - footnote section の `<section[data-footnotes]>` には `data-source-line` が付かない（配賦特例の対象、Step 4.3）

- **採番一貫性 / id 重複防止のクロスページテスト**（doc-renderer / page-split を跨ぐ統合ケース）：
  - ページ A・B 双方で `[^1]` を参照する markdown を全文 parse + 配賦すると、文書内に `id="footnote-ref-1"` が 1 個、`id="footnote-ref-1-2"` が 1 個だけ存在する（id 重複ゼロ）
  - 上記ケースで footnote section の backref が `#footnote-ref-1` と `#footnote-ref-1-2` の両方を指し、それぞれ対応する DOM 要素が存在する（戻りリンク切れゼロ）
  - 通常 page の `<section class="virtual-page">` に `<section[data-footnotes]>` が **含まれない**（重複描画ゼロ）
  - footnotes synthetic page の `<section class="virtual-page">` に `<section[data-footnotes]>` が 1 個だけ含まれる

- `app/doc-renderer.ts`（既存テストに追加）：
  - footnotes synthetic page が `<section class="virtual-page" data-page-slug="<resolved-slug>">` として描画される（`resolved-slug` は通常 `'footnotes'`、本物の H1「Footnotes」と衝突する文書では `resolveUniqueSlug` 経由で `'footnotes-2'` 等。テストは `state.pages[pages.length - 1].slug` を読んで期待値を組み立て、固定文字列 `"footnotes"` は assert しない）
  - 各定義 `<li id="footnote-<id>">` に `data-block-id` が振られている
  - 未参照定義 `[^orphan]: text` が `<li id="footnote-orphan" data-footnote-orphan="1">` として描画されること（`renderOrphanFootnoteItems` 経由、Step 2 / §3.1）

### 手動視覚チェックリスト

`npm run build` 後、脚注を含む sample markdown で生成した HTML を Chromium で開いて以下を確認：

- [ ] インライン `[^1]` が上付き数字としてリンク表示される
- [ ] 文書末に「Footnotes」セクションが現れ、各定義が並ぶ
- [ ] 各定義に backref `↩` リンクが表示される
- [ ] 同じ `[^1]` を複数回参照すると、定義側に複数の backref が並ぶ
- [ ] 左 TOC に「Footnotes」が最終 page として表示される
- [ ] TOC から「Footnotes」をクリックすると Footnotes セクションへスクロール
- [ ] 参照 `[^1]` をクリックすると Footnotes セクションの該当定義へスクロール + focus
- [ ] backref をクリックすると元の参照位置へ戻る + focus
- [ ] Tab で参照 → 定義 → backref → 次の参照 ... と巡回できる
- [ ] Enter で synthetic click が発火し、navigate が動作する
- [ ] 未定義参照 `[^undefined]` は plain text として残る（`[^undefined]` の文字列がそのまま見える）
- [ ] 未参照定義 `[^orphan]: text` は Footnotes セクションに描画される（marked-footnote 1.4.0 単体では隠蔽されるため、`renderOrphanFootnoteItems` の post-processing が機能していることの確認。`<li>` には `data-footnote-orphan="1"` 属性が付く）
- [ ] OS dark で開いた時に脚注セクションの罫線 / リンク色が dark 配色に追従
- [ ] theme toggle で `system → light → dark` を循環すると脚注配色も追従（再描画なし）
- [ ] 脚注定義テキストを選択して `+ Comment` で コメントを追加できる
- [ ] 参照を含む段落のテキストを選択 → コメント追加 → 再描画後も `<mark class="cmt">` が同じ位置に出る
- [ ] §10 Search の検索クエリ `[^1]` で参照位置にヒットする
- [ ] §10 Search で脚注定義テキストの単語にもヒットする
- [ ] page 跨ぎでも `#footnote-<id>` deep link が動作する（URL を直接書き換えて Enter）
- [ ] `dist/embed-template.html` / `dist/standalone.html` 双方のサイズ増分が ~+5 KB raw / +2 KB gzipped 程度に収まる

## 7. 受け入れ基準

- MDXG §16 [SHOULD] 脚注参照の上付きリンク描画を満たす（§1 冒頭の対応スコープ表が ✓）
- MDXG §16 [SHOULD] 脚注定義の文書末セクション + backref 描画を満たす
- MDXG §16 [MUST] 脚注未サポート時の plain text fallback が回帰していない（未定義参照 / `marked-footnote` 未ロード時に raw `[^1]` が表示される）
- MDXG §16 [MUST NOT] ストリップ / 隠蔽が発生しない
- `dist/embed-template.html` / `dist/standalone.html` 双方のサイズ増分が **gzip +3 KB 以内**（見積もり +1〜2 KB に対し +50% の保守的上限。transitive deps / marked-footnote 内部 helper の予期せぬ膨張に備える余白）
- §6 アンカリングが壊れない（既存 in-source test 全通過 + 新規追加分も通過、footnote-ref 含み段落の textSegments が raw `[^<id>]` を返す）
- §10 Search が脚注を含む文書でも動作する（参照 / 定義の両方にヒット）
- §1 Theming の dark 連動が脚注セクションにも適用される
- §13 Keyboard Navigation で footnote-ref / backref が Tab 巡回に乗る
- 同一 ID 複数参照時に backref が正しく分岐する（marked-footnote 1.4.0 の標準フォーマット `↩` / `↩<sup>2</sup>` ...、docs 草案の `↩₁ / ↩₂` ではない）
- DESIGN.md §12 表に「§16 Footnotes」行が追加され「準拠」に塗られる
- DESIGN.md §12「その他の拡張候補」の MDXG §16 項目が削除されている

## 8. 想定リスクと回避策

| リスク                                                                                | 回避策                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| marked-footnote の出力 DOM が version up で変わる                                     | `package.json` で exact pin。version up 時は本ドキュメントの §3.1 / §5.e / 手動チェックを再評価。in-source test が DOM 構造の不変条件を検査するため CI で先に fail する                                                                                                                                                                |
| 同一 `[^id]` の複数ページ参照で `footnote-ref-*` ID が重複する / 戻りリンクが切れる   | §5.i A 案「全文 1 回 parse + sourceLine 配賦」で構造的に解決。`footnote-ref-*` / `footnote-*` の採番は単一 parse 呼び出し内で marked-footnote が一意に保証する。in-source test に「同一 `[^id]` を 2 ページ目で参照したケース」を追加し、`footnote-ref-1` / `footnote-ref-1-2` の 2 ID が文書内に 1 個ずつだけ存在することを assertion |
| 通常ページ末と synthetic page に脚注セクションが重複表示される                        | §5.i A 案「全文 1 回 parse」で構造的に解決（脚注セクションは parse 出力末尾に 1 つだけ生成される）。各 block の配賦は `data-source-line` 属性経由で行い、`<section[data-footnotes]>` は footnotes synthetic page にハードコードで配置するため重複経路が発生しない                                                                      |
| marked の token に sourceLine 情報が無く `data-source-line` 注入が不可能              | Step 1 PoC で確定済み: marked 1.x には token 単位の sourceLine 安定 API は無い。`marked.lexer` の token.raw 累積長から行番号を計算する fallback を `core/markdown.ts` の `parseAndAnnotate` で採用（既存 `core/block-anchors.ts` の手法を流用）。lexer 先頭の `type: 'footnotes'` placeholder token は cursor 加算から skip            |
| 未参照定義が marked-footnote の実装によりスキップされ MDXG §16 [MUST NOT] 違反        | Step 1 PoC で **スキップ挙動を確定**（marked-footnote 1.4.0 は orphan を完全に隠蔽する）。本実装で `core/footnotes.ts` の `getOrphanFootnoteIds` + `renderOrphanFootnoteItems` を追加し、parse 後の `<section[data-footnotes]>` に手動 append で復活描画する経路を持つ（§3.1 / Step 2）                                                |
| `<sup>` 配下 `[data-footnote-ref]` の textSegments 経路が Math と分岐し維持コスト増   | `getRawSegmentForElement(el)` のような共通 helper を `app/selection.ts` に切り出し、Math / Footnote / 将来追加される DOM 拡張で共有。判定ロジックを 1 箇所に集約                                                                                                                                                                       |
| 未参照定義の扱いがリファレンス挙動と異なる                                            | リファレンス実装 (vercel-labs/mdxg) は §16 自体を実装していないため比較対象なし。本実装は MDXG §16 [MUST NOT] 準拠を最優先し、orphan を post-processing で描画する。in-source test で `getOrphanFootnoteIds` の戻り値と DOM 上の `<li data-footnote-orphan="1">` の存在を assertion                                                    |
| footnotes synthetic page が export feedback.json の `sourceLine` に -1 として出現     | export 仕様として「`sourceLine === -1` は文書外起源」を §5.d で明文化。後段 LLM は `quote` 文字列で grep フォールバック                                                                                                                                                                                                                |
| `#footnote-<id>` deep link が page 跨ぎで動かない                                     | `resolveTargetFromHash` の element ID フォールバック経路で `closest('section.virtual-page')` から `pageIndex` を逆引きし、`navigateToTarget` 経由で page 切替 + scroll を 1 系統に統合                                                                                                                                                 |
| Stacked View 全 page が DOM 上に同居するため `footnote-<id>` ID の衝突                | marked-footnote が文書 1 回のパースで一意 ID を保証。Stacked View でも 1 度の `marked.parse(fullMarkdown)` 経路で生成されるため衝突しない                                                                                                                                                                                              |
| 脚注定義が H1 / H2 と同じ slug `footnotes` を持つ markdown                            | `core/slugify.ts` の `resolveUniqueSlug` で `-2` suffix を付与。synthetic page 側の slug 解決経路に同関数を通す                                                                                                                                                                                                                        |
| backref の textContent `↩` が search にヒットして UX を損ねる                         | textSegments で `<a data-footnote-backref>` 配下を walk skip するため、`↩` 文字は検索対象に含まれない（§5.e）                                                                                                                                                                                                                          |
| Marked instance を lexer と parse で共有すると crash する (marked-footnote 1.4.0 bug) | Step 1 PoC で確定。`core/footnotes.ts` の orphan 検出 lexer 呼び出しと `core/markdown.ts` の全文 parse 呼び出しを **別 Marked instance** で実装する。in-source test で lexer→parse の順序呼び出しが crash しないことを assertion                                                                                                       |
| 脚注テキストが極端に長く UI で読みづらい                                              | CSS の `font-size: 0.9em` で本文より小さく描画する以外の対策はしない。markdown 側で 1 定義 1 段落の慣習を維持する責任は文書作成者にある                                                                                                                                                                                                |
| サイレント回帰（footnote 追加で Math / Mermaid / Shiki が壊れる）                     | 既知ケースを in-source test + 手動チェックで網羅。CI で fail させる                                                                                                                                                                                                                                                                    |

## 9. 参考

- [MDXG §16 Footnotes（日本語訳）](./mdxg/05-extensions.md#16-footnotes脚注)
- [marked-footnote リポジトリ](https://github.com/bent10/marked-extensions/tree/main/packages/footnote) — GFM 互換の marked 拡張
- [GitHub Flavored Markdown footnote 仕様](https://github.blog/changelog/2021-09-30-footnotes-now-supported-in-markdown-fields/) — 参照と定義のフォーマット
- [DESIGN.md §12 MDXG 準拠ロードマップ・今後の拡張](./DESIGN.md#12-mdxg-準拠ロードマップ今後の拡張)
- [DESIGN.md §12 §1 Theming](./DESIGN.md#1-theming準拠)
- [DESIGN.md §6 コメントのアンカリング](./DESIGN.md#6-コメントのアンカリング)
- [DESIGN.md §12 §7 Page Navigation](./DESIGN.md#7-page-navigation準拠)
- [DESIGN.md §12 §10 Search](./DESIGN.md#10-search準拠)
- [DESIGN.md §12 §13 Keyboard Navigation](./DESIGN.md#13-keyboard-navigation準拠)
- [docs/mdxg-diagram-rendering.archive.md](./mdxg-diagram-rendering.archive.md) — Mermaid 設計プラン（synthetic page / hash navigation の先行例なし、本ドキュメントが synthetic page の最初の採用例）
- [docs/mdxg-math-rendering.archive.md](./mdxg-math-rendering.archive.md) — Math 設計プラン（`<sup>` 配下 `[data-footnote-ref]` を 1 セグメントとして扱う textSegments 経路の先行パターン参考元、`[data-math]` の取り扱いと並列）
- [.temp/footnote-poc.mjs](../.temp/footnote-poc.mjs) — Step 1 PoC 本体（marked-footnote 1.4.0 の単一参照 / 複数参照 / 未参照定義 / 未定義参照 / 重複定義 / lexer token 構造の実測スクリプト）
- [.temp/footnote-poc-extra.mjs](../.temp/footnote-poc-extra.mjs) — Step 1 PoC 追補（Marked instance 状態汚染 / orphan 救済戦略 / token.raw 累積による sourceLine 算出の実測スクリプト）
- [docs/design-example.md](./design-example.md) — 設計ドキュメントテンプレート
