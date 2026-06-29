import { Capacitor } from '@capacitor/core'

interface MarkdownTable {
  headers: string[]
  alignments: Array<'left' | 'center' | 'right' | null>
  rows: string[][]
  endIndex: number
}

export function renderMarkdown(value: string) {
  const source = value.trim()
  if (!source) return ''

  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const html: string[] = []
  let paragraph: string[] = []

  const flushParagraph = () => {
    if (!paragraph.length) return
    html.push(`<p>${renderInlineMarkdown(paragraph.join('\n')).replace(/\n/g, '<br>')}</p>`)
    paragraph = []
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmed = line.trim()
    const fence = trimmed.match(/^```([\w-]+)?\s*$/)

    if (fence) {
      flushParagraph()
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index])
        index += 1
      }
      html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
      continue
    }

    if (!trimmed) {
      flushParagraph()
      continue
    }

    const table = parseMarkdownTable(lines, index)
    if (table) {
      flushParagraph()
      html.push(renderMarkdownTable(table))
      index = table.endIndex
      continue
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      flushParagraph()
      const level = heading[1].length
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`)
      continue
    }

    if (/^([-*_])\s*\1\s*\1\s*$/.test(trimmed)) {
      flushParagraph()
      html.push('<hr>')
      continue
    }

    const unorderedItems: string[] = []
    while (index < lines.length) {
      const item = lines[index].match(/^\s*[-*]\s+(.+)$/)
      if (!item) break
      unorderedItems.push(`<li>${renderInlineMarkdown(item[1])}</li>`)
      index += 1
    }
    if (unorderedItems.length) {
      flushParagraph()
      html.push(`<ul>${unorderedItems.join('')}</ul>`)
      index -= 1
      continue
    }

    const orderedItems: string[] = []
    while (index < lines.length) {
      const item = lines[index].match(/^\s*\d+\.\s+(.+)$/)
      if (!item) break
      orderedItems.push(`<li>${renderInlineMarkdown(item[1])}</li>`)
      index += 1
    }
    if (orderedItems.length) {
      flushParagraph()
      html.push(`<ol>${orderedItems.join('')}</ol>`)
      index -= 1
      continue
    }

    const quoteLines: string[] = []
    while (index < lines.length) {
      const quote = lines[index].match(/^\s*>\s?(.*)$/)
      if (!quote) break
      quoteLines.push(quote[1])
      index += 1
    }
    if (quoteLines.length) {
      flushParagraph()
      html.push(`<blockquote>${renderMarkdown(quoteLines.join('\n'))}</blockquote>`)
      index -= 1
      continue
    }

    paragraph.push(line)
  }

  flushParagraph()
  return html.join('')
}

function parseMarkdownTable(lines: string[], startIndex: number): MarkdownTable | null {
  const headerLine = lines[startIndex]
  const separatorLine = lines[startIndex + 1]
  if (!separatorLine || !isTableRow(headerLine)) return null

  const headers = splitTableRow(headerLine)
  const alignments = parseTableSeparator(separatorLine)
  if (!alignments || headers.length < 2 || alignments.length !== headers.length) return null

  const rows: string[][] = []
  let index = startIndex + 2
  while (index < lines.length && isTableRow(lines[index])) {
    rows.push(normalizeTableRow(splitTableRow(lines[index]), headers.length))
    index += 1
  }

  return {
    headers,
    alignments,
    rows,
    endIndex: index - 1,
  }
}

function renderMarkdownTable(table: MarkdownTable) {
  const headerHtml = table.headers
    .map((cell, index) => `<th${tableCellAlignAttribute(table.alignments[index])}>${renderInlineMarkdown(cell)}</th>`)
    .join('')
  const bodyHtml = table.rows
    .map((row) => {
      const cells = row
        .map((cell, index) => `<td${tableCellAlignAttribute(table.alignments[index])}>${renderInlineMarkdown(cell)}</td>`)
        .join('')
      return `<tr>${cells}</tr>`
    })
    .join('')

  return `<div class="markdown-table-wrap"><table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`
}

function isTableRow(line: string) {
  return line.includes('|') && splitTableRow(line).length >= 2
}

function splitTableRow(line: string) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let current = ''

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index]
    if (char === '|' && trimmed[index - 1] !== '\\') {
      cells.push(current.replace(/\\\|/g, '|').trim())
      current = ''
      continue
    }
    current += char
  }
  cells.push(current.replace(/\\\|/g, '|').trim())

  return cells
}

function parseTableSeparator(line: string) {
  const cells = splitTableRow(line)
  if (!cells.length || cells.some((cell) => !/^:?-{3,}:?$/.test(cell.trim()))) return null

  return cells.map((cell) => {
    const trimmed = cell.trim()
    if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center'
    if (trimmed.endsWith(':')) return 'right'
    if (trimmed.startsWith(':')) return 'left'
    return null
  })
}

function normalizeTableRow(row: string[], length: number) {
  return Array.from({ length }, (_value, index) => row[index] ?? '')
}

function tableCellAlignAttribute(align: MarkdownTable['alignments'][number]) {
  return align ? ` style="text-align:${align}"` : ''
}

function renderInlineMarkdown(value: string) {
  const placeholders: string[] = []
  const hold = (html: string) => {
    const key = `\u0000${placeholders.length}\u0000`
    placeholders.push(html)
    return key
  }

  let text = value.replace(/`([^`\n]+)`/g, (_match, code: string) => hold(`<code>${escapeHtml(code)}</code>`))

  text = text.replace(/!\[([^\]\n]*)\]\(([^)\n]+)\)/g, (match, alt: string, rawSrc: string) => {
    const src = sanitizeMarkdownImageSrc(parseMarkdownDestination(rawSrc))
    if (!src) return match
    return hold(`<img class="markdown-image" src="${escapeAttribute(src)}" alt="${escapeAttribute(alt)}" loading="lazy">`)
  })

  text = text.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (match, label: string, rawHref: string) => {
    const safeHref = sanitizeMarkdownHref(parseMarkdownDestination(rawHref))
    if (!safeHref) return match
    return hold(
      `<a href="${escapeAttribute(safeHref)}" target="_blank" rel="noreferrer noopener">${escapeHtml(label)}</a>`,
    )
  })

  let html = escapeHtml(text)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
    .replace(/(^|[^\*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>')

  placeholders.forEach((placeholder, index) => {
    html = html.replaceAll(`\u0000${index}\u0000`, placeholder)
  })

  return html
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

function sanitizeMarkdownHref(value: string) {
  const trimmed = value.trim()
  return /^(https?:|mailto:|tel:)/i.test(trimmed) ? trimmed : ''
}

function sanitizeMarkdownImageSrc(value: string) {
  const trimmed = value.trim()
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=]+$/i.test(trimmed)) return trimmed
  if (/^(blob:|content:|file:|capacitor:)/i.test(trimmed)) return convertFileSrc(trimmed)
  if (/^(\/|\.\/|\.\.\/)/.test(trimmed)) return convertFileSrc(trimmed)

  return ''
}

function convertFileSrc(value: string) {
  try {
    return Capacitor.convertFileSrc(value) || value
  } catch {
    return value
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttribute(value: string) {
  return escapeHtml(value)
}
