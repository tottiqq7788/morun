import type { MorunNativeBridge } from '../native/morunNative'
import type { StorageLike } from '../agent/types'

export const tavilyConfigKey = 'morun.tavily-config.v1'
export const tavilyApiKeyRef = 'tool:tavily:apiKey'

export interface TavilyConfig {
  apiKey: string
  apiKeyRef?: string
  updatedAt: number
}

export function createDefaultTavilyConfig(): TavilyConfig {
  return {
    apiKey: '',
    updatedAt: Date.now(),
  }
}

export function loadTavilyConfig(storage: StorageLike = localStorage): TavilyConfig {
  const stored = safeParse<unknown>(storage.getItem(tavilyConfigKey))
  const record = asRecord(stored)
  if (!record) return createDefaultTavilyConfig()

  return {
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : '',
    apiKeyRef: typeof record.apiKeyRef === 'string' && record.apiKeyRef ? record.apiKeyRef : undefined,
    updatedAt: typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? record.updatedAt : Date.now(),
  }
}

export function saveTavilyConfig(config: TavilyConfig, storage: StorageLike = localStorage) {
  storage.setItem(tavilyConfigKey, JSON.stringify(config))
}

export function hasConfiguredTavilyApiKey(config: Pick<TavilyConfig, 'apiKey' | 'apiKeyRef'>) {
  return Boolean(config.apiKey.trim() || config.apiKeyRef)
}

export async function migrateTavilyConfigSecret(config: TavilyConfig, nativeBridge: MorunNativeBridge) {
  if (!(await nativeBridge.isAvailable())) return false

  const apiKey = config.apiKey.trim()
  if (!apiKey) return false

  const stored = await nativeBridge.secureSet(tavilyApiKeyRef, apiKey)
  if (!stored) return false

  config.apiKey = ''
  config.apiKeyRef = tavilyApiKeyRef
  config.updatedAt = Date.now()
  return true
}

export async function resolveTavilyApiKey(config: TavilyConfig, nativeBridge: MorunNativeBridge) {
  if (config.apiKeyRef) {
    const value = await nativeBridge.secureGet(config.apiKeyRef)
    if (value) return value
  }

  return config.apiKey
}

export async function withStoredTavilyApiKey(
  config: TavilyConfig,
  apiKey: string,
  nativeBridge: MorunNativeBridge,
): Promise<TavilyConfig> {
  const trimmedKey = apiKey.trim()
  const next = {
    ...config,
    updatedAt: Date.now(),
  }

  if (!trimmedKey) {
    return {
      ...next,
      apiKey: '',
      apiKeyRef: undefined,
    }
  }

  if (await nativeBridge.isAvailable()) {
    const stored = await nativeBridge.secureSet(tavilyApiKeyRef, trimmedKey)
    if (!stored) {
      throw new Error('无法安全保存 Tavily API Key。')
    }

    return {
      ...next,
      apiKey: '',
      apiKeyRef: tavilyApiKeyRef,
    }
  }

  return {
    ...next,
    apiKey: trimmedKey,
    apiKeyRef: undefined,
  }
}

export async function clearStoredTavilyApiKey(
  config: TavilyConfig,
  nativeBridge: MorunNativeBridge,
): Promise<TavilyConfig> {
  if (config.apiKeyRef && (await nativeBridge.isAvailable())) {
    await nativeBridge.secureDelete(config.apiKeyRef)
  }

  return {
    ...config,
    apiKey: '',
    apiKeyRef: undefined,
    updatedAt: Date.now(),
  }
}

function safeParse<T>(value: string | null): T | null {
  if (!value) return null

  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}
