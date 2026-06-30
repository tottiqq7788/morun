import { describe, expect, it } from 'vitest'
import type { MorunNativeBridge } from '../native/morunNative'
import { defaultConfig, type ModelConfig } from './chat'
import {
  clearStoredModelAccountApiKey,
  migrateModelAccountSecrets,
  modelAccountApiKeyRef,
  resolveModelAccountApiKey,
  withStoredModelAccountApiKey,
} from './modelSecrets'

describe('model account secrets', () => {
  it('migrates raw API keys into native secure storage', async () => {
    const secureValues = new Map<string, string>()
    const bridge = createBridge({
      available: true,
      secureValues,
    })
    const config = createConfig({
      apiKey: 'secret-key',
    })

    const changed = await migrateModelAccountSecrets(config, bridge)

    expect(changed).toBe(true)
    expect(config.accounts[0].apiKey).toBe('')
    expect(config.accounts[0].apiKeyRef).toBe(modelAccountApiKeyRef('account_1'))
    expect(secureValues.get(modelAccountApiKeyRef('account_1'))).toBe('secret-key')
  })

  it('keeps browser dev behavior when native storage is unavailable', async () => {
    const config = createConfig({
      apiKey: 'dev-key',
    })

    const changed = await migrateModelAccountSecrets(config, createBridge({ available: false }))

    expect(changed).toBe(false)
    expect(config.accounts[0].apiKey).toBe('dev-key')
    expect(config.accounts[0].apiKeyRef).toBeUndefined()
  })

  it('resolves stored native API keys before falling back to local metadata', async () => {
    const bridge = createBridge({
      available: true,
      secureValues: new Map([[modelAccountApiKeyRef('account_1'), 'native-key']]),
    })
    const config = createConfig({
      apiKey: '',
      apiKeyRef: modelAccountApiKeyRef('account_1'),
    })

    await expect(resolveModelAccountApiKey(config.accounts[0], bridge)).resolves.toBe('native-key')
  })

  it('stores new account keys natively when the bridge is available', async () => {
    const secureValues = new Map<string, string>()
    const account = createConfig({ apiKey: '' }).accounts[0]

    const storedAccount = await withStoredModelAccountApiKey(
      account,
      'fresh-key',
      createBridge({ available: true, secureValues }),
    )

    expect(storedAccount.apiKey).toBe('')
    expect(storedAccount.apiKeyRef).toBe(modelAccountApiKeyRef('account_1'))
    expect(secureValues.get(modelAccountApiKeyRef('account_1'))).toBe('fresh-key')
  })

  it('does not fall back to local raw keys when native secure storage fails', async () => {
    const account = createConfig({ apiKey: '' }).accounts[0]

    await expect(
      withStoredModelAccountApiKey(account, 'fresh-key', createBridge({ available: true, canStore: false })),
    ).rejects.toThrow('无法安全保存接口密钥')
  })

  it('clears secure API keys when model accounts are deleted', async () => {
    const secureValues = new Map([[modelAccountApiKeyRef('account_1'), 'native-key']])
    const account = createConfig({
      apiKey: '',
      apiKeyRef: modelAccountApiKeyRef('account_1'),
    }).accounts[0]

    await expect(clearStoredModelAccountApiKey(account, createBridge({ available: true, secureValues }))).resolves.toBe(
      true,
    )

    expect(secureValues.has(modelAccountApiKeyRef('account_1'))).toBe(false)
  })

  it('treats local-only API keys as already clearable', async () => {
    const account = createConfig({
      apiKey: 'dev-key',
      apiKeyRef: undefined,
    }).accounts[0]

    await expect(clearStoredModelAccountApiKey(account, createBridge({ available: false }))).resolves.toBe(true)
  })
})

function createConfig(accountPatch: Partial<ModelConfig['accounts'][number]>): ModelConfig {
  return {
    ...defaultConfig,
    accounts: [
      {
        id: 'account_1',
        providerId: 'deepseek',
        name: 'DeepSeek',
        apiKey: '',
        model: 'deepseek-chat',
        availableModels: [],
        createdAt: 1,
        updatedAt: 1,
        ...accountPatch,
      },
    ],
    activeAccountId: 'account_1',
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
