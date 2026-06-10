// textSegments が「要素ごと skip」する対象を 1 つの宣言テーブル `SKIP_RULES` に集約する。
// selection.ts (cmt mark 貼付経路) と search.ts (検索一致経路) の共通 invariant をここに寄せ、
// walk ベース判定 (`shouldSkipForTextSegments`) と CSS セレクタ (`SKIP_TEXT_SEGMENT_SELECTOR`)
// の両出力を単一定義から導出することで、追加時に片方だけ漏れる回帰を構造的に防ぐ。

import { MERMAID_ATTR, MERMAID_ATTR_VALUE } from '../../core/mermaid-attrs'

interface SkipRule {
  /** CSS セレクタ。`Element.matches()` と `querySelectorAll` の両方で使う。単純な class / 属性 selector に限定する。 */
  selector: string
  /** rule 追加の理由。失効しないよう WHY ベースで記述する。 */
  reason: string
}

export const SKIP_RULES: readonly SkipRule[] = [
  {
    reason:
      '描画時の動的注入で markdown 由来でなく、再描画前後 / ネストブロック vs トップレベルで textContent が変動するため除外',
    selector: '.code-copy-btn',
  },
  {
    reason:
      '描画時の動的注入で markdown 由来でなく、再描画前後 / ネストブロック vs トップレベルで textContent が変動するため除外',
    selector: '.code-lang-label',
  },
  {
    reason:
      'toolbar の lang toggle button。textContent (EN / JA) が言語切替で動的更新されるため、万が一 #doc 配下に紛れ込んだ場合のアンカリング不変条件保護として skip 対象に含める',
    selector: '.lang-toggle',
  },
  {
    reason:
      'marked-footnote 1.4.0 が <section.footnotes> 冒頭に強制挿入する a11y 用 visible-hidden <h2> を除外する footnote 専用クラス',
    selector: '.sr-only',
  },
  {
    reason:
      'KaTeX upgrade 前後で textContent が大きく変わる ($x$ ↔ MathML+HTML span) ため要素ごと skip し、textSegments 出力を upgrade 前後で一致させる',
    selector: '[data-math]',
  },
  {
    reason:
      'marked-footnote 1.4.0 が <sup><a>N</a></sup> に付与。`[^id]` (4+ chars) と DOM textContent (1 char) の長さ差を吸収し合成 UI 要素を選択 / 検索 / mark の対象から外す',
    selector: '[data-footnote-ref]',
  },
  {
    reason:
      'marked-footnote 1.4.0 が backref ↩ に付与。合成 UI 要素を選択 / 検索 / mark の対象から外す',
    selector: '[data-footnote-backref]',
  },
  {
    reason:
      'upgrade 済み mermaid (<pre[data-mermaid-applied]>) を「ダイアグラム全体を検索 / コメント対象外にする」案 A (docs/archive/mdxg-diagram-rendering.archive.md §4 Step 6)',
    selector: `[${MERMAID_ATTR.applied}="${MERMAID_ATTR_VALUE}"]`,
  },
  {
    reason: '上記 mermaid 兄弟 <svg[data-mermaid-svg]> も同じく対象外',
    selector: `[${MERMAID_ATTR.svg}="${MERMAID_ATTR_VALUE}"]`,
  },
]

/** textSegments の walk で node ごとに skip するか判定する。Element 以外は false。 */
export const shouldSkipForTextSegments = (node: Node): boolean => {
  if (!(node instanceof Element)) {
    return false
  }
  return SKIP_RULES.some((rule): boolean => node.matches(rule.selector))
}

/**
 * `shouldSkipForTextSegments` と 1:1 対応する CSS セレクタ。selection.ts の querySelectorAll で
 * 一括取得するために `SKIP_RULES` の selector を `,` 連結した形で公開する。
 * 単一定義から導出することで、要素境界経路 (`range.toString().length` 補正) と walk 経路の
 * 漏れを構造的に防ぐ (review feedback Medium: footnote skip 追加時に補正側が math 専用のまま
 * `<sup>1</sup>` / `<a>↩</a>` 分の長さがズレた回帰への対応)。
 */
export const SKIP_TEXT_SEGMENT_SELECTOR = SKIP_RULES.map((rule): string => rule.selector).join(', ')

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  const hasRule = (selector: string): boolean =>
    SKIP_RULES.some((rule): boolean => rule.selector === selector)

  // DESIGN.md §6 アンカリング (upgrade される DOM 拡張の textSegments 取り扱い): [data-math] 要素は upgrade 前後で textContent が
  // 大きく変化する (raw `$x$` → KaTeX 出力の MathML+HTML)。`shouldSkipForTextSegments` が
  // `[data-math]` ルールを含むことで textSegments の出力が upgrade 前後で完全に一致し、
  // §6 アンカリングの cmt mark 貼付経路が壊れない。DOM ベースの統合テストは現在のテスト環境
  // (node、DOM 未提供) では書けないため (DESIGN.md §12「DOM 依存ロジックのテスト環境追加」が
  // 将来拡張として残る論点)、ここでは skip 経路の存在自体を SKIP_RULES の selector identity で
  // 担保する (production の attribute 名が `data-math` から逸脱したら本テストが落ちる)。
  describe('SKIP_RULES (data-math 連動契約)', () => {
    it("'[data-math]' を skip 対象として含む", () => {
      expect(hasRule('[data-math]')).toBe(true)
    })
  })

  // docs/mdxg-footnotes.md §3.1 / §5.e / §6 / Step 6: marked-footnote 1.4.0 が出力する
  // `<a data-footnote-ref>` / `<a data-footnote-backref>` を `<sup>` 配下から skip することで、
  // source markdown (`[^<id>]` 4+ 文字) と DOM textContent (`1` 1 文字) の食い違いで offset が
  // ズレるのを防ぐ。backref の `↩` も合成 UI 要素として走査対象から外す。
  describe('SKIP_RULES (data-footnote-* 連動契約)', () => {
    it("'[data-footnote-ref]' を skip 対象として含む", () => {
      expect(hasRule('[data-footnote-ref]')).toBe(true)
    })

    it("'[data-footnote-backref]' を skip 対象として含む", () => {
      expect(hasRule('[data-footnote-backref]')).toBe(true)
    })
  })

  // marked-footnote 1.4.0 が `<section[data-footnotes]>` 冒頭に強制挿入する
  // `<h2 id="footnote-label" class="sr-only">Footnotes</h2>` を skip するための class 契約。
  describe('SKIP_RULES (sr-only 連動契約)', () => {
    it("'.sr-only' を skip 対象として含む", () => {
      expect(hasRule('.sr-only')).toBe(true)
    })
  })

  // toolbar の lang toggle button (textContent が言語切替で 'EN' / 'JA' に動的更新される)。
  // 通常は #doc 配下に出現しないが、万が一 markdown 内に同名 class が混入したケースの
  // アンカリング不変条件保護として、宣言テーブルに含まれていることを契約として固定する。
  describe('SKIP_RULES (lang-toggle 連動契約)', () => {
    it("'.lang-toggle' を skip 対象として含む", () => {
      expect(hasRule('.lang-toggle')).toBe(true)
    })
  })
}
