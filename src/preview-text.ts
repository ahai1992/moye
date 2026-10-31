export class PreviewText {
  readonly text: string
  readonly chunks: { node: Text; start: number; end: number }[] = []
  constructor(readonly root: HTMLElement) {
    const parts: string[] = []
    let length = 0, newline = true
    const lineBreak = () => { if (!newline) { parts.push('\n'); length++; newline = true } }
    const visit = (node: Node) => {
      if (node instanceof Text) {
        if (!node.length) return
        this.chunks.push({ node, start: length, end: length + node.length })
        parts.push(node.data); length += node.length; newline = node.data.endsWith('\n')
      } else if (node instanceof HTMLElement) {
        if (node.hidden || node.getAttribute('aria-hidden') === 'true' || node.matches('script, style, .katex-mathml')) return
        if (node.tagName === 'BR') { parts.push('\n'); length++; newline = true; return }
        const block = node !== root && node.matches('section, p, div, h1, h2, h3, h4, h5, h6, li, tr, blockquote, pre')
        if (block) lineBreak()
        node.childNodes.forEach(visit)
        if (block) lineBreak()
      }
    }
    visit(root)
    this.text = parts.join('')
  }
  point(offset: number, end = false) {
    let low = 0, high = this.chunks.length
    while (low < high) {
      const mid = (low + high) >>> 1, chunk = this.chunks[mid]!
      if (end ? chunk.start < offset : chunk.end <= offset) low = mid + 1
      else high = mid
    }
    const chunk = this.chunks[end ? Math.max(0, low - 1) : Math.min(low, this.chunks.length - 1)]
    return chunk && { node: chunk.node, offset: Math.max(0, Math.min(chunk.node.length, offset - chunk.start)) }
  }
  range(from: number, to: number) {
    const start = this.point(from), end = this.point(to, to > from)
    if (!start || !end) return undefined
    const range = document.createRange()
    range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset)
    return range
  }
  selection() {
    const selection = window.getSelection()
    if (!selection?.rangeCount || !this.root.contains(selection.anchorNode) || !this.root.contains(selection.focusNode)) return undefined
    const range = selection.getRangeAt(0)
    const position = (node: Node, offset: number) => {
      const chunk = this.chunks.find(item => item.node === node)
      if (chunk) return chunk.start + offset
      const prefix = document.createRange(); prefix.selectNodeContents(this.root); prefix.setEnd(node, offset)
      const clone = document.createElement('div'); clone.append(prefix.cloneContents())
      return new PreviewText(clone).text.replace(/\n$/, '').length
    }
    return { from: position(range.startContainer, range.startOffset), to: position(range.endContainer, range.endOffset) }
  }
}
