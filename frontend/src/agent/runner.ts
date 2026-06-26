import { requestChatCompletion, UnsupportedToolsError } from './openaiCompatible'
import type {
  AgentMessage,
  AgentModelConfig,
  AgentRunEvent,
  ChatCompletionClient,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from './types'

export interface RunAgentTurnOptions {
  messages: AgentMessage[]
  modelConfig: AgentModelConfig
  tools: ToolDefinition[]
  signal?: AbortSignal
  maxToolRounds?: number
  client?: ChatCompletionClient
  toolContext?: ToolExecutionContext
  onEvent?: (event: AgentRunEvent) => void
}

export interface RunAgentTurnResult {
  content: string
  messages: AgentMessage[]
  usedTools: boolean
  fellBackWithoutTools: boolean
}

export async function runAgentTurn(options: RunAgentTurnOptions): Promise<RunAgentTurnResult> {
  const client = options.client ?? requestChatCompletion
  const maxToolRounds = options.maxToolRounds ?? 4
  const toolsByName = new Map(options.tools.map((tool) => [tool.name, tool]))
  const initialMessages = [...options.messages]
  let history = [...initialMessages]
  let useTools = options.tools.length > 0
  let fellBackWithoutTools = false
  let completedToolRounds = 0
  let usedTools = false

  while (true) {
    throwIfAborted(options.signal)

    let completion
    try {
      completion = await client({
        modelConfig: options.modelConfig,
        messages: history,
        tools: options.tools,
        signal: options.signal,
        useTools,
      })
    } catch (error) {
      if (error instanceof UnsupportedToolsError && useTools && !fellBackWithoutTools) {
        fellBackWithoutTools = true
        useTools = false
        history = [...initialMessages]
        options.onEvent?.({
          type: 'fallback_without_tools',
          reason: error.message,
        })
        continue
      }

      throw error
    }

    if (!completion.toolCalls.length || !useTools) {
      const content = completion.content.trim()
      const assistantMessage: AgentMessage = {
        role: 'assistant',
        content,
      }
      history.push(assistantMessage)
      options.onEvent?.({
        type: 'assistant_message',
        content,
      })

      return {
        content,
        messages: history,
        usedTools,
        fellBackWithoutTools,
      }
    }

    if (completedToolRounds >= maxToolRounds) {
      const content = `工具调用次数达到上限（${maxToolRounds} 轮），已停止继续执行。`
      history.push({
        role: 'assistant',
        content,
      })
      options.onEvent?.({
        type: 'assistant_message',
        content,
      })

      return {
        content,
        messages: history,
        usedTools,
        fellBackWithoutTools,
      }
    }

    usedTools = true
    completedToolRounds += 1
    history.push({
      role: 'assistant',
      content: completion.content,
      toolCalls: completion.toolCalls,
    })

    for (const toolCall of completion.toolCalls) {
      throwIfAborted(options.signal)
      const startedAt = Date.now()
      options.onEvent?.({
        type: 'tool_started',
        toolCall,
      })

      const tool = toolsByName.get(toolCall.name)
      if (!tool) {
        const error = `未知工具：${toolCall.name}`
        history.push(toolResultMessage(toolCall.id, toolCall.name, { text: error, data: { error } }))
        options.onEvent?.({
          type: 'tool_failed',
          toolCall,
          error,
          durationMs: Date.now() - startedAt,
        })
        continue
      }

      try {
        const output = await tool.execute(toolCall.arguments, {
          ...options.toolContext,
          signal: options.signal,
        })
        history.push(toolResultMessage(toolCall.id, toolCall.name, output))
        options.onEvent?.({
          type: 'tool_completed',
          toolCall,
          output,
          durationMs: Date.now() - startedAt,
        })
      } catch (error) {
        if (isAbortError(error)) throw error

        const message = formatToolError(error)
        history.push(toolResultMessage(toolCall.id, toolCall.name, { text: message, data: { error: message } }))
        options.onEvent?.({
          type: 'tool_failed',
          toolCall,
          error: message,
          durationMs: Date.now() - startedAt,
        })
      }
    }
  }
}

function toolResultMessage(toolCallId: string, toolName: string, output: ToolExecutionResult): AgentMessage {
  return {
    role: 'tool',
    toolCallId,
    toolName,
    content: JSON.stringify(output),
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  throw new DOMException('Aborted', 'AbortError')
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function formatToolError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\s+/g, ' ').slice(0, 180) || '工具执行失败。'
}
