import { invoke } from './desktop'
import type { ViewState } from './document-tab'

export interface WorkspaceSnapshot {
  activeId: string
  tabs: { id: string; content: string | null; view: ViewState }[]
}

// 同时最多写一个快照，输入期间的新请求在写入结束后合并处理。
export class DraftWriter {
  ready = false
  private sequence = 0
  private pending = false
  private timer?: ReturnType<typeof setTimeout>
  private flight: Promise<void> | null = null
  private suspended = false

  constructor(
    private snapshot: () => WorkspaceSnapshot,
    private saved: (snapshot: WorkspaceSnapshot) => void,
    private failed: (error: unknown) => void,
  ) {}

  schedule() {
    if (!this.ready) return
    this.pending = true
    // 不反复重置计时器，连续输入也会定期写入。
    if (!this.suspended && !this.timer && !this.flight) this.timer = setTimeout(() => { void this.flush().catch(this.failed) }, 800)
  }

  suspend(value: boolean) {
    this.suspended = value
    if (value) { clearTimeout(this.timer); this.timer = undefined }
    else if (this.pending) this.schedule()
  }

  async idle() { await this.flight }

  async flush(): Promise<void> {
    if (!this.ready) throw new Error('临时保存暂不可用，请将文档保存为文件。')
    clearTimeout(this.timer)
    this.timer = undefined
    this.pending = true
    if (this.flight) {
      await this.flight
      if (this.pending) await this.flush()
      return
    }
    this.flight = this.drain()
    try { await this.flight }
    finally { this.flight = null }
  }

  private async drain() {
    while (this.pending) {
      const snapshot = this.snapshot()
      this.pending = false
      await invoke('save_workspace', { ...snapshot, sequence: ++this.sequence })
      this.saved(snapshot)
    }
  }
}
