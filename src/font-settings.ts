import { invoke } from './desktop'

const storageKey = 'moye-font-settings'
const textFallback = '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
const codeFallback = '"Cascadia Code", Consolas, monospace'
interface FontSettings { text: string; code: string }
let settings: FontSettings = { text: '', code: '' }

function validFont(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 100 && !/[\u0000-\u001f\u007f]/.test(value)
}

function family(name: string, fallback: string) {
  const escaped = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return name ? `"${escaped}", ${fallback}` : fallback
}

function paint() {
  document.documentElement.style.setProperty('--app-text-font', family(settings.text, textFallback))
  document.documentElement.style.setProperty('--app-code-font', family(settings.code, codeFallback))
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    if (saved === null) settings = { text: '', code: '' }
    else if (validFont(saved.text) && validFont(saved.code)) settings = { text: saved.text, code: saved.code }
    else throw new Error('Invalid font preferences')
    paint()
  } catch (error) { console.error('Font preferences could not be read:', error) }
}

export function restoreFontSettings() {
  restore()
  window.addEventListener('storage', event => {
    if (event.storageArea === localStorage && (event.key === storageKey || event.key === null)) restore()
  })
}

export function openFontSettings() {
  const dialog = document.createElement('dialog')
  dialog.className = 'dialog font-settings-dialog'
  dialog.setAttribute('aria-label', '软件字体')
  dialog.innerHTML = `<form>
    <h2>软件字体</h2>
    <p>从当前电脑已安装的字体中选择。所有文档统一使用，重启后保留，不修改 Markdown；字体卸载后会自动回退。</p>
    <div class="font-loading"><span role="status" aria-live="polite">正在读取本机字体…</span><button type="button" class="font-retry" hidden>重新读取</button></div>
    <label for="text-font">文本字体</label>
    <select id="text-font" name="text" aria-label="文本字体"></select>
    <div class="font-sample text-font-sample">墨页 · 中文字体预览 AaBb 012345</div>
    <label for="code-font">代码字体（含源码、行内代码）</label>
    <select id="code-font" name="code" aria-label="代码字体"></select>
    <div class="font-sample code-font-sample">const message = "你好，墨页";<br>0123456789 () {} [] =&gt;</div>
    <p class="font-error" role="alert" hidden></p>
    <div class="dialog-actions"><button type="button" class="font-reset">恢复默认</button><button type="button" class="font-cancel">取消</button><button type="submit" class="primary">保存</button></div>
  </form>`
  const text = dialog.querySelector<HTMLSelectElement>('#text-font')!
  const code = dialog.querySelector<HTMLSelectElement>('#code-font')!
  const error = dialog.querySelector<HTMLParagraphElement>('.font-error')!
  const status = dialog.querySelector<HTMLElement>('[role="status"]')!
  const retry = dialog.querySelector<HTMLButtonElement>('.font-retry')!
  const fill = (select: HTMLSelectElement, names: string[], value: string) => {
    const options = [new Option('使用默认字体', '')]
    if (value && !names.includes(value)) options.push(new Option(`${value}（未在列表中）`, value))
    options.push(...names.map(name => new Option(name, name)))
    select.replaceChildren(...options)
    select.value = value
  }
  const preview = () => {
    if (validFont(text.value)) dialog.querySelector<HTMLElement>('.text-font-sample')!.style.fontFamily = family(text.value.trim(), textFallback)
    if (validFont(code.value)) dialog.querySelector<HTMLElement>('.code-font-sample')!.style.fontFamily = family(code.value.trim(), codeFallback)
  }
  const finish = () => { dialog.close(); dialog.remove() }
  const save = (next: FontSettings, reset = false) => {
    try {
      if (reset) localStorage.removeItem(storageKey)
      else localStorage.setItem(storageKey, JSON.stringify(next))
      settings = next
      paint()
      finish()
    } catch (value) {
      console.error('Font preferences save failed:', value)
      error.textContent = '字体设置未能保存，请检查应用存储空间后重试。'
      error.hidden = false
    }
  }
  fill(text, [], settings.text)
  fill(code, [], settings.code)
  preview()
  text.addEventListener('change', preview)
  code.addEventListener('change', preview)
  let loading = false
  const loadFonts = async () => {
    if (loading) return
    loading = true
    retry.hidden = true
    status.textContent = '正在读取本机字体…'
    text.disabled = code.disabled = true
    try {
      const names = Array.from(new Set((await invoke<string[]>('installed_fonts')).filter(validFont)))
        .sort((a, b) => a.localeCompare(b, 'zh-CN'))
      if (!names.length) throw new Error('No installed font families returned')
      if (!dialog.isConnected) return
      fill(text, names, text.value)
      fill(code, names, code.value)
      status.textContent = `已读取 ${names.length} 种本机字体`
    } catch (value) {
      console.error('Installed fonts could not be read:', value)
      if (!dialog.isConnected) return
      status.textContent = '读取本机字体失败，请点击「重新读取」。'
      retry.hidden = false
    } finally {
      loading = false
      text.disabled = code.disabled = false
    }
  }
  retry.addEventListener('click', () => { void loadFonts() })
  dialog.querySelector('form')!.addEventListener('submit', event => {
    event.preventDefault()
    if (!validFont(text.value) || !validFont(code.value)) {
      error.textContent = '字体名称无法识别，请重新选择字体。'
      error.hidden = false
      return
    }
    save({ text: text.value.trim(), code: code.value.trim() })
  })
  dialog.querySelector('.font-reset')!.addEventListener('click', () => save({ text: '', code: '' }, true))
  dialog.querySelector('.font-cancel')!.addEventListener('click', finish)
  dialog.addEventListener('cancel', event => { event.preventDefault(); finish() })
  document.body.append(dialog)
  dialog.showModal()
  void loadFonts()
}
