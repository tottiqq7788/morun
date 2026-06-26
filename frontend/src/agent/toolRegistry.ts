import { createBuiltinTools } from './builtinTools'
import { createNativeTools } from './nativeTools'
import { createTermuxTools } from './termuxTools'
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
  termux_clipboard: 'Termux 剪贴板',
  termux_contacts_messages: 'Termux 联系人与消息',
  termux_device_status: 'Termux 设备状态',
  termux_location: 'Termux 定位',
  termux_media_capture: 'Termux 媒体采集',
  termux_notify: 'Termux 通知',
}

export function createToolRegistry(context: ToolRegistryContext = {}, policy?: ToolPolicyConfig): ToolRegistry {
  const nativeBridge = context.nativeBridge ?? morunNativeBridge
  const { tools, catalogTools } = applyToolPolicy(
    [...createBuiltinTools(context), ...createNativeTools(nativeBridge), ...createTermuxTools(nativeBridge)],
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
