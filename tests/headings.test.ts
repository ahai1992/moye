import { describe, expect, it } from 'vitest'
import { markdownHeadings } from '../src/markdown'

describe('文档目录', () => {
  it('识别六级标题与下划线标题，保留重复标题的独立位置，并过滤代码、属性和公式', () => {
    const source = '---\ntitle: 测试\n# 属性中的内容\n---\n\n'
      + '```md\n# 代码里的标题\n```\n\n    ## 缩进代码\n\n$$\n# 公式里的内容\n$$\n\n'
      + '# **标题** [链接](https://example.com) `代码` &amp; ![图片](a.png)\n\n'
      + Array.from({ length: 5 }, (_, i) => `${'#'.repeat(i + 2)} 重复标题\n\n`).join('')
      + '下划线标题\n====\n\n\\# 普通文字\n\n####### 不是标题\n'
    const headings = markdownHeadings(source)
    expect(headings.map(heading => heading.level)).toEqual([1, 2, 3, 4, 5, 6, 1])
    expect(headings[0]!.text).toBe('标题 链接 代码 & 图片')
    expect(headings[6]!.text).toBe('下划线标题')
    expect(new Set(headings.map(heading => heading.from)).size).toBe(7)
    for (const heading of headings) expect(source.slice(heading.from)).toMatch(/^(?:#{1,6} |下划线标题)/)
  })

  it('引用和列表中的标题定位到实际源码，排除同名代码和引用定义', () => {
    const source = '> ```md\n> # 相同\n> ```\n>\n> # 相同\n>\n> 引用标题\n> ----\n\n'
      + '- 列表\n\n  ### 列表标题\n\n  > #### 嵌套引用\n\n# [引用][ref]\n\n[ref]: https://example.com\n'
    const headings = markdownHeadings(source)
    expect(headings.map(heading => heading.text)).toEqual(['相同', '引用标题', '列表标题', '嵌套引用', '引用'])
    expect(headings[0]!.from).toBe(source.indexOf('# 相同', source.indexOf('# 相同') + 1))
    for (const [index, text] of ['引用标题', '### 列表标题', '#### 嵌套引用', '# [引用]'].entries()) {
      expect(headings[index + 1]!.from).toBe(source.indexOf(text))
    }
  })
})
