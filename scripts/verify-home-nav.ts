/**
 * Home redesign + nav IA smoke checks (static).
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const root = join(import.meta.dirname, "..");

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

assert(existsSync(join(root, "src/components/HomeLanding.tsx")), "HomeLanding");
assert(existsSync(join(root, "src/app/upload/page.tsx")), "upload page");
assert(existsSync(join(root, "src/app/tracks/page.tsx")), "tracks page");
assert(
  existsSync(join(root, "src/app/lap-comparisons/page.tsx")),
  "lap-comparisons page",
);

const home = read("src/components/HomeLanding.tsx");
assert(
  home.includes("Compare your laps against anyone"),
  "hero headline",
);
assert(home.includes('href="/upload"'), "upload CTA");
assert(home.includes('href="/lap-comparisons"'), "comparisons CTA");
assert(home.includes("HomeLiveExample"), "live example");
assert(home.includes("HomeComparisonsGrid"), "recent comparisons");
assert(home.includes("HomeTracksColumn"), "tracks column");
assert(home.includes("How it works"), "how it works");

const header = read("src/components/AppHeader.tsx");
assert(header.includes('href: "/upload"'), "nav upload");
assert(header.includes('href: "/lap-comparisons"'), "nav comparisons");
assert(header.includes('href: "/tracks"'), "nav tracks");
assert(!header.includes(">Discover<"), "Discover removed from nav");
assert(!header.includes('href: "/friends"'), "Friends removed from nav");
assert(!header.includes('href: "/youtube"'), "YouTube removed from nav");

const live = read("src/components/HomeLiveExample.tsx");
assert(live.includes("listPublicComparisons"), "real public data");
assert(live.includes("No public lap comparisons yet"), "empty state");
assert(!/fake|demo data|placeholder lap/i.test(live), "no fake demo copy");

const auth = read("src/components/AuthForm.tsx");
assert(auth.includes('router.replace("/account")'), "signed-in lands on sessions");

const nextConfig = read("next.config.ts");
assert(
  nextConfig.includes('destination: "/lap-comparisons"'),
  "discover redirect",
);

const session = read("src/components/CloudSessionView.tsx");
assert(
  session.includes('layout="workspace"') || session.includes("100dvh"),
  "session one-screen workspace",
);
assert(session.includes("SessionLapDetail"), "in-place lap detail");
assert(session.includes("useSessionLapSelection"), "lap query selection");
assert(session.includes("LapChips"), "lap chips");
const syncedLap = read("src/components/video/SyncedLapView.tsx");
assert(syncedLap.includes("lg:grid-cols"), "session workspace side-by-side");
assert(syncedLap.includes("SessionToolsPanel"), "secondary tools drawer");
const lapPage = read("src/app/sessions/[id]/laps/[lapId]/page.tsx");
assert(lapPage.includes("legacyLapRedirectHref"), "legacy lap redirect");
assert(!lapPage.includes("CloudLapView"), "lap page no longer renders detail");

const compare = read("src/components/LapCompare.tsx");
assert(
  compare.includes("StackedCompareTelemetry") ||
    compare.includes("stackedChannels"),
  "compare stacked telemetry (no tabs)",
);
assert(!compare.includes("setChartPanel"), "compare has no chart tabs");
assert(
  compare.includes("lg:grid-cols") || compare.includes("100dvh"),
  "compare one-screen / side-by-side",
);

const trackDetail = read("src/components/TrackDirectory.tsx");
assert(trackDetail.includes('setTab("sessions")') || trackDetail.includes("setTab(item.id)"), "track tabs");

const account = read("src/components/AccountWorkbench.tsx");
assert(account.includes("My Sessions"), "account tabs");

const headerSessions = read("src/components/AppHeader.tsx");
assert(headerSessions.includes("My Sessions"), "nav My Sessions");

const accountPage = read("src/app/account/page.tsx");
assert(accountPage.includes("My Sessions"), "account page heading");

const footer = read("src/components/SiteFooter.tsx");
assert(footer.includes("My Sessions"), "footer My Sessions");

console.log("verify-home-nav: ok");
