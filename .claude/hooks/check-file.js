#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

const readPayload = () => {
  const raw = readFileSync(0, 'utf8').trim()

  if (raw === '') {
    return {}
  }

  const parsed = JSON.parse(raw)

  if (isRecord(parsed)) {
    return parsed
  }

  return {}
}

const getFile = (payload) => {
  if (!isRecord(payload.tool_input)) {
    return ''
  }

  if (typeof payload.tool_input.file_path === 'string') {
    return payload.tool_input.file_path
  }

  return ''
}

const emitAdditionalContext = (message) => {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        additionalContext: `check-file failed:\n${message}`,
        hookEventName: 'PostToolUse',
      },
    })
  )
}

const file = getFile(readPayload())

if (file !== '') {
  const result = spawnSync('bash', ['.agents/scripts/check-file.sh', file], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.status === 0) {
    process.exit(0)
  }

  if (result.error) {
    emitAdditionalContext(result.error.message)
  } else {
    emitAdditionalContext([result.stdout, result.stderr].filter(Boolean).join('\n').trim())
  }
}
