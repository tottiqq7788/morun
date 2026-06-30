import { describe, expect, it, vi } from 'vitest'
import { createSearchTools, parseTavilySearchArgs } from './searchTools'

describe('tavily_search args', () => {
  it('applies defaults', () => {
    expect(parseTavilySearchArgs({ query: ' OpenAI latest updates ' })).toEqual({
      query: 'OpenAI latest updates',
      searchDepth: 'advanced',
      maxResults: 5,
    })
  })

  it('rejects invalid args', () => {
    expect(() => parseTavilySearchArgs({ query: '' })).toThrow('query')
    expect(() => parseTavilySearchArgs({ query: 'news', searchDepth: 'deep' })).toThrow('searchDepth')
    expect(() => parseTavilySearchArgs({ query: 'news', maxResults: 0 })).toThrow('maxResults')
    expect(() => parseTavilySearchArgs({ query: 'news', maxResults: 21 })).toThrow('maxResults')
  })
})

describe('tavily_search tool', () => {
  it('fails clearly when API key is missing', async () => {
    const [tool] = createSearchTools({
      resolveApiKey: async () => '',
    })

    await expect(tool.execute({ query: 'latest news' }, {})).rejects.toThrow('请先在设置中配置 Tavily API Key')
  })

  it('posts to Tavily and returns answer with sources', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          query: 'OpenAI updates',
          answer: 'OpenAI released an update.',
          response_time: 1.2,
          request_id: 'req_123',
          usage: { credits: 1 },
          results: [
            {
              title: 'OpenAI News',
              url: 'https://example.com/openai',
              content: 'A concise source snippet.',
              score: 0.98,
              published_date: '2026-06-30',
              favicon: 'https://example.com/favicon.ico',
            },
          ],
        }),
        { status: 200 },
      ),
    )
    const [tool] = createSearchTools({
      resolveApiKey: async () => 'test-key',
      fetchImpl,
    })

    const result = await tool.execute({ query: 'OpenAI updates', searchDepth: 'basic', maxResults: 3 }, {})

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.tavily.com/search',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          query: 'OpenAI updates',
          search_depth: 'basic',
          max_results: 3,
          include_answer: true,
          include_raw_content: false,
        }),
      }),
    )
    expect(result.text).toContain('答案：OpenAI released an update.')
    expect(result.text).toContain('1. OpenAI News')
    expect(result.data).toMatchObject({
      query: 'OpenAI updates',
      answer: 'OpenAI released an update.',
      requestId: 'req_123',
      usage: { credits: 1 },
      results: [
        {
          title: 'OpenAI News',
          url: 'https://example.com/openai',
          content: 'A concise source snippet.',
        },
      ],
    })
    expect(tool).toMatchObject({
      name: 'tavily_search',
      source: 'network',
      riskLevel: 'low',
      permission: 'network',
      requiresConfirmation: false,
      confirmationPolicy: 'auto',
    })
  })

  it('formats HTTP errors', async () => {
    const [tool] = createSearchTools({
      resolveApiKey: async () => 'bad-key',
      fetchImpl: async () =>
        new Response(JSON.stringify({ detail: { error: 'Unauthorized: missing or invalid API key.' } }), {
          status: 401,
        }),
    })

    await expect(tool.execute({ query: 'OpenAI' }, {})).rejects.toThrow(
      'Tavily 检索失败（HTTP 401）：Unauthorized: missing or invalid API key.',
    )
  })

  it('formats invalid JSON and network errors', async () => {
    const invalidJsonTool = createSearchTools({
      resolveApiKey: async () => 'test-key',
      fetchImpl: async () => new Response('not json', { status: 200 }),
    })[0]
    await expect(invalidJsonTool.execute({ query: 'OpenAI' }, {})).rejects.toThrow('无效 JSON')

    const networkTool = createSearchTools({
      resolveApiKey: async () => 'test-key',
      fetchImpl: async () => {
        throw new Error('network down')
      },
    })[0]
    await expect(networkTool.execute({ query: 'OpenAI' }, {})).rejects.toThrow('network down')
  })

  it('preserves abort errors so generation can stop cleanly', async () => {
    const abortError = new DOMException('Aborted', 'AbortError')
    const [tool] = createSearchTools({
      resolveApiKey: async () => 'test-key',
      fetchImpl: async () => {
        throw abortError
      },
    })

    await expect(tool.execute({ query: 'OpenAI' }, {})).rejects.toBe(abortError)
  })
})
