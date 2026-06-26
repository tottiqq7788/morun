import type { StorageLike, ToolDefinition, ToolExecutionContext } from './types'

interface AgentNote {
  id: string
  title?: string
  content: string
  createdAt: string
}

export const notesKey = 'morun.agent-notes.v1'
const maxExpressionLength = 160

export function createBuiltinTools(context: Pick<ToolExecutionContext, 'storage' | 'now'> = {}): ToolDefinition[] {
  return [
    {
      name: 'get_current_time',
      description: '获取当前时间。可以指定 IANA 时区，例如 Asia/Shanghai 或 America/New_York。',
      source: 'builtin',
      riskLevel: 'safe',
      requiresConfirmation: false,
      parameters: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: '可选 IANA 时区名称。',
          },
        },
        additionalProperties: false,
      },
      execute: async (args, runtimeContext) => {
        const record = asRecord(args)
        const timezone = typeof record.timezone === 'string' && record.timezone.trim() ? record.timezone.trim() : undefined
        const now = (context.now ?? runtimeContext.now ?? (() => new Date()))()
        const resolvedTimezone = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
        const formatter = new Intl.DateTimeFormat('zh-CN', {
          dateStyle: 'full',
          timeStyle: 'medium',
          timeZone: resolvedTimezone,
        })

        return {
          text: `${resolvedTimezone} 当前时间：${formatter.format(now)}`,
          data: {
            timezone: resolvedTimezone,
            iso: now.toISOString(),
            display: formatter.format(now),
          },
        }
      },
    },
    {
      name: 'calculate',
      description: '计算一个安全的数学表达式。只支持数字、括号、+、-、*、/、% 和一元正负号。',
      source: 'builtin',
      riskLevel: 'safe',
      requiresConfirmation: false,
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: '要计算的数学表达式。',
          },
        },
        required: ['expression'],
        additionalProperties: false,
      },
      execute: async (args) => {
        const record = asRecord(args)
        if (typeof record.expression !== 'string') {
          throw new Error('expression 必须是字符串。')
        }

        const result = calculateExpression(record.expression)
        return {
          text: `${record.expression.trim()} = ${formatNumber(result)}`,
          data: {
            expression: record.expression,
            result,
          },
        }
      },
    },
    {
      name: 'remember_note',
      description: '把一条用户希望保留的偏好、事实或备忘保存到本地记忆。',
      source: 'builtin',
      riskLevel: 'low',
      requiresConfirmation: false,
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: '可选标题。',
          },
          content: {
            type: 'string',
            description: '要保存的内容。',
          },
        },
        required: ['content'],
        additionalProperties: false,
      },
      execute: async (args, runtimeContext) => {
        const record = asRecord(args)
        if (typeof record.content !== 'string' || !record.content.trim()) {
          throw new Error('content 不能为空。')
        }

        const storage = resolveStorage(context.storage ?? runtimeContext.storage)
        const notes = loadNotes(storage)
        const now = (context.now ?? runtimeContext.now ?? (() => new Date()))()
        const note: AgentNote = {
          id: createId(),
          title: typeof record.title === 'string' && record.title.trim() ? record.title.trim().slice(0, 80) : undefined,
          content: record.content.trim().slice(0, 1000),
          createdAt: now.toISOString(),
        }

        notes.unshift(note)
        storage.setItem(notesKey, JSON.stringify(notes.slice(0, 200)))

        return {
          text: `已记住：${note.title ? `${note.title} - ` : ''}${note.content}`,
          data: note,
        }
      },
    },
    {
      name: 'recall_notes',
      description: '从本地记忆中检索之前保存的偏好、事实或备忘。',
      source: 'builtin',
      riskLevel: 'safe',
      requiresConfirmation: false,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '可选关键词。',
          },
          limit: {
            type: 'number',
            description: '最多返回几条，最大为 5。',
            minimum: 1,
            maximum: 5,
          },
        },
        additionalProperties: false,
      },
      execute: async (args, runtimeContext) => {
        const record = asRecord(args)
        const storage = resolveStorage(context.storage ?? runtimeContext.storage)
        const notes = loadNotes(storage)
        const query = typeof record.query === 'string' ? record.query.trim().toLowerCase() : ''
        const limit = clampLimit(typeof record.limit === 'number' ? record.limit : 5)
        const matched = notes
          .filter((note) => {
            if (!query) return true
            return `${note.title ?? ''} ${note.content}`.toLowerCase().includes(query)
          })
          .slice(0, limit)

        return {
          text: matched.length
            ? matched.map((note, index) => `${index + 1}. ${note.title ? `${note.title}: ` : ''}${note.content}`).join('\n')
            : '没有找到匹配的记忆。',
          data: {
            query,
            notes: matched,
          },
        }
      },
    },
    {
      name: 'clear_notes',
      description: '清空所有本地记忆。这个操作需要用户确认。',
      source: 'builtin',
      riskLevel: 'medium',
      requiresConfirmation: true,
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: '清空记忆的原因。',
          },
        },
        additionalProperties: false,
      },
      execute: async (_args, runtimeContext) => {
        const storage = resolveStorage(context.storage ?? runtimeContext.storage)
        const notes = loadNotes(storage)
        storage.setItem(notesKey, JSON.stringify([]))

        return {
          text: `已清空 ${notes.length} 条本地记忆。`,
          data: {
            cleared: notes.length,
          },
        }
      },
    },
  ]
}

export function calculateExpression(expression: string): number {
  if (expression.length > maxExpressionLength) {
    throw new Error(`表达式过长，最多 ${maxExpressionLength} 个字符。`)
  }

  if (!/^[\d\s()+\-*/%.]*$/.test(expression)) {
    throw new Error('表达式包含不支持的字符。')
  }

  const parser = new ExpressionParser(expression)
  const result = parser.parse()
  if (!Number.isFinite(result)) {
    throw new Error('计算结果不是有效数字。')
  }
  return result
}

class ExpressionParser {
  private readonly source: string
  private position = 0

  constructor(source: string) {
    this.source = source
  }

  parse() {
    const value = this.parseExpression()
    this.skipWhitespace()
    if (this.position < this.source.length) {
      throw new Error(`无法解析表达式：${this.source.slice(this.position)}`)
    }
    return value
  }

  private parseExpression(): number {
    let value = this.parseTerm()

    while (true) {
      this.skipWhitespace()
      if (this.match('+')) {
        value += this.parseTerm()
      } else if (this.match('-')) {
        value -= this.parseTerm()
      } else {
        return value
      }
    }
  }

  private parseTerm(): number {
    let value = this.parseUnary()

    while (true) {
      this.skipWhitespace()
      if (this.match('*')) {
        value *= this.parseUnary()
      } else if (this.match('/')) {
        const divisor = this.parseUnary()
        if (divisor === 0) throw new Error('不能除以 0。')
        value /= divisor
      } else if (this.match('%')) {
        const divisor = this.parseUnary()
        if (divisor === 0) throw new Error('不能对 0 取模。')
        value %= divisor
      } else {
        return value
      }
    }
  }

  private parseUnary(): number {
    this.skipWhitespace()
    if (this.match('+')) return this.parseUnary()
    if (this.match('-')) return -this.parseUnary()
    return this.parsePrimary()
  }

  private parsePrimary(): number {
    this.skipWhitespace()

    if (this.match('(')) {
      const value = this.parseExpression()
      this.skipWhitespace()
      if (!this.match(')')) throw new Error('缺少右括号。')
      return value
    }

    return this.parseNumber()
  }

  private parseNumber(): number {
    this.skipWhitespace()
    const start = this.position
    let dotCount = 0

    while (this.position < this.source.length) {
      const char = this.source[this.position]
      if (char === '.') {
        dotCount += 1
        if (dotCount > 1) break
        this.position += 1
      } else if (char >= '0' && char <= '9') {
        this.position += 1
      } else {
        break
      }
    }

    const raw = this.source.slice(start, this.position)
    if (!raw || raw === '.') {
      throw new Error('缺少数字。')
    }

    return Number(raw)
  }

  private match(expected: string) {
    if (this.source[this.position] !== expected) return false
    this.position += 1
    return true
  }

  private skipWhitespace() {
    while (/\s/.test(this.source[this.position] ?? '')) {
      this.position += 1
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function resolveStorage(storage?: StorageLike): StorageLike {
  if (storage) return storage
  if (typeof localStorage !== 'undefined') return localStorage
  throw new Error('当前环境不支持本地记忆。')
}

function loadNotes(storage: StorageLike): AgentNote[] {
  const raw = storage.getItem(notesKey)
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isAgentNote)
  } catch {
    return []
  }
}

function isAgentNote(value: unknown): value is AgentNote {
  const record = asRecord(value)
  return typeof record.id === 'string' && typeof record.content === 'string' && typeof record.createdAt === 'string'
}

function clampLimit(limit: number) {
  if (!Number.isFinite(limit)) return 5
  return Math.min(5, Math.max(1, Math.floor(limit)))
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : Number(value.toPrecision(12)).toString()
}

function createId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `note_${crypto.randomUUID()}`
    : `note_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
