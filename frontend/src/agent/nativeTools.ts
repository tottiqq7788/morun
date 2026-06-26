import type { MorunNativeBridge } from '../native/morunNative'
import type { ToolDefinition } from './types'

export function createNativeTools(nativeBridge: MorunNativeBridge): ToolDefinition[] {
  return [
    {
      name: 'native_open_url',
      description: '通过系统浏览器或可处理链接的外部应用打开一个网页地址。',
      source: 'native',
      riskLevel: 'medium',
      permission: 'external_app',
      requiresConfirmation: true,
      confirmationPolicy: 'auto',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: '要打开的 http 或 https 地址。',
          },
        },
        required: ['url'],
        additionalProperties: false,
      },
      execute: async (args) => {
        const url = parseHttpUrl(args)
        const ok = await nativeBridge.openUrl(url)
        if (!ok) {
          throw new Error('当前环境不支持原生打开链接。')
        }

        return {
          text: `已打开链接：${url}`,
          data: {
            url,
          },
        }
      },
    },
  ]
}

export function parseHttpUrl(args: unknown) {
  const record = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : null
  const rawUrl = record?.url
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('url 必须是非空字符串。')
  }

  let parsed: URL
  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    throw new Error('url 不是有效地址。')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('native_open_url 只允许 http 或 https 地址。')
  }

  return parsed.toString()
}
