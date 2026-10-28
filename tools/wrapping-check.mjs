import assert from 'node:assert/strict'
import { resolve } from 'node:path'

export const wrapDocument = '# 换行方式\n\n' + '中文长行 English words，按当前显示宽度排版。'.repeat(90)
  + '\n\n```text\n' + 'very_long_code_without_spaces_'.repeat(90) + '\n```\n'

// 两种测试入口共用：浏览器替身与真实桌面程序均须满足相同的显示约定。
export async function checkWrapping(page, screenshots) {
  const previewScroll = page.locator('#preview-scroll')
  const preview = page.locator('#preview')
  const paragraph = preview.locator('p').first()
  const setWrap = async value => {
    await page.locator(`button[data-wrap="${value}"]`).click()
    await page.waitForTimeout(120)
    assert.equal(await page.locator(`button[data-wrap="${value}"]`).getAttribute('aria-pressed'), 'true')
  }
  const dimensions = locator => locator.evaluate(element => ({
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height,
    client: element.clientWidth, scroll: element.scrollWidth,
    line: parseFloat(getComputedStyle(element).lineHeight),
  }))
  await page.locator('[data-mode="preview"]').click()
  await setWrap('window')
  const original = await preview.textContent()
  const windowSize = await dimensions(previewScroll)
  assert.ok(windowSize.scroll <= windowSize.client + 1, '按窗口换行应避免正文横向滚动')
  assert.ok((await dimensions(paragraph)).height > (await dimensions(paragraph)).line * 2)
  const chrome = await page.evaluate(() => ({
    top: document.getElementById('workspace').getBoundingClientRect().top,
    left: document.getElementById('workspace').getBoundingClientRect().left,
    width: document.getElementById('workspace').getBoundingClientRect().width,
    viewport: innerWidth,
    outline: document.getElementById('outline').getBoundingClientRect().width,
    padding: parseFloat(getComputedStyle(document.getElementById('preview')).paddingLeft),
  }))
  assert.ok(chrome.top <= (chrome.viewport >= 1050 ? 65 : 99), '顶部应只有紧凑工具栏和一行标签')
  assert.equal(chrome.left, chrome.outline)
  assert.equal(chrome.width + chrome.outline, chrome.viewport)
  assert.ok(chrome.padding <= 12, '正文两侧不应预留大块空白')

  await setWrap('none')
  const noWrap = await dimensions(previewScroll)
  const noWrapParagraph = await dimensions(paragraph)
  assert.ok(noWrap.scroll > noWrap.client * 2, '不换行应可横向滚动长行')
  assert.ok(noWrapParagraph.height <= noWrapParagraph.line + 1, '不换行的段落应显示为单行')
  await previewScroll.evaluate(element => { element.scrollLeft = 500 })
  await page.locator('[data-mode="source"]').click()
  await page.locator('[data-mode="preview"]').click()
  await page.waitForTimeout(120)
  assert.ok(Math.abs(await previewScroll.evaluate(element => element.scrollLeft) - 500) <= 2, '模式切换应保留横向位置')

  await setWrap('page')
  assert.ok(Math.abs((await dimensions(preview)).width - 210 * 96 / 25.4) < 2, '页面应为固定 A4 宽度')
  assert.equal(await preview.textContent(), original, '换行选项不能修改预览正文')
  assert.equal(await page.evaluate(() => localStorage.getItem('moye-wrap-mode')), 'page')
  await page.screenshot({ path: resolve(screenshots, 'wrap-page.png') })

  await page.locator('[data-mode="source"]').click()
  const source = page.locator('#source .cm-content')
  const sourceScroll = page.locator('#source .cm-scroller')
  await setWrap('none')
  assert.equal(await source.evaluate(element => getComputedStyle(element).whiteSpace), 'pre')
  assert.ok((await dimensions(sourceScroll)).scroll > (await dimensions(sourceScroll)).client * 2)
  await setWrap('window')
  assert.ok((await dimensions(sourceScroll)).scroll <= (await dimensions(sourceScroll)).client + 1)
  await setWrap('page')
  assert.ok(Math.abs((await dimensions(source)).width - 210 * 96 / 25.4) < 2)

  await source.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('换行后仍可撤销')
  await setWrap('window')
  await page.keyboard.press('Control+z')
  assert.ok(!await source.innerText().then(text => text.includes('换行后仍可撤销')), '换行选项不应丢失源码撤销历史')
  await page.locator('[data-mode="preview"]').click()
  await setWrap('window')
  assert.equal(await preview.textContent(), original)
}
