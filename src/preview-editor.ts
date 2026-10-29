import DOMPurify from 'dompurify'
import { comparableHtml, escapeHtml, htmlToMarkdown, markdownBlocks, pastedHtml, widgetSource } from './markdown'
import { invoke, isDesktop } from './desktop'
import { blockText } from './block-copy'
import { blockRange, headingSelector, listItemContainer } from './block-range'
import type { MarkdownBlock } from './markdown'
import { BlockHistory } from './block-history'
import { plainTextClipboard } from './plain-clipboard'

interface OriginalBlock { raw: string; html: string; hidden: boolean }
type EditFragment = (source: string, kind: string) => Promise<string | null>

export class PreviewEditor {
  private originals = new Map<string, OriginalBlock>()
  private revision = 0
  private sequence = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private composing = false
  private selection: Range | null = null
  private imageCache = new Map<string, Promise<string>>()
  private lastValue = ''
  private editPending = false
  private blockHistory = new BlockHistory()
  private selectionChanged = () => {
    const selection = window.getSelection()
    if (selection?.rangeCount && this.element.contains(selection.anchorNode) && this.element.contains(selection.focusNode)) {
      this.selection = selection.getRangeAt(0).cloneRange()
    }
  }

  constructor(
    readonly element: HTMLElement,
    private onChange: (value: string) => void,
    private editFragment: EditFragment,
    private onError: (error: unknown) => void,
    private documentId = '',
  ) {
    element.contentEditable = 'true'
    element.spellcheck = false
    element.setAttribute('role', 'textbox')
    element.setAttribute('aria-label', '可编辑预览')
    element.setAttribute('aria-multiline', 'true')
    plainTextClipboard(element)
    element.addEventListener('compositionstart', () => { this.composing = true })
    element.addEventListener('compositionend', () => { this.composing = false; this.changed() })
    element.addEventListener('input', () => { if (!this.composing) this.changed() })
    element.addEventListener('paste', event => this.paste(event))
    element.addEventListener('drop', event => event.preventDefault())
    element.addEventListener('click', event => {
      const target = event.target as HTMLElement
      if (target.closest('a')) event.preventDefault()
      if (target instanceof HTMLInputElement && target.type === 'checkbox') {
        target.toggleAttribute('checked', target.checked)
        this.changed()
      }
    })
    element.addEventListener('dblclick', event => {
      const widget = (event.target as HTMLElement).closest<HTMLElement>('[data-md-source]')
      if (widget) { event.preventDefault(); void this.editWidget(widget) }
    })
    element.addEventListener('keydown', event => {
      const target = event.target as HTMLElement
      if (event.key === 'Enter' && target.matches('[data-md-source]')) {
        event.preventDefault()
        void this.editWidget(target)
      }
    })
    document.addEventListener('selectionchange', this.selectionChanged)
  }

  destroy() {
    clearTimeout(this.timer)
    this.blockHistory.clear()
    this.revision++
    document.removeEventListener('selectionchange', this.selectionChanged)
  }

  setValue(markdown: string, newFile = false) {
    clearTimeout(this.timer)
    if (newFile) this.imageCache.clear()
    if (!newFile && markdown === this.lastValue) return
    const blocks = markdownBlocks(markdown)
    this.revision++
    this.blockHistory.clear()
    this.originals.clear()
    this.selection = null
    this.element.replaceChildren()
    for (const block of blocks) this.element.append(this.createBlock(block))
    if (!blocks.length) this.element.innerHTML = '<p><br></p>'
    this.lastValue = markdown
    this.element.classList.toggle('is-empty', !markdown.trim())
    void this.hydrate(this.revision)
  }

  getValue(): string {
    return this.serialize(this.element.childNodes)
  }

  private createBlock(block: MarkdownBlock): HTMLElement {
    const section = document.createElement('section')
    const id = String(++this.sequence)
    section.dataset.blockId = id
    section.innerHTML = block.html
    if (block.hidden || !block.html) { section.hidden = true; section.contentEditable = 'false' }
    this.prepare(section)
    this.originals.set(id, { raw: block.raw, html: comparableHtml(section), hidden: section.hidden })
    return section
  }

  private serialize(nodes: Iterable<Node>): string {
    const parts: string[] = []
    const seen = new Set<string>()
    for (const node of nodes) {
      if (node.nodeType === Node.COMMENT_NODE || (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim())) continue
      const element = node instanceof HTMLElement ? node : document.createElement('span')
      if (!(node instanceof HTMLElement)) element.textContent = node.textContent
      const id = element.dataset.blockId ?? ''
      const original = seen.has(id) ? undefined : this.originals.get(id)
      seen.add(id)
      if (original && (original.hidden || comparableHtml(element) === original.html)) {
        parts.push(original.raw)
        continue
      }
      let container = element
      if (!original) {
        container = document.createElement('div')
        container.append(element.cloneNode(true))
      }
      const markdown = htmlToMarkdown(container)
      if (!markdown) continue
      if (!original && parts.length && !parts[parts.length - 1]!.endsWith('\n\n')) parts.push('\n\n')
      const prefix = original?.raw.match(/^\n*/)?.[0] ?? ''
      const suffix = original?.raw.match(/\n*$/)?.[0] ?? '\n\n'
      parts.push(prefix + markdown + suffix)
    }
    return parts.join('')
  }

  flush(): string {
    clearTimeout(this.timer)
    const value = this.getValue()
    if (value !== this.lastValue) {
      this.lastValue = value
      this.onChange(value)
    }
    this.element.classList.toggle('is-empty', !value.trim())
    return value
  }

  private changed() {
    // 输入期间只序列化，不用 innerHTML 回写；光标、IME、撤销栈和滚动位置均留在原 DOM。
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 100)
  }

  focus() {
    this.element.focus({ preventScroll: true })
    if (this.selection && this.element.contains(this.selection.commonAncestorContainer)) {
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(this.selection)
    }
  }

  refreshImages() {
    this.imageCache.clear()
    this.element.querySelectorAll<HTMLImageElement>('img[data-original-src]').forEach(img => {
      delete img.dataset.imageLoaded
    })
    void this.hydrate(this.revision)
  }

  command(command: string, value?: string) {
    this.focus()
    document.execCommand(command, false, value)
    this.flush()
  }

  insertMarkdown(markdown: string) {
    const html = markdownBlocks(markdown).map(block => block.html).join('')
    this.insertHtml(html)
  }

  private insertHtml(html: string) {
    this.focus()
    const inserted = document.execCommand('insertHTML', false, html)
    this.prepare(this.element)
    this.flush()
    void this.hydrate(this.revision)
    return inserted
  }

  copyBlock(target: HTMLElement): string {
    if (!this.element.contains(target)) return ''
    return target.matches(headingSelector) ? this.rangeSource(blockRange(this.element, target)) : blockText(target)
  }

  private rangeSource(range: Range): string {
    return this.serialize(range.cloneContents().childNodes).replace(/^\n+|\n+$/g, '')
  }

  async replaceBlock(target: HTMLElement) {
    if (this.editPending || !this.element.contains(target)) return
    this.editPending = true
    const revision = this.revision
    const scroller = this.element.parentElement!
    const position = { top: scroller.scrollTop, left: scroller.scrollLeft }
    const restore = () => {
      if (this.revision !== revision || !this.element.isConnected) return
      scroller.scrollTop = position.top
      scroller.scrollLeft = position.left
    }
    try {
      const context = this.flush()
      const code = target.tagName === 'PRE' || target.dataset.kind === 'mermaid'
      const chapter = target.matches(headingSelector)
      const range = blockRange(this.element, target)
      const source = chapter ? this.rangeSource(range) : code ? blockText(target) : this.blockSource(target)
      const value = await this.editFragment(source, chapter ? 'chapter' : code ? 'code-block' : 'block')
      if (value === null || value === source || revision !== this.revision || !this.element.contains(target)) return
      let markdown = value
      if (code) {
        const language = target.dataset.kind === 'mermaid' ? 'mermaid' : /language-([^\s]*)/.exec(target.querySelector('code')?.className ?? '')?.[1] ?? ''
        let fence = '```'
        for (const match of value.matchAll(/`+/g)) if (match[0].length >= fence.length) fence = '`'.repeat(match[0].length + 1)
        markdown = `${fence}${language}\n${value}\n${fence}`
      }
      const blocks = markdownBlocks(markdown, context)
      let html = blocks.map(block => block.html).join('')
      if (chapter && range.startContainer === this.element && range.endContainer === this.element) {
        // 为新块保留原文；旧记录留给原生撤销/重做使用。
        if (blocks.length && !blocks[blocks.length - 1]!.raw.endsWith('\n\n')) blocks[blocks.length - 1]!.raw += '\n\n'
        html = blocks.map(block => this.createBlock(block).outerHTML).join('')
      } else if (target.tagName === 'LI' && html) {
        const holder = document.createElement('div')
        holder.innerHTML = html
        const list = holder.firstElementChild
        html = holder.children.length === 1 && list?.matches('ul, ol') ? list.innerHTML : `<li>${html}</li>`
      }
      const fragment = document.createElement('template')
      fragment.innerHTML = html
      this.blockHistory.replace(range, fragment.content, selection => {
        const top = scroller.scrollTop
        const left = scroller.scrollLeft
        this.selection = selection
        this.selection.collapse(true)
        this.focus()
        this.prepare(this.element)
        this.flush()
        void this.hydrate(this.revision)
        scroller.scrollTop = top
        scroller.scrollLeft = left
      })
    } finally {
      restore()
      requestAnimationFrame(restore)
      this.editPending = false
    }
  }

  private blockSource(target: HTMLElement): string {
    if (target.tagName === 'LI') return htmlToMarkdown(listItemContainer(target))
    const section = target.parentElement!
    const original = this.originals.get(section.dataset.blockId ?? '')
    if (original && section.children.length === 1 && comparableHtml(section) === original.html) {
      return original.raw.replace(/^\n+|\n+$/g, '')
    }
    const container = document.createElement('div')
    container.append(target.cloneNode(true))
    return htmlToMarkdown(container)
  }

  private prepare(root: HTMLElement) {
    root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(input => {
      input.disabled = false
      input.contentEditable = 'false'
      input.setAttribute('aria-label', '完成任务')
    })
    root.querySelectorAll<HTMLImageElement>('img:not([data-original-src])').forEach(img => {
      const src = img.getAttribute('src') ?? ''
      img.dataset.originalSrc = src
      img.dataset.originalTitle = img.getAttribute('title') ?? ''
      img.removeAttribute('srcset')
      if (!/^data:image\/(?:png|jpeg|gif|webp|avif|bmp|svg\+xml);base64,/i.test(src)) img.removeAttribute('src')
      img.title = '本地图片'
    })
  }

  private keepViewport(change: () => void) {
    const scroller = this.element.parentElement!
    const top = scroller.getBoundingClientRect().top
    const anchor = Array.from(this.element.children).find(child => child.getBoundingClientRect().bottom > top)
    const oldTop = anchor?.getBoundingClientRect().top ?? 0
    change()
    if (anchor?.isConnected) scroller.scrollTop += anchor.getBoundingClientRect().top - oldTop
  }

  private async hydrate(revision: number) {
    const images = Array.from(this.element.querySelectorAll<HTMLImageElement>('img[data-original-src]:not([data-image-loaded])'))
    // 顺序载入，避免图片很多时同时占满本地文件读取。
    for (const img of images) {
      if (revision !== this.revision || !img.isConnected) return
      img.dataset.imageLoaded = 'true'
      const src = img.dataset.originalSrc!
      if (src.startsWith('data:')) continue
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(src)) {
        img.title = '外部图片未载入；本地工具不会自动联网'
        continue
      }
      if (!isDesktop) { img.title = '在桌面程序中显示本地图片'; continue }
      try {
        let request = this.imageCache.get(src)
        if (!request) {
          request = invoke<string>('read_image', { documentId: this.documentId, relativePath: src })
          this.imageCache.set(src, request)
        }
        const data = await request
        if (revision !== this.revision || !img.isConnected) return
        const probe = new Image()
        probe.src = data
        await probe.decode()
        this.keepViewport(() => { img.src = data; img.title = img.alt || '本地图片' })
      } catch (error) {
        console.error('Local image could not be loaded:', error)
        img.title = '图片未找到或无法读取，请检查相对路径'
      }
    }
    const widgets = Array.from(this.element.querySelectorAll<HTMLElement>('[data-kind="mermaid"]:not([data-rendered])'))
    if (!widgets.length) return
    try {
      const { default: mermaid } = await import('mermaid')
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', htmlLabels: false, suppressErrorRendering: true })
      for (const widget of widgets) {
        if (revision !== this.revision || !widget.isConnected) return
        widget.dataset.rendered = 'true'
        const raw = widgetSource(widget)
        const code = raw.replace(/^\s*(`{3,}|~{3,})mermaid[^\n]*\n/, '').replace(/\n\s*(`{3,}|~{3,})\s*$/, '')
        try {
          const { svg } = await mermaid.render(`diagram-${++this.sequence}`, code)
          if (revision !== this.revision || !widget.isConnected) return
          this.keepViewport(() => { widget.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } }) })
        } catch (error) {
          console.error('Diagram could not be rendered:', error instanceof Error ? error.name : 'render error')
          this.keepViewport(() => { widget.innerHTML = `<div class="diagram-error">图表暂时无法显示，双击检查内容</div><pre>${escapeHtml(code)}</pre>` })
        }
      }
    } catch (error) { this.onError(error) }
  }

  private async editWidget(widget: HTMLElement) {
    if (this.editPending) return
    this.editPending = true
    const scrollTop = this.element.parentElement!.scrollTop
    try {
      const value = await this.editFragment(widgetSource(widget), widget.dataset.kind ?? 'source')
      if (value === null || !widget.isConnected) return
      const range = document.createRange()
      range.selectNode(widget)
      this.selection = range
      const holder = document.createElement('div')
      holder.innerHTML = markdownBlocks(value).map(block => block.html).join('')
      if (widget.tagName === 'SPAN' && holder.firstElementChild?.tagName === 'P') {
        this.insertHtml(holder.firstElementChild.innerHTML)
      } else this.insertHtml(holder.innerHTML)
      this.element.parentElement!.scrollTop = scrollTop
    } catch (error) { this.onError(error) }
    finally { this.editPending = false }
  }

  private paste(event: ClipboardEvent) {
    event.preventDefault()
    const html = event.clipboardData?.getData('text/html')
    if (html) this.insertHtml(pastedHtml(html))
    else {
      const text = event.clipboardData?.getData('text/plain') ?? ''
      this.command('insertText', text)
    }
  }
}
