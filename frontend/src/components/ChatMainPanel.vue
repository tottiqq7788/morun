<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  CircleAlert,
  Check,
  LoaderCircle,
  Menu,
  MessageSquare,
  Send,
  Settings,
  Square,
  X,
} from '@lucide/vue'
import {
  accountDisplayName,
  accountModels,
  makeModelValue,
  type ChatMessage,
  type ChatSession,
  type ModelAccount,
} from '../stores/chat'
import { groupChatTurnPages } from '../stores/chatTurns'
import type { MarkdownRenderOptions } from '../stores/markdown'
import {
  findMediaAttachmentById,
  findMediaAttachmentBySource,
  isImportableImageSource,
  mediaAttachmentViewSrc,
  mediaIdFromUrl,
  mediaUrl,
  normalizeMediaSource,
  type MediaAttachment,
} from '../stores/media'

type MediaImportState = { status: 'pending' | 'error'; error?: string }

const props = defineProps<{
  activeSession: ChatSession | null | undefined
  hasMessages: boolean
  activeModelLabel: string
  activeModelInitial: string
  activeModelValue: string
  modelAccounts: ModelAccount[]
  isGenerating: boolean
  draft: string
  formatTime: (value: number) => string
  renderMarkdown: (value: string, options?: MarkdownRenderOptions) => string
  mediaImportStates: Record<string, MediaImportState>
  toolDisplayTitle: (message: ChatMessage) => string
  toolSubtitle: (message: ChatMessage) => string
  toolStatusSummary: (message: ChatMessage) => string
  hasToolDetails: (message: ChatMessage) => boolean
  formatToolArgs: (message: ChatMessage) => string
  formatToolOutput: (message: ChatMessage) => string
}>()

const emit = defineEmits<{
  toggleSidebar: []
  openSettings: []
  sendMessage: []
  stopGeneration: []
  'update:draft': [value: string]
  'update:activeModelValue': [value: string]
}>()

const agentScroll = ref<HTMLElement | null>(null)
const messagesEnd = ref<HTMLElement | null>(null)
const composerTextarea = ref<HTMLTextAreaElement | null>(null)
const pageIndex = ref(0)
const followLatest = ref(true)
const shouldStickToBottom = ref(true)
const questionDialogMessage = ref<ChatMessage | null>(null)
const modelPickerOpen = ref(false)
const mediaPreview = ref<MediaAttachment | null>(null)

const turnPages = computed(() => groupChatTurnPages(props.activeSession?.messages ?? []))
const lastPageIndex = computed(() => Math.max(turnPages.value.length - 1, 0))
const currentPageIndex = computed(() => Math.min(pageIndex.value, lastPageIndex.value))
const currentPage = computed(() => turnPages.value[currentPageIndex.value] ?? null)
const currentAgentMessages = computed(() => currentPage.value?.messages ?? [])
const pageLabel = computed(() => (turnPages.value.length ? `${currentPageIndex.value + 1} / ${turnPages.value.length}` : '0 / 0'))
const sessionMediaAttachments = computed(() => {
  return props.activeSession?.messages.flatMap((message) => message.mediaAttachments ?? []) ?? []
})
const mediaPreviewSrc = computed(() => (mediaPreview.value ? mediaAttachmentViewSrc(mediaPreview.value) : ''))

const messageSignature = computed(() => {
  return (props.activeSession?.messages ?? [])
    .map((message) => [
      message.id,
      message.role,
      message.status,
      message.toolStatus ?? '',
      message.content.length,
      message.error ?? '',
      message.toolError ?? '',
      message.mediaAttachments?.map((attachment) => attachment.mediaId).join(',') ?? '',
    ].join(':'))
    .join('|')
})

function scrollToEnd() {
  nextTick(() => {
    if (!followLatest.value || !shouldStickToBottom.value) return

    pageIndex.value = lastPageIndex.value
    const container = agentScroll.value
    if (container) {
      container.scrollTop = container.scrollHeight
    } else {
      messagesEnd.value?.scrollIntoView({ block: 'end' })
    }
  })
}

function adjustComposerHeight() {
  nextTick(() => {
    const textarea = composerTextarea.value
    if (!textarea) return

    const style = window.getComputedStyle(textarea)
    const lineHeight = Number.parseFloat(style.lineHeight) || 20
    const paddingY = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)
    const borderY = Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth)
    const minHeight = lineHeight + paddingY + borderY
    const maxHeight = lineHeight * 4 + paddingY + borderY

    textarea.style.height = 'auto'
    const nextHeight = Math.min(maxHeight, Math.max(minHeight, textarea.scrollHeight + borderY))
    textarea.style.height = `${nextHeight}px`
    textarea.style.overflowY = nextHeight >= maxHeight ? 'auto' : 'hidden'
  })
}

function openModelPicker() {
  if (!props.modelAccounts.length) return

  modelPickerOpen.value = true
}

function handleDraftInput(event: Event) {
  const target = event.target as HTMLTextAreaElement | null
  emit('update:draft', target?.value ?? '')
  adjustComposerHeight()
}

function selectModel(accountId: string, model: string) {
  emit('update:activeModelValue', makeModelValue(accountId, model))
  modelPickerOpen.value = false
}

function handleAgentScroll() {
  const container = agentScroll.value
  if (!container) return

  shouldStickToBottom.value = container.scrollHeight - container.scrollTop - container.clientHeight < 80
}

function goToPage(index: number) {
  if (!turnPages.value.length) return

  const nextIndex = Math.max(0, Math.min(index, lastPageIndex.value))
  pageIndex.value = nextIndex
  followLatest.value = nextIndex >= lastPageIndex.value
  shouldStickToBottom.value = true
  nextTick(() => {
    const container = agentScroll.value
    if (container) container.scrollTop = container.scrollHeight
  })
}

function goPrevPage() {
  goToPage(currentPageIndex.value - 1)
}

function goNextPage() {
  goToPage(currentPageIndex.value + 1)
}

function handleSendMessage() {
  followLatest.value = true
  shouldStickToBottom.value = true
  emit('sendMessage')
}

function openQuestionDialog(message: ChatMessage | null | undefined) {
  if (!message) return
  questionDialogMessage.value = message
}

function assistantDisplayContent(message: ChatMessage) {
  if (message.content.trim()) return message.content
  if (message.status === 'streaming') return '正在连接模型...'
  if (message.error) return ''
  return '模型没有返回内容。'
}

function renderMessageMarkdown(message: ChatMessage) {
  return props.renderMarkdown(assistantDisplayContent(message), {
    resolveImage: resolveMarkdownImage,
  })
}

function resolveMarkdownImage(source: string) {
  const normalizedSource = normalizeMediaSource(source)
  const mediaId = mediaIdFromUrl(normalizedSource)
  if (mediaId) {
    const attachment = findMediaAttachmentById(sessionMediaAttachments.value, mediaId)
    if (!attachment) return { mediaId, placeholder: '图片尚未导入' }

    return {
      mediaId,
      fileName: attachment.fileName,
      src: mediaAttachmentViewSrc(attachment),
    }
  }

  const attachment = findMediaAttachmentBySource(sessionMediaAttachments.value, normalizedSource)
  if (attachment) {
    return {
      mediaId: attachment.mediaId,
      fileName: attachment.fileName,
      src: mediaAttachmentViewSrc(attachment),
    }
  }

  if (/^https?:\/\//i.test(normalizedSource) || /^data:image\//i.test(normalizedSource)) return null

  const importState = props.mediaImportStates[normalizedSource]
  if (importState?.status === 'error') return { error: importState.error ?? '图片导入失败' }
  if (importState?.status === 'pending') return { placeholder: '图片导入中' }
  if (isImportableImageSource(normalizedSource) && !/^https:\/\//i.test(normalizedSource) && !/^data:image\//i.test(normalizedSource)) {
    return { placeholder: '图片导入中' }
  }

  return null
}

function openMediaPreview(attachment: MediaAttachment) {
  mediaPreview.value = attachment
}

function handleMarkdownClick(event: MouseEvent) {
  const target = event.target
  if (!(target instanceof HTMLElement)) return

  const image = target.closest<HTMLImageElement>('.markdown-image[data-media-id]')
  const mediaId = image?.dataset.mediaId
  if (!mediaId) return

  const attachment = findMediaAttachmentById(sessionMediaAttachments.value, mediaId)
  if (attachment) openMediaPreview(attachment)
}

async function copyMediaMarkdown(attachment: MediaAttachment) {
  await navigator.clipboard?.writeText(`![${attachment.fileName}](${mediaUrl(attachment.mediaId)})`)
}

watch(
  () => props.activeSession?.id,
  () => {
    followLatest.value = true
    shouldStickToBottom.value = true
    modelPickerOpen.value = false
    questionDialogMessage.value = null
    pageIndex.value = lastPageIndex.value
    scrollToEnd()
  },
  { flush: 'post', immediate: true },
)

watch(
  () => turnPages.value.length,
  () => {
    if (!turnPages.value.length) {
      pageIndex.value = 0
      followLatest.value = true
      shouldStickToBottom.value = true
      return
    }

    if (followLatest.value || pageIndex.value > lastPageIndex.value) {
      pageIndex.value = lastPageIndex.value
    }
    scrollToEnd()
  },
  { flush: 'post' },
)

watch(
  messageSignature,
  () => {
    scrollToEnd()
  },
  { flush: 'post' },
)

watch(
  () => props.draft,
  () => {
    adjustComposerHeight()
  },
  { flush: 'post' },
)

defineExpose({
  scrollToEnd,
  adjustComposerHeight,
})
</script>

<template>
  <section class="chat-panel">
    <header class="chat-header">
      <button
        class="icon-button menu-button"
        type="button"
        aria-label="切换会话列表"
        title="切换会话列表"
        @click="emit('toggleSidebar')"
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
        <button class="icon-button" type="button" aria-label="模型设置" title="模型设置" @click="emit('openSettings')">
          <Settings :size="18" />
        </button>
      </div>
    </header>

    <div v-if="currentPage?.userMessage" class="question-pin">
      <button class="question-bubble pinned-question" type="button" @click="openQuestionDialog(currentPage.userMessage)">
        {{ currentPage.userMessage.content }}
      </button>
    </div>
    <div v-else-if="currentPage" class="question-pin question-pin-muted">
      <span class="question-placeholder">历史消息</span>
    </div>

    <div ref="agentScroll" class="agent-scroll" @scroll="handleAgentScroll">
      <section v-if="!hasMessages" class="empty-state">
        <MessageSquare :size="36" />
        <h3>开始对话</h3>
        <p>{{ activeModelLabel }}</p>
      </section>

      <div v-else class="turn-agent-stack">
        <article
          v-for="message in currentAgentMessages"
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
            <div v-if="message.mediaAttachments?.length" class="message-media-grid">
              <button
                v-for="attachment in message.mediaAttachments"
                :key="attachment.mediaId"
                class="message-media-thumb"
                type="button"
                @click="openMediaPreview(attachment)"
              >
                <img :src="mediaAttachmentViewSrc(attachment)" :alt="attachment.fileName" loading="lazy">
              </button>
            </div>
          </div>
          <div v-else class="message-bubble">
            <div
              class="markdown-body"
              @click="handleMarkdownClick"
              v-html="renderMessageMarkdown(message)"
            />
            <small v-if="message.error" class="message-error">{{ message.error }}</small>
          </div>
        </article>

        <p v-if="currentPage && !currentAgentMessages.length" class="turn-empty-copy">Agent 正在准备...</p>
        <div ref="messagesEnd" />
      </div>
    </div>

    <footer class="composer">
      <div class="composer-main">
        <div class="composer-toolbar">
          <div class="model-switcher-wrap">
            <button
              class="model-text-button"
              type="button"
              aria-label="选择模型"
              title="选择模型"
              :disabled="!modelAccounts.length"
              @click="openModelPicker"
            >
              {{ activeModelInitial }}
            </button>
          </div>

          <div class="turn-pager" aria-label="当前会话轮次分页">
            <button
              class="pager-button"
              type="button"
              aria-label="上一轮对话"
              :disabled="!turnPages.length || currentPageIndex <= 0"
              @click="goPrevPage"
            >
              <ChevronLeft :size="15" />
            </button>
            <span class="pager-label">{{ pageLabel }}</span>
            <button
              class="pager-button"
              type="button"
              aria-label="下一轮对话"
              :disabled="!turnPages.length || currentPageIndex >= lastPageIndex"
              @click="goNextPage"
            >
              <ChevronRight :size="15" />
            </button>
          </div>
        </div>

        <div class="composer-input-row">
          <div class="composer-input">
            <textarea
              ref="composerTextarea"
              :value="draft"
              rows="1"
              placeholder="输入消息..."
              :disabled="isGenerating"
              @input="handleDraftInput"
              @keydown.enter.exact.prevent="handleSendMessage"
            />
          </div>

          <button
            v-if="isGenerating"
            class="primary-button composer-square-button stop"
            type="button"
            aria-label="停止"
            title="停止"
            @click="emit('stopGeneration')"
          >
            <Square :size="16" />
          </button>
          <button
            v-else
            class="primary-button composer-square-button"
            type="button"
            aria-label="发送"
            title="发送"
            :disabled="!draft.trim()"
            @click="handleSendMessage"
          >
            <Send :size="16" />
          </button>
        </div>
      </div>
    </footer>

    <section v-if="modelPickerOpen" class="model-picker-layer" aria-label="选择模型" @click.self="modelPickerOpen = false">
      <div class="model-picker-dialog">
        <header>
          <div>
            <p class="eyebrow">模型</p>
            <h2>选择模型</h2>
          </div>
          <button class="icon-button" type="button" aria-label="关闭模型选择" title="关闭模型选择" @click="modelPickerOpen = false">
            <X :size="18" />
          </button>
        </header>

        <div class="model-picker-content">
          <section
            v-for="account in modelAccounts"
            :key="account.id"
            class="model-picker-group"
          >
            <div class="model-picker-group-title">
              <strong>{{ accountDisplayName(account) }}</strong>
              <span>{{ accountModels(account).length }} 个模型</span>
            </div>
            <div class="model-option-list">
              <button
                v-for="model in accountModels(account)"
                :key="makeModelValue(account.id, model)"
                :class="['model-option-button', { selected: activeModelValue === makeModelValue(account.id, model) }]"
                type="button"
                @click="selectModel(account.id, model)"
              >
                <span>{{ model }}</span>
                <Check v-if="activeModelValue === makeModelValue(account.id, model)" :size="17" />
              </button>
            </div>
          </section>
        </div>
      </div>
    </section>

    <section v-if="questionDialogMessage" class="question-dialog-layer" aria-label="完整提问" @click.self="questionDialogMessage = null">
      <div class="question-dialog">
        <header>
          <div>
            <p class="eyebrow">本轮</p>
            <h2>完整提问</h2>
          </div>
          <button class="icon-button" type="button" aria-label="关闭完整提问" title="关闭完整提问" @click="questionDialogMessage = null">
            <X :size="18" />
          </button>
        </header>
        <div class="question-dialog-content">
          {{ questionDialogMessage.content }}
        </div>
      </div>
    </section>
    <section v-if="mediaPreview" class="media-preview-layer" aria-label="图片预览" @click.self="mediaPreview = null">
      <div class="media-preview-dialog">
        <header>
          <div>
            <p class="eyebrow">图片</p>
            <h2>{{ mediaPreview.fileName }}</h2>
          </div>
          <button class="icon-button" type="button" aria-label="关闭图片预览" title="关闭图片预览" @click="mediaPreview = null">
            <X :size="18" />
          </button>
        </header>

        <div class="media-preview-stage">
          <img :src="mediaPreviewSrc" :alt="mediaPreview.fileName">
        </div>

        <footer>
          <span>{{ Math.ceil(mediaPreview.size / 1024) }} KB · {{ mediaPreview.mimeType }}</span>
          <button class="secondary-button compact" type="button" @click="copyMediaMarkdown(mediaPreview)">复制引用</button>
        </footer>
      </div>
    </section>
  </section>
</template>
