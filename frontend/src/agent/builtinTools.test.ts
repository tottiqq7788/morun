import { describe, expect, it } from 'vitest'
import { calculateExpression } from './builtinTools'

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
})
