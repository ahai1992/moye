import { defineConfig } from 'vitest/config'

export default defineConfig({
  clearScreen: false,
  cacheDir: '.cache/vite',
  server: { host: '127.0.0.1', port: 1420, strictPort: true, open: false },
  preview: { host: '127.0.0.1', port: 1421, strictPort: true, open: false },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
    rolldownOptions: {
      input: { main: 'index.html', note: 'note.html' },
      output: { codeSplitting: { groups: [{ name: 'math', test: /node_modules[\\/]katex/ }] } },
    },
  },
  test: { environment: 'happy-dom', setupFiles: ['tests/setup.ts'], include: ['tests/**/*.test.ts'] },
})
