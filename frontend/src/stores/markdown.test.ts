import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  it('renders pipe tables with inline markdown', () => {
    const html = renderMarkdown(`| 类别 | 能力 | 说明 |
|:---:|:---|:---|
| ⏰ | **查时间** | 支持指定时区 |
| 🧮 | 计算 | \`1+1\` |`)

    expect(html).toContain('<table>')
    expect(html).toContain('<th style="text-align:center">类别</th>')
    expect(html).toContain('<strong>查时间</strong>')
    expect(html).toContain('<code>1+1</code>')
  })

  it('renders remote images and placeholders for local import sources', () => {
    const remote = renderMarkdown('![照片](https://example.com/photo.jpg)')
    const local = renderMarkdown('![本地照片](/data/data/com.termux/files/home/photo.jpg)')

    expect(remote).toContain('<img class="markdown-image"')
    expect(remote).toContain('src="https://example.com/photo.jpg"')
    expect(remote).toContain('alt="照片"')
    expect(local).toContain('markdown-image-placeholder')
    expect(local).toContain('photo.jpg')
  })

  it('renders morun media images through a resolver', () => {
    const html = renderMarkdown('![自拍](morun-media://media_test123)', {
      resolveImage: (source) =>
        source === 'morun-media://media_test123'
          ? {
              mediaId: 'media_test123',
              fileName: 'selfie.jpg',
              src: 'http://localhost/_capacitor_file_/selfie.jpg',
            }
          : null,
    })

    expect(html).toContain('<img class="markdown-image"')
    expect(html).toContain('data-media-id="media_test123"')
    expect(html).toContain('src="http://localhost/_capacitor_file_/selfie.jpg"')
  })

  it('renders unknown morun media references as placeholders', () => {
    const html = renderMarkdown('![自拍](morun-media://media_missing)')

    expect(html).toContain('markdown-image-placeholder')
    expect(html).toContain('图片尚未导入')
    expect(html).not.toContain('<img ')
  })

  it('allows base64 image data urls', () => {
    const html = renderMarkdown('![小图](data:image/png;base64,aGVsbG8=)')

    expect(html).toContain('<img class="markdown-image"')
    expect(html).toContain('data:image/png;base64,aGVsbG8=')
  })

  it('does not render unsafe image or link destinations', () => {
    const html = renderMarkdown('[坏链接](javascript:alert(1))\n![坏图](javascript:alert(1))')

    expect(html).not.toContain('<a ')
    expect(html).not.toContain('<img ')
    expect(html).toContain('javascript:alert(1)')
  })

  it('escapes raw html while preserving supported markdown', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n**ok**')

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('<strong>ok</strong>')
  })
})
