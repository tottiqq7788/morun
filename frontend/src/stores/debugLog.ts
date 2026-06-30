import { morunNativeBridge, type MorunNativeBridge } from '../native/morunNative'

export type DebugLogLevel = 'debug' | 'info' | 'warn' | 'error'
export type DebugLogCategory = 'app' | 'chat' | 'agent' | 'model' | 'tool' | 'media' | 'settings'

export interface DebugLogEntryInput {
  level?: DebugLogLevel
  category: DebugLogCategory
  event: string
  sessionId?: string
  messageId?: string
  runId?: string
  data?: unknown
}

export interface DebugLogEntry extends Required<Pick<DebugLogEntryInput, 'level' | 'category' | 'event'>> {
  schemaVersion: 1
  id: string
  ts: string
  sessionId?: string
  messageId?: string
  runId?: string
  data?: unknown
}

export interface DebugLogFileInfo {
  name: string
  size: number
  lastModified: number
}

export interface DebugLogInfo {
  enabled: boolean
  transport: 'android' | 'web'
  directory?: string
  totalBytes: number
  latestModifiedAt?: number
  files: DebugLogFileInfo[]
}

export interface DebugLogStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

export const debugLogStorageKey = 'morun.debug-log.web.v1'
export const debugLogSchemaVersion = 1
export const debugLogFieldLimit = 50 * 1024
const webLogLimit = 768 * 1024
const sensitiveKeyPattern = /(api[_-]?key|authorization|auth[_-]?header|bearer|password|secret|access[_-]?token|refresh[_-]?token|keyref|apiKeyRef)/i
const mediaKeyPattern = /(base64|bytes|blob|binary|imageData|dataUrl)/i

export async function writeDebugLog(
  input: DebugLogEntryInput,
  {
    nativeBridge = morunNativeBridge,
    storage = localStorage,
  }: {
    nativeBridge?: MorunNativeBridge
    storage?: DebugLogStorageLike
  } = {},
) {
  const entry = createDebugLogEntry(input)
  const line = JSON.stringify(entry)

  if (nativeBridge.appendDebugLog && (await nativeBridge.isAvailable())) {
    const ok = await nativeBridge.appendDebugLog(line)
    if (ok) return entry
  }

  appendWebDebugLog(line, storage)
  return entry
}

export async function getDebugLogInfo(
  {
    nativeBridge = morunNativeBridge,
    storage = localStorage,
  }: {
    nativeBridge?: MorunNativeBridge
    storage?: DebugLogStorageLike
  } = {},
): Promise<DebugLogInfo> {
  if (nativeBridge.getDebugLogInfo && (await nativeBridge.isAvailable())) {
    const info = await nativeBridge.getDebugLogInfo()
    if (info) return { ...info, transport: 'android', enabled: true }
  }

  const value = storage.getItem(debugLogStorageKey) ?? ''
  return {
    enabled: true,
    transport: 'web',
    totalBytes: byteLength(value),
    latestModifiedAt: value ? Date.now() : undefined,
    files: value
      ? [
          {
            name: debugLogStorageKey,
            size: byteLength(value),
            lastModified: Date.now(),
          },
        ]
      : [],
  }
}

export async function clearDebugLogs(
  {
    nativeBridge = morunNativeBridge,
    storage = localStorage,
  }: {
    nativeBridge?: MorunNativeBridge
    storage?: DebugLogStorageLike
  } = {},
) {
  if (nativeBridge.clearDebugLogs && (await nativeBridge.isAvailable())) {
    await nativeBridge.clearDebugLogs()
  }

  storage.removeItem?.(debugLogStorageKey)
  return true
}

export function createDebugLogEntry(input: DebugLogEntryInput): DebugLogEntry {
  const entry: DebugLogEntry = {
    schemaVersion: debugLogSchemaVersion,
    id: createDebugLogId(),
    ts: new Date().toISOString(),
    level: input.level ?? 'info',
    category: input.category,
    event: input.event,
  }

  if (input.sessionId) entry.sessionId = input.sessionId
  if (input.messageId) entry.messageId = input.messageId
  if (input.runId) entry.runId = input.runId
  if (input.data !== undefined) entry.data = sanitizeDebugLogData(input.data)

  return entry
}

export function sanitizeDebugLogData(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return sanitizeDebugString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'function' || typeof value === 'symbol') return `[omitted:${typeof value}]`

  if (Array.isArray(value)) {
    if (seen.has(value)) return '[circular]'
    seen.add(value)
    return value.map((item) => sanitizeDebugLogData(item, seen))
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]'
    seen.add(value)

    const record = value as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(record).map(([key, item]) => {
        if (isSensitiveKey(key)) return [key, '[redacted]']
        if (mediaKeyPattern.test(key)) return [key, '[redacted:media]']
        return [key, sanitizeDebugLogData(item, seen)]
      }),
    )
  }

  return String(value)
}

function appendWebDebugLog(line: string, storage: DebugLogStorageLike) {
  const current = storage.getItem(debugLogStorageKey) ?? ''
  let next = `${current}${line}\n`
  if (byteLength(next) > webLogLimit) {
    next = next.slice(Math.max(0, next.length - webLogLimit))
    const newlineIndex = next.indexOf('\n')
    if (newlineIndex >= 0) next = next.slice(newlineIndex + 1)
  }
  storage.setItem(debugLogStorageKey, next)
}

function sanitizeDebugString(value: string): unknown {
  if (isMediaString(value)) return '[redacted:media]'
  if (value.length <= debugLogFieldLimit) return value

  return {
    value: value.slice(0, debugLogFieldLimit),
    truncated: true,
    originalLength: value.length,
  }
}

function isSensitiveKey(key: string) {
  return sensitiveKeyPattern.test(key)
}

function isMediaString(value: string) {
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) return true
  if (value.length < 4096 || /\s/.test(value)) return false

  const looksLikeBase64 = /^[A-Za-z0-9+/=]+$/.test(value) && value.length % 4 === 0
  if (!looksLikeBase64) return false

  return value.startsWith('/9j/') || value.startsWith('iVBORw0KGgo') || value.startsWith('R0lGOD') || value.startsWith('UklGR')
}

function createDebugLogId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `log_${crypto.randomUUID()}`
    : `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function byteLength(value: string) {
  return new Blob([value]).size
}
