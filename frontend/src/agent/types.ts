export type AgentRole = 'system' | 'user' | 'assistant' | 'tool'

export interface AgentMessage {
  role: AgentRole
  content: string
  toolCallId?: string
  toolName?: string
  toolCalls?: ToolCall[]
}

export interface ToolCall {
  id: string
  name: string
  arguments: unknown
  rawArguments: string
}

export interface JsonSchema {
  type?: string
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean
  enum?: string[]
  items?: JsonSchema
  minimum?: number
  maximum?: number
}

export interface ToolExecutionContext {
  signal?: AbortSignal
  storage?: StorageLike
  now?: () => Date
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface ToolExecutionResult {
  text: string
  data?: unknown
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: JsonSchema
  execute(args: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult>
}

export interface AgentModelConfig {
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
}

export type AgentRunEvent =
  | {
      type: 'assistant_message'
      content: string
    }
  | {
      type: 'tool_started'
      toolCall: ToolCall
    }
  | {
      type: 'tool_completed'
      toolCall: ToolCall
      output: ToolExecutionResult
      durationMs: number
    }
  | {
      type: 'tool_failed'
      toolCall: ToolCall
      error: string
      durationMs: number
    }
  | {
      type: 'fallback_without_tools'
      reason: string
    }

export interface ChatCompletionResult {
  content: string
  toolCalls: ToolCall[]
}

export interface ChatCompletionRequest {
  modelConfig: AgentModelConfig
  messages: AgentMessage[]
  tools: ToolDefinition[]
  signal?: AbortSignal
  useTools: boolean
}

export type ChatCompletionClient = (request: ChatCompletionRequest) => Promise<ChatCompletionResult>
