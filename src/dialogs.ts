function createDialog(title: string, description: string) {
  const dialog = document.createElement('dialog')
  dialog.className = 'dialog'
  const heading = document.createElement('h2')
  heading.textContent = title
  const detail = document.createElement('p')
  detail.textContent = description
  dialog.append(heading, detail)
  dialog.setAttribute('aria-label', title)
  document.body.append(dialog)
  return dialog
}

export function confirmUnsaved(name: string, closingDraft = false): Promise<'save' | 'discard' | 'cancel'> {
  const dialog = createDialog('保存当前修改？', closingDraft
    ? `关闭“${name}”的标签会同时移除临时草稿。可以保存为文件；直接关闭整个窗口则会保留草稿供下次继续。`
    : `“${name}”有尚未保存的修改。已有文件不会自动保存或暂存。`)
  const actions = document.createElement('div')
  actions.className = 'dialog-actions'
  return new Promise(resolve => {
    const finish = (value: 'save' | 'discard' | 'cancel') => { dialog.close(); dialog.remove(); resolve(value) }
    for (const [value, label] of [['discard', '不保存'], ['cancel', '取消'], ['save', '保存修改']] as const) {
      const button = document.createElement('button')
      button.textContent = label
      if (value === 'save') button.className = 'primary'
      button.onclick = () => finish(value)
      actions.append(button)
    }
    dialog.append(actions)
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish('cancel') })
    dialog.showModal()
    actions.querySelector<HTMLButtonElement>('.primary')!.focus()
  })
}

export function confirmReload(name: string, dirty: boolean): Promise<boolean> {
  const dialog = createDialog('文件已被其他程序修改', dirty
    ? `“${name}”在磁盘上已变化，当前标签也有未保存的修改。重新加载会放弃本标签的修改；保留当前内容后可以另存为或创建临时副本。`
    : `“${name}”在磁盘上已变化，是否重新加载最新内容？`)
  return new Promise(resolve => {
    const finish = (reload: boolean) => { dialog.close(); dialog.remove(); resolve(reload) }
    const actions = document.createElement('div')
    actions.className = 'dialog-actions'
    const keep = document.createElement('button')
    keep.textContent = '保留当前内容'
    keep.onclick = () => finish(false)
    const reload = document.createElement('button')
    reload.className = 'primary'
    reload.textContent = '重新加载'
    reload.onclick = () => finish(true)
    actions.append(keep, reload)
    dialog.append(actions)
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false) })
    dialog.showModal()
    keep.focus()
  })
}

export function editText(title: string, description: string, value: string, multiline: boolean | 'block' = false): Promise<string | null> {
  const dialog = createDialog(title, description)
  const input = multiline ? document.createElement('textarea') : document.createElement('input')
  input.value = value
  input.setAttribute('aria-label', title)
  input.spellcheck = false
  if (multiline) dialog.classList.add(multiline === 'block' ? 'block-edit-dialog' : 'fragment-dialog')
  const actions = document.createElement('div')
  actions.className = 'dialog-actions'
  return new Promise(resolve => {
    const finish = (value: string | null) => { dialog.close(); dialog.remove(); resolve(value) }
    const cancel = document.createElement('button')
    cancel.textContent = '取消'
    cancel.onclick = () => finish(null)
    const save = document.createElement('button')
    save.className = 'primary'
    save.textContent = multiline === 'block' ? '应用修改' : '确定'
    save.onclick = () => finish(input.value)
    actions.append(cancel, save)
    dialog.append(input, actions)
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null) })
    input.addEventListener('keydown', event => {
      const key = event as KeyboardEvent
      if (key.isComposing) return
      if (key.key === 'Enter' && (!multiline || key.ctrlKey || key.metaKey)) {
        event.preventDefault()
        finish(input.value)
      }
    })
    dialog.showModal()
    input.focus()
    if (!multiline) input.select()
    else if (multiline === 'block') {
      input.setSelectionRange(0, 0)
      input.scrollTop = 0
    }
  })
}
