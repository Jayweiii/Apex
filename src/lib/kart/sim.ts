/**
 * Deterministic kart world: fixed 120 Hz step, seeded RNG, no allocation in
 * `stepWorld`. Same (level, seed, input log) ⇒ bit-identical result.
 *
 * Rules: checkpoint gates in order (gate 0 = start/finish), grass slows,
 * a soft wall keeps you near the track, drift scoring with combos, and two
 * items (Turbo, Oil slick).
 */
import { createCar, DRIFT_MIN_SPEED, driftAngle, stepCar, type CarInput, type KartCar } from "./car";
import { createRng, nextRandom, type Rng } from "./rng";
import {
  buildTrack,
  createTrackHit,
  poseAt,
  projectOnTrack,
  type KartLevelDef,
  type KartTrack,
  type TrackHit,
} from "./track";

export const TICK_HZ = 120;
export const DT = 1 / TICK_HZ;

export const ITEM_NONE = 0;
export const ITEM_TURBO = 1;
export const ITEM_OIL = 2;

export const SURFACE_ASPHALT = 0;
export const SURFACE_CURB = 1;
export const SURFACE_GRASS = 2;

/** Rule tuning (all in SI units / ticks). */
export const KART_RULES = {
  curbWidth: 1.4,
  grassMu: 0.45,
  /** Grass drag, N per m/s — "out of bounds slows you down". */
  grassDrag: 520,
  /** Hard boundary this far outside the asphalt (m). */
  wallOutside: 10,
  wallSpeedKeep: 0.6,
  boxRadius: 3.2,
  /** Direct acceleration while a Turbo is active (m/s²), on top of drive force. */
  turboAccel: 7,
  turboTopBonus: 8,
  /** Mini-turbo on drift release: needs this long a hold, scaled by hold time. */
  miniMinHoldTicks: Math.round(0.5 * TICK_HZ),
  miniBaseTicks: Math.round(0.3 * TICK_HZ),
  miniMaxTicks: Math.round(1.1 * TICK_HZ),
  miniAccel: 5,
  miniTopBonus: 4,
  /** Perfect-start window: gas first pressed this late in the countdown. */
  launchWindowS: 0.9,
  launchKick: 2.5,
  launchTicks: Math.round(1.0 * TICK_HZ),
  boxRespawnTicks: 4 * TICK_HZ,
  turboTicks: Math.round(1.2 * TICK_HZ),
  turboForceN: 5200,
  slickRadius: 2,
  slickTicks: Math.round(0.8 * TICK_HZ),
  slickRearMu: 0.35,
  slickArmTicks: Math.round(1.5 * TICK_HZ),
  maxSlicks: 4,
  driftMinAngle: 0.17,
  driftEndAngle: 0.1,
  driftMinSpeed: 8,
  driftEndTicks: Math.round(0.3 * TICK_HZ),
  maxLaps: 16,
  /** Stopped off-track this long ⇒ put back on the centerline. */
  stuckResetTicks: Math.round(2.5 * TICK_HZ),
};

export type KartInput = CarInput & {
  /** Edge-triggered inside the sim (fires on the tick it goes true). */
  useItem: boolean;
};

export type KartWorld = {
  track: KartTrack;
  car: KartCar;
  hit: TrackHit;
  rng: Rng;
  seed: number;
  tick: number;
  /** Lap state. */
  lap: number;
  nextGate: number;
  lapStartTick: number;
  lastLapTicks: number;
  bestLapTicks: number;
  lapTicks: Int32Array;
  lapsDone: number;
  prevS: number;
  /** 0 asphalt, 1 curb, 2 grass. */
  surface: number;
  /** Ticks since the last wall hit (for effects). */
  wallHitTick: number;
  /** Items. */
  item: number;
  prevUseItem: boolean;
  boxCooldown: Int32Array;
  turboTicks: number;
  /** Mini-turbo (drift release / perfect launch) ticks left. */
  miniTicks: number;
  /** Ticks the handbrake has been held in a drift. */
  holdTicks: number;
  /** Tick of the last mini-turbo / launch (HUD flash) and its kind. */
  lastMiniTick: number;
  lastMiniLaunch: boolean;
  slickedTicks: number;
  slickX: Float64Array;
  slickY: Float64Array;
  slickBornTick: Int32Array;
  slickActive: Uint8Array;
  slickNext: number;
  /** Drift scoring. */
  score: number;
  driftPending: number;
  driftTicks: number;
  driftCalmTicks: number;
  drifting: boolean;
  /** Last banked combo (for the HUD flash) and when. */
  lastBank: number;
  lastBankTick: number;
  lastWipeTick: number;
  /** Tick of the last gate passed and which gate (HUD flash). */
  lastGateTick: number;
  wrongWayTicks: number;
  /** Ticks spent stopped off the asphalt (auto-reset after a while). */
  stuckTicks: number;
  /** Tick of the last auto-reset (HUD flash). */
  lastResetTick: number;
};

const SPAWN_AFTER_GATE_M = 6;

export function createWorld(level: KartLevelDef, seed = 1): KartWorld {
  const track = buildTrack(level);
  const car = createCar();
  const hit = createTrackHit();
  const world: KartWorld = {
    track,
    car,
    hit,
    rng: createRng(seed),
    seed,
    tick: 0,
    lap: 1,
    nextGate: 1,
    lapStartTick: 0,
    lastLapTicks: 0,
    bestLapTicks: 0,
    lapTicks: new Int32Array(KART_RULES.maxLaps),
    lapsDone: 0,
    prevS: 0,
    surface: SURFACE_ASPHALT,
    wallHitTick: -1e9,
    item: ITEM_NONE,
    prevUseItem: false,
    boxCooldown: new Int32Array(track.boxX.length),
    turboTicks: 0,
    miniTicks: 0,
    holdTicks: 0,
    lastMiniTick: -1e9,
    lastMiniLaunch: false,
    slickedTicks: 0,
    slickX: new Float64Array(KART_RULES.maxSlicks),
    slickY: new Float64Array(KART_RULES.maxSlicks),
    slickBornTick: new Int32Array(KART_RULES.maxSlicks),
    slickActive: new Uint8Array(KART_RULES.maxSlicks),
    slickNext: 0,
    score: 0,
    driftPending: 0,
    driftTicks: 0,
    driftCalmTicks: 0,
    drifting: false,
    lastBank: 0,
    lastBankTick: -1e9,
    lastWipeTick: -1e9,
    lastGateTick: -1e9,
    wrongWayTicks: 0,
    stuckTicks: 0,
    lastResetTick: -1e9,
  };
  resetCar(world);
  return world;
}

/** Put the car on the grid just past the start/finish line. */
export function resetCar(world: KartWorld): void {
  const pose = poseAt(world.track, SPAWN_AFTER_GATE_M);
  const car = world.car;
  car.x = pose.x;
  car.y = pose.y;
  car.heading = pose.heading;
  car.vx = 0;
  car.vy = 0;
  car.r = 0;
  car.steer = 0;
  car.ax = 0;
  car.ay = 0;
  world.hit.index = pose.index;
  projectOnTrack(world.track, car.x, car.y, world.hit, true);
  world.prevS = world.hit.s;
}

/**
 * Perfect start: call once at GO when gas was pressed inside the launch
 * window. Gives a small kick plus a short mini-turbo. Deterministic — a
 * replay just records the tick it was applied.
 */
export function applyLaunch(world: KartWorld, power = 1): void {
  // Analog: a half-pulled stick at GO gives a half-strength launch.
  const p = Math.max(0, Math.min(1, power));
  world.car.vx += KART_RULES.launchKick * p;
  world.miniTicks = Math.max(world.miniTicks, Math.round(KART_RULES.launchTicks * p));
  world.lastMiniTick = world.tick;
  world.lastMiniLaunch = true;
}

/** Signed wrap of an arc-length difference to (−L/2, L/2]. */
function wrapDelta(ds: number, length: number): number {
  if (ds > length / 2) return ds - length;
  if (ds <= -length / 2) return ds + length;
  return ds;
}

/** Did moving forward from s0 by ds (> 0) pass arc length g? */
function passed(s0: number, ds: number, g: number, length: number): boolean {
  if (ds <= 0) return false;
  const rel = (((g - s0) % length) + length) % length;
  return rel > 0 && rel <= ds;
}

const scratchInput: CarInput = { steer: 0, throttle: 0, brake: 0, handbrake: false, allowReverse: true };

/** Advance the world one fixed tick. Allocation-free. */
export function stepWorld(world: KartWorld, input: KartInput): void {
  const R = KART_RULES;
  const car = world.car;
  const track = world.track;
  world.tick += 1;

  // Quantise inputs so a recorded log replays exactly.
  scratchInput.steer = Math.round(Math.max(-1, Math.min(1, input.steer)) * 64) / 64;
  scratchInput.throttle = Math.round(Math.max(0, Math.min(1, input.throttle)) * 16) / 16;
  scratchInput.brake = Math.round(Math.max(0, Math.min(1, input.brake)) * 16) / 16;
  scratchInput.handbrake = input.handbrake;
  scratchInput.allowReverse = input.allowReverse !== false;

  // Surface from last projection.
  const off = Math.abs(world.hit.d) - track.halfWidth;
  if (off > R.curbWidth) {
    world.surface = SURFACE_GRASS;
    car.surfaceMu = R.grassMu;
    car.extraDrag = R.grassDrag;
  } else if (off > 0) {
    world.surface = SURFACE_CURB;
    car.surfaceMu = 0.92;
    car.extraDrag = 0;
  } else {
    world.surface = SURFACE_ASPHALT;
    car.surfaceMu = 1;
    car.extraDrag = 0;
  }

  // Items in effect.
  if (world.turboTicks > 0) world.turboTicks -= 1;
  car.boostForce = world.turboTicks > 0 ? R.turboForceN : 0;
  // Hills: gravity along the slope, projected onto the kart's heading.
  {
    const k = world.hit.index;
    const along = Math.cos(car.heading) * track.tx[k] + Math.sin(car.heading) * track.ty[k];
    const sinSlope = track.grade[k] / Math.sqrt(1 + track.grade[k] * track.grade[k]);
    car.gradeForce = -car.params.massKg * 9.81 * sinSlope * along;
    // Parked: a released stick (no reverse allowed, no throttle) holds the
    // kart on a slope like a handbrake — gravity only acts once it moves.
    if (!scratchInput.allowReverse && scratchInput.throttle === 0 && car.vx < 0.5) {
      car.gradeForce = 0;
    }
  }
  if (world.miniTicks > 0) world.miniTicks -= 1;
  car.topBonus = world.turboTicks > 0 ? R.turboTopBonus : world.miniTicks > 0 ? R.miniTopBonus : 0;
  // Boosts add acceleration directly so they still push when the rear
  // tires are already at their traction limit.
  if (world.turboTicks > 0) car.vx += R.turboAccel * DT;
  else if (world.miniTicks > 0) car.vx += R.miniAccel * DT;

  // Mini-turbo: hold the drift, release it, get a boost scaled by hold time.
  const dragging = input.handbrake && car.vx >= DRIFT_MIN_SPEED && Math.abs(scratchInput.steer) > 0.1;
  if (dragging) {
    world.holdTicks += 1;
  } else {
    if (world.holdTicks >= R.miniMinHoldTicks) {
      const extra = Math.min(R.miniMaxTicks - R.miniBaseTicks, Math.round(world.holdTicks * 0.4));
      world.miniTicks = Math.max(world.miniTicks, R.miniBaseTicks + extra);
      world.lastMiniTick = world.tick;
      world.lastMiniLaunch = false;
    }
    world.holdTicks = 0;
  }
  if (world.slickedTicks > 0) world.slickedTicks -= 1;
  car.rearMuScale = world.slickedTicks > 0 ? R.slickRearMu : 1;

  // Use item (edge-triggered).
  if (input.useItem && !world.prevUseItem && world.item !== ITEM_NONE) {
    if (world.item === ITEM_TURBO) {
      world.turboTicks = R.turboTicks;
    } else if (world.item === ITEM_OIL) {
      const k = world.slickNext;
      world.slickX[k] = car.x - Math.cos(car.heading) * 3;
      world.slickY[k] = car.y - Math.sin(car.heading) * 3;
      world.slickBornTick[k] = world.tick;
      world.slickActive[k] = 1;
      world.slickNext = (k + 1) % R.maxSlicks;
    }
    world.item = ITEM_NONE;
  }
  world.prevUseItem = input.useItem;

  stepCar(car, scratchInput, DT);
  if (!scratchInput.allowReverse && scratchInput.throttle === 0 && car.vx < 0) car.vx = 0;
  projectOnTrack(track, car.x, car.y, world.hit);

  // Wall: keep the car within reach of the track.
  const hit = world.hit;
  const maxD = track.halfWidth + R.wallOutside;
  if (Math.abs(hit.d) > maxD) {
    const k = hit.index;
    const side = hit.d > 0 ? 1 : -1;
    const nx = -track.ty[k] * side;
    const ny = track.tx[k] * side;
    const push = Math.abs(hit.d) - maxD;
    car.x -= nx * push;
    car.y -= ny * push;
    // World velocity; drop the outward part and scrub speed.
    const ch = Math.cos(car.heading);
    const sh = Math.sin(car.heading);
    let wx = car.vx * ch - car.vy * sh;
    let wy = car.vx * sh + car.vy * ch;
    const out = wx * nx + wy * ny;
    if (out > 0) {
      wx -= out * nx;
      wy -= out * ny;
      // Scrub speed only on an actual impact, not every tick against the
      // wall (that pinned the car so it could never drive away).
      if (out > 1) {
        wx *= R.wallSpeedKeep;
        wy *= R.wallSpeedKeep;
      }
    }
    car.vx = wx * ch + wy * sh;
    car.vy = -wx * sh + wy * ch;
    car.r *= 0.5;
    world.wallHitTick = world.tick;
    hit.d = side * maxD;
  }

  // Gates, in order. Gate 0 (start/finish) completes the lap.
  const ds = wrapDelta(hit.s - world.prevS, track.length);
  const gateS = track.gates[world.nextGate];
  if (passed(world.prevS, ds, gateS, track.length)) {
    world.lastGateTick = world.tick;
    if (world.nextGate === 0) {
      const lapTicks = world.tick - world.lapStartTick;
      world.lastLapTicks = lapTicks;
      if (world.bestLapTicks === 0 || lapTicks < world.bestLapTicks) {
        world.bestLapTicks = lapTicks;
      }
      if (world.lapsDone < R.maxLaps) world.lapTicks[world.lapsDone] = lapTicks;
      world.lapsDone += 1;
      world.lap += 1;
      world.lapStartTick = world.tick;
    }
    world.nextGate = (world.nextGate + 1) % track.gates.length;
  }
  world.wrongWayTicks =
    ds < -0.02 && Math.abs(car.vx) > 3 ? world.wrongWayTicks + 1 : 0;
  world.prevS = hit.s;

  // Stuck off the asphalt (e.g. nose into the wall)? Put the car back on
  // the centerline facing forward, without moving its race progress.
  const stopped = Math.hypot(car.vx, car.vy) < 1;
  world.stuckTicks = stopped && world.surface === SURFACE_GRASS ? world.stuckTicks + 1 : 0;
  if (world.stuckTicks >= R.stuckResetTicks) {
    const k = hit.index;
    car.x = track.px[k];
    car.y = track.py[k];
    car.heading = Math.atan2(track.ty[k], track.tx[k]);
    car.vx = 0;
    car.vy = 0;
    car.r = 0;
    car.steer = 0;
    hit.d = 0;
    world.stuckTicks = 0;
    world.lastResetTick = world.tick;
  }

  // Item boxes.
  for (let b = 0; b < track.boxX.length; b += 1) {
    if (world.boxCooldown[b] > 0) {
      world.boxCooldown[b] -= 1;
      continue;
    }
    const dx = car.x - track.boxX[b];
    const dy = car.y - track.boxY[b];
    if (dx * dx + dy * dy < R.boxRadius * R.boxRadius) {
      world.boxCooldown[b] = R.boxRespawnTicks;
      if (world.item === ITEM_NONE) {
        world.item = nextRandom(world.rng) < 0.55 ? ITEM_TURBO : ITEM_OIL;
      }
    }
  }

  // Oil slicks (your own arms after a moment, so you can't hit it at once).
  for (let k = 0; k < R.maxSlicks; k += 1) {
    if (!world.slickActive[k]) continue;
    if (world.tick - world.slickBornTick[k] < R.slickArmTicks) continue;
    const dx = car.x - world.slickX[k];
    const dy = car.y - world.slickY[k];
    if (dx * dx + dy * dy < R.slickRadius * R.slickRadius) {
      world.slickedTicks = R.slickTicks;
      world.slickActive[k] = 0;
    }
  }

  // Drift scoring with combos; grass or a wall while drifting wipes it.
  const beta = Math.abs(driftAngle(car));
  const speed = Math.hypot(car.vx, car.vy);
  const onTrack = world.surface !== SURFACE_GRASS;
  if (beta > R.driftMinAngle && speed > R.driftMinSpeed && onTrack) {
    world.drifting = true;
    world.driftTicks += 1;
    world.driftCalmTicks = 0;
    const mult = 1 + Math.min(4, Math.floor(world.driftTicks / TICK_HZ));
    world.driftPending += beta * speed * DT * 10 * mult;
  } else if (world.drifting) {
    const wiped = !onTrack || world.wallHitTick === world.tick;
    if (wiped) {
      world.driftPending = 0;
      world.drifting = false;
      world.driftTicks = 0;
      world.lastWipeTick = world.tick;
    } else if (beta < R.driftEndAngle || speed < R.driftMinSpeed) {
      world.driftCalmTicks += 1;
      if (world.driftCalmTicks >= R.driftEndTicks) {
        const banked = Math.round(world.driftPending);
        world.score += banked;
        world.lastBank = banked;
        world.lastBankTick = world.tick;
        world.driftPending = 0;
        world.drifting = false;
        world.driftTicks = 0;
      }
    }
  }
}

/** Current combo multiplier (1…5). */
export function comboMultiplier(world: KartWorld): number {
  return world.drifting ? 1 + Math.min(4, Math.floor(world.driftTicks / TICK_HZ)) : 1;
}

/** Ticks → milliseconds. */
export function ticksToMs(ticks: number): number {
  return Math.round((ticks * 1000) / TICK_HZ);
}

/** FNV-1a over the sim state, for determinism checks and replay verify. */
export function hashWorld(world: KartWorld): string {
  const c = world.car;
  const values = [
    c.x, c.y, c.heading, c.vx, c.vy, c.r, c.steer,
    world.tick, world.lap, world.nextGate, world.score, world.item,
    world.rng.state, world.turboTicks, world.slickedTicks, world.miniTicks,
  ];
  let h = 0x811c9dc5;
  for (const v of values) {
    const s = Number.isInteger(v) ? String(v) : v.toPrecision(15);
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
