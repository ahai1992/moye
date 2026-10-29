import type { EditorView, Panel, ViewUpdate } from '@codemirror/view'
import { closeSearchPanel, findNext, findPrevious, getSearchQuery, replaceAll, replaceNext, SearchQuery, setSearchQuery } from '@codemirror/search'

let floatingPosition: { left: number; top: number } | undefined

export class FindDialog implements Panel {
  readonly dom = document.createElement('dialog')
  private find: HTMLTextAreaElement
  private replacement: HTMLInputElement
  private caseSensitive: HTMLInputElement
  private wholeWord: HTMLInputElement
  private timer?: ReturnType<typeof setTimeout>
  private total = 0
  private replacing = false
  private composing = false
  private drag?: { id: number; x: number; y: number; left: number; top: number }
  private resizeObserver = new ResizeObserver(() => this.place())
  private resized = () => this.place()

  constructor(private view: EditorView, replace: boolean, private onClose: () => void) {
    this.dom.className = 'dialog find-dialog'
    this.dom.innerHTML = `
      <div class="find-header" title="拖动标题栏移动浮窗"><h2>搜索</h2><button type="button" data-find="close" title="关闭 Esc" aria-label="关闭搜索">×</button></div>
      <div class="find-modes" role="group" aria-label="搜索方式"><button type="button" data-find="search">搜索</button><button type="button" data-find="replace-mode">替换</button></div>
      <label class="find-row">查找<textarea rows="1" main-field="true" aria-label="查找内容" spellcheck="false"></textarea></label>
      <label class="find-row" data-replace-row>替换为<input type="text" aria-label="替换为" spellcheck="false"></label>
      <div class="find-options"><label><input type="checkbox" data-case>区分大小写</label><label><input type="checkbox" data-word>全词匹配</label></div>
      <p class="find-scope">在当前文档的 Markdown 原文中查找</p>
      <div class="find-status" role="status" aria-live="polite"></div>
      <div class="find-actions"><button type="button" data-find="previous">上一处</button><button type="button" data-find="next" class="primary">下一处</button><button type="button" data-find="replace">替换当前</button><button type="button" data-find="all">全部替换</button></div>`
    this.find = this.dom.querySelector('[main-field]')!
    this.replacement = this.dom.querySelector('[aria-label="替换为"]')!
    this.caseSensitive = this.dom.querySelector('[data-case]')!
    this.wholeWord = this.dom.querySelector('[data-word]')!
    const query = getSearchQuery(view.state)
    this.find.value = query.search
    this.replacement.value = query.replace
    this.caseSensitive.checked = query.caseSensitive
    this.wholeWord.checked = query.wholeWord
    this.setMode(replace)
    const header = this.dom.querySelector<HTMLElement>('.find-header')!
    header.addEventListener('pointerdown', event => {
      if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
      event.preventDefault()
      const rect = this.dom.getBoundingClientRect()
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top }
      header.setPointerCapture(event.pointerId)
      header.classList.add('dragging')
    })
    header.addEventListener('pointermove', event => {
      if (!this.drag || event.pointerId !== this.drag.id) return
      this.place(this.drag.left + event.clientX - this.drag.x, this.drag.top + event.clientY - this.drag.y)
    })
    const stopDragging = (event: PointerEvent) => {
      if (!this.drag || event.pointerId !== this.drag.id) return
      this.drag = undefined
      header.classList.remove('dragging')
      if (header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId)
    }
    header.addEventListener('pointerup', stopDragging)
    header.addEventListener('pointercancel', stopDragging)
    header.addEventListener('lostpointercapture', stopDragging)
    const schedule = () => {
      if (this.composing) return
      clearTimeout(this.timer)
      this.timer = setTimeout(() => this.syncQuery(true), 150)
    }
    this.dom.addEventListener('input', schedule)
    this.dom.addEventListener('compositionstart', () => { this.composing = true; clearTimeout(this.timer) })
    this.dom.addEventListener('compositionend', () => { this.composing = false; schedule() })
    this.dom.addEventListener('click', event => {
      const action = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-find]')?.dataset.find
      if (action === 'close') this.close()
      else if (action === 'search' || action === 'replace-mode') this.setMode(action === 'replace-mode')
      else if (action) this.run(action)
    })
    this.dom.addEventListener('cancel', event => { event.preventDefault(); this.close() })
    this.dom.addEventListener('keydown', event => {
      if (event.isComposing) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        this.close()
        return
      }
      if (event.key === 'Enter' && (event.target instanceof HTMLInputElement || event.target === this.find)) {
        event.preventDefault()
        this.run(event.shiftKey ? 'previous' : 'next')
      }
    })
  }

  mount() {
    this.dom.show()
    this.place(floatingPosition?.left, floatingPosition?.top)
    this.resizeObserver.observe(this.dom)
    window.addEventListener('resize', this.resized)
    this.syncQuery(false)
    this.find.focus()
    this.find.select()
  }

  private place(left?: number, top?: number) {
    if (!this.dom.open) return
    const rect = this.dom.getBoundingClientRect()
    left = Math.max(8, Math.min(left ?? rect.left, window.innerWidth - rect.width - 8))
    top = Math.max(8, Math.min(top ?? rect.top, window.innerHeight - rect.height - 8))
    this.dom.style.inset = `${top}px auto auto ${left}px`
    floatingPosition = { left, top }
  }

  setSearchText(text: string) {
    this.find.value = text.replace(/\r\n?/g, '\n')
    this.syncQuery(false)
    this.find.focus()
    this.find.select()
  }

  setMode(replace: boolean) {
    this.dom.setAttribute('aria-label', replace ? '搜索和替换' : '搜索')
    this.dom.querySelector('h2')!.textContent = replace ? '搜索和替换' : '搜索'
    this.dom.querySelector<HTMLElement>('[data-replace-row]')!.hidden = !replace
    for (const action of ['replace', 'all']) this.dom.querySelector<HTMLButtonElement>(`[data-find="${action}"]`)!.hidden = !replace
    this.dom.querySelector('[data-find="search"]')!.setAttribute('aria-pressed', String(!replace))
    this.dom.querySelector('[data-find="replace-mode"]')!.setAttribute('aria-pressed', String(replace))
    if (this.dom.open) { this.find.focus(); this.find.select() }
  }

  update(update: ViewUpdate) {
    if (!getSearchQuery(update.startState).eq(getSearchQuery(update.state))) {
      const query = getSearchQuery(update.state)
      if (this.find.value !== query.search) { clearTimeout(this.timer); this.find.value = query.search }
    }
    if (update.docChanged || update.selectionSet || !getSearchQuery(update.startState).eq(getSearchQuery(update.state))) this.updateStatus()
  }

  close() {
    this.syncQuery(false)
    closeSearchPanel(this.view)
  }

  private syncQuery(select: boolean) {
    clearTimeout(this.timer)
    // 用户已回到正文时，延迟执行的搜索更新只能更新查询，不能重设其拖选范围。
    select = select && this.dom.contains(document.activeElement) && document.activeElement !== this.replacement
    const query = new SearchQuery({ search: this.find.value, replace: this.replacement.value, caseSensitive: this.caseSensitive.checked, wholeWord: this.wholeWord.checked, literal: true })
    if (!query.eq(getSearchQuery(this.view.state))) {
      const inputSelection = [this.find.selectionStart, this.find.selectionEnd] as const
      const selection = select ? { anchor: this.view.state.selection.main.from } : undefined
      this.view.dispatch({ effects: setSearchQuery.of(query), selection })
      if (select && query.valid) findNext(this.view)
      if (document.activeElement === this.find) this.find.setSelectionRange(...inputSelection)
    }
    this.updateStatus()
  }

  private updateStatus(message?: string) {
    const query = getSearchQuery(this.view.state)
    const selection = this.view.state.selection.main
    let selected = 0
    this.total = 0
    if (query.valid) {
      const cursor = query.getCursor(this.view.state)
      for (let match = cursor.next(); !match.done; match = cursor.next()) {
        this.total++
        if (match.value.from === selection.from && match.value.to === selection.to) selected = this.total
      }
    }
    this.dom.querySelector('.find-status')!.textContent = message ?? (!query.valid ? '请输入要查找的内容' : !this.total ? '未找到匹配内容' : selected ? `第 ${selected} / ${this.total} 处` : `共 ${this.total} 处`)
    for (const button of this.dom.querySelectorAll<HTMLButtonElement>('.find-actions button')) button.disabled = !this.total || this.replacing
  }

  private run(action: string) {
    if (this.replacing) return
    this.syncQuery(false)
    if (!this.total) return
    if (action === 'next' || action === 'previous') {
      ;(action === 'next' ? findNext : findPrevious)(this.view)
      return
    }
    this.replacing = true
    try {
      const total = this.total
      const before = this.view.state.doc
      if (action === 'all') replaceAll(this.view)
      else if (action === 'replace') { replaceNext(this.view); findNext(this.view) }
      if (!this.view.state.doc.eq(before)) this.updateStatus(`已替换 ${action === 'all' ? total : 1} 处，可回到正文按 Ctrl+Z 撤销`)
    } finally {
      this.replacing = false
      for (const button of this.dom.querySelectorAll<HTMLButtonElement>('.find-actions button')) button.disabled = !this.total
    }
  }

  destroy() {
    clearTimeout(this.timer)
    this.resizeObserver.disconnect()
    window.removeEventListener('resize', this.resized)
    this.dom.close()
    this.onClose()
  }
}
