import type { MorunNativeBridge, TermuxCommandRequest } from '../native/morunNative'
import type { JsonSchema, ToolDefinition, ToolExecutionResult } from './types'

type TermuxCommandSpec = Omit<TermuxCommandRequest, 'requestId'>

const defaultTimeoutMs = 20000
const phoneDataDefaultLimit = 5
const phoneDataTimeoutMs = 60000
const termuxHomePrefix = '/data/data/com.termux/files/home/'

const deviceStatusActions = ['battery_status', 'audio_info', 'camera_info'] as const
const clipboardActions = ['get', 'set'] as const
const notifyActions = ['toast', 'vibrate', 'notification', 'tts_speak'] as const
const locationProviders = ['gps', 'network', 'passive'] as const
const mediaCaptureActions = ['camera_photo', 'microphone_record'] as const
const contactActions = ['list'] as const
const messageActions = ['sms_list'] as const
const callLogActions = ['list'] as const

export type TermuxToolName =
  | 'termux_device_status'
  | 'termux_clipboard'
  | 'termux_notify'
  | 'termux_location'
  | 'termux_media_capture'
  | 'termux_contacts'
  | 'termux_messages'
  | 'termux_call_log'

export function createTermuxTools(nativeBridge: MorunNativeBridge): ToolDefinition[] {
  return [
    {
      name: 'termux_device_status',
      description: '读取手机侧只读状态，包括电池、音频和相机信息。',
      source: 'termux',
      riskLevel: 'safe',
      permission: 'none',
      requiresConfirmation: false,
      confirmationPolicy: 'auto',
      parameters: objectSchema(
        {
          action: enumSchema(deviceStatusActions, '要读取的设备状态。'),
        },
        ['action'],
      ),
      execute: async (args) => executeTermuxTool(nativeBridge, 'termux_device_status', termuxCommandForTool('termux_device_status', args)),
    },
    {
      name: 'termux_clipboard',
      description: '读取或写入 Android 剪贴板。',
      source: 'termux',
      riskLevel: 'medium',
      permission: 'clipboard',
      requiresConfirmation: true,
      confirmationPolicy: 'confirm',
      parameters: objectSchema(
        {
          action: enumSchema(clipboardActions, '剪贴板动作。'),
          text: {
            type: 'string',
            description: '写入剪贴板的文本，仅 action=set 时使用，最长 2000 字符。',
          },
        },
        ['action'],
      ),
      execute: async (args) => executeTermuxTool(nativeBridge, 'termux_clipboard', termuxCommandForTool('termux_clipboard', args)),
    },
    {
      name: 'termux_notify',
      description: '触发 toast、震动、系统通知或 TTS 播报。',
      source: 'termux',
      riskLevel: 'low',
      permission: 'notification',
      requiresConfirmation: false,
      confirmationPolicy: 'auto',
      parameters: objectSchema(
        {
          action: enumSchema(notifyActions, '通知动作。'),
          title: {
            type: 'string',
            description: '系统通知标题，最长 80 字符。',
          },
          text: {
            type: 'string',
            description: 'toast、通知正文或 TTS 文本，最长 500 字符。',
          },
          durationMs: {
            type: 'number',
            description: '震动时长，范围 100 到 5000 毫秒。',
            minimum: 100,
            maximum: 5000,
          },
        },
        ['action'],
      ),
      execute: async (args) => executeTermuxTool(nativeBridge, 'termux_notify', termuxCommandForTool('termux_notify', args)),
    },
    {
      name: 'termux_location',
      description: '读取设备定位信息。',
      source: 'termux',
      riskLevel: 'high',
      permission: 'location',
      requiresConfirmation: true,
      confirmationPolicy: 'confirm',
      parameters: objectSchema(
        {
          action: {
            type: 'string',
            enum: ['get'],
            description: '定位动作。',
          },
          provider: enumSchema(locationProviders, '定位 provider，默认 network。'),
        },
        ['action'],
      ),
      execute: async (args) => executeTermuxTool(nativeBridge, 'termux_location', termuxCommandForTool('termux_location', args)),
    },
    {
      name: 'termux_media_capture',
      description: '通过 Termux:API 拍照或录音。',
      source: 'termux',
      riskLevel: 'high',
      permission: 'camera',
      requiresConfirmation: true,
      confirmationPolicy: 'confirm',
      parameters: objectSchema(
        {
          action: enumSchema(mediaCaptureActions, '媒体采集动作。'),
          outputPath: {
            type: 'string',
            description: '输出到 Termux home 目录下的绝对路径。',
          },
          cameraId: {
            type: 'number',
            description: '相机编号，范围 0 到 4。',
            minimum: 0,
            maximum: 4,
          },
          durationSeconds: {
            type: 'number',
            description: '录音时长，范围 1 到 60 秒。',
            minimum: 1,
            maximum: 60,
          },
        },
        ['action'],
      ),
      execute: async (args) => executeTermuxTool(nativeBridge, 'termux_media_capture', termuxCommandForTool('termux_media_capture', args)),
    },
    {
      name: 'termux_contacts',
      description: '读取联系人列表，默认关闭。',
      source: 'termux',
      riskLevel: 'high',
      permission: 'contacts',
      enabled: false,
      requiresConfirmation: true,
      confirmationPolicy: 'confirm',
      parameters: objectSchema(
        {
          action: enumSchema(contactActions, '联系人动作。'),
        },
        ['action'],
      ),
      execute: async (args) => executeTermuxTool(nativeBridge, 'termux_contacts', termuxCommandForTool('termux_contacts', args)),
    },
    {
      name: 'termux_messages',
      description: '读取短信列表，默认关闭。',
      source: 'termux',
      riskLevel: 'high',
      permission: 'sms',
      enabled: false,
      requiresConfirmation: true,
      confirmationPolicy: 'confirm',
      parameters: objectSchema(
        {
          action: enumSchema(messageActions, '短信动作。'),
          limit: {
            type: 'number',
            description: '返回条数，范围 1 到 50。',
            minimum: 1,
            maximum: 50,
          },
        },
        ['action'],
      ),
      execute: async (args) => executeTermuxTool(nativeBridge, 'termux_messages', termuxCommandForTool('termux_messages', args)),
    },
    {
      name: 'termux_call_log',
      description: '读取通话记录，默认关闭。',
      source: 'termux',
      riskLevel: 'high',
      permission: 'call_log',
      enabled: false,
      requiresConfirmation: true,
      confirmationPolicy: 'confirm',
      parameters: objectSchema(
        {
          action: enumSchema(callLogActions, '通话记录动作。'),
          limit: {
            type: 'number',
            description: '返回条数，范围 1 到 50。',
            minimum: 1,
            maximum: 50,
          },
        },
        ['action'],
      ),
      execute: async (args) => executeTermuxTool(nativeBridge, 'termux_call_log', termuxCommandForTool('termux_call_log', args)),
    },
  ]
}

export function termuxCommandForTool(toolName: TermuxToolName, args: unknown): TermuxCommandSpec {
  const record = parseRecord(args)

  if (toolName === 'termux_device_status') {
    const action = parseEnum(record.action, deviceStatusActions, 'action')
    const commands = {
      battery_status: 'termux-battery-status',
      audio_info: 'termux-audio-info',
      camera_info: 'termux-camera-info',
    } satisfies Record<(typeof deviceStatusActions)[number], string>
    return { command: commands[action], timeoutMs: 15000 }
  }

  if (toolName === 'termux_clipboard') {
    const action = parseEnum(record.action, clipboardActions, 'action')
    if (action === 'get') return { command: 'termux-clipboard-get', timeoutMs: 15000 }

    return {
      command: 'termux-clipboard-set',
      args: [parseString(record.text, 'text', { maxLength: 2000 })],
      timeoutMs: 15000,
    }
  }

  if (toolName === 'termux_notify') {
    const action = parseEnum(record.action, notifyActions, 'action')
    if (action === 'toast') {
      return { command: 'termux-toast', args: [parseString(record.text, 'text', { maxLength: 500 })], timeoutMs: 10000 }
    }
    if (action === 'vibrate') {
      return { command: 'termux-vibrate', args: ['-d', String(parseInteger(record.durationMs ?? 350, 'durationMs', 100, 5000))], timeoutMs: 10000 }
    }
    if (action === 'notification') {
      return {
        command: 'termux-notification',
        args: [
          '--title',
          parseString(record.title ?? 'morun', 'title', { maxLength: 80 }),
          '--content',
          parseString(record.text, 'text', { maxLength: 500 }),
        ],
        timeoutMs: 10000,
      }
    }
    return { command: 'termux-tts-speak', args: [parseString(record.text, 'text', { maxLength: 500 })], timeoutMs: 20000 }
  }

  if (toolName === 'termux_location') {
    const action = parseEnum(record.action, ['get'] as const, 'action')
    const provider = parseEnum(record.provider ?? 'network', locationProviders, 'provider')
    if (action === 'get') return { command: 'termux-location', args: ['-p', provider], timeoutMs: 30000 }
  }

  if (toolName === 'termux_media_capture') {
    const action = parseEnum(record.action, mediaCaptureActions, 'action')
    if (action === 'camera_photo') {
      const outputPath = parseTermuxHomePath(record.outputPath, `morun-photo-${Date.now()}.jpg`)
      return {
        command: 'termux-camera-photo',
        args: ['-c', String(parseInteger(record.cameraId ?? 0, 'cameraId', 0, 4)), outputPath],
        timeoutMs: 30000,
      }
    }

    const outputPath = parseTermuxHomePath(record.outputPath, `morun-recording-${Date.now()}.m4a`)
    return {
      command: 'termux-microphone-record',
      args: ['-f', outputPath, '-l', String(parseInteger(record.durationSeconds ?? 10, 'durationSeconds', 1, 60))],
      timeoutMs: 70000,
    }
  }

  if (toolName === 'termux_contacts') {
    parseEnum(record.action, contactActions, 'action')
    return { command: 'termux-contact-list', timeoutMs: 20000 }
  }

  if (toolName === 'termux_messages') {
    parseEnum(record.action, messageActions, 'action')
    const limit = String(parseInteger(record.limit ?? phoneDataDefaultLimit, 'limit', 1, 50))
    return { command: 'termux-sms-list', args: ['-l', limit], timeoutMs: phoneDataTimeoutMs }
  }

  parseEnum(record.action, callLogActions, 'action')
  const limit = String(parseInteger(record.limit ?? phoneDataDefaultLimit, 'limit', 1, 50))
  return { command: 'termux-call-log', args: ['-l', limit], timeoutMs: phoneDataTimeoutMs }
}

async function executeTermuxTool(
  nativeBridge: MorunNativeBridge,
  toolName: TermuxToolName,
  commandSpec: TermuxCommandSpec,
): Promise<ToolExecutionResult> {
  const requestId = createRequestId(toolName)
  const startedAt = Date.now()
  const result = await nativeBridge.runTermuxCommand({
    requestId,
    ...commandSpec,
    timeoutMs: commandSpec.timeoutMs ?? defaultTimeoutMs,
  })
  const elapsedMs = Date.now() - startedAt
  const summary = formatCommandSummary(commandSpec)

  if (!result.available) {
    throw new Error(result.stderr || result.errmsg || 'Termux 未就绪。')
  }

  const data = {
    toolName,
    command: commandSpec.command,
    args: commandSpec.args ?? [],
    permission: 'RUN_COMMAND',
    elapsedMs,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    stdout: truncate(result.stdout, 4000),
    stderr: truncate(result.stderr, 2000),
  }

  if (result.timedOut) {
    throw new Error(`Termux 命令超时：${summary}`)
  }

  if (result.exitCode !== 0) {
    throw new Error(truncate(result.stderr || result.errmsg || `Termux 命令失败，退出码 ${result.exitCode}：${summary}`, 1000))
  }

  return {
    text: [
      `命令：${summary}`,
      '权限：RUN_COMMAND',
      `耗时：${elapsedMs}ms`,
      `退出码：${result.exitCode ?? 'unknown'}`,
      result.stdout.trim() ? `stdout:\n${truncate(result.stdout.trim(), 4000)}` : '',
      result.stderr.trim() ? `stderr:\n${truncate(result.stderr.trim(), 2000)}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    data,
  }
}

function objectSchema(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  }
}

function enumSchema(values: readonly string[], description: string): JsonSchema {
  return {
    type: 'string',
    enum: [...values],
    description,
  }
}

function parseRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('参数必须是对象。')
  }
  return value as Record<string, unknown>
}

function parseEnum<T extends readonly string[]>(value: unknown, values: T, name: string): T[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new Error(`${name} 必须是 ${values.join(', ')} 之一。`)
  }
  return value
}

function parseString(value: unknown, name: string, options: { maxLength: number }) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} 必须是非空字符串。`)
  }
  return value.trim().slice(0, options.maxLength)
}

function parseInteger(value: unknown, name: string, min: number, max: number) {
  const numberValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numberValue)) {
    throw new Error(`${name} 必须是数字。`)
  }
  return Math.min(max, Math.max(min, Math.round(numberValue)))
}

function parseTermuxHomePath(value: unknown, fallbackName: string) {
  if (value === undefined || value === null || value === '') {
    return `${termuxHomePrefix}${fallbackName}`
  }

  const path = parseString(value, 'outputPath', { maxLength: 220 })
  if (!path.startsWith(termuxHomePrefix)) {
    throw new Error(`outputPath 必须位于 ${termuxHomePrefix}`)
  }
  if (path.endsWith('/')) {
    throw new Error('outputPath 必须包含文件名。')
  }
  return path
}

function formatCommandSummary(spec: TermuxCommandSpec) {
  const args = spec.args?.length ? ` ${spec.args.map((arg) => JSON.stringify(arg)).join(' ')}` : ''
  return `${spec.command}${args}`
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}\n...截断 ${value.length - maxLength} 字符`
}

function createRequestId(prefix: string) {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)
  return `${prefix}_${Date.now()}_${random}`
}
