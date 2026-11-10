"use client";

import { guardPlaySurface, lockPageOverscroll } from "@/components/kart/touch-guard";
import type { DriveTrackPayload } from "@/lib/drive/types";
import type { RushAudio } from "@/lib/rush/audio";
import { statsFor, type KartLook } from "@/lib/rush/garage";
import {
  bundledRealLap,
  ghostFromRealLap,
  ghostFromRecording,
  ghostPose,
  loadBest,
  saveBest,
  type Ghost,
  type GhostPose,
  type RealLap,
} from "@/lib/rush/ghost";
import { stickInput, STICK_RADIUS, type StickInput } from "@/lib/rush/input";
import { DT, EV_BOOST, EV_CHARGE, EV_LAP, EV_PICKUP, EV_WALL, MAX_NITRO, type KartInput } from "@/lib/rush/kart";
import type { RushLevel } from "@/lib/rush/levels";
import { autopilot, createRace, RIVALS, stepRace, type RaceWorld, type RushMode } from "@/lib/rush/race";
import { buildRushTrack, type RushTrack, type TrackHit } from "@/lib/rush/track";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRushRenderer, type CameraMode, type RushRenderer } from "./renderer";

type Phase = "loading" | "intro" | "countdown" | "racing" | "paused" | "finished" | "error";

export type RushSettings = { autoGas: boolean; muted: boolean };

type Standing = { place: number; name: string; timeMs: number | null; bestMs: number; you: boolean };
type Results = {
  standings: Standing[];
  laps: number[];
  bestMs: number;
  newBest: boolean;
  ghostLabel: string | null;
  ghostMs: number;
};

const ORDINAL = ["1ST", "2ND", "3RD", "4TH", "5TH", "6TH", "7TH", "8TH"];
const INTRO_S = 3.2;
const COUNTDOWN_S = 3;

export function formatRushTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "-:--.--";
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

const trackCache = new Map<string, RushTrack>();
function trackFor(level: RushLevel): RushTrack {
  let t = trackCache.get(level.id);
  if (!t) {
    t = buildRushTrack(level.data);
    trackCache.set(level.id, t);
  }
  return t;
}

/** The site's best real lap for this track (uploaded telemetry), if any. */
async function fetchRealLap(trackId: string): Promise<RealLap | null> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    const res = await fetch(`/api/tracks/${encodeURIComponent(trackId)}/drive`, { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const payload = (await res.json()) as DriveTrackPayload;
    const g = payload.realGhost;
    if (!g || !Array.isArray(g.samples) || g.samples.length < 20) return null;
    return { label: g.label, timeMs: g.timeMs, origin: payload.origin, samples: g.samples.map((s) => [s.x, s.y, s.t ?? 0]) };
  } catch {
    return null;
  }
}

const REAL_GHOST_LOOK: KartLook = { body: "wedge", wheels: "slick", paint: "#dff6ff", accent: "#4cc9f0", helmet: "#ffffff", number: 0 };

export function RushRace({
  level,
  mode,
  look,
  settings,
  onSettings,
  onExit,
  audio,
}: {
  level: RushLevel;
  mode: RushMode;
  look: KartLook;
  settings: RushSettings;
  onSettings: (next: RushSettings) => void;
  onExit: () => void;
  /** Created on the Start tap so the browser allows sound from the first beep. */
  audio: RushAudio | null;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [results, setResults] = useState<Results | null>(null);
  const [raceKey, setRaceKey] = useState(0);
  const [touch] = useState(() => window.matchMedia("(pointer: coarse)").matches);
  const [error, setError] = useState("");

  const phaseRef = useRef<Phase>("loading");
  const settingsRef = useRef(settings);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<HTMLCanvasElement | null>(null);
  const placeEl = useRef<HTMLSpanElement | null>(null);
  const lapEl = useRef<HTMLSpanElement | null>(null);
  const timeEl = useRef<HTMLSpanElement | null>(null);
  const speedEl = useRef<HTMLSpanElement | null>(null);
  const deltaEl = useRef<HTMLSpanElement | null>(null);
  const flashEl = useRef<HTMLDivElement | null>(null);
  const hintEl = useRef<HTMLDivElement | null>(null);
  const wrongEl = useRef<HTMLDivElement | null>(null);
  const linesEl = useRef<HTMLDivElement | null>(null);
  const chargeEl = useRef<HTMLDivElement | null>(null);
  const nitroEl = useRef<HTMLDivElement | null>(null);
  const stickBase = useRef<HTMLDivElement | null>(null);
  const stickKnob = useRef<HTMLDivElement | null>(null);

  const keys = useRef({ left: false, right: false, up: false, down: false, drift: false, item: false });
  const stick = useRef({ id: -1, ox: 0, oy: 0, dx: 0, dy: 0 });
  const nitroHeld = useRef(false);

  // The sound engine is created by the Start tap and handed in; keep it in a
  // ref for the race loop and key handlers.
  const audioRef = useRef<RushAudio | null>(null);
  useEffect(() => {
    audioRef.current = audio;
    return () => {
      audio?.update(0, false, false, false, false);
      audioRef.current = null;
    };
  }, [audio]);

  useEffect(() => {
    settingsRef.current = settings;
    audio?.setMuted(settings.muted);
  }, [settings, audio]);

  const beforePause = useRef<Phase>("racing");
  const changePhase = useCallback((next: Phase) => {
    if (next === "paused" && phaseRef.current !== "paused") beforePause.current = phaseRef.current;
    phaseRef.current = next;
    setPhase(next);
  }, []);
  const resume = useCallback(() => changePhase(beforePause.current), [changePhase]);

  // Page hardening for touch play (no rubber-band scroll under the thumb).
  useEffect(() => {
    const html = document.documentElement;
    const prevGutter = html.style.scrollbarGutter;
    const prevOverflow = html.style.overflow;
    // The site reserves a scrollbar gutter; the race is full-screen.
    html.style.scrollbarGutter = "auto";
    html.style.overflow = "hidden";
    const cleanups = [
      lockPageOverscroll(),
      () => {
        html.style.scrollbarGutter = prevGutter;
        html.style.overflow = prevOverflow;
      },
    ];
    if (surfaceRef.current) cleanups.push(guardPlaySurface(surfaceRef.current));
    return () => {
      for (const fn of cleanups) fn();
    };
  }, []);

  // ── The race itself ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: RushRenderer;
    let world: RaceWorld;
    let track: RushTrack;
    const ghosts: Array<Ghost | null> = [null, null];
    try {
      track = trackFor(level);
      world = createRace(track, mode, statsFor(look));
      const looks: KartLook[] = [look];
      for (let i = 1; i < world.karts.length; i += 1) {
        const r = RIVALS[world.karts[i]!.id - 1]!;
        looks.push({ body: (["classic", "wedge", "buggy", "bubble"] as const)[r.body]!, wheels: "slick", paint: r.paint, accent: r.accent, helmet: r.helmet, number: i });
      }
      renderer = createRushRenderer(canvas, track, level.theme, looks, mode === "tt" ? [REAL_GHOST_LOOK, look] : []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "This device could not start the 3D view.";
      const id = requestAnimationFrame(() => {
        setError(message);
        changePhase("error");
      });
      return () => cancelAnimationFrame(id);
    }

    let cancelled = false;
    let savedBestMs = 0;
    if (mode === "tt") {
      const saved = loadBest(level.id);
      if (saved) {
        savedBestMs = saved.lapMs;
        ghosts[1] = ghostFromRecording(track, saved.rec, saved.lapMs, "Your best");
      }
      const bundled = bundledRealLap(level.id);
      if (bundled) ghosts[0] = ghostFromRealLap(track, bundled);
      void fetchRealLap(level.id).then((lap) => {
        if (cancelled || !lap) return;
        const g = ghostFromRealLap(track, lap);
        if (g) ghosts[0] = g;
      });
    }

    const input: KartInput = { steer: 0, throttle: 0, brake: 0, drift: false, useItem: false };
    const so: StickInput = { steer: 0, brake: 0, drift: false };
    const ghostHits: TrackHit[] = [
      { i: 0, s: 0, d: 0 },
      { i: 0, s: 0, d: 0 },
    ];
    const ghostPoses: GhostPose[] = [
      { x: 0, y: 0, z: 0, heading: 0 },
      { x: 0, y: 0, z: 0, heading: 0 },
    ];
    const shown: Array<GhostPose | null> = [null, null];
    const view = { world, ghosts: shown, camera: "intro" as CameraMode, cameraT: 0 };
    const lapTimes: number[] = [];
    const accum = new Int32Array(world.karts.length);
    const player = world.karts[0]!;

    // Minimap geometry.
    const map = mapRef.current;
    const mctx = map?.getContext("2d") ?? null;
    let mx0 = Infinity;
    let mx1 = -Infinity;
    let my0 = Infinity;
    let my1 = -Infinity;
    for (let i = 0; i < track.n; i += 1) {
      mx0 = Math.min(mx0, track.px[i]!);
      mx1 = Math.max(mx1, track.px[i]!);
      my0 = Math.min(my0, track.py[i]!);
      my1 = Math.max(my1, track.py[i]!);
    }
    const MAP = 96;
    const mScale = (MAP - 12) / Math.max(mx1 - mx0, my1 - my0);
    const mapX = (x: number) => 6 + (x - mx0) * mScale + (MAP - 12 - (mx1 - mx0) * mScale) / 2;
    const mapY = (y: number) => MAP - 6 - (y - my0) * mScale - (MAP - 12 - (my1 - my0) * mScale) / 2;
    const rivalColors = world.karts.map((k) => (k.id === 0 ? "#ffffff" : RIVALS[k.id - 1]!.paint));

    const drawMap = () => {
      if (!mctx) return;
      mctx.clearRect(0, 0, MAP, MAP);
      mctx.lineJoin = "round";
      mctx.beginPath();
      for (let i = 0; i <= track.n; i += 3) {
        const k = i % track.n;
        if (i === 0) mctx.moveTo(mapX(track.px[k]!), mapY(track.py[k]!));
        else mctx.lineTo(mapX(track.px[k]!), mapY(track.py[k]!));
      }
      mctx.closePath();
      mctx.strokeStyle = "#14151a";
      mctx.lineWidth = 7;
      mctx.stroke();
      mctx.strokeStyle = "#f8f9fa";
      mctx.lineWidth = 3;
      mctx.stroke();
      for (let g = 0; g < shown.length; g += 1) {
        const p = shown[g];
        if (!p) continue;
        mctx.fillStyle = g === 0 ? "#4cc9f0" : "#b388ff";
        mctx.fillRect(Math.round(mapX(p.x)) - 2, Math.round(mapY(p.y)) - 2, 4, 4);
      }
      for (let k = world.karts.length - 1; k >= 0; k -= 1) {
        const kart = world.karts[k]!;
        const x = Math.round(mapX(kart.x));
        const y = Math.round(mapY(kart.y));
        const r = k === 0 ? 4 : 3;
        mctx.fillStyle = "#14151a";
        mctx.fillRect(x - r - 1, y - r - 1, r * 2 + 2, r * 2 + 2);
        mctx.fillStyle = k === 0 ? "#ffd60a" : rivalColors[k]!;
        mctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    };

    const setText = (el: HTMLElement | null, text: string) => {
      if (el && el.textContent !== text) el.textContent = text;
    };
    let flashUntil = 0;
    const flash = (text: string, seconds: number, now: number) => {
      setText(flashEl.current, text);
      flashUntil = now + seconds * 1000;
    };

    // ?auto=1: the kart drives itself (demo and end-to-end tests).
    const auto = new URLSearchParams(window.location.search).get("auto") === "1";
    const readInput = () => {
      if (auto) {
        autopilot(world, input);
        return;
      }
      const k = keys.current;
      const st = stick.current;
      let steer = (k.right ? 1 : 0) - (k.left ? 1 : 0);
      let brake = k.down ? 1 : 0;
      let drift = k.drift;
      let gas = k.up || settingsRef.current.autoGas;
      let item = k.item || nitroHeld.current;
      if (st.id >= 0) {
        stickInput(st.dx, st.dy, player.drifting, so);
        steer = so.steer;
        brake = so.brake;
        drift = so.drift;
        gas = true;
      }
      const pads = typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
      for (const pad of pads) {
        if (!pad || !pad.connected) continue;
        const ax = pad.axes[0] ?? 0;
        if (Math.abs(ax) > 0.15) steer = ax;
        if ((pad.buttons[7]?.value ?? 0) > 0.1 || pad.buttons[0]?.pressed) gas = true;
        if ((pad.buttons[6]?.value ?? 0) > 0.1) brake = 1;
        if (pad.buttons[5]?.pressed || pad.buttons[1]?.pressed) drift = true;
        if (pad.buttons[2]?.pressed || pad.buttons[4]?.pressed) item = true;
        break;
      }
      input.steer = steer;
      input.brake = brake;
      input.throttle = brake > 0 ? 0 : gas ? 1 : 0;
      input.drift = drift;
      input.useItem = item;
    };

    const standingsNow = (): Standing[] =>
      world.karts
        .slice()
        .sort((a, b) => a.place - b.place)
        .map((k) => ({
          place: k.place,
          name: k.id === 0 ? "YOU" : RIVALS[k.id - 1]!.name.toUpperCase(),
          timeMs: k.finished ? k.finishMs : null,
          bestMs: k.bestLapMs,
          you: k.id === 0,
        }));
    let shownFinished = 0;
    const countFinished = () => world.karts.reduce((nDone, k) => nDone + (k.finished ? 1 : 0), 0);

    const finish = (now: number) => {
      const audio = audioRef.current;
      audio?.blip("finish");
      renderer.celebrate();
      const best = lapTimes.length ? Math.min(...lapTimes) : 0;
      let newBest = false;
      if (best > 0 && world.bestRec && (savedBestMs === 0 || best < savedBestMs)) {
        saveBest(level.id, best, world.bestRec);
        newBest = true;
      }
      const ghost = ghosts[0];
      const standings = standingsNow();
      shownFinished = countFinished();
      setResults({ standings, laps: lapTimes.slice(), bestMs: best, newBest, ghostLabel: ghost ? ghost.label : null, ghostMs: ghost ? ghost.lapMs : 0 });
      flash(mode === "gp" ? ORDINAL[player.place - 1]! : "FINISH!", 2.5, now);
      changePhase("finished");
    };

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let phaseT = 0;
    let lastCount = -1;
    let finishedT = 0;
    let booted = false;
    phaseRef.current = "loading";
    setText(flashEl.current, "");

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!booted) {
        booted = true;
        setResults(null);
        changePhase("intro");
      }
      const ph = phaseRef.current;
      const audio = audioRef.current;
      if (ph === "paused" || ph === "error") {
        audio?.update(0, false, false, false, false);
        return;
      }
      phaseT += dt;
      let steps = 0;

      if (ph === "intro") {
        view.camera = "intro";
        view.cameraT = phaseT;
        if (phaseT >= INTRO_S) {
          phaseT = 0;
          changePhase("countdown");
        }
      } else if (ph === "countdown") {
        view.camera = "chase";
        const n = Math.ceil(COUNTDOWN_S - phaseT);
        if (n !== lastCount && n > 0) {
          lastCount = n;
          flash(String(n), 1, now);
          audio?.blip("count");
        }
        if (phaseT >= COUNTDOWN_S) {
          phaseT = 0;
          flash("GO!", 0.9, now);
          audio?.blip("go");
          changePhase("racing");
        }
      } else {
        acc += dt;
        accum.fill(0);
        while (acc >= DT && steps < 6) {
          readInput();
          if (ph === "finished") {
            input.throttle = 0;
            input.drift = false;
            input.useItem = false;
          }
          stepRace(world, input);
          acc -= DT;
          steps += 1;
          for (let k = 0; k < world.karts.length; k += 1) accum[k] = accum[k]! | world.karts[k]!.events;
          const ev = player.events;
          if (ev & EV_LAP) {
            lapTimes.push(player.lastLapMs);
            if (!player.finished) {
              audio?.blip("lap");
              flash(player.lap === world.laps ? "FINAL LAP" : `LAP ${player.lap}`, 1.4, now);
            }
          }
          if (ev & EV_BOOST) audio?.blip("boost");
          if (ev & EV_PICKUP) audio?.blip("pickup");
          if (ev & EV_CHARGE) audio?.blip("charge");
          if (ev & EV_WALL) audio?.blip("wall");
          if (player.finished && phaseRef.current === "racing") finish(now);
        }
        if (steps === 6) acc = 0;
        for (let k = 0; k < world.karts.length; k += 1) world.karts[k]!.events = steps > 0 ? accum[k]! : 0;
        if (phaseRef.current === "finished") {
          // Fill in rivals' times as they take the flag.
          const done = countFinished();
          if (done !== shownFinished) {
            shownFinished = done;
            const standings = standingsNow();
            setResults((r) => (r ? { ...r, standings } : r));
          }
          finishedT += dt;
          view.camera = "orbit";
          view.cameraT = finishedT;
        } else view.camera = "chase";
      }

      // Ghosts run on the player's lap clock.
      const lapMs = player.lap >= 1 && !player.finished ? world.timeMs - player.lapStartMs : -1;
      for (let g = 0; g < 2; g += 1) {
        const ghost = ghosts[g];
        shown[g] = ghost && lapMs >= 0 && ghostPose(ghost, track, lapMs, ghostHits[g]!, ghostPoses[g]!) ? ghostPoses[g]! : null;
        if (lapMs < 300) ghostHits[g]!.i = 0;
      }

      // HUD.
      const racing = phaseRef.current === "racing";
      setText(placeEl.current, mode === "gp" ? ORDINAL[player.place - 1]! : "TRIAL");
      setText(lapEl.current, `LAP ${Math.max(1, Math.min(world.laps, player.lap))}/${world.laps}`);
      setText(timeEl.current, formatRushTime(player.finished ? player.finishMs - 0 : lapMs >= 0 ? lapMs : 0));
      setText(speedEl.current, String(Math.round(Math.abs(player.v) * 3.6)));
      const lead = ghosts[1] ?? ghosts[0];
      if (deltaEl.current) {
        if (mode === "tt" && lead && lapMs > 1500 && racing) {
          const d = (lapMs - lead.timeAtIndex[player.hit.i]!) / 1000;
          setText(deltaEl.current, `${d <= 0 ? "-" : "+"}${Math.abs(d).toFixed(2)}`);
          deltaEl.current.style.color = d <= 0 ? "#70e000" : "#ff6b6b";
        } else setText(deltaEl.current, "");
      }
      if (flashEl.current && flashUntil && now > flashUntil) {
        setText(flashEl.current, "");
        flashUntil = 0;
      }
      if (hintEl.current) hintEl.current.style.opacity = ph === "intro" || ph === "countdown" ? "1" : "0";
      if (wrongEl.current) wrongEl.current.style.opacity = world.wrongWayT > 1 ? "1" : "0";
      if (linesEl.current) linesEl.current.style.opacity = player.boostT > 0 ? "1" : "0";
      if (chargeEl.current) {
        const levels = [0.55, 1.35, 2.4];
        const pct = player.drifting !== 0 ? Math.min(1, player.charge / levels[2]!) : 0;
        chargeEl.current.style.width = `${Math.round(pct * 100)}%`;
        chargeEl.current.style.background = ["#adb5bd", "#4cc9f0", "#ff9f1c", "#c77dff"][player.chargeLevel]!;
      }
      if (nitroEl.current) {
        const pips = nitroEl.current.children;
        for (let i = 0; i < pips.length; i += 1) (pips[i] as HTMLElement).style.opacity = i < player.nitro ? "1" : "0.25";
      }
      if (stickKnob.current) {
        stickKnob.current.style.background = player.drifting !== 0 ? ["#f8f9fa", "#4cc9f0", "#ff9f1c", "#c77dff"][player.chargeLevel]! : "#f8f9fa";
      }
      canvas.dataset.rushPhase = phaseRef.current;
      canvas.dataset.rushTick = String(world.tick);
      canvas.dataset.rushSpeed = Math.abs(player.v).toFixed(2);
      canvas.dataset.rushLap = String(player.lap);
      canvas.dataset.rushDrift = String(player.drifting);

      audio?.update(Math.abs(player.v) / 27, player.drifting !== 0, player.boostT > 0, player.offroad, phaseRef.current !== "finished" || finishedT < 3);
      drawMap();
      renderer.draw(view, dt);
      if (frame0) {
        frame0 = false;
        const s = renderer.size();
        canvas.dataset.rushRes = `${s.w}x${s.h}`;
        canvas.dataset.rushCalls = String(s.calls);
        canvas.dataset.rushTris = String(s.tris);
      }
    };
    let frame0 = true;
    raf = requestAnimationFrame(frame);

    const onResize = () => renderer.resize();
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(canvas);
    const onVisibility = () => {
      if (document.hidden && (phaseRef.current === "racing" || phaseRef.current === "countdown")) changePhase("paused");
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      renderer.dispose();
    };
  }, [level, mode, look, raceKey, changePhase]);

  // ── Keyboard ──
  useEffect(() => {
    const set = (e: KeyboardEvent, down: boolean) => {
      const k = keys.current;
      switch (e.code) {
        case "ArrowLeft":
        case "KeyA":
          k.left = down;
          break;
        case "ArrowRight":
        case "KeyD":
          k.right = down;
          break;
        case "ArrowUp":
        case "KeyW":
          k.up = down;
          break;
        case "ArrowDown":
        case "KeyS":
          k.down = down;
          break;
        case "Space":
        case "ShiftLeft":
        case "ShiftRight":
          k.drift = down;
          break;
        case "KeyE":
        case "KeyX":
          k.item = down;
          break;
        case "Escape":
        case "KeyP":
          if (down && !e.repeat) {
            const ph = phaseRef.current;
            if (ph === "racing" || ph === "countdown" || ph === "intro") changePhase("paused");
            else if (ph === "paused") resume();
          }
          break;
        default:
          return;
      }
      if (down) audioRef.current?.unlock();
      e.preventDefault();
    };
    const down = (e: KeyboardEvent) => set(e, true);
    const up = (e: KeyboardEvent) => set(e, false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [changePhase, resume]);

  // ── Touch / mouse stick ──
  const placeStick = () => {
    const st = stick.current;
    const base = stickBase.current;
    const knob = stickKnob.current;
    if (!base || !knob) return;
    if (st.id < 0) {
      base.style.opacity = "0";
      return;
    }
    base.style.opacity = "1";
    base.style.left = `${st.ox - STICK_RADIUS}px`;
    base.style.top = `${st.oy - STICK_RADIUS}px`;
    const len = Math.hypot(st.dx, st.dy);
    const k = len > STICK_RADIUS ? STICK_RADIUS / len : 1;
    knob.style.transform = `translate(${st.dx * k}px, ${st.dy * k}px)`;
  };
  const onStickDown = (e: React.PointerEvent<HTMLDivElement>) => {
    audioRef.current?.unlock();
    const st = stick.current;
    if (st.id >= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    st.id = e.pointerId;
    st.ox = e.clientX - rect.left;
    st.oy = e.clientY - rect.top;
    st.dx = 0;
    st.dy = 0;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture is a nicety; moves still arrive while the thumb is over the surface.
    }
    placeStick();
  };
  const onStickMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = stick.current;
    if (e.pointerId !== st.id) return;
    const rect = e.currentTarget.getBoundingClientRect();
    st.dx = e.clientX - rect.left - st.ox;
    st.dy = e.clientY - rect.top - st.oy;
    placeStick();
  };
  const onStickUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = stick.current;
    if (e.pointerId !== st.id) return;
    st.id = -1;
    st.dx = 0;
    st.dy = 0;
    placeStick();
  };

  const paused = phase === "paused";
  const showHud = phase !== "loading" && phase !== "error";

  return (
    <div className="rush fixed left-0 top-0 z-50 h-dvh w-screen select-none overflow-hidden bg-[#14151a]" data-rush-race={mode}>
      <canvas ref={canvasRef} data-rush-canvas="1" className="rush-canvas absolute inset-0 h-full w-full" />
      <div ref={linesEl} aria-hidden className="rush-speedlines pointer-events-none absolute inset-0" />

      {/* Play surface: one thumb steers, drifts and brakes. */}
      <div
        ref={surfaceRef}
        data-rush-surface="1"
        className="absolute inset-0 touch-none"
        onPointerDown={onStickDown}
        onPointerMove={onStickMove}
        onPointerUp={onStickUp}
        onPointerCancel={onStickUp}
        onLostPointerCapture={onStickUp}
      >
        <div
          ref={stickBase}
          aria-hidden
          className="rush-stick pointer-events-none absolute opacity-0"
          style={{ width: STICK_RADIUS * 2, height: STICK_RADIUS * 2 }}
        >
          <div ref={stickKnob} className="rush-knob absolute" style={{ left: STICK_RADIUS - 22, top: STICK_RADIUS - 22, width: 38, height: 38 }} />
        </div>
      </div>

      {/* Always mounted (the race loop writes into it); hidden until there is something to show. */}
      <div
        hidden={!showHud}
        className="rush-hud pointer-events-none absolute inset-0 p-3 [padding-top:max(0.75rem,env(safe-area-inset-top))]"
      >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2">
              <button
                type="button"
                data-rush-pause="1"
                aria-label={paused ? "Resume" : "Pause"}
                className="rush-btn rush-btn--ghost pointer-events-auto !min-h-11 !min-w-11 !p-0 text-base"
                onClick={() => {
                  audioRef.current?.unlock();
                  if (phaseRef.current === "paused") resume();
                  else if (phaseRef.current !== "finished") changePhase("paused");
                }}
              >
                {paused ? "▶" : "II"}
              </button>
              <div className="leading-none">
                <span ref={placeEl} data-rush-place="1" className="block text-3xl font-bold text-[#ffd60a] sm:text-4xl" />
                <span ref={lapEl} className="mt-1 block text-sm" />
              </div>
            </div>
            <div className="text-center leading-none">
              <span ref={timeEl} data-rush-time="1" className="block text-xl font-bold tabular-nums sm:text-2xl" />
              <span ref={deltaEl} className="mt-1 block text-base font-bold tabular-nums" />
            </div>
            <canvas ref={mapRef} width={96} height={96} aria-hidden className="rush-canvas h-24 w-24 sm:h-28 sm:w-28" />
          </div>

          <div ref={flashEl} data-rush-flash="1" aria-live="polite" className="rush-flash absolute inset-x-0 top-[26%] text-center" />
          <div
            ref={wrongEl}
            className="absolute inset-x-0 top-[44%] text-center text-2xl font-bold text-[#ff6b6b] opacity-0 transition-opacity"
          >
            WRONG WAY
          </div>
          <div ref={hintEl} className="absolute inset-x-4 top-[56%] text-center text-xs leading-relaxed opacity-0 transition-opacity sm:text-sm">
            {touch ? (
              <>
                DRAG TO STEER · PUSH TO THE EDGE TO DRIFT
                <br />
                LET GO TO BOOST · PULL DOWN TO BRAKE
              </>
            ) : (
              <>
                {settings.autoGas ? "A / D STEER" : "W GAS · A / D STEER"} · HOLD SPACE TO DRIFT
                <br />
                RELEASE TO BOOST · E NITRO · S BRAKE · P PAUSE
              </>
            )}
          </div>

          <div className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-3 [padding-bottom:env(safe-area-inset-bottom)]">
            <div className="leading-none">
              <span ref={speedEl} className="text-4xl font-bold tabular-nums sm:text-5xl" />
              <span className="ml-1 text-xs">KM/H</span>
              <div className="rush-bar mt-2 w-36 sm:w-48" aria-hidden>
                <div ref={chargeEl} data-rush-charge="1" className="h-full w-0" />
              </div>
              <span className="mt-1 block text-[10px]">DRIFT BOOST</span>
            </div>
            <button
              type="button"
              data-rush-nitro="1"
              aria-label="Use nitro"
              className="rush-btn rush-btn--hot pointer-events-auto !h-20 !w-20 flex-col !gap-1 !rounded-full !p-0 text-xs"
              onPointerDown={(e) => {
                e.stopPropagation();
                audioRef.current?.unlock();
                nitroHeld.current = true;
              }}
              onPointerUp={() => (nitroHeld.current = false)}
              onPointerCancel={() => (nitroHeld.current = false)}
              onPointerLeave={() => (nitroHeld.current = false)}
            >
              NITRO
              <div ref={nitroEl} className="flex gap-1" aria-hidden>
                {Array.from({ length: MAX_NITRO }, (_, i) => (
                  <span key={i} className="block h-2.5 w-2.5 bg-[#ffd60a] opacity-25" />
                ))}
              </div>
            </button>
          </div>
      </div>

      {phase === "loading" ? (
        <div className="absolute inset-0 flex items-center justify-center text-lg text-[#ffd60a]">BUILDING TRACK…</div>
      ) : null}

      {phase === "error" ? (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="rush-panel max-w-sm p-5 text-center text-[#f8f9fa]">
            <p className="text-lg font-bold text-[#ffd60a]">CAN&apos;T START</p>
            <p className="mt-2 text-sm">{error || "This device could not start the 3D view."}</p>
            <button type="button" className="rush-btn mt-4" onClick={onExit}>
              Back
            </button>
          </div>
        </div>
      ) : null}

      {paused ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/55 p-4" data-rush-paused="1">
          <div className="rush-panel w-full max-w-xs p-5 text-center text-[#f8f9fa]">
            <p className="text-2xl font-bold text-[#ffd60a]">PAUSED</p>
            <div className="mt-4 flex flex-col gap-3">
              <button type="button" className="rush-btn rush-btn--go" data-rush-resume="1" onClick={resume}>
                Resume
              </button>
              <button type="button" className="rush-btn" onClick={() => setRaceKey((k) => k + 1)}>
                Restart
              </button>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span>SOUND</span>
                <div className="rush-seg" role="group" aria-label="Sound">
                  <button type="button" aria-pressed={!settings.muted} onClick={() => onSettings({ ...settings, muted: false })}>
                    On
                  </button>
                  <button type="button" aria-pressed={settings.muted} onClick={() => onSettings({ ...settings, muted: true })}>
                    Off
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span>AUTO GAS</span>
                <div className="rush-seg" role="group" aria-label="Auto gas">
                  <button type="button" aria-pressed={settings.autoGas} onClick={() => onSettings({ ...settings, autoGas: true })}>
                    On
                  </button>
                  <button type="button" aria-pressed={!settings.autoGas} onClick={() => onSettings({ ...settings, autoGas: false })}>
                    Off
                  </button>
                </div>
              </div>
              <button type="button" className="rush-btn rush-btn--ghost" data-rush-quit="1" onClick={onExit}>
                Quit to menu
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {phase === "finished" && results ? (
        <div className="absolute inset-x-0 bottom-0 flex justify-center p-3 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]" data-rush-results="1">
          <div className="rush-panel w-full max-w-md p-4 text-[#f8f9fa]">
            {mode === "gp" ? (
              <ol className="space-y-1 text-sm">
                {results.standings.map((s) => (
                  <li key={s.name} className={`flex justify-between gap-3 px-2 py-1 ${s.you ? "bg-[#ffd60a] font-bold text-[#14151a]" : ""}`}>
                    <span>
                      {ORDINAL[s.place - 1]} {s.name}
                    </span>
                    <span className="tabular-nums">{s.timeMs ? formatRushTime(s.timeMs) : "…"}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="text-sm">
                <p className="text-lg font-bold text-[#ffd60a]">
                  BEST LAP {formatRushTime(results.bestMs)}
                  {results.newBest ? " · NEW RECORD!" : ""}
                </p>
                <ol className="mt-2 space-y-1">
                  {results.laps.map((ms, i) => (
                    <li key={i} className="flex justify-between px-2 tabular-nums">
                      <span>LAP {i + 1}</span>
                      <span>{formatRushTime(ms)}</span>
                    </li>
                  ))}
                </ol>
                {results.ghostLabel ? (
                  <p className="mt-2 text-xs text-[#4cc9f0]">
                    {results.bestMs > 0 && results.bestMs < results.ghostMs
                      ? `YOU BEAT THE REAL-LAP GHOST BY ${((results.ghostMs - results.bestMs) / 1000).toFixed(2)} S`
                      : `REAL-LAP GHOST: ${formatRushTime(results.ghostMs)}`}{" "}
                    ({results.ghostLabel})
                  </p>
                ) : null}
              </div>
            )}
            <div className="mt-3 flex gap-3">
              <button type="button" className="rush-btn rush-btn--go flex-1" data-rush-again="1" onClick={() => setRaceKey((k) => k + 1)}>
                Again
              </button>
              <button type="button" className="rush-btn rush-btn--ghost flex-1" onClick={onExit}>
                Menu
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
