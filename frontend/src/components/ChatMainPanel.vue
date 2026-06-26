<script setup lang="ts">
import { nextTick, ref } from 'vue'
import {
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  Menu,
  MessageSquare,
  Send,
  Settings,
  Square,
} from '@lucide/vue'
import {
  accountDisplayName,
  accountModels,
  makeModelValue,
  type ChatMessage,
  type ChatSession,
  type ModelAccount,
} from '../stores/chat'

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
  renderMarkdown: (value: string) => string
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

const messagesEnd = ref<HTMLElement | null>(null)
const composerTextarea = ref<HTMLTextAreaElement | null>(null)
const modelSelect = ref<HTMLSelectElement | null>(null)

function scrollToEnd() {
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

function openModelSelect() {
  const select = modelSelect.value
  if (!select || !props.modelAccounts.length) return

  select.focus()
  select.showPicker?.()
}

function handleDraftInput(event: Event) {
  const target = event.target as HTMLTextAreaElement | null
  emit('update:draft', target?.value ?? '')
  adjustComposerHeight()
}

function handleModelChange(event: Event) {
  const target = event.target as HTMLSelectElement | null
  emit('update:activeModelValue', target?.value ?? '')
}

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
          :value="draft"
          rows="1"
          placeholder="输入消息..."
          :disabled="isGenerating"
          @input="handleDraftInput"
          @keydown.enter.exact.prevent="emit('sendMessage')"
        />
      </div>
      <div class="composer-side-actions">
        <select
          ref="modelSelect"
          :value="activeModelValue"
          class="model-switcher-hidden"
          aria-label="选择模型"
          :disabled="!modelAccounts.length"
          @change="handleModelChange"
        >
          <option value="" disabled>未配置模型</option>
          <optgroup
            v-for="account in modelAccounts"
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
          :disabled="!modelAccounts.length"
          @click="openModelSelect"
        >
          {{ activeModelInitial }}
        </button>
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
          @click="emit('sendMessage')"
        >
          <Send :size="16" />
        </button>
      </div>
    </footer>
  </section>
</template>
