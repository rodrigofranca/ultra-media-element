import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: './tests',
  // @network specs hit real internet hosts (YouTube); everything else is hermetic.
  grepInvert: process.env.E2E_NETWORK ? undefined : /@network/,
  grep: process.env.E2E_NETWORK ? /@network/ : undefined,
  fullyParallel: true,
  // Real video decode under many concurrent Chromium instances causes CPU
  // contention that makes hls.js/dash.js emit transient, non-fatal buffer
  // stall errors (see result.md "Descobertas" - hls-player.ts/dash-player.ts
  // forward every SDK error, fatal or not, as the element's `error` event).
  // A couple of workers keeps the suite deterministic without going fully
  // serial.
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : [['list']],
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `node server/static-server.mjs`,
    cwd: __dirname,
    env: { PORT: String(PORT) },
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
});
