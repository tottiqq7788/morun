import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestChatCompletion } from './openaiCompatible'
import type { ChatCompletionRequest } from './types'

const baseRequest: ChatCompletionRequest = {
  modelConfig: {
    baseUrl: 'https://example.test/v1',
    apiKey: 'test',
    model: 'test-model',
    temperature: 0.7,
    maxTokens: 1024,
    stream: true,
  },
  messages: [{ role: 'user', content: 'hello' }],
  tools: [],
  useTools: false,
}

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('requestChatCompletion streaming', () => {
  it('aggregates text deltas until DONE', async () => {
    const deltas: string[] = []
    mockFetchWithSse([
      { choices: [{ delta: { content: 'Hel' } }] },
      { choices: [{ delta: { content: 'lo' } }] },
      '[DONE]',
    ])

    const result = await requestChatCompletion({
      ...baseRequest,
      onContentDelta: (delta) => deltas.push(delta.accumulatedContent),
    })

    expect(result.content).toBe('Hello')
    expect(result.toolCalls).toEqual([])
    expect(deltas).toEqual(['Hel', 'Hello'])
  })

  it('aggregates streamed tool call argument chunks', async () => {
    mockFetchWithSse([
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'echo',
                    arguments: '{"text"',
                  },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: {
                    arguments: ':"hi"}',
                  },
                },
              ],
            },
          },
        ],
      },
      '[DONE]',
    ])

    const result = await requestChatCompletion({
      ...baseRequest,
      tools: [
        {
          name: 'echo',
          description: 'Echo.',
          source: 'builtin',
          riskLevel: 'safe',
          requiresConfirmation: false,
          parameters: {
            type: 'object',
            additionalProperties: false,
          },
          execute: async () => ({ text: '' }),
        },
      ],
      useTools: true,
    })

    expect(result.content).toBe('')
    expect(result.toolCalls).toEqual([
      {
        id: 'call_1',
        name: 'echo',
        rawArguments: '{"text":"hi"}',
        arguments: { text: 'hi' },
      },
    ])
  })

  it('propagates abort errors', async () => {
    const controller = new AbortController()
    controller.abort()
    globalThis.fetch = vi.fn(async () => {
      throw new DOMException('Aborted', 'AbortError')
    }) as typeof fetch

    await expect(
      requestChatCompletion({
        ...baseRequest,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

function mockFetchWithSse(events: Array<unknown | '[DONE]'>) {
  const body = events
    .map((event) => {
      const data = event === '[DONE]' ? '[DONE]' : JSON.stringify(event)
      return `data: ${data}\n\n`
    })
    .join('')

  globalThis.fetch = vi.fn(async () => new Response(body, { status: 200 })) as typeof fetch
}
