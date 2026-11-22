/**
 * Apex Rush multiplayer: the pure parts. Lobby codes, the compact kart
 * snapshot sent over the wire, and the buffer that turns a few snapshots a
 * second into smooth motion. No network and no DOM here, so it is testable.
 *
 * Model: every player simulates their own kart and broadcasts its state a few
 * times a second. Other players' karts are drawn from those snapshots, a short
 * moment in the past so there is always a pair to blend between, and carried
 * forward along their heading when a packet is late.
 */
import type { Kart } from "./kart";

/** Most racers in one lobby. */
export const MAX_PLAYERS = 6;
/** Snapshots per second from each racer. */
export const SEND_HZ = 8;
/** Remote karts are drawn this far behind their newest snapshot (ms). */
export const INTERP_DELAY_MS = 220;
/** A late packet is extrapolated at most this far (ms), then the kart holds. */
export const MAX_EXTRAPOLATE_MS = 400;

/** No 0/O, 1/I/L: codes are read aloud and typed on phones. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 4;

export function makeLobbyCode(rand: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)]!;
  return s;
}

/** Uppercase and drop spaces and dashes; null if it can't be a code. */
export function normalizeLobbyCode(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[\s-]/g, "");
  if (s.length !== CODE_LENGTH) return null;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
  return s;
}

export function lobbyChannelName(code: string): string {
  return `rush:lobby:${code}`;
}

/** Player names: short, printable, never empty. */
export function cleanName(raw: string, fallback: string): string {
  const s = raw.replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, 14);
  return s || fallback;
}

/** Wire format of one kart snapshot (numbers only, rounded, as an array). */
export type Snapshot = {
  /** Sender's clock (ms, performance.now on their device). */
  t: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  va: number;
  v: number;
  steer: number;
  drifting: number;
  chargeLevel: number;
  boosting: boolean;
  lap: number;
  progress: number;
  finished: boolean;
  finishMs: number;
  bestLapMs: number;
};

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function encodeSnapshot(k: Kart, t: number): number[] {
  return [
    Math.round(t),
    r2(k.x),
    r2(k.y),
    r2(k.z),
    r3(k.heading),
    r3(k.va),
    r2(k.v),
    r2(k.steer),
    k.drifting,
    k.chargeLevel,
    k.boostT > 0 ? 1 : 0,
    k.lap,
    r2(k.progress),
    k.finished ? 1 : 0,
    Math.round(k.finishMs),
    Math.round(k.bestLapMs),
  ];
}

export function decodeSnapshot(a: unknown): Snapshot | null {
  if (!Array.isArray(a) || a.length < 16 || !a.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const n = a as number[];
  return {
    t: n[0]!,
    x: n[1]!,
    y: n[2]!,
    z: n[3]!,
    heading: n[4]!,
    va: n[5]!,
    v: n[6]!,
    steer: n[7]!,
    drifting: Math.sign(n[8]!),
    chargeLevel: Math.max(0, Math.min(3, Math.round(n[9]!))),
    boosting: n[10] === 1,
    lap: n[11]!,
    progress: n[12]!,
    finished: n[13] === 1,
    finishMs: n[14]!,
    bestLapMs: n[15]!,
  };
}

const angLerp = (a: number, b: number, f: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * f;

/**
 * Snapshots from one remote racer, and where to draw them now. Sender clocks
 * differ from ours, so the offset between the two is learned from the
 * fastest-arriving packets (the least delayed) and allowed to drift slowly.
 */
export class RemoteKart {
  private buf: Snapshot[] = [];
  private offset = Number.NaN;
  /** Our clock (ms) when the last snapshot arrived. */
  lastHeard = 0;

  push(s: Snapshot, now: number): void {
    this.lastHeard = now;
    const off = now - s.t;
    // The smallest delay seen is the best estimate; creep up slowly so a
    // drifting clock or a jump in latency is followed.
    this.offset = Number.isNaN(this.offset) || off < this.offset ? off : this.offset;
    const last = this.buf[this.buf.length - 1];
    if (last && s.t <= last.t) return; // late or duplicate packet
    this.buf.push(s);
    if (this.buf.length > 24) this.buf.shift();
  }

  /** Let the clock offset relax upward over time (call every frame). */
  relax(dtMs: number): void {
    if (!Number.isNaN(this.offset)) this.offset += dtMs * 0.01;
  }

  get latest(): Snapshot | null {
    return this.buf[this.buf.length - 1] ?? null;
  }

  /** Blend the snapshots at our clock `now` into `out` (a kart). False before the first packet. */
  sample(now: number, out: Kart): boolean {
    const n = this.buf.length;
    if (n === 0) return false;
    const t = now - this.offset - INTERP_DELAY_MS;
    let a = this.buf[0]!;
    let b = a;
    let f = 0;
    if (t <= a.t) {
      b = a;
    } else if (t >= this.buf[n - 1]!.t) {
      a = this.buf[n - 1]!;
      b = a;
    } else {
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
    out.va = angLerp(a.va, b.va, f);
    out.v = a.v + (b.v - a.v) * f;
    out.steer = a.steer + (b.steer - a.steer) * f;
    // Past the newest snapshot: carry on along the travel direction a little.
    if (a === b && t > a.t && !a.finished) {
      const ahead = Math.min(t - a.t, MAX_EXTRAPOLATE_MS) / 1000;
      out.x += Math.cos(a.va) * a.v * ahead;
      out.y += Math.sin(a.va) * a.v * ahead;
    }
    const s = f < 0.5 ? a : b;
    out.drifting = s.drifting;
    out.chargeLevel = s.chargeLevel;
    out.boostT = s.boosting ? 0.1 : 0;
    // Race standing comes from the newest packet, not the blended past.
    const latest = this.buf[n - 1]!;
    out.lap = latest.lap;
    out.progress = latest.progress;
    out.finished = latest.finished;
    out.finishMs = latest.finishMs;
    out.bestLapMs = latest.bestLapMs;
    return true;
  }
}

/** Lobby member as shared through presence. */
export type LobbyPlayer = {
  id: string;
  name: string;
  /** Our clock is not theirs: an epoch time (ms) used only to order who joined first. */
  joinedAt: number;
  look: unknown;
  /** Track the host has picked (only read from the host). */
  levelId?: string;
  /** In a race right now (late joiners wait for the next one). */
  racing?: boolean;
};

/** The host is whoever has been in the lobby longest (ties by id), so a new host is picked if they leave. */
export function pickHost(players: LobbyPlayer[]): LobbyPlayer | null {
  let best: LobbyPlayer | null = null;
  for (const p of players) {
    if (!best || p.joinedAt < best.joinedAt || (p.joinedAt === best.joinedAt && p.id < best.id)) best = p;
  }
  return best;
}
