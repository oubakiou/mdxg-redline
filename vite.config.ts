import {
  buildAliasMap,
  canonicalizeSpec,
  formatAliasesTs,
  loadGrammar,
} from './scripts/lib/shiki-meta.ts'
import { createHash, randomBytes } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { buildOnlineAllowlist } from './src/build/online-allowlist.ts'
import { buildOnlineHeadersFile } from './src/build/online-headers.ts'
import { type OnlineAssetManifestPayload, buildOnlineHtml } from './src/build/online-html.ts'
import { inlineMarkdownCssIntoHtml } from './src/build/inline-markdown-css.ts'
import { type Plugin, defineConfig } from 'vite-plus'
import { fileURLToPath } from 'node:url'
import { viteSingleFile } from 'vite-plugin-singlefile'

const ROOT_DIR = dirname(fileURLToPath(import.meta.url))

const readShikiVersion = async (): Promise<string> => {
  const pkgPath = resolve(ROOT_DIR, 'node_modules', 'shiki', 'package.json')
  const pkgJson = await readFile(pkgPath, 'utf8')
  const parsed: unknown = JSON.parse(pkgJson)
  if (typeof parsed !== 'object' || parsed === null || !('version' in parsed)) {
    throw new Error('shiki/package.json から version を読み取れませんでした')
  }
  const { version } = parsed
  if (typeof version !== 'string') {
    throw new Error('shiki/package.json の version が string ではありません')
  }
  return version
}

const regenerateAliasesTs = async (): Promise<void> => {
  const shikiVersion = await readShikiVersion()
  const canonicals = canonicalizeSpec()
  const aliasMap = buildAliasMap(canonicals)
  const ts = formatAliasesTs({ aliasMap, canonicals, shikiVersion })
  const outPath = resolve(ROOT_DIR, 'src', 'core', 'shiki-aliases.generated.ts')
  await writeFile(outPath, ts, 'utf8')
}

// online edition は manifest 経由で `dist/hosting/fingerprinted/shiki-langs/<lang>.<hash>.json`
// (immutable cache 対象) と `dist/hosting/canonical/shiki-langs/<lang>.json` (404 retry 先 +
// 古い HTML cache が直接 fetch する fallback) の 2 系統を必要とする。fingerprinted は content
// hash 焼き込みで `_headers` の `immutable, max-age=31536000` 配信を可能にし、canonical は
// `max-age=300` で deploy 直後の世代ずれ過渡期に新版を返す (docs/feature-online-runtime-assets.md
// §5.i)。両者は Pages の Build output directory として指定する `dist/hosting/` 配下に置く
// (Step 4 の C 設計判断、 詳細は resolveFinalGrammarDirs / resolveSplitOutputPaths のコメント)。
// 加えて CLI 経路 (`npm publish` 対象の `dist/shiki-langs/`、review-request CLI が markdown scan
// 結果に応じて inject する素材) は dist 直下の従来パスを維持する。3 セットそれぞれが独立用途で
// 衝突しない。
const FINGERPRINT_HASH_LEN = 8

const sha256Prefix = (content: string): string =>
  createHash('sha256').update(content).digest('hex').slice(0, FINGERPRINT_HASH_LEN)

interface GrammarManifestEntry {
  fingerprintedPath: string
}

interface ShikiGrammarEmission {
  manifest: Readonly<Record<string, GrammarManifestEntry>>
}

interface GrammarOutputDirs {
  canonicalDir: string
  cliDir: string
  fingerprintedDir: string
}

// 部分書き込み → atomic swap のため、 まず ROOT_DIR 配下の隔離 tmp dir に全 grammar を生成し、
// 全成功時にのみ既存 dist/{shiki-langs,canonical/shiki-langs,fingerprinted/shiki-langs} と
// rename で置換する。失敗時 (loadGrammar throw / writeFile EBUSY 等) は tmp dir を cleanup
// して旧 dist をそのまま残し、 "半完成 dist が tracked file に潜り込む" 事故を構造的に防ぐ。
//
// 同 filesystem 内の rename は atomic (POSIX rename(2) / Node fs.promises.rename)。
// tmp dir 名に randomBytes を混ぜることで、 同一 ROOT で並列 build が走った場合にも衝突しない。
const TMP_DIR_RANDOM_BYTES = 6

const makeTmpGrammarDirs = (): { dirs: GrammarOutputDirs; root: string } => {
  const suffix = randomBytes(TMP_DIR_RANDOM_BYTES).toString('hex')
  const root = resolve(ROOT_DIR, 'dist', `.tmp-shiki-${suffix}`)
  return {
    dirs: {
      canonicalDir: resolve(root, 'canonical', 'shiki-langs'),
      cliDir: resolve(root, 'shiki-langs'),
      fingerprintedDir: resolve(root, 'fingerprinted', 'shiki-langs'),
    },
    root,
  }
}

const prepareTmpDirs = async (dirs: GrammarOutputDirs): Promise<void> => {
  await Promise.all([
    mkdir(dirs.cliDir, { recursive: true }),
    mkdir(dirs.canonicalDir, { recursive: true }),
    mkdir(dirs.fingerprintedDir, { recursive: true }),
  ])
}

// online edition 用の canonical / fingerprinted は Cloudflare Pages 配信 subset として
// `dist/hosting/` 配下に直接 emit する (Pages の Build output directory を `dist/hosting`
// に指定する設計、 docs/feature-online-runtime-assets.md Step 4 ✅ 完了の C 設計判断)。
// CLI 用 `dist/shiki-langs/` は dist 直下のまま (review-request CLI が markdown scan
// 結果に応じて inject する素材)。
const resolveFinalGrammarDirs = (): GrammarOutputDirs => ({
  canonicalDir: resolve(ROOT_DIR, 'dist', 'hosting', 'canonical', 'shiki-langs'),
  cliDir: resolve(ROOT_DIR, 'dist', 'shiki-langs'),
  fingerprintedDir: resolve(ROOT_DIR, 'dist', 'hosting', 'fingerprinted', 'shiki-langs'),
})

// rename 1 件分の三角関係 (tmp → final → bak)。 sequential rename の進捗を記録するため
// 配列で持ち、 失敗時に completed の逆順を辿って tmp に戻し、 movedToBak の順で bak から
// final へ復元する。
interface SwapEntry {
  bak: string
  final: string
  tmp: string
}

const BAK_DIR_RANDOM_BYTES = 6

const makeBakDirs = (): { dirs: GrammarOutputDirs; root: string } => {
  const suffix = randomBytes(BAK_DIR_RANDOM_BYTES).toString('hex')
  const root = resolve(ROOT_DIR, 'dist', `.bak-shiki-${suffix}`)
  return {
    dirs: {
      canonicalDir: resolve(root, 'canonical', 'shiki-langs'),
      cliDir: resolve(root, 'shiki-langs'),
      fingerprintedDir: resolve(root, 'fingerprinted', 'shiki-langs'),
    },
    root,
  }
}

const buildSwapEntries = (
  tmpDirs: GrammarOutputDirs,
  finalDirs: GrammarOutputDirs,
  bakDirs: GrammarOutputDirs
): readonly SwapEntry[] => [
  { bak: bakDirs.cliDir, final: finalDirs.cliDir, tmp: tmpDirs.cliDir },
  { bak: bakDirs.canonicalDir, final: finalDirs.canonicalDir, tmp: tmpDirs.canonicalDir },
  {
    bak: bakDirs.fingerprintedDir,
    final: finalDirs.fingerprintedDir,
    tmp: tmpDirs.fingerprintedDir,
  },
]

// ENOENT (旧 dir 不在) を skip しつつ rename する。 初回 build や CLI 用 `dist/shiki-langs/` だけ
// 存在するケースなど、 退避対象の部分不在は normal シナリオ。
const renameSkipMissing = async (src: string, dst: string): Promise<boolean> => {
  try {
    await rename(src, dst)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

interface RenameAttempt {
  context: string
  dst: string
  src: string
}

const wrapAsError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error
  }
  return new Error(String(error))
}

// ロールバック中の rename は **sequential + 全件試行** が必須。 sequential は race 防止、
// 全件試行は「1 件目失敗で残りを諦めない」ため (旧成果物の復元機会を最大化する)。 個別失敗は
// 集約して呼び出し側に AggregateError で透過し、 bak を残して旧成果物の最後のコピーを保護する。
const tryRenameCollectingFailures = async (
  attempt: RenameAttempt,
  failures: Error[]
): Promise<void> => {
  try {
    await rename(attempt.src, attempt.dst)
  } catch (error) {
    const wrapped = wrapAsError(error)
    wrapped.message = `${attempt.context} (${attempt.src} → ${attempt.dst}): ${wrapped.message}`
    failures.push(wrapped)
  }
}

const throwIfFailures = (failures: readonly Error[], summary: string): void => {
  if (failures.length > 0) {
    throw new AggregateError(failures, summary)
  }
}

// 退避失敗時の bak → final 復元。 部分復元の機会を最大化するため全件試行し、 失敗を集約。
// 復元失敗が 1 件でもあれば AggregateError で throw し、 呼び出し側に bak を保全させる。
// 復元順は退避の逆順 (トランザクション巻き戻しとして自然、 movedToBak.toReversed())。
const restoreBakToFinal = async (movedToBak: readonly SwapEntry[]): Promise<void> => {
  const failures: Error[] = []
  for (const entry of [...movedToBak].toReversed()) {
    // eslint-disable-next-line no-await-in-loop
    await tryRenameCollectingFailures(
      { context: 'bak→final 復元', dst: entry.final, src: entry.bak },
      failures
    )
  }
  throwIfFailures(failures, `bak → final の復元に失敗しました (${failures.length} 件)`)
}

// promote 失敗時のロールバック。 (a) 完了済み final → tmp 取消を逆順 sequential、 (b) bak → final
// 復元を逆順 sequential で実行し、 両ステップの失敗を 1 つの AggregateError に集約。 復元失敗が
// 1 件でもあれば呼び出し側に bak 保全を求める。
const rollbackSwap = async (
  completed: readonly SwapEntry[],
  movedToBak: readonly SwapEntry[]
): Promise<void> => {
  const failures: Error[] = []
  for (const entry of [...completed].toReversed()) {
    // eslint-disable-next-line no-await-in-loop
    await tryRenameCollectingFailures(
      { context: 'tmp→final 取消', dst: entry.tmp, src: entry.final },
      failures
    )
  }
  for (const entry of [...movedToBak].toReversed()) {
    // eslint-disable-next-line no-await-in-loop
    await tryRenameCollectingFailures(
      { context: 'bak→final 復元', dst: entry.final, src: entry.bak },
      failures
    )
  }
  throwIfFailures(failures, `grammar swap のロールバックに失敗しました (${failures.length} 件)`)
}

// 旧 dir を bak に退避 (存在しないものは skip)。 **sequential** 必須: 失敗時に部分退避状態を
// 確定的に把握してロールバック対象を movedToBak で正確に列挙するため。 mutation で進捗を漏らす
// (return 経路では throw 時に値を返せないため、 mutation 経由で部分結果を呼び出し側に伝える)。
const moveOldDirsToBakTracking = async (
  entries: readonly SwapEntry[],
  movedToBak: SwapEntry[]
): Promise<void> => {
  for (const entry of entries) {
    // eslint-disable-next-line no-await-in-loop
    const moved = await renameSkipMissing(entry.final, entry.bak)
    if (moved) {
      movedToBak.push(entry)
    }
  }
}

// tmp → final の promote は **sequential** 必須。 失敗時にどこまで rename が完了したかを
// ロールバックに正確に伝えるため、 mutable な completed array に push しながら進める
// (return 経路では throw 時に値を返せないため、 mutation 経由で部分結果を漏らす)。
// 並列化すると race + 順序不確定でロールバック対象が確定できなくなる (no-await-in-loop 抑制の理由)。
const promoteTmpToFinalTracking = async (
  entries: readonly SwapEntry[],
  completed: SwapEntry[]
): Promise<void> => {
  for (const entry of entries) {
    // eslint-disable-next-line no-await-in-loop
    await rename(entry.tmp, entry.final)
    completed.push(entry)
  }
}

const prepareBakRoot = async (bakRoot: string): Promise<void> => {
  await Promise.all([
    mkdir(resolve(bakRoot, 'canonical'), { recursive: true }),
    mkdir(resolve(bakRoot, 'fingerprinted'), { recursive: true }),
  ])
}

const prepareFinalParents = async (): Promise<void> => {
  await Promise.all([
    mkdir(resolve(ROOT_DIR, 'dist', 'hosting', 'canonical'), { recursive: true }),
    mkdir(resolve(ROOT_DIR, 'dist', 'hosting', 'fingerprinted'), { recursive: true }),
  ])
}

const cleanupBakDirSilently = async (bakRoot: string): Promise<void> => {
  try {
    await rm(bakRoot, { force: true, recursive: true })
  } catch (error) {
    console.warn(`[mdxg-online] bak dir cleanup に失敗 (${bakRoot}): ${String(error)}`)
  }
}

// 退避 / promote の失敗 → ロールバック → 結果に応じた bak 処理を 1 関数に集約。
// (1) ロールバック成功: bak は不要 → 削除 (失敗は warn、 元 error を優先 throw)
// (2) ロールバック失敗: bak が旧成果物の最後のコピー → **削除しない** + AggregateError で
//     元 error + rollback error を両方伝える。 メッセージに bak.root を含めて手動回復可能に。
const handleSwapStepFailure = async (
  originalError: unknown,
  runRollback: () => Promise<void>,
  bakRoot: string
): Promise<never> => {
  try {
    await runRollback()
  } catch (rollbackError) {
    // AggregateError は `errors` 配列で originalError と rollbackError の両方を保持するため、
    // ES2022 の `cause` option は冗長 (errors[0] / errors[1] で同等以上の情報が取れる)。
    // eslint の preserve-caught-error は AggregateError の errors 経路を判別しないので、
    // ここだけ局所的に抑制する。
    // eslint-disable-next-line preserve-caught-error
    throw new AggregateError(
      [wrapAsError(originalError), wrapAsError(rollbackError)],
      `grammar swap の例外復元に失敗しました。 旧成果物の最後のコピーが bak に残っています: ${bakRoot}`
    )
  }
  await cleanupBakDirSilently(bakRoot)
  throw wrapAsError(originalError)
}

// 退避フェーズ: 失敗時に部分退避済みの bak を final に復元してから handleSwapStepFailure へ。
const moveOldDirsOrRestore = async (
  entries: readonly SwapEntry[],
  movedToBak: SwapEntry[],
  bakRoot: string
): Promise<void> => {
  try {
    await moveOldDirsToBakTracking(entries, movedToBak)
  } catch (error) {
    await handleSwapStepFailure(error, async () => restoreBakToFinal(movedToBak), bakRoot)
  }
}

// promote フェーズ: 失敗時に completed の取消 + bak からの復元を集約してロールバック。
const promoteOrRollback = async (
  entries: readonly SwapEntry[],
  movedToBak: readonly SwapEntry[],
  bakRoot: string
): Promise<void> => {
  const completed: SwapEntry[] = []
  try {
    await promoteTmpToFinalTracking(entries, completed)
  } catch (error) {
    await handleSwapStepFailure(error, async () => rollbackSwap(completed, movedToBak), bakRoot)
  }
}

const swapTmpIntoDist = async (tmpDirs: GrammarOutputDirs): Promise<void> => {
  const finalDirs = resolveFinalGrammarDirs()
  await prepareFinalParents()
  const bak = makeBakDirs()
  await prepareBakRoot(bak.root)
  const entries = buildSwapEntries(tmpDirs, finalDirs, bak.dirs)
  const movedToBak: SwapEntry[] = []
  await moveOldDirsOrRestore(entries, movedToBak, bak.root)
  await promoteOrRollback(entries, movedToBak, bak.root)
  // 全成功: bak 全体を削除 (subdirs は退避済み、 root は空ディレクトリのみ)。
  await cleanupBakDirSilently(bak.root)
}

// === grammar build 排他制御 (file lock + PID 生存判定 + token 照合) ===
// 同 ROOT で `vp build --watch` と単発 `vp build` が並列に走った場合、 swap が互いに干渉して
// 不整合を起こす。 splitOutputsPlugin.closeBundle 全体 (grammar emit + standalone/online HTML 書き出し
// + hosting config) を `dist/.shiki-build.lock` で囲い、 同時 build を fail-fast で拒否する。
//
// 設計 (Phase A.2 レビュー指摘の反映):
// - lock 範囲: closeBundle 全体。 emit だけ守ると、 emit 完了 → HTML 書き出しの窓で別 build が
//   grammar を入れ替え、 先の build の manifest が消えた fingerprinted path を埋め込む race が
//   起きる。
// - lock 自動削除なし: stale 判定で自動 `rm` すると double-stale TOCTOU で 2 process が同時に lock を
//   取得する race が起きる。 常に fail-fast し、 開発者に手動 cleanup を促す。
// - PID 生存判定: `process.kill(pid, 0)` が ESRCH なら不在、 EPERM なら **生存扱い** (権限不足でも
//   process は live)。
// - 解放時 token 照合: 取得時に書いた random token と現在の lock 内容を比較し、 一致時のみ削除。
//   通常運用での誤削除 (例: 自分の lock が他 process に手動削除されて新規に他 process が取得した
//   状態で、 自分が finally で解放) を防ぐ。 read → 比較 → rm 間の理論上の TOCTOU は残るが、
//   manual 介入が同時発生する稀ケースに限られる。
const LOCK_PATH = resolve(ROOT_DIR, 'dist', '.shiki-build.lock')
const LOCK_TOKEN_BYTES = 16

interface LockContent {
  pid: number
  token: string
}

const formatLockContent = (content: LockContent): string => `${content.pid}\n${content.token}\n`

// 厳密一致 parse: `<digits>\n<32 桁 hex>\n?` だけを受理する。
// - `Number.parseInt` は `123abc` を 123 と silent 受理するので使えない。 `^\d+$` で全体が digits か検証。
// - token は LOCK_TOKEN_BYTES (16) × 2 = 32 桁の小文字 hex に限定 (`randomBytes(16).toString('hex')` 出力形式)。
// - 余分な行や trailing garbage は reject。 他用途で書かれた file を lock と誤認するリスクを下げる。
// - 末尾改行は optional (POSIX 改行慣習との互換のため許容)。
const LOCK_CONTENT_RE = /^(\d+)\n([0-9a-f]{32})\n?$/u

const parseLockContent = (raw: string): LockContent | null => {
  const match = LOCK_CONTENT_RE.exec(raw)
  if (match === null) {
    return null
  }
  const pid = Number.parseInt(match[1], 10)
  if (!Number.isFinite(pid) || pid <= 0) {
    return null
  }
  return { pid, token: match[2] }
}

const readLockContent = async (): Promise<LockContent | null> => {
  try {
    const raw = await readFile(LOCK_PATH, 'utf8')
    return parseLockContent(raw)
  } catch {
    return null
  }
}

// EPERM は権限不足 (= 別 user 所有の process が live) を意味するので「生存」扱いに含める。
// ESRCH (no such process) のみ「不在」扱い。
const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EPERM') {
      return true
    }
    return false
  }
}

const tryCreateLock = async (content: string): Promise<boolean> => {
  try {
    await writeFile(LOCK_PATH, content, { flag: 'wx' })
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      return false
    }
    throw error
  }
}

const throwLockHeldByLiveProcess = (pid: number): never => {
  throw new Error(
    `[mdxg-online] 別 grammar build が稼働中 (PID ${pid})。 同 ROOT での並列 build は禁止です。 既存 build の完了を待ってから再実行してください: ${LOCK_PATH}`
  )
}

const throwLockNeedsManualReview = (detail: string): never => {
  throw new Error(
    `[mdxg-online] grammar build lock が残存しています (${detail})。 別 build が稼働していないことを確認し、 手動で削除してから再実行してください: rm ${LOCK_PATH}`
  )
}

// 既存 lock があれば parse 結果に基づいて 3 経路に分岐 (すべて throw、 自動削除なし):
//   (a) PID 生存 → 「完了を待つ」案内で fail-fast
//   (b) PID 不在 (parse 成功) → stale 残骸、 「確認後 rm」案内で fail-fast
//   (c) parse 失敗 (lock file が空 / 不正形式 / read 失敗) → 「確認後 rm」案内で fail-fast
const failOnExistingLock = async (): Promise<never> => {
  const existing = await readLockContent()
  if (existing === null) {
    return throwLockNeedsManualReview('lock file が空 / 不正形式 / 読み込み失敗')
  }
  if (isProcessAlive(existing.pid)) {
    return throwLockHeldByLiveProcess(existing.pid)
  }
  return throwLockNeedsManualReview(`PID ${existing.pid} は不在 (stale 残骸)`)
}

// 取得時は token を生成して `PID\nTOKEN\n` を `wx` で書き、 token を呼び出し側に返す。
// 既存 lock の処理は failOnExistingLock に委譲 (3 分岐すべて throw)。
const acquireGrammarBuildLock = async (): Promise<string> => {
  await mkdir(resolve(ROOT_DIR, 'dist'), { recursive: true })
  const token = randomBytes(LOCK_TOKEN_BYTES).toString('hex')
  const content = formatLockContent({ pid: process.pid, token })
  if (await tryCreateLock(content)) {
    return token
  }
  await failOnExistingLock()
  // 上記は必ず throw するが型推論のため明示
  throw new Error('unreachable')
}

// 解放時は取得時の token と現在の lock 内容を照合し、 一致時のみ削除する。
// 不一致 / 読み失敗 / 不正形式の場合は **削除せず warn** して握る (元の throw を上書きしない、
// かつ他 process の lock を誤削除しない)。 lock を残すデメリットより、 他 process の lock を
// 消す race を起こすリスクを優先して避ける。
const releaseGrammarBuildLock = async (ownedToken: string): Promise<void> => {
  const current = await readLockContent()
  if (current === null) {
    console.warn(
      `[mdxg-online] lock 解放: ${LOCK_PATH} を読めない / 不正形式のため削除を skip しました`
    )
    return
  }
  if (current.token !== ownedToken) {
    console.warn(
      `[mdxg-online] lock 解放: token 不一致 (自身は別 lock を解放しようとした可能性)。 削除を skip: ${LOCK_PATH}`
    )
    return
  }
  try {
    await rm(LOCK_PATH, { force: true })
  } catch (error) {
    console.warn(`[mdxg-online] lock 解放に失敗 (${LOCK_PATH}): ${String(error)}`)
  }
}

const writeGrammarToTmp = async (
  tmpDirs: GrammarOutputDirs,
  canonicals: readonly string[]
): Promise<Record<string, GrammarManifestEntry>> => {
  const entries = await Promise.all(
    canonicals.map(async (lang: string): Promise<readonly [string, GrammarManifestEntry]> => {
      const grammar = await loadGrammar(lang)
      const json = JSON.stringify(grammar)
      const hash = sha256Prefix(json)
      const fingerprintedName = `${lang}.${hash}.json`
      await Promise.all([
        writeFile(resolve(tmpDirs.cliDir, `${lang}.json`), json, 'utf8'),
        writeFile(resolve(tmpDirs.canonicalDir, `${lang}.json`), json, 'utf8'),
        writeFile(resolve(tmpDirs.fingerprintedDir, fingerprintedName), json, 'utf8'),
      ])
      return [lang, { fingerprintedPath: `fingerprinted/shiki-langs/${fingerprintedName}` }]
    })
  )
  const manifest: Record<string, GrammarManifestEntry> = {}
  for (const [lang, entry] of entries) {
    manifest[lang] = entry
  }
  return manifest
}

// cleanup 自体の失敗は元エラー (build 失敗) を上書きしないように内側で握って warn に倒す。
const cleanupTmpDirSilently = async (tmpRoot: string): Promise<void> => {
  try {
    await rm(tmpRoot, { force: true, recursive: true })
  } catch (cleanupError) {
    console.warn(`[mdxg-online] tmp dir cleanup に失敗 (${tmpRoot}): ${String(cleanupError)}`)
  }
}

const emitGrammarJsonFiles = async (): Promise<ShikiGrammarEmission> => {
  const canonicals = canonicalizeSpec()
  const tmp = makeTmpGrammarDirs()
  try {
    await prepareTmpDirs(tmp.dirs)
    const manifest = await writeGrammarToTmp(tmp.dirs, canonicals)
    await swapTmpIntoDist(tmp.dirs)
    return { manifest }
  } finally {
    // 成功時は swap 後に subdirs が rename で移動済みなので tmp.root は empty。 失敗時は
    // 未完成 subdirs を含む全 tree。 どちらも recursive で 1 度消し、 dist 配下に `.tmp-shiki-*`
    // が積もらないようにする。 cleanup 自体の失敗は元エラー (build 失敗) を上書きしないよう
    // helper 内で握って warn に倒す (catch なし finally なので元 throw は透過する)。
    await cleanupTmpDirSilently(tmp.root)
  }
}

const buildManifestPayload = (grammar: ShikiGrammarEmission): OnlineAssetManifestPayload => {
  const shikiLangs: Record<string, string> = {}
  for (const [lang, entry] of Object.entries(grammar.manifest)) {
    shikiLangs[lang] = entry.fingerprintedPath
  }
  return { katex: null, mermaid: null, shikiLangs }
}

// Shiki 同梱言語のメタを `src/core/shiki-aliases.generated.ts` に再生成する buildStart 専任 plugin。
// 生成物は CLI / browser 双方がコンパイル時に import する固定マップで、buildStart 段階で完了して
// いる必要がある (transform 時点で aliases を参照するため)。
//
// grammar JSON (`dist/shiki-langs/*` / canonical / fingerprinted) の emit は本 plugin では行わない。
// Rollup / Vite の `closeBundle` は parallel hook (型 `async, parallel`) で plugin 間の順序が保証
// されないため、grammar emit と standalone/online 派生は **同一 plugin の同一 closeBundle 内で
// 逐次 await** する必要がある (docs/mdxg-rendering-code-block.archive.md §3 / §5.j の方針は維持)。
// 実装は splitOutputsPlugin.closeBundle を参照。
const shikiAliasesPlugin = (): Plugin => ({
  apply: 'build',
  buildStart: regenerateAliasesTs,
  name: 'mdxg-shiki-aliases',
})

// embed.ts の EMBEDDED_SHIKI_LANGS_RE / rewriteEmbeddedShikiLangs と同じパターン。
// Node loader が src/core/embed.ts を直接 import できないため、build chain 専用に inline する。
// CLI と shape を揃えるため `<` の Unicode escape (`<`) も同じ書きぶりで行う。
const EMBEDDED_SHIKI_LANGS_RE_BUILD =
  /(<script\b(?=[^>]*\bid="embedded-shiki-langs")(?=[^>]*\btype="application\/json")[^>]*>)([\s\S]*?)(<\/script>)/i

// Mermaid runtime 注入用 (docs/mdxg-diagram-rendering.md §5.l)。CLI 経路は embed.ts の
// rewriteEmbeddedMermaid を使うが、standalone build は build chain 専用にここで inline する。
const EMBEDDED_MERMAID_RE_BUILD =
  /(<script\b(?=[^>]*\bid="embedded-mermaid")(?=[^>]*\btype="module")[^>]*>)([\s\S]*?)(<\/script>)/i

// KaTeX runtime / CSS / fonts-extra CSS 注入用 (docs/mdxg-math-rendering.md §5.k / §5.l)。
// CLI 経路は embed.ts の rewriteEmbeddedKatex (Step 4 で追加) を使うが、standalone build は
// build chain 専用にここで inline する。standalone はフォント範囲 `all` 固定なので
// fonts-extra も無条件に書き込む。Mermaid と完全に対称。
const EMBEDDED_KATEX_JS_RE_BUILD =
  /(<script\b(?=[^>]*\bid="embedded-katex")(?=[^>]*\btype="module")[^>]*>)([\s\S]*?)(<\/script>)/i
const EMBEDDED_KATEX_CSS_RE_BUILD =
  /(<style\b(?=[^>]*\bid="embedded-katex-css")[^>]*>)([\s\S]*?)(<\/style>)/i
const EMBEDDED_KATEX_FONTS_EXTRA_CSS_RE_BUILD =
  /(<style\b(?=[^>]*\bid="embedded-katex-fonts-extra-css")[^>]*>)([\s\S]*?)(<\/style>)/i

const inlineMermaidIntoHtml = (html: string, runtime: string): string => {
  const match = EMBEDDED_MERMAID_RE_BUILD.exec(html)
  if (!match) {
    throw new Error(
      'review.html に id="embedded-mermaid" の <script> タグが見つかりません (build plugin)'
    )
  }
  const [fullMatch, openingTag, , closingTag] = match
  // bridge コード (`globalThis.__mdxgMermaid = mermaid; document.dispatchEvent(...)`) は
  // src/mermaid-entry.ts に含まれており runtime 末尾に焼き込まれている。ここでは
  // literal </script> だけを escape して書き込む (embed.ts の escapeScriptTagInJs と同じ規約)。
  const escaped = runtime.replace(/<\/script>/gi, String.raw`<\/script>`)
  const replaced = `${openingTag}${escaped}${closingTag}`
  return html.slice(0, match.index) + replaced + html.slice(match.index + fullMatch.length)
}

const inlineKatexJsIntoHtml = (html: string, runtime: string): string => {
  const match = EMBEDDED_KATEX_JS_RE_BUILD.exec(html)
  if (!match) {
    throw new Error(
      'review.html に id="embedded-katex" の <script> タグが見つかりません (build plugin)'
    )
  }
  const [fullMatch, openingTag, , closingTag] = match
  // bridge コード (`globalThis.__mdxgKatex = katex; document.dispatchEvent(...)`) は
  // src/katex-entry.ts に含まれており runtime 末尾に焼き込まれている。
  // literal </script> だけ escape (Mermaid と同じ規約)。
  const escaped = runtime.replace(/<\/script>/gi, String.raw`<\/script>`)
  const replaced = `${openingTag}${escaped}${closingTag}`
  return html.slice(0, match.index) + replaced + html.slice(match.index + fullMatch.length)
}

interface CssInlineTarget {
  blockId: string
  re: RegExp
}

const inlineCssBlock = (html: string, css: string, target: CssInlineTarget): string => {
  const match = target.re.exec(html)
  if (!match) {
    throw new Error(
      `review.html に id="${target.blockId}" の <style> タグが見つかりません (build plugin)`
    )
  }
  const [fullMatch, openingTag, , closingTag] = match
  // literal </style> を <\/style> に escape (markdown-css inline と同じ規約、
  // CSS コメントや content: 値に閉じタグ文字列が混入してもパースが壊れないため)。
  const escaped = css.replace(/<\/style>/gi, String.raw`<\/style>`)
  const replaced = `${openingTag}${escaped}${closingTag}`
  return html.slice(0, match.index) + replaced + html.slice(match.index + fullMatch.length)
}

const inlineGrammarsIntoHtml = (html: string, grammars: Record<string, unknown>): string => {
  const match = EMBEDDED_SHIKI_LANGS_RE_BUILD.exec(html)
  if (!match) {
    throw new Error(
      'review.html に id="embedded-shiki-langs" の <script> タグが見つかりません (build plugin)'
    )
  }
  const [fullMatch, openingTag, , closingTag] = match
  // `<` を JSON Unicode escape `\u003C` (6 文字の literal) に置換することで、HTML パーサが
  // `</script>` を閉じタグとして誤検出する余地をゼロにする。embed.ts の `escapeJsonForScriptTag`
  // と同一パターン。
  //
  // ⚠️ template literal の中身は **literal バックスラッシュ + u003C** (7 バイト) で書く必要がある。
  // ソース上で `<` のように Unicode escape を直接書くと TypeScript lexer が先に `<` 1 文字に
  // 解決してしまい、`String.raw` が raw 形式を保持する余地が無くなって replace が no-op になる
  // 罠がある (将来同じ場所を編集する時は hexdump で `60 5c 75 30 30 33 43 60` を確認)。
  const payload = JSON.stringify(grammars).replace(/</g, String.raw`\u003C`)
  const replaced = `${openingTag}${payload}${closingTag}`
  return html.slice(0, match.index) + replaced + html.slice(match.index + fullMatch.length)
}

// vite build 出力 (`dist/review.html`) を 2 ファイルに分岐させる plugin (DESIGN.md §5.a)。
//   1. dist/embed-template.html  : review-request CLI が読み込んでテンプレートとして rewrite する
//                                  (grammar 注入なしの最小サイズ、現行 review.html 相当)
//   2. dist/standalone.html      : 単独 Open file 用、27 言語の grammar を事前 inline 済み
// grammar emit (emitGrammarJsonFiles) は splitOutputsPlugin.closeBundle 内で直接 await する
// (closeBundle は parallel hook で plugin 間順序が保証されないため、emit と派生を同一 plugin に
// 集約して逐次化する。詳細は splitOutputsPlugin のコメント参照)。
// docs/mdxg-diagram-rendering.md §5.l に従い standalone.html には Mermaid runtime を
// build 時に default で inline する。`dist/mermaid.mjs` が見つからない場合 (npm run build を
// 通さず単体で vite.config.ts を回した場合) は標準エラーに警告だけ出して inline 自体は skip し、
// standalone.html は Shiki ハイライト fallback で動作する形にする (build を fail させない)。
const readMermaidRuntimeIfPresent = async (distDir: string): Promise<string | null> => {
  try {
    return await readFile(resolve(distDir, 'mermaid.mjs'), 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      console.warn(
        '[mdxg-split-outputs] dist/mermaid.mjs が見つからないため standalone.html への Mermaid inline を skip しました。`vp build --config vite.mermaid.config.ts` を先に実行してください。'
      )
      return null
    }
    throw error
  }
}

interface KatexAssets {
  fontsExtraCss: string
  js: string
  minimalCss: string
}

// docs/mdxg-math-rendering.md §5.k に従い standalone.html には KaTeX runtime / CSS /
// fonts-extra CSS を build 時に default で inline する (フォント範囲は `all` 相当固定)。
// 3 ファイルのいずれかが見つからない場合 (npm run build を通さず単体で vite.config.ts を
// 回した場合) は標準エラーに警告だけ出して inline 自体を skip し、standalone.html は raw
// `$...$` plain text fallback で動作する形にする (build を fail させない、Mermaid と同じ規約)。
const readKatexAssetsIfPresent = async (distDir: string): Promise<KatexAssets | null> => {
  try {
    const [js, minimalCss, fontsExtraCss] = await Promise.all([
      readFile(resolve(distDir, 'katex', 'katex.mjs'), 'utf8'),
      readFile(resolve(distDir, 'katex', 'katex.css'), 'utf8'),
      readFile(resolve(distDir, 'katex', 'katex-fonts-extra.css'), 'utf8'),
    ])
    return { fontsExtraCss, js, minimalCss }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      console.warn(
        '[mdxg-split-outputs] dist/katex/* が見つからないため standalone.html への KaTeX inline を skip しました。`vp build --config vite.katex.config.ts && node scripts/build-katex-css.ts` を先に実行してください。'
      )
      return null
    }
    throw error
  }
}

const loadShikiGrammars = async (distDir: string): Promise<Record<string, unknown>> => {
  const canonicals = canonicalizeSpec()
  // Promise.all は入力配列順に結果を返すため、entries を canonicals 順に組み直してから
  // オブジェクトへ挿入する。直接 grammars[lang] = ... を Promise.all 内で行うと readFile の
  // 解決順 (= I/O タイミング依存) でキー順が変わり、JSON.stringify 出力がビルドごとに揺れて
  // standalone.html が非決定的になる。
  const entries = await Promise.all(
    canonicals.map(async (lang: string): Promise<readonly [string, unknown]> => {
      const grammarJson = await readFile(resolve(distDir, 'shiki-langs', `${lang}.json`), 'utf8')
      return [lang, JSON.parse(grammarJson) as unknown]
    })
  )
  const grammars: Record<string, unknown> = {}
  for (const [lang, grammar] of entries) {
    grammars[lang] = grammar
  }
  return grammars
}

const inlineKatexAssets = (html: string, assets: KatexAssets): string => {
  const withJs = inlineKatexJsIntoHtml(html, assets.js)
  const withMinimal = inlineCssBlock(withJs, assets.minimalCss, {
    blockId: 'embedded-katex-css',
    re: EMBEDDED_KATEX_CSS_RE_BUILD,
  })
  // standalone は `--math-fonts all` 相当固定 (docs/mdxg-math-rendering.md §5.k) なので
  // fonts-extra も無条件に書き込む。CLI 経路は --math-fonts minimal のとき書かない。
  return inlineCssBlock(withMinimal, assets.fontsExtraCss, {
    blockId: 'embedded-katex-fonts-extra-css',
    re: EMBEDDED_KATEX_FONTS_EXTRA_CSS_RE_BUILD,
  })
}

const buildStandaloneHtml = async (distDir: string, html: string): Promise<string> => {
  const grammars = await loadShikiGrammars(distDir)
  let result = inlineGrammarsIntoHtml(html, grammars)
  const mermaidRuntime = await readMermaidRuntimeIfPresent(distDir)
  if (mermaidRuntime !== null) {
    result = inlineMermaidIntoHtml(result, mermaidRuntime)
  }
  const katexAssets = await readKatexAssetsIfPresent(distDir)
  if (katexAssets !== null) {
    result = inlineKatexAssets(result, katexAssets)
  }
  return result
}

// `<style id="markdown-css">` の中身を src/styles/markdown.css で埋める build / dev 共通 plugin。
// 中核ロジック (HTML コメント mask + regex match + `</style>` escape) は
// src/build/inline-markdown-css.ts に集約済みで、CLI 経路 (--markdown-css / embed.ts の
// rewriteEmbeddedMarkdownCss) と build inline が同一の関数を通る。回帰防止テスト
// (HTML コメント中の literal を無視する等) は同ファイルの in-source test 群で担保されるため、
// ここでは plugin の I/O (markdown.css 読み込み + transformIndexHtml hook への接続) だけを書く。
const markdownCssInlinePlugin = (): Plugin => ({
  name: 'mdxg-markdown-css-inline',
  transformIndexHtml: {
    handler: async (html: string): Promise<string> => {
      const css = await readFile(resolve(ROOT_DIR, 'src', 'styles', 'markdown.css'), 'utf8')
      return inlineMarkdownCssIntoHtml(html, css)
    },
    order: 'pre',
  },
})

// dist/hosting/index.html は standalone を素材として派生し、docs/feature-online-runtime-assets.md
// Phase A.2 の 5 mutation を apply する (buildOnlineHtml の comment 参照):
//   1. <html data-mdxg-online="1">
//   2. CSP `connect-src 'none'` → `connect-src 'self' <allowlist>`
//   3. <head> に <script type="application/json" id="online-allowlist">[...]</script>
//   4. <head> に <script type="application/json" id="online-asset-manifest">{...}</script>
//   5. <script id="embedded-shiki-langs"> の textContent を {} に上書き
// allowlist は MDXG_ONLINE_CONNECT_SRC env (CSV) を DEFAULT に union + 正規化 + 重複排除した結果。
// manifest は splitOutputsPlugin.closeBundle 内で emit 結果から組み立てたものを引数で受け取る。
const buildOnlineHtmlFromStandalone = (
  standaloneHtml: string,
  manifest: OnlineAssetManifestPayload
): string => {
  const allowlist = buildOnlineAllowlist(process.env, {
    warn: (msg: string): void => {
      console.warn(msg)
    },
  })
  // build の再現性に env が影響するため、解決済み allowlist を必ず stdout に emit する。
  // CI ログ / 開発者の手元両方で「この build がどの allowlist を採用したか」が後追いできる。
  console.log(
    `[mdxg-online] dist/hosting/index.html allowlist (${allowlist.length}): ${allowlist.join(' ')}`
  )
  return buildOnlineHtml(standaloneHtml, { allowlist, manifest })
}

// Cloudflare Pages hosting 用の `_headers` を `dist/hosting/` に emit する。
// `/` と `/index.html` (Pages の default index 配信と直接 URL アクセスの両経路) に allowlist
// 適用後 CSP を HTTP response header として返す。 meta CSP との single source of truth は
// extractCspContent 経由で構造的に担保。
//
// `_redirects` は配置しない: Pages 慣習で `/` request は自動的に `index.html` を返すため、
// 旧設計の `/ /online.html 200` rewrite は不要 (online.html → index.html リネームの C 設計判断、
// docs/feature-online-runtime-assets.md Step 4)。
const emitHostingHeaders = async (hostingDir: string, onlineHtml: string): Promise<void> => {
  await writeFile(resolve(hostingDir, '_headers'), buildOnlineHeadersFile(onlineHtml), 'utf8')
}

interface SplitOutputPaths {
  distDir: string
  embedTemplatePath: string
  hostingDir: string
  intermediatePath: string
  onlinePath: string
  standalonePath: string
}

const resolveSplitOutputPaths = (): SplitOutputPaths => {
  const distDir = resolve(ROOT_DIR, 'dist')
  const hostingDir = resolve(distDir, 'hosting')
  return {
    distDir,
    embedTemplatePath: resolve(distDir, 'embed-template.html'),
    hostingDir,
    intermediatePath: resolve(distDir, 'review.html'),
    onlinePath: resolve(hostingDir, 'index.html'),
    standalonePath: resolve(distDir, 'standalone.html'),
  }
}

// grammar emit と standalone/online 派生を **同一 closeBundle 内で逐次 await** することで
// Rollup/Vite の parallel closeBundle 仕様による plugin 間 race を構造的に排除する。
// emit の戻り値 (manifest payload) はこの closeBundle ローカル変数として持ち、 module-level state
// を介さない。 loadShikiGrammars (buildStandaloneHtml 内) も emit 完了後に読むため ENOENT race を
// 踏まない。
//
// **lock 範囲**: Vite/Rolldown は `writeBundle` で共有の `dist/review.html` を書き出すため、
// closeBundle で lock を取ると **lock 取得前に並列 build が review.html を上書きする race** が残る。
// lock を `buildStart` (build chain 開始時) で acquire し、 success path (`closeBundle`) と
// failure path (`buildEnd(error)`) の両方で release を保証する。 token は module-level state で
// hook 間共有 (同一 vite process 内で 1 build しか走らない前提のため state 衝突は起きない)。
const runSplitOutputs = async (): Promise<void> => {
  const paths = resolveSplitOutputPaths()
  const grammarEmission = await emitGrammarJsonFiles()
  const html = await readFile(paths.intermediatePath, 'utf8')
  const standaloneHtml = await buildStandaloneHtml(paths.distDir, html)
  const manifest = buildManifestPayload(grammarEmission)
  const onlineHtml = buildOnlineHtmlFromStandalone(standaloneHtml, manifest)
  // emitGrammarJsonFiles が dist/hosting/{canonical,fingerprinted}/shiki-langs を rename で
  // 作るため hostingDir 自体は既に存在するが、 初回 build や grammar 経路の swap 後で消えている
  // 経路を防御するため明示 mkdir する。 recursive で idempotent。
  await mkdir(paths.hostingDir, { recursive: true })
  await Promise.all([
    writeFile(paths.standalonePath, standaloneHtml, 'utf8'),
    writeFile(paths.onlinePath, onlineHtml, 'utf8'),
    emitHostingHeaders(paths.hostingDir, onlineHtml),
    rename(paths.intermediatePath, paths.embedTemplatePath),
  ])
}

// buildStart で取得した token を closeBundle / buildEnd で release するため module-level に保持。
// 取得失敗 (別 build 稼働中 / stale 残骸) は buildStart 段階で throw されて build を fail-fast で
// 止めるため、 ownedLockToken === null のまま closeBundle / buildEnd に到達することは無い。
let ownedLockToken: string | null = null

const takeOwnedToken = (): string | null => {
  const token = ownedLockToken
  ownedLockToken = null
  return token
}

const splitOutputsPlugin = (): Plugin => ({
  apply: 'build',
  buildEnd: async (error?: Error): Promise<void> => {
    // build success 時は buildEnd → closeBundle 順で呼ばれるため、 ここでは何もせず closeBundle
    // に lock を引き継ぐ。 failure 時 (error が渡される) は closeBundle が呼ばれないため buildEnd で
    // release を実行する。 `eqeqeq` ルールが許す範囲で nullish 判定 (`!= null`) を使い、
    // `error === undefined` 直接比較を避ける。
    if (!(error instanceof Error)) {
      return
    }
    const token = takeOwnedToken()
    if (token !== null) {
      await releaseGrammarBuildLock(token)
    }
  },
  buildStart: async (): Promise<void> => {
    // Vite/Rolldown は writeBundle で共有の `dist/review.html` を書くため、 ここ (build chain の
    // 最初) で lock を取らないと、 lock 取得前に並列 build が review.html を上書きする race が
    // 残る。 acquire の throw は vite-plus の plugin context で握られて build が closeBundle まで
    // 進んでしまう挙動が観測されたため、 ここで catch して **process.exit(1) で abrupt termination**
    // する (build pipeline 用途として正規)。 abrupt 終了でも vite の中間 file はあとで cleanup
    // されるため副作用最小。
    try {
      ownedLockToken = await acquireGrammarBuildLock()
    } catch (error) {
      console.error(wrapAsError(error).message)
      process.exit(1)
    }
  },
  closeBundle: async (): Promise<void> => {
    const token = takeOwnedToken()
    try {
      await runSplitOutputs()
    } finally {
      if (token !== null) {
        await releaseGrammarBuildLock(token)
      }
    }
  },
  name: 'mdxg-split-outputs',
})

// `root: 'src'` でソース一式 (review.html + review.ts + review.css) を src/ 配下に集約。
// outDir は root からの相対なので '../dist' を指定し、中間出力を repo ルート直下の
// dist/review.html に置く (splitOutputsPlugin が embed-template.html / standalone.html に分岐)。
// `files` field 経由で npm publish 対象になる。
export default defineConfig({
  build: {
    emptyOutDir: false,
    outDir: '../dist',
    rollupOptions: {
      input: 'src/review.html',
    },
  },
  // in-source test (`if (import.meta.vitest) { ... }`) を production bundle から除去する。
  // 除去しないと bundle 内のテストデータ文字列（例: rewriteReviewHtml の baseHtml に含まれる
  // `<script id="embedded-md" type="text/markdown">` リテラル）が本物の埋め込み script タグより
  // 手前に出現し、embed CLI 側の正規表現が誤マッチを起こして埋め込みが壊れる。
  define: {
    'import.meta.vitest': 'undefined',
  },
  fmt: {
    // ビルド成果物はフォーマット対象外。`vp build` で都度上書きされるため。
    ignorePatterns: ['dist/'],
    semi: false,
    singleQuote: true,
    trailingComma: 'es5',
  },
  lint: {
    categories: {
      correctness: 'error',
      perf: 'error',
      restriction: 'error',
      style: 'error',
      suspicious: 'error',
    },
    // ビルド成果物はチェック対象外。`vp build` で都度上書きされるため。
    ignorePatterns: ['dist/'],
    options: { typeAware: true, typeCheck: true },
    overrides: [
      {
        // 言語 ID として "c" 等の 1 文字識別子を含む必要がある生成物。
        files: ['**/*.generated.ts'],
        rules: { 'id-length': 'off' },
      },
      {
        // ビルドスクリプト / vite config では stdout・stderr が正規の出力チャネルなので
        // no-console を off にする。出荷される browser コード (src/app 等) には適用しない。
        // unicorn/no-process-exit も同様に off: vite-plus が plugin の async throw を握って
        // build を継続させる挙動への対策として、 lock 取得失敗時に build を確実に止めるため
        // process.exit(1) を使う必要がある (build pipeline 用途として正規)。
        files: ['scripts/**', '*.config.ts'],
        rules: { 'no-console': 'off', 'unicorn/no-process-exit': 'off' },
      },
    ],
    rules: {
      'capitalized-comments': 'off',
      'no-array-reduce': 'off',
      'no-magic-numbers': 'off',
      'number-literal-case': 'off',
      'oxc/no-async-await': 'off',
      'oxc/no-rest-spread-properties': 'off',
      // import の並びは fmt (oxfmt sortImports) が所有する。lint の sort-imports は
      // member 構文順 (none→all→multiple→single) という別アルゴリズムで衝突するため off。
      'sort-imports': 'off',
      'unicorn/no-null': 'off',
    },
  },
  plugins: [
    markdownCssInlinePlugin(),
    viteSingleFile(),
    shikiAliasesPlugin(),
    splitOutputsPlugin(),
  ],
  root: 'src',
  test: {
    environment: 'happy-dom',
    includeSource: ['**/*.ts'],
  },
})
