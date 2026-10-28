import { Timer } from "three";

/**
 * Clock-shaped facade over THREE.Timer for react-three-fiber.
 * THREE.Clock has been deprecated since r183 in favor of Timer; R3F still
 * expects a Clock-like object (`getDelta`, `elapsedTime`, …).
 */
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
