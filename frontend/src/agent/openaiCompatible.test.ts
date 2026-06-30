import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildChatCompletionRequestBody,
  chatCompletionTokenLimitField,
  requestChatCompletion,
  supportsCustomSamplingParameters,
} from './openaiCompatible'
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
          permission: 'none',
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

  it('aggregates a trailing streamed tool call without a final newline', async () => {
    mockFetchWithRawSse(
      `data: ${JSON.stringify({
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
                    arguments: '{"text":"hi"}',
                  },
                },
              ],
            },
          },
        ],
      })}`,
    )

    const result = await requestChatCompletion({
      ...baseRequest,
      tools: [
        {
          name: 'echo',
          description: 'Echo.',
          source: 'builtin',
          riskLevel: 'safe',
          permission: 'none',
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

describe('chat completion request body', () => {
  it('uses max_completion_tokens and default sampling for GPT-5 style models', () => {
    const body = buildChatCompletionRequestBody({
      ...baseRequest,
      modelConfig: {
        ...baseRequest.modelConfig,
        model: 'gpt-5',
      },
    })

    expect(body).toMatchObject({
      model: 'gpt-5',
      max_completion_tokens: 1024,
    })
    expect(body).not.toHaveProperty('max_tokens')
    expect(body).not.toHaveProperty('temperature')
    expect(chatCompletionTokenLimitField('openai/gpt-5-mini')).toBe('max_completion_tokens')
    expect(supportsCustomSamplingParameters('o3-mini')).toBe(false)
  })

  it('keeps max_tokens and temperature for regular chat models', () => {
    const body = buildChatCompletionRequestBody({
      ...baseRequest,
      modelConfig: {
        ...baseRequest.modelConfig,
        model: 'gpt-4o-mini',
      },
    })

    expect(body).toMatchObject({
      model: 'gpt-4o-mini',
      max_tokens: 1024,
      temperature: 0.7,
    })
    expect(body).not.toHaveProperty('max_completion_tokens')
    expect(supportsCustomSamplingParameters('deepseek-chat')).toBe(true)
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

function mockFetchWithRawSse(body: string) {
  globalThis.fetch = vi.fn(async () => new Response(body, { status: 200 })) as typeof fetch
}
