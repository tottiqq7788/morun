import { describe, expect, it } from 'vitest'
import { formatVoiceDuration, normalizeVoiceAttachment, voiceAudioSrc } from './voice'

const validVoice = {
  voiceId: 'voice_test123',
  localPath: '/data/user/0/com.morun.app/files/morun-voice/voice_test123.wav',
  fileName: 'voice_test123.wav',
  mimeType: 'audio/wav',
  size: 2048,
  durationMs: 1800.4,
  sampleRate: 16000,
  transcript: ' 今天天气怎么样 ',
  recognitionElapsedMs: 220.5,
  createdAt: 100,
  segments: [{ text: ' 今天天气怎么样 ', raw: '{"text":"今天天气怎么样"}' }],
}

describe('voice attachment store helpers', () => {
  it('normalizes safe Android voice metadata', () => {
    expect(normalizeVoiceAttachment(validVoice)).toMatchObject({
      voiceId: 'voice_test123',
      localPath: '/data/user/0/com.morun.app/files/morun-voice/voice_test123.wav',
      fileName: 'voice_test123.wav',
      mimeType: 'audio/wav',
      size: 2048,
      durationMs: 1800,
      sampleRate: 16000,
      transcript: '今天天气怎么样',
      recognitionElapsedMs: 221,
      createdAt: 100,
      segments: [{ text: '今天天气怎么样', raw: '{"text":"今天天气怎么样"}' }],
    })
  })

  it('drops unsafe voice metadata', () => {
    expect(normalizeVoiceAttachment({ ...validVoice, localPath: '/tmp/voice_test123.wav' })).toBeUndefined()
    expect(normalizeVoiceAttachment({ ...validVoice, fileName: 'voice_other123.wav' })).toBeUndefined()
    expect(normalizeVoiceAttachment({ ...validVoice, mimeType: 'audio/mpeg' })).toBeUndefined()
    expect(normalizeVoiceAttachment({ ...validVoice, size: 40 * 1024 * 1024 })).toBeUndefined()
    expect(normalizeVoiceAttachment({ ...validVoice, transcript: '   ' })).toBeUndefined()
  })

  it('formats duration and converts playback source defensively', () => {
    expect(formatVoiceDuration(1850)).toBe('1.9s')
    expect(formatVoiceDuration(0)).toBe('0.0s')
    expect(voiceAudioSrc({ localPath: validVoice.localPath })).toContain('voice_test123.wav')
  })
})
