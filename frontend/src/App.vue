<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import {
  CheckCircle2,
  CircleAlert,
  ClipboardCopy,
  ExternalLink,
  LoaderCircle,
  Menu,
  MessageSquare,
  Plus,
  RefreshCw,
  Save,
  Send,
  Settings,
  Smartphone,
  Square,
  Terminal,
  Trash2,
  X,
} from '@lucide/vue'
import { createChatCompletionClient } from './agent/chatTransport'
import { runAgentTurn, type ToolConfirmationDecision } from './agent/runtime'
import { createToolRegistry } from './agent/toolRegistry'
import { loadToolPolicy, saveToolPolicy } from './agent/toolPolicy'
import type {
  AgentRunEvent,
  ToolCall,
  ToolConfirmationPolicy,
  ToolDefinition,
  ToolPermission,
  ToolRiskLevel,
  ToolSource,
} from './agent/types'
import { morunNativeBridge, type TermuxStatus } from './native/morunNative'
import {
  accountDisplayName,
  accountModels,
  accountTestLabel,
  buildAgentMessages,
  createAssistantMessage,
  createId,
  createUserMessage,
  getProviderById,
  makeModelValue,
  normalizeModels,
  providerPresets,
  trimTrailingSlash,
  useChatStore,
  type ChatMessage,
  type ChatSession,
  type ModelAccount,
} from './stores/chat'
import {
  migrateModelAccountSecrets,
  resolveModelAccountApiKey,
  withStoredModelAccountApiKey,
} from './stores/modelSecrets'

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

type TermuxDiagnosticState = 'idle' | 'running' | 'ready' | 'package_missing' | 'error'

interface TermuxDiagnostic {
  state: TermuxDiagnosticState
  text: string
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
const toolCatalogGroups = computed(() => groupToolCatalog(catalogTools.value))
const draft = ref('')
const configOpen = ref(false)
const sidebarOpen = ref(false)
const accountDialogOpen = ref(false)
const accountDraft = ref<AccountDraft>(createAccountDraft('deepseek'))
const isGenerating = ref(false)
const isTestingConnection = ref(false)
const activeAbortController = ref<AbortController | null>(null)
const pendingToolConfirmation = ref<PendingToolConfirmation | null>(null)
const messagesEnd = ref<HTMLElement | null>(null)
const composerTextarea = ref<HTMLTextAreaElement | null>(null)
const modelSelect = ref<HTMLSelectElement | null>(null)
const connectionStatus = ref<ConnectionStatus>({
  state: 'idle',
  text: '尚未测试连接。',
})
const termuxStatus = ref<TermuxStatus | null>(null)
const termuxDiagnostic = ref<TermuxDiagnostic>({
  state: 'idle',
  text: '尚未运行诊断。',
})
const isCheckingTermux = ref(false)
const isRunningTermuxDiagnostic = ref(false)
const termuxSetupCopied = ref(false)
const termuxSetupCommand =
  "mkdir -p ~/.termux && (grep -qxF 'allow-external-apps=true' ~/.termux/termux.properties 2>/dev/null || echo 'allow-external-apps=true' >> ~/.termux/termux.properties) && pkg update && pkg install -y termux-api"

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
  await refreshTermuxStatus()
})

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

async function refreshTermuxStatus() {
  isCheckingTermux.value = true
  try {
    termuxStatus.value = await nativeBridge.termuxStatus()
  } finally {
    isCheckingTermux.value = false
  }
}

async function openTermuxInstallPage() {
  await nativeBridge.openTermuxInstallPage()
}

async function openTermuxApiInstallPage() {
  await nativeBridge.openTermuxApiInstallPage()
}

async function openTermuxApp() {
  await nativeBridge.openTermuxApp()
}

async function runTermuxDiagnostic() {
  isRunningTermuxDiagnostic.value = true
  termuxDiagnostic.value = {
    state: 'running',
    text: '正在读取电池状态。',
  }

  try {
    await refreshTermuxStatus()
    const status = termuxStatus.value
    if (status?.termuxInstalled && !status.runCommandPermissionGranted) {
      termuxStatus.value = await nativeBridge.requestTermuxRunCommandPermission()
    }

    const authorizedStatus = termuxStatus.value
    if (!authorizedStatus?.canRunCommands) {
      termuxDiagnostic.value = {
        state: 'error',
        text: authorizedStatus?.message || 'Termux RUN_COMMAND 尚未就绪。',
      }
      return
    }

    const result = await nativeBridge.runTermuxCommand({
      requestId: `termux_diagnostic_${Date.now()}`,
      command: 'termux-battery-status',
      timeoutMs: 15000,
    })

    if (result.exitCode === 0) {
      termuxDiagnostic.value = {
        state: 'ready',
        text: 'Termux:API 命令可用。',
      }
      return
    }

    const detail = `${result.stderr}\n${result.stdout}\n${result.errmsg ?? ''}`.toLowerCase()
    termuxDiagnostic.value = {
      state: detail.includes('not found') || detail.includes('no such file') ? 'package_missing' : 'error',
      text: detail.includes('not found') || detail.includes('no such file') ? 'Termux 内未安装 termux-api 包。' : 'Termux 诊断命令执行失败。',
    }
  } finally {
    isRunningTermuxDiagnostic.value = false
  }
}

async function copyTermuxSetupCommand() {
  await navigator.clipboard?.writeText(termuxSetupCommand)
  termuxSetupCopied.value = true
  window.setTimeout(() => {
    termuxSetupCopied.value = false
  }, 1800)
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

  const apiKey = await resolveModelAccountApiKey(account, nativeBridge)

  if (provider.requiresApiKey && !apiKey.trim()) {
    configOpen.value = true
    return
  }

  const userMessage = createUserMessage(content)
  const assistantMessage = createAssistantMessage()
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
        handleAgentEvent(session, assistantMessage, event)
      },
    })

    if (hasMessage(session, assistantMessage.id)) {
      assistantMessage.status = 'complete'
    }
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

function handleAgentEvent(session: ChatSession, assistantMessage: ChatMessage, event: AgentRunEvent) {
  if (
    event.type === 'run_started' ||
    event.type === 'run_completed' ||
    event.type === 'run_aborted' ||
    event.type === 'fallback_without_tools'
  ) {
    return
  }

  if (event.type === 'assistant_delta') {
    appendOrStreamAssistantMessage(session, assistantMessage, event.accumulatedContent)
    return
  }

  if (event.type === 'assistant_message') {
    appendOrCompleteAssistantMessage(session, assistantMessage, event.content)
    return
  }

  if (event.type === 'tool_started') {
    removeAssistantPlaceholder(session, assistantMessage.id)
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
    return
  }

  if (event.type === 'tool_confirmation_required') {
    updateToolConfirmationMessage(session, event.toolCall.id)
    return
  }

  updateToolMessage(session, event)
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
  } else {
    assistantMessage.content = content
    assistantMessage.status = 'streaming'
    session.messages.push(assistantMessage)
  }

  session.updatedAt = Date.now()
  scheduleScroll()
}

function appendOrCompleteAssistantMessage(session: ChatSession, assistantMessage: ChatMessage, content: string) {
  const existing = session.messages.find((message) => message.id === assistantMessage.id)
  if (existing) {
    existing.content = content
    existing.status = 'complete'
  } else {
    session.messages.push({
      id: createId('message'),
      role: 'assistant',
      content,
      createdAt: Date.now(),
      status: 'complete',
    })
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

function removeAssistantPlaceholder(session: ChatSession, assistantMessageId: string) {
  const placeholder = session.messages.find((message) => message.id === assistantMessageId)
  if (!placeholder) return

  session.messages = session.messages.filter((message) => message.id !== assistantMessageId)
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

function groupToolCatalog(tools: ToolDefinition[]) {
  const groups = new Map<ToolSource, ToolDefinition[]>()
  for (const tool of tools) {
    groups.set(tool.source, [...(groups.get(tool.source) ?? []), tool])
  }

  return Array.from(groups.entries()).map(([source, items]) => ({
    key: source,
    title: toolSourceLabel(source),
    tools: items.sort((left, right) => left.riskLevel.localeCompare(right.riskLevel) || left.name.localeCompare(right.name)),
  }))
}

function enabledToolCount() {
  return catalogTools.value.filter((tool) => tool.enabled !== false && tool.confirmationPolicy !== 'deny').length
}

function toolCatalogTitle(tool: ToolDefinition) {
  return toolRegistry.value.getTitle(tool.name)
}

function handleToolEnabledChange(toolName: string, event: Event) {
  const target = event.target as HTMLInputElement | null
  setToolPolicy(toolName, {
    enabled: Boolean(target?.checked),
  })
}

function handleToolConfirmationPolicyChange(toolName: string, event: Event) {
  const target = event.target as HTMLSelectElement | null
  if (!isToolConfirmationPolicy(target?.value)) return

  setToolPolicy(toolName, {
    confirmationPolicy: target.value,
  })
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

function isToolConfirmationPolicy(value: unknown): value is ToolConfirmationPolicy {
  return value === 'auto' || value === 'confirm' || value === 'deny'
}

function termuxStatusLabel() {
  const status = termuxStatus.value
  if (!status) return '检测中'
  if (!status.available && status.message.includes('仅 Android')) return '不可用'
  if (!status.termuxInstalled) return '未安装 Termux'
  if (!status.runCommandPermissionGranted) return '未授权 RUN_COMMAND'
  if (!status.termuxApiInstalled) return '未安装 Termux:API'
  if (!status.available) return '不可用'
  if (termuxDiagnostic.value.state === 'package_missing') return '未安装 termux-api 包'
  if (termuxDiagnostic.value.state === 'ready') return '已就绪'
  return '待初始化'
}

function termuxStatusDescription() {
  const status = termuxStatus.value
  if (!status) return '正在检测 Android 执行环境。'
  if (!status.available && status.message.includes('仅 Android')) return status.message
  if (!status.termuxInstalled) return '需要先安装 Termux。'
  if (!status.runCommandPermissionGranted) return '需要允许 morun 调用 Termux RUN_COMMAND。'
  if (!status.termuxApiInstalled) return '手机能力工具需要安装 Termux:API app。'
  if (!status.available) return status.message
  if (termuxDiagnostic.value.state !== 'idle') return termuxDiagnostic.value.text
  return '运行诊断可确认 Termux 内的 termux-api 包是否可用。'
}

function termuxStatusTone() {
  const status = termuxStatus.value
  if (status?.canRunCommands && status.termuxApiInstalled && termuxDiagnostic.value.state === 'ready') return 'ready'
  if (termuxDiagnostic.value.state === 'running' || isCheckingTermux.value) return 'checking'
  if (!status?.available || !status.termuxInstalled || !status.runCommandPermissionGranted || !status.termuxApiInstalled) return 'blocked'
  if (termuxDiagnostic.value.state === 'package_missing' || termuxDiagnostic.value.state === 'error') return 'blocked'
  return 'pending'
}

function toolSourceLabel(source: ToolSource) {
  const labels: Record<ToolSource, string> = {
    builtin: '内置工具',
    native: '原生工具',
    termux: 'Termux 工具',
    mcp: 'MCP 工具',
    plugin: '插件工具',
  }
  return labels[source]
}

function toolRiskLabel(riskLevel: ToolRiskLevel) {
  const labels: Record<ToolRiskLevel, string> = {
    safe: '安全',
    low: '低风险',
    medium: '中风险',
    high: '高风险',
  }
  return labels[riskLevel]
}

function toolPermissionLabel(permission: ToolPermission) {
  const labels: Record<ToolPermission, string> = {
    camera: '相机/录音',
    clipboard: '剪贴板',
    contacts: '联系人',
    none: '无权限',
    external_app: '外部应用',
    location: '定位',
    local_storage: '本地存储',
    network: '网络',
    notification: '通知',
    secret: '密钥',
    sms: '短信',
  }
  return labels[permission]
}

function toolConfirmationPolicyLabel(policy: ToolConfirmationPolicy) {
  const labels: Record<ToolConfirmationPolicy, string> = {
    auto: '自动',
    confirm: '每次确认',
    deny: '拒绝',
  }
  return labels[policy]
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

function renderMarkdown(value: string) {
  const source = value.trim()
  if (!source) return ''

  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const html: string[] = []
  let paragraph: string[] = []

  const flushParagraph = () => {
    if (!paragraph.length) return
    html.push(`<p>${renderInlineMarkdown(paragraph.join('\n')).replace(/\n/g, '<br>')}</p>`)
    paragraph = []
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmed = line.trim()
    const fence = trimmed.match(/^```([\w-]+)?\s*$/)

    if (fence) {
      flushParagraph()
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index])
        index += 1
      }
      html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
      continue
    }

    if (!trimmed) {
      flushParagraph()
      continue
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      flushParagraph()
      const level = heading[1].length
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`)
      continue
    }

    if (/^([-*_])\s*\1\s*\1\s*$/.test(trimmed)) {
      flushParagraph()
      html.push('<hr>')
      continue
    }

    const unorderedItems: string[] = []
    while (index < lines.length) {
      const item = lines[index].match(/^\s*[-*]\s+(.+)$/)
      if (!item) break
      unorderedItems.push(`<li>${renderInlineMarkdown(item[1])}</li>`)
      index += 1
    }
    if (unorderedItems.length) {
      flushParagraph()
      html.push(`<ul>${unorderedItems.join('')}</ul>`)
      index -= 1
      continue
    }

    const orderedItems: string[] = []
    while (index < lines.length) {
      const item = lines[index].match(/^\s*\d+\.\s+(.+)$/)
      if (!item) break
      orderedItems.push(`<li>${renderInlineMarkdown(item[1])}</li>`)
      index += 1
    }
    if (orderedItems.length) {
      flushParagraph()
      html.push(`<ol>${orderedItems.join('')}</ol>`)
      index -= 1
      continue
    }

    const quoteLines: string[] = []
    while (index < lines.length) {
      const quote = lines[index].match(/^\s*>\s?(.*)$/)
      if (!quote) break
      quoteLines.push(quote[1])
      index += 1
    }
    if (quoteLines.length) {
      flushParagraph()
      html.push(`<blockquote>${renderMarkdown(quoteLines.join('\n'))}</blockquote>`)
      index -= 1
      continue
    }

    paragraph.push(line)
  }

  flushParagraph()
  return html.join('')
}

function renderInlineMarkdown(value: string) {
  const placeholders: string[] = []
  const hold = (html: string) => {
    const key = `\u0000${placeholders.length}\u0000`
    placeholders.push(html)
    return key
  }

  let text = value.replace(/`([^`\n]+)`/g, (_match, code: string) => hold(`<code>${escapeHtml(code)}</code>`))

  text = text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label: string, href: string) => {
    const safeHref = sanitizeMarkdownHref(href)
    if (!safeHref) return match
    return hold(
      `<a href="${escapeAttribute(safeHref)}" target="_blank" rel="noreferrer noopener">${escapeHtml(label)}</a>`,
    )
  })

  let html = escapeHtml(text)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
    .replace(/(^|[^\*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>')

  placeholders.forEach((placeholder, index) => {
    html = html.replaceAll(`\u0000${index}\u0000`, placeholder)
  })

  return html
}

function sanitizeMarkdownHref(value: string) {
  const trimmed = value.trim()
  return /^(https?:|mailto:|tel:)/i.test(trimmed) ? trimmed : ''
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttribute(value: string) {
  return escapeHtml(value)
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
          <div v-if="message.role === 'tool'" :class="['tool-card', message.toolStatus]">
            <div class="tool-card-header">
              <span :class="['tool-state-icon', message.toolStatus]">
                <LoaderCircle v-if="message.toolStatus === 'running'" :size="16" />
                <CircleAlert v-else-if="message.toolStatus === 'error'" :size="16" />
                <CheckCircle2 v-else :size="16" />
              </span>
              <span class="tool-title">
                <strong>{{ toolDisplayTitle(message) }}</strong>
                <small>{{ toolSubtitle(message) }}</small>
              </span>
              <span class="tool-status">{{ toolStatusSummary(message) }}</span>
            </div>
            <details v-if="hasToolDetails(message)" class="tool-details" :open="message.toolStatus === 'error'">
              <summary>调用详情</summary>
              <div v-if="formatToolArgs(message)" class="tool-detail-block">
                <span>参数</span>
                <pre>{{ formatToolArgs(message) }}</pre>
              </div>
              <div v-if="formatToolOutput(message)" class="tool-detail-block">
                <span>{{ message.toolStatus === 'error' ? '错误' : '结果' }}</span>
                <pre>{{ formatToolOutput(message) }}</pre>
              </div>
            </details>
          </div>
          <div v-else class="message-bubble">
            <div
              class="markdown-body"
              v-html="renderMarkdown(message.content || (message.status === 'streaming' ? '正在思考...' : ''))"
            />
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

    <section v-if="pendingToolConfirmation" class="confirmation-layer" aria-label="工具确认">
      <div class="confirmation-dialog">
        <header>
          <div>
            <p class="eyebrow">工具确认</p>
            <h2>{{ pendingToolTitle() }}</h2>
          </div>
          <button
            class="icon-button"
            type="button"
            aria-label="拒绝工具调用"
            title="拒绝工具调用"
            @click="resolveToolConfirmation('denied')"
          >
            <X :size="18" />
          </button>
        </header>

        <section class="confirmation-body">
          <p>{{ pendingToolConfirmation.tool.description }}</p>
          <div class="confirmation-meta">
            <span>{{ pendingToolConfirmation.tool.source }}</span>
            <span>{{ pendingToolConfirmation.tool.riskLevel }}</span>
            <span>{{ pendingToolConfirmation.tool.permission }}</span>
          </div>
          <details v-if="pendingToolArgs()" class="tool-details" open>
            <summary>调用参数</summary>
            <div class="tool-detail-block">
              <pre>{{ pendingToolArgs() }}</pre>
            </div>
          </details>
        </section>

        <footer>
          <button class="secondary-button" type="button" @click="resolveToolConfirmation('denied')">拒绝</button>
          <button class="primary-button" type="button" @click="resolveToolConfirmation('approved')">确认执行</button>
        </footer>
      </div>
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
            <h3>Termux 执行环境</h3>
            <span :class="['termux-status-pill', termuxStatusTone()]">{{ termuxStatusLabel() }}</span>
          </div>

          <div class="termux-card">
            <div class="termux-status-row">
              <Smartphone :size="18" />
              <span>{{ termuxStatusDescription() }}</span>
            </div>

            <div class="termux-actions">
              <button class="secondary-button compact" type="button" @click="openTermuxInstallPage">
                <ExternalLink :size="15" />
                Termux
              </button>
              <button class="secondary-button compact" type="button" @click="openTermuxApiInstallPage">
                <ExternalLink :size="15" />
                Termux:API
              </button>
              <button class="secondary-button compact" type="button" @click="openTermuxApp">
                <Terminal :size="15" />
                打开
              </button>
              <button
                class="secondary-button compact"
                type="button"
                :disabled="isCheckingTermux || isRunningTermuxDiagnostic"
                @click="runTermuxDiagnostic"
              >
                <LoaderCircle v-if="isRunningTermuxDiagnostic" class="spin" :size="15" />
                <RefreshCw v-else :size="15" />
                诊断
              </button>
              <button class="secondary-button compact" type="button" @click="copyTermuxSetupCommand">
                <ClipboardCopy :size="15" />
                {{ termuxSetupCopied ? '已复制' : '初始化命令' }}
              </button>
            </div>

            <code class="termux-command">{{ termuxSetupCommand }}</code>
          </div>
        </section>

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
            <h3>工具目录</h3>
            <span>{{ enabledToolCount() }} / {{ catalogTools.length }} 已启用</span>
          </div>

          <div class="tool-catalog">
            <section v-for="group in toolCatalogGroups" :key="group.key" class="tool-catalog-group">
              <header>
                <strong>{{ group.title }}</strong>
                <small>{{ group.tools.length }} 个工具</small>
              </header>

              <article v-for="tool in group.tools" :key="tool.name" class="tool-catalog-item">
                <div class="tool-catalog-main">
                  <div class="tool-catalog-title">
                    <strong>{{ toolCatalogTitle(tool) }}</strong>
                    <small>{{ tool.name }}</small>
                  </div>
                  <p>{{ tool.description }}</p>
                  <div class="tool-catalog-badges">
                    <span :class="['risk-badge', tool.riskLevel]">{{ toolRiskLabel(tool.riskLevel) }}</span>
                    <span>{{ toolPermissionLabel(tool.permission) }}</span>
                    <span>{{ toolConfirmationPolicyLabel(tool.confirmationPolicy ?? 'auto') }}</span>
                  </div>
                </div>

                <div class="tool-catalog-controls">
                  <label class="tool-toggle">
                    <input
                      type="checkbox"
                      :checked="tool.enabled !== false"
                      @change="handleToolEnabledChange(tool.name, $event)"
                    />
                    <span>启用</span>
                  </label>
                  <select
                    class="tool-policy-select"
                    :value="tool.confirmationPolicy ?? 'auto'"
                    @change="handleToolConfirmationPolicyChange(tool.name, $event)"
                  >
                    <option value="auto">自动</option>
                    <option value="confirm">确认</option>
                    <option value="deny">拒绝</option>
                  </select>
                </div>
              </article>
            </section>
          </div>
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
