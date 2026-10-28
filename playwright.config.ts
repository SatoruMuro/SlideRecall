import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    actionTimeout: 15_000,
    baseURL: "http://127.0.0.1:4173/SlideRecall/",
    trace: "off",
    screenshot: "off",
    video: "off",
    serviceWorkers: "allow",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173/SlideRecall/",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
