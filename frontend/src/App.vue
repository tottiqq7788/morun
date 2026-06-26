<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  Check,
  Copy,
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

interface ModelConfig {
  providerId: string
  apiKey: string
  model: string
  availableModels: string[]
  temperature: number
  maxTokens: number
  systemPrompt: string
  stream: boolean
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
  providerId: 'deepseek',
  apiKey: '',
  model: 'deepseek-chat',
  availableModels: [],
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
const sidebarOpen = ref(true)
const isGenerating = ref(false)
const isTestingConnection = ref(false)
const activeAbortController = ref<AbortController | null>(null)
const messagesEnd = ref<HTMLElement | null>(null)
const copiedMessageId = ref('')
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

const selectedProvider = computed(() => {
  return getProviderById(modelConfig.value.providerId)
})

const selectableModels = computed(() => {
  return modelConfig.value.availableModels.length ? modelConfig.value.availableModels : selectedProvider.value.models
})

const lastTestLabel = computed(() => {
  return modelConfig.value.lastTestedAt ? `上次测试 ${formatTime(modelConfig.value.lastTestedAt)}` : '尚未测试'
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
    safeParse<Partial<ModelConfig> & { providerName?: string; baseUrl?: string }>(localStorage.getItem(configKey)) ??
    safeParse<Partial<ModelConfig> & { providerName?: string; baseUrl?: string }>(localStorage.getItem(legacyConfigKey)) ??
    safeParse<Partial<ModelConfig> & { providerName?: string; baseUrl?: string }>(localStorage.getItem(olderConfigKey))

  if (!stored) {
    return { ...defaultConfig }
  }

  const providerId = resolveProviderId(stored)
  const provider = getProviderById(providerId)
  const availableModels = normalizeModels(stored.availableModels)
  const modelPool = availableModels.length ? availableModels : provider.models
  const storedModel = typeof stored.model === 'string' && modelPool.includes(stored.model) ? stored.model : ''

  return {
    providerId,
    apiKey: typeof stored.apiKey === 'string' ? stored.apiKey : '',
    model: storedModel || modelPool[0] || '',
    availableModels,
    temperature: typeof stored.temperature === 'number' ? stored.temperature : defaultConfig.temperature,
    maxTokens: typeof stored.maxTokens === 'number' ? stored.maxTokens : defaultConfig.maxTokens,
    systemPrompt: typeof stored.systemPrompt === 'string' ? stored.systemPrompt : defaultConfig.systemPrompt,
    stream: typeof stored.stream === 'boolean' ? stored.stream : defaultConfig.stream,
    lastTestedAt: typeof stored.lastTestedAt === 'number' ? stored.lastTestedAt : undefined,
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

function resolveProviderId(stored: Partial<ModelConfig> & { providerName?: string; baseUrl?: string }) {
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

  return defaultConfig.providerId
}

function getProviderById(id: string) {
  return providerPresets.find((provider) => provider.id === id) ?? providerPresets[0]
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

function renameActiveSession() {
  const session = activeSession.value
  if (!session) return

  const nextTitle = window.prompt('会话名称', session.title)?.trim()
  if (!nextTitle) return

  session.title = nextTitle.slice(0, 80)
  session.updatedAt = Date.now()
}

function chooseProvider(providerId: string) {
  const provider = getProviderById(providerId)
  if (provider.id === modelConfig.value.providerId) return

  modelConfig.value = {
    ...modelConfig.value,
    providerId: provider.id,
    apiKey: '',
    model: provider.models[0] ?? '',
    availableModels: [],
    lastTestedAt: undefined,
  }
  connectionStatus.value = {
    state: 'idle',
    text: '尚未测试连接。',
  }
}

function resetConfig() {
  modelConfig.value = { ...defaultConfig }
  connectionStatus.value = {
    state: 'idle',
    text: '尚未测试连接。',
  }
}

function saveConfig() {
  localStorage.setItem(configKey, JSON.stringify(modelConfig.value))
  configOpen.value = false
}

async function testProviderConnection() {
  const provider = selectedProvider.value
  const apiKey = modelConfig.value.apiKey.trim()

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

    modelConfig.value.availableModels = models
    modelConfig.value.model = models.includes(modelConfig.value.model) ? modelConfig.value.model : models[0] || ''
    modelConfig.value.lastTestedAt = Date.now()
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

async function sendMessage() {
  const content = draft.value.trim()
  const session = activeSession.value
  if (!content || !session || isGenerating.value) return

  if (!selectedProvider.value.baseUrl.trim() || !modelConfig.value.model.trim()) {
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
  const baseUrl = trimTrailingSlash(selectedProvider.value.baseUrl)
  const messages = buildProviderMessages(session, assistantMessage.id)
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey.trim() ? { Authorization: `Bearer ${config.apiKey.trim()}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
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

function retryLastUserMessage() {
  const session = activeSession.value
  if (!session || isGenerating.value) return

  const lastUserIndex = findLastIndex(session.messages, (message) => message.role === 'user')
  if (lastUserIndex < 0) return

  draft.value = session.messages[lastUserIndex].content
  session.messages = session.messages.slice(0, lastUserIndex)
  sendMessage()
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return index
  }

  return -1
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

async function copyMessage(message: ChatMessage) {
  await navigator.clipboard.writeText(message.content)
  copiedMessageId.value = message.id
  window.setTimeout(() => {
    if (copiedMessageId.value === message.id) copiedMessageId.value = ''
  }, 1200)
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
</script>

<template>
  <main class="app-shell">
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
          <p>{{ activeSession ? formatTime(activeSession.updatedAt) : '' }}</p>
        </div>

        <div class="header-actions">
          <button class="icon-button" type="button" aria-label="重命名会话" title="重命名会话" @click="renameActiveSession">
            <Save :size="18" />
          </button>
          <button class="icon-button" type="button" aria-label="模型设置" title="模型设置" @click="configOpen = true">
            <Settings :size="18" />
          </button>
          <button
            class="icon-button danger"
            type="button"
            aria-label="删除会话"
            title="删除会话"
            @click="activeSession && deleteSession(activeSession.id)"
          >
            <Trash2 :size="18" />
          </button>
        </div>
      </header>

      <div class="message-scroll">
        <section v-if="!hasMessages" class="empty-state">
          <MessageSquare :size="36" />
          <h3>开始对话</h3>
          <p>{{ selectedProvider.name }} · {{ modelConfig.model || '未选择模型' }}</p>
        </section>

        <article
          v-for="message in activeSession?.messages"
          :key="message.id"
          :class="['message-row', message.role]"
        >
          <div class="message-bubble">
            <header class="message-meta">
              <span>{{ message.role === 'user' ? '我' : '助手' }}</span>
              <button
                v-if="message.content"
                class="ghost-icon"
                type="button"
                aria-label="复制消息"
                title="复制消息"
                @click="copyMessage(message)"
              >
                <Check v-if="copiedMessageId === message.id" :size="15" />
                <Copy v-else :size="15" />
              </button>
            </header>
            <p>{{ message.content || (message.status === 'streaming' ? '正在思考...' : '') }}</p>
            <small v-if="message.error" class="message-error">{{ message.error }}</small>
          </div>
        </article>
        <div ref="messagesEnd" />
      </div>

      <footer class="composer">
        <textarea
          v-model="draft"
          rows="1"
          placeholder="输入消息..."
          :disabled="isGenerating"
          @keydown.enter.exact.prevent="sendMessage"
        />
        <div class="composer-actions">
          <button
            class="secondary-button"
            type="button"
            :disabled="!activeSession?.messages.length || isGenerating"
            @click="retryLastUserMessage"
          >
            <RefreshCw :size="16" />
            重试
          </button>
          <button v-if="isGenerating" class="primary-button stop" type="button" @click="stopGeneration">
            <Square :size="16" />
            停止
          </button>
          <button v-else class="primary-button" type="button" :disabled="!draft.trim()" @click="sendMessage">
            <Send :size="16" />
            发送
          </button>
        </div>
      </footer>
    </section>

    <section v-if="configOpen" class="settings-drawer" aria-label="模型设置">
      <div class="drawer-panel">
        <header>
          <div>
            <p class="eyebrow">模型</p>
            <h2>模型设置</h2>
          </div>
          <button class="icon-button" type="button" aria-label="关闭设置" title="关闭设置" @click="configOpen = false">
            <X :size="18" />
          </button>
        </header>

        <section class="settings-section">
          <div class="section-heading">
            <h3>模型厂商</h3>
            <span>{{ selectedProvider.name }}</span>
          </div>
          <div class="provider-grid">
            <button
              v-for="provider in providerPresets"
              :key="provider.id"
              :class="['provider-card', { selected: provider.id === modelConfig.providerId }]"
              type="button"
              :aria-pressed="provider.id === modelConfig.providerId"
              @click="chooseProvider(provider.id)"
            >
              <span class="provider-name">{{ provider.name }}</span>
              <span class="provider-desc">{{ provider.description }}</span>
            </button>
          </div>
        </section>

        <section class="settings-section">
          <div class="section-heading">
            <h3>连接信息</h3>
            <span>{{ lastTestLabel }}</span>
          </div>

          <label>
            接口地址
            <span class="endpoint-box">{{ selectedProvider.baseUrl }}</span>
          </label>

          <label>
            {{ selectedProvider.apiKeyLabel }}
            <input v-model="modelConfig.apiKey" autocomplete="off" type="password" placeholder="请输入接口密钥" />
          </label>

          <div :class="['status-line', connectionStatus.state]">
            <span>{{ connectionStatus.text }}</span>
            <button class="secondary-button compact" type="button" :disabled="isTestingConnection" @click="testProviderConnection">
              <RefreshCw :size="15" />
              {{ isTestingConnection ? '测试中' : '测试连接' }}
            </button>
          </div>
        </section>

        <section class="settings-section">
          <div class="section-heading">
            <h3>模型参数</h3>
            <span>{{ selectableModels.length }} 个可选模型</span>
          </div>

          <label>
            当前模型
            <select v-model="modelConfig.model">
              <option v-for="model in selectableModels" :key="model" :value="model">{{ model }}</option>
            </select>
          </label>

          <div class="field-grid">
            <label>
              温度
              <input v-model.number="modelConfig.temperature" max="2" min="0" step="0.1" type="number" />
            </label>
            <label>
              最大输出
              <input v-model.number="modelConfig.maxTokens" min="1" step="128" type="number" />
            </label>
          </div>

          <label>
            系统提示词
            <textarea v-model="modelConfig.systemPrompt" rows="4" />
          </label>

          <label class="toggle-row">
            <input v-model="modelConfig.stream" type="checkbox" />
            流式回复
          </label>
        </section>

        <footer>
          <button class="secondary-button" type="button" @click="resetConfig">重置</button>
          <button class="primary-button" type="button" @click="saveConfig">
            <Save :size="16" />
            保存
          </button>
        </footer>
      </div>
    </section>
  </main>
</template>
