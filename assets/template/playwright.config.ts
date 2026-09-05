import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';
import 'dotenv/config';

const testDir = defineBddConfig({
  features: 'features/**/*.feature',
  steps: ['steps/**/*.ts', 'support/hooks.ts'],
});

export default defineConfig({
  testDir,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  retries: Number(process.env.RETRIES || (process.env.CI ? 2 : 1)),
  workers: Number(process.env.WORKERS || 2),
  outputDir: 'artifacts',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/html', open: 'never' }],
    ['json', { outputFile: 'reports/last-run.json' }],
  ],
  use: {
    baseURL: process.env.BASE_URL || '__BASE_URL__',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    // Set HEADLESS=false when a visible browser is useful for authorized debugging.
    headless: process.env.HEADLESS !== 'false',
    locale: 'en-US',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@smoke/ },
  ],
});
