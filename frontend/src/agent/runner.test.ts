import { describe, expect, it } from 'vitest'
import { UnsupportedToolsError } from './openaiCompatible'
import { runAgentTurn } from './runner'
import type { AgentRunEvent, ChatCompletionClient, ToolDefinition } from './types'

const modelConfig = {
  baseUrl: 'https://example.test/v1',
  apiKey: 'test',
  model: 'test-model',
  temperature: 0.7,
  maxTokens: 1024,
  stream: false,
}

const echoTool: ToolDefinition = {
  name: 'echo',
  description: 'Echo text.',
  source: 'builtin',
  riskLevel: 'safe',
  permission: 'none',
  requiresConfirmation: false,
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
      },
    },
    required: ['text'],
    additionalProperties: false,
  },
  execute: async (args) => {
    const record = args as { text?: string }
    return {
      text: record.text ?? '',
      data: {
        echoed: record.text ?? '',
      },
    }
  },
}

const failingTool: ToolDefinition = {
  name: 'fail',
  description: 'Always fail.',
  source: 'builtin',
  riskLevel: 'low',
  permission: 'none',
  requiresConfirmation: false,
  parameters: {
    type: 'object',
    additionalProperties: false,
  },
  execute: async () => {
    throw new Error('boom')
  },
}

const guardedTool: ToolDefinition = {
  name: 'guarded',
  description: 'Requires confirmation.',
  source: 'builtin',
  riskLevel: 'medium',
  permission: 'none',
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    additionalProperties: false,
  },
  execute: async () => ({
    text: 'guarded done',
  }),
}

describe('runAgentTurn', () => {
  it('returns a normal assistant reply when no tool calls are present', async () => {
    const client: ChatCompletionClient = async () => ({
      content: 'hello',
      toolCalls: [],
    })

    const result = await runAgentTurn({
      messages: [{ role: 'user', content: 'hi' }],
      modelConfig,
      tools: [echoTool],
      client,
    })

    expect(result.content).toBe('hello')
    expect(result.usedTools).toBe(false)
    expect(result.messages.at(-1)).toMatchObject({ role: 'assistant', content: 'hello' })
  })

  it('rejects an empty assistant reply when no tool calls are present', async () => {
    const events: AgentRunEvent[] = []
    const client: ChatCompletionClient = async () => ({
      content: '',
      toolCalls: [],
    })

    await expect(
      runAgentTurn({
        messages: [{ role: 'user', content: 'hi' }],
        modelConfig,
        tools: [echoTool],
        client,
        onEvent: (event) => events.push(event),
      }),
    ).rejects.toThrow('模型没有返回内容。')

    expect(events.map((event) => event.type)).toEqual(['run_started'])
  })

  it('rejects a whitespace-only assistant reply when no tool calls are present', async () => {
    const client: ChatCompletionClient = async () => ({
      content: '   \n\t',
      toolCalls: [],
    })

    await expect(
      runAgentTurn({
        messages: [{ role: 'user', content: 'hi' }],
        modelConfig,
        tools: [echoTool],
        client,
      }),
    ).rejects.toThrow('模型没有返回内容。')
  })

  it('executes one tool call and continues to the final reply', async () => {
    const events: AgentRunEvent[] = []
    let calls = 0
    const client: ChatCompletionClient = async () => {
      calls += 1
      if (calls === 1) {
        return {
          content: '',
          toolCalls: [
            {
              id: 'call_1',
              name: 'echo',
              rawArguments: '{"text":"done"}',
              arguments: { text: 'done' },
            },
          ],
        }
      }
      return {
        content: 'final',
        toolCalls: [],
      }
    }

    const result = await runAgentTurn({
      messages: [{ role: 'user', content: 'echo' }],
      modelConfig,
      tools: [echoTool],
      client,
      onEvent: (event) => events.push(event),
    })

    expect(result.content).toBe('final')
    expect(result.usedTools).toBe(true)
    expect(events.map((event) => event.type)).toEqual([
      'run_started',
      'tool_started',
      'tool_completed',
      'assistant_message',
      'run_completed',
    ])
    expect(result.messages.some((message) => message.role === 'tool' && message.toolName === 'echo')).toBe(true)
  })

  it('supports multiple tool rounds', async () => {
    let calls = 0
    const client: ChatCompletionClient = async () => {
      calls += 1
      if (calls <= 2) {
        return {
          content: '',
          toolCalls: [
            {
              id: `call_${calls}`,
              name: 'echo',
              rawArguments: `{"text":"${calls}"}`,
              arguments: { text: String(calls) },
            },
          ],
        }
      }
      return {
        content: 'all set',
        toolCalls: [],
      }
    }

    const result = await runAgentTurn({
      messages: [{ role: 'user', content: 'two rounds' }],
      modelConfig,
      tools: [echoTool],
      client,
    })

    expect(result.content).toBe('all set')
    expect(result.messages.filter((message) => message.role === 'tool')).toHaveLength(2)
  })

  it('emits assistant text before starting a tool call', async () => {
    const events: AgentRunEvent[] = []
    let calls = 0
    const client: ChatCompletionClient = async () => {
      calls += 1
      if (calls === 1) {
        return {
          content: 'I will use the camera.',
          toolCalls: [
            {
              id: 'call_1',
              name: 'echo',
              rawArguments: '{"text":"photo"}',
              arguments: { text: 'photo' },
            },
          ],
        }
      }
      return {
        content: 'done',
        toolCalls: [],
      }
    }

    await runAgentTurn({
      messages: [{ role: 'user', content: 'take a photo' }],
      modelConfig,
      tools: [echoTool],
      client,
      onEvent: (event) => events.push(event),
    })

    expect(events.map((event) => event.type)).toEqual([
      'run_started',
      'assistant_message',
      'tool_started',
      'tool_completed',
      'assistant_message',
      'run_completed',
    ])
    expect(events.find((event) => event.type === 'assistant_message')?.content).toBe('I will use the camera.')
  })

  it('records tool failures and lets the model recover', async () => {
    const events: AgentRunEvent[] = []
    let calls = 0
    const client: ChatCompletionClient = async () => {
      calls += 1
      if (calls === 1) {
        return {
          content: '',
          toolCalls: [
            {
              id: 'call_1',
              name: 'fail',
              rawArguments: '{}',
              arguments: {},
            },
          ],
        }
      }
      return {
        content: 'recovered',
        toolCalls: [],
      }
    }

    const result = await runAgentTurn({
      messages: [{ role: 'user', content: 'fail then recover' }],
      modelConfig,
      tools: [failingTool],
      client,
      onEvent: (event) => events.push(event),
    })

    expect(result.content).toBe('recovered')
    expect(events.map((event) => event.type)).toEqual([
      'run_started',
      'tool_started',
      'tool_failed',
      'assistant_message',
      'run_completed',
    ])
    expect(result.messages.find((message) => message.role === 'tool')?.content).toContain('boom')
  })

  it('stops when the tool round limit is reached', async () => {
    const client: ChatCompletionClient = async () => ({
      content: '',
      toolCalls: [
        {
          id: 'call_loop',
          name: 'echo',
          rawArguments: '{"text":"loop"}',
          arguments: { text: 'loop' },
        },
      ],
    })

    const result = await runAgentTurn({
      messages: [{ role: 'user', content: 'loop' }],
      modelConfig,
      tools: [echoTool],
      client,
      maxToolRounds: 1,
    })

    expect(result.content).toContain('工具调用次数达到上限')
    expect(result.messages.filter((message) => message.role === 'tool')).toHaveLength(1)
  })

  it('allows ten tool rounds by default', async () => {
    const client: ChatCompletionClient = async () => ({
      content: '',
      toolCalls: [
        {
          id: 'call_loop',
          name: 'echo',
          rawArguments: '{"text":"loop"}',
          arguments: { text: 'loop' },
        },
      ],
    })

    const result = await runAgentTurn({
      messages: [{ role: 'user', content: 'loop' }],
      modelConfig,
      tools: [echoTool],
      client,
    })

    expect(result.messages.filter((message) => message.role === 'tool')).toHaveLength(10)
  })

  it('falls back without tools when the provider rejects tool calling', async () => {
    const useToolsValues: boolean[] = []
    const client: ChatCompletionClient = async (request) => {
      useToolsValues.push(request.useTools)
      if (request.useTools) {
        throw new UnsupportedToolsError('tools are not supported')
      }
      return {
        content: 'fallback reply',
        toolCalls: [],
      }
    }

    const result = await runAgentTurn({
      messages: [{ role: 'user', content: 'hello' }],
      modelConfig,
      tools: [echoTool],
      client,
    })

    expect(result.content).toBe('fallback reply')
    expect(result.fellBackWithoutTools).toBe(true)
    expect(useToolsValues).toEqual([true, false])
  })

  it('executes a guarded tool after user approval', async () => {
    const events: AgentRunEvent[] = []
    let calls = 0
    const client: ChatCompletionClient = async () => {
      calls += 1
      if (calls === 1) {
        return {
          content: '',
          toolCalls: [
            {
              id: 'call_guarded',
              name: 'guarded',
              rawArguments: '{}',
              arguments: {},
            },
          ],
        }
      }
      return {
        content: 'approved final',
        toolCalls: [],
      }
    }

    const result = await runAgentTurn({
      messages: [{ role: 'user', content: 'guarded' }],
      modelConfig,
      tools: [guardedTool],
      client,
      requestToolConfirmation: async () => 'approved',
      onEvent: (event) => events.push(event),
    })

    expect(result.content).toBe('approved final')
    expect(events.map((event) => event.type)).toContain('tool_confirmation_required')
    expect(result.messages.find((message) => message.role === 'tool')?.content).toContain('guarded done')
  })

  it('skips a guarded tool after user denial and lets the model recover', async () => {
    let calls = 0
    const client: ChatCompletionClient = async () => {
      calls += 1
      if (calls === 1) {
        return {
          content: '',
          toolCalls: [
            {
              id: 'call_guarded',
              name: 'guarded',
              rawArguments: '{}',
              arguments: {},
            },
          ],
        }
      }
      return {
        content: 'denied final',
        toolCalls: [],
      }
    }

    const result = await runAgentTurn({
      messages: [{ role: 'user', content: 'guarded' }],
      modelConfig,
      tools: [guardedTool],
      client,
      requestToolConfirmation: async () => 'denied',
    })

    const toolMessage = result.messages.find((message) => message.role === 'tool')
    expect(result.content).toBe('denied final')
    expect(toolMessage?.content).toContain('用户拒绝执行工具')
    expect(toolMessage?.content).not.toContain('guarded done')
  })

  it('aborts while waiting for guarded tool confirmation', async () => {
    const events: AgentRunEvent[] = []
    const controller = new AbortController()
    const client: ChatCompletionClient = async () => ({
      content: '',
      toolCalls: [
        {
          id: 'call_guarded',
          name: 'guarded',
          rawArguments: '{}',
          arguments: {},
        },
      ],
    })

    await expect(
      runAgentTurn({
        messages: [{ role: 'user', content: 'guarded' }],
        modelConfig,
        tools: [guardedTool],
        client,
        signal: controller.signal,
        requestToolConfirmation: async () => {
          controller.abort()
          return new Promise<never>(() => {})
        },
        onEvent: (event) => events.push(event),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(events.map((event) => event.type)).toContain('tool_confirmation_required')
    expect(events.map((event) => event.type)).toContain('run_aborted')
  })
})
