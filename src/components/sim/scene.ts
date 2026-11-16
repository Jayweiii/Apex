/**
 * Apex Sim renderer: the circuit at 1:1 on its surveyed terrain, lit by a
 * physical sky with shadows and reflections. Plain three.js, no React. The
 * world is built once; each frame moves the cars, effects and camera.
 */
import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { SURFACE_GRASS, SURFACE_ROAD, type Car, type CarSpec } from "@/lib/sim/car";
import type { GhostPose } from "@/lib/sim/ghost";
import { createPilot } from "@/lib/sim/session";
import { gridHeight, groundHeight, poseAt, projectOnTrack, type SimTrack, type TrackHit } from "@/lib/sim/track";
import { buildMiata, type CarModel } from "./miata";

export type CameraMode = "chase" | "cockpit" | "hood" | "orbit";
export const CAMERA_MODES: CameraMode[] = ["chase", "cockpit", "hood"];

export type SimView = {
  car: Car;
  /** Ghosts to draw this frame (null hides one): [real lap, your best]. */
  ghosts: Array<GhostPose | null>;
  camera: CameraMode;
};

export type SimScene = {
  resize: () => void;
  draw: (view: SimView, dt: number) => void;
  setPaint: (hex: string) => void;
  dispose: () => void;
  stats: () => { w: number; h: number; calls: number; tris: number };
};

export type SceneOptions = { paint: string; lowPower: boolean };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Speckled fill: many small dots of random brightness around a base colour. */
function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, rand: () => number, base: [number, number, number], spread: number, count: number, size: number): void {
  ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < count; i += 1) {
    const k = (rand() - 0.5) * 2 * spread;
    ctx.fillStyle = `rgba(${clamp(base[0] + k, 0, 255)},${clamp(base[1] + k, 0, 255)},${clamp(base[2] + k, 0, 255)},${0.35 + rand() * 0.5})`;
    const s = size * (0.5 + rand());
    ctx.fillRect(rand() * w, rand() * h, s, s);
  }
}

function roadTextures(rand: () => number): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const W = 512;
  const H = 512;
  const map = canvasTexture(W, H, (ctx) => {
    speckle(ctx, W, H, rand, [58, 58, 60], 16, 26000, 2.2);
    // Rubbered-in racing line down the middle, patchy tar seams, painted edges.
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0.18, "rgba(0,0,0,0)");
    g.addColorStop(0.5, "rgba(0,0,0,0.3)");
    g.addColorStop(0.82, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(18,18,20,0.55)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 5; i += 1) {
      ctx.beginPath();
      let x = rand() * W;
      ctx.moveTo(x, 0);
      for (let y = 0; y <= H; y += 32) {
        x += (rand() - 0.5) * 26;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(236,236,228,0.92)";
    ctx.fillRect(W * 0.018, 0, W * 0.022, H);
    ctx.fillRect(W * 0.96, 0, W * 0.022, H);
  });
  const bump = canvasTexture(256, 256, (ctx) => speckle(ctx, 256, 256, rand, [128, 128, 128], 90, 16000, 2), false);
  return { map, bump };
}

function grassTexture(rand: () => number): THREE.CanvasTexture {
  return canvasTexture(256, 256, (ctx) => {
    speckle(ctx, 256, 256, rand, [150, 150, 150], 60, 14000, 2.6);
    ctx.globalAlpha = 0.35;
    for (let i = 0; i < 2400; i += 1) {
      ctx.strokeStyle = rand() > 0.5 ? "#ffffff" : "#5a5a5a";
      const x = rand() * 256;
      const y = rand() * 256;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rand() - 0.5) * 3, y - 2 - rand() * 5);
      ctx.stroke();
    }
  });
}

function checkerTexture(): THREE.CanvasTexture {
  return canvasTexture(64, 16, (ctx) => {
    for (let y = 0; y < 2; y += 1) for (let x = 0; x < 8; x += 1) {
      ctx.fillStyle = (x + y) % 2 ? "#101010" : "#f4f4f0";
      ctx.fillRect(x * 8, y * 8, 8, 8);
    }
  });
}

function blobTexture(): THREE.CanvasTexture {
  return canvasTexture(64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(0.5, "rgba(255,255,255,0.35)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
}

function boardTexture(text: string): THREE.CanvasTexture {
  return canvasTexture(64, 96, (ctx) => {
    ctx.fillStyle = "#f4f4ee";
    ctx.fillRect(0, 0, 64, 96);
    ctx.fillStyle = "#111";
    ctx.font = "bold 78px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 32, 52);
  });
}

const SMOKE = 90;
const SKID_QUADS = 1400;

export function createSimScene(canvas: HTMLCanvasElement, track: SimTrack, spec: CarSpec, opts: SceneOptions): SimScene {
  const rand = rng(90210);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !opts.lowPower, powerPreference: "high-performance" });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.5;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, 1, 0.08, 9000);
  const owned: Array<{ dispose: () => void }> = [];
  const keep = <T extends { dispose: () => void }>(v: T): T => {
    owned.push(v);
    return v;
  };
  /** Sim metres (east, north, up) → three.js (x, y up, z south). */
  const P = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);

  // ── Sky, sun and reflections ──
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 40), THREE.MathUtils.degToRad(215));
  const sky = new Sky();
  sky.scale.setScalar(8000);
  const su = sky.material.uniforms;
  su.turbidity!.value = 2.2;
  su.rayleigh!.value = 0.9;
  su.mieCoefficient!.value = 0.003;
  su.mieDirectionalG!.value = 0.8;
  su.sunPosition!.value.copy(sunDir);
  scene.add(sky);
  keep(sky.geometry);
  keep(sky.material);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(1000);
  envSky.material.uniforms.sunPosition!.value.copy(sunDir);
  for (const key of ["turbidity", "rayleigh", "mieCoefficient", "mieDirectionalG"] as const) envSky.material.uniforms[key]!.value = su[key]!.value;
  envScene.add(envSky);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 24), new THREE.MeshBasicMaterial({ color: 0x6f6a4a }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -2;
  envScene.add(ground);
  const env = keep(pmrem.fromScene(envScene, 0.02));
  scene.environment = env.texture;
  scene.environmentIntensity = 0.6;
  envSky.geometry.dispose();
  envSky.material.dispose();
  ground.geometry.dispose();
  (ground.material as THREE.Material).dispose();
  pmrem.dispose();
  const haze = new THREE.Color(0xa9bccb);
  scene.fog = new THREE.FogExp2(haze, 0.00032);

  const sun = new THREE.DirectionalLight(0xfff1dc, 3.4);
  sun.castShadow = true;
  const shadowSize = opts.lowPower ? 1024 : 2048;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  const SH = 26;
  sun.shadow.camera.left = -SH;
  sun.shadow.camera.right = SH;
  sun.shadow.camera.top = SH;
  sun.shadow.camera.bottom = -SH;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 260;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xcfe2ff, 0x7a6a44, 0.55));

  // ── Terrain: the surveyed grid, eased to road height beside the track ──
  const g = track.data.grid;
  let bx0 = Infinity;
  let bx1 = -Infinity;
  let by0 = Infinity;
  let by1 = -Infinity;
  for (let i = 0; i < track.n; i += 1) {
    bx0 = Math.min(bx0, track.px[i]!);
    bx1 = Math.max(bx1, track.px[i]!);
    by0 = Math.min(by0, track.py[i]!);
    by1 = Math.max(by1, track.py[i]!);
  }
  const margin = 420;
  const tx0 = bx0 - margin;
  const tx1 = bx1 + margin;
  const ty0 = by0 - margin;
  const ty1 = by1 + margin;
  const cell = opts.lowPower ? 9 : 6;
  const nx = Math.ceil((tx1 - tx0) / cell) + 1;
  const ny = Math.ceil((ty1 - ty0) / cell) + 1;
  const nearest = (x: number, y: number, hit: TrackHit): void => {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < track.n; i += 6) {
      const dx = x - track.px[i]!;
      const dy = y - track.py[i]!;
      const d2 = dx * dx + dy * dy;
      if (d2 < bd) {
        bd = d2;
        best = i;
      }
    }
    hit.i = best;
    projectOnTrack(track, x, y, hit);
  };
  const terrainHeight = (x: number, y: number, hit: TrackHit): number => {
    nearest(x, y, hit);
    return groundHeight(track, x, y, hit);
  };
  {
    const pos = new Float32Array(nx * ny * 3);
    const col = new Float32Array(nx * ny * 3);
    const uv = new Float32Array(nx * ny * 2);
    const hit: TrackHit = { i: 0, s: 0, d: 0 };
    const dry = new THREE.Color(0xb49a52);
    const green = new THREE.Color(0x6f7d3a);
    const mown = new THREE.Color(0x7f8a45);
    const c = new THREE.Color();
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const x = tx0 + i * cell;
        const y = ty0 + j * cell;
        let h = terrainHeight(x, y, hit);
        const d = Math.abs(hit.d);
        // Under the road and kerb the terrain sits just below them.
        if (d < track.halfWidth + track.kerb + 1.5) h -= 0.25;
        else h -= 0.03;
        const k = (j * nx + i) * 3;
        pos[k] = x;
        pos[k + 1] = h;
        pos[k + 2] = -y;
        const patch = 0.5 + 0.5 * Math.sin(x * 0.011 + Math.sin(y * 0.017) * 2.1) * Math.cos(y * 0.009 + x * 0.004);
        c.copy(dry).lerp(green, clamp(patch * 0.75 + (rand() - 0.5) * 0.15, 0, 1));
        c.lerp(mown, clamp(1 - (d - 8) / 30, 0, 1) * 0.8);
        col[k] = c.r;
        col[k + 1] = c.g;
        col[k + 2] = c.b;
        uv[(j * nx + i) * 2] = x / 7;
        uv[(j * nx + i) * 2 + 1] = y / 7;
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < ny - 1; j += 1) for (let i = 0; i < nx - 1; i += 1) {
      const a = j * nx + i;
      idx.push(a, a + 1, a + nx, a + 1, a + nx + 1, a + nx);
    }
    const geo = keep(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = keep(new THREE.MeshStandardMaterial({ map: keep(grassTexture(rand)), vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 0.25 }));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    scene.add(mesh);
    // Flat plain out to the horizon, and a far ridge line.
    const edgeH = g ? (gridHeight(track, tx0, ty0) ?? 0) : 0;
    const plain = new THREE.Mesh(keep(new THREE.CircleGeometry(8500, 48)), keep(new THREE.MeshStandardMaterial({ color: 0xa8955a, roughness: 1 })));
    plain.rotation.x = -Math.PI / 2;
    plain.position.set((tx0 + tx1) / 2, Math.min(edgeH, 0) - 6, -(ty0 + ty1) / 2);
    scene.add(plain);
    const ridgePos: number[] = [];
    const ridgeIdx: number[] = [];
    const SEG = 120;
    for (let i = 0; i <= SEG; i += 1) {
      const a = (i / SEG) * Math.PI * 2;
      const r = 5200;
      const hgt = 150 + 190 * Math.abs(Math.sin(a * 3.1 + 1)) * (0.5 + 0.5 * Math.sin(a * 7.3)) + 140 * Math.max(0, Math.cos(a - 3.3));
      ridgePos.push(Math.cos(a) * r, -20, Math.sin(a) * r, Math.cos(a) * r, hgt, Math.sin(a) * r);
      if (i < SEG) ridgeIdx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const ridgeGeo = keep(new THREE.BufferGeometry());
    ridgeGeo.setAttribute("position", new THREE.Float32BufferAttribute(ridgePos, 3));
    ridgeGeo.setIndex(ridgeIdx);
    const ridge = new THREE.Mesh(ridgeGeo, keep(new THREE.MeshBasicMaterial({ color: 0x8fa3b4, side: THREE.DoubleSide, fog: false })));
    scene.add(ridge);
  }

  // ── Road, kerbs and verge ──
  const n = track.n;
  const strip = (inner: number, outer: number, side: number, lift: number, drop: number, color: (i: number) => THREE.Color | null, uvScale: number | null) => {
    const pos = new Float32Array((n + 1) * 2 * 3);
    const col = new Float32Array((n + 1) * 2 * 3);
    const uv = new Float32Array((n + 1) * 2 * 2);
    const idx: number[] = [];
    for (let k = 0; k <= n; k += 1) {
      const i = k % n;
      const nxn = -track.ty[i]! * side;
      const nyn = track.tx[i]! * side;
      const z = track.pz[i]!;
      for (let e = 0; e < 2; e += 1) {
        const off = e === 0 ? inner : outer;
        const v = (k * 2 + e) * 3;
        pos[v] = track.px[i]! + nxn * off;
        pos[v + 1] = z + lift - (e === 1 ? drop : 0);
        pos[v + 2] = -(track.py[i]! + nyn * off);
        const c = color(i);
        col[v] = c ? c.r : 1;
        col[v + 1] = c ? c.g : 1;
        col[v + 2] = c ? c.b : 1;
        if (uvScale !== null) {
          uv[(k * 2 + e) * 2] = e === 0 ? 0.5 : side > 0 ? 0 : 1;
          uv[(k * 2 + e) * 2 + 1] = (k * track.spacing) / uvScale;
        } else {
          uv[(k * 2 + e) * 2] = pos[v]! / 7;
          uv[(k * 2 + e) * 2 + 1] = -pos[v + 2]! / 7;
        }
      }
      if (k < n) {
        const a = k * 2;
        if (side > 0) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = keep(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  };
  const roadTex = roadTextures(rand);
  keep(roadTex.map);
  keep(roadTex.bump);
  roadTex.bump.repeat.set(6, 6);
  const roadMat = keep(new THREE.MeshStandardMaterial({ map: roadTex.map, bumpMap: roadTex.bump, bumpScale: 0.6, roughness: 0.95, metalness: 0, envMapIntensity: 0.12 }));
  for (const side of [1, -1]) {
    const road = new THREE.Mesh(strip(0, track.halfWidth, side, 0.02, 0, () => null, 9), roadMat);
    road.receiveShadow = true;
    scene.add(road);
  }
  // Kerbs are striped where the road bends and plain concrete elsewhere.
  const bend = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    let m = 0;
    for (let o = -18; o <= 18; o += 3) m = Math.max(m, Math.abs(track.curv[(i + o + n) % n]!));
    bend[i] = m;
  }
  const red = new THREE.Color(0xb3211c);
  const white = new THREE.Color(0xe9e7df);
  const concrete = new THREE.Color(0x8d8a82);
  const kerbMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, envMapIntensity: 0.4 }));
  const vergeMat = keep(new THREE.MeshStandardMaterial({ map: keep(grassTexture(rand)), color: 0x7f8a45, roughness: 1, envMapIntensity: 0.25 }));
  for (const side of [1, -1]) {
    const kerb = new THREE.Mesh(
      strip(track.halfWidth, track.halfWidth + track.kerb, side, 0.03, 0.05, (i) => (bend[i]! > 0.0055 ? (Math.floor((i * track.spacing) / 2.2) % 2 ? red : white) : concrete), 4),
      kerbMat,
    );
    kerb.receiveShadow = true;
    scene.add(kerb);
    const verge = new THREE.Mesh(strip(track.halfWidth + track.kerb, track.halfWidth + track.kerb + 4.5, side, -0.02, 0.02, () => null, null), vergeMat);
    verge.receiveShadow = true;
    scene.add(verge);
  }
  // Start/finish line.
  {
    const p = poseAt(track, 0, 0);
    const line = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.2, track.halfWidth * 2)), keep(new THREE.MeshStandardMaterial({ map: keep(checkerTexture()), roughness: 0.8 })));
    (line.material as THREE.MeshStandardMaterial).map!.repeat.set(1, 3);
    line.rotation.order = "YXZ";
    line.rotation.set(-Math.PI / 2, p.heading, 0);
    line.position.copy(P(p.x, p.y, p.z + 0.035));
    line.receiveShadow = true;
    scene.add(line);
  }

  // ── Trackside: brake boards, cones at apexes, oaks on the hills ──
  const hitScratch: TrackHit = { i: 0, s: 0, d: 0 };
  {
    const pilot = createPilot(track, spec, 0.95);
    const postMat = keep(new THREE.MeshStandardMaterial({ color: 0x8b8b86, roughness: 0.7 }));
    const boardGeo = keep(new THREE.PlaneGeometry(0.7, 1.05));
    const postGeo = keep(new THREE.BoxGeometry(0.06, 1.3, 0.06));
    const boardMats = ["3", "2", "1"].map((t) => keep(new THREE.MeshStandardMaterial({ map: keep(boardTexture(t)), roughness: 0.7, side: THREE.DoubleSide })));
    // Slowest point of each heavy braking zone.
    for (let i = 0; i < n; i += 1) {
      const v = pilot.target[i]!;
      const prev = pilot.target[(i - 1 + n) % n]!;
      const next = pilot.target[(i + 1) % n]!;
      if (!(v <= prev && v < next)) continue;
      let top = v;
      for (let o = 1; o < 260; o += 1) top = Math.max(top, pilot.target[(i - o + n) % n]!);
      if (top - v < 11) continue;
      const side = track.curv[i]! > 0 ? -1 : 1;
      [150, 100, 50].forEach((dist, b) => {
        const p = poseAt(track, i * track.spacing - dist - 25, side * (track.halfWidth + track.kerb + 1.6));
        const grp = new THREE.Group();
        const board = new THREE.Mesh(boardGeo, boardMats[b]!);
        board.position.y = 1.45;
        board.castShadow = true;
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.y = 0.65;
        grp.add(board, post);
        grp.position.copy(P(p.x, p.y, p.z));
        grp.rotation.y = p.heading - Math.PI / 2;
        scene.add(grp);
      });
    }
    // Cones on the inside of the tighter apexes.
    const cones: THREE.Matrix4[] = [];
    for (let i = 0; i < n; i += 1) {
      const c = track.curv[i]!;
      const a = Math.abs(c);
      if (a < 0.014 || a < Math.abs(track.curv[(i - 1 + n) % n]!) || a <= Math.abs(track.curv[(i + 1) % n]!)) continue;
      for (const o of [-6, 0, 6]) {
        const p = poseAt(track, (i + o) * track.spacing, Math.sign(c) * (track.halfWidth + track.kerb + 0.5));
        cones.push(new THREE.Matrix4().setPosition(P(p.x, p.y, p.z + 0.22)));
      }
    }
    if (cones.length) {
      const cone = new THREE.InstancedMesh(keep(new THREE.ConeGeometry(0.16, 0.48, 10)), keep(new THREE.MeshStandardMaterial({ color: 0xf06a12, roughness: 0.6 })), cones.length);
      cones.forEach((m, i) => cone.setMatrixAt(i, m));
      cone.castShadow = true;
      scene.add(cone);
    }
    const trunkGeo = keep(new THREE.CylinderGeometry(0.28, 0.42, 3.2, 7));
    const crownGeo = keep(new THREE.IcosahedronGeometry(1, 1));
    const trunkMat = keep(new THREE.MeshStandardMaterial({ color: 0x4d3b2a, roughness: 1 }));
    const crownMat = keep(new THREE.MeshStandardMaterial({ color: 0x3f5527, roughness: 1, envMapIntensity: 0.2, flatShading: true }));
    const spots: Array<[number, number, number, number]> = [];
    for (let tries = 0; tries < 2600 && spots.length < (opts.lowPower ? 60 : 130); tries += 1) {
      const x = lerp(tx0 + 60, tx1 - 60, rand());
      const y = lerp(ty0 + 60, ty1 - 60, rand());
      nearest(x, y, hitScratch);
      if (Math.abs(hitScratch.d) < 55) continue;
      spots.push([x, y, groundHeight(track, x, y, hitScratch), 0.8 + rand() * 0.9]);
    }
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, spots.length * 3);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    spots.forEach(([x, y, z, s], i) => {
      m4.compose(P(x, y, z + 1.5 * s), q, new THREE.Vector3(s, s, s));
      trunks.setMatrixAt(i, m4);
      for (let b = 0; b < 3; b += 1) {
        const r = (2.6 + rand() * 1.4) * s;
        m4.compose(P(x + (rand() - 0.5) * 3 * s, y + (rand() - 0.5) * 3 * s, z + (3.6 + rand() * 1.6) * s), q, new THREE.Vector3(r, r * 0.72, r));
        crowns.setMatrixAt(i * 3 + b, m4);
      }
    });
    trunks.castShadow = true;
    crowns.castShadow = true;
    scene.add(trunks, crowns);
  }

  // ── Cars ──
  const player: CarModel = buildMiata(spec, opts.paint);
  player.group.rotation.order = "YZX";
  scene.add(player.group);
  const ghostModels: CarModel[] = [buildMiata(spec, "#9fd8ff", { ghost: true }), buildMiata(spec, "#ffffff", { ghost: true })];
  ghostModels.forEach((m, i) => {
    m.group.visible = false;
    m.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && i === 1) {
        const mat = (mesh.material as THREE.MeshBasicMaterial).clone();
        mat.color.set(0xffe9a8);
        mesh.material = keep(mat);
      }
    });
    scene.add(m.group);
  });

  // ── Tyre smoke and skid marks ──
  const blob = keep(blobTexture());
  const smoke: Array<{ sprite: THREE.Sprite; life: number; max: number; vx: number; vy: number; vz: number; grow: number }> = [];
  for (let i = 0; i < SMOKE; i += 1) {
    const sprite = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: blob, transparent: true, opacity: 0, depthWrite: false, color: 0xdddddd })));
    sprite.visible = false;
    scene.add(sprite);
    smoke.push({ sprite, life: 0, max: 1, vx: 0, vy: 0, vz: 0, grow: 1 });
  }
  let smokeNext = 0;
  const puff = (x: number, y: number, z: number, dust: boolean, strength: number) => {
    const p = smoke[smokeNext]!;
    smokeNext = (smokeNext + 1) % SMOKE;
    p.sprite.position.copy(P(x, y, z + 0.15));
    p.sprite.scale.setScalar(0.5 + strength * 0.5);
    p.sprite.visible = true;
    p.sprite.material.color.set(dust ? 0xb39c6b : 0xe4e4e4);
    p.life = p.max = dust ? 1.1 : 1.6;
    p.vx = (rand() - 0.5) * 0.8;
    p.vy = (rand() - 0.5) * 0.8;
    p.vz = 0.5 + rand() * 0.7;
    p.grow = dust ? 2.2 : 3.2;
  };
  const skidPos = new Float32Array(SKID_QUADS * 4 * 3);
  const skidIdx: number[] = [];
  for (let i = 0; i < SKID_QUADS; i += 1) skidIdx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2);
  const skidGeo = keep(new THREE.BufferGeometry());
  skidGeo.setAttribute("position", new THREE.BufferAttribute(skidPos, 3));
  skidGeo.setIndex(skidIdx);
  const skids = new THREE.Mesh(skidGeo, keep(new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 })));
  skids.frustumCulled = false;
  scene.add(skids);
  let skidNext = 0;
  const skidLast: Array<{ on: boolean; lx: number; ly: number; lz: number; rx: number; ry: number; rz: number }> = [0, 1, 2, 3].map(() => ({ on: false, lx: 0, ly: 0, lz: 0, rx: 0, ry: 0, rz: 0 }));

  // ── Per-frame ──
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  let camHeading = 0;
  let camInit = false;
  let orbitAngle = 2.4;
  let lastMode: CameraMode | null = null;
  const tmp = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const wheelOffsets: Array<[number, number]> = [
    [spec.wheelbase * (1 - spec.frontWeight), spec.trackFront / 2],
    [spec.wheelbase * (1 - spec.frontWeight), -spec.trackFront / 2],
    [-spec.wheelbase * spec.frontWeight, spec.trackRear / 2],
    [-spec.wheelbase * spec.frontWeight, -spec.trackRear / 2],
  ];
  const texel = (SH * 2) / shadowSize;

  const resize = () => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.lowPower ? 1.5 : 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();

  const draw = (view: SimView, dt: number) => {
    const car = view.car;
    const speed = Math.hypot(car.vx, car.vy);
    const ch = Math.cos(car.heading);
    const sh = Math.sin(car.heading);

    // Player car.
    player.group.position.copy(P(car.x, car.y, car.z));
    player.group.rotation.set(0, car.heading, car.slope);
    player.body.rotation.set(car.roll, 0, -car.pitch);
    player.body.position.y = -Math.abs(car.pitch) * 0.2;
    for (let w = 0; w < 4; w += 1) {
      const holder = player.wheels[w]!;
      holder.rotation.z -= car.omega[w]! * dt;
      if (w < 2) (holder.userData as { pivot: THREE.Group }).pivot.rotation.y = car.steer;
    }
    player.steeringWheel.rotation.z = -car.steer * spec.steeringRatio;
    player.brakeLights.emissiveIntensity = car.brake > 0.03 ? 3.2 : 0.25;

    // Ghosts.
    view.ghosts.forEach((gp, i) => {
      const m = ghostModels[i];
      if (!m) return;
      m.group.visible = !!gp;
      if (!gp) return;
      m.group.position.copy(P(gp.x, gp.y, gp.z));
      m.group.rotation.set(0, gp.heading, 0);
      for (const holder of m.wheels) holder.rotation.z -= (gp.speed / spec.tyreRadius) * dt;
    });

    // Smoke, dust and skid marks from what each tyre is doing.
    for (let w = 0; w < 4; w += 1) {
      const [ox, oy] = wheelOffsets[w]!;
      const wx = car.x + ox * ch - oy * sh;
      const wy = car.y + ox * sh + oy * ch;
      const slide = Math.abs(car.slipRatio[w]!) / spec.peakSlipRatio + Math.abs(car.slipAngle[w]!) / spec.peakSlipAngle;
      const surf = car.surface[w]!;
      const loaded = car.load[w]! > 400;
      if (surf === SURFACE_GRASS && speed > 6 && rand() < 0.5) puff(wx, wy, car.z, true, 1);
      else if (surf !== SURFACE_GRASS && loaded && slide > 2.1 && speed > 4 && rand() < Math.min(0.9, (slide - 2) * 0.5)) puff(wx, wy, car.z, false, Math.min(2, slide - 1.5));
      const mark = skidLast[w]!;
      const marking = surf === SURFACE_ROAD && loaded && slide > 1.7 && speed > 3;
      const half = 0.09;
      const lx = wx + sh * half;
      const ly = wy - ch * half;
      const rx = wx - sh * half;
      const ry = wy + ch * half;
      const z = car.z + 0.03;
      if (marking && mark.on) {
        const o = skidNext * 12;
        skidNext = (skidNext + 1) % SKID_QUADS;
        skidPos.set([mark.lx, mark.lz, -mark.ly, mark.rx, mark.rz, -mark.ry, lx, z, -ly, rx, z, -ry], o);
        skidGeo.attributes.position!.needsUpdate = true;
      }
      mark.on = marking;
      mark.lx = lx;
      mark.ly = ly;
      mark.lz = z;
      mark.rx = rx;
      mark.ry = ry;
      mark.rz = z;
    }
    for (const p of smoke) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.sprite.visible = false;
        continue;
      }
      const k = p.life / p.max;
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.z += p.vy * dt;
      p.sprite.position.y += p.vz * dt;
      p.sprite.scale.addScalar(p.grow * dt);
      p.sprite.material.opacity = 0.34 * k;
    }

    // Camera.
    fwd.set(ch, 0, -sh);
    if (lastMode !== view.camera) {
      camInit = false;
      lastMode = view.camera;
    }
    const cockpitView = view.camera === "cockpit" || view.camera === "hood";
    orbitAngle += dt * 0.25;
    for (const o of player.hideInCockpit) o.visible = view.camera !== "cockpit";
    if (view.camera === "orbit") {
      const r = 5.2;
      camera.position.copy(P(car.x + Math.cos(car.heading + orbitAngle) * r, car.y + Math.sin(car.heading + orbitAngle) * r, car.z + 1.25));
      camera.lookAt(P(car.x, car.y, car.z + 0.55));
      camera.fov = 42;
    } else if (!cockpitView) {
      // The chase camera swings round more slowly than the car, so slides show.
      let dh = car.heading - camHeading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      camHeading = camInit ? camHeading + dh * Math.min(1, dt * 5.5) : car.heading;
      const back = 5.4 + speed * 0.012;
      tmp.copy(P(car.x - Math.cos(camHeading) * back, car.y - Math.sin(camHeading) * back, car.z + 1.62));
      // Stay above the ground behind the car on hills.
      nearest(car.x - Math.cos(camHeading) * back, car.y - Math.sin(camHeading) * back, hitScratch);
      const floor = groundHeight(track, car.x - Math.cos(camHeading) * back, car.y - Math.sin(camHeading) * back, hitScratch) + 0.9;
      if (tmp.y < floor) tmp.y = floor;
      if (!camInit) camPos.copy(tmp);
      else camPos.lerp(tmp, Math.min(1, dt * 9));
      camLook.copy(P(car.x + ch * 2.4, car.y + sh * 2.4, car.z + 0.95));
      camera.position.copy(camPos);
      camera.lookAt(camLook);
      camera.fov = 56 + Math.min(10, speed * 0.16);
    } else {
      if (view.camera === "cockpit") camera.position.set(-0.76, 1.13, -0.345);
      else camera.position.set(0.62, 0.98, 0);
      player.body.updateWorldMatrix(true, false);
      camera.position.applyMatrix4(player.body.matrixWorld);
      // Look where the car is pointing, leaning into the corner a little.
      const lean = car.steer * 0.55;
      const lh = car.heading + lean;
      tmp.set(Math.cos(lh) * 20, Math.tan(car.slope) * 20 - 0.9, -Math.sin(lh) * 20).add(camera.position);
      camera.lookAt(tmp);
      camera.fov = view.camera === "cockpit" ? 68 : 60;
    }
    camInit = true;
    camera.updateProjectionMatrix();

    // Shadows follow the car, snapped to shadow texels so edges do not crawl.
    const cx = Math.round(car.x / texel) * texel;
    const cy = Math.round(car.y / texel) * texel;
    sun.target.position.copy(P(cx, cy, car.z));
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 120);
    sky.position.copy(camera.position);

    renderer.render(scene, camera);
  };

  return {
    resize,
    draw,
    setPaint: (hex: string) => player.setPaint(hex),
    dispose: () => {
      player.dispose();
      ghostModels.forEach((m) => m.dispose());
      for (const o of owned) o.dispose();
      renderer.dispose();
    },
    stats: () => ({ w: renderer.domElement.width, h: renderer.domElement.height, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }),
  };
}
