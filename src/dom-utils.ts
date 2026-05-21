// DOM 操作と一過性 ID / hash / toast 用の小さなユーティリティ。
// review.ts 内に散在していた汎用 helper を集約し、テスト容易性と再利用性を高める。

/**
 * `document.querySelector` の薄いエイリアス。本アプリでは全箇所これ経由でアクセスする。
 * セレクタが必ず存在する前提のアプリ仕様なので、見つからなければ throw して気付かせる。
 */
export const qs = (selector: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(selector)
  if (!el) {
    throw new Error(`Element not found: ${selector}`)
  }
  return el
}

/** `qs` の input/textarea 版。`.value` `.focus()` 等を型安全に取りに行く */
export const qsInput = (selector: string): HTMLInputElement | HTMLTextAreaElement => {
  const el = qs(selector)
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
    throw new Error(`Element ${selector} is not an input or textarea`)
  }
  return el
}

/** 8 文字の base36 ランダム ID。コメント等の一過性 ID として使う（衝突確率は実用上問題にならない範囲を想定） */
export const uid = (): string => Math.random().toString(36).slice(2, 10)

/** SHA-256 の先頭 8 バイトを hex で返す。docHash として保存キー・ワークスペース差分検知に使う（短く比較しやすいことを優先） */
export const hashStr = async (str: string): Promise<string> => {
  const buf = new TextEncoder().encode(str)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(hash)]
    .slice(0, 8)
    .map((byte): string => byte.toString(16).padStart(2, '0'))
    .join('')
}

// toast の解除タイマー。関数静的プロパティを使わず、モジュールスコープで型安全に保持する。
let toastTimer: ReturnType<typeof setTimeout> | null = null

/** 1.8 秒で消える短時間トースト。連続呼び出しは前回の解除タイマーを潰して上書きする */
export const toast = (msg: string): void => {
  const toastEl = qs('#toast')
  toastEl.textContent = msg
  toastEl.classList.add('show')
  if (toastTimer !== null) {
    clearTimeout(toastTimer)
  }
  toastTimer = setTimeout((): void => toastEl.classList.remove('show'), 1800)
}
