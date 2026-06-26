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
