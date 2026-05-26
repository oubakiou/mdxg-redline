// Mermaid 関連の data-* 属性名を一元管理する。CLI 側 markdown 注入と browser 側 upgrade /
// selection skip / code-copy 除外が同じ属性名に依存するため、文字列リテラルを散らすと
// 片側だけ rename した際に silent な検索 / 除外漏れになる (例: data-mermaid-svg を
// data-mermaid-rendered に変えても CSS / selection 側 skip 判定が古い名前を見続ける)。
//
// `pre.dataset.<key>` 経由のアクセスは JS 側の identifier として TypeScript に守られるため
// この定数を経由しない。ここで管理するのはあくまで「属性文字列を直接書く必要がある経路」
// (setAttribute / getAttribute / querySelector / HTML 生成の正規表現置換) 用。
export const MERMAID_ATTR = {
  applied: 'data-mermaid-applied',
  code: 'data-mermaid',
  expandable: 'data-mermaid-expandable',
  failed: 'data-mermaid-failed',
  svg: 'data-mermaid-svg',
} as const

export const MERMAID_ATTR_VALUE = '1'
