import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Variants talk to an unchanged Taste Truce server. The server only issues its session
// cookie on GET / and rejects a POST whose Origin differs from Host, so /__session is
// rewritten to / and the Origin header is dropped on the way through.
// No default on purpose: 127.0.0.1:3000 is the live deployment, which holds real provider keys.
// Point this at a separate local server (for example one started without keys on 3210).
const backend = process.env.TASTE_TRUCE_BACKEND
if (!backend && process.argv.some((a) => a === 'dev' || a.endsWith('vite') || a === 'serve'))
  console.warn('Set TASTE_TRUCE_BACKEND to a local Taste Truce server; API requests will fail without it.')
const variants = ['ledger', 'matrix', 'atlas', 'thread']

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: {
    proxy: !backend ? undefined : {
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
      input: Object.fromEntries(variants.map((name) => [name, path.resolve(import.meta.dirname, `${name}/index.html`)])),
    },
  },
})
