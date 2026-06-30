import { describe, expect, it } from 'vitest'
import {
  extractProviderErrorMessage,
  getFriendlyRequestErrorMessage,
  isUnsupportedChatModelError,
  unsupportedChatModelMessage,
  unsupportedMaxTokensMessage,
} from './requestErrors'

describe('request error helpers', () => {
  it('detects non-chat model errors from OpenAI-compatible providers', () => {
    const message = JSON.stringify({
      error: {
        message:
          'This is not a chat model and thus not supported in the v1/chat/completions endpoint. Did you mean to use v1/completions?',
        type: 'invalid_request_error',
      },
    })

    expect(isUnsupportedChatModelError(message)).toBe(true)
    expect(getFriendlyRequestErrorMessage(message)).toBe(unsupportedChatModelMessage)
    expect(unsupportedChatModelMessage).toBe('当前模型不支持聊天接口，请切换模型')
  })

  it('detects unsupported max_tokens errors and maps them to a friendly message', () => {
    const message = JSON.stringify({
      error: {
        message:
          "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
        type: 'invalid_request_error',
        param: 'max_tokens',
      },
    })

    expect(extractProviderErrorMessage(message)).toBe(
      "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
    )
    expect(getFriendlyRequestErrorMessage(message)).toBe(unsupportedMaxTokensMessage)
  })

  it('extracts provider error messages from JSON payloads', () => {
    expect(extractProviderErrorMessage('{"error":{"message":"Rate limit exceeded"}}')).toBe('Rate limit exceeded')
    expect(extractProviderErrorMessage('{"message":"Bad gateway"}')).toBe('Bad gateway')
    expect(extractProviderErrorMessage('plain text')).toBeNull()
  })

  it('does not treat unrelated HTTP errors as model type errors', () => {
    expect(isUnsupportedChatModelError('HTTP 401 unauthorized')).toBe(false)
    expect(isUnsupportedChatModelError('模型请求超时')).toBe(false)
    expect(getFriendlyRequestErrorMessage('HTTP 401 unauthorized')).toBeNull()
  })
})
