import { friendlyError, invoke, listen } from './desktop'
import { confirmDeleteNote } from './note-delete-dialog'

interface NoteSummary { id: string; content: string; background: string; visible: boolean; pinned: boolean }

export async function openNotes() {
  const dialog = document.createElement('dialog')
  dialog.className = 'dialog notes-dialog'
  dialog.setAttribute('aria-label', '便签')
  dialog.innerHTML = `<h2>便签</h2><p>独立窗口随墨页启动和退出。收起后内容仍会保留。</p>
    <div class="notes-list"></div><p class="notes-error" role="alert" hidden></p>
    <div class="dialog-actions"><button class="notes-done">完成</button><button class="primary notes-new">＋ 新建便签</button></div>`
  document.body.append(dialog)
  const list = dialog.querySelector<HTMLDivElement>('.notes-list')!
  const error = dialog.querySelector<HTMLParagraphElement>('.notes-error')!
  const create = dialog.querySelector<HTMLButtonElement>('.notes-new')!
  const fail = (value: unknown) => { error.textContent = friendlyError(value); error.hidden = false }
  const refresh = async () => {
    const notes = await invoke<NoteSummary[]>('notes_list')
    list.replaceChildren()
    if (!notes.length) { list.textContent = '还没有便签，点击下方新建。'; return }
    for (const note of notes) {
      const row = document.createElement('div')
      row.className = 'note-list-row'
      const button = document.createElement('button')
      button.className = 'note-list-item'
      button.style.setProperty('--paper', note.background)
      const title = document.createElement('span')
      title.textContent = note.content.trim().split(/\r?\n/)[0]?.slice(0, 100) || '空白便签'
      const detail = document.createElement('small')
      detail.textContent = `${note.visible ? '显示中' : '已收起'}${note.pinned ? ' · 置顶' : ''} · 点击打开`
      button.append(title, detail)
      button.onclick = async () => {
        if (button.disabled) return
        button.disabled = true
        try { await invoke('notes_show', { id: note.id }); await refresh() }
        catch (value) { fail(value); button.disabled = false }
      }
      const remove = document.createElement('button')
      remove.className = 'note-list-delete'
      remove.textContent = '删除'
      remove.title = '删除这张便签'
      remove.onclick = async () => {
        if (remove.disabled) return
        remove.disabled = button.disabled = true
        try {
          if (!await confirmDeleteNote(note.content)) return
          await invoke('notes_delete', { id: note.id })
          localStorage.removeItem(`moye-note-${note.id}`)
          await refresh()
        } catch (value) { fail(value) }
        finally { remove.disabled = button.disabled = false }
      }
      row.append(button, remove)
      list.append(row)
    }
  }
  create.onclick = async () => {
    if (create.disabled) return
    create.disabled = true
    try { await invoke('notes_create', { id: crypto.randomUUID() }); await refresh() }
    catch (value) { fail(value) }
    finally { create.disabled = false }
  }
  let unlisten: (() => void) | undefined
  const finish = () => { unlisten?.(); dialog.close(); dialog.remove() }
  dialog.querySelector('.notes-done')!.addEventListener('click', finish)
  dialog.addEventListener('cancel', event => { event.preventDefault(); finish() })
  dialog.showModal()
  try {
    unlisten = await listen('notes-changed', () => { if (dialog.isConnected) void refresh().catch(fail) })
    if (!dialog.isConnected) { unlisten(); return }
    await refresh()
  } catch (value) { fail(value) }
}
