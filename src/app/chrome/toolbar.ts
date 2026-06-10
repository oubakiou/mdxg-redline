import {
  type StoredTheme,
  applyAppliedTheme,
  getSystemPrefersDark,
  nextStoredTheme,
  readCliHint,
  readStoredTheme,
  resolveAppliedTheme,
  subscribeSystemTheme,
  writeStoredTheme,
} from './theme'
import { qs, qsInput, toast } from '../dom/dom-utils'
import type { DocumentLoader } from '../document/load-document'
import type { ExportPayload } from '../../core/types'
import type { Lang } from '../i18n/i18n-core'
import type { MessageKey } from '../i18n/messages.en'
import { confirmDialog } from '../dom/dialog'
import { exportBaseName } from '../../core/review-export'
import { reapplyAllMarks } from '../comments/mark-engine'
import { redrawMermaidForTheme } from '../renderers/mermaid'
import { renderComments } from '../comments/comments'
import { replaceComments, state } from '../state/app-state'
import {
  getLang,
  nextStoredLang,
  setLang,
  subscribeLangChange,
  translate,
  translatePlural,
} from '../i18n/i18n-browser'

/** documentLoader のみ循環を避けるため runtime 経由で受け取る (Open file 経路で kind='local' を流す) */
export interface ToolbarRuntime {
  buildExportPayload: () => ExportPayload
  commentCountLabel: () => string
  documentLoader: DocumentLoader
}

/** FileList は配列ではないため、テストしやすい ArrayLike 境界で先頭 File だけ取り出す */
const firstFileFromList = (files: ArrayLike<File> | null | undefined): File | null => {
  if (!files || files.length === 0) {
    return null
  }
  return files[0] || null
}

/** input[type=file] の change イベントから 1 つ目のファイルを取り出す共通処理 */
const fileFromChange = (event: Event): File | null => {
  const input = event.currentTarget
  if (!(input instanceof HTMLInputElement) || !input.files) {
    return null
  }
  return firstFileFromList(input.files)
}

/** 同じファイルを続けて選んでも change が再発火するよう、処理後に input value を空へ戻す */
const clearFileInput = (event: Event): void => {
  const input = event.currentTarget
  if (input instanceof HTMLInputElement) {
    input.value = ''
  }
}

/** Blob を一時 URL 化してアンカークリックで即ダウンロードする定石。URL は即 revoke してリークを防ぐ */
const downloadJson = (payload: ExportPayload): void => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${exportBaseName(state.docName)}.feedback.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

/** 画面外に textarea を作る。document.execCommand('copy') は選択範囲が必要だが、見せたくないため位置を画面外にする */
const createHiddenTextarea = (text: string): HTMLTextAreaElement => {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  return textarea
}

/**
 * レガシー API `execCommand('copy')` の薄いラッパー（成功/失敗を boolean に正規化）。
 * `execCommand` は標準的に非推奨だが、`navigator.clipboard` が利用不可な環境向けのフォールバックとして残す。
 */
const copySelectedText = (): boolean => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    return document.execCommand('copy')
  } catch {
    return false
  }
}

/**
 * `navigator.clipboard` が使えない／拒否された場合の代替コピー経路。
 * 一時 textarea + execCommand('copy') という古典手法を使うが、これ無しでは安全コンテキスト外ブラウザで完全に動かなくなる。
 */
const fallbackCopy = (text: string): void => {
  const textarea = createHiddenTextarea(text)
  document.body.appendChild(textarea)
  textarea.select()
  if (copySelectedText()) {
    toast(translate('toast.copied'))
  } else {
    toast(translate('toast.copy_failed'))
  }
  document.body.removeChild(textarea)
}

/** 確認後に全コメントを破棄。再描画まで一括で行うため UI の不整合は発生しない */
const clearAllComments = (): void => {
  replaceComments([])
  reapplyAllMarks()
  renderComments()
  toast(translate('toast.comments_discarded'))
}

// テキストアイコン (Unicode シンボル) を使うことで OS 絵文字差異を回避しつつ、追加リソース無しで
// 3 状態を識別可能にする。SVG inline 化は将来の見栄え調整時に検討。
const THEME_ICON: Readonly<Record<StoredTheme, string>> = {
  dark: '☾',
  light: '☀',
  system: '◐',
}

const THEME_LABEL_KEY: Readonly<Record<StoredTheme, MessageKey>> = {
  dark: 'toolbar.theme_dark_aria',
  light: 'toolbar.theme_light_aria',
  system: 'toolbar.theme_system_aria',
}

const THEME_TOOLTIP_NEXT_KEY: Readonly<Record<StoredTheme, MessageKey>> = {
  dark: 'toolbar.theme_switch_system',
  light: 'toolbar.theme_switch_dark',
  system: 'toolbar.theme_switch_light',
}

// FOUC inline script と同じ P1 (cliHint > stored > 'system') で起動時の effective StoredTheme を求める。
// localStorage 未設定時は 'system' 既定 (MDXG §1 [MUST NOT] ユーザー設定必須化禁止を満たす)。
// この値で session state を初期化することで、画面の paint・ボタン表示・OS subscribe が同じ「現在の
// テーマ循環状態」を参照できるようになる (cliHint と localStorage が不一致のとき、ボタンが
// localStorage 側を表示して初回クリックが no-op に見える事故を防ぐ)。
const initialSelection = (): StoredTheme => readCliHint() ?? readStoredTheme() ?? 'system'

/** session state 値から button の見た目とアクセシブル名 / tooltip を更新する */
const renderThemeButton = (button: HTMLElement, selection: StoredTheme): void => {
  button.textContent = THEME_ICON[selection]
  button.setAttribute('aria-label', translate(THEME_LABEL_KEY[selection]))
  button.setAttribute('data-tooltip', translate(THEME_TOOLTIP_NEXT_KEY[selection]))
}

/**
 * theme toggle ボタンの配線。inline script で既に .dark は確定しているため、
 * click ハンドラ・OS テーマ変更購読・button 表示の同期だけを担う。
 */
// theme トグル / OS テーマ変更後に Mermaid SVG を再描画する。Mermaid は CSS variables を直接
// 読まず initialize 時のテーマ色を SVG に焼き込むため、CSS だけでは追従できない
// (docs/mdxg-diagram-rendering.md §5.g)。doc 要素が無い起動初期 (Empty state) は no-op で返す。
const refreshMermaidAfterTheme = (): void => {
  const doc = document.querySelector<HTMLElement>('#doc')
  if (doc !== null) {
    redrawMermaidForTheme(doc)
  }
}

// 起動から click / OS subscribe にまたがる「現在のテーマ循環状態」。
// const + プロパティ更新で `let` 禁止と整合させる (CLAUDE.md / AGENTS.md)。
interface ThemeSessionState {
  current: StoredTheme
}

const wireThemeToggle = (): void => {
  const button = qs('#btn-theme')
  // session state は FOUC inline script と同じ effective StoredTheme で初期化する。
  // 画面の paint・ボタン表示・OS subscribe を同じ値で一貫させ、CLI hint と localStorage が
  // 不一致のときに初回クリックが no-op に見える事故 (例: stored='light', cliHint='dark') を防ぐ。
  const session: ThemeSessionState = { current: initialSelection() }
  renderThemeButton(button, session.current)
  button.addEventListener('click', (): void => {
    const next = nextStoredTheme(session.current)
    session.current = next
    writeStoredTheme(next)
    // CLI hint は「初回 paint で localStorage より優先」する起動時ヒントなので、
    // ユーザーがその後に UI でクリックした選択は CLI hint を上書きする (resolveAppliedTheme は
    // stored × OS で完結する純関数)。次回ロード時はまた CLI hint が paint を上書きする。
    applyAppliedTheme(resolveAppliedTheme(next, getSystemPrefersDark()))
    renderThemeButton(button, next)
    refreshMermaidAfterTheme()
  })
  // OS テーマ変更は session.current が 'system' のときだけ反映する。session state は
  // FOUC paint と同じ初期値 + クリックで更新されるので、cliHint と stored を再評価する必要は無く、
  // ユーザーが UI で 'system' に切り替えた直後の OS 変化も自然に反映される。
  subscribeSystemTheme((prefersDark): void => {
    if (session.current !== 'system') {
      return
    }
    applyAppliedTheme(resolveAppliedTheme('system', prefersDark))
    refreshMermaidAfterTheme()
  })
}

// CLI 経路 (review-request) が <html data-toolbar-open-file="off"> を注入した時、
// 「特定 MD のレビュー固定文脈」フットガン (DESIGN.md §3 入力 1, §5.g) を構造的に塞ぐため
// Open file ボタンと隠し file input を tab order / DOM クエリから完全に外す。
// display:none での視覚抑制は CSS 側で並行して効くが、DOM 削除も併せて行う方が
// 信頼境界として強い (--show-open-file 未指定時に keyboard 経路で偶発的に叩かれないため)。
const isOpenFileSuppressed = (): boolean =>
  document.documentElement.dataset.toolbarOpenFile === 'off'

const removeIfPresent = (selector: string): void => {
  const el = document.querySelector(selector)
  if (el !== null) {
    el.remove()
  }
}

/** Markdown 読み込みボタンと隠し file input を接続する。CLI 経路で抑止された場合は両要素を削除する */
const wireMarkdownLoad = (runtime: ToolbarRuntime): void => {
  if (isOpenFileSuppressed()) {
    removeIfPresent('#btn-load')
    removeIfPresent('#file-md')
    return
  }
  qs('#btn-load').addEventListener('click', (): void => qsInput('#file-md').click())
  qsInput('#file-md').addEventListener('change', async (event): Promise<void> => {
    const file = fileFromChange(event)
    if (!file) {
      return
    }
    const text = await file.text()
    await runtime.documentLoader.loadDocument({ body: text, docName: file.name, kind: 'local' })
    clearFileInput(event)
  })
}

/** 現在の review state を feedback.json としてダウンロードする。本文未読込時は何も出力しない */
const wireExport = (runtime: ToolbarRuntime): void => {
  qs('#btn-export').addEventListener('click', (): void => {
    if (!state.markdown) {
      toast(translate('toast.nothing_to_export'))
      return
    }
    downloadJson(runtime.buildExportPayload())
    toast(translate('toast.exported'))
  })
}

/** feedback JSON をクリップボードへコピーする。ブラウザ拒否時は fallbackCopy に任せる */
const wireCopy = (runtime: ToolbarRuntime): void => {
  qs('#btn-copy').addEventListener('click', async (): Promise<void> => {
    if (!state.markdown) {
      toast(translate('toast.nothing_to_copy'))
      return
    }
    const text = JSON.stringify(runtime.buildExportPayload(), null, 2)
    try {
      await navigator.clipboard.writeText(text)
      toast(translate('toast.copied_with_count', { count: runtime.commentCountLabel() }))
    } catch {
      fallbackCopy(text)
    }
  })
}

/** 全コメント削除の UI 配線。破壊的操作なので confirmDialog を挟んでから state を更新する */
const wireClear = (): void => {
  qs('#btn-clear').addEventListener('click', async (): Promise<void> => {
    if (!state.comments.length) {
      toast(translate('toast.no_comments_to_clear'))
      return
    }
    const confirmed = await confirmDialog(
      translatePlural({
        baseKey: 'modal.confirm_delete_comments',
        count: state.comments.length,
      }),
      translate('modal.confirm_warn')
    )
    if (!confirmed) {
      return
    }
    clearAllComments()
  })
}

// EN / JA 2 state toggle (DESIGN.md §3.5)。
// theme と違って applied state ↔ stored state の差が無く ('en' / 'ja' のみ)、循環順序も
// `nextStoredLang` の単純な 2 state 反転。textContent は lang コード ('EN' / 'JA') を
// machine contract として翻訳せずに表示し、aria-label / data-tooltip だけ翻訳に追従する。
const LANG_LABEL: Readonly<Record<Lang, string>> = {
  en: 'EN',
  ja: 'JA',
}

const renderLangButton = (button: HTMLElement, lang: Lang): void => {
  button.textContent = LANG_LABEL[lang]
}

const wireLangToggle = (): void => {
  const button = qs('#btn-lang')
  renderLangButton(button, getLang())
  // subscribeLangChange listener は本関数末尾で wireLangToggle 同期内に登録済みのため、
  // click → setLang → applyI18nDataset → 通知 → renderLangButton の経路だけで button
  // textContent / aria-label / data-tooltip がすべて更新される (data-i18n-* は applyI18nDataset、
  // textContent は subscriber 経由)。click handler 内に明示 renderLangButton を置かないのは、
  // 重複呼び出しを避けるため。
  button.addEventListener('click', (): void => {
    const next = nextStoredLang(getLang())
    setLang(next)
  })
  // 他経路 (将来の URL クエリ初期化 / プログラム的 setLang 呼び出し) で lang が変わった場合も
  // button textContent を追従させる。
  subscribeLangChange((lang): void => renderLangButton(button, lang))
}

/** toolbar 上の全ボタンを一括配線する entry point */
export const wireToolbar = (runtime: ToolbarRuntime): void => {
  wireMarkdownLoad(runtime)
  wireExport(runtime)
  wireCopy(runtime)
  wireClear()
  wireThemeToggle()
  wireLangToggle()
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('firstFileFromList', () => {
    it('先頭の File を返す', () => {
      const file = new File(['# Review'], 'review.md', { type: 'text/markdown' })
      expect(firstFileFromList([file])).toBe(file)
    })

    it('空なら null', () => {
      expect(firstFileFromList([])).toBeNull()
      expect(firstFileFromList(null)).toBeNull()
    })
  })

  describe('renderLangButton: machine contract (EN / JA)', () => {
    // 'EN' / 'JA' は lang コード (machine contract) なので翻訳しない。本 test は
    // LANG_LABEL テーブルが en / ja の両方で正しい大文字 2 文字を返す不変条件を固定する。
    // 規約が変わると (例: textContent を翻訳語に変更) この test が落ちる。
    it('lang に応じて "EN" / "JA" を textContent に設定', () => {
      const button = document.createElement('button')
      renderLangButton(button, 'en')
      expect(button.textContent).toBe('EN')
      renderLangButton(button, 'ja')
      expect(button.textContent).toBe('JA')
    })
  })
}
