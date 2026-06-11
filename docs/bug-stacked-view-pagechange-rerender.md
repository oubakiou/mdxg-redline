# [BUG] TOC からの別ページ遷移で文書全体が再描画され、大きな文書 / モバイルで操作が重い

[![MKDN](https://img.shields.io/badge/MKDN-review-red?style=for-the-badge)](https://mkdn.review/?url=https%3A%2F%2Fraw.githubusercontent.com%2Foubakiou%2Fmdxg-redline%2Frefs%2Fheads%2Fmain%2Fdocs%2Fbug-stacked-view-pagechange-rerender.md#p:bug-1)

> **状態**: **修正済み** — `navigateToTarget` のページ切替経路を `renderAll()`（全再 mount）から軽量 `refreshActivePageView()`（`renderPageNavigation` のみ）へ変更。`renderDoc` による再 mount + 全 Shiki/Mermaid/KaTeX 再 upgrade を回避。in-source test（sentinel 生存 / cmt mark・search-hl 残存 / TOC 追従 / 同一ページ no-op）を追加。`§4 修正方針` の「採用案」を実装し、`§4 要検証の不変条件`（drift / mark 維持 / scroll-spy 維持 / comments active 同期）はサブエージェントによるソースレベル検証で確認済み。CPU 体感の実機 / DevTools 確認は別途推奨。

Stacked View は全ページを常時 DOM に保持する設計だが、TOC / Sequential / hashchange による**別ページ（大セクション）遷移**では `navigateToTarget` が `renderAll()` → `renderDoc()` → `mountRenderedDoc()` を呼び、`#doc` の `innerHTML` を全消去して全ページ section を再構築し、さらに全 `<pre>` / mermaid / math に対して Shiki / Mermaid / KaTeX upgrade を再 schedule する。全ページがすでに DOM 上にある Stacked View ではこの再 mount は本来不要で、ページ切替に必要なのは active 状態の更新とスクロールのみ。結果として、code block を多く含む長文や低速 CPU（スマートフォン）では別ページ遷移が体感で重くなる。同一ページ内の小セクション（heading outline）遷移は `pageChanged === false` で `renderAll` を完全にスキップするため軽快で、この非対称が問題を顕在化させる。

## 1. 問題の構造

Stacked View（MDXG §6–§9 Virtual Pages）は markdown 読み込み時に全 page を `<section class="virtual-page">` として 1 度に描画し、以降はマウスホイール / スクロールで全文を読み進める設計（DESIGN.md §12「§7 Page Navigation（準拠）」実装詳細、`docs/archive/mdxg-virtual-pages.archive.md`）。つまり**ページ切替で DOM 構造は変化しない**（全ページが常駐）。にもかかわらず、`navigateToTarget` は `pageChanged` が真のとき無条件に `renderAll()` を呼び、その中の `renderDoc()` が `mountRenderedDoc()` で `#doc` 全体を再構築する。これは「全ページ常駐」という Stacked View の不変条件と、「ページ切替で全再 mount」という実装の食い違いである。

| 場所                                                                                        | 状態                                                                                                                          |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Stacked View の設計（DESIGN.md §12「§7 Page Navigation」/ `mdxg-virtual-pages.archive.md`） | 全ページを 1 度に描画し常駐させる。ページ切替は active 状態 + スクロール位置の更新で足り、DOM 再構築は不要                    |
| `src/app/navigation/navigation-orchestrator.ts:138-141`（`navigateToTarget`）               | `setActivePageIndex` が `pageChanged` を返すと `renderAll()` を無条件に呼ぶ                                                   |
| `src/app/navigation/navigation-orchestrator.ts:29-35`（`renderAll`）                        | `renderDoc` + `renderPageNavigation` + `renderComments` + `setupScrollSpy` + `setupPageScrollSpy` をまとめて実行              |
| `src/app/document/doc-renderer.ts:27-39`（`renderDoc`）                                     | `mountRenderedDoc` + `reapplyAllMarks` + `schedulePostPaintUpgrades`（Shiki / Mermaid / KaTeX を全 `#doc` に再 schedule）     |
| `src/app/document/doc-mount.ts:184-194`（`mountRenderedDoc`）                               | `doc.innerHTML = ''` → 全 page section を `state.markdown` から再 render → `cacheBlocksAndBuildAnchors` → `injectCopyButtons` |
| runtime 観測（別ページ TOC 遷移）                                                           | `#doc` 全体が再 parse / 再 mount され、全 code block が再ハイライトされる。低速 CPU + 長文で体感ラグが発生                    |

`navigateToTarget` には次の設計コメントがあり、再 mount は「drift（view 追加時のズレ）を防ぐ単一の真の源」として意図的に renderAll 経由に集約されている（`navigation-orchestrator.ts:132`）：

> 再描画は必ず `renderAll()` 経由にする。view 追加時の drift を構造的に防ぐ単一の真の源。

このコメントが示す通り、修正は「ページ切替経路だけ renderDoc をスキップしても drift / mark / scroll-spy の不変条件が壊れないこと」を検証した上で行う必要がある。単純な 1 行削除ではなく、`renderAll` を「文書 mount を伴う経路（初期ロード / markdown 差し替え）」と「ページ切替経路（DOM 不変）」に分離する設計判断を要する。

## 2. 推定される影響

- **別ページ（大セクション H1 / H2）遷移が重い**: TOC link / Sequential Prev・Next / 別ページの hash 遷移で `pageChanged === true` となり、`#doc` 全体の再 parse + 全 Shiki / Mermaid / KaTeX 再 upgrade が走る。code block / 数式 / 図が多い長文ほど線形に重くなる（観測可能：操作から描画確定までの体感ラグ、Performance タブの long task）。
- **同一ページ内の小セクション（heading outline）遷移は軽快**: `setActivePageIndex` が同一 index で `false` を返し（`pages.ts:203-205`）、`renderAll` を完全スキップして `scrollToHeading` のみ実行する。この非対称（大セクション=重い / 小セクション=軽い）がユーザーから見た症状の中心。
- **環境依存で顕在化**: desktop の高速 CPU では再 mount コストが体感に埋もれて目立たない。スマートフォン（iOS Safari / Android Chrome）の低速 CPU で初めて顕在化する。モバイルレイアウト（`docs/feature-mobile-layout.md`）の導入で TOC drawer からの別ページ遷移が日常操作になり、症状が報告された。
- **本 bug は既存アーキテクチャ起因（regression ではない）**: モバイルレイアウト実装が新たに導入したコストではなく、Stacked View の `renderAll` 設計に内在する既存コスト。モバイル経路（`onCompositeSlugClick` の mobile 分岐 = `closeMobilePageNav` + `.doc-pane.focus()`）は軽量で重さに寄与していない。

CPU 速度依存のため、再現には DevTools の CPU throttling（後述）か実機が必要。

## 3. 再現確認手順

1. **ビルド / 準備**: `npm run build` 後、`dist/standalone.html` を Chromium 系ブラウザで開く。code block / 数式 / mermaid を多数含み、H1 / H2 で複数ページに分割される長文 markdown を用意して読み込む（検証用 fixture は §3 末尾、または本リポジトリの `docs/feature-mobile-layout.md` 自体が長文 + 多数 code block で好適）。
2. **CPU throttling を有効化**: DevTools → Performance パネル → 歯車 → CPU を `4x slowdown` 以上に設定（モバイル CPU を近似）。または実機スマートフォンで `dist/standalone.html` 相当を開く。
3. **主確認（Performance パネル）**: Record 開始 → TOC（モバイルでは footer の `TOC` ボタン → drawer）から**別ページ（大セクション）**の link をタップ → Record 停止。`renderDoc` → `mountRenderedDoc` → `renderMarkdown` と Shiki / Mermaid / KaTeX upgrade に由来する long task（数百 ms オーダー）が観測される。続いて**同一ページ内の小セクション**（heading outline link）へ遷移して再録画すると、`mountRenderedDoc` 系のフレームが**現れない**（`scrollToHeading` のみ）。この非対称が本 bug の指紋。
4. **副確認（Sources / breakpoint）**: `src/app/document/doc-mount.ts:186`（`doc.innerHTML = ''`）に breakpoint を置く。別ページ TOC 遷移で**ヒットする**、同一ページ小セクション遷移では**ヒットしない**ことを確認。
5. **能動確認（Console から実行）**: 別ページ遷移の前後で `#doc` の DOM ノードが作り直されていることを、要素 identity の入れ替わりで確認する：

   ```js
   // 別ページ遷移の「前」に現在ページ先頭 section を掴む
   const before = document.querySelector('#doc > section.virtual-page')
   // → TOC から別ページへ遷移する操作を行う
   // 遷移「後」に同じ位置の section を取り直す
   const after = document.querySelector('#doc > section.virtual-page')
   console.log('section re-mounted:', before !== after) // true なら全再 mount が起きている
   ```

6. **目視確認**: 別ページ遷移直後、code block が一瞬 plain text（Shiki upgrade 前のフォールバック）になってから再ハイライトされる「ちらつき」が、長文 + 低速 CPU で観測できる場合がある。同一ページ小セクション遷移ではちらつかない。

注: Network パネルは inline 化済みの runtime / 全 asset を追跡しないため、本 bug の観測には使えない。Performance パネルの long task と Sources の breakpoint が確実な経路。

### 検証用 fixture（必要なら）

複数ページ + 多数 code block を持つ最小 markdown（H1 ごとにページ分割される）：

```markdown
# Page 1

\`\`\`ts
const a = 1
\`\`\`

# Page 2

\`\`\`ts
const b = 2
\`\`\`

# Page 3

\`\`\`ts
const c = 3
\`\`\`
```

（実運用では code block を各ページ数十個に増やすと long task が顕著になる。）

### 自動化（vitest 等、必要なら）

ヘッドレスでは CPU 体感は測れないが、「別ページ遷移で再 mount を行わない」invariant は spy で検出できる（§6 参照）。`doc-mount.ts` の `mountRenderedDoc` ないし `doc-renderer.ts` の `renderDoc` を spy し、ページ切替経路で**呼ばれない**ことを assert する形で regression を防げる。

## 4. 修正方針

`navigateToTarget` の「ページ切替経路」で `renderDoc`（= `mountRenderedDoc` による全再 mount + 全 upgrade 再 schedule）を回避し、Stacked View で実際に必要な更新（active page の TOC highlight + スクロール）だけを行うように `renderAll` を分解する。文書 mount を伴う経路（初期ロード / markdown 差し替え）は従来どおり `renderDoc` を通す。

修正前（現状、ページ切替でも全再 mount）：

```ts
export const navigateToTarget = (
  target: NavigateTarget,
  pushHash: boolean,
  focusTOC = false
): void => {
  const pageChanged = setActivePageIndex(target.pageIndex)
  if (pageChanged) {
    renderAll() // ← renderDoc 経由で #doc 全体を再 mount + 全 Shiki/Mermaid/KaTeX 再 upgrade
  }
  // ...
}
```

修正後（方針案、ページ切替は DOM 不変として軽量パスに分岐）：

```ts
// renderAll を「文書 mount を伴う full render」と「ページ切替時の軽量 refresh」に分離する。
// Stacked View では全ページが常駐するため、ページ切替で必要なのは active 状態 (TOC highlight) の
// 更新とスクロールのみ。doc の再 mount / 全 upgrade 再 schedule は不要。
const refreshActivePageView = (): void => {
  renderPageNavigation() // active page の TOC highlight 更新（軽量）
  // 既存 mark / scroll-spy observer は DOM が不変なので維持される（再 setup 不要）
}

export const navigateToTarget = (
  target: NavigateTarget,
  pushHash: boolean,
  focusTOC = false
): void => {
  const pageChanged = setActivePageIndex(target.pageIndex)
  if (pageChanged) {
    refreshActivePageView() // ← 全再 mount を回避
  }
  // ...
}
```

**要検証の不変条件（この修正の核心）**:

- **drift 防止**: `navigateToTarget` 直前の設計コメント（`navigation-orchestrator.ts:132`）が警告する「view 追加時の drift」が、再 mount を省いても発生しないこと。全ページ常駐前提（loadFromMarkdown 後に view が動的追加されない）が成立しているかを確認する。
- **mark の維持**: ページ切替で `reapplyAllMarks` を省いても、別ページの cmt mark / search-hl が正しい状態を保つこと（mark は #doc 配下にあり再 mount しなければ破壊されないはず）。
- **scroll-spy の維持**: `setupScrollSpy` / `setupPageScrollSpy` の再 setup を省いても、既存の IntersectionObserver が有効なままページ追従すること。
- **comments の active 同期**: `renderComments` を省くか軽量化しても、別ページの comment カード active 表示が追従すること。

これらが満たせない場合は、`renderAll` を完全に置き換えるのではなく、`renderDoc`（再 mount + 全 upgrade）だけをページ切替経路から外し、必要な軽量再描画（`renderPageNavigation` 等）は残す中間案を採る。波及範囲は `navigation-orchestrator.ts` に閉じる見込みだが、mark / scroll-spy / comments の各 invariant 検証のため `comments.ts` / `scroll-spy.ts` / `page-scroll-spy.ts` の挙動確認が必要。

## 5. 受け入れ基準

- `src/app/navigation/navigation-orchestrator.ts` のページ切替経路で `renderDoc`（`mountRenderedDoc` / `schedulePostPaintUpgrades`）が**呼ばれない**こと（§6 の spy test で `mountRenderedDoc` 呼び出し回数が 0）
- §3 主確認（Performance）で、別ページ遷移の long task が同一ページ小セクション遷移と同等まで縮む（`mountRenderedDoc` 系フレームが消える）
- §3 副確認（`doc-mount.ts:186` breakpoint）が別ページ遷移で**ヒットしない**
- §3 能動確認のスニペットで `before !== after` が `false`（section が再 mount されない）になる
- 別ページ遷移後も：別ページの cmt mark / search-hl が正しく表示される / TOC の active highlight がページに追従する / scroll-spy がページ位置を追従する / comment カードの active 同期が機能する（既存挙動の維持）
- 既存 `vp test` / `vp check` がすべて通過する（mark / navigation / scroll-spy / comments の既存 in-source test に回帰がない）

本 bug は CPU 速度依存で、絶対的な ms 値は環境依存のため受け入れ基準には含めない。「別ページ遷移で全再 mount が起きない」という構造的観測（spy / breakpoint / DOM identity）を反転条件とする。

## 6. テスト追加方針

ページ切替経路で再 mount が起きない invariant を in-source test で構造的に固定する（CPU 体感はヘッドレスで測れないため、呼び出し有無で代替する）：

- `src/app/navigation/navigation-orchestrator.ts`: `navigateToTarget` を別ページ index で呼ぶと、ページ切替の軽量 refresh のみ走り `renderDoc` / `mountRenderedDoc` 相当が呼ばれないことを spy で assert。逆に、文書 mount を伴う経路（初期ロード / markdown 差し替え）では従来どおり `renderDoc` が走る regression test を並置する。
- `src/app/comments/comments.ts` / scroll-spy 系: ページ切替で再 mount を省いても、別ページ comment の active 同期 / scroll-spy 追従が壊れないことを確認する既存テストの拡張（DOM 不変前提での active 更新）。

`renderDoc` / `mountRenderedDoc` は同一モジュール内 / 別モジュールの関数のため、spy 可能な境界（import 経由）で観測する。`navigateToTarget` が同一モジュール内の `renderAll` を呼ぶ構造のため、`renderAll` を分解して `renderDoc` 呼び出しを別経路に切り出すリファクタが spy のしやすさにも資する。

## 7. 関連

- [DESIGN.md §12「§7 Page Navigation（準拠）」実装詳細](./DESIGN.md#12-mdxg-準拠ロードマップ今後の拡張) — Stacked View の「全ページ常駐 / navigate orchestrator」設計（DESIGN.md の章 §7「永続化レイヤー」ではなく、§12 内 MDXG §7 準拠サブ節）。本 bug の期待動作（ページ切替で DOM 不変）の出典
- [docs/archive/mdxg-virtual-pages.archive.md](./archive/mdxg-virtual-pages.archive.md) — Stacked View / navigate orchestrator / scroll-spy の導入経緯と drift 対策の議論
- [docs/feature-mobile-layout.md](./feature-mobile-layout.md) — 本 bug を顕在化させたモバイルレイアウト（TOC drawer からの別ページ遷移が日常操作になった）。本 bug はモバイル実装の regression ではなく既存コストである旨をここに記録
- `src/app/navigation/navigation-orchestrator.ts`（`renderAll` / `navigateToTarget` / `onCompositeSlugClick`） — 修正対象の中心
- `src/app/document/doc-renderer.ts`（`renderDoc` / `schedulePostPaintUpgrades`） / `src/app/document/doc-mount.ts`（`mountRenderedDoc`） — 再 mount コストの実体
