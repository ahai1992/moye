export function highlightWords(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((word): word is string => typeof word === 'string' && Boolean(word.trim())))] : []
}

// 旧版的选区底色升级为关键词；只在打开便签、开始编辑前处理 DOM。
export function migrateNoteHighlights(root: HTMLElement): string[] {
  const words: string[] = []
  root.querySelectorAll<HTMLElement>('mark, [style]').forEach(element => {
    const background = element.style.backgroundColor
    if (element.tagName === 'MARK' || background && !['transparent', 'rgba(0, 0, 0, 0)'].includes(background)) {
      if (element.textContent?.trim()) words.push(element.textContent)
    }
    element.removeAttribute('style')
    if (element.tagName === 'MARK') element.replaceWith(...element.childNodes)
  })
  return highlightWords(words)
}

export const supportsNoteHighlights = typeof Highlight !== 'undefined' && 'highlights' in CSS

export function renderNoteHighlights(root: HTMLElement, words: string[]) {
  if (!supportsNoteHighlights) return
  const highlight = new Highlight()
  if (!words.length) { CSS.highlights.set('note-keywords', highlight); return }
  const chunks: { node: Text; start: number; end: number }[] = []
  const parts: string[] = []
  let length = 0
  let newline = true
  const lineBreak = () => {
    if (!newline) { parts.push('\n'); length++; newline = true }
  }
  const visit = (node: Node) => {
    if (node instanceof Text) {
      if (!node.length) return
      chunks.push({ node, start: length, end: length + node.length })
      parts.push(node.data)
      length += node.length
      newline = node.data.endsWith('\n')
    } else if (node instanceof HTMLElement) {
      if (node.tagName === 'BR') { parts.push('\n'); length++; newline = true; return }
      const block = node !== root && ['DIV', 'P'].includes(node.tagName)
      if (block) lineBreak()
      node.childNodes.forEach(visit)
      if (block) lineBreak()
    }
  }
  visit(root)
  const text = parts.join('')
  // 合并相邻、重叠的匹配，长便签中重复单字也不会创建同等数量的 Range。
  const changes = new Int32Array(text.length + 1)
  for (const word of words) {
    let index = text.indexOf(word)
    while (index !== -1) {
      changes[index] = changes[index]! + 1
      changes[index + word.length] = changes[index + word.length]! - 1
      index = text.indexOf(word, index + 1)
    }
  }
  const endpoint = (offset: number, end: boolean) => {
    let low = 0, high = chunks.length
    while (low < high) {
      const middle = (low + high) >>> 1
      const chunk = chunks[middle]!
      if (end ? chunk.start < offset : chunk.end <= offset) low = middle + 1
      else high = middle
    }
    const chunk = chunks[end ? low - 1 : low]
    return chunk && { node: chunk.node, offset: Math.max(0, Math.min(chunk.node.length, offset - chunk.start)) }
  }
  let active = 0, start = 0
  for (let index = 0; index < changes.length; index++) {
    const previous = active
    active += changes[index]!
    if (!previous && active) start = index
    if (previous && !active) {
      const first = endpoint(start, false), last = endpoint(index, true)
      if (!first || !last) continue
      const range = document.createRange()
      range.setStart(first.node, first.offset)
      range.setEnd(last.node, last.offset)
      highlight.add(range)
    }
  }
  // 只替换绘制范围，不修改正文节点、选区、撤销记录或滚动位置。
  CSS.highlights.set('note-keywords', highlight)
}
