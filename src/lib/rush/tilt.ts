/**
 * Apex Rush tilt steering: turn the phone like a steering wheel, or tip it
 * left and right while holding it flat. Either way the screen's own
 * left–right axis is compared with the horizon, so it works in portrait and
 * landscape and at any angle you hold the phone towards you.
 */

/** Tilt (degrees) for full steering lock. Kept well short of 45° so the screen doesn't auto-rotate. */
export const TILT_FULL_DEG = 22;
/** Tilt (degrees) ignored around level, so a steady hand drives straight. */
export const TILT_DEAD_DEG = 2.5;
/** No reading for this long (ms) and tilt counts as off: the thumb steers instead. */
export const TILT_STALE_MS = 800;

const RAD = Math.PI / 180;

/** Shown when the browser refuses motion access. */
export const TILT_BLOCKED = "MOTION ACCESS IS OFF: ALLOW IT FOR THIS SITE IN YOUR BROWSER SETTINGS, THEN TRY AGAIN";

/**
 * Steering from a device orientation reading.
 * @param beta,gamma  DeviceOrientationEvent angles (degrees)
 * @param screenDeg   how far the screen is turned from the device's natural orientation
 *                    (screen.orientation.angle: 0 portrait, 90 or 270/−90 landscape)
 * @returns −1 (full left) … +1 (full right)
 */
export function tiltSteer(beta: number, gamma: number, screenDeg: number, fullDeg = TILT_FULL_DEG, deadDeg = TILT_DEAD_DEG): number {
  const b = beta * RAD;
  const g = gamma * RAD;
  // "Up" in the device's own axes (x right, y towards the top, z out of the screen).
  const upX = -Math.sin(g) * Math.cos(b);
  const upY = Math.sin(b);
  // The screen's right-hand direction, in device axes, after rotation by the screen angle.
  const s = screenDeg * RAD;
  const upAlongScreenRight = upX * Math.cos(s) - upY * Math.sin(s);
  // Screen-right lower than screen-left means up points left: steer right.
  const roll = Math.asin(Math.max(-1, Math.min(1, -upAlongScreenRight))) / RAD;
  const mag = Math.abs(roll);
  if (mag <= deadDeg) return 0;
  return Math.sign(roll) * Math.min(1, (mag - deadDeg) / (fullDeg - deadDeg));
}

function screenAngle(): number {
  const so = typeof screen !== "undefined" ? screen.orientation : undefined;
  if (so && typeof so.angle === "number") return so.angle;
  const legacy = (window as Window & { orientation?: unknown }).orientation;
  return typeof legacy === "number" ? legacy : 0;
}

type OrientationCtor = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<"granted" | "denied"> };

/** A touch device that reports orientation (desktop browsers define the event but have no sensor). */
export function tiltAvailable(): boolean {
  return typeof window !== "undefined" && "DeviceOrientationEvent" in window && window.matchMedia("(pointer: coarse)").matches;
}

/**
 * Ask for motion access where the browser requires it (iPhone and iPad).
 * Must be called inside a tap. Elsewhere it resolves "granted" at once.
 */
export function requestTilt(): Promise<"granted" | "denied"> {
  const ctor = (typeof window !== "undefined" ? (window as Window & { DeviceOrientationEvent?: OrientationCtor }).DeviceOrientationEvent : undefined) as
    | OrientationCtor
    | undefined;
  if (!ctor) return Promise.resolve("denied");
  if (typeof ctor.requestPermission !== "function") return Promise.resolve("granted");
  return ctor.requestPermission().then(
    (r) => (r === "granted" ? "granted" : "denied"),
    () => "denied",
  );
}

/** Listens for orientation while started; `steer` is the latest reading. */
export class TiltReader {
  steer = 0;
  /** performance.now() of the last reading (0 = none yet). */
  heard = 0;
  private on = (e: DeviceOrientationEvent) => {
    if (e.beta === null || e.gamma === null) return;
    this.steer = tiltSteer(e.beta, e.gamma, screenAngle());
    this.heard = performance.now();
  };

  start(): void {
    window.addEventListener("deviceorientation", this.on);
  }

  stop(): void {
    window.removeEventListener("deviceorientation", this.on);
    this.heard = 0;
    this.steer = 0;
  }

  /** Readings are arriving. */
  live(now: number): boolean {
    return this.heard > 0 && now - this.heard < TILT_STALE_MS;
  }
}
