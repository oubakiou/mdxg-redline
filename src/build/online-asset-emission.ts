// build pipeline (vite.config.ts) の splitOutputsPlugin から呼ばれる pure 関数群。
// dist/hosting/{fingerprinted,canonical}/ に emit した asset の path 情報を OnlineAssetManifestPayload
// 形式に組み立てる。 副作用 (filesystem) を持つ emitX 関数とは分離し、 入出力 pure な変換だけを
// 本 module に集約することで in-source test を書ける構造にしている。

import type { OnlineAssetManifestPayload } from './online-html'

export interface MermaidRuntimeEmission {
  /** "fingerprinted/mermaid.<hash>.mjs" の hosting-relative path */
  fingerprintedPath: string
}

export interface KatexAssetEmission {
  /** "fingerprinted/katex/katex.<hash>.css" */
  cssPath: string
  /** "fingerprinted/katex/katex-fonts-extra.<hash>.css" */
  fontsExtraCssPath: string
  /** "fingerprinted/katex/katex.<hash>.mjs" */
  jsPath: string
}

export interface ShikiGrammarEmission {
  manifest: Readonly<Record<string, { fingerprintedPath: string }>>
}

export interface AssetEmission {
  katex: KatexAssetEmission | null
  mermaid: MermaidRuntimeEmission | null
  shiki: ShikiGrammarEmission
}

export const resolveMermaidManifestPath = (
  mermaid: MermaidRuntimeEmission | null
): string | null => {
  if (mermaid === null) {
    return null
  }
  return mermaid.fingerprintedPath
}

export const resolveKatexManifestPaths = (
  katex: KatexAssetEmission | null
): { css: string; fontsExtraCss: string; js: string } | null => {
  if (katex === null) {
    return null
  }
  return { css: katex.cssPath, fontsExtraCss: katex.fontsExtraCssPath, js: katex.jsPath }
}

const collectShikiLangsManifest = (
  shiki: ShikiGrammarEmission
): Readonly<Record<string, string>> => {
  const shikiLangs: Record<string, string> = {}
  for (const [lang, entry] of Object.entries(shiki.manifest)) {
    shikiLangs[lang] = entry.fingerprintedPath
  }
  return shikiLangs
}

export const buildManifestPayload = (emission: AssetEmission): OnlineAssetManifestPayload => ({
  katex: resolveKatexManifestPaths(emission.katex),
  mermaid: resolveMermaidManifestPath(emission.mermaid),
  shikiLangs: collectShikiLangsManifest(emission.shiki),
})

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  const SAMPLE_MERMAID: MermaidRuntimeEmission = {
    fingerprintedPath: 'fingerprinted/mermaid.abc123.mjs',
  }
  const SAMPLE_KATEX: KatexAssetEmission = {
    cssPath: 'fingerprinted/katex/katex.aaa.css',
    fontsExtraCssPath: 'fingerprinted/katex/katex-fonts-extra.bbb.css',
    jsPath: 'fingerprinted/katex/katex.ccc.mjs',
  }
  const SAMPLE_SHIKI: ShikiGrammarEmission = {
    manifest: {
      typescript: { fingerprintedPath: 'fingerprinted/shiki-langs/typescript.deadbeef.json' },
    },
  }

  describe('resolveMermaidManifestPath', () => {
    it('null 入力で null 返却', () => {
      expect(resolveMermaidManifestPath(null)).toBeNull()
    })

    it('fingerprintedPath をそのまま返す', () => {
      expect(resolveMermaidManifestPath(SAMPLE_MERMAID)).toBe('fingerprinted/mermaid.abc123.mjs')
    })
  })

  describe('resolveKatexManifestPaths', () => {
    it('null 入力で null 返却 (dist/katex/* 不在経路)', () => {
      expect(resolveKatexManifestPaths(null)).toBeNull()
    })

    it('3 ファイルの hash 付き path を { css, fontsExtraCss, js } に組み立てる', () => {
      expect(resolveKatexManifestPaths(SAMPLE_KATEX)).toEqual({
        css: 'fingerprinted/katex/katex.aaa.css',
        fontsExtraCss: 'fingerprinted/katex/katex-fonts-extra.bbb.css',
        js: 'fingerprinted/katex/katex.ccc.mjs',
      })
    })
  })

  describe('buildManifestPayload', () => {
    it('3 経路 (Shiki / Mermaid / KaTeX) すべて非 null で完全な payload', () => {
      const payload = buildManifestPayload({
        katex: SAMPLE_KATEX,
        mermaid: SAMPLE_MERMAID,
        shiki: SAMPLE_SHIKI,
      })
      expect(payload).toEqual({
        katex: {
          css: 'fingerprinted/katex/katex.aaa.css',
          fontsExtraCss: 'fingerprinted/katex/katex-fonts-extra.bbb.css',
          js: 'fingerprinted/katex/katex.ccc.mjs',
        },
        mermaid: 'fingerprinted/mermaid.abc123.mjs',
        shikiLangs: { typescript: 'fingerprinted/shiki-langs/typescript.deadbeef.json' },
      })
    })

    it('Mermaid emit skip (dist/mermaid.mjs 不在) で mermaid フィールドが null', () => {
      const payload = buildManifestPayload({
        katex: SAMPLE_KATEX,
        mermaid: null,
        shiki: SAMPLE_SHIKI,
      })
      expect(payload.mermaid).toBeNull()
      expect(payload.katex).not.toBeNull()
    })

    it('KaTeX emit skip (dist/katex/* 不在) で katex フィールドが null', () => {
      const payload = buildManifestPayload({
        katex: null,
        mermaid: SAMPLE_MERMAID,
        shiki: SAMPLE_SHIKI,
      })
      expect(payload.katex).toBeNull()
      expect(payload.mermaid).not.toBeNull()
    })

    it('Shiki manifest 空でも shikiLangs={} で構造は維持される', () => {
      const payload = buildManifestPayload({
        katex: null,
        mermaid: null,
        shiki: { manifest: {} },
      })
      expect(payload).toEqual({ katex: null, mermaid: null, shikiLangs: {} })
    })

    it('複数言語の Shiki manifest を全て shikiLangs に集約', () => {
      const payload = buildManifestPayload({
        katex: null,
        mermaid: null,
        shiki: {
          manifest: {
            javascript: { fingerprintedPath: 'fingerprinted/shiki-langs/javascript.111.json' },
            python: { fingerprintedPath: 'fingerprinted/shiki-langs/python.222.json' },
            typescript: { fingerprintedPath: 'fingerprinted/shiki-langs/typescript.333.json' },
          },
        },
      })
      expect(payload.shikiLangs).toEqual({
        javascript: 'fingerprinted/shiki-langs/javascript.111.json',
        python: 'fingerprinted/shiki-langs/python.222.json',
        typescript: 'fingerprinted/shiki-langs/typescript.333.json',
      })
    })
  })
}
