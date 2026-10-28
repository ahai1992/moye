import { widgetSource } from './markdown'
import { actionBlock, headingSelector, listItemContainer } from './block-range'

export function blockText(element: HTMLElement): string {
  if (element.dataset.kind === 'mermaid') {
    return widgetSource(element).replace(/^\s*(`{3,}|~{3,})mermaid[^\n]*\n/, '').replace(/\n\s*(`{3,}|~{3,})\s*$/, '')
  }
  if (element.tagName === 'PRE') return element.innerText ?? element.textContent ?? ''
  const read = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    if (!(node instanceof HTMLElement)) return ''
    if (node.dataset.mdSource) return widgetSource(node)
    if (node instanceof HTMLImageElement) return node.alt
    if (node instanceof HTMLInputElement) return node.type === 'checkbox' ? (node.checked ? '[x]' : '[ ]') : ''
    if (node.tagName === 'BR') return '\n'
    if (node.tagName === 'TABLE') {
      return Array.from(node.querySelectorAll('tr'), row => Array.from(row.cells, cell => read(cell).trim()).join('\t')).join('\n') + '\n'
    }
    if (node.tagName === 'UL' || node.tagName === 'OL') {
      const start = node instanceof HTMLOListElement ? node.start : 1
      return '\n' + Array.from(node.children).map((child, index) => {
        const marker = node.tagName === 'OL' ? `${start + index}. ` : '- '
        return marker + read(child).trim()
      }).join('\n') + '\n'
    }
    const text = Array.from(node.childNodes, read).join('')
    return /^(P|DIV|BLOCKQUOTE|H[1-6])$/.test(node.tagName) ? text + '\n' : text
  }
  return read(element.tagName === 'LI' ? listItemContainer(element) : element).replace(/\n{3,}/g, '\n\n').trim()
}

async function writeClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return }
    catch (error) { console.error('Clipboard write failed, trying selected text copy:', error) }
  }
  const active = document.activeElement as HTMLElement | null
  const selection = window.getSelection()
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : []
  const input = document.createElement('textarea')
  input.value = text
  input.readOnly = true
  input.className = 'clipboard-transfer'
  document.body.append(input)
  try {
    input.select()
    if (!document.execCommand('copy')) throw new Error('复制未完成，请选中内容后按 Ctrl+C 重试。')
  } finally {
    input.remove()
    active?.focus({ preventScroll: true })
    selection?.removeAllRanges()
    for (const range of ranges) selection?.addRange(range)
  }
}

export class BlockCopy {
  private actions = document.createElement('div')
  private button = document.createElement('button')
  private replaceButton = document.createElement('button')
  private target?: HTMLElement
  private pending = false
  private disposed = false
  private visible = false
  private frame = 0
  private timer?: ReturnType<typeof setTimeout>
  private observer: ResizeObserver
  private scroller: HTMLElement
  private selectionChanged = () => {
    const node = window.getSelection()?.anchorNode
    if (node && this.host.contains(node)) this.show(node instanceof HTMLElement ? node : node.parentElement)
  }
  private scroll = () => {
    if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.position() })
  }

  constructor(private host: HTMLElement, private onError: (error: unknown) => void,
    private onReplace: (target: HTMLElement) => Promise<void>, private copyText: (target: HTMLElement) => string) {
    this.scroller = host.parentElement!
    this.button.type = 'button'
    this.button.className = 'block-copy'
    this.button.textContent = '复制'
    this.button.setAttribute('aria-live', 'polite')
    this.replaceButton.type = 'button'
    this.replaceButton.className = 'block-replace'
    this.replaceButton.textContent = '替换'
    this.replaceButton.title = '编辑或替换当前块的内容'
    this.replaceButton.setAttribute('aria-label', '替换当前块')
    this.actions.className = 'block-actions'
    this.actions.hidden = true
    this.actions.append(this.replaceButton, this.button)
    // 控件放在编辑器外，不参与 Markdown 序列化、选区或撤销历史。
    this.scroller.append(this.actions)
    this.scroller.addEventListener('pointermove', event => {
      if (!this.actions.contains(event.target as Node)) this.show(event.target as HTMLElement)
    })
    this.scroller.addEventListener('pointerleave', () => { this.visible = false; this.actions.hidden = true })
    this.host.addEventListener('input', () => { this.visible = false; this.actions.hidden = true })
    this.actions.addEventListener('mousedown', event => event.preventDefault())
    this.button.addEventListener('click', () => { void this.copy() })
    this.replaceButton.addEventListener('click', () => { void this.replace() })
    this.scroller.addEventListener('scroll', this.scroll, { passive: true })
    document.addEventListener('selectionchange', this.selectionChanged)
    this.observer = new ResizeObserver(this.scroll)
    this.observer.observe(this.host)
    this.observer.observe(this.scroller)
  }

  private show(element: HTMLElement | null) {
    if (this.pending || this.disposed) return
    const block = actionBlock(element)
    if (!block || !this.host.contains(block)) { this.visible = false; this.actions.hidden = true; return }
    if (this.target !== block) {
      clearTimeout(this.timer)
      this.button.textContent = '复制'
    }
    this.target = block
    this.visible = true
    const chapter = block.matches(headingSelector)
    const label = chapter ? '复制本节（包含下级内容）'
      : block.tagName === 'PRE' || block.dataset.kind === 'mermaid' ? '复制代码' : '复制此文本块'
    this.button.title = label
    this.button.setAttribute('aria-label', label)
    this.replaceButton.title = chapter ? '替换本节（包含下级内容）' : '编辑或替换当前块的内容'
    this.replaceButton.setAttribute('aria-label', chapter ? '替换本节（包含下级内容）' : '替换当前块')
    this.position()
  }

  private position() {
    if (this.disposed || !this.visible || !this.target?.isConnected) { this.actions.hidden = true; return }
    const block = this.target.getBoundingClientRect()
    const viewport = this.scroller.getBoundingClientRect()
    if (!viewport.height || block.bottom <= viewport.top || block.top >= viewport.bottom) { this.actions.hidden = true; return }
    this.actions.hidden = false
    const right = Math.min(block.right, viewport.left + this.scroller.clientWidth) - 5
    this.actions.style.left = `${Math.max(viewport.left + 4, right - this.actions.offsetWidth)}px`
    this.actions.style.top = `${Math.min(viewport.bottom - 28, Math.max(viewport.top + 4, block.top + 3))}px`
  }

  private async replace() {
    if (this.pending || !this.target?.isConnected) return
    this.pending = true
    this.button.disabled = this.replaceButton.disabled = true
    clearTimeout(this.timer)
    try { await this.onReplace(this.target) }
    catch (error) { this.onError(error) }
    finally {
      this.pending = false
      this.button.disabled = this.replaceButton.disabled = false
      this.visible = false
      this.actions.hidden = true
    }
  }

  private async copy() {
    if (this.pending || !this.target?.isConnected) return
    this.pending = true
    this.button.disabled = this.replaceButton.disabled = true
    clearTimeout(this.timer)
    this.button.textContent = '复制中…'
    this.position()
    try {
      await writeClipboard(this.copyText(this.target))
      if (this.disposed) return
      this.button.textContent = '已复制'
      this.position()
      clearTimeout(this.timer)
      this.timer = setTimeout(() => { this.button.textContent = '复制'; this.position() }, 1400)
    } catch (error) {
      console.error('Block copy failed:', error)
      this.button.textContent = '未复制'
      this.onError(new Error('复制未完成，请选中内容后按 Ctrl+C 重试。'))
    } finally {
      this.pending = false
      this.button.disabled = this.replaceButton.disabled = false
    }
  }

  destroy() {
    this.disposed = true
    clearTimeout(this.timer)
    cancelAnimationFrame(this.frame)
    this.observer.disconnect()
    this.scroller.removeEventListener('scroll', this.scroll)
    document.removeEventListener('selectionchange', this.selectionChanged)
    this.actions.remove()
  }
}
