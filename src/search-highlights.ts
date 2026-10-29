import { EditorState } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { getSearchQuery, searchPanelOpen, SearchQuery } from '@codemirror/search'

// CodeMirror 自带高亮仅在搜索面板打开时绘制；关闭后使用同一查询继续绘制可见匹配。
export const persistentSearchHighlights = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(private view: EditorView) { this.decorations = this.build() }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.selectionSet
      || searchPanelOpen(update.startState) !== searchPanelOpen(update.state)
      || !getSearchQuery(update.startState).eq(getSearchQuery(update.state))) this.decorations = this.build()
  }
  private build() {
    const { state } = this.view
    const query = getSearchQuery(state)
    if (searchPanelOpen(state) || !query.valid) return Decoration.none
    const marks = []
    let previous = -1
    for (const { from, to } of this.view.visibleRanges) {
      const cursor = query.getCursor(state, Math.max(0, from - query.search.length), Math.min(state.doc.length, to + query.search.length))
      for (let match = cursor.next(); !match.done; match = cursor.next()) {
        if (match.value.from <= previous || match.value.to <= from || match.value.from >= to) continue
        previous = match.value.from
        const selected = state.selection.ranges.some(range => range.from === match.value.from && range.to === match.value.to)
        marks.push(Decoration.mark({ class: selected ? 'cm-searchMatch cm-searchMatch-selected' : 'cm-searchMatch' }).range(match.value.from, match.value.to))
      }
    }
    return Decoration.set(marks, true)
  }
}, { decorations: plugin => plugin.decorations })

export class PreviewSearchHighlights {
  private query = new SearchQuery({ search: '' })
  private active = false
  private frame = 0
  private composing = false
  private observer: MutationObserver

  constructor(private root: HTMLElement) {
    this.observer = new MutationObserver(() => this.schedule())
    this.observer.observe(root, { childList: true, characterData: true, subtree: true })
    root.addEventListener('compositionstart', () => { this.composing = true })
    root.addEventListener('compositionend', () => { this.composing = false; this.schedule() })
  }
  setQuery(query: SearchQuery) { this.query = query; this.schedule() }
  setActive(active: boolean) {
    this.active = active
    if (active) this.schedule()
    else if (typeof CSS !== 'undefined' && 'highlights' in CSS) CSS.highlights.delete('document-search')
  }
  private schedule() {
    if (!this.active || this.frame || this.composing) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      if (this.active && !this.composing) this.render()
    })
  }
  private render() {
    if (typeof Highlight === 'undefined' || !('highlights' in CSS)) return
    const highlight = new Highlight()
    if (!this.query.valid) { CSS.highlights.set('document-search', highlight); return }
    const chunks: { node: Text; start: number; end: number }[] = []
    const parts: string[] = []
    let length = 0, newline = true
    const lineBreak = () => { if (!newline) { parts.push('\n'); length++; newline = true } }
    const visit = (node: Node) => {
      if (node instanceof Text) {
        if (!node.length) return
        chunks.push({ node, start: length, end: length + node.length })
        parts.push(node.data)
        length += node.length
        newline = node.data.endsWith('\n')
      } else if (node instanceof HTMLElement) {
        if (node.hidden || node.getAttribute('aria-hidden') === 'true' || node.matches('script, style, .katex-mathml')) return
        if (node.tagName === 'BR') { parts.push('\n'); length++; newline = true; return }
        const block = node !== this.root && node.matches('section, p, div, h1, h2, h3, h4, h5, h6, li, tr, blockquote, pre')
        if (block) lineBreak()
        node.childNodes.forEach(visit)
        if (block) lineBreak()
      }
    }
    visit(this.root)
    const state = EditorState.create({ doc: parts.join('') })
    const endpoint = (offset: number, end: boolean) => {
      let low = 0, high = chunks.length
      while (low < high) {
        const middle = (low + high) >>> 1, chunk = chunks[middle]!
        if (end ? chunk.start < offset : chunk.end <= offset) low = middle + 1
        else high = middle
      }
      const chunk = chunks[end ? low - 1 : low]
      return chunk && { node: chunk.node, offset: Math.max(0, Math.min(chunk.node.length, offset - chunk.start)) }
    }
    const cursor = this.query.getCursor(state)
    for (let match = cursor.next(); !match.done; match = cursor.next()) {
      const first = endpoint(match.value.from, false), last = endpoint(match.value.to, true)
      if (!first || !last) continue
      const range = document.createRange()
      range.setStart(first.node, first.offset)
      range.setEnd(last.node, last.offset)
      highlight.add(range)
    }
    CSS.highlights.set('document-search', highlight)
  }
  destroy() {
    if (this.active) this.setActive(false)
    cancelAnimationFrame(this.frame)
    this.observer.disconnect()
  }
}
