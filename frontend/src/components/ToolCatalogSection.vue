<script setup lang="ts">
import { computed, ref } from 'vue'
import { X } from '@lucide/vue'
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

const selectedGroupKey = ref<ToolSource | null>(null)
const toolCatalogGroups = computed(() => groupToolCatalog(props.tools))
const selectedGroup = computed(() => toolCatalogGroups.value.find((group) => group.key === selectedGroupKey.value) ?? null)
const enabledToolCount = computed(() => activeToolCount(props.tools))

function groupToolCatalog(tools: ToolDefinition[]) {
  const groups = new Map<ToolSource, ToolDefinition[]>()
  for (const tool of tools) {
    groups.set(tool.source, [...(groups.get(tool.source) ?? []), tool])
  }

  return Array.from(groups.entries()).map(([source, items]) => ({
    key: source,
    title: toolSourceLabel(source),
    description: toolSourceDescription(source),
    tools: items.sort((left, right) => left.riskLevel.localeCompare(right.riskLevel) || left.name.localeCompare(right.name)),
  }))
}

function openGroup(key: ToolSource) {
  selectedGroupKey.value = key
}

function closeGroup() {
  selectedGroupKey.value = null
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

function activeToolCount(tools: ToolDefinition[]) {
  return tools.filter((tool) => tool.enabled !== false && tool.confirmationPolicy !== 'deny').length
}

function confirmToolCount(tools: ToolDefinition[]) {
  return tools.filter((tool) => tool.enabled !== false && tool.confirmationPolicy === 'confirm').length
}

function deniedToolCount(tools: ToolDefinition[]) {
  return tools.filter((tool) => tool.enabled === false || tool.confirmationPolicy === 'deny').length
}

function groupSummary(tools: ToolDefinition[]) {
  const parts = [`${activeToolCount(tools)} / ${tools.length} 已启用`]
  const confirmCount = confirmToolCount(tools)
  const deniedCount = deniedToolCount(tools)
  if (confirmCount) parts.push(`${confirmCount} 个需确认`)
  if (deniedCount) parts.push(`${deniedCount} 个关闭`)
  return parts.join(' · ')
}

function toolStatusLabel(tool: ToolDefinition) {
  if (tool.enabled === false || tool.confirmationPolicy === 'deny') return '已关闭'
  return toolConfirmationPolicyLabel(tool.confirmationPolicy ?? 'auto')
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

function toolSourceDescription(source: ToolSource) {
  const labels: Record<ToolSource, string> = {
    builtin: '应用内置能力，不依赖手机系统权限。',
    native: '通过手机原生桥调用系统能力。',
    termux: '通过 Termux:API 调用更多手机能力。',
    mcp: '由 MCP 服务提供的外部能力。',
    plugin: '由插件扩展提供的工具能力。',
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
      <button v-for="group in toolCatalogGroups" :key="group.key" class="tool-catalog-group-button" type="button" @click="openGroup(group.key)">
        <span class="tool-group-main">
          <strong>{{ group.title }}</strong>
          <small>{{ group.description }}</small>
          <span>{{ groupSummary(group.tools) }}</span>
        </span>
        <span class="tool-summary-action">查看</span>
      </button>
    </div>

    <section v-if="selectedGroup" class="tool-catalog-dialog-layer" :aria-label="`${selectedGroup.title}详情`" @click.self="closeGroup">
      <div class="tool-catalog-dialog">
        <header>
          <div>
            <p class="eyebrow">工具目录</p>
            <h2>{{ selectedGroup.title }}</h2>
            <span>{{ selectedGroup.description }}</span>
          </div>
          <button class="icon-button" type="button" :aria-label="`关闭${selectedGroup.title}`" :title="`关闭${selectedGroup.title}`" @click="closeGroup">
            <X :size="18" />
          </button>
        </header>

        <div class="tool-dialog-list">
          <article v-for="tool in selectedGroup.tools" :key="tool.name" class="tool-dialog-item">
            <header class="tool-dialog-item-header">
              <div class="tool-catalog-title">
                <strong>{{ getTitle(tool.name) }}</strong>
                <small>{{ tool.name }}</small>
              </div>
              <span class="tool-state-label">{{ toolStatusLabel(tool) }}</span>
            </header>

            <p>{{ tool.description }}</p>

            <div class="tool-catalog-badges">
              <span :class="['risk-badge', tool.riskLevel]">{{ toolRiskLabel(tool.riskLevel) }}</span>
              <span>{{ toolPermissionLabel(tool.permission) }}</span>
              <span>{{ toolConfirmationPolicyLabel(tool.confirmationPolicy ?? 'auto') }}</span>
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
        </div>

        <footer>
          <button class="secondary-button" type="button" @click="closeGroup">关闭</button>
        </footer>
      </div>
    </section>
  </section>
</template>

<style scoped>
.tool-catalog {
  display: grid;
  gap: 8px;
}

.tool-catalog-group-button {
  align-items: center;
  background: rgba(255, 253, 249, 0.72);
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--text);
  cursor: pointer;
  display: grid;
  gap: 10px;
  grid-template-columns: minmax(0, 1fr) auto;
  min-height: 62px;
  padding: 10px 11px;
  text-align: left;
}

.tool-catalog-group-button:hover {
  background: #fffdf9;
  border-color: #cdbca9;
}

.tool-group-main {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.tool-group-main strong,
.tool-group-main small,
.tool-group-main span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-group-main strong {
  color: var(--text);
  font-size: 13px;
  font-weight: 850;
}

.tool-group-main small,
.tool-group-main span {
  color: var(--muted);
  font-size: 12px;
}

.tool-summary-action {
  color: var(--accent-strong);
  font-size: 12px;
  font-weight: 850;
}

.tool-catalog-dialog-layer {
  align-items: center;
  animation: fade-in 160ms ease both;
  background: rgba(39, 34, 28, 0.34);
  display: flex;
  inset: 0;
  justify-content: center;
  padding: 18px;
  position: fixed;
  z-index: 13;
}

.tool-catalog-dialog {
  background: var(--panel);
  border-radius: 8px;
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  max-height: min(760px, 92svh);
  max-width: 560px;
  overflow: hidden;
  width: min(100%, 560px);
}

.tool-catalog-dialog > header,
.tool-catalog-dialog footer {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  padding: 16px 18px;
}

.tool-catalog-dialog > header {
  border-bottom: 1px solid var(--line);
}

.tool-catalog-dialog > header span {
  color: var(--muted);
  display: block;
  font-size: 12px;
  line-height: 1.45;
  margin-top: 4px;
}

.tool-catalog-dialog footer {
  border-top: 1px solid var(--line);
  justify-content: flex-end;
}

.tool-dialog-list {
  display: grid;
  gap: 10px;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 18px;
}

.tool-dialog-item {
  background: rgba(255, 253, 249, 0.72);
  border: 1px solid var(--line);
  border-radius: 8px;
  display: grid;
  gap: 10px;
  padding: 11px;
}

.tool-dialog-item-header {
  align-items: start;
  display: grid;
  gap: 10px;
  grid-template-columns: minmax(0, 1fr) auto;
}

.tool-catalog-title {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.tool-catalog-title strong,
.tool-catalog-title small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-catalog-title strong {
  color: var(--text);
  font-size: 14px;
  font-weight: 850;
}

.tool-catalog-title small {
  color: var(--muted);
  font-size: 11px;
}

.tool-state-label {
  color: var(--accent-strong);
  font-size: 12px;
  font-weight: 850;
  white-space: nowrap;
}

.tool-dialog-item p {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.45;
}

.tool-catalog-controls {
  align-items: center;
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.tool-toggle {
  align-items: center;
  display: flex !important;
  flex-direction: row;
  flex-shrink: 0;
  gap: 7px !important;
  white-space: nowrap;
}

.tool-toggle input {
  accent-color: var(--accent);
  flex-shrink: 0;
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
  min-width: 86px;
  padding-block: 7px;
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
  max-width: 100%;
  overflow: hidden;
  padding: 3px 7px;
  text-overflow: ellipsis;
  white-space: nowrap;
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

@media (max-width: 720px) {
  .tool-dialog-item-header {
    grid-template-columns: 1fr;
  }

  .tool-catalog-controls {
    justify-content: space-between;
  }
}
</style>
