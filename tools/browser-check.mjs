import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { preview } from 'vite'
import { checkWrapping, wrapDocument } from './wrapping-check.mjs'
import { checkTabs } from './tabs-check.mjs'
import { checkReading, outlineDocument } from './reading-check.mjs'
import { checkEditing, editingDocument } from './editing-check.mjs'
import { checkBlockEditing, blockEditDocument } from './block-edit-check.mjs'
import { checkHierarchy, hierarchyDocument } from './hierarchy-check.mjs'

// 这里验证真实 Chromium 渲染与交互。原生桥是测试替身，不代表已验证系统文件关联或 Rust IO。
const fixture = readFileSync('tests/fixtures/showcase.md', 'utf8').replaceAll('\r\n', '\n')
const imageData = `data:image/png;base64,${readFileSync('src-tauri/icons/icon.png').toString('base64')}`
const screenshotDirectory = resolve('.cache/screenshots')
mkdirSync(screenshotDirectory, { recursive: true })
const executablePath = process.env.BROWSER_PATH ?? [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync)
const server = await preview({ preview: { host: '127.0.0.1', port: 1421, strictPort: true } })
let browser
const results = []
try {
  browser = await chromium.launch({ headless: true, executablePath })
  const page = await browser.newPage({ viewport: { width: 1100, height: 820 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort()
  })
  await page.addInitScript(({ fixture, imageData }) => {
    localStorage.clear()
    window.__nativeTest = { next: fixture, saved: null, saveCount: 0, pending: false, closed: false, listeners: {}, calls: [], documents: {}, workspace: null }
    window.__TAURI__ = {
      core: {
        async invoke(command, args = {}) {
          const state = window.__nativeTest
          state.calls.push(command)
          switch (command) {
            case 'set_document_title': return
            case 'load_workspace': return { tabs: [], activeId: '', warnings: [] }
            case 'save_workspace':
              state.workspace = structuredClone(args)
              return args.sequence
            case 'check_document': return 'unchanged'
            case 'has_pending_file': return state.pending
            case 'discard_pending_file': state.pending = false; return
            case 'open_document':
            case 'open_pending_file': {
              state.pending = false
              const doc = { id: args.documentId, name: '写作笔记.md', path: `C:/notes/${args.documentId}/写作笔记.md`, content: state.next, lineEnding: 'LF' }
              state.documents[doc.id] = doc
              return doc
            }
            case 'new_document': {
              const doc = { id: args.documentId, name: args.name, path: null, content: '', lineEnding: 'LF' }
              state.documents[doc.id] = doc
              return doc
            }
            case 'close_document': delete state.documents[args.documentId]; return
            case 'save_document': {
              state.saveCount++
              await new Promise(resolve => setTimeout(resolve, 120))
              state.saved = args.content
              const doc = state.documents[args.documentId]
              doc.content = args.content
              doc.path ??= `C:/notes/${args.documentId}/${doc.name}`
              return doc
            }
            case 'close_window': state.closed = true; return
            case 'read_image': return imageData
            default: throw new Error(`测试桥没有实现命令：${command}`)
          }
        },
      },
      event: { async listen(name, callback) { window.__nativeTest.listeners[name] = callback; return () => {} } },
    }
  }, { fixture, imageData })
  await page.goto('http://127.0.0.1:1421', { waitUntil: 'networkidle' })
  await page.locator('[data-action="open"]').click()
  await page.locator('#preview h1').waitFor()
  await page.locator('[data-kind="mermaid"] svg').waitFor({ timeout: 20000 })
  assert.ok(await page.locator('[data-kind="mermaid"] svg').textContent().then(text => text.includes('记录灵感') && text.includes('保存到本地')), '图表节点必须显示文字')
  assert.equal(await page.locator('#preview table').count(), 1)
  assert.ok(await page.locator('#preview .katex').count() >= 2)
  assert.equal(await page.locator('#source').isVisible(), false)
  await page.screenshot({ path: resolve(screenshotDirectory, 'desktop.png') })
  await page.locator('[data-kind="mermaid"]').scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(screenshotDirectory, 'formulas-diagrams.png') })
  await page.locator('#preview-scroll').evaluate(element => { element.scrollTop = 0 })
  await page.locator('[data-action="save"]').click()
  await page.waitForFunction(() => window.__nativeTest.saved !== null)
  assert.equal(await page.evaluate(() => window.__nativeTest.saved), fixture, '只打开和保存不应改写 Markdown')
  results.push('标题、列表、表格、代码、公式、图表渲染及无修改保存')

  const math = page.locator('[data-kind="math"]').first()
  await math.scrollIntoViewIfNeeded()
  const formulaScroll = await page.locator('#preview-scroll').evaluate(element => element.scrollTop)
  await math.dblclick()
  await page.getByRole('dialog', { name: '编辑公式' }).getByRole('textbox').fill('$A = 2\\pi r$')
  await page.getByRole('button', { name: '确定', exact: true }).click()
  await page.waitForTimeout(150)
  assert.ok(Math.abs(await page.locator('#preview-scroll').evaluate(element => element.scrollTop) - formulaScroll) <= 2, '局部编辑公式后应留在原位置')
  await page.locator('[data-action="save"]').click()
  await page.waitForFunction(() => window.__nativeTest.saved.includes('$A = 2\\pi r$'))
  results.push('预览页局部修改公式并保留滚动位置和公式源码')

  await page.locator('#preview input[type="checkbox"]').nth(1).check()
  await page.locator('#preview td').first().click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' · 修改')
  await page.locator('[data-action="save"]').click()
  await page.waitForFunction(() => window.__nativeTest.saved.includes('· 修改'))
  assert.ok(await page.evaluate(() => /-\s+\[x\]\s+把一个想法/.test(window.__nativeTest.saved)))
  results.push('预览直接编辑表格与勾选任务')

  await page.locator('[data-mode="source"]').click()
  assert.equal(await page.locator('#preview-scroll').isVisible(), false)
  await page.screenshot({ path: resolve(screenshotDirectory, 'source.png') })
  await page.locator('#source .cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('\n\n源码追加的内容。')
  await page.locator('[data-mode="preview"]').click()
  await page.locator('#preview').getByText('源码追加的内容。', { exact: true }).waitFor()
  await page.locator('[data-action="save"]').click()
  await page.waitForFunction(() => window.__nativeTest.saved.endsWith('源码追加的内容。'))
  results.push('同页切换源码、预览并同步编辑结果')

  const longDocument = '# 长文档\n\n' + Array.from({ length: 100 }, (_, index) => `第 ${index + 1} 段。这是一段用于验证滚动稳定性的中文内容。\n\n`).join('')
  await page.evaluate(value => { window.__nativeTest.next = value }, longDocument)
  await page.locator('[data-action="open"]').click()
  const paragraph = page.locator('#preview p').nth(50)
  await paragraph.scrollIntoViewIfNeeded()
  await paragraph.click()
  await page.keyboard.press('End')
  const before = await page.evaluate(() => {
    window.__paragraphBefore = document.querySelectorAll('#preview p')[50]
    return document.getElementById('preview-scroll').scrollTop
  })
  await page.keyboard.insertText('中文输入不会跳动。')
  await page.waitForTimeout(250)
  const after = await page.evaluate(() => ({
    top: document.getElementById('preview-scroll').scrollTop,
    same: window.__paragraphBefore === document.querySelectorAll('#preview p')[50],
  }))
  assert.ok(before > 1000, '必须在长文档中间验证')
  assert.ok(Math.abs(after.top - before) <= 2, `输入造成滚动位移：${after.top - before}`)
  assert.ok(after.same, '输入不能重建段落 DOM')
  await page.locator('[data-mode="source"]').click()
  await page.locator('[data-mode="preview"]').click()
  await page.waitForTimeout(100)
  assert.ok(Math.abs(await page.locator('#preview-scroll').evaluate(element => element.scrollTop) - before) <= 2)
  results.push('长文档中部中文输入不重建 DOM、不跳滚动条；往返切换保留预览位置')

  await page.evaluate(() => { window.__nativeTest.listeners['close-requested']() })
  await page.getByRole('dialog', { name: '保存当前修改？' }).waitFor()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal(await page.evaluate(() => window.__nativeTest.closed), false)
  const previousTab = await page.locator('[role="tab"][aria-selected="true"]').getAttribute('data-tab')
  await page.evaluate(() => { window.__nativeTest.pending = true; window.__nativeTest.listeners['files-pending']() })
  await page.waitForFunction(id => document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-tab') !== id, previousTab)
  await page.locator(`[data-tab="${previousTab}"]`).click()
  assert.ok(await page.locator('#preview').innerText().then(text => text.includes('中文输入不会跳动')))
  results.push('关闭窗口时保护已有文件修改；关联文件打开新标签，原标签内容保留')

  const saveCount = await page.evaluate(() => window.__nativeTest.saveCount)
  await page.evaluate(() => {
    const button = document.querySelector('[data-action="save"]')
    button.click()
    button.click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))
  })
  await page.waitForFunction(count => window.__nativeTest.saveCount === count + 1 && !document.querySelector('[data-action="save"]').disabled, saveCount)
  assert.equal(await page.evaluate(() => window.__nativeTest.saveCount), saveCount + 1)
  results.push('保存按钮与快捷键并发触发时只提交一次')

  const imageDocument = '![示例](images/logo.png "原有标题")\n\n图片说明。\n'
  await page.evaluate(value => { window.__nativeTest.next = value }, imageDocument)
  await page.locator('[data-action="open"]').click()
  await page.waitForFunction(() => document.querySelector('#preview img')?.naturalWidth > 0)
  await page.locator('[data-action="save"]').click()
  await page.waitForFunction(value => window.__nativeTest.saved === value, imageDocument)
  results.push('本地图片显示且保存时保留相对路径与标题（原生桥替身）')

  await page.evaluate(value => { window.__nativeTest.next = value }, wrapDocument)
  await page.locator('[data-action="open"]').click()
  await checkWrapping(page, screenshotDirectory)
  await page.locator('[data-action="save"]').click()
  await page.waitForFunction(value => window.__nativeTest.saved === value, wrapDocument)
  results.push('紧凑工具栏、全宽正文；预览与源码三种换行模式、A4 宽度、横向位置与撤销保留，保存原文不变')

  await page.setViewportSize({ width: 560, height: 720 })
  await page.waitForTimeout(120)
  assert.ok(await page.locator('#preview-scroll').evaluate(element => element.scrollWidth <= element.clientWidth + 1))
  await page.locator('button[data-wrap="page"]').click()
  const pageWidth = await page.locator('#preview').evaluate(element => element.getBoundingClientRect().width)
  assert.ok(Math.abs(pageWidth - 210 * 96 / 25.4) < 2, '窄窗口下 A4 宽度不应随窗口缩小')
  await page.locator('[data-mode="source"]').click()
  assert.ok(Math.abs(await page.locator('#source .cm-content').evaluate(element => element.getBoundingClientRect().width) - pageWidth) < 2)
  await page.locator('button[data-wrap="window"]').click()
  await page.waitForTimeout(120)
  assert.ok(await page.locator('#source .cm-scroller').evaluate(element => element.scrollWidth <= element.clientWidth + 1))
  await page.locator('[data-mode="preview"]').click()
  await page.setViewportSize({ width: 1100, height: 820 })

  await page.evaluate(value => { window.__nativeTest.next = value }, fixture)
  await page.locator('[data-action="open"]').click()
  await page.locator('#preview h1').waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(150)
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }))
  assert.ok(width.scroll <= width.viewport, `窄窗口出现横向溢出：${width.scroll}`)
  for (const button of await page.locator('.format-toolbar button, .format-toolbar select').all()) {
    const bounds = await button.boundingBox()
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390, '窄窗口所有工具按钮都应在可见区域内')
  }
  for (const selector of ['[data-mode="preview"]', '[data-mode="source"]', '[data-action="save"]']) {
    assert.equal(await page.locator(selector).evaluate(element => getComputedStyle(element).whiteSpace), 'nowrap')
  }
  await page.screenshot({ path: resolve(screenshotDirectory, 'narrow.png') })
  results.push('390px 窄窗口无页面横向溢出、短标签保持单行')

  await checkTabs(page)
  results.push('多个临时标签自动暂存；已有文件不自动暂存；关闭标签保护及各标签撤销隔离')

  await page.evaluate(value => { window.__nativeTest.next = value }, outlineDocument)
  await page.locator('[data-action="open"]').click()
  await checkReading(page, screenshotDirectory)
  await page.locator('[data-action="save"]').click()
  await page.waitForFunction(value => window.__nativeTest.saved === value, outlineDocument)
  results.push('六级目录、重复标题精确跳转、两种模式编辑后自动更新；Ctrl＋滚轮仅调整正文字号，源码撤销与磁盘原文不变')

  const outlineTab = await page.locator('[role="tab"][aria-selected="true"]').getAttribute('data-tab')
  await page.locator('[data-action="new"]').first().click()
  assert.equal(await page.locator('#outline-empty').isVisible(), true)
  await page.locator(`[data-tab="${outlineTab}"]`).click()
  await page.waitForFunction(() => document.querySelectorAll('#outline-list button').length === 7)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(150)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: resolve(screenshotDirectory, 'outline-narrow.png') })
  results.push('目录随标签切换、无标题空状态、窄窗口布局无溢出')
  await page.setViewportSize({ width: 1100, height: 820 })
  await page.evaluate(value => { window.__nativeTest.next = value }, editingDocument)
  await page.locator('[data-action="open"]').click()
  await checkEditing(page, screenshotDirectory)
  await page.locator('[data-action="save"]').click()
  await page.waitForFunction(value => window.__nativeTest.saved === value, editingDocument)
  results.push('代码、文本、引用、列表、表格快捷复制与实际粘贴；弹窗搜索替换、Ctrl+F/H、匹配选项、撤销及原文保留')
  await page.keyboard.press('Control+h')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(120)
  for (const button of await page.locator('.find-dialog button:visible').all()) {
    const bounds = await button.boundingBox()
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390, '窄窗口搜索弹窗按钮必须可见')
  }
  await page.screenshot({ path: resolve(screenshotDirectory, 'find-replace-narrow.png') })
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1100, height: 820 })
  await page.evaluate(value => { window.__nativeTest.next = value }, blockEditDocument)
  await page.locator('[data-action="open"]').click()
  await checkBlockEditing(page, screenshotDirectory)
  await page.locator('[data-action="save"]').click()
  await page.waitForFunction(value => window.__nativeTest.saved === value, blockEditDocument)
  results.push('复制左侧替换按钮与大输入框；段落、代码、表格、列表局部修改，取消、空内容、撤销及原文/滚动保护')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('#preview pre').hover()
  await page.locator('.document-view:not([hidden]) .block-replace').click()
  await page.screenshot({ path: resolve(screenshotDirectory, 'block-edit-narrow.png') })
  for (const button of await page.locator('.block-edit-dialog button').all()) {
    const bounds = await button.boundingBox()
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y + bounds.height <= 844)
  }
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1100, height: 820 })
  await page.evaluate(value => { window.__nativeTest.next = value }, hierarchyDocument)
  await page.locator('[data-action="open"]').click()
  await checkHierarchy(page, screenshotDirectory, async expected => {
    await page.locator('[data-action="save"]').click()
    await page.waitForFunction(() => !document.querySelector('[data-action="save"]').disabled)
    assert.equal(await page.evaluate(() => window.__nativeTest.saved), expected)
  })
  results.push('标题整节复制/替换包含下级内容；列表项、嵌套列表与引用、代码独立操作，边界、撤销重做及保存原文验证')
  assert.deepEqual(errors, [], '页面不应出现未处理异常')
  console.log(JSON.stringify({ passed: results, screenshots: screenshotDirectory, pageErrors: errors }, null, 2))
} finally {
  await browser?.close()
  await new Promise(resolve => server.httpServer.close(resolve))
}
