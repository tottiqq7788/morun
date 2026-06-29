import { describe, expect, it } from 'vitest'
import type { ChatMessage, Role, ToolStatus } from './chat'
import { groupChatTurnPages, rollbackChatTurnToDraft } from './chatTurns'

describe('groupChatTurnPages', () => {
  it('returns no pages for an empty conversation', () => {
    expect(groupChatTurnPages([])).toEqual([])
  })

  it('groups one user message with its assistant reply', () => {
    const pages = groupChatTurnPages([
      message('u1', 'user', 'hello'),
      message('a1', 'assistant', 'hi'),
    ])

    expect(pages).toHaveLength(1)
    expect(pages[0].userMessage?.id).toBe('u1')
    expect(pages[0].messages.map((item) => item.id)).toEqual(['a1'])
  })

  it('splits multiple turns by user messages', () => {
    const pages = groupChatTurnPages([
      message('u1', 'user', 'first'),
      message('t1', 'tool', 'tool output', { toolStatus: 'done' }),
      message('a1', 'assistant', 'first answer'),
      message('u2', 'user', 'second'),
      message('a2', 'assistant', 'second answer'),
    ])

    expect(pages).toHaveLength(2)
    expect(pages[0].userMessage?.id).toBe('u1')
    expect(pages[0].messages.map((item) => item.id)).toEqual(['t1', 'a1'])
    expect(pages[1].userMessage?.id).toBe('u2')
    expect(pages[1].messages.map((item) => item.id)).toEqual(['a2'])
  })

  it('keeps running tool and streaming assistant messages in the active turn', () => {
    const pages = groupChatTurnPages([
      message('u1', 'user', 'read sms'),
      message('t1', 'tool', '', { status: 'streaming', toolStatus: 'running' }),
      message('a1', 'assistant', 'reading...', { status: 'streaming' }),
    ])

    expect(pages).toHaveLength(1)
    expect(pages[0].messages.map((item) => item.id)).toEqual(['t1', 'a1'])
    expect(pages[0].messages[0].toolStatus).toBe('running')
    expect(pages[0].messages[1].status).toBe('streaming')
  })

  it('keeps leading orphan assistant and tool messages in a fallback page', () => {
    const pages = groupChatTurnPages([
      message('a0', 'assistant', 'legacy answer'),
      message('t0', 'tool', 'legacy tool', { toolStatus: 'done' }),
      message('u1', 'user', 'normal turn'),
      message('a1', 'assistant', 'normal answer'),
    ])

    expect(pages).toHaveLength(2)
    expect(pages[0]).toMatchObject({
      id: 'orphan-a0',
      userMessage: null,
    })
    expect(pages[0].messages.map((item) => item.id)).toEqual(['a0', 't0'])
    expect(pages[1].userMessage?.id).toBe('u1')
    expect(pages[1].messages.map((item) => item.id)).toEqual(['a1'])
  })

  it('rolls back to the turn before the selected user message', () => {
    const messages = [
      message('u1', 'user', 'first'),
      message('a1', 'assistant', 'first answer'),
      message('u2', 'user', 'second'),
      message('t2', 'tool', 'tool output', { toolStatus: 'done' }),
      message('a2', 'assistant', 'second answer'),
      message('u3', 'user', 'third'),
      message('a3', 'assistant', 'third answer'),
    ]

    const rollback = rollbackChatTurnToDraft(messages, 'u2')

    expect(rollback?.draft).toBe('second')
    expect(rollback?.messages.map((item) => item.id)).toEqual(['u1', 'a1'])
    expect(rollback?.remainingTurnCount).toBe(1)
  })

  it('clears messages when rolling back to the first turn', () => {
    const rollback = rollbackChatTurnToDraft([
      message('u1', 'user', 'first'),
      message('t1', 'tool', 'tool output', { toolStatus: 'done' }),
      message('a1', 'assistant', 'first answer'),
    ], 'u1')

    expect(rollback).toEqual({
      draft: 'first',
      messages: [],
      remainingTurnCount: 0,
    })
  })

  it('returns null when the selected user message does not exist', () => {
    const messages = [
      message('u1', 'user', 'first'),
      message('a1', 'assistant', 'first answer'),
    ]

    expect(rollbackChatTurnToDraft(messages, 'missing')).toBeNull()
  })

  it('removes selected and later turns including tools and media attachments', () => {
    const mediaMessage = message('t2', 'tool', 'tool output', { toolStatus: 'done' })
    mediaMessage.mediaAttachments = [
      {
        mediaId: 'media_1',
        kind: 'image',
        originalSource: '/data/data/com.termux/files/home/photo.jpg',
        localPath: '/files/morun-media/media_1.jpg',
        mimeType: 'image/jpeg',
        fileName: 'photo.jpg',
        size: 123,
        createdAt: 2,
      },
    ]
    const messages = [
      message('u1', 'user', 'first'),
      message('a1', 'assistant', 'first answer'),
      message('u2', 'user', 'second'),
      mediaMessage,
      message('a2', 'assistant', 'second answer'),
    ]

    const rollback = rollbackChatTurnToDraft(messages, 'u2')

    expect(rollback?.messages.map((item) => item.id)).toEqual(['u1', 'a1'])
    expect(rollback?.messages.some((item) => item.mediaAttachments?.length)).toBe(false)
  })
})

function message(
  id: string,
  role: Role,
  content: string,
  overrides: Partial<Pick<ChatMessage, 'status' | 'toolStatus'>> = {},
): ChatMessage {
  const toolStatus = overrides.toolStatus as ToolStatus | undefined
  return {
    id,
    role,
    content,
    createdAt: Number(id.replace(/\D/g, '') || 0),
    status: overrides.status ?? 'complete',
    ...(toolStatus ? { toolStatus } : {}),
  }
}
