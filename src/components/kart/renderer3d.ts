/**
 * Third-person 3D renderer for Apex Kart (plain three.js, no React).
 *
 * Same interface as the 2D renderer (`resize`, `draw`, `dispose`) so the
 * game loop is unchanged. View-only: reads the sim, never mutates it.
 *
 * Coordinates: sim (x east, y north, z up) → three (X = x, Y = height,
 * Z = −y). Track height comes from real USGS altitude baked into the level.
 *
 * Perf budget (mid-range phone): everything repeated is instanced, no
 * real-time shadows (blob shadow under the kart), pixel ratio ≤ 2, fog
 * hides the far terrain, nothing allocates per frame.
 */
import { driftAngle } from "@/lib/kart/car";
import { createRng, nextRandom } from "@/lib/kart/rng";
import { KART_RULES, SURFACE_GRASS, type KartWorld } from "@/lib/kart/sim";
import type { KartTrack } from "@/lib/kart/track";
import * as THREE from "three";
import type { KartRenderer } from "./renderer";

const SKY = 0x9fd4f5;
const FOG = 0xbfe2f7;
const SMOKE_MAX = 90;
const SKID_MAX = 1400;
const KART_LEN = 3.3;

/* ───────────────────────── geometry helpers ───────────────────────── */

/** Height of the track at a centerline index (sim metres). */
function zAt(track: KartTrack, k: number): number {
  const n = track.count;
  return track.pz[((k % n) + n) % n];
}

/** Build a strip along the track between lateral offsets [a, b]. */
function stripGeometry(
  track: KartTrack,
  a: number,
  b: number,
  lift: number,
  color: (k: number, side: 0 | 1) => THREE.Color,
): THREE.BufferGeometry {
  const n = track.count;
  const pos = new Float32Array((n + 1) * 2 * 3);
  const col = new Float32Array((n + 1) * 2 * 3);
  const idx: number[] = [];
  for (let i = 0; i <= n; i += 1) {
    const k = i % n;
    const nx = -track.ty[k];
    const ny = track.tx[k];
    const h = zAt(track, k) + lift;
    const sides: Array<[number, 0 | 1]> = [
      [a, 0],
      [b, 1],
    ];
    for (const [off, side] of sides) {
      const v = i * 2 + side;
      pos[v * 3] = track.px[k] + nx * off;
      pos[v * 3 + 1] = h;
      pos[v * 3 + 2] = -(track.py[k] + ny * off);
      const c = color(k, side);
      col[v * 3] = c.r;
      col[v * 3 + 1] = c.g;
      col[v * 3 + 2] = c.b;
    }
    if (i < n) {
      const v = i * 2;
      idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Nearest-centerline distance + height for a world point (coarse, setup only). */
function makeTrackSampler(track: KartTrack) {
  const step = 3;
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (let k = 0; k < track.count; k += step) {
    xs.push(track.px[k]);
    ys.push(track.py[k]);
    zs.push(track.pz[k]);
  }
  return (x: number, y: number) => {
    let best = Infinity;
    let bestZ = 0;
    // Inverse-distance blend of the 3 nearest for smooth hills.
    let w = 0;
    let wz = 0;
    for (let i = 0; i < xs.length; i += 1) {
      const dx = x - xs[i];
      const dy = y - ys[i];
      const d2 = dx * dx + dy * dy;
      if (d2 < best) {
        best = d2;
        bestZ = zs[i];
      }
      const wi = 1 / (d2 + 400);
      w += wi * wi;
      wz += wi * wi * zs[i];
    }
    const dist = Math.sqrt(best);
    // Near the track the ground follows the road exactly; further out it
    // eases toward the regional average height of nearby track.
    const t = Math.min(1, Math.max(0, (dist - 12) / 40));
    return { dist, z: bestZ * (1 - t) + (wz / w) * t };
  };
}

/* ───────────────────────── textures (drawn in code) ───────────────────────── */

function checkerTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 16;
  const g = c.getContext("2d")!;
  for (let y = 0; y < 4; y += 1)
    for (let x = 0; x < 4; x += 1) {
      g.fillStyle = (x + y) % 2 ? "#111" : "#fff";
      g.fillRect(x * 4, y * 4, 4, 4);
    }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function itemBoxTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 32;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 32, 32);
  grad.addColorStop(0, "#fde047");
  grad.addColorStop(1, "#f97316");
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  g.strokeStyle = "#fff7";
  g.lineWidth = 3;
  g.strokeRect(2, 2, 28, 28);
  g.fillStyle = "#fff";
  g.font = "bold 24px monospace";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("?", 16, 18);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function smokeTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 32;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(16, 16, 2, 16, 16, 16);
  r.addColorStop(0, "rgba(255,255,255,0.9)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function crowdTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 16;
  const g = c.getContext("2d")!;
  g.fillStyle = "#3f3f46";
  g.fillRect(0, 0, 64, 16);
  const colors = ["#f97316", "#38bdf8", "#fde047", "#f43f5e", "#a3e635", "#e4e4e7", "#c084fc"];
  const rng = createRng(7);
  for (let y = 1; y < 16; y += 3)
    for (let x = 1; x < 64; x += 2) {
      if (nextRandom(rng) < 0.25) continue;
      g.fillStyle = colors[Math.floor(nextRandom(rng) * colors.length)];
      g.fillRect(x, y, 1, 2);
    }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ───────────────────────── kart model ───────────────────────── */

type KartModel = {
  root: THREE.Group;
  body: THREE.Group;
  wheels: THREE.Mesh[];
  frontPivots: THREE.Group[];
  flame: THREE.Mesh;
};

function buildKart(color: number): KartModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const paint = new THREE.MeshLambertMaterial({ color, flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1f2937, flatShading: true });
  const metal = new THREE.MeshLambertMaterial({ color: 0x9ca3af, flatShading: true });
  const skin = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  const visor = new THREE.MeshLambertMaterial({ color: 0x38bdf8, emissive: 0x0c4a6e, flatShading: true });

  // Kart local axes: +Z forward, +X left, +Y up.
  const tray = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 2.9), dark);
  tray.position.set(0, 0.28, 0);
  body.add(tray);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.32, 0.7), paint);
  nose.position.set(0, 0.42, 1.35);
  nose.rotation.x = -0.25;
  body.add(nose);
  for (const side of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.3, 1.3), paint);
    pod.position.set(side * 0.78, 0.42, -0.05);
    body.add(pod);
  }
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.18, 0.18), paint);
  bumper.position.set(0, 0.36, -1.5);
  body.add(bumper);
  const engine = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.5), metal);
  engine.position.set(-0.35, 0.58, -0.95);
  body.add(engine);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.45), dark);
  seat.position.set(0, 0.6, -0.45);
  body.add(seat);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.4), paint);
  torso.position.set(0, 0.95, -0.35);
  body.add(torso);
  const helmet = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 1), skin);
  helmet.position.set(0, 1.4, -0.3);
  body.add(helmet);
  const visorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.12), visor);
  visorMesh.position.set(0, 1.42, -0.04);
  body.add(visorMesh);
  const wheelSteer = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.04, 6, 12), dark);
  wheelSteer.position.set(0, 0.92, 0.12);
  wheelSteer.rotation.x = -0.9;
  body.add(wheelSteer);

  const tire = new THREE.MeshLambertMaterial({ color: 0x18181b, flatShading: true });
  const hub = new THREE.MeshLambertMaterial({ color: 0xe4e4e7, flatShading: true });
  const wheels: THREE.Mesh[] = [];
  const frontPivots: THREE.Group[] = [];
  const wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.32, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.34, 8);
  hubGeo.rotateZ(Math.PI / 2);
  for (const [z, front] of [
    [1.05, true],
    [-1.05, false],
  ] as const) {
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.86, 0.3, z);
      const w = new THREE.Mesh(wheelGeo, tire);
      w.add(new THREE.Mesh(hubGeo, hub));
      pivot.add(w);
      root.add(pivot);
      wheels.push(w);
      if (front) frontPivots.push(pivot);
    }
  }
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 1, 8),
    new THREE.MeshBasicMaterial({ color: 0xfde047, transparent: true, opacity: 0.9 }),
  );
  flame.rotation.x = -Math.PI / 2;
  flame.position.set(-0.35, 0.6, -1.75);
  flame.visible = false;
  body.add(flame);
  return { root, body, wheels, frontPivots, flame };
}

/* ───────────────────────── renderer ───────────────────────── */

/** Throws if WebGL isn't available (caller falls back to 2D). */
export function createRenderer3D(canvas: HTMLCanvasElement, world: KartWorld): KartRenderer {
  const track = world.track;
  // Phones: cap the pixel ratio at 1.5 (retina × 3 is ~4× the fill cost
  // for little visible gain); MSAA only where the screen isn't already dense.
  const dpr = window.devicePixelRatio || 1;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: dpr < 1.5,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(coarse ? 1.5 : 2, dpr));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  canvas.style.imageRendering = "auto";

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY); // under the dome, if it ever shows
  scene.fog = new THREE.Fog(FOG, 70, 260);
  const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 1200);

  scene.add(new THREE.HemisphereLight(0xdbeafe, 0x4d7c0f, 1.15));
  const sun = new THREE.DirectionalLight(0xfff4d6, 1.6);
  sun.position.set(-60, 120, 40);
  scene.add(sun);

  let skyDome: THREE.Object3D | null = null;
  let hillRing: THREE.Object3D | null = null;
  let cloudLayer: THREE.Object3D | null = null;
  const disposables: Array<{ dispose: () => void }> = [];
  const keep = <T extends { dispose: () => void }>(x: T) => {
    disposables.push(x);
    return x;
  };

  // ── Sky dome (gradient), distant hills, clouds — unaffected by fog ──
  {
    const skyGeo = keep(new THREE.SphereGeometry(500, 24, 12));
    const pos = skyGeo.getAttribute("position") as THREE.BufferAttribute;
    const cols = new Float32Array(pos.count * 3);
    const top = new THREE.Color(0x4aa3e8);
    const horizon = new THREE.Color(0xd8eefb);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i += 1) {
      const t = Math.max(0, pos.getY(i) / 500);
      c.copy(horizon).lerp(top, Math.pow(t, 0.6));
      cols[i * 3] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }
    skyGeo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    const sky = new THREE.Mesh(
      skyGeo,
      keep(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })),
    );
    sky.renderOrder = -1;
    scene.add(sky);
    skyDome = sky;

    // Distant hills: a ring of soft low-poly mounds on the horizon.
    const hillGeo = keep(new THREE.ConeGeometry(1, 1, 7));
    const hillMat = keep(new THREE.MeshLambertMaterial({ color: 0x7aa36a, flatShading: true, fog: false }));
    const rngH = createRng(5);
    const HN = 28;
    const hills = new THREE.InstancedMesh(hillGeo, hillMat, HN);
    const hq = new THREE.Quaternion();
    const hp = new THREE.Vector3();
    const hs = new THREE.Vector3();
    const hm = new THREE.Matrix4();
    for (let i = 0; i < HN; i += 1) {
      const a = (i / HN) * Math.PI * 2 + nextRandom(rngH) * 0.2;
      const r = 380 + nextRandom(rngH) * 60;
      hs.set(60 + nextRandom(rngH) * 70, 25 + nextRandom(rngH) * 45, 60 + nextRandom(rngH) * 70);
      hp.set(Math.cos(a) * r, hs.y / 2 - 6, Math.sin(a) * r);
      hills.setMatrixAt(i, hm.compose(hp, hq, hs));
    }
    hillRing = hills;
    scene.add(hills);

    // Clouds: flattened icosahedron puffs.
    const cloudGeo = keep(new THREE.IcosahedronGeometry(1, 0));
    const cloudMat = keep(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92, fog: false }));
    const CN2 = 18;
    const clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, CN2 * 3);
    let ci = 0;
    for (let i = 0; i < CN2; i += 1) {
      const a = nextRandom(rngH) * Math.PI * 2;
      const r = 200 + nextRandom(rngH) * 180;
      const cx0 = Math.cos(a) * r;
      const cz0 = Math.sin(a) * r;
      const cy0 = 110 + nextRandom(rngH) * 50;
      for (let p = 0; p < 3; p += 1) {
        const sc = 9 + nextRandom(rngH) * 9;
        hs.set(sc * 1.6, sc * 0.6, sc);
        hp.set(cx0 + (p - 1) * sc * 1.2, cy0 + nextRandom(rngH) * 3, cz0 + (nextRandom(rngH) - 0.5) * 8);
        clouds.setMatrixAt(ci, hm.compose(hp, hq, hs));
        ci += 1;
      }
    }
    cloudLayer = clouds;
    scene.add(clouds);
  }

  // ── Terrain: heightfield that follows the real altitude near the track ──
  const sample = makeTrackSampler(track);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let k = 0; k < track.count; k += 1) {
    minX = Math.min(minX, track.px[k]);
    maxX = Math.max(maxX, track.px[k]);
    minY = Math.min(minY, track.py[k]);
    maxY = Math.max(maxY, track.py[k]);
  }
  const margin = 140;
  const tw = maxX - minX + margin * 2;
  const th = maxY - minY + margin * 2;
  const seg = 110;
  const terrainGeo = keep(new THREE.PlaneGeometry(tw, th, seg, seg));
  terrainGeo.rotateX(-Math.PI / 2);
  const tPos = terrainGeo.getAttribute("position") as THREE.BufferAttribute;
  const tCol = new Float32Array(tPos.count * 3);
  const rngT = createRng(11);
  const grassA = new THREE.Color(0x4f9d3a);
  const grassB = new THREE.Color(0x3f8530);
  const sand = new THREE.Color(0xd6b77a);
  const tmpC = new THREE.Color();
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  for (let i = 0; i < tPos.count; i += 1) {
    const x = tPos.getX(i) + cx;
    const y = -tPos.getZ(i) + cy;
    const s = sample(x, y);
    const noise = (nextRandom(rngT) - 0.5) * 0.6;
    const rolling = Math.sin(x * 0.03) * Math.cos(y * 0.025) * 2.5 * Math.min(1, s.dist / 60);
    tPos.setXYZ(i, x, s.z - 0.25 + rolling + (s.dist > 20 ? noise : 0), -y);
    const runoff = s.dist < track.halfWidth + KART_RULES.wallOutside;
    tmpC.copy(grassA).lerp(grassB, nextRandom(rngT));
    if (runoff && s.dist > track.halfWidth + KART_RULES.curbWidth + 2) tmpC.copy(sand);
    tCol[i * 3] = tmpC.r;
    tCol[i * 3 + 1] = tmpC.g;
    tCol[i * 3 + 2] = tmpC.b;
  }
  terrainGeo.setAttribute("color", new THREE.BufferAttribute(tCol, 3));
  terrainGeo.computeVertexNormals();
  const vcFlat = keep(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  scene.add(new THREE.Mesh(terrainGeo, vcFlat));

  // ── Road, curbs, grass verge, centre dashes ──
  const hw = track.halfWidth;
  const asphalt = new THREE.Color(0x3a3a48);
  const asphalt2 = new THREE.Color(0x34343f);
  const vc = keep(new THREE.MeshLambertMaterial({ vertexColors: true }));
  const verge = new THREE.Color(0x3b8a2c);
  scene.add(new THREE.Mesh(keep(stripGeometry(track, -hw - KART_RULES.curbWidth - 3, hw + KART_RULES.curbWidth + 3, 0.0, () => verge)), vc));
  scene.add(new THREE.Mesh(keep(stripGeometry(track, -hw, hw, 0.05, (k) => (k % 6 < 3 ? asphalt : asphalt2))), vc));
  const red = new THREE.Color(0xe11d48);
  const white = new THREE.Color(0xf4f4f5);
  for (const sgn of [-1, 1]) {
    scene.add(
      new THREE.Mesh(
        keep(stripGeometry(track, sgn * hw, sgn * (hw + KART_RULES.curbWidth), 0.09, (k) => (Math.floor(k / 1.5) % 2 ? red : white))),
        vc,
      ),
    );
  }
  const dashMat = keep(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
  const dashGeo = keep(new THREE.PlaneGeometry(0.22, 2.2));
  dashGeo.rotateX(-Math.PI / 2);
  const dashCount = Math.floor(track.count / 4);
  const dashes = new THREE.InstancedMesh(dashGeo, dashMat, dashCount);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v3 = new THREE.Vector3();
  const s3 = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < dashCount; i += 1) {
    const k = i * 4;
    q.setFromAxisAngle(up, Math.atan2(track.ty[k], track.tx[k]) - Math.PI / 2);
    v3.set(track.px[k], zAt(track, k) + 0.07, -track.py[k]);
    dashes.setMatrixAt(i, m4.compose(v3, q, s3));
  }
  scene.add(dashes);

  // ── Start/finish checker + gate arches ──
  const checker = keep(checkerTexture());
  checker.repeat.set(Math.round(hw), 1);
  const startMat = keep(new THREE.MeshLambertMaterial({ map: checker }));
  const startGeo = keep(new THREE.PlaneGeometry(hw * 2, 2));
  startGeo.rotateX(-Math.PI / 2);
  const start = new THREE.Mesh(startGeo, startMat);
  {
    const k = 0;
    start.position.set(track.px[k], zAt(track, k) + 0.08, -track.py[k]);
    start.rotation.y = Math.atan2(track.ty[k], track.tx[k]) - Math.PI / 2;
  }
  scene.add(start);

  const postGeo = keep(new THREE.BoxGeometry(0.5, 5, 0.5));
  const barGeo = keep(new THREE.BoxGeometry(hw * 2 + 1.5, 0.6, 0.5));
  const gateMats: THREE.MeshLambertMaterial[] = [];
  const gateIndex: number[] = [];
  for (let g = 0; g < track.gates.length; g += 1) {
    const k = Math.round((track.gates[g] / track.length) * track.count) % track.count;
    gateIndex.push(k);
    const mat = keep(new THREE.MeshLambertMaterial({ color: g === 0 ? 0xf4f4f5 : 0xa1a1aa, emissive: 0x000000 }));
    gateMats.push(mat);
    const arch = new THREE.Group();
    const nx = -track.ty[k];
    const ny = track.tx[k];
    for (const sgn of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, mat);
      const ox = track.px[k] + nx * sgn * (hw + 0.8);
      const oy = track.py[k] + ny * sgn * (hw + 0.8);
      post.position.set(ox, zAt(track, k) + 2.5, -oy);
      arch.add(post);
    }
    const bar = new THREE.Mesh(barGeo, mat);
    bar.position.set(track.px[k], zAt(track, k) + 5, -track.py[k]);
    bar.rotation.y = Math.atan2(track.ty[k], track.tx[k]) - Math.PI / 2;
    arch.add(bar);
    if (g === 0) {
      const banner = new THREE.Mesh(keep(new THREE.BoxGeometry(hw * 2, 1.2, 0.2)), keep(new THREE.MeshLambertMaterial({ map: checker })));
      banner.position.copy(bar.position).add(new THREE.Vector3(0, 1, 0));
      banner.rotation.y = bar.rotation.y;
      arch.add(banner);
    }
    scene.add(arch);
  }

  // ── Item boxes ──
  const boxTex = keep(itemBoxTexture());
  const boxMat = keep(new THREE.MeshLambertMaterial({ map: boxTex, emissive: 0x7c2d12, emissiveIntensity: 0.35 }));
  const boxGeo = keep(new THREE.BoxGeometry(1.5, 1.5, 1.5));
  const boxes = new THREE.InstancedMesh(boxGeo, boxMat, track.boxX.length);
  boxes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(boxes);
  const boxZ = new Float32Array(track.boxX.length);
  {
    const hitK = (x: number, y: number) => {
      let best = 0;
      let bd = Infinity;
      for (let k = 0; k < track.count; k += 2) {
        const d = (x - track.px[k]) ** 2 + (y - track.py[k]) ** 2;
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
      return best;
    };
    for (let b = 0; b < track.boxX.length; b += 1) boxZ[b] = zAt(track, hitK(track.boxX[b], track.boxY[b]));
  }

  // ── Oil slicks ──
  const slickGeo = keep(new THREE.CircleGeometry(KART_RULES.slickRadius, 16));
  slickGeo.rotateX(-Math.PI / 2);
  const slickMat = keep(new THREE.MeshBasicMaterial({ color: 0x1e1036, transparent: true, opacity: 0.85 }));
  const slicks: THREE.Mesh[] = [];
  for (let i = 0; i < KART_RULES.maxSlicks; i += 1) {
    const m = new THREE.Mesh(slickGeo, slickMat);
    m.visible = false;
    scene.add(m);
    slicks.push(m);
  }

  // ── Trackside: trees, tire walls, cones, barriers, grandstand ──
  const rngO = createRng(23);
  const tooClose = (x: number, y: number, r: number) => sample(x, y).dist < r;
  {
    const trunkGeo = keep(new THREE.CylinderGeometry(0.25, 0.35, 2, 6));
    const crownGeo = keep(new THREE.ConeGeometry(1.8, 4.5, 7));
    const roundGeo = keep(new THREE.IcosahedronGeometry(2.1, 0));
    const trunkMat = keep(new THREE.MeshLambertMaterial({ color: 0x7c4a1e, flatShading: true }));
    const pineMat = keep(new THREE.MeshLambertMaterial({ color: 0x166534, flatShading: true }));
    const oakMat = keep(new THREE.MeshLambertMaterial({ color: 0x3f7d20, flatShading: true }));
    const N = 260;
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, N);
    const pines = new THREE.InstancedMesh(crownGeo, pineMat, N);
    const oaks = new THREE.InstancedMesh(roundGeo, oakMat, N);
    let nP = 0;
    let nO = 0;
    let placed = 0;
    for (let tries = 0; placed < N && tries < N * 8; tries += 1) {
      const x = minX - margin * 0.8 + nextRandom(rngO) * (tw - margin * 0.4);
      const y = minY - margin * 0.8 + nextRandom(rngO) * (th - margin * 0.4);
      if (tooClose(x, y, hw + KART_RULES.wallOutside + 6)) continue;
      const g = sample(x, y).z - 0.3 + Math.sin(x * 0.03) * Math.cos(y * 0.025) * 2.5;
      const sc = 0.7 + nextRandom(rngO) * 0.8;
      s3.set(sc, sc, sc);
      q.setFromAxisAngle(up, nextRandom(rngO) * Math.PI * 2);
      trunks.setMatrixAt(placed, m4.compose(v3.set(x, g + sc, -y), q, s3));
      if (nextRandom(rngO) < 0.55) {
        pines.setMatrixAt(nP, m4.compose(v3.set(x, g + sc * 4, -y), q, s3));
        nP += 1;
      } else {
        oaks.setMatrixAt(nO, m4.compose(v3.set(x, g + sc * 3.4, -y), q, s3));
        nO += 1;
      }
      placed += 1;
    }
    trunks.count = placed;
    pines.count = nP;
    oaks.count = nO;
    scene.add(trunks, pines, oaks);
    s3.set(1, 1, 1);

    // Tire walls on the outside of the tighter corners.
    const tireGeo = keep(new THREE.TorusGeometry(0.42, 0.2, 5, 10));
    tireGeo.rotateX(Math.PI / 2);
    const tireMatA = keep(new THREE.MeshLambertMaterial({ color: 0x18181b, flatShading: true }));
    const tireMatB = keep(new THREE.MeshLambertMaterial({ color: 0xf4f4f5, flatShading: true }));
    const TW = 700;
    const tiresA = new THREE.InstancedMesh(tireGeo, tireMatA, TW);
    const tiresB = new THREE.InstancedMesh(tireGeo, tireMatB, TW);
    let na = 0;
    let nb = 0;
    const coneGeo = keep(new THREE.ConeGeometry(0.28, 0.8, 8));
    const coneMat = keep(new THREE.MeshLambertMaterial({ color: 0xf97316, flatShading: true }));
    const CN = 160;
    const cones = new THREE.InstancedMesh(coneGeo, coneMat, CN);
    let nc = 0;
    for (let k = 0; k < track.count; k += 3) {
      const k2 = (k + 6) % track.count;
      const turn = track.tx[k] * track.ty[k2] - track.ty[k] * track.tx[k2]; // + = left turn
      if (Math.abs(turn) < 0.12) continue;
      const outside = turn > 0 ? -1 : 1; // outside of the corner
      const nx = -track.ty[k] * outside;
      const ny = track.tx[k] * outside;
      const off = hw + KART_RULES.wallOutside - 0.6;
      const bx = track.px[k] + nx * off;
      const by = track.py[k] + ny * off;
      const gz = zAt(track, k);
      for (let level = 0; level < 3; level += 1) {
        const mesh = (k / 3 + level) % 2 ? tiresA : tiresB;
        const i = mesh === tiresA ? na : nb;
        if (i >= TW) continue;
        mesh.setMatrixAt(i, m4.compose(v3.set(bx, gz + 0.2 + level * 0.4, -by), q.identity(), s3));
        if (mesh === tiresA) na += 1;
        else nb += 1;
      }
      // Apex cones on the inside curb.
      if (k % 12 === 0 && nc < CN) {
        const ix = track.px[k] - nx * (hw + KART_RULES.curbWidth + 0.6);
        const iy = track.py[k] - ny * (hw + KART_RULES.curbWidth + 0.6);
        cones.setMatrixAt(nc, m4.compose(v3.set(ix, gz + 0.4, -iy), q.identity(), s3));
        nc += 1;
      }
    }
    tiresA.count = na;
    tiresB.count = nb;
    cones.count = nc;
    scene.add(tiresA, tiresB, cones);

    // Armco barrier along the start straight, both sides.
    const railGeo = keep(new THREE.BoxGeometry(2.1, 0.5, 0.12));
    const railMat = keep(new THREE.MeshLambertMaterial({ color: 0xd4d4d8, flatShading: true }));
    const RN = 220;
    const rails = new THREE.InstancedMesh(railGeo, railMat, RN);
    let nr = 0;
    const straight = Math.round(track.count * 0.08);
    for (let i = -straight; i < straight && nr < RN - 1; i += 1) {
      const k = (i + track.count) % track.count;
      for (const sgn of [-1, 1]) {
        const off = sgn * (hw + KART_RULES.curbWidth + 2.5);
        const rx = track.px[k] - track.ty[k] * off;
        const ry = track.py[k] + track.tx[k] * off;
        q.setFromAxisAngle(up, Math.atan2(track.ty[k], track.tx[k]));
        rails.setMatrixAt(nr, m4.compose(v3.set(rx, zAt(track, k) + 0.55, -ry), q, s3));
        nr += 1;
      }
    }
    rails.count = nr;
    scene.add(rails);

    // Grandstand facing the start line.
    const k = Math.round(track.count * 0.015);
    const nx = -track.ty[k];
    const ny = track.tx[k];
    const off = hw + KART_RULES.wallOutside + 7;
    const gx = track.px[k] + nx * off;
    const gy = track.py[k] + ny * off;
    const stand = new THREE.Group();
    const stepMat = keep(new THREE.MeshLambertMaterial({ color: 0x71717a, flatShading: true }));
    const crowdMat = keep(new THREE.MeshLambertMaterial({ map: keep(crowdTexture()) }));
    for (let r = 0; r < 5; r += 1) {
      const step = new THREE.Mesh(keep(new THREE.BoxGeometry(26, 0.8, 2)), stepMat);
      step.position.set(0, 0.4 + r * 0.8, -r * 2);
      stand.add(step);
      const crowd = new THREE.Mesh(keep(new THREE.PlaneGeometry(26, 0.7)), crowdMat);
      crowd.position.set(0, 1.15 + r * 0.8, -r * 2 + 0.6);
      stand.add(crowd);
    }
    const roof = new THREE.Mesh(keep(new THREE.BoxGeometry(28, 0.3, 11)), keep(new THREE.MeshLambertMaterial({ color: 0xf97316, flatShading: true })));
    roof.position.set(0, 7.5, -4);
    roof.rotation.x = 0.08;
    stand.add(roof);
    for (const px of [-13, 13]) {
      const pole = new THREE.Mesh(keep(new THREE.BoxGeometry(0.4, 7.5, 0.4)), stepMat);
      pole.position.set(px, 3.75, -8.5);
      stand.add(pole);
    }
    stand.position.set(gx, zAt(track, k), -gy);
    // Face the track (local +Z toward the road).
    stand.rotation.y = Math.atan2(-nx, ny);
    scene.add(stand);
  }

  // ── Kart + blob shadow ──
  const kart = buildKart(0xf97316);
  scene.add(kart.root);
  const shadow = new THREE.Mesh(
    keep(new THREE.CircleGeometry(1.6, 16)),
    keep(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false })),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(0.8, 1.25, 1);
  scene.add(shadow);

  // ── Smoke (instanced billboards) + skid marks (line segments) ──
  const smokeMat = keep(
    new THREE.SpriteMaterial({ map: keep(smokeTexture()), color: 0xf4f4f5, transparent: true, depthWrite: false }),
  );
  const smoke: THREE.Sprite[] = [];
  const smokeLife = new Float32Array(SMOKE_MAX);
  for (let i = 0; i < SMOKE_MAX; i += 1) {
    const sp = new THREE.Sprite(smokeMat.clone());
    keep(sp.material);
    sp.visible = false;
    scene.add(sp);
    smoke.push(sp);
  }
  let smokeNext = 0;
  const skidPos = new Float32Array(SKID_MAX * 2 * 3);
  const skidGeo = keep(new THREE.BufferGeometry());
  skidGeo.setAttribute("position", new THREE.BufferAttribute(skidPos, 3).setUsage(THREE.DynamicDrawUsage));
  skidGeo.setDrawRange(0, 0);
  const skids = new THREE.LineSegments(skidGeo, keep(new THREE.LineBasicMaterial({ color: 0x18181b, transparent: true, opacity: 0.6 })));
  skids.frustumCulled = false;
  scene.add(skids);
  let skidHead = 0;
  let skidCount = 0;
  const lastL = { x: 0, y: 0, z: 0, ok: false };
  const lastR = { x: 0, y: 0, z: 0, ok: false };
  const pushSkid = (prev: typeof lastL, x: number, y: number, z: number) => {
    if (prev.ok) {
      const o = skidHead * 6;
      skidPos[o] = prev.x;
      skidPos[o + 1] = prev.z + 0.1;
      skidPos[o + 2] = -prev.y;
      skidPos[o + 3] = x;
      skidPos[o + 4] = z + 0.1;
      skidPos[o + 5] = -y;
      skidHead = (skidHead + 1) % SKID_MAX;
      skidCount = Math.min(SKID_MAX, skidCount + 1);
    }
    prev.x = x;
    prev.y = y;
    prev.z = z;
    prev.ok = true;
  };

  // ── Per-frame state (preallocated) ──
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const want = new THREE.Vector3();
  const look = new THREE.Vector3();
  let camInit = false;
  let wheelSpin = 0;
  let roll = 0;
  let pitch = 0;
  let lastNextGate = -1;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function draw(w: KartWorld, frameDt: number) {
    const car = w.car;
    const k = w.hit.index;
    const h = zAt(track, k);
    const speed = Math.hypot(car.vx, car.vy);
    const beta = driftAngle(car);
    const yaw = car.heading;

    // Kart pose: yaw, slope pitch, body roll/pitch from accelerations.
    const along = Math.cos(yaw) * track.tx[k] + Math.sin(yaw) * track.ty[k];
    const slope = Math.atan(track.grade[k] * along);
    const ease = 1 - Math.exp(-frameDt * 8);
    // Lean to the outside of the turn (ay > 0 = turning left → left side up).
    roll += (Math.max(-0.12, Math.min(0.12, car.ay * 0.012)) - roll) * ease;
    pitch += (Math.max(-0.08, Math.min(0.08, car.ax * 0.008)) - pitch) * ease;
    kart.root.position.set(car.x, h + 0.02, -car.y);
    kart.root.rotation.set(0, 0, 0);
    // Model faces local +Z; sim heading 0 = east (+X), CCW positive.
    kart.root.rotateY(yaw + Math.PI / 2);
    kart.root.rotateX(-slope);
    kart.body.rotation.set(-pitch, 0, roll);
    wheelSpin += (car.vx / 0.3) * frameDt;
    for (const wheel of kart.wheels) wheel.rotation.x = wheelSpin;
    for (const p of kart.frontPivots) p.rotation.y = car.steer;
    kart.flame.visible = w.turboTicks > 0;
    if (kart.flame.visible) kart.flame.scale.set(1, 0.7 + ((w.tick % 6) / 6) * 0.8, 1);
    shadow.position.set(car.x, h + 0.04, -car.y);
    shadow.rotation.z = yaw + Math.PI / 2;

    // Gate highlight: next gate glows gold.
    if (w.nextGate !== lastNextGate) {
      for (let g = 0; g < gateMats.length; g += 1) {
        const next = g === w.nextGate;
        gateMats[g].color.setHex(next ? 0xfacc15 : g === 0 ? 0xf4f4f5 : 0xa1a1aa);
        gateMats[g].emissive.setHex(next ? 0x854d0e : 0x000000);
      }
      lastNextGate = w.nextGate;
    }

    // Item boxes: spin + bob, hidden while respawning.
    const bob = Math.sin(w.tick / 20) * 0.25;
    for (let b = 0; b < track.boxX.length; b += 1) {
      const live = w.boxCooldown[b] <= 0;
      q.setFromAxisAngle(up, w.tick / 40 + b);
      s3.setScalar(live ? 1 : 0.0001);
      boxes.setMatrixAt(b, m4.compose(v3.set(track.boxX[b], boxZ[b] + 1.3 + bob, -track.boxY[b]), q, s3));
    }
    s3.setScalar(1);
    boxes.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < slicks.length; i += 1) {
      const on = !!w.slickActive[i];
      slicks[i].visible = on;
      if (on) slicks[i].position.set(w.slickX[i], h + 0.08, -w.slickY[i]);
    }

    // Smoke + skids while sliding.
    const ch = Math.cos(yaw);
    const sh = Math.sin(yaw);
    const rx = car.x - ch * KART_LEN * 0.36;
    const ry = car.y - sh * KART_LEN * 0.36;
    const sx = -sh * 0.86;
    const sy = ch * 0.86;
    const sliding = speed > 4 && (Math.abs(car.rearSlip) > 0.14 || car.driveUsage > 0.97 || w.slickedTicks > 0);
    if (sliding) {
      pushSkid(lastL, rx + sx, ry + sy, h);
      pushSkid(lastR, rx - sx, ry - sy, h);
      const sp = smoke[smokeNext];
      sp.position.set(rx + (Math.random() - 0.5), h + 0.4, -(ry + (Math.random() - 0.5)));
      sp.visible = true;
      smokeLife[smokeNext] = 1;
      smokeNext = (smokeNext + 1) % SMOKE_MAX;
    } else {
      lastL.ok = false;
      lastR.ok = false;
    }
    for (let i = 0; i < SMOKE_MAX; i += 1) {
      if (smokeLife[i] <= 0) continue;
      smokeLife[i] -= frameDt * 1.3;
      const sp = smoke[i];
      if (smokeLife[i] <= 0) {
        sp.visible = false;
        continue;
      }
      const life = smokeLife[i];
      const size = 0.8 + (1 - life) * 2.6;
      sp.scale.set(size, size, 1);
      sp.position.y += frameDt * 0.9;
      (sp.material as THREE.SpriteMaterial).opacity = life * 0.55;
    }
    skidGeo.setDrawRange(0, skidCount * 2);
    skidGeo.getAttribute("position").needsUpdate = true;

    // Chase camera: behind and above, swings with the drift, pulls back
    // and widens with speed.
    const camYaw = yaw + beta * 0.45;
    const back = 7.5 + Math.min(4, speed * 0.1);
    want.set(car.x - Math.cos(camYaw) * back, h + 3.4 + Math.min(1.5, speed * 0.03), -(car.y - Math.sin(camYaw) * back));
    look.set(car.x + Math.cos(yaw) * 5, h + 1.2, -(car.y + Math.sin(yaw) * 5));
    if (!camInit) {
      camPos.copy(want);
      camLook.copy(look);
      camInit = true;
    }
    const follow = 1 - Math.exp(-frameDt * 6);
    camPos.lerp(want, follow);
    camLook.lerp(look, 1 - Math.exp(-frameDt * 10));
    // Never dip under the road on crests.
    camPos.y = Math.max(camPos.y, h + 1.6);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    const fov = 60 + Math.min(14, speed * 0.35);
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov += (fov - camera.fov) * follow;
      camera.updateProjectionMatrix();
    }

    // Backdrop follows the camera (never reachable, never pops).
    if (skyDome) skyDome.position.set(camPos.x, 0, camPos.z);
    if (hillRing) hillRing.position.set(camPos.x, h, camPos.z);
    if (cloudLayer) cloudLayer.position.set(camPos.x * 0.6 + w.tick * 0.01, 0, camPos.z * 0.6);

    // Grass: warm tint via fog colour so "off track" reads at a glance.
    (scene.fog as THREE.Fog).color.setHex(w.surface === SURFACE_GRASS ? 0xd9c79a : FOG);

    renderer.render(scene, camera);
    canvas.dataset.apexKartDrawCalls = String(renderer.info.render.calls);
    canvas.dataset.apexKartTriangles = String(renderer.info.render.triangles);
  }

  resize();
  return {
    resize,
    draw,
    dispose() {
      for (const d of disposables) d.dispose();
      renderer.dispose();
    },
  };
}
