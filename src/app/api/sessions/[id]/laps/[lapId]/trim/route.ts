import { applyLapTrim, videoOffsetAfterStartShift } from "@/lib/lap-trim";
import { createClient } from "@/lib/supabase/server";
import type { TelemetryPoint } from "@/lib/types";
import { NextResponse } from "next/server";

/**
 * Owner-only: set start/end offset overrides and recompute lap_time_ms.
 * Also shifts dedicated lap video offsets so sync stays consistent.
 * Clear error when 20261019_lap_trim_overrides.sql is not applied yet.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; lapId: string }> },
) {
  const { id: sessionId, lapId } = await context.params;
  let body: {
    start_offset_override?: unknown;
    end_offset_override?: unknown;
    reset?: unknown;
    merge_next?: unknown;
    split_progress?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const { data: lap, error: loadError } = await supabase
    .from("laps")
    .select(
      "id, session_id, user_id, lap_number, lap_time_ms, telemetry, start_offset_sec, start_offset_override, end_offset_override",
    )
    .eq("id", lapId)
    .eq("session_id", sessionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (loadError) {
    const missing = /start_offset_override|end_offset_override/i.test(
      loadError.message,
    );
    return NextResponse.json(
      {
        error: missing
          ? "Run supabase/migrations/20261019_lap_trim_overrides.sql in the Supabase SQL editor, then retry."
          : loadError.message,
        code: missing ? "missing_trim_columns" : "load_failed",
      },
      { status: missing ? 503 : 400 },
    );
  }
  if (!lap) {
    return NextResponse.json(
      { error: "Lap not found or you are not the owner" },
      { status: 404 },
    );
  }

  // Merge / split are structural — handled separately when requested.
  if (body.merge_next === true) {
    return mergeNext(supabase, user.id, sessionId, lap);
  }
  if (typeof body.split_progress === "number") {
    return splitAt(supabase, user.id, sessionId, lap, body.split_progress);
  }

  const reset = body.reset === true;
  if (!reset) {
    if (
      body.start_offset_override === undefined &&
      body.end_offset_override === undefined
    ) {
      return NextResponse.json(
        {
          error:
            "Provide start_offset_override and/or end_offset_override, or reset",
        },
        { status: 400 },
      );
    }
    const startParsed = normalizeOverride(body.start_offset_override);
    const endParsed = normalizeOverride(body.end_offset_override);
    if (startParsed.error || endParsed.error) {
      return NextResponse.json(
        { error: startParsed.error ?? endParsed.error },
        { status: 400 },
      );
    }
  }

  let startOverride: number | null = reset
    ? null
    : body.start_offset_override === undefined
      ? ((lap.start_offset_override as number | null | undefined) ?? null)
      : (normalizeOverride(body.start_offset_override).value ?? null);
  let endOverride: number | null = reset
    ? null
    : body.end_offset_override === undefined
      ? ((lap.end_offset_override as number | null | undefined) ?? null)
      : (normalizeOverride(body.end_offset_override).value ?? null);

  const before = applyLapTrim({
    id: lap.id,
    lap_number: lap.lap_number,
    lap_time_ms: lap.lap_time_ms,
    start_offset_sec: lap.start_offset_sec,
    telemetry: (lap.telemetry ?? []) as TelemetryPoint[],
    start_offset_override: lap.start_offset_override,
    end_offset_override: lap.end_offset_override,
  });
  const after = applyLapTrim({
    id: lap.id,
    lap_number: lap.lap_number,
    lap_time_ms: lap.lap_time_ms,
    start_offset_sec: lap.start_offset_sec,
    telemetry: (lap.telemetry ?? []) as TelemetryPoint[],
    start_offset_override: startOverride,
    end_offset_override: endOverride,
  });
  const startDelta =
    after.start_offset_sec - before.start_offset_sec;

  const { data, error } = await supabase
    .from("laps")
    .update({
      start_offset_override: startOverride,
      end_offset_override: endOverride,
      lap_time_ms: after.lap_time_ms,
    })
    .eq("id", lapId)
    .eq("session_id", sessionId)
    .eq("user_id", user.id)
    .select(
      "id, lap_time_ms, start_offset_sec, start_offset_override, end_offset_override",
    )
    .maybeSingle();

  if (error) {
    const missing = /start_offset_override|end_offset_override/i.test(
      error.message,
    );
    return NextResponse.json(
      {
        error: missing
          ? "Run supabase/migrations/20261019_lap_trim_overrides.sql in the Supabase SQL editor, then retry."
          : error.message,
        code: missing ? "missing_trim_columns" : "update_failed",
      },
      { status: missing ? 503 : 400 },
    );
  }

  // Keep dedicated lap video offsets consistent with the new start.
  if (Math.abs(startDelta) > 1e-6) {
    const { data: videos } = await supabase
      .from("session_videos")
      .select("id, offset_sec, lap_id")
      .eq("session_id", sessionId)
      .eq("user_id", user.id)
      .eq("lap_id", lapId);
    for (const row of videos ?? []) {
      const nextOffset = videoOffsetAfterStartShift(
        { offsetSec: Number(row.offset_sec) || 0, lapId },
        lapId,
        startDelta,
      );
      await supabase
        .from("session_videos")
        .update({ offset_sec: nextOffset })
        .eq("id", row.id)
        .eq("user_id", user.id);
    }
  }

  return NextResponse.json({
    id: data?.id ?? lapId,
    lap_time_ms: data?.lap_time_ms ?? after.lap_time_ms,
    start_offset_sec: data?.start_offset_sec ?? lap.start_offset_sec,
    start_offset_override: (data?.start_offset_override as number | null) ?? null,
    end_offset_override: (data?.end_offset_override as number | null) ?? null,
    video_offset_delta: startDelta,
  });
}

function normalizeOverride(value: unknown): {
  value?: number | null;
  error?: string;
} {
  if (value === undefined) return {};
  if (value == null) return { value: null };
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { error: "override must be a number or null" };
  }
  return { value };
}

async function mergeNext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  sessionId: string,
  lap: {
    id: string;
    lap_number: number;
    lap_time_ms: number;
    start_offset_sec: number | null;
    telemetry: unknown;
    start_offset_override: number | null;
    end_offset_override: number | null;
  },
) {
  const { mergeAdjacentLaps } = await import("@/lib/lap-trim");
  const { data: rows, error } = await supabase
    .from("laps")
    .select(
      "id, lap_number, lap_time_ms, telemetry, start_offset_sec, start_offset_override, end_offset_override",
    )
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .order("lap_number", { ascending: true });
  if (error || !rows?.length) {
    return NextResponse.json(
      { error: error?.message ?? "No laps" },
      { status: 400 },
    );
  }
  const merged = mergeAdjacentLaps(
    rows.map((row) => ({
      id: row.id,
      lap_number: row.lap_number,
      lap_time_ms: row.lap_time_ms,
      start_offset_sec: row.start_offset_sec,
      telemetry: (row.telemetry ?? []) as TelemetryPoint[],
      start_offset_override: row.start_offset_override,
      end_offset_override: row.end_offset_override,
    })),
    lap.id,
  );
  if (!merged) {
    return NextResponse.json(
      { error: "No next lap to merge" },
      { status: 400 },
    );
  }

  const nextLap = rows.find((r) => r.lap_number === lap.lap_number + 1);
  const kept = merged.find((m) => m.id === lap.id);
  if (!nextLap || !kept) {
    return NextResponse.json({ error: "Merge failed" }, { status: 400 });
  }

  await supabase
    .from("laps")
    .update({
      telemetry: kept.telemetry,
      lap_time_ms: kept.lap_time_ms,
      start_offset_sec: kept.start_offset_sec,
      start_offset_override: null,
      end_offset_override: null,
    })
    .eq("id", lap.id)
    .eq("user_id", userId);

  await supabase.from("laps").delete().eq("id", nextLap.id).eq("user_id", userId);

  // Renumber remaining.
  const { data: remaining } = await supabase
    .from("laps")
    .select("id, lap_number, start_offset_sec")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .order("start_offset_sec", { ascending: true });
  let n = 1;
  for (const row of remaining ?? []) {
    if (row.lap_number !== n) {
      await supabase
        .from("laps")
        .update({ lap_number: n })
        .eq("id", row.id)
        .eq("user_id", userId);
    }
    n += 1;
  }

  return NextResponse.json({ ok: true, action: "merge" });
}

async function splitAt(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  sessionId: string,
  lap: {
    id: string;
    lap_number: number;
    lap_time_ms: number;
    start_offset_sec: number | null;
    telemetry: unknown;
    start_offset_override: number | null;
    end_offset_override: number | null;
  },
  progress: number,
) {
  const { splitLapAtProgress } = await import("@/lib/lap-trim");
  const { data: rows } = await supabase
    .from("laps")
    .select(
      "id, lap_number, lap_time_ms, telemetry, start_offset_sec, start_offset_override, end_offset_override",
    )
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .order("lap_number", { ascending: true });

  const split = splitLapAtProgress(
    (rows ?? []).map((row) => ({
      id: row.id,
      lap_number: row.lap_number,
      lap_time_ms: row.lap_time_ms,
      start_offset_sec: row.start_offset_sec,
      telemetry: (row.telemetry ?? []) as TelemetryPoint[],
      start_offset_override: row.start_offset_override,
      end_offset_override: row.end_offset_override,
    })),
    lap.id,
    progress,
  );
  if (!split) {
    return NextResponse.json({ error: "Split failed" }, { status: 400 });
  }

  const left = split.find((s) => s.id === lap.id);
  const right = split.find((s) => s.id !== lap.id && s.lap_number === (left?.lap_number ?? 0) + 1);
  if (!left || !right) {
    return NextResponse.json({ error: "Split failed" }, { status: 400 });
  }

  await supabase
    .from("laps")
    .update({
      telemetry: left.telemetry,
      lap_time_ms: left.lap_time_ms,
      start_offset_sec: left.start_offset_sec,
      start_offset_override: null,
      end_offset_override: null,
    })
    .eq("id", lap.id)
    .eq("user_id", userId);

  // Shift lap numbers for following laps, then insert right.
  const following = (rows ?? []).filter((r) => r.lap_number > lap.lap_number);
  for (const row of [...following].sort((a, b) => b.lap_number - a.lap_number)) {
    await supabase
      .from("laps")
      .update({ lap_number: row.lap_number + 1 })
      .eq("id", row.id)
      .eq("user_id", userId);
  }

  await supabase.from("laps").insert({
    session_id: sessionId,
    user_id: userId,
    lap_number: lap.lap_number + 1,
    lap_time_ms: right.lap_time_ms,
    telemetry: right.telemetry,
    start_offset_sec: right.start_offset_sec,
    start_offset_override: null,
    end_offset_override: null,
  });

  return NextResponse.json({ ok: true, action: "split" });
}
