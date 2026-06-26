import { describe, expect, it, vi } from 'vitest'
import { createTermuxTools, termuxCommandForTool } from './termuxTools'
import type { MorunNativeBridge } from '../native/morunNative'

describe('termux tool catalog', () => {
  it('maps device status actions to fixed commands', () => {
    expect(termuxCommandForTool('termux_device_status', { action: 'battery_status' })).toMatchObject({
      command: 'termux-battery-status',
    })
    expect(termuxCommandForTool('termux_device_status', { action: 'camera_info' })).toMatchObject({
      command: 'termux-camera-info',
    })
  })

  it('rejects unknown actions instead of constructing shell strings', () => {
    expect(() => termuxCommandForTool('termux_notify', { action: 'shell', text: 'id' })).toThrow('action 必须是')
  })

  it('clamps bounded numeric parameters', () => {
    expect(termuxCommandForTool('termux_notify', { action: 'vibrate', durationMs: 9000 })).toMatchObject({
      command: 'termux-vibrate',
      args: ['-d', '5000'],
    })
    expect(termuxCommandForTool('termux_messages', { action: 'sms_list', limit: 500 })).toMatchObject({
      command: 'termux-sms-list',
      args: ['-l', '50'],
    })
  })

  it('marks high-risk phone data tools as confirm-only and disables contacts/messages by default', () => {
    const tools = createTermuxTools(createBridge())
    expect(tools.find((tool) => tool.name === 'termux_location')).toMatchObject({
      source: 'termux',
      riskLevel: 'high',
      permission: 'location',
      requiresConfirmation: true,
      confirmationPolicy: 'confirm',
    })
    expect(tools.find((tool) => tool.name === 'termux_contacts')).toMatchObject({
      enabled: false,
      riskLevel: 'high',
      permission: 'contacts',
      requiresConfirmation: true,
      confirmationPolicy: 'confirm',
    })
    expect(tools.find((tool) => tool.name === 'termux_messages')).toMatchObject({
      enabled: false,
      riskLevel: 'high',
      permission: 'sms',
      requiresConfirmation: true,
      confirmationPolicy: 'confirm',
    })
  })

  it('executes through the native bridge with a whitelist command result summary', async () => {
    const runTermuxCommand = vi.fn(async ({ requestId }) => ({
      requestId,
      available: true,
      stdout: '{"percentage":90}',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    }))
    const tool = createTermuxTools(createBridge({ runTermuxCommand })).find((item) => item.name === 'termux_device_status')

    const result = await tool?.execute({ action: 'battery_status' }, {})

    expect(runTermuxCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'termux-battery-status',
        timeoutMs: 15000,
      }),
    )
    expect(result?.text).toContain('命令：termux-battery-status')
    expect(result?.text).toContain('退出码：0')
    expect(result?.data).toMatchObject({
      command: 'termux-battery-status',
      exitCode: 0,
      stdout: '{"percentage":90}',
    })
  })
})

function createBridge(overrides: Partial<MorunNativeBridge> = {}): MorunNativeBridge {
  return {
    isAvailable: async () => true,
    platformInfo: async () => ({ platform: 'android', version: 'test' }),
    secureGet: async () => null,
    secureSet: async () => true,
    secureDelete: async () => true,
    openUrl: async () => true,
    termuxStatus: async () => ({
      available: true,
      termuxInstalled: true,
      termuxApiInstalled: true,
      runCommandPermissionGranted: true,
      canRunCommands: true,
      message: 'ready',
    }),
    requestTermuxRunCommandPermission: async () => ({
      available: true,
      termuxInstalled: true,
      termuxApiInstalled: true,
      runCommandPermissionGranted: true,
      canRunCommands: true,
      message: 'ready',
    }),
    openTermuxInstallPage: async () => true,
    openTermuxApiInstallPage: async () => true,
    openTermuxApp: async () => true,
    runTermuxCommand: async ({ requestId }) => ({
      requestId,
      available: true,
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    }),
    startChatCompletion: async ({ requestId }) => ({ requestId }),
    cancelChatCompletion: async () => true,
    addListener: async () => ({
      remove: async () => {},
    }),
    ...overrides,
  }
}
