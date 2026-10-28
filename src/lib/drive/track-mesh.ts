import type { TrackGradeSample } from "@/lib/drive/elevation";
import type { DrivePoint } from "@/lib/drive/types";

/** Match DRIVE_PHYSICS.curbStartFrac — keep mesh free of physics import. */
const CURB_START_FRAC = 0.78;

export type TrackMeshBuffers = {
  asphalt: Float32Array;
  asphaltIndex: Uint32Array;
  curb: Float32Array;
  curbIndex: Uint32Array;
  grass: Float32Array;
  grassIndex: Uint32Array;
  stripe: Float32Array;
};

function frameAt(
  centerline: DrivePoint[],
  grades: TrackGradeSample[],
  i: number,
): {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  bank: number;
} {
  const prev = centerline[Math.max(0, i - 1)]!;
  const next = centerline[Math.min(centerline.length - 1, i + 1)]!;
  const p = centerline[i]!;
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const len = Math.hypot(dx, dy) || 1;
  const tx = dx / len;
  const ty = dy / len;
  const nx = -ty;
  const ny = tx;
  const bank = grades[i]?.bank ?? 0;
  return {
    x: p.x,
    y: p.y,
    z: p.z ?? grades[i]?.z ?? 0,
    nx,
    ny,
    bank,
  };
}

/** Map drive ENU (x=east, y=north, z=up) → three.js (x, y-up, z=-north). */
export function enuToThree(
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  return [x, z, -y];
}

function pushQuadStrip(
  positions: number[],
  indices: number[],
  centerline: DrivePoint[],
  grades: TrackGradeSample[],
  innerHalf: number,
  outerHalf: number,
  baseVertex: number,
): number {
  const n = centerline.length;
  for (let i = 0; i < n; i += 1) {
    const f = frameAt(centerline, grades, i);
    const sinB = Math.sin(f.bank);
    const cosB = Math.cos(f.bank);
    const iOff = innerHalf;
    const oOff = outerHalf;
    const iz = f.z + sinB * iOff;
    const oz = f.z + sinB * oOff;
    const ix = f.x + f.nx * iOff * cosB;
    const iy = f.y + f.ny * iOff * cosB;
    const ox = f.x + f.nx * oOff * cosB;
    const oy = f.y + f.ny * oOff * cosB;
    const [tx0, ty0, tz0] = enuToThree(ix, iy, iz);
    const [tx1, ty1, tz1] = enuToThree(ox, oy, oz);
    positions.push(tx0, ty0, tz0, tx1, ty1, tz1);
  }
  for (let i = 0; i < n - 1; i += 1) {
    const a = baseVertex + i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, b, c, b, d, c);
  }
  return baseVertex + n * 2;
}

function pushFullRibbon(
  positions: number[],
  indices: number[],
  centerline: DrivePoint[],
  grades: TrackGradeSample[],
  halfW: number,
  baseVertex: number,
): number {
  const n = centerline.length;
  for (let i = 0; i < n; i += 1) {
    const f = frameAt(centerline, grades, i);
    const sinB = Math.sin(f.bank);
    const cosB = Math.cos(f.bank);
    const lx = f.x + f.nx * halfW * cosB;
    const ly = f.y + f.ny * halfW * cosB;
    const lz = f.z + sinB * halfW;
    const rx = f.x - f.nx * halfW * cosB;
    const ry = f.y - f.ny * halfW * cosB;
    const rz = f.z - sinB * halfW;
    const [llx, lly, llz] = enuToThree(lx, ly, lz);
    const [rrx, rry, rrz] = enuToThree(rx, ry, rz);
    positions.push(llx, lly, llz, rrx, rry, rrz);
  }
  for (let i = 0; i < n - 1; i += 1) {
    const a = baseVertex + i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, c, b, b, c, d);
  }
  return baseVertex + n * 2;
}

/**
 * Build low-poly road / curb / grass meshes from GPS centerline + grade profile.
 */
export function buildTrackMeshBuffers(
  centerline: DrivePoint[],
  halfWidthM: number,
  grades: TrackGradeSample[],
  grassExtraM = 14,
): TrackMeshBuffers {
  const asphaltHalf = halfWidthM * CURB_START_FRAC;
  const curbHalf = halfWidthM;

  const asphaltPos: number[] = [];
  const asphaltIdx: number[] = [];
  pushFullRibbon(asphaltPos, asphaltIdx, centerline, grades, asphaltHalf, 0);

  const curbPos: number[] = [];
  const curbIdx: number[] = [];
  let base = 0;
  base = pushQuadStrip(
    curbPos,
    curbIdx,
    centerline,
    grades,
    asphaltHalf,
    curbHalf,
    base,
  );
  pushQuadStrip(
    curbPos,
    curbIdx,
    centerline,
    grades,
    -asphaltHalf,
    -curbHalf,
    base,
  );

  const grassPos: number[] = [];
  const grassIdx: number[] = [];
  base = 0;
  base = pushQuadStrip(
    grassPos,
    grassIdx,
    centerline,
    grades,
    curbHalf,
    curbHalf + grassExtraM,
    base,
  );
  pushQuadStrip(
    grassPos,
    grassIdx,
    centerline,
    grades,
    -curbHalf,
    -(curbHalf + grassExtraM),
    base,
  );

  const stripe: number[] = [];
  for (const p of centerline) {
    const [x, y, z] = enuToThree(p.x, p.y, p.z ?? 0);
    stripe.push(x, y + 0.04, z);
  }

  return {
    asphalt: new Float32Array(asphaltPos),
    asphaltIndex: new Uint32Array(asphaltIdx),
    curb: new Float32Array(curbPos),
    curbIndex: new Uint32Array(curbIdx),
    grass: new Float32Array(grassPos),
    grassIndex: new Uint32Array(grassIdx),
    stripe: new Float32Array(stripe),
  };
}
