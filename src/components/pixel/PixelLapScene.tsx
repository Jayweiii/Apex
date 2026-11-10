"use client";

import { useEffect, useRef } from "react";

/**
 * Home hero: two pixel cars lap a tiny circuit. The cyan car is the reference
 * lap, the orange one is "you". The gap between them and a speed trace are
 * drawn live, which is what Apex does with real telemetry. Decorative only.
 */
const W = 192;
const H = 108;
const N = 240;

/** Closed circuit as N points (a wobbly superellipse with a chicane). */
function buildTrack(): { x: Float32Array; y: Float32Array; speed: Float32Array } {
  const x = new Float32Array(N);
  const y = new Float32Array(N);
  for (let i = 0; i < N; i += 1) {
    const t = (i / N) * Math.PI * 2;
    const r = 1 + 0.18 * Math.sin(t * 3 + 0.6) + 0.1 * Math.cos(t * 5);
    x[i] = 70 + Math.cos(t) * 52 * r;
    y[i] = 50 + Math.sin(t) * 30 * r + Math.sin(t * 2) * 5;
  }
  // Speed from curvature: slow in the tight bits.
  const speed = new Float32Array(N);
  for (let i = 0; i < N; i += 1) {
    const a = (i - 4 + N) % N;
    const b = (i + 4) % N;
    const ux = x[i]! - x[a]!;
    const uy = y[i]! - y[a]!;
    const vx = x[b]! - x[i]!;
    const vy = y[b]! - y[i]!;
    const turn = Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy));
    speed[i] = Math.max(0.35, 1 - turn * 1.5);
  }
  // Smooth it so the trace reads as braking and accelerating.
  for (let pass = 0; pass < 3; pass += 1) {
    const next = speed.slice();
    for (let i = 0; i < N; i += 1) next[i] = (speed[(i - 2 + N) % N]! + speed[i]! * 2 + speed[(i + 2) % N]!) / 4;
    speed.set(next);
  }
  return { x, y, speed };
}

export function PixelLapScene({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const track = buildTrack();
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let you = 20;
    let ref_ = 26;
    let raf = 0;
    let last = performance.now();
    let visible = true;

    const px = (x: number, y: number, w: number, h: number, color: string) => {
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(x), Math.round(y), w, h);
    };

    const draw = () => {
      ctx.fillStyle = "#0e1016";
      ctx.fillRect(0, 0, W, H);
      // Grid.
      for (let gx = 0; gx < W; gx += 12) px(gx, 0, 1, H, "#151823");
      for (let gy = 0; gy < H; gy += 12) px(0, gy, W, 1, "#151823");
      // Track: fat dark line, then a kerb-dotted edge.
      for (let i = 0; i < N; i += 1) px(track.x[i]! - 3, track.y[i]! - 3, 7, 7, "#272b3a");
      for (let i = 0; i < N; i += 1) px(track.x[i]! - 2, track.y[i]! - 2, 5, 5, "#3b4157");
      for (let i = 0; i < N; i += 6) px(track.x[i]!, track.y[i]!, 1, 1, "#585f77");
      // Start/finish.
      for (let k = -3; k <= 3; k += 1) px(track.x[0]! + (k % 2 === 0 ? 0 : 1), track.y[0]! + k, 1, 1, k % 2 === 0 ? "#f0f2f8" : "#0e1016");
      // Trails.
      for (let k = 1; k <= 14; k += 1) {
        const a = (Math.floor(ref_) - k * 2 + N * 4) % N;
        const b = (Math.floor(you) - k * 2 + N * 4) % N;
        if (k % 2 === 0) px(track.x[a]!, track.y[a]! + 1, 1, 1, "#2b6f86");
        if (k % 2 === 1) px(track.x[b]!, track.y[b]! - 1, 1, 1, "#8a4410");
      }
      // Cars.
      const car = (pos: number, off: number, body: string) => {
        const i = Math.floor(pos) % N;
        px(track.x[i]! - 1, track.y[i]! - 1 + off, 3, 3, "#07080c");
        px(track.x[i]! - 1, track.y[i]! - 1 + off, 3, 2, body);
        px(track.x[i]!, track.y[i]! - 1 + off, 1, 1, "#f0f2f8");
      };
      car(ref_, 1, "#4cc9f0");
      car(you, -1, "#f97316");

      // Right panel: gap and speed trace.
      const x0 = 138;
      px(x0 - 4, 6, 1, H - 12, "#272b3a");
      // Gap bar: orange ahead grows right, behind grows left.
      let gap = (you - ref_ + N * 1.5) % N - N / 2;
      gap = Math.max(-20, Math.min(20, gap));
      px(x0, 12, 48, 7, "#151823");
      px(x0 + 24, 10, 1, 11, "#585f77");
      if (gap >= 0) px(x0 + 24, 13, Math.round(gap), 5, "#22c55e");
      else px(x0 + 24 + Math.round(gap), 13, Math.round(-gap), 5, "#ef4444");
      // Speed traces over the last stretch of lap.
      const base = 96;
      px(x0, base, 48, 1, "#272b3a");
      for (let k = 0; k < 48; k += 1) {
        const a = (Math.floor(ref_) - (47 - k) * 2 + N * 4) % N;
        const b = (Math.floor(you) - (47 - k) * 2 + N * 4) % N;
        px(x0 + k, base - 4 - track.speed[a]! * 56, 1, 1, "#4cc9f0");
        px(x0 + k, base - 4 - Math.min(1, track.speed[b]! * 1.04) * 56, 1, 1, "#f97316");
      }
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!visible) return;
      // "You" brake a touch later and carry more speed: slowly reel the reference in, then reset.
      ref_ = (ref_ + track.speed[Math.floor(ref_) % N]! * 46 * dt) % N;
      you = (you + Math.min(1, track.speed[Math.floor(you) % N]! * 1.04) * 46 * dt) % N;
      draw();
    };

    draw();
    if (still) return;
    const io = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true;
    });
    io.observe(canvas);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, []);

  return <canvas ref={ref} width={W} height={H} aria-hidden className={`px-canvas block w-full ${className}`} style={{ aspectRatio: `${W} / ${H}` }} />;
}
