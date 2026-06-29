import { requestChatCompletion, UnsupportedToolsError } from './openaiCompatible'
import { isToolDenied, shouldConfirmTool } from './toolPolicy'
import type {
  AgentMessage,
  AgentModelConfig,
  AgentRunEvent,
  ChatCompletionClient,
  ToolCall,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from './types'

export type ToolConfirmationDecision = 'approved' | 'denied' | { outcome: 'approved' | 'denied' }

export interface RunAgentTurnOptions {
  messages: AgentMessage[]
  modelConfig: AgentModelConfig
  tools: ToolDefinition[]
  signal?: AbortSignal
  maxToolRounds?: number
  client?: ChatCompletionClient
  toolContext?: ToolExecutionContext
  requestToolConfirmation?: (toolCall: ToolCall, tool: ToolDefinition) => Promise<ToolConfirmationDecision>
  onEvent?: (event: AgentRunEvent) => void
}

export interface RunAgentTurnResult {
  content: string
  messages: AgentMessage[]
  usedTools: boolean
  fellBackWithoutTools: boolean
}

export const emptyAssistantReplyMessage = '模型没有返回内容。'

export async function runAgentTurn(options: RunAgentTurnOptions): Promise<RunAgentTurnResult> {
  const runId = createRunId()
  const client = options.client ?? requestChatCompletion
  const maxToolRounds = options.maxToolRounds ?? 4
  const toolsByName = new Map(options.tools.map((tool) => [tool.name, tool]))
  const initialMessages = [...options.messages]
  let history = [...initialMessages]
  let useTools = options.tools.length > 0
  let fellBackWithoutTools = false
  let completedToolRounds = 0
  let usedTools = false

  options.onEvent?.({
    type: 'run_started',
    runId,
  })

  try {
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
          onContentDelta: (delta) => {
            options.onEvent?.({
              type: 'assistant_delta',
              ...delta,
            })
          },
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
        if (!content) {
          throw new Error(emptyAssistantReplyMessage)
        }

        history.push({
          role: 'assistant',
          content,
        })
        options.onEvent?.({
          type: 'assistant_message',
          content,
        })
        return finishRun({ content, history, usedTools, fellBackWithoutTools, onEvent: options.onEvent })
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
        return finishRun({ content, history, usedTools, fellBackWithoutTools, onEvent: options.onEvent })
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
        const tool = toolsByName.get(toolCall.name) ?? createUnknownTool(toolCall.name)
        options.onEvent?.({
          type: 'tool_started',
          toolCall,
          tool,
        })

        if (!toolsByName.has(toolCall.name)) {
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

        if (isToolDenied(tool)) {
          const error = `工具策略拒绝执行：${tool.name}`
          history.push(toolResultMessage(toolCall.id, toolCall.name, { text: error, data: { denied: true } }))
          options.onEvent?.({
            type: 'tool_failed',
            toolCall,
            error,
            durationMs: Date.now() - startedAt,
          })
          continue
        }

        if (shouldConfirmTool(tool)) {
          options.onEvent?.({
            type: 'tool_confirmation_required',
            toolCall,
            tool,
          })
          const decision = await requestConfirmation(options, toolCall, tool)
          if (decision !== 'approved') {
            const error = `用户拒绝执行工具：${tool.name}`
            history.push(toolResultMessage(toolCall.id, toolCall.name, { text: error, data: { denied: true } }))
            options.onEvent?.({
              type: 'tool_failed',
              toolCall,
              error,
              durationMs: Date.now() - startedAt,
            })
            continue
          }
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
  } catch (error) {
    if (isAbortError(error)) {
      options.onEvent?.({
        type: 'run_aborted',
      })
    }
    throw error
  }
}

function finishRun({
  content,
  history,
  usedTools,
  fellBackWithoutTools,
  onEvent,
}: {
  content: string
  history: AgentMessage[]
  usedTools: boolean
  fellBackWithoutTools: boolean
  onEvent?: (event: AgentRunEvent) => void
}): RunAgentTurnResult {
  onEvent?.({
    type: 'run_completed',
    content,
    usedTools,
    fellBackWithoutTools,
  })

  return {
    content,
    messages: history,
    usedTools,
    fellBackWithoutTools,
  }
}

async function requestConfirmation(options: RunAgentTurnOptions, toolCall: ToolCall, tool: ToolDefinition) {
  const decision = await withAbort(Promise.resolve(options.requestToolConfirmation?.(toolCall, tool)), options.signal)
  if (typeof decision === 'string') return decision
  return decision?.outcome ?? 'denied'
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(createAbortError())

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      reject(createAbortError())
    }

    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
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
  throw createAbortError()
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function createAbortError() {
  return new DOMException('Aborted', 'AbortError')
}

function formatToolError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\s+/g, ' ').slice(0, 180) || '工具执行失败。'
}

function createRunId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `run_${crypto.randomUUID()}`
    : `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function createUnknownTool(name: string): ToolDefinition {
  return {
    name,
    description: '未知工具。',
    source: 'plugin',
    riskLevel: 'high',
    permission: 'none',
    enabled: false,
    confirmationPolicy: 'deny',
    requiresConfirmation: true,
    parameters: {
      type: 'object',
      additionalProperties: true,
    },
    execute: async () => {
      throw new Error(`未知工具：${name}`)
    },
  }
}
