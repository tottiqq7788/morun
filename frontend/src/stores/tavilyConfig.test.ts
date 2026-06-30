import { describe, expect, it } from 'vitest'
import type { MorunNativeBridge } from '../native/morunNative'
import {
  clearStoredTavilyApiKey,
  createDefaultTavilyConfig,
  hasConfiguredTavilyApiKey,
  loadTavilyConfig,
  migrateTavilyConfigSecret,
  resolveTavilyApiKey,
  saveTavilyConfig,
  tavilyApiKeyRef,
  tavilyConfigKey,
  withStoredTavilyApiKey,
  type TavilyConfig,
} from './tavilyConfig'

describe('tavily config', () => {
  it('loads and saves local config', () => {
    const storage = createStorage()
    const config: TavilyConfig = {
      apiKey: 'local-key',
      updatedAt: 123,
    }

    saveTavilyConfig(config, storage)

    expect(storage.getItem(tavilyConfigKey)).toContain('local-key')
    expect(loadTavilyConfig(storage)).toEqual(config)
  })

  it('migrates local API key into native secure storage', async () => {
    const secureValues = new Map<string, string>()
    const config = createConfig({ apiKey: 'secret-key' })

    const changed = await migrateTavilyConfigSecret(config, createBridge({ available: true, secureValues }))

    expect(changed).toBe(true)
    expect(config.apiKey).toBe('')
    expect(config.apiKeyRef).toBe(tavilyApiKeyRef)
    expect(secureValues.get(tavilyApiKeyRef)).toBe('secret-key')
  })

  it('keeps local key when native storage is unavailable', async () => {
    const config = createConfig({ apiKey: 'dev-key' })

    const changed = await migrateTavilyConfigSecret(config, createBridge({ available: false }))

    expect(changed).toBe(false)
    expect(config.apiKey).toBe('dev-key')
    expect(config.apiKeyRef).toBeUndefined()
  })

  it('resolves secure key before falling back to local key', async () => {
    const config = createConfig({ apiKey: 'local-key', apiKeyRef: tavilyApiKeyRef })
    const bridge = createBridge({
      available: true,
      secureValues: new Map([[tavilyApiKeyRef, 'secure-key']]),
    })

    await expect(resolveTavilyApiKey(config, bridge)).resolves.toBe('secure-key')
  })

  it('stores new key natively when native storage is available', async () => {
    const secureValues = new Map<string, string>()

    const config = await withStoredTavilyApiKey(
      createDefaultTavilyConfig(),
      'fresh-key',
      createBridge({ available: true, secureValues }),
    )

    expect(config.apiKey).toBe('')
    expect(config.apiKeyRef).toBe(tavilyApiKeyRef)
    expect(secureValues.get(tavilyApiKeyRef)).toBe('fresh-key')
  })

  it('stores new key locally in browser preview', async () => {
    const config = await withStoredTavilyApiKey(createDefaultTavilyConfig(), 'dev-key', createBridge({ available: false }))

    expect(config.apiKey).toBe('dev-key')
    expect(config.apiKeyRef).toBeUndefined()
  })

  it('clears local and secure key references', async () => {
    const secureValues = new Map([[tavilyApiKeyRef, 'secure-key']])
    const config = createConfig({ apiKey: 'local-key', apiKeyRef: tavilyApiKeyRef })

    const cleared = await clearStoredTavilyApiKey(config, createBridge({ available: true, secureValues }))

    expect(cleared.apiKey).toBe('')
    expect(cleared.apiKeyRef).toBeUndefined()
    expect(secureValues.has(tavilyApiKeyRef)).toBe(false)
    expect(hasConfiguredTavilyApiKey(cleared)).toBe(false)
  })
})

function createConfig(patch: Partial<TavilyConfig>): TavilyConfig {
  return {
    apiKey: '',
    updatedAt: 1,
    ...patch,
  }
}

function createStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
}

function createBridge({
  available,
  secureValues = new Map<string, string>(),
  canStore = true,
}: {
  available: boolean
  secureValues?: Map<string, string>
  canStore?: boolean
}): MorunNativeBridge {
  return {
    isAvailable: async () => available,
    platformInfo: async () => (available ? { platform: 'android', version: 'test' } : null),
    secureGet: async (key) => secureValues.get(key) ?? null,
    secureSet: async (key, value) => {
      if (!available || !canStore) return false
      secureValues.set(key, value)
      return true
    },
    secureDelete: async (key) => {
      secureValues.delete(key)
      return available
    },
    openUrl: async () => available,
    termuxStatus: async () => ({
      available,
      termuxInstalled: available,
      termuxApiInstalled: available,
      runCommandPermissionGranted: available,
      canRunCommands: available,
      message: available ? 'ready' : 'unavailable',
    }),
    requestTermuxRunCommandPermission: async () => ({
      available,
      termuxInstalled: available,
      termuxApiInstalled: available,
      runCommandPermissionGranted: available,
      canRunCommands: available,
      message: available ? 'ready' : 'unavailable',
    }),
    openTermuxInstallPage: async () => available,
    openTermuxApiInstallPage: async () => available,
    openTermuxApp: async () => available,
    runTermuxCommand: async ({ requestId }) => ({
      requestId,
      available,
      stdout: '',
      stderr: available ? '' : 'unavailable',
      exitCode: available ? 0 : null,
      timedOut: false,
    }),
    importMedia: async () => ({
      mediaId: 'media_test123',
      kind: 'image',
      originalSource: 'https://example.com/photo.jpg',
      localPath: '/data/user/0/com.morun.app/files/morun-media/media_test123.jpg',
      mimeType: 'image/jpeg',
      fileName: 'media_test123.jpg',
      size: 100,
      createdAt: 1,
    }),
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
    cancelVoiceRecording: async () => available,
    startChatCompletion: async ({ requestId }) => ({ requestId }),
    cancelChatCompletion: async () => available,
    addListener: async () => ({
      remove: async () => {},
    }),
  }
}
