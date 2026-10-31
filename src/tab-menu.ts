export type TabAction = 'save' | 'copy-path' | 'reveal' | 'save-encoding' | 'read-encoding' | 'reload'
const encodings = ['UTF-8', 'UTF-8 BOM', 'UTF-16LE', 'UTF-16BE', 'GBK', 'GB18030', 'Big5', 'Shift_JIS', 'Windows-1252']

export function chooseEncoding(current: string, reading: boolean): Promise<string | null> {
  const dialog = document.createElement('dialog')
  dialog.className = 'dialog encoding-dialog'
  dialog.innerHTML = `<h2>${reading ? '以指定编码读取' : '按指定编码保存'}</h2><p>${reading ? '重新读取磁盘文件，不会转换或覆盖原文件。' : '使用所选编码保存当前内容；如果编码无法完整表示文字，将停止保存并提示。'}</p><select aria-label="文本编码"></select><div class="dialog-actions"><button data-cancel>取消</button><button class="primary" data-accept>${reading ? '读取' : '保存'}</button></div>`
  const select = dialog.querySelector('select')!
  select.replaceChildren(...encodings.map(name => new Option(name, name)))
  select.value = current
  return new Promise(resolve => {
    const close = (value: string | null) => { dialog.close(); dialog.remove(); resolve(value) }
    dialog.querySelector('[data-cancel]')!.addEventListener('click', () => close(null))
    dialog.querySelector('[data-accept]')!.addEventListener('click', () => close(select.value))
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(null) })
    document.body.append(dialog)
    dialog.showModal()
    select.focus()
  })
}

export function installTabMenu(strip: HTMLElement, available: () => boolean, hasFile: (id: string) => boolean, run: (id: string, action: TabAction) => void) {
  let close: (() => void) | undefined
  const open = (target: HTMLElement, x: number, y: number) => {
    close?.()
    const id = target.closest<HTMLElement>('.tab-item')?.dataset.id
    if (!id || !available()) return
    const menu = document.createElement('div')
    menu.className = 'tab-context-menu'
    menu.setAttribute('role', 'menu')
    menu.setAttribute('aria-label', '文档操作')
    const entries: [TabAction, string, boolean][] = [
      ['save', '保存', true], ['copy-path', '复制文件路径', hasFile(id)],
      ['reveal', '在资源管理器中显示', hasFile(id)], ['save-encoding', '按指定编码保存…', true],
      ['read-encoding', '以指定编码读取…', hasFile(id)], ['reload', '重新载入', hasFile(id)],
    ]
    for (const [action, label, enabled] of entries) {
      const button = document.createElement('button')
      button.type = 'button'; button.textContent = label; button.disabled = !enabled
      button.setAttribute('role', 'menuitem')
      button.onclick = () => { close?.(); run(id, action) }
      menu.append(button)
    }
    const outside = (event: PointerEvent) => { if (!menu.contains(event.target as Node)) close?.() }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close?.(); target.closest<HTMLElement>('.tab-item')?.querySelector<HTMLButtonElement>('.tab-select')?.focus(); return }
      const buttons = Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
      if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus()
      }
    }
    close = () => { menu.remove(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', key, true); window.removeEventListener('resize', close!); close = undefined }
    document.body.append(menu)
    menu.style.left = `${Math.max(4, Math.min(x, innerWidth - menu.offsetWidth - 4))}px`
    menu.style.top = `${Math.max(4, Math.min(y, innerHeight - menu.offsetHeight - 4))}px`
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', key, true)
    window.addEventListener('resize', close)
    menu.querySelector<HTMLButtonElement>('button')!.focus()
  }
  strip.addEventListener('contextmenu', event => { event.preventDefault(); open(event.target as HTMLElement, event.clientX, event.clientY) })
  strip.addEventListener('keydown', event => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
    event.preventDefault()
    const target = event.target as HTMLElement, rect = target.getBoundingClientRect()
    open(target, rect.left, rect.bottom)
  })
}
