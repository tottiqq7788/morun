export const unsupportedChatModelMessage = '当前模型不支持聊天接口，请切换模型'
export const unsupportedMaxTokensMessage = '当前模型不支持旧的 max_tokens 参数，请刷新后重试'
export const unsupportedTemperatureMessage = '当前模型不支持自定义温度参数，请切换模型或使用默认温度'

export function getFriendlyRequestErrorMessage(message: string) {
  const providerMessage = extractProviderErrorMessage(message) ?? message

  if (isUnsupportedChatModelError(providerMessage)) {
    return unsupportedChatModelMessage
  }

  if (isUnsupportedMaxTokensError(providerMessage)) {
    return unsupportedMaxTokensMessage
  }

  if (isUnsupportedTemperatureError(providerMessage)) {
    return unsupportedTemperatureMessage
  }

  return null
}

export function extractProviderErrorMessage(message: string) {
  const parsed = safeParseJson(message)
  if (!parsed || typeof parsed !== 'object') return null

  const record = parsed as Record<string, unknown>
  const error = record.error
  if (error && typeof error === 'object') {
    const errorMessage = (error as Record<string, unknown>).message
    if (typeof errorMessage === 'string' && errorMessage.trim()) {
      return errorMessage.trim()
    }
  }

  if (typeof record.message === 'string' && record.message.trim()) {
    return record.message.trim()
  }

  return null
}

export function isUnsupportedChatModelError(message: string) {
  const normalized = message.toLowerCase()

  return (
    normalized.includes('not a chat model') ||
    (normalized.includes('/chat/completions') &&
      normalized.includes('/completions') &&
      normalized.includes('not supported'))
  )
}

export function isUnsupportedMaxTokensError(message: string) {
  const normalized = message.toLowerCase()

  return (
    normalized.includes('max_tokens') &&
    normalized.includes('max_completion_tokens') &&
    /unsupported|not support|not supported|invalid/.test(normalized)
  )
}

export function isUnsupportedTemperatureError(message: string) {
  const normalized = message.toLowerCase()

  return (
    normalized.includes('temperature') &&
    /unsupported|not support|not supported|only the default|invalid/.test(normalized)
  )
}

function safeParseJson(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}
