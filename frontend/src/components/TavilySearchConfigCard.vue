<script setup lang="ts">
import { computed, ref } from 'vue'
import { KeyRound, Save, Search, Trash2, X } from '@lucide/vue'

type OperationState = 'idle' | 'saving' | 'clearing' | 'success' | 'error'

const props = defineProps<{
  configured: boolean
  saveApiKey: (apiKey: string) => Promise<void>
  clearApiKey: () => Promise<void>
}>()

const dialogOpen = ref(false)
const draftApiKey = ref('')
const operationState = ref<OperationState>('idle')
const feedback = ref('')
const isBusy = computed(() => operationState.value === 'saving' || operationState.value === 'clearing')

function openDialog() {
  draftApiKey.value = ''
  operationState.value = 'idle'
  feedback.value = ''
  dialogOpen.value = true
}

function closeDialog() {
  if (isBusy.value) return

  dialogOpen.value = false
}

async function saveKey() {
  const apiKey = draftApiKey.value.trim()
  if (!apiKey) {
    operationState.value = 'error'
    feedback.value = '请输入 Tavily API Key。'
    return
  }

  operationState.value = 'saving'
  feedback.value = '正在保存 Tavily API Key。'

  try {
    await props.saveApiKey(apiKey)
    draftApiKey.value = ''
    operationState.value = 'success'
    feedback.value = 'Tavily API Key 已保存。'
  } catch (error) {
    operationState.value = 'error'
    feedback.value = readableError(error, '保存 Tavily API Key 失败。')
  }
}

async function clearKey() {
  operationState.value = 'clearing'
  feedback.value = '正在清除 Tavily API Key。'

  try {
    await props.clearApiKey()
    draftApiKey.value = ''
    operationState.value = 'success'
    feedback.value = 'Tavily API Key 已清除。'
  } catch (error) {
    operationState.value = 'error'
    feedback.value = readableError(error, '清除 Tavily API Key 失败。')
  }
}

function readableError(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}
</script>

<template>
  <section class="settings-section">
    <div class="section-heading">
      <h3>Tavily 联网检索</h3>
      <span>{{ configured ? '已配置' : '未配置' }}</span>
    </div>

    <div class="tavily-config-card">
      <span class="tavily-icon" aria-hidden="true">
        <Search :size="18" />
      </span>
      <span class="tavily-main">
        <strong>联网检索</strong>
        <small>Tavily Search 可为模型提供实时信息和来源链接。</small>
      </span>
      <span :class="['tavily-state-pill', { ready: configured }]">{{ configured ? '已就绪' : '待配置' }}</span>
      <button class="secondary-button compact" type="button" @click="openDialog">
        <KeyRound :size="15" />
        配置
      </button>
    </div>

    <section v-if="dialogOpen" class="tavily-dialog-layer" aria-label="配置 Tavily 联网检索" @click.self="closeDialog">
      <div class="tavily-dialog">
        <header>
          <div>
            <p class="eyebrow">联网工具</p>
            <h2>Tavily 联网检索</h2>
          </div>
          <button class="icon-button" type="button" aria-label="关闭 Tavily 配置" title="关闭 Tavily 配置" :disabled="isBusy" @click="closeDialog">
            <X :size="18" />
          </button>
        </header>

        <label>
          Tavily API Key
          <input
            v-model="draftApiKey"
            autocomplete="off"
            autocapitalize="none"
            autocorrect="off"
            class="secret-text-input"
            inputmode="text"
            spellcheck="false"
            type="text"
            placeholder="请输入 Tavily API Key"
            @keydown.enter.prevent="saveKey"
          />
        </label>

        <div v-if="feedback" :class="['tavily-status', operationState]">
          <span>{{ feedback }}</span>
        </div>

        <footer>
          <button v-if="configured" class="danger-button compact-danger" type="button" :disabled="isBusy" @click="clearKey">
            <Trash2 :size="15" />
            清除
          </button>
          <div class="tavily-dialog-actions">
            <button class="secondary-button" type="button" :disabled="isBusy" @click="closeDialog">取消</button>
            <button class="primary-button" type="button" :disabled="isBusy" @click="saveKey">
              <Save :size="16" />
              {{ operationState === 'saving' ? '保存中' : '保存' }}
            </button>
          </div>
        </footer>
      </div>
    </section>
  </section>
</template>

<style scoped>
.tavily-config-card {
  align-items: center;
  background: rgba(255, 253, 249, 0.72);
  border: 1px solid var(--line);
  border-radius: 8px;
  display: grid;
  gap: 10px;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  min-height: 64px;
  padding: 10px 11px;
}

.tavily-icon {
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

.tavily-main {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.tavily-main strong,
.tavily-main small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tavily-main strong {
  color: var(--text);
  font-size: 13px;
  font-weight: 850;
}

.tavily-main small {
  color: var(--muted);
  font-size: 12px;
}

.tavily-state-pill {
  background: var(--warn-soft);
  border-radius: 999px;
  color: var(--warn);
  font-size: 11px;
  font-weight: 850;
  padding: 4px 8px;
  white-space: nowrap;
}

.tavily-state-pill.ready {
  background: var(--success-soft);
  color: var(--success);
}

.tavily-dialog-layer {
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

.tavily-dialog {
  background: var(--panel);
  border-radius: 8px;
  box-shadow: var(--shadow);
  display: grid;
  gap: 16px;
  max-width: 460px;
  padding: 18px;
  width: min(100%, 460px);
}

.tavily-dialog > header,
.tavily-dialog footer {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
}

.tavily-dialog label {
  color: var(--muted);
  display: grid;
  font-size: 13px;
  font-weight: 700;
  gap: 7px;
}

.tavily-status {
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.45;
  min-height: 42px;
  padding: 10px 12px;
}

.tavily-status.saving,
.tavily-status.clearing {
  background: var(--accent-soft);
}

.tavily-status.success {
  background: var(--success-soft);
  border-color: rgba(53, 109, 85, 0.28);
  color: var(--success);
}

.tavily-status.error {
  background: var(--warn-soft);
  border-color: rgba(159, 63, 47, 0.24);
  color: var(--warn);
}

.tavily-dialog-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

@media (max-width: 560px) {
  .tavily-config-card {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .tavily-state-pill,
  .tavily-config-card > button {
    grid-column: 2;
    justify-self: start;
  }

  .tavily-dialog footer {
    align-items: stretch;
    flex-direction: column;
  }

  .tavily-dialog-actions {
    width: 100%;
  }

  .tavily-dialog-actions > button,
  .tavily-dialog footer > button {
    flex: 1;
  }
}
</style>
