<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  MessageSquare,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from '@lucide/vue'
import ChatMainPanel from './components/ChatMainPanel.vue'
import TermuxEnvironmentCard from './components/TermuxEnvironmentCard.vue'
import ToolCatalogSection, { type ToolPolicyUpdate } from './components/ToolCatalogSection.vue'
import ToolConfirmationDialog from './components/ToolConfirmationDialog.vue'
import { createChatCompletionClient } from './agent/chatTransport'
import { runAgentTurn, type ToolConfirmationDecision } from './agent/runtime'
import { createToolRegistry } from './agent/toolRegistry'
import { loadToolPolicy, saveToolPolicy } from './agent/toolPolicy'
import type {
  AgentModelConfig,
  AgentRunEvent,
  ToolCall,
  ToolConfirmationPolicy,
  ToolDefinition,
} from './agent/types'
import { morunNativeBridge } from './native/morunNative'
import {
  accountDisplayName,
  accountModels,
  accountTestLabel,
  buildAgentMessages,
  createAssistantMessage,
  createId,
  createUserMessage,
  getProviderById,
  normalizeModels,
  providerPresets,
  trimTrailingSlash,
  useChatStore,
  type ChatMessage,
  type ChatSession,
  type ModelAccount,
} from './stores/chat'
import {
  extractMarkdownImageReferences,
  findMediaAttachmentBySource,
  isImportableImageSource,
  mediaIdFromUrl,
  normalizeMediaAttachments,
  normalizeMediaSource,
  type MediaAttachment,
} from './stores/media'
import {
  migrateModelAccountSecrets,
  resolveModelAccountApiKey,
  withStoredModelAccountApiKey,
} from './stores/modelSecrets'
import { renderMarkdown } from './stores/markdown'
import {
  buildSessionTitleMessages,
  countConversationTurns,
  markSessionTitleGenerated,
  sanitizeGeneratedSessionTitle,
  shouldGenerateSessionTitle,
} from './stores/sessionTitle'

type ConnectionState = 'idle' | 'testing' | 'success' | 'error'

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

interface PendingToolConfirmation {
  toolCall: ToolCall
  tool: ToolDefinition
  resolve: (decision: ToolConfirmationDecision) => void
}

interface SwipeGestureState {
  active: boolean
  pointerId: number | null
  startX: number
  startY: number
  latestX: number
  latestY: number
}

const chatStore = useChatStore()
const {
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
} = chatStore
const nativeBridge = morunNativeBridge
const chatCompletionClient = createChatCompletionClient({ nativeBridge })
const toolPolicy = ref(loadToolPolicy())
const toolRegistry = computed(() => createToolRegistry({ storage: localStorage, nativeBridge }, toolPolicy.value))
const agentTools = computed(() => toolRegistry.value.tools)
const catalogTools = computed(() => toolRegistry.value.catalogTools)
const draft = ref('')
const configOpen = ref(false)
const sidebarOpen = ref(false)
const accountDialogOpen = ref(false)
const accountDraft = ref<AccountDraft>(createAccountDraft('deepseek'))
const isGenerating = ref(false)
const isTestingConnection = ref(false)
const activeAbortController = ref<AbortController | null>(null)
const pendingToolConfirmation = ref<PendingToolConfirmation | null>(null)
const chatPanel = ref<InstanceType<typeof ChatMainPanel> | null>(null)
const pendingTitleTurnCounts = new Map<string, number>()
const pendingMediaImports = new Set<string>()
const mediaImportStates = ref<Record<string, { status: 'pending' | 'error'; error?: string }>>({})
const swipeGesture = ref<SwipeGestureState>({
  active: false,
  pointerId: null,
  startX: 0,
  startY: 0,
  latestX: 0,
  latestY: 0,
})
const connectionStatus = ref<ConnectionStatus>({
  state: 'idle',
  text: '尚未测试连接。',
})

const draftProvider = computed(() => {
  return getProviderById(accountDraft.value.providerId)
})

const draftModels = computed(() => {
  return accountModels(accountDraft.value)
})

onMounted(async () => {
  if (await migrateModelAccountSecrets(modelConfig.value, nativeBridge)) {
    chatStore.saveConfig()
  }
})

watch(
  () => [
    activeSession.value?.id ?? '',
    activeSession.value?.messages.length ?? 0,
    activeModelAccount.value?.id ?? '',
    selectedProvider.value?.id ?? '',
    isGenerating.value,
  ],
  () => {
    if (isGenerating.value) return

    void maybeQueueActiveSessionTitleGeneration()
  },
  { flush: 'post', immediate: true },
)

watch(
  () => activeSession.value?.id,
  () => {
    queueMediaImportsForSession(activeSession.value)
  },
  { flush: 'post', immediate: true },
)

function createSession() {
  chatStore.createSession()
  draft.value = ''
  sidebarOpen.value = false
  scheduleScroll()
}

function selectSession(id: string) {
  chatStore.selectSession(id)
  sidebarOpen.value = false
  scheduleScroll()
}

function sessionConversationCount(session: ChatSession) {
  return countConversationTurns(session.messages)
}

function deleteSession(id: string) {
  chatStore.deleteSession(id)
}

function resetConfig() {
  chatStore.resetConfig()
  connectionStatus.value = {
    state: 'idle',
    text: '已重置系统提示词。',
  }
}

function saveConfig() {
  chatStore.saveConfig()
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

async function maybeQueueActiveSessionTitleGeneration() {
  const session = activeSession.value
  const account = activeModelAccount.value
  const provider = selectedProvider.value
  if (!session || !account || !provider || !provider.baseUrl.trim() || !account.model.trim()) return
  if (!shouldGenerateSessionTitle(session)) return

  try {
    const apiKey = await resolveModelAccountApiKey(account, nativeBridge)
    if (provider.requiresApiKey && !apiKey.trim()) {
      console.warn('跳过会话标题生成：当前预览环境无法读取模型接口密钥。')
      return
    }

    queueSessionTitleGeneration(session, createTitleModelConfig(provider.baseUrl, apiKey, account.model))
  } catch (error) {
    console.warn('准备生成会话标题失败', error)
  }
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

async function saveAccountDraft() {
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
    apiKey: '',
    model,
    availableModels: models,
    createdAt: now,
    updatedAt: now,
    lastTestedAt: accountDraft.value.lastTestedAt,
  }
  let accountWithSecret: ModelAccount
  try {
    accountWithSecret = await withStoredModelAccountApiKey(account, accountDraft.value.apiKey, nativeBridge)
  } catch (error) {
    connectionStatus.value = {
      state: 'error',
      text: formatConnectionError(error),
    }
    return
  }

  modelConfig.value.accounts.push(accountWithSecret)
  modelConfig.value.activeAccountId = accountWithSecret.id
  accountDialogOpen.value = false
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

  const apiKey = await resolveModelAccountApiKey(account, nativeBridge)

  if (provider.requiresApiKey && !apiKey.trim()) {
    configOpen.value = true
    return
  }

  const userMessage = createUserMessage(content)
  let assistantMessage = createAssistantMessage()
  assistantMessage.createdAt = userMessage.createdAt + 1

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
    await runAgentTurn({
      messages: buildAgentMessages(session, assistantMessage.id, modelConfig.value.systemPrompt),
      modelConfig: {
        baseUrl: provider.baseUrl,
        apiKey,
        model: account.model,
        temperature: modelConfig.value.temperature,
        maxTokens: modelConfig.value.maxTokens,
        stream: modelConfig.value.stream,
      },
      tools: agentTools.value,
      client: chatCompletionClient,
      signal: controller.signal,
      toolContext: {
        storage: localStorage,
      },
      requestToolConfirmation,
      onEvent: (event) => {
        assistantMessage = handleAgentEvent(session, assistantMessage, event)
      },
    })

    if (hasMessage(session, assistantMessage.id)) {
      assistantMessage.status = 'complete'
    }

    queueSessionTitleGeneration(session, createTitleModelConfig(provider.baseUrl, apiKey, account.model))
  } catch (error) {
    const target = hasMessage(session, assistantMessage.id) ? assistantMessage : createAssistantMessage()
    if (!hasMessage(session, target.id)) {
      session.messages.push(target)
    }

    if (isAbortError(error)) {
      target.status = target.content ? 'complete' : 'error'
      target.error = target.content ? undefined : '生成已停止。'
    } else {
      target.status = 'error'
      target.error = formatRequestError(error)
    }
  } finally {
    session.updatedAt = Date.now()
    isGenerating.value = false
    activeAbortController.value = null
    pendingToolConfirmation.value = null
    scheduleScroll()
  }
}

function queueSessionTitleGeneration(session: ChatSession, titleModelConfig: AgentModelConfig) {
  if (!shouldGenerateSessionTitle(session)) return

  const turnCount = countConversationTurns(session.messages)
  if (pendingTitleTurnCounts.get(session.id) === turnCount) return

  pendingTitleTurnCounts.set(session.id, turnCount)

  void generateSessionTitle(session, titleModelConfig, turnCount)
}

function createTitleModelConfig(baseUrl: string, apiKey: string, model: string): AgentModelConfig {
  return {
    baseUrl,
    apiKey,
    model,
    temperature: 0.2,
    maxTokens: 256,
    stream: false,
  }
}

async function generateSessionTitle(
  session: ChatSession,
  titleModelConfig: AgentModelConfig,
  requestedTurnCount: number,
) {
  try {
    const result = await chatCompletionClient({
      messages: buildSessionTitleMessages(session),
      modelConfig: titleModelConfig,
      tools: [],
      useTools: false,
    })
    const title = sanitizeGeneratedSessionTitle(result.content)
    if (
      !title ||
      pendingTitleTurnCounts.get(session.id) !== requestedTurnCount ||
      countConversationTurns(session.messages) !== requestedTurnCount
    ) {
      return
    }

    session.title = title
    markSessionTitleGenerated(session, requestedTurnCount)
    session.updatedAt = Date.now()
  } catch (error) {
    console.warn('生成会话标题失败', error)
  } finally {
    if (pendingTitleTurnCounts.get(session.id) === requestedTurnCount) {
      pendingTitleTurnCounts.delete(session.id)
    }
  }
}

function handleAgentEvent(session: ChatSession, assistantMessage: ChatMessage, event: AgentRunEvent): ChatMessage {
  if (
    event.type === 'run_started' ||
    event.type === 'run_completed' ||
    event.type === 'run_aborted' ||
    event.type === 'fallback_without_tools'
  ) {
    return assistantMessage
  }

  if (event.type === 'assistant_delta') {
    appendOrStreamAssistantMessage(session, assistantMessage, event.accumulatedContent)
    return assistantMessage
  }

  if (event.type === 'assistant_message') {
    appendOrCompleteAssistantMessage(session, assistantMessage, event.content)
    return assistantMessage
  }

  if (event.type === 'tool_started') {
    const nextAssistantMessage = commitAssistantPlaceholderBeforeTool(session, assistantMessage)
    session.messages.push({
      id: createId('message'),
      role: 'tool',
      content: '',
      createdAt: Date.now(),
      status: 'streaming',
      toolName: event.toolCall.name,
      toolCallId: event.toolCall.id,
      toolArgs: event.toolCall.arguments,
      toolStatus: 'running',
    })
    session.updatedAt = Date.now()
    scheduleScroll()
    return nextAssistantMessage
  }

  if (event.type === 'tool_confirmation_required') {
    updateToolConfirmationMessage(session, event.toolCall.id)
    return assistantMessage
  }

  updateToolMessage(session, event)
  return assistantMessage
}

function requestToolConfirmation(toolCall: ToolCall, tool: ToolDefinition) {
  return new Promise<ToolConfirmationDecision>((resolve) => {
    pendingToolConfirmation.value = {
      toolCall,
      tool,
      resolve,
    }
  })
}

function resolveToolConfirmation(decision: ToolConfirmationDecision) {
  const pending = pendingToolConfirmation.value
  if (!pending) return

  pending.resolve(decision)
  pendingToolConfirmation.value = null
}

function appendOrStreamAssistantMessage(session: ChatSession, assistantMessage: ChatMessage, content: string) {
  const existing = session.messages.find((message) => message.id === assistantMessage.id)
  if (existing) {
    existing.content = content
    existing.status = 'streaming'
    queueMediaImportsFromMessage(session, existing)
  } else {
    assistantMessage.content = content
    assistantMessage.status = 'streaming'
    session.messages.push(assistantMessage)
    queueMediaImportsFromMessage(session, assistantMessage)
  }

  session.updatedAt = Date.now()
  scheduleScroll()
}

function appendOrCompleteAssistantMessage(session: ChatSession, assistantMessage: ChatMessage, content: string) {
  const existing = session.messages.find((message) => message.id === assistantMessage.id)
  if (existing) {
    existing.content = content
    existing.status = 'complete'
    queueMediaImportsFromMessage(session, existing)
  } else {
    const message: ChatMessage = {
      id: createId('message'),
      role: 'assistant',
      content,
      createdAt: Date.now(),
      status: 'complete',
    }
    session.messages.push(message)
    queueMediaImportsFromMessage(session, message)
  }

  session.updatedAt = Date.now()
  scheduleScroll()
}

function updateToolMessage(session: ChatSession, event: Extract<AgentRunEvent, { type: 'tool_completed' | 'tool_failed' }>) {
  const message = session.messages.find(
    (item) => item.role === 'tool' && item.toolCallId === event.toolCall.id && item.toolStatus === 'running',
  )
  if (!message) return

  message.status = event.type === 'tool_completed' ? 'complete' : 'error'
  message.toolStatus = event.type === 'tool_completed' ? 'done' : 'error'
  message.toolDuration = event.durationMs / 1000

  if (event.type === 'tool_completed') {
    message.content = event.output.text
    message.toolResult = event.output.data ?? event.output.text
    for (const attachment of normalizeMediaAttachments([event.output.data])) {
      attachMediaToMessage(message, attachment)
    }
    queueMediaImportsFromMessage(session, message)
  } else {
    message.content = event.error
    message.toolError = event.error
    message.error = event.error
  }

  session.updatedAt = Date.now()
  scheduleScroll()
}

function updateToolConfirmationMessage(session: ChatSession, toolCallId: string) {
  const message = session.messages.find(
    (item) => item.role === 'tool' && item.toolCallId === toolCallId && item.toolStatus === 'running',
  )
  if (!message) return

  message.content = '等待用户确认后执行。'
  session.updatedAt = Date.now()
  scheduleScroll()
}

function commitAssistantPlaceholderBeforeTool(session: ChatSession, assistantMessage: ChatMessage): ChatMessage {
  const placeholder = session.messages.find((message) => message.id === assistantMessage.id)
  if (!placeholder) return createAssistantMessage()

  const content = placeholder.content.trim()
  if (!content) {
    session.messages = session.messages.filter((message) => message.id !== assistantMessage.id)
    return createAssistantMessage()
  }

  placeholder.content = content
  placeholder.status = 'complete'
  queueMediaImportsFromMessage(session, placeholder)

  return createAssistantMessage()
}

function queueMediaImportsForSession(session: ChatSession | null | undefined) {
  if (!session) return
  for (const message of session.messages) {
    queueMediaImportsFromMessage(session, message)
  }
}

function queueMediaImportsFromMessage(session: ChatSession, message: ChatMessage) {
  const sources = [
    ...extractMarkdownImageReferences(message.content).map((reference) => reference.source),
    ...extractMediaHintSources(message.toolResult),
  ]

  for (const source of sources) {
    queueMediaImport(session, message, source)
  }
}

function queueMediaImport(session: ChatSession, message: ChatMessage, source: string) {
  const normalizedSource = normalizeMediaSource(source)
  if (!normalizedSource || mediaIdFromUrl(normalizedSource) || !isImportableImageSource(normalizedSource)) return
  if (/^https:\/\//i.test(normalizedSource) || /^data:image\//i.test(normalizedSource)) return

  const existingAttachment = findMediaAttachmentBySource(collectSessionMediaAttachments(session), normalizedSource)
  if (existingAttachment) {
    attachMediaToMessage(message, existingAttachment)
    return
  }

  const importKey = mediaImportKey(normalizedSource)
  if (pendingMediaImports.has(importKey)) return

  pendingMediaImports.add(importKey)
  setMediaImportState(normalizedSource, { status: 'pending' })

  void nativeBridge
    .importMedia({ source: normalizedSource, kind: 'image' })
    .then((attachment) => {
      attachMediaToMessage(message, attachment)
      clearMediaImportState(normalizedSource)
      session.updatedAt = Date.now()
      scheduleScroll()
    })
    .catch((error) => {
      setMediaImportState(normalizedSource, {
        status: 'error',
        error: formatRequestError(error),
      })
    })
    .finally(() => {
      pendingMediaImports.delete(importKey)
    })
}

function collectSessionMediaAttachments(session: ChatSession | null | undefined): MediaAttachment[] {
  return session?.messages.flatMap((message) => message.mediaAttachments ?? []) ?? []
}

function attachMediaToMessage(message: ChatMessage, attachment: MediaAttachment) {
  const existing = message.mediaAttachments ?? []
  if (existing.some((item) => item.mediaId === attachment.mediaId)) return

  message.mediaAttachments = [...existing, attachment]
}

function extractMediaHintSources(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const record = value as Record<string, unknown>
  const hint = record.mediaHint
  if (!hint || typeof hint !== 'object' || Array.isArray(hint)) return []
  const rawHint = hint as Record<string, unknown>
  return rawHint.kind === 'image' && typeof rawHint.source === 'string' ? [rawHint.source] : []
}

function mediaImportKey(source: string) {
  return normalizeMediaSource(source)
}

function setMediaImportState(source: string, state: { status: 'pending' | 'error'; error?: string }) {
  mediaImportStates.value = {
    ...mediaImportStates.value,
    [mediaImportKey(source)]: state,
  }
}

function clearMediaImportState(source: string) {
  const key = mediaImportKey(source)
  if (!(key in mediaImportStates.value)) return

  const next = { ...mediaImportStates.value }
  delete next[key]
  mediaImportStates.value = next
}

function hasMessage(session: ChatSession, messageId: string) {
  return session.messages.some((message) => message.id === messageId)
}

function stopGeneration() {
  resolveToolConfirmation('denied')
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

function toolStatusLabel(message: ChatMessage) {
  if (message.toolStatus === 'running') return '运行中'
  if (message.toolStatus === 'error') return '失败'
  return '完成'
}

function toolDisplayName(message: ChatMessage) {
  return message.toolName || 'tool'
}

function toolDisplayTitle(message: ChatMessage) {
  const name = toolDisplayName(message)
  return toolRegistry.value.getTitle(name)
}

function pendingToolTitle() {
  const pending = pendingToolConfirmation.value
  return pending ? toolRegistry.value.getTitle(pending.tool.name) : ''
}

function pendingToolArgs() {
  return stringifyCompact(pendingToolConfirmation.value?.toolCall.arguments)
}

function setToolPolicy(
  toolName: string,
  patch: {
    enabled?: boolean
    confirmationPolicy?: ToolConfirmationPolicy
  },
) {
  const current = toolPolicy.value.tools[toolName] ?? {}
  toolPolicy.value = {
    tools: {
      ...toolPolicy.value.tools,
      [toolName]: {
        ...current,
        ...patch,
      },
    },
  }
  saveToolPolicy(toolPolicy.value)
}

function handleToolPolicyUpdate(update: ToolPolicyUpdate) {
  const patch: {
    enabled?: boolean
    confirmationPolicy?: ToolConfirmationPolicy
  } = {}
  if ('enabled' in update) patch.enabled = update.enabled
  if ('confirmationPolicy' in update) patch.confirmationPolicy = update.confirmationPolicy
  setToolPolicy(update.toolName, patch)
}

function toolSubtitle(message: ChatMessage) {
  if (message.toolStatus === 'running') {
    return formatToolArgsInline(message) || '正在执行工具调用'
  }

  if (message.toolStatus === 'error') {
    return shortenOneLine(message.toolError || message.content || '工具执行失败。', 108)
  }

  return shortenOneLine(message.content || stringifyCompact(message.toolResult) || '工具执行完成。', 108)
}

function toolStatusSummary(message: ChatMessage) {
  const duration = formatToolDuration(message)
  return duration ? `${toolStatusLabel(message)} · ${duration}` : toolStatusLabel(message)
}

function hasToolDetails(message: ChatMessage) {
  return Boolean(formatToolArgs(message) || formatToolOutput(message))
}

function formatToolArgs(message: ChatMessage) {
  return stringifyCompact(message.toolArgs)
}

function formatToolArgsInline(message: ChatMessage) {
  const args = message.toolArgs
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return shortenOneLine(stringifyCompact(args), 96)
  }

  const pairs = Object.entries(args as Record<string, unknown>)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${typeof value === 'string' || typeof value === 'number' ? value : JSON.stringify(value)}`)

  return shortenOneLine(pairs.join(' · '), 96)
}

function formatToolOutput(message: ChatMessage) {
  return message.toolError || message.content || stringifyCompact(message.toolResult)
}

function formatToolDuration(message: ChatMessage) {
  if (typeof message.toolDuration !== 'number') return ''
  if (message.toolDuration > 0 && message.toolDuration < 0.1) return '<0.1s'
  return `${message.toolDuration.toFixed(1)}s`
}

function stringifyCompact(value: unknown) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'string') return shortenToolText(value)

  try {
    return shortenToolText(JSON.stringify(value, null, 2))
  } catch {
    return shortenToolText(String(value))
  }
}

function shortenToolText(value: string) {
  const normalized = value.trim()
  return normalized.length > 520 ? `${normalized.slice(0, 520)}...` : normalized
}

function shortenOneLine(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
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
  chatPanel.value?.scrollToEnd()
}

function adjustComposerHeight() {
  chatPanel.value?.adjustComposerHeight()
}

function isMobileGestureViewport() {
  return window.matchMedia('(max-width: 780px)').matches
}

function shouldIgnoreSwipeStart(target: EventTarget | null) {
  const element = target instanceof Element ? target : null
  return Boolean(
    element?.closest(
      [
        'input',
        'textarea',
        'select',
        '.account-dialog-layer',
        '.confirmation-layer',
        '.model-picker-layer',
        '.question-dialog-layer',
        '.termux-config-dialog-layer',
        '.tool-catalog-dialog-layer',
      ].join(', '),
    ),
  )
}

function beginSwipeGesture(event: PointerEvent) {
  if (
    event.pointerType !== 'touch' ||
    !event.isPrimary ||
    !isMobileGestureViewport() ||
    shouldIgnoreSwipeStart(event.target)
  ) {
    return
  }

  swipeGesture.value = {
    active: true,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    latestX: event.clientX,
    latestY: event.clientY,
  }
}

function updateSwipeGesture(event: PointerEvent) {
  const gesture = swipeGesture.value
  if (!gesture.active || gesture.pointerId !== event.pointerId) return

  gesture.latestX = event.clientX
  gesture.latestY = event.clientY

  const deltaX = gesture.latestX - gesture.startX
  const deltaY = gesture.latestY - gesture.startY
  if (Math.abs(deltaY) > 24 && Math.abs(deltaY) > Math.abs(deltaX) * 1.15) {
    gesture.active = false
  }
}

function endSwipeGesture(event: PointerEvent) {
  const gesture = swipeGesture.value
  if (!gesture.active || gesture.pointerId !== event.pointerId) return

  const deltaX = gesture.latestX - gesture.startX
  const deltaY = gesture.latestY - gesture.startY
  gesture.active = false

  if (Math.abs(deltaX) < 72 || Math.abs(deltaX) < Math.abs(deltaY) * 1.45) return

  if (deltaX > 0) {
    handleSwipeRight()
  } else {
    handleSwipeLeft()
  }
}

function cancelSwipeGesture(event: PointerEvent) {
  const gesture = swipeGesture.value
  if (gesture.pointerId === event.pointerId) {
    gesture.active = false
  }
}

function handleSwipeRight() {
  if (configOpen.value) {
    closeSettings()
    return
  }

  if (!sidebarOpen.value) {
    sidebarOpen.value = true
  }
}

function handleSwipeLeft() {
  if (sidebarOpen.value) {
    sidebarOpen.value = false
    return
  }

  if (!configOpen.value) {
    configOpen.value = true
  }
}
</script>

<template>
  <main
    class="app-shell"
    @pointerdown="beginSwipeGesture"
    @pointermove="updateSwipeGesture"
    @pointerup="endSwipeGesture"
    @pointercancel="cancelSwipeGesture"
  >
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
            <small>{{ sessionConversationCount(session) }} 条对话</small>
          </span>
        </button>
      </nav>
    </aside>

    <ChatMainPanel
      ref="chatPanel"
      v-model:draft="draft"
      v-model:active-model-value="activeModelValue"
      :active-session="activeSession"
      :has-messages="hasMessages"
      :active-model-label="activeModelLabel"
      :active-model-initial="activeModelInitial"
      :model-accounts="modelConfig.accounts"
      :is-generating="isGenerating"
      :format-time="formatTime"
      :render-markdown="renderMarkdown"
      :media-import-states="mediaImportStates"
      :tool-display-title="toolDisplayTitle"
      :tool-subtitle="toolSubtitle"
      :tool-status-summary="toolStatusSummary"
      :has-tool-details="hasToolDetails"
      :format-tool-args="formatToolArgs"
      :format-tool-output="formatToolOutput"
      @toggle-sidebar="sidebarOpen = !sidebarOpen"
      @open-settings="configOpen = true"
      @send-message="sendMessage"
      @stop-generation="stopGeneration"
    />

    <ToolConfirmationDialog
      v-if="pendingToolConfirmation"
      :title="pendingToolTitle()"
      :tool="pendingToolConfirmation.tool"
      :arguments-text="pendingToolArgs()"
      @resolve="resolveToolConfirmation"
    />

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

        <div class="settings-scroll-area">
          <section class="settings-section">
            <div class="section-heading">
              <h3>系统提示词</h3>
            </div>

            <label>
              <textarea v-model="modelConfig.systemPrompt" rows="5" />
            </label>
          </section>

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

          <TermuxEnvironmentCard />

          <ToolCatalogSection
            :tools="catalogTools"
            :get-title="toolRegistry.getTitle"
            @update-policy="handleToolPolicyUpdate"
          />
        </div>

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
              <input
                v-model="accountDraft.apiKey"
                autocomplete="off"
                autocapitalize="none"
                autocorrect="off"
                class="secret-text-input"
                inputmode="text"
                spellcheck="false"
                type="text"
                placeholder="请输入接口密钥"
              />
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
