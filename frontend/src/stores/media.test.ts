import { describe, expect, it } from 'vitest'
import {
  extractMarkdownImageReferences,
  isImportableImageSource,
  isTermuxHomeImageSource,
  mediaIdFromUrl,
  mediaUrl,
  normalizeMediaAttachments,
} from './media'

describe('media helpers', () => {
  it('recognizes morun media urls', () => {
    expect(mediaUrl('media_test123')).toBe('morun-media://media_test123')
    expect(mediaIdFromUrl('morun-media://media_test123')).toBe('media_test123')
  })

  it('recognizes safe Termux home image sources', () => {
    expect(isTermuxHomeImageSource('/data/data/com.termux/files/home/selfie.jpg')).toBe(true)
    expect(isTermuxHomeImageSource('/data/data/com.termux/files/home/../secret.jpg')).toBe(false)
    expect(isTermuxHomeImageSource('/data/data/com.other/files/home/selfie.jpg')).toBe(false)
    expect(isTermuxHomeImageSource('/data/data/com.termux/files/home/file.svg')).toBe(false)
  })

  it('detects importable image sources', () => {
    expect(isImportableImageSource('https://example.com/photo.jpg')).toBe(true)
    expect(isImportableImageSource('content://media/external/images/1')).toBe(true)
    expect(isImportableImageSource('data:image/png;base64,aGVsbG8=')).toBe(true)
    expect(isImportableImageSource('/data/user/0/com.morun.app/files/morun-media/media_test123.jpg')).toBe(true)
    expect(isImportableImageSource('/storage/emulated/0/DCIM/photo.jpg')).toBe(false)
    expect(isImportableImageSource('javascript:alert(1)')).toBe(false)
  })

  it('extracts markdown image references while ignoring code fences', () => {
    const refs = extractMarkdownImageReferences([
      '![one](https://example.com/a.jpg)',
      '```',
      '![skip](https://example.com/b.jpg)',
      '```',
      '![two](/data/data/com.termux/files/home/selfie.jpg)',
    ].join('\n'))

    expect(refs.map((ref) => ref.source)).toEqual([
      'https://example.com/a.jpg',
      '/data/data/com.termux/files/home/selfie.jpg',
    ])
  })

  it('normalizes stored media attachments', () => {
    const attachments = normalizeMediaAttachments([
      {
        mediaId: 'media_test123',
        kind: 'image',
        originalSource: 'https://example.com/photo.jpg',
        localPath: '/data/user/0/com.morun.app/files/morun-media/media_test123.jpg',
        mimeType: 'image/jpeg',
        fileName: 'media_test123.jpg',
        size: 100,
        createdAt: 1,
      },
      {
        mediaId: 'bad',
        kind: 'image',
        originalSource: 'javascript:alert(1)',
        localPath: '/tmp/x.svg',
        mimeType: 'image/svg+xml',
        fileName: 'x.svg',
        size: 100,
        createdAt: 1,
      },
    ])

    expect(attachments).toHaveLength(1)
    expect(attachments[0]).toMatchObject({
      mediaId: 'media_test123',
      mimeType: 'image/jpeg',
    })
  })
})
