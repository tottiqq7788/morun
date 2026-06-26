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
  index?: number
  function?: {
    name?: string
    arguments?: string
  }
}

interface ProviderDelta {
  content?: string | null
  tool_calls?: ProviderToolCall[]
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

  if (request.modelConfig.stream) {
    return parseStreamingChatCompletion(response, request)
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
    stream: request.modelConfig.stream,
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

async function parseStreamingChatCompletion(
  response: Response,
  request: ChatCompletionRequest,
): Promise<ChatCompletionResult> {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('当前环境不支持流式响应。')
  }

  const decoder = new TextDecoder()
  const toolStates = new Map<number, { id: string; name: string; rawArguments: string }>()
  let buffer = ''
  let content = ''
  let done = false
  let sawSseData = false

  while (!done) {
    const { value, done: streamDone } = await reader.read()
    if (streamDone) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const data = parseSseDataLine(line)
      if (data === null) continue
      sawSseData = true
      if (data === '[DONE]') {
        done = true
        break
      }

      const delta = parseStreamingDelta(data)
      if (!delta) continue

      if (delta.content) {
        content += delta.content
        request.onContentDelta?.({
          contentDelta: delta.content,
          accumulatedContent: content,
        })
      }

      for (const toolCall of delta.tool_calls ?? []) {
        const index = typeof toolCall.index === 'number' ? toolCall.index : toolStates.size
        const existing = toolStates.get(index) ?? {
          id: `tool_call_${index + 1}`,
          name: '',
          rawArguments: '',
        }

        existing.id = toolCall.id || existing.id
        existing.name = toolCall.function?.name || existing.name
        existing.rawArguments += toolCall.function?.arguments ?? ''
        toolStates.set(index, existing)
      }
    }
  }

  if (buffer.trim()) {
    const data = parseSseDataLine(buffer)
    if (data && data !== '[DONE]') {
      sawSseData = true
      const delta = parseStreamingDelta(data)
      if (delta?.content) {
        content += delta.content
        request.onContentDelta?.({
          contentDelta: delta.content,
          accumulatedContent: content,
        })
      }
    }
  }

  if (!sawSseData) {
    throw new Error('流式响应格式无效。')
  }

  return {
    content,
    toolCalls: Array.from(toolStates.entries())
      .sort(([left], [right]) => left - right)
      .map(([, state]) => ({
        id: state.id,
        name: state.name,
        rawArguments: state.rawArguments || '{}',
        arguments: parseToolArguments(state.rawArguments || '{}'),
      }))
      .filter((toolCall) => toolCall.name),
  }
}

function parseSseDataLine(line: string) {
  const trimmed = line.trim()
  if (!trimmed || !trimmed.startsWith('data:')) return null
  return trimmed.slice(5).trim()
}

function parseStreamingDelta(data: string): ProviderDelta | null {
  try {
    return ((JSON.parse(data) as { choices?: Array<{ delta?: ProviderDelta }> }).choices?.[0]?.delta ?? null)
  } catch {
    return null
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
