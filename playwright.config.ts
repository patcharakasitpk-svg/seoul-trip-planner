import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30000,
  use: { baseURL: 'http://localhost:4179', timezoneId: 'America/New_York', locale: 'th-TH', channel: process.env.PW_CHANNEL ?? 'chrome' },
  webServer: { command: 'npx vite preview --port 4179 --strictPort', url: 'http://localhost:4179', reuseExistingServer: true },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'], timezoneId: 'America/New_York', channel: process.env.PW_CHANNEL ?? 'chrome' } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
  ],
});
