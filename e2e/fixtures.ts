import { test as base, expect, type Page } from "@playwright/test";

/** Public session with GPS used across Apex QA scripts. */
export const SESSION_ID =
  process.env.APEX_SESSION_ID || "340f914a-49f7-4c6e-bccc-33a3fe2de689";

export const COMPARE_ID =
  process.env.APEX_COMPARE_ID || "b3d74813-1ad5-4786-a47a-887cc049b60e";

export const DRIVE_TRACK = process.env.APEX_DRIVE_TRACK || "thunderhill-west";

export const PRIMARY_NAV = [
  "home",
  "upload",
  "session",
  "compare",
  "drive",
] as const;

/** Optional Vercel share-cookie bypass for protected previews. */
export async function applyVercelShare(page: Page) {
  const share = process.env.VERCEL_SHARE || process.env.VERCEL_SHARE_COOKIE;
  if (!share) return;
  const base =
    process.env.BASE_URL ||
    process.env.APEX_BASE_URL ||
    process.env.APEX_PROD_URL ||
    "https://apex-ashy-beta.vercel.app";
  const host = new URL(base).hostname;
  await page.context().addCookies([
    {
      name: "_vercel_share",
      value: share.replace(/^_vercel_share=/, ""),
      domain: host,
      path: "/",
    },
  ]);
}

/** Tap on touch projects; click on desktop. */
export async function activate(
  page: Page,
  locator: ReturnType<Page["locator"]>,
) {
  const target = locator.first();
  await target.waitFor({ state: "visible", timeout: 30_000 });
  const isTouch = await page.evaluate(
    () => "ontouchstart" in window || navigator.maxTouchPoints > 0,
  );
  if (isTouch) {
    await target.tap({ timeout: 10_000 });
  } else {
    await target.click({ timeout: 10_000 });
  }
}

/**
 * Assert one finger tap / click fires exactly one click on the target.
 * iPhone uses touchscreen.tap(); desktop uses click().
 */
export async function assertSingleActivate(
  page: Page,
  locator: ReturnType<Page["locator"]>,
  opts: { useTap: boolean },
) {
  const el = locator.first();
  await el.waitFor({ state: "visible", timeout: 30_000 });
  const box = await el.boundingBox();
  expect(box, "target must have a bounding box").toBeTruthy();
  const handle = await el.elementHandle();
  expect(handle, "target must resolve to an element").toBeTruthy();

  await page.evaluate((node) => {
    const n = node as HTMLElement;
    n.dataset.apexTapClicks = "0";
    n.addEventListener(
      "click",
      (event) => {
        // Keep multi-control suites on the same page.
        event.preventDefault();
        event.stopPropagation();
        n.dataset.apexTapClicks = String(
          Number(n.dataset.apexTapClicks || "0") + 1,
        );
      },
      { capture: true },
    );
  }, handle!);

  if (opts.useTap) {
    await page.touchscreen.tap(
      box!.x + box!.width / 2,
      box!.y + box!.height / 2,
    );
  } else {
    await el.click({ timeout: 10_000 });
  }
  await page.waitForTimeout(120);

  const clicks = await page.evaluate(
    (node) => Number((node as HTMLElement).dataset.apexTapClicks || "0"),
    handle!,
  );
  expect(clicks, "primary control must fire exactly one click").toBe(1);
}

export async function gotoReady(page: Page, path: string) {
  await applyVercelShare(page);
  await page.goto(path, { waitUntil: "domcontentloaded", timeout: 90_000 });
}

export const test = base.extend<{ useTap: boolean }>({
  // Playwright fixture runner (not React's `use` hook).
  useTap: async ({}, provide, testInfo) => {
    await provide(testInfo.project.name === "iphone");
  },
});

export { expect };
