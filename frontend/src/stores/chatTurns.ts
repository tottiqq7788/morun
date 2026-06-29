import type { ChatMessage } from './chat'

export interface ChatTurnPage {
  id: string
  userMessage: ChatMessage | null
  messages: ChatMessage[]
  startedAt: number
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
