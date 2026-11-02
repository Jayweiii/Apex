"use client";

/**
 * Apex Kart (#48, phase 1): playable slice on "Thunder Hills".
 *
 * React renders chrome only on phase changes (ready / racing / paused).
 * Per-frame values (time, speed, score…) are written to the DOM through
 * refs, so React never re-renders at 60 Hz — the cause of missed taps
 * found in #43. Touch controls act on pointerdown (single tap, no click).
 */
import { readStick, STICK_RADIUS } from "@/lib/kart/joystick";
import { THUNDERHILL_LEVEL } from "@/lib/kart/levels/thunderhill";
import {
  comboMultiplier,
  createWorld,
  DT,
  ITEM_NONE,
  ITEM_OIL,
  ITEM_TURBO,
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

type Phase = "ready" | "racing" | "paused";

const LEVEL = THUNDERHILL_LEVEL;
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
  // Floating joystick (#51): one pointer owns the stick; a second finger's tap = item.
  const stick = useRef({ pointerId: -1, x0: 0, y0: 0, steer: 0, throttle: 0, used: false });
  const stickBase = useRef<HTMLDivElement | null>(null);
  const stickKnob = useRef<HTMLDivElement | null>(null);

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
    if (since(world.lastResetTick) < TICK_HZ) msg = "Back on track";
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

  // Game loop while racing.
  useEffect(() => {
    if (phase !== "racing") return;
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
      acc += frameDt;
      const h = held.current;
      const st = stick.current;
      const stickDown = st.pointerId !== -1;
      const target = stickDown ? st.steer : (h.right ? 1 : 0) - (h.left ? 1 : 0);
      // Ramp toward the target; snap back to centre faster.
      const rate = target === 0 ? 7 : 4.5;
      steerValue.current += Math.max(-rate * frameDt, Math.min(rate * frameDt, target - steerValue.current));
      const inp = input.current;
      inp.steer = steerValue.current;
      inp.throttle = stickDown ? st.throttle : h.gas ? 1 : 0;
      // Releasing the stick brakes (once a touch has been used).
      inp.brake = h.brake || (st.used && !stickDown) ? 1 : 0;
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
      if (document.visibilityState === "hidden") setPhase("paused");
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

  const endStick = () => {
    const st = stick.current;
    st.pointerId = -1;
    st.steer = 0;
    st.throttle = 0;
    if (stickBase.current) stickBase.current.style.display = "none";
  };

  const onStickDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = stick.current;
    if (st.pointerId !== -1) {
      // Second finger: tap = use item.
      held.current.item = true;
      window.setTimeout(() => {
        held.current.item = false;
      }, 120);
      return;
    }
    const host = e.currentTarget.getBoundingClientRect();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // synthetic/expired pointer — the stick still works without capture
    }
    st.pointerId = e.pointerId;
    st.x0 = e.clientX;
    st.y0 = e.clientY;
    st.steer = 0;
    st.throttle = 0;
    st.used = true;
    const base = stickBase.current;
    if (base) {
      base.style.display = "block";
      base.style.transform = `translate(${e.clientX - host.left - STICK_RADIUS}px, ${e.clientY - host.top - STICK_RADIUS}px)`;
    }
    if (stickKnob.current) stickKnob.current.style.transform = "translate(0px, 0px)";
  };

  const onStickMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = stick.current;
    if (e.pointerId !== st.pointerId) return;
    const r = readStick(e.clientX - st.x0, e.clientY - st.y0);
    st.steer = r.steer;
    st.throttle = r.throttle;
    if (stickKnob.current) stickKnob.current.style.transform = `translate(${r.knobX}px, ${r.knobY}px)`;
  };

  const onStickUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerId === stick.current.pointerId) endStick();
  };

  const start = () => {
    setPhase("racing");
  };

  return (
    <div
      className="relative flex h-[100dvh] flex-col overflow-hidden bg-[#1c3a17] text-zinc-50 select-none"
      data-apex-kart="1"
    >
      {/* HUD bar */}
      <div className="z-10 flex items-center justify-between gap-2 bg-zinc-950/85 px-3 py-1.5 font-mono text-xs backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/drive" className="apex-hit text-zinc-400" aria-label="Back to Drive">
            ←
          </Link>
          <span ref={hudLap} className="text-zinc-300">Lap 1</span>
          <span ref={hudTime} className="text-base text-orange-300">0:00.00</span>
          <span className="hidden text-zinc-500 sm:inline">
            best <span ref={hudBest}>—</span>
          </span>
          <span ref={hudGate} className="text-yellow-300">Gate 1/8</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-zinc-400">
            <span ref={hudScore}>0</span> pts
          </span>
          <button
            type="button"
            className="apex-btn apex-btn--ghost min-h-11 min-w-11 px-3 text-xs"
            onClick={() => setPhase((p) => (p === "racing" ? "paused" : "racing"))}
            disabled={phase === "ready"}
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
        <span ref={hudSpeed} className="pointer-events-none absolute left-3 top-2 rounded bg-black/40 px-1.5 font-mono text-sm" />
        <span ref={hudCombo} className="pointer-events-none absolute right-3 top-2 font-mono text-sm font-bold text-yellow-300 drop-shadow" />
        <div
          ref={hudFlash}
          className="pointer-events-none absolute inset-x-0 top-[22%] text-center font-mono text-lg font-bold text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.8)]"
          aria-live="polite"
        />
        <span ref={hudProbe} hidden data-apex-kart-probe="1" />
        {/* Single floating joystick: the whole stage is the touch surface.
            Left/right steers the rear (drift angle), pulling down = throttle,
            releasing brakes. A second finger's tap uses the item. */}
        <div
          className="absolute inset-0 z-[5] touch-none"
          style={{ touchAction: "none" }}
          data-apex-kart-stick="1"
          onPointerDown={onStickDown}
          onPointerMove={onStickMove}
          onPointerUp={onStickUp}
          onPointerCancel={onStickUp}
          onLostPointerCapture={onStickUp}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div
            ref={stickBase}
            className="pointer-events-none absolute left-0 top-0 hidden rounded-full border-2 border-white/40 bg-white/10"
            style={{ width: STICK_RADIUS * 2, height: STICK_RADIUS * 2 }}
          >
            <div
              ref={stickKnob}
              className="absolute rounded-full bg-orange-400/80 shadow-lg"
              style={{ width: 48, height: 48, left: STICK_RADIUS - 24, top: STICK_RADIUS - 24 }}
            />
          </div>
        </div>
        {/* Item button: tap (or use a second finger anywhere). */}
        <button
          ref={hudItem}
          type="button"
          aria-label="No item"
          data-apex-kart-control="item"
          className="absolute right-3 top-12 z-10 min-h-11 min-w-11 touch-manipulation rounded-2xl border border-white/15 bg-black/40 px-3 text-xs font-semibold text-white active:bg-orange-500/70"
          onPointerDown={(e) => {
            e.stopPropagation();
            held.current.item = true;
          }}
          onPointerUp={() => {
            held.current.item = false;
          }}
          onPointerCancel={() => {
            held.current.item = false;
          }}
        >
          No item
        </button>

        {phase !== "racing" ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/55 p-4">
            <div className="w-full max-w-sm rounded-2xl border border-zinc-700 bg-zinc-950/95 p-5 text-center">
              <p className="text-[10px] uppercase tracking-[0.2em] text-orange-400">Apex Kart · beta</p>
              <h1 className="mt-1 text-2xl font-semibold">{phase === "paused" ? "Paused" : LEVEL.name}</h1>
              <p className="mt-1 text-xs text-zinc-400">Loosely based on {LEVEL.basedOn}</p>
              {phase === "ready" ? (
                <ul className="mt-3 space-y-1 text-left text-xs text-zinc-300">
                  <li>• Drive through every <span className="text-yellow-300">gold gate</span> in order.</li>
                  <li>• Touch anywhere for a joystick: <b>left/right</b> swings the rear (drift angle), <b>pull down</b> for throttle, <b>let go</b> to brake.</li>
                  <li>• Tap with a second finger (or the Item button) to use an item.</li>
                  <li>• Grass slows you down. Hit <span className="text-yellow-300">? boxes</span> for Turbo or Oil.</li>
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

    </div>
  );
}

