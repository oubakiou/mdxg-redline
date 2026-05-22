// scripts/lib/shiki-meta.mjs の型注釈。vite.config.ts (TypeScript) からも import するため
// .d.mts として併設している。実装は .mjs 側を編集する。

import type { LanguageRegistration } from 'shiki'

export declare const SPEC_LANGS: readonly string[]

export declare const canonicalizeSpec: () => string[]

export declare const buildAliasMap: (canonicals: readonly string[]) => Record<string, string>

export interface FormatAliasesTsInput {
  aliasMap: Record<string, string>
  canonicals: readonly string[]
  shikiVersion: string
}

export declare const formatAliasesTs: (input: FormatAliasesTsInput) => string

export declare const loadGrammar: (canonical: string) => Promise<LanguageRegistration[]>
