import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { getSearchQuery, searchPanelOpen } from '@codemirror/search'

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
        if (match.value.from === match.value.to || match.value.from <= previous || match.value.to <= from || match.value.from >= to) continue
        previous = match.value.from
        const selected = state.selection.ranges.some(range => range.from === match.value.from && range.to === match.value.to)
        marks.push(Decoration.mark({ class: selected ? 'cm-searchMatch cm-searchMatch-selected' : 'cm-searchMatch' }).range(match.value.from, match.value.to))
      }
    }
    return Decoration.set(marks, true)
  }
}, { decorations: plugin => plugin.decorations })
