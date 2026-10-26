"use client";

import { toLocalMeters } from "@/lib/drive/coords";
import {
  buildSfGate,
  crossedStartFinishRobust,
} from "@/lib/drive/lap-timing";
import type { SfGate } from "@/lib/drive/lap-timing";
import { spawnAtStart, stepCar } from "@/lib/drive/physics";
import { ribbonEdges } from "@/lib/drive/ribbon";
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
import { formatLapTime } from "@/lib/format";
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
};

const FIXED_DT = 1 / 60;
const MAX_STEPS = 4;
const RECORD_EVERY_MS = 50;

export function DriveGame({ trackId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [payload, setPayload] = useState<DriveTrackPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [camera, setCamera] = useState<DriveCameraMode>("chase");
  const [hud, setHud] = useState({
    speedMph: 0,
    currentMs: 0,
    lastMs: null as number | null,
    bestMs: null as number | null,
    lap: 0,
    onTrack: true,
    sliding: false,
  });
  const [board, setBoard] = useState<DriveLeaderboardEntry[]>([]);
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);

  const keysRef = useRef(new Set<string>());
  const touchRef = useRef({ steer: 0, throttle: 0, brake: 0 });
  const padRef = useRef({ steer: 0, throttle: 0, brake: 0 });
  const cameraRef = useRef<DriveCameraMode>("chase");
  const pausedRef = useRef(false);
  const startedRef = useRef(false);

  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  useEffect(() => {
    startedRef.current = started;
  }, [started]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/tracks/${encodeURIComponent(trackId)}/drive`);
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

  // Lock page scroll while playing
  useEffect(() => {
    if (!started) return;
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
  }, [started]);

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
        setPaused((p) => !p);
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

    // Gamepad
    const pads = typeof navigator !== "undefined" ? navigator.getGamepads?.() : null;
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
      const nextBoard = submitGameTime(trackId, timeMs);
      setBoard(nextBoard);
      setHud((h) => ({
        ...h,
        lastMs: timeMs,
        bestMs:
          h.bestMs == null || timeMs < h.bestMs ? timeMs : h.bestMs,
        lap: h.lap + 1,
        currentMs: 0,
      }));
    },
  );

  // Main loop
  useEffect(() => {
    if (!payload || !started) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const centerline = payload.centerline;
    const halfW = payload.halfWidthM;
    const edges = ribbonEdges(centerline, halfW);
    const grass = ribbonEdges(centerline, halfW + 14);
    const gate: SfGate = buildSfGate(payload.origin, payload.startFinish, 16);
    const sfLocal = toLocalMeters(payload.origin, {
      lat: payload.startFinish.lat,
      lon: payload.startFinish.lon,
    });

    let car: DriveCarState = spawnAtStart(
      centerline,
      sfLocal,
      gate.travelHeading,
    );
    let prevPos: DrivePoint = { x: car.x, y: car.y };
    let lapStartPerf = performance.now();
    let pausedAt: number | null = null;
    let pausedAccum = 0;
    let armed = false; // ignore SF until we've left the gate once
    let leaveTimer = 0;
    let acc = 0;
    let last = performance.now();
    let raf = 0;
    let recordBuf: DrivePoint[] = [];
    let lastRecord = 0;
    let hudTick = 0;

    const playerGhost: DriveGhostLap | null = loadPlayerGhost(trackId);
    const realGhost = payload.realGhost;

    // World bounds for top-down fit
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
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
      c.fillStyle = color;
      c.strokeStyle = "#09090b";
      c.lineWidth = 1.2 / scale;
      const L = 4.2;
      const W = 1.9;
      c.beginPath();
      c.moveTo(0, -L * 0.55);
      c.lineTo(W * 0.5, L * 0.45);
      c.lineTo(-W * 0.5, L * 0.45);
      c.closePath();
      c.fill();
      c.stroke();
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
      // Chase: car-up, camera behind
      const scale = Math.min(viewW, viewH) / 95;
      const dx = px - camX;
      const dy = py - camY;
      const cos = Math.cos(camHeading);
      const sin = Math.sin(camHeading);
      // Rotate so car heading points up (-screenY)
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
        const s = worldToScreen(mode, viewW, viewH, pts[i]!.x, pts[i]!.y, camX, camY, camH);
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
        const s = worldToScreen(mode, viewW, viewH, left[i]!.x, left[i]!.y, camX, camY, camH);
        if (i === 0) c.moveTo(s.x, s.y);
        else c.lineTo(s.x, s.y);
      }
      for (let i = right.length - 1; i >= 0; i -= 1) {
        const s = worldToScreen(mode, viewW, viewH, right[i]!.x, right[i]!.y, camX, camY, camH);
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

      if (pausedRef.current) {
        if (pausedAt == null) pausedAt = now;
      } else if (pausedAt != null) {
        pausedAccum += now - pausedAt;
        pausedAt = null;
      }

      const lapElapsedNow = () =>
        performance.now() - lapStartPerf - pausedAccum - (pausedAt != null ? now - pausedAt : 0);

      if (!pausedRef.current && startedRef.current) {
        acc += dtWall;
        let steps = 0;
        while (acc >= FIXED_DT && steps < MAX_STEPS) {
          const inputs = readInputs();
          const stepped = stepCar(car, inputs, FIXED_DT, centerline, halfW);
          car = stepped.car;
          const nextPos = { x: car.x, y: car.y };

          leaveTimer += FIXED_DT;
          if (!armed && leaveTimer > 1.2) {
            const dist = Math.hypot(car.x - sfLocal.x, car.y - sfLocal.y);
            if (dist > 25) armed = true;
          }

          if (
            armed &&
            crossedStartFinishRobust(gate, prevPos, nextPos)
          ) {
            const timeMs = lapElapsedNow();
            if (timeMs > 15_000) {
              onLapComplete(timeMs, recordBuf);
              recordBuf = [];
              lastRecord = 0;
              lapStartPerf = performance.now();
              pausedAccum = 0;
              pausedAt = null;
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

      // Draw
      const mode = cameraRef.current;
      ctx!.fillStyle = "#1a3d1f";
      ctx!.fillRect(0, 0, viewW, viewH);

      // soft grass gradient patches
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
        "#3f3f46",
      );

      // Center dashed line
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

      // SF gate
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
      strokePoly(ctx!, [g0, g1], mode, viewW, viewH, car.x, car.y, car.heading, false);
      ctx!.stroke();
      ctx!.strokeStyle = "#f97316";
      ctx!.lineWidth = 2;
      strokePoly(ctx!, [g0, g1], mode, viewW, viewH, car.x, car.y, car.heading, false);
      ctx!.stroke();

      const lapElapsed = lapElapsedNow();

      // Ghosts
      const ghosts: Array<{ g: DriveGhostLap; color: string }> = [];
      if (playerGhost) ghosts.push({ g: playerGhost, color: "rgba(56,189,248,0.85)" });
      if (realGhost) ghosts.push({ g: realGhost, color: "rgba(250,204,21,0.8)" });
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
        // Approximate ghost heading from path
        const look = sampleGhost(
          g,
          Math.min(lapElapsed + 120, g.timeMs),
        );
        let gh = car.heading;
        if (look) gh = Math.atan2(look.x - sample.x, look.y - sample.y);
        drawCar(ctx!, s.x, s.y, mode === "chase" ? gh - car.heading : gh, color, s.scale);
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
      drawCar(
        ctx!,
        me.x,
        me.y,
        mode === "chase" ? 0 : car.heading,
        car.onTrack ? "#f97316" : "#a1a1aa",
        me.scale,
      );

      hudTick += dtWall;
      if (hudTick > 0.1) {
        hudTick = 0;
        setHud((h) => ({
          ...h,
          speedMph: Math.abs(car.speed) * 2.23694,
          currentMs: lapElapsed,
          onTrack: car.onTrack,
          sliding: Math.abs(car.slip) > 0.55,
        }));
      }
    }

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // onLapComplete is useEffectEvent — omit from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, started, trackId, readInputs]);

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

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-zinc-400">
        Loading track…
      </div>
    );
  }

  if (error || !payload) {
    return (
      <div className="mx-auto max-w-lg space-y-3 px-4 py-10 text-center">
        <p className="text-sm text-zinc-300">{error ?? "Track unavailable"}</p>
        <Link href="/drive" className="apex-btn inline-flex">
          Pick another track
        </Link>
      </div>
    );
  }

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
          <p className="truncate text-sm text-zinc-200">Drive · arcade</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className="apex-btn apex-btn--ghost text-xs"
            onClick={() => setCamera((c) => (c === "chase" ? "top" : "chase"))}
          >
            Cam: {camera === "chase" ? "Chase" : "Top"}
          </button>
          {started ? (
            <button
              type="button"
              className="apex-btn apex-btn--ghost text-xs"
              onClick={() => setPaused((p) => !p)}
            >
              {paused ? "Resume" : "Pause"}
            </button>
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

        {!started ? (
          <div
            data-drive-ui
            className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-zinc-950/70 px-4 text-center backdrop-blur-sm"
          >
            <p className="max-w-md text-sm text-zinc-300">
              Arcade drive on a real GPS ribbon
              {payload.source === "session_gps"
                ? " from a session at this track"
                : payload.source === "centerline"
                  ? " from the saved centerline"
                  : " (builtin layout)"}.
              Ghosts: your best (blue)
              {payload.realGhost ? ", real lap (yellow)" : ""}.
            </p>
            <p className="text-xs text-zinc-500">
              WASD / arrows · gamepad · on-screen controls · C camera · game
              times stay off real leaderboards
            </p>
            <button
              type="button"
              className="apex-btn apex-btn--accent min-h-12 px-8 text-base"
              onClick={() => {
                setStarted(true);
                setPaused(false);
              }}
            >
              Start driving
            </button>
          </div>
        ) : null}

        {started ? (
          <div
            data-drive-ui
            className="pointer-events-none absolute inset-x-0 top-0 flex justify-between gap-2 p-2 sm:p-3"
          >
            <div className="rounded-lg bg-zinc-950/75 px-2.5 py-1.5 font-mono text-xs text-zinc-100 backdrop-blur">
              <div>Lap {Math.max(1, hud.lap + 1)}</div>
              <div className="text-base text-orange-400">
                {formatLapTime(hud.currentMs)}
              </div>
              <div className="text-[10px] text-zinc-400">
                Last {hud.lastMs != null ? formatLapTime(hud.lastMs) : "—"} · Best{" "}
                {hud.bestMs != null ? formatLapTime(hud.bestMs) : "—"}
              </div>
            </div>
            <div className="rounded-lg bg-zinc-950/75 px-2.5 py-1.5 text-right font-mono text-xs text-zinc-100 backdrop-blur">
              <div className="text-base">{hud.speedMph.toFixed(0)} mph</div>
              <div
                className={`text-[10px] ${
                  hud.onTrack ? "text-emerald-400" : "text-amber-400"
                }`}
              >
                {hud.onTrack ? (hud.sliding ? "Slide" : "On track") : "Grass"}
              </div>
            </div>
          </div>
        ) : null}

        {started ? (
          <div
            data-drive-ui
            className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4"
          >
            <div
              className="h-28 w-[42%] max-w-[220px] touch-none rounded-2xl border border-zinc-700/80 bg-zinc-900/55 sm:h-32"
              onTouchStart={(e) => onSteerTouch(e)}
              onTouchMove={(e) => onSteerTouch(e)}
              onTouchEnd={(e) => onSteerTouch(e, true)}
              onTouchCancel={(e) => onSteerTouch(e, true)}
              aria-label="Steering"
            >
              <p className="pointer-events-none pt-2 text-center text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                Steer
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="apex-btn h-24 w-20 touch-none sm:h-28 sm:w-24"
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
                className="apex-btn apex-btn--accent h-24 w-20 touch-none sm:h-28 sm:w-24"
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
          className="border-t border-zinc-800/80 bg-zinc-950/90 px-3 py-2 text-xs text-zinc-400"
        >
          <span className="uppercase tracking-[0.14em] text-zinc-500">
            Game board (local only)
          </span>
          <span className="ml-2">
            {board
              .slice(0, 5)
              .map((e, i) => `${i + 1}. ${formatLapTime(e.timeMs)}`)
              .join(" · ")}
          </span>
        </div>
      ) : null}
    </div>
  );
}
