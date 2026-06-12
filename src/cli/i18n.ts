// CLI の i18n state (Node 専用)。document / localStorage には触らない。
// bootstrap (review-request.ts main()) で setCliLang を 1 回呼んで以降は固定。
// 設計判断は i18n.md §14.2 / §14.4 を参照。

import { type Lang, type MessageDict, translate as translateCore } from '../core/i18n/i18n-core'
import { type CliMessageKey, messagesCliEn } from './i18n/messages-cli.en'
import { messagesCliJa } from './i18n/messages-cli.ja'

const CLI_DICTS: Record<Lang, MessageDict> = {
  en: messagesCliEn,
  ja: messagesCliJa,
}

let currentCliLang: Lang = 'en'

export const setCliLang = (lang: Lang): void => {
  currentCliLang = lang
}

export const getCliLang = (): Lang => currentCliLang

export const translateCli = (
  key: CliMessageKey,
  params?: Readonly<Record<string, string | number>>
): string => translateCore(CLI_DICTS[currentCliLang], key, params)

if (import.meta.vitest) {
  const { afterEach, beforeEach, describe, expect, it } = import.meta.vitest

  const resetCliState = (): void => {
    currentCliLang = 'en'
  }

  beforeEach(resetCliState)
  afterEach(resetCliState)

  describe('setCliLang / getCliLang', () => {
    it('既定は en', () => {
      expect(getCliLang()).toBe('en')
    })

    it('ja に切替可能', () => {
      setCliLang('ja')
      expect(getCliLang()).toBe('ja')
    })

    it('en に戻せる', () => {
      setCliLang('ja')
      setCliLang('en')
      expect(getCliLang()).toBe('en')
    })
  })

  describe('translateCli', () => {
    it('en で help.usage を返す', () => {
      expect(translateCli('cli.help.usage')).toContain('Usage:')
    })

    it('ja に切替後は日本語の help.usage を返す', () => {
      setCliLang('ja')
      expect(translateCli('cli.help.usage')).toContain('使い方:')
    })

    it('placeholder を展開 (cli.error.unknown_option)', () => {
      expect(translateCli('cli.error.unknown_option', { token: '--bogus' })).toBe(
        'unknown option: --bogus'
      )
    })

    it('ja の placeholder も同じ key 名で展開', () => {
      setCliLang('ja')
      expect(translateCli('cli.error.unknown_option', { token: '--bogus' })).toContain('--bogus')
    })

    it('beforeEach の resetCliState で test 間に state がリークしない', () => {
      // 直前の test で ja に切替えた状態が引きずられないことを確認
      expect(getCliLang()).toBe('en')
      expect(translateCli('cli.help.usage')).toContain('Usage:')
    })
  })
}
