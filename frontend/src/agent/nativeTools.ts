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
    {
      name: 'morun_media_import',
      description: 'Import a trusted image source into morun media storage and return a stable Markdown image reference.',
      source: 'native',
      riskLevel: 'medium',
      permission: 'local_storage',
      requiresConfirmation: true,
      confirmationPolicy: 'confirm',
      parameters: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Image source to import. Supports https, content URI, data:image, morun-readable files, and Termux home image paths.',
          },
          kind: {
            type: 'string',
            enum: ['image'],
            description: 'Media kind. Only image is supported.',
          },
        },
        required: ['source', 'kind'],
        additionalProperties: false,
      },
      execute: async (args) => {
        const request = parseMediaImportArgs(args)
        const attachment = await nativeBridge.importMedia(request)
        const markdown = `![${attachment.fileName}](morun-media://${attachment.mediaId})`

        return {
          text: [
            'Imported image into morun media storage.',
            `mediaId: ${attachment.mediaId}`,
            `markdown: ${markdown}`,
          ].join('\n'),
          data: {
            ...attachment,
            markdown,
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

export function parseMediaImportArgs(args: unknown) {
  const record = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : null
  const source = record?.source
  const kind = record?.kind
  if (typeof source !== 'string' || !source.trim()) {
    throw new Error('source must be a non-empty string.')
  }
  if (kind !== 'image') {
    throw new Error('kind must be image.')
  }

  return {
    source: source.trim(),
    kind,
  } as const
}
