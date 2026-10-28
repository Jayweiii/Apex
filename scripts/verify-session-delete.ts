/**
 * Owner session delete: scrub comparisons, owner ok / non-owner denied,
 * cascade notes, toolbar + My Sessions wiring, RLS migration present.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  canDeleteSession,
  markMissingComparisonItems,
  scrubSessionsFromComparisonItems,
} from "../src/lib/session-delete";
import type { ComparisonItem } from "../src/lib/comparisons";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

const owner = "7a23f279-c3c6-428d-82d6-1823cc8b3fd1";
const other = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

assert(canDeleteSession(owner, owner), "owner may delete");
assert(
  canDeleteSession(owner.toUpperCase(), owner),
  "owner compare case-insensitive",
);
assert(!canDeleteSession(owner, other), "non-owner denied");
assert(!canDeleteSession(owner, null), "signed-out denied");
assert(!canDeleteSession(null, owner), "missing session user denied");

const items: ComparisonItem[] = [
  { session_id: "s1", lap_id: "l1", lap_number: 1 },
  { session_id: "s2", lap_id: "l2", lap_number: 2 },
  { session_id: "s1", lap_id: "l3", lap_number: 3 },
];

const scrubOne = scrubSessionsFromComparisonItems(items, ["s1"]);
assert(scrubOne.removedCount === 2, "both s1 items removed");
assert(scrubOne.items.length === 1, "s2 remains");
assert(scrubOne.items[0].session_id === "s2", "kept s2");
assert(
  scrubOne.shouldDeleteComparison === true,
  "one lap left → delete comparison",
);

const scrubOther = scrubSessionsFromComparisonItems(items, ["s3"]);
assert(scrubOther.removedCount === 0, "unrelated session no-op");
assert(scrubOther.shouldDeleteComparison === false, "still valid");

const scrubAll = scrubSessionsFromComparisonItems(items, ["s1", "s2"]);
assert(scrubAll.shouldDeleteComparison === true, "empty → delete");
assert(scrubAll.items.length === 0, "no items");

const missing = markMissingComparisonItems(items, ["s2"]);
assert(missing.available.length === 1, "s2 available");
assert(missing.missing.length === 2, "s1 marked missing");

// Mock client: owner delete ok, non-owner denied at pre-check.
async function runMockDeletes() {
  const calls: Array<{ table: string; op: string; filter?: unknown }> = [];
  const fakeOwned = {
    from(table: string) {
      return {
        select() {
          return {
            in() {
              return {
                eq(_col: string, userId: string) {
                  calls.push({ table, op: "select-owned", filter: userId });
                  if (userId !== owner) {
                    return Promise.resolve({ data: [], error: null });
                  }
                  return Promise.resolve({
                    data: [{ id: "s1", user_id: owner, name: "Thunderhill" }],
                    error: null,
                  });
                },
              };
            },
          };
        },
        delete() {
          return {
            in() {
              return {
                eq(_col: string, userId: string) {
                  calls.push({ table, op: "delete", filter: userId });
                  if (userId !== owner) {
                    return Promise.resolve({
                      error: { message: "RLS denied" },
                    });
                  }
                  return Promise.resolve({ error: null });
                },
              };
            },
          };
        },
      };
    },
  };

  // Patch comparisons path: empty list.
  const client = {
    from(table: string) {
      if (table === "comparisons") {
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({ data: [], error: null });
              },
            };
          },
        };
      }
      return fakeOwned.from(table);
    },
  };

  const { deleteOwnedSession } = await import("../src/lib/session-delete");

  const ok = await deleteOwnedSession(client, owner, {
    id: "s1",
    name: "Thunderhill",
    user_id: owner,
  });
  assert(ok.deletedIds.includes("s1"), "owner delete returns id");

  let denied = false;
  try {
    await deleteOwnedSession(client, other, {
      id: "s1",
      name: "Thunderhill",
      user_id: owner,
    });
  } catch (err) {
    denied = /owner/i.test(err instanceof Error ? err.message : String(err));
  }
  assert(denied, "non-owner throws before delete");
}

const migration = "supabase/migrations/20261020_session_delete.sql";
assert(existsSync(resolve(root, migration)), "migration file present");
const mig = read(migration);
assert(mig.includes("sessions_delete_own"), "sessions delete RLS");
assert(mig.includes("laps_delete_own"), "laps delete RLS");
assert(mig.includes("session_videos_delete_own"), "videos delete RLS");
assert(mig.includes("auth.uid() = user_id"), "owner-only using clause");

const cloud = read("src/components/CloudSessionView.tsx");
assert(cloud.includes("DeleteSessionControl"), "toolbar delete control");
assert(cloud.includes('variant="toolbar"'), "toolbar danger delete");
assert(cloud.includes("toolsShowButtons={false}"), "deduped tools buttons");
assert(cloud.includes("autoStart"), "reparse click auto-starts");

const tools = read("src/components/SessionToolsPanel.tsx");
assert(tools.includes("showButtons"), "showButtons for toolbar dedupe");

const compare = read("src/components/LapCompare.tsx");
assert(
  compare.includes("Comparing (") || compare.includes("lapPicker"),
  "compare lap picker always visible",
);

const account = read("src/components/AccountSessions.tsx");
assert(account.includes("DeleteSessionControl"), "account row delete");
assert(account.includes('variant="bulk"'), "account bulk delete");
assert(account.includes('type="checkbox"'), "account multi-select");

const yours = read("src/components/YourSessions.tsx");
assert(yours.includes("DeleteSessionControl"), "home My Sessions delete");
assert(yours.includes('variant="bulk"'), "home bulk delete");

const globals = read("src/app/globals.css");
assert(globals.includes("cursor: pointer"), "cursor:pointer on clickables");

const gChart = read("src/components/GChart.tsx");
assert(
  (/h-\[(?:1[0-9]{2,}|[2-9][0-9]{2,})px\]/.test(gChart) ||
    gChart.includes("h-[240px]")) &&
    !gChart.includes("h-[56px]"),
  "G chart height >100px",
);

const speed = read("src/components/SpeedChart.tsx");
assert(
  speed.includes("min-h-[120px]") ||
    speed.includes("min-h-[240px]") ||
    speed.includes("min-h-[280px]") ||
    /h-\[(?:1[0-9]{2,}|[2-9][0-9]{2,})px\]/.test(speed),
  "chart height >100px",
);

const confirm = read("src/components/ConfirmDialog.tsx");
assert(confirm.includes("alertdialog"), "confirm dialog");
assert(
  read("src/components/DeleteSessionControl.tsx").includes("session.name") ||
    read("src/components/DeleteSessionControl.tsx").includes("targets[0].name"),
  "confirm names the session",
);

void runMockDeletes()
  .then(() => {
    console.log(
      JSON.stringify({
        ok: true,
        migration,
        ownerOk: true,
        nonOwnerDenied: true,
        cascade: "laps+videos FK; comparisons scrub; leaderboards query-derived",
      }),
    );
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
