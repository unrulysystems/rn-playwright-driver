import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    // RN Driver options are configured via environment variables
    // RN_METRO_URL, RN_DEVICE_ID, RN_DEVICE_NAME, RN_TIMEOUT
  },
})
