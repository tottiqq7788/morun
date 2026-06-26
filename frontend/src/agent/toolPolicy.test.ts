import { describe, expect, it } from 'vitest'
import { runAgentTurn } from './runner'
import { applyToolPolicy, shouldConfirmTool } from './toolPolicy'
import type { ChatCompletionClient, ToolDefinition } from './types'

const modelConfig = {
  baseUrl: 'https://example.test/v1',
  apiKey: 'test',
  model: 'test-model',
  temperature: 0.7,
  maxTokens: 1024,
  stream: false,
}

describe('tool guard policy', () => {
  it('auto-runs safe and low risk tools by default', () => {
    expect(shouldConfirmTool(createTool('safe_tool', 'safe'))).toBe(false)
    expect(shouldConfirmTool(createTool('low_tool', 'low'))).toBe(false)
  })

  it('requires confirmation for medium and high risk tools by default', () => {
    expect(shouldConfirmTool(createTool('medium_tool', 'medium'))).toBe(true)
    expect(shouldConfirmTool(createTool('high_tool', 'high'))).toBe(true)
  })

  it('filters disabled and denied tools out of the model catalog', () => {
    const safeTool = createTool('safe_tool', 'safe')
    const deniedTool = createTool('denied_tool', 'low')
    const disabledTool = createTool('disabled_tool', 'low')

    const registry = applyToolPolicy([safeTool, deniedTool, disabledTool], {
      tools: {
        denied_tool: { confirmationPolicy: 'deny' },
        disabled_tool: { enabled: false },
      },
    })

    expect(registry.catalogTools).toHaveLength(3)
    expect(registry.tools.map((tool) => tool.name)).toEqual(['safe_tool'])
  })

  it('returns a tool failure instead of executing denied tools', async () => {
    const deniedTool = {
      ...createTool('dangerous', 'low'),
      confirmationPolicy: 'deny' as const,
      execute: async () => ({ text: 'should not execute' }),
    }
    const client: ChatCompletionClient = async (request) => {
      if (!request.messages.some((message) => message.role === 'tool')) {
        return {
          content: '',
          toolCalls: [
            {
              id: 'call_1',
              name: 'dangerous',
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
      messages: [{ role: 'user', content: 'run tool' }],
      modelConfig,
      tools: [deniedTool],
      client,
    })

    const toolMessage = result.messages.find((message) => message.role === 'tool')
    expect(toolMessage?.content).toContain('工具策略拒绝执行')
    expect(toolMessage?.content).not.toContain('should not execute')
  })
})

function createTool(name: string, riskLevel: ToolDefinition['riskLevel']): ToolDefinition {
  return {
    name,
    description: `${name}.`,
    source: 'builtin',
    riskLevel,
    permission: 'none',
    requiresConfirmation: false,
    parameters: {
      type: 'object',
      additionalProperties: false,
    },
    execute: async () => ({
      text: `${name} done`,
    }),
  }
}
