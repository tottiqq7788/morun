import type { ToolDefinition, ToolExecutionResult } from './types'

type TavilySearchDepth = 'basic' | 'advanced'

export interface SearchToolsContext {
  resolveApiKey: () => Promise<string>
  fetchImpl?: typeof fetch
}

interface TavilySearchRequest {
  query: string
  searchDepth: TavilySearchDepth
  maxResults: number
}

interface TavilySearchResult {
  title: string
  url: string
  content: string
  score?: number
  publishedDate?: string
  favicon?: string
}

interface TavilySearchResponse {
  answer?: string
  query?: string
  response_time?: number
  request_id?: string
  usage?: {
    credits?: number
  }
  results?: Array<{
    title?: unknown
    url?: unknown
    content?: unknown
    score?: unknown
    published_date?: unknown
    favicon?: unknown
  }>
}

const tavilySearchUrl = 'https://api.tavily.com/search'
const defaultSearchDepth: TavilySearchDepth = 'advanced'
const defaultMaxResults = 5

export function createSearchTools(options: SearchToolsContext): ToolDefinition[] {
  return [
    {
      name: 'tavily_search',
      description: '使用 Tavily 进行联网检索，获取实时信息、摘要答案和来源链接。',
      source: 'network',
      riskLevel: 'low',
      permission: 'network',
      requiresConfirmation: false,
      confirmationPolicy: 'auto',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '要检索的问题或关键词。',
          },
          searchDepth: {
            type: 'string',
            enum: ['basic', 'advanced'],
            description: '检索深度，默认 advanced。',
          },
          maxResults: {
            type: 'number',
            description: '返回来源数量，范围 1 到 20，默认 5。',
            minimum: 1,
            maximum: 20,
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
      execute: async (args, context) => executeTavilySearch(options, parseTavilySearchArgs(args), context.signal),
    },
  ]
}

export function parseTavilySearchArgs(args: unknown): TavilySearchRequest {
  const record = asRecord(args)
  const query = typeof record.query === 'string' ? record.query.trim() : ''
  if (!query) {
    throw new Error('query 必须是非空字符串。')
  }

  const searchDepth = parseSearchDepth(record.searchDepth)
  const maxResults = parseMaxResults(record.maxResults)

  return {
    query: query.slice(0, 500),
    searchDepth,
    maxResults,
  }
}

async function executeTavilySearch(
  options: SearchToolsContext,
  request: TavilySearchRequest,
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  const apiKey = (await options.resolveApiKey()).trim()
  if (!apiKey) {
    throw new Error('请先在设置中配置 Tavily API Key。')
  }

  const fetchImpl = options.fetchImpl ?? fetch
  let response: Response
  try {
    response = await fetchImpl(tavilySearchUrl, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: request.query,
        search_depth: request.searchDepth,
        max_results: request.maxResults,
        include_answer: true,
        include_raw_content: false,
      }),
    })
  } catch (error) {
    throw new Error(`Tavily 检索请求失败：${formatErrorMessage(error)}`)
  }

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Tavily 检索失败（HTTP ${response.status}）：${extractErrorDetail(text)}`)
  }

  let payload: TavilySearchResponse
  try {
    payload = JSON.parse(text) as TavilySearchResponse
  } catch {
    throw new Error('Tavily 返回了无效 JSON。')
  }

  const results = normalizeResults(payload.results)
  const answer = typeof payload.answer === 'string' ? payload.answer.trim() : ''

  return {
    text: formatTavilySearchText(answer, results),
    data: {
      query: typeof payload.query === 'string' && payload.query.trim() ? payload.query : request.query,
      answer,
      results,
      responseTime: typeof payload.response_time === 'number' ? payload.response_time : undefined,
      requestId: typeof payload.request_id === 'string' ? payload.request_id : undefined,
      usage: payload.usage,
    },
  }
}

function parseSearchDepth(value: unknown): TavilySearchDepth {
  if (value === undefined || value === null || value === '') return defaultSearchDepth
  if (value === 'basic' || value === 'advanced') return value
  throw new Error('searchDepth 必须是 basic 或 advanced。')
}

function parseMaxResults(value: unknown) {
  if (value === undefined || value === null || value === '') return defaultMaxResults

  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
    throw new Error('maxResults 必须是 1 到 20 之间的整数。')
  }

  return parsed
}

function normalizeResults(value: TavilySearchResponse['results']): TavilySearchResult[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item): TavilySearchResult | null => {
      const title = typeof item.title === 'string' ? item.title.trim() : ''
      const url = typeof item.url === 'string' ? item.url.trim() : ''
      const content = typeof item.content === 'string' ? item.content.trim() : ''
      if (!title || !url) return null

      return {
        title,
        url,
        content,
        score: typeof item.score === 'number' ? item.score : undefined,
        publishedDate: typeof item.published_date === 'string' ? item.published_date : undefined,
        favicon: typeof item.favicon === 'string' ? item.favicon : undefined,
      }
    })
    .filter((item): item is TavilySearchResult => Boolean(item))
}

function formatTavilySearchText(answer: string, results: TavilySearchResult[]) {
  const lines = [
    answer ? `答案：${answer}` : '答案：Tavily 未返回直接答案。',
    results.length ? '来源：' : '来源：未返回来源。',
    ...results.map((result, index) => {
      const content = result.content ? `\n   ${truncate(result.content, 500)}` : ''
      return `${index + 1}. ${result.title}\n   ${result.url}${content}`
    }),
  ]

  return lines.join('\n')
}

function extractErrorDetail(value: string) {
  try {
    const parsed = JSON.parse(value) as { detail?: unknown; error?: unknown; message?: unknown }
    const detail = parsed.detail
    if (typeof detail === 'string') return truncate(detail, 300)
    if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
      const record = detail as Record<string, unknown>
      if (typeof record.error === 'string') return truncate(record.error, 300)
    }
    if (typeof parsed.error === 'string') return truncate(parsed.error, 300)
    if (typeof parsed.message === 'string') return truncate(parsed.message, 300)
  } catch {
    // Fall through to raw text.
  }

  return truncate(value.replace(/\s+/g, ' ').trim() || '未知错误', 300)
}

function formatErrorMessage(error: unknown) {
  return error instanceof Error ? truncate(error.message, 180) : truncate(String(error), 180)
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
