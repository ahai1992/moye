import assert from 'node:assert/strict'
import { resolve } from 'node:path'

export const blockEditDocument = '# 局部替换检查\n\n前面的 **原始格式** 保持不变。\n\n'
  + Array.from({ length: 40 }, (_, i) => `前文第 ${i + 1} 段，保持当前位置。\n\n`).join('')
  + '当前段落 **原来的加粗** 和 [链接][ref]。\n\n'
  + '```js\n  const greeting = "hello";\nconsole.log(greeting);\n```\n\n'
  + '| 字段 | 内容 |\n| --- | --- |\n| 名称 | 旧值 |\n\n'
  + '- [x] 保留任务状态\n- [ ] 修改这一项\n\n'
  + Array.from({ length: 40 }, (_, i) => `后文第 ${i + 1} 段，不能被替换。\n\n`).join('')
  + '[ref]: https://example.com "引用标题"\n'

export async function checkBlockEditing(page, screenshots) {
  const paragraph = () => page.locator('#preview p').filter({ hasText: /^当前段落/ })
  const scroller = page.locator('#preview-scroll')
  const dialog = page.locator('dialog.block-edit-dialog')
  const open = async block => {
    await block.scrollIntoViewIfNeeded()
    await block.hover()
    const replace = page.locator('.document-view:not([hidden]) .block-replace')
    const copy = page.locator('.document-view:not([hidden]) .block-copy')
    const [left, right] = await Promise.all([replace.boundingBox(), copy.boundingBox()])
    assert.ok(left.x + left.width <= right.x, '替换按钮必须位于复制按钮左侧')
    const position = await scroller.evaluate(element => ({ top: element.scrollTop, left: element.scrollLeft }))
    await replace.click()
    await dialog.waitFor({ state: 'visible' })
    assert.equal(await page.locator('dialog[open]').count(), 1)
    return position
  }
  const assertPosition = async position => {
    await page.waitForTimeout(150)
    const after = await scroller.evaluate(element => ({ top: element.scrollTop, left: element.scrollLeft }))
    assert.ok(Math.abs(after.top - position.top) <= 2 && Math.abs(after.left - position.left) <= 2, `局部替换不能跳动滚动位置：${JSON.stringify(position)} → ${JSON.stringify(after)}`)
  }
  const apply = async () => {
    await dialog.getByRole('button', { name: '应用修改', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
  }
  const undo = async () => { await page.keyboard.press('Control+z'); await page.waitForTimeout(150) }

  await page.locator('[data-mode="preview"]').click()
  const position = await open(paragraph())
  assert.ok(position.top > 800, '必须在长文档中间验证')
  const input = dialog.locator('textarea')
  const original = '当前段落 **原来的加粗** 和 [链接][ref]。'
  assert.equal(await input.inputValue(), original, '弹窗只显示选中的段落')
  const bounds = await input.boundingBox()
  assert.ok(bounds.width >= 600 && bounds.height >= 350, '桌面弹窗应提供足够大的多行输入区')
  await input.fill('取消后不能写入的内容')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await assertPosition(position)
  assert.ok(await paragraph().innerText().then(text => text.includes('原来的加粗')))
  await open(paragraph())
  await apply()
  assert.equal(await page.locator('#dirty-dot').isVisible(), false, '未修改就确认不能将文档标为已修改')

  await page.evaluate(() => {
    const target = Array.from(document.querySelectorAll('#preview p')).find(node => node.textContent.startsWith('当前段落'))
    window.__untouchedBlocks = Array.from(document.querySelector('#preview').children).filter(node => !node.contains(target))
  })
  const editedPosition = await open(paragraph())
  await input.fill('当前段落 **新的加粗** 和 [链接][ref]。')
  await page.screenshot({ path: resolve(screenshots, 'block-edit.png') })
  await apply()
  await assertPosition(editedPosition)
  assert.equal(await paragraph().locator('strong').textContent(), '新的加粗')
  assert.equal(await paragraph().locator('a').getAttribute('href'), 'https://example.com')
  assert.ok(await page.evaluate(() => window.__untouchedBlocks.every(node => node.isConnected)), '不能重新生成其他段落')
  await undo()
  assert.equal(await paragraph().locator('strong').textContent(), '原来的加粗')

  const codePosition = await open(page.locator('#preview pre'))
  assert.equal(await input.inputValue(), '  const greeting = "hello";\nconsole.log(greeting);', '代码弹窗不显示围栏或其他段落')
  const code = '  const value = "<script>不是 HTML</script>";\nconsole.log("```");\n# 仍然属于代码'
  await input.fill(code)
  await page.keyboard.press('Control+Enter')
  await dialog.waitFor({ state: 'detached' })
  await assertPosition(codePosition)
  assert.equal(await page.locator('#preview pre code').textContent(), code)
  assert.ok((await page.locator('#preview pre code').getAttribute('class')).includes('language-js'))
  assert.equal(await page.locator('#preview script').count(), 0)
  assert.equal(await page.locator('#preview h1').count(), 1)
  await undo()
  assert.ok((await page.locator('#preview pre code').textContent()).includes('greeting'))

  await open(page.locator('#preview table'))
  assert.ok((await input.inputValue()).includes('| 名称 | 旧值 |'))
  await input.fill((await input.inputValue()).replace('旧值', '新值'))
  await apply()
  assert.ok((await page.locator('#preview table').textContent()).includes('新值'))
  await undo()
  assert.ok((await page.locator('#preview table').textContent()).includes('旧值'))

  await open(page.locator('#preview ul > li').nth(1))
  assert.match((await input.inputValue()).trim(), /^-\s+\[ \]\s+修改这一项$/)
  await input.fill((await input.inputValue()).replace('修改这一项', '已经替换'))
  await apply()
  assert.ok((await page.locator('#preview ul').textContent()).includes('已经替换'))
  assert.equal(await page.locator('#preview ul input').first().isChecked(), true)
  await undo()

  await open(paragraph())
  await input.fill('')
  await apply()
  assert.equal(await paragraph().count(), 0, '清空只删除当前段落')
  assert.equal(await page.locator('#preview pre').count(), 1)
  await undo()
  assert.equal(await paragraph().count(), 1)
  await page.evaluate(() => { delete window.__untouchedBlocks })
}
