import { createBuiltinTools } from './builtinTools'
import { createNativeTools } from './nativeTools'
import { applyToolPolicy, type ToolPolicyConfig } from './toolPolicy'
import { morunNativeBridge, type MorunNativeBridge } from '../native/morunNative'
import type { ToolDefinition, ToolExecutionContext } from './types'

export interface ToolRegistry {
  tools: ToolDefinition[]
  catalogTools: ToolDefinition[]
  getTool(name: string): ToolDefinition | undefined
  getTitle(name: string): string
}

export interface ToolRegistryContext extends Pick<ToolExecutionContext, 'storage' | 'now'> {
  nativeBridge?: MorunNativeBridge
}

const toolTitles: Record<string, string> = {
  calculate: '安全计算',
  clear_notes: '清空记忆',
  get_current_time: '读取当前时间',
  native_open_url: '打开链接',
  recall_notes: '检索记忆',
  remember_note: '保存记忆',
}

export function createToolRegistry(context: ToolRegistryContext = {}, policy?: ToolPolicyConfig): ToolRegistry {
  const nativeBridge = context.nativeBridge ?? morunNativeBridge
  const { tools, catalogTools } = applyToolPolicy(
    [...createBuiltinTools(context), ...createNativeTools(nativeBridge)],
    policy,
  )
  const toolsByName = new Map(catalogTools.map((tool) => [tool.name, tool]))

  return {
    tools,
    catalogTools,
    getTool(name) {
      return toolsByName.get(name)
    },
    getTitle(name) {
      return toolTitles[name] ?? name
    },
  }
}

export function getToolTitle(name: string) {
  return toolTitles[name] ?? name
}
