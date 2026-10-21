import { defineConfig, devices } from "@playwright/test";

/*
 * Browser tests for the dashboard UI. They run against the production build (vite preview) with
 * every /api request answered by fixtures in e2e/mock-api.ts, so they never touch real projects
 * or paid services. On Windows they use the installed Microsoft Edge; elsewhere run
 * `npx playwright install chromium` once, or set PW_CHANNEL to a browser channel you have.
 */
const channel = process.env.PW_CHANNEL ?? (process.platform === "win32" ? "msedge" : undefined);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, channel } }],
  webServer: {
    command: "pnpm exec vite build && pnpm exec vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
