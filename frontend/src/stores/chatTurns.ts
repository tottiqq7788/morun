import type { ChatMessage } from './chat'

export interface ChatTurnPage {
  id: string
  userMessage: ChatMessage | null
  messages: ChatMessage[]
  startedAt: number
}

export interface ChatTurnRollback {
  draft: string
  messages: ChatMessage[]
  remainingTurnCount: number
}

export function groupChatTurnPages(messages: ChatMessage[]): ChatTurnPage[] {
  const pages: ChatTurnPage[] = []
  let current: ChatTurnPage | null = null

  for (const message of messages) {
    if (message.role === 'user') {
      current = {
        id: message.id,
        userMessage: message,
        messages: [],
        startedAt: message.createdAt,
      }
      pages.push(current)
      continue
    }

    if (!current) {
      current = {
        id: `orphan-${message.id}`,
        userMessage: null,
        messages: [],
        startedAt: message.createdAt,
      }
      pages.push(current)
    }

    current.messages.push(message)
  }

  return pages
}

export function rollbackChatTurnToDraft(messages: ChatMessage[], userMessageId: string): ChatTurnRollback | null {
  const targetIndex = messages.findIndex((message) => message.role === 'user' && message.id === userMessageId)
  if (targetIndex < 0) return null

  const target = messages[targetIndex]
  const nextMessages = messages.slice(0, targetIndex)

  return {
    draft: target.content,
    messages: nextMessages,
    remainingTurnCount: groupChatTurnPages(nextMessages).filter((page) => page.userMessage).length,
  }
}
