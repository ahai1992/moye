// Chromium 的跨块 insertHTML 会合并两端的标题或列表项。使用 DOM Range 精确替换，
// 在正文外记录一个原生编辑事务，使它与普通输入共用浏览器的撤销/重做顺序。
export class BlockHistory {
  private entries: { marker: HTMLElement; start: Comment; end: Comment }[] = []

  replace(range: Range, content: DocumentFragment, changed: (range: Range) => void) {
    const marker = document.createElement('div')
    marker.contentEditable = 'true'
    marker.tabIndex = -1
    marker.setAttribute('aria-hidden', 'true')
    marker.className = 'clipboard-transfer'
    marker.style.opacity = '0'
    marker.style.pointerEvents = 'none'
    marker.textContent = '0'
    document.body.append(marker)
    marker.focus({ preventScroll: true })
    const token = document.createRange()
    token.selectNodeContents(marker)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(token)
    if (!document.execCommand('insertText', false, '1')) {
      marker.remove()
      throw new Error('当前内容未能替换，请重新点击“替换”后重试。')
    }
    const start = document.createComment('')
    const end = document.createComment('')
    const tail = range.cloneRange()
    tail.collapse(false)
    tail.insertNode(end)
    const head = range.cloneRange()
    head.collapse(true)
    head.insertNode(start)
    const between = () => {
      const value = document.createRange()
      value.setStartAfter(start)
      value.setEndBefore(end)
      return value
    }
    let inactive = between().extractContents()
    end.before(content)
    let applied = true
    const entry = { marker, start, end }
    this.entries.push(entry)
    marker.addEventListener('input', () => {
      const next = marker.textContent === '1'
      if (next === applied || !start.isConnected || !end.isConnected) return
      const current = between().extractContents()
      end.before(inactive)
      inactive = current
      applied = next
      changed(between())
    })
    changed(between())
  }

  clear() {
    for (const { marker, start, end } of this.entries) {
      marker.remove()
      start.remove()
      end.remove()
    }
    this.entries = []
  }
}
