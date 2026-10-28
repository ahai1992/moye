export function confirmDeleteNote(content: string): Promise<boolean> {
  const dialog = document.createElement('dialog')
  dialog.className = 'dialog note-delete-dialog'
  dialog.setAttribute('aria-label', '删除便签')
  const title = document.createElement('h2')
  title.textContent = '删除这张便签？'
  const description = document.createElement('p')
  const name = content.trim().split(/\r?\n/)[0]?.slice(0, 50) || '空白便签'
  description.textContent = `“${name}”将从便签列表移除，窗口也会关闭。此操作无法撤销。`
  const actions = document.createElement('div')
  actions.className = 'dialog-actions'
  const cancel = document.createElement('button')
  cancel.textContent = '取消'
  const remove = document.createElement('button')
  remove.className = 'danger'
  remove.textContent = '删除便签'
  actions.append(cancel, remove)
  dialog.append(title, description, actions)
  document.body.append(dialog)
  return new Promise(resolve => {
    const finish = (value: boolean) => { dialog.close(); dialog.remove(); resolve(value) }
    cancel.onclick = () => finish(false)
    remove.onclick = () => finish(true)
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false) })
    dialog.showModal()
    cancel.focus()
  })
}
