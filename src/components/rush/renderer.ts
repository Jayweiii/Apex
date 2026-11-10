/**
 * Apex Rush renderer: a low-resolution 3D scene scaled up with hard pixels.
 *
 * Plain three.js, no React. The scene is built once per track (terrain from
 * the real elevation grid, road ribbon, walls, props); each frame only moves
 * karts, particles and the camera.
 */
import * as THREE from "three";
import type { KartLook } from "@/lib/rush/garage";
import type { GhostPose } from "@/lib/rush/ghost";
import type { Kart } from "@/lib/rush/kart";
import type { RushTheme } from "@/lib/rush/levels";
import type { RaceWorld } from "@/lib/rush/race";
import { gridHeight, rushRng, trackSeed, type RushTrack } from "@/lib/rush/track";
import {
  arrowTexture,
  asphaltTexture,
  bannerTexture,
  blobTexture,
  boxTexture,
  buildKart,
  checkerTexture,
  crowdTexture,
  MeshBuilder,
  sunTexture,
  type KartModel,
} from "./models";

export type CameraMode = "chase" | "intro" | "orbit";

export type RushView = {
  world: RaceWorld;
  /** Ghost poses to draw this frame (null entries are hidden). */
  ghosts: Array<GhostPose | null>;
  camera: CameraMode;
  /** Seconds since the camera mode began (drives intro / orbit moves). */
  cameraT: number;
};

export type RushRenderer = {
  resize: () => void;
  draw: (view: RushView, dt: number) => void;
  /** Burst of confetti over the player (finish). */
  celebrate: () => void;
  dispose: () => void;
  /** Internal resolution, for tests and the debug readout. */
  size: () => { w: number; h: number; calls: number; tris: number };
};

const MAX_PARTICLES = 420;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function createRushRenderer(
  canvas: HTMLCanvasElement,
  track: RushTrack,
  theme: RushTheme,
  looks: KartLook[],
  ghostLooks: KartLook[],
): RushRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", alpha: false });
  renderer.setPixelRatio(1);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(theme.fog, 140, 900);
  scene.background = new THREE.Color(theme.fog);
  const camera = new THREE.PerspectiveCamera(64, 1, 0.3, 2600);
  const disposables: Array<{ dispose: () => void }> = [];
  const keep = <T extends { dispose: () => void }>(x: T): T => {
    disposables.push(x);
    return x;
  };
  const rand = rushRng(trackSeed(track));
  const n = track.n;
  const limit = track.halfWidth + track.runoff;
  // Game (x, y, height) → three (x, height, −y).
  const V = (x: number, y: number, z: number): number[] => [x, z, -y];

  // ── Lights ──
  scene.add(new THREE.HemisphereLight(theme.ambient, theme.grassB, 1.15));
  const sun = new THREE.DirectionalLight(theme.light, 1.9);
  sun.position.set(0.5, 0.8, 0.35);
  scene.add(sun);

  // ── Sky dome, sun, mountains, clouds (follow the camera) ──
  const sky = new THREE.Group();
  scene.add(sky);
  {
    const geo = keep(new THREE.SphereGeometry(2200, 16, 10));
    const top = new THREE.Color(theme.skyTop);
    const bottom = new THREE.Color(theme.skyBottom);
    const colors: number[] = [];
    const pos = geo.attributes.position!;
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i += 1) {
      const t = clamp(pos.getY(i) / 2200, 0, 1);
      // Banded gradient: a few flat steps, like a sprite backdrop.
      c.copy(bottom).lerp(top, Math.round(Math.pow(t, 0.7) * 7) / 7);
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const mat = keep(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    const dome = new THREE.Mesh(geo, mat);
    dome.renderOrder = -10;
    sky.add(dome);

    const sunGeo = keep(new THREE.PlaneGeometry(190, 190));
    const sunTex = keep(sunTexture(theme.sun));
    const sunMat = keep(new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, fog: false, depthWrite: false }));
    const disc = new THREE.Mesh(sunGeo, sunMat);
    disc.position.set(900, 620, -1500);
    disc.lookAt(0, 0, 0);
    disc.renderOrder = -9;
    sky.add(disc);

    // Two jagged mountain rings.
    for (const [radius, height, color, seedShift] of [
      [1900, 300, theme.mountainFar, 0],
      [1500, 190, theme.mountain, 7],
    ] as Array<[number, number, string, number]>) {
      const mb = new MeshBuilder();
      const segs = 72;
      const hs: number[] = [];
      for (let i = 0; i < segs; i += 1) {
        hs.push(height * (0.35 + 0.65 * Math.abs(Math.sin(i * 0.9 + seedShift) * Math.cos(i * 0.37 + seedShift * 2))) + rand() * height * 0.25);
      }
      for (let i = 0; i < segs; i += 1) {
        const a0 = (i / segs) * Math.PI * 2;
        const a1 = ((i + 1) / segs) * Math.PI * 2;
        const p0 = [Math.cos(a0) * radius, -40, Math.sin(a0) * radius];
        const p1 = [Math.cos(a1) * radius, -40, Math.sin(a1) * radius];
        const t0 = [p0[0]!, hs[i]!, p0[2]!];
        const t1 = [p1[0]!, hs[(i + 1) % segs]!, p1[2]!];
        mb.quad(p0, p1, t1, t0, color);
      }
      const g = keep(mb.build());
      const m = keep(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false, depthWrite: false }));
      const ring = new THREE.Mesh(g, m);
      ring.renderOrder = -8;
      sky.add(ring);
    }
    // Blocky clouds.
    const cb = new MeshBuilder();
    for (let i = 0; i < 16; i += 1) {
      const a = rand() * Math.PI * 2;
      const r = 900 + rand() * 700;
      const y = 380 + rand() * 260;
      const w = 120 + rand() * 160;
      const cx = Math.cos(a) * r;
      const cz = Math.sin(a) * r;
      for (let k = 0; k < 3; k += 1) {
        cb.box(cx + (k - 1) * w * 0.4, y + (k === 1 ? 18 : 0), cz, w * (k === 1 ? 0.7 : 0.5), 26 + (k === 1 ? 14 : 0), 60, "#ffffff");
      }
    }
    const cg = keep(cb.build());
    const cm = keep(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, transparent: true, opacity: 0.9, depthWrite: false }));
    const clouds = new THREE.Mesh(cg, cm);
    clouds.renderOrder = -7;
    sky.add(clouds);
  }

  // ── Terrain ──
  const xs = track.px;
  const ys = track.py;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i += 1) {
    minX = Math.min(minX, xs[i]!);
    maxX = Math.max(maxX, xs[i]!);
    minY = Math.min(minY, ys[i]!);
    maxY = Math.max(maxY, ys[i]!);
  }
  const margin = 420;
  minX -= margin;
  maxX += margin;
  minY -= margin;
  maxY += margin;
  const cell = 9;
  const gx = Math.ceil((maxX - minX) / cell) + 1;
  const gy = Math.ceil((maxY - minY) / cell) + 1;
  const terrainH = new Float32Array(gx * gy);
  const terrainD = new Float32Array(gx * gy);
  const hillNoise = (x: number, y: number) =>
    Math.sin(x * 0.011 + 1.3) * Math.cos(y * 0.013 - 0.4) * 9 + Math.sin(x * 0.027 + y * 0.021) * 4 + Math.cos(x * 0.004 - y * 0.006) * 14;
  // Distance to the track and the height of the nearest piece of road.
  const nearest = (x: number, y: number): [number, number] => {
    let best = Infinity;
    let bi = 0;
    for (let i = 0; i < n; i += 3) {
      const dx = x - xs[i]!;
      const dy = y - ys[i]!;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) {
        best = d2;
        bi = i;
      }
    }
    return [Math.sqrt(best), track.pz[bi]!];
  };
  for (let j = 0; j < gy; j += 1) {
    for (let i = 0; i < gx; i += 1) {
      const x = minX + i * cell;
      const y = minY + j * cell;
      const [d, roadZ] = nearest(x, y);
      const real = gridHeight(track, x, y);
      const far = real ?? roadZ + hillNoise(x, y) * smooth(30, 260, d);
      // Sunk under the road corridor, natural beyond it.
      const t = smooth(limit + 2, limit + 46, d);
      const edge = smooth(margin - 150, margin, Math.max(minX + margin - x, x - (maxX - margin), minY + margin - y, y - (maxY - margin)));
      terrainH[j * gx + i] = lerp(roadZ - 1.1, far + (real === null ? 0 : hillNoise(x, y) * 0.12), t) + edge * 46;
      terrainD[j * gx + i] = d;
    }
  }
  const terrainAt = (x: number, y: number): number => {
    const fx = clamp((x - minX) / cell, 0, gx - 1.001);
    const fy = clamp((y - minY) / cell, 0, gy - 1.001);
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const at = (a: number, b: number) => terrainH[b * gx + a]!;
    return at(ix, iy) * (1 - tx) * (1 - ty) + at(ix + 1, iy) * tx * (1 - ty) + at(ix, iy + 1) * (1 - tx) * ty + at(ix + 1, iy + 1) * tx * ty;
  };
  {
    const tb = new MeshBuilder();
    const cA = new THREE.Color(theme.grassA);
    const cB = new THREE.Color(theme.grassB);
    const cDirt = new THREE.Color(theme.dirt);
    const cRock = new THREE.Color(theme.rock);
    const c = new THREE.Color();
    for (let j = 0; j < gy - 1; j += 1) {
      for (let i = 0; i < gx - 1; i += 1) {
        const x0 = minX + i * cell;
        const y0 = minY + j * cell;
        const h00 = terrainH[j * gx + i]!;
        const h10 = terrainH[j * gx + i + 1]!;
        const h01 = terrainH[(j + 1) * gx + i]!;
        const h11 = terrainH[(j + 1) * gx + i + 1]!;
        if (terrainD[j * gx + i]! < limit - cell * 1.5) continue; // hidden under the road
        const slope = (Math.abs(h10 - h00) + Math.abs(h01 - h00) + Math.abs(h11 - h10)) / cell;
        // Patchwork of two greens, dirt on slopes, rock on steep faces.
        const patch = (Math.floor(x0 / 54) + Math.floor(y0 / 54)) % 2 === 0;
        c.copy(patch ? cA : cB);
        if (slope > 0.75) c.lerp(cDirt, 0.8);
        if (slope > 1.25) c.copy(cRock);
        c.multiplyScalar(0.94 + rand() * 0.12);
        tb.quad(V(x0, y0, h00), V(x0 + cell, y0, h10), V(x0 + cell, y0 + cell, h11), V(x0, y0 + cell, h01), c);
      }
    }
    const g = keep(tb.build());
    const m = keep(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    scene.add(new THREE.Mesh(g, m));
  }

  // ── Road ribbon: asphalt (textured) + curbs, verge and lines (vertex colours) ──
  const edge = (i: number, d: number, lift = 0): number[] => {
    const k = ((i % n) + n) % n;
    return V(xs[k]! - track.ty[k]! * d, ys[k]! + track.tx[k]! * d, track.pz[k]! + lift);
  };
  {
    const pos: number[] = [];
    const uv: number[] = [];
    const hw = track.halfWidth;
    for (let i = 0; i < n; i += 1) {
      const a = edge(i, hw, 0.02);
      const b = edge(i, -hw, 0.02);
      const c = edge(i + 1, -hw, 0.02);
      const d = edge(i + 1, hw, 0.02);
      const v0 = (i * track.spacing) / 6;
      const v1 = ((i + 1) * track.spacing) / 6;
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
      uv.push(0, v0, 2, v0, 2, v1, 0, v0, 2, v1, 0, v1);
    }
    const g = keep(new THREE.BufferGeometry());
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const tex = keep(asphaltTexture(rand));
    const m = keep(new THREE.MeshLambertMaterial({ map: tex }));
    scene.add(new THREE.Mesh(g, m));

    const rb = new MeshBuilder();
    const vergeA = new THREE.Color(theme.grassA).multiplyScalar(1.08);
    const vergeB = new THREE.Color(theme.grassB).multiplyScalar(1.08);
    for (let i = 0; i < n; i += 1) {
      const corner = Math.abs(track.curv[i]!) > 0.012;
      const stripe = Math.floor(i / 2) % 2 === 0;
      for (const s of [1, -1]) {
        const q = (d0: number, d1: number, lift: number, color: THREE.ColorRepresentation) => {
          const a = edge(i, s * d0, lift);
          const b = edge(i, s * d1, lift);
          const c = edge(i + 1, s * d1, lift);
          const d = edge(i + 1, s * d0, lift);
          if (s > 0) rb.quad(b, a, d, c, color);
          else rb.quad(a, b, c, d, color);
        };
        // White edge line, curb (corners only), striped verge.
        q(hw - 0.5, hw - 0.2, 0.035, "#e9ecef");
        q(hw, hw + 1, 0.05, corner ? (stripe ? "#e63946" : "#f8f9fa") : stripe ? vergeA : vergeB);
        q(hw + 1, limit + 0.6, 0.0, Math.floor(i / 6) % 2 === 0 ? vergeA : vergeB);
        // Wall: a low barrier, red/white through corners.
        const wallColor = corner ? (stripe ? "#d62828" : "#f1f3f5") : stripe ? "#adb5bd" : "#868e96";
        const a = edge(i, s * limit, 0);
        const b = edge(i + 1, s * limit, 0);
        const at = edge(i, s * limit, 1.0);
        const bt = edge(i + 1, s * limit, 1.0);
        if (s > 0) rb.quad(b, a, at, bt, wallColor);
        else rb.quad(a, b, bt, at, wallColor);
        const ao = edge(i, s * (limit + 0.5), 1.0);
        const bo = edge(i + 1, s * (limit + 0.5), 1.0);
        if (s > 0) rb.quad(bt, at, ao, bo, "#dee2e6");
        else rb.quad(at, bt, bo, ao, "#dee2e6");
      }
      // Centre dashes.
      if (i % 6 < 2) {
        const a = edge(i, 0.14, 0.04);
        const b = edge(i, -0.14, 0.04);
        const c = edge(i + 1, -0.14, 0.04);
        const d = edge(i + 1, 0.14, 0.04);
        rb.quad(a, b, c, d, "#ffe066");
      }
    }
    const rg = keep(rb.build());
    const rm = keep(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
    scene.add(new THREE.Mesh(rg, rm));

    // Start / finish line.
    const cpos: number[] = [];
    const cuv: number[] = [];
    const a = edge(0, hw, 0.045);
    const b = edge(0, -hw, 0.045);
    const c = edge(1, -hw, 0.045);
    const d = edge(1, hw, 0.045);
    cpos.push(...a, ...b, ...c, ...a, ...c, ...d);
    cuv.push(0, 0, 2, 0, 2, 1, 0, 0, 2, 1, 0, 1);
    const cgeo = keep(new THREE.BufferGeometry());
    cgeo.setAttribute("position", new THREE.Float32BufferAttribute(cpos, 3));
    cgeo.setAttribute("uv", new THREE.Float32BufferAttribute(cuv, 2));
    cgeo.computeVertexNormals();
    const ctex = keep(checkerTexture());
    scene.add(new THREE.Mesh(cgeo, keep(new THREE.MeshBasicMaterial({ map: ctex }))));
  }

  // ── Start gantry, grandstand, billboards ──
  {
    const heading = Math.atan2(track.ty[0]!, track.tx[0]!);
    const gantry = new THREE.Group();
    gantry.position.set(xs[0]!, track.pz[0]!, -ys[0]!);
    gantry.rotation.y = heading;
    const gb = new MeshBuilder();
    for (const z of [-limit - 0.4, limit + 0.4]) gb.box(0, 3.6, z, 0.6, 7.2, 0.6, "#495057");
    gb.box(0, 7.4, 0, 0.7, 0.5, limit * 2 + 1.4, "#343a40");
    const gg = keep(gb.build());
    gantry.add(new THREE.Mesh(gg, keep(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }))));
    const bannerTex = keep(bannerTexture("APEX RUSH", "#16181d", "#ffd60a"));
    // Keep the texture's 40:7 shape and a width a narrow portrait view can frame.
    const bannerW = Math.min(limit * 1.7, 11);
    const bannerGeo = keep(new THREE.PlaneGeometry(bannerW, (bannerW * 7) / 40));
    const bannerMat = keep(new THREE.MeshBasicMaterial({ map: bannerTex, side: THREE.DoubleSide }));
    const banner = new THREE.Mesh(bannerGeo, bannerMat);
    banner.position.set(0, 6.1, 0);
    banner.rotation.y = -Math.PI / 2;
    gantry.add(banner);
    scene.add(gantry);

    // Grandstand on the left of the start straight.
    const crowd = keep(crowdTexture(rand));
    // 34 wide x 1.4 tall faces, one 24x2 texture across: each spectator is about 1.4 m x 0.7 m.
    const standMat = keep(new THREE.MeshLambertMaterial({ map: crowd }));
    const stand = new THREE.Group();
    const side = 1;
    const base = edge(Math.floor(14 / track.spacing), side * (limit + 7), 0);
    stand.position.set(base[0]!, terrainAt(base[0]!, -base[2]!) , base[2]!);
    stand.rotation.y = heading;
    for (let row = 0; row < 4; row += 1) {
      const geo = keep(new THREE.BoxGeometry(34, 1.4, 2.2));
      const mesh = new THREE.Mesh(geo, standMat);
      mesh.position.set(0, 1 + row * 1.3, -side * row * 2.1);
      stand.add(mesh);
    }
    const roofGeo = keep(new THREE.BoxGeometry(36, 0.4, 10));
    const roof = new THREE.Mesh(roofGeo, keep(new THREE.MeshLambertMaterial({ color: "#e63946" })));
    roof.position.set(0, 7.6, -side * 3.2);
    stand.add(roof);
    scene.add(stand);

    const words = ["DRIFT!", "APEX", "TURBO", "GO GO GO", "PIXEL GP"];
    for (let k = 0; k < 5; k += 1) {
      const i = Math.floor(((k + 0.5) / 5) * n);
      const s = track.curv[i]! > 0 ? -1 : 1; // outside of the corner
      const p = edge(i, s * (limit + 6), 0);
      const tex = keep(bannerTexture(words[k]!, k % 2 === 0 ? "#ffd60a" : "#4361ee", k % 2 === 0 ? "#16181d" : "#ffffff"));
      const board = new THREE.Mesh(keep(new THREE.PlaneGeometry(12, 2.1)), keep(new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })));
      const ground = terrainAt(p[0]!, -p[2]!);
      board.position.set(p[0]!, ground + 3.4, p[2]!);
      board.rotation.y = Math.atan2(track.ty[i]!, track.tx[i]!) + (s > 0 ? Math.PI : 0);
      scene.add(board);
      const post = new THREE.Mesh(keep(new THREE.BoxGeometry(0.4, 3, 0.4)), keep(new THREE.MeshLambertMaterial({ color: "#495057" })));
      post.position.set(p[0]!, ground + 1.2, p[2]!);
      scene.add(post);
    }
  }

  // ── Trees and rocks (instanced) ──
  {
    const trunkB = new MeshBuilder();
    const leafB = new MeshBuilder();
    if (theme.tree === "pine") {
      trunkB.box(0, 1.1, 0, 0.5, 2.2, 0.5, theme.trunk);
      leafB.box(0, 3.0, 0, 3.4, 2.2, 3.4, theme.treeLeafDark, 0.25);
      leafB.box(0, 4.7, 0, 2.6, 2.0, 2.6, theme.treeLeaf, 0.2);
      leafB.box(0, 6.2, 0, 1.7, 1.8, 1.7, theme.treeLeaf, 0.05);
    } else if (theme.tree === "joshua") {
      trunkB.box(0, 1.6, 0, 0.6, 3.2, 0.6, theme.trunk);
      trunkB.box(0.8, 3.0, 0, 1.4, 0.45, 0.45, theme.trunk);
      trunkB.box(-0.7, 2.4, 0.2, 1.2, 0.45, 0.45, theme.trunk);
      trunkB.box(1.4, 3.6, 0, 0.45, 1.2, 0.45, theme.trunk);
      trunkB.box(-1.2, 3.0, 0.2, 0.45, 1.2, 0.45, theme.trunk);
      leafB.box(0, 3.7, 0, 1.5, 1.2, 1.5, theme.treeLeaf, 0.5);
      leafB.box(1.4, 4.6, 0, 1.3, 1.0, 1.3, theme.treeLeafDark, 0.5);
      leafB.box(-1.2, 4.0, 0.2, 1.3, 1.0, 1.3, theme.treeLeaf, 0.5);
    } else {
      trunkB.box(0, 1.2, 0, 0.7, 2.4, 0.7, theme.trunk);
      leafB.box(0, 3.4, 0, 4.2, 2.2, 4.2, theme.treeLeafDark, 0.8);
      leafB.box(0.3, 4.9, 0.2, 3.2, 1.6, 3.2, theme.treeLeaf, 0.6);
      leafB.box(-1.6, 3.2, 1.0, 2.0, 1.4, 2.0, theme.treeLeaf, 0.7);
    }
    const rockB = new MeshBuilder();
    rockB.box(0, 0.5, 0, 1.8, 1.2, 1.5, theme.rock, 0.6, 0.15);
    const trunkG = keep(trunkB.build());
    const leafG = keep(leafB.build());
    const rockG = keep(rockB.build());
    const mat = keep(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    const count = theme.tree === "joshua" ? 260 : 520;
    const trunks = new THREE.InstancedMesh(trunkG, mat, count);
    const leaves = new THREE.InstancedMesh(leafG, mat, count);
    const rocks = new THREE.InstancedMesh(rockG, mat, 140);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const sc = new THREE.Vector3();
    const p = new THREE.Vector3();
    const place = (mesh: THREE.InstancedMesh, also: THREE.InstancedMesh | null, total: number, minScale: number, maxScale: number, clump: boolean) => {
      let placed = 0;
      let guard = 0;
      let cx = 0;
      let cy = 0;
      while (placed < total && guard < total * 60) {
        guard += 1;
        let x: number;
        let y: number;
        if (clump && placed % 5 !== 0) {
          x = cx + (rand() - 0.5) * 30;
          y = cy + (rand() - 0.5) * 30;
        } else {
          x = minX + 60 + rand() * (maxX - minX - 120);
          y = minY + 60 + rand() * (maxY - minY - 120);
          cx = x;
          cy = y;
        }
        const fx = clamp(Math.round((x - minX) / cell), 0, gx - 1);
        const fy = clamp(Math.round((y - minY) / cell), 0, gy - 1);
        const d = terrainD[fy * gx + fx]!;
        if (d < limit + 5 || d > 330) continue;
        const s = minScale + rand() * (maxScale - minScale);
        p.set(x, terrainAt(x, y) - 0.15, -y);
        q.setFromAxisAngle(up, rand() * Math.PI * 2);
        sc.set(s, s * (0.85 + rand() * 0.3), s);
        m4.compose(p, q, sc);
        mesh.setMatrixAt(placed, m4);
        also?.setMatrixAt(placed, m4);
        placed += 1;
      }
      mesh.count = placed;
      if (also) also.count = placed;
    };
    place(trunks, leaves, count, 0.8, 1.7, true);
    place(rocks, null, 140, 0.6, 2.2, false);
    scene.add(trunks, leaves, rocks);
    disposables.push(trunks, leaves, rocks);
  }

  // ── Tyre stacks on the outside of sharp corners ──
  {
    const tb = new MeshBuilder();
    for (let i = 0; i < n; i += 4) {
      if (Math.abs(track.curv[i]!) < 0.03) continue;
      const s = track.curv[i]! > 0 ? -1 : 1;
      const p = edge(i, s * (limit - 0.5), 0);
      tb.box(p[0]!, p[1]! + 0.3, p[2]!, 0.9, 0.6, 0.9, "#25262b", 0.9);
      tb.box(p[0]!, p[1]! + 0.85, p[2]!, 0.9, 0.5, 0.9, i % 8 === 0 ? "#e63946" : "#f8f9fa", 0.9);
    }
    if (tb.pos.length) {
      const g = keep(tb.build());
      scene.add(new THREE.Mesh(g, keep(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }))));
    }
  }

  // ── Boost pads and item boxes ──
  const padTex = keep(arrowTexture());
  padTex.repeat.set(2, 3);
  const padMat = keep(new THREE.MeshBasicMaterial({ map: padTex }));
  for (const pad of track.pads) {
    const geo = keep(new THREE.PlaneGeometry(4.6, 7));
    const mesh = new THREE.Mesh(geo, padMat);
    mesh.rotation.order = "YXZ";
    mesh.rotation.y = pad.heading - Math.PI / 2;
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(pad.x, pad.z + 0.07, -pad.y);
    scene.add(mesh);
  }
  const boxTex = keep(boxTexture());
  const boxGeo = keep(new THREE.BoxGeometry(1.5, 1.5, 1.5));
  const boxMat = keep(new THREE.MeshBasicMaterial({ map: boxTex }));
  const boxes = track.boxes.map((b) => {
    const mesh = new THREE.Mesh(boxGeo, boxMat);
    mesh.position.set(b.x, b.z + 1.5, -b.y);
    scene.add(mesh);
    return mesh;
  });

  // ── Karts ──
  const models: KartModel[] = looks.map((look) => buildKart(look));
  const ghostModels: KartModel[] = ghostLooks.map((look) => buildKart(look, { ghost: true }));
  const blobTex = keep(blobTexture());
  const blobGeo = keep(new THREE.PlaneGeometry(2.6, 1.9));
  const blobMat = keep(new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
  const blobs = models.map((m) => {
    scene.add(m.group);
    const blob = new THREE.Mesh(blobGeo, blobMat);
    blob.rotation.order = "YXZ";
    blob.rotation.x = -Math.PI / 2;
    scene.add(blob);
    return blob;
  });
  for (const g of ghostModels) {
    g.group.visible = false;
    scene.add(g.group);
  }
  const wheelSpin = new Float32Array(models.length);
  const visYaw = new Float32Array(models.length);
  const visRoll = new Float32Array(models.length);

  // ── Particles: chunky square points ──
  const pPos = new Float32Array(MAX_PARTICLES * 3);
  const pCol = new Float32Array(MAX_PARTICLES * 3);
  const pVel = new Float32Array(MAX_PARTICLES * 3);
  const pLife = new Float32Array(MAX_PARTICLES);
  const pGrav = new Float32Array(MAX_PARTICLES);
  let pNext = 0;
  const pGeo = keep(new THREE.BufferGeometry());
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute("color", new THREE.BufferAttribute(pCol, 3));
  const pMat = keep(new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, fog: false }));
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  scene.add(points);
  for (let i = 0; i < MAX_PARTICLES; i += 1) pPos[i * 3 + 1] = -9999;
  const tmpColor = new THREE.Color();
  const emit = (x: number, y: number, z: number, vx: number, vy: number, vz: number, color: THREE.ColorRepresentation, life: number, grav: number) => {
    const i = pNext;
    pNext = (pNext + 1) % MAX_PARTICLES;
    pPos[i * 3] = x;
    pPos[i * 3 + 1] = y;
    pPos[i * 3 + 2] = z;
    pVel[i * 3] = vx;
    pVel[i * 3 + 1] = vy;
    pVel[i * 3 + 2] = vz;
    tmpColor.set(color);
    pCol[i * 3] = tmpColor.r;
    pCol[i * 3 + 1] = tmpColor.g;
    pCol[i * 3 + 2] = tmpColor.b;
    pLife[i] = life;
    pGrav[i] = grav;
  };
  const SPARKS = ["#ffffff", "#4cc9f0", "#ff9f1c", "#c77dff"];
  const FLAMES = ["#ffe066", "#ff9f1c", "#ff5400"];
  const CONFETTI = ["#ef233c", "#ffd60a", "#4cc9f0", "#70e000", "#f72585", "#ffffff"];

  // ── Camera state ──
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  let camYaw = 0;
  let camReady = false;
  let fov = 64;
  let shake = 0;
  let portrait = false;
  let frame = 0;

  const resize = () => {
    const w = canvas.clientWidth || 640;
    const h = canvas.clientHeight || 360;
    // Chunky pixels: 2–4 CSS px each depending on the screen.
    const px = clamp(Math.round(Math.min(w, h) / 230), 2, 4);
    const iw = Math.max(160, Math.round(w / px));
    const ih = Math.max(120, Math.round(h / px));
    renderer.setSize(iw, ih, false);
    camera.aspect = iw / ih;
    portrait = h > w;
    pMat.size = px >= 3 ? 2 : 3;
    camera.updateProjectionMatrix();
  };
  resize();

  const placeKart = (model: KartModel, x: number, y: number, z: number, heading: number, slipYaw: number, roll: number, pitch: number, steer: number, spin: number) => {
    model.group.position.set(x, z, -y);
    model.group.rotation.y = heading + slipYaw;
    model.body.rotation.x = roll;
    model.body.rotation.z = pitch;
    for (const w of model.wheels) w.rotation.z = -spin;
    for (const p of model.frontPivots) p.rotation.y = -steer * 0.45;
  };

  const draw = (view: RushView, dt: number) => {
    frame += 1;
    const world = view.world;
    const player = world.karts[0]!;
    const time = world.timeMs / 1000 + frame * 0.0001;

    for (let k = 0; k < world.karts.length && k < models.length; k += 1) {
      const kart: Kart = world.karts[k]!;
      const model = models[k]!;
      const speed = Math.abs(kart.v);
      wheelSpin[k] = (wheelSpin[k]! + (kart.v * dt) / model.wheelRadius) % (Math.PI * 2);
      // The kart points into the corner in a drift, with a touch of lean.
      const slip = Math.atan2(Math.sin(kart.heading - kart.va), Math.cos(kart.heading - kart.va));
      const wantYaw = kart.drifting !== 0 ? -kart.drifting * 0.32 : 0;
      visYaw[k] = lerp(visYaw[k]!, wantYaw, Math.min(1, dt * 8));
      const wantRoll = clamp(-kart.steer * speed * 0.006 + slip * 0.25, -0.22, 0.22);
      visRoll[k] = lerp(visRoll[k]!, wantRoll, Math.min(1, dt * 7));
      const i = kart.hit.i;
      const along = Math.cos(kart.heading) * track.tx[i]! + Math.sin(kart.heading) * track.ty[i]!;
      const pitch = Math.atan(track.grade[i]! * along) + (kart.boostT > 0 ? 0.05 : 0);
      placeKart(model, kart.x, kart.y, kart.z, kart.heading, visYaw[k]!, visRoll[k]!, pitch, kart.steer, wheelSpin[k]!);
      const blob = blobs[k]!;
      blob.position.set(kart.x, kart.z - (kart.hopT > 0 ? Math.sin((1 - kart.hopT / 0.2) * Math.PI) * 0.45 : 0) + 0.06, -kart.y);
      blob.rotation.y = kart.heading;

      // Effects at the rear wheels.
      const ch = Math.cos(kart.heading);
      const sh = Math.sin(kart.heading);
      const rx = kart.x - ch * 0.8;
      const ry = kart.y - sh * 0.8;
      if (kart.drifting !== 0) {
        const color = SPARKS[kart.chargeLevel]!;
        for (const side of [-0.6, 0.6]) {
          emit(rx - sh * side, kart.z + 0.15, -(ry + ch * side), -ch * 2 + (rand() - 0.5) * 3, 1.5 + rand() * 2.5, sh * 2 + (rand() - 0.5) * 3, kart.chargeLevel === 0 ? "#d0d4da" : color, 0.3 + rand() * 0.2, 9);
        }
      }
      if (kart.boostT > 0) {
        for (let j = 0; j < 2; j += 1) {
          const side = j === 0 ? -0.22 : 0.22;
          emit(rx - ch * 0.4 - sh * side, kart.z + 0.5, -(ry - sh * 0.4 + ch * side), -ch * (6 + rand() * 4), rand() * 1.2, sh * (6 + rand() * 4), FLAMES[Math.floor(rand() * 3)]!, 0.22 + rand() * 0.14, -2);
        }
      }
      if (kart.offroad && speed > 4 && frame % 3 === 0) {
        emit(rx + (rand() - 0.5), kart.z + 0.2, -(ry + (rand() - 0.5)), (rand() - 0.5) * 2, 1 + rand() * 1.5, (rand() - 0.5) * 2, theme.dirt, 0.5, 3);
      }
      if (kart.events & 4) {
        for (let j = 0; j < 10; j += 1) emit(kart.x, kart.z + 0.5, -kart.y, (rand() - 0.5) * 8, 2 + rand() * 4, (rand() - 0.5) * 8, "#ffe066", 0.4, 12);
        if (k === 0) shake = 0.35;
      }
      if (kart.events & 8) {
        for (let j = 0; j < 12; j += 1) emit(kart.x, kart.z + 1.2, -kart.y, (rand() - 0.5) * 7, 2 + rand() * 5, (rand() - 0.5) * 7, j % 2 === 0 ? "#ffd60a" : "#ffffff", 0.5, 10);
      }
    }

    // Ghosts.
    for (let g = 0; g < ghostModels.length; g += 1) {
      const pose = view.ghosts[g] ?? null;
      const model = ghostModels[g]!;
      model.group.visible = pose !== null;
      if (pose) placeKart(model, pose.x, pose.y, pose.z, pose.heading, 0, 0, 0, 0, time * 30);
    }

    // Item boxes spin and bob; taken ones hide.
    for (let b = 0; b < boxes.length; b += 1) {
      const mesh = boxes[b]!;
      mesh.visible = world.boxT[b]! <= 0;
      mesh.rotation.y = time * 1.6 + b;
      mesh.rotation.x = 0.5;
      mesh.position.y = track.boxes[b]!.z + 1.5 + Math.sin(time * 3 + b) * 0.2;
    }
    padTex.offset.y = -(time * 2.2) % 1;

    // Particles.
    for (let i = 0; i < MAX_PARTICLES; i += 1) {
      if (pLife[i]! <= 0) continue;
      pLife[i] = pLife[i]! - dt;
      if (pLife[i]! <= 0) {
        pPos[i * 3 + 1] = -9999;
        continue;
      }
      pVel[i * 3 + 1] = pVel[i * 3 + 1]! - pGrav[i]! * dt;
      pPos[i * 3] = pPos[i * 3]! + pVel[i * 3]! * dt;
      pPos[i * 3 + 1] = pPos[i * 3 + 1]! + pVel[i * 3 + 1]! * dt;
      pPos[i * 3 + 2] = pPos[i * 3 + 2]! + pVel[i * 3 + 2]! * dt;
    }
    pGeo.attributes.position!.needsUpdate = true;
    pGeo.attributes.color!.needsUpdate = true;

    // Camera.
    const px = player.x;
    const py = player.y;
    const pz = player.z;
    let wantFov = (portrait ? 78 : 64) + (player.boostT > 0 ? 9 : 0) + clamp(player.v / 40, 0, 1) * 5;
    if (view.camera === "chase") {
      // Sit behind the direction of travel, so a drift shows the kart's side.
      const slip = Math.atan2(Math.sin(player.heading - player.va), Math.cos(player.heading - player.va));
      const target = player.va + slip * 0.35;
      if (!camReady) camYaw = target;
      camYaw += Math.atan2(Math.sin(target - camYaw), Math.cos(target - camYaw)) * Math.min(1, dt * 5.5);
      const dist = (portrait ? 7.6 : 6.4) + clamp(player.v / 30, 0, 1) * 1.2;
      const height = portrait ? 3.6 : 2.9;
      const tx = px - Math.cos(camYaw) * dist;
      const ty = py - Math.sin(camYaw) * dist;
      const ground = terrainAt(tx, ty);
      const tz = Math.max(pz + height, ground + 1.2);
      const k = camReady ? Math.min(1, dt * 9) : 1;
      camPos.set(lerp(camPos.x, tx, k), lerp(camPos.y, tz, k), lerp(camPos.z, -ty, k));
      camLook.set(px + Math.cos(camYaw) * 4, pz + 1.3, -(py + Math.sin(camYaw) * 4));
      camReady = true;
    } else if (view.camera === "intro") {
      // Swoop from a high side view down to the chase position.
      const t = clamp(view.cameraT / 3.2, 0, 1);
      const e = t * t * (3 - 2 * t);
      const ang = player.heading + Math.PI + (1 - e) * 2.4;
      const dist = lerp(26, portrait ? 7.6 : 6.4, e);
      camPos.set(px + Math.cos(ang) * dist, pz + lerp(14, portrait ? 3.6 : 2.9, e), -(py + Math.sin(ang) * dist));
      camLook.set(px, pz + 1.2, -py);
      camYaw = player.heading;
      camReady = false;
      wantFov = portrait ? 78 : 64;
    } else {
      const ang = player.heading + 0.6 + view.cameraT * 0.5;
      // Frame the kart in the upper half; the results panel sits below.
      camPos.set(px + Math.cos(ang) * 8, pz + 3.4, -(py + Math.sin(ang) * 8));
      camLook.set(px, pz - (portrait ? 1.6 : 1.0), -py);
      camReady = false;
      wantFov = portrait ? 70 : 52;
    }
    fov = lerp(fov, wantFov, Math.min(1, dt * 5));
    camera.fov = fov;
    camera.updateProjectionMatrix();
    camera.position.copy(camPos);
    if (shake > 0) {
      shake -= dt;
      camera.position.x += (rand() - 0.5) * shake;
      camera.position.y += (rand() - 0.5) * shake;
    }
    camera.lookAt(camLook);
    if (view.camera === "chase") camera.rotation.z += clamp(-player.steer * 0.03 * (player.drifting !== 0 ? 2 : 1), -0.07, 0.07);
    sky.position.set(camera.position.x, 0, camera.position.z);
    renderer.render(scene, camera);
  };

  const celebrate = () => {
    const p = models[0]!.group.position;
    for (let j = 0; j < 160; j += 1) {
      emit(p.x + (rand() - 0.5) * 6, p.y + 3 + rand() * 3, p.z + (rand() - 0.5) * 6, (rand() - 0.5) * 9, 3 + rand() * 7, (rand() - 0.5) * 9, CONFETTI[j % CONFETTI.length]!, 1.6 + rand() * 1.4, 7);
    }
  };

  return {
    resize,
    draw,
    celebrate,
    size: () => {
      const s = renderer.getSize(new THREE.Vector2());
      return { w: s.x, h: s.y, calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
    },
    dispose: () => {
      for (const m of models) m.dispose();
      for (const m of ghostModels) m.dispose();
      for (const d of disposables) d.dispose();
      renderer.dispose();
      // iOS caps live WebGL contexts; free this one instead of waiting for GC. Deferred
      // until the canvas has left the DOM so a StrictMode re-run can reuse a live one.
      setTimeout(() => {
        if (!canvas.isConnected) renderer.forceContextLoss();
      }, 0);
    },
  };
}
