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

export interface MorunNativePlugin {
  isAvailable(): Promise<NativeAvailability>
  secureGet(options: { key: string }): Promise<{ value: string | null }>
  secureSet(options: { key: string; value: string }): Promise<{ ok: true }>
  secureDelete(options: { key: string }): Promise<{ ok: true }>
  openUrl(options: { url: string }): Promise<{ ok: true }>
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

export const morunNativeBridge = createMorunNativeBridge()
