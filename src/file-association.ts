import { friendlyError, invoke } from './desktop'

export function openFileAssociation() {
  const dialog = document.createElement('dialog')
  dialog.className = 'dialog'
  dialog.setAttribute('aria-label', '关联 Markdown 文档')
  dialog.innerHTML = `<h2>关联 Markdown 文档</h2><p>将当前 EXE 注册为 Markdown 打开程序，然后在 Windows 默认应用设置中将 .md 等文档选择为“墨页”。关联后请保持程序文件的位置不变。</p>
    <p class="association-status" role="status" hidden></p><div class="dialog-actions"><button class="association-close">关闭</button><button class="primary association-register">注册并打开默认应用设置</button></div>`
  const status = dialog.querySelector<HTMLParagraphElement>('.association-status')!
  const button = dialog.querySelector<HTMLButtonElement>('.association-register')!
  button.onclick = async () => {
    if (button.disabled) return
    button.disabled = true
    status.hidden = false
    status.textContent = '正在注册…'
    try {
      await invoke('register_file_association')
      status.textContent = '已注册。请在 Windows 设置中找到“墨页”，将 .md 等扩展名设为默认。'
    } catch (error) { status.textContent = friendlyError(error) }
    finally { button.disabled = false }
  }
  const finish = () => { if (!button.disabled) { dialog.close(); dialog.remove() } }
  dialog.querySelector('.association-close')!.addEventListener('click', finish)
  dialog.addEventListener('cancel', event => { event.preventDefault(); finish() })
  document.body.append(dialog)
  dialog.showModal()
}
