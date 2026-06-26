import { describe, expect, it } from 'vitest'
import type { StorageLike } from '../agent/types'
import {
  legacyConfigKey,
  legacySessionsKey,
  loadConfig,
  loadSessions,
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
