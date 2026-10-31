import type { OpenedDocument } from './desktop'
import { SourceEditor, type WrapMode } from './source-editor'
import { PreviewEditor } from './preview-editor'
import { editText } from './dialogs'
import { headingText, markdownHeadings } from './markdown'
import { BlockCopy } from './block-copy'
import { DocumentSearch } from './document-search'
import { PreviewPosition, sourceAnchor, restoreSource, type ReadingAnchor } from './preview-position'

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
  encoding: string
  draftContent: string | null = null
  readonly root = document.createElement('div')
  readonly previewScroll = document.createElement('div')
  readonly previewHost = document.createElement('article')
  readonly sourceHost = document.createElement('div')
  readonly search: DocumentSearch
  private position?: PreviewPosition
  private scrollRevision = 0
  private readingAnchor?: ReadingAnchor
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
    this.encoding = document.encoding ?? 'UTF-8'
    this.root.className = 'document-view'
    this.root.id = `panel-${this.id}`
    this.root.setAttribute('role', 'tabpanel')
    this.root.hidden = true
    this.previewScroll.className = 'writing-scroll'
    this.previewHost.className = 'writing-page'
    this.sourceHost.className = 'source-editor'
    this.previewScroll.append(this.previewHost)
    this.root.append(this.previewScroll, this.sourceHost)
    this.search = new DocumentSearch(this, onError)
  }

  get dirty() { return this.content !== this.savedContent }
  get source() { return this.editors!.source }
  get preview() { return this.editors!.preview }

  selectedText() {
    if (document.activeElement?.closest('.find-dialog')) return ''
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
    const changed = (content: string) => { this.content = content; this.position?.invalidate(); this.search.schedule(); this.onChange(this) }
    const source = new SourceEditor(this.sourceHost, changed, this.content, this.view.wrap, () => this.search.schedule())
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
    this.position?.destroy()
    this.position = new PreviewPosition(preview, this.previewScroll, this.root)
    source.setSearch(this.search.query)
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
    this.search.close()
    this.flush()
    this.captureView()
    this.active = false
    this.search.setActive(false)
    this.position?.setActive(false)
    this.scrollRevision++
    this.root.hidden = true
    for (const element of [this.previewHost, this.previewScroll, this.sourceHost]) element.removeAttribute('id')
  }

  private showMode() {
    this.previewScroll.hidden = this.view.mode !== 'preview'
    this.sourceHost.hidden = this.view.mode !== 'source'
    this.search.setActive(this.active)
    this.position?.setActive(this.active && this.view.mode === 'preview')
  }

  private restoreScroll() {
    const revision = ++this.scrollRevision
    requestAnimationFrame(() => {
      if (!this.active || !this.editors || revision !== this.scrollRevision) return
      this.source.view.requestMeasure()
      const scroller = this.view.mode === 'preview' ? this.previewScroll : this.source.scrollElement
      const position = this.view[this.view.mode]
      scroller.scrollTop = position.top
      scroller.scrollLeft = position.left
      requestAnimationFrame(() => {
        if (!this.active || revision !== this.scrollRevision) return
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
    this.flush()
    const anchor = this.view.mode === 'preview' ? this.position!.capture(this.readingAnchor) : sourceAnchor(this.source, this.readingAnchor)
    this.readingAnchor = anchor
    this.captureView()
    const revision = ++this.scrollRevision
    if (mode === 'preview') this.preview.setValue(this.content)
    else this.source.setValue(this.content)
    this.view.mode = mode
    this.showMode()
    if (mode === 'preview') this.preview.focus()
    else this.source.focus()
    const restore = () => {
      if (!this.active || revision !== this.scrollRevision) return
      if (mode === 'preview') this.position!.restore(anchor)
      else restoreSource(this.source, anchor)
      this.captureView()
      this.search.schedule()
    }
    requestAnimationFrame(() => { restore(); requestAnimationFrame(restore) })
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
    const reading = this.position!.capture()
    const top = this.previewScroll.getBoundingClientRect().top
    const anchor = Array.from(this.previewHost.children).find(child => child.getBoundingClientRect().bottom > top)
    const offset = anchor?.getBoundingClientRect().top ?? 0
    change()
    if (anchor?.isConnected) this.previewScroll.scrollTop += anchor.getBoundingClientRect().top - offset
    else this.position!.restore(reading)
  }

  markSaved(document: OpenedDocument) {
    const moved = this.path !== document.path
    this.path = document.path
    this.name = document.name
    this.lineEnding = document.lineEnding
    this.encoding = document.encoding ?? 'UTF-8'
    this.savedContent = document.content
    this.draftContent = null
    if (moved) this.editors?.preview.refreshImages()
  }

  reload(document: OpenedDocument) {
    this.readingAnchor = undefined
    this.search.close()
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
    this.search.destroy()
    this.position?.destroy()
    this.root.remove()
  }
}
