"use client";

/**
 * Apex Kart (#48, phase 1): playable slice on "Thunder Hills".
 *
 * React renders chrome only on phase changes (ready / racing / paused).
 * Per-frame values (time, speed, score…) are written to the DOM through
 * refs, so React never re-renders at 60 Hz — the cause of missed taps
 * found in #43. Touch controls act on pointerdown (single tap, no click).
 */
import { THUNDERHILL_LEVEL } from "@/lib/kart/levels/thunderhill";
import {
  applyLaunch,
  comboMultiplier,
  createWorld,
  DT,
  ITEM_NONE,
  ITEM_OIL,
  ITEM_TURBO,
  KART_RULES,
  SURFACE_GRASS,
  stepWorld,
  ticksToMs,
  TICK_HZ,
  type KartInput,
  type KartWorld,
} from "@/lib/kart/sim";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRenderer, type KartRenderer } from "./renderer";

type Phase = "ready" | "countdown" | "racing" | "paused";

const LEVEL = THUNDERHILL_LEVEL;
/** 3-2-1 then GO. */
const COUNTDOWN_S = 3;
const BEST_KEY = `apex.kart.best.${LEVEL.id}`;
const MAX_STEPS_PER_FRAME = 8;

function formatLap(ms: number): string {
  if (!ms) return "—";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const c = Math.floor((ms % 1000) / 10);
  return `${m}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

function loadBest(): number {
  try {
    const v = Number(window.localStorage.getItem(BEST_KEY));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

function saveBest(ms: number) {
  try {
    window.localStorage.setItem(BEST_KEY, String(ms));
  } catch {
    // storage unavailable — best lap just isn't remembered
  }
}

type ControlKey = "left" | "right" | "gas" | "brake" | "drift" | "item";

export function KartGame() {
  const [phase, setPhase] = useState<Phase>("ready");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const worldRef = useRef<KartWorld | null>(null);
  const rendererRef = useRef<KartRenderer | null>(null);
  const held = useRef<Record<ControlKey, boolean>>({
    left: false,
    right: false,
    gas: false,
    brake: false,
    drift: false,
    item: false,
  });
  const input = useRef<KartInput>({
    steer: 0,
    throttle: 0,
    brake: 0,
    handbrake: false,
    useItem: false,
  });
  const bestRef = useRef(0);
  // The loop reads the phase from a ref so stale closures can never run the
  // race clock outside "racing".
  const phaseRef = useRef<Phase>("ready");
  const countdownS = useRef(0);
  /** Countdown time when Gas was last pressed (−1 = not held). */
  const gasDownAt = useRef(-1);

  // HUD nodes (written directly each frame).
  const hudLap = useRef<HTMLSpanElement | null>(null);
  const hudTime = useRef<HTMLSpanElement | null>(null);
  const hudBest = useRef<HTMLSpanElement | null>(null);
  const hudGate = useRef<HTMLSpanElement | null>(null);
  const hudSpeed = useRef<HTMLSpanElement | null>(null);
  const hudScore = useRef<HTMLSpanElement | null>(null);
  const hudCombo = useRef<HTMLSpanElement | null>(null);
  const hudItem = useRef<HTMLButtonElement | null>(null);
  const hudFlash = useRef<HTMLDivElement | null>(null);
  const hudProbe = useRef<HTMLSpanElement | null>(null);

  // World + renderer, created once on mount.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const world = createWorld(LEVEL, Date.now() & 0xffff);
    worldRef.current = world;
    phaseRef.current = "ready";
    const renderer = createRenderer(canvas, world);
    rendererRef.current = renderer;
    bestRef.current = loadBest();
    renderer.draw(world, 0);
    const onResize = () => {
      renderer.resize();
      renderer.draw(world, 0);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      renderer.dispose();
    };
  }, []);

  // Smooth steering from digital buttons/keys (ramps like a real wheel).
  const steerValue = useRef(0);

  const updateHud = useCallback((world: KartWorld) => {
    const t = ticksToMs(world.tick - world.lapStartTick);
    const speedKmh = Math.round(Math.hypot(world.car.vx, world.car.vy) * 3.6);
    const set = (ref: { current: HTMLElement | null }, text: string) => {
      const el = ref.current;
      if (el && el.textContent !== text) el.textContent = text;
    };
    set(hudLap, `Lap ${world.lap}`);
    set(hudTime, formatLap(t));
    const lastBest = ticksToMs(world.bestLapTicks);
    if (lastBest && (!bestRef.current || lastBest < bestRef.current)) {
      bestRef.current = lastBest;
      saveBest(lastBest);
    }
    set(hudBest, formatLap(bestRef.current));
    set(hudGate, `Gate ${world.nextGate === 0 ? world.track.gates.length : world.nextGate}/${world.track.gates.length}`);
    set(hudSpeed, `${speedKmh} km/h`);
    const pending = Math.round(world.driftPending);
    set(hudScore, String(world.score + pending));
    set(hudCombo, world.drifting ? `DRIFT ×${comboMultiplier(world)}  +${pending}` : "");
    const itemEl = hudItem.current;
    if (itemEl) {
      const label =
        world.item === ITEM_TURBO ? "Turbo" : world.item === ITEM_OIL ? "Oil" : "No item";
      if (itemEl.dataset.item !== String(world.item)) {
        itemEl.dataset.item = String(world.item);
        itemEl.textContent = label;
        itemEl.setAttribute("aria-label", world.item === ITEM_NONE ? "No item" : `Use ${label}`);
      }
    }
    // Centre flash: most recent event wins for ~1 s.
    const since = (tick: number) => world.tick - tick;
    let msg = "";
    if (since(world.lastMiniTick) < TICK_HZ * 0.9 && world.lastMiniLaunch) msg = "GO! Perfect launch!";
    else if (world.tick < TICK_HZ * 0.7) msg = "GO!";
    else if (since(world.lastMiniTick) < TICK_HZ * 0.9) msg = "Mini-turbo!";
    else if (since(world.lastResetTick) < TICK_HZ) msg = "Back on track";
    else if (world.wrongWayTicks > TICK_HZ / 2) msg = "Wrong way!";
    else if (since(world.lastWipeTick) < TICK_HZ) msg = "Wiped out!";
    else if (since(world.lastBankTick) < TICK_HZ && world.lastBank > 0) msg = `+${world.lastBank} drift`;
    else if (world.surface === SURFACE_GRASS) msg = "Off track — slowing!";
    else if (since(world.lastGateTick) < TICK_HZ * 0.7)
      msg = world.nextGate === 1 && world.lapsDone > 0 ? `Lap ${formatLap(ticksToMs(world.lastLapTicks))}` : "Checkpoint";
    set(hudFlash, msg);
    const probe = hudProbe.current;
    if (probe) {
      probe.dataset.tick = String(world.tick);
      probe.dataset.lap = String(world.lap);
      probe.dataset.gate = String(world.nextGate);
      probe.dataset.speed = (Math.hypot(world.car.vx, world.car.vy)).toFixed(2);
      probe.dataset.s = world.hit.s.toFixed(1);
      probe.dataset.item = String(world.item);
      probe.dataset.surface = String(world.surface);
    }
  }, []);

  // Keep the loop's phase ref in step with React state (declared before the
  // loop effect so it is current when the loop starts).
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Game loop: countdown (draw only), then racing (sim + draw).
  useEffect(() => {
    if (phase !== "racing" && phase !== "countdown") return;
    const world = worldRef.current;
    const renderer = rendererRef.current;
    if (!world || !renderer) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const frameDt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const h = held.current;
      if (phaseRef.current === "countdown") {
        // The race clock does not run here: the world isn't stepped.
        const t = countdownS.current + frameDt;
        countdownS.current = t;
        if (h.gas) {
          if (gasDownAt.current < 0) gasDownAt.current = t;
        } else gasDownAt.current = -1;
        const el = hudFlash.current;
        if (el) {
          const n = Math.ceil(COUNTDOWN_S - t);
          const text = n > 0 ? String(n) : "GO!";
          if (el.textContent !== text) el.textContent = text;
        }
        renderer.draw(world, frameDt);
        if (t >= COUNTDOWN_S) {
          // Gas pressed in the last moment of the countdown = perfect launch.
          if (gasDownAt.current >= COUNTDOWN_S - KART_RULES.launchWindowS) applyLaunch(world);
          phaseRef.current = "racing";
          setPhase("racing");
        }
        return;
      }
      if (phaseRef.current !== "racing") return;
      acc += frameDt;
      const target = (h.right ? 1 : 0) - (h.left ? 1 : 0);
      // Ramp toward the target; snap back to centre faster. Gentler
      // steer-in at low speed so a tap doesn't overshoot.
      const carSpeed = Math.hypot(world.car.vx, world.car.vy);
      const rate = target === 0 ? 7 : carSpeed < 12 ? 2.8 + carSpeed * 0.14 : 4.5;
      steerValue.current += Math.max(-rate * frameDt, Math.min(rate * frameDt, target - steerValue.current));
      const inp = input.current;
      inp.steer = steerValue.current;
      inp.throttle = h.gas ? 1 : 0;
      inp.brake = h.brake ? 1 : 0;
      inp.handbrake = h.drift;
      inp.useItem = h.item;
      let steps = 0;
      while (acc >= DT && steps < MAX_STEPS_PER_FRAME) {
        stepWorld(world, inp);
        acc -= DT;
        steps += 1;
      }
      if (steps === MAX_STEPS_PER_FRAME) acc = 0; // slow down, don't spiral
      renderer.draw(world, frameDt);
      updateHud(world);
    };
    raf = requestAnimationFrame(tick);
    const onHidden = () => {
      if (document.visibilityState !== "hidden") return;
      // Mid-countdown: back to the start card; mid-race: pause.
      setPhase(phaseRef.current === "countdown" ? "ready" : "paused");
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [phase, updateHud]);

  // Keyboard: WASD / arrows, Space = drift, Shift/E = item, P/Esc = pause.
  useEffect(() => {
    const map: Record<string, ControlKey> = {
      ArrowLeft: "left",
      KeyA: "left",
      ArrowRight: "right",
      KeyD: "right",
      ArrowUp: "gas",
      KeyW: "gas",
      ArrowDown: "brake",
      KeyS: "brake",
      Space: "drift",
      ShiftLeft: "item",
      ShiftRight: "item",
      KeyE: "item",
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === "KeyP" || e.code === "Escape") {
        setPhase((p) => (p === "racing" ? "paused" : p === "paused" ? "racing" : p));
        return;
      }
      const key = map[e.code];
      if (!key) return;
      e.preventDefault();
      held.current[key] = true;
    };
    const up = (e: KeyboardEvent) => {
      const key = map[e.code];
      if (key) held.current[key] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const releaseAll = () => {
    for (const k of Object.keys(held.current) as ControlKey[]) held.current[k] = false;
  };

  const start = () => {
    if (phaseRef.current === "paused") {
      setPhase("racing");
      return;
    }
    if (phaseRef.current !== "ready") return;
    // Fresh world + inputs every time, so no stale state can start the
    // clock or skip the countdown.
    releaseAll();
    steerValue.current = 0;
    countdownS.current = 0;
    gasDownAt.current = -1;
    const world = createWorld(LEVEL, Date.now() & 0xffff);
    worldRef.current = world;
    rendererRef.current?.draw(world, 0);
    phaseRef.current = "countdown";
    setPhase("countdown");
  };

  return (
    <div
      className="relative flex h-[100dvh] flex-col overflow-hidden bg-[#1c3a17] text-zinc-50 select-none"
      data-apex-kart="1"
      data-phase={phase}
    >
      {/* HUD bar */}
      <div className="z-10 flex items-center justify-between gap-2 bg-zinc-950/90 px-3 py-1.5 font-mono text-sm font-semibold backdrop-blur sm:text-base">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-4">
          <Link href="/drive" className="apex-hit text-zinc-200" aria-label="Back to Drive">
            ←
          </Link>
          <span ref={hudLap} className="text-zinc-100">Lap 1</span>
          <span ref={hudTime} className="text-lg text-orange-300 sm:text-xl">0:00.00</span>
          <span className="hidden text-zinc-300 sm:inline">
            best <span ref={hudBest}>—</span>
          </span>
          <span ref={hudGate} className="text-yellow-300">Gate 1/8</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-zinc-200">
            <span ref={hudScore}>0</span> pts
          </span>
          <button
            type="button"
            className="apex-btn apex-btn--ghost min-h-11 min-w-11 px-3 text-xs"
            onClick={() => setPhase((p) => (p === "racing" ? "paused" : "racing"))}
            disabled={phase === "ready" || phase === "countdown"}
            data-apex-kart-pause="1"
          >
            {phase === "paused" ? "Resume" : "Pause"}
          </button>
        </div>
      </div>

      {/* Stage */}
      <div className="relative min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full touch-none"
          style={{ imageRendering: "pixelated" }}
          aria-label="Apex Kart track"
          data-apex-kart-canvas="1"
        />
        <span ref={hudSpeed} className="pointer-events-none absolute left-3 top-2 rounded bg-black/40 px-1.5 font-mono text-base font-semibold sm:text-lg" />
        <span ref={hudCombo} className="pointer-events-none absolute right-3 top-2 font-mono text-base font-bold text-yellow-300 drop-shadow-[0_2px_0_rgba(0,0,0,0.8)] sm:text-lg" />
        <div
          ref={hudFlash}
          className="pointer-events-none absolute inset-x-0 top-[22%] text-center font-mono text-2xl font-bold sm:text-3xl text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.8)]"
          aria-live="polite"
        />
        <span ref={hudProbe} hidden data-apex-kart-probe="1" />
        {/* Item button sits on the play area, right above the thumbs. */}
        <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2">
          <HoldPad
            control="item"
            held={held}
            label="No item"
            ariaLabel="No item"
            small
            buttonRef={hudItem}
          />
        </div>

        {phase === "ready" || phase === "paused" ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/55 p-4">
            <div className="w-full max-w-sm rounded-2xl border border-zinc-700 bg-zinc-950/95 p-5 text-center">
              <p className="text-[10px] uppercase tracking-[0.2em] text-orange-400">Apex Kart · beta</p>
              <h1 className="mt-1 text-2xl font-semibold">{phase === "paused" ? "Paused" : LEVEL.name}</h1>
              <p className="mt-1 text-xs text-zinc-400">Loosely based on {LEVEL.basedOn}</p>
              {phase === "ready" ? (
                <ul className="mt-3 space-y-1 text-left text-xs text-zinc-300">
                  <li>• Drive through every <span className="text-yellow-300">gold gate</span> in order.</li>
                  <li>• Rear-wheel drive: throttle or <b>Drift</b> kicks the tail out — counter-steer to hold it.</li>
                  <li>• Grass slows you down. Hit <span className="text-yellow-300">? boxes</span> for Turbo or Oil.</li>
                  <li>• Tap <b>Gas</b> right as the countdown hits <b>GO</b> for a launch boost. Hold <b>Drift</b> while steering, release for a mini-turbo.</li>
                  <li className="text-zinc-500">Keys: arrows/WASD · Space drift · E item · P pause</li>
                </ul>
              ) : null}
              <button
                type="button"
                className="apex-btn apex-btn--primary apex-btn--cta mt-4 w-full"
                onClick={start}
                data-apex-kart-start="1"
              >
                {phase === "paused" ? "Resume" : "Start"}
              </button>
              <Link href="/drive" className="apex-hit mt-3 inline-block text-xs text-zinc-500 underline">
                Back to Drive
              </Link>
            </div>
          </div>
        ) : null}
      </div>

      {/* Touch controls: act on pointerdown, release on up/cancel/leave. */}
      <div
        className="z-10 grid grid-cols-[auto_1fr_auto] items-end gap-2 bg-zinc-950/70 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2"
        onContextMenu={(e) => e.preventDefault()}
        onPointerCancel={releaseAll}
      >
        <div className="flex gap-2">
          <HoldPad control="left" held={held} label="◀" ariaLabel="Steer left" />
          <HoldPad control="right" held={held} label="▶" ariaLabel="Steer right" />
        </div>
        <div />
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-2">
            <HoldPad control="drift" held={held} label="Drift" ariaLabel="Drift (handbrake)" small />
            <HoldPad control="brake" held={held} label="Brake" ariaLabel="Brake" small />
          </div>
          <HoldPad control="gas" held={held} label="Gas" ariaLabel="Gas" big />
        </div>
      </div>
    </div>
  );
}

function HoldPad({
  control,
  held,
  label,
  ariaLabel,
  big,
  small,
  buttonRef,
}: {
  control: ControlKey;
  held: React.RefObject<Record<ControlKey, boolean>>;
  label: string;
  ariaLabel: string;
  big?: boolean;
  small?: boolean;
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  const set = (on: boolean) => (e: React.PointerEvent<HTMLButtonElement>) => {
    held.current[control] = on;
    if (on) e.currentTarget.setPointerCapture?.(e.pointerId);
    e.currentTarget.dataset.held = on ? "1" : "0";
  };
  const size = big
    ? "h-[5.25rem] w-[5.25rem] text-base"
    : small
      ? "h-12 min-w-[3.75rem] px-2.5 text-xs"
      : "h-16 w-16 text-2xl";
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={ariaLabel}
      data-apex-kart-control={control}
      className={`touch-none rounded-2xl border border-white/15 bg-white/10 font-semibold text-white shadow-lg shadow-black/30 data-[held=1]:bg-orange-500/70 ${size}`}
      onPointerDown={set(true)}
      onPointerUp={set(false)}
      onPointerCancel={set(false)}
      onLostPointerCapture={set(false)}
    >
      {label}
    </button>
  );
}
