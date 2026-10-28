"use client";

import { pathLength, toLocalMeters } from "@/lib/drive/coords";
import {
  createDriveAudio,
  loadDriveMuted,
  type DriveAudioHandle,
} from "@/lib/drive/audio";
import {
  getDriveCar,
  loadSelectedCarId,
  type DriveCarId,
  type DriveCarPreset,
} from "@/lib/drive/cars";
import {
  buildSfGate,
  crossedStartFinishRobust,
  LAP_FINISH_COVER_FRAC,
  lapCoverFraction,
} from "@/lib/drive/lap-timing";
import type { SfGate } from "@/lib/drive/lap-timing";
import { spawnAtStart, stepCar, DRIVE_PHYSICS } from "@/lib/drive/physics";
import { projectOnRibbon, ribbonEdges } from "@/lib/drive/ribbon";
import {
  alongFromStart,
  buildSectorSplits,
  formatDeltaMs,
  ghostTimeAtAlong,
  sectorIndexForAlong,
} from "@/lib/drive/sectors";
import {
  loadGameLeaderboard,
  loadPersonalBest,
  loadPlayerGhost,
  sampleGhost,
  savePersonalBest,
  savePlayerGhost,
  submitGameTime,
  type DriveLeaderboardEntry,
} from "@/lib/drive/scores";
import type {
  DriveCameraMode,
  DriveCarState,
  DriveGhostLap,
  DriveInputs,
  DrivePoint,
  DriveTrackPayload,
} from "@/lib/drive/types";
import { useSpeedUnit } from "@/components/useSpeedUnit";
import { formatLapTime, formatSpeed } from "@/lib/format";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

type Props = {
  trackId: string;
  carId?: string;
};

const FIXED_DT = 1 / 60;
const MAX_STEPS = 4;
const RECORD_EVERY_MS = 50;
const COUNTDOWN_MS = 3200;

export function DriveGame({ trackId, carId: carIdProp }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [payload, setPayload] = useState<DriveTrackPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [camera, setCamera] = useState<DriveCameraMode>("chase");
  const [hud, setHud] = useState({
    speedKmh: 0,
    currentMs: 0,
    lastMs: null as number | null,
    bestMs: null as number | null,
    lap: 0,
    onTrack: true,
    sliding: false,
    carPx: 0,
    surface: "asphalt" as string,
    sector: 0,
    deltaMs: null as number | null,
    sectorDeltaMs: null as number | null,
  });
  const [board, setBoard] = useState<DriveLeaderboardEntry[]>([]);
  const [phase, setPhase] = useState<
    "ready" | "countdown" | "racing" | "paused"
  >("ready");
  const [countdownLabel, setCountdownLabel] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState<string | null>(null);
  const [muted, setMuted] = useState(() => loadDriveMuted());
  const [tiltSteer, setTiltSteer] = useState(false);
  const [showRealGhost, setShowRealGhost] = useState(true);
  const [speedUnit] = useSpeedUnit();
  const [carPreset, setCarPreset] = useState<DriveCarPreset>(() =>
    getDriveCar(
      (carIdProp as DriveCarId | undefined) ?? loadSelectedCarId(),
    ),
  );
  const [sessionNonce, setSessionNonce] = useState(0);

  const keysRef = useRef(new Set<string>());
  const touchRef = useRef({ steer: 0, throttle: 0, brake: 0 });
  const padRef = useRef({ steer: 0, throttle: 0, brake: 0 });
  const tiltRef = useRef(0);
  const cameraRef = useRef<DriveCameraMode>("chase");
  const phaseRef = useRef(phase);
  const carPresetRef = useRef(carPreset);
  const showRealGhostRef = useRef(showRealGhost);
  const shoveRef = useRef(0);
  const resetTrackRef = useRef(false);
  const restartRef = useRef(false);
  const audioRef = useRef<DriveAudioHandle | null>(null);

  // Keep car preset in sync when the hub passes ?car=
  const resolvedCarId =
    (carIdProp as DriveCarId | undefined) ?? loadSelectedCarId();
  const resolvedPreset = getDriveCar(resolvedCarId);
  if (carPreset.id !== resolvedPreset.id) {
    setCarPreset(resolvedPreset);
  }
  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    carPresetRef.current = carPreset;
  }, [carPreset]);
  useEffect(() => {
    showRealGhostRef.current = showRealGhost;
  }, [showRealGhost]);

  useEffect(() => {
    const audio = createDriveAudio();
    audioRef.current = audio;
    audio.setMuted(loadDriveMuted());
    return () => {
      audio.dispose();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/tracks/${encodeURIComponent(trackId)}/drive`,
        );
        const data = (await res.json()) as DriveTrackPayload & {
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error || `Failed (${res.status})`);
        }
        if (!cancelled) {
          setPayload(data);
          setBoard(loadGameLeaderboard(trackId));
          setHud((h) => ({
            ...h,
            bestMs: loadPersonalBest(trackId),
          }));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load track");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [trackId]);

  const playing = phase === "racing" || phase === "paused" || phase === "countdown";

  useEffect(() => {
    if (!playing) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const prevent = (e: TouchEvent) => {
      if ((e.target as HTMLElement)?.closest?.("[data-drive-ui]")) return;
      e.preventDefault();
    };
    document.addEventListener("touchmove", prevent, { passive: false });
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("touchmove", prevent);
    };
  }, [playing]);

  // Tilt-to-steer (optional)
  useEffect(() => {
    if (!tiltSteer) {
      tiltRef.current = 0;
      return;
    }
    const onOrient = (e: DeviceOrientationEvent) => {
      // gamma: left/right tilt in portrait; beta fallback for landscape
      const raw =
        typeof e.gamma === "number" && Math.abs(e.gamma) > 1
          ? e.gamma
          : typeof e.beta === "number"
            ? e.beta
            : 0;
      const clamped = Math.max(-1, Math.min(1, raw / 28));
      tiltRef.current = clamped;
    };
    window.addEventListener("deviceorientation", onOrient);
    return () => window.removeEventListener("deviceorientation", onOrient);
  }, [tiltSteer]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keysRef.current.add(e.code);
      if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(
          e.code,
        )
      ) {
        e.preventDefault();
      }
      if (e.code === "KeyC") {
        setCamera((c) => (c === "chase" ? "top" : "chase"));
      }
      if (e.code === "KeyP" || e.code === "Escape") {
        setPhase((p) => {
          if (p === "racing") return "paused";
          if (p === "paused") return "racing";
          return p;
        });
      }
      if (e.code === "KeyM") {
        setMuted((m) => {
          const next = !m;
          audioRef.current?.setMuted(next);
          return next;
        });
      }
      if (e.code === "KeyX") {
        shoveRef.current = 22;
      }
      if (e.code === "KeyR") {
        resetTrackRef.current = true;
      }
    };
    const up = (e: KeyboardEvent) => {
      keysRef.current.delete(e.code);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const readInputs = useCallback((): DriveInputs => {
    const keys = keysRef.current;
    let throttle = touchRef.current.throttle || padRef.current.throttle;
    let brake = touchRef.current.brake || padRef.current.brake;
    let steer = touchRef.current.steer || padRef.current.steer;

    if (keys.has("KeyW") || keys.has("ArrowUp")) throttle = 1;
    if (keys.has("KeyS") || keys.has("ArrowDown") || keys.has("Space"))
      brake = 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) steer = -1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) steer = 1;

    if (Math.abs(tiltRef.current) > 0.08) {
      steer = tiltRef.current;
    }

    const pads =
      typeof navigator !== "undefined" ? navigator.getGamepads?.() : null;
    if (pads) {
      for (const pad of pads) {
        if (!pad) continue;
        const axis = pad.axes[0] ?? 0;
        if (Math.abs(axis) > 0.12) steer = axis;
        const rt = pad.buttons[7]?.value ?? 0;
        const lt = pad.buttons[6]?.value ?? 0;
        if (rt > 0.05) throttle = Math.max(throttle, rt);
        if (lt > 0.05) brake = Math.max(brake, lt);
        if (pad.buttons[0]?.pressed) throttle = 1;
        if (pad.buttons[1]?.pressed || pad.buttons[2]?.pressed) brake = 1;
      }
    }

    return {
      throttle: Math.max(0, Math.min(1, throttle)),
      brake: Math.max(0, Math.min(1, brake)),
      steer: Math.max(-1, Math.min(1, steer)),
    };
  }, []);

  const onLapComplete = useEffectEvent(
    (timeMs: number, samples: DrivePoint[]) => {
      const isPb = savePersonalBest(trackId, timeMs);
      if (isPb) savePlayerGhost(trackId, timeMs, samples);
      const nextBoard = submitGameTime(
        trackId,
        timeMs,
        "You",
        carPresetRef.current.id,
      );
      setBoard(nextBoard);
      setHud((h) => ({
        ...h,
        lastMs: timeMs,
        bestMs: h.bestMs == null || timeMs < h.bestMs ? timeMs : h.bestMs,
        lap: h.lap + 1,
        currentMs: 0,
        deltaMs: null,
        sectorDeltaMs: null,
      }));
      setCelebrate(
        isPb
          ? `New PB! ${formatLapTime(timeMs)}`
          : `Lap ${formatLapTime(timeMs)}`,
      );
      window.setTimeout(() => setCelebrate(null), 1800);
    },
  );

  const beginCountdown = useCallback(() => {
    audioRef.current?.resume();
    audioRef.current?.setMuted(muted);
    setCelebrate(null);
    setPhase("countdown");
    setCountdownLabel("3");
    const t0 = performance.now();
    const tick = () => {
      const elapsed = performance.now() - t0;
      if (elapsed < 900) setCountdownLabel("3");
      else if (elapsed < 1800) setCountdownLabel("2");
      else if (elapsed < 2700) setCountdownLabel("1");
      else if (elapsed < COUNTDOWN_MS) setCountdownLabel("GO");
      else {
        setCountdownLabel(null);
        setSessionNonce((n) => n + 1);
        setPhase("racing");
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [muted]);

  const requestRestart = useCallback(() => {
    restartRef.current = true;
    setCelebrate(null);
    setPhase("countdown");
    setCountdownLabel("3");
    const t0 = performance.now();
    const tick = () => {
      const elapsed = performance.now() - t0;
      if (elapsed < 900) setCountdownLabel("3");
      else if (elapsed < 1800) setCountdownLabel("2");
      else if (elapsed < 2700) setCountdownLabel("1");
      else if (elapsed < COUNTDOWN_MS) setCountdownLabel("GO");
      else {
        setCountdownLabel(null);
        setSessionNonce((n) => n + 1);
        setPhase("racing");
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, []);

  const simLive = phase !== "ready";

  // Main loop
  useEffect(() => {
    if (!payload || !simLive) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!ctx) return;

    const centerline = payload.centerline;
    const halfW = payload.halfWidthM;
    const edges = ribbonEdges(centerline, halfW);
    const curbInner = ribbonEdges(
      centerline,
      halfW * DRIVE_PHYSICS.curbStartFrac,
    );
    const grass = ribbonEdges(centerline, halfW + 14);
    const gate: SfGate = buildSfGate(payload.origin, payload.startFinish, 16);
    const sfLocal = toLocalMeters(payload.origin, {
      lat: payload.startFinish.lat,
      lon: payload.startFinish.lon,
    });
    const trackLenM = Math.max(1, pathLength(centerline));
    const sectorSplits = buildSectorSplits(centerline);

    let car: DriveCarState = spawnAtStart(
      centerline,
      sfLocal,
      gate.travelHeading,
    );
    let prevPos: DrivePoint = { x: car.x, y: car.y };
    let lapStartPerf = performance.now();
    let pausedAt: number | null = null;
    let pausedAccum = 0;
    let armed = false;
    let leaveTimer = 0;
    let lapStartAlong = projectOnRibbon(centerline, car.x, car.y).along;
    let maxCover = 0;
    let acc = 0;
    let last = performance.now();
    let raf = 0;
    let recordBuf: DrivePoint[] = [];
    let lastRecord = 0;
    let hudTick = 0;
    let lastHudMs = 0;
    let sectorMarks = [0, 0, 0];
    let waitingForGo = phaseRef.current === "countdown";

    const playerGhost: DriveGhostLap | null = loadPlayerGhost(trackId);
    const realGhost = payload.realGhost;

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const p of grass.left.concat(grass.right)) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const worldPad = 40;

    function resize() {
      const wrap = wrapRef.current;
      if (!wrap || !canvas) return;
      // Cap DPR on phones for stable 60fps.
      const coarse =
        typeof window !== "undefined" &&
        window.matchMedia?.("(pointer: coarse)")?.matches;
      const dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const ro = new ResizeObserver(resize);
    if (wrapRef.current) ro.observe(wrapRef.current);

    function resetLapState(spawn = true) {
      if (spawn) {
        car = spawnAtStart(centerline, sfLocal, gate.travelHeading);
        prevPos = { x: car.x, y: car.y };
      }
      lapStartPerf = performance.now();
      pausedAt = null;
      pausedAccum = 0;
      armed = false;
      leaveTimer = 0;
      lapStartAlong = projectOnRibbon(centerline, car.x, car.y).along;
      maxCover = 0;
      recordBuf = [];
      lastRecord = 0;
      lastHudMs = 0;
      sectorMarks = [0, 0, 0];
      setHud((h) => ({
        ...h,
        currentMs: 0,
        deltaMs: null,
        sectorDeltaMs: null,
        sector: 0,
      }));
    }

    function drawCar(
      c: CanvasRenderingContext2D,
      x: number,
      y: number,
      heading: number,
      color: string,
      scale: number,
    ) {
      c.save();
      c.translate(x, y);
      c.rotate(heading);
      const pxPerM = Math.max(scale, 0.001);
      const L = Math.max(56, 11 * pxPerM);
      const W = Math.max(30, 5.2 * pxPerM);
      c.fillStyle = color;
      c.strokeStyle = "#09090b";
      c.lineWidth = Math.max(2, L * 0.07);
      c.beginPath();
      c.moveTo(0, -L * 0.58);
      c.lineTo(W * 0.52, L * 0.4);
      c.lineTo(W * 0.2, L * 0.26);
      c.lineTo(-W * 0.2, L * 0.26);
      c.lineTo(-W * 0.52, L * 0.4);
      c.closePath();
      c.fill();
      c.stroke();
      c.fillStyle = "rgba(9,9,11,0.4)";
      c.beginPath();
      c.moveTo(0, -L * 0.18);
      c.lineTo(W * 0.24, L * 0.02);
      c.lineTo(-W * 0.24, L * 0.02);
      c.closePath();
      c.fill();
      c.strokeStyle = "#fafafa";
      c.lineWidth = Math.max(1.5, L * 0.04);
      c.beginPath();
      c.moveTo(0, -L * 0.5);
      c.lineTo(0, -L * 0.15);
      c.stroke();
      c.restore();
    }

    function drawMinimap(
      c: CanvasRenderingContext2D,
      viewW: number,
      viewH: number,
      carX: number,
      carY: number,
      carHeading: number,
    ) {
      const size = Math.max(96, Math.min(148, Math.floor(viewW * 0.22)));
      const pad = 10;
      const left = viewW - size - pad;
      const top = pad + (viewW < 640 ? 58 : 8);
      const bw = maxX - minX + worldPad * 2;
      const bh = maxY - minY + worldPad * 2;
      const scale = (size * 0.86) / Math.max(bw, bh);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const toMini = (px: number, py: number) => ({
        x: left + size / 2 + (px - cx) * scale,
        y: top + size / 2 - (py - cy) * scale,
      });

      c.save();
      c.fillStyle = "rgba(9,9,11,0.72)";
      c.strokeStyle = "rgba(250,250,250,0.2)";
      c.lineWidth = 1;
      c.beginPath();
      const rr = 10;
      c.moveTo(left + rr, top);
      c.arcTo(left + size, top, left + size, top + size, rr);
      c.arcTo(left + size, top + size, left, top + size, rr);
      c.arcTo(left, top + size, left, top, rr);
      c.arcTo(left, top, left + size, top, rr);
      c.closePath();
      c.fill();
      c.stroke();

      c.fillStyle = "#2f6b38";
      c.beginPath();
      for (let i = 0; i < grass.left.length; i += 1) {
        const s = toMini(grass.left[i]!.x, grass.left[i]!.y);
        if (i === 0) c.moveTo(s.x, s.y);
        else c.lineTo(s.x, s.y);
      }
      for (let i = grass.right.length - 1; i >= 0; i -= 1) {
        const s = toMini(grass.right[i]!.x, grass.right[i]!.y);
        c.lineTo(s.x, s.y);
      }
      c.closePath();
      c.fill();

      c.fillStyle = "#52525b";
      c.beginPath();
      for (let i = 0; i < edges.left.length; i += 1) {
        const s = toMini(edges.left[i]!.x, edges.left[i]!.y);
        if (i === 0) c.moveTo(s.x, s.y);
        else c.lineTo(s.x, s.y);
      }
      for (let i = edges.right.length - 1; i >= 0; i -= 1) {
        const s = toMini(edges.right[i]!.x, edges.right[i]!.y);
        c.lineTo(s.x, s.y);
      }
      c.closePath();
      c.fill();

      c.strokeStyle = "rgba(250,250,250,0.55)";
      c.lineWidth = 1.25;
      c.beginPath();
      for (let i = 0; i < centerline.length; i += 1) {
        const s = toMini(centerline[i]!.x, centerline[i]!.y);
        if (i === 0) c.moveTo(s.x, s.y);
        else c.lineTo(s.x, s.y);
      }
      c.stroke();

      const g0 = toMini(
        gate.mid.x - gate.gateX * gate.halfWidthM,
        gate.mid.y - gate.gateY * gate.halfWidthM,
      );
      const g1 = toMini(
        gate.mid.x + gate.gateX * gate.halfWidthM,
        gate.mid.y + gate.gateY * gate.halfWidthM,
      );
      c.strokeStyle = "#fafafa";
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(g0.x, g0.y);
      c.lineTo(g1.x, g1.y);
      c.stroke();

      const me = toMini(carX, carY);
      c.save();
      c.translate(me.x, me.y);
      c.rotate(carHeading);
      c.fillStyle = carPresetRef.current.color;
      c.beginPath();
      c.moveTo(0, -7);
      c.lineTo(4.5, 5.5);
      c.lineTo(-4.5, 5.5);
      c.closePath();
      c.fill();
      c.restore();
      c.restore();
    }

    function worldToScreen(
      mode: DriveCameraMode,
      viewW: number,
      viewH: number,
      px: number,
      py: number,
      camX: number,
      camY: number,
      camHeading: number,
    ): { x: number; y: number; scale: number } {
      if (mode === "top") {
        const bw = maxX - minX + worldPad * 2;
        const bh = maxY - minY + worldPad * 2;
        const scale = Math.min(viewW / bw, viewH / bh) * 0.92;
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        return {
          x: viewW / 2 + (px - cx) * scale,
          y: viewH / 2 - (py - cy) * scale,
          scale,
        };
      }
      const scale = Math.min(viewW, viewH) / 95;
      const dx = px - camX;
      const dy = py - camY;
      const cos = Math.cos(camHeading);
      const sin = Math.sin(camHeading);
      const rx = dx * cos - dy * sin;
      const ry = dx * sin + dy * cos;
      return {
        x: viewW / 2 + rx * scale,
        y: viewH * 0.62 - ry * scale,
        scale,
      };
    }

    function strokePoly(
      c: CanvasRenderingContext2D,
      pts: DrivePoint[],
      mode: DriveCameraMode,
      viewW: number,
      viewH: number,
      camX: number,
      camY: number,
      camH: number,
      close: boolean,
    ) {
      if (!pts.length) return;
      c.beginPath();
      for (let i = 0; i < pts.length; i += 1) {
        const s = worldToScreen(
          mode,
          viewW,
          viewH,
          pts[i]!.x,
          pts[i]!.y,
          camX,
          camY,
          camH,
        );
        if (i === 0) c.moveTo(s.x, s.y);
        else c.lineTo(s.x, s.y);
      }
      if (close) c.closePath();
    }

    function fillRibbon(
      c: CanvasRenderingContext2D,
      left: DrivePoint[],
      right: DrivePoint[],
      mode: DriveCameraMode,
      viewW: number,
      viewH: number,
      camX: number,
      camY: number,
      camH: number,
      fill: string,
    ) {
      c.fillStyle = fill;
      c.beginPath();
      for (let i = 0; i < left.length; i += 1) {
        const s = worldToScreen(
          mode,
          viewW,
          viewH,
          left[i]!.x,
          left[i]!.y,
          camX,
          camY,
          camH,
        );
        if (i === 0) c.moveTo(s.x, s.y);
        else c.lineTo(s.x, s.y);
      }
      for (let i = right.length - 1; i >= 0; i -= 1) {
        const s = worldToScreen(
          mode,
          viewW,
          viewH,
          right[i]!.x,
          right[i]!.y,
          camX,
          camY,
          camH,
        );
        c.lineTo(s.x, s.y);
      }
      c.closePath();
      c.fill();
    }

    function frame(now: number) {
      raf = requestAnimationFrame(frame);
      const viewW = canvas!.clientWidth;
      const viewH = canvas!.clientHeight;
      const dtWall = Math.min(0.05, (now - last) / 1000);
      last = now;

      const ph = phaseRef.current;
      waitingForGo = ph === "countdown";
      const paused = ph === "paused" || waitingForGo;

      if (ph === "paused" || waitingForGo) {
        if (pausedAt == null) pausedAt = now;
      } else if (pausedAt != null) {
        pausedAccum += now - pausedAt;
        pausedAt = null;
      }

      if (restartRef.current) {
        restartRef.current = false;
        resetLapState(true);
      }

      const lapElapsedNow = () =>
        performance.now() -
        lapStartPerf -
        pausedAccum -
        (pausedAt != null ? now - pausedAt : 0);

      if (!paused && ph === "racing") {
        acc += dtWall;
        let steps = 0;
        while (acc >= FIXED_DT && steps < MAX_STEPS) {
          const inputs = readInputs();
          const stepped = stepCar(
            car,
            inputs,
            FIXED_DT,
            centerline,
            halfW,
            { carPreset: carPresetRef.current },
          );
          car = stepped.car;
          if (shoveRef.current !== 0) {
            const lat = shoveRef.current;
            shoveRef.current = 0;
            const lx = Math.cos(car.heading);
            const ly = -Math.sin(car.heading);
            car = {
              ...car,
              x: car.x + lx * lat,
              y: car.y + ly * lat,
              onTrack: false,
              surface: "grass",
              speed: Math.min(car.speed, 8),
            };
          }
          if (resetTrackRef.current) {
            resetTrackRef.current = false;
            const hit = projectOnRibbon(centerline, car.x, car.y);
            const seg = centerline[hit.segIndex]!;
            const next =
              centerline[Math.min(centerline.length - 1, hit.segIndex + 1)]!;
            const dx = next.x - seg.x;
            const dy = next.y - seg.y;
            const len = Math.hypot(dx, dy) || 1;
            const t = Math.max(
              0,
              Math.min(
                1,
                ((car.x - seg.x) * dx + (car.y - seg.y) * dy) / (len * len),
              ),
            );
            car = {
              ...car,
              x: seg.x + (dx / len) * (t * len),
              y: seg.y + (dy / len) * (t * len),
              heading: hit.pathHeading || Math.atan2(dx, dy),
              speed: Math.max(Math.abs(car.speed), 6),
              slip: 0,
              onTrack: true,
              surface: "asphalt",
            };
          }
          const nextPos = { x: car.x, y: car.y };

          leaveTimer += FIXED_DT;
          const alongHit = projectOnRibbon(centerline, car.x, car.y);
          maxCover = Math.max(
            maxCover,
            lapCoverFraction(alongHit.along, lapStartAlong, trackLenM),
          );
          if (!armed && leaveTimer > 1.2) {
            const dist = Math.hypot(car.x - sfLocal.x, car.y - sfLocal.y);
            if (dist > 35 && maxCover > 0.08) armed = true;
          }

          if (
            armed &&
            maxCover >= LAP_FINISH_COVER_FRAC &&
            crossedStartFinishRobust(gate, prevPos, nextPos)
          ) {
            const timeMs = lapElapsedNow();
            if (timeMs > 8_000) {
              onLapComplete(timeMs, recordBuf);
              resetLapState(false);
              lapStartAlong = alongHit.along;
            }
          }
          prevPos = nextPos;

          const elapsed = lapElapsedNow();
          if (elapsed - lastRecord >= RECORD_EVERY_MS) {
            recordBuf.push({ x: car.x, y: car.y, t: elapsed });
            lastRecord = elapsed;
          }

          acc -= FIXED_DT;
          steps += 1;
        }
      }

      const mode = cameraRef.current;
      ctx!.fillStyle = "#16351a";
      ctx!.fillRect(0, 0, viewW, viewH);

      fillRibbon(
        ctx!,
        grass.left,
        grass.right,
        mode,
        viewW,
        viewH,
        car.x,
        car.y,
        car.heading,
        "#2f6b38",
      );
      // Outer asphalt including curb band
      fillRibbon(
        ctx!,
        edges.left,
        edges.right,
        mode,
        viewW,
        viewH,
        car.x,
        car.y,
        car.heading,
        "#6b5a3e",
      );
      // Inner asphalt
      fillRibbon(
        ctx!,
        curbInner.left,
        curbInner.right,
        mode,
        viewW,
        viewH,
        car.x,
        car.y,
        car.heading,
        "#3f3f46",
      );

      ctx!.strokeStyle = "rgba(250,250,250,0.35)";
      ctx!.lineWidth = 1.5;
      ctx!.setLineDash([8, 10]);
      strokePoly(
        ctx!,
        centerline,
        mode,
        viewW,
        viewH,
        car.x,
        car.y,
        car.heading,
        false,
      );
      ctx!.stroke();
      ctx!.setLineDash([]);

      const gateLen = gate.halfWidthM;
      const g0 = {
        x: gate.mid.x - gate.gateX * gateLen,
        y: gate.mid.y - gate.gateY * gateLen,
      };
      const g1 = {
        x: gate.mid.x + gate.gateX * gateLen,
        y: gate.mid.y + gate.gateY * gateLen,
      };
      ctx!.strokeStyle = "#fafafa";
      ctx!.lineWidth = 3;
      strokePoly(
        ctx!,
        [g0, g1],
        mode,
        viewW,
        viewH,
        car.x,
        car.y,
        car.heading,
        false,
      );
      ctx!.stroke();
      ctx!.strokeStyle = "#f97316";
      ctx!.lineWidth = 2;
      strokePoly(
        ctx!,
        [g0, g1],
        mode,
        viewW,
        viewH,
        car.x,
        car.y,
        car.heading,
        false,
      );
      ctx!.stroke();

      const lapElapsed = waitingForGo || ph === "countdown" ? 0 : lapElapsedNow();

      const ghosts: Array<{ g: DriveGhostLap; color: string }> = [];
      if (playerGhost)
        ghosts.push({ g: playerGhost, color: "rgba(56,189,248,0.85)" });
      if (showRealGhostRef.current && realGhost)
        ghosts.push({ g: realGhost, color: "rgba(250,204,21,0.8)" });
      for (const { g, color } of ghosts) {
        const sample = sampleGhost(g, Math.min(lapElapsed, g.timeMs));
        if (!sample) continue;
        const s = worldToScreen(
          mode,
          viewW,
          viewH,
          sample.x,
          sample.y,
          car.x,
          car.y,
          car.heading,
        );
        const look = sampleGhost(g, Math.min(lapElapsed + 120, g.timeMs));
        let gh = car.heading;
        if (look) gh = Math.atan2(look.x - sample.x, look.y - sample.y);
        drawCar(
          ctx!,
          s.x,
          s.y,
          mode === "chase" ? gh - car.heading : gh,
          color,
          s.scale,
        );
      }

      const me = worldToScreen(
        mode,
        viewW,
        viewH,
        car.x,
        car.y,
        car.x,
        car.y,
        car.heading,
      );
      const carScale = me.scale;
      const carLenPx = Math.max(56, 11 * Math.max(carScale, 0.001));
      drawCar(
        ctx!,
        me.x,
        me.y,
        mode === "chase" ? 0 : car.heading,
        car.onTrack ? carPresetRef.current.color : "#a1a1aa",
        carScale,
      );

      drawMinimap(ctx!, viewW, viewH, car.x, car.y, car.heading);

      const inputsNow = readInputs();
      audioRef.current?.tick({
        speed: car.speed,
        maxSpeed: DRIVE_PHYSICS.maxSpeedOn * carPresetRef.current.topSpeed,
        throttle: inputsNow.throttle,
        brake: inputsNow.brake,
        slip: car.slip,
        onTrack: !!car.onTrack,
        onCurb: car.surface === "curb",
        paused: paused || ph !== "racing",
      });

      hudTick += dtWall;
      if (hudTick > 0.1) {
        hudTick = 0;
        const displayMs =
          lapElapsed + 40 >= lastHudMs ? lapElapsed : lastHudMs;
        lastHudMs = displayMs;
        const alongHit = projectOnRibbon(centerline, car.x, car.y);
        const alongFrom = alongFromStart(
          alongHit.along,
          lapStartAlong,
          trackLenM,
        );
        const sector = sectorIndexForAlong(
          alongHit.along,
          lapStartAlong,
          trackLenM,
          sectorSplits,
        );
        sectorMarks[sector] = displayMs;

        let deltaMs: number | null = null;
        let sectorDeltaMs: number | null = null;
        const refGhost = playerGhost;
        if (refGhost && displayMs > 500) {
          const ghostT = ghostTimeAtAlong(
            refGhost,
            centerline,
            // Ghost was recorded from its own start; approximate using first sample along.
            (() => {
              const s0 = refGhost.samples[0]!;
              return projectOnRibbon(centerline, s0.x, s0.y).along;
            })(),
            alongFrom,
            (x, y) => projectOnRibbon(centerline, x, y).along,
          );
          if (ghostT != null) deltaMs = displayMs - ghostT;
          const sectorEnd = sectorSplits[sector]!.endAlongM;
          const ghostSectorT = ghostTimeAtAlong(
            refGhost,
            centerline,
            (() => {
              const s0 = refGhost.samples[0]!;
              return projectOnRibbon(centerline, s0.x, s0.y).along;
            })(),
            Math.min(alongFrom, sectorEnd),
            (x, y) => projectOnRibbon(centerline, x, y).along,
          );
          if (ghostSectorT != null) sectorDeltaMs = displayMs - ghostSectorT;
        }

        setHud((h) => ({
          ...h,
          speedKmh: Math.abs(car.speed) * 3.6,
          currentMs: displayMs,
          onTrack: car.onTrack,
          sliding: Math.abs(car.slip) > 0.55,
          carPx: carLenPx,
          surface: car.surface ?? (car.onTrack ? "asphalt" : "grass"),
          sector,
          deltaMs,
          sectorDeltaMs,
        }));
      }
    }

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // onLapComplete is useEffectEvent; phase gated via simLive + phaseRef
     
  }, [payload, simLive, trackId, readInputs, sessionNonce]);

  const onSteerTouch = (
    e: React.TouchEvent<HTMLDivElement>,
    end = false,
  ) => {
    e.preventDefault();
    if (end) {
      touchRef.current.steer = 0;
      return;
    }
    const touch = e.changedTouches[0] ?? e.touches[0];
    if (!touch) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (touch.clientX - rect.left) / rect.width;
    touchRef.current.steer = Math.max(-1, Math.min(1, (x - 0.5) * 2));
  };

  const enableTilt = async () => {
    const doe = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<string>;
    };
    try {
      if (typeof doe.requestPermission === "function") {
        const res = await doe.requestPermission();
        if (res !== "granted") return;
      }
      setTiltSteer(true);
    } catch {
      setTiltSteer(true);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-zinc-400">
        Loading track…
      </div>
    );
  }

  if (error || !payload) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-4 px-4 py-10 text-center">
        <div className="w-full rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-6">
          <p className="text-[11px] uppercase tracking-[0.2em] text-amber-300/90">
            Unknown track
          </p>
          <p className="mt-2 text-base font-medium text-zinc-100">
            {error ?? "This track has no driveable GPS path yet."}
          </p>
          <p className="mt-2 text-sm text-zinc-400">
            Pick a circuit with a saved centerline or a public session GPS
            ribbon.
          </p>
        </div>
        <Link href="/drive" className="apex-btn apex-btn--accent inline-flex">
          Pick another track
        </Link>
      </div>
    );
  }

  const deltaColor =
    hud.deltaMs == null
      ? "text-zinc-400"
      : hud.deltaMs <= 0
        ? "text-emerald-400"
        : "text-rose-400";

  return (
    <div className="relative flex min-h-[100dvh] flex-col bg-zinc-950">
      <div
        data-drive-ui
        className="z-10 flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 bg-zinc-950/90 px-3 py-2 backdrop-blur"
      >
        <div className="min-w-0">
          <Link
            href={`/tracks/${trackId}`}
            className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 hover:text-zinc-300"
          >
            {payload.name}
          </Link>
          <p className="truncate text-sm text-zinc-200">
            Drive · {carPreset.name}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className="apex-btn apex-btn--ghost text-xs"
            onClick={() => setCamera((c) => (c === "chase" ? "top" : "chase"))}
          >
            Cam: {camera === "chase" ? "Chase" : "Top"}
          </button>
          <button
            type="button"
            className="apex-btn apex-btn--ghost text-xs"
            data-apex-drive-mute={muted ? "1" : "0"}
            onClick={() => {
              setMuted((m) => {
                const next = !m;
                audioRef.current?.setMuted(next);
                return next;
              });
            }}
          >
            {muted ? "Unmute" : "Mute"}
          </button>
          {phase !== "ready" ? (
            <>
              <button
                type="button"
                className="apex-btn apex-btn--ghost text-xs"
                onClick={() =>
                  setPhase((p) =>
                    p === "paused"
                      ? "racing"
                      : p === "racing"
                        ? "paused"
                        : p,
                  )
                }
              >
                {phase === "paused" ? "Resume" : "Pause"}
              </button>
              <button
                type="button"
                className="apex-btn apex-btn--ghost text-xs"
                data-apex-drive-restart="1"
                onClick={() => {
                  audioRef.current?.resume();
                  requestRestart();
                }}
              >
                Restart
              </button>
              <button
                type="button"
                className="apex-btn apex-btn--ghost text-xs"
                data-apex-drive-reset="1"
                onClick={() => {
                  resetTrackRef.current = true;
                }}
              >
                Return to track
              </button>
            </>
          ) : null}
          <Link href="/drive" className="apex-btn apex-btn--ghost text-xs">
            Exit
          </Link>
        </div>
      </div>

      <div ref={wrapRef} className="relative min-h-0 flex-1 touch-none">
        <canvas
          ref={canvasRef}
          className="block h-full w-full touch-none"
          style={{ touchAction: "none" }}
        />

        {phase === "ready" ? (
          <div
            data-drive-ui
            className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-zinc-950/75 px-5 text-center backdrop-blur-sm"
          >
            <p className="max-w-md text-base leading-relaxed text-zinc-100 sm:text-lg">
              Arcade drive on a real GPS ribbon
              {payload.source === "session_gps"
                ? " from a session at this track"
                : payload.source === "centerline"
                  ? " from the saved centerline"
                  : " (builtin layout)"}
              .
            </p>
            <p className="max-w-md text-sm leading-relaxed text-zinc-300">
              Ghosts: your PB (blue)
              {payload.realGhost ? ", optional real lap (yellow)" : ""}.
              Sectors + live delta vs PB. WASD / arrows · pads · tilt · C
              camera · P pause · M mute · R return. Game times stay off real
              leaderboards.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                className={`apex-btn text-xs ${
                  tiltSteer ? "apex-btn--accent" : "apex-btn--ghost"
                }`}
                onClick={() => {
                  if (tiltSteer) setTiltSteer(false);
                  else void enableTilt();
                }}
              >
                {tiltSteer ? "Tilt steer on" : "Tilt to steer"}
              </button>
              {payload.realGhost ? (
                <button
                  type="button"
                  className={`apex-btn text-xs ${
                    showRealGhost ? "apex-btn--accent" : "apex-btn--ghost"
                  }`}
                  onClick={() => setShowRealGhost((v) => !v)}
                >
                  Real ghost {showRealGhost ? "on" : "off"}
                </button>
              ) : null}
            </div>
            <button
              type="button"
              className="apex-btn apex-btn--accent min-h-12 px-8 text-base"
              data-apex-drive-start="1"
              onClick={() => beginCountdown()}
            >
              Start driving
            </button>
          </div>
        ) : null}

        {countdownLabel ? (
          <div
            data-drive-ui
            data-apex-drive-countdown={countdownLabel}
            className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
          >
            <p className="text-7xl font-semibold tracking-tight text-orange-400 drop-shadow-[0_4px_24px_rgba(0,0,0,0.65)] sm:text-8xl">
              {countdownLabel}
            </p>
          </div>
        ) : null}

        {celebrate ? (
          <div
            data-drive-ui
            data-apex-drive-celebrate="1"
            className="pointer-events-none absolute inset-x-0 top-1/3 z-20 flex justify-center px-4"
          >
            <p className="rounded-2xl bg-zinc-950/80 px-5 py-3 text-lg font-semibold text-orange-300 backdrop-blur sm:text-xl">
              {celebrate}
            </p>
          </div>
        ) : null}

        {phase === "paused" ? (
          <div
            data-drive-ui
            className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-zinc-950/60 backdrop-blur-[2px]"
          >
            <p className="text-2xl font-semibold text-zinc-50">Paused</p>
            <div className="flex gap-2">
              <button
                type="button"
                className="apex-btn apex-btn--accent"
                onClick={() => setPhase("racing")}
              >
                Resume
              </button>
              <button
                type="button"
                className="apex-btn apex-btn--ghost"
                onClick={() => requestRestart()}
              >
                Restart
              </button>
            </div>
          </div>
        ) : null}

        {phase !== "ready" ? (
          <div
            data-drive-ui
            className="pointer-events-none absolute left-0 top-0 z-10 flex max-w-[min(100%,240px)] flex-col gap-1.5 p-2 sm:p-3"
          >
            <div
              className="rounded-lg bg-zinc-950/55 px-2.5 py-1.5 font-mono text-xs text-zinc-100 backdrop-blur"
              data-apex-drive-lap
              data-apex-drive-lap-ms={Math.round(hud.currentMs)}
              data-apex-drive-lap-n={Math.max(1, hud.lap + 1)}
            >
              <div>Lap {Math.max(1, hud.lap + 1)}</div>
              <div className="text-base text-orange-400">
                {formatLapTime(hud.currentMs)}
              </div>
              <div className={`text-[10px] ${deltaColor}`}>
                Δ PB{" "}
                {hud.deltaMs != null ? formatDeltaMs(hud.deltaMs) : "—"} · S
                {hud.sector + 1}{" "}
                {hud.sectorDeltaMs != null
                  ? formatDeltaMs(hud.sectorDeltaMs)
                  : ""}
              </div>
              <div className="text-[10px] text-zinc-400">
                Last {hud.lastMs != null ? formatLapTime(hud.lastMs) : "—"} ·
                Best {hud.bestMs != null ? formatLapTime(hud.bestMs) : "—"}
              </div>
            </div>
            <div
              className="rounded-lg bg-zinc-950/55 px-2.5 py-1.5 font-mono text-xs text-zinc-100 backdrop-blur"
              data-apex-drive-speed
              data-apex-drive-mph={(hud.speedKmh / 1.60934).toFixed(1)}
              data-apex-drive-on-track={hud.onTrack ? "1" : "0"}
              data-apex-drive-car-px={hud.carPx.toFixed(0)}
              data-apex-drive-surface={hud.surface}
            >
              <div className="text-base">
                {formatSpeed(hud.speedKmh, speedUnit, 0)}
              </div>
              <div
                className={`text-[10px] ${
                  hud.surface === "grass"
                    ? "text-amber-400"
                    : hud.surface === "curb"
                      ? "text-sky-300"
                      : hud.sliding
                        ? "text-orange-300"
                        : "text-emerald-400"
                }`}
              >
                {hud.surface === "grass"
                  ? "Grass"
                  : hud.surface === "curb"
                    ? "Rumble"
                    : hud.sliding
                      ? "Slide"
                      : "On track"}
              </div>
            </div>
          </div>
        ) : null}

        {phase === "racing" || phase === "paused" || phase === "countdown" ? (
          <div
            data-drive-ui
            className="absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-2 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-3"
          >
            {!tiltSteer ? (
              <div
                className="h-12 w-[30%] max-w-[110px] touch-none rounded-xl border border-white/10 bg-zinc-900/25 sm:h-14 sm:max-w-[140px]"
                onTouchStart={(e) => onSteerTouch(e)}
                onTouchMove={(e) => onSteerTouch(e)}
                onTouchEnd={(e) => onSteerTouch(e, true)}
                onTouchCancel={(e) => onSteerTouch(e, true)}
                aria-label="Steering"
              >
                <p className="pointer-events-none pt-1 text-center text-[9px] uppercase tracking-[0.16em] text-zinc-300/70">
                  Steer
                </p>
              </div>
            ) : (
              <div className="h-12 w-[30%] max-w-[110px] rounded-xl border border-white/5 bg-zinc-900/15 sm:h-14">
                <p className="pointer-events-none pt-1 text-center text-[9px] uppercase tracking-[0.16em] text-zinc-400/80">
                  Tilt
                </p>
              </div>
            )}
            <div className="flex gap-1.5">
              <button
                type="button"
                className="h-12 w-12 touch-none rounded-xl border border-white/10 bg-zinc-900/30 text-[11px] text-zinc-100 sm:h-14 sm:w-14"
                style={{ touchAction: "none" }}
                onTouchStart={(e) => {
                  e.preventDefault();
                  touchRef.current.brake = 1;
                }}
                onTouchEnd={() => {
                  touchRef.current.brake = 0;
                }}
                onTouchCancel={() => {
                  touchRef.current.brake = 0;
                }}
                onMouseDown={() => {
                  touchRef.current.brake = 1;
                }}
                onMouseUp={() => {
                  touchRef.current.brake = 0;
                }}
                onMouseLeave={() => {
                  touchRef.current.brake = 0;
                }}
              >
                Brake
              </button>
              <button
                type="button"
                className="h-12 w-12 touch-none rounded-xl border border-orange-400/30 bg-orange-500/35 text-[11px] text-zinc-50 sm:h-14 sm:w-14"
                style={{ touchAction: "none" }}
                onTouchStart={(e) => {
                  e.preventDefault();
                  touchRef.current.throttle = 1;
                }}
                onTouchEnd={() => {
                  touchRef.current.throttle = 0;
                }}
                onTouchCancel={() => {
                  touchRef.current.throttle = 0;
                }}
                onMouseDown={() => {
                  touchRef.current.throttle = 1;
                }}
                onMouseUp={() => {
                  touchRef.current.throttle = 0;
                }}
                onMouseLeave={() => {
                  touchRef.current.throttle = 0;
                }}
              >
                Gas
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {board.length > 0 ? (
        <div
          data-drive-ui
          data-apex-drive-local-board="1"
          className="border-t border-zinc-800/80 bg-zinc-950/90 px-3 py-2 text-xs text-zinc-400"
        >
          <span className="uppercase tracking-[0.14em] text-zinc-500">
            Local game board (not real laps)
          </span>
          <span className="ml-2">
            {board
              .slice(0, 5)
              .map(
                (e, i) =>
                  `${i + 1}. ${formatLapTime(e.timeMs)}${
                    e.carId ? ` (${e.carId})` : ""
                  }`,
              )
              .join(" · ")}
          </span>
        </div>
      ) : null}
    </div>
  );
}
