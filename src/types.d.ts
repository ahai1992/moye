declare module 'turndown-plugin-gfm' {
  import type { Plugin } from 'turndown'
  export const gfm: Plugin
}

interface Window {
  __TAURI__?: {
    core: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> }
    event: { listen<T>(event: string, callback: (event: { payload: T }) => void): Promise<() => void> }
  }
}
