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
}

const echoTool: ToolDefinition = {
  name: 'echo',
  description: 'Echo text.',
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
  parameters: {
    type: 'object',
    additionalProperties: false,
  },
  execute: async () => {
    throw new Error('boom')
  },
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
    expect(events.map((event) => event.type)).toEqual(['tool_started', 'tool_completed', 'assistant_message'])
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
    expect(events.map((event) => event.type)).toEqual(['tool_started', 'tool_failed', 'assistant_message'])
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
})
