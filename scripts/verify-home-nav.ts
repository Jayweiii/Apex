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
assert(session.includes("lg:grid-cols"), "session side-by-side");

const compare = read("src/components/LapCompare.tsx");
assert(compare.includes("chartPanel"), "compare chart tabs");
assert(compare.includes("lg:grid-cols-2"), "compare side-by-side");

const trackDetail = read("src/components/TrackDirectory.tsx");
assert(trackDetail.includes('setTab("sessions")') || trackDetail.includes("setTab(item.id)"), "track tabs");

const account = read("src/components/AccountWorkbench.tsx");
assert(account.includes("Sessions"), "account tabs");

console.log("verify-home-nav: ok");
