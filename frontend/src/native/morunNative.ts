import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export interface NativeAvailability {
  platform: 'android'
  version: string
}

export interface NativeChatCompletionRequest {
  requestId: string
  url: string
  headers: Record<string, string>
  body: string
}

export interface NativeChatCompletionDeltaEvent {
  requestId: string
  data: string
}

export interface NativeChatCompletionErrorEvent {
  requestId: string
  message: string
  status?: number
}

export interface NativeChatCompletionDoneEvent {
  requestId: string
}

export interface TermuxStatus {
  available: boolean
  termuxInstalled: boolean
  termuxApiInstalled: boolean
  runCommandPermissionGranted: boolean
  canRunCommands: boolean
  message: string
}

export interface TermuxCommandRequest {
  requestId: string
  command: string
  args?: string[]
  stdin?: string
  workdir?: string
  timeoutMs?: number
}

export interface TermuxCommandResult {
  requestId: string
  available: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
  errCode?: number
  errmsg?: string
}

export interface ImportMediaRequest {
  source: string
  kind: 'image'
}

export interface ImportMediaResult {
  mediaId: string
  kind: 'image'
  originalSource: string
  localPath: string
  mimeType: string
  fileName: string
  size: number
  createdAt: number
}

export interface NativeDebugLogFileInfo {
  name: string
  size: number
  lastModified: number
}

export interface NativeDebugLogInfo {
  enabled: boolean
  directory: string
  totalBytes: number
  latestModifiedAt?: number
  files: NativeDebugLogFileInfo[]
}

export interface MorunNativePlugin {
  isAvailable(): Promise<NativeAvailability>
  secureGet(options: { key: string }): Promise<{ value: string | null }>
  secureSet(options: { key: string; value: string }): Promise<{ ok: true }>
  secureDelete(options: { key: string }): Promise<{ ok: true }>
  openUrl(options: { url: string }): Promise<{ ok: true }>
  termuxStatus(): Promise<TermuxStatus>
  requestTermuxRunCommandPermission(): Promise<TermuxStatus>
  openTermuxInstallPage(): Promise<{ ok: true }>
  openTermuxApiInstallPage(): Promise<{ ok: true }>
  openTermuxApp(): Promise<{ ok: true }>
  runTermuxCommand(options: TermuxCommandRequest): Promise<TermuxCommandResult>
  importMedia(options: ImportMediaRequest): Promise<ImportMediaResult>
  appendDebugLog(options: { entry: string }): Promise<{ ok: true }>
  getDebugLogInfo(): Promise<NativeDebugLogInfo>
  readDebugLogs(options?: { maxBytes?: number }): Promise<{ content: string }>
  clearDebugLogs(): Promise<{ ok: true }>
  startChatCompletion(options: NativeChatCompletionRequest): Promise<{ requestId: string }>
  cancelChatCompletion(options: { requestId: string }): Promise<{ ok: true }>
  addListener(
    eventName: 'chatCompletionDelta',
    listenerFunc: (event: NativeChatCompletionDeltaEvent) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'chatCompletionError',
    listenerFunc: (event: NativeChatCompletionErrorEvent) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'chatCompletionDone',
    listenerFunc: (event: NativeChatCompletionDoneEvent) => void,
  ): Promise<PluginListenerHandle>
}

export interface MorunNativeBridge {
  isAvailable(): Promise<boolean>
  platformInfo(): Promise<NativeAvailability | null>
  secureGet(key: string): Promise<string | null>
  secureSet(key: string, value: string): Promise<boolean>
  secureDelete(key: string): Promise<boolean>
  openUrl(url: string): Promise<boolean>
  termuxStatus(): Promise<TermuxStatus>
  requestTermuxRunCommandPermission(): Promise<TermuxStatus>
  openTermuxInstallPage(): Promise<boolean>
  openTermuxApiInstallPage(): Promise<boolean>
  openTermuxApp(): Promise<boolean>
  runTermuxCommand(options: TermuxCommandRequest): Promise<TermuxCommandResult>
  importMedia(options: ImportMediaRequest): Promise<ImportMediaResult>
  appendDebugLog?(entry: string): Promise<boolean>
  getDebugLogInfo?(): Promise<NativeDebugLogInfo | null>
  readDebugLogs?(maxBytes?: number): Promise<string>
  clearDebugLogs?(): Promise<boolean>
  startChatCompletion(options: NativeChatCompletionRequest): Promise<{ requestId: string }>
  cancelChatCompletion(requestId: string): Promise<boolean>
  addListener: MorunNativePlugin['addListener']
}

export const MorunNative = registerPlugin<MorunNativePlugin>('MorunNative')

export const noopListenerHandle: PluginListenerHandle = {
  remove: async () => {},
}

export function createMorunNativeBridge(
  plugin: MorunNativePlugin = MorunNative,
  getPlatform: () => string = () => Capacitor.getPlatform(),
): MorunNativeBridge {
  const nativePlatformAvailable = () => getPlatform() === 'android'

  const platformInfo = async () => {
    if (!nativePlatformAvailable()) return null

    try {
      return await plugin.isAvailable()
    } catch {
      return null
    }
  }

  return {
    async isAvailable() {
      return Boolean(await platformInfo())
    },
    platformInfo,
    async secureGet(key) {
      if (!(await platformInfo())) return null

      try {
        const result = await plugin.secureGet({ key })
        return result.value
      } catch {
        return null
      }
    },
    async secureSet(key, value) {
      if (!(await platformInfo())) return false

      try {
        await plugin.secureSet({ key, value })
        return true
      } catch {
        return false
      }
    },
    async secureDelete(key) {
      if (!(await platformInfo())) return false

      try {
        await plugin.secureDelete({ key })
        return true
      } catch {
        return false
      }
    },
    async openUrl(url) {
      if (!(await platformInfo())) return false

      try {
        await plugin.openUrl({ url })
        return true
      } catch {
        return false
      }
    },
    async termuxStatus() {
      if (!(await platformInfo())) return unavailableTermuxStatus()

      try {
        return await plugin.termuxStatus()
      } catch {
        return unavailableTermuxStatus('无法读取 Termux 状态。')
      }
    },
    async requestTermuxRunCommandPermission() {
      if (!(await platformInfo())) return unavailableTermuxStatus()

      try {
        return await plugin.requestTermuxRunCommandPermission()
      } catch {
        try {
          return await plugin.termuxStatus()
        } catch {
          return unavailableTermuxStatus('无法请求 RUN_COMMAND 权限。')
        }
      }
    },
    async openTermuxInstallPage() {
      if (!(await platformInfo())) return false

      try {
        await plugin.openTermuxInstallPage()
        return true
      } catch {
        return false
      }
    },
    async openTermuxApiInstallPage() {
      if (!(await platformInfo())) return false

      try {
        await plugin.openTermuxApiInstallPage()
        return true
      } catch {
        return false
      }
    },
    async openTermuxApp() {
      if (!(await platformInfo())) return false

      try {
        await plugin.openTermuxApp()
        return true
      } catch {
        return false
      }
    },
    async runTermuxCommand(options) {
      if (!(await platformInfo())) return unavailableTermuxCommandResult(options.requestId)

      try {
        return await plugin.runTermuxCommand(options)
      } catch (error) {
        return unavailableTermuxCommandResult(options.requestId, error instanceof Error ? error.message : undefined)
      }
    },
    async importMedia(options) {
      if (!(await platformInfo())) {
        throw new Error('Native bridge unavailable.')
      }

      return plugin.importMedia(options)
    },
    async appendDebugLog(entry) {
      if (!(await platformInfo())) return false

      try {
        await plugin.appendDebugLog({ entry })
        return true
      } catch {
        return false
      }
    },
    async getDebugLogInfo() {
      if (!(await platformInfo())) return null

      try {
        return await plugin.getDebugLogInfo()
      } catch {
        return null
      }
    },
    async readDebugLogs(maxBytes) {
      if (!(await platformInfo())) return ''

      try {
        const result = await plugin.readDebugLogs(maxBytes ? { maxBytes } : {})
        return result.content
      } catch {
        return ''
      }
    },
    async clearDebugLogs() {
      if (!(await platformInfo())) return false

      try {
        await plugin.clearDebugLogs()
        return true
      } catch {
        return false
      }
    },
    async startChatCompletion(options) {
      if (!(await platformInfo())) {
        throw new Error('Native bridge unavailable.')
      }

      return plugin.startChatCompletion(options)
    },
    async cancelChatCompletion(requestId) {
      if (!(await platformInfo())) return false

      try {
        await plugin.cancelChatCompletion({ requestId })
        return true
      } catch {
        return false
      }
    },
    addListener: plugin.addListener.bind(plugin),
  }
}

function unavailableTermuxStatus(message = '仅 Android 支持 Termux 连接。'): TermuxStatus {
  return {
    available: false,
    termuxInstalled: false,
    termuxApiInstalled: false,
    runCommandPermissionGranted: false,
    canRunCommands: false,
    message,
  }
}

function unavailableTermuxCommandResult(requestId: string, message = '当前环境不支持 Termux。'): TermuxCommandResult {
  return {
    requestId,
    available: false,
    stdout: '',
    stderr: message,
    exitCode: null,
    timedOut: false,
  }
}

export const morunNativeBridge = createMorunNativeBridge()
