import { describe, expect, it } from 'vitest'
import { calculateExpression, createBuiltinTools, notesKey } from './builtinTools'
import type { StorageLike } from './types'

describe('calculateExpression', () => {
  it('respects arithmetic precedence', () => {
    expect(calculateExpression('2 + 3 * 4')).toBe(14)
  })

  it('supports parentheses', () => {
    expect(calculateExpression('(2 + 3) * 4')).toBe(20)
  })

  it('supports unary signs', () => {
    expect(calculateExpression('-2 * -(3 + 4)')).toBe(14)
  })

  it('rejects unsupported characters', () => {
    expect(() => calculateExpression('Math.max(1, 2)')).toThrow('不支持')
  })

  it('rejects division by zero', () => {
    expect(() => calculateExpression('8 / (3 - 3)')).toThrow('不能除以 0')
  })

  it('rejects overly long expressions', () => {
    expect(() => calculateExpression('1+'.repeat(90))).toThrow('表达式过长')
  })

  it('clears local notes with confirmation metadata', async () => {
    const storage = createMemoryStorage({
      [notesKey]: JSON.stringify([
        {
          id: 'note_1',
          content: 'hello',
          createdAt: new Date(0).toISOString(),
        },
      ]),
    })
    const tool = createBuiltinTools({ storage }).find((item) => item.name === 'clear_notes')

    expect(tool).toMatchObject({
      riskLevel: 'medium',
      requiresConfirmation: true,
    })

    const result = await tool?.execute({}, { storage })
    expect(result?.text).toContain('已清空 1 条本地记忆')
    expect(storage.getItem(notesKey)).toBe('[]')
  })

  it('returns configured model and provider information without secrets', async () => {
    const tool = createBuiltinTools({
      getModelInfo: () => ({
        activeAccountId: 'account_openai',
        activeProviderName: 'OpenAI',
        activeModel: 'gpt-5',
        accounts: [
          {
            id: 'account_openai',
            providerId: 'openai',
            providerName: 'OpenAI',
            displayName: 'op · OpenAI',
            model: 'gpt-5',
            availableModels: ['gpt-5', 'gpt-4.1'],
            isActive: true,
            apiKeyConfigured: true,
            lastTestedAt: 1,
          },
          {
            id: 'account_deepseek',
            providerId: 'deepseek',
            providerName: 'DeepSeek',
            displayName: 'DeepSeek',
            model: 'deepseek-v4-pro',
            availableModels: ['deepseek-v4-flash', 'deepseek-v4-pro'],
            isActive: false,
            apiKeyConfigured: true,
          },
        ],
      }),
    }).find((item) => item.name === 'get_configured_model_info')

    expect(tool).toMatchObject({
      source: 'builtin',
      riskLevel: 'safe',
      permission: 'none',
      requiresConfirmation: false,
    })

    const result = await tool?.execute({}, {})

    expect(result?.text).toContain('当前使用模型：gpt-5')
    expect(result?.text).toContain('所属厂商：OpenAI')
    expect(result?.text).toContain('DeepSeek')
    expect(JSON.stringify(result?.data)).not.toContain('sk-')
  })
})

function createMemoryStorage(initial: Record<string, string> = {}): StorageLike {
  const data = new Map(Object.entries(initial))

  return {
    getItem(key) {
      return data.get(key) ?? null
    },
    setItem(key, value) {
      data.set(key, value)
    },
  }
}
