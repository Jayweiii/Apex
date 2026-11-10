/**
 * Apex Rush models and pixel textures, all built in code: low-poly karts with
 * swappable bodies and wheels, and tiny canvas textures drawn pixel by pixel.
 */
import * as THREE from "three";
import type { KartLook } from "@/lib/rush/garage";

/** Collects flat-shaded, vertex-coloured triangles into one geometry. */
export class MeshBuilder {
  pos: number[] = [];
  col: number[] = [];
  private c = new THREE.Color();

  tri(a: number[], b: number[], c: number[], color: THREE.ColorRepresentation): void {
    this.c.set(color);
    this.pos.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!);
    for (let i = 0; i < 3; i += 1) this.col.push(this.c.r, this.c.g, this.c.b);
  }

  quad(a: number[], b: number[], c: number[], d: number[], color: THREE.ColorRepresentation): void {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  /**
   * Box centred at (x, y, z), size (w along x, h up, d along z). `top` scales
   * the top face (taper) and `shift` slides it along x (wedges, noses).
   */
  box(x: number, y: number, z: number, w: number, h: number, d: number, color: THREE.ColorRepresentation, top = 1, shift = 0, topD = top): void {
    const hw = w / 2;
    const hh = h / 2;
    const hd = d / 2;
    const p = (sx: number, sy: number, sz: number): number[] =>
      sy > 0 ? [x + sx * hw * top + shift, y + hh, z + sz * hd * topD] : [x + sx * hw, y - hh, z + sz * hd];
    const v = [p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1), p(-1, -1, 1), p(-1, 1, -1), p(1, 1, -1), p(1, 1, 1), p(-1, 1, 1)];
    this.quad(v[4]!, v[7]!, v[6]!, v[5]!, color); // top
    this.quad(v[0]!, v[1]!, v[2]!, v[3]!, color); // bottom
    this.quad(v[3]!, v[2]!, v[6]!, v[7]!, color); // +z
    this.quad(v[1]!, v[0]!, v[4]!, v[5]!, color); // −z
    this.quad(v[2]!, v[1]!, v[5]!, v[6]!, color); // +x
    this.quad(v[0]!, v[3]!, v[7]!, v[4]!, color); // −x
  }

  /** Prism along z (a wheel or a post lying on its side). */
  wheel(radius: number, width: number, sides: number, tire: THREE.ColorRepresentation, hub: THREE.ColorRepresentation): void {
    const hw = width / 2;
    for (let i = 0; i < sides; i += 1) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      const x0 = Math.cos(a0) * radius;
      const y0 = Math.sin(a0) * radius;
      const x1 = Math.cos(a1) * radius;
      const y1 = Math.sin(a1) * radius;
      // Alternate tread shade so the spin reads at low resolution.
      const shade = i % 2 === 0 ? tire : new THREE.Color(tire).multiplyScalar(0.72);
      this.quad([x0, y0, hw], [x0, y0, -hw], [x1, y1, -hw], [x1, y1, hw], shade);
      const r = radius * 0.55;
      for (const s of [-1, 1]) {
        const z = s * hw;
        const zi = s * (hw + 0.01);
        const outer = s > 0 ? [[0, 0, z], [x0, y0, z], [x1, y1, z]] : [[0, 0, z], [x1, y1, z], [x0, y0, z]];
        this.tri(outer[0]!, outer[1]!, outer[2]!, tire);
        const h0 = [Math.cos(a0) * r, Math.sin(a0) * r, zi];
        const h1 = [Math.cos(a1) * r, Math.sin(a1) * r, zi];
        if (s > 0) this.tri([0, 0, zi], h0, h1, i % 2 === 0 ? hub : new THREE.Color(hub).multiplyScalar(0.8));
        else this.tri([0, 0, zi], h1, h0, i % 2 === 0 ? hub : new THREE.Color(hub).multiplyScalar(0.8));
      }
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return g;
  }
}

export type KartModel = {
  group: THREE.Group;
  /** Tilts with roll/pitch; children of `group`. */
  body: THREE.Group;
  wheels: THREE.Mesh[];
  /** Front wheel pivots (steer). */
  frontPivots: THREE.Group[];
  wheelRadius: number;
  dispose: () => void;
};

const DARK = "#22242b";
const STEEL = "#8d99ae";

/** Build a kart facing +x, wheels on y = 0. */
export function buildKart(look: KartLook, opts: { ghost?: boolean } = {}): KartModel {
  const paint = new THREE.Color(look.paint);
  const paintDark = paint.clone().multiplyScalar(0.72);
  const accent = look.accent;
  const b = new MeshBuilder();
  const y0 = 0.3;

  // Floor pan and bumpers (every body).
  b.box(0, y0, 0, 1.95, 0.14, 0.92, DARK);
  b.box(1.02, y0 + 0.02, 0, 0.12, 0.16, 1.1, STEEL);
  b.box(-1.02, y0 + 0.05, 0, 0.12, 0.18, 1.0, STEEL);

  if (look.body === "wedge") {
    b.box(0.1, y0 + 0.26, 0, 1.9, 0.38, 0.96, paint, 0.55, -0.42, 0.8);
    b.box(0.72, y0 + 0.16, 0, 0.5, 0.14, 1.0, accent, 0.7, 0.1);
    b.box(-0.86, y0 + 0.78, 0, 0.3, 0.06, 1.24, accent);
    b.box(-0.86, y0 + 0.55, 0.5, 0.08, 0.42, 0.06, DARK);
    b.box(-0.86, y0 + 0.55, -0.5, 0.08, 0.42, 0.06, DARK);
  } else if (look.body === "buggy") {
    b.box(0.15, y0 + 0.2, 0, 1.5, 0.28, 0.9, paint, 0.9);
    b.box(0.8, y0 + 0.22, 0, 0.36, 0.3, 0.7, paintDark, 0.7, 0.05);
    b.box(-0.72, y0 + 0.3, 0, 0.46, 0.44, 0.66, STEEL, 0.8);
    // Roll cage.
    for (const z of [-0.42, 0.42]) {
      b.box(0.28, y0 + 0.72, z, 0.07, 0.86, 0.07, accent);
      b.box(-0.5, y0 + 0.72, z, 0.07, 0.86, 0.07, accent);
      b.box(-0.11, y0 + 1.15, z, 0.86, 0.07, 0.07, accent);
    }
    b.box(0.28, y0 + 1.15, 0, 0.07, 0.07, 0.9, accent);
    b.box(-0.5, y0 + 1.15, 0, 0.07, 0.07, 0.9, accent);
    b.box(0.3, y0 + 1.24, 0.24, 0.12, 0.1, 0.16, "#fff3b0");
    b.box(0.3, y0 + 1.24, -0.24, 0.12, 0.1, 0.16, "#fff3b0");
  } else if (look.body === "bubble") {
    b.box(0.1, y0 + 0.2, 0, 1.7, 0.3, 1.0, paint, 0.86);
    b.box(0.62, y0 + 0.42, 0, 0.7, 0.26, 0.86, paint, 0.6, -0.08, 0.7);
    b.box(-0.66, y0 + 0.46, 0, 0.6, 0.34, 0.88, paint, 0.6, 0.06, 0.7);
    b.box(0.94, y0 + 0.2, 0.3, 0.1, 0.14, 0.18, "#fff3b0");
    b.box(0.94, y0 + 0.2, -0.3, 0.1, 0.14, 0.18, "#fff3b0");
    b.box(0.1, y0 + 0.07, 0, 1.74, 0.07, 1.04, accent);
    b.box(-0.8, y0 + 0.95, 0.3, 0.03, 0.6, 0.03, STEEL);
    b.box(-0.8, y0 + 1.28, 0.3, 0.11, 0.11, 0.11, accent);
  } else {
    // Classic: nose cone, side pods, engine, wing.
    b.box(0.66, y0 + 0.19, 0, 0.74, 0.26, 0.56, paint, 0.55, 0.12);
    b.box(-0.05, y0 + 0.18, 0.5, 0.86, 0.24, 0.26, paint, 0.85);
    b.box(-0.05, y0 + 0.18, -0.5, 0.86, 0.24, 0.26, paint, 0.85);
    b.box(-0.7, y0 + 0.28, 0, 0.5, 0.42, 0.62, STEEL, 0.8);
    b.box(-0.7, y0 + 0.52, 0, 0.3, 0.1, 0.4, DARK);
    b.box(0.98, y0 + 0.08, 0, 0.2, 0.06, 1.16, accent);
    b.box(-0.96, y0 + 0.86, 0, 0.26, 0.06, 1.1, accent);
    b.box(-0.96, y0 + 0.6, 0.42, 0.07, 0.5, 0.06, DARK);
    b.box(-0.96, y0 + 0.6, -0.42, 0.07, 0.5, 0.06, DARK);
    b.box(0.5, y0 + 0.34, 0, 0.3, 0.02, 0.3, "#f8f9fa");
  }
  // Exhausts.
  b.box(-1.08, y0 + 0.2, 0.22, 0.2, 0.1, 0.1, "#5c6370");
  b.box(-1.08, y0 + 0.2, -0.22, 0.2, 0.1, 0.1, "#5c6370");
  // Seat, driver, steering wheel.
  b.box(-0.36, y0 + 0.4, 0, 0.12, 0.56, 0.5, DARK);
  b.box(-0.16, y0 + 0.42, 0, 0.36, 0.46, 0.44, accent, 0.85);
  b.box(0.08, y0 + 0.5, 0.2, 0.36, 0.1, 0.1, accent);
  b.box(0.08, y0 + 0.5, -0.2, 0.36, 0.1, 0.1, accent);
  b.box(0.3, y0 + 0.5, 0, 0.05, 0.22, 0.3, DARK);
  b.box(-0.14, y0 + 0.86, 0, 0.38, 0.36, 0.4, look.helmet, 0.86);
  b.box(0.04, y0 + 0.86, 0, 0.08, 0.14, 0.34, "#1b1d24");
  b.box(-0.14, y0 + 1.06, 0, 0.3, 0.05, 0.08, accent);

  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const ghost = opts.ghost === true;
  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    transparent: ghost,
    opacity: ghost ? 0.42 : 1,
    depthWrite: !ghost,
  });
  const bodyGeo = b.build();
  body.add(new THREE.Mesh(bodyGeo, material));

  // Wheels.
  const chunky = look.wheels === "chunky";
  const rr = chunky ? 0.36 : 0.31;
  const rf = chunky ? 0.32 : 0.27;
  const hub = look.wheels === "drift" ? "#f6c343" : look.wheels === "chunky" ? "#adb5bd" : look.accent;
  const sides = chunky ? 6 : 8;
  const wf = new MeshBuilder();
  wf.wheel(rf, chunky ? 0.34 : 0.26, sides, "#2a2c33", hub);
  const wr = new MeshBuilder();
  wr.wheel(rr, chunky ? 0.4 : 0.34, sides, "#2a2c33", hub);
  const geoF = wf.build();
  const geoR = wr.build();
  const wheels: THREE.Mesh[] = [];
  const frontPivots: THREE.Group[] = [];
  const spots: Array<[number, number, number, boolean]> = [
    [0.68, rf, 0.62, true],
    [0.68, rf, -0.62, true],
    [-0.68, rr, 0.66, false],
    [-0.68, rr, -0.66, false],
  ];
  for (const [x, y, z, front] of spots) {
    const mesh = new THREE.Mesh(front ? geoF : geoR, material);
    if (front) {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, z);
      pivot.add(mesh);
      group.add(pivot);
      frontPivots.push(pivot);
    } else {
      mesh.position.set(x, y, z);
      group.add(mesh);
    }
    wheels.push(mesh);
  }
  if (ghost) group.traverse((o) => (o.renderOrder = 5));
  return {
    group,
    body,
    wheels,
    frontPivots,
    wheelRadius: rr,
    dispose: () => {
      bodyGeo.dispose();
      geoF.dispose();
      geoR.dispose();
      material.dispose();
    },
  };
}

/** Draw a tiny canvas pixel by pixel and return it as a crisp texture. */
export function pixelTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, repeat = false): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  draw(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  return tex;
}

export function asphaltTexture(rand: () => number): THREE.CanvasTexture {
  return pixelTexture(
    32,
    32,
    (ctx) => {
      const shades = ["#4a4d57", "#454851", "#50535d", "#3f424b"];
      for (let y = 0; y < 32; y += 1) {
        for (let x = 0; x < 32; x += 1) {
          ctx.fillStyle = shades[Math.floor(rand() * rand() * shades.length)]!;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    },
    true,
  );
}

export function checkerTexture(): THREE.CanvasTexture {
  return pixelTexture(
    8,
    2,
    (ctx) => {
      for (let y = 0; y < 2; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          ctx.fillStyle = (x + y) % 2 === 0 ? "#f8f9fa" : "#16181d";
          ctx.fillRect(x, y, 1, 1);
        }
      }
    },
    true,
  );
}

export function arrowTexture(): THREE.CanvasTexture {
  return pixelTexture(
    8,
    8,
    (ctx) => {
      ctx.fillStyle = "#ff7b00";
      ctx.fillRect(0, 0, 8, 8);
      ctx.fillStyle = "#ffe066";
      // Chevron pointing along +v.
      const rows = [3, 2, 1, 0, 3, 2, 1, 0];
      for (let y = 0; y < 8; y += 1) {
        const inset = rows[y]!;
        ctx.fillRect(inset, y, 1, 1);
        ctx.fillRect(7 - inset, y, 1, 1);
        if (inset < 3) {
          ctx.fillRect(inset + 1, y, 1, 1);
          ctx.fillRect(6 - inset, y, 1, 1);
        }
      }
    },
    true,
  );
}

export function boxTexture(): THREE.CanvasTexture {
  return pixelTexture(8, 8, (ctx) => {
    ctx.fillStyle = "#ffd60a";
    ctx.fillRect(0, 0, 8, 8);
    ctx.fillStyle = "#ff9f1c";
    ctx.fillRect(0, 0, 8, 1);
    ctx.fillRect(0, 7, 8, 1);
    ctx.fillRect(0, 0, 1, 8);
    ctx.fillRect(7, 0, 1, 8);
    ctx.fillStyle = "#ffffff";
    // A little lightning bolt.
    const px = [[4, 1], [3, 2], [3, 3], [4, 3], [5, 3], [4, 4], [3, 5], [4, 5], [3, 6]];
    for (const [x, y] of px) ctx.fillRect(x!, y!, 1, 1);
  });
}

export function crowdTexture(rand: () => number): THREE.CanvasTexture {
  // One big texel per spectator: a head over a shirt, so a row of seats reads
  // as a row of people at game resolution instead of as noise.
  return pixelTexture(
    24,
    2,
    (ctx) => {
      const shirts = ["#c1121f", "#f6c343", "#2f8fb5", "#f8f9fa", "#4f9d2d", "#d9722b"];
      const skins = ["#f1c9a5", "#c98f62", "#8d5a3b"];
      for (let x = 0; x < 24; x += 1) {
        const empty = rand() < 0.12;
        ctx.fillStyle = empty ? "#3a3f4b" : skins[Math.floor(rand() * skins.length)]!;
        ctx.fillRect(x, 0, 1, 1);
        ctx.fillStyle = empty ? "#2b2f38" : shirts[Math.floor(rand() * shirts.length)]!;
        ctx.fillRect(x, 1, 1, 1);
      }
    },
    true,
  );
}

/** 3×5 pixel glyphs, rows top to bottom, 3 bits each. */
const GLYPHS: Record<string, string> = {
  A: "010101111101101",
  B: "110101110101110",
  C: "011100100100011",
  D: "110101101101110",
  E: "111100110100111",
  F: "111100110100100",
  G: "011100101101011",
  H: "101101111101101",
  I: "111010010010111",
  J: "001001001101010",
  K: "101101110101101",
  L: "100100100100111",
  M: "101111111101101",
  N: "110101101101101",
  O: "010101101101010",
  P: "110101110100100",
  Q: "010101101110011",
  R: "110101110101101",
  S: "011100010001110",
  T: "111010010010010",
  U: "101101101101111",
  V: "101101101101010",
  W: "101101111111101",
  X: "101101010101101",
  Y: "101101010010010",
  Z: "111001010100111",
  "!": "010010010000010",
};

/** Banner text in a 3×5 pixel font (up to 9 characters), crisp at any distance. */
export function bannerTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  return pixelTexture(40, 7, (ctx) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 40, 7);
    ctx.fillStyle = fg;
    const chars = text.toUpperCase().slice(0, 9).split("");
    const width = chars.length * 4 - 1;
    let x = Math.floor((40 - width) / 2);
    for (const ch of chars) {
      const g = GLYPHS[ch];
      if (g) {
        for (let i = 0; i < 15; i += 1) if (g[i] === "1") ctx.fillRect(x + (i % 3), 1 + Math.floor(i / 3), 1, 1);
      }
      x += 4;
    }
  });
}

export function blobTexture(): THREE.CanvasTexture {
  return pixelTexture(8, 8, (ctx) => {
    ctx.clearRect(0, 0, 8, 8);
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    const rows = [[2, 4], [1, 6], [0, 8], [0, 8], [0, 8], [0, 8], [1, 6], [2, 4]];
    rows.forEach(([x, w], y) => ctx.fillRect(x!, y, w!, 1));
  });
}

/** A round pixel sun with a soft outer ring. */
export function sunTexture(color: string): THREE.CanvasTexture {
  return pixelTexture(16, 16, (ctx) => {
    ctx.clearRect(0, 0, 16, 16);
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const d = Math.hypot(x - 7.5, y - 7.5);
        if (d < 5.2) {
          ctx.fillStyle = color;
          ctx.fillRect(x, y, 1, 1);
        } else if (d < 7.4) {
          ctx.fillStyle = "rgba(255,255,255,0.28)";
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  });
}
