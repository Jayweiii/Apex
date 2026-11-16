/**
 * Apex Sim controls: turns keys, a gamepad or touch into car inputs.
 *
 * A key is all-or-nothing, so steering and pedals are eased the way hands and
 * feet move, and the steering lock offered shrinks with speed to roughly what
 * the front tyres can use. With steering help on, the wheel also eases into a
 * slide the way a driver would catch it. None of this changes the car: the
 * physics sees only steer, throttle and brake.
 */
import type { Car, CarInput } from "./car";

export type RawControls = {
  /** −1 right … +1 left. */
  steer: number;
  throttle: number;
  brake: number;
  /** True when steer/pedals are already analogue (gamepad, touch drag). */
  analog: boolean;
  shiftUp: boolean;
  shiftDown: boolean;
};

export type Assists = {
  autoShift: boolean;
  abs: boolean;
  tractionControl: boolean;
  steeringHelp: boolean;
};

export const DEFAULT_ASSISTS: Assists = { autoShift: true, abs: true, tractionControl: true, steeringHelp: true };

export type ControlState = { steer: number; throttle: number; brake: number; upHeld: boolean; downHeld: boolean };

export function createControlState(): ControlState {
  return { steer: 0, throttle: 0, brake: 0, upHeld: false, downHeld: false };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const approach = (v: number, target: number, up: number, down: number) => v + clamp(target - v, -down, up);

/** Share of full lock that is useful at this speed. */
export function usefulLock(car: Car): number {
  const sp = car.spec;
  const v = Math.max(4, Math.hypot(car.vx, car.vy));
  const angle = (sp.wheelbase * sp.grip * 9.81 * 1.15) / (v * v) + sp.peakSlipAngle * 1.25;
  return clamp(angle / sp.maxSteer, 0.05, 1);
}

/** One display frame of control shaping; writes the car input. */
export function shapeControls(state: ControlState, raw: RawControls, assists: Assists, car: Car, dt: number, out: CarInput): CarInput {
  const lock = usefulLock(car);
  // Reverse gear with the automatic box: the pedals swap, like a driver would.
  const reversing = assists.autoShift && car.gear < 0;
  const wantThrottle = reversing ? raw.brake : raw.throttle;
  const wantBrake = reversing ? raw.throttle : raw.brake;
  if (raw.analog) {
    // A stick or a drag is progressive: gentle near centre, full useful lock at the end.
    const shaped = Math.sign(raw.steer) * Math.abs(raw.steer) ** 1.6;
    state.steer = approach(state.steer, shaped * lock, 6 * dt, 6 * dt);
    state.throttle = approach(state.throttle, wantThrottle, 8 * dt, 12 * dt);
    state.brake = approach(state.brake, wantBrake, 8 * dt, 12 * dt);
  } else {
    const target = raw.steer * lock;
    const away = Math.sign(target) !== Math.sign(state.steer) || Math.abs(target) < Math.abs(state.steer);
    state.steer = approach(state.steer, target, (away ? 3.2 : 1.7) * lock * dt + 0.2 * dt, (away ? 3.2 : 1.7) * lock * dt + 0.2 * dt);
    state.throttle = approach(state.throttle, wantThrottle, 3.5 * dt, 7 * dt);
    state.brake = approach(state.brake, wantBrake, 4.5 * dt, 9 * dt);
  }
  let steer = state.steer;
  if (assists.steeringHelp && car.vx > 3) {
    const rear = (car.slipAngle[2]! + car.slipAngle[3]!) / 2;
    const slide = Math.sign(rear) * Math.max(0, Math.abs(rear) - car.spec.peakSlipAngle * 0.8);
    steer += (slide * 1.4) / car.spec.maxSteer;
  }
  out.steer = clamp(steer, -1, 1);
  out.throttle = state.throttle;
  out.brake = state.brake;
  out.shift = 0;
  if (assists.autoShift) {
    // Automatic: braking to a stop and holding the brake selects reverse.
    if (car.gear > 0 && Math.abs(car.vx) < 0.4 && raw.brake > 0.5 && raw.throttle < 0.1) out.shift = car.gear === 1 ? -1 : 0;
    else if (car.gear < 0 && Math.abs(car.vx) < 0.4 && raw.throttle > 0.5 && raw.brake < 0.1) out.shift = 1;
  } else {
    if (raw.shiftUp && !state.upHeld) out.shift = 1;
    else if (raw.shiftDown && !state.downHeld) out.shift = -1;
  }
  state.upHeld = raw.shiftUp;
  state.downHeld = raw.shiftDown;
  out.autoShift = assists.autoShift && car.gear > 0;
  out.abs = assists.abs;
  out.tractionControl = assists.tractionControl;
  return out;
}

/** Read the first connected standard gamepad into `raw`; false when none. */
export function readGamepad(raw: RawControls): boolean {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return false;
  for (const pad of navigator.getGamepads()) {
    if (!pad || !pad.connected) continue;
    const x = pad.axes[0] ?? 0;
    const dead = Math.abs(x) < 0.06 ? 0 : (Math.abs(x) - 0.06) / 0.94;
    const throttle = pad.buttons[7]?.value ?? 0;
    const brake = pad.buttons[6]?.value ?? 0;
    const up = !!pad.buttons[5]?.pressed || !!pad.buttons[0]?.pressed;
    const down = !!pad.buttons[4]?.pressed || !!pad.buttons[2]?.pressed;
    if (dead === 0 && throttle < 0.02 && brake < 0.02 && !up && !down) continue;
    raw.steer = -Math.sign(x) * dead;
    raw.throttle = throttle;
    raw.brake = brake;
    raw.analog = true;
    raw.shiftUp = up;
    raw.shiftDown = down;
    return true;
  }
  return false;
}
