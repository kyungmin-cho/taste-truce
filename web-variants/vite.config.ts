import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Variants talk to an unchanged Taste Truce server. The server only issues its session
// cookie on GET / and rejects a POST whose Origin differs from Host, so /__session is
// rewritten to / and the Origin header is dropped on the way through.
const backend = process.env.TASTE_TRUCE_BACKEND ?? 'http://127.0.0.1:3000'
const variants = ['ledger', 'matrix', 'atlas', 'thread']

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    proxy: {
      '/__session': { target: backend, rewrite: () => '/' },
      '/api': {
        target: backend,
        configure: (proxy) => proxy.on('proxyReq', (req) => req.removeHeader('origin')),
      },
      '/scene': backend,
      '/health': backend,
    },
  },
  build: {
    rollupOptions: {
      input: Object.fromEntries(variants.map((name) => [name, path.resolve(__dirname, `${name}/index.html`)])),
    },
  },
})
