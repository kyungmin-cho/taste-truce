// End-to-end tests of the built interface and /classic against a LOCAL keyless Pages server.
// Build first: (cd web && npm run build) && (cd pages && npm run build). Then, from web/:
//   npx playwright test -c e2e
// Without TT_BASE_URL the config starts e2e/serve-local.sh on TT_PORT (default 8941), seeded from the
// local Qloo response cache; it deletes its state when stopped. Any other host, and port 3000, are refused:
// never the live site.
// TT_OUT moves the report, the screenshots and the per-test Qloo tally (default: web/test-results).
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.TT_PORT || 8941)
const base = process.env.TT_BASE_URL || `http://127.0.0.1:${port}`
const url = new URL(base)
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port === '3000') throw new Error('E2E tests run against a local server only.')
const out = resolve(process.env.TT_OUT || join(import.meta.dirname, '..', 'test-results'))
process.env.TT_SHOTS = join(out, 'shots')

export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  outputDir: join(out, 'artifacts'),
  reporter: [['list'], ['html', { outputFolder: join(out, 'playwright-report'), open: 'never' }], ['json', { outputFile: join(out, 'results.json') }]],
  use: { baseURL: base, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', testMatch: 'truce.spec.ts', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'phone', testMatch: 'phone.spec.ts', use: { ...devices['iPhone 13'], browserName: 'chromium', viewport: { width: 390, height: 844 } } },
  ],
  webServer: process.env.TT_BASE_URL
    ? undefined
    : { command: `sh ../web/e2e/serve-local.sh ${port} ${join(tmpdir(), `tt-e2e-${port}`)}`, cwd: join(import.meta.dirname, '..', '..', 'pages'), url: base + '/health', timeout: 180_000, reuseExistingServer: false, gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 } },
})
