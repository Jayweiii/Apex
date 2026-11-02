/**
 * Seeded PRNG (mulberry32). The only randomness the sim may use, so a
 * (seed, input log) pair replays bit-identically.
 */
export type Rng = { state: number };

export function createRng(seed: number): Rng {
  return { state: seed >>> 0 };
}

/** Uniform in [0, 1). Mutates `rng`; allocation-free. */
export function nextRandom(rng: Rng): number {
  let t = (rng.state = (rng.state + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
