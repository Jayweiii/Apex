"use client";

import { AppHeader } from "@/components/AppHeader";
import { LapCompare } from "@/components/LapCompare";
import { SaveComparisonControls } from "@/components/SaveComparisonControls";
import { ShareLinkButton } from "@/components/ShareLinkButton";
import {
  groupLapsBySession,
  type CompareSessionOption,
} from "@/lib/compare-sessions";
import {
  comparisonSharePath,
  resolveComparisonItemsAgainstLaps,
  type ComparisonDraftSnapshot,
  type ComparisonItem,
  type ComparisonRow,
} from "@/lib/comparisons";
import { fetchComparison } from "@/lib/comparisons-cloud";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import type { LapRow } from "@/lib/types";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Load a saved comparison by id and render LapCompare + save/fork controls.
 * Signed-out viewers can open public comparisons when underlying sessions allow.
 */
export function SavedComparisonView({ id }: { id: string }) {
  const [email, setEmail] = useState<string | undefined>();
  const [userId, setUserId] = useState<string | null>(null);
  const [comparison, setComparison] = useState<ComparisonRow | null | undefined>(
    undefined,
  );
  const [sessions, setSessions] = useState<CompareSessionOption[]>([]);
  const [resolvedItems, setResolvedItems] = useState<ComparisonItem[]>([]);
  const [inaccessible, setInaccessible] = useState<ComparisonItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ComparisonDraftSnapshot | null>(null);

  const onDraftChange = useCallback((next: ComparisonDraftSnapshot) => {
    setDraft(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!hasSupabaseConfig()) {
        setComparison(null);
        setError("Supabase is not configured.");
        return;
      }
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (cancelled) return;
        setEmail(user?.email ?? undefined);
        setUserId(user?.id ?? null);

        const row = await fetchComparison(supabase, id);
        if (cancelled) return;
        if (!row) {
          setComparison(null);
          setError("not-found");
          return;
        }
        setComparison(row);

        const sessionIds = [
          ...new Set(row.items.map((item) => item.session_id)),
        ];
        const { data: sessionRows, error: sessionError } = await supabase
          .from("sessions")
          .select(
            "id, name, track_id, car, driver_name, user_id, visibility, source_kind, gps_quality",
          )
          .in("id", sessionIds);
        if (cancelled) return;
        if (sessionError) {
          setError(sessionError.message);
        }

        const { data: lapRows, error: lapError } = await supabase
          .from("laps")
          .select("*")
          .in("session_id", sessionIds);
        if (cancelled) return;
        if (lapError) {
          setError(lapError.message);
        }

        const metas = sessionRows ?? [];
        const allLaps = (lapRows ?? []) as LapRow[];
        const options = groupLapsBySession(metas, allLaps, user?.id ?? null);

        // Attach videos when available.
        try {
          const { data: videos } = await supabase
            .from("session_videos")
            .select("*")
            .in("session_id", sessionIds);
          if (videos?.length) {
            for (const option of options) {
              option.videos = (videos as Array<Record<string, unknown>>)
                .filter((v) => v.session_id === option.id)
                .map((v) => ({
                  id: String(v.id),
                  provider: (v.provider as "youtube" | "mp4") ?? "youtube",
                  youtubeId: (v.youtube_id as string) ?? undefined,
                  youtubeUrl: (v.youtube_url as string) ?? undefined,
                  offsetSec: Number(v.offset_sec ?? 0),
                  rate: Number(v.rate ?? 1),
                  syncSource:
                    (v.sync_source as "auto" | "manual" | "unsynced" | "time_of_day") ??
                    "unsynced",
                  lapId: (v.lap_id as string) ?? undefined,
                }));
            }
          }
        } catch {
          // videos optional
        }

        // Re-parse recreates lap UUIDs; resolve via lap_number when lap_id is stale.
        const { resolved, missing } = resolveComparisonItemsAgainstLaps(
          row.items,
          allLaps.map((lap) => ({
            id: lap.id,
            session_id: lap.session_id,
            lap_number: lap.lap_number,
          })),
        );

        if (!cancelled) {
          setSessions(options);
          setResolvedItems(resolved);
          setInaccessible(missing);
        }
      } catch (err) {
        if (!cancelled) {
          setComparison(null);
          setError(err instanceof Error ? err.message : "Could not load");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const mine = Boolean(userId && comparison && comparison.user_id === userId);

  const initialLaps = useMemo(() => {
    if (resolvedItems.length < 2) return undefined;
    return resolvedItems
      .map((item) => `${item.session_id}:${item.lap_id}`)
      .join(",");
  }, [resolvedItems]);

  const primaryLaps = sessions[0]?.laps ?? [];

  if (comparison === undefined) {
    return (
      <>
        <AppHeader email={email} />
        <main className="mx-auto w-full max-w-5xl px-6 py-8">
          <p className="text-sm text-zinc-500">Loading comparison…</p>
        </main>
      </>
    );
  }

  if (!comparison) {
    return (
      <>
        <AppHeader email={email} />
        <main className="mx-auto w-full max-w-5xl px-6 py-8">
          <p className="text-sm text-zinc-400">
            {error === "not-found"
              ? "Comparison not found (or it is private)."
              : (error ?? "Comparison not found.")}
          </p>
          <Link href="/lap-comparisons" className="mt-4 inline-block text-sm text-orange-400">
            Browse Lap Comparisons
          </Link>
        </main>
      </>
    );
  }

  const accessibleCount = resolvedItems.length;
  const displayItems =
    resolvedItems.length >= 2 ? resolvedItems : comparison.items;
  const refItem =
    displayItems[comparison.reference_index] ?? displayItems[0] ?? null;

  return (
    <>
      <AppHeader email={email} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
        <div className="space-y-3">
          <Link
            href="/lap-comparisons"
            className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
          >
            Lap Comparisons
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
                {comparison.title}
              </h1>
              {comparison.description ? (
                <p className="mt-1 text-sm text-zinc-400">
                  {comparison.description}
                </p>
              ) : null}
              <p className="mt-2 text-xs uppercase tracking-[0.16em] text-zinc-500">
                {comparison.visibility}
                {comparison.forked_from ? " · forked" : ""}
                {mine ? " · yours" : ""}
              </p>
            </div>
            <ShareLinkButton
              path={comparisonSharePath(comparison.id)}
              label="Copy link"
            />
          </div>
        </div>

        {inaccessible.length ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            <p>
              {inaccessible.length} of {comparison.items.length} laps could not
              be matched (private/friends session, deleted, or re-parsed away).
              {accessibleCount >= 2
                ? " Showing the laps you can open."
                : " Need the owner to make those sessions Public, or re-save the comparison after re-parse."}
            </p>
            {!userId ? (
              <p className="mt-2 text-amber-200/80">
                <Link href={`/login?next=${encodeURIComponent(`/compare/${id}`)}`} className="underline">
                  Sign in
                </Link>{" "}
                if they are Friends-visible, or ask the owner to set sessions
                to Public.
              </p>
            ) : (
              <p className="mt-2 text-amber-200/80">
                Ask the owner to open each session and set visibility to{" "}
                <strong className="font-medium">Public</strong>, or re-save
                after re-parse so lap ids refresh.
              </p>
            )}
          </div>
        ) : null}

        <SaveComparisonControls
          draft={draft}
          existing={
            resolvedItems.length
              ? { ...comparison, items: resolvedItems }
              : comparison
          }
          canEdit={mine}
        />

        {accessibleCount >= 2 && sessions.length ? (
          <LapCompare
            laps={primaryLaps}
            sessions={sessions}
            initialLaps={initialLaps}
            initialRef={refItem?.lap_id}
            initialRefIndex={Math.min(
              comparison.reference_index,
              Math.max(0, accessibleCount - 1),
            )}
            initialAnalysisMode={comparison.analysis_mode}
            initialTrackId={sessions[0]?.trackId}
            readOnly={!mine}
            onDraftChange={onDraftChange}
          />
        ) : (
          <p className="text-sm text-zinc-500">
            Not enough accessible laps to render this comparison.
          </p>
        )}
      </main>
    </>
  );
}
