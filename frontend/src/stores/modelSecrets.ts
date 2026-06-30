import type { MorunNativeBridge } from '../native/morunNative'
import type { ModelAccount, ModelConfig } from './chat'

export function modelAccountApiKeyRef(accountId: string) {
  return `modelAccount:${accountId}:apiKey`
}

export async function migrateModelAccountSecrets(config: ModelConfig, nativeBridge: MorunNativeBridge) {
  if (!(await nativeBridge.isAvailable())) return false

  let changed = false
  for (const account of config.accounts) {
    const apiKey = account.apiKey.trim()
    if (!apiKey) continue

    const apiKeyRef = account.apiKeyRef || modelAccountApiKeyRef(account.id)
    const stored = await nativeBridge.secureSet(apiKeyRef, apiKey)
    if (!stored) continue

    account.apiKey = ''
    account.apiKeyRef = apiKeyRef
    account.updatedAt = Date.now()
    changed = true
  }

  return changed
}

export async function resolveModelAccountApiKey(account: ModelAccount, nativeBridge: MorunNativeBridge) {
  if (account.apiKeyRef) {
    const value = await nativeBridge.secureGet(account.apiKeyRef)
    if (value) return value
  }

  return account.apiKey
}

export async function clearStoredModelAccountApiKey(account: ModelAccount, nativeBridge: MorunNativeBridge) {
  if (!account.apiKeyRef) return true

  try {
    return await nativeBridge.secureDelete(account.apiKeyRef)
  } catch {
    return false
  }
}

export async function withStoredModelAccountApiKey(
  account: ModelAccount,
  apiKey: string,
  nativeBridge: MorunNativeBridge,
) {
  const trimmedKey = apiKey.trim()
  if (!trimmedKey) {
    return {
      ...account,
      apiKey: '',
      apiKeyRef: undefined,
    }
  }

  if (await nativeBridge.isAvailable()) {
    const apiKeyRef = modelAccountApiKeyRef(account.id)
    const stored = await nativeBridge.secureSet(apiKeyRef, trimmedKey)
    if (stored) {
      return {
        ...account,
        apiKey: '',
        apiKeyRef,
      }
    }

    throw new Error('无法安全保存接口密钥。')
  }

  return {
    ...account,
    apiKey: trimmedKey,
    apiKeyRef: undefined,
  }
}
