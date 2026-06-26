import { describe, expect, it, vi } from 'vitest'
import { createNativeTools, parseHttpUrl } from './nativeTools'
import type { MorunNativeBridge } from '../native/morunNative'

describe('native_open_url', () => {
  it('rejects non-http URLs', () => {
    expect(() => parseHttpUrl({ url: 'file:///etc/passwd' })).toThrow('只允许 http 或 https')
    expect(() => parseHttpUrl({ url: 'javascript:alert(1)' })).toThrow('只允许 http 或 https')
  })

  it('opens valid http URLs through the native bridge', async () => {
    const openUrl = vi.fn(async () => true)
    const [tool] = createNativeTools(createBridge(openUrl))

    const result = await tool.execute({ url: 'https://example.com/path' }, {})

    expect(openUrl).toHaveBeenCalledWith('https://example.com/path')
    expect(result.text).toContain('已打开链接')
    expect(tool).toMatchObject({
      source: 'native',
      riskLevel: 'medium',
      permission: 'external_app',
      requiresConfirmation: true,
    })
  })
})

function createBridge(openUrl: MorunNativeBridge['openUrl']): MorunNativeBridge {
  return {
    isAvailable: async () => true,
    platformInfo: async () => ({ platform: 'android', version: 'test' }),
    secureGet: async () => null,
    secureSet: async () => true,
    secureDelete: async () => true,
    openUrl,
    startChatCompletion: async ({ requestId }) => ({ requestId }),
    cancelChatCompletion: async () => true,
    addListener: async () => ({
      remove: async () => {},
    }),
  }
}
