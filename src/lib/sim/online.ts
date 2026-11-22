/**
 * Apex Sim online races: the pure parts. Who is in a lobby, the start message,
 * the grid, the car snapshot sent over the wire, smoothing other drivers' cars
 * between snapshots, and the running order. No network and no DOM here.
 *
 * Model: every driver simulates their own car and sends a snapshot a few times
 * a second while racing. Other cars are drawn from those snapshots a moment in
 * the past, so there is always a pair to blend between. Cars pass through each
 * other: there is no contact between drivers.
 */
import { cleanName, pickHost } from "@/lib/rush/net";
import type { Car } from "./car";
import type { GhostPose } from "./ghost";
import type { SimTrack } from "./track";

/**
 * Most drivers in one lobby. Every snapshot goes to every other driver
 * (SEND_HZ · N · (N−1) messages a second), and Supabase's free tier allows 100/s.
 */
export const MAX_DRIVERS = 3;
/** Snapshots a second from each driver, only while racing. */
export const SEND_HZ = 4;
/** Other cars are drawn this far behind their newest snapshot (ms): a bit over one send interval. */
export const INTERP_DELAY_MS = 320;
/** A late packet is carried on at most this far (ms), then the car holds. */
export const MAX_EXTRAPOLATE_MS = 500;
/** From the Start tap to GO (ms): everyone loads the grid, then the lights. */
export const START_LEAD_MS = 6000;
/** The lights before GO (s), counted down on every screen. */
export const LIGHTS_S = 3;
export const LAP_CHOICES = [3, 5, 10] as const;
export const DEFAULT_LAPS = 3;
/** A driver missing from the lobby this long (ms) is out of the race. */
export const GONE_AFTER_MS = 3000;

/** Sim paint choices, in the order repeats are given out. */
export const SIM_PAINTS = ["#8f1a22", "#e6e6e2", "#5f656d", "#1c3c78", "#15161a"] as const;

export function simChannelName(code: string): string {
  return `sim:lobby:${code}`;
}

export type SimPlayer = {
  id: string;
  name: string;
  paint: string;
  /** Laps the host has picked (only read from the host). */
  laps: number;
  /** In a race right now (late joiners wait for the next one). */
  racing: boolean;
};

const HEX = /^#[0-9a-f]{6}$/i;
const cleanPaint = (v: unknown) => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : SIM_PAINTS[0]);
export const cleanLaps = (v: unknown): number => (LAP_CHOICES.includes(v as (typeof LAP_CHOICES)[number]) ? (v as number) : DEFAULT_LAPS);

/** A player from a presence payload; `id` is the presence key. */
export function readSimPlayer(m: Record<string, unknown>, id: string): SimPlayer {
  return { id, name: cleanName(String(m.name ?? ""), "Driver"), paint: cleanPaint(m.paint), laps: cleanLaps(m.laps), racing: m.racing === true };
}

export type SimGridEntry = { id: string; name: string; paint: string };
export type SimStart = {
  raceId: string;
  laps: number;
  grid: SimGridEntry[];
  /** From receipt to GO (ms), so a phone's wrong clock can't move the start. */
  startInMs: number;
  /** Presence key of the host who sent it. */
  from: string;
};

/**
 * Every driver a paint of their own. In grid order (the same on every device),
 * a driver whose paint someone earlier already has gets the first unused one.
 */
export function distinctSimPaints<T extends { paint: string }>(entries: T[]): T[] {
  const used = new Set<string>();
  return entries.map((e) => {
    let paint = e.paint.toLowerCase();
    if (used.has(paint)) paint = SIM_PAINTS.find((c) => !used.has(c)) ?? paint;
    used.add(paint);
    return paint === e.paint ? e : { ...e, paint };
  });
}

/** A start message if it is well formed and from the current host; otherwise null. */
export function acceptSimStart(payload: unknown, players: SimPlayer[]): SimStart | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Partial<SimStart>;
  if (typeof p.from !== "string" || p.from !== pickHost(players)?.id) return null;
  if (typeof p.raceId !== "string" || !Array.isArray(p.grid)) return null;
  if (typeof p.startInMs !== "number" || !Number.isFinite(p.startInMs)) return null;
  const known = new Set(players.map((q) => q.id));
  const grid = (p.grid as unknown[])
    .filter((g): g is SimGridEntry => !!g && typeof g === "object" && typeof (g as SimGridEntry).id === "string" && known.has((g as SimGridEntry).id))
    .slice(0, MAX_DRIVERS)
    .map((g) => ({ id: g.id, name: cleanName(String(g.name ?? ""), "Driver"), paint: cleanPaint(g.paint) }));
  if (grid.length === 0) return null;
  return {
    raceId: p.raceId.slice(0, 40),
    laps: cleanLaps(p.laps),
    grid: distinctSimPaints(grid),
    startInMs: Math.max(0, Math.min(15000, p.startInMs)),
    from: p.from,
  };
}

/** Grid slot → where the car waits: staggered left/right, 8 m apart, behind the line. */
export function gridSpot(slot: number): { back: number; side: number } {
  return { back: 12 + slot * 8, side: slot % 2 === 0 ? 2.2 : -2.2 };
}

/**
 * How far into the race a car is (m): negative on the grid, then laps done
 * times the lap length plus the distance past the line.
 */
export function raceDistance(track: SimTrack, started: boolean, lap: number, s: number): number {
  if (!started) return s > track.length / 2 ? s - track.length : s;
  return (lap - 1) * track.length + s;
}

/** Wire format of one car (numbers only, rounded, as an array). */
export type SimSnapshot = {
  /** Sender's clock (ms, performance.now on their device). */
  t: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  /** Ground speed (m/s). */
  speed: number;
  /** Road-wheel angle (rad). */
  steer: number;
  roll: number;
  pitch: number;
  braking: boolean;
  /** Race distance (m), for the running order. */
  dist: number;
  /** Laps completed. */
  laps: number;
  finished: boolean;
  /** Race time at the finish (ms from GO). */
  finishMs: number;
  bestLapMs: number;
};

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function encodeSimSnapshot(car: Car, t: number, dist: number, laps: number, finished: boolean, finishMs: number, bestLapMs: number): number[] {
  return [
    Math.round(t),
    r2(car.x),
    r2(car.y),
    r2(car.z),
    r3(car.heading),
    r2(Math.hypot(car.vx, car.vy)),
    r3(car.steer),
    r3(car.roll),
    r3(car.pitch),
    car.brake > 0.03 ? 1 : 0,
    r2(dist),
    laps,
    finished ? 1 : 0,
    Math.round(finishMs),
    Math.round(bestLapMs),
  ];
}

const clampTo = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const MAX_COORD = 50_000;
const MAX_TIME = 6 * 3_600_000;

/** A snapshot from another driver, with every value held to a sane range; null if malformed. */
export function decodeSimSnapshot(a: unknown): SimSnapshot | null {
  if (!Array.isArray(a) || a.length < 15 || !a.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const n = a as number[];
  return {
    t: n[0]!,
    x: clampTo(n[1]!, -MAX_COORD, MAX_COORD),
    y: clampTo(n[2]!, -MAX_COORD, MAX_COORD),
    z: clampTo(n[3]!, -2000, 9000),
    heading: n[4]!,
    speed: clampTo(n[5]!, 0, 120),
    steer: clampTo(n[6]!, -1, 1),
    roll: clampTo(n[7]!, -0.5, 0.5),
    pitch: clampTo(n[8]!, -0.5, 0.5),
    braking: n[9] === 1,
    dist: clampTo(n[10]!, -1000, 99 * MAX_COORD),
    laps: clampTo(Math.round(n[11]!), 0, 99),
    finished: n[12] === 1,
    finishMs: clampTo(n[13]!, 0, MAX_TIME),
    bestLapMs: clampTo(n[14]!, 0, MAX_TIME),
  };
}

/** Where to draw another driver's car, with what the renderer needs beyond a ghost. */
export type RemotePose = GhostPose & { steer: number; roll: number; pitch: number; braking: boolean };

const angLerp = (a: number, b: number, f: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * f;

/**
 * Snapshots from one other driver, and where to draw them now. Sender clocks
 * differ from ours, so the offset is learned from the fastest-arriving packets
 * (the least delayed) and allowed to creep up so drift and lag are followed.
 */
export class RemoteCar {
  private buf: SimSnapshot[] = [];
  private offset = Number.NaN;
  /** Our clock (ms) when the last snapshot arrived. */
  lastHeard = 0;

  push(s: SimSnapshot, now: number): void {
    this.lastHeard = now;
    const off = now - s.t;
    this.offset = Number.isNaN(this.offset) || off < this.offset ? off : this.offset;
    const last = this.buf[this.buf.length - 1];
    if (last && s.t <= last.t) return; // late or duplicate
    this.buf.push(s);
    if (this.buf.length > 24) this.buf.shift();
  }

  /** Let the clock offset relax upward (call every frame). */
  relax(dtMs: number): void {
    if (!Number.isNaN(this.offset)) this.offset += dtMs * 0.01;
  }

  get latest(): SimSnapshot | null {
    return this.buf[this.buf.length - 1] ?? null;
  }

  /** Blend the snapshots at our clock `now` into `out`. False before the first packet. */
  sample(now: number, out: RemotePose): boolean {
    const n = this.buf.length;
    if (n === 0) return false;
    const t = now - this.offset - INTERP_DELAY_MS;
    let a = this.buf[0]!;
    let b = a;
    let f = 0;
    if (t >= this.buf[n - 1]!.t) {
      a = this.buf[n - 1]!;
      b = a;
    } else if (t > a.t) {
      for (let i = 0; i < n - 1; i += 1) {
        if (this.buf[i + 1]!.t >= t) {
          a = this.buf[i]!;
          b = this.buf[i + 1]!;
          f = (t - a.t) / (b.t - a.t || 1);
          break;
        }
      }
    }
    out.x = a.x + (b.x - a.x) * f;
    out.y = a.y + (b.y - a.y) * f;
    out.z = a.z + (b.z - a.z) * f;
    out.heading = angLerp(a.heading, b.heading, f);
    out.speed = a.speed + (b.speed - a.speed) * f;
    out.steer = a.steer + (b.steer - a.steer) * f;
    out.roll = a.roll + (b.roll - a.roll) * f;
    out.pitch = a.pitch + (b.pitch - a.pitch) * f;
    out.braking = (f < 0.5 ? a : b).braking;
    // Past the newest snapshot: carry on along the heading a little.
    if (a === b && t > a.t && !a.finished) {
      const ahead = Math.min(t - a.t, MAX_EXTRAPOLATE_MS) / 1000;
      out.x += Math.cos(a.heading) * a.speed * ahead;
      out.y += Math.sin(a.heading) * a.speed * ahead;
    }
    return true;
  }
}

export type SimStanding = { id: string; name: string; paint: string; dist: number; laps: number; finished: boolean; finishMs: number; bestLapMs: number; gone: boolean; you: boolean };

/** Running order: finishers by time, then everyone still racing by distance, drivers who left last. */
export function simStandings(rows: SimStanding[]): SimStanding[] {
  return rows.slice().sort((a, b) => {
    if (a.gone !== b.gone) return a.gone ? 1 : -1;
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.finished) return a.finishMs - b.finishMs;
    return b.dist - a.dist;
  });
}
