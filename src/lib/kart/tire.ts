/**
 * Tire model: Pacejka magic formula with load-sensitive friction and a
 * friction ellipse for combined slip (issue #44 physics).
 */

export type TireParams = {
  /** Peak friction coefficient at the nominal load. */
  mu0: number;
  /** Nominal (reference) wheel load, N. */
  fz0: number;
  /** Load sensitivity: mu drops by k per unit of Fz/Fz0 above 1. */
  loadSens: number;
  /** Pacejka stiffness / shape / curvature factors (lateral). */
  B: number;
  C: number;
  E: number;
};

export const DEFAULT_TIRE: TireParams = {
  // Kart slicks: grippier than street tires so corners stay quick.
  mu0: 1.45,
  fz0: 2600,
  loadSens: 0.12,
  B: 9.5,
  C: 1.65,
  E: 0.6,
};

/** Normalised magic formula, −1…1 (peak ≈ 1). x is slip angle in radians. */
export function magicFormula(x: number, B: number, C: number, E: number): number {
  const bx = B * x;
  return Math.sin(C * Math.atan(bx - E * (bx - Math.atan(bx))));
}

/** Load-sensitive friction coefficient (never below 30% of mu0). */
export function loadSensitiveMu(fz: number, tire: TireParams, surfaceMu = 1): number {
  const ratio = fz / tire.fz0;
  const mu = tire.mu0 * (1 - tire.loadSens * (ratio - 1));
  return Math.max(tire.mu0 * 0.3, mu) * surfaceMu;
}

/** Peak force available at this load (N). */
export function peakForce(fz: number, tire: TireParams, surfaceMu = 1): number {
  return Math.max(0, fz) * loadSensitiveMu(fz, tire, surfaceMu);
}

/**
 * Lateral force (N) for a slip angle, given the longitudinal force the tire
 * is already carrying. Friction ellipse: (Fx/Fmax)² + (Fy/Fmax)² ≤ 1, so the
 * more drive/brake force, the less cornering grip — that's what lets
 * throttle break the rear loose.
 */
export function lateralForce(
  slipAngle: number,
  fz: number,
  fx: number,
  tire: TireParams,
  surfaceMu = 1,
): number {
  const fmax = peakForce(fz, tire, surfaceMu);
  if (fmax <= 0) return 0;
  const used = Math.min(1, Math.abs(fx) / fmax);
  const remaining = Math.sqrt(1 - used * used);
  return -fmax * remaining * magicFormula(slipAngle, tire.B, tire.C, tire.E);
}

/** Clamp a requested longitudinal force to the tire's peak (N). */
export function clampLongitudinal(
  fxRequest: number,
  fz: number,
  tire: TireParams,
  surfaceMu = 1,
): number {
  const fmax = peakForce(fz, tire, surfaceMu);
  return Math.max(-fmax, Math.min(fmax, fxRequest));
}
