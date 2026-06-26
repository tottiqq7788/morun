<script setup lang="ts">
import { computed } from 'vue'
import type {
  ToolConfirmationPolicy,
  ToolDefinition,
  ToolPermission,
  ToolRiskLevel,
  ToolSource,
} from '../agent/types'

export interface ToolPolicyUpdate {
  toolName: string
  enabled?: boolean
  confirmationPolicy?: ToolConfirmationPolicy
}

const props = defineProps<{
  tools: ToolDefinition[]
  getTitle: (name: string) => string
}>()

const emit = defineEmits<{
  updatePolicy: [update: ToolPolicyUpdate]
}>()

const toolCatalogGroups = computed(() => groupToolCatalog(props.tools))
const enabledToolCount = computed(() => {
  return props.tools.filter((tool) => tool.enabled !== false && tool.confirmationPolicy !== 'deny').length
})

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

function handleToolEnabledChange(toolName: string, event: Event) {
  const target = event.target as HTMLInputElement | null
  emit('updatePolicy', {
    toolName,
    enabled: Boolean(target?.checked),
  })
}

function handleToolConfirmationPolicyChange(toolName: string, event: Event) {
  const target = event.target as HTMLSelectElement | null
  if (!isToolConfirmationPolicy(target?.value)) return

  emit('updatePolicy', {
    toolName,
    confirmationPolicy: target.value,
  })
}

function isToolConfirmationPolicy(value: unknown): value is ToolConfirmationPolicy {
  return value === 'auto' || value === 'confirm' || value === 'deny'
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
    call_log: '通话记录',
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
</script>

<template>
  <section class="settings-section">
    <div class="section-heading">
      <h3>工具目录</h3>
      <span>{{ enabledToolCount }} / {{ tools.length }} 已启用</span>
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
              <strong>{{ getTitle(tool.name) }}</strong>
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
</template>

<style scoped>
.tool-catalog {
  display: grid;
  gap: 12px;
}

.tool-catalog-group {
  display: grid;
  gap: 8px;
}

.tool-catalog-group > header {
  align-items: baseline;
  display: flex;
  justify-content: space-between;
}

.tool-catalog-group > header strong {
  font-size: 13px;
  font-weight: 850;
}

.tool-catalog-group > header small {
  color: var(--muted);
  font-size: 12px;
}

.tool-catalog-item {
  background: rgba(255, 253, 249, 0.72);
  border: 1px solid var(--line);
  border-radius: 8px;
  display: grid;
  gap: 12px;
  grid-template-columns: minmax(0, 1fr) 118px;
  padding: 11px;
}

.tool-catalog-main {
  display: grid;
  gap: 7px;
  min-width: 0;
}

.tool-catalog-title {
  align-items: baseline;
  display: flex;
  gap: 8px;
  min-width: 0;
}

.tool-catalog-title strong,
.tool-catalog-title small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-catalog-title strong {
  font-size: 14px;
  font-weight: 850;
}

.tool-catalog-title small {
  color: var(--muted);
  font-size: 11px;
}

.tool-catalog-main p {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.45;
}

.tool-catalog-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tool-catalog-badges span {
  background: var(--panel-deep);
  border: 1px solid rgba(125, 115, 104, 0.18);
  border-radius: 999px;
  color: var(--accent-strong);
  font-size: 11px;
  font-weight: 800;
  padding: 3px 7px;
}

.tool-catalog-badges .risk-badge.safe {
  background: var(--success-soft);
  color: var(--success);
}

.tool-catalog-badges .risk-badge.low {
  background: #e8f0f4;
  color: #2f6276;
}

.tool-catalog-badges .risk-badge.medium {
  background: #fff0c8;
  color: #7c5c12;
}

.tool-catalog-badges .risk-badge.high {
  background: var(--warn-soft);
  color: var(--warn);
}

.tool-catalog-controls {
  align-content: start;
  display: grid;
  gap: 8px;
}

.tool-toggle {
  align-items: center;
  display: flex !important;
  flex-direction: row;
  gap: 7px !important;
}

.tool-toggle input {
  accent-color: var(--accent);
  height: 16px;
  width: 16px;
}

.tool-toggle span {
  color: var(--text);
  font-size: 12px;
  font-weight: 800;
}

.tool-policy-select {
  min-height: 34px;
  padding-block: 7px;
}

@media (max-width: 720px) {
  .tool-catalog-item {
    grid-template-columns: 1fr;
  }

  .tool-catalog-controls {
    grid-template-columns: auto minmax(0, 1fr);
  }
}
</style>
