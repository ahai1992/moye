export interface OpenedDocument {
  id: string
  path: string | null
  name: string
  content: string
  lineEnding: string
}

export const isDesktop = Boolean(window.__TAURI__)

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!window.__TAURI__) throw new Error('请在墨页桌面程序中打开和保存本地文件。')
  return window.__TAURI__.core.invoke<T>(command, args)
}

export async function listen(event: string, callback: () => void): Promise<() => void> {
  if (!window.__TAURI__) return () => {}
  return window.__TAURI__.event.listen(event, callback)
}

export function friendlyError(error: unknown): string {
  const message = typeof error === 'string' ? error : error instanceof Error ? error.message : ''
  if (/[\u3400-\u9fff]/.test(message)) return message
  return '操作未完成，请稍后重试。'
}
