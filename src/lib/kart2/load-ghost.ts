import { detectGpsLoggerFormat, parseGpsLoggerFile } from "@/lib/parse-gps-logger";
import { parseTelemetryCsv } from "@/lib/parse-telemetry";
import type { ParsedLap, TelemetryPoint } from "@/lib/types";
import { ghostFromSamples, type GeoSample, type GhostLap } from "./ghost";
import type { Kart2Track } from "./track";

function samplesFromLap(lap: ParsedLap): GeoSample[] {
  const out: GeoSample[] = [];
  for (const p of lap.points) {
    if (typeof p.lat !== "number" || typeof p.lon !== "number") continue;
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    out.push({ t: p.t, lat: p.lat, lon: p.lon, alt: p.alt });
  }
  return out;
}

function bestLap(laps: ParsedLap[]): ParsedLap | null {
  const usable = laps.filter((lap) => samplesFromLap(lap).length >= 4);
  if (!usable.length) return null;
  return usable.reduce((best, lap) => (lap.lapTimeMs < best.lapTimeMs ? lap : best));
}

function formatLap(ms: number): string {
  if (!ms || !Number.isFinite(ms)) return "lap";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const c = Math.floor((ms % 1000) / 10);
  return `${m}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

export type GhostLoad =
  | { ok: true; ghost: GhostLap; samples: GeoSample[] }
  | { ok: false; error: string };

/**
 * Turn an uploaded TrackAddict / RaceRender CSV, GoPro export, GPX, or VBO
 * into a ghost on `track`. The fastest lap in the file is used.
 */
export async function ghostFromUpload(file: File, track: Kart2Track): Promise<GhostLoad> {
  const text = await file.text();
  let laps: ParsedLap[];
  const tryTrackAddict = () => parseTelemetryCsv(text).laps;
  try {
    const head = text.slice(0, 4000);
    const detected = detectGpsLoggerFormat(file.name, head);
    const trackAddict =
      detected === "trackaddict-csv" || /trackaddict|racerender/i.test(head);
    if (trackAddict) {
      laps = tryTrackAddict();
    } else {
      try {
        const parsed = await parseGpsLoggerFile(file, file.name);
        laps = parsed.laps;
      } catch (err) {
        if (err instanceof Error && err.message === "TRACKADDICT_CSV") {
          laps = tryTrackAddict();
        } else if (/\.csv$/i.test(file.name)) {
          laps = tryTrackAddict();
        } else {
          throw err;
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not read that file.";
    return { ok: false, error: message };
  }
  const lap = bestLap(laps);
  if (!lap) return { ok: false, error: "No GPS lap in that file." };
  const samples = samplesFromLap(lap);
  const ghost = ghostFromSamples(
    track,
    samples,
    `Your lap ${formatLap(lap.lapTimeMs)}`,
  );
  if (!ghost) {
    return {
      ok: false,
      error: "That lap is not on this track. Pick the matching circuit, or try another file.",
    };
  }
  return { ok: true, ghost, samples };
}

export function pointsToSamples(points: TelemetryPoint[]): GeoSample[] {
  return points
    .filter((p) => typeof p.lat === "number" && typeof p.lon === "number")
    .map((p) => ({ t: p.t, lat: p.lat!, lon: p.lon!, alt: p.alt }));
}
