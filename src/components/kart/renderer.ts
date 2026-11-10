/**
 * Canvas2D pixel renderer. Draws into a low-res buffer (~260 px wide) that
 * CSS scales up with `image-rendering: pixelated`. Camera follows the kart
 * heading-up and swings with yaw while drifting.
 *
 * View-only: reads the world, never mutates it (effects here — smoke, skid
 * marks — are cosmetic, so they don't affect determinism).
 */
import { driftAngle } from "@/lib/kart/car";
import {
  KART_RULES,
  SURFACE_GRASS,
  type KartWorld,
} from "@/lib/kart/sim";
import {
  CAR_LENGTH_M,
  CAR_WIDTH_M,
  createSprites,
  type KartSprites,
} from "./sprites";

const TARGET_LOWRES_WIDTH = 260;
const SKID_MAX = 1600;
const SMOKE_MAX = 96;

export type KartRenderer = {
  resize: () => void;
  draw: (world: KartWorld, frameDt: number) => void;
  /** World angle (rad) that points to screen-up now (heading-up camera). */
  cameraRotation: () => number;
  dispose: () => void;
};

export function createRenderer(canvas: HTMLCanvasElement, world: KartWorld): KartRenderer {
  const ctx = canvas.getContext("2d", { alpha: false })!;
  let sprites: KartSprites = createSprites(ctx);
  const track = world.track;

  // Track path, built once.
  const path = new Path2D();
  path.moveTo(track.px[0], track.py[0]);
  for (let k = 1; k < track.count; k += 1) path.lineTo(track.px[k], track.py[k]);
  path.closePath();

  // Skid marks: ring buffer of segments (x1, y1, x2, y2).
  const skids = new Float32Array(SKID_MAX * 4);
  let skidHead = 0;
  let skidCount = 0;
  let lastRearL = { x: 0, y: 0, valid: false };
  let lastRearR = { x: 0, y: 0, valid: false };

  // Smoke particle pool.
  const smX = new Float32Array(SMOKE_MAX);
  const smY = new Float32Array(SMOKE_MAX);
  const smLife = new Float32Array(SMOKE_MAX);
  let smNext = 0;

  let cam = { x: world.car.x, y: world.car.y, rot: world.car.heading, zoom: 3.2 };
  let pixel = 3;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(1, rect.width);
    const cssH = Math.max(1, rect.height);
    pixel = Math.max(2, Math.round(cssW / TARGET_LOWRES_WIDTH));
    canvas.width = Math.max(1, Math.round(cssW / pixel));
    canvas.height = Math.max(1, Math.round(cssH / pixel));
    ctx.imageSmoothingEnabled = false;
    sprites = createSprites(ctx);
  }

  function pushSkid(prev: { x: number; y: number; valid: boolean }, x: number, y: number) {
    if (prev.valid) {
      const o = skidHead * 4;
      skids[o] = prev.x;
      skids[o + 1] = prev.y;
      skids[o + 2] = x;
      skids[o + 3] = y;
      skidHead = (skidHead + 1) % SKID_MAX;
      if (skidCount < SKID_MAX) skidCount += 1;
    }
    prev.x = x;
    prev.y = y;
    prev.valid = true;
  }

  function draw(world: KartWorld, frameDt: number) {
    const car = world.car;
    const w = canvas.width;
    const h = canvas.height;
    const speed = Math.hypot(car.vx, car.vy);
    const beta = driftAngle(car);

    // ── Effects (cosmetic) ──
    const ch = Math.cos(car.heading);
    const sh = Math.sin(car.heading);
    const rearX = car.x - ch * CAR_LENGTH_M * 0.38;
    const rearY = car.y - sh * CAR_LENGTH_M * 0.38;
    const sideX = -sh * CAR_WIDTH_M * 0.42;
    const sideY = ch * CAR_WIDTH_M * 0.42;
    const sliding =
      speed > 4 &&
      (Math.abs(car.rearSlip) > 0.14 || car.driveUsage > 0.97 || world.slickedTicks > 0);
    if (sliding) {
      pushSkid(lastRearL, rearX + sideX, rearY + sideY);
      pushSkid(lastRearR, rearX - sideX, rearY - sideY);
      if (Math.random() < 0.6) {
        const k = smNext;
        smX[k] = rearX + (Math.random() - 0.5) * 1.2;
        smY[k] = rearY + (Math.random() - 0.5) * 1.2;
        smLife[k] = 1;
        smNext = (k + 1) % SMOKE_MAX;
      }
    } else {
      lastRearL.valid = false;
      lastRearR.valid = false;
    }
    for (let k = 0; k < SMOKE_MAX; k += 1) {
      if (smLife[k] > 0) smLife[k] -= frameDt * 1.4;
    }

    // ── Camera: heading-up, swings with drift, zooms out with speed ──
    const follow = 1 - Math.exp(-frameDt * 10);
    cam.x += (car.x - cam.x) * follow;
    cam.y += (car.y - cam.y) * follow;
    const targetRot = car.heading + beta * 0.35;
    let dRot = targetRot - cam.rot;
    while (dRot > Math.PI) dRot -= 2 * Math.PI;
    while (dRot < -Math.PI) dRot += 2 * Math.PI;
    cam.rot += dRot * (1 - Math.exp(-frameDt * 6));
    const targetZoom = (w / TARGET_LOWRES_WIDTH) * (6.4 - Math.min(2.2, speed * 0.055));
    cam.zoom += (targetZoom - cam.zoom) * (1 - Math.exp(-frameDt * 3));

    // ── Background ──
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#3f8f2f";
    ctx.fillRect(0, 0, w, h);

    // World transform: car at ~68% height (more road ahead), heading up.
    ctx.setTransform(1, 0, 0, 1, Math.round(w / 2), Math.round(h * 0.68));
    ctx.scale(cam.zoom, -cam.zoom);
    ctx.rotate(Math.PI / 2 - cam.rot);
    ctx.translate(-cam.x, -cam.y);

    if (sprites.grass) {
      ctx.fillStyle = sprites.grass;
      ctx.save();
      ctx.scale(0.5, 0.5);
      ctx.fillRect(cam.x * 2 - 400, cam.y * 2 - 400, 800, 800);
      ctx.restore();
    }

    // Run-off (sand), curbs, asphalt, centre line.
    const hw = track.halfWidth;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "#c8a96a";
    ctx.lineWidth = (hw + KART_RULES.wallOutside) * 2;
    ctx.stroke(path);
    ctx.strokeStyle = "#2f7a25";
    ctx.lineWidth = (hw + KART_RULES.curbWidth + 3) * 2;
    ctx.stroke(path);
    ctx.setLineDash([2.5, 2.5]);
    ctx.lineWidth = (hw + KART_RULES.curbWidth) * 2;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke(path);
    ctx.lineDashOffset = 2.5;
    ctx.strokeStyle = "#e11d48";
    ctx.stroke(path);
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    ctx.strokeStyle = "#3a3a48";
    ctx.lineWidth = hw * 2;
    ctx.stroke(path);
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 0.35;
    ctx.stroke(path);
    ctx.setLineDash([]);

    // Skid marks.
    ctx.strokeStyle = "rgba(15,15,20,0.55)";
    ctx.lineWidth = 0.32;
    ctx.beginPath();
    for (let i = 0; i < skidCount; i += 1) {
      const o = i * 4;
      ctx.moveTo(skids[o], skids[o + 1]);
      ctx.lineTo(skids[o + 2], skids[o + 3]);
    }
    ctx.stroke();

    // Gates: start/finish checker, next gate glows gold.
    for (let g = 0; g < track.gates.length; g += 1) {
      const k = Math.round((track.gates[g] / track.length) * track.count) % track.count;
      const nx = -track.ty[k];
      const ny = track.tx[k];
      const x1 = track.px[k] + nx * hw;
      const y1 = track.py[k] + ny * hw;
      const x2 = track.px[k] - nx * hw;
      const y2 = track.py[k] - ny * hw;
      if (g === 0 && sprites.checker) {
        ctx.save();
        ctx.translate(track.px[k], track.py[k]);
        ctx.rotate(Math.atan2(track.ty[k], track.tx[k]));
        ctx.fillStyle = sprites.checker;
        ctx.fillRect(-1, -hw, 2, hw * 2);
        ctx.restore();
      }
      const next = g === world.nextGate;
      ctx.strokeStyle = next ? "#facc15" : g === 0 ? "rgba(0,0,0,0)" : "rgba(255,255,255,0.25)";
      ctx.lineWidth = next ? 0.9 : 0.4;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      if (next) {
        // Gate posts.
        ctx.fillStyle = "#facc15";
        ctx.fillRect(x1 - 0.7, y1 - 0.7, 1.4, 1.4);
        ctx.fillRect(x2 - 0.7, y2 - 0.7, 1.4, 1.4);
      }
    }

    // Oil slicks.
    for (let k = 0; k < KART_RULES.maxSlicks; k += 1) {
      if (!world.slickActive[k]) continue;
      ctx.fillStyle = "rgba(20,10,40,0.85)";
      ctx.beginPath();
      ctx.ellipse(world.slickX[k], world.slickY[k], KART_RULES.slickRadius, KART_RULES.slickRadius * 0.7, 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(167,139,250,0.55)";
      ctx.fillRect(world.slickX[k] - 0.4, world.slickY[k], 0.8, 0.5);
    }

    // Item boxes (bob with time).
    const bob = Math.sin(world.tick / 20) * 0.25;
    for (let b = 0; b < track.boxX.length; b += 1) {
      if (world.boxCooldown[b] > 0) continue;
      // Pulsing halo + big box so pickups read from across the track.
      const pulse = 0.5 + 0.5 * Math.sin(world.tick / 14 + b);
      ctx.fillStyle = `rgba(253,224,71,${(0.18 + 0.2 * pulse).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(track.boxX[b], track.boxY[b], 2.6 + pulse * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.drawImage(sprites.box, track.boxX[b] - 1.8, track.boxY[b] - 1.8 + bob, 3.6, 3.6);
    }

    // Smoke.
    for (let k = 0; k < SMOKE_MAX; k += 1) {
      const life = smLife[k];
      if (life <= 0) continue;
      const size = 0.8 + (1 - life) * 2.2;
      ctx.fillStyle = `rgba(230,230,240,${(life * 0.45).toFixed(2)})`;
      ctx.fillRect(smX[k] - size / 2, smY[k] - size / 2, size, size);
    }

    // Kart.
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.heading - Math.PI / 2);
    if (world.turboTicks > 0) {
      ctx.fillStyle = world.tick % 6 < 3 ? "#fde047" : "#f97316";
      ctx.fillRect(-0.45, -CAR_LENGTH_M / 2 - 1.1, 0.9, 1.1);
    }
    // Sprite rows run top→bottom; world y is up, so flip vertically.
    ctx.scale(1, -1);
    ctx.drawImage(sprites.car, -CAR_WIDTH_M / 2, -CAR_LENGTH_M / 2, CAR_WIDTH_M, CAR_LENGTH_M);
    ctx.restore();

    // Grass tint flash at screen edges.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (world.surface === SURFACE_GRASS) {
      ctx.fillStyle = "rgba(120,53,15,0.18)";
      ctx.fillRect(0, 0, w, h);
    }
  }

  resize();
  return {
    resize,
    draw,
    cameraRotation: () => cam.rot,
    dispose() {
      lastRearL = { x: 0, y: 0, valid: false };
      lastRearR = { x: 0, y: 0, valid: false };
      cam = { x: 0, y: 0, rot: 0, zoom: 1 };
    },
  };
}
