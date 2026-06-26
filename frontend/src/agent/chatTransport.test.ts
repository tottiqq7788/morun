import { describe, expect, it, vi } from 'vitest'
import { createChatCompletionClient } from './chatTransport'
import type { ChatCompletionRequest } from './types'
import type {
  MorunNativeBridge,
  NativeChatCompletionDeltaEvent,
  NativeChatCompletionDoneEvent,
  NativeChatCompletionErrorEvent,
} from '../native/morunNative'

const baseRequest: ChatCompletionRequest = {
  modelConfig: {
    baseUrl: 'https://example.test/v1',
    apiKey: 'test-key',
    model: 'test-model',
    temperature: 0.7,
    maxTokens: 1024,
    stream: true,
  },
  messages: [{ role: 'user', content: 'hello' }],
  tools: [],
  useTools: false,
}

describe('chat transport selection', () => {
  it('uses browser fetch transport when native bridge is unavailable', async () => {
    const browserClient = vi.fn(async () => ({
      content: 'browser',
      toolCalls: [],
    }))
    const client = createChatCompletionClient({
      nativeBridge: createBridge({ available: false }),
      browserClient,
    })

    await expect(client(baseRequest)).resolves.toMatchObject({ content: 'browser' })
    expect(browserClient).toHaveBeenCalledOnce()
  })

  it('uses native transport on Android when streaming is enabled', async () => {
    const bridge = createBridge({
      available: true,
      startChatCompletion: async ({ requestId }) => {
        queueMicrotask(() => {
          bridge.emitDelta({
            requestId,
            data: JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] }),
          })
          bridge.emitDelta({
            requestId,
            data: JSON.stringify({ choices: [{ delta: { content: 'lo' } }] }),
          })
          bridge.emitDelta({ requestId, data: '[DONE]' })
          bridge.emitDone({ requestId })
        })
        return { requestId }
      },
    })
    const browserClient = vi.fn()
    const deltas: string[] = []
    const client = createChatCompletionClient({
      nativeBridge: bridge,
      browserClient,
    })

    const result = await client({
      ...baseRequest,
      onContentDelta: (delta) => deltas.push(delta.accumulatedContent),
    })

    expect(result).toEqual({ content: 'Hello', toolCalls: [] })
    expect(deltas).toEqual(['Hel', 'Hello'])
    expect(browserClient).not.toHaveBeenCalled()
  })

  it('aggregates native streamed tool calls with the shared SSE parser', async () => {
    const bridge = createBridge({
      available: true,
      startChatCompletion: async ({ requestId }) => {
        queueMicrotask(() => {
          bridge.emitDelta({
            requestId,
            data: JSON.stringify({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_1',
                        function: {
                          name: 'echo',
                          arguments: '{"text"',
                        },
                      },
                    ],
                  },
                },
              ],
            }),
          })
          bridge.emitDelta({
            requestId,
            data: JSON.stringify({
              choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':"hi"}' } }] } }],
            }),
          })
          bridge.emitDelta({ requestId, data: '[DONE]' })
          bridge.emitDone({ requestId })
        })
        return { requestId }
      },
    })
    const client = createChatCompletionClient({ nativeBridge: bridge })

    const result = await client(baseRequest)

    expect(result.toolCalls).toEqual([
      {
        id: 'call_1',
        name: 'echo',
        rawArguments: '{"text":"hi"}',
        arguments: { text: 'hi' },
      },
    ])
  })

  it('cancels native requests when the run is aborted', async () => {
    const controller = new AbortController()
    const cancelChatCompletion = vi.fn(async () => true)
    let markStarted: () => void = () => {}
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const bridge = createBridge({
      available: true,
      startChatCompletion: async ({ requestId }) => {
        markStarted()
        return { requestId }
      },
      cancelChatCompletion,
    })
    const client = createChatCompletionClient({ nativeBridge: bridge })

    const promise = client({
      ...baseRequest,
      signal: controller.signal,
    })
    await started
    controller.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancelChatCompletion).toHaveBeenCalled()
  })

  it('cancels native requests when abort fires while start is in flight', async () => {
    const controller = new AbortController()
    const cancelChatCompletion = vi.fn(async () => true)
    let markStarted: () => void = () => {}
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    let resolveStart: () => void = () => {}
    const startGate = new Promise<void>((resolve) => {
      resolveStart = resolve
    })
    const bridge = createBridge({
      available: true,
      startChatCompletion: async ({ requestId }) => {
        markStarted()
        await startGate
        return { requestId }
      },
      cancelChatCompletion,
    })
    const client = createChatCompletionClient({ nativeBridge: bridge })

    const promise = client({
      ...baseRequest,
      signal: controller.signal,
    })
    await started
    controller.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancelChatCompletion).toHaveBeenCalledOnce()
    resolveStart()
    await Promise.resolve()
    await Promise.resolve()
    expect(cancelChatCompletion).toHaveBeenCalledTimes(2)
  })
})

function createBridge({
  available,
  startChatCompletion,
  cancelChatCompletion,
}: {
  available: boolean
  startChatCompletion?: MorunNativeBridge['startChatCompletion']
  cancelChatCompletion?: MorunNativeBridge['cancelChatCompletion']
}) {
  const deltaListeners: Array<(event: NativeChatCompletionDeltaEvent) => void> = []
  const errorListeners: Array<(event: NativeChatCompletionErrorEvent) => void> = []
  const doneListeners: Array<(event: NativeChatCompletionDoneEvent) => void> = []

  const bridge: MorunNativeBridge & {
    emitDelta(event: NativeChatCompletionDeltaEvent): void
    emitError(event: NativeChatCompletionErrorEvent): void
    emitDone(event: NativeChatCompletionDoneEvent): void
  } = {
    isAvailable: async () => available,
    platformInfo: async () => (available ? { platform: 'android', version: 'test' } : null),
    secureGet: async () => null,
    secureSet: async () => available,
    secureDelete: async () => available,
    openUrl: async () => available,
    startChatCompletion: startChatCompletion ?? (async ({ requestId }) => ({ requestId })),
    cancelChatCompletion: cancelChatCompletion ?? (async () => available),
    addListener: async (eventName, listener) => {
      if (eventName === 'chatCompletionDelta') {
        deltaListeners.push(listener as (event: NativeChatCompletionDeltaEvent) => void)
      }
      if (eventName === 'chatCompletionError') {
        errorListeners.push(listener as (event: NativeChatCompletionErrorEvent) => void)
      }
      if (eventName === 'chatCompletionDone') {
        doneListeners.push(listener as (event: NativeChatCompletionDoneEvent) => void)
      }
      return {
        remove: async () => {},
      }
    },
    emitDelta(event) {
      deltaListeners.forEach((listener) => listener(event))
    },
    emitError(event) {
      errorListeners.forEach((listener) => listener(event))
    },
    emitDone(event) {
      doneListeners.forEach((listener) => listener(event))
    },
  }

  return bridge
}
