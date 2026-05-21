# Markdown Experience Guidelines (MDXG)

_取得日: 2026-05-21_

**インターフェースが markdown ドキュメントをどのように提示し、操作させるべきかについての仕様。**

> このディレクトリは [vercel-labs/mdxg](https://github.com/vercel-labs/mdxg) の README.md / SPEC.md を日本語訳したものです。原文の構造を忠実に再現し、セクションごとにファイル分割しています。原文 / 正典は upstream を参照してください。

Markdown はソフトウェアにおいて最も広く対応されているドキュメント形式である。あらゆる AI モデルがそれを話し、あらゆる開発者がそれを読み、あらゆるプラットフォームがそれを描画する。しかし、markdown を _使う_ 体験は 20 年間ほとんど変わっていない。

50 行の README も 3,000 行の技術仕様も、同じ扱いを受ける —— レンダリングされたテキストの平坦なスクロール。ナビゲーションもなく、構造もなく、自分が今どこにいるのかという感覚もない。

MDXG はこれを直す。

![MDXG Preview](https://github.com/vercel-labs/mdxg/raw/main/assets/screenshot.png)

_<a href="https://github.com/vercel-labs/mdxg/tree/main/packages/vscode" target="_blank">MDXG VS Code 拡張</a> は本仕様の実装例の 1 つで、単一の markdown ファイルをナビゲート可能なマルチページ体験に変える。_

**[mdxg.org で仕様をライブで読む →](https://mdxg.org)**

## MDXG とは何か

MDXG は、インターフェースが markdown ドキュメントを **どのように提示・操作させるか** についての仕様である。文法仕様ではない。CommonMark、GFM、MDX と競合するものではない。これらの一段上に位置し、形式ではなく体験を定義する。

| レイヤー       |                   |
| -------------- | ----------------- |
| **MDXG**       | 提示 + 操作の仕様 |
| **GFM / MDX**  | 文法拡張          |
| **CommonMark** | ベース文法仕様    |

MDXG は既存の `.md` ファイルに対し、いかなる変更も加えずそのまま動作する。本仕様は提示レイヤーで動作する。ファイル自体は変わらず、レンダリング方法が変わるだけである。

markdown を表示するあらゆるインターフェース（エディタ、ドキュメンテーションプラットフォーム、ノートアプリ、AI インターフェース、CMS など）が MDXG を実装できる。

### MDXG が他と違う点

**ドキュメントサイトジェネレータ（VitePress、MkDocs、Docusaurus）との違い**: MDXG は純粋に読書体験についての仕様である。コンテンツの整理方法に関係なく、任意の `.md` ファイル上で動作する。

**markdown ビューワーツール（VS Code 拡張、デスクトップアプリ）との違い**: 多くは既に優れた機能を提供しているが、それぞれが独自の慣習を定めている。MDXG はその慣習を標準化することで、実装間でプラットフォームを跨いだ一貫性を実現する。

## 提供する機能（概要）

完全な仕様は [SPEC](./00-introduction.md) を参照のこと。以下はサマリ：

**仮想ページ。** H1 と H2 見出しが、ドキュメントをナビゲート可能なページに分割する。1 つの markdown ファイルがマルチページ体験になる。ファイル分割もなく、設定もなく、ビルドステップもない。

**ページナビゲーション。** ユーザーはすべてのページを見渡し、任意のページにジャンプし、自分がどのページにいるか知ることができる。それをどう表面化するか（サイドバー、ドロップダウン、コマンドパレット、ジェスチャー）は実装に委ねられる。

**テーマ適応。** カスタムカラーは持たない。インターフェースはホストから継承する —— ライト、ダーク、あるいはその間のいずれであっても。

**コードブロック描画。** 言語タグを持つフェンス付きコードブロックは構文ハイライトされる。すべてのコードブロックにコピーボタンが付く。

**タスクリスト。** `- [ ]` と `- [x]` がチェックボックスとして描画される。

**ページアウトライン。** 現在ページ内の H3–H6 見出しはナビゲート可能で、現在の見出しが示される。サイドバー、フローティングパネル、ドロップダウン、その他何でもよい。

**逐次ナビゲーション。** 前後のページ移動と、ページタイトルの可視化。フッターリンク、ツールバーボタン、キーボードショートカット、スワイプジェスチャーなど、何でもよい。

**検索。** 全ページ横断のテキスト検索。マッチハイライト、マッチ件数、次/前のナビゲーション。

**プレビューモードとソースモード。** その場で、レンダリング後の HTML と編集可能な構文ハイライト付き markdown を切り替える。新しいタブやウィンドウは開かない。

**ドキュメントリンク。** 他の `.md` ファイルへのリンクをクリックすると、同一の MDXG 準拠ビューワーで開かれる。

**数式、ダイアグラム、脚注。** `$...$` 数式、` ```mermaid ` ダイアグラム、`[^1]` 脚注のサポートを推奨。非対応時はグレースフルにフォールバックする。

## なぜ今か

Markdown は人間と AI エージェントの間の主要なインターフェースである。エージェントがドキュメントを生成したり、コードを説明したり、レポートを書いたり、提案書をドラフトしたりするとき、それは markdown で書かれる。人間がその出力を読み、レビューし、編集するとき、彼らは markdown を読んでいる。

Markdown はエージェントにとってすでに理想的である —— トークンコストは低く、生成は簡単で、パースは些細である。欠けているのは人間側の体験である。ナビゲーション、構造、洗練された読書体験がなければ、人々はより重いフォーマットに手を伸ばす。MDXG はそのギャップを埋め、markdown が両方のオーディエンスに対して 1 つのフォーマットで奉仕できるようにする。

AI 製品、開発者ツール、ドキュメンテーションプラットフォーム、ナレッジベースを作るあらゆる企業が、どこかで markdown をレンダリングしている。ほとんどはデフォルトのレンダリングを使う。MDXG は完全な markdown 体験がどのようなものかを定義することで、すべてのチームが個別に再発明しなくてよいようにする。

## リファレンス実装

| パッケージ                                                                    | 説明                                                       | ステータス       |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------- |
| [@mdxg/parser](https://github.com/vercel-labs/mdxg/tree/main/packages/parser) | 共有 markdown パーサ                                       | コアライブラリ   |
| [@mdxg/vscode](https://github.com/vercel-labs/mdxg/tree/main/packages/vscode) | VS Code 拡張                                               | リファレンス実装 |
| [@mdxg/web](https://github.com/vercel-labs/mdxg/tree/main/apps/web)           | ドキュメンテーションサイト（[mdxg.org](https://mdxg.org)） | リファレンス実装 |

## 実装者向け

MDXG は、markdown を描画するあらゆる環境で実装可能であるように設計されている。仕様は 2 段階の準拠レベルを定める：

**MDXG Viewer**: 読み取り専用。テーマ、コードブロック描画、タスクリスト、仮想ページ、ページナビゲーション、ページアウトライン、逐次ナビゲーション、検索を持つ。

**MDXG Editor**: フル実装。Viewer のすべてに加え、モード切り替え（プレビュー / ソース / 両方）とドキュメントリンクを持つ。

[仕様](./00-introduction.md) から読み始めるとよい。動作例としては [VS Code リファレンス実装](https://github.com/vercel-labs/mdxg/tree/main/packages/vscode) を参照。共有パーサ（[`@mdxg/parser`](https://github.com/vercel-labs/mdxg/tree/main/packages/parser)）がドキュメント分割、見出し抽出、スラッグ生成を担う。フレームワーク非依存で、そのまま使うことも任意のプラットフォームに合わせて適応させることもできる。

## コントリビューション

仕様へのフィードバック、バグ報告、新規実装、コード変更を歓迎する。詳細は upstream の [CONTRIBUTING.md](https://github.com/vercel-labs/mdxg/blob/main/CONTRIBUTING.md) を参照。

Issue / Discussion / Pull Request は [GitHub リポジトリ](https://github.com/vercel-labs/mdxg) を参照。

---

## このディレクトリのファイル構成

`SPEC.md` を以下のとおりセクション別に分割している。原文の章番号 / 見出し ID は保持する。

| ファイル                                               | 範囲        | 内容                                                                            |
| ------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------- |
| [00-introduction.md](./00-introduction.md)             | 序文 / 定義 | バージョン、注意書き、Motivation、Definitions                                   |
| [01-rendering.md](./01-rendering.md)                   | §1–§5       | Theming / Code Block Rendering / Task Lists / Images / Tables                   |
| [02-document-structure.md](./02-document-structure.md) | §6–§10      | Virtual Pages / Page Navigation / Page Outline / Sequential Navigation / Search |
| [03-editing.md](./03-editing.md)                       | §11–§12     | Mode Toggle / Document Links                                                    |
| [04-accessibility.md](./04-accessibility.md)           | §13         | Keyboard Navigation                                                             |
| [05-extensions.md](./05-extensions.md)                 | §14–§16     | Math Rendering / Diagram Rendering / Footnotes                                  |
| [06-conformance.md](./06-conformance.md)               | Conformance | MDXG Viewer / MDXG Editor                                                       |

> 翻訳上の注意: "MUST" / "MUST NOT" / "SHOULD" / "SHOULD NOT" / "MAY" は RFC 2119 に従う規範語であり、意味のブレを避けるため原文の英語表記をそのまま残している。本翻訳では Requirement Level を行頭に `[MUST]` / `[MUST NOT]` / `[SHOULD]` / `[SHOULD NOT]` / `[MAY]` の形式でタグ付けする（規範語を含まない導入文・補足・Implementation Examples にはタグを付けない）。原文で 1 つの文に複数の Requirement Level が含まれる場合は、文を分割してそれぞれにタグを付けている。
