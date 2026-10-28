/**
 * Static + live checks: signed-out visitors can browse public data.
 * Live REST uses the published anon key against the Apex project when reachable.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = resolve(__dirname, "..");

function read(rel: string) {
  return readFileSync(resolve(root, rel), "utf8");
}

// Legacy /friends redirects to Account → Friends management.
const friends = read("src/app/friends/page.tsx");
assert(
  friends.includes('"/account"') && friends.includes("redirect"),
  "friends page redirects into Account",
);
const lapComparisons = read("src/components/LapComparisonsPage.tsx");
assert(
  !/if\s*\(\s*!user\s*\)\s*\{\s*return\s*\(/m.test(lapComparisons),
  "lap comparisons feed must not early-return when !user",
);
assert(
  lapComparisons.includes('eq("visibility", "public")'),
  "friends/public feed filters public for anon",
);
assert(
  read("src/components/AppHeader.tsx").includes("Lap Comparisons"),
  "nav labels Lap Comparisons",
);
assert(
  !read("src/components/AppHeader.tsx").includes('href="/friends"'),
  "Friends tab removed from nav",
);
assert(
  !read("src/components/AppHeader.tsx").includes('href="/youtube"'),
  "YouTube catalog removed from nav",
);

// Leaderboard must query cloud sessions without requiring a user.
const leaderboard = read("src/components/LeaderboardPanel.tsx");
assert(
  !/if\s*\(\s*user\s*\)\s*\{[\s\S]*?\.from\(\s*"sessions"\s*\)/.test(leaderboard),
  "leaderboard must not gate cloud query behind if (user)",
);
assert(
  leaderboard.includes('from("sessions")'),
  "leaderboard still queries sessions",
);

// Cloud views: no hard "sign-in" error branch for missing public rows.
for (const file of [
  "src/components/CloudSessionView.tsx",
  "src/components/CloudCompareView.tsx",
]) {
  const src = read(file);
  assert(
    !/setError\(\s*user\s*\?\s*"not-found"\s*:\s*"sign-in"\s*\)/.test(src),
    `${file} must not map missing rows to sign-in for anon`,
  );
  assert(
    !/error\s*===\s*"sign-in"/.test(src),
    `${file} must not render a sign-in error wall`,
  );
}

// Proxy must not redirect unsigned visitors away from browse routes.
const proxy = read("src/lib/supabase/proxy.ts");
assert(
  !/!user[\s\S]*redirect/.test(proxy),
  "supabase proxy must not redirect when !user",
);

// Home exposes PublicCloudSessions for anon browse.
const home = read("src/components/TrackDirectory.tsx");
assert(
  home.includes("<PublicCloudSessions"),
  "home/track pages list PublicCloudSessions",
);

const PUBLIC_SESSION = "5edf9ab3-f0b4-4c24-a91e-d6c8ed9636e2";
const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://xhysarrdspledfenabnz.supabase.co";
const anon =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  "";

async function liveAnonRead() {
  if (!anon) {
    console.log("verify-public-browse: skip live REST (no anon key in env)");
    return;
  }
  const headers = {
    apikey: anon,
    Authorization: `Bearer ${anon}`,
  };
  const listRes = await fetch(
    `${url}/rest/v1/sessions?select=id,visibility&visibility=eq.public&limit=3`,
    { headers },
  );
  assert(listRes.ok, `anon public list HTTP ${listRes.status}`);
  const list = (await listRes.json()) as Array<{ id: string; visibility: string }>;
  assert(list.length > 0, "anon can list public sessions");
  assert(
    list.every((row) => row.visibility === "public"),
    "list is public-only",
  );

  const oneRes = await fetch(
    `${url}/rest/v1/sessions?select=id,name&id=eq.${PUBLIC_SESSION}`,
    { headers },
  );
  assert(oneRes.ok, `anon get public session HTTP ${oneRes.status}`);
  const one = (await oneRes.json()) as Array<{ id: string }>;
  assert(one.length === 1 && one[0].id === PUBLIC_SESSION, "anon reads public id");

  console.log("verify-public-browse live ok", { publicListed: list.length });
}

void liveAnonRead()
  .then(() => {
    console.log("verify-public-browse ok");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
