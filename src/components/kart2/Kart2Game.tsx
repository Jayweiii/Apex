"use client";

/**
 * Apex Kart rebuild. React paints the garage and the phase overlays only.
 * The race loop writes the HUD through refs so a phone never re-renders at 60 Hz.
 */
import { SegmentedControl } from "@/components/SegmentedControl";
import { attachTouchDebug, guardPlaySurface, lockPageOverscroll } from "@/components/kart/touch-guard";
import { emptyGhostPose, ghostFromSamples, referenceGhost, sampleGhost, type GeoSample, type GhostLap, type GhostPose } from "@/lib/kart2/ghost";
import { ghostFromUpload } from "@/lib/kart2/load-ghost";
import { getKart2Level, KART2_LEVELS } from "@/lib/kart2/levels";
import {
  KART_BODIES,
  KART_COLORS,
  KART_PATTERNS,
  KART_WHEELS,
  liveryColor,
  liveryStats,
  loadLivery,
  saveLivery,
  type KartBody,
  type KartColorId,
  type KartPattern,
  type KartWheels,
  type Livery,
} from "@/lib/kart2/livery";
import { wrapAngle } from "@/lib/kart2/math";
import { createKart, stepKart, DT, type Kart2Input, type Kart2State } from "@/lib/kart2/physics";
import { chaseCamYaw, clampStick, STICK_RADIUS, stickCommand } from "@/lib/kart2/stick";
import { buildTrack, type Kart2Track } from "@/lib/kart2/track";
import { kmhToDisplay, readSpeedUnit, SPEED_UNIT_EVENT, type SpeedUnit } from "@/lib/speed-units";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createKartAudio, type KartAudio } from "./audio";
import { createKart2View, type Kart2View } from "./scene";

type Phase = "ready" | "countdown" | "racing" | "paused";

const TRACK_KEY = "apex.kart2.track";
const MAX_STEPS = 5;

function bestKey(id: string) {
  return `apex.kart2.best.${id}`;
}

function formatLap(seconds: number): string {
  if (!seconds || !Number.isFinite(seconds)) return "—";
  const ms = Math.round(seconds * 1000);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const c = Math.floor((ms % 1000) / 10);
  return `${m}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

function loadBest(id: string): number {
  try {
    const v = Number(window.localStorage.getItem(bestKey(id)));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

function saveBest(id: string, seconds: number) {
  try {
    window.localStorage.setItem(bestKey(id), String(seconds));
  } catch {
    // ignore
  }
}

type Keys = { up: boolean; down: boolean; left: boolean; right: boolean; drift: boolean };
type Stick = { pointerId: number; dx: number; dy: number };

function capture(el: HTMLElement, pointerId: number) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // pointer already gone
  }
}

export function Kart2Game() {
  const [phase, setPhase] = useState<Phase>("ready");
  const [trackId, setTrackId] = useState(() => {
    if (typeof window === "undefined") return KART2_LEVELS[0]!.id;
    try {
      const saved = localStorage.getItem(TRACK_KEY);
      if (saved && KART2_LEVELS.some((level) => level.id === saved)) return saved;
    } catch {
      // ignore
    }
    return KART2_LEVELS[0]!.id;
  });
  const [livery, setLivery] = useState<Livery>(() => loadLivery());
  const [ghostName, setGhostName] = useState("Reference lap");
  const [ghostError, setGhostError] = useState("");
  const [muted, setMuted] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("apex.kart2.muted") === "1";
    } catch {
      return false;
    }
  });

  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const miniRef = useRef<HTMLCanvasElement | null>(null);
  const stickArea = useRef<HTMLDivElement | null>(null);
  const stickBase = useRef<HTMLDivElement | null>(null);
  const stickKnob = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const debugPanel = useRef<HTMLPreElement | null>(null);
  const probeRef = useRef<HTMLSpanElement | null>(null);
  const hudTime = useRef<HTMLSpanElement | null>(null);
  const hudLap = useRef<HTMLSpanElement | null>(null);
  const hudSpeed = useRef<HTMLSpanElement | null>(null);
  const hudDelta = useRef<HTMLSpanElement | null>(null);
  const hudBest = useRef<HTMLSpanElement | null>(null);
  const hudFlash = useRef<HTMLDivElement | null>(null);
  const boostRefs = useRef<Array<HTMLSpanElement | null>>([null, null, null]);

  const phaseRef = useRef<Phase>("ready");
  const trackRef = useRef<Kart2Track | null>(null);
  const kartRef = useRef<Kart2State | null>(null);
  const viewRef = useRef<Kart2View | null>(null);
  const ghostRef = useRef<GhostLap | null>(null);
  const ghostPose = useRef<GhostPose>(emptyGhostPose());
  const samplesRef = useRef<GeoSample[] | null>(null);
  const liveryRef = useRef(livery);
  const camRef = useRef(0);
  const audioRef = useRef<KartAudio | null>(null);
  const keys = useRef<Keys>({ up: false, down: false, left: false, right: false, drift: false });
  const stick = useRef<Stick>({ pointerId: -1, dx: 0, dy: 0 });
  const stickAngle = useRef({ active: false, angle: 0 });
  const unitRef = useRef<SpeedUnit>("mph");
  const bestRef = useRef(0);
  const tickRef = useRef(0);
  const countdown = useRef(0);
  const beepAt = useRef(0);
  const flashUntil = useRef(0);
  const seenLap = useRef(1);
  const padButtons = useRef<boolean[]>([]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    const area = stickArea.current;
    const cleanups: Array<() => void> = [lockPageOverscroll()];
    if (area) cleanups.push(guardPlaySurface(area));
    const audio = createKartAudio();
    audioRef.current = audio;
    unitRef.current = readSpeedUnit();
    const onUnit = (event: Event) => {
      unitRef.current = (event as CustomEvent<SpeedUnit>).detail ?? readSpeedUnit();
    };
    window.addEventListener(SPEED_UNIT_EVENT, onUnit);

    liveryRef.current = livery;
    const canvas = canvasRef.current;
    let view: Kart2View | null = null;
    const mount = (id: string) => {
      if (!canvas) return;
      view?.dispose();
      const level = getKart2Level(id);
      const track = buildTrack(level);
      trackRef.current = track;
      kartRef.current = createKart(track, liveryStats(liveryRef.current));
      camRef.current = kartRef.current.heading;
      const custom = samplesRef.current
        ? ghostFromSamples(track, samplesRef.current, ghostRef.current?.name || "Your lap")
        : null;
      ghostRef.current = custom ?? referenceGhost(track);
      setGhostName(ghostRef.current.name);
      if (samplesRef.current && !custom) {
        setGhostError("That lap is not on this track.");
      }
      bestRef.current = loadBest(level.id);
      if (hudBest.current) hudBest.current.textContent = formatLap(bestRef.current);
      try {
        view = createKart2View(canvas, track, liveryRef.current);
      } catch {
        view = { resize() {}, draw() {}, setLivery() {}, dispose() {} };
      }
      viewRef.current = view;
      view.resize();
    };
    mount(trackId);

    const onResize = () => viewRef.current?.resize();
    window.addEventListener("resize", onResize);

    const releaseStick = () => {
      stick.current.pointerId = -1;
      stick.current.dx = 0;
      stick.current.dy = 0;
      if (stickBase.current) stickBase.current.style.opacity = "0";
    };

    const onBlur = () => {
      keys.current = { up: false, down: false, left: false, right: false, drift: false };
      releaseStick();
      if (phaseRef.current === "racing") {
        phaseRef.current = "paused";
        setPhase("paused");
      }
    };
    window.addEventListener("blur", onBlur);

    const panel = debugPanel.current;
    if (panel && new URLSearchParams(window.location.search).get("debug") === "1") {
      panel.hidden = false;
      cleanups.push(
        attachTouchDebug(panel, () => {
          const kart = kartRef.current;
          return `${phaseRef.current} h ${kart ? kart.heading.toFixed(2) : "-"} cam ${camRef.current.toFixed(2)} v ${kart ? kart.speed.toFixed(1) : "0"} stick ${Math.round(stick.current.dx)},${Math.round(stick.current.dy)}`;
        }),
      );
    }

    function readInput(cam: number): Kart2Input {
      let dx = 0;
      let dy = 0;
      let drift = keys.current.drift;
      const pad = navigator.getGamepads?.()[0];
      if (pad) {
        const pressed = pad.buttons.map((button) => button.pressed);
        if (pressed[9] && !padButtons.current[9]) {
          if (phaseRef.current === "racing") {
            phaseRef.current = "paused";
            setPhase("paused");
          } else if (phaseRef.current === "paused") {
            phaseRef.current = "racing";
            setPhase("racing");
          }
        }
        padButtons.current = pressed;
        drift = drift || Boolean(pressed[1] || pressed[5]);
      }
      if (stick.current.pointerId >= 0) {
        dx = stick.current.dx;
        dy = stick.current.dy;
      } else if (pad && (Math.hypot(pad.axes[0] ?? 0, pad.axes[1] ?? 0) > 0.18 || (pad.buttons[7]?.value ?? 0) > 0.12)) {
        const ax = pad.axes[0] ?? 0;
        const ay = pad.axes[1] ?? 0;
        if (Math.hypot(ax, ay) > 0.18) {
          dx = ax * STICK_RADIUS;
          dy = ay * STICK_RADIUS;
        } else {
          dy = -(pad.buttons[7]?.value ?? 0) * STICK_RADIUS;
        }
      } else {
        const k = keys.current;
        dx = (Number(k.right) - Number(k.left)) * STICK_RADIUS;
        dy = (Number(k.down) - Number(k.up)) * STICK_RADIUS;
      }
      const cmd = stickCommand(dx, dy, cam);
      let omega = 0;
      if (cmd.active) {
        const angle = Math.atan2(cmd.x, -cmd.y);
        if (stickAngle.current.active) omega = wrapAngle(angle - stickAngle.current.angle) / DT;
        stickAngle.current = { active: true, angle };
      } else {
        stickAngle.current.active = false;
      }
      return {
        active: cmd.active,
        heading: cmd.heading,
        throttle: cmd.throttle,
        stickOmega: omega,
        drift,
      };
    }

    function paintHud(now: number, kart: Kart2State, track: Kart2Track) {
      if (hudTime.current) hudTime.current.textContent = formatLap(phaseRef.current === "racing" || phaseRef.current === "paused" ? kart.lapTime : 0);
      if (hudLap.current) hudLap.current.textContent = `Lap ${kart.lap}`;
      if (hudSpeed.current) {
        const kmh = kart.speed * 3.6;
        const shown = Math.round(kmhToDisplay(kmh, unitRef.current));
        hudSpeed.current.textContent = `${shown} ${unitRef.current === "mph" ? "mph" : "km/h"}`;
      }
      if (hudDelta.current && ghostPose.current.active && phaseRef.current === "racing") {
        const len = track.length;
        let gap = kart.s - (ghostPose.current.s % len);
        if (gap > len * 0.5) gap -= len;
        if (gap < -len * 0.5) gap += len;
        const sec = -gap / Math.max(10, kart.speed);
        const ahead = sec <= 0;
        hudDelta.current.textContent = `${ahead ? "" : "+"}${sec.toFixed(2)}`;
        hudDelta.current.style.color = ahead ? "#7dff6b" : "#ff8b7a";
      }
      const tier = kart.charge >= 1.6 ? 3 : kart.charge >= 0.92 ? 2 : kart.charge >= 0.4 ? 1 : 0;
      for (let i = 0; i < 3; i += 1) {
        const el = boostRefs.current[i];
        if (!el) continue;
        const on = kart.boost > 0 || i < tier;
        el.style.background = on ? (i === 2 ? "#c56bff" : i === 1 ? "#ff8a1e" : "#7ec8ff") : "rgba(255,255,255,0.18)";
      }
      if (hudFlash.current && now > flashUntil.current && phaseRef.current === "racing") {
        hudFlash.current.textContent = kart.drifting ? "DRIFT" : kart.boost > 0 ? "BOOST" : "";
      }
      const probe = probeRef.current;
      if (probe) {
        probe.dataset.tick = String(tickRef.current);
        probe.dataset.x = kart.x.toFixed(2);
        probe.dataset.y = kart.y.toFixed(2);
        probe.dataset.heading = String(kart.heading);
        probe.dataset.cam = String(camRef.current);
        probe.dataset.speed = kart.speed.toFixed(3);
        probe.dataset.s = kart.s.toFixed(2);
        probe.dataset.drift = kart.drifting ? "1" : "0";
        probe.dataset.left = kart.turnedLeft.toFixed(3);
      }
    }

    function paintMini(track: Kart2Track, kart: Kart2State, ghost: GhostPose) {
      const canvas = miniRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < track.count; i += 3) {
        minX = Math.min(minX, track.px[i]!);
        maxX = Math.max(maxX, track.px[i]!);
        minY = Math.min(minY, track.py[i]!);
        maxY = Math.max(maxY, track.py[i]!);
      }
      const span = Math.max(maxX - minX, maxY - minY) || 1;
      const map = (x: number, y: number) => ({
        x: ((x - minX) / span) * (w - 10) + 5,
        y: h - (((y - minY) / span) * (h - 10) + 5),
      });
      ctx.fillStyle = "#142018";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#d7d3c8";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < track.count; i += 2) {
        const p = map(track.px[i]!, track.py[i]!);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.stroke();
      if (ghost.active) {
        const g = map(ghost.x, ghost.y);
        ctx.fillStyle = "#9fd7ff";
        ctx.fillRect(g.x - 2, g.y - 2, 4, 4);
      }
      const c = map(kart.x, kart.y);
      ctx.fillStyle = "#ff5a1f";
      ctx.fillRect(c.x - 2, c.y - 2, 5, 5);
    }
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const frameDt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const track = trackRef.current;
      const kart = kartRef.current;
      const viewNow = viewRef.current;
      if (!track || !kart || !viewNow) return;
      const phaseNow = phaseRef.current;

      if (phaseNow === "ready" || phaseNow === "paused") {
        camRef.current = phaseNow === "ready" ? camRef.current + frameDt * 0.28 : kart.heading;
      } else if (phaseNow === "countdown") {
        countdown.current -= frameDt;
        const left = Math.ceil(countdown.current);
        if (hudFlash.current) hudFlash.current.textContent = left > 0 ? String(left) : "GO";
        if (left > 0 && left !== beepAt.current) {
          beepAt.current = left;
          audioRef.current?.blip(420 + (3 - left) * 80, 0.12);
        }
        if (countdown.current <= 0) {
          phaseRef.current = "racing";
          setPhase("racing");
          beepAt.current = 0;
          audioRef.current?.blip(880, 0.18);
          const launch = readInput(camRef.current);
          if (launch.active && launch.throttle > 0.85) {
            kart.boost = 0.5;
            kart.boostTier = 1;
          }
          if (hudFlash.current) {
            hudFlash.current.textContent = "GO";
            flashUntil.current = now + 700;
          }
        }
      } else if (phaseNow === "racing") {
        acc += frameDt;
        let steps = 0;
        while (acc >= DT && steps < MAX_STEPS) {
          const input = readInput(camRef.current);
          stepKart(kart, input, track, DT);
          camRef.current = chaseCamYaw(camRef.current, kart.heading, kart.slip, DT);
          acc -= DT;
          steps += 1;
          tickRef.current += 1;
        }
        if (steps === MAX_STEPS) acc = 0;
        if (kart.lap !== seenLap.current && kart.lastLap > 8) {
          seenLap.current = kart.lap;
          if (hudFlash.current) {
            hudFlash.current.textContent = formatLap(kart.lastLap);
            flashUntil.current = now + 1600;
          }
          if (bestRef.current === 0 || kart.lastLap < bestRef.current) {
            bestRef.current = kart.lastLap;
            saveBest(track.level.id, kart.lastLap);
            if (hudBest.current) hudBest.current.textContent = formatLap(kart.lastLap);
          }
          audioRef.current?.blip(660, 0.08);
        }
        if (kart.boost > 0.55 && kart.boost < 0.62) audioRef.current?.blip(520, 0.1);
      }

      const ghost = ghostRef.current;
      if (ghost && phaseNow === "racing") sampleGhost(ghost, kart.lapTime, ghostPose.current);
      else if (ghost) sampleGhost(ghost, 0, ghostPose.current);
      viewNow.draw(kart, ghostPose.current, camRef.current, frameDt, phaseNow === "ready");
      audioRef.current?.update(kart.speed, kart.slip, kart.boost, kart.drifting);
      paintHud(now, kart, track);
      paintMini(track, kart, ghostPose.current);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      viewRef.current?.dispose();
      viewRef.current = null;
      audio.dispose();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener(SPEED_UNIT_EVENT, onUnit);
      for (const cleanup of cleanups) cleanup();
    };
    // Mount once. Track changes go through rebuildTrack.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  function rebuildTrack(id: string) {
    setTrackId(id);
    try {
      localStorage.setItem(TRACK_KEY, id);
    } catch {
      // ignore
    }
    const canvas = canvasRef.current;
    const previous = viewRef.current;
    if (!canvas) return;
    previous?.dispose();
    const level = getKart2Level(id);
    const track = buildTrack(level);
    trackRef.current = track;
    kartRef.current = createKart(track, liveryStats(liveryRef.current));
    camRef.current = kartRef.current.heading;
    seenLap.current = 1;
    tickRef.current = 0;
    const custom = samplesRef.current
      ? ghostFromSamples(track, samplesRef.current, "Your lap")
      : null;
    ghostRef.current = custom ?? referenceGhost(track);
    setGhostName(ghostRef.current.name);
    setGhostError(samplesRef.current && !custom ? "That lap is not on this track." : "");
    bestRef.current = loadBest(id);
    if (hudBest.current) hudBest.current.textContent = formatLap(bestRef.current);
    let view: Kart2View;
    try {
      view = createKart2View(canvas, track, liveryRef.current);
    } catch {
      view = { resize() {}, draw() {}, setLivery() {}, dispose() {} };
    }
    viewRef.current = view;
    view.resize();
  }

  function applyLivery(next: Livery) {
    liveryRef.current = next;
    setLivery(next);
    saveLivery(next);
    viewRef.current?.setLivery(next);
    const track = trackRef.current;
    if (track && phaseRef.current === "ready") {
      kartRef.current = createKart(track, liveryStats(next));
      camRef.current = kartRef.current.heading;
    }
  }

  function start() {
    audioRef.current?.resume();
    const track = trackRef.current;
    if (!track) return;
    if (phaseRef.current === "paused") {
      phaseRef.current = "racing";
      setPhase("racing");
      return;
    }
    if (phaseRef.current !== "ready") return;
    keys.current = { up: false, down: false, left: false, right: false, drift: false };
    stick.current = { pointerId: -1, dx: 0, dy: 0 };
    const kart = createKart(track, liveryStats(liveryRef.current));
    kartRef.current = kart;
    camRef.current = kart.heading;
    tickRef.current = 0;
    seenLap.current = 1;
    countdown.current = 3;
    beepAt.current = 0;
    phaseRef.current = "countdown";
    setPhase("countdown");
  }

  function onKey(event: KeyboardEvent, down: boolean) {
    const key = event.key.toLowerCase();
    const map: Record<string, keyof Keys | "pause"> = {
      w: "up",
      arrowup: "up",
      s: "down",
      arrowdown: "down",
      a: "left",
      arrowleft: "left",
      d: "right",
      arrowright: "right",
      " ": "drift",
      shift: "drift",
      p: "pause",
      escape: "pause",
    };
    const action = map[key];
    if (!action) return;
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) event.preventDefault();
    if (action === "pause") {
      if (!down) return;
      if (phaseRef.current === "racing") {
        phaseRef.current = "paused";
        setPhase("paused");
      } else if (phaseRef.current === "paused") {
        phaseRef.current = "racing";
        setPhase("racing");
      }
      return;
    }
    keys.current[action] = down;
  }

  useEffect(() => {
    const down = (event: KeyboardEvent) => onKey(event, true);
    const up = (event: KeyboardEvent) => onKey(event, false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  function moveStick(event: React.PointerEvent<HTMLDivElement>) {
    if (stick.current.pointerId !== event.pointerId) return;
    const area = stickArea.current;
    const base = stickBase.current;
    if (!area || !base) return;
    const rect = area.getBoundingClientRect();
    const ox = base.offsetLeft + STICK_RADIUS;
    const oy = base.offsetTop + STICK_RADIUS;
    const clamped = clampStick(event.clientX - rect.left - ox, event.clientY - rect.top - oy);
    stick.current.dx = clamped.x;
    stick.current.dy = clamped.y;
    if (stickKnob.current) {
      stickKnob.current.style.transform = `translate(${clamped.x}px, ${clamped.y}px)`;
    }
  }

  function endStick(event: React.PointerEvent<HTMLDivElement>) {
    if (stick.current.pointerId !== event.pointerId && stick.current.pointerId !== -1) return;
    stick.current = { pointerId: -1, dx: 0, dy: 0 };
    if (stickBase.current) stickBase.current.style.opacity = "0";
    if (stickKnob.current) stickKnob.current.style.transform = "translate(0px, 0px)";
  }

  const level = getKart2Level(trackId);
  const driving = phase === "racing" || phase === "countdown";

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 flex flex-col overflow-hidden bg-[#16304a] text-zinc-50 select-none"
      style={{ touchAction: "none" }}
      data-apex-kart2="1"
      data-phase={phase}
    >
      <div className="z-10 flex items-center justify-between gap-1 bg-zinc-950/90 px-1 py-1 font-mono text-xs font-semibold sm:px-3 sm:text-sm">
        <div className="flex min-w-0 items-center gap-1 sm:gap-3">
          <Link
            href="/drive"
            aria-label="Back to Drive"
            data-apex-kart2-back="1"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-lg text-zinc-100"
          >
            ←
          </Link>
          <span ref={hudLap}>Lap 1</span>
          <span ref={hudTime} className="text-base text-orange-300 sm:text-xl">
            0:00.00
          </span>
          <span className="hidden text-zinc-400 sm:inline">
            best <span ref={hudBest}>—</span>
          </span>
          <span ref={hudDelta} className="text-zinc-300">
            0.00
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="flex gap-1" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                ref={(el) => {
                  boostRefs.current[i] = el;
                }}
                className="inline-block h-3 w-3 border border-white/30"
                style={{ background: "rgba(255,255,255,0.18)" }}
              />
            ))}
          </span>
          <span ref={hudSpeed} className="min-w-14 text-right text-zinc-100">
            0
          </span>
          <button
            type="button"
            className="apex-btn min-h-11 min-w-11 px-2"
            aria-pressed={muted}
            aria-label={muted ? "Unmute" : "Mute"}
            data-apex-kart2-mute="1"
            onClick={() => {
              const next = !audioRef.current?.muted();
              audioRef.current?.setMuted(next);
              setMuted(next);
            }}
          >
            {muted ? "Off" : "Snd"}
          </button>
          <button
            type="button"
            className="apex-btn min-h-11 min-w-11 px-2"
            data-apex-kart2-pause="1"
            disabled={phase === "ready" || phase === "countdown"}
            onClick={() => {
              if (phaseRef.current === "racing") {
                phaseRef.current = "paused";
                setPhase("paused");
              } else if (phaseRef.current === "paused") {
                phaseRef.current = "racing";
                setPhase("racing");
              }
            }}
          >
            {phase === "paused" ? "Resume" : "Pause"}
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
          style={{ imageRendering: "pixelated", touchAction: "none" }}
          aria-label="Apex Kart"
          data-apex-kart2-canvas="1"
        />
        <canvas
          ref={miniRef}
          width={96}
          height={96}
          aria-hidden
          data-apex-kart2-minimap="1"
          className="pointer-events-none absolute right-2 top-2 z-[6] h-16 w-16 border border-white/30 sm:h-20 sm:w-20"
          style={{ imageRendering: "pixelated" }}
        />
        <div
          ref={stickArea}
          className="absolute inset-0 z-[5]"
          style={{ touchAction: "none", pointerEvents: driving ? "auto" : "none" }}
          data-apex-kart2-stick-area="1"
          data-apex-kart-stick-area="1"
          onPointerDown={(event) => {
            if (!driving) return;
            audioRef.current?.resume();
            stick.current.pointerId = event.pointerId;
            stick.current.dx = 0;
            stick.current.dy = 0;
            const area = stickArea.current;
            const base = stickBase.current;
            if (!area || !base) return;
            const rect = area.getBoundingClientRect();
            base.style.left = `${event.clientX - rect.left - STICK_RADIUS}px`;
            base.style.top = `${event.clientY - rect.top - STICK_RADIUS}px`;
            base.style.opacity = "1";
            if (stickKnob.current) stickKnob.current.style.transform = "translate(0px, 0px)";
            capture(event.currentTarget, event.pointerId);
          }}
          onPointerMove={moveStick}
          onPointerUp={endStick}
          onPointerCancel={endStick}
          onLostPointerCapture={endStick}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div
            ref={stickBase}
            data-apex-kart2-stick="1"
            data-apex-kart-stick="1"
            className="pointer-events-none absolute rounded-full border-2 border-white/50 bg-white/10 opacity-0"
            style={{ width: STICK_RADIUS * 2, height: STICK_RADIUS * 2 }}
          >
            <div
              ref={stickKnob}
              className="absolute left-1/2 top-1/2 -ml-6 -mt-6 h-12 w-12 rounded-full bg-orange-400/90 shadow-lg shadow-black/40"
            />
          </div>
        </div>
        <div
          ref={hudFlash}
          className="pointer-events-none absolute inset-x-0 top-[18%] text-center font-mono text-5xl font-black tracking-wide text-white drop-shadow-[0_3px_0_rgba(0,0,0,0.65)]"
        />
        <span ref={probeRef} hidden data-apex-kart2-probe="1" />
        <pre
          ref={debugPanel}
          hidden
          data-apex-kart2-debug="1"
          className="pointer-events-none absolute bottom-2 left-2 z-30 max-w-[95%] whitespace-pre-wrap rounded bg-black/75 p-1.5 font-mono text-[10px] leading-tight text-lime-300"
        />

        {phase === "ready" || phase === "paused" ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center p-3">
            <div className="w-full max-w-md border border-zinc-700 bg-zinc-950/95 p-4 shadow-2xl">
              <p className="text-[11px] uppercase tracking-[0.18em] text-orange-400">Apex Kart</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">{phase === "paused" ? "Paused" : level.name}</h1>
              <p className="text-xs text-zinc-400">{level.blurb}</p>
              {phase === "ready" ? (
                <div className="mt-3 flex flex-col gap-2.5">
                  <SegmentedControl
                    ariaLabel="Track"
                    className="apex-segment--fill"
                    accent
                    value={trackId}
                    onChange={rebuildTrack}
                    options={KART2_LEVELS.map((item) => ({
                      value: item.id,
                      label: item.short,
                      title: item.name,
                    }))}
                  />
                  <div role="radiogroup" aria-label="Body color" className="flex flex-wrap gap-2">
                    {KART_COLORS.map((color) => {
                      const selected = livery.color === color.id;
                      return (
                        <button
                          key={color.id}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          aria-label={color.name}
                          onClick={() => applyLivery({ ...liveryRef.current, color: color.id as KartColorId })}
                          className="h-11 w-11 border-2"
                          style={{
                            background: color.hex,
                            borderColor: selected ? "#fff" : "transparent",
                          }}
                        />
                      );
                    })}
                  </div>
                  <SegmentedControl
                    ariaLabel="Body"
                    className="apex-segment--fill"
                    value={livery.body}
                    onChange={(body) => applyLivery({ ...liveryRef.current, body: body as KartBody })}
                    options={KART_BODIES.map((body) => ({ value: body, label: body }))}
                  />
                  <SegmentedControl
                    ariaLabel="Wheels"
                    className="apex-segment--fill"
                    value={livery.wheels}
                    onChange={(wheels) => applyLivery({ ...liveryRef.current, wheels: wheels as KartWheels })}
                    options={KART_WHEELS.map((wheels) => ({ value: wheels, label: wheels }))}
                  />
                  <SegmentedControl
                    ariaLabel="Livery"
                    className="apex-segment--fill"
                    value={livery.pattern}
                    onChange={(pattern) => applyLivery({ ...liveryRef.current, pattern: pattern as KartPattern })}
                    options={KART_PATTERNS.map((pattern) => ({ value: pattern, label: pattern }))}
                  />
                  <button
                    type="button"
                    className="apex-btn w-full"
                    data-apex-kart2-ghost="1"
                    onClick={() => fileRef.current?.click()}
                  >
                    Ghost: {ghostName}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,.gpx,.json,.vbo,.txt,text/csv"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      const track = trackRef.current;
                      if (!file || !track) return;
                      void ghostFromUpload(file, track).then((result) => {
                        if (!result.ok) {
                          setGhostError(result.error);
                          return;
                        }
                        samplesRef.current = result.samples;
                        ghostRef.current = result.ghost;
                        setGhostName(result.ghost.name);
                        setGhostError("");
                      });
                    }}
                  />
                  {ghostError ? <p className="text-xs text-red-300">{ghostError}</p> : null}
                  <p className="text-xs leading-relaxed text-zinc-300">
                    Point the stick where you want to go. Push it farther to go faster, and let go to brake.
                    Flick it, or yank the kart sideways at speed, to hang the rear out — straighten up to spend the boost.
                  </p>
                  <p className="text-[11px] text-zinc-500">Keys: WASD steer · Space drift · P pause · gamepad left stick</p>
                </div>
              ) : null}
              <button
                type="button"
                className="apex-btn apex-btn--primary mt-3 w-full"
                data-apex-kart2-start="1"
                onClick={start}
              >
                {phase === "paused" ? "Resume" : "Start"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <span className="sr-only" style={{ background: liveryColor(livery) }} />
    </div>
  );
}
