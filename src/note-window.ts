import './note.css'
import { friendlyError, invoke, listen } from './desktop'
import { cleanNoteHtml } from './note-content'
import { highlightWords, migrateNoteHighlights, renderNoteHighlights, supportsNoteHighlights } from './note-highlights'
import { confirmDeleteNote } from './note-delete-dialog'

interface Note {
  id: string; content: string; background: string; foreground: string
  pinned: boolean; updated: number; richContent?: string; highlightWords: string[]
}

document.querySelector('#note-app')!.innerHTML = `
  <header class="note-toolbar">
    <button id="new-note" title="新建便签" aria-label="新建便签">＋</button>
    <button id="pin-note" title="开启或关闭置顶" aria-label="置顶" aria-pressed="false">钉</button>
    <button id="highlight-note" title="选中文字后点击：所有相同文字持续高亮；再次选中同一关键词点击可取消" aria-label="设置或取消关键词高亮" aria-pressed="false">亮</button>
    <label class="color-control" title="便签纸颜色"><span>纸</span><input id="paper-color" type="color" aria-label="便签纸颜色" value="#fff1ad"></label>
    <label class="color-control" title="文字颜色"><span>字</span><input id="text-color" type="color" aria-label="文字颜色" value="#493f29"></label>
    <div id="note-drag" title="拖动便签位置；双击回到编辑">⠿</div>
    <button id="delete-note" title="删除便签" aria-label="删除便签">删</button>
    <button id="hide-note" title="收起便签，内容会保留；从主窗口“便签”重新打开" aria-label="收起便签">×</button>
  </header>
  <div id="note-content" role="textbox" aria-label="便签内容" aria-multiline="true" data-placeholder="写点什么…" spellcheck="false" contenteditable="false"></div>
  <footer><button id="note-status" title="点击立即保存">正在读取…</button><time id="note-time"></time></footer>
  <div id="note-error" role="alert" hidden></div>
  ${['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map(direction => `<div class="resize-edge edge-${direction}" data-resize="${direction}"></div>`).join('')}
`
const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const input = get<HTMLDivElement>('note-content')
const paper = get<HTMLInputElement>('paper-color')
const ink = get<HTMLInputElement>('text-color')
const pin = get<HTMLButtonElement>('pin-note')
const highlight = get<HTMLButtonElement>('highlight-note')
const status = get<HTMLButtonElement>('note-status')
const errorBox = get<HTMLDivElement>('note-error')
const id = new URLSearchParams(location.search).get('id') ?? ''
const recoveryKey = `moye-note-${id}`
let note: Note | undefined
let dirty = false
let writing: Promise<void> | undefined
let retry: ReturnType<typeof setTimeout> | undefined
let lastStamp = 0
let closing = false
let selection: Range | undefined
let composing = false
let highlightFrame = 0

function updateHighlightButton() {
  const enabled = Boolean(note?.highlightWords?.includes(selection?.toString() ?? ''))
  highlight.setAttribute('aria-pressed', String(enabled))
  highlight.disabled = closing || !note || !supportsNoteHighlights
  highlight.title = !supportsNoteHighlights ? '请更新 Microsoft Edge WebView2 以使用关键词高亮'
    : enabled ? '取消这个关键词的全部高亮' : '选中文字后点击：所有相同文字持续高亮；再次选中同一关键词点击可取消'
}
function refreshHighlights() {
  if (highlightFrame || composing) return
  highlightFrame = requestAnimationFrame(() => {
    highlightFrame = 0
    if (!composing && note) renderNoteHighlights(input, note.highlightWords)
  })
}

function setClosing(value: boolean) {
  closing = value
  input.contentEditable = String(!value && Boolean(note))
  document.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input').forEach(control => { control.disabled = value })
  updateHighlightButton()
}

function showError(error: unknown) {
  console.error('Note operation failed:', error)
  errorBox.textContent = `${friendlyError(error)} 内容会保留在窗口中，点击底部“重试保存”重试。`
  errorBox.hidden = false
  status.textContent = '重试保存'
}
function paint() {
  document.documentElement.style.setProperty('--note-paper', paper.value)
  document.documentElement.style.setProperty('--note-ink', ink.value)
  pin.setAttribute('aria-pressed', String(note?.pinned ?? false))
  pin.title = note?.pinned ? '已置顶，点击取消' : '点击置顶到其他窗口上方'
}
function snapshot(): Note {
  return { ...note!, highlightWords: [...note!.highlightWords], content: input.innerText, richContent: cleanNoteHtml(input.innerHTML), background: paper.value, foreground: ink.value }
}
function localSave(value: Note) {
  try { localStorage.setItem(recoveryKey, JSON.stringify(value)) }
  catch (error) { console.error('Note local recovery write failed:', error) }
}
function changed() {
  if (!note) return
  lastStamp = Math.max(Date.now(), lastStamp + 1)
  note.updated = lastStamp
  dirty = true
  localSave(snapshot())
  status.textContent = '保存中…'
  paint()
  void save().catch(showError)
}
async function save(): Promise<void> {
  if (writing) { await writing; if (dirty) return save(); return }
  clearTimeout(retry)
  writing = (async () => {
    while (dirty && note) {
      const value = snapshot()
      dirty = false
      try {
        await invoke('note_save', { edit: value })
        if (!dirty) {
          errorBox.hidden = true
          status.textContent = '已保存'
          get<HTMLTimeElement>('note-time').textContent = new Date(value.updated).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        }
      } catch (error) {
        dirty = true
        retry = setTimeout(() => { void save().catch(showError) }, 3000)
        throw error
      }
    }
  })()
  try { await writing } finally { writing = undefined }
}
async function hide() {
  if (closing || !note) return
  setClosing(true)
  try { await save(); await invoke('note_hide') }
  catch (error) { showError(error) }
  finally { setClosing(false) }
}
input.addEventListener('input', () => { changed(); refreshHighlights() })
input.addEventListener('compositionstart', () => { composing = true })
input.addEventListener('compositionend', () => { composing = false; refreshHighlights() })
input.addEventListener('paste', event => {
  event.preventDefault()
  const text = event.clipboardData?.getData('text/plain') ?? ''
  document.execCommand('insertText', false, text)
})
input.addEventListener('drop', event => event.preventDefault())
document.addEventListener('selectionchange', () => {
  const current = window.getSelection()
  if (current?.rangeCount && input.contains(current.anchorNode) && input.contains(current.focusNode)) {
    selection = current.getRangeAt(0).cloneRange()
  }
  updateHighlightButton()
})
highlight.addEventListener('mousedown', event => event.preventDefault())
highlight.addEventListener('click', () => {
  if (closing || !note || !selection || selection.collapsed || !input.contains(selection.commonAncestorContainer)) return
  const word = selection.toString()
  if (!word.trim()) return
  const words = note.highlightWords
  const enabled = words.includes(word)
  if (!enabled && (words.length >= 128 || new TextEncoder().encode([...words, word].join('')).length > 64 * 1024)) {
    errorBox.textContent = '高亮关键词过多或过长，请先选中已有关键词，点击“亮”取消部分高亮后重试。'
    errorBox.hidden = false
    return
  }
  note.highlightWords = enabled ? words.filter(value => value !== word) : [...words, word]
  const top = input.scrollTop, left = input.scrollLeft
  input.focus({ preventScroll: true })
  const current = window.getSelection()!
  current.removeAllRanges()
  current.addRange(selection)
  input.scrollTop = top
  input.scrollLeft = left
  renderNoteHighlights(input, note.highlightWords)
  updateHighlightButton()
  changed()
})
paper.addEventListener('input', changed)
ink.addEventListener('input', changed)
pin.addEventListener('click', () => { if (note && !closing) { note.pinned = !note.pinned; changed() } })
status.addEventListener('click', () => { if (note) { dirty = true; void save().catch(showError) } })
get('hide-note').addEventListener('click', () => { void hide() })
get('delete-note').addEventListener('click', async () => {
  if (closing || !note) return
  setClosing(true)
  try {
    if (!await confirmDeleteNote(input.innerText)) return
    await save()
    clearTimeout(retry)
    localStorage.removeItem(recoveryKey)
    await invoke('notes_delete', { id })
  } catch (error) { if (note) localSave(snapshot()); showError(error) }
  finally { setClosing(false) }
})
get('new-note').addEventListener('click', async event => {
  const button = event.currentTarget as HTMLButtonElement
  if (button.disabled) return
  button.disabled = true
  try { await invoke('notes_create', { id: crypto.randomUUID() }) }
  catch (error) { showError(error) }
  finally { button.disabled = false }
})
get('note-drag').addEventListener('mousedown', event => {
  if (event.button !== 0) return
  event.preventDefault()
  void invoke('note_drag').catch(showError)
})
get('note-drag').addEventListener('dblclick', () => input.focus())
document.querySelectorAll<HTMLElement>('[data-resize]').forEach(edge => edge.addEventListener('mousedown', event => {
  if (event.button !== 0) return
  event.preventDefault()
  const directions: Record<string, string> = { n: 'North', s: 'South', e: 'East', w: 'West', ne: 'NorthEast', nw: 'NorthWest', se: 'SouthEast', sw: 'SouthWest' }
  void invoke('plugin:window|start_resize_dragging', { value: directions[edge.dataset.resize!] }).catch(showError)
}))
window.addEventListener('blur', () => { if (dirty) void save().catch(showError) })
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    if (note) { dirty = true; void save().catch(showError) }
  }
})

async function start() {
  await listen('close-requested', () => { void hide() })
  await listen('note-save-error', () => showError('便签位置或大小未能保存，请检查磁盘空间和写入权限。'))
  await listen('note-flush-request', () => {
    setClosing(true)
    void (async () => {
      let success = false
      try { if (!note) throw new Error('便签尚未读取完成。'); await save(); success = true }
      catch (error) { showError(error) }
      finally {
        await invoke('note_flush_done', { success }).catch(showError)
      }
    })()
  })
  await listen('note-flush-cancel', () => { setClosing(false) })
  note = await invoke<Note>('note_read')
  try {
    const raw = localStorage.getItem(recoveryKey)
    if (raw) {
      const recovered = JSON.parse(raw) as Note
      if (recovered.id === id && recovered.updated > note.updated && typeof recovered.content === 'string'
        && /^#[a-f\d]{6}$/i.test(recovered.background) && /^#[a-f\d]{6}$/i.test(recovered.foreground)) {
        note = { ...note, ...recovered }
        dirty = true
      }
    }
  } catch (error) { console.error('Note local recovery read failed:', error) }
  lastStamp = note.updated
  if (note.richContent) input.innerHTML = cleanNoteHtml(note.richContent)
  else input.textContent = note.content
  const migrated = migrateNoteHighlights(input)
  note.highlightWords = highlightWords([...highlightWords(note.highlightWords), ...migrated])
  renderNoteHighlights(input, note.highlightWords)
  updateHighlightButton()
  paper.value = note.background
  ink.value = note.foreground
  paint()
  input.contentEditable = 'true'
  status.textContent = '已保存'
  get<HTMLTimeElement>('note-time').textContent = new Date(note.updated).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  await invoke('note_ready')
  input.focus({ preventScroll: true })
  if (migrated.length) changed()
  else if (dirty) await save()
}
void start().catch(async error => {
  showError(error)
  await invoke('note_ready').catch(console.error)
})
