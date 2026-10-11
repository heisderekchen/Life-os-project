// Rebuild allowed rich text into a new tree; imported HTML is never trusted.
const tags = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'DEL', 'CODE', 'PRE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'A', 'SPAN', 'MARK', 'HR'])
const discard = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'TEMPLATE', 'FORM', 'INPUT', 'BUTTON', 'IMG', 'VIDEO', 'AUDIO', 'LINK', 'META', 'BASE'])

export function sanitizeRichText(html: string): string {
  if (typeof document === 'undefined') return String(html).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]!))
  const input = document.createElement('template')
  input.innerHTML = String(html)
  const output = document.createElement('div')
  const copy = (node: Node, parent: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { parent.appendChild(document.createTextNode(node.textContent || '')); return }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const source = node as HTMLElement
    const tag = source.tagName.toUpperCase()
    if (discard.has(tag)) return
    if (!tags.has(tag)) { for (const child of Array.from(source.childNodes)) copy(child, parent); return }
    const target = document.createElement(source.tagName.toLowerCase())
    if (tag === 'A') {
      const href = source.getAttribute('href') || ''
      if (/^(https?:\/\/|mailto:|#|\/(?!\/))/i.test(href) && !/[\u0000-\u0020]/.test(href)) target.setAttribute('href', href)
      target.setAttribute('rel', 'noopener noreferrer')
    }
    // Keep TipTap task list metadata without permitting event/style attributes.
    for (const name of ['data-type', 'data-checked']) {
      const value = source.getAttribute(name)
      if (value && /^(taskList|taskItem|true|false)$/.test(value)) target.setAttribute(name, value)
    }
    for (const child of Array.from(source.childNodes)) copy(child, target)
    parent.appendChild(target)
  }
  for (const child of Array.from(input.content.childNodes)) copy(child, output)
  return output.innerHTML
}

const safeCodePoint = (code: number): string => {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return ''
  try {
    return String.fromCodePoint(code)
  } catch {
    return ''
  }
}

const decodeEntities = (value: string): string => value
  .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, dec: string) => safeCodePoint(parseInt(dec, 10)))
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")

// Block boundaries become spaces so words never run together when tags are dropped.
const blockSelector = 'p,br,li,h1,h2,h3,h4,h5,h6,blockquote,pre,hr,div,tr,section,article'
// These elements are never rendered as text in the sanitized editor, so they are
// removed (with their content) before we read the plain text.
const opaqueSelector = 'script,style,iframe,object,embed,svg,math,template,noscript'

/**
 * Flatten stored rich-text HTML into a single, unescaped line of plain text.
 *
 * The list summary must never show raw markup like `<p>…</p>`. This reads text
 * out of an inert template (so nothing executes) and drops script/style content,
 * which is a lossy read-only projection. It does not touch `sanitizeRichText`,
 * so the editor's sanitized rendering guarantees are unchanged.
 */
export function richTextToPlainText(html: string): string {
  const source = typeof html === 'string' ? html : ''
  if (!source) return ''
  if (typeof document === 'undefined') {
    const stripped = source
      .replace(/<(script|style|iframe|object|embed|svg|math|template|noscript)[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<\/?(p|br|li|h[1-6]|blockquote|pre|hr|div|tr|section|article)\b[^>]*>/gi, ' ')
      .replace(/<[^>]*>/g, '')
    return decodeEntities(stripped).replace(/\s+/g, ' ').trim()
  }
  const template = document.createElement('template')
  template.innerHTML = source
  template.content.querySelectorAll(opaqueSelector).forEach(node => node.remove())
  template.content.querySelectorAll(blockSelector).forEach(node => node.after(document.createTextNode(' ')))
  return (template.content.textContent || '').replace(/\s+/g, ' ').trim()
}

/** A single-line, plain-text excerpt of rich-text content for list previews. */
export function richTextExcerpt(html: string, maxLength = 120): string {
  const text = richTextToPlainText(html)
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength).replace(/\s+\S*$/, '').trimEnd()}…`
}
