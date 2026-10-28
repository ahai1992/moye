import './window-colors.css'

const storageKey = 'moye-window-colors'
const valid = (value: unknown): value is string => typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value)
let colors = { background: '#ffffff', foreground: '#293448' }

function paint() {
  const root = document.documentElement
  root.classList.add('custom-colors')
  root.style.setProperty('--window-bg', colors.background)
  root.style.setProperty('--window-ink', colors.foreground)
  root.style.setProperty('--paper', colors.background)
  root.style.setProperty('--accent', colors.foreground)
  root.style.setProperty('--muted', colors.foreground)
  root.style.setProperty('--line', `color-mix(in srgb, ${colors.foreground} 22%, ${colors.background})`)
  root.style.colorScheme = Number.parseInt(colors.background.slice(1, 3), 16)
    + Number.parseInt(colors.background.slice(3, 5), 16) + Number.parseInt(colors.background.slice(5, 7), 16) < 384 ? 'dark' : 'light'
}

export function restoreWindowColors() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    if (saved && valid(saved.background) && valid(saved.foreground)) { colors = saved; paint() }
  } catch (error) { console.error('Window color preference could not be read:', error) }
}

export function openWindowColors() {
  const dialog = document.createElement('dialog')
  dialog.className = 'dialog window-colors-dialog'
  dialog.setAttribute('aria-label', '窗口配色')
  dialog.innerHTML = `<h2>窗口配色</h2><p>统一设置整个主窗口，包括正文、工具栏、标签栏、目录和状态栏。颜色会自动记住。</p>
    <label>背景色<input type="color" name="background" aria-label="窗口背景色"></label>
    <label>文字颜色<input type="color" name="foreground" aria-label="窗口文字颜色"></label>
    <p class="color-error" role="alert" hidden></p>
    <div class="dialog-actions"><button class="color-reset">恢复默认</button><button class="color-done primary">完成</button></div>`
  const error = dialog.querySelector<HTMLParagraphElement>('.color-error')!
  dialog.querySelectorAll<HTMLInputElement>('input').forEach(input => {
    const key = input.name as keyof typeof colors
    input.value = colors[key]
    input.addEventListener('input', () => {
      colors[key] = input.value
      paint()
      try { localStorage.setItem(storageKey, JSON.stringify(colors)); error.hidden = true }
      catch (value) { console.error('Window colors save failed:', value); error.textContent = '当前配色已生效，但未能记住，请检查应用存储空间。'; error.hidden = false }
    })
  })
  dialog.querySelector('.color-reset')!.addEventListener('click', () => {
    try { localStorage.removeItem(storageKey) }
    catch (value) { console.error('Window colors reset failed:', value); error.textContent = '恢复默认设置未能保存，请重试。'; error.hidden = false; return }
    document.documentElement.classList.remove('custom-colors')
    for (const name of ['--window-bg', '--window-ink', '--paper', '--accent', '--muted', '--line']) document.documentElement.style.removeProperty(name)
    document.documentElement.style.removeProperty('color-scheme')
    colors = { background: '#ffffff', foreground: '#293448' }
    dialog.querySelectorAll<HTMLInputElement>('input').forEach(input => { input.value = colors[input.name as keyof typeof colors] })
  })
  const finish = () => { dialog.close(); dialog.remove() }
  dialog.querySelector('.color-done')!.addEventListener('click', finish)
  dialog.addEventListener('cancel', event => { event.preventDefault(); finish() })
  document.body.append(dialog)
  dialog.showModal()
}
