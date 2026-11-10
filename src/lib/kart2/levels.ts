import { THUNDERHILL_EAST_CENTERLINE } from "@/lib/centerlines";
import type { Kart2Level } from "./track";
import { THUNDERHILL_WEST_ALT_M, THUNDERHILL_WEST_LATLON } from "./levels/thunderhill-west";

function metersToLatLon(
  lat0: number,
  lon0: number,
  pts: ReadonlyArray<readonly [number, number]>,
): Array<[number, number]> {
  const mLat = 111320;
  const mLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return pts.map(([east, north]) => [lat0 + north / mLat, lon0 + east / mLon]);
}

function shapedAlt(n: number, base: number, amp: number, phase: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = (i / n) * Math.PI * 2;
    out.push(base + amp * (Math.sin(t + phase) * 0.72 + Math.sin(t * 2 + 0.5) * 0.28));
  }
  return out;
}

/**
 * Buttonwillow 13CW-inspired loop, anchored on the catalog pin.
 * The site ships a reference point for this circuit, not a traced centreline,
 * so the shape is a simplified clockwise layout at the real venue
 * (long front straight, hairpin, sweeper, esses) with a few metres of relief.
 */
const BUTTONWILLOW_METERS: ReadonlyArray<readonly [number, number]> = [
  [0, -320],
  [280, -340],
  [560, -260],
  [760, -80],
  [820, 140],
  [700, 340],
  [440, 460],
  [140, 490],
  [-80, 400],
  [-200, 240],
  [-160, 80],
  [-40, 20],
  [60, 80],
  [30, 180],
  [-90, 220],
  [-230, 120],
  [-340, -20],
  [-420, -180],
  [-300, -300],
  [-80, -340],
];

/**
 * Streets of Willow CW-inspired loop, anchored on the catalog pin.
 * Tighter than Buttonwillow: a stadium bowl, a sweeper, and a kinked straight.
 */
const STREETS_METERS: ReadonlyArray<readonly [number, number]> = [
  [30, -170],
  [210, -160],
  [340, -40],
  [310, 100],
  [160, 180],
  [10, 200],
  [-110, 130],
  [-150, 20],
  [-80, -30],
  [20, 20],
  [-10, 80],
  [-120, 100],
  [-190, 20],
  [-170, -90],
  [-40, -180],
];

const buttonwillowLatLon = metersToLatLon(35.4913, -119.5449, BUTTONWILLOW_METERS);
const streetsLatLon = metersToLatLon(34.874, -118.263, STREETS_METERS);

const eastLatLon = THUNDERHILL_EAST_CENTERLINE.slice(0, -1).map(
  (p) => [p.lat, p.lon] as [number, number],
);

export const KART2_LEVELS: Kart2Level[] = [
  {
    id: "thunderhill-west",
    name: "Thunderhill West",
    short: "West",
    basedOn: "Thunderhill Raceway — West",
    blurb: "Real lap trace · USGS elevation",
    scale: 0.4,
    halfWidth: 7.2,
    latLon: THUNDERHILL_WEST_LATLON,
    altM: THUNDERHILL_WEST_ALT_M,
    vertExaggeration: 1.7,
    surveyedElevation: true,
  },
  {
    id: "thunderhill-east",
    name: "Thunderhill East",
    short: "East",
    basedOn: "Thunderhill Raceway — East",
    blurb: "Site centreline · shaped relief",
    scale: 0.34,
    halfWidth: 7.2,
    latLon: eastLatLon,
    altM: shapedAlt(eastLatLon.length, 96, 14, 0.4),
    vertExaggeration: 1.5,
    surveyedElevation: false,
  },
  {
    id: "buttonwillow",
    name: "Buttonwillow",
    short: "Btnw",
    basedOn: "Buttonwillow Raceway — 13CW",
    blurb: "Venue layout · valley relief",
    scale: 0.62,
    halfWidth: 7,
    latLon: buttonwillowLatLon,
    altM: shapedAlt(buttonwillowLatLon.length, 88, 9, 1.1),
    vertExaggeration: 1.6,
    surveyedElevation: false,
  },
  {
    id: "streets",
    name: "Streets of Willow",
    short: "Willow",
    basedOn: "Streets of Willow — CW",
    blurb: "Venue layout · hillside relief",
    scale: 0.78,
    halfWidth: 6.6,
    latLon: streetsLatLon,
    altM: shapedAlt(streetsLatLon.length, 110, 16, 0.2),
    vertExaggeration: 1.55,
    surveyedElevation: false,
  },
];

export function getKart2Level(id: string | null | undefined): Kart2Level {
  return KART2_LEVELS.find((level) => level.id === id) ?? KART2_LEVELS[0]!;
}
