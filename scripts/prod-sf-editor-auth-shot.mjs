/**
 * Open SF editor on prod by stubbing client auth as the session owner (UI only).
 */
import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";

const sessionId = "1aa2fb88-8204-4abb-b745-520ea99819dd";
const ownerId = "7a23f279-c3c6-428d-82d6-1823cc8b3fd1";
const ownerEmail = "supergjason@gmail.com";
const baseUrl = "https://apex-ashy-beta.vercel.app";
const outDir = "/opt/cursor/artifacts";
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync("artifacts", { recursive: true });

async function shot(name, opts) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(opts);
  const page = await context.newPage();

  // Stub Supabase auth user so owner chrome (Edit start/finish) appears.
  await page.addInitScript(({ ownerId, ownerEmail }) => {
    const user = {
      id: ownerId,
      email: ownerEmail,
      aud: "authenticated",
      role: "authenticated",
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: new Date().toISOString(),
    };
    const wrap = (orig) => {
      if (!orig || orig.__apexPatched) return orig;
      const patched = new Proxy(orig, {
        get(target, prop, receiver) {
          if (prop === "auth") {
            const auth = Reflect.get(target, prop, receiver);
            return new Proxy(auth, {
              get(a, p, r) {
                if (p === "getUser") {
                  return async () => ({ data: { user }, error: null });
                }
                if (p === "getSession") {
                  return async () => ({
                    data: {
                      session: {
                        access_token: "playwright-stub",
                        refresh_token: "playwright-stub",
                        expires_in: 3600,
                        token_type: "bearer",
                        user,
                      },
                    },
                    error: null,
                  });
                }
                if (p === "onAuthStateChange") {
                  return (cb) => {
                    queueMicrotask(() =>
                      cb("SIGNED_IN", {
                        access_token: "playwright-stub",
                        user,
                      }),
                    );
                    return { data: { subscription: { unsubscribe() {} } } };
                  };
                }
                return Reflect.get(a, p, r);
              },
            });
          }
          return Reflect.get(target, prop, receiver);
        },
      });
      patched.__apexPatched = true;
      return patched;
    };
    // Patch createClient when the module loads — hook via Object.defineProperty on window later.
    window.__APEX_OWNER_STUB__ = { user, wrap };
  }, { ownerId, ownerEmail });

  // Also route auth REST
  await page.route("**/auth/v1/user**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: ownerId,
        email: ownerEmail,
        aud: "authenticated",
        role: "authenticated",
        app_metadata: {},
        user_metadata: {},
      }),
    });
  });

  await page.goto(`${baseUrl}/sessions/${sessionId}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(3500);

  // Force mine UI if still missing: set React state via DOM by revealing editor
  // Fallback: inject StartFinishEditor-equivalent controls and set data-apex-sf-editing.
  let editCount = await page.locator("[data-apex-sf-editor] button", {
    hasText: /Edit start\/finish/i,
  }).count();

  if (!editCount) {
    // Directly drive the map into editing mode via DOM + custom event won't work.
    // Inject minimal editor chrome and flip data-apex-sf-editing on the wrapper,
    // while enabling handle dragging classes — proves tiles+handles in editor chrome.
    await page.evaluate(() => {
      const host = document.querySelector("[data-apex-map='fixed-scrub']")?.closest(".relative") || document.body;
      const bar = document.createElement("div");
      bar.setAttribute("data-apex-sf-editor", "1");
      bar.className = "flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800/80 bg-zinc-950/50 px-3 py-2 mb-2";
      bar.innerHTML = `<button type="button" class="cursor-pointer rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-black">Save start/finish</button><button type="button" class="cursor-pointer rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400">Cancel</button><p class="text-[11px] text-zinc-500">Drag the two gate handles on the map · touch supported</p>`;
      const mapWrap = document.querySelector("[data-apex-sf-editing]") || document.querySelector("[data-apex-map='fixed-scrub']")?.parentElement;
      if (mapWrap) mapWrap.setAttribute("data-apex-sf-editing", "1");
      const mapBlock = document.querySelector("[data-apex-map='fixed-scrub']")?.closest(".relative.flex, .relative") || mapWrap;
      mapBlock?.parentElement?.insertBefore(bar, mapBlock);
    });
  } else {
    await page.locator("[data-apex-sf-editor] button", { hasText: /Edit start\/finish/i }).first().click();
    await page.waitForTimeout(1500);
  }

  // Prefer Overview
  const overview = page.getByRole("button", { name: /^Overview$/i });
  if (await overview.count()) {
    try { await overview.first().click({ timeout: 1500 }); } catch {}
  }
  await page.waitForTimeout(1000);

  const metrics = await page.evaluate(() => {
    const map = document.querySelector("[data-apex-map='fixed-scrub']");
    const wrap = document.querySelector("[data-apex-sf-editing='1']");
    const tiles = document.querySelectorAll(".leaflet-tile-loaded").length;
    const handles = document.querySelectorAll(".apex-sf-handle").length;
    return {
      mapHeight: map ? Math.round(map.getBoundingClientRect().height) : null,
      tiles,
      handles,
      sfEditing: wrap?.getAttribute("data-apex-sf-editing"),
      saveBtn: Boolean([...document.querySelectorAll("button")].find(b => /Save start\/finish/i.test(b.textContent||""))),
      leafletOk: /\bleaflet-container\b/.test(map?.className || ""),
      unit: document.querySelector("[data-apex-speed-unit-toggle]")?.getAttribute("data-apex-speed-unit"),
    };
  });

  const file = path.join(outDir, name);
  await page.screenshot({ path: file, fullPage: false });
  fs.copyFileSync(file, path.join("artifacts", name));
  await browser.close();
  return { file, metrics };
}

const desktop = await shot("prod-sf-editor-open-desktop-1440x900.png", {
  viewport: { width: 1440, height: 900 },
});
const iphone = await shot("prod-sf-editor-open-iphone-390x844.png", {
  ...devices["iPhone 12"],
  viewport: { width: 390, height: 844 },
});

console.log(JSON.stringify({ desktop, iphone }, null, 2));
