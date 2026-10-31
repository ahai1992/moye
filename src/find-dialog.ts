import { SearchQuery } from '@codemirror/search'

export interface SearchHost {
  query: SearchQuery
  setQuery(query: SearchQuery, navigate: boolean): void
  status(): { total: number; selected: number }
  next(previous?: boolean): void
  replace(all: boolean): number
  scope(): string
}

let floatingPosition: { left: number; top: number } | undefined

export class FindDialog {
  readonly dom = document.createElement('dialog')
  private find: HTMLTextAreaElement
  private replacement: HTMLTextAreaElement
  private caseSensitive: HTMLInputElement
  private wholeWord: HTMLInputElement
  private regexp: HTMLInputElement
  private timer?: ReturnType<typeof setTimeout>
  private total = 0
  private replacing = false
  private composing = false
  private drag?: { id: number; x: number; y: number; left: number; top: number }
  private resizeObserver = new ResizeObserver(() => this.place())
  private resized = () => this.place()

  constructor(private host: SearchHost, replace: boolean, private onClose: () => void, private onError: (error: unknown) => void) {
    this.dom.className = 'dialog find-dialog'
    this.dom.innerHTML = `
      <div class="find-header" title="拖动标题栏移动浮窗"><h2>搜索</h2><button type="button" data-find="close" title="关闭 Esc" aria-label="关闭搜索">×</button></div>
      <div class="find-modes" role="group" aria-label="搜索方式"><button type="button" data-find="search">搜索</button><button type="button" data-find="replace-mode">替换</button></div>
      <label class="find-row">查找<textarea rows="1" main-field="true" aria-label="查找内容" spellcheck="false"></textarea></label>
      <label class="find-row" data-replace-row>替换为<textarea rows="1" aria-label="替换为" spellcheck="false"></textarea></label>
      <div class="find-options"><label><input type="checkbox" data-case>区分大小写</label><label><input type="checkbox" data-word>全词匹配</label><label><input type="checkbox" data-regexp>正则表达式</label></div>
      <p class="find-scope"></p>
      <p class="find-regexp-help" hidden>正则替换支持 $1、$2、$&amp; 和命名分组 $&lt;名称&gt;；\\n 换行，\\t 制表符。</p>
      <div class="find-status" role="status" aria-live="polite"></div>
      <div class="find-actions"><button type="button" data-find="previous">上一处</button><button type="button" data-find="next" class="primary">下一处</button><button type="button" data-find="replace">替换当前</button><button type="button" data-find="all">全部替换</button></div>`
    this.find = this.dom.querySelector('[main-field]')!
    this.replacement = this.dom.querySelector('[aria-label="替换为"]')!
    this.caseSensitive = this.dom.querySelector('[data-case]')!
    this.wholeWord = this.dom.querySelector('[data-word]')!
    this.regexp = this.dom.querySelector('[data-regexp]')!
    const query = host.query
    this.find.value = query.search
    this.replacement.value = query.replace
    this.caseSensitive.checked = query.caseSensitive
    this.wholeWord.checked = query.wholeWord
    this.regexp.checked = query.regexp
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
      if (event.key === 'Enter' && (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault()
        this.run(event.shiftKey ? 'previous' : 'next')
      }
    })
  }

  mount() {
    document.body.append(this.dom)
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

  update() { this.updateStatus() }

  close() {
    this.syncQuery(false)
    this.destroy()
  }

  private syncQuery(select: boolean) {
    clearTimeout(this.timer)
    // 用户已回到正文时，延迟执行的搜索更新只能更新查询，不能重设其拖选范围。
    select = select && this.dom.contains(document.activeElement) && document.activeElement !== this.replacement
    const query = new SearchQuery({ search: this.find.value, replace: this.replacement.value, caseSensitive: this.caseSensitive.checked, wholeWord: this.wholeWord.checked, regexp: this.regexp.checked, literal: true })
    if (!query.eq(this.host.query)) this.host.setQuery(query, select)
    this.updateStatus()
  }

  private updateStatus(message?: string) {
    const query = this.host.query
    const { total, selected } = this.host.status()
    this.total = total
    this.dom.querySelector('.find-scope')!.textContent = this.host.scope()
    this.dom.querySelector<HTMLElement>('.find-regexp-help')!.hidden = !query.regexp
    this.dom.querySelector('.find-status')!.textContent = message ?? (!query.valid ? query.search && query.regexp ? '正则表达式无效，请检查括号或转义符。' : '请输入要查找的内容' : !this.total ? '未找到匹配内容' : selected ? `第 ${selected} / ${this.total} 处` : `共 ${this.total} 处`)
    for (const button of this.dom.querySelectorAll<HTMLButtonElement>('.find-actions button')) button.disabled = !this.total || this.replacing
  }

  private run(action: string) {
    if (this.replacing) return
    this.syncQuery(false)
    if (!this.total) return
    if (action === 'next' || action === 'previous') {
      this.host.next(action === 'previous')
      return
    }
    this.replacing = true
    try {
      const count = this.host.replace(action === 'all')
      if (count) this.updateStatus(`已替换 ${count} 处，可回到正文按 Ctrl+Z 撤销`)
    } catch (error) { this.onError(error) } finally {
      this.replacing = false
      for (const button of this.dom.querySelectorAll<HTMLButtonElement>('.find-actions button')) button.disabled = !this.total
    }
  }

  destroy() {
    clearTimeout(this.timer)
    this.resizeObserver.disconnect()
    window.removeEventListener('resize', this.resized)
    this.dom.close()
    this.dom.remove()
    this.onClose()
  }
}
