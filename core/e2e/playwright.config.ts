import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Playwright's default (half the logical cores) ignores memory. Each worker
// is a Chromium instance decoding media; on a 22-core/7.5 GB host the default
// 11 workers exhaust RAM+swap and whole pages stall past their timeouts,
// while 4 workers finish the suite in the same wall time with 0 failures
// (measured - see fronts/shell-migration results). Budget ~1.75 GiB per
// worker, never above the core-based default, never below 2.
const GIB = 1024 ** 3;
const workers = Math.max(2, Math.min(
  Math.floor(os.cpus().length / 2),
  Math.floor(os.totalmem() / (1.75 * GIB)),
));
const PORT = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: './tests',
  // Bundles the media-chrome devDependency into one file before any worker
  // starts (once, not per worker) - see e2e/scripts/bundle-media-chrome.mjs
  // and result-cycle2.md's diagnosis of why this needs to happen regardless
  // of how `playwright test` is invoked.
  globalSetup: './scripts/bundle-media-chrome.mjs',
  // @network specs hit real internet hosts (YouTube); everything else is hermetic.
  grepInvert: process.env.E2E_NETWORK ? undefined : /@network/,
  grep: process.env.E2E_NETWORK ? /@network/ : undefined,
  fullyParallel: true,
  workers,
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
