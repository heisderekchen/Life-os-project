import { describe, expect, it } from 'vitest'
import { richTextExcerpt, richTextToPlainText, sanitizeRichText } from '@/lib/rich-text-safety'

describe('untrusted rich text', () => {
  it('preserves text, headings, emphasis, lists and safe links', () => {
    const result = sanitizeRichText('<h2>用户输入 English</h2><p><strong>重要</strong></p><ul><li>事项</li></ul><a href="https://example.com">链接</a>')
    expect(result).toContain('<h2>用户输入 English</h2>')
    expect(result).toContain('<strong>重要</strong>')
    expect(result).toContain('href="https://example.com"')
  })
  it('removes scripts, embedded content, event attributes and dangerous URLs without executing them', () => {
    const result = sanitizeRichText('<script>throw new Error("must not execute")</script><p onclick="x()" style="background:url(https://example.com)">safe</p><img src=x onerror="x()"><svg onload="x()"><script>x()</script></svg><a href="jav&#x61;script:x()">link</a><a href="data:text/html,test">data</a>')
    expect(result).toBe('<p>safe</p><a rel="noopener noreferrer">link</a><a rel="noopener noreferrer">data</a>')
  })
  it('is idempotent and strips attributes on allowed elements', () => {
    const once = sanitizeRichText('<p id="injected" onmouseover="x()"><em>hello</em></p>')
    expect(once).toBe('<p><em>hello</em></p>')
    expect(sanitizeRichText(once)).toBe(once)
  })
})

describe('rich text to plain text (list summaries)', () => {
  it('flattens stored HTML into readable text instead of raw markup', () => {
    const text = richTextToPlainText('<p>这是<strong>演示</strong>数据</p><p>第二段</p>')
    expect(text).toBe('这是演示数据 第二段')
    expect(text).not.toMatch(/[<>]/)
  })

  it('decodes entities and never leaks markup or attributes', () => {
    const text = richTextToPlainText('<p title="x">A &amp; B &lt;tag&gt; &#39;q&#39;</p>')
    expect(text).toBe("A & B <tag> 'q'")
  })

  it('drops script and style content instead of rendering it as text', () => {
    expect(richTextToPlainText('<script>alert(1)</script><style>.x{}</style><p>safe</p>')).toBe('safe')
  })

  it('returns an empty string for empty or tag-only content', () => {
    expect(richTextToPlainText('')).toBe('')
    expect(richTextToPlainText('<p></p><br />')).toBe('')
  })
})

describe('richTextExcerpt', () => {
  it('returns the full plain text when it already fits', () => {
    expect(richTextExcerpt('<p>short note</p>')).toBe('short note')
  })

  it('truncates long content to a plain-text excerpt with an ellipsis', () => {
    const excerpt = richTextExcerpt(`<p>${'word '.repeat(40)}</p>`, 40)
    expect(excerpt.endsWith('…')).toBe(true)
    expect(excerpt.length).toBeLessThanOrEqual(41)
    expect(excerpt).not.toMatch(/[<>]/)
  })
})
