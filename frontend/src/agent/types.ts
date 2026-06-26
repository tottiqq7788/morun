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

export type ToolSource = 'builtin' | 'native' | 'termux' | 'mcp' | 'plugin'
export type ToolRiskLevel = 'safe' | 'low' | 'medium' | 'high'
export type ToolPermission =
  | 'none'
  | 'external_app'
  | 'local_storage'
  | 'network'
  | 'secret'
  | 'clipboard'
  | 'notification'
  | 'location'
  | 'camera'
  | 'contacts'
  | 'call_log'
  | 'sms'
export type ToolConfirmationPolicy = 'auto' | 'confirm' | 'deny'

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
  removeItem?(key: string): void
}

export interface ToolExecutionResult {
  text: string
  data?: unknown
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: JsonSchema
  source: ToolSource
  riskLevel: ToolRiskLevel
  permission: ToolPermission
  enabled?: boolean
  confirmationPolicy?: ToolConfirmationPolicy
  requiresConfirmation: boolean
  execute(args: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult>
}

export interface AgentModelConfig {
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
  stream: boolean
}

export type AgentRunEvent =
  | {
      type: 'run_started'
      runId: string
    }
  | {
      type: 'assistant_delta'
      contentDelta: string
      accumulatedContent: string
    }
  | {
      type: 'assistant_message'
      content: string
    }
  | {
      type: 'tool_started'
      toolCall: ToolCall
      tool: ToolDefinition
    }
  | {
      type: 'tool_confirmation_required'
      toolCall: ToolCall
      tool: ToolDefinition
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
  | {
      type: 'run_aborted'
    }
  | {
      type: 'run_completed'
      content: string
      usedTools: boolean
      fellBackWithoutTools: boolean
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
  onContentDelta?: (delta: { contentDelta: string; accumulatedContent: string }) => void
}

export type ChatCompletionClient = (request: ChatCompletionRequest) => Promise<ChatCompletionResult>
