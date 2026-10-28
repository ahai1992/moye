import { afterEach, expect, it, vi } from 'vitest'
import { DraftWriter } from '../src/drafts'
import { initialView } from '../src/document-tab'
import { invoke } from '../src/desktop'

vi.mock('../src/desktop', () => ({ invoke: vi.fn(), isDesktop: false }))
afterEach(() => { vi.clearAllMocks() })

it('慢写入期间的后续修改按顺序落盘，不被旧快照覆盖', async () => {
  let content = '第一版'
  let finishFirst!: () => void
  const writes: string[] = []
  vi.mocked(invoke).mockImplementation(async (_command, args) => {
    const snapshot = args as { tabs: { content: string }[]; sequence: number }
    writes.push(snapshot.tabs[0]!.content)
    if (writes.length === 1) await new Promise<void>(resolve => { finishFirst = resolve })
    return snapshot.sequence
  })
  const saved = vi.fn()
  const writer = new DraftWriter(() => ({ activeId: 'draft', tabs: [{ id: 'draft', content, view: initialView() }] }), saved, vi.fn())
  writer.ready = true
  const writing = writer.flush()
  content = '第二版'
  writer.schedule()
  expect(writes).toEqual(['第一版'])
  finishFirst()
  await writing
  expect(writes).toEqual(['第一版', '第二版'])
  expect(saved.mock.lastCall?.[0].tabs[0].content).toBe('第二版')
})

it('临时写入失败不会标记成功，手动重试可保存最新内容', async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error('磁盘不可写')).mockResolvedValueOnce(2)
  const saved = vi.fn()
  const writer = new DraftWriter(() => ({ activeId: 'draft', tabs: [{ id: 'draft', content: '需要恢复的内容', view: initialView() }] }), saved, vi.fn())
  writer.ready = true
  await expect(writer.flush()).rejects.toThrow('磁盘不可写')
  expect(saved).not.toHaveBeenCalled()
  await writer.flush()
  expect(saved).toHaveBeenCalledTimes(1)
})
