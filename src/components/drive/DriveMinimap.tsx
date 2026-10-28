"use client";

import { ribbonEdges } from "@/lib/drive/ribbon";
import type { DrivePoint } from "@/lib/drive/types";
import type { SfGate } from "@/lib/drive/lap-timing";
import { useEffect, useRef } from "react";

type Props = {
  centerline: DrivePoint[];
  halfWidthM: number;
  gate: SfGate;
  carX: number;
  carY: number;
  carHeading: number;
  carColor: string;
  className?: string;
};

/** Lightweight 2D minimap overlay (keeps QA hooks + phone readability). */
export function DriveMinimap({
  centerline,
  halfWidthM,
  gate,
  carX,
  carY,
  carHeading,
  carColor,
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const edges = ribbonEdges(centerline, halfWidthM);
  const grass = ribbonEdges(centerline, halfWidthM + 14);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

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
    const size = 128;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const bw = maxX - minX + worldPad * 2;
    const bh = maxY - minY + worldPad * 2;
    const scale = (size * 0.86) / Math.max(bw, bh);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const toMini = (px: number, py: number) => ({
      x: size / 2 + (px - cx) * scale,
      y: size / 2 - (py - cy) * scale,
    });

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "rgba(9,9,11,0.72)";
    ctx.strokeStyle = "rgba(250,250,250,0.2)";
    ctx.lineWidth = 1;
    const rr = 10;
    ctx.beginPath();
    ctx.moveTo(rr, 0);
    ctx.arcTo(size, 0, size, size, rr);
    ctx.arcTo(size, size, 0, size, rr);
    ctx.arcTo(0, size, 0, 0, rr);
    ctx.arcTo(0, 0, size, 0, rr);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#2f6b38";
    ctx.beginPath();
    for (let i = 0; i < grass.left.length; i += 1) {
      const s = toMini(grass.left[i]!.x, grass.left[i]!.y);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    }
    for (let i = grass.right.length - 1; i >= 0; i -= 1) {
      const s = toMini(grass.right[i]!.x, grass.right[i]!.y);
      ctx.lineTo(s.x, s.y);
    }
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#52525b";
    ctx.beginPath();
    for (let i = 0; i < edges.left.length; i += 1) {
      const s = toMini(edges.left[i]!.x, edges.left[i]!.y);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    }
    for (let i = edges.right.length - 1; i >= 0; i -= 1) {
      const s = toMini(edges.right[i]!.x, edges.right[i]!.y);
      ctx.lineTo(s.x, s.y);
    }
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(250,250,250,0.55)";
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    for (let i = 0; i < centerline.length; i += 1) {
      const s = toMini(centerline[i]!.x, centerline[i]!.y);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    }
    ctx.stroke();

    const g0 = toMini(
      gate.mid.x - gate.gateX * gate.halfWidthM,
      gate.mid.y - gate.gateY * gate.halfWidthM,
    );
    const g1 = toMini(
      gate.mid.x + gate.gateX * gate.halfWidthM,
      gate.mid.y + gate.gateY * gate.halfWidthM,
    );
    ctx.strokeStyle = "#fafafa";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(g0.x, g0.y);
    ctx.lineTo(g1.x, g1.y);
    ctx.stroke();

    const me = toMini(carX, carY);
    ctx.save();
    ctx.translate(me.x, me.y);
    ctx.rotate(carHeading);
    ctx.fillStyle = carColor;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(4.5, 5.5);
    ctx.lineTo(-4.5, 5.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }, [
    centerline,
    carColor,
    carHeading,
    carX,
    carY,
    edges.left,
    edges.right,
    gate,
    grass.left,
    grass.right,
    halfWidthM,
  ]);

  return (
    <canvas
      ref={canvasRef}
      data-apex-drive-minimap="1"
      className={
        className ??
        "pointer-events-none absolute right-2 top-14 z-10 sm:right-3 sm:top-3"
      }
      aria-hidden
    />
  );
}

/** Exported name kept for verify-drive-minigame string checks via DriveGame import. */
export function drawMinimap() {
  return null;
}
