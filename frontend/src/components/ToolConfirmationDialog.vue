<script setup lang="ts">
import { X } from '@lucide/vue'
import type { ToolConfirmationDecision } from '../agent/runtime'
import type { ToolDefinition } from '../agent/types'

defineProps<{
  title: string
  tool: ToolDefinition
  argumentsText: string
}>()

const emit = defineEmits<{
  resolve: [decision: ToolConfirmationDecision]
}>()
</script>

<template>
  <section class="confirmation-layer" aria-label="工具确认">
    <div class="confirmation-dialog">
      <header>
        <div>
          <p class="eyebrow">工具确认</p>
          <h2>{{ title }}</h2>
        </div>
        <button
          class="icon-button"
          type="button"
          aria-label="拒绝工具调用"
          title="拒绝工具调用"
          @click="emit('resolve', 'denied')"
        >
          <X :size="18" />
        </button>
      </header>

      <section class="confirmation-body">
        <p>{{ tool.description }}</p>
        <div class="confirmation-meta">
          <span>{{ tool.source }}</span>
          <span>{{ tool.riskLevel }}</span>
          <span>{{ tool.permission }}</span>
        </div>
        <details v-if="argumentsText" class="tool-details" open>
          <summary>调用参数</summary>
          <div class="tool-detail-block">
            <pre>{{ argumentsText }}</pre>
          </div>
        </details>
      </section>

      <footer>
        <button class="secondary-button" type="button" @click="emit('resolve', 'denied')">拒绝</button>
        <button class="primary-button" type="button" @click="emit('resolve', 'approved')">确认执行</button>
      </footer>
    </div>
  </section>
</template>

<style scoped>
.confirmation-layer {
  align-items: center;
  animation: fade-in 160ms ease both;
  background: rgba(39, 34, 28, 0.34);
  display: flex;
  inset: 0;
  justify-content: center;
  padding: 18px;
  position: fixed;
  z-index: 14;
}

.confirmation-dialog {
  background: var(--panel);
  border-radius: 8px;
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 440px;
  padding: 18px;
  width: min(100%, 440px);
}

.confirmation-dialog > header,
.confirmation-dialog footer {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
}

.confirmation-dialog footer {
  justify-content: flex-end;
}

.confirmation-body {
  border-top: 1px solid var(--line);
  display: grid;
  gap: 12px;
  padding-top: 14px;
}

.confirmation-body p {
  color: var(--muted);
  font-size: 13px;
  line-height: 1.55;
}

.confirmation-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.confirmation-meta span {
  background: var(--panel-deep);
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--accent-strong);
  font-size: 11px;
  font-weight: 800;
  padding: 4px 8px;
}
</style>
