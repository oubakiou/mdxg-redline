// `--clean` サブコマンドの stdout フォーマッタ群 (pure)。I/O を一切持たず、`runClean` から
// 文字列生成だけを取り出した責務に閉じている。新規 clean policy を追加する際にも、
// フォーマット文言の試行錯誤を実 fs 経由のテストなしで行える。

import type { ClassifiedEntry, ClassifyResult } from './clean'
import { translateCli } from './i18n'

const formatEntryLines = (header: string, entries: readonly ClassifiedEntry[]): string[] => {
  if (entries.length === 0) {
    return []
  }
  return [header, ...entries.map((entry: ClassifiedEntry): string => `  ${entry.filename}`)]
}

export const formatDryRun = (dir: string, result: ClassifyResult): string => {
  if (result.toDelete.length === 0 && result.kept.length === 0) {
    return `${translateCli('cli.clean.no_files_found', { dir })}\n`
  }
  const deleteLines = formatEntryLines(
    translateCli('cli.clean.dry_run_header', { count: result.toDelete.length, dir }),
    result.toDelete
  )
  const keepLines = formatEntryLines(
    translateCli('cli.clean.kept_header', { count: result.kept.length }),
    result.kept
  )
  return `${[...deleteLines, ...keepLines, translateCli('cli.clean.run_with_yes_hint')].join('\n')}\n`
}

export const formatDeleted = (dir: string, deleted: number, kept: number): string => {
  if (deleted === 0 && kept === 0) {
    return `${translateCli('cli.clean.no_files_found', { dir })}\n`
  }
  const head = `${translateCli('cli.clean.deleted_summary', { count: deleted, dir })}\n`
  if (kept === 0) {
    return head
  }
  return `${head}${translateCli('cli.clean.kept_summary', { count: kept })}\n`
}
