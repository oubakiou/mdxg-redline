// §10 Search の public API barrel。実装は search-state / search-dom / search-controller に分離。
//
// 設計判断:
// - Stacked View で全 page が DOM 上に並ぶため、ハイライトは全 page の全ブロックに対して
//   `<mark class="search-hl">` を text node に挿入する一括方式 (リファレンス実装 vercel-labs/mdxg
//   の `highlightTextNodes` と相当)。current mark には `search-hl-current` クラスを追加
// - cmt mark との共存: `mark-engine.registerPostMarksReapplied` で register した callback 経由で
//   reapplyAllMarks 後に search ハイライトを再貼付する。reapply 経路 (Shiki upgrade /
//   renderAll / コメント追加 / 削除) のどれを通っても search 状態が維持される
// - DOM 操作はブロック単位で `selection.ts` の `textRangeFromOffsets` / `textSegments` を再利用。
//   `textSegments` の `.code-copy-btn` / `.code-lang-label` skip ルールが search にも適用されるため、
//   markdown 由来でない描画装飾が検索対象に混入する事故を構造的に防ぐ
// - 自動 navigate (§10 [SHOULD]): current match の page が `state.activePageIndex` と異なれば
//   `navigateToPage` (review.ts から DI) で page を切り替えてから scrollIntoView する。hash は
//   更新しない (検索中の hash 履歴汚染を避け、ブラウザ戻る/進むで「検索開始前」に一発で戻れる)
// - 検索 mark を貼った後の textContent は変わらない (cmt mark と同じ理由: mark タグは textContent
//   に現れない)。よって §6 anchoring 不変条件 (cmt の startOffset/endOffset) は破られない

export { isSearchOpen } from './search-state'
export {
  closeSearch,
  setOnSearchNavigate,
  nextMatch,
  openSearch,
  prevMatch,
  reapplySearchHighlights,
  setSearchQuery,
  toggleSearch,
  wireSearchBar,
} from './search-controller'

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest
  // barrel 経由で public API が解決できることを確認する。new flag 追加時に re-export 漏れを検知。
  const api = await import('./search')

  describe('search public API barrel', () => {
    it('全 public 名が function として export されている', () => {
      expect(typeof api.isSearchOpen).toBe('function')
      expect(typeof api.openSearch).toBe('function')
      expect(typeof api.closeSearch).toBe('function')
      expect(typeof api.toggleSearch).toBe('function')
      expect(typeof api.setSearchQuery).toBe('function')
      expect(typeof api.nextMatch).toBe('function')
      expect(typeof api.prevMatch).toBe('function')
      expect(typeof api.reapplySearchHighlights).toBe('function')
      expect(typeof api.wireSearchBar).toBe('function')
      expect(typeof api.setOnSearchNavigate).toBe('function')
    })
  })
}
