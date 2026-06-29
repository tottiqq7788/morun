import { describe, expect, it, vi } from 'vitest'
import { createNativeTools, parseHttpUrl, parseMediaImportArgs } from './nativeTools'
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

describe('morun_media_import', () => {
  it('parses image import args', () => {
    expect(parseMediaImportArgs({ source: ' https://example.com/a.jpg ', kind: 'image' })).toEqual({
      source: 'https://example.com/a.jpg',
      kind: 'image',
    })
    expect(() => parseMediaImportArgs({ source: '', kind: 'image' })).toThrow('source')
    expect(() => parseMediaImportArgs({ source: 'https://example.com/a.jpg', kind: 'video' })).toThrow('kind')
  })

  it('imports media through the native bridge and returns markdown', async () => {
    const importMedia = vi.fn(async () => ({
      mediaId: 'media_test123',
      kind: 'image' as const,
      originalSource: 'https://example.com/a.jpg',
      localPath: '/data/user/0/com.morun.app/files/morun-media/media_test123.jpg',
      mimeType: 'image/jpeg',
      fileName: 'media_test123.jpg',
      size: 42,
      createdAt: 1,
    }))
    const tools = createNativeTools(createBridge(undefined, importMedia))
    const tool = tools.find((item) => item.name === 'morun_media_import')

    const result = await tool?.execute({ source: 'https://example.com/a.jpg', kind: 'image' }, {})

    expect(importMedia).toHaveBeenCalledWith({ source: 'https://example.com/a.jpg', kind: 'image' })
    expect(result?.data).toMatchObject({
      mediaId: 'media_test123',
      markdown: '![media_test123.jpg](morun-media://media_test123)',
    })
    expect(tool).toMatchObject({
      source: 'native',
      riskLevel: 'medium',
      permission: 'local_storage',
      requiresConfirmation: true,
      confirmationPolicy: 'confirm',
    })
  })
})

function createBridge(
  openUrl: MorunNativeBridge['openUrl'] = async () => true,
  importMedia: MorunNativeBridge['importMedia'] = async () => ({
    mediaId: 'media_default',
    kind: 'image',
    originalSource: 'https://example.com/default.jpg',
    localPath: '/data/user/0/com.morun.app/files/morun-media/media_default.jpg',
    mimeType: 'image/jpeg',
    fileName: 'media_default.jpg',
    size: 1,
    createdAt: 1,
  }),
): MorunNativeBridge {
  return {
    isAvailable: async () => true,
    platformInfo: async () => ({ platform: 'android', version: 'test' }),
    secureGet: async () => null,
    secureSet: async () => true,
    secureDelete: async () => true,
    openUrl,
    importMedia,
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
    openTermuxInstallPage: async () => true,
    openTermuxApiInstallPage: async () => true,
    openTermuxApp: async () => true,
    runTermuxCommand: async ({ requestId }) => ({
      requestId,
      available: false,
      stdout: '',
      stderr: 'test',
      exitCode: null,
      timedOut: false,
    }),
    startChatCompletion: async ({ requestId }) => ({ requestId }),
    cancelChatCompletion: async () => true,
    addListener: async () => ({
      remove: async () => {},
    }),
  }
}
