import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { basename, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { chromium } from 'playwright'

if (process.platform !== 'win32') throw new Error('此检查用于 Windows。')
const runFile = promisify(execFile)
const running = await runFile('tasklist.exe', ['/FI', 'IMAGENAME eq moye.exe', '/FO', 'CSV', '/NH'], { windowsHide: true })
assert.ok(!/^"moye\.exe",/im.test(running.stdout), '请先关闭墨页，再运行恢复检查。')
const executable = resolve('src-tauri/target/release/moye.exe')
mkdirSync('.cache', { recursive: true })
const directory = mkdtempSync(resolve('.cache/recovery-check-'))
const dataDirectory = resolve(directory, 'app-data')
const snapshotPath = resolve(dataDirectory, 'workspace.json')
const firstPath = resolve(directory, '实际 文件甲.md')
const secondPath = resolve(directory, '实际 文件乙.md')
const firstOriginal = '# 实际文件甲\n\n原文件内容保持不变。\n'
const secondOriginal = '# 实际文件乙\n\n可以由其他软件修改。\n'
writeFileSync(firstPath, firstOriginal)
writeFileSync(secondPath, secondOriginal)
const results = []
const errors = []
let app
let browser
let page

async function until(check, message, timeout = 20000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await delay(100)
  }
  throw new Error(message)
}

async function launch(args = []) {
  const portServer = createServer()
  await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve))
  const port = portServer.address().port
  await new Promise(resolve => portServer.close(resolve))
  app = spawn(executable, args, {
    windowsHide: true, stdio: 'ignore',
    env: {
      ...process.env,
      MOYE_DATA_DIR: dataDirectory,
      WEBVIEW2_USER_DATA_FOLDER: resolve(directory, 'webview-profile'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
  })
  let launchError
  app.once('error', error => { launchError = error })
  await until(async () => {
    if (launchError) throw launchError
    try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })).ok }
    catch { return false }
  }, 'WebView2 未启动')
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  await until(() => {
    page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().includes('tauri.localhost'))
    return Boolean(page)
  }, '应用页面未出现')
  page.on('pageerror', error => errors.push(error.message))
  await page.locator('[role="tab"][aria-selected="true"]').waitFor()
  await idle()
}

async function idle() {
  await page.waitForFunction(() => !document.querySelector('[data-action="save"]').disabled)
}

async function native(action, path) {
  const args = ['-NoProfile', '-NonInteractive', '-File', resolve('tools/windows-dialog.ps1'), '-AppProcessId', String(app.pid), '-Action', action]
  if (path) args.push('-FilePath', path)
  await runFile('powershell.exe', args, { windowsHide: true, timeout: 25000 })
}

const selectedId = () => page.locator('[role="tab"][aria-selected="true"]').getAttribute('data-tab')
const snapshot = () => JSON.parse(readFileSync(snapshotPath, 'utf8'))

async function select(id, expectDialog = false) {
  await page.locator(`[data-tab="${id}"]`).click()
  if (!expectDialog) await idle()
}

async function typePreview(text) {
  await page.locator('[data-mode="preview"]').click()
  await page.locator('#preview p').first().click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(text)
  await delay(150)
}

async function newDraft(text) {
  await page.keyboard.press('Control+n')
  await idle()
  const id = await selectedId()
  await typePreview(text)
  return id
}

async function waitForExit() {
  await until(() => app.exitCode !== null || app.signalCode !== null, '退出前的临时保存或窗口关闭未完成')
  await browser.close().catch(() => {})
  browser = null
  page = null
}

try {
  await launch([firstPath, secondPath])
  const bounds = await page.locator('#workspace').boundingBox()
  await page.mouse.move(bounds.x + 100, bounds.y + 100)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -120)
  await page.keyboard.up('Control')
  await page.waitForFunction(() => document.getElementById('font-size').textContent === '16 px')
  await page.locator('#outline-toggle').click()
  assert.equal(await page.locator('[role="tab"]').count(), 2)
  const firstId = await page.getByRole('tab', { name: basename(firstPath), exact: true }).getAttribute('data-tab')
  const secondId = await page.getByRole('tab', { name: basename(secondPath), exact: true }).getAttribute('data-tab')
  await select(firstId)
  await typePreview(' 已有文件的未保存修改。')
  await delay(1200)
  assert.equal(readFileSync(firstPath, 'utf8'), firstOriginal)
  assert.ok(existsSync(snapshotPath))
  assert.ok(!readFileSync(snapshotPath, 'utf8').includes('已有文件的未保存修改'))
  assert.ok(snapshot().tabs.filter(tab => tab.path).every(tab => tab.content === null))
  results.push('已有文件编辑后，原文件未自动覆盖，恢复记录也不自动保存其修改内容')

  await page.locator('[data-action="temporary-save"]').click()
  await idle()
  const copyId = await selectedId()
  assert.notEqual(copyId, firstId)
  assert.ok(snapshot().tabs.find(tab => tab.id === copyId).content.includes('已有文件的未保存修改'))
  assert.equal(snapshot().tabs.find(tab => tab.id === copyId).path, null)
  assert.equal(readFileSync(firstPath, 'utf8'), firstOriginal)
  results.push('手动临时保存已有文件会创建独立草稿标签，保留修改且不写回原文件')

  const draftA = await newDraft('草稿甲：重启后要恢复中文内容。')
  await page.locator('[data-mode="source"]').click()
  await page.locator('button[data-wrap="page"]').click()
  const draftB = await newDraft('草稿乙：多个标签独立保存。')
  await page.locator('button[data-wrap="none"]').click()
  await until(() => {
    const saved = snapshot().tabs
    return saved.find(tab => tab.id === draftA)?.content.includes('草稿甲') && saved.find(tab => tab.id === draftB)?.content.includes('草稿乙')
  }, '多个未命名文档未自动写入临时文件')
  await native('close')
  await page.getByRole('dialog', { name: '保存当前修改？' }).waitFor()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await idle()
  assert.equal(app.exitCode, null)
  await select(draftB)
  await typePreview(' 退出前最后输入。')
  await native('close')
  await page.getByRole('button', { name: '不保存', exact: true }).click()
  await waitForExit()
  assert.equal(readFileSync(firstPath, 'utf8'), firstOriginal)
  assert.ok(snapshot().tabs.find(tab => tab.id === draftB).content.includes('退出前最后输入'))

  await launch()
  assert.equal(await page.locator('#font-size').textContent(), '16 px')
  assert.equal(await page.locator('#outline').isVisible(), false)
  await page.keyboard.press('Control+0')
  await page.locator('#outline-toggle').click()
  results.push('真实重启后保留字号和目录显隐设置，Ctrl+0 可恢复默认字号')
  assert.equal(await page.locator('[role="tab"]').count(), 5)
  assert.equal(await selectedId(), draftB)
  assert.ok(await page.locator('#preview').innerText().then(text => text.includes('退出前最后输入')))
  assert.equal(await page.locator('button[data-wrap="none"]').getAttribute('aria-pressed'), 'true')
  await select(draftA)
  assert.equal(await page.locator('[data-mode="source"]').getAttribute('aria-pressed'), 'true')
  assert.equal(await page.locator('button[data-wrap="page"]').getAttribute('aria-pressed'), 'true')
  assert.ok(await page.locator('#source').innerText().then(text => text.includes('草稿甲')))
  await select(copyId)
  assert.ok(await page.locator('#preview').innerText().then(text => text.includes('已有文件的未保存修改')))
  await select(firstId)
  assert.ok(!await page.locator('#preview').innerText().then(text => text.includes('已有文件的未保存修改')))
  results.push('真实关闭、重新启动后恢复多个草稿、临时副本、活动标签、源码/预览及换行方式；原文件放弃的修改不恢复')

  await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$stream = [System.IO.File]::Open($env:MOYE_CHECK_FILE, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None); $stream.Dispose()'], {
    windowsHide: true, timeout: 10000, env: { ...process.env, MOYE_CHECK_FILE: firstPath },
  })
  const external = '# 外部软件更新\n\n从磁盘重新加载。\n'
  writeFileSync(secondPath, external)
  await select(secondId, true)
  await page.getByRole('dialog', { name: '文件已被其他程序修改' }).waitFor()
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await idle()
  assert.ok(await page.locator('#preview').innerText().then(text => text.includes('外部软件更新')))
  await typePreview(' 当前标签还有未保存修改。')
  const secondExternal = '# 外部再次更新\n\n磁盘最新版本必须保留。\n'
  writeFileSync(secondPath, secondExternal)
  await select(firstId)
  await select(secondId, true)
  assert.ok(await page.getByRole('dialog', { name: '文件已被其他程序修改' }).innerText().then(text => text.includes('未保存的修改')))
  await page.getByRole('button', { name: '保留当前内容', exact: true }).click()
  await idle()
  assert.ok(await page.locator('#preview').innerText().then(text => text.includes('当前标签还有未保存修改')))
  await page.locator('[data-action="save"]').click()
  await idle()
  assert.ok(await page.locator('#toast').innerText().then(text => text.includes('其他程序修改')))
  assert.equal(readFileSync(secondPath, 'utf8'), secondExternal)
  await select(firstId)
  await select(secondId, true)
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await idle()
  assert.ok(await page.locator('#preview').innerText().then(text => text.includes('外部再次更新')))
  results.push('独立进程可独占读写已打开文件；切换标签检查外部更新，支持确认重新加载或保留当前修改，并防止冲突覆盖')

  await select(draftA)
  const savedDraftPath = resolve(directory, '草稿正式保存.md')
  await page.locator('[data-action="save"]').click()
  await native('accept', savedDraftPath)
  await idle()
  const savedDraftContent = readFileSync(savedDraftPath, 'utf8')
  assert.ok(savedDraftContent.includes('草稿甲'))
  assert.equal(snapshot().tabs.find(tab => tab.id === draftA).content, null)
  await page.locator('#source .cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('\n正式保存后不再自动暂存修改。')
  await delay(1100)
  assert.equal(readFileSync(savedDraftPath, 'utf8'), savedDraftContent)
  assert.ok(!readFileSync(snapshotPath, 'utf8').includes('正式保存后不再自动暂存修改'))

  await select(copyId)
  await page.locator(`[data-close-tab="${copyId}"]`).click()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await idle()
  assert.equal(await page.locator(`[data-tab="${copyId}"]`).count(), 1)
  await page.locator(`[data-close-tab="${copyId}"]`).click()
  await page.getByRole('button', { name: '不保存', exact: true }).click()
  await idle()
  assert.ok(!snapshot().tabs.some(tab => tab.id === copyId))
  await select(draftB)
  await native('close')
  await page.getByRole('button', { name: '不保存', exact: true }).click()
  await waitForExit()
  await launch()
  assert.equal(await page.locator(`[data-tab="${copyId}"]`).count(), 0)
  await select(draftA)
  assert.ok(!await page.locator('#source').innerText().then(text => text.includes('正式保存后不再自动暂存修改')))
  assert.equal(readFileSync(savedDraftPath, 'utf8'), savedDraftContent)
  results.push('草稿正式保存后停止自动暂存；显式放弃关闭的草稿不再恢复；重启不会把旧草稿写回文件')

  await select(draftB)
  await typePreview(' 异常退出前已暂存。')
  await until(() => snapshot().tabs.find(tab => tab.id === draftB).content.includes('异常退出前已暂存'), '异常退出测试前暂存未完成')
  app.kill()
  await waitForExit()
  await launch()
  await select(draftB)
  assert.ok(await page.locator('#preview').innerText().then(text => text.includes('异常退出前已暂存')))
  await page.screenshot({ path: resolve('.cache/screenshots/tabs-recovered.png') })
  results.push('实际进程异常退出后，已完成自动暂存的草稿可再次恢复')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: results, pageErrors: errors, directory }, null, 2))
} finally {
  if (page && !page.isClosed()) await page.evaluate(() => window.__TAURI__.core.invoke('close_window')).catch(() => {})
  await browser?.close().catch(() => {})
  if (app && app.exitCode === null) app.kill()
}
