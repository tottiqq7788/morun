import { computed, ref, watch } from 'vue'
import type { AgentMessage, StorageLike } from '../agent/types'

export type Role = 'user' | 'assistant' | 'tool'
export type MessageStatus = 'complete' | 'streaming' | 'error'
export type ToolStatus = 'running' | 'done' | 'error'

export interface ChatMessage {
  id: string
  role: Role
  content: string
  createdAt: number
  status: MessageStatus
  error?: string
  toolName?: string
  toolCallId?: string
  toolArgs?: unknown
  toolResult?: unknown
  toolStatus?: ToolStatus
  toolDuration?: number
  toolError?: string
}

export interface ChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
}

export interface ProviderPreset {
  id: string
  name: string
  baseUrl: string
  description: string
  apiKeyLabel: string
  requiresApiKey: boolean
  models: string[]
}

export interface ModelAccount {
  id: string
  providerId: string
  name: string
  apiKey: string
  apiKeyRef?: string
  model: string
  availableModels: string[]
  createdAt: number
  updatedAt: number
  lastTestedAt?: number
}

export interface ModelConfig {
  activeAccountId: string
  accounts: ModelAccount[]
  temperature: number
  maxTokens: number
  systemPrompt: string
  stream: boolean
}

export const sessionsKey = 'morun.sessions.v1'
export const legacySessionsKey = 'family-agent.sessions.v1'
export const configKey = 'morun.model-config.v2'
export const legacyConfigKey = 'family-agent.model-config.v2'
export const olderConfigKey = 'family-agent.model-config.v1'

const validRoles = new Set<Role>(['user', 'assistant', 'tool'])
const validMessageStatuses = new Set<MessageStatus>(['complete', 'streaming', 'error'])
const validToolStatuses = new Set<ToolStatus>(['running', 'done', 'error'])
const emptyAssistantReplyMessage = '模型没有返回内容。'

export const providerPresets: ProviderPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    description: '官方接口，适合 GPT 系列模型。',
    apiKeyLabel: 'OpenAI API Key',
    requiresApiKey: true,
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini'],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    description: '国产高性价比对话与推理模型。',
    apiKeyLabel: 'DeepSeek API Key',
    requiresApiKey: true,
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'dashscope',
    name: '通义千问 DashScope',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    description: '阿里云百炼兼容模式。',
    apiKeyLabel: 'DashScope API Key',
    requiresApiKey: true,
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen-long'],
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    description: '智谱开放平台兼容接口。',
    apiKeyLabel: '智谱 API Key',
    requiresApiKey: true,
    models: ['glm-4-plus', 'glm-4-air', 'glm-4-flash'],
  },
  {
    id: 'moonshot',
    name: 'Moonshot Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    description: '长上下文对话模型。',
    apiKeyLabel: 'Moonshot API Key',
    requiresApiKey: true,
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
  },
  {
    id: 'siliconflow',
    name: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    description: '聚合开源与商业模型。',
    apiKeyLabel: '硅基流动 API Key',
    requiresApiKey: true,
    models: ['Qwen/Qwen3-8B', 'deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1'],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    description: '多厂商模型聚合接口。',
    apiKeyLabel: 'OpenRouter API Key',
    requiresApiKey: true,
    models: ['openai/gpt-4o-mini', 'deepseek/deepseek-chat', 'anthropic/claude-3.5-sonnet'],
  },
  {
    id: 'ollama',
    name: 'Ollama 本地',
    baseUrl: 'http://localhost:11434/v1',
    description: '本地模型服务，适合开发调试。',
    apiKeyLabel: '接口密钥',
    requiresApiKey: false,
    models: ['llama3.1', 'qwen2.5', 'gemma2'],
  },
]

export const defaultConfig: ModelConfig = {
  activeAccountId: '',
  accounts: [],
  temperature: 0.7,
  maxTokens: 4096,
  systemPrompt: '你是一个运行在手机上的智能助手，回答要清晰、可靠、适合移动端阅读。需要时可以调用安全内置工具获取时间、计算、保存或检索本地记忆。',
  stream: true,
}

export function useChatStore(storage: StorageLike = localStorage) {
  const sessions = ref<ChatSession[]>(loadSessions(storage))
  const modelConfig = ref<ModelConfig>(loadConfig(storage))
  const activeSessionId = ref(sessions.value[0]?.id ?? '')

  const activeSession = computed(() => {
    return sessions.value.find((session) => session.id === activeSessionId.value) ?? null
  })

  const sortedSessions = computed(() => {
    return [...sessions.value].sort((a, b) => b.updatedAt - a.updatedAt)
  })

  const hasMessages = computed(() => {
    return Boolean(activeSession.value?.messages.length)
  })

  const activeModelAccount = computed(() => {
    const accounts = modelConfig.value.accounts
    return accounts.find((account) => account.id === modelConfig.value.activeAccountId) ?? accounts[0] ?? null
  })

  const selectedProvider = computed(() => {
    return activeModelAccount.value ? getProviderById(activeModelAccount.value.providerId) : null
  })

  const activeModelLabel = computed(() => {
    const account = activeModelAccount.value
    if (!account) return '未配置模型'

    return `${accountDisplayName(account)} · ${account.model || '未选择模型'}`
  })

  const activeModelInitial = computed(() => {
    const account = activeModelAccount.value
    const label = account?.model || account?.name || ''
    return label.trim().charAt(0).toUpperCase() || '?'
  })

  const activeModelValue = computed({
    get() {
      const account = activeModelAccount.value
      return account?.model ? makeModelValue(account.id, account.model) : ''
    },
    set(value: string) {
      const [accountId, model] = value.split('::')
      const account = modelConfig.value.accounts.find((item) => item.id === accountId)
      if (!account || !model) return

      modelConfig.value.activeAccountId = account.id
      account.model = model
      account.updatedAt = Date.now()
    },
  })

  watch(
    sessions,
    (value) => {
      storage.setItem(sessionsKey, JSON.stringify(value))
    },
    { deep: true },
  )

  watch(
    modelConfig,
    (value) => {
      storage.setItem(configKey, JSON.stringify(value))
    },
    { deep: true },
  )

  function createSession() {
    const session = createSessionModel()
    sessions.value.unshift(session)
    activeSessionId.value = session.id
    return session
  }

  function selectSession(id: string) {
    activeSessionId.value = id
  }

  function deleteSession(id: string) {
    if (sessions.value.length === 1) {
      sessions.value = [createSessionModel()]
      activeSessionId.value = sessions.value[0].id
      return
    }

    const index = sessions.value.findIndex((session) => session.id === id)
    sessions.value = sessions.value.filter((session) => session.id !== id)

    if (activeSessionId.value === id) {
      activeSessionId.value = sessions.value[Math.max(0, index - 1)]?.id ?? sessions.value[0].id
    }
  }

  function resetConfig() {
    modelConfig.value.systemPrompt = defaultConfig.systemPrompt
    modelConfig.value.temperature = defaultConfig.temperature
    modelConfig.value.maxTokens = defaultConfig.maxTokens
    modelConfig.value.stream = defaultConfig.stream
  }

  function saveConfig() {
    storage.setItem(configKey, JSON.stringify(modelConfig.value))
  }

  return {
    sessions,
    modelConfig,
    activeSessionId,
    activeSession,
    sortedSessions,
    hasMessages,
    activeModelAccount,
    selectedProvider,
    activeModelLabel,
    activeModelInitial,
    activeModelValue,
    createSession,
    selectSession,
    deleteSession,
    resetConfig,
    saveConfig,
  }
}

export function loadSessions(storage: StorageLike): ChatSession[] {
  const stored =
    safeParse<unknown>(storage.getItem(sessionsKey)) ??
    safeParse<unknown>(storage.getItem(legacySessionsKey))
  const sessions = normalizeSessions(stored)
  if (sessions.length) {
    return sessions
  }

  return [createSessionModel()]
}

export function loadConfig(storage: StorageLike): ModelConfig {
  const stored =
    safeParse<
      Partial<ModelConfig> & {
        providerId?: string
        providerName?: string
        baseUrl?: string
        apiKey?: string
        model?: string
        availableModels?: unknown
        lastTestedAt?: number
      }
    >(storage.getItem(configKey)) ??
    safeParse<
      Partial<ModelConfig> & {
        providerId?: string
        providerName?: string
        baseUrl?: string
        apiKey?: string
        model?: string
        availableModels?: unknown
        lastTestedAt?: number
      }
    >(storage.getItem(legacyConfigKey)) ??
    safeParse<
      Partial<ModelConfig> & {
        providerId?: string
        providerName?: string
        baseUrl?: string
        apiKey?: string
        model?: string
        availableModels?: unknown
        lastTestedAt?: number
      }
    >(storage.getItem(olderConfigKey))

  if (!stored) {
    return { ...defaultConfig, accounts: [] }
  }

  const accounts = normalizeAccounts(stored.accounts)
  if (!accounts.length && (stored.providerId || stored.providerName || stored.baseUrl || stored.model || stored.apiKey)) {
    accounts.push(createAccountFromLegacyConfig(stored))
  }

  const activeAccountId =
    typeof stored.activeAccountId === 'string' && accounts.some((account) => account.id === stored.activeAccountId)
      ? stored.activeAccountId
      : accounts[0]?.id ?? ''

  return {
    activeAccountId,
    accounts,
    temperature: typeof stored.temperature === 'number' ? stored.temperature : defaultConfig.temperature,
    maxTokens: typeof stored.maxTokens === 'number' ? stored.maxTokens : defaultConfig.maxTokens,
    systemPrompt: typeof stored.systemPrompt === 'string' ? stored.systemPrompt : defaultConfig.systemPrompt,
    stream: typeof stored.stream === 'boolean' ? stored.stream : defaultConfig.stream,
  }
}

export function safeParse<T>(value: string | null): T | null {
  if (!value) return null

  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

export function normalizeModels(value: unknown) {
  if (!Array.isArray(value)) return []

  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)))
}

export function normalizeSessions(value: unknown): ChatSession[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item): ChatSession | null => {
      const raw = asRecord(item)
      if (!raw) return null

      const now = Date.now()
      const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : '新会话'
      const createdAt = asFiniteNumber(raw.createdAt) ?? now

      return {
        id: typeof raw.id === 'string' && raw.id ? raw.id : createId('session'),
        title: title === 'New chat' ? '新会话' : title.slice(0, 80),
        createdAt,
        updatedAt: asFiniteNumber(raw.updatedAt) ?? createdAt,
        messages: normalizeMessages(raw.messages),
      }
    })
    .filter((session): session is ChatSession => Boolean(session))
}

function normalizeMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item): ChatMessage | null => {
      const raw = asRecord(item)
      const role = raw?.role
      if (!raw || !validRoles.has(role as Role)) return null
      const wasStreaming = raw.status === 'streaming'
      const rawToolStatus = validToolStatuses.has(raw.toolStatus as ToolStatus)
        ? (raw.toolStatus as ToolStatus)
        : undefined
      const wasRunningTool = rawToolStatus === 'running'

      const message: ChatMessage = {
        id: typeof raw.id === 'string' && raw.id ? raw.id : createId('message'),
        role: role as Role,
        content: typeof raw.content === 'string' ? raw.content : '',
        createdAt: asFiniteNumber(raw.createdAt) ?? Date.now(),
        status:
          wasStreaming || wasRunningTool
            ? 'error'
            : validMessageStatuses.has(raw.status as MessageStatus)
              ? (raw.status as MessageStatus)
              : 'complete',
      }

      if (typeof raw.error === 'string') message.error = raw.error
      else if (wasStreaming) message.error = '上次生成已中断。'
      if (typeof raw.toolName === 'string') message.toolName = raw.toolName
      if (typeof raw.toolCallId === 'string') message.toolCallId = raw.toolCallId
      if ('toolArgs' in raw) message.toolArgs = raw.toolArgs
      if ('toolResult' in raw) message.toolResult = raw.toolResult
      if (rawToolStatus) message.toolStatus = wasRunningTool ? 'error' : rawToolStatus
      if (asFiniteNumber(raw.toolDuration) !== undefined) message.toolDuration = asFiniteNumber(raw.toolDuration)
      if (typeof raw.toolError === 'string') message.toolError = raw.toolError
      else if (wasRunningTool) message.toolError = '工具执行已中断。'
      if (wasRunningTool && !message.content) message.content = message.toolError ?? '工具执行已中断。'
      if (
        message.role === 'assistant' &&
        !message.content.trim() &&
        typeof raw.error !== 'string'
      ) {
        message.status = 'error'
        message.error = emptyAssistantReplyMessage
      }

      return message
    })
    .filter((message): message is ChatMessage => Boolean(message))
}

export function normalizeAccounts(value: unknown): ModelAccount[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item): ModelAccount | null => {
      const raw = item as Partial<ModelAccount>
      if (typeof raw.providerId !== 'string') return null

      const provider = getProviderById(raw.providerId)
      if (provider.id !== raw.providerId) return null

      const availableModels = normalizeModels(raw.availableModels)
      const modelPool = availableModels.length ? availableModels : provider.models
      const storedModel = typeof raw.model === 'string' && modelPool.includes(raw.model) ? raw.model : ''
      const now = Date.now()

      return {
        id: typeof raw.id === 'string' && raw.id ? raw.id : createId('account'),
        providerId: provider.id,
        name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 80) : provider.name,
        apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
        apiKeyRef: typeof raw.apiKeyRef === 'string' && raw.apiKeyRef ? raw.apiKeyRef : undefined,
        model: storedModel || modelPool[0] || '',
        availableModels,
        createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
        lastTestedAt: typeof raw.lastTestedAt === 'number' ? raw.lastTestedAt : undefined,
      }
    })
    .filter((account): account is ModelAccount => Boolean(account))
}

export function createAccountFromLegacyConfig(
  stored: Partial<ModelConfig> & {
    providerId?: string
    providerName?: string
    baseUrl?: string
    apiKey?: string
    model?: string
    availableModels?: unknown
    lastTestedAt?: number
  },
): ModelAccount {
  const providerId = resolveProviderId(stored)
  const provider = getProviderById(providerId)
  const availableModels = normalizeModels(stored.availableModels)
  const modelPool = availableModels.length ? availableModels : provider.models
  const storedModel = typeof stored.model === 'string' && modelPool.includes(stored.model) ? stored.model : ''
  const now = Date.now()

  return {
    id: `account_${provider.id}_legacy`,
    providerId: provider.id,
    name: provider.name,
    apiKey: typeof stored.apiKey === 'string' ? stored.apiKey : '',
    model: storedModel || modelPool[0] || '',
    availableModels,
    createdAt: now,
    updatedAt: now,
    lastTestedAt: typeof stored.lastTestedAt === 'number' ? stored.lastTestedAt : undefined,
  }
}

export function resolveProviderId(stored: { providerId?: string; providerName?: string; baseUrl?: string }) {
  if (typeof stored.providerId === 'string' && providerPresets.some((provider) => provider.id === stored.providerId)) {
    return stored.providerId
  }

  if (typeof stored.baseUrl === 'string') {
    const normalizedBaseUrl = trimTrailingSlash(stored.baseUrl)
    const matched = providerPresets.find((provider) => trimTrailingSlash(provider.baseUrl) === normalizedBaseUrl)
    if (matched) return matched.id
  }

  if (typeof stored.providerName === 'string') {
    const matched = providerPresets.find((provider) =>
      stored.providerName?.toLowerCase().includes(provider.name.toLowerCase()),
    )
    if (matched) return matched.id
  }

  return 'deepseek'
}

export function getProviderById(id: string) {
  return providerPresets.find((provider) => provider.id === id) ?? providerPresets[0]
}

export function accountModels(account: Pick<ModelAccount, 'providerId' | 'availableModels'>) {
  const provider = getProviderById(account.providerId)
  return account.availableModels.length ? account.availableModels : provider.models
}

export function accountDisplayName(account: Pick<ModelAccount, 'providerId' | 'name'>) {
  const provider = getProviderById(account.providerId)
  return account.name && account.name !== provider.name ? `${account.name} · ${provider.name}` : provider.name
}

export function accountTestLabel(account: ModelAccount) {
  return account.lastTestedAt ? `上次测试 ${formatTime(account.lastTestedAt)}` : '未测试'
}

export function makeModelValue(accountId: string, model: string) {
  return `${accountId}::${model}`
}

export function createId(prefix: string) {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `${prefix}_${crypto.randomUUID()}`
    : `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function createSessionModel(): ChatSession {
  const now = Date.now()

  return {
    id: createId('session'),
    title: '新会话',
    createdAt: now,
    updatedAt: now,
    messages: [],
  }
}

export function createUserMessage(content: string): ChatMessage {
  return {
    id: createId('message'),
    role: 'user',
    content,
    createdAt: Date.now(),
    status: 'complete',
  }
}

export function createAssistantMessage(): ChatMessage {
  return {
    id: createId('message'),
    role: 'assistant',
    content: '',
    createdAt: Date.now(),
    status: 'streaming',
  }
}

export function buildAgentMessages(
  session: ChatSession,
  assistantMessageId: string,
  systemPrompt: string,
): AgentMessage[] {
  const messages = session.messages
    .filter((message) => message.id !== assistantMessageId)
    .filter((message) => message.role !== 'tool')
    .filter((message) => message.content.trim())
    .map((message) => ({
      role: message.role,
      content: message.content,
    }))

  if (systemPrompt.trim()) {
    return [
      {
        role: 'system',
        content: systemPrompt.trim(),
      },
      ...messages,
    ]
  }

  return messages
}

export function trimTrailingSlash(value: string) {
  return value.trim().replace(/\/+$/, '')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)
}
