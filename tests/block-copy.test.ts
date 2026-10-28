import { expect, it } from 'vitest'
import { blockText } from '../src/block-copy'
import { PreviewEditor } from '../src/preview-editor'
import { actionBlock, blockRange } from '../src/block-range'

it('复制代码保留缩进、换行及特殊字符，正文复制不包含格式标签或公式渲染碎片', () => {
  const host = document.createElement('article')
  const editor = new PreviewEditor(host, () => {}, async () => null, error => { throw error })
  const markdown = '```js\n\tconst value = "<test>&";\n  console.log(value)\n```\n\n'
    + '**加粗**、[链接](https://example.com) 和 $x^2$。\n\n- [x] 完成\n- [ ] 待办\n\n| A | B |\n| --- | --- |\n| 甲 | 乙 |\n'
  editor.setValue(markdown)
  expect(blockText(host.querySelector('pre')!)).toBe('\tconst value = "<test>&";\n  console.log(value)')
  expect(blockText(host.querySelector('p')!)).toBe('加粗、链接 和 $x^2$。')
  expect(blockText(host.querySelector('ul')!)).toBe('- [x] 完成\n- [ ] 待办')
  expect(blockText(host.querySelector('table')!)).toBe('A\tB\n甲\t乙')
  expect(editor.getValue()).toBe(markdown)
  editor.destroy()
})

it('局部替换弹窗仅取得当前块；取消和不修改不改变原文', async () => {
  const scroller = document.createElement('div')
  const host = document.createElement('article')
  scroller.append(host)
  document.body.append(scroller)
  const inputs: { value: string; kind: string }[] = []
  const editor = new PreviewEditor(host, () => {}, async (value, kind) => {
    inputs.push({ value, kind })
    return kind === 'block' ? value : null
  }, error => { throw error })
  const markdown = '# 标题\n\n只修改 **这个段落**。\n\n```js\n  const x = 1;\n```\n\n后面的段落。\n'
  editor.setValue(markdown)
  await editor.replaceBlock(host.querySelector('p')!)
  await editor.replaceBlock(host.querySelector('pre')!)
  expect(inputs).toEqual([
    { value: '只修改 **这个段落**。', kind: 'block' },
    { value: '  const x = 1;', kind: 'code-block' },
  ])
  expect(editor.getValue()).toBe(markdown)
  editor.destroy()
  scroller.remove()
})

it('六级标题复制包含下级内容，到同级或上级标题为止，代码中的标题不划分章节', () => {
  for (let level = 1; level <= 6; level++) {
    const host = document.createElement('article')
    const editor = new PreviewEditor(host, () => {}, async () => null, error => { throw error })
    const chapter = `${'#'.repeat(level)} 目标\n\n- 第一项\n- 第二项\n\n`
      + '```text\n# 代码不是标题\n\n代码中的空行\n```\n\n'
      + (level < 6 ? `${'#'.repeat(level + 1)} 子标题\n\n子内容\n\n` : '')
    editor.setValue(chapter + `${'#'.repeat(level)} 下一节\n\n不包含\n`)
    expect(editor.copyBlock(host.querySelector<HTMLElement>(`h${level}`)!)).toBe(chapter.trimEnd())
    expect(editor.getValue()).toContain('下一节')
    editor.destroy()
  }
})

it('下划线标题、引用定义和已有预览修改都参与章节范围', () => {
  const host = document.createElement('article')
  const editor = new PreviewEditor(host, () => {}, async () => null, error => { throw error })
  const chapter = '一级标题\n===\n\n二级标题\n---\n\n[链接][ref]\n\n[ref]: https://example.com\n\n'
  editor.setValue(chapter + '# 下一节\n\n正文')
  expect(editor.copyBlock(host.querySelector('h1')!)).toBe(chapter.trimEnd())
  host.querySelector('h2')!.append('已修改')
  expect(editor.copyBlock(host.querySelector('h1')!)).toContain('## 二级标题已修改')
  expect(editor.copyBlock(host.querySelector('h1')!)).not.toContain('下一节')
  editor.destroy()
})

it('列表项各自独立，父项包含子项，有序项保留序号，代码仍为独立块', () => {
  const host = document.createElement('article')
  const editor = new PreviewEditor(host, () => {}, async () => null, error => { throw error })
  editor.setValue('- 父项\n  - 子项\n- 相邻项\n\n3. 第三项\n4. 第四项\n\n> 引用\n>\n> ```text\n> # 代码\n> ```\n')
  const parent = host.querySelector('li')!
  const child = parent.querySelector('li')!
  expect(actionBlock(child)).toBe(child)
  expect(editor.copyBlock(parent)).toContain('子项')
  expect(editor.copyBlock(parent)).not.toContain('相邻项')
  expect(editor.copyBlock(child)).toBe('- 子项')
  expect(editor.copyBlock(host.querySelectorAll<HTMLElement>('ol li')[1]!)).toBe('4. 第四项')
  expect(actionBlock(host.querySelector('pre code'))).toBe(host.querySelector('pre'))
  editor.destroy()
})

it('引用内标题不能越过当前引用，外层章节包含嵌套引用但不被其中的标题截断', () => {
  const host = document.createElement('article')
  const editor = new PreviewEditor(host, () => {}, async () => null, error => { throw error })
  editor.setValue('## 外层\n\n> ### 引用标题\n>\n> 引用正文\n>\n> > # 内层引用\n> >\n> > 内层正文\n\n外面的正文\n\n## 后一节\n')
  const inner = host.querySelector('h3')!
  expect(actionBlock(inner)).toBe(inner)
  const range = blockRange(host, inner)
  expect(range.toString()).toContain('引用正文')
  expect(range.toString()).not.toContain('外面的正文')
  expect(editor.copyBlock(host.querySelector('h2')!)).toContain('外面的正文')
  expect(editor.copyBlock(host.querySelector('h2')!)).not.toContain('后一节')
  editor.destroy()
})
