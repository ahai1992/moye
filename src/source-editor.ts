import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, drawSelection, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { defaultHighlightStyle, syntaxHighlighting, bracketMatching } from '@codemirror/language'
import { search, SearchQuery, setSearchQuery } from '@codemirror/search'
import { persistentSearchHighlights } from './search-highlights'

export type WrapMode = 'none' | 'window' | 'page'

function wrappingExtensions(mode: WrapMode) {
  return [
    mode === 'none' ? [] : EditorView.lineWrapping,
    mode === 'page' ? EditorView.theme({
      '.cm-content': { flex: '0 0 210mm', width: '210mm', borderRight: '1px solid #e2e5eb' },
    }) : [],
  ]
}

export class SourceEditor {
  readonly view: EditorView
  private replacing = false
  private wrapping = new Compartment()

  constructor(parent: HTMLElement, onChange: (value: string) => void, initialValue = '', wrapMode: WrapMode = 'window', onUpdate?: () => void) {
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc: initialValue,
        extensions: [
          lineNumbers(), history(), drawSelection(), highlightActiveLine(), bracketMatching(),
          markdown(), syntaxHighlighting(defaultHighlightStyle), persistentSearchHighlights,
          search({
            literal: true,
            scrollToMatch: range => EditorView.scrollIntoView(range, { y: 'center' }),
          }),
          this.wrapping.of(wrappingExtensions(wrapMode)),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.contentAttributes.of({ 'aria-label': 'Markdown 源码', spellcheck: 'false' }),
          EditorView.updateListener.of(update => {
            if (update.docChanged && !this.replacing) onChange(update.state.doc.toString())
            if (update.docChanged || update.selectionSet || update.geometryChanged) onUpdate?.()
          }),
          EditorView.theme({
            '&': { height: '100%', fontSize: 'calc(var(--editor-font-size, 15px) - 1px)' },
            '.cm-scroller': { fontFamily: 'var(--app-code-font, "Cascadia Code", Consolas, monospace)', lineHeight: '1.6', overflow: 'auto' },
            '.cm-content': { padding: '8px 0 48px', minHeight: '100%' },
            '.cm-gutters': { backgroundColor: '#fafbfc', color: '#969eac', borderRight: '1px solid #edf0f4', padding: '8px 4px 0 4px' },
            '.cm-line': { padding: '0 10px 0 8px' },
            '.cm-activeLine': { backgroundColor: '#7463de08' },
            '.cm-cursor': { borderLeftColor: '#6653cf' },
            '&.cm-focused': { outline: 'none' },
            '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: '#e7e1ff' },
          }),
        ],
      }),
    })
  }

  setWrapping(mode: WrapMode) {
    this.view.dispatch({ effects: [this.view.scrollSnapshot(), this.wrapping.reconfigure(wrappingExtensions(mode))] })
  }

  jumpTo(position: number) {
    const anchor = Math.max(0, Math.min(position, this.view.state.doc.length))
    this.view.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: 'start', yMargin: 8 }) })
    this.focus()
  }

  preserveViewport(change: () => void) {
    const snapshot = this.view.scrollSnapshot()
    change()
    this.view.dispatch({ effects: snapshot })
    this.view.requestMeasure()
  }

  setValue(value: string) {
    const previous = this.getValue()
    if (value === previous) return
    let from = 0
    let suffix = 0
    while (from < previous.length && from < value.length && previous[from] === value[from]) from++
    while (suffix < previous.length - from && suffix < value.length - from && previous[previous.length - suffix - 1] === value[value.length - suffix - 1]) suffix++
    this.replacing = true
    this.view.dispatch({ changes: { from, to: previous.length - suffix, insert: value.slice(from, value.length - suffix) } })
    this.replacing = false
  }

  getValue() { return this.view.state.doc.toString() }
  get scrollElement() { return this.view.scrollDOM }
  focus() { this.view.focus() }
  destroy() { this.view.destroy() }
  setSearch(query: SearchQuery) { this.view.dispatch({ effects: setSearchQuery.of(query) }) }
  undo() { undo(this.view) }
  redo() { redo(this.view) }

  replaceSelection(text: string) {
    const { from, to } = this.view.state.selection.main
    this.view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } })
    this.focus()
  }

  insert(before: string, after = '', fallback = '文字') {
    const { from, to } = this.view.state.selection.main
    const selected = this.view.state.sliceDoc(from, to) || fallback
    this.view.dispatch({
      changes: { from, to, insert: before + selected + after },
      selection: { anchor: from + before.length, head: from + before.length + selected.length },
    })
    this.focus()
  }
}
