import 'katex/dist/katex.min.css'
import 'highlight.js/styles/github.css'
import './style.css'
import { layout } from './layout'
import type { WrapMode } from './source-editor'
import { DocumentTab, initialView, type ViewState } from './document-tab'
import { DraftWriter } from './drafts'
import { ReadingTools } from './reading-tools'
import { confirmReload, confirmUnsaved, editText } from './dialogs'
import { friendlyError, invoke, isDesktop, listen, type OpenedDocument } from './desktop'
import { openNotes } from './notes-manager'
import { openWindowColors, restoreWindowColors } from './window-colors'
import { openFileAssociation } from './file-association'
import { openFontSettings, restoreFontSettings } from './font-settings'
import { chooseEncoding, installTabMenu } from './tab-menu'
import { writeClipboard } from './block-copy'

restoreWindowColors()
restoreFontSettings()
document.querySelector<HTMLDivElement>('#app')!.innerHTML = layout
const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const tabs: DocumentTab[] = []
let activeId = ''
let busy = true
let pendingRequested = false
let checkRequested = false
let lastCheck = 0
let lastWindowTitle = ''
let draftFailed = false
let toastTimer: ReturnType<typeof setTimeout> | undefined
const wrapKey = 'moye-wrap-mode'
let defaultWrap: WrapMode = 'window'
try {
  const stored = localStorage.getItem(wrapKey)
  if (stored === 'none' || stored === 'window' || stored === 'page') defaultWrap = stored
} catch (error) { console.error('Wrap preference could not be read:', error) }

const current = () => tabs.find(tab => tab.id === activeId)!
const readingTools = new ReadingTools(current, () => !busy && !document.querySelector('dialog:modal'))

function toast(message: string) {
  clearTimeout(toastTimer)
  get('toast').textContent = message
  get('toast').hidden = false
  toastTimer = setTimeout(() => { get('toast').hidden = true }, 6000)
}

function showError(error: unknown) {
  console.error('Document operation failed:', error)
  toast(friendlyError(error))
}

const drafts = new DraftWriter(() => ({
  activeId,
  tabs: tabs.map(tab => {
    tab.flush()
    return { id: tab.id, content: tab.path ? null : tab.content, view: tab.captureView() }
  }),
}), snapshot => {
  draftFailed = false
  for (const saved of snapshot.tabs) {
    const tab = tabs.find(tab => tab.id === saved.id)
    if (tab && !tab.path) tab.draftContent = saved.content
  }
  updateStatus()
}, error => {
  draftFailed = true
  updateStatus()
  showError(error)
})

function renderTabs() {
  const strip = get('tab-strip')
  for (const item of Array.from(strip.children) as HTMLElement[]) {
    if (!tabs.some(tab => tab.id === item.dataset.id)) item.remove()
  }
  for (const tab of tabs) {
    let item = Array.from(strip.children).find(item => (item as HTMLElement).dataset.id === tab.id) as HTMLElement | undefined
    if (!item) {
      item = document.createElement('div')
      item.className = 'tab-item'
      item.dataset.id = tab.id
      const button = document.createElement('button')
      button.className = 'tab-select'
      button.dataset.tab = tab.id
      button.setAttribute('role', 'tab')
      button.setAttribute('aria-controls', `panel-${tab.id}`)
      const label = document.createElement('span')
      label.className = 'tab-label'
      const dot = document.createElement('span')
      dot.className = 'tab-dirty'
      dot.textContent = '●'
      button.append(label, dot)
      const close = document.createElement('button')
      close.className = 'tab-close'
      close.dataset.closeTab = tab.id
      close.textContent = '×'
      close.tabIndex = -1
      item.append(button, close)
      strip.append(item)
    }
    item.classList.toggle('active', tab.id === activeId)
    item.querySelector('.tab-label')!.textContent = tab.name
    const button = item.querySelector<HTMLButtonElement>('.tab-select')!
    button.title = tab.path ?? `${tab.name} · 临时文档`
    button.setAttribute('aria-selected', String(tab.id === activeId))
    button.tabIndex = tab.id === activeId ? 0 : -1
    button.disabled = busy
    const close = item.querySelector<HTMLButtonElement>('.tab-close')!
    close.setAttribute('aria-label', `关闭 ${tab.name}`)
    close.disabled = busy
    const dot = item.querySelector<HTMLElement>('.tab-dirty')!
    dot.hidden = !tab.dirty
  }
}

function updateStatus() {
  const tab = current()
  if (!tab) return
  readingTools.update(tab)
  renderTabs()
  get('filename').textContent = tab.name
  get('filename').title = tab.path ?? tab.name
  get('dirty-dot').hidden = !tab.dirty
  get('save-status').textContent = tab.path ? (tab.dirty ? '有未保存的修改' : '已保存到本地')
    : draftFailed || !drafts.ready ? '临时保存不可用，请保存为文件'
    : tab.draftContent === tab.content ? '已自动暂存' : '等待临时保存'
  get('word-count').textContent = `${tab.content.replace(/\s/g, '').length.toLocaleString()} 字`
  get('line-count').textContent = `${tab.content.split('\n').length.toLocaleString()} 行`
  get('encoding').textContent = `${tab.encoding} · ${tab.lineEnding}`
  get('mode-label').textContent = tab.view.mode === 'preview' ? '点击文字即可编辑' : 'Markdown 源码'
  document.querySelectorAll<HTMLButtonElement>('button[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === tab.view.mode)))
  document.querySelectorAll<HTMLButtonElement>('button[data-wrap]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.wrap === tab.view.wrap)))
  document.title = `${tab.dirty ? '● ' : ''}${tab.name} — 墨页`
  if (isDesktop && lastWindowTitle !== document.title) {
    lastWindowTitle = document.title
    void invoke('set_document_title', { title: document.title }).catch(showError)
  }
}

function changed(tab: DocumentTab) {
  updateStatus()
  if (!tab.path) drafts.schedule()
}

function selectTab(id: string) {
  if (activeId === id || !tabs.some(tab => tab.id === id)) return
  current()?.deactivate()
  activeId = id
  current().activate(get('workspace'))
  updateStatus()
  get('tab-strip').querySelector<HTMLElement>(`[data-tab="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  drafts.schedule()
}

function addTab(document: OpenedDocument, view = initialView(defaultWrap), restored = false, activate = true) {
  if (!tabs.some(tab => tab.id === document.id)) {
    const tab = new DocumentTab(document, view, changed, showError)
    if (restored && !tab.path) tab.draftContent = tab.content
    tabs.push(tab)
  }
  if (activate) selectTab(document.id)
}

async function newTab(content = '', name?: string) {
  if (!name) {
    let number = 1
    while (tabs.some(tab => tab.name === `未命名 ${number}.md`)) number++
    name = `未命名 ${number}.md`
  }
  const document = await invoke<OpenedDocument>('new_document', { documentId: crypto.randomUUID(), name })
  document.content = content
  addTab(document)
  drafts.schedule()
}

async function save(saveAs = false, encoding?: string): Promise<boolean> {
  const tab = current()
  const snapshot = tab.flush()
  const result = await invoke<OpenedDocument | null>('save_document', { documentId: tab.id, content: snapshot, saveAs, encoding })
  if (!result) return false
  tab.markSaved(result)
  updateStatus()
  if (drafts.ready) await drafts.flush()
  toast('文档已保存')
  return true
}

async function temporarySave() {
  const tab = current()
  tab.flush()
  if (tab.path) await newTab(tab.content, `${tab.name.replace(/\.[^.]+$/, '')}（临时副本）.md`)
  await drafts.flush()
  toast(tab.path ? '已创建独立临时副本，原文件未保存' : '临时文档已保存，下次打开会自动恢复')
}

async function closeTab(id: string) {
  const tab = tabs.find(tab => tab.id === id)
  if (!tab) return
  selectTab(id)
  tab.flush()
  if (tab.dirty) {
    const answer = await confirmUnsaved(tab.name, !tab.path)
    if (answer === 'cancel' || answer === 'save' && !await save()) return
  }
  const index = tabs.indexOf(tab)
  tab.deactivate()
  tabs.splice(index, 1)
  activeId = ''
  if (tabs.length) selectTab(tabs[Math.min(index, tabs.length - 1)]!.id)
  else await newTab()
  try { if (drafts.ready) await drafts.flush() }
  catch (error) { tabs.splice(index, 0, tab); selectTab(tab.id); throw error }
  await invoke('close_document', { documentId: id })
  tab.destroy()
  renderTabs()
}

async function closeWindow() {
  const previousId = activeId
  for (const tab of tabs) tab.flush()
  for (const tab of tabs) {
    if (!tab.dirty || (!tab.path && drafts.ready)) continue
    selectTab(tab.id)
    const answer = await confirmUnsaved(tab.name)
    if (answer === 'cancel' || answer === 'save' && !await save()) return
  }
  selectTab(previousId)
  if (drafts.ready) await drafts.flush()
  await invoke('close_window')
}

function setBusy(value: boolean) {
  busy = value
  get('workspace').inert = value
  document.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('nav button, nav select, .tab-bar button').forEach(button => { button.disabled = value })
}

async function task(action: () => Promise<void>) {
  if (busy || document.querySelector('dialog:modal')) return
  setBusy(true)
  drafts.suspend(true)
  try {
    await drafts.idle().catch(showError)
    await action()
  } catch (error) { showError(error) }
  finally {
    setBusy(false)
    drafts.suspend(false)
    if (pendingRequested) { pendingRequested = false; void task(openPending) }
    else if (checkRequested) { checkRequested = false; requestFileCheck() }
  }
}

async function checkActiveFile(force = false) {
  const tab = current()
  if (!tab?.path || (!force && Date.now() - lastCheck < 1000)) return
  lastCheck = Date.now()
  tab.flush()
  const status = await invoke<'unchanged' | 'changed' | 'missing'>('check_document', { documentId: tab.id })
  if (status === 'missing') { toast('此文件已移动或删除，当前内容仍保留，可以另存为。'); return }
  if (status !== 'changed' || !await confirmReload(tab.name, tab.dirty)) return
  const document = await invoke<OpenedDocument>('reload_document', { documentId: tab.id })
  tab.reload(document)
  updateStatus()
  drafts.schedule()
  toast('已重新加载磁盘上的最新内容')
}

function requestFileCheck() {
  if (busy) { checkRequested = true; return }
  if (!document.querySelector('dialog:modal')) void task(() => checkActiveFile())
}

async function openPending() {
  while (await invoke<boolean>('has_pending_file')) {
    try {
      const document = await invoke<OpenedDocument | null>('open_pending_file', { documentId: crypto.randomUUID() })
      if (document) { addTab(document); await checkActiveFile(true) }
    } catch (error) { showError(error) }
  }
}

async function insertLink() {
  const tab = current()
  const url = await editText('插入链接', '输入网址、邮件地址或文档中的相对路径。', 'https://')
  if (url === null) return
  const value = url.trim()
  if (!value || /^(?!https?:|mailto:)[a-z][a-z\d+.-]*:/i.test(value) || /[\r\n<>]/.test(value)) { toast('请输入有效的网址或相对路径。'); return }
  if (tab.view.mode === 'source') tab.source.insert('[', `](<${value}>)`, '链接文字')
  else tab.preview.command('createLink', value)
}

const snippets: Record<string, [string, string, string]> = {
  bold: ['**', '**', '加粗文字'], italic: ['*', '*', '斜体文字'], strike: ['~~', '~~', '删除线文字'],
  quote: ['> ', '', '引用文字'], list: ['- ', '', '列表内容'], 'ordered-list': ['1. ', '', '列表内容'],
  task: ['- [ ] ', '', '待办事项'], code: ['\n```\n', '\n```\n', '代码'],
  table: ['\n', '\n', '| 列一 | 列二 |\n| --- | --- |\n| 内容 | 内容 |'],
}
const commands: Record<string, string> = { bold: 'bold', italic: 'italic', strike: 'strikeThrough', list: 'insertUnorderedList', 'ordered-list': 'insertOrderedList' }

function action(name: string) {
  if (busy || !current() || document.querySelector('dialog:modal')) return
  const tab = current()
  if (name === 'notes') { void openNotes().catch(showError); return }
  if (name === 'window-colors') { openWindowColors(); return }
  if (name === 'font-settings') { openFontSettings(); return }
  if (name === 'associate') { openFileAssociation(); return }
  const snippet = snippets[name]
  if (snippet) {
    if (tab.view.mode === 'source') tab.source.insert(...snippet)
    else if (commands[name]) tab.preview.command(commands[name])
    else if (name === 'quote') tab.preview.command('formatBlock', 'blockquote')
    else tab.preview.insertMarkdown(snippet[0] + snippet[2] + snippet[1])
    return
  }
  if (name === 'undo' || name === 'redo') {
    if (tab.view.mode === 'source') tab.source[name]()
    else tab.preview.command(name)
    return
  }
  if (name === 'search' || name === 'replace') {
    const selectedText = tab.selectedText()
    tab.search.open(name === 'replace', selectedText)
    return
  }
  if (name === 'clear-highlights') { tab.search.clear(); return }
  if (name === 'link') { void insertLink().catch(showError); return }
  void task(async () => {
    switch (name) {
      case 'new': await newTab(); break
      case 'open': {
        const document = await invoke<OpenedDocument | null>('open_document', { documentId: crypto.randomUUID() })
        if (document) { addTab(document); await checkActiveFile(true) }
        break
      }
      case 'save': await save(); break
      case 'save-as': await save(true); break
      case 'temporary-save': await temporarySave(); break
      case 'close-tab': await closeTab(tab.id); break
      case 'image': {
        const result = await invoke<{ name: string; data: string } | null>('pick_image')
        if (result) {
          get('workspace').inert = false
          const markdown = `![${result.name.replace(/[\[\]\\]/g, '')}](${result.data})`
          if (tab.view.mode === 'source') tab.source.replaceSelection(markdown)
          else tab.preview.insertMarkdown(markdown)
        }
        break
      }
    }
  })
}

document.addEventListener('mousedown', event => {
  if ((event.target as HTMLElement).closest('.format-toolbar button')) event.preventDefault()
})
document.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button')
  if (!button || busy) return
  if (button.dataset.tab) { void task(async () => { selectTab(button.dataset.tab!); await checkActiveFile(true) }); return }
  if (button.dataset.closeTab) { void task(() => closeTab(button.dataset.closeTab!)); return }
  if (button.dataset.action) action(button.dataset.action)
  const tab = current()
  if (!tab) return
  try {
    if (button.dataset.mode) tab.setMode(button.dataset.mode as ViewState['mode'])
    if (button.dataset.wrap) {
      defaultWrap = button.dataset.wrap as WrapMode
      tab.setWrapping(defaultWrap)
      localStorage.setItem(wrapKey, defaultWrap)
    }
    if (button.dataset.mode || button.dataset.wrap) { updateStatus(); drafts.schedule() }
  } catch (error) { showError(error) }
})
document.addEventListener('auxclick', event => {
  const tab = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-tab]')
  if (event.button === 1 && tab) { event.preventDefault(); void task(() => closeTab(tab.dataset.tab!)) }
})
installTabMenu(get('tab-strip'), () => !busy && !document.querySelector('dialog:modal'), id => Boolean(tabs.find(tab => tab.id === id)?.path), (id, action) => {
  void task(async () => {
    selectTab(id)
    const tab = current()
    if (action === 'save') { await save(); return }
    if (action === 'copy-path') {
      const path = tab.path!.replace(/^\\\\\?\\UNC\\/, '\\\\').replace(/^\\\\\?\\/, '')
      await writeClipboard(path); toast('文件路径已复制'); return
    }
    if (action === 'reveal') { await invoke('reveal_document', { documentId: id }); return }
    const encoding = action === 'reload' ? undefined : await chooseEncoding(tab.encoding, action === 'read-encoding')
    if (encoding === null) return
    if (action === 'save-encoding') { await save(false, encoding); return }
    tab.flush()
    if (tab.dirty) {
      const answer = await confirmUnsaved(tab.name)
      if (answer === 'cancel' || answer === 'save' && !await save()) return
    }
    const result = await invoke<OpenedDocument>('reload_document', { documentId: id, encoding })
    tab.reload(result)
    updateStatus(); drafts.schedule(); toast('已重新载入文档')
  })
})
get<HTMLSelectElement>('heading').addEventListener('change', event => {
  const select = event.target as HTMLSelectElement
  const tab = current()
  if (tab.view.mode === 'preview') tab.preview.command('formatBlock', select.value)
  else tab.source.insert(select.value === 'p' ? '' : '#'.repeat(Number(select.value.slice(1))) + ' ', '', '标题')
  select.value = 'p'
})
document.addEventListener('keydown', event => {
  if (event.key !== 'F3') return
  event.preventDefault(); event.stopImmediatePropagation()
  if (!event.isComposing && !busy && current() && !document.querySelector('dialog:modal')) current().search.next(event.shiftKey)
}, true)
document.addEventListener('keydown', event => {
  if (event.isComposing || busy || !current() || !(event.ctrlKey || event.metaKey)) return
  const key = event.key.toLowerCase()
  if (key !== 'f' && key !== 'h') return
  if (document.querySelector('dialog:modal')) return
  event.preventDefault()
  event.stopPropagation()
  action(key === 'h' ? 'replace' : 'search')
}, true)

document.addEventListener('keydown', event => {
  if (event.isComposing || busy || !current() || document.querySelector('dialog:modal')) return
  if (event.key === 'Escape') { current().search.close(); return }
  if ((event.target as HTMLElement).closest('.find-dialog')) return
  const tabNavigation = (event.target as HTMLElement).matches('[role="tab"]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
  const key = event.key.toLowerCase()
  if (tabNavigation || (event.ctrlKey && key === 'tab')) {
    event.preventDefault()
    const index = tabs.indexOf(current())
    const next = key === 'home' ? 0 : key === 'end' ? tabs.length - 1 : (index + (key === 'arrowleft' || event.shiftKey ? -1 : 1) + tabs.length) % tabs.length
    void task(async () => { selectTab(tabs[next]!.id); await checkActiveFile(true) })
    return
  }
  if (!(event.ctrlKey || event.metaKey)) return
  const shortcuts: Record<string, string> = { n: 'new', t: 'new', o: 'open', w: 'close-tab', s: event.altKey ? 'temporary-save' : event.shiftKey ? 'save-as' : 'save', b: 'bold', i: 'italic', k: 'link' }
  if (key === '/' || (key === 'm' && event.shiftKey)) {
    event.preventDefault()
    try { current().setMode(current().view.mode === 'source' ? 'preview' : 'source'); updateStatus(); drafts.schedule() }
    catch (error) { showError(error) }
  } else if (shortcuts[key]) { event.preventDefault(); action(shortcuts[key]) }
})
window.addEventListener('focus', requestFileCheck)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') requestFileCheck()
  else drafts.schedule()
})

async function start() {
  setBusy(true)
  drafts.suspend(true)
  try {
    try {
      const restored = await invoke<{ activeId: string; tabs: { document: OpenedDocument; view: ViewState }[]; warnings: string[] }>('load_workspace')
      for (const tab of restored.tabs) addTab(tab.document, { ...tab.view, mode: 'preview' }, true, false)
      const initial = tabs.find(tab => tab.id === restored.activeId) ?? tabs[0]
      if (initial) selectTab(initial.id)
      drafts.ready = true
      if (restored.warnings.length) toast(restored.warnings.join('\n'))
    } catch (error) { showError(error); draftFailed = true }
    let legacy: string | null = null
    try { legacy = localStorage.getItem('moye-recovery-v1') }
    catch (error) { console.error('Legacy draft could not be read:', error) }
    if (legacy) {
      try {
        const parsed: unknown = JSON.parse(legacy)
        if (parsed && typeof parsed === 'object' && 'content' in parsed && typeof parsed.content === 'string') {
          await newTab(parsed.content, '恢复的草稿.md')
          if (drafts.ready) { await drafts.flush(); localStorage.removeItem('moye-recovery-v1') }
        }
      } catch (error) { showError(error) }
    }
    await listen('files-pending', () => {
      if (busy) pendingRequested = true
      else void task(openPending)
    })
    await listen('close-requested', () => { void task(closeWindow) })
    if (isDesktop) await invoke('notes_restore').catch(showError)
    await openPending()
    if (!tabs.length) await newTab()
    updateStatus()
    drafts.schedule()
  } finally {
    setBusy(false)
    drafts.suspend(false)
    if (pendingRequested) { pendingRequested = false; void task(openPending) }
  }
}

void start().catch(showError)
