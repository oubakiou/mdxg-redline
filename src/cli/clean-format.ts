// `--clean` サブコマンドの stdout フォーマッタ群 (pure)。I/O を一切持たず、`runClean` から
// 文字列生成だけを取り出した責務に閉じている。新規 clean policy を追加する際にも、
// フォーマット文言の試行錯誤を実 fs 経由のテストなしで行える。

import type { ClassifiedEntry, ClassifyResult } from './clean'

const formatEntryLines = (header: string, entries: readonly ClassifiedEntry[]): string[] => {
  if (entries.length === 0) {
    return []
  }
  return [header, ...entries.map((entry: ClassifiedEntry): string => `  ${entry.filename}`)]
}

export const formatDryRun = (dir: string, result: ClassifyResult): string => {
  if (result.toDelete.length === 0 && result.kept.length === 0) {
    return `No review/feedback artifacts found in ${dir}.\n`
  }
  const deleteLines = formatEntryLines(
    `[dry-run] Would delete ${result.toDelete.length} file(s) in ${dir}:`,
    result.toDelete
  )
  const keepLines = formatEntryLines(
    `Kept ${result.kept.length} file(s) matching --keep:`,
    result.kept
  )
  return `${[...deleteLines, ...keepLines, `Run with --yes to delete.`].join('\n')}\n`
}

export const formatDeleted = (dir: string, deleted: number, kept: number): string => {
  if (deleted === 0 && kept === 0) {
    return `No review/feedback artifacts found in ${dir}.\n`
  }
  const head = `Deleted ${deleted} file(s) in ${dir}.\n`
  if (kept === 0) {
    return head
  }
  return `${head}Kept ${kept} file(s) matching --keep.\n`
}
