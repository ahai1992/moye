import { SearchQuery } from '@codemirror/search'
import { EditorView } from '@codemirror/view'
import { isolateHistory } from '@codemirror/commands'
import { FindDialog, type SearchHost } from './find-dialog'
import { PreviewText } from './preview-text'
import { SearchOverview } from './search-overview'
import type { DocumentTab } from './document-tab'

interface Match { from: number; to: number; captures: RegExpExecArray }

function replacement(value: string, match: Match, source: string) {
  return value.replace(/\\([nrt\\])/g, (_, key: string) => ({ n: '\n', r: '\r', t: '\t', '\\': '\\' })[key]!)
    .replace(/\$(\$|&|`|'|\d{1,2}|<[^>]+>)/g, (token, key: string) => {
      if (key === '$') return '$'
      if (key === '&') return match.captures[0]
      if (key === '`') return source.slice(0, match.from)
      if (key === "'") return source.slice(match.to)
      if (key.startsWith('<')) return match.captures.groups ? match.captures.groups[key.slice(1, -1)] ?? '' : token
      const index = Number(key)
      if (index > 0 && index < match.captures.length) return match.captures[index] ?? ''
      const first = Number(key[0])
      return key.length === 2 && first > 0 && first < match.captures.length ? (match.captures[first] ?? '') + key[1] : token
    })
}

export class DocumentSearch implements SearchHost {
  query = new SearchQuery({ search: '' })
  private dialog?: FindDialog
  private matches: Match[] = []
  private map?: PreviewText
  private text = ''
  private selected = -1
  private active = false
  private timer?: ReturnType<typeof setTimeout>
  private observer: MutationObserver
  private resize: ResizeObserver
  private overview: SearchOverview
  private composing = false
  private selectionChanged = () => {
    if (!this.active || this.tab.view.mode !== 'preview' || !this.map) return
    const range = this.map.selection()
    if (range) { this.selected = this.matches.findIndex(match => match.from === range.from && match.to === range.to); this.dialog?.update() }
  }
  constructor(private tab: DocumentTab, private onError: (error: unknown) => void) {
    this.overview = new SearchOverview(tab.root, index => this.go(index))
    this.observer = new MutationObserver(() => this.schedule())
    this.observer.observe(tab.previewHost, { childList: true, characterData: true, subtree: true })
    this.resize = new ResizeObserver(() => this.schedule())
    this.resize.observe(tab.root); this.resize.observe(tab.previewHost)
    document.addEventListener('selectionchange', this.selectionChanged)
    tab.previewHost.addEventListener('compositionstart', () => { this.composing = true })
    tab.previewHost.addEventListener('compositionend', () => { this.composing = false; this.schedule() })
  }
  scope() { return this.tab.view.mode === 'preview' ? '在当前预览的可见文字中查找（F3 下一处，Shift+F3 上一处）' : '在 Markdown 源码中查找（F3 下一处，Shift+F3 上一处）' }
  open(replace: boolean, selectedText = '') {
    this.refresh()
    if (!this.dialog) {
      this.dialog = new FindDialog(this, replace, () => { this.dialog = undefined }, this.onError)
      this.dialog.mount()
    } else this.dialog.setMode(replace)
    if (selectedText) this.dialog.setSearchText(this.query.regexp ? selectedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : selectedText)
  }
  close() { this.dialog?.close() }
  clear() { this.close(); this.setQuery(new SearchQuery({ search: '' }), false) }
  setActive(active: boolean) {
    this.active = active
    if (!active) { this.close(); this.clearPaint(); this.overview.render([]) }
    else this.schedule()
  }
  setQuery(query: SearchQuery, navigate: boolean) {
    this.query = query; this.selected = -1
    this.tab.source.setSearch(query)
    this.refresh()
    if (navigate && this.matches.length) this.next()
  }
  schedule() {
    if (!this.active || this.composing) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.refresh(), 100)
  }
  private selection() {
    return this.tab.view.mode === 'source' ? this.tab.source.view.state.selection.main : this.map?.selection()
  }
  private refresh() {
    clearTimeout(this.timer)
    if (!this.active || this.composing) return
    const previous = this.matches[this.selected]
    this.map = this.tab.view.mode === 'preview' ? new PreviewText(this.tab.previewHost) : undefined
    this.text = this.map?.text ?? this.tab.source.getValue()
    this.matches = []
    if (this.query.valid) {
      const expression = this.query.regexp ? this.query.search : this.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      try {
        const regex = new RegExp(expression, `gmu${this.query.caseSensitive ? '' : 'i'}`)
        const word = (value: string) => /[\p{L}\p{N}_]/u.test(value)
        let result: RegExpExecArray | null
        while ((result = regex.exec(this.text))) {
          const from = result.index, to = from + result[0].length
          const before = Array.from(this.text.slice(Math.max(0, from - 2), from)).pop() ?? ''
          const after = String.fromCodePoint(this.text.codePointAt(to) ?? 32)
          if (!this.query.wholeWord || !(word(before) && word(Array.from(result[0])[0] ?? '') || word(after) && word(Array.from(result[0]).pop() ?? ''))) {
            this.matches.push({ from, to, captures: result })
          }
          if (!result[0].length) regex.lastIndex += (this.text.codePointAt(regex.lastIndex) ?? 0) > 0xffff ? 2 : 1
        }
      } catch (error) { console.error('Search expression failed:', error) }
    }
    const selection = this.selection() ?? previous
    this.selected = selection ? this.matches.findIndex(match => match.from === selection.from && match.to === selection.to) : -1
    this.paint(); this.dialog?.update()
  }
  status() { return { total: this.matches.length, selected: this.selected + 1 } }
  next(previous = false) {
    this.refresh()
    if (!this.query.search) { this.open(false, this.tab.selectedText()); return }
    if (!this.matches.length) return
    const range = this.selection()
    let index: number
    if (this.selected >= 0) index = (this.selected + (previous ? -1 : 1) + this.matches.length) % this.matches.length
    else if (previous) {
      index = this.matches.findLastIndex(match => match.to <= (range?.from ?? this.text.length)); if (index < 0) index = this.matches.length - 1
    } else { index = this.matches.findIndex(match => match.from >= (range?.to ?? 0)); if (index < 0) index = 0 }
    this.go(index)
  }
  private go(index: number) {
    const match = this.matches[index]
    if (!match) return
    this.selected = index
    if (this.map) {
      const range = this.map.range(match.from, match.to)
      if (range) {
        const active = document.activeElement as HTMLElement | null
        const selection = window.getSelection()!
        selection.removeAllRanges(); selection.addRange(range)
        const rect = range.getBoundingClientRect(), scroller = this.tab.previewScroll
        if (rect.height) scroller.scrollTop += rect.top - scroller.getBoundingClientRect().top - scroller.clientHeight / 2
        if (active?.closest('.find-dialog')) active.focus({ preventScroll: true })
      }
    } else {
      this.tab.source.view.dispatch({ selection: { anchor: match.from, head: match.to }, effects: EditorView.scrollIntoView(match.from, { y: 'center' }) })
    }
    this.paint(); this.dialog?.update()
  }
  replace(all: boolean) {
    this.refresh()
    if (!this.matches.length) return 0
    if (!all && this.selected < 0) { this.next(); return 0 }
    const matches = all ? this.matches : [this.matches[this.selected]!]
    const changes = matches.map(match => ({ from: match.from, to: match.to, insert: this.query.regexp ? replacement(this.query.replace, match, this.text) : this.query.replace }))
    const focused = document.activeElement as HTMLElement | null
    this.tab.preserveViewport(() => {
      if (this.map) this.tab.preview.replaceText(changes)
      else this.tab.source.view.dispatch({ changes, annotations: isolateHistory.of('full') })
    })
    if (focused?.isConnected) focused.focus({ preventScroll: true })
    this.refresh()
    if (!all) {
      const next = this.matches.findIndex(match => match.from >= changes[0]!.from + changes[0]!.insert.length)
      this.go(next < 0 ? 0 : next)
    }
    return changes.length
  }
  private clearPaint() {
    if (typeof CSS !== 'undefined' && 'highlights' in CSS) { CSS.highlights.delete('document-search'); CSS.highlights.delete('document-search-current') }
  }
  private paint() {
    this.clearPaint()
    const positions: number[] = []
    const highlight = typeof Highlight === 'undefined' ? undefined : new Highlight()
    const current = typeof Highlight === 'undefined' ? undefined : new Highlight()
    const scroller = this.map ? this.tab.previewScroll : this.tab.source.scrollElement
    for (let index = 0; index < this.matches.length; index++) {
      const match = this.matches[index]!
      if (this.map) {
        const range = this.map.range(match.from, match.to)
        if (!range) { positions.push(0); continue }
        if (index === this.selected) current?.add(range)
        highlight?.add(range)
        const rect = range.getBoundingClientRect()
        positions.push((rect.top - scroller.getBoundingClientRect().top + scroller.scrollTop) / Math.max(1, scroller.scrollHeight))
      } else {
        const line = this.tab.source.view.lineBlockAt(match.from)
        positions.push((line.top + line.height * (match.from - line.from) / Math.max(1, line.to - line.from)) / Math.max(1, this.tab.source.view.contentHeight))
      }
    }
    if (highlight && current && 'highlights' in CSS && this.map) { CSS.highlights.set('document-search', highlight); CSS.highlights.set('document-search-current', current) }
    this.overview.render(positions, scroller.offsetWidth - scroller.clientWidth)
  }
  destroy() {
    this.close(); clearTimeout(this.timer); this.observer.disconnect(); this.resize.disconnect(); this.overview.destroy()
    document.removeEventListener('selectionchange', this.selectionChanged)
    if (this.active) this.clearPaint()
  }
}
