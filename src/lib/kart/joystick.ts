/**
 * Floating-joystick maths for Apex Kart (#51). Pure functions so the feel can
 * be unit-tested without a DOM.
 *
 * Offset (dx, dy) is in px from where the thumb landed; +x is right, +y is
 * down (screen space). Direction-based: the stick ANGLE is the heading the
 * kart should face (screen "up" = the camera's forward direction), the stick
 * DISTANCE is the throttle, and releasing the stick brakes. The kart only ever
 * drives forward.
 */
export const STICK_RADIUS = 56;
/** Fraction of the radius ignored around the centre. */
export const STICK_DEAD = 0.12;
/** Steer backed off per rad/s of yaw rate (damps overshoot / spin-out). */
export const YAW_DAMP = 0.4;
/**
 * Yaw-rate controller: commanded rate is YAW_RATE_GAIN·err, capped at what the
 * tyres can bend the path at this speed (LATERAL_G·g / v). Higher than the
 * legacy gain of 2 so from-rest 135°/180° aims reach err<0.3 within 1.5 s;
 * the rate cap still prevents body vx < 0.
 */
export const YAW_RATE_GAIN = 3.2;
/** Lateral acceleration (in g) the yaw-rate cap assumes the tyres can hold. */
export const LATERAL_G = 1.6;
/**
 * Speed floor (m/s) in the yaw-rate cap. Lower than mid-corner tyre speed so a
 * standing-start U-turn can command near-full arcade yaw instead of stalling
 * at ~2.6 rad/s (the old floor of 6 m/s left 180° aims at err≈0.7 after 1.5 s).
 */
export const CAP_MIN_SPEED = 3.5;
/** Lateral grip (g) the friction-circle throttle limit budgets for. */
export const GRIP_G = 1.0;
/** Lowest fraction of the pulled throttle kept while cornering at the limit. */
export const TRACTION_FLOOR = 0.3;
/** Speed (m/s) below which the traction budget uses the actual yaw rate only. */
export const TRACTION_FF_LO = 4;
/** Speed (m/s) at/above which it uses the full commanded yaw rate. */
export const TRACTION_FF_HI = 8;
/**
 * Arcade yaw (rad/s) the car applies at full stick-steer while crawling.
 * Must match `stepCar`'s low-speed yaw floor so open-loop steer→yaw is 1:1:
 * steer = −rDes / ARCADE_YAW_PER_STEER reaches rDes without the PD equilibrium
 * that only delivered ~half the commanded rate from rest.
 */
export const ARCADE_YAW_PER_STEER = 4.2;
/** Speed (m/s) where arcade open-loop steer finishes fading to the tyre PD. */
export const ARCADE_STEER_FADE = 18;
/**
 * Stick-angle change (rad) that re-latches the chase camera during a hold.
 * ~0.15 (~9°) let thumb wobble pick up the live camera and restart circling;
 * ~25° still catches a deliberate re-aim.
 */
export const RELATCH_ANGLE = 0.45;

/** True when the stick has been re-aimed far enough to refresh the cam latch. */
export function shouldRelatchCam(prevAng: number, ang: number, threshold = RELATCH_ANGLE): boolean {
  return Math.abs(wrapAngle(ang - prevAng)) > threshold;
}

export interface StickOutput {
  /** −1 (left) … +1 (right): rear-end steer toward the target heading. */
  steer: number;
  /** 0 … 1: stick distance past the dead zone, linear. */
  throttle: number;
  /** Sharp heading change on throttle = hold the drift (mini-turbo charge). */
  handbrake: boolean;
  /** World heading (rad, 0 = +x, CCW +) the stick points at; null in the dead zone. */
  target: number | null;
}

export function wrapAngle(a: number): number {
  let r = a;
  while (r > Math.PI) r -= 2 * Math.PI;
  while (r < -Math.PI) r += 2 * Math.PI;
  return r;
}

/** Clamp an offset to the stick radius (for drawing the knob). */
export function clampToRadius(dx: number, dy: number, r = STICK_RADIUS): { x: number; y: number } {
  const len = Math.hypot(dx, dy);
  if (len <= r || len === 0) return { x: dx, y: dy };
  const k = r / len;
  return { x: dx * k, y: dy * k };
}

/** Stick distance past the dead zone, 0..1, linear. */
export function stickThrottle(dx: number, dy: number, r = STICK_RADIUS): number {
  const c = clampToRadius(dx, dy, r);
  const d = Math.hypot(c.x, c.y) / r;
  return d <= STICK_DEAD ? 0 : Math.min(1, (d - STICK_DEAD) / (1 - STICK_DEAD));
}

/**
 * Screen-space stick offset → world heading. Screen "up" is world angle
 * `camRot` (the heading-up camera); screen "left" is camRot + 90° (CCW).
 */
export function stickTargetHeading(dx: number, dy: number, camRot: number): number {
  return wrapAngle(camRot + Math.atan2(-dx, -dy));
}

/**
 * @param heading current kart heading (world rad)
 * @param camRot  world angle that points to screen-up (camera rotation)
 */
export function stickOutput(
  dx: number,
  dy: number,
  heading = 0,
  camRot = 0,
  r = STICK_RADIUS,
  yawRate = 0,
  vx = 0,
  vy = 0,
): StickOutput {
  const throttle = stickThrottle(dx, dy, r);
  if (throttle <= 0) return { steer: 0, throttle: 0, handbrake: false, target: null };
  const target = stickTargetHeading(dx, dy, camRot);
  const err = wrapAngle(target - heading); // + = target is to the left
  // Commanded yaw rate (+ = left), capped to what the tyres can follow.
  const speed = Math.hypot(vx, vy);
  const rMax = (LATERAL_G * 9.81) / Math.max(speed, CAP_MIN_SPEED);
  const rDes = Math.max(-rMax, Math.min(rMax, err * YAW_RATE_GAIN));
  // At crawl, map rDes → steer open-loop so full stick commands the arcade
  // yaw floor 1:1 (the legacy PD only reached ~½ rDes in equilibrium with
  // that plant, and a from-rest 90° aim hit the wall still turning). Fade
  // to the yaw-rate PD as tyres take over at speed.
  const arcade = Math.max(0, Math.min(1, (ARCADE_STEER_FADE - speed) / ARCADE_STEER_FADE));
  const steerOpen = -rDes / ARCADE_YAW_PER_STEER;
  const steerPd = -(rDes - yawRate) * YAW_DAMP;
  const steer = Math.max(-1, Math.min(1, steerOpen * arcade + steerPd * (1 - arcade)));
  // Friction circle: the rears can't both drive and corner at the limit. Full
  // throttle through a big turn spends the rear grip on drive force and the
  // tail steps out into a sustained spin (the full-radius right hold circled
  // 14 rad while the 0.8-radius hold, with less throttle, settled). Scale the
  // throttle by the grip left after the lateral demand of the commanded yaw
  // rate. Zero when speed is unknown/zero, so a standing start is unaffected.
  // At crawling speeds the commanded rate is a feed-forward the car can't yet
  // follow, and budgeting for it cut drive to the floor right when a standing
  // start needs speed (the 90°/180° holds from rest spent 1–4 s at 30% throttle).
  // Below TRACTION_FF_LO use the yaw rate the car actually has; fade to the
  // commanded rate by TRACTION_FF_HI, where the tail-out spin can happen.
  const ff = Math.max(0, Math.min(1, (speed - TRACTION_FF_LO) / (TRACTION_FF_HI - TRACTION_FF_LO)));
  const rBudget = Math.abs(yawRate) + ff * Math.max(0, Math.abs(rDes) - Math.abs(yawRate));
  const ayDemand = Math.min(1, (speed * rBudget) / (GRIP_G * 9.81));
  const tractionScale = Math.max(TRACTION_FLOOR, Math.sqrt(1 - ayDemand * ayDemand));
  return {
    steer,
    throttle: throttle * tractionScale,
    // The stick never holds the handbrake itself: a held drift pinned the
    // heading short of (or past) the target. Drift is the explicit Space key.
    handbrake: false,
    target,
  };
}
