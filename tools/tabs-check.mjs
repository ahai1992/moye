import assert from 'node:assert/strict'

export async function checkTabs(page) {
  await page.setViewportSize({ width: 1100, height: 820 })
  const selectedId = () => page.locator('[role="tab"][aria-selected="true"]').getAttribute('data-tab')
  const select = async id => {
    await page.locator(`[data-tab="${id}"]`).click()
    await page.waitForFunction(() => !document.querySelector('[data-action="save"]').disabled)
  }
  const type = async text => {
    await page.locator('#preview p').first().click()
    await page.keyboard.press('End')
    await page.keyboard.insertText(text)
    await page.waitForTimeout(150)
  }
  await page.keyboard.press('Control+n')
  await page.waitForFunction(() => !document.querySelector('[data-action="save"]').disabled)
  const first = await selectedId()
  await type('临时文档甲，不能被其他标签的撤销修改。')
  await page.keyboard.press('Control+n')
  await page.waitForFunction(() => !document.querySelector('[data-action="save"]').disabled)
  const second = await selectedId()
  await type('临时文档乙。')
  await page.waitForFunction(({ first, second }) => {
    const tabs = window.__nativeTest.workspace?.tabs ?? []
    return tabs.find(tab => tab.id === first)?.content?.includes('临时文档甲') && tabs.find(tab => tab.id === second)?.content?.includes('临时文档乙')
  }, { first, second })
  const snapshots = await page.evaluate(() => window.__nativeTest.workspace.tabs)
  for (const tab of snapshots) {
    const hasPath = await page.evaluate(id => Boolean(window.__nativeTest.documents[id]?.path), tab.id)
    if (hasPath) assert.equal(tab.content, null, '已有文件绝不能自动保存内容副本')
  }

  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  await select(first)
  assert.ok(await page.locator('#preview').innerText().then(text => text.includes('临时文档甲')), '预览撤销不能修改另一个标签')
  await page.locator('[data-mode="source"]').click()
  await page.locator('#source .cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('\n源码甲')
  await select(second)
  await page.locator('[data-mode="source"]').click()
  await page.locator('#source .cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('\n源码乙')
  await page.keyboard.press('Control+z')
  await select(first)
  assert.ok(await page.locator('#source').innerText().then(text => text.includes('源码甲')), '源码撤销必须属于当前标签')
  await page.locator('[data-action="temporary-save"]').click()
  await page.waitForFunction(() => !document.querySelector('[data-action="save"]').disabled)
  assert.ok(await page.locator('#save-status').innerText().then(text => text.includes('已自动暂存')))
  await page.locator(`[data-close-tab="${first}"]`).click()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal(await selectedId(), first)
  await page.locator(`[data-close-tab="${first}"]`).click()
  await page.getByRole('button', { name: '不保存', exact: true }).click()
  await page.waitForFunction(id => !document.querySelector(`[data-tab="${id}"]`), first)
  await page.waitForFunction(id => !window.__nativeTest.workspace.tabs.some(tab => tab.id === id), first)
}
