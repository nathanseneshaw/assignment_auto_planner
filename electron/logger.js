import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

const MAX_BYTES = 1024 * 1024 // 1MB

let logDirCached = null
let logFileCached = null

function ensurePaths() {
  if (logFileCached) return logFileCached
  // Defer app.getPath until first use; module load may precede app ready.
  const userData = app.getPath('userData')
  logDirCached = path.join(userData, 'logs')
  logFileCached = path.join(logDirCached, 'main.log')
  try {
    fs.mkdirSync(logDirCached, { recursive: true })
  } catch {
    // best-effort
  }
  return logFileCached
}

export function getLogPath() {
  return ensurePaths()
}

function rotateIfNeeded(file) {
  try {
    const stat = fs.statSync(file)
    if (stat.size < MAX_BYTES) return
    const rotated = file + '.1'
    try { fs.rmSync(rotated, { force: true }) } catch {}
    fs.renameSync(file, rotated)
  } catch {
    // file may not exist yet
  }
}

function fmt(arg) {
  if (arg instanceof Error) return arg.stack || arg.message
  if (typeof arg === 'string') return arg
  try { return JSON.stringify(arg) } catch { return String(arg) }
}

export function log(level, ...args) {
  const ts = new Date().toISOString()
  const lvl = String(level).toUpperCase()
  const msg = args.map(fmt).join(' ')
  const line = `[${ts}] [${lvl}] ${msg}\n`

  // Mirror to console.
  const consoleFn = lvl === 'ERROR' ? console.error : lvl === 'WARN' ? console.warn : console.log
  consoleFn(line.trimEnd())

  try {
    const file = ensurePaths()
    rotateIfNeeded(file)
    fs.appendFileSync(file, line)
  } catch {
    // swallow — logging must never throw
  }
}

export const info = (...args) => log('info', ...args)
export const warn = (...args) => log('warn', ...args)
export const error = (...args) => log('error', ...args)

export default { log, info, warn, error, getLogPath }
