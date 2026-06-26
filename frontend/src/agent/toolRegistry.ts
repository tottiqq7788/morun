import { createBuiltinTools } from './builtinTools'
import type { ToolDefinition, ToolExecutionContext } from './types'

export interface ToolRegistry {
  tools: ToolDefinition[]
  getTool(name: string): ToolDefinition | undefined
  getTitle(name: string): string
}

const toolTitles: Record<string, string> = {
  calculate: '安全计算',
  clear_notes: '清空记忆',
  get_current_time: '读取当前时间',
  recall_notes: '检索记忆',
  remember_note: '保存记忆',
}

export function createToolRegistry(context: Pick<ToolExecutionContext, 'storage' | 'now'> = {}): ToolRegistry {
  const tools = createBuiltinTools(context)
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]))

  return {
    tools,
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
