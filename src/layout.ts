const icons: Record<string, string> = {
  document: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4M9 12h6M9 16h6"/>',
  open: '<path d="M3 7h6l2 2h10l-3 11H3z"/><path d="M3 7V4h6l2 3h7v2"/>',
  new: '<path d="M12 5v14M5 12h14"/>',
  save: '<path d="M5 3h12l4 4v14H3V3zM7 3v6h10V3M7 21v-8h10v8"/>',
  'save-as': '<path d="M4 3h12l3 3v5M4 3v18h7M7 3v6h8V3M7 20v-7h5m2 6 6-6 2 2-6 6h-2z"/>',
  temporary: '<path d="M4 3h11l4 4v4M4 3v18h6M7 3v6h8V3"/><circle cx="16" cy="17" r="5"/><path d="M16 14v3l2 1"/>',
  undo: '<path d="M8 4 3 9l5 5M3 9h11a6 6 0 0 1 0 12"/>',
  redo: '<path d="m16 4 5 5-5 5M21 9H10a6 6 0 0 0 0 12"/>',
  link: '<path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 0) scale(.9)"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M11 4v16"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18"/>',
  quote: '<path d="M4 7h6v6H5c0 3 2 4 4 4M14 7h6v6h-5c0 3 2 4 4 4"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1"/>',
  check: '<rect x="3" y="4" width="6" height="6" rx="1"/><path d="m4 6 2 2 4-5M13 7h8M13 17h8"/><rect x="3" y="14" width="6" height="6" rx="1"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
}

export function icon(name: string) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? ''}</svg>`
}

function tool(action: string, title: string, body: string, text = false) {
  return `<button type="button" class="tool${text ? ' text-tool' : ''}" data-action="${action}" title="${title}" aria-label="${title}">${body}</button>`
}

export const layout = `
  <nav class="format-toolbar" aria-label="编辑工具栏">
    <button id="outline-toggle" aria-controls="outline" aria-expanded="true" title="显示或隐藏文档目录">目录</button>
    <div class="toolbar-group" role="group" aria-label="文件">
      ${tool('new', '新建 Ctrl+N', icon('new'))}${tool('open', '打开 Ctrl+O', icon('open'))}
      ${tool('save', '保存 Ctrl+S', icon('save'))}${tool('save-as', '另存为 Ctrl+Shift+S', icon('save-as'))}
      ${tool('temporary-save', '临时保存 Ctrl+Alt+S；已有文件会创建独立草稿副本', icon('temporary'))}
    </div>
    <div class="toolbar-group">
      ${tool('undo', '撤销 Ctrl+Z', icon('undo'))}${tool('redo', '重做 Ctrl+Shift+Z', icon('redo'))}
    </div>
    <div class="toolbar-group">
      <select id="heading" aria-label="段落样式"><option value="p">正文</option><option value="h1">标题 1</option><option value="h2">标题 2</option><option value="h3">标题 3</option></select>
      ${tool('bold', '加粗 Ctrl+B', '<b>B</b>')}${tool('italic', '斜体 Ctrl+I', '<i>I</i>')}${tool('strike', '删除线', '<s>S</s>')}
    </div>
    <div class="toolbar-group">
      ${tool('quote', '引用', icon('quote'))}${tool('list', '无序列表', icon('list'))}${tool('ordered-list', '有序列表', '<span class="ordered-icon">1.</span>')}${tool('task', '任务列表', icon('check'))}
    </div>
    <div class="toolbar-group">
      ${tool('code', '代码块', icon('code'))}${tool('link', '插入链接 Ctrl+K', icon('link'))}${tool('image', '插入本地图片', icon('image'))}${tool('table', '插入表格', icon('table'))}
    </div>
    <span class="toolbar-spacer"></span>
    <div class="toolbar-group utility-tools" role="group" aria-label="应用工具">
      ${tool('notes', '便签：新建或打开独立便签窗口', '便签', true)}
      ${tool('window-colors', '设置整个主窗口的背景色和文字颜色', '配色', true)}
      ${tool('font-settings', '设置软件的文本字体和代码字体', '字体', true)}
      ${tool('associate', '关联 Markdown 文档到当前程序', '关联 MD', true)}
    </div>
    <div class="toolbar-group" role="group" aria-label="查找与替换">
      ${tool('search', '搜索 Ctrl+F', icon('search'))}${tool('replace', '替换 Ctrl+H', '替')}
      ${tool('clear-highlights', '取消当前文档的搜索高亮', '取消高亮', true)}
    </div>
    <div class="mode-switch" role="group" aria-label="编辑模式">
      <button data-mode="preview" aria-pressed="true" title="可编辑预览 Ctrl+/">预览</button>
      <button data-mode="source" aria-pressed="false" title="Markdown 源码 Ctrl+/">源码</button>
    </div>
    <div class="wrap-switch" role="group" aria-label="显示换行方式">
      <button data-wrap="none" aria-pressed="false" title="不自动换行，横向滚动查看长行">不换行</button>
      <button data-wrap="window" aria-pressed="true" title="根据当前窗口宽度自动换行">按窗口换行</button>
      <button data-wrap="page" aria-pressed="false" title="按 A4 页面宽度自动换行">按页面换行</button>
    </div>
  </nav>
  <div class="tab-bar">
    <div id="tab-strip" role="tablist" aria-label="打开的文档"></div>
    <button class="new-tab" data-action="new" title="新建标签 Ctrl+N" aria-label="新建标签">+</button>
  </div>
  <div class="editor-area">
    <aside id="outline" aria-label="文档目录">
      <div class="outline-title">目录</div>
      <div id="outline-list" aria-label="文档标题"></div>
      <p id="outline-empty">暂无标题<br>使用 #、## 等标题后<br>将在这里显示目录</p>
    </aside>
    <main id="workspace"></main>
  </div>
  <footer class="statusbar">
    <div class="status-left"><span id="dirty-dot" hidden aria-label="有未保存的修改"></span><span id="filename">未命名.md</span><span id="save-status">本地文档</span></div>
    <div class="status-right"><button id="font-size" title="Ctrl＋滚轮调整字号；点击或 Ctrl+0 恢复默认" aria-label="恢复默认字号">15 px</button><span id="word-count">0 字</span><span id="line-count">1 行</span><span id="encoding">UTF-8</span><span id="mode-label">点击文字即可编辑</span></div>
  </footer>
  <div id="toast" role="status" aria-live="polite" hidden></div>
`
