import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { basename, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { chromium } from 'playwright'
import { checkWrapping, wrapDocument } from './wrapping-check.mjs'
import { checkReading, outlineDocument } from './reading-check.mjs'
import { checkEditing, editingDocument } from './editing-check.mjs'
import { checkBlockEditing, blockEditDocument } from './block-edit-check.mjs'
import { checkHierarchy, hierarchyDocument } from './hierarchy-check.mjs'

// 在实际 EXE 的 WebView2 中操作，调用真实 Rust 命令；不替换原生桥。
// 远程调试参数只传给本次测试进程，普通启动不启用。
if (process.platform !== 'win32') throw new Error('此检查用于 Windows 桌面程序。')
const runFile = promisify(execFile)
const running = await runFile('tasklist.exe', ['/FI', 'IMAGENAME eq moye.exe', '/FO', 'CSV', '/NH'], { windowsHide: true })
assert.ok(!/^"moye\.exe",/im.test(running.stdout), '请先关闭已打开的墨页窗口，再运行桌面检查。')
const executable = resolve('src-tauri/target/release/moye.exe')
assert.ok(existsSync(executable), '请先执行 npm run desktop:build')
const server = createServer()
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
await new Promise(resolve => server.close(resolve))
mkdirSync('.cache', { recursive: true })
const directory = mkdtempSync(resolve('.cache/desktop-check-'))
const screenshots = resolve('.cache/screenshots')
mkdirSync(screenshots, { recursive: true })
const documentPath = resolve(directory, '中文 文档.md')
const secondPath = resolve(directory, '第二份 文档.md')
const longPath = resolve(directory, '长文档.md')
const wrappingPath = resolve(directory, '换行方式.md')
const outlinePath = resolve(directory, '目录与字号.md')
const editingPath = resolve(directory, '复制与替换.md')
const blockEditPath = resolve(directory, '局部替换.md')
const hierarchyPath = resolve(directory, '标题层级.md')
const fixture = readFileSync('tests/fixtures/showcase.md', 'utf8').replaceAll('\r\n', '\n')
writeFileSync(documentPath, '\ufeff' + fixture.replaceAll('\n', '\r\n'))
writeFileSync(secondPath, '# 第二份文档\n\n![图标](icon.png "本地图片")\n\n原生文件关联入口。\n')
copyFileSync('src-tauri/icons/icon.png', resolve(directory, 'icon.png'))
writeFileSync(longPath, '# 长文档\n\n' + Array.from({ length: 100 }, (_, i) => `第 ${i + 1} 段，验证本地编辑与滚动位置。\n\n`).join(''))
writeFileSync(wrappingPath, wrapDocument)
writeFileSync(outlinePath, outlineDocument)
writeFileSync(editingPath, editingDocument)
writeFileSync(blockEditPath, blockEditDocument)
writeFileSync(hierarchyPath, hierarchyDocument)
const env = {
  ...process.env,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  WEBVIEW2_USER_DATA_FOLDER: resolve(directory, 'webview-profile'),
  MOYE_DATA_DIR: resolve(directory, 'app-data'),
}
const app = spawn(executable, [documentPath], { env, windowsHide: true, stdio: 'ignore' })
let launchError
app.on('error', error => { launchError = error })
let browser
let page
const passed = []
const pageErrors = []

async function nativeDialog(action, path) {
  const args = ['-NoProfile', '-NonInteractive', '-File', resolve('tools/windows-dialog.ps1'), '-AppProcessId', String(app.pid), '-Action', action]
  if (path) args.push('-FilePath', path)
  await runFile('powershell.exe', args, { windowsHide: true, timeout: 25000 })
}

async function waitUntil(check, message, timeout = 30000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (launchError) throw launchError
    if (await check()) return
    await delay(150)
  }
  throw new Error(message)
}

async function openInRunningApp(path) {
  const child = spawn(executable, [path], { env, windowsHide: true, stdio: 'ignore' })
  await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`文件打开进程退出码：${code}`)))
  })
}

async function waitForFileName(path) {
  await page.waitForFunction(name => document.getElementById('filename')?.textContent === name, basename(path))
  await page.waitForFunction(() => !document.querySelector('[data-action="save"]').disabled)
}

async function save() {
  await page.locator('[data-action="save"]').click()
  await page.waitForFunction(() => !document.querySelector('[data-action="save"]').disabled)
}

try {
  await waitUntil(async () => {
    try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok }
    catch { return false }
  }, '桌面程序的 WebView2 未能启动')
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  await waitUntil(() => {
    page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().includes('tauri.localhost'))
    return Boolean(page)
  }, '没有找到应用窗口')
  page.on('pageerror', error => pageErrors.push(error.message))
  await waitForFileName(documentPath)
  await page.locator('[data-kind="mermaid"] svg').waitFor({ timeout: 30000 })
  assert.ok(await page.locator('[data-kind="mermaid"] svg').textContent().then(text => text.includes('记录灵感')))
  assert.ok(await page.locator('#preview .katex').count() >= 2)
  assert.equal(await page.locator('#preview table').count(), 1)
  await page.screenshot({ path: resolve(screenshots, 'native-desktop.png') })
  const original = readFileSync(documentPath)
  await save()
  assert.deepEqual(readFileSync(documentPath), original)
  passed.push('真实 EXE 冷启动打开中文及空格路径；公式、图表、表格显示；无修改保存保留 BOM/CRLF 和原文')

  await page.locator('#preview p').first().click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' 原生保存验证。')
  await save()
  assert.ok(readFileSync(documentPath, 'utf8').includes('原生保存验证。'))
  assert.ok(readFileSync(documentPath).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])))
  assert.ok(!/(?<!\r)\n/.test(readFileSync(documentPath, 'utf8')))
  passed.push('预览编辑通过 Rust 原子保存写入真实磁盘，保留编码和换行风格')

  await openInRunningApp(secondPath)
  await waitForFileName(secondPath)
  await page.waitForFunction(() => document.querySelector('#preview img')?.naturalWidth > 0)
  await save()
  assert.ok(readFileSync(secondPath, 'utf8').includes('![图标](icon.png "本地图片")'))
  passed.push('再次运行 EXE 将文件交给已有窗口；真实本地图片读取、显示和相对路径保留')

  await page.locator('#preview p').last().click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' 尚未保存。')
  const secondId = await page.locator('[role="tab"][aria-selected="true"]').getAttribute('data-tab')
  await openInRunningApp(longPath)
  await waitForFileName(longPath)
  await page.locator(`[data-tab="${secondId}"]`).click()
  await waitForFileName(secondPath)
  assert.equal(await page.locator('#filename').textContent(), basename(secondPath))
  assert.ok(await page.locator('#preview').innerText().then(text => text.includes('尚未保存。')))
  await save()
  await openInRunningApp(longPath)
  await waitForFileName(longPath)
  passed.push('运行中打开另一个文件会增加标签，原标签修改保留；重复打开不会增加重复标签')

  const paragraph = page.locator('#preview p').nth(50)
  await paragraph.scrollIntoViewIfNeeded()
  await paragraph.click()
  await page.keyboard.press('End')
  const before = await page.locator('#preview-scroll').evaluate(element => element.scrollTop)
  await page.keyboard.insertText(' 中文输入不跳动。')
  await delay(200)
  const after = await page.locator('#preview-scroll').evaluate(element => element.scrollTop)
  assert.ok(before > 1000)
  assert.ok(Math.abs(after - before) <= 2, `滚动位置变化：${after - before}`)
  await page.locator('[data-mode="source"]').click()
  assert.equal(await page.locator('#preview-scroll').isVisible(), false)
  await page.locator('[data-mode="preview"]').click()
  await delay(150)
  assert.ok(Math.abs(await page.locator('#preview-scroll').evaluate(element => element.scrollTop) - before) <= 2)
  await save()
  assert.ok(readFileSync(longPath, 'utf8').includes('中文输入不跳动。'))
  passed.push('原生 WebView2 长文档中部中文编辑与源码/预览切换，滚动变化不超过 2 px')

  await page.locator('#preview p').nth(50).click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' 冲突检查。')
  writeFileSync(longPath, '# 外部修改\n\n必须保留外部写入。\n')
  await save()
  assert.equal(readFileSync(longPath, 'utf8'), '# 外部修改\n\n必须保留外部写入。\n')
  assert.ok(await page.locator('#toast').innerText().then(text => text.includes('其他程序修改')))
  passed.push('外部修改冲突由真实 Rust 保存命令拒绝，磁盘内容未被覆盖')

  const savedAsPath = resolve(directory, '另存为 中文.md')
  await page.locator('[data-action="save-as"]').click()
  await nativeDialog('accept', savedAsPath)
  await waitForFileName(savedAsPath)
  assert.ok(readFileSync(savedAsPath, 'utf8').includes('冲突检查。'))
  assert.equal(readFileSync(longPath, 'utf8'), '# 外部修改\n\n必须保留外部写入。\n')
  await page.locator('[data-action="open"]').click()
  await nativeDialog('accept', secondPath)
  await waitForFileName(secondPath)
  await page.locator('[data-action="open"]').click()
  await nativeDialog('cancel')
  await waitForFileName(secondPath)
  passed.push('Windows 原生另存为、打开和取消对话框；冲突文档可另存且原文件保持不变')

  await page.locator('#preview p').last().click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' 关闭保护。')
  await nativeDialog('close')
  await page.getByRole('dialog', { name: '保存当前修改？' }).waitFor()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  assert.ok(await page.locator('#preview').innerText().then(text => text.includes('关闭保护。')))
  passed.push('真实 Windows 关闭消息触发未保存保护，取消后窗口与修改保留')

  await save()
  await openInRunningApp(wrappingPath)
  await waitForFileName(wrappingPath)
  await checkWrapping(page, screenshots)
  await save()
  assert.equal(readFileSync(wrappingPath, 'utf8'), wrapDocument)
  passed.push('紧凑布局及预览/源码的三种换行方式；A4 宽度、横向位置和撤销保留，磁盘原文未变')

  await openInRunningApp(outlinePath)
  await waitForFileName(outlinePath)
  await checkReading(page, screenshots)
  await save()
  assert.equal(readFileSync(outlinePath, 'utf8'), outlineDocument)
  passed.push('真实 EXE 六级目录与重复标题跳转、标题实时更新、目录折叠；Ctrl＋滚轮缩放正文、默认字号恢复，保存不改写原文')
  await openInRunningApp(editingPath)
  await waitForFileName(editingPath)
  await checkEditing(page, screenshots)
  await save()
  assert.equal(readFileSync(editingPath, 'utf8'), editingDocument)
  passed.push('真实系统剪贴板复制代码和文本块；搜索替换弹窗与快捷键、匹配选项及替换撤销，磁盘原文保持一致')
  await openInRunningApp(blockEditPath)
  await waitForFileName(blockEditPath)
  await checkBlockEditing(page, screenshots)
  await save()
  assert.equal(readFileSync(blockEditPath, 'utf8'), blockEditDocument)
  passed.push('真实 EXE 在当前块的大输入框中修改段落、代码、列表和表格；取消、空内容、一次撤销、滚动和其他段落保持正常，撤销后磁盘原文一致')

  await openInRunningApp(hierarchyPath)
  await waitForFileName(hierarchyPath)
  await checkHierarchy(page, screenshots, async expected => {
    await save()
    assert.equal(readFileSync(hierarchyPath, 'utf8'), expected)
  })
  passed.push('真实 EXE 章节子树复制/替换、独立列表项、嵌套结构、代码边界、撤销重做及磁盘保存原文一致')
  assert.deepEqual(pageErrors, [])
  console.log(JSON.stringify({ passed, pageErrors, directory, screenshots }, null, 2))
} finally {
  if (page && !page.isClosed()) {
    // 测试只编辑自己的临时文档；清理测试草稿后关闭自己启动的窗口。
    await page.evaluate(() => localStorage.removeItem('moye-recovery-v1')).catch(() => {})
    await page.evaluate(() => window.__TAURI__.core.invoke('close_window')).catch(() => {})
  }
  await browser?.close().catch(() => {})
  if (app.exitCode === null) app.kill()
}
