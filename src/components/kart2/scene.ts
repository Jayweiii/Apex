/**
 * Pixel-art chase view for Apex Kart. Plain three.js (no per-frame React):
 * a low-resolution render target scaled up nearest-neighbour, toon bands,
 * and a small palette.
 */
import { createRng, nextRandom } from "@/lib/kart/rng";
import type { GhostPose } from "@/lib/kart2/ghost";
import { liveryColor, type KartBody, type Livery } from "@/lib/kart2/livery";
import type { Kart2State } from "@/lib/kart2/physics";
import type { Kart2Track } from "@/lib/kart2/track";
import * as THREE from "three";

export type Kart2View = {
  resize: () => void;
  draw: (
    kart: Kart2State,
    ghost: GhostPose,
    camYaw: number,
    dt: number,
    orbit: boolean,
  ) => void;
  setLivery: (livery: Livery) => void;
  dispose: () => void;
};

type Rig = {
  group: THREE.Group;
  spin: THREE.Object3D[];
  steer: THREE.Object3D[];
};

function enu(x: number, y: number, z: number): [number, number, number] {
  return [x, z, -y];
}

function toonMap(): THREE.DataTexture {
  const data = new Uint8Array([
    64, 64, 72, 255, 140, 140, 150, 255, 214, 214, 220, 255, 255, 255, 255, 255,
  ]);
  const tex = new THREE.DataTexture(data, 4, 1);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

function toon(color: THREE.ColorRepresentation, gradient: THREE.DataTexture, map?: THREE.Texture) {
  return new THREE.MeshToonMaterial({
    color,
    gradientMap: gradient,
    ...(map ? { map } : {}),
  });
}

function liveryTexture(livery: Livery): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const g = canvas.getContext("2d");
  const hex = liveryColor(livery);
  if (g) {
    g.imageSmoothingEnabled = false;
    g.fillStyle = hex;
    g.fillRect(0, 0, 32, 32);
    if (livery.pattern === "stripes") {
      g.fillStyle = "#fff8ea";
      for (let x = 2; x < 32; x += 8) g.fillRect(x, 0, 3, 32);
    } else if (livery.pattern === "checks") {
      for (let y = 0; y < 32; y += 8) {
        for (let x = 0; x < 32; x += 8) {
          const on = (x / 8 + y / 8) % 2 === 0;
          g.fillStyle = on ? hex : "#16141c";
          g.fillRect(x, y, 8, 8);
        }
      }
    } else if (livery.pattern === "flames") {
      g.fillStyle = "#ffd23f";
      g.fillRect(0, 16, 32, 6);
      g.fillStyle = "#ff3b1f";
      g.fillRect(0, 22, 32, 6);
      g.fillStyle = "#fff4d0";
      g.fillRect(0, 28, 32, 4);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function checkerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 8;
  const g = canvas.getContext("2d");
  if (g) {
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        g.fillStyle = (x + y) % 2 === 0 ? "#f4f1ea" : "#16141c";
        g.fillRect(x, y, 1, 1);
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function ribbonGeometry(
  track: Kart2Track,
  inner: number,
  outer: number,
  lift: number,
  keep?: (i: number) => boolean,
): THREE.BufferGeometry {
  const n = track.count;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const leftX = -track.ty[i]!;
    const leftY = track.tx[i]!;
    const z = track.pz[i]! + lift;
    const ix = track.px[i]! + leftX * inner;
    const iy = track.py[i]! + leftY * inner;
    const ox = track.px[i]! + leftX * outer;
    const oy = track.py[i]! + leftY * outer;
    positions.push(...enu(ix, iy, z), ...enu(ox, oy, z));
  }
  for (let i = 0; i < n; i += 1) {
    if (keep && !keep(i)) continue;
    const j = (i + 1) % n;
    const a = i * 2;
    const b = a + 1;
    const c = j * 2;
    const d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function buildKart(gradient: THREE.DataTexture, livery: Livery | null, ghost: boolean): Rig {
  const group = new THREE.Group();
  const bodyKind: KartBody = livery?.body ?? "standard";
  const scale =
    bodyKind === "wide" ? [1.22, 0.92, 0.98] : bodyKind === "wedge" ? [0.9, 0.78, 1.16] : [1, 1, 1];
  const color = ghost ? "#b9e6ff" : "#ffffff";
  const map = ghost || !livery ? undefined : liveryTexture(livery);
  const mat = ghost
    ? new THREE.MeshToonMaterial({
        color,
        gradientMap: gradient,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      })
    : toon("#ffffff", gradient, map);
  const dark = ghost
    ? mat
    : toon("#2a242c", gradient);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.28, 1.55), mat);
  body.position.set(0, 0.42, 0.05);
  body.scale.set(scale[0]!, scale[1]!, scale[2]!);
  group.add(body);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.16, 0.46), mat);
  nose.position.set(0, 0.34, -0.86);
  nose.scale.set(scale[0]!, 1, 1);
  group.add(nose);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.28, 0.55), dark);
  cabin.position.set(0, 0.66, 0.12);
  group.add(cabin);
  const helmetMat = ghost ? mat : toon(livery?.color === "ink" ? "#ffd23f" : "#f7f1e4", gradient);
  const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.26), helmetMat);
  helmet.position.set(0, 0.78, 0.02);
  group.add(helmet);
  if (!ghost) {
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.06), toon("#1a2430", gradient));
    visor.position.set(0, 0.78, -0.12);
    group.add(visor);
  }
  if (bodyKind === "wedge" && !ghost) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.06, 0.22), mat);
    wing.position.set(0, 0.72, 0.78);
    group.add(wing);
  }
  const wheelGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.16, 7);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelColor = ghost ? "#d7eaff" : livery?.wheels === "gold" ? "#e2b657" : livery?.wheels === "white" ? "#f4f1ea" : "#1a1a1a";
  const wheelMat = ghost
    ? mat
    : toon(wheelColor, gradient);
  const tw = bodyKind === "wide" ? 0.58 : 0.48;
  const spots: Array<[number, number, boolean]> = [
    [-tw, -0.72, true],
    [tw, -0.72, true],
    [-tw, 0.78, false],
    [tw, 0.78, false],
  ];
  const spin: THREE.Object3D[] = [];
  const steer: THREE.Object3D[] = [];
  for (const [x, z, front] of spots) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.2, z);
    const mesh = new THREE.Mesh(wheelGeo, wheelMat);
    pivot.add(mesh);
    group.add(pivot);
    spin.push(mesh);
    if (front) steer.push(pivot);
  }
  return { group, spin, steer };
}

function placeRig(rig: Rig, x: number, y: number, z: number, heading: number, slip: number, grade: number) {
  const [tx, ty, tz] = enu(x, y, z);
  rig.group.position.set(tx, ty, tz);
  rig.group.rotation.order = "YXZ";
  rig.group.rotation.y = -heading;
  rig.group.rotation.x = -Math.atan(grade) * 0.85;
  rig.group.rotation.z = -slip * 0.55;
}

export function createKart2View(
  canvas: HTMLCanvasElement,
  track: Kart2Track,
  livery: Livery,
): Kart2View {
  const gradient = toonMap();
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x8ec8ea, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8ec8ea);
  scene.fog = new THREE.Fog(0xb7daf0, 48, 230);
  scene.add(new THREE.HemisphereLight(0xd9f3ff, 0x3e6b34, 0.95));
  const sun = new THREE.DirectionalLight(0xfff1cf, 1.35);
  sun.position.set(70, 110, 40);
  scene.add(sun);

  const floor = new THREE.Mesh(new THREE.CircleGeometry(1800, 8), toon("#2c6434", gradient));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.2;
  scene.add(floor);

  const asphalt = new THREE.Mesh(ribbonGeometry(track, -track.halfWidth, track.halfWidth, 0.02), toon("#3c4150", gradient));
  scene.add(asphalt);
  scene.add(new THREE.Mesh(ribbonGeometry(track, track.halfWidth, track.halfWidth + 0.85, 0.03, (i) => Math.floor(i / 3) % 2 === 0), toon("#e23d3d", gradient)));
  scene.add(new THREE.Mesh(ribbonGeometry(track, track.halfWidth, track.halfWidth + 0.85, 0.03, (i) => Math.floor(i / 3) % 2 === 1), toon("#f4f1ea", gradient)));
  scene.add(new THREE.Mesh(ribbonGeometry(track, -track.halfWidth - 0.85, -track.halfWidth, 0.03, (i) => Math.floor(i / 3) % 2 === 0), toon("#f4f1ea", gradient)));
  scene.add(new THREE.Mesh(ribbonGeometry(track, -track.halfWidth - 0.85, -track.halfWidth, 0.03, (i) => Math.floor(i / 3) % 2 === 1), toon("#e23d3d", gradient)));
  scene.add(new THREE.Mesh(ribbonGeometry(track, -0.18, 0.18, 0.05, (i) => Math.floor(i / 4) % 2 === 0), toon("#f7f3ea", gradient)));
  scene.add(new THREE.Mesh(ribbonGeometry(track, track.halfWidth + 0.85, track.halfWidth + 9, 0.0), toon("#3f8f45", gradient)));
  scene.add(new THREE.Mesh(ribbonGeometry(track, -track.halfWidth - 9, -track.halfWidth - 0.85, 0.0), toon("#357a3c", gradient)));

  // Terrain quilt around the circuit.
  {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < track.count; i += 1) {
      minX = Math.min(minX, track.px[i]!);
      maxX = Math.max(maxX, track.px[i]!);
      minY = Math.min(minY, track.py[i]!);
      maxY = Math.max(maxY, track.py[i]!);
    }
    const pad = 90;
    minX -= pad;
    maxX += pad;
    minY -= pad;
    maxY += pad;
    const cells = 36;
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const rng = createRng(track.level.id.length * 97 + track.count);
    for (let gy = 0; gy <= cells; gy += 1) {
      for (let gx = 0; gx <= cells; gx += 1) {
        const x = minX + ((maxX - minX) * gx) / cells;
        const y = minY + ((maxY - minY) * gy) / cells;
        let best = Infinity;
        let z = 0;
        const step = Math.max(1, Math.floor(track.count / 80));
        for (let i = 0; i < track.count; i += step) {
          const d2 = (x - track.px[i]!) ** 2 + (y - track.py[i]!) ** 2;
          if (d2 < best) {
            best = d2;
            z = track.pz[i]!;
          }
        }
        const dist = Math.sqrt(best);
        const fall = Math.max(0, 1 - dist / 80);
        const n = (nextRandom(rng) - 0.5) * 1.4;
        z = z * fall * 0.35 + n;
        positions.push(...enu(x, y, z));
        const grass = dist < track.halfWidth + 12;
        const shade = 0.75 + nextRandom(rng) * 0.35;
        if (grass) colors.push(0.25 * shade, 0.48 * shade, 0.22 * shade);
        else colors.push(0.32 * shade, 0.55 * shade, 0.24 * shade);
      }
    }
    const stride = cells + 1;
    for (let gy = 0; gy < cells; gy += 1) {
      for (let gx = 0; gx < cells; gx += 1) {
        const a = gy * stride + gx;
        indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradient }),
    );
    mesh.position.y = -0.15;
    scene.add(mesh);
  }

  // Trees, tyres, a grandstand, and the start gantry.
  const rng = createRng(42);
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 0.7, 5);
  const leafGeo = new THREE.ConeGeometry(0.7, 1.5, 5);
  const trunks = new THREE.InstancedMesh(trunkGeo, toon("#6b4428", gradient), 140);
  const leaves = new THREE.InstancedMesh(leafGeo, toon("#2f8a3a", gradient), 140);
  const dummy = new THREE.Object3D();
  let tree = 0;
  for (let i = 0; i < track.count && tree < 140; i += 4) {
    if (nextRandom(rng) < 0.25) continue;
    const side = nextRandom(rng) > 0.5 ? 1 : -1;
    const off = track.halfWidth + 8 + nextRandom(rng) * 16;
    const x = track.px[i]! + -track.ty[i]! * side * off;
    const y = track.py[i]! + track.tx[i]! * side * off;
    const z = track.pz[i]!;
    const [tx, ty, tz] = enu(x, y, z);
    dummy.position.set(tx, ty + 0.35, tz);
    dummy.scale.setScalar(0.8 + nextRandom(rng) * 0.7);
    dummy.rotation.set(0, nextRandom(rng) * 3, 0);
    dummy.updateMatrix();
    trunks.setMatrixAt(tree, dummy.matrix);
    dummy.position.y += 1.15 * dummy.scale.y;
    dummy.updateMatrix();
    leaves.setMatrixAt(tree, dummy.matrix);
    tree += 1;
  }
  trunks.count = tree;
  leaves.count = tree;
  trunks.instanceMatrix.needsUpdate = true;
  leaves.instanceMatrix.needsUpdate = true;
  scene.add(trunks, leaves);

  const tyreGeo = new THREE.TorusGeometry(0.28, 0.1, 5, 8);
  const tyres = new THREE.InstancedMesh(tyreGeo, toon("#1a1a1a", gradient), 80);
  let tyre = 0;
  for (let i = 0; i < track.count && tyre < 80; i += 6) {
    if (Math.abs(track.curv[i]!) < 0.08) continue;
    const side = -Math.sign(track.curv[i]!);
    const off = track.halfWidth + 1.3;
    const x = track.px[i]! + -track.ty[i]! * side * off;
    const y = track.py[i]! + track.tx[i]! * side * off;
    const [tx, ty, tz] = enu(x, y, track.pz[i]! + 0.28);
    dummy.position.set(tx, ty, tz);
    dummy.scale.setScalar(1);
    dummy.rotation.set(Math.PI / 2, 0, 0);
    dummy.updateMatrix();
    tyres.setMatrixAt(tyre, dummy.matrix);
    tyre += 1;
  }
  tyres.count = tyre;
  tyres.instanceMatrix.needsUpdate = true;
  scene.add(tyres);

  // Grandstand on the opening straight.
  const standMat = toon("#c4553a", gradient);
  const crowdMat = toon("#ffd23f", gradient);
  for (let k = 0; k < 7; k += 1) {
    const i = (8 + k * 3) % track.count;
    const side = 1;
    const off = track.halfWidth + 4.5;
    const x = track.px[i]! + -track.ty[i]! * side * off;
    const y = track.py[i]! + track.tx[i]! * side * off;
    const [tx, ty, tz] = enu(x, y, track.pz[i]!);
    const block = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 1.4), standMat);
    block.position.set(tx, ty + 0.55, tz);
    scene.add(block);
    const crowd = new THREE.Mesh(new THREE.BoxGeometry(2, 0.35, 1.1), k % 2 ? crowdMat : toon("#3ec1ff", gradient));
    crowd.position.set(tx, ty + 1.25, tz);
    scene.add(crowd);
  }

  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(track.halfWidth * 2.1, 0.7, 0.12),
    new THREE.MeshToonMaterial({ map: checkerTexture(), gradientMap: gradient }),
  );
  {
    const i = 4;
    const [tx, ty, tz] = enu(track.px[i]!, track.py[i]!, track.pz[i]! + 4.8);
    banner.position.set(tx, ty, tz);
    banner.rotation.y = -Math.atan2(track.tx[i]!, track.ty[i]!);
    scene.add(banner);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.2, 0.18), toon("#f4f1ea", gradient));
      const x = track.px[i]! + -track.ty[i]! * side * track.halfWidth;
      const y = track.py[i]! + track.tx[i]! * side * track.halfWidth;
      const [px, py, pz] = enu(x, y, track.pz[i]! + 2.4);
      post.position.set(px, py, pz);
      scene.add(post);
    }
  }

  // Distant clouds sit on the horizon and face the camera. Box meshes up
  // in the sky read as flat grey slabs.
  const cloudGeo = new THREE.PlaneGeometry(22, 7);
  const cloudMat = toon("#e7f3fb", gradient);
  const clouds: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i += 1) {
    const cloud = new THREE.Mesh(cloudGeo, cloudMat);
    const ang = (i / 6) * Math.PI * 2;
    cloud.position.set(Math.cos(ang) * 170, 3.2 + (i % 3) * 1.4, Math.sin(ang) * 170);
    scene.add(cloud);
    clouds.push(cloud);
  }

  let player = buildKart(gradient, livery, false);
  const ghostRig = buildKart(gradient, null, true);
  scene.add(player.group, ghostRig.group);

  const PARTS = 90;
  const pPos = new Float32Array(PARTS * 3);
  const pCol = new Float32Array(PARTS * 3);
  const pVel = new Float32Array(PARTS * 3);
  const pLife = new Float32Array(PARTS);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute("color", new THREE.BufferAttribute(pCol, 3));
  const particles = new THREE.Points(
    pGeo,
    new THREE.PointsMaterial({
      size: 0.45,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: true,
    }),
  );
  scene.add(particles);
  let pNext = 0;

  function spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, rgb: [number, number, number], life: number) {
    const i = pNext;
    pNext = (pNext + 1) % PARTS;
    const [tx, ty, tz] = enu(x, y, z);
    pPos[i * 3] = tx;
    pPos[i * 3 + 1] = ty;
    pPos[i * 3 + 2] = tz;
    pVel[i * 3] = vx;
    pVel[i * 3 + 1] = vy;
    pVel[i * 3 + 2] = vz;
    pCol[i * 3] = rgb[0];
    pCol[i * 3 + 1] = rgb[1];
    pCol[i * 3 + 2] = rgb[2];
    pLife[i] = life;
  }

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 500);
  const camPos = new THREE.Vector3(0, 8, 12);
  const look = new THREE.Vector3();
  let wheelSpin = 0;

  function resize() {
    const w = canvas.clientWidth || 320;
    const h = canvas.clientHeight || 240;
    const target = w < 700 ? 300 : 520;
    const scale = Math.max(1, w / target);
    renderer.setSize(Math.max(16, Math.floor(w / scale)), Math.max(16, Math.floor(h / scale)), false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }

  function setLivery(next: Livery) {
    scene.remove(player.group);
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    player.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) geos.add(mesh.geometry);
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      const list = Array.isArray(material) ? material : material ? [material] : [];
      for (const m of list) mats.add(m);
    });
    for (const geo of geos) geo.dispose();
    for (const m of mats) {
      (m as THREE.MeshToonMaterial).map?.dispose();
      m.dispose();
    }
    player = buildKart(gradient, next, false);
    scene.add(player.group);
  }

  function draw(kart: Kart2State, ghost: GhostPose, camYaw: number, dt: number, orbit: boolean) {
    placeRig(player, kart.x, kart.y, kart.z, kart.heading, kart.slip, kart.grade);
    wheelSpin += kart.speed * dt * 1.6;
    const steer = Math.max(-0.45, Math.min(0.45, kart.slip * -1.2));
    for (const w of player.spin) w.rotation.x = wheelSpin;
    for (const s of player.steer) s.rotation.y = steer;
    if (ghost.active) {
      ghostRig.group.visible = true;
      placeRig(ghostRig, ghost.x, ghost.y, ghost.z + 0.05, ghost.heading, 0, 0);
      for (const w of ghostRig.spin) w.rotation.x = wheelSpin;
    } else {
      ghostRig.group.visible = false;
    }

    const fx = Math.sin(camYaw);
    const fz = -Math.cos(camYaw);
    const rx = Math.cos(camYaw);
    const rz = Math.sin(camYaw);
    const [kx, ky, kz] = enu(kart.x, kart.y, kart.z);
    const dist = orbit ? 14 : 9.2;
    const height = orbit ? 6.4 : 3.8 + Math.min(0.8, kart.speed * 0.02);
    const desiredX = kx - fx * dist + rx * kart.slip * 1.1;
    const desiredY = ky + height;
    const desiredZ = kz - fz * dist + rz * kart.slip * 1.1;
    const blend = 1 - Math.exp(-(orbit ? 1.4 : 4.2) * Math.max(0.001, dt));
    camPos.x += (desiredX - camPos.x) * blend;
    camPos.y += (desiredY - camPos.y) * blend;
    camPos.z += (desiredZ - camPos.z) * blend;
    // Aim just below the kart so it sits in the upper-middle. The stick ring
    // is drawn in the lower third, so the two don't overlap. A harder pitch
    // put the start gantry across the lens.
    look.set(kx + fx * 5.4, ky + 0.05, kz + fz * 5.4);
    camera.position.copy(camPos);
    camera.lookAt(look);
    camera.rotateX(-0.07);
    camera.fov = 60 + Math.min(8, kart.speed * 0.12) + (kart.boost > 0 ? 6 : 0);
    camera.updateProjectionMatrix();

    if (kart.drifting && kart.speed > 6) {
      const rear = 0.8;
      const rxw = Math.cos(kart.heading);
      const ryw = -Math.sin(kart.heading);
      spawn(
        kart.x - Math.sin(kart.heading) * rear + rxw * 0.4,
        kart.y - Math.cos(kart.heading) * rear + ryw * 0.4,
        kart.z + 0.15,
        (Math.random() - 0.5) * 2,
        1.5 + Math.random(),
        (Math.random() - 0.5) * 2,
        [1, 0.55, 0.15],
        0.35,
      );
    }
    if (Math.abs(kart.hit.d) > track.halfWidth && kart.speed > 4) {
      spawn(kart.x, kart.y, kart.z + 0.2, (Math.random() - 0.5) * 3, 0.8, (Math.random() - 0.5) * 3, [0.72, 0.58, 0.32], 0.45);
    }
    if (kart.boost > 0) {
      spawn(
        kart.x - Math.sin(kart.heading) * 0.9,
        kart.y - Math.cos(kart.heading) * 0.9,
        kart.z + 0.35,
        -Math.sin(kart.heading) * 2,
        1.2,
        Math.cos(kart.heading) * 2,
        [0.7, 0.9, 1],
        0.28,
      );
    }
    for (let i = 0; i < PARTS; i += 1) {
      if (pLife[i]! <= 0) {
        pPos[i * 3 + 1] = -100;
        continue;
      }
      pLife[i]! -= dt;
      pPos[i * 3]! += pVel[i * 3]! * dt;
      pPos[i * 3 + 1]! += pVel[i * 3 + 1]! * dt;
      pPos[i * 3 + 2]! += pVel[i * 3 + 2]! * dt;
      pVel[i * 3 + 1]! -= dt * 2;
    }
    (pGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (pGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;

    for (let i = 0; i < clouds.length; i += 1) {
      const cloud = clouds[i]!;
      cloud.lookAt(camera.position.x, cloud.position.y, camera.position.z);
    }
    renderer.render(scene, camera);
  }

  function dispose() {
    renderer.dispose();
    const mats = new Set<THREE.Material>();
    const geos = new Set<THREE.BufferGeometry>();
    const maps = new Set<THREE.Texture>();
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) geos.add(mesh.geometry);
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      const list = Array.isArray(material) ? material : material ? [material] : [];
      for (const m of list) mats.add(m);
    });
    for (const m of mats) {
      const mapped = m as THREE.MeshToonMaterial;
      if (mapped.map) maps.add(mapped.map);
      m.dispose();
    }
    for (const map of maps) map.dispose();
    for (const geo of geos) geo.dispose();
    gradient.dispose();
  }

  resize();
  return { resize, draw, setLivery, dispose };
}
