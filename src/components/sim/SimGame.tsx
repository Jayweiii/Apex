"use client";

import { BugReportButton } from "@/components/BugReport";
import { ND_MIATA, SURFACE_GRASS, type CarInput } from "@/lib/sim/car";
import { createSimAudio, type SimAudio } from "@/lib/sim/audio";
import { enableFastTap } from "@/lib/fast-tap";
import { createControlState, DEFAULT_ASSISTS, readGamepad, shapeControls, type Assists, type RawControls } from "@/lib/sim/controls";
import { bundledRealLap, ghostDelta, ghostFromRealLap, ghostFromRecording, ghostPose, loadBest, saveBest, type Ghost, type GhostPose } from "@/lib/sim/ghost";
import { blankInput, createPilot, createSession, FRAME_HZ, pilotInput, resetToTrack, stepSession, type Session } from "@/lib/sim/session";
import { buildSimTrack, type SimTrackData } from "@/lib/sim/track";
import westData from "@/lib/rush/data/thunderhill-west.json";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CAMERA_MODES, createSimScene, type CameraMode, type SimScene } from "./scene";
import "./sim.css";

type Phase = "menu" | "drive" | "paused";
type Unit = "mph" | "kmh";
type Prefs = { assists: Assists; ghostReal: boolean; ghostBest: boolean; paint: string; unit: Unit; camera: CameraMode; muted: boolean };

const PAINTS: Array<{ name: string; hex: string }> = [
  { name: "Red", hex: "#8f1a22" },
  { name: "White", hex: "#e6e6e2" },
  { name: "Grey", hex: "#5f656d" },
  { name: "Blue", hex: "#1c3c78" },
  { name: "Black", hex: "#15161a" },
];
const PREFS_KEY = "apex.sim.prefs";
const DEFAULT_PREFS: Prefs = { assists: DEFAULT_ASSISTS, ghostReal: true, ghostBest: true, paint: PAINTS[0]!.hex, unit: "mph", camera: "chase", muted: false };

function loadPrefs(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>;
    const a = (v.assists ?? {}) as Partial<Assists>;
    const bool = (x: unknown, d: boolean) => (typeof x === "boolean" ? x : d);
    return {
      assists: {
        autoShift: bool(a.autoShift, true),
        abs: bool(a.abs, true),
        tractionControl: bool(a.tractionControl, true),
        steeringHelp: bool(a.steeringHelp, true),
      },
      ghostReal: bool(v.ghostReal, true),
      ghostBest: bool(v.ghostBest, true),
      paint: PAINTS.some((p) => p.hex === v.paint) ? v.paint! : DEFAULT_PREFS.paint,
      unit: v.unit === "kmh" ? "kmh" : "mph",
      camera: CAMERA_MODES.includes(v.camera as CameraMode) ? (v.camera as CameraMode) : "chase",
      muted: bool(v.muted, false),
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function formatLap(ms: number): string {
  if (!(ms > 0)) return "–:––.–––";
  const total = Math.round(ms);
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const k = total % 1000;
  return `${m}:${String(s).padStart(2, "0")}.${String(k).padStart(3, "0")}`;
}

const KEYS_STEER_L = ["ArrowLeft", "a", "A"];
const KEYS_STEER_R = ["ArrowRight", "d", "D"];
const KEYS_GAS = ["ArrowUp", "w", "W"];
const KEYS_BRAKE = ["ArrowDown", "s", "S", " "];

export function SimGame() {
  // Client-only (loaded with ssr: false), so saved choices can seed the state.
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [phase, setPhase] = useState<Phase>("menu");
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [touch] = useState(() => window.matchMedia("(pointer: coarse)").matches);
  const [savedBest, setSavedBest] = useState(() => loadBest("thunderhill-west", ND_MIATA.name)?.lapMs ?? 0);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapRef = useRef<HTMLCanvasElement | null>(null);
  const speedEl = useRef<HTMLSpanElement | null>(null);
  const gearEl = useRef<HTMLSpanElement | null>(null);
  const rpmEl = useRef<HTMLDivElement | null>(null);
  const rpmText = useRef<HTMLSpanElement | null>(null);
  const lapEl = useRef<HTMLSpanElement | null>(null);
  const lastEl = useRef<HTMLSpanElement | null>(null);
  const bestEl = useRef<HTMLSpanElement | null>(null);
  const deltaEl = useRef<HTMLDivElement | null>(null);
  const noticeEl = useRef<HTMLDivElement | null>(null);
  const thrEl = useRef<HTMLDivElement | null>(null);
  const brkEl = useRef<HTMLDivElement | null>(null);
  const steerEl = useRef<HTMLDivElement | null>(null);
  const absEl = useRef<HTMLSpanElement | null>(null);
  const tcEl = useRef<HTMLSpanElement | null>(null);

  /** What the frame loop reads; kept in step with React state by an effect. */
  const live = useRef({ phase: "menu" as Phase, prefs, restart: 0, reset: 0 });
  useEffect(() => {
    live.current.phase = phase;
    live.current.prefs = prefs;
  }, [phase, prefs]);
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Preferences just do not persist.
    }
  }, [prefs]);

  const raw = useRef<RawControls>({ steer: 0, throttle: 0, brake: 0, analog: false, shiftUp: false, shiftDown: false });
  const keys = useRef(new Set<string>());
  const pad = useRef({ steer: 0, steering: false, throttle: false, brake: false, up: false, down: false });
  const audio = useRef<SimAudio | null>(null);
  const sceneRef = useRef<SimScene | null>(null);

  useEffect(() => {
    sceneRef.current?.setPaint(prefs.paint);
    audio.current?.setMuted(prefs.muted);
  }, [prefs.paint, prefs.muted]);

  // ── World, session and the frame loop ──
  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root) return;
    const params = new URLSearchParams(window.location.search);
    const autopilot = params.get("autopilot") === "1";
    const orbit = params.get("cam") === "orbit";
    const maxSteps = Math.max(4, Math.min(64, Number(params.get("simSpeed")) || 4));
    // Test hook: start closer to the line (metres, 20–400) so e2e laps cross it quickly.
    const runUpParam = Number(params.get("runUp"));
    const runUp = Number.isFinite(runUpParam) && runUpParam >= 20 && runUpParam <= 400 ? runUpParam : 0;
    const track = buildSimTrack(westData as SimTrackData);
    const spec = ND_MIATA;
    let scene: SimScene;
    try {
      scene = createSimScene(canvas, track, spec, { paint: live.current.prefs.paint, lowPower: window.matchMedia("(pointer: coarse)").matches });
    } catch {
      requestAnimationFrame(() => setFailed(true));
      return;
    }
    sceneRef.current = scene;
    const pilot = createPilot(track, spec, 0.93);
    const realLap = bundledRealLap(track.data.id);
    const realGhost: Ghost | null = realLap ? ghostFromRealLap(track, realLap) : null;
    const stored = loadBest(track.data.id, spec.name);
    let bestGhost: Ghost | null = stored ? ghostFromRecording(track, stored.rec, "Your best") : null;
    let bestMs = stored?.lapMs ?? 0;

    let ses: Session = createSession(track, spec, runUp || 160, 0);
    let demo = true;
    const input: CarInput = blankInput();
    const controls = createControlState();
    const cursors = [{ k: 0 }, { k: 0 }];
    const poses: GhostPose[] = [0, 1].map(() => ({ x: 0, y: 0, z: 0, heading: 0, speed: 0 }));
    const shown: Array<GhostPose | null> = [null, null];
    let noticeUntil = 0;
    let wasValid = true;
    const notice = (text: string, seconds: number, tone: "info" | "good" | "bad") => {
      const el = noticeEl.current;
      if (!el) return;
      el.textContent = text;
      el.dataset.tone = tone;
      el.dataset.on = "1";
      noticeUntil = performance.now() + seconds * 1000;
    };

    // Minimap: the outline once, dots each frame.
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < track.n; i += 1) {
      minX = Math.min(minX, track.px[i]!);
      maxX = Math.max(maxX, track.px[i]!);
      minY = Math.min(minY, track.py[i]!);
      maxY = Math.max(maxY, track.py[i]!);
    }
    const MAP = 132;
    const scale = (MAP - 16) / Math.max(maxX - minX, maxY - minY);
    const mx = (x: number) => 8 + (x - minX) * scale + ((MAP - 16) - (maxX - minX) * scale) / 2;
    const my = (y: number) => MAP - 8 - (y - minY) * scale - ((MAP - 16) - (maxY - minY) * scale) / 2;
    const outline = document.createElement("canvas");
    outline.width = MAP * 2;
    outline.height = MAP * 2;
    {
      const c = outline.getContext("2d")!;
      c.scale(2, 2);
      c.lineJoin = "round";
      c.beginPath();
      for (let i = 0; i <= track.n; i += 4) {
        const k = i % track.n;
        if (i === 0) c.moveTo(mx(track.px[k]!), my(track.py[k]!));
        else c.lineTo(mx(track.px[k]!), my(track.py[k]!));
      }
      c.closePath();
      c.strokeStyle = "rgba(0,0,0,0.65)";
      c.lineWidth = 5;
      c.stroke();
      c.strokeStyle = "#f4f4f5";
      c.lineWidth = 2;
      c.stroke();
      c.fillStyle = "#f4f4f5";
      c.fillRect(mx(track.px[0]!) - 1, my(track.py[0]!) - 5, 2, 10);
    }
    const mapCtx = mapRef.current?.getContext("2d") ?? null;
    const dot = (x: number, y: number, color: string, r: number) => {
      if (!mapCtx) return;
      mapCtx.beginPath();
      mapCtx.arc(mx(x) * 2, my(y) * 2, r * 2, 0, Math.PI * 2);
      mapCtx.fillStyle = color;
      mapCtx.fill();
    };

    const begin = () => {
      ses = createSession(track, spec, runUp || 70, 0);
      ses.bestLapMs = bestMs;
      demo = false;
      controls.steer = 0;
      controls.throttle = 0;
      controls.brake = 0;
      wasValid = true;
      notice("Cross the line to start your lap", 4, "info");
    };

    const onResize = () => scene.resize();
    window.addEventListener("resize", onResize);
    let seenRestart = live.current.restart;
    let seenReset = live.current.reset;
    let last = performance.now();
    let acc = 0;
    let frames = 0;
    let lastReadout = 0;
    let rafId = 0;
    const frameDt = 1 / FRAME_HZ;
    requestAnimationFrame(() => setReady(true));

    const frame = (now: number) => {
      rafId = requestAnimationFrame(frame);
      const o = live.current;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (o.restart !== seenRestart) {
        seenRestart = o.restart;
        begin();
      }
      if (o.reset !== seenReset) {
        seenReset = o.reset;
        if (!demo) {
          resetToTrack(ses);
          notice("Back on track · this lap will not count", 3, "info");
        }
      }
      const running = o.phase !== "paused";
      if (running) acc += dt * (maxSteps > 4 ? maxSteps / 2 : 1);
      let steps = 0;
      while (running && acc >= frameDt && steps < maxSteps) {
        acc -= frameDt;
        steps += 1;
        if (demo || autopilot) pilotInput(pilot, ses, input);
        else {
          const r = raw.current;
          const k = keys.current;
          const p = pad.current;
          r.shiftUp = k.has("e") || k.has("E") || k.has("Shift") || p.up;
          r.shiftDown = k.has("q") || k.has("Q") || k.has("Control") || p.down;
          if (!readGamepad(r)) {
            const left = KEYS_STEER_L.some((c) => k.has(c));
            const right = KEYS_STEER_R.some((c) => k.has(c));
            if (p.steering) {
              r.steer = p.steer;
              r.analog = true;
            } else {
              r.steer = (left ? 1 : 0) - (right ? 1 : 0);
              r.analog = false;
            }
            r.throttle = p.throttle || KEYS_GAS.some((c) => k.has(c)) ? 1 : 0;
            r.brake = p.brake || KEYS_BRAKE.some((c) => k.has(c)) ? 1 : 0;
          }
          shapeControls(controls, r, o.prefs.assists, ses.car, frameDt, input);
        }
        stepSession(ses, input);
        if (ses.lapDone && !demo) {
          const improved = ses.lastLapValid && (bestMs === 0 || ses.lastLapMs < bestMs);
          if (improved) {
            const gap = bestMs > 0 ? ` · ${((ses.lastLapMs - bestMs) / 1000).toFixed(3)} s` : "";
            bestMs = ses.lastLapMs;
            bestGhost = ghostFromRecording(track, ses.bestRecording, "Your best");
            saveBest(track.data.id, spec.name, bestMs, ses.bestRecording);
            setSavedBest(bestMs);
            notice(`New best ${formatLap(ses.lastLapMs)}${gap}`, 5, "good");
          } else if (ses.lastLapValid) notice(`Lap ${formatLap(ses.lastLapMs)}`, 4, "info");
          else notice(`Lap ${formatLap(ses.lastLapMs)} · not counted: all four wheels left the track`, 5, "bad");
          wasValid = true;
        }
        if (!demo && ses.started && wasValid && !ses.lapValid) {
          wasValid = false;
          notice("Track limits · this lap will not count", 3, "bad");
        }
      }
      if (steps === maxSteps) acc = 0;

      // Ghosts run from the moment your lap starts.
      const car = ses.car;
      const ghosts: Array<Ghost | null> = [o.prefs.ghostReal ? realGhost : null, o.prefs.ghostBest ? bestGhost : null];
      for (let i = 0; i < 2; i += 1) {
        const g = ghosts[i];
        shown[i] = g && ses.started && !demo && ghostPose(g, track, ses.lapMs, cursors[i]!, poses[i]!) ? poses[i]! : null;
      }
      scene.draw({ car, ghosts: shown, camera: o.phase === "menu" || orbit ? "orbit" : o.prefs.camera }, dt);

      // HUD.
      const speed = Math.hypot(car.vx, car.vy);
      const unit = o.prefs.unit;
      if (speedEl.current) speedEl.current.textContent = String(Math.round(speed * (unit === "mph" ? 2.23694 : 3.6)));
      if (gearEl.current) gearEl.current.textContent = car.gear < 0 ? "R" : String(car.gear);
      if (rpmEl.current) {
        const f = Math.min(1, car.rpm / spec.redlineRpm);
        rpmEl.current.style.transform = `scaleX(${f.toFixed(3)})`;
        rpmEl.current.dataset.zone = car.rpm > spec.redlineRpm - 350 ? "red" : car.rpm > spec.redlineRpm - 1100 ? "amber" : "ok";
      }
      if (rpmText.current && frames % 6 === 0) rpmText.current.textContent = String(Math.round(car.rpm / 100) * 100);
      if (lapEl.current) lapEl.current.textContent = ses.started ? formatLap(ses.lapMs) : "–:––.–––";
      if (lastEl.current) lastEl.current.textContent = formatLap(ses.lastLapMs);
      if (bestEl.current) bestEl.current.textContent = formatLap(demo ? bestMs : ses.bestLapMs || bestMs);
      if (lapEl.current) lapEl.current.dataset.valid = ses.lapValid ? "1" : "0";
      const ref = ghosts[1] ?? ghosts[0];
      if (deltaEl.current) {
        if (ref && ses.started && !demo) {
          const d = ghostDelta(ref, car.hit.i, ses.lapMs);
          deltaEl.current.textContent = `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(2)} s vs ${ref.kind === "real" ? "real lap" : "your best"}`;
          deltaEl.current.dataset.sign = d > 0.005 ? "slow" : "fast";
          deltaEl.current.dataset.on = "1";
        } else deltaEl.current.dataset.on = "0";
      }
      if (thrEl.current) thrEl.current.style.transform = `scaleY(${car.throttle.toFixed(3)})`;
      if (brkEl.current) brkEl.current.style.transform = `scaleY(${car.brake.toFixed(3)})`;
      if (steerEl.current) steerEl.current.style.transform = `translateX(${(-(car.steer / spec.maxSteer) * 46).toFixed(1)}px)`;
      if (absEl.current) absEl.current.dataset.on = car.absActive ? "1" : "0";
      if (tcEl.current) tcEl.current.dataset.on = car.tcActive ? "1" : "0";
      if (noticeEl.current && noticeEl.current.dataset.on === "1" && now > noticeUntil) noticeEl.current.dataset.on = "0";
      if (mapCtx) {
        mapCtx.clearRect(0, 0, MAP * 2, MAP * 2);
        mapCtx.drawImage(outline, 0, 0);
        if (shown[0]) dot(shown[0].x, shown[0].y, "#7dd3fc", 3);
        if (shown[1]) dot(shown[1].x, shown[1].y, "#fde68a", 3);
        dot(car.x, car.y, "#ef4444", 3.6);
      }

      // Sound.
      let slide = 0;
      let grass = false;
      for (let w = 0; w < 4; w += 1) {
        slide = Math.max(slide, Math.abs(car.slipRatio[w]!) / spec.peakSlipRatio - 1, Math.abs(car.slipAngle[w]!) / spec.peakSlipAngle - 0.85);
        if (car.surface[w] === SURFACE_GRASS) grass = true;
      }
      audio.current?.update(car.rpm, car.throttle, speed > 3 ? Math.max(0, Math.min(1, slide)) : 0, speed, grass, running && o.phase === "drive");

      frames += 1;
      // Readouts for tests and tools, a few times a second whatever the frame rate.
      if (now - lastReadout > 150) {
        lastReadout = now;
        const d = root.dataset;
        d.simSpeed = String(Math.round(speed * 2.23694));
        d.simGear = String(car.gear);
        d.simRpm = String(Math.round(car.rpm));
        d.simLap = String(ses.lap);
        d.simLapMs = String(Math.round(ses.lapMs));
        d.simLastMs = String(Math.round(ses.lastLapMs));
        d.simValid = ses.lapValid ? "1" : "0";
        d.simS = String(Math.round(car.hit.s));
        d.simOff = String(car.wheelsOff);
        d.simGhosts = `${shown[0] ? "real" : ""}${shown[1] ? "+best" : ""}`;
        const st = scene.stats();
        d.simDraw = `${st.w}x${st.h}`;
      }
    };
    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  // ── Keyboard ──
  const startDrive = useCallback(() => {
    if (!audio.current) audio.current = createSimAudio();
    audio.current.unlock();
    audio.current.setMuted(live.current.prefs.muted);
    // Start from the top of the page: iOS can mis-route touches to a fixed
    // layer while the document underneath is scrolled.
    window.scrollTo(0, 0);
    live.current.restart += 1;
    setPhase("drive");
  }, []);
  const cycleCamera = useCallback(() => {
    setPrefs((p) => ({ ...p, camera: CAMERA_MODES[(CAMERA_MODES.indexOf(p.camera) + 1) % CAMERA_MODES.length]! }));
  }, []);
  const resetCar = useCallback(() => {
    live.current.reset += 1;
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      const driving = live.current.phase === "drive";
      if (driving && (e.key.startsWith("Arrow") || e.key === " ")) e.preventDefault();
      keys.current.add(e.key);
      if (e.repeat) return;
      if (e.key === "Escape" || e.key === "p" || e.key === "P") setPhase((ph) => (ph === "drive" ? "paused" : ph === "paused" ? "drive" : ph));
      else if (driving && (e.key === "c" || e.key === "C")) cycleCamera();
      else if (driving && (e.key === "r" || e.key === "R")) resetCar();
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key);
    const clear = () => keys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, [cycleCamera, resetCar]);

  useEffect(() => () => audio.current?.dispose(), []);
  // iOS can need two taps per button while the 3D view is busy: press on the first.
  useEffect(() => (rootRef.current ? enableFastTap(rootRef.current) : undefined), []);

  // ── Touch: a steering pad on the left, pedals on the right ──
  const steerStart = useRef({ id: -1, x: 0 });
  const steerKnob = useRef<HTMLDivElement | null>(null);
  const capture = (el: Element, id: number) => {
    try {
      el.setPointerCapture(id);
    } catch {
      // Not an active pointer (synthetic event): the press still counts.
    }
  };
  const onSteerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    capture(e.currentTarget, e.pointerId);
    steerStart.current = { id: e.pointerId, x: e.clientX };
    pad.current.steering = true;
    pad.current.steer = 0;
  };
  const onSteerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== steerStart.current.id) return;
    const v = Math.max(-1, Math.min(1, (e.clientX - steerStart.current.x) / 72));
    pad.current.steer = -v;
    if (steerKnob.current) steerKnob.current.style.transform = `translateX(${(v * 52).toFixed(0)}px)`;
  };
  const onSteerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== steerStart.current.id) return;
    steerStart.current.id = -1;
    pad.current.steering = false;
    pad.current.steer = 0;
    if (steerKnob.current) steerKnob.current.style.transform = "translateX(0px)";
  };
  const hold = (key: "throttle" | "brake" | "up" | "down") => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      // Stops iOS Safari turning a long press into a text-selection / callout gesture that fires pointercancel.
      e.preventDefault();
      capture(e.currentTarget, e.pointerId);
      pad.current[key] = true;
    },
    onPointerUp: () => {
      pad.current[key] = false;
    },
    onPointerCancel: () => {
      pad.current[key] = false;
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  const setAssist = (key: keyof Assists, value: boolean) => setPrefs((p) => ({ ...p, assists: { ...p.assists, [key]: value } }));
  const toggle = (label: string, on: boolean, set: (v: boolean) => void, hint: string, id: string) => (
    <button type="button" className="sim-toggle" aria-pressed={on} data-sim-toggle={id} onClick={() => set(!on)}>
      <span className="sim-toggle__box" aria-hidden />
      <span>
        <span className="block font-semibold">{label}</span>
        <span className="block text-xs text-zinc-400">{hint}</span>
      </span>
    </button>
  );

  const driving = phase === "drive";
  const real = bundledRealLap("thunderhill-west");

  return (
    <div ref={rootRef} className="sim fixed left-0 top-0 z-50 h-dvh w-screen select-none overflow-hidden bg-[#0d0e11]" data-sim-phase={phase} data-sim-ready={ready ? "1" : "0"} data-touch={touch ? "1" : "0"}>
      <canvas ref={canvasRef} data-sim-canvas="1" className="absolute inset-0 h-full w-full" />

      {failed ? (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-zinc-100">
          <div className="sim-panel max-w-sm p-5">
            <p className="font-semibold">This browser could not start 3D graphics.</p>
            <p className="mt-2 text-sm text-zinc-400">Apex Sim needs WebGL 2. Try the latest Chrome, Safari, Edge or Firefox.</p>
            <Link href="/drive" className="sim-btn mt-4">
              Back
            </Link>
          </div>
        </div>
      ) : null}

      {/* HUD */}
      <div className="sim-hud pointer-events-none absolute inset-0" data-on={driving ? "1" : "0"} aria-hidden={!driving}>
        <div className="absolute left-3 top-3 flex items-start gap-2 [padding-top:env(safe-area-inset-top)]">
          <button type="button" className="sim-icon pointer-events-auto" aria-label="Pause" data-sim-pause="1" onClick={() => setPhase("paused")}>
            II
          </button>
          <div className="sim-card px-3 py-2">
            <div className="sim-label">Lap</div>
            <span ref={lapEl} data-sim-laptime="1" className="sim-time block text-2xl" />
            <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-xs text-zinc-300">
              <span className="sim-label">Last</span>
              <span ref={lastEl} className="sim-time" />
              <span className="sim-label">Best</span>
              <span ref={bestEl} className="sim-time" />
            </div>
          </div>
        </div>
        <div className="sim-banners absolute inset-x-0 flex flex-col items-center gap-2 [padding-top:env(safe-area-inset-top)]">
          <div ref={deltaEl} data-sim-delta="1" className="sim-delta" />
          <div ref={noticeEl} data-sim-notice="1" role="status" className="sim-notice" />
        </div>
        <div className="absolute right-3 top-3 flex flex-col items-end gap-2 [padding-top:env(safe-area-inset-top)]">
          <canvas ref={mapRef} width={264} height={264} className="h-[104px] w-[104px] sm:h-[132px] sm:w-[132px]" />
          <div className="flex gap-2">
            <button type="button" className="sim-icon pointer-events-auto" aria-label="Change camera" data-sim-camera="1" onClick={cycleCamera}>
              Cam
            </button>
            <button type="button" className="sim-icon pointer-events-auto" aria-label="Put the car back on the track" data-sim-reset="1" onClick={resetCar}>
              Reset
            </button>
          </div>
        </div>

        <div className="sim-gauges absolute inset-x-0 flex items-end justify-center gap-3 [padding-bottom:env(safe-area-inset-bottom)]">
          <div className="sim-card flex items-end gap-2 px-2 py-2">
            <div className="sim-pedal" title="Brake">
              <div ref={brkEl} className="sim-pedal__fill sim-pedal__fill--brake" />
            </div>
            <div className="sim-pedal" title="Throttle">
              <div ref={thrEl} className="sim-pedal__fill sim-pedal__fill--gas" />
            </div>
          </div>
          <div className="sim-card min-w-[210px] px-4 py-2 text-center sm:min-w-[260px]">
            <div className="sim-rpm">
              <div ref={rpmEl} className="sim-rpm__fill" />
            </div>
            <div className="mt-1 flex items-end justify-center gap-3">
              <span ref={gearEl} data-sim-gear="1" className="sim-gear" />
              <span className="leading-none">
                <span ref={speedEl} data-sim-speed="1" className="sim-speed" />
                <span className="sim-label ml-1">{prefs.unit === "mph" ? "mph" : "km/h"}</span>
              </span>
              <span className="text-left leading-tight">
                <span ref={rpmText} className="sim-time block text-xs text-zinc-300" />
                <span className="sim-label">rpm</span>
              </span>
            </div>
            <div className="mt-1 flex items-center justify-center gap-2">
              <span ref={absEl} className="sim-lamp">
                ABS
              </span>
              <div className="sim-steer">
                <div ref={steerEl} className="sim-steer__dot" />
              </div>
              <span ref={tcEl} className="sim-lamp">
                TC
              </span>
            </div>
          </div>
        </div>

        {touch ? (
          <>
            <div
              className="sim-steerpad pointer-events-auto absolute bottom-0 left-0 h-[46%] w-[46%]"
              data-sim-steerpad="1"
              onPointerDown={onSteerDown}
              onPointerMove={onSteerMove}
              onPointerUp={onSteerUp}
              onPointerCancel={onSteerUp}
            >
              <div className="sim-steerpad__track">
                <div ref={steerKnob} className="sim-steerpad__knob" />
              </div>
            </div>
            <div className="pointer-events-auto absolute bottom-3 right-3 flex items-end gap-3 [padding-bottom:env(safe-area-inset-bottom)]">
              {!prefs.assists.autoShift ? (
                <div className="flex flex-col gap-2">
                  <button type="button" className="sim-icon" aria-label="Shift up" {...hold("up")}>
                    +
                  </button>
                  <button type="button" className="sim-icon" aria-label="Shift down" {...hold("down")}>
                    −
                  </button>
                </div>
              ) : null}
              <button type="button" className="sim-pedalbtn sim-pedalbtn--brake" aria-label="Brake" data-sim-brake="1" {...hold("brake")}>
                Brake
              </button>
              <button type="button" className="sim-pedalbtn sim-pedalbtn--gas" aria-label="Throttle" data-sim-gas="1" {...hold("throttle")}>
                Gas
              </button>
            </div>
          </>
        ) : null}
      </div>

      {/* Menu and pause */}
      {!driving && !failed ? (
        <div className="absolute inset-0 overflow-y-auto bg-black/45 p-3 sm:p-6" data-sim-menu="1">
          <div className="sim-panel mx-auto max-w-xl p-4 text-zinc-100 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="sim-label">Apex Sim</p>
                <h1 className="sim-title">ND Miata · Thunderhill West</h1>
              </div>
              <Link href="/drive" className="sim-btn sim-btn--quiet" data-sim-exit="1">
                Exit
              </Link>
            </div>
            <p className="mt-2 text-sm text-zinc-300">
              The real circuit at full size on its surveyed hills, and a 181 hp, {ND_MIATA.mass} kg rear-drive roadster modelled tyre by tyre. Chase
              {real ? ` the real ${formatLap(real.timeMs)} lap from uploaded telemetry` : " your own best lap"}.
            </p>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="sim-stat">
                <dt className="sim-label">Lap length</dt>
                <dd>2.61 km</dd>
              </div>
              <div className="sim-stat">
                <dt className="sim-label">Real lap</dt>
                <dd data-sim-reallap="1">{real ? formatLap(real.timeMs) : "none"}</dd>
              </div>
              <div className="sim-stat">
                <dt className="sim-label">Your best</dt>
                <dd data-sim-best="1">{savedBest ? formatLap(savedBest) : "not set"}</dd>
              </div>
            </dl>

            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="sim-btn sim-btn--go" data-sim-start="1" disabled={!ready} onClick={phase === "paused" ? () => setPhase("drive") : startDrive}>
                {!ready ? "Loading…" : phase === "paused" ? "Resume" : "Drive"}
              </button>
              {phase === "paused" ? (
                <button type="button" className="sim-btn" data-sim-restart="1" onClick={startDrive}>
                  Restart
                </button>
              ) : null}
              <BugReportButton className="sim-btn min-h-11" controls={touch ? "touch pedals" : "keyboard / gamepad"} dataAttr="sim" />
            </div>

            <h2 className="sim-label mt-5">Ghost cars</h2>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {toggle("Real lap", prefs.ghostReal, (v) => setPrefs((p) => ({ ...p, ghostReal: v })), "Blue car on the real line at real speed", "ghost-real")}
              {toggle("Your best", prefs.ghostBest, (v) => setPrefs((p) => ({ ...p, ghostBest: v })), "Gold car replaying your fastest valid lap", "ghost-best")}
            </div>

            <h2 className="sim-label mt-5">Driving aids</h2>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {toggle("Automatic gearbox", prefs.assists.autoShift, (v) => setAssist("autoShift", v), "Off: shift with E and Q", "auto")}
              {toggle("Anti-lock brakes", prefs.assists.abs, (v) => setAssist("abs", v), "Off: the wheels can lock", "abs")}
              {toggle("Traction control", prefs.assists.tractionControl, (v) => setAssist("tractionControl", v), "Off: the rear wheels can spin", "tc")}
              {toggle("Steering help", prefs.assists.steeringHelp, (v) => setAssist("steeringHelp", v), "Eases into slides for keys and touch", "steer")}
            </div>

            <h2 className="sim-label mt-5">Paint</h2>
            <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Paint colour">
              {PAINTS.map((p) => (
                <button
                  key={p.hex}
                  type="button"
                  role="radio"
                  aria-checked={prefs.paint === p.hex}
                  aria-label={p.name}
                  className="sim-swatch"
                  style={{ background: p.hex }}
                  onClick={() => setPrefs((q) => ({ ...q, paint: p.hex }))}
                />
              ))}
            </div>

            <h2 className="sim-label mt-5">Display</h2>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {toggle("Miles per hour", prefs.unit === "mph", (v) => setPrefs((p) => ({ ...p, unit: v ? "mph" : "kmh" })), "Off: km/h", "mph")}
              {toggle("Sound", !prefs.muted, (v) => setPrefs((p) => ({ ...p, muted: !v })), "Engine, tyres and wind", "sound")}
            </div>

            <h2 className="sim-label mt-5">Controls</h2>
            <ul className="mt-2 grid gap-1 text-sm text-zinc-300 sm:grid-cols-2">
              {touch ? (
                <>
                  <li>Steer: drag left or right on the left side</li>
                  <li>Pedals: Gas and Brake on the right</li>
                  <li>Reverse: hold Brake when stopped</li>
                </>
              ) : (
                <>
                  <li>Steer: A D or ← →</li>
                  <li>Throttle: W or ↑ · Brake: S, ↓ or Space</li>
                  <li>Shift: E up, Q down (manual)</li>
                  <li>Camera: C · Reset: R · Pause: Esc</li>
                  <li>Reverse: hold Brake when stopped</li>
                  <li>Gamepad: stick, triggers, bumpers</li>
                </>
              )}
            </ul>
            <p className="mt-4 text-xs text-zinc-500">
              Line from a real GPS lap, heights from USGS 3DEP. Track width, kerbs and the tyre curve are estimates; the road is modelled without banking.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
