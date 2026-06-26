import type {
  AgentMessage,
  ChatCompletionClient,
  ChatCompletionRequest,
  ChatCompletionResult,
  ToolCall,
  ToolDefinition,
} from './types'

interface ProviderToolCall {
  id?: string
  type?: string
  function?: {
    name?: string
    arguments?: string
  }
}

interface ProviderMessage {
  role?: string
  content?: string | null
  tool_calls?: ProviderToolCall[]
  function_call?: {
    name?: string
    arguments?: string
  }
}

export class UnsupportedToolsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedToolsError'
  }
}

export const requestChatCompletion: ChatCompletionClient = async (request) => {
  const response = await fetch(`${trimTrailingSlash(request.modelConfig.baseUrl)}/chat/completions`, {
    method: 'POST',
    signal: request.signal,
    headers: {
      'Content-Type': 'application/json',
      ...(request.modelConfig.apiKey.trim() ? { Authorization: `Bearer ${request.modelConfig.apiKey.trim()}` } : {}),
    },
    body: JSON.stringify(buildRequestBody(request)),
  })

  if (!response.ok) {
    const detail = await response.text()
    if (request.useTools && looksLikeUnsupportedToolsError(response.status, detail)) {
      throw new UnsupportedToolsError(detail || `HTTP ${response.status}`)
    }
    throw new Error(detail || `HTTP ${response.status}`)
  }

  const payload = await response.json()
  return parseChatCompletion(payload)
}

function buildRequestBody(request: ChatCompletionRequest) {
  return {
    model: request.modelConfig.model,
    messages: request.messages.map(toProviderMessage),
    temperature: Number(request.modelConfig.temperature),
    max_tokens: Number(request.modelConfig.maxTokens) || undefined,
    stream: false,
    ...(request.useTools && request.tools.length
      ? {
          tools: request.tools.map(toProviderTool),
          tool_choice: 'auto',
        }
      : {}),
  }
}

function toProviderMessage(message: AgentMessage) {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: message.toolCallId,
      name: message.toolName,
      content: message.content,
    }
  }

  return {
    role: message.role,
    content: message.content,
    ...(message.toolCalls?.length
      ? {
          tool_calls: message.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            type: 'function',
            function: {
              name: toolCall.name,
              arguments: toolCall.rawArguments,
            },
          })),
        }
      : {}),
  }
}

function toProviderTool(tool: ToolDefinition) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }
}

function parseChatCompletion(payload: unknown): ChatCompletionResult {
  const message = (payload as { choices?: Array<{ message?: ProviderMessage }> })?.choices?.[0]?.message ?? {}
  const content = typeof message.content === 'string' ? message.content : ''
  const toolCalls = parseToolCalls(message)

  return {
    content,
    toolCalls,
  }
}

function parseToolCalls(message: ProviderMessage): ToolCall[] {
  if (Array.isArray(message.tool_calls)) {
    return message.tool_calls
      .map((call, index): ToolCall | null => {
        const name = call.function?.name
        if (!name) return null
        const rawArguments = call.function?.arguments ?? '{}'

        return {
          id: call.id || `tool_call_${index + 1}`,
          name,
          rawArguments,
          arguments: parseToolArguments(rawArguments),
        }
      })
      .filter((call): call is ToolCall => Boolean(call))
  }

  const legacyFunctionCall = message.function_call
  if (legacyFunctionCall?.name) {
    const rawArguments = legacyFunctionCall.arguments ?? '{}'
    return [
      {
        id: 'function_call_1',
        name: legacyFunctionCall.name,
        rawArguments,
        arguments: parseToolArguments(rawArguments),
      },
    ]
  }

  return []
}

function parseToolArguments(rawArguments: string): unknown {
  try {
    return JSON.parse(rawArguments || '{}')
  } catch {
    return rawArguments
  }
}

function looksLikeUnsupportedToolsError(status: number, detail: string) {
  if (![400, 404, 422].includes(status)) return false

  const normalized = detail.toLowerCase()
  const mentionsTools = /tool|tools|function_call|functions|tool_choice/.test(normalized)
  const mentionsUnsupported = /unsupported|not support|unknown|invalid|unrecognized|unexpected|extra|does not support/.test(
    normalized,
  )

  return mentionsTools && mentionsUnsupported
}

function trimTrailingSlash(value: string) {
  return value.trim().replace(/\/+$/, '')
}
