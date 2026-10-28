import { defineConfig, devices } from "@playwright/test";

/**
 * Mobile + desktop e2e regression for Muse / merge gating.
 * Both projects use Chromium so CI only installs one browser binary; the
 * iPhone project still sets hasTouch/isMobile and uses tap().
 */
const baseURL =
  process.env.BASE_URL ||
  process.env.APEX_BASE_URL ||
  process.env.APEX_PROD_URL ||
  "https://apex-ashy-beta.vercel.app";

const iPhone = devices["iPhone 13"];

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
        browserName: "chromium",
        viewport: { width: 1280, height: 800 },
        hasTouch: false,
        isMobile: false,
      },
    },
    {
      name: "iphone",
      use: {
        viewport: iPhone.viewport,
        userAgent: iPhone.userAgent,
        deviceScaleFactor: iPhone.deviceScaleFactor,
        browserName: "chromium",
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
});
