// 只接管编辑正文的选区；工具栏、搜索框及 CodeMirror 仍使用各自的复制逻辑。
export function plainTextClipboard(root: HTMLElement) {
  const copy = (event: ClipboardEvent) => {
    const selection = window.getSelection()
    if (!event.clipboardData || !selection?.rangeCount || selection.isCollapsed
      || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return
    event.preventDefault()
    event.clipboardData.clearData()
    event.clipboardData.setData('text/plain', selection.toString())
    if (event.type === 'cut') document.execCommand('delete')
  }
  root.addEventListener('copy', copy)
  root.addEventListener('cut', copy)
}
