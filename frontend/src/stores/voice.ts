import { Capacitor } from '@capacitor/core'

export const maxVoiceAudioBytes = 20 * 1024 * 1024
export const voiceMimeType = 'audio/wav'

export interface VoiceSegment {
  text: string
  raw?: string
}

export interface VoiceAttachment {
  voiceId: string
  localPath: string
  fileName: string
  mimeType: typeof voiceMimeType
  size: number
  durationMs: number
  sampleRate: number
  transcript: string
  recognitionElapsedMs: number
  createdAt: number
  limited?: boolean
  segments?: VoiceSegment[]
}

export function voiceAudioSrc(attachment: Pick<VoiceAttachment, 'localPath'>) {
  try {
    return Capacitor.convertFileSrc(attachment.localPath) || attachment.localPath
  } catch {
    return attachment.localPath
  }
}

export function normalizeVoiceAttachment(value: unknown): VoiceAttachment | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Partial<VoiceAttachment>
  if (!isSafeVoiceId(raw.voiceId)) return undefined
  if (typeof raw.localPath !== 'string' || !isSafeVoicePath(raw.localPath)) return undefined
  if (typeof raw.fileName !== 'string' || !/^voice_[a-zA-Z0-9_-]{6,80}\.wav$/.test(raw.fileName)) return undefined
  if (raw.fileName !== `${raw.voiceId}.wav`) return undefined
  if (raw.mimeType !== voiceMimeType) return undefined
  if (!isPositiveFinite(raw.size) || raw.size > maxVoiceAudioBytes) return undefined
  if (!isPositiveFinite(raw.durationMs)) return undefined
  if (!isPositiveFinite(raw.sampleRate)) return undefined
  if (!Number.isInteger(raw.sampleRate) || raw.sampleRate < 8000 || raw.sampleRate > 48000) return undefined
  if (typeof raw.transcript !== 'string' || !raw.transcript.trim()) return undefined
  if (!isPositiveFinite(raw.recognitionElapsedMs)) return undefined

  return {
    voiceId: raw.voiceId,
    localPath: raw.localPath,
    fileName: raw.fileName,
    mimeType: voiceMimeType,
    size: Math.round(raw.size),
    durationMs: Math.round(raw.durationMs),
    sampleRate: Math.round(raw.sampleRate),
    transcript: raw.transcript.trim(),
    recognitionElapsedMs: Math.round(raw.recognitionElapsedMs),
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    limited: raw.limited === true,
    segments: normalizeVoiceSegments(raw.segments),
  }
}

export function formatVoiceDuration(durationMs: number) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '0.0s'
  return `${(durationMs / 1000).toFixed(1)}s`
}

export function isSafeVoiceId(value: unknown): value is string {
  return typeof value === 'string' && /^voice_[a-zA-Z0-9_-]{6,80}$/.test(value)
}

function normalizeVoiceSegments(value: unknown): VoiceSegment[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item): VoiceSegment | null => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const raw = item as Partial<VoiceSegment>
      if (typeof raw.text !== 'string' || !raw.text.trim()) return null
      const segment: VoiceSegment = { text: raw.text.trim() }
      if (typeof raw.raw === 'string' && raw.raw.trim()) segment.raw = raw.raw
      return segment
    })
    .filter((item): item is VoiceSegment => Boolean(item))
}

function isSafeVoicePath(value: string) {
  if (!value.trim() || value.includes('\0') || value.includes('/../')) return false
  if (!value.endsWith('.wav')) return false
  return /^\/data\/user\/\d+\/com\.morun\.app\/files\/morun-voice\//.test(value) ||
    value.startsWith('/data/data/com.morun.app/files/morun-voice/')
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}
