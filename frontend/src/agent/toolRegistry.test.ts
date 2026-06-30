import { describe, expect, it } from 'vitest'
import { createToolRegistry } from './toolRegistry'
import type { MorunNativeBridge } from '../native/morunNative'

describe('tool registry', () => {
  it('registers Tavily as a network tool', () => {
    const registry = createToolRegistry({
      nativeBridge: createBridge(),
      searchTools: {
        resolveApiKey: async () => 'test-key',
      },
    })

    expect(registry.getTitle('tavily_search')).toBe('联网检索')
    expect(registry.getTool('tavily_search')).toMatchObject({
      name: 'tavily_search',
      source: 'network',
      riskLevel: 'low',
      permission: 'network',
      enabled: true,
      confirmationPolicy: 'auto',
    })
  })

  it('keeps denied Tavily in the catalog but filters it from model tools', () => {
    const registry = createToolRegistry(
      {
        nativeBridge: createBridge(),
        searchTools: {
          resolveApiKey: async () => 'test-key',
        },
      },
      {
        tools: {
          tavily_search: { confirmationPolicy: 'deny' },
        },
      },
    )

    expect(registry.catalogTools.some((tool) => tool.name === 'tavily_search')).toBe(true)
    expect(registry.tools.some((tool) => tool.name === 'tavily_search')).toBe(false)
  })
})

function createBridge(): MorunNativeBridge {
  return {
    isAvailable: async () => false,
    platformInfo: async () => null,
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
    importMedia: async () => ({
      mediaId: 'media_test',
      kind: 'image',
      originalSource: 'https://example.com/photo.jpg',
      localPath: '/data/user/0/com.morun.app/files/morun-media/media_test.jpg',
      mimeType: 'image/jpeg',
      fileName: 'media_test.jpg',
      size: 1,
      createdAt: 1,
    }),
    startChatCompletion: async () => ({ requestId: '' }),
    cancelChatCompletion: async () => false,
    addListener: async () => ({ remove: async () => {} }),
  }
}
