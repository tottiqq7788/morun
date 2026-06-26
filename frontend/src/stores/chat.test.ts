import { describe, expect, it } from 'vitest'
import type { StorageLike } from '../agent/types'
import {
  legacyConfigKey,
  legacySessionsKey,
  loadConfig,
  loadSessions,
  sessionsKey,
  useChatStore,
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
      messages: [],
    })
    expect(sessions[1].title).toBe('新会话')
    expect(sessions[1].messages).toHaveLength(1)
    expect(sessions[1].messages[0]).toMatchObject({
      id: 'message_1',
      role: 'assistant',
      content: '',
      status: 'complete',
    })
    expect(typeof sessions[1].messages[0].createdAt).toBe('number')
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
