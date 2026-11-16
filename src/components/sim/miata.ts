/**
 * A procedural small roadster in the proportions of the ND MX-5: lofted body
 * with real wheel arches, open cockpit, windscreen, seats, lights and
 * spinning, steering wheels. Model space: +X forward, +Y up, −Z left; the
 * origin is on the ground under the centre of gravity.
 */
import * as THREE from "three";
import type { CarSpec } from "@/lib/sim/car";

export type CarModel = {
  group: THREE.Group;
  /** Sprung body (rolls and pitches on the wheels). */
  body: THREE.Group;
  wheels: THREE.Group[];
  steeringWheel: THREE.Object3D;
  /** Parts that would block the driver's-eye view. */
  hideInCockpit: THREE.Object3D[];
  brakeLights: THREE.MeshStandardMaterial;
  setPaint: (hex: string) => void;
  dispose: () => void;
};

/** Key body sections, tail to nose: x, half width, underside, shoulder, crown. */
const SECTIONS: number[][] = [
  [-2.005, 0.56, 0.44, 0.68, 0.72],
  [-1.95, 0.72, 0.36, 0.75, 0.79],
  [-1.72, 0.835, 0.27, 0.8, 0.83],
  [-1.2, 0.8675, 0.19, 0.815, 0.835],
  [-0.78, 0.86, 0.165, 0.8, 0.815],
  [-0.2, 0.845, 0.165, 0.755, 0.76],
  [0.5, 0.845, 0.165, 0.75, 0.79],
  [1.11, 0.8675, 0.19, 0.7, 0.705],
  [1.58, 0.8, 0.24, 0.61, 0.64],
  [1.84, 0.66, 0.31, 0.53, 0.56],
  [1.915, 0.48, 0.37, 0.47, 0.5],
];

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

/** Section values at x, splined between the key sections. */
function sectionAt(x: number): number[] {
  const S = SECTIONS;
  let k = 0;
  while (k < S.length - 2 && S[k + 1]![0]! < x) k += 1;
  const a = S[Math.max(0, k - 1)]!;
  const b = S[k]!;
  const c = S[k + 1]!;
  const d = S[Math.min(S.length - 1, k + 2)]!;
  const t = Math.max(0, Math.min(1, (x - b[0]!) / (c[0]! - b[0]!)));
  const out = [x];
  for (let i = 1; i < 5; i += 1) out.push(catmull(a[i]!, b[i]!, c[i]!, d[i]!, t));
  return out;
}

const RING = 22;

/** Half cross-section from the underside centre to the crown centre: [y, z]. */
function ring(sec: number[]): Array<[number, number]> {
  const [, w, zb, zs, zt] = sec as [number, number, number, number, number];
  const mid = zb + (zs - zb) * 0.52;
  const key: Array<[number, number]> = [
    [0, zb],
    [w * 0.78, zb],
    [w * 0.97, zb + 0.07],
    [w, mid],
    [w * 0.965, zs - 0.035],
    [w * 0.88, zs],
    [w * 0.6, zt - 0.012],
    [0, zt],
  ];
  const out: Array<[number, number]> = [];
  for (let i = 0; i < RING; i += 1) {
    const f = (i / (RING - 1)) * (key.length - 1);
    const k = Math.min(key.length - 2, Math.floor(f));
    const t = f - k;
    const p0 = key[Math.max(0, k - 1)]!;
    const p1 = key[k]!;
    const p2 = key[k + 1]!;
    const p3 = key[Math.min(key.length - 1, k + 2)]!;
    out.push([Math.max(0, catmull(p0[0], p1[0], p2[0], p3[0], t)), catmull(p0[1], p1[1], p2[1], p3[1], t)]);
  }
  out[0]![0] = 0;
  out[RING - 1]![0] = 0;
  return out;
}

function bodyGeometry(spec: CarSpec, frontAxle: number, rearAxle: number): THREE.BufferGeometry {
  const x0 = SECTIONS[0]![0]!;
  const x1 = SECTIONS[SECTIONS.length - 1]![0]!;
  const steps = 150;
  const arch = spec.tyreRadius + 0.075;
  const pos: number[] = [];
  const idx: number[] = [];
  const cols = RING * 2 - 1;
  const cockpit = (x: number, y: number, k: number) => x > -0.98 && x < 0.38 && k >= 15 && Math.abs(y) < 0.7;
  const open: boolean[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const x = x0 + ((x1 - x0) * i) / steps;
    const half = ring(sectionAt(x));
    for (let j = 0; j < cols; j += 1) {
      const side = j < RING ? -1 : 1;
      const k = j < RING ? j : cols - 1 - j;
      // Left half runs underside → crown, right half crown → underside.
      const p = half[k]!;
      let z = p[1];
      const y = p[0] * side;
      // Wheel arches: lift the lower body side over each wheel.
      if (p[0] > spec.trackFront / 2 - 0.27) {
        for (const ax of [frontAxle, rearAxle]) {
          const dx = x - ax;
          if (Math.abs(dx) < arch) z = Math.max(z, spec.tyreRadius + Math.sqrt(arch * arch - dx * dx));
        }
      }
      pos.push(x, z, y);
      open.push(cockpit(x, p[0], k));
    }
  }
  for (let i = 0; i < steps; i += 1) {
    for (let j = 0; j < cols - 1; j += 1) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      if (open[a] && open[b] && open[c] && open[d]) continue;
      idx.push(a, b, c, b, d, c);
    }
  }
  // Close the tail and the nose with fans.
  for (const end of [0, steps]) {
    const base = end * cols;
    let cy = 0;
    let cz = 0;
    for (let j = 0; j < cols; j += 1) {
      cy += pos[(base + j) * 3 + 2]!;
      cz += pos[(base + j) * 3 + 1]!;
    }
    const centre = pos.length / 3;
    pos.push(pos[base * 3]!, cz / cols, cy / cols);
    for (let j = 0; j < cols - 1; j += 1) {
      if (end === 0) idx.push(centre, base + j + 1, base + j);
      else idx.push(centre, base + j, base + j + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function wheelMesh(spec: CarSpec, mats: { tyre: THREE.Material; rim: THREE.Material; disc: THREE.Material; caliper: THREE.Material }): THREE.Group {
  const g = new THREE.Group();
  const R = spec.tyreRadius;
  const half = 0.1025;
  const rimR = 0.216;
  // Tyre: a lathe with rounded shoulders, axis along local Z.
  const prof: THREE.Vector2[] = [];
  const shoulder = 0.035;
  prof.push(new THREE.Vector2(rimR, -half));
  prof.push(new THREE.Vector2(R - shoulder, -half));
  for (let i = 1; i <= 5; i += 1) {
    const a = (i / 5) * (Math.PI / 2);
    prof.push(new THREE.Vector2(R - shoulder + Math.sin(a) * shoulder, -half + shoulder - Math.cos(a) * shoulder));
  }
  for (let i = 0; i <= 5; i += 1) {
    const a = (i / 5) * (Math.PI / 2);
    prof.push(new THREE.Vector2(R - shoulder + Math.cos(a) * shoulder, half - shoulder + Math.sin(a) * shoulder));
  }
  prof.push(new THREE.Vector2(rimR, half));
  const tyre = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), mats.tyre);
  tyre.rotation.x = Math.PI / 2;
  tyre.castShadow = true;
  g.add(tyre);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR, half * 2 - 0.02, 28, 1, true), mats.rim);
  barrel.rotation.x = Math.PI / 2;
  g.add(barrel);
  // Spokes on the outer face (−Z is outboard for a left wheel; the group is flipped for the right).
  const face = -half + 0.03;
  for (let i = 0; i < 10; i += 1) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.026, 0.022), mats.rim);
    const a = (i / 10) * Math.PI * 2;
    spoke.position.set(Math.cos(a) * 0.115, Math.sin(a) * 0.115, face);
    spoke.rotation.z = a;
    g.add(spoke);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.04, 16), mats.rim);
  hub.rotation.x = Math.PI / 2;
  hub.position.z = face;
  g.add(hub);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 24), mats.disc);
  disc.rotation.x = Math.PI / 2;
  disc.position.z = face + 0.05;
  g.add(disc);
  return g;
}

export function buildMiata(spec: CarSpec, paintHex: string, opts: { ghost?: boolean } = {}): CarModel {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const L = spec.wheelbase;
  const frontAxle = L * (1 - spec.frontWeight);
  const rearAxle = -L * spec.frontWeight;
  const ghost = !!opts.ghost;
  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(v: T): T => {
    disposables.push(v);
    return v;
  };

  const ghostMat = ghost
    ? track(new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.28, depthWrite: false }))
    : null;
  const paint = track(
    new THREE.MeshPhysicalMaterial({ color: paintHex, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.1 }),
  );
  const dark = track(new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.75, metalness: 0.1 }));
  const trim = track(new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.5, metalness: 0.3 }));
  const seatMat = track(new THREE.MeshStandardMaterial({ color: 0x1b1b1e, roughness: 0.9 }));
  const glass = track(
    new THREE.MeshPhysicalMaterial({ color: 0x9fb4c0, metalness: 0, roughness: 0.03, transparent: true, opacity: 0.22, envMapIntensity: 1.6, side: THREE.DoubleSide, depthWrite: false }),
  );
  const tyre = track(new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.92 }));
  const rim = track(new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.35, metalness: 0.85 }));
  const discMat = track(new THREE.MeshStandardMaterial({ color: 0x6a6d72, roughness: 0.45, metalness: 0.9 }));
  const caliper = track(new THREE.MeshStandardMaterial({ color: 0xb01218, roughness: 0.5 }));
  const lamp = track(new THREE.MeshStandardMaterial({ color: 0xf2f6ff, emissive: 0xdfe8ff, emissiveIntensity: 1.2, roughness: 0.2 }));
  const brakeLights = track(new THREE.MeshStandardMaterial({ color: 0x5a0508, emissive: 0xff1010, emissiveIntensity: 0.25, roughness: 0.3 }));
  const helmet = track(new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.25, metalness: 0.1 }));
  const visor = track(new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.1, metalness: 0.6 }));
  const pick = (m: THREE.Material): THREE.Material => ghostMat ?? m;
  const hideInCockpit: THREE.Object3D[] = [];

  // Body shell.
  const shellGeo = track(bodyGeometry(spec, frontAxle, rearAxle));
  const shell = new THREE.Mesh(shellGeo, pick(paint));
  shell.castShadow = !ghost;
  body.add(shell);

  // Cockpit tub, dash, seats, driver.
  const tub = new THREE.Group();
  tub.position.x = -0.22;
  body.add(tub);
  const floor = box(1.3, 0.04, 1.34, pick(dark), -0.09, 0.3, 0);
  tub.add(floor);
  tub.add(box(1.3, 0.5, 0.03, pick(dark), -0.09, 0.53, -0.685));
  tub.add(box(1.3, 0.5, 0.03, pick(dark), -0.09, 0.53, 0.685));
  tub.add(box(0.03, 0.5, 1.34, pick(dark), -0.74, 0.53, 0));
  // Dash and cowl.
  tub.add(box(0.3, 0.2, 1.36, pick(trim), 0.46, 0.68, 0));
  tub.add(box(0.5, 0.12, 0.22, pick(trim), 0.05, 0.42, 0));
  for (const side of [-1, 1]) {
    const seat = new THREE.Group();
    seat.add(box(0.5, 0.12, 0.46, pick(seatMat), -0.28, 0.4, 0));
    const back = box(0.13, 0.62, 0.46, pick(seatMat), -0.56, 0.7, 0);
    back.rotation.z = -0.2;
    seat.add(back);
    seat.add(box(0.1, 0.18, 0.26, pick(seatMat), -0.635, 1.03, 0));
    // Fairing hoop behind the headrest.
    const hoop = box(0.24, 0.1, 0.3, pick(trim), -0.8, 0.88, 0);
    hoop.rotation.z = 0.45;
    seat.add(hoop);
    seat.position.z = side * 0.345;
    tub.add(seat);
  }
  if (!ghost) {
    const driver = new THREE.Group();
    const torso = box(0.24, 0.5, 0.4, seatMat, -0.44, 0.72, 0);
    torso.rotation.z = -0.18;
    driver.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 20, 14), helmet);
    head.position.set(-0.44, 1.1, 0);
    head.castShadow = true;
    driver.add(head);
    const vis = new THREE.Mesh(new THREE.SphereGeometry(0.137, 16, 8, -0.9, 1.8, 1.1, 0.55), visor);
    vis.position.copy(head.position);
    vis.rotation.y = Math.PI / 2;
    driver.add(vis);
    hideInCockpit.push(head, vis);
    for (const side of [-1, 1]) {
      const arm = box(0.42, 0.07, 0.07, seatMat, -0.2, 0.82, side * 0.17);
      arm.rotation.z = 0.25;
      driver.add(arm);
    }
    driver.position.z = -0.345;
    tub.add(driver);
  }
  const steeringWheel = new THREE.Group();
  const rimGeo = track(new THREE.TorusGeometry(0.165, 0.014, 10, 28));
  const sw = new THREE.Mesh(rimGeo, pick(trim));
  steeringWheel.add(sw);
  steeringWheel.add(box(0.33, 0.035, 0.02, pick(trim), 0, 0, 0));
  steeringWheel.add(box(0.035, 0.17, 0.02, pick(trim), 0, -0.085, 0));
  const column = new THREE.Group();
  column.add(steeringWheel);
  column.position.set(0.17, 0.8, -0.345);
  column.rotation.set(0, Math.PI / 2, 0);
  column.rotateX(-0.42);
  tub.add(column);

  // Windscreen: glass in a dark frame, raked back from the cowl.
  const base = new THREE.Vector3(0.44, 0.785, 0);
  const top = new THREE.Vector3(-0.08, 1.2, 0);
  const wBase = 0.7;
  const wTop = 0.58;
  const glassGeo = track(new THREE.BufferGeometry());
  glassGeo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([base.x, base.y, -wBase, base.x, base.y, wBase, top.x, top.y, wTop, top.x, top.y, -wTop], 3),
  );
  glassGeo.setIndex([0, 1, 2, 0, 2, 3]);
  glassGeo.computeVertexNormals();
  const screen = new THREE.Mesh(glassGeo, pick(glass));
  screen.renderOrder = 2;
  body.add(screen);
  const pillarLen = Math.hypot(top.x - base.x, top.y - base.y, wBase - wTop);
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(pillarLen + 0.03, 0.045, 0.04), pick(dark));
    pillar.position.set((base.x + top.x) / 2, (base.y + top.y) / 2, (side * (wBase + wTop)) / 2);
    pillar.lookAt(pillar.position.x + (top.x - base.x), pillar.position.y + (top.y - base.y), pillar.position.z + side * (wTop - wBase));
    pillar.rotateY(Math.PI / 2);
    pillar.castShadow = !ghost;
    body.add(pillar);
    // Door mirror.
    const mirror = box(0.05, 0.07, 0.13, pick(paint), 0.3, 0.85, side * 0.85);
    body.add(mirror);
    body.add(box(0.03, 0.03, 0.08, pick(dark), 0.3, 0.82, side * 0.78));
  }
  body.add(box(0.045, 0.045, wTop * 2 + 0.04, pick(dark), top.x, top.y, 0));

  // Lights, grille, plates and trim.
  if (!ghost) {
    for (const side of [-1, 1]) {
      const head = box(0.2, 0.045, 0.2, lamp, 1.72, 0.565, side * 0.6);
      head.rotation.set(0, side * -0.5, -0.32);
      head.castShadow = false;
      body.add(head);
      const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.04, 20), brakeLights);
      tail.rotation.z = Math.PI / 2;
      tail.position.set(-1.992, 0.655, side * 0.44);
      body.add(tail);
      const tailOuter = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 16), brakeLights);
      tailOuter.rotation.z = Math.PI / 2;
      tailOuter.position.set(-1.962, 0.655, side * 0.6);
      body.add(tailOuter);
      // Sill.
      body.add(box(1.46, 0.06, 0.03, dark, -0.05, 0.2, side * 0.835));
    }
    const grille = box(0.06, 0.13, 0.86, dark, 1.895, 0.385, 0);
    grille.castShadow = false;
    body.add(grille);
    body.add(box(0.36, 0.03, 1.36, dark, 1.68, 0.235, 0));
    body.add(box(0.02, 0.11, 0.3, track(new THREE.MeshStandardMaterial({ color: 0xe9e9e4, roughness: 0.6 })), -2.01, 0.56, 0));
    body.add(box(0.14, 0.09, 1.1, dark, -1.9, 0.345, 0));
    for (const z of [0.42, 0.56]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 12), rim);
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(-1.99, 0.31, z);
      body.add(pipe);
    }
    // Undertray keeps daylight from showing through the arches.
    const under = box(3.3, 0.02, 1.2, dark, -0.05, 0.17, 0);
    under.castShadow = true;
    body.add(under);
  }

  // Wheels: FL, FR, RL, RR. Each sits in a pivot (steer) holding a spinner.
  const wheels: THREE.Group[] = [];
  const wheelGeoMats = { tyre: pick(tyre), rim: pick(rim), disc: pick(discMat), caliper: pick(caliper) };
  const place: Array<[number, number]> = [
    [frontAxle, spec.trackFront / 2],
    [frontAxle, -spec.trackFront / 2],
    [rearAxle, spec.trackRear / 2],
    [rearAxle, -spec.trackRear / 2],
  ];
  for (const [x, yLeft] of place) {
    const pivot = new THREE.Group();
    pivot.position.set(x, spec.tyreRadius, -yLeft);
    const spin = wheelMesh(spec, wheelGeoMats);
    if (yLeft < 0) spin.rotation.y = Math.PI;
    const holder = new THREE.Group();
    holder.add(spin);
    pivot.add(holder);
    if (!ghost) {
      const cal = box(0.07, 0.12, 0.05, caliper, 0.13, 0.05, yLeft > 0 ? -0.03 : 0.03);
      cal.castShadow = false;
      pivot.add(cal);
      // Dark liner inboard of the wheel so the arch does not show daylight.
      const liner = box(0.84, 0.56, 0.04, dark, x, 0.45, -yLeft + (yLeft > 0 ? 0.2 : -0.2));
      liner.castShadow = false;
      body.add(liner);
    }
    group.add(pivot);
    wheels.push(holder);
    (holder.userData as { pivot: THREE.Group }).pivot = pivot;
  }

  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      const m = o as THREE.Mesh;
      if (ghost) {
        m.castShadow = false;
        m.renderOrder = 3;
      }
      if (!disposables.includes(m.geometry)) disposables.push(m.geometry);
    }
  });

  return {
    group,
    body,
    wheels,
    steeringWheel,
    hideInCockpit,
    brakeLights,
    setPaint: (hex: string) => paint.color.set(hex),
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
