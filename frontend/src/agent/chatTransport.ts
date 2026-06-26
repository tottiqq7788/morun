import {
  buildChatCompletionRequestBody,
  createStreamingChatCompletionAccumulator,
  requestChatCompletion,
} from './openaiCompatible'
import type { ChatCompletionClient, ChatCompletionRequest } from './types'
import { morunNativeBridge, type MorunNativeBridge } from '../native/morunNative'

export interface ChatTransportOptions {
  nativeBridge?: MorunNativeBridge
  browserClient?: ChatCompletionClient
}

export function createChatCompletionClient({
  nativeBridge = morunNativeBridge,
  browserClient = requestChatCompletion,
}: ChatTransportOptions = {}): ChatCompletionClient {
  return async (request) => {
    if (request.modelConfig.stream && (await nativeBridge.isAvailable())) {
      return requestNativeChatCompletion(request, nativeBridge)
    }

    return browserClient(request)
  }
}

export async function requestNativeChatCompletion(
  request: ChatCompletionRequest,
  nativeBridge: MorunNativeBridge,
) {
  const requestId = createRequestId()
  const accumulator = createStreamingChatCompletionAccumulator(request.onContentDelta)
  let settled = false
  let startCompleted = false
  let abortBeforeStartCompleted = false
  let resolveOnce: (value: ReturnType<typeof accumulator.result>) => void = () => {}
  let rejectOnce: (error: unknown) => void = () => {}

  const listeners = await Promise.all([
    nativeBridge.addListener('chatCompletionDelta', (event) => {
      if (event.requestId !== requestId) return
      if (event.data === '[DONE]') {
        accumulator.markDone()
        return
      }
      accumulator.applyData(event.data)
    }),
    nativeBridge.addListener('chatCompletionError', (event) => {
      if (event.requestId !== requestId) return
      rejectOnce(new Error(event.status ? `${event.message} (HTTP ${event.status})` : event.message))
    }),
    nativeBridge.addListener('chatCompletionDone', (event) => {
      if (event.requestId !== requestId) return
      if (!accumulator.sawSseData()) {
        rejectOnce(new Error('流式响应格式无效。'))
        return
      }
      resolveOnce(accumulator.result())
    }),
  ])

  const cleanup = async () => {
    request.signal?.removeEventListener('abort', onAbort)
    await Promise.all(listeners.map((listener) => listener.remove()))
  }

  const onAbort = () => {
    abortBeforeStartCompleted = !startCompleted
    nativeBridge
      .cancelChatCompletion(requestId)
      .catch(() => false)
      .finally(() => {
        rejectOnce(createAbortError())
      })
  }

  const promise = new Promise<ReturnType<typeof accumulator.result>>((resolve, reject) => {
    resolveOnce = (value) => {
      if (settled) return
      settled = true
      cleanup()
        .catch(() => {})
        .finally(() => resolve(value))
    }
    rejectOnce = (error) => {
      if (settled) return
      settled = true
      cleanup()
        .catch(() => {})
        .finally(() => reject(error))
    }
  })

  if (request.signal?.aborted) {
    rejectOnce(createAbortError())
    return promise
  }

  request.signal?.addEventListener('abort', onAbort, { once: true })

  nativeBridge
    .startChatCompletion({
      requestId,
      url: `${trimTrailingSlash(request.modelConfig.baseUrl)}/chat/completions`,
      headers: {
        'Content-Type': 'application/json',
        ...(request.modelConfig.apiKey.trim() ? { Authorization: `Bearer ${request.modelConfig.apiKey.trim()}` } : {}),
      },
      body: JSON.stringify(buildChatCompletionRequestBody(request)),
    })
    .then(async () => {
      startCompleted = true
      if (!request.signal?.aborted || !abortBeforeStartCompleted) return
      await nativeBridge.cancelChatCompletion(requestId).catch(() => false)
      rejectOnce(createAbortError())
    })
    .catch((error) => {
      rejectOnce(error)
    })

  return promise
}

function trimTrailingSlash(value: string) {
  return value.trim().replace(/\/+$/, '')
}

function createRequestId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `native_${crypto.randomUUID()}`
    : `native_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function createAbortError() {
  return new DOMException('Aborted', 'AbortError')
}
