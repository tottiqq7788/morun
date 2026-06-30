<script setup lang="ts">
import { computed } from 'vue'
import { Database, RefreshCw, Trash2 } from '@lucide/vue'
import type { DebugLogInfo } from '../stores/debugLog'

const props = defineProps<{
  info: DebugLogInfo | null
  busy: boolean
}>()

defineEmits<{
  refresh: []
  clear: []
}>()

const statusLabel = computed(() => {
  if (!props.info) return '检测中'
  return props.info.enabled ? '已启用' : '未启用'
})
const transportLabel = computed(() => {
  if (!props.info) return '读取中'
  return props.info.transport === 'android' ? 'Android 私有文件' : 'Web 预览缓存'
})
const fileCount = computed(() => props.info?.files.length ?? 0)
const totalSize = computed(() => formatBytes(props.info?.totalBytes ?? 0))
const latestText = computed(() => {
  const latest = props.info?.latestModifiedAt
  if (!latest) return '暂无记录'
  return formatDate(latest)
})

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(2)} MB`
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}
</script>

<template>
  <section class="settings-section">
    <div class="section-heading">
      <h3>诊断日志</h3>
      <span>{{ statusLabel }}</span>
    </div>

    <div class="debug-log-card">
      <span class="debug-log-icon" aria-hidden="true">
        <Database :size="18" />
      </span>
      <span class="debug-log-main">
        <strong>ADB 调试日志</strong>
        <small>记录完整对话、工具调用、错误和耗时，密钥与媒体内容会脱敏。</small>
        <span>{{ transportLabel }} · {{ fileCount }} 个文件 · {{ totalSize }} · {{ latestText }}</span>
      </span>
      <button class="secondary-button compact icon-only-action" type="button" :disabled="busy" title="刷新日志状态" aria-label="刷新日志状态" @click="$emit('refresh')">
        <RefreshCw :class="{ spin: busy }" :size="15" />
      </button>
      <button class="danger-button compact-danger icon-only-action" type="button" :disabled="busy || !info?.totalBytes" title="清除诊断日志" aria-label="清除诊断日志" @click="$emit('clear')">
        <Trash2 :size="15" />
      </button>
    </div>
  </section>
</template>

<style scoped>
.debug-log-card {
  align-items: center;
  background: rgba(255, 253, 249, 0.72);
  border: 1px solid var(--line);
  border-radius: 8px;
  display: grid;
  gap: 10px;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  min-height: 74px;
  padding: 11px;
}

.debug-log-icon {
  align-items: center;
  background: var(--panel-deep);
  border: 1px solid rgba(125, 115, 104, 0.18);
  border-radius: 8px;
  color: var(--accent-strong);
  display: inline-flex;
  height: 36px;
  justify-content: center;
  width: 36px;
}

.debug-log-main {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.debug-log-main strong {
  color: var(--text);
  font-size: 14px;
  font-weight: 850;
}

.debug-log-main small,
.debug-log-main span {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.45;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.debug-log-main small {
  white-space: nowrap;
}

.debug-log-main span {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.icon-only-action {
  min-width: 36px;
  padding-inline: 9px;
}

@media (max-width: 560px) {
  .debug-log-card {
    grid-template-columns: auto minmax(0, 1fr) auto auto;
  }
}
</style>
