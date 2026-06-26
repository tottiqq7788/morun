<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  Menu,
  MessageSquare,
  Plus,
  RefreshCw,
  Save,
  Send,
  Settings,
  Square,
  Trash2,
  X,
} from '@lucide/vue'

type Role = 'user' | 'assistant'
type MessageStatus = 'complete' | 'streaming' | 'error'
type ConnectionState = 'idle' | 'testing' | 'success' | 'error'

interface ChatMessage {
  id: string
  role: Role
  content: string
  createdAt: number
  status: MessageStatus
  error?: string
}

interface ChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
}

interface ProviderPreset {
  id: string
  name: string
  baseUrl: string
  description: string
  apiKeyLabel: string
  requiresApiKey: boolean
  models: string[]
}

interface ModelAccount {
  id: string
  providerId: string
  name: string
  apiKey: string
  model: string
  availableModels: string[]
  createdAt: number
  updatedAt: number
  lastTestedAt?: number
}

interface ModelConfig {
  activeAccountId: string
  accounts: ModelAccount[]
  temperature: number
  maxTokens: number
  systemPrompt: string
  stream: boolean
}

interface AccountDraft {
  providerId: string
  name: string
  apiKey: string
  model: string
  availableModels: string[]
  lastTestedAt?: number
}

interface ConnectionStatus {
  state: ConnectionState
  text: string
}

const sessionsKey = 'morun.sessions.v1'
const legacySessionsKey = 'family-agent.sessions.v1'
const configKey = 'morun.model-config.v2'
const legacyConfigKey = 'family-agent.model-config.v2'
const olderConfigKey = 'family-agent.model-config.v1'

const providerPresets: ProviderPreset[] = [
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

const defaultConfig: ModelConfig = {
  activeAccountId: '',
  accounts: [],
  temperature: 0.7,
  maxTokens: 4096,
  systemPrompt: '你是一个运行在手机上的智能助手，回答要清晰、可靠、适合移动端阅读。',
  stream: true,
}

const sessions = ref<ChatSession[]>(loadSessions())
const modelConfig = ref<ModelConfig>(loadConfig())
const activeSessionId = ref(sessions.value[0]?.id ?? '')
const draft = ref('')
const configOpen = ref(false)
const sidebarOpen = ref(false)
const accountDialogOpen = ref(false)
const accountDraft = ref<AccountDraft>(createAccountDraft('deepseek'))
const isGenerating = ref(false)
const isTestingConnection = ref(false)
const activeAbortController = ref<AbortController | null>(null)
const messagesEnd = ref<HTMLElement | null>(null)
const composerTextarea = ref<HTMLTextAreaElement | null>(null)
const modelSelect = ref<HTMLSelectElement | null>(null)
const connectionStatus = ref<ConnectionStatus>({
  state: 'idle',
  text: '尚未测试连接。',
})

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

const draftProvider = computed(() => {
  return getProviderById(accountDraft.value.providerId)
})

const draftModels = computed(() => {
  return accountModels(accountDraft.value)
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
    localStorage.setItem(sessionsKey, JSON.stringify(value))
  },
  { deep: true },
)

watch(
  modelConfig,
  (value) => {
    localStorage.setItem(configKey, JSON.stringify(value))
  },
  { deep: true },
)

onMounted(() => {
  if (!activeSessionId.value) {
    createSession()
  }
})

function loadSessions(): ChatSession[] {
  const stored =
    safeParse<ChatSession[]>(localStorage.getItem(sessionsKey)) ??
    safeParse<ChatSession[]>(localStorage.getItem(legacySessionsKey))
  if (stored?.length) {
    return stored.map((session) => ({
      ...session,
      title: session.title === 'New chat' ? '新会话' : session.title,
    }))
  }

  return [createSessionModel()]
}

function loadConfig(): ModelConfig {
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
    >(localStorage.getItem(configKey)) ??
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
    >(localStorage.getItem(legacyConfigKey)) ??
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
    >(localStorage.getItem(olderConfigKey))

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

function safeParse<T>(value: string | null): T | null {
  if (!value) return null

  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function normalizeModels(value: unknown) {
  if (!Array.isArray(value)) return []

  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)))
}

function normalizeAccounts(value: unknown): ModelAccount[] {
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
        model: storedModel || modelPool[0] || '',
        availableModels,
        createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
        lastTestedAt: typeof raw.lastTestedAt === 'number' ? raw.lastTestedAt : undefined,
      }
    })
    .filter((account): account is ModelAccount => Boolean(account))
}

function createAccountFromLegacyConfig(
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

function resolveProviderId(stored: { providerId?: string; providerName?: string; baseUrl?: string }) {
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

function getProviderById(id: string) {
  return providerPresets.find((provider) => provider.id === id) ?? providerPresets[0]
}

function accountModels(account: Pick<ModelAccount, 'providerId' | 'availableModels'> | AccountDraft) {
  const provider = getProviderById(account.providerId)
  return account.availableModels.length ? account.availableModels : provider.models
}

function accountDisplayName(account: Pick<ModelAccount, 'providerId' | 'name'>) {
  const provider = getProviderById(account.providerId)
  return account.name && account.name !== provider.name ? `${account.name} · ${provider.name}` : provider.name
}

function accountTestLabel(account: ModelAccount) {
  return account.lastTestedAt ? `上次测试 ${formatTime(account.lastTestedAt)}` : '未测试'
}

function makeModelValue(accountId: string, model: string) {
  return `${accountId}::${model}`
}

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`
}

function createSessionModel(): ChatSession {
  const now = Date.now()

  return {
    id: createId('session'),
    title: '新会话',
    createdAt: now,
    updatedAt: now,
    messages: [],
  }
}

function createSession() {
  const session = createSessionModel()
  sessions.value.unshift(session)
  activeSessionId.value = session.id
  draft.value = ''
  sidebarOpen.value = false
  scheduleScroll()
}

function selectSession(id: string) {
  activeSessionId.value = id
  sidebarOpen.value = false
  scheduleScroll()
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
  connectionStatus.value = {
    state: 'idle',
    text: '已重置系统提示词。',
  }
}

function saveConfig() {
  localStorage.setItem(configKey, JSON.stringify(modelConfig.value))
  closeSettings()
}

function closeSettings() {
  configOpen.value = false
  accountDialogOpen.value = false
}

function deleteActiveSessionFromSettings() {
  const session = activeSession.value
  if (!session) return

  deleteSession(session.id)
  closeSettings()
}

function openAccountDialog() {
  accountDraft.value = createAccountDraft(activeModelAccount.value?.providerId ?? defaultConfigProviderId())
  connectionStatus.value = {
    state: 'idle',
    text: '尚未测试连接。',
  }
  accountDialogOpen.value = true
}

function createAccountDraft(providerId = defaultConfigProviderId()): AccountDraft {
  const provider = getProviderById(providerId)

  return {
    providerId: provider.id,
    name: '',
    apiKey: '',
    model: provider.models[0] ?? '',
    availableModels: [],
  }
}

function defaultConfigProviderId() {
  return activeModelAccount.value?.providerId ?? 'deepseek'
}

function updateDraftProvider() {
  const provider = draftProvider.value
  accountDraft.value.apiKey = ''
  accountDraft.value.model = provider.models[0] ?? ''
  accountDraft.value.availableModels = []
  accountDraft.value.lastTestedAt = undefined
  connectionStatus.value = {
    state: 'idle',
    text: '尚未测试连接。',
  }
}

async function testDraftConnection() {
  const provider = draftProvider.value
  const apiKey = accountDraft.value.apiKey.trim()

  if (provider.requiresApiKey && !apiKey) {
    connectionStatus.value = {
      state: 'error',
      text: '请先填写接口密钥。',
    }
    return
  }

  isTestingConnection.value = true
  connectionStatus.value = {
    state: 'testing',
    text: `正在连接 ${provider.name}...`,
  }

  try {
    const response = await fetch(`${trimTrailingSlash(provider.baseUrl)}/models`, {
      method: 'GET',
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
    })

    if (!response.ok) {
      const detail = await response.text()
      throw new Error(detail || `HTTP ${response.status}`)
    }

    const payload = await response.json()
    const remoteModels = extractModelIds(payload)
    const models = remoteModels.length ? remoteModels : provider.models

    accountDraft.value.availableModels = models
    accountDraft.value.model = models.includes(accountDraft.value.model) ? accountDraft.value.model : models[0] || ''
    accountDraft.value.lastTestedAt = Date.now()
    connectionStatus.value = {
      state: 'success',
      text: remoteModels.length ? `连接成功，发现 ${remoteModels.length} 个模型。` : '连接成功，已使用推荐模型列表。',
    }
  } catch (error) {
    connectionStatus.value = {
      state: 'error',
      text: formatConnectionError(error),
    }
  } finally {
    isTestingConnection.value = false
  }
}

function saveAccountDraft() {
  const provider = draftProvider.value
  const models = normalizeModels(accountDraft.value.availableModels)
  const modelPool = models.length ? models : provider.models
  const model = modelPool.includes(accountDraft.value.model) ? accountDraft.value.model : modelPool[0] || ''
  const sameProviderCount = modelConfig.value.accounts.filter((account) => account.providerId === provider.id).length
  const now = Date.now()
  const account: ModelAccount = {
    id: createId('account'),
    providerId: provider.id,
    name: accountDraft.value.name.trim().slice(0, 80) || `${provider.name} ${sameProviderCount + 1}`,
    apiKey: accountDraft.value.apiKey.trim(),
    model,
    availableModels: models,
    createdAt: now,
    updatedAt: now,
    lastTestedAt: accountDraft.value.lastTestedAt,
  }

  modelConfig.value.accounts.push(account)
  modelConfig.value.activeAccountId = account.id
  accountDialogOpen.value = false
}

function openModelSelect() {
  const select = modelSelect.value
  if (!select || !modelConfig.value.accounts.length) return

  select.focus()
  select.showPicker?.()
}

async function sendMessage() {
  const content = draft.value.trim()
  const session = activeSession.value
  if (!content || !session || isGenerating.value) return

  const account = activeModelAccount.value
  const provider = selectedProvider.value
  if (!account || !provider || !provider.baseUrl.trim() || !account.model.trim()) {
    configOpen.value = true
    return
  }

  if (provider.requiresApiKey && !account.apiKey.trim()) {
    configOpen.value = true
    return
  }

  const now = Date.now()
  const userMessage: ChatMessage = {
    id: createId('message'),
    role: 'user',
    content,
    createdAt: now,
    status: 'complete',
  }
  const assistantMessage: ChatMessage = {
    id: createId('message'),
    role: 'assistant',
    content: '',
    createdAt: now + 1,
    status: 'streaming',
  }

  if (session.title === '新会话' || session.title === 'New chat') {
    session.title = content.replace(/\s+/g, ' ').slice(0, 48)
  }

  session.messages.push(userMessage, assistantMessage)
  session.updatedAt = Date.now()
  draft.value = ''
  adjustComposerHeight()
  isGenerating.value = true
  scheduleScroll()

  const controller = new AbortController()
  activeAbortController.value = controller

  try {
    await requestChatCompletion(session, assistantMessage, controller)
    assistantMessage.status = 'complete'
  } catch (error) {
    if (isAbortError(error)) {
      assistantMessage.status = assistantMessage.content ? 'complete' : 'error'
      assistantMessage.error = assistantMessage.content ? undefined : '生成已停止。'
    } else {
      assistantMessage.status = 'error'
      assistantMessage.error = formatRequestError(error)
    }
  } finally {
    session.updatedAt = Date.now()
    isGenerating.value = false
    activeAbortController.value = null
    scheduleScroll()
  }
}

async function requestChatCompletion(
  session: ChatSession,
  assistantMessage: ChatMessage,
  controller: AbortController,
) {
  const config = modelConfig.value
  const account = activeModelAccount.value
  const provider = account ? getProviderById(account.providerId) : null
  if (!account || !provider) throw new Error('请先添加模型配置。')

  const baseUrl = trimTrailingSlash(provider.baseUrl)
  const messages = buildProviderMessages(session, assistantMessage.id)
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'Content-Type': 'application/json',
      ...(account.apiKey.trim() ? { Authorization: `Bearer ${account.apiKey.trim()}` } : {}),
    },
    body: JSON.stringify({
      model: account.model,
      messages,
      temperature: Number(config.temperature),
      max_tokens: Number(config.maxTokens) || undefined,
      stream: config.stream,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `HTTP ${response.status}`)
  }

  if (!config.stream || !response.body) {
    const payload = await response.json()
    assistantMessage.content = payload?.choices?.[0]?.message?.content ?? ''
    return
  }

  await readStream(response, assistantMessage)
}

function buildProviderMessages(session: ChatSession, assistantMessageId: string) {
  const messages = session.messages
    .filter((message) => message.id !== assistantMessageId)
    .filter((message) => message.content.trim())
    .map((message) => ({
      role: message.role,
      content: message.content,
    }))

  if (modelConfig.value.systemPrompt.trim()) {
    return [
      {
        role: 'system',
        content: modelConfig.value.systemPrompt.trim(),
      },
      ...messages,
    ]
  }

  return messages
}

async function readStream(response: Response, assistantMessage: ChatMessage) {
  if (!response.body) return

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue

      const payload = trimmed.slice(5).trim()
      if (payload === '[DONE]') return

      try {
        const parsed = JSON.parse(payload)
        const delta = parsed?.choices?.[0]?.delta?.content ?? ''
        if (delta) {
          assistantMessage.content += delta
          activeSession.value!.updatedAt = Date.now()
          scheduleScroll()
        }
      } catch {
        // 部分兼容接口会发心跳片段，跳过即可。
      }
    }
  }
}

function stopGeneration() {
  activeAbortController.value?.abort()
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function extractModelIds(payload: unknown) {
  const data = (payload as { data?: unknown })?.data
  if (!Array.isArray(data)) return []

  return Array.from(
    new Set(
      data
        .map((item) => (typeof item === 'string' ? item : (item as { id?: unknown })?.id))
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0),
    ),
  )
}

function trimTrailingSlash(value: string) {
  return value.trim().replace(/\/+$/, '')
}

function formatConnectionError(error: unknown) {
  if (error instanceof TypeError) {
    return '连接失败：浏览器直连可能被跨域策略拦截，后续可用 Kotlin 原生网络桥处理。'
  }

  const message = error instanceof Error ? error.message : '未知错误'
  return `连接失败：${shortenError(message)}`
}

function formatRequestError(error: unknown) {
  if (error instanceof TypeError) {
    return '请求失败：当前接口可能被跨域策略拦截。'
  }

  const message = error instanceof Error ? error.message : '未知错误'
  return `请求失败：${shortenError(message)}`
}

function shortenError(message: string) {
  return message.replace(/\s+/g, ' ').slice(0, 180)
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)
}

function scheduleScroll() {
  nextTick(() => {
    messagesEnd.value?.scrollIntoView({ block: 'end' })
  })
}

function adjustComposerHeight() {
  nextTick(() => {
    const textarea = composerTextarea.value
    if (!textarea) return

    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`
  })
}
</script>

<template>
  <main class="app-shell">
    <button
      v-if="sidebarOpen"
      class="sidebar-backdrop"
      type="button"
      aria-label="关闭会话列表"
      title="关闭会话列表"
      @click="sidebarOpen = false"
    />

    <aside :class="['session-panel', { open: sidebarOpen }]">
      <header class="panel-header">
        <div>
          <p class="eyebrow">morun</p>
          <h1>会话</h1>
        </div>
        <button class="icon-button" type="button" aria-label="新建会话" title="新建会话" @click="createSession">
          <Plus :size="18" />
        </button>
      </header>

      <nav class="session-list" aria-label="会话列表">
        <button
          v-for="session in sortedSessions"
          :key="session.id"
          :class="['session-item', { active: session.id === activeSessionId }]"
          type="button"
          @click="selectSession(session.id)"
        >
          <MessageSquare :size="17" />
          <span>
            <strong>{{ session.title }}</strong>
            <small>{{ session.messages.length }} 条消息</small>
          </span>
        </button>
      </nav>
    </aside>

    <section class="chat-panel">
      <header class="chat-header">
        <button
          class="icon-button menu-button"
          type="button"
          aria-label="切换会话列表"
          title="切换会话列表"
          @click="sidebarOpen = !sidebarOpen"
        >
          <Menu :size="19" />
        </button>

        <div class="chat-title">
          <h2>{{ activeSession?.title ?? '对话' }}</h2>
          <div class="chat-subtitle">
            <span>{{ activeSession ? formatTime(activeSession.updatedAt) : '' }}</span>
          </div>
        </div>

        <div class="header-actions">
          <button class="icon-button" type="button" aria-label="模型设置" title="模型设置" @click="configOpen = true">
            <Settings :size="18" />
          </button>
        </div>
      </header>

      <div class="message-scroll">
        <section v-if="!hasMessages" class="empty-state">
          <MessageSquare :size="36" />
          <h3>开始对话</h3>
          <p>{{ activeModelLabel }}</p>
        </section>

        <article
          v-for="message in activeSession?.messages"
          :key="message.id"
          :class="['message-row', message.role]"
        >
          <div class="message-bubble">
            <p>{{ message.content || (message.status === 'streaming' ? '正在思考...' : '') }}</p>
            <small v-if="message.error" class="message-error">{{ message.error }}</small>
          </div>
        </article>
        <div ref="messagesEnd" />
      </div>

      <footer class="composer">
        <div class="composer-input">
          <textarea
            ref="composerTextarea"
            v-model="draft"
            rows="1"
            placeholder="输入消息..."
            :disabled="isGenerating"
            @input="adjustComposerHeight"
            @keydown.enter.exact.prevent="sendMessage"
          />
        </div>
        <div class="composer-side-actions">
          <select ref="modelSelect" v-model="activeModelValue" class="model-switcher-hidden" aria-label="选择模型" :disabled="!modelConfig.accounts.length">
            <option value="" disabled>未配置模型</option>
            <optgroup
              v-for="account in modelConfig.accounts"
              :key="account.id"
              :label="accountDisplayName(account)"
            >
              <option
                v-for="model in accountModels(account)"
                :key="makeModelValue(account.id, model)"
                :value="makeModelValue(account.id, model)"
              >
                {{ model }}
              </option>
            </optgroup>
          </select>
          <button
            class="secondary-button composer-square-button model-square-button"
            type="button"
            aria-label="选择模型"
            title="选择模型"
            :disabled="!modelConfig.accounts.length"
            @click="openModelSelect"
          >
            {{ activeModelInitial }}
          </button>
          <button v-if="isGenerating" class="primary-button composer-square-button stop" type="button" aria-label="停止" title="停止" @click="stopGeneration">
            <Square :size="16" />
          </button>
          <button
            v-else
            class="primary-button composer-square-button"
            type="button"
            aria-label="发送"
            title="发送"
            :disabled="!draft.trim()"
            @click="sendMessage"
          >
            <Send :size="16" />
          </button>
        </div>
      </footer>
    </section>

    <section v-if="configOpen" class="settings-drawer" aria-label="模型设置" @click.self="closeSettings">
      <div class="drawer-panel">
        <header>
          <div>
            <p class="eyebrow">模型</p>
            <h2>模型设置</h2>
          </div>
          <button class="icon-button" type="button" aria-label="关闭设置" title="关闭设置" @click="closeSettings">
            <X :size="18" />
          </button>
        </header>

        <section class="settings-section">
          <div class="section-heading">
            <h3>模型配置</h3>
            <button class="secondary-button compact" type="button" @click="openAccountDialog">
              <Plus :size="15" />
              添加
            </button>
          </div>

          <div v-if="modelConfig.accounts.length" class="model-account-list">
            <button
              v-for="account in modelConfig.accounts"
              :key="account.id"
              :class="['model-account-card', { selected: account.id === activeModelAccount?.id }]"
              type="button"
              :aria-pressed="account.id === activeModelAccount?.id"
              @click="modelConfig.activeAccountId = account.id"
            >
              <span>
                <strong>{{ accountDisplayName(account) }}</strong>
                <small>{{ account.model || '未选择模型' }}</small>
              </span>
              <small>{{ accountTestLabel(account) }}</small>
            </button>
          </div>
          <p v-else class="empty-copy">还没有模型配置。添加后可以在对话顶部切换厂商和模型。</p>
        </section>

        <section class="settings-section">
          <div class="section-heading">
            <h3>系统提示词</h3>
          </div>

          <label>
            <textarea v-model="modelConfig.systemPrompt" rows="5" />
          </label>
        </section>

        <footer class="settings-footer">
          <button class="danger-button compact-danger" type="button" :disabled="!activeSession" @click="deleteActiveSessionFromSettings">
            <Trash2 :size="16" />
            删除会话
          </button>
          <div class="footer-actions">
            <button class="secondary-button" type="button" @click="resetConfig">重置</button>
            <button class="primary-button" type="button" @click="saveConfig">
              <Save :size="16" />
              保存
            </button>
          </div>
        </footer>
      </div>

      <section v-if="accountDialogOpen" class="account-dialog-layer" aria-label="添加模型配置" @click.self="accountDialogOpen = false">
        <div class="account-dialog">
          <header>
            <div>
              <p class="eyebrow">配置</p>
              <h2>添加模型配置</h2>
            </div>
            <button class="icon-button" type="button" aria-label="关闭添加配置" title="关闭添加配置" @click="accountDialogOpen = false">
              <X :size="18" />
            </button>
          </header>

          <section class="settings-section">
            <label>
              配置名称
              <input v-model="accountDraft.name" type="text" placeholder="例如：DeepSeek 工作号" />
            </label>

            <label>
              模型厂商
              <select v-model="accountDraft.providerId" @change="updateDraftProvider">
                <option v-for="provider in providerPresets" :key="provider.id" :value="provider.id">
                  {{ provider.name }}
                </option>
              </select>
            </label>

            <label>
              接口地址
              <span class="endpoint-box">{{ draftProvider.baseUrl }}</span>
            </label>

            <label>
              {{ draftProvider.apiKeyLabel }}
              <input v-model="accountDraft.apiKey" autocomplete="off" type="password" placeholder="请输入接口密钥" />
            </label>

            <div :class="['status-line', connectionStatus.state]">
              <span>{{ connectionStatus.text }}</span>
              <button class="secondary-button compact" type="button" :disabled="isTestingConnection" @click="testDraftConnection">
                <RefreshCw :size="15" />
                {{ isTestingConnection ? '测试中' : '测试连接' }}
              </button>
            </div>

            <label>
              默认模型
              <select v-model="accountDraft.model">
                <option v-for="model in draftModels" :key="model" :value="model">{{ model }}</option>
              </select>
            </label>
          </section>

          <footer>
            <button class="secondary-button" type="button" @click="accountDialogOpen = false">取消</button>
            <button class="primary-button" type="button" @click="saveAccountDraft">
              <Save :size="16" />
              保存配置
            </button>
          </footer>
        </div>
      </section>
    </section>
  </main>
</template>
