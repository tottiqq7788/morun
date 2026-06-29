import { describe, expect, it } from 'vitest'
import type { ChatMessage, ChatSession, Role } from './chat'
import {
  buildSessionTitleMessages,
  countConversationTurns,
  markSessionTitleGenerated,
  sanitizeGeneratedSessionTitle,
  shouldGenerateSessionTitle,
} from './sessionTitle'

describe('session title helpers', () => {
  it('triggers title generation only at configured conversation turn counts', () => {
    expect(shouldGenerateSessionTitle(sessionWithTurns(4))).toBe(false)
    expect(shouldGenerateSessionTitle(sessionWithTurns(5))).toBe(true)
    expect(shouldGenerateSessionTitle(sessionWithTurns(15))).toBe(true)
    expect(shouldGenerateSessionTitle(sessionWithTurns(25))).toBe(true)
    expect(shouldGenerateSessionTitle(sessionWithTurns(26))).toBe(false)
  })

  it('counts only user question pages as conversation turns', () => {
    expect(
      countConversationTurns([
        message('a0', 'assistant', '历史回复'),
        message('t0', 'tool', '历史工具结果'),
        message('u1', 'user', '问'),
        message('a1', 'assistant', '答'),
        message('t1', 'tool', '工具结果'),
        message('u2', 'user', '再问'),
      ]),
    ).toBe(2)
  })

  it('does not use orphan fallback pages to trigger title generation', () => {
    expect(
      shouldGenerateSessionTitle({
        ...sessionWithTurns(4),
        messages: [message('a0', 'assistant', '历史孤立回复'), ...sessionWithTurns(4).messages],
      }),
    ).toBe(false)
  })

  it('does not trigger again for a completed title threshold', () => {
    const session = sessionWithTurns(5)
    markSessionTitleGenerated(session)

    expect(session.titleGeneratedTurnCounts).toEqual([5])
    expect(shouldGenerateSessionTitle(session)).toBe(false)
  })

  it('keeps generated title thresholds unique and sorted', () => {
    const session = {
      ...sessionWithTurns(25),
      titleGeneratedTurnCounts: [15, 5],
    }

    markSessionTitleGenerated(session, 25)
    markSessionTitleGenerated(session, 15)

    expect(session.titleGeneratedTurnCounts).toEqual([5, 15, 25])
  })

  it('builds a title prompt from user, assistant and tool history', () => {
    const titleMessages = buildSessionTitleMessages({
      ...sessionWithTurns(0),
      messages: [
        message('u1', 'user', '查一下短信'),
        message('t1', 'tool', '读取到 20 条短信', { toolName: 'termux_messages' }),
        message('a1', 'assistant', '短信里有天气提醒'),
      ],
    })

    expect(titleMessages).toHaveLength(2)
    expect(titleMessages[0].role).toBe('system')
    expect(titleMessages[1].content).toContain('用户：查一下短信')
    expect(titleMessages[1].content).toContain('工具(termux_messages)：读取到 20 条短信')
    expect(titleMessages[1].content).toContain('助手：短信里有天气提醒')
  })

  it('sanitizes model output to a 2 to 8 character title', () => {
    expect(sanitizeGeneratedSessionTitle('标题：短信天气提醒')).toBe('短信天气提醒')
    expect(sanitizeGeneratedSessionTitle('“家庭行程安排”\n这是解释')).toBe('家庭行程安排')
    expect(sanitizeGeneratedSessionTitle('a')).toBe('')
    expect(sanitizeGeneratedSessionTitle('这是一个特别长的对话标题')).toBe('这是一个特别长的')
  })
})

function sessionWithTurns(turns: number): ChatSession {
  const messages: ChatMessage[] = []
  for (let index = 0; index < turns; index += 1) {
    messages.push(message(`u${index}`, 'user', `问题 ${index + 1}`))
    messages.push(message(`a${index}`, 'assistant', `回答 ${index + 1}`))
  }

  return {
    id: 'session_1',
    title: '新会话',
    createdAt: 1,
    updatedAt: 1,
    titleGeneratedTurnCounts: [],
    messages,
  }
}

function message(
  id: string,
  role: Role,
  content: string,
  overrides: Partial<Pick<ChatMessage, 'toolName'>> = {},
): ChatMessage {
  return {
    id,
    role,
    content,
    createdAt: Number(id.replace(/\D/g, '') || 0),
    status: 'complete',
    ...overrides,
  }
}
