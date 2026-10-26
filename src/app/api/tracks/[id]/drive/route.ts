import { builtinCenterline } from "@/lib/centerlines";
import {
  decimatePolyline,
  pathLength,
  polylineToLocal,
  toLocalMeters,
} from "@/lib/drive/coords";
import type {
  DriveGhostLap,
  DriveLatLon,
  DrivePoint,
  DriveTrackPayload,
} from "@/lib/drive/types";
import { formatLapTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import {
  parseStartFinishLine,
  type StartFinishLine,
} from "@/lib/start-finish-line";
import {
  builtinTrack,
  getTrack,
  resolveBuiltinAlias,
  trackEquivalentIds,
} from "@/lib/tracks";
import type { TelemetryPoint } from "@/lib/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const HALF_WIDTH_M = 9;

function gpsOf(points: TelemetryPoint[]): DriveLatLon[] {
  const out: DriveLatLon[] = [];
  for (const p of points) {
    if (
      typeof p.lat === "number" &&
      typeof p.lon === "number" &&
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lon)
    ) {
      out.push({ lat: p.lat, lon: p.lon });
    }
  }
  return out;
}

function pickBestGpsLap(
  laps: Array<{
    telemetry?: TelemetryPoint[] | null;
    lap_time_ms?: number | null;
    lap_number?: number | null;
  }>,
): {
  path: DriveLatLon[];
  timeMs: number;
  lapNumber: number | null;
} | null {
  const ranked = laps
    .map((lap) => {
      const path = gpsOf(lap.telemetry ?? []);
      return {
        path,
        timeMs: Number(lap.lap_time_ms) || 0,
        lapNumber:
          typeof lap.lap_number === "number" ? lap.lap_number : null,
      };
    })
    .filter((row) => row.path.length >= 40);
  if (!ranked.length) return null;
  // Prefer a hot lap with a sane time; else longest GPS.
  const withTime = ranked
    .filter((r) => r.timeMs > 30_000 && r.timeMs < 600_000)
    .sort((a, b) => a.timeMs - b.timeMs || b.path.length - a.path.length);
  return withTime[0] ?? ranked.sort((a, b) => b.path.length - a.path.length)[0]!;
}

function closeLoop(points: DrivePoint[]): DrivePoint[] {
  if (points.length < 3) return points;
  const a = points[0]!;
  const b = points[points.length - 1]!;
  if (Math.hypot(a.x - b.x, a.y - b.y) > 8) {
    return [...points, { x: a.x, y: a.y }];
  }
  return points;
}

function ghostFromLap(
  origin: DriveLatLon,
  path: DriveLatLon[],
  timeMs: number,
  label: string,
): DriveGhostLap {
  const samples: DrivePoint[] = [];
  const n = path.length;
  for (let i = 0; i < n; i += 1) {
    const local = toLocalMeters(origin, path[i]!);
    samples.push({
      x: local.x,
      y: local.y,
      t: n <= 1 ? 0 : (i / (n - 1)) * timeMs,
    });
  }
  return {
    label,
    kind: "real",
    timeMs,
    samples: decimatePolyline(samples, 6),
  };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: trackId } = await context.params;
  if (!trackId?.trim()) {
    return NextResponse.json({ error: "Missing track id" }, { status: 400 });
  }

  const alias = resolveBuiltinAlias(trackId);
  const catalog =
    getTrack(trackId) ??
    (alias ? builtinTrack(alias) : null) ??
    builtinTrack(trackId);

  let name = catalog?.name ?? trackId;
  let location = catalog?.location ?? "";
  let startFinishRaw: unknown = catalog
    ? { lat: catalog.lat, lon: catalog.lon }
    : null;
  let centerlineGps: DriveLatLon[] | null = null;
  let source: DriveTrackPayload["source"] = "builtin";
  let realGhost: DriveGhostLap | null = null;

  // Builtin geometric fallback first (always available offline).
  const builtin =
    builtinCenterline(trackId) ??
    (alias ? builtinCenterline(alias) : null);
  if (builtin && builtin.length >= 8) {
    centerlineGps = builtin.map((p) => ({ lat: p.lat, lon: p.lon }));
    source = "builtin";
  }

  try {
    const supabase = await createClient();
    const aliases = trackEquivalentIds(trackId);
    const { data: trackRow } = await supabase
      .from("tracks")
      .select("id, name, location, lat, lon, start_finish, centerline")
      .in("id", aliases.length ? aliases : [trackId])
      .limit(1)
      .maybeSingle();

    if (trackRow) {
      name = (trackRow.name as string) || name;
      location = (trackRow.location as string) || location;
      if (trackRow.start_finish) startFinishRaw = trackRow.start_finish;
      else if (
        typeof trackRow.lat === "number" &&
        typeof trackRow.lon === "number"
      ) {
        startFinishRaw = { lat: trackRow.lat, lon: trackRow.lon };
      }
      if (Array.isArray(trackRow.centerline) && trackRow.centerline.length >= 8) {
        const pts: DriveLatLon[] = [];
        for (const item of trackRow.centerline as unknown[]) {
          if (!item || typeof item !== "object") continue;
          const row = item as Record<string, unknown>;
          const lat = Number(row.lat ?? row.latitude);
          const lon = Number(row.lon ?? row.longitude ?? row.lng);
          if (Number.isFinite(lat) && Number.isFinite(lon)) {
            pts.push({ lat, lon });
          }
        }
        if (pts.length >= 8) {
          centerlineGps = pts;
          source = "centerline";
        }
      }
    }

    // Prefer a real session GPS outline for the ribbon.
    let sessionsQuery = supabase
      .from("sessions")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(16);
    sessionsQuery =
      aliases.length > 1
        ? sessionsQuery.in("track_id", aliases)
        : sessionsQuery.eq("track_id", trackId);
    const { data: sessions } = await sessionsQuery;
    const ids = (sessions ?? []).map((row) => row.id as string);

    let bestGhostCandidate: {
      path: DriveLatLon[];
      timeMs: number;
      lapNumber: number | null;
    } | null = null;

    for (const sessionId of ids) {
      const { data: laps } = await supabase
        .from("laps")
        .select("telemetry, lap_time_ms, lap_number")
        .eq("session_id", sessionId)
        .order("lap_number", { ascending: true })
        .limit(24);
      const picked = pickBestGpsLap(
        (laps ?? []).map((lap) => ({
          telemetry: (lap.telemetry ?? null) as TelemetryPoint[] | null,
          lap_time_ms: lap.lap_time_ms as number,
          lap_number: lap.lap_number as number,
        })),
      );
      if (!picked) continue;
      if (source !== "session_gps" && picked.path.length >= 40) {
        centerlineGps = picked.path;
        source = "session_gps";
      }
      if (
        !bestGhostCandidate ||
        (picked.timeMs > 0 &&
          (bestGhostCandidate.timeMs <= 0 ||
            picked.timeMs < bestGhostCandidate.timeMs))
      ) {
        bestGhostCandidate = picked;
      }
      if (source === "session_gps" && bestGhostCandidate?.timeMs > 0) break;
    }

    if (bestGhostCandidate && bestGhostCandidate.timeMs > 0) {
      // origin not known yet — build after origin chosen
      realGhost = {
        label: `Real${
          bestGhostCandidate.lapNumber != null
            ? ` L${bestGhostCandidate.lapNumber}`
            : ""
        } ${formatLapTime(bestGhostCandidate.timeMs)}`,
        kind: "real",
        timeMs: bestGhostCandidate.timeMs,
        samples: [], // filled below
      };
      // stash path on object via closure rebuild
      (realGhost as DriveGhostLap & { _path?: DriveLatLon[] })._path =
        bestGhostCandidate.path;
    }
  } catch {
    // Offline / no supabase — keep builtin
  }

  if (!centerlineGps || centerlineGps.length < 8) {
    return NextResponse.json(
      {
        error:
          "No GPS path for this track yet. Upload a session with GPS, or pick Thunderhill West/East.",
        code: "no_gps",
      },
      { status: 404 },
    );
  }

  const sfParsed: StartFinishLine | null =
    parseStartFinishLine(startFinishRaw) ??
    (catalog
      ? { lat: catalog.lat, lon: catalog.lon, headingDeg: 0 }
      : { lat: centerlineGps[0]!.lat, lon: centerlineGps[0]!.lon });

  const origin: DriveLatLon = {
    lat: sfParsed?.lat ?? centerlineGps[0]!.lat,
    lon: sfParsed?.lon ?? centerlineGps[0]!.lon,
  };

  const centerline = closeLoop(
    decimatePolyline(polylineToLocal(origin, centerlineGps), 5),
  );
  if (pathLength(centerline) < 200) {
    return NextResponse.json(
      { error: "Track path too short to drive", code: "path_short" },
      { status: 422 },
    );
  }

  const ghostWithPath = realGhost as
    | (DriveGhostLap & { _path?: DriveLatLon[] })
    | null;
  if (ghostWithPath?._path && ghostWithPath.timeMs > 0) {
    realGhost = ghostFromLap(
      origin,
      ghostWithPath._path,
      ghostWithPath.timeMs,
      ghostWithPath.label,
    );
  } else {
    realGhost = null;
  }

  const payload: DriveTrackPayload = {
    trackId,
    name,
    location,
    origin,
    centerline,
    halfWidthM: HALF_WIDTH_M,
    startFinish: {
      lat: sfParsed!.lat,
      lon: sfParsed!.lon,
      headingDeg: sfParsed!.headingDeg,
      a: sfParsed!.a,
      b: sfParsed!.b,
    },
    realGhost,
    source,
  };

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
