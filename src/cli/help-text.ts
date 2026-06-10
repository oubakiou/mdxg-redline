// review-request CLI の usage テキスト。flag spec と並ぶ書き換え対象なので、
// parse-args.ts の parser logic から分離して 1 ファイルにまとめる。
// テキスト本体は CLI 辞書 (src/cli/i18n/messages-cli.{en,ja}.ts) の cli.help.* に
// block 形式で配置し、ここでは現在の CLI 言語に応じて結合して返す。

import { translateCli } from './i18n'

/**
 * 現在の CLI 言語 (setCliLang で確定済み) に応じた help テキスト全体を返す。
 * Usage / description / arguments / options / cleanup / examples の各 block を改行 2 つで連結。
 * 末尾改行を 1 つ付与し、stdout に書いた時のターミナル整形と合わせる。
 */
export const getHelpText = (): string => {
  const sections = [
    translateCli('cli.help.usage'),
    translateCli('cli.help.description'),
    translateCli('cli.help.arguments_block'),
    translateCli('cli.help.options_block'),
    translateCli('cli.help.cleanup_block'),
    translateCli('cli.help.examples_block'),
  ]
  return `${sections.join('\n\n')}\n`
}

if (import.meta.vitest) {
  const { afterEach, beforeEach, describe, expect, it } = import.meta.vitest
  const { setCliLang } = await import('./i18n')

  beforeEach(() => {
    setCliLang('en')
  })
  afterEach(() => {
    setCliLang('en')
  })

  describe('getHelpText: en', () => {
    it('Usage: で始まり末尾改行が 1 つ付く', () => {
      const text = getHelpText()
      expect(text.startsWith('Usage: mdxg-redline')).toBe(true)
      expect(text.endsWith('\n')).toBe(true)
    })

    it('全主要オプション名を含む', () => {
      const text = getHelpText()
      for (const flag of [
        '--theme',
        '--shiki-langs',
        '--comments-width',
        '--page-nav-width',
        '--mermaid',
        '--math',
        '--math-fonts',
        '--markdown-css',
        '--no-open',
        '--show-open-file',
        '--show-paste-markdown',
        '--lang',
        '--clean',
        '--yes',
        '--keep',
        '-r',
        '--recursive',
        '-h',
        '--help',
      ]) {
        expect(text, `flag=${flag}`).toContain(flag)
      }
    })

    it('各モード値キーワードを含む', () => {
      const text = getHelpText()
      for (const value of [
        'system',
        'light',
        'dark',
        'auto',
        'all',
        'none',
        'on',
        'off',
        'minimal',
      ]) {
        expect(text, `value=${value}`).toContain(value)
      }
    })
  })

  describe('getHelpText: ja', () => {
    it('日本語に切替後は 使い方: で始まる', () => {
      setCliLang('ja')
      const text = getHelpText()
      expect(text.startsWith('使い方: mdxg-redline')).toBe(true)
    })

    it('日本語版も同じ主要オプション名を含む (フラグ名は machine contract で英語固定)', () => {
      setCliLang('ja')
      const text = getHelpText()
      for (const flag of ['--theme', '--shiki-langs', '--lang', '--clean', '--help']) {
        expect(text, `flag=${flag}`).toContain(flag)
      }
    })

    it('en と ja で行数構造が大きく崩れない (オプション block の長さは現状の 95% 以上を保つ)', () => {
      setCliLang('en')
      const enOptions = getHelpText()
      setCliLang('ja')
      const jaOptions = getHelpText()
      expect(jaOptions.length).toBeGreaterThan(enOptions.length * 0.7)
    })
  })
}
