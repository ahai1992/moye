import type { DocumentTab, OutlineHeading } from './document-tab'

export class ReadingTools {
  private panel = document.getElementById('outline')!
  private list = document.getElementById('outline-list')!
  private toggle = document.getElementById('outline-toggle')!
  private fontLabel = document.getElementById('font-size')!
  private fontSize = 15
  private tab?: DocumentTab
  private content = ''
  private mode = ''
  private headings: OutlineHeading[] = []
  private timer?: ReturnType<typeof setTimeout>

  constructor(private current: () => DocumentTab | undefined, private enabled: () => boolean) {
    try {
      this.panel.hidden = localStorage.getItem('moye-outline-hidden') === 'true'
      const size = Number(localStorage.getItem('moye-font-size'))
      if (Number.isInteger(size) && size >= 10 && size <= 32) this.fontSize = size
    } catch (error) { console.error('Reading preferences could not be read:', error) }
    this.applyFont()
    this.toggle.setAttribute('aria-expanded', String(!this.panel.hidden))
    this.toggle.addEventListener('click', () => {
      if (!this.enabled()) return
      const change = () => { this.panel.hidden = !this.panel.hidden }
      const tab = this.current()
      if (tab) tab.preserveViewport(change)
      else change()
      this.toggle.setAttribute('aria-expanded', String(!this.panel.hidden))
      this.remember('moye-outline-hidden', String(this.panel.hidden))
      if (tab) this.render(tab)
    })
    this.list.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-heading]')
      const tab = this.current()
      if (!button || !tab || tab !== this.tab || !this.enabled()) return
      tab.flush()
      const index = Number(button.dataset.heading)
      const heading = tab.headings()[index]
      if (heading) {
        tab.jumpToHeading(heading)
        this.list.querySelector('[aria-current]')?.removeAttribute('aria-current')
        button.setAttribute('aria-current', 'location')
      }
    })
    document.addEventListener('wheel', event => {
      if (!event.ctrlKey || document.querySelector('dialog:modal')) return
      event.preventDefault()
      if (!this.enabled() || !event.deltaY) return
      this.setFont(this.fontSize + (event.deltaY < 0 ? 1 : -1))
    }, { passive: false, capture: true })
    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key === '0' && this.enabled() && !event.isComposing) {
        event.preventDefault()
        this.setFont(15)
      }
    })
    this.fontLabel.addEventListener('click', () => { if (this.enabled()) this.setFont(15) })
  }

  update(tab: DocumentTab) {
    if (tab === this.tab && tab.content === this.content && tab.view.mode === this.mode) return
    const switched = tab !== this.tab || tab.view.mode !== this.mode
    this.tab = tab
    this.content = tab.content
    this.mode = tab.view.mode
    clearTimeout(this.timer)
    if (switched) this.list.replaceChildren()
    if (this.panel.hidden) return
    if (switched) this.render(tab)
    else this.timer = setTimeout(() => this.render(tab), 150)
  }

  private render(tab: DocumentTab) {
    clearTimeout(this.timer)
    if (tab !== this.current() || this.panel.hidden) return
    const headings = tab.headings()
    const unchanged = this.list.childElementCount > 0 && headings.length === this.headings.length
      && headings.every((heading, index) => heading.level === this.headings[index]!.level && heading.text === this.headings[index]!.text)
    this.headings = headings
    document.getElementById('outline-empty')!.hidden = headings.length > 0
    if (unchanged) return
    const fragment = document.createDocumentFragment()
    for (const [index, heading] of headings.entries()) {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.heading = String(index)
      button.style.paddingLeft = `${8 + (heading.level - 1) * 12}px`
      button.textContent = heading.text
      button.title = `${heading.level} 级标题：${heading.text}`
      fragment.append(button)
    }
    this.list.replaceChildren(fragment)
  }

  private applyFont() {
    document.documentElement.style.setProperty('--editor-font-size', `${this.fontSize}px`)
    this.fontLabel.textContent = `${this.fontSize} px`
  }

  private setFont(size: number) {
    size = Math.min(32, Math.max(10, size))
    if (size === this.fontSize) return
    const tab = this.current()
    const change = () => { this.fontSize = size; this.applyFont() }
    if (tab) tab.preserveViewport(change)
    else change()
    this.remember('moye-font-size', String(size))
  }

  private remember(key: string, value: string) {
    try { localStorage.setItem(key, value) }
    catch (error) { console.error('Reading preference could not be saved:', error) }
  }
}
