"use client";

import { ShareLinkButton } from "@/components/ShareLinkButton";
import { SessionVisibilityControl } from "@/components/SessionVisibilityControl";
import {
  forkComparison,
  insertComparison,
  updateComparison,
} from "@/lib/comparisons-cloud";
import {
  comparisonSharePath,
  defaultComparisonTitle,
  type ComparisonDraftSnapshot,
  type ComparisonRow,
} from "@/lib/comparisons";
import {
  ensureAuthenticatedUser,
  isAnonymousUser,
} from "@/lib/guest-auth";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import {
  defaultVisibilityForUser,
  type SessionVisibility,
} from "@/lib/visibility";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Save / fork / visibility / copy-link for a multi-lap comparison draft.
 * Works for guests via anonymous auth.
 */
export function SaveComparisonControls({
  draft,
  existing,
  canEdit,
}: {
  draft: ComparisonDraftSnapshot | null;
  /** When viewing /compare/<id> as owner. */
  existing?: ComparisonRow | null;
  canEdit?: boolean;
}) {
  const router = useRouter();
  const configured = hasSupabaseConfig();
  const [title, setTitle] = useState(
    existing?.title ?? defaultComparisonTitle(draft?.items ?? []),
  );
  const [visibility, setVisibility] = useState<SessionVisibility>(
    existing?.visibility ?? "friends",
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(existing?.id ?? null);

  if (!configured) return null;

  const items = draft?.items ?? existing?.items ?? [];
  const canSave = items.length >= 2;

  async function saveNew() {
    if (!draft || !canSave) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const supabase = createClient();
      const user = await ensureAuthenticatedUser(supabase);
      const guest = isAnonymousUser(user);
      const row = await insertComparison(supabase, user.id, {
        title: title.trim() || defaultComparisonTitle(draft.items),
        visibility: guest
          ? defaultVisibilityForUser(true)
          : visibility,
        items: draft.items,
        referenceIndex: draft.referenceIndex,
        analysisMode: draft.analysisMode,
        cursorState: { progress: draft.progress },
      });
      setSavedId(row.id);
      setVisibility(row.visibility);
      setMessage(
        guest
          ? "Saved as guest — add an email on Account to keep it across devices."
          : "Comparison saved.",
      );
      router.push(comparisonSharePath(row.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function saveExisting() {
    if (!existing || !canEdit || !draft) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const supabase = createClient();
      await ensureAuthenticatedUser(supabase);
      const row = await updateComparison(supabase, existing.id, {
        title: title.trim() || existing.title,
        visibility,
        items: draft.items,
        referenceIndex: draft.referenceIndex,
        analysisMode: draft.analysisMode,
        cursorState: { progress: draft.progress },
      });
      setSavedId(row.id);
      setMessage("Saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update");
    } finally {
      setBusy(false);
    }
  }

  async function fork() {
    if (!existing) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const supabase = createClient();
      const user = await ensureAuthenticatedUser(supabase);
      const row = await forkComparison(supabase, user.id, existing);
      setMessage("Duplicated into your account.");
      router.push(comparisonSharePath(row.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not duplicate");
    } finally {
      setBusy(false);
    }
  }

  async function changeVisibility(next: SessionVisibility) {
    setVisibility(next);
    if (!existing || !canEdit) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      await ensureAuthenticatedUser(supabase);
      await updateComparison(supabase, existing.id, { visibility: next });
      setMessage(`Visibility → ${next}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update visibility");
    } finally {
      setBusy(false);
    }
  }

  const shareId = savedId ?? existing?.id;

  // Read-only shared view: only copy link — hide save/fork/title/visibility.
  const readOnlyShared = Boolean(existing) && !canEdit;

  // Read-only visitors: one slim row (status + Copy link). The title and
  // visibility already show in the page header.
  if (readOnlyShared) {
    return (
      <div
        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800/80 bg-zinc-950/50 px-3 py-2"
        data-apex-compare-shared="1"
      >
        <p className="text-xs text-zinc-400">
          <span className="uppercase tracking-[0.16em] text-zinc-500">
            Shared
          </span>{" "}
          · read-only · {existing?.visibility}
        </p>
        {shareId ? (
          <ShareLinkButton
            path={comparisonSharePath(shareId)}
            label="Copy link"
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border border-zinc-800/80 bg-zinc-950/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            {readOnlyShared ? "Shared comparison" : "Save comparison"}
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            {readOnlyShared
              ? "Read-only link · duplicate into your account to edit."
              : "Shareable link · duplicate into your account · works as a guest."}
          </p>
        </div>
        {shareId ? (
          <ShareLinkButton
            path={comparisonSharePath(shareId)}
            label="Copy link"
          />
        ) : null}
      </div>

      {readOnlyShared ? (
        <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">
          Read-only · {existing?.visibility}
          {existing?.title ? ` · ${existing.title}` : ""}
        </p>
      ) : (
        <>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-zinc-400">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={Boolean(existing) && !canEdit}
              placeholder="Untitled comparison"
              className="min-h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2 disabled:opacity-60"
            />
          </label>

          <SessionVisibilityControl
            value={visibility}
            onChange={changeVisibility}
            disabled={busy}
            compact
            legend="Who can see this comparison?"
          />

          <div className="flex flex-wrap gap-2">
            {existing && canEdit ? (
              <button
                type="button"
                disabled={busy || !canSave}
                onClick={() => void saveExisting()}
                className="apex-btn apex-btn--primary apex-btn--cta"
              >
                {busy ? "Saving…" : "Update"}
              </button>
            ) : null}
            {!existing ? (
              <button
                type="button"
                disabled={busy || !canSave}
                onClick={() => void saveNew()}
                className="apex-btn apex-btn--primary apex-btn--cta"
              >
                {busy ? "Working…" : "Save comparison"}
              </button>
            ) : canEdit ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void fork()}
                className="apex-btn apex-btn--cta"
              >
                Duplicate / Fork
              </button>
            ) : null}
          </div>
        </>
      )}

      {!canSave && !readOnlyShared ? (
        <p className="text-xs text-zinc-600">Pick at least two laps first.</p>
      ) : null}
      {message ? <p className="text-sm text-zinc-400">{message}</p> : null}
      {error ? <p className="text-sm text-amber-200">{error}</p> : null}
    </div>
  );
}
