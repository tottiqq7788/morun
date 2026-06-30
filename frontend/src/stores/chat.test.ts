import { describe, expect, it } from 'vitest'
import type { StorageLike } from '../agent/types'
import {
  defaultConfig,
  legacyConfigKey,
  legacySessionsKey,
  buildAgentMessages,
  loadConfig,
  loadSessions,
  removeModelAccountConfig,
  sessionsKey,
  useChatStore,
  type ChatMessage,
  type ModelConfig,
  type ChatSession,
} from './chat'

describe('chat store persistence', () => {
  it('loads legacy sessions and localizes the old default title', () => {
    const storage = createMemoryStorage({
      [legacySessionsKey]: JSON.stringify([
        {
          id: 'session_1',
          title: 'New chat',
          createdAt: 1,
          updatedAt: 1,
          messages: [],
        },
      ]),
    })

    const sessions = loadSessions(storage)

    expect(sessions).toHaveLength(1)
    expect(sessions[0].title).toBe('新会话')
  })

  it('normalizes malformed stored sessions instead of returning broken records', () => {
    const storage = createMemoryStorage({
      [sessionsKey]: JSON.stringify([
        {
          id: 'session_without_messages',
          title: 'New chat',
          createdAt: 1,
          updatedAt: 2,
          titleGeneratedTurnCounts: [15, 'bad', 5, 5, -1],
        },
        {
          id: 'session_with_bad_messages',
          title: '',
          messages: [
            {
              id: 'message_1',
              role: 'assistant',
              content: 42,
              createdAt: 'bad',
              status: 'unknown',
            },
            {
              id: 'message_2',
              role: 'unknown',
              content: 'drop me',
              createdAt: 3,
              status: 'complete',
            },
          ],
        },
      ]),
    })

    const sessions = loadSessions(storage)

    expect(sessions).toHaveLength(2)
    expect(sessions[0]).toMatchObject({
      id: 'session_without_messages',
      title: '新会话',
      titleGeneratedTurnCounts: [5, 15],
      messages: [],
    })
    expect(sessions[1].title).toBe('新会话')
    expect(sessions[1].messages).toHaveLength(1)
    expect(sessions[1].messages[0]).toMatchObject({
      id: 'message_1',
      role: 'assistant',
      content: '',
      status: 'error',
      error: '模型没有返回内容。',
    })
    expect(typeof sessions[1].messages[0].createdAt).toBe('number')
  })

  it('normalizes stored empty assistant replies as errors without changing other messages', () => {
    const storage = createMemoryStorage({
      [sessionsKey]: JSON.stringify([
        {
          id: 'session_1',
          title: 'Empty assistant',
          createdAt: 1,
          updatedAt: 2,
          messages: [
            {
              id: 'message_user',
              role: 'user',
              content: 'hello',
              createdAt: 3,
              status: 'complete',
            },
            {
              id: 'message_empty_assistant',
              role: 'assistant',
              content: '   ',
              createdAt: 4,
              status: 'streaming',
            },
            {
              id: 'message_normal_assistant',
              role: 'assistant',
              content: 'world',
              createdAt: 5,
              status: 'complete',
            },
            {
              id: 'message_tool',
              role: 'tool',
              content: '',
              createdAt: 6,
              status: 'complete',
            },
          ],
        },
      ]),
    })

    const [session] = loadSessions(storage)

    expect(session.messages[0]).toMatchObject({
      id: 'message_user',
      role: 'user',
      content: 'hello',
      status: 'complete',
    })
    expect(session.messages[1]).toMatchObject({
      id: 'message_empty_assistant',
      role: 'assistant',
      content: '   ',
      status: 'error',
      error: '模型没有返回内容。',
    })
    expect(session.messages[2]).toMatchObject({
      id: 'message_normal_assistant',
      role: 'assistant',
      content: 'world',
      status: 'complete',
    })
    expect(session.messages[3]).toMatchObject({
      id: 'message_tool',
      role: 'tool',
      content: '',
      status: 'complete',
    })
  })

  it('normalizes stored media attachments', () => {
    const storage = createMemoryStorage({
      [sessionsKey]: JSON.stringify([
        {
          id: 'session_media',
          title: 'Media',
          createdAt: 1,
          updatedAt: 2,
          messages: [
            {
              id: 'message_media',
              role: 'assistant',
              content: '![photo](morun-media://media_test123)',
              createdAt: 3,
              status: 'complete',
              mediaAttachments: [
                {
                  mediaId: 'media_test123',
                  kind: 'image',
                  originalSource: 'https://example.com/photo.jpg',
                  localPath: '/data/user/0/com.morun.app/files/morun-media/media_test123.jpg',
                  mimeType: 'image/jpeg',
                  fileName: 'media_test123.jpg',
                  size: 100,
                  createdAt: 4,
                },
                {
                  mediaId: 'bad',
                  kind: 'image',
                  originalSource: 'bad',
                  localPath: '/tmp/bad.svg',
                  mimeType: 'image/svg+xml',
                  fileName: 'bad.svg',
                  size: 100,
                  createdAt: 4,
                },
              ],
            },
          ],
        },
      ]),
    })

    const [session] = loadSessions(storage)

    expect(session.messages[0].mediaAttachments).toHaveLength(1)
    expect(session.messages[0].mediaAttachments?.[0]).toMatchObject({
      mediaId: 'media_test123',
      kind: 'image',
      mimeType: 'image/jpeg',
    })
  })

  it('normalizes stored voice attachments for user messages', () => {
    const storage = createMemoryStorage({
      [sessionsKey]: JSON.stringify([
        {
          id: 'session_voice',
          title: 'Voice',
          createdAt: 1,
          updatedAt: 2,
          messages: [
            {
              id: 'message_voice',
              role: 'user',
              content: '今天天气怎么样',
              createdAt: 3,
              status: 'complete',
              voice: {
                voiceId: 'voice_test123',
                localPath: '/data/user/0/com.morun.app/files/morun-voice/voice_test123.wav',
                fileName: 'voice_test123.wav',
                mimeType: 'audio/wav',
                size: 1024,
                durationMs: 1800,
                sampleRate: 16000,
                transcript: '今天天气怎么样',
                recognitionElapsedMs: 220,
                createdAt: 3,
                segments: [{ text: '今天天气怎么样', raw: '{"text":"今天天气怎么样"}' }],
              },
            },
            {
              id: 'message_bad_voice',
              role: 'user',
              content: 'bad',
              createdAt: 4,
              status: 'complete',
              voice: {
                voiceId: 'bad',
                localPath: '/tmp/voice.wav',
                fileName: 'bad.wav',
                mimeType: 'audio/mpeg',
                size: 1024,
                durationMs: 1800,
                sampleRate: 16000,
                transcript: 'bad',
                recognitionElapsedMs: 220,
              },
            },
          ],
        },
      ]),
    })

    const [session] = loadSessions(storage)

    expect(session.messages[0].voice).toMatchObject({
      voiceId: 'voice_test123',
      mimeType: 'audio/wav',
      transcript: '今天天气怎么样',
      durationMs: 1800,
      recognitionElapsedMs: 220,
    })
    expect(session.messages[0].voice?.segments).toEqual([{ text: '今天天气怎么样', raw: '{"text":"今天天气怎么样"}' }])
    expect(session.messages[1].voice).toBeUndefined()
  })

  it('settles interrupted in-flight messages when loading persisted sessions', () => {
    const storage = createMemoryStorage({
      [sessionsKey]: JSON.stringify([
        {
          id: 'session_1',
          title: 'Interrupted',
          createdAt: 1,
          updatedAt: 2,
          messages: [
            {
              id: 'message_streaming',
              role: 'assistant',
              content: 'partial',
              createdAt: 3,
              status: 'streaming',
            },
            {
              id: 'message_tool',
              role: 'tool',
              content: '',
              createdAt: 4,
              status: 'streaming',
              toolStatus: 'running',
            },
          ],
        },
      ]),
    })

    const [session] = loadSessions(storage)

    expect(session.messages[0]).toMatchObject({
      id: 'message_streaming',
      status: 'error',
      error: '上次生成已中断。',
    })
    expect(session.messages[1]).toMatchObject({
      id: 'message_tool',
      status: 'error',
      toolStatus: 'error',
      content: '工具执行已中断。',
      toolError: '工具执行已中断。',
    })
  })

  it('loads a legacy single-account model config', () => {
    const storage = createMemoryStorage({
      [legacyConfigKey]: JSON.stringify({
        providerId: 'deepseek',
        apiKey: 'secret',
        model: 'deepseek-chat',
      }),
    })

    const config = loadConfig(storage)

    expect(config.accounts).toHaveLength(1)
    expect(config.activeAccountId).toBe('account_deepseek_legacy')
    expect(config.accounts[0]).toMatchObject({
      providerId: 'deepseek',
      apiKey: 'secret',
      model: 'deepseek-chat',
    })
  })

  it('preserves secure API key references in stored model accounts', () => {
    const storage = createMemoryStorage({
      [legacyConfigKey]: JSON.stringify({
        accounts: [
          {
            id: 'account_secure',
            providerId: 'deepseek',
            name: 'Secure account',
            apiKey: '',
            apiKeyRef: 'modelAccount:account_secure:apiKey',
            model: 'deepseek-chat',
            availableModels: [],
          },
        ],
        activeAccountId: 'account_secure',
      }),
    })

    const config = loadConfig(storage)

    expect(config.accounts[0]).toMatchObject({
      id: 'account_secure',
      apiKey: '',
      apiKeyRef: 'modelAccount:account_secure:apiKey',
    })
  })

  it('removes inactive model accounts without changing the active account', () => {
    const config = createModelConfig('account_1')

    const nextConfig = removeModelAccountConfig(config, 'account_2')

    expect(nextConfig.accounts.map((account) => account.id)).toEqual(['account_1', 'account_3'])
    expect(nextConfig.activeAccountId).toBe('account_1')
  })

  it('selects the next or previous account after deleting the active account', () => {
    const deleteMiddle = removeModelAccountConfig(createModelConfig('account_2'), 'account_2')
    const deleteLast = removeModelAccountConfig(createModelConfig('account_3'), 'account_3')

    expect(deleteMiddle.accounts.map((account) => account.id)).toEqual(['account_1', 'account_3'])
    expect(deleteMiddle.activeAccountId).toBe('account_3')
    expect(deleteLast.accounts.map((account) => account.id)).toEqual(['account_1', 'account_2'])
    expect(deleteLast.activeAccountId).toBe('account_2')
  })

  it('allows deleting the final model account', () => {
    const config = createModelConfig('account_1')
    const singleAccountConfig: ModelConfig = {
      ...config,
      accounts: [config.accounts[0]],
    }

    const nextConfig = removeModelAccountConfig(singleAccountConfig, 'account_1')

    expect(nextConfig.accounts).toEqual([])
    expect(nextConfig.activeAccountId).toBe('')
  })

  it('creates, selects, and deletes sessions without leaving an empty store', () => {
    const store = useChatStore(createMemoryStorage())
    const originalSessionId = store.activeSessionId.value

    const created = store.createSession()
    expect(store.activeSessionId.value).toBe(created.id)
    expect(store.sessions.value).toHaveLength(2)

    store.selectSession(originalSessionId)
    expect(store.activeSession.value?.id).toBe(originalSessionId)

    store.deleteSession(originalSessionId)
    expect(store.sessions.value).toHaveLength(1)
    expect(store.activeSessionId.value).toBe(created.id)

    store.deleteSession(created.id)
    expect(store.sessions.value).toHaveLength(1)
    expect(store.activeSession.value).not.toBeNull()
  })
})

describe('agent message context', () => {
  it('strongly annotates historical turns and keeps the latest user message current', () => {
    const session = createSession([
      createMessage({
        id: 'u1',
        role: 'user',
        content: '我现在在哪里？',
        createdAt: 1,
      }),
      createMessage({
        id: 't1',
        role: 'tool',
        content: 'Termux 命令超时：termux-location -p network',
        createdAt: 2,
        status: 'error',
        toolName: 'termux_location',
        toolArgs: { action: 'get', provider: 'network' },
        toolStatus: 'error',
        toolDuration: 31,
        toolError: 'Termux 命令超时：termux-location -p network',
      }),
      createMessage({
        id: 'a1',
        role: 'assistant',
        content: '三种定位都超时，暂时无法获取你的位置。',
        createdAt: 3,
      }),
      createMessage({
        id: 'u2',
        role: 'user',
        content: '我已经开启了权限，你再试试',
        createdAt: 4,
      }),
      createMessage({
        id: 'a2',
        role: 'assistant',
        content: '',
        createdAt: 5,
        status: 'streaming',
      }),
    ])

    const messages = buildAgentMessages(session, 'a2', '你是手机助手。')
    const history = messages.find((message) => message.role === 'system' && message.content.includes('历史对话索引'))

    expect(messages.map((message) => message.role)).toEqual(['system', 'system', 'user'])
    expect(history?.content).toContain('第 1 轮（历史记录，仅代表当时状态')
    expect(history?.content).toContain('用户问题：我现在在哪里？')
    expect(history?.content).toContain('工具调用：termux_location')
    expect(history?.content).toContain('工具参数：{"action":"get","provider":"network"}')
    expect(history?.content).toContain('工具状态：失败')
    expect(history?.content).toContain('工具错误（当时失败）：Termux 命令超时')
    expect(history?.content).toContain('助手回复：三种定位都超时')
    expect(history?.content).not.toContain('我已经开启了权限')
    expect(messages.at(-1)).toEqual({
      role: 'user',
      content: '我已经开启了权限，你再试试',
    })
    expect(messages.some((message) => message.role === 'tool')).toBe(false)
  })

  it('sends only the voice transcript text to the agent model', () => {
    const session = createSession([
      createMessage({
        id: 'u1',
        role: 'user',
        content: '明天提醒我买牛奶',
        createdAt: 1,
        voice: {
          voiceId: 'voice_test123',
          localPath: '/data/user/0/com.morun.app/files/morun-voice/voice_test123.wav',
          fileName: 'voice_test123.wav',
          mimeType: 'audio/wav',
          size: 1200,
          durationMs: 2100,
          sampleRate: 16000,
          transcript: '明天提醒我买牛奶',
          recognitionElapsedMs: 300,
          createdAt: 1,
        },
      }),
      createMessage({ id: 'a1', role: 'assistant', content: '', createdAt: 2, status: 'streaming' }),
    ])

    const messages = buildAgentMessages(session, 'a1', '')

    expect(messages.at(-1)).toEqual({
      role: 'user',
      content: '明天提醒我买牛奶',
    })
  })

  it('marks history as explainable when the current user only asks why it failed', () => {
    const session = createSession([
      createMessage({ id: 'u1', role: 'user', content: '定位一下', createdAt: 1 }),
      createMessage({
        id: 't1',
        role: 'tool',
        content: 'Termux 命令超时',
        createdAt: 2,
        status: 'error',
        toolName: 'termux_location',
        toolStatus: 'error',
        toolError: 'Termux 命令超时',
      }),
      createMessage({ id: 'a1', role: 'assistant', content: '定位失败。', createdAt: 3 }),
      createMessage({ id: 'u2', role: 'user', content: '刚才为什么失败？', createdAt: 4 }),
      createMessage({ id: 'a2', role: 'assistant', content: '', createdAt: 5, status: 'streaming' }),
    ])

    const history = buildAgentMessages(session, 'a2', '').find((message) => message.role === 'system')?.content ?? ''

    expect(history).toContain('如果用户只是询问历史原因，可以基于历史记录解释')
    expect(history).toContain('工具错误（当时失败）：Termux 命令超时')
  })

  it('truncates long tool results in the historical index', () => {
    const session = createSession([
      createMessage({ id: 'u1', role: 'user', content: '查资料', createdAt: 1 }),
      createMessage({
        id: 't1',
        role: 'tool',
        content: '',
        createdAt: 2,
        toolName: 'tavily_search',
        toolStatus: 'done',
        toolResult: {
          answer: `${'长结果'.repeat(700)}结尾`,
        },
      }),
      createMessage({ id: 'u2', role: 'user', content: '继续', createdAt: 3 }),
      createMessage({ id: 'a2', role: 'assistant', content: '', createdAt: 4, status: 'streaming' }),
    ])

    const history = buildAgentMessages(session, 'a2', '').find((message) => message.role === 'system')?.content ?? ''

    expect(history).toContain('工具结果摘要（当时结果）：')
    expect(history).toContain('已截断')
    expect(history).not.toContain('结尾')
  })
})

function createMemoryStorage(initial: Record<string, string> = {}): StorageLike {
  const data = new Map(Object.entries(initial))

  return {
    getItem(key) {
      return data.get(key) ?? null
    },
    setItem(key, value) {
      data.set(key, value)
    },
    removeItem(key) {
      data.delete(key)
    },
  }
}

function createModelConfig(activeAccountId: string): ModelConfig {
  return {
    ...defaultConfig,
    activeAccountId,
    accounts: [
      createModelAccount('account_1', 'DeepSeek', 'deepseek-chat'),
      createModelAccount('account_2', 'OpenAI', 'gpt-5'),
      createModelAccount('account_3', 'Kimi', 'moonshot-v1-8k'),
    ],
  }
}

function createModelAccount(id: string, name: string, model: string): ModelConfig['accounts'][number] {
  return {
    id,
    providerId: 'deepseek',
    name,
    apiKey: `key-${id}`,
    model,
    availableModels: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

function createSession(messages: ChatMessage[]): ChatSession {
  return {
    id: 'session_test',
    title: '测试会话',
    createdAt: 1,
    updatedAt: 1,
    titleGeneratedTurnCounts: [],
    messages,
  }
}

function createMessage(patch: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'role' | 'content'>): ChatMessage {
  return {
    createdAt: 1,
    status: 'complete',
    ...patch,
  }
}
