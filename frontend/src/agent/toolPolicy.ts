import type { StorageLike, ToolConfirmationPolicy, ToolDefinition, ToolRiskLevel } from './types'

export const toolPolicyKey = 'morun.tool-policy.v1'

export interface ToolPolicyEntry {
  enabled?: boolean
  confirmationPolicy?: ToolConfirmationPolicy
}

export interface ToolPolicyConfig {
  tools: Record<string, ToolPolicyEntry>
}

export const defaultToolPolicy: ToolPolicyConfig = {
  tools: {},
}

export function loadToolPolicy(storage: StorageLike = localStorage): ToolPolicyConfig {
  const stored = safeParse<unknown>(storage.getItem(toolPolicyKey))
  const record = asRecord(stored)
  const tools = asRecord(record?.tools)

  if (!tools) return { ...defaultToolPolicy, tools: {} }

  return {
    tools: Object.fromEntries(
      Object.entries(tools)
        .map(([name, value]): [string, ToolPolicyEntry] | null => {
          const entry = asRecord(value)
          if (!entry) return null

          return [
            name,
            {
              enabled: typeof entry.enabled === 'boolean' ? entry.enabled : undefined,
              confirmationPolicy: isConfirmationPolicy(entry.confirmationPolicy)
                ? entry.confirmationPolicy
                : undefined,
            },
          ]
        })
        .filter((entry): entry is [string, ToolPolicyEntry] => Boolean(entry)),
    ),
  }
}

export function saveToolPolicy(policy: ToolPolicyConfig, storage: StorageLike = localStorage) {
  storage.setItem(toolPolicyKey, JSON.stringify(policy))
}

export function applyToolPolicy(tools: ToolDefinition[], policy: ToolPolicyConfig = defaultToolPolicy) {
  const catalogTools = tools.map((tool) => applyToolPolicyEntry(tool, policy.tools[tool.name]))
  return {
    catalogTools,
    tools: catalogTools.filter((tool) => tool.enabled !== false && tool.confirmationPolicy !== 'deny'),
  }
}

export function applyToolPolicyEntry(tool: ToolDefinition, entry?: ToolPolicyEntry): ToolDefinition {
  return {
    ...tool,
    enabled: entry?.enabled ?? tool.enabled ?? true,
    confirmationPolicy: entry?.confirmationPolicy ?? tool.confirmationPolicy ?? 'auto',
  }
}

export function shouldConfirmTool(tool: ToolDefinition) {
  const policy = tool.confirmationPolicy ?? 'auto'
  if (policy === 'deny') return false
  if (policy === 'confirm') return true
  return tool.requiresConfirmation || shouldConfirmRisk(tool.riskLevel)
}

export function isToolDenied(tool: ToolDefinition | undefined) {
  if (!tool) return true
  return tool.enabled === false || tool.confirmationPolicy === 'deny'
}

export function shouldConfirmRisk(riskLevel: ToolRiskLevel) {
  return riskLevel === 'medium' || riskLevel === 'high'
}

function safeParse<T>(value: string | null): T | null {
  if (!value) return null

  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function isConfirmationPolicy(value: unknown): value is ToolConfirmationPolicy {
  return value === 'auto' || value === 'confirm' || value === 'deny'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}
