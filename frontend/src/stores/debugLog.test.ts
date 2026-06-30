import { describe, expect, it, vi } from 'vitest'
import {
  clearDebugLogs,
  createDebugLogEntry,
  debugLogFieldLimit,
  debugLogStorageKey,
  getDebugLogInfo,
  sanitizeDebugLogData,
  writeDebugLog,
  type DebugLogStorageLike,
} from './debugLog'
import type { MorunNativeBridge } from '../native/morunNative'

describe('debug log store', () => {
  it('records full user and assistant text in log entries', () => {
    const entry = createDebugLogEntry({
      category: 'chat',
      event: 'assistant_message',
      sessionId: 'session-1',
      messageId: 'message-1',
      data: {
        userContent: '我现在在哪里？',
        assistantContent: '你在上海附近。',
      },
    })

    expect(entry.schemaVersion).toBe(1)
    expect(entry.sessionId).toBe('session-1')
    expect(entry.messageId).toBe('message-1')
    expect(entry.data).toMatchObject({
      userContent: '我现在在哪里？',
      assistantContent: '你在上海附近。',
    })
  })

  it('redacts credentials and media payloads', () => {
    const data = sanitizeDebugLogData({
      apiKey: 'sk-live',
      headers: {
        Authorization: 'Bearer secret',
      },
      nested: {
        access_token: 'token',
        apiKeyRef: 'tool:tavily:apiKey',
      },
      imageData: 'data:image/png;base64,AAAA',
      safe: 'visible',
    })

    expect(data).toEqual({
      apiKey: '[redacted]',
      headers: {
        Authorization: '[redacted]',
      },
      nested: {
        access_token: '[redacted]',
        apiKeyRef: '[redacted]',
      },
      imageData: '[redacted:media]',
      safe: 'visible',
    })
  })

  it('truncates large string fields with metadata', () => {
    const longText = '这是一段调试文本。'.repeat(Math.ceil((debugLogFieldLimit + 20) / 9))
    const data = sanitizeDebugLogData({ output: longText }) as { output: { value: string; truncated: boolean; originalLength: number } }

    expect(data.output.value).toHaveLength(debugLogFieldLimit)
    expect(data.output.truncated).toBe(true)
    expect(data.output.originalLength).toBe(longText.length)
  })

  it('keeps long plain text while redacting image data urls', () => {
    const plainText = 'plain debug text '.repeat(400)
    const data = sanitizeDebugLogData({
      plainText,
      image: 'data:image/png;base64,AAAA',
    }) as { plainText: string; image: string }

    expect(data.plainText).toBe(plainText)
    expect(data.image).toBe('[redacted:media]')
  })

  it('writes to native debug log when available', async () => {
    const appendDebugLog = vi.fn(async (_entry: string) => true)
    const bridge = createBridge({
      available: true,
      appendDebugLog,
    })
    const storage = createStorage()

    await writeDebugLog(
      {
        category: 'agent',
        event: 'run_started',
        data: { apiKey: 'secret', content: 'hello' },
      },
      { nativeBridge: bridge, storage },
    )

    expect(appendDebugLog).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(appendDebugLog.mock.calls[0]?.[0] ?? '{}')
    expect(payload.data).toMatchObject({ apiKey: '[redacted]', content: 'hello' })
    expect(storage.getItem(debugLogStorageKey)).toBeNull()
  })

  it('falls back to local storage and can clear logs', async () => {
    const storage = createStorage()
    const bridge = createBridge({ available: false })

    await writeDebugLog({ category: 'tool', event: 'tool_failed', data: { error: 'boom' } }, { nativeBridge: bridge, storage })
    expect(storage.getItem(debugLogStorageKey)).toContain('tool_failed')

    const info = await getDebugLogInfo({ nativeBridge: bridge, storage })
    expect(info.transport).toBe('web')
    expect(info.totalBytes).toBeGreaterThan(0)

    await clearDebugLogs({ nativeBridge: bridge, storage })
    expect(storage.getItem(debugLogStorageKey)).toBeNull()
  })
})

function createStorage(): DebugLogStorageLike {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

function createBridge({
  available,
  appendDebugLog,
}: {
  available: boolean
  appendDebugLog?: MorunNativeBridge['appendDebugLog']
}): MorunNativeBridge {
  return {
    isAvailable: async () => available,
    platformInfo: async () => (available ? { platform: 'android', version: 'test' } : null),
    secureGet: async () => null,
    secureSet: async () => false,
    secureDelete: async () => false,
    openUrl: async () => false,
    termuxStatus: async () => ({
      available: false,
      termuxInstalled: false,
      termuxApiInstalled: false,
      runCommandPermissionGranted: false,
      canRunCommands: false,
      message: 'test',
    }),
    requestTermuxRunCommandPermission: async () => ({
      available: false,
      termuxInstalled: false,
      termuxApiInstalled: false,
      runCommandPermissionGranted: false,
      canRunCommands: false,
      message: 'test',
    }),
    openTermuxInstallPage: async () => false,
    openTermuxApiInstallPage: async () => false,
    openTermuxApp: async () => false,
    runTermuxCommand: async ({ requestId }) => ({
      requestId,
      available: false,
      stdout: '',
      stderr: '',
      exitCode: null,
      timedOut: false,
    }),
    importMedia: async () => {
      throw new Error('unavailable')
    },
    startVoiceRecording: async (requestId) => ({ requestId, startedAt: 1 }),
    stopVoiceRecording: async (requestId) => ({
      requestId,
      voiceId: 'voice_test123',
      localPath: '/data/user/0/com.morun.app/files/morun-voice/voice_test123.wav',
      fileName: 'voice_test123.wav',
      mimeType: 'audio/wav',
      size: 1,
      durationMs: 1000,
      sampleRate: 16000,
      transcript: 'test',
      recognitionElapsedMs: 1,
      createdAt: 1,
      segments: [],
    }),
    cancelVoiceRecording: async () => false,
    startChatCompletion: async ({ requestId }) => ({ requestId }),
    cancelChatCompletion: async () => false,
    addListener: async () => ({ remove: async () => {} }),
    appendDebugLog,
  }
}
