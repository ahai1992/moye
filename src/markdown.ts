import DOMPurify from 'dompurify'
import { Marked } from 'marked'
import type { Token, TokensList } from 'marked'
import katex from 'katex'
import hljs from 'highlight.js/lib/common'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'

export interface MarkdownBlock { raw: string; html: string; hidden?: boolean }
export interface MarkdownHeading { level: number; text: string; from: number }

const frontmatterPattern = /^---\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/

export function headingText(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement
  clone.querySelectorAll<HTMLElement>('[data-md-source]').forEach(node => node.replaceWith(widgetSource(node)))
  clone.querySelectorAll<HTMLImageElement>('img').forEach(node => node.replaceWith(node.alt))
  return clone.textContent?.replace(/\s+/g, ' ').trim() || '（空标题）'
}

export function markdownHeadings(markdown: string): MarkdownHeading[] {
  const offset = frontmatterPattern.exec(markdown)?.[0].length ?? 0
  const text = markdown.slice(offset)
  const tokens = parser.lexer(text)
  const headings: MarkdownHeading[] = []
  // 容器会移除引用符或列表缩进；逐行映射回原文，保留精确的源码位置。
  const childPosition = (raw: string, child: string, parent: (position: number) => number) => {
    const lines = child.split('\n')
    const positions: { start: number; source: number }[] = []
    let cursor = 0
    let start = 0
    for (const line of lines) {
      while (cursor < raw.length) {
        const end = raw.indexOf('\n', cursor)
        const stop = end < 0 ? raw.length : end
        const original = raw.slice(cursor, stop)
        cursor = stop + 1
        if (!original.endsWith(line)) continue
        positions.push({ start, source: parent(stop - line.length) })
        break
      }
      start += line.length + 1
    }
    positions.reverse()
    return (position: number) => {
      const line = positions.find(line => line.start <= position)
      return line ? line.source + position - line.start : parent(0)
    }
  }
  const walk = (items: Token[], source: string, position: (offset: number) => number) => {
    let cursor = 0
    for (const token of items) {
      const found = source.indexOf(token.raw, cursor)
      if (found < 0) continue
      cursor = found + token.raw.length
      if (token.type === 'heading') {
        const element = document.createElement('template')
        const list = [token] as TokensList
        list.links = tokens.links
        element.innerHTML = cleanRendered(parser.parser(list))
        headings.push({ level: token.depth, text: headingText(element.content.firstElementChild as HTMLElement), from: position(found) })
      } else if (token.type === 'blockquote' || token.type === 'list_item') {
        walk(token.tokens ?? [], token.text, childPosition(token.raw, token.text, value => position(found + value)))
      } else if (token.type === 'list') {
        walk(token.items, token.raw, value => position(found + value))
      }
    }
  }
  walk(tokens, text, value => offset + value)
  return headings
}

export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]!)

function protectedMarkup(raw: string, body: string, block = false, kind = 'math'): string {
  const tag = block ? 'div' : 'span'
  return `<${tag} data-md-source="${escapeHtml(encodeURIComponent(raw))}" data-kind="${kind}" contenteditable="false" tabindex="0" title="双击或按 Enter 编辑" class="md-widget ${block ? 'block-widget' : ''}">${body}</${tag}>`
}

export const widgetSource = (element: HTMLElement) => decodeURIComponent(element.dataset.mdSource ?? '')

function mathMarkup(raw: string, expression: string, displayMode: boolean): string {
  return protectedMarkup(raw, katex.renderToString(expression, {
    displayMode, throwOnError: false, trust: false, strict: 'ignore', output: 'html',
  }), displayMode)
}

const parser = new Marked({ gfm: true, breaks: false })
parser.use({
  renderer: {
    html({ text }) {
      // 文档里的 HTML 不能伪装成编辑器内部节点，也不能携带事件或脚本。
      if (/^<\/[a-z][\w:-]*\s*>$/i.test(text)) return text
      const sanitized = DOMPurify.sanitize(text, { ALLOW_DATA_ATTR: false, FORBID_ATTR: ['contenteditable', 'tabindex'], FORBID_TAGS: ['style', 'input', 'form', 'button', 'textarea'] })
      const opening = /^<([a-z][\w:-]*)\b[^>]*>$/i.exec(text)
      // 内联 HTML 的开闭标签是独立 token，保留它们的结构，再由整块清洗兜底。
      return opening ? sanitized.replace(new RegExp(`</${opening[1]}>$`, 'i'), '') : sanitized
    },
    code({ text, lang, raw }) {
      const language = (lang ?? '').split(/\s+/)[0] ?? ''
      if (language.toLowerCase() === 'mermaid') {
        return protectedMarkup(raw, `<pre>${escapeHtml(text)}</pre>`, true, 'mermaid')
      }
      const highlighted = hljs.getLanguage(language)
        ? hljs.highlight(text, { language, ignoreIllegals: true }).value : escapeHtml(text)
      return `<pre><code class="language-${escapeHtml(language)}">${highlighted}</code></pre>`
    },
    blockquote(token) {
      const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?/i.exec(token.text)
      if (!match) return false
      const body = token.text.slice(match[0].length)
      return `<blockquote class="markdown-alert" data-alert="${match[1]!.toUpperCase()}"><p class="alert-label" contenteditable="false">${match[1]!.toUpperCase()}</p>${parser.parse(body)}</blockquote>`
    },
  },
  extensions: [
    {
      name: 'mathBlock', level: 'block',
      start: src => src.indexOf('$$'),
      tokenizer(src) {
        const match = /^ {0,3}\$\$[ \t]*\n([\s\S]*?)\n {0,3}\$\$[ \t]*(?:\n|$)/.exec(src)
        if (match) return { type: 'mathBlock', raw: match[0], text: match[1]! }
      },
      renderer: token => mathMarkup(token.raw, token.text as string, true),
    },
    {
      name: 'mathInline', level: 'inline',
      start: src => src.indexOf('$'),
      tokenizer(src) {
        const match = /^(\${1,2})(?!\s|\$)((?:\\.|[^\\\n$])+?)\1(?!\d)/.exec(src)
        if (match) return { type: 'mathInline', raw: match[0], text: match[2]!, display: match[1]!.length === 2 }
      },
      renderer: token => mathMarkup(token.raw, token.text as string, Boolean(token.display)),
    },
    {
      name: 'footnoteDefinition', level: 'block',
      start: src => src.search(/^\[\^[^\]]+\]:/m),
      tokenizer(src) {
        const match = /^\[\^([^\]]+)\]:[ \t]*([^\n]*(?:\n(?: {4}|\t)[^\n]*)*)(?:\n|$)/.exec(src)
        if (match) return { type: 'footnoteDefinition', raw: match[0], label: match[1]!, text: match[2]!.replace(/\n(?: {4}|\t)/g, '\n') }
      },
      renderer(token) {
        return protectedMarkup(token.raw, `<div class="footnote" id="fn-${escapeHtml(token.label as string)}"><sup>${escapeHtml(token.label as string)}</sup> ${parser.parseInline(token.text as string)}</div>`, true, 'footnote')
      },
    },
    {
      name: 'footnoteReference', level: 'inline',
      start: src => src.indexOf('[^'),
      tokenizer(src) {
        const match = /^\[\^([^\]]+)\]/.exec(src)
        if (match) return { type: 'footnoteReference', raw: match[0], label: match[1]! }
      },
      renderer: token => protectedMarkup(token.raw, `<sup>${escapeHtml(token.label as string)}</sup>`, false, 'footnote'),
    },
  ],
})

function cleanRendered(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['contenteditable', 'tabindex'],
    FORBID_TAGS: ['style', 'form', 'button', 'textarea'],
  })
}

export function markdownBlocks(markdown: string, referenceMarkdown?: string): MarkdownBlock[] {
  if (!markdown) return []
  const blocks: MarkdownBlock[] = []
  let offset = 0
  // YAML 元数据作为原文保存；编辑时不会被误转成标题和分隔线。
  const frontmatter = frontmatterPattern.exec(markdown)
  if (frontmatter) {
    blocks.push({ raw: frontmatter[0], html: protectedMarkup(frontmatter[0], '<div class="metadata-label">文档属性 · 双击编辑</div>', true, 'metadata') })
    offset = frontmatter[0].length
  }
  let tokens: TokensList
  if (referenceMarkdown) {
    const links = parser.lexer(referenceMarkdown).links
    const lexer = new parser.Lexer({ ...parser.defaults })
    lexer.blockTokens(markdown.slice(offset), lexer.tokens)
    // 行内解析之前补齐文档中的引用定义；片段内的新定义优先。
    lexer.tokens.links = { ...links, ...lexer.tokens.links }
    tokens = lexer.lex('')
  } else tokens = parser.lexer(markdown.slice(offset))
  for (const token of tokens) {
    const found = markdown.indexOf(token.raw, offset)
    if (found < 0) throw new Error('此文档暂时无法完整显示，请切换到源码编辑。')
    if (found > offset) blocks.push({ raw: markdown.slice(offset, found), html: '', hidden: true })
    const nextOffset = found + token.raw.length
    if (token.type === 'space' && blocks.length) {
      blocks[blocks.length - 1]!.raw += token.raw
    } else {
      const list = [token] as TokensList
      list.links = tokens.links
      blocks.push({ raw: token.raw, html: cleanRendered(parser.parser(list)), hidden: token.type === 'space' })
    }
    offset = nextOffset
  }
  if (offset < markdown.length) blocks.push({ raw: markdown.slice(offset), html: '', hidden: true })
  return blocks
}

const converter = new TurndownService({
  headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*', strongDelimiter: '**',
})
converter.use(gfm)
converter.keep(['details', 'summary', 'sub', 'sup', 'kbd', 'mark', 'u'])
converter.addRule('source-widget', {
  filter: node => (node as HTMLElement).hasAttribute?.('data-md-source'),
  replacement: (_content, node) => widgetSource(node as HTMLElement),
})
converter.addRule('alert', {
  filter: node => (node as HTMLElement).hasAttribute?.('data-alert'),
  replacement(content, node) {
    const type = (node as HTMLElement).dataset.alert!
    return `\n\n> [!${type}]\n${content.trim().replace(/^/gm, '> ')}\n\n`
  },
})
converter.addRule('alert-label', { filter: node => (node as HTMLElement).classList?.contains('alert-label'), replacement: () => '' })
converter.addRule('code-fence', {
  filter: node => node.nodeName === 'PRE' && node.firstChild?.nodeName === 'CODE',
  replacement(_content, node) {
    const code = node.firstChild as HTMLElement
    const language = /language-([^\s]*)/.exec(code.className)?.[1] ?? ''
    const text = code.textContent ?? ''
    const longest = Math.max(2, ...Array.from(text.matchAll(/`+/g), match => match[0].length))
    const fence = '`'.repeat(longest + 1)
    return `\n\n${fence}${language}\n${text.replace(/\n$/, '')}\n${fence}\n\n`
  },
})

export function htmlToMarkdown(element: HTMLElement): string {
  const clone = cloneForConversion(element)
  clone.querySelectorAll<HTMLImageElement>('img[data-original-src]').forEach(img => {
    img.setAttribute('src', img.dataset.originalSrc!)
    if (img.dataset.originalTitle) img.title = img.dataset.originalTitle
    else img.removeAttribute('title')
    delete img.dataset.originalSrc
    delete img.dataset.originalTitle
    delete img.dataset.imageLoaded
  })
  // Turndown 会将 HTML 中的空白折叠；代码中的换行由自定义规则保留。
  return converter.turndown(clone.innerHTML)
}

export function comparableHtml(element: HTMLElement): string {
  const clone = cloneForConversion(element)
  clone.querySelectorAll<HTMLElement>('[data-md-source]').forEach(widget => {
    widget.innerHTML = ''
    widget.removeAttribute('data-rendered')
  })
  clone.querySelectorAll<HTMLImageElement>('img[data-original-src]').forEach(img => {
    img.setAttribute('src', img.dataset.originalSrc!)
    img.removeAttribute('data-image-loaded')
    img.removeAttribute('title')
  })
  clone.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(input => input.toggleAttribute('checked', input.checked))
  return clone.innerHTML
}

function cloneForConversion(element: HTMLElement): HTMLElement {
  const clone = element.cloneNode(true) as HTMLElement
  // 局部替换的空注释仅用于撤销定位，不属于用户内容或原文比较。
  const comments = document.createTreeWalker(clone, NodeFilter.SHOW_COMMENT)
  const empty: Node[] = []
  while (comments.nextNode()) if (!comments.currentNode.textContent) empty.push(comments.currentNode)
  empty.forEach(node => node.parentNode!.removeChild(node))
  // Chromium 切换 inert 时可能给不可编辑的子节点留下空 style；它不代表文档发生修改。
  clone.querySelectorAll('[style=""]').forEach(node => node.removeAttribute('style'))
  clone.querySelectorAll('details').forEach(node => node.removeAttribute('open'))
  const originals = element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
  clone.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((input, index) => {
    input.checked = originals[index]!.checked
    input.toggleAttribute('checked', input.checked)
  })
  return clone
}

export function pastedHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['style', 'input', 'form', 'button', 'textarea', 'img'],
    FORBID_ATTR: ['style', 'class', 'id', 'contenteditable', 'tabindex'],
  })
}

