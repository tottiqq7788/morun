import { Capacitor } from '@capacitor/core'

export const morunMediaScheme = 'morun-media://'
export const maxImageMediaBytes = 12 * 1024 * 1024
export const termuxHomePrefix = '/data/data/com.termux/files/home/'

export type MediaKind = 'image'

export interface MediaAttachment {
  mediaId: string
  kind: MediaKind
  originalSource: string
  localPath: string
  mimeType: string
  fileName: string
  size: number
  createdAt: number
}

export interface ImportMediaResult extends MediaAttachment {}

export interface MarkdownImageReference {
  alt: string
  source: string
}

const imageExtensions = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif'])
const imageMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export function mediaUrl(mediaId: string) {
  return `${morunMediaScheme}${encodeURIComponent(mediaId)}`
}

export function mediaIdFromUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed.toLowerCase().startsWith(morunMediaScheme)) return ''

  try {
    return decodeURIComponent(trimmed.slice(morunMediaScheme.length))
  } catch {
    return trimmed.slice(morunMediaScheme.length)
  }
}

export function mediaAttachmentViewSrc(attachment: Pick<MediaAttachment, 'localPath'>) {
  try {
    return Capacitor.convertFileSrc(attachment.localPath) || attachment.localPath
  } catch {
    return attachment.localPath
  }
}

export function normalizeMediaSource(value: string) {
  return value.trim()
}

export function isImportableImageSource(value: string) {
  const source = normalizeMediaSource(value)
  if (!source || /[\u0000-\u001f\u007f]/.test(source)) return false
  if (/^https:\/\//i.test(source)) return true
  if (/^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(source)) return true
  if (/^content:\/\//i.test(source)) return true
  if (isTermuxHomeImageSource(source)) return true
  if (isMorunReadableFileSource(source)) return true
  return false
}

export function isTermuxHomeImageSource(value: string) {
  const path = sourceToPath(value)
  if (!path.startsWith(termuxHomePrefix)) return false
  if (path.split('/').includes('..')) return false
  return hasImageExtension(path)
}

export function isMorunReadableFileSource(value: string) {
  const path = sourceToPath(value)
  if (!path || path.split('/').includes('..')) return false
  if (!/^file:\/\//i.test(value) && !/^(\/|\.\/|\.\.\/)/.test(value)) return false
  if (!path.startsWith('/data/user/0/com.morun.app/') && !path.startsWith('/data/data/com.morun.app/')) return false
  return hasImageExtension(path)
}

export function extractMarkdownImageReferences(value: string): MarkdownImageReference[] {
  const withoutFences = value.replace(/```[\s\S]*?```/g, '')
  const references: MarkdownImageReference[] = []
  const pattern = /!\[([^\]\n]*)\]\(([^)\n]+)\)/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(withoutFences))) {
    references.push({
      alt: match[1],
      source: parseMarkdownDestination(match[2]),
    })
  }

  return references
}

export function findMediaAttachmentBySource(
  attachments: readonly MediaAttachment[],
  source: string,
) {
  const normalized = normalizeMediaSource(source)
  return attachments.find((attachment) => normalizeMediaSource(attachment.originalSource) === normalized) ?? null
}

export function findMediaAttachmentById(
  attachments: readonly MediaAttachment[],
  mediaId: string,
) {
  return attachments.find((attachment) => attachment.mediaId === mediaId) ?? null
}

export function normalizeMediaAttachments(value: unknown): MediaAttachment[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item): MediaAttachment | null => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const raw = item as Partial<MediaAttachment>
      if (raw.kind !== 'image') return null
      if (!isSafeMediaId(raw.mediaId)) return null
      if (typeof raw.originalSource !== 'string' || !raw.originalSource.trim()) return null
      if (typeof raw.localPath !== 'string' || !raw.localPath.trim()) return null
      if (typeof raw.mimeType !== 'string' || !imageMimeTypes.has(raw.mimeType)) return null
      if (typeof raw.fileName !== 'string' || !raw.fileName.trim()) return null
      if (typeof raw.size !== 'number' || !Number.isFinite(raw.size) || raw.size <= 0 || raw.size > maxImageMediaBytes) {
        return null
      }

      return {
        mediaId: raw.mediaId,
        kind: 'image',
        originalSource: raw.originalSource,
        localPath: raw.localPath,
        mimeType: raw.mimeType,
        fileName: raw.fileName,
        size: Math.round(raw.size),
        createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
      }
    })
    .filter((attachment): attachment is MediaAttachment => Boolean(attachment))
}

export function isSafeMediaId(value: unknown): value is string {
  return typeof value === 'string' && /^media_[a-zA-Z0-9_-]{6,80}$/.test(value)
}

export function createMediaId() {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)
  return `media_${random.replace(/[^a-zA-Z0-9_-]/g, '')}`
}

function parseMarkdownDestination(value: string) {
  const trimmed = value.trim()
  if (trimmed.startsWith('<')) {
    const endIndex = trimmed.indexOf('>')
    return endIndex > 0 ? trimmed.slice(1, endIndex) : trimmed
  }

  const titled = trimmed.match(/^(\S+)(?:\s+["'][^"']*["'])?$/)
  return titled?.[1] ?? trimmed
}

function sourceToPath(value: string) {
  const source = normalizeMediaSource(value)
  if (/^file:\/\//i.test(source)) {
    try {
      return decodeURIComponent(new URL(source).pathname)
    } catch {
      return source.replace(/^file:\/\//i, '')
    }
  }
  return source
}

function hasImageExtension(value: string) {
  const clean = value.split(/[?#]/)[0].toLowerCase()
  const extension = clean.match(/\.([a-z0-9]+)$/)?.[1] ?? ''
  return imageExtensions.has(extension)
}
