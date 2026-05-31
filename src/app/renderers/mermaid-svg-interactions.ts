// Mermaid SVG 由来の interaction (クリック / キーボードで modal 拡大) と、SVG 文字列の
// `<template>.innerHTML` 経由でのパース。Mermaid runtime には依存せず、SVGSVGElement と
// modal を結ぶ pure な helper のみで構成する。

import { MERMAID_ATTR, MERMAID_ATTR_VALUE } from '../../core/mermaid-attrs'
import { openMermaidModal } from './mermaid-modal'

export const parseSvg = (svgText: string): SVGSVGElement | null => {
  const tpl = document.createElement('template')
  tpl.innerHTML = svgText
  const first = tpl.content.firstElementChild
  if (first instanceof SVGSVGElement) {
    return first
  }
  return null
}

const SVG_CLICK_TARGET_TAGS = new Set(['A', 'a'])

// SVG クリックでモーダル拡大を開く (docs/mdxg-diagram-rendering.md §5.j)。
// - 選択中 (テキスト選択操作中の誤発火) はスキップ
// - SVG 内 `<a>` (Mermaid `click` directive) クリックは <a> の既定挙動を優先し open しない
const handleMermaidSvgClick = (event: Event, svg: SVGSVGElement): void => {
  const sel = document.getSelection()
  if (sel !== null && sel.toString().length > 0) {
    return
  }
  const { target } = event
  if (target instanceof Element && target.closest('a') !== null) {
    return
  }
  if (target instanceof Element && SVG_CLICK_TARGET_TAGS.has(target.tagName)) {
    return
  }
  openMermaidModal(svg)
}

export const wireMermaidSvgExpand = (svg: SVGSVGElement): void => {
  svg.setAttribute('role', 'button')
  svg.setAttribute('tabindex', '0')
  svg.setAttribute('aria-label', 'Expand diagram')
  svg.setAttribute(MERMAID_ATTR.expandable, MERMAID_ATTR_VALUE)
  svg.style.cursor = 'zoom-in'
  svg.addEventListener('click', (event): void => handleMermaidSvgClick(event, svg))
  svg.addEventListener('keydown', (event): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openMermaidModal(svg)
    }
  })
}
