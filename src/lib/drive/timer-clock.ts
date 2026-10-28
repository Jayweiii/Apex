import {
  Timer,
  getConsoleFunction,
  setConsoleFunction,
} from "three";

/**
 * Clock-shaped facade over THREE.Timer for react-three-fiber.
 * THREE.Clock has been deprecated since r183 in favor of Timer; R3F still
 * expects a Clock-like object (`getDelta`, `elapsedTime`, …).
 *
 * As of @react-three/fiber 9.8.2 (and 10 canaries), the store still does
 * `new THREE.Clock()` before `onCreated` can swap our Timer facade — that
 * constructor warn is upstream-only. Filter just that message.
 */
let clockDeprecationFilterInstalled = false;

export function silenceUpstreamR3fClockDeprecation(): void {
  if (clockDeprecationFilterInstalled) return;
  clockDeprecationFilterInstalled = true;
  const prev = getConsoleFunction();
  setConsoleFunction((type, message, ...params) => {
    if (
      type === "warn" &&
      typeof message === "string" &&
      message.includes("Clock:") &&
      message.includes("deprecated")
    ) {
      return;
    }
    if (prev) {
      prev(type, message, ...params);
      return;
    }
    if (type === "error") {
      console.error(message, ...params);
    } else if (type === "log") {
      console.log(message, ...params);
    } else {
      console.warn(message, ...params);
    }
  });
}

export type TimerClock = {
  autoStart: boolean;
  startTime: number;
  oldTime: number;
  elapsedTime: number;
  running: boolean;
  start: () => void;
  stop: () => void;
  getElapsedTime: () => number;
  getDelta: () => number;
  dispose: () => void;
};

export function createTimerClock(
  doc: Document | null = typeof document !== "undefined" ? document : null,
): TimerClock {
  const timer = new Timer();
  if (doc) timer.connect(doc);

  const clock: TimerClock = {
    autoStart: true,
    startTime: 0,
    oldTime: 0,
    elapsedTime: 0,
    running: true,
    start() {
      timer.reset();
      clock.running = true;
      clock.startTime = performance.now();
      clock.oldTime = clock.startTime;
      clock.elapsedTime = 0;
    },
    stop() {
      clock.running = false;
    },
    getElapsedTime() {
      if (clock.running) {
        timer.update();
        clock.elapsedTime = timer.getElapsed();
        clock.oldTime = performance.now();
      }
      return clock.elapsedTime;
    },
    getDelta() {
      if (!clock.running) return 0;
      timer.update();
      clock.elapsedTime = timer.getElapsed();
      clock.oldTime = performance.now();
      return timer.getDelta();
    },
    dispose() {
      timer.dispose();
      clock.running = false;
    },
  };

  clock.start();
  return clock;
}
