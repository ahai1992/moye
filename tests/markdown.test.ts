import { describe, expect, it } from 'vitest'
import { comparableHtml, markdownBlocks, pastedHtml } from '../src/markdown'
import { PreviewEditor } from '../src/preview-editor'

function editor(value: string) {
  const host = document.createElement('article')
  const view = new PreviewEditor(host, () => {}, async () => null, error => { throw error })
  view.setValue(value)
  return { view, host }
}

describe('Markdown 无修改往返', () => {
  const documents = [
    '', '\n\n', '# 标题\n\n正文 **粗体** 与 *斜体*。\n',
    '标题\n====\n\n- [ ] 未完成\n- [x] 已完成\n\n1. A\n2. B\n',
    '| 左 | 右 |\n| :--- | ---: |\n| `a` | **b** |\n',
    '```ts\nconst x = `text`\n\nconsole.log(x)\n```\n',
    '~~~js\nconst a = 1\n~~~\n',
    '行内 $x^2$ 公式。\n\n$$\n\\frac{1}{2}\n$$\n',
    '```mermaid\ngraph LR\n A --> B\n```\n',
    '参考 [链接][ref]。\n\n[ref]: https://example.com "标题"\n',
    '脚注[^note]。\n\n[^note]: 解释内容\n    继续解释\n',
    '---\ntitle: 测试\ntags: [本地, 笔记]\n---\n\n# 文章\n',
    '> [!NOTE]\n> 提示 **文字**\n\n> 引用\n',
    '<details>\n<summary>展开</summary>\n\n内容\n\n</details>\n',
    '![本地图片](images/a%20b.png)\n\n<!-- 保留注释 -->\n',
    '\t缩进代码\n\n---\n\n最后一段',
  ]
  it.each(documents)('不编辑时不改变源文档：%s', value => {
    const { view } = editor(value)
    expect(view.getValue()).toBe(value)
  })
})

describe('预览编辑', () => {
  it('局部编辑保留文档其他位置定义的引用链接', () => {
    const blocks = markdownBlocks('修改后的 [链接][ref]。', '[ref]: https://example.com "原有标题"\n')
    const host = document.createElement('div')
    host.innerHTML = blocks[0]!.html
    expect(host.querySelector('a')?.getAttribute('href')).toBe('https://example.com')
    expect(host.querySelector('a')?.title).toBe('原有标题')
  })
  it('支持内联 HTML 的下标和键盘标记', () => {
    const { host } = editor('H<sub>2</sub>O，按 <kbd>Ctrl</kbd> 保存。\n')
    expect(host.querySelector('sub')?.textContent).toBe('2')
    expect(host.querySelector('kbd')?.textContent).toBe('Ctrl')
  })
  it('展开折叠内容不会被当成文档编辑', () => {
    const value = '<details>\n<summary>展开</summary>\n内容\n</details>\n'
    const { view, host } = editor(value)
    host.querySelector('details')!.open = true
    expect(view.getValue()).toBe(value)
  })
  it('浏览器给不可编辑节点添加空 style 时不会改写原文', () => {
    const value = '- [x] 任务\n\n公式 $x^2$。\n'
    const { view, host } = editor(value)
    host.querySelectorAll<HTMLElement>('[contenteditable="false"]').forEach(node => node.setAttribute('style', ''))
    expect(view.getValue()).toBe(value)
  })
  it('仅修改目标段落，保留其余 Markdown 原文和引用定义', () => {
    const value = '# 原始标题\n\n修改这里。\n\n```js\nlet x = 1;\n```\n\n[ref]: https://example.com\n'
    const { view, host } = editor(value)
    host.querySelector('p')!.textContent = '新的中文内容。'
    expect(view.getValue()).toBe(value.replace('修改这里。', '新的中文内容。'))
  })
  it('编辑公式所在段落不会将公式转成渲染后的文字', () => {
    const { view, host } = editor('原文 $x^2$ 结束。\n')
    host.querySelector('p')!.append('追加')
    expect(view.getValue()).toContain('$x^2$')
    expect(view.getValue()).not.toContain('katex')
  })
  it('可以直接修改表格单元格与任务状态', () => {
    const { view, host } = editor('| A | B |\n| --- | --- |\n| 旧 | 值 |\n\n- [ ] 任务\n')
    host.querySelector('td')!.textContent = '新'
    host.querySelector<HTMLInputElement>('input')!.checked = true
    const result = view.getValue()
    expect(result).toContain('新')
    expect(result).not.toContain('旧')
    expect(result).toMatch(/-\s+\[x\]\s+任务/)
  })
  it('修改代码时保留语言、换行和反引号', () => {
    const { view, host } = editor('```js\nconst a = 1\n```\n')
    host.querySelector('code')!.textContent = 'const a = "```"\nconsole.log(a)'
    expect(view.getValue()).toBe('````js\nconst a = "```"\nconsole.log(a)\n````\n')
  })
  it('新建文档中的标题和多段内容可以保存', () => {
    const { view, host } = editor('')
    host.innerHTML = '<h2>标题</h2><p>第一段</p><p>第二段</p>'
    expect(view.getValue()).toContain('## 标题\n\n第一段\n\n第二段')
  })
  it('异步图表渲染不算编辑', () => {
    const { host } = editor('```mermaid\ngraph LR\n A --> B\n```\n')
    const section = host.firstElementChild as HTMLElement
    const before = comparableHtml(section)
    const widget = host.querySelector<HTMLElement>('[data-md-source]')!
    expect(host.innerHTML).toContain('data-md-source')
    widget.dataset.rendered = 'true'
    widget.innerHTML = '<svg><path d="M0 0"/></svg>'
    expect(comparableHtml(section)).toBe(before)
  })
  it('转换后的本地图片地址不会覆盖 Markdown 中的相对路径', () => {
    const { view, host } = editor('说明 ![图片](images/photo.png)\n')
    host.querySelector<HTMLImageElement>('img')!.src = 'data:image/png;base64,AAAA'
    host.querySelector('p')!.append('追加')
    expect(view.getValue()).toContain('![图片](images/photo.png)')
  })
})

describe('安全的文档 HTML 与粘贴', () => {
  it('清除脚本、事件和危险链接', () => {
    const html = markdownBlocks('<img src="x" onerror="alert(1)"><script>alert(1)</script>\n\n[危险](javascript:alert%281%29)').map(block => block.html).join('')
    expect(html).not.toMatch(/onerror|<script|href="javascript:/)
  })
  it('文档不能伪造受保护的 Markdown 内部节点', () => {
    const html = markdownBlocks('<span data-md-source="伪造内容" contenteditable="false">正文</span>').map(block => block.html).join('')
    expect(html).not.toContain('data-md-source')
    expect(html).not.toContain('contenteditable')
  })
  it('粘贴内容不携带内部标记、脚本或样式', () => {
    const html = pastedHtml('<p data-block-id="1" style="position:fixed" onclick="alert(1)">文本<strong>粗体</strong></p>')
    expect(html).toBe('<p>文本<strong>粗体</strong></p>')
  })
})
