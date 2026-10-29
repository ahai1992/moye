import type { OpenedDocument } from './desktop'
import { SourceEditor, type WrapMode } from './source-editor'
import { PreviewEditor } from './preview-editor'
import { editText } from './dialogs'
import { headingText, markdownHeadings } from './markdown'
import { BlockCopy } from './block-copy'
import { PreviewSearchHighlights } from './search-highlights'

export interface OutlineHeading { level: number; text: string; from?: number; element?: HTMLElement }

export interface ViewState {
  mode: 'preview' | 'source'
  wrap: WrapMode
  preview: { top: number; left: number }
  source: { top: number; left: number }
}

export function initialView(wrap: WrapMode = 'window'): ViewState {
  return { mode: 'preview', wrap, preview: { top: 0, left: 0 }, source: { top: 0, left: 0 } }
}

export class DocumentTab {
  readonly id: string
  name: string
  path: string | null
  content: string
  savedContent: string
  lineEnding: string
  draftContent: string | null = null
  readonly root = document.createElement('div')
  readonly previewScroll = document.createElement('div')
  readonly previewHost = document.createElement('article')
  readonly sourceHost = document.createElement('div')
  private searchHighlights = new PreviewSearchHighlights(this.previewHost)
  private editors?: { source: SourceEditor; preview: PreviewEditor }
  private copy?: BlockCopy
  private active = false

  constructor(
    document: OpenedDocument,
    public view: ViewState,
    private onChange: (tab: DocumentTab) => void,
    private onError: (error: unknown) => void,
  ) {
    this.id = document.id
    this.name = document.name
    this.path = document.path
    this.content = document.content
    this.savedContent = document.path ? document.content : ''
    this.lineEnding = document.lineEnding
    this.root.className = 'document-view'
    this.root.id = `panel-${this.id}`
    this.root.setAttribute('role', 'tabpanel')
    this.root.hidden = true
    this.previewScroll.className = 'writing-scroll'
    this.previewHost.className = 'writing-page'
    this.sourceHost.className = 'source-editor'
    this.previewScroll.append(this.previewHost)
    this.root.append(this.previewScroll, this.sourceHost)
  }

  get dirty() { return this.content !== this.savedContent }
  get source() { return this.editors!.source }
  get preview() { return this.editors!.preview }

  selectedText() {
    if (this.view.mode === 'source') {
      if (!this.source.view.hasFocus) return ''
      const { from, to } = this.source.view.state.selection.main
      return this.source.view.state.sliceDoc(from, to)
    }
    const selection = window.getSelection()
    return selection && this.previewHost.contains(selection.anchorNode) && this.previewHost.contains(selection.focusNode)
      ? selection.toString() : ''
  }

  private ensureEditors() {
    if (this.editors) return
    const changed = (content: string) => { this.content = content; this.onChange(this) }
    const source = new SourceEditor(this.sourceHost, changed, this.content, this.view.wrap, query => this.searchHighlights.setQuery(query))
    const preview = new PreviewEditor(this.previewHost, changed, (value, kind) => {
      if (kind === 'chapter') {
        return editText('替换当前章节', '包含当前标题及下级内容，至下一个同级或更高级标题之前。Ctrl+Enter 应用修改。', value, 'block')
      }
      if (kind === 'block' || kind === 'code-block') {
        return editText(kind === 'code-block' ? '替换当前代码块' : '替换当前文本块',
          kind === 'code-block' ? '只修改当前代码块，保留代码语言和缩进。Ctrl+Enter 应用修改。'
            : '这里只包含当前块的 Markdown 内容，应用后仅替换这一块。Ctrl+Enter 应用修改。', value, 'block')
      }
      const names: Record<string, string> = { math: '编辑公式', mermaid: '编辑图表', metadata: '编辑文档属性', footnote: '编辑脚注' }
      return editText(names[kind] ?? '编辑内容', '修改这一处的 Markdown 内容，确定后回到原来的位置。', value, true)
    }, this.onError, this.id)
    this.editors = { source, preview }
    this.copy ??= new BlockCopy(this.previewHost, this.onError,
      target => this.preview.replaceBlock(target), target => this.preview.copyBlock(target))
    try { preview.setValue(this.content, true) }
    catch (error) { this.view.mode = 'source'; this.onError(error) }
  }

  activate(parent: HTMLElement) {
    if (!this.root.isConnected) parent.append(this.root)
    this.active = true
    this.root.hidden = false
    this.previewHost.id = 'preview'
    this.previewScroll.id = 'preview-scroll'
    this.sourceHost.id = 'source'
    this.root.dataset.wrap = this.view.wrap
    this.ensureEditors()
    this.showMode()
    this.restoreScroll()
  }

  deactivate() {
    this.editors?.source.closeSearch()
    this.flush()
    this.captureView()
    this.active = false
    this.searchHighlights.setActive(false)
    this.root.hidden = true
    for (const element of [this.previewHost, this.previewScroll, this.sourceHost]) element.removeAttribute('id')
  }

  private showMode() {
    this.previewScroll.hidden = this.view.mode !== 'preview'
    this.sourceHost.hidden = this.view.mode !== 'source'
    this.searchHighlights.setActive(this.active && this.view.mode === 'preview')
  }

  private restoreScroll() {
    requestAnimationFrame(() => {
      if (!this.active || !this.editors) return
      this.source.view.requestMeasure()
      const scroller = this.view.mode === 'preview' ? this.previewScroll : this.source.scrollElement
      const position = this.view[this.view.mode]
      scroller.scrollTop = position.top
      scroller.scrollLeft = position.left
      requestAnimationFrame(() => {
        if (!this.active) return
        scroller.scrollTop = position.top
        scroller.scrollLeft = position.left
      })
    })
  }

  captureView() {
    if (this.active && this.editors) {
      const scroller = this.view.mode === 'preview' ? this.previewScroll : this.source.scrollElement
      this.view[this.view.mode] = { top: scroller.scrollTop, left: scroller.scrollLeft }
    }
    return structuredClone(this.view)
  }

  flush() {
    if (this.editors) this.content = this.view.mode === 'preview' ? this.preview.flush() : this.source.getValue()
    return this.content
  }

  setMode(mode: ViewState['mode']) {
    if (mode === this.view.mode) return
    this.source.closeSearch()
    this.flush()
    this.captureView()
    if (mode === 'preview') this.preview.setValue(this.content)
    else this.source.setValue(this.content)
    this.view.mode = mode
    this.showMode()
    if (mode === 'preview') this.preview.focus()
    else this.source.focus()
    this.restoreScroll()
  }

  setWrapping(wrap: WrapMode) {
    const top = this.previewScroll.getBoundingClientRect().top
    const anchor = Array.from(this.previewHost.children).find(child => child.getBoundingClientRect().bottom > top)
    const offset = anchor?.getBoundingClientRect().top ?? 0
    this.view.wrap = wrap
    this.root.dataset.wrap = wrap
    this.source.setWrapping(wrap)
    if (this.view.mode === 'preview' && anchor) this.previewScroll.scrollTop += anchor.getBoundingClientRect().top - offset
    if (wrap !== 'none') this.previewScroll.scrollLeft = 0
    this.captureView()
  }

  headings(): OutlineHeading[] {
    if (this.view.mode === 'source') return markdownHeadings(this.content)
    return Array.from(this.previewHost.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'))
      .filter(element => !element.closest('[data-md-source]'))
      .map(element => ({ level: Number(element.tagName.slice(1)), text: headingText(element), element }))
  }

  jumpToHeading(heading: OutlineHeading) {
    if (this.view.mode === 'source' && heading.from !== undefined) this.source.jumpTo(heading.from)
    else if (heading.element?.isConnected) {
      const element = heading.element
      for (let parent = element.parentElement; parent && parent !== this.previewHost; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement) parent.open = true
      }
      this.previewHost.focus({ preventScroll: true })
      const range = document.createRange()
      range.selectNodeContents(element)
      range.collapse(true)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      this.previewScroll.scrollTop += element.getBoundingClientRect().top - this.previewScroll.getBoundingClientRect().top - 8
    }
    requestAnimationFrame(() => this.captureView())
  }

  preserveViewport(change: () => void) {
    if (this.view.mode === 'source') { this.source.preserveViewport(change); return }
    const top = this.previewScroll.getBoundingClientRect().top
    const anchor = Array.from(this.previewHost.children).find(child => child.getBoundingClientRect().bottom > top)
    const offset = anchor?.getBoundingClientRect().top ?? 0
    change()
    if (anchor) this.previewScroll.scrollTop += anchor.getBoundingClientRect().top - offset
  }

  markSaved(document: OpenedDocument) {
    const moved = this.path !== document.path
    this.path = document.path
    this.name = document.name
    this.lineEnding = document.lineEnding
    this.savedContent = document.content
    this.draftContent = null
    if (moved) this.editors?.preview.refreshImages()
  }

  reload(document: OpenedDocument) {
    this.captureView()
    this.content = document.content
    this.markSaved(document)
    this.editors?.source.destroy()
    this.editors?.preview.destroy()
    this.editors = undefined
    this.previewHost.replaceChildren()
    this.ensureEditors()
    this.showMode()
    this.restoreScroll()
  }

  destroy() {
    this.active = false
    this.editors?.source.destroy()
    this.editors?.preview.destroy()
    this.copy?.destroy()
    this.searchHighlights.destroy()
    this.root.remove()
  }
}
