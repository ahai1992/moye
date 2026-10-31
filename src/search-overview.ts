export class SearchOverview {
  private canvas = document.createElement('canvas')
  private positions: number[] = []
  constructor(parent: HTMLElement, private jump: (index: number) => void) {
    this.canvas.className = 'search-overview'
    this.canvas.title = '绿色标记为搜索匹配，点击跳转'
    this.canvas.setAttribute('aria-label', '搜索匹配位置')
    parent.append(this.canvas)
    this.canvas.addEventListener('click', event => {
      const target = (event.clientY - this.canvas.getBoundingClientRect().top) / this.canvas.clientHeight
      let index = -1, distance = Infinity
      this.positions.forEach((position, current) => { if (Math.abs(position - target) < distance) { distance = Math.abs(position - target); index = current } })
      if (index >= 0) this.jump(index)
    })
  }
  render(positions: number[], scrollbarWidth = 0) {
    this.positions = positions
    this.canvas.style.right = `${scrollbarWidth}px`
    this.canvas.hidden = !positions.length
    const height = this.canvas.clientHeight
    this.canvas.width = 8; this.canvas.height = Math.max(1, height)
    const ctx = this.canvas.getContext('2d')!
    ctx.fillStyle = '#22a447'
    for (const position of positions) ctx.fillRect(1, Math.max(0, Math.min(height - 3, position * height)), 6, 3)
  }
  destroy() { this.canvas.remove() }
}
