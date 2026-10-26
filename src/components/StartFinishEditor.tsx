"use client";

import {
  ensureStartFinishEndpoints,
  moveStartFinishEndpoint,
  parseStartFinishLine,
  serializeStartFinishLine,
  type StartFinishLine,
} from "@/lib/start-finish-line";
import { resolveTrackStartFinishLine } from "@/lib/track-start-finish";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MutableRefObject,
} from "react";

/**
 * Owner control: edit track SF on the session map, explicit Save (no autosave),
 * then optionally re-split the current session from source_gps.
 */
export function StartFinishEditor({
  trackId,
  storedStartFinish,
  canEdit,
  onLineChange,
  onSaved,
  onRequestResplit,
  busy = false,
  moveEndpointRef,
}: {
  trackId: string;
  storedStartFinish?: unknown;
  canEdit: boolean;
  /** Live draft line for the map overlay (null when not editing). */
  onLineChange?: (line: StartFinishLine | null, editing: boolean) => void;
  onSaved?: (line: StartFinishLine) => void;
  /** After Save — parent runs reparse with the new SF. */
  onRequestResplit?: (line: StartFinishLine) => void;
  busy?: boolean;
  /** Parent map forwards A/B handle drags through this ref. */
  moveEndpointRef?: MutableRefObject<
    ((which: "a" | "b", lat: number, lon: number) => void) | null
  >;
}) {
  const baseline = useMemo(() => {
    return (
      parseStartFinishLine(storedStartFinish) ??
      resolveTrackStartFinishLine(trackId, storedStartFinish)
    );
  }, [trackId, storedStartFinish]);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<StartFinishLine | null>(null);
  const [savedLine, setSavedLine] = useState<StartFinishLine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [offerResplit, setOfferResplit] = useState(false);

  /** Live map-handle moves (parent forwards Leaflet drag). */
  const applyEndpointMove = useCallback(
    (which: "a" | "b", lat: number, lon: number) => {
      setDraft((prev) =>
        prev
          ? moveStartFinishEndpoint(ensureStartFinishEndpoints(prev), which, {
              lat,
              lon,
            })
          : prev,
      );
    },
    [],
  );

  useEffect(() => {
    if (!moveEndpointRef) return;
    moveEndpointRef.current = applyEndpointMove;
    return () => {
      moveEndpointRef.current = null;
    };
  }, [moveEndpointRef, applyEndpointMove]);

  useEffect(() => {
    if (!editing || !draft) {
      onLineChange?.(null, false);
      return;
    }
    onLineChange?.(ensureStartFinishEndpoints(draft), true);
  }, [editing, draft, onLineChange]);

  const startEdit = useCallback(() => {
    if (!baseline) {
      setError("No start/finish for this track yet.");
      return;
    }
    setError(null);
    setOfferResplit(false);
    setDraft(ensureStartFinishEndpoints(baseline));
    setEditing(true);
  }, [baseline]);

  const cancel = useCallback(() => {
    setEditing(false);
    setDraft(null);
    setError(null);
    setOfferResplit(false);
    onLineChange?.(null, false);
  }, [onLineChange]);

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/tracks/${encodeURIComponent(trackId)}/start-finish`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          startFinish: serializeStartFinishLine(ensureStartFinishEndpoints(draft)),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        startFinish?: unknown;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? `Save failed (HTTP ${response.status})`);
      }
      const saved =
        parseStartFinishLine(payload.startFinish) ??
        ensureStartFinishEndpoints(draft);
      setSavedLine(saved);
      onSaved?.(saved);
      setOfferResplit(true);
      setEditing(false);
      setDraft(null);
      onLineChange?.(null, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save start/finish");
    } finally {
      setSaving(false);
    }
  }

  if (!canEdit || !trackId) return null;

  return (
    <div
      className="flex flex-col gap-1.5"
      data-apex-sf-editor="1"
      data-testid="map-sf-tools"
    >
      <div className="flex flex-wrap items-center gap-2">
        {!editing && !offerResplit ? (
          <button
            type="button"
            onClick={startEdit}
            disabled={busy}
            data-testid="toolbar-sf-edit"
            className="apex-btn"
          >
            Edit start/finish
          </button>
        ) : null}
        {editing ? (
          <>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || busy || !draft}
              className="apex-btn apex-btn--primary"
            >
              {saving ? "Saving…" : "Save start/finish"}
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={saving}
              className="apex-btn"
            >
              Cancel
            </button>
            <p className="text-[11px] text-zinc-500">
              Drag the two gate handles on the map · touch supported
            </p>
          </>
        ) : null}
        {offerResplit && draft == null ? (
          <>
            <p className="text-xs text-zinc-300">Start/finish saved.</p>
            <button
              type="button"
              onClick={() => {
                const line =
                  savedLine ??
                  parseStartFinishLine(storedStartFinish) ??
                  resolveTrackStartFinishLine(trackId, storedStartFinish);
                if (line) onRequestResplit?.(line);
                setOfferResplit(false);
              }}
              disabled={busy}
              className="apex-btn apex-btn--primary"
            >
              Re-split laps
            </button>
            <button
              type="button"
              onClick={() => setOfferResplit(false)}
              className="apex-btn apex-btn--ghost"
            >
              Skip
            </button>
          </>
        ) : null}
      </div>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
    </div>
  );
}

/** Apply a pointer drag delta (meters-ish via lat/lon) to one SF endpoint. */
export function nudgeSfEndpoint(
  line: StartFinishLine,
  which: "a" | "b",
  lat: number,
  lon: number,
): StartFinishLine {
  return moveStartFinishEndpoint(ensureStartFinishEndpoints(line), which, {
    lat,
    lon,
  });
}
