import type { PreviewEditor } from './preview-editor'
import type { SourceEditor } from './source-editor'
import { EditorView } from '@codemirror/view'

interface Segment { node: Text; offset: number; from: number; length: number }
export interface ReadingAnchor { position: number; text: string; offset: number }

export class PreviewPosition {
  private segments: Segment[] = []
  private blocks: ReturnType<PreviewEditor['sourceBlocks']> = []
  private content = ''
  private dirty = true
  private observer: MutationObserver
  private resize: ResizeObserver
  private gutter = document.createElement('canvas')
  private frame = 0
  private active = false
  private scroll = () => { if (!this.frame && this.active) this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw() }) }
  constructor(private editor: PreviewEditor, private scroller: HTMLElement, parent: HTMLElement) {
    this.gutter.className = 'preview-line-numbers'
    this.gutter.setAttribute('aria-label', '预览源码行号')
    parent.append(this.gutter)
    this.observer = new MutationObserver(() => { this.dirty = true; this.scroll() })
    this.observer.observe(editor.element, { childList: true, characterData: true, subtree: true })
    this.resize = new ResizeObserver(this.scroll)
    this.resize.observe(editor.element); this.resize.observe(scroller)
    scroller.addEventListener('scroll', this.scroll, { passive: true })
  }
  setActive(active: boolean) { this.active = active; this.gutter.hidden = !active; this.scroll() }
  invalidate() { this.dirty = true; this.scroll() }
  private build() {
    if (!this.dirty) return
    this.dirty = false
    this.content = this.editor.getValue()
    this.blocks = this.editor.sourceBlocks()
    this.segments = []
    for (const block of this.blocks) {
      if (block.element.hidden) continue
      const walker = document.createTreeWalker(block.element, NodeFilter.SHOW_TEXT)
      let cursor = 0
      while (walker.nextNode()) {
        const node = walker.currentNode as Text
        if (node.parentElement?.closest('[data-md-source], [hidden], [aria-hidden="true"]')) continue
        let offset = 0
        while (offset < node.length) {
          const length = Math.min(64, node.length - offset)
          let found = block.raw.indexOf(node.data.slice(offset, offset + length), cursor), size = length
          if (found < 0) { size = Math.min(8, node.length - offset); found = block.raw.indexOf(node.data.slice(offset, offset + size), cursor) }
          if (found < 0) { size = 1; found = block.raw.indexOf(node.data[offset]!, cursor) }
          if (found < 0) { offset++; continue }
          // 长文本锚点先定位，再延伸匹配，避免重复段落跳到文档开头。
          while (offset + size < node.length && block.raw[found + size] === node.data[offset + size]) size++
          this.segments.push({ node, offset, from: block.from + found, length: size })
          cursor = found + size; offset += size
        }
      }
    }
  }
  private range(segment: Segment, offset = 0) {
    const range = document.createRange()
    const start = Math.min(segment.node.length, segment.offset + offset)
    range.setStart(segment.node, start); range.setEnd(segment.node, Math.min(segment.node.length, start + 1))
    return range
  }
  capture(preferred?: ReadingAnchor): ReadingAnchor {
    this.build()
    const viewport = this.scroller.getBoundingClientRect()
    if (preferred && this.content.slice(preferred.position, preferred.position + preferred.text.length) === preferred.text) {
      const segment = this.segments.find(item => item.from <= preferred.position && item.from + item.length > preferred.position)
      const rect = segment && this.range(segment, preferred.position - segment.from).getBoundingClientRect()
      if (rect?.height && Math.abs(rect.top - viewport.top - preferred.offset) < 2) return preferred
    }
    let position = 0, offset = 0
    for (const segment of this.segments) {
      const whole = document.createRange(); whole.setStart(segment.node, segment.offset); whole.setEnd(segment.node, segment.offset + segment.length)
      if (whole.getBoundingClientRect().bottom <= viewport.top + 1) continue
      let low = 0, high = segment.length - 1
      while (low < high) {
        const mid = (low + high) >>> 1
        if (this.range(segment, mid).getBoundingClientRect().bottom <= viewport.top + 1) low = mid + 1
        else high = mid
      }
      const rect = this.range(segment, low).getBoundingClientRect()
      if (!rect.height) continue
      position = segment.from + low; offset = rect.top - viewport.top; break
    }
    return { position, text: this.content.slice(position, position + 100), offset }
  }
  restore(anchor: ReadingAnchor) {
    this.build()
    let position = anchor.position
    if (anchor.text && this.content.slice(position, position + anchor.text.length) !== anchor.text) {
      const found = this.content.indexOf(anchor.text, Math.max(0, position - 2000))
      if (found >= 0) position = found
    }
    let segment = this.segments.find(item => item.from <= position && item.from + item.length > position)
    const block = this.blocks.find(item => item.from <= position && item.to > position)
    segment ??= this.segments.find(item => item.from >= position && (!block || item.from < block.to))
    let rect: DOMRect | undefined
    if (segment) {
      for (let parent = segment.node.parentElement; parent && parent !== this.editor.element; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true
      rect = this.range(segment, Math.max(0, position - segment.from)).getBoundingClientRect()
    } else rect = block?.element.getBoundingClientRect()
    if (rect) this.scroller.scrollTop += rect.top - this.scroller.getBoundingClientRect().top - anchor.offset
    this.scroll()
  }
  private draw() {
    if (!this.active) return
    this.build()
    const height = this.scroller.clientHeight, ratio = devicePixelRatio || 1
    this.gutter.width = Math.round(44 * ratio); this.gutter.height = Math.round(height * ratio)
    const ctx = this.gutter.getContext('2d')!
    ctx.scale(ratio, ratio); ctx.font = '11px Consolas, monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'top'
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--window-ink').trim() || '#89909b'
    const top = this.scroller.getBoundingClientRect().top
    const lines = [0]
    for (let i = this.content.indexOf('\n'); i >= 0; i = this.content.indexOf('\n', i + 1)) lines.push(i + 1)
    let lastY = -30, lastLine = 0
    for (const segment of this.segments) {
      const range = document.createRange(); range.setStart(segment.node, segment.offset); range.setEnd(segment.node, segment.offset + segment.length)
      const bounds = range.getBoundingClientRect()
      if (bounds.bottom < top || bounds.top > top + height) continue
      let low = 0, high = lines.length
      while (low < high) { const mid = (low + high) >>> 1; if (lines[mid]! <= segment.from) low = mid + 1; else high = mid }
      let index = Math.max(0, low - 1)
      while (index < lines.length && lines[index]! < segment.from + segment.length) {
        const position = Math.max(lines[index]!, segment.from)
        const rect = this.range(segment, position - segment.from).getBoundingClientRect(), y = rect.top - top + 2
        if (index + 1 !== lastLine && y >= -10 && y < height && y - lastY >= 11) { ctx.fillText(String(index + 1), 36, y); lastY = y; lastLine = index + 1 }
        index++
      }
    }
  }
  destroy() { this.observer.disconnect(); this.resize.disconnect(); this.scroller.removeEventListener('scroll', this.scroll); cancelAnimationFrame(this.frame); this.gutter.remove() }
}

export function sourceAnchor(source: SourceEditor, preferred?: ReadingAnchor): ReadingAnchor {
  const top = source.scrollElement.getBoundingClientRect().top
  if (preferred && source.getValue().slice(preferred.position, preferred.position + preferred.text.length) === preferred.text) {
    const rect = source.view.coordsAtPos(preferred.position)
    if (rect && Math.abs(rect.top - top - preferred.offset) < 2) return preferred
  }
  const block = source.view.lineBlockAtHeight(source.scrollElement.scrollTop)
  const position = source.view.posAtCoords({ x: source.view.contentDOM.getBoundingClientRect().left + 8, y: top + 8 }, false) ?? block.from
  const rect = source.view.coordsAtPos(position)
  return { position, text: source.getValue().slice(position, position + 100), offset: rect ? rect.top - top : block.top - source.scrollElement.scrollTop }
}

export function restoreSource(source: SourceEditor, anchor: ReadingAnchor) {
  const position = Math.min(anchor.position, source.view.state.doc.length)
  source.view.dispatch({ effects: EditorView.scrollIntoView(position, { y: 'start', yMargin: anchor.offset, x: 'nearest' }) })
}
