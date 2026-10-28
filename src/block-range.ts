export const headingSelector = 'h1, h2, h3, h4, h5, h6'
const containerSelector = 'li, blockquote, details, td, th'

export function actionBlock(element: HTMLElement | null): HTMLElement | null {
  return element?.closest<HTMLElement>('[data-kind="mermaid"], pre, table')
    ?? element?.closest<HTMLElement>(headingSelector)
    ?? element?.closest<HTMLElement>('li, blockquote, ul, ol')
    ?? element?.closest<HTMLElement>('p') ?? null
}

export function blockRange(host: HTMLElement, target: HTMLElement): Range {
  const range = document.createRange()
  range.selectNode(target)
  if (!target.matches(headingSelector)) return range
  // 引用、列表项等容器内的标题只管理该容器；代码中的 # 不是标题节点。
  const scope = target.closest(containerSelector) ?? host
  const level = Number(target.tagName[1])
  const next = Array.from(scope.querySelectorAll<HTMLElement>(headingSelector)).find(heading =>
    Boolean(target.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING)
    && (heading.closest(containerSelector) ?? host) === scope
    && Number(heading.tagName[1]) <= level)
  // 包含完整的原文包装节点，使标题、空行和引用定义能原样复制和撤销。
  const boundary = (node: HTMLElement): HTMLElement => {
    const parent = node.parentElement!
    return parent !== scope && parent.matches('section[data-block-id]')
      && Array.from(parent.childNodes).slice(0, Array.from(parent.childNodes).indexOf(node))
        .every(child => child.nodeType === Node.TEXT_NODE && !child.textContent?.trim()) ? parent : node
  }
  range.setStartBefore(boundary(target))
  if (next) range.setEndBefore(boundary(next))
  else range.setEnd(scope, scope.childNodes.length)
  return range
}

export function listItemContainer(item: HTMLElement): HTMLElement {
  const parent = item.parentElement!
  const list = parent.cloneNode(false) as HTMLElement
  if (parent instanceof HTMLOListElement) {
    list.setAttribute('start', String(parent.start + Array.from(parent.children).indexOf(item)))
  }
  list.append(item.cloneNode(true))
  const holder = document.createElement('div')
  holder.append(list)
  return holder
}
