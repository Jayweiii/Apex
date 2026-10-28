import { defineConfig, devices } from "@playwright/test";

/**
 * Mobile + desktop e2e regression for Muse / merge gating.
 * Targets a live BASE_URL (prod or preview) — no local Next boot required.
 */
const baseURL =
  process.env.BASE_URL ||
  process.env.APEX_BASE_URL ||
  process.env.APEX_PROD_URL ||
  "https://apex-ashy-beta.vercel.app";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: process.env.CI
    ? [["list"], ["github"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 90_000,
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        hasTouch: false,
        isMobile: false,
      },
    },
    {
      name: "iphone",
      use: {
        ...devices["iPhone 13"],
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
});
