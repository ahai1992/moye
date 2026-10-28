import assert from 'node:assert/strict'
import { resolve } from 'node:path'

export const chapterText = '### 镜022｜层级范围\n\n'
  + '- 时长：11秒\n- 资源准备\n  - 角色\n  - 场景\n- 剪辑\n\n'
  + '```text\n【视频规格】\n11秒\n\n# 代码中的标题\n- 代码中的列表\n```\n\n'
  + '#### 子标题\n\n子内容 [链接][ref]\n\n[ref]: https://example.com "引用标题"\n\n'
  + '> 引用父层\n>\n> > 引用子层\n\n'
export const hierarchyDocument = '# 范围检查\n\n'
  + Array.from({ length: 35 }, (_, i) => `前文 ${i}，保留当前位置。\n\n`).join('')
  + '## 当前章\n\n' + chapterText
  + '### 镜023｜相邻节\n\n相邻正文\n\n'
  + '下一章\n---\n\n3. 第三项\n4. 第四项\n\n'
  + Array.from({ length: 35 }, (_, i) => `后文 ${i}，不可改动。\n\n`).join('')

export async function checkHierarchy(page, screenshots, assertSaved) {
  const heading = () => page.locator('#preview h3').filter({ hasText: '镜022' })
  const dialog = page.locator('dialog.block-edit-dialog')
  const input = dialog.locator('textarea')
  const actions = page.locator('.document-view:not([hidden]) .block-actions')
  const hover = async (block, position) => {
    await block.scrollIntoViewIfNeeded()
    await block.hover(position ? { position } : {})
    await actions.waitFor({ state: 'visible' })
  }
  const open = async (block, position) => {
    await hover(block, position)
    const top = await page.locator('#preview-scroll').evaluate(element => element.scrollTop)
    await actions.locator('.block-replace').click()
    await dialog.waitFor({ state: 'visible' })
    return top
  }
  const apply = async () => {
    await dialog.getByRole('button', { name: '应用修改', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    await page.waitForTimeout(150)
  }
  const undo = async () => { await page.keyboard.press('Control+z'); await page.waitForTimeout(150) }
  const checkPosition = async top => {
    const now = await page.locator('#preview-scroll').evaluate(element => element.scrollTop)
    assert.ok(Math.abs(now - top) <= 2, `章节替换滚动变化 ${top} → ${now}`)
  }
  const copy = async (block, expected) => {
    await hover(block)
    await actions.locator('.block-copy').click()
    await page.waitForFunction(() => document.querySelector('.document-view:not([hidden]) .block-copy')?.textContent === '已复制')
    await page.evaluate(() => {
      const input = document.createElement('textarea')
      input.id = 'hierarchy-clipboard'
      input.style.cssText = 'position:fixed;left:0;top:0;z-index:20'
      document.body.append(input)
      input.focus({ preventScroll: true })
    })
    await page.keyboard.press('Control+v')
    assert.equal(await page.locator('#hierarchy-clipboard').inputValue(), expected)
    await page.locator('#hierarchy-clipboard').evaluate(element => element.remove())
  }

  await page.locator('[data-mode="preview"]').click()
  await copy(heading(), chapterText.trimEnd())
  const top = await open(heading())
  assert.equal(await input.inputValue(), chapterText.trimEnd(), '标题弹窗应包含整个子树且不包括相邻节')
  await page.screenshot({ path: resolve(screenshots, 'chapter-edit.png') })
  await apply()
  assert.equal(await page.locator('#dirty-dot').isVisible(), false)
  await checkPosition(top)

  await page.evaluate(() => {
    window.__adjacentChapter = Array.from(document.querySelectorAll('#preview h3')).find(node => node.textContent.includes('镜023'))
  })
  await open(heading())
  const changedChapter = chapterText.replace('时长：11秒', '时长：12秒').replace('【视频规格】\n11秒', '【视频规格】\n12秒')
  await input.fill(changedChapter.trimEnd())
  await apply()
  await checkPosition(top)
  assert.ok(await page.evaluate(() => window.__adjacentChapter.isConnected), '不能重建相邻章节')
  assert.equal(await page.locator('#preview p a').getAttribute('href'), 'https://example.com')
  await assertSaved(hierarchyDocument.replace(chapterText, changedChapter))
  await undo()
  await assertSaved(hierarchyDocument)
  await page.keyboard.press('Control+Shift+z')
  await page.waitForTimeout(150)
  await assertSaved(hierarchyDocument.replace(chapterText, changedChapter))
  await undo()

  const item = text => page.locator('#preview li').filter({ hasText: new RegExp(`^\\s*${text}`) }).first()
  await copy(item('时长'), '- 时长：11秒')
  await open(item('时长'))
  assert.match(await input.inputValue(), /^-\s+时长：11秒$/)
  await input.fill('- 时长：13秒')
  await apply()
  assert.equal(await page.locator('#preview > section > ul > li').count(), 3)
  assert.ok((await item('资源准备').textContent()).includes('场景'))
  await undo()

  await open(item('资源准备'), { x: 50, y: 8 })
  const parent = await input.inputValue()
  assert.ok(parent.includes('角色') && parent.includes('场景') && !parent.includes('剪辑'))
  await input.fill(parent.replace('角色', '新角色'))
  await apply()
  assert.equal(await page.locator('#preview li li').count(), 2)
  assert.ok((await item('剪辑').textContent()).includes('剪辑'))
  await undo()
  await open(item('角色'))
  assert.match((await input.inputValue()).trim(), /^-\s+角色$/)
  await input.fill('- 新角色')
  await apply()
  assert.equal(await page.locator('#preview li li').count(), 2)
  await undo()

  await open(page.locator('#preview ol > li').nth(1))
  assert.match((await input.inputValue()).trim(), /^4\.\s+第四项$/)
  await input.fill('4. 第四项修改')
  await apply()
  assert.equal(await page.locator('#preview ol > li').count(), 2)
  assert.ok((await page.locator('#preview ol > li').first().textContent()).includes('第三项'))
  await undo()

  await open(page.locator('#preview blockquote blockquote'))
  assert.ok((await input.inputValue()).includes('引用子层'))
  assert.ok(!(await input.inputValue()).includes('引用父层'))
  await page.keyboard.press('Escape')
  await open(page.locator('#preview pre'))
  assert.equal(await input.inputValue(), '【视频规格】\n11秒\n\n# 代码中的标题\n- 代码中的列表')
  await page.keyboard.press('Escape')
  await open(page.locator('#preview h2').filter({ hasText: '当前章' }))
  assert.ok((await input.inputValue()).includes('镜023'))
  assert.ok(!(await input.inputValue()).includes('下一章'))
  await page.keyboard.press('Escape')

  // 普通输入与局部替换必须共用同一撤销顺序，不能丢失原有输入历史。
  const beforeParagraph = page.locator('#preview p').filter({ hasText: /^前文 0，/ })
  const typeAtEnd = async text => {
    await beforeParagraph.evaluate(element => {
      element.closest('article').focus({ preventScroll: true })
      const range = document.createRange()
      range.selectNodeContents(element)
      range.collapse(false)
      window.getSelection().removeAllRanges()
      window.getSelection().addRange(range)
    })
    await page.keyboard.insertText(text)
    await page.waitForTimeout(150)
  }
  await typeAtEnd('前置输入')
  await open(heading())
  await input.fill(changedChapter.trimEnd())
  await apply()
  await typeAtEnd('后置输入')
  await undo()
  assert.ok(!(await beforeParagraph.textContent()).includes('后置输入'))
  await undo()
  assert.ok((await page.locator('#preview pre').textContent()).includes('11秒'))
  await undo()
  await assertSaved(hierarchyDocument)

  // 清空整篇再撤销后，章节撤销定位也应恢复。
  await open(heading())
  await input.fill(changedChapter.trimEnd())
  await apply()
  await page.locator('#preview').focus()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Backspace')
  await undo()
  assert.ok((await page.locator('#preview pre').textContent()).includes('12秒'))
  await undo()
  await assertSaved(hierarchyDocument)

  await open(heading())
  await input.fill('')
  await apply()
  assert.equal(await heading().count(), 0)
  assert.equal(await page.locator('#preview pre').count(), 0)
  assert.ok(await page.evaluate(() => window.__adjacentChapter.isConnected))
  await undo()
  await assertSaved(hierarchyDocument)
  await copy(page.locator('#preview h1'), hierarchyDocument.trimEnd())
  await open(page.locator('#preview h1'))
  assert.equal(await input.inputValue(), hierarchyDocument.trimEnd())
  await input.fill(hierarchyDocument.replace('范围检查', '全篇检查').trimEnd())
  await apply()
  await assertSaved(hierarchyDocument.replace('范围检查', '全篇检查'))
  await undo()
  await assertSaved(hierarchyDocument)
  await page.evaluate(() => { delete window.__adjacentChapter })
}
