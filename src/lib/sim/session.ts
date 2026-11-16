/**
 * Apex Sim session: fixed-step driving, lap timing, track limits and the
 * lap recording that becomes the player's own ghost. Also a test driver
 * that laps the car on its own (used by the contracts and the demo lap).
 */
import { carSpeed, createCar, EV_OFF, placeCar, stepCar, type Car, type CarInput, type CarSpec } from "./car";
import { type SimTrack } from "./track";

/** Physics rate and the display rate it is stepped from. */
export const PHYSICS_HZ = 480;
export const FRAME_HZ = 60;
export const SUBSTEPS = PHYSICS_HZ / FRAME_HZ;
export const DT = 1 / PHYSICS_HZ;
/** Ghost recording interval (ms). */
export const RECORD_MS = 100;

export type Session = {
  track: SimTrack;
  car: Car;
  /** Simulated time since the session started (ms). */
  clockMs: number;
  /** Time into the current lap (ms); negative before the first line crossing. */
  lapMs: number;
  lap: number;
  lapValid: boolean;
  lastLapMs: number;
  lastLapValid: boolean;
  bestLapMs: number;
  /** [x, y, ms] samples of the lap in progress. */
  recording: number[];
  /** Recording of the best valid lap. */
  bestRecording: number[];
  /** Lap just completed on this frame. */
  lapDone: boolean;
  prevS: number;
  started: boolean;
  nextRecordMs: number;
};

/** Start a flying lap: the car rolls toward the line from `runUp` m before it. */
export function createSession(track: SimTrack, spec?: CarSpec, runUp = 60, speed = 0): Session {
  const car = createCar(spec);
  placeCar(car, track, track.length - runUp, 0, speed);
  return {
    track,
    car,
    clockMs: 0,
    lapMs: -1,
    lap: 0,
    lapValid: true,
    lastLapMs: 0,
    lastLapValid: false,
    bestLapMs: 0,
    recording: [],
    bestRecording: [],
    lapDone: false,
    prevS: car.hit.s,
    started: false,
    nextRecordMs: 0,
  };
}

/** One display frame: SUBSTEPS physics steps with the same input. */
export function stepSession(ses: Session, input: CarInput): void {
  const { car, track } = ses;
  ses.lapDone = false;
  let shift = input.shift;
  for (let k = 0; k < SUBSTEPS; k += 1) {
    input.shift = shift;
    stepCar(car, input, track, DT);
    shift = 0;
    const s = car.hit.s;
    // Crossing the line forwards: s wraps from near the end to near zero.
    if (ses.prevS > track.length * 0.75 && s < track.length * 0.25 && car.vx > 0) {
      const stepLen = s + (track.length - ses.prevS);
      const frac = stepLen > 1e-6 ? 1 - s / stepLen : 0;
      const crossMs = ses.clockMs + frac * DT * 1000;
      if (ses.started) {
        ses.lastLapMs = crossMs - (ses.clockMs - ses.lapMs);
        ses.lastLapValid = ses.lapValid;
        ses.lapDone = true;
        if (ses.lapValid && (ses.bestLapMs === 0 || ses.lastLapMs < ses.bestLapMs)) {
          ses.bestLapMs = ses.lastLapMs;
          ses.bestRecording = ses.recording.concat([car.x, car.y, ses.lastLapMs]);
        }
      }
      ses.started = true;
      ses.lap += 1;
      ses.lapMs = ses.clockMs - crossMs;
      ses.lapValid = true;
      ses.recording = [];
      ses.nextRecordMs = 0;
    }
    ses.prevS = s;
    ses.clockMs += DT * 1000;
    if (ses.started) {
      ses.lapMs += DT * 1000;
      if (car.wheelsOff >= 4) ses.lapValid = false;
      if (ses.lapMs >= ses.nextRecordMs) {
        ses.recording.push(car.x, car.y, ses.lapMs);
        ses.nextRecordMs += RECORD_MS;
      }
    }
  }
  if (car.events & EV_OFF) ses.lapValid = ses.started ? false : ses.lapValid;
}

/** Back on the road, stopped, a little before where the car left it. */
export function resetToTrack(ses: Session): void {
  const s = ses.car.hit.s - 15;
  placeCar(ses.car, ses.track, (s + ses.track.length) % ses.track.length, 0, 0);
  ses.prevS = ses.car.hit.s;
  if (ses.started) ses.lapValid = false;
}

export type Pilot = {
  /** Target speed at each track sample (m/s). */
  target: Float32Array;
  integral: number;
};

/**
 * Speed the car can carry at each point of the line: cornering grip sets the
 * ceiling, then a backward pass leaves room to brake for what comes next.
 */
export function createPilot(track: SimTrack, spec: CarSpec, effort = 0.94): Pilot {
  const n = track.n;
  const target = new Float32Array(n);
  const lat = spec.grip * 9.81 * effort;
  for (let i = 0; i < n; i += 1) {
    const k = Math.abs(track.curv[i]!);
    const light = Math.min(0, track.vcurv[i]!);
    // On a crest the car is lighter: v²·(|κ|/μ − crest) ≤ g.
    const denom = k / (spec.grip * effort) - light;
    target[i] = denom > 1e-5 ? Math.min(75, Math.sqrt(9.81 / denom)) : 75;
    if (lat <= 0) target[i] = 0;
  }
  const brake = spec.grip * 9.81 * 0.78 * effort;
  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = n - 1; i >= 0; i -= 1) {
      const next = target[(i + 1) % n]!;
      const cornering = (next * next * Math.abs(track.curv[i]!)) / lat;
      const room = brake * Math.max(0, 1 - Math.min(1, cornering)) + 9.81 * track.grade[i]!;
      const allowed = Math.sqrt(next * next + 2 * Math.max(1, room) * track.spacing);
      if (allowed < target[i]!) target[i] = allowed;
    }
  }
  return { target, integral: 0 };
}

/** Drive the line: aim at a point ahead, hold the target speed. */
export function pilotInput(pilot: Pilot, ses: Session, out: CarInput): CarInput {
  const { car, track } = ses;
  const v = carSpeed(car);
  const look = 5 + v * 0.32;
  const f = (car.hit.s + look) / track.spacing;
  const j = ((Math.floor(f) % track.n) + track.n) % track.n;
  const dx = track.px[j]! - car.x;
  const dy = track.py[j]! - car.y;
  const ch = Math.cos(car.heading);
  const sh = Math.sin(car.heading);
  const lx = dx * ch + dy * sh;
  const ly = -dx * sh + dy * ch;
  const curvature = (2 * ly) / (lx * lx + ly * ly || 1);
  // Catch a slide: once the rear tyres are past their peak, steer into it.
  const rear = (car.slipAngle[2]! + car.slipAngle[3]!) / 2;
  const slide = Math.sign(rear) * Math.max(0, Math.abs(rear) - car.spec.peakSlipAngle * 0.75);
  const angle = Math.atan(curvature * car.spec.wheelbase * 1.05) + slide * 1.6;
  out.steer = Math.max(-1, Math.min(1, angle / car.spec.maxSteer));
  const ahead = ((Math.floor((car.hit.s + 2 + v * 0.1) / track.spacing) % track.n) + track.n) % track.n;
  const err = pilot.target[ahead]! - v;
  // Share the tyres: the harder the car is cornering, the less pedal it gets.
  const busy = Math.min(1, Math.abs(car.ay) / (car.spec.grip * 9.81 * 0.95));
  const spare = Math.sqrt(Math.max(0, 1 - busy * busy));
  let throttle = 0;
  let brake = 0;
  if (err > 0) throttle = Math.min(1, err * 0.9) * (0.3 + 0.7 * spare);
  else if (err > -0.6) throttle = 0.25 * (1 + err / 0.6);
  else brake = Math.min(1, (-err - 0.6) * 0.7) * (0.12 + 0.88 * spare);
  if (Math.abs(slide) > 0.02) {
    throttle = Math.min(throttle, 0.2);
    brake = 0;
  }
  // Feet move smoothly: no snapping off the throttle mid-corner.
  out.throttle += Math.max(-0.07, Math.min(0.1, throttle - out.throttle));
  out.brake += Math.max(-0.15, Math.min(0.08, brake - out.brake));
  out.shift = 0;
  out.autoShift = true;
  out.abs = true;
  out.tractionControl = true;
  return out;
}

export function blankInput(): CarInput {
  return { steer: 0, throttle: 0, brake: 0, shift: 0, autoShift: true, abs: true, tractionControl: true };
}
