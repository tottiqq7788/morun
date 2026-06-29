import type { AgentMessage } from '../agent/types'
import type { ChatMessage, ChatSession } from './chat'
import { groupChatTurnPages } from './chatTurns'

const sessionTitleTurnThresholds = new Set([5, 15, 25])

export function countConversationTurns(messages: ChatMessage[]) {
  return groupChatTurnPages(messages).filter((page) => page.userMessage).length
}

export function shouldGenerateSessionTitle(session: ChatSession) {
  const turnCount = countConversationTurns(session.messages)
  return sessionTitleTurnThresholds.has(turnCount) && !hasGeneratedSessionTitle(session, turnCount)
}

export function markSessionTitleGenerated(session: ChatSession, turnCount = countConversationTurns(session.messages)) {
  if (!sessionTitleTurnThresholds.has(turnCount)) return

  const counts = new Set(session.titleGeneratedTurnCounts ?? [])
  counts.add(turnCount)
  session.titleGeneratedTurnCounts = Array.from(counts).sort((a, b) => a - b)
}

export function buildSessionTitleMessages(session: ChatSession): AgentMessage[] {
  const transcript = session.messages
    .map(formatTranscriptMessage)
    .filter((line) => line.trim())
    .join('\n\n')

  return [
    {
      role: 'system',
      content:
        '你是对话标题生成器。请基于完整历史生成一个中文短标题，长度2到8个字。只输出标题本身，不要解释，不要标点，不要引号。',
    },
    {
      role: 'user',
      content: `请为以下对话生成一个2到8字标题。\n\n${transcript || '暂无对话内容'}`,
    },
  ]
}

export function sanitizeGeneratedSessionTitle(value: string) {
  const firstContentLine =
    value
      .replace(/\r/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) ?? ''
  const title = firstContentLine
    .replace(/^(标题|会话标题|对话标题)\s*[:：]\s*/i, '')
    .replace(/^[-*#\d.、\s]+/, '')
    .replace(/[《》“”"'`【】\[\]（）()]/g, '')
    .replace(/[，。！？、；：:,.!?;~～]/g, '')
    .replace(/\s+/g, '')
    .trim()
  const normalized = Array.from(title).slice(0, 8).join('')

  return Array.from(normalized).length >= 2 ? normalized : ''
}

function formatTranscriptMessage(message: ChatMessage) {
  const content = readableMessageContent(message)
  if (!content) return ''

  if (message.role === 'user') return `用户：${content}`
  if (message.role === 'assistant') return `助手：${content}`
  return `工具${message.toolName ? `(${message.toolName})` : ''}：${content}`
}

function readableMessageContent(message: ChatMessage) {
  return (message.error || message.toolError || message.content).trim()
}

function hasGeneratedSessionTitle(session: ChatSession, turnCount: number) {
  return (session.titleGeneratedTurnCounts ?? []).includes(turnCount)
}
