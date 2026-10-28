import assert from 'node:assert/strict'
import { resolve } from 'node:path'

export const outlineDocument = '---\ntitle: 目录检查\n# 不应出现的属性\n---\n\n# 文档目录\n\n'
  + '```md\n## 不应出现的代码\n```\n\n'
  + Array.from({ length: 6 }, (_, i) => `${'#'.repeat(i + 1)} ${i === 3 || i === 4 ? '同名标题' : `章节 ${i + 1}`}\n\n`
    + Array.from({ length: 12 }, (_, j) => `第 ${i + 1} 章第 ${j + 1} 段，目录跳转和字体大小验证。\n\n`).join('')).join('')

// 复用同一套检查，覆盖 Chromium 及真正 EXE 内的 WebView2。
export async function checkReading(page, screenshots) {
  const outline = page.locator('#outline-list button')
  const previewScroll = page.locator('#preview-scroll')
  const size = selector => page.locator(selector).evaluate(element => parseFloat(getComputedStyle(element).fontSize))
  const headingVisible = async index => {
    const bounds = await page.locator('#preview :is(h1,h2,h3,h4,h5,h6)').nth(index).boundingBox()
    const scroll = await previewScroll.boundingBox()
    assert.ok(bounds.y >= scroll.y && bounds.y < scroll.y + 35, '点击目录后标题应位于正文顶部')
  }
  const wheel = async delta => {
    const bounds = await page.locator('#workspace').boundingBox()
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 180)
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, delta)
    await page.keyboard.up('Control')
    await page.waitForTimeout(180)
  }
  await page.locator('[data-mode="preview"]').click()
  if (!await page.locator('#outline').isVisible()) await page.locator('#outline-toggle').click()
  await page.waitForFunction(() => document.querySelectorAll('#outline-list button').length === 7)
  assert.deepEqual(await outline.allTextContents(), ['文档目录', '章节 1', '章节 2', '章节 3', '同名标题', '同名标题', '章节 6'])
  await outline.nth(5).click()
  await headingVisible(5)
  await page.waitForTimeout(150)
  await page.keyboard.press('End')
  await page.waitForTimeout(100)
  const before = await previewScroll.evaluate(element => element.scrollTop)
  await page.keyboard.insertText('（已修改）')
  await page.waitForFunction(() => document.querySelectorAll('#outline-list button')[5]?.textContent.includes('已修改'))
  const after = await previewScroll.evaluate(element => element.scrollTop)
  assert.ok(Math.abs(after - before) <= 2, `更新目录不应跳动正文：${before} → ${after}`)
  await page.keyboard.press('Control+z')
  await page.waitForFunction(() => document.querySelectorAll('#outline-list button')[5]?.textContent === '同名标题')

  const toolbar = await page.locator('.format-toolbar').boundingBox()
  const previewSize = await size('#preview')
  const headingSize = await size('#preview h5')
  const dpr = await page.evaluate(() => devicePixelRatio)
  await wheel(-120)
  assert.equal(await size('#preview'), previewSize + 1)
  assert.ok(await size('#preview h5') > headingSize)
  assert.equal(await page.evaluate(() => devicePixelRatio), dpr, '不能触发整个 WebView 缩放')
  assert.equal((await page.locator('.format-toolbar').boundingBox()).height, toolbar.height)
  await headingVisible(5)
  await wheel(120)
  assert.equal(await size('#preview'), previewSize)

  await page.locator('[data-mode="source"]').click()
  await page.waitForFunction(() => document.querySelectorAll('#outline-list button').length === 7)
  await outline.nth(5).click()
  await page.waitForTimeout(150)
  assert.ok(await page.locator('#source .cm-scroller').evaluate(element => element.scrollTop > 1000))
  await page.keyboard.press('End')
  await page.keyboard.insertText(' 源码定位')
  await page.waitForFunction(() => document.querySelectorAll('#outline-list button')[5]?.textContent.endsWith('源码定位'))
  await page.keyboard.press('Control+z')
  await page.waitForFunction(() => document.querySelectorAll('#outline-list button')[5]?.textContent === '同名标题')
  const sourceSize = await size('#source .cm-editor')
  const sourceBefore = await page.locator('#source .cm-scroller').evaluate(element => element.scrollTop)
  await wheel(-120)
  assert.equal(await size('#source .cm-editor'), sourceSize + 1)
  assert.ok(await page.locator('#source .cm-scroller').evaluate(element => element.scrollTop) > sourceBefore * .8, '字号调整应保留阅读位置')
  assert.equal(await page.evaluate(() => localStorage.getItem('moye-font-size')), '16')
  await page.keyboard.press('Control+0')
  await page.waitForTimeout(150)
  assert.equal(await size('#source .cm-editor'), sourceSize)

  await page.locator('[data-mode="preview"]').click()
  await outline.nth(2).click()
  const width = (await page.locator('#workspace').boundingBox()).width
  await page.locator('#outline-toggle').click()
  assert.equal(await page.locator('#outline').isVisible(), false)
  assert.ok((await page.locator('#workspace').boundingBox()).width > width)
  await page.locator('#outline-toggle').click()
  assert.equal(await page.locator('#outline').isVisible(), true)
  await headingVisible(2)
  await page.screenshot({ path: resolve(screenshots, 'outline-desktop.png') })
}
