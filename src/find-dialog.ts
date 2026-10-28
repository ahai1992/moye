import type { EditorView, Panel, ViewUpdate } from '@codemirror/view'
import { closeSearchPanel, findNext, findPrevious, getSearchQuery, replaceAll, replaceNext, SearchQuery, setSearchQuery } from '@codemirror/search'

export class FindDialog implements Panel {
  readonly dom = document.createElement('dialog')
  private find: HTMLInputElement
  private replacement: HTMLInputElement
  private caseSensitive: HTMLInputElement
  private wholeWord: HTMLInputElement
  private timer?: ReturnType<typeof setTimeout>
  private total = 0
  private replacing = false
  private composing = false

  constructor(private view: EditorView, replace: boolean, private onClose: () => void) {
    this.dom.className = 'dialog find-dialog'
    this.dom.innerHTML = `
      <div class="find-header"><h2>搜索</h2><button type="button" data-find="close" title="关闭 Esc" aria-label="关闭搜索">×</button></div>
      <div class="find-modes" role="group" aria-label="搜索方式"><button type="button" data-find="search">搜索</button><button type="button" data-find="replace-mode">替换</button></div>
      <label class="find-row">查找<input type="text" main-field="true" aria-label="查找内容" spellcheck="false"></label>
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
      if (action === 'close') closeSearchPanel(this.view)
      else if (action === 'search' || action === 'replace-mode') this.setMode(action === 'replace-mode')
      else if (action) this.run(action)
    })
    this.dom.addEventListener('cancel', event => { event.preventDefault(); closeSearchPanel(this.view) })
    this.dom.addEventListener('keydown', event => {
      if (event.isComposing) return
      if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
        event.preventDefault()
        this.run(event.shiftKey ? 'previous' : 'next')
      }
    })
  }

  mount() {
    this.dom.showModal()
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
    if (update.docChanged || update.selectionSet || !getSearchQuery(update.startState).eq(getSearchQuery(update.state))) this.updateStatus()
  }

  private syncQuery(select: boolean) {
    clearTimeout(this.timer)
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
      if (!this.view.state.doc.eq(before)) this.updateStatus(`已替换 ${action === 'all' ? total : 1} 处，可在关闭弹窗后按 Ctrl+Z 撤销`)
    } finally {
      this.replacing = false
      for (const button of this.dom.querySelectorAll<HTMLButtonElement>('.find-actions button')) button.disabled = !this.total
    }
  }

  destroy() {
    clearTimeout(this.timer)
    this.dom.close()
    this.onClose()
  }
}
