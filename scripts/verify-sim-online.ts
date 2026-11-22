/**
 * Apex Sim online races: lobby players, host-only starts, repeat paints, the
 * snapshot wire format, smoothing other cars, the grid, race distance and the
 * running order, and a real two-car standing start driven by the test driver.
 * Pure, no network. Run with `npm test -- sim-online`.
 */
import westData from "../src/lib/rush/data/thunderhill-west.json";
import { createCar, ND_MIATA } from "../src/lib/sim/car";
import {
  acceptSimStart,
  decodeSimSnapshot,
  distinctSimPaints,
  encodeSimSnapshot,
  gridSpot,
  INTERP_DELAY_MS,
  MAX_DRIVERS,
  MAX_EXTRAPOLATE_MS,
  raceDistance,
  readSimPlayer,
  RemoteCar,
  SEND_HZ,
  SIM_PAINTS,
  simStandings,
  type RemotePose,
  type SimPlayer,
  type SimStanding,
} from "../src/lib/sim/online";
import { blankInput, createGridSession, createPilot, pilotInput, stepSession } from "../src/lib/sim/session";
import { buildSimTrack, type SimTrackData } from "../src/lib/sim/track";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

// ── Message budget: SEND_HZ · N · (N−1) under Supabase's free 100/s ──
assert(SEND_HZ * MAX_DRIVERS * (MAX_DRIVERS - 1) <= 100, "a full lobby stays under 100 realtime messages a second");

// ── Players from presence ──
{
  const p = readSimPlayer({ name: "  <b>Sam</b>!! ", paint: "javascript:", laps: 7, racing: "yes" }, "1abc");
  assert(p.id === "1abc", "the id is the presence key, not anything in the payload");
  assert(p.name === "bSamb", `names are cleaned (${p.name})`);
  assert(p.paint === SIM_PAINTS[0], "a bad paint falls back");
  assert(p.laps === 3 && p.racing === false, "a bad lap count and racing flag fall back");
  assert(readSimPlayer({}, "x").name === "Driver", "a missing name gets a default");
}

// ── Host-only start ──
const pl = (id: string, paint: string = SIM_PAINTS[0]): SimPlayer => ({ id, name: id, paint, laps: 3, racing: false });
{
  const players = [pl("1b"), pl("0a")];
  const msg = (from: unknown, extra: object = {}) => ({
    raceId: "r1",
    laps: 5,
    startInMs: 6000,
    from,
    grid: [
      { id: "0a", name: "Ann", paint: SIM_PAINTS[0] },
      { id: "1b", name: "Bo", paint: SIM_PAINTS[0] },
      { id: "9z", name: "Ghost", paint: SIM_PAINTS[1] },
    ],
    ...extra,
  });
  const ok = acceptSimStart(msg("0a"), players);
  assert(ok && ok.laps === 5 && ok.grid.length === 2, "the host's start is accepted; drivers not in the lobby are dropped");
  assert(ok.grid[0]!.paint !== ok.grid[1]!.paint, "two cars on one paint are told apart on the grid");
  assert(acceptSimStart(msg("1b"), players) === null, "a guest can't start a race");
  assert(acceptSimStart(msg(undefined), players) === null, "a start with no sender is ignored");
  assert(acceptSimStart(msg("0a", { startInMs: "soon" }), players) === null, "a malformed start is ignored");
  assert(acceptSimStart(msg("0a", { grid: [] }), players) === null, "an empty grid is ignored");
  assert(acceptSimStart(null, players) === null, "a non-object is ignored");
  assert(acceptSimStart(msg("0a", { startInMs: 1e9 }), players)!.startInMs === 15000, "the lead time is capped");
  assert(acceptSimStart(msg("0a", { laps: 99 }), players)!.laps === 3, "an unknown lap count falls back to the default");
  // The host left: the next lowest id hosts, and the old host's id no longer starts races.
  assert(acceptSimStart(msg("0a"), [pl("1b")]) === null, "a departed host can't start");
}

// ── Paints ──
{
  const all = distinctSimPaints([0, 1, 2].map((i) => ({ id: `1${i}`, paint: SIM_PAINTS[0] as string })));
  assert(new Set(all.map((e) => e.paint)).size === 3, "three cars on the default paint get three paints");
  assert(all[0]!.paint === SIM_PAINTS[0], "the first keeps theirs");
  assert(JSON.stringify(distinctSimPaints(all)) === JSON.stringify(all), "repainting twice changes nothing");
  const kept = distinctSimPaints([{ paint: SIM_PAINTS[2] as string }, { paint: SIM_PAINTS[3] as string }]);
  assert(kept[0]!.paint === SIM_PAINTS[2] && kept[1]!.paint === SIM_PAINTS[3], "different paints are kept");
}

// ── Snapshots ──
const track = buildSimTrack(westData as SimTrackData);
{
  const car = createCar(ND_MIATA);
  car.x = 123.456;
  car.y = -78.9;
  car.z = 41.25;
  car.heading = 1.2345;
  car.vx = 30;
  car.vy = 1;
  car.steer = 0.05;
  car.brake = 0.5;
  const snap = decodeSimSnapshot(encodeSimSnapshot(car, 1000, 2500.5, 1, false, 0, 95123));
  assert(snap, "a snapshot round-trips");
  assert(near(snap.x, 123.46, 0.01) && near(snap.y, -78.9, 0.01) && near(snap.heading, 1.2345, 0.001), "position and heading survive");
  assert(near(snap.speed, Math.hypot(30, 1), 0.01) && snap.braking && snap.laps === 1 && snap.dist === 2500.5, "speed, brakes, laps and distance survive");
  assert(decodeSimSnapshot([1, 2, 3]) === null, "a short snapshot is refused");
  assert(decodeSimSnapshot(Array(15).fill(Number.NaN)) === null, "non-numbers are refused");
  const wild = decodeSimSnapshot([0, 1e9, -1e9, 1e9, 0, 1e6, 9, 9, -9, 1, 1e12, 500, 1, -5, 1e15])!;
  assert(Math.abs(wild.x) <= 50000 && wild.speed <= 120 && Math.abs(wild.steer) <= 1 && Math.abs(wild.roll) <= 0.5, "wild values are clamped");
  assert(wild.laps === 99 && wild.finishMs === 0 && wild.bestLapMs <= 6 * 3_600_000, "laps and times are clamped");
}

// ── Smoothing another car ──
{
  const rc = new RemoteCar();
  const pose: RemotePose = { x: 0, y: 0, z: 0, heading: 0, speed: 0, steer: 0, roll: 0, pitch: 0, braking: false };
  assert(!rc.sample(0, pose), "nothing to draw before the first packet");
  const mk = (t: number, x: number) => decodeSimSnapshot([t, x, 0, 0, 0, 40, 0, 0, 0, 0, x, 0, 0, 0, 0])!;
  // Their clock is 5 s ahead of ours; packets take 50 ms.
  for (let k = 0; k <= 4; k += 1) rc.push(mk(5000 + k * 250, k * 10), k * 250 + 50);
  // At our 650 ms we draw their 650 − 50 − INTERP_DELAY ms ≈ 280 ms: between the 2nd and 3rd packets.
  rc.sample(650, pose);
  const theirT = 650 - 50 - INTERP_DELAY_MS;
  assert(near(pose.x, (theirT / 250) * 10, 0.05), `blends between snapshots (${pose.x.toFixed(2)})`);
  // Long after the last packet: carried on along the heading, but no further than the cap.
  rc.sample(10_000, pose);
  assert(near(pose.x, 40 + 40 * (MAX_EXTRAPOLATE_MS / 1000), 0.05), "carries on at most MAX_EXTRAPOLATE_MS past the last packet");
  // A stale, out-of-order packet is ignored.
  rc.push(mk(5100, 999), 1200);
  rc.sample(10_000, pose);
  assert(pose.x < 100, "late packets don't jump the car back");
}

// ── Grid and race distance ──
{
  const spots = [0, 1, 2].map(gridSpot);
  assert(spots.every((sp) => sp.back > 0 && Math.abs(sp.side) < track.halfWidth - 1), "every grid spot is behind the line, on the asphalt");
  assert(spots[0]!.side !== spots[1]!.side && spots[1]!.back > spots[0]!.back, "the grid is staggered left and right, front to back");
  const L = track.length;
  assert(near(raceDistance(track, false, 0, L - 12), -12, 1e-6), "on the grid: negative distance to the line");
  assert(near(raceDistance(track, true, 1, 100), 100, 1e-6) && near(raceDistance(track, true, 3, 5), 2 * L + 5, 1e-6), "racing: laps done plus distance past the line");
}

// ── Running order ──
{
  const row = (id: string, o: Partial<SimStanding>): SimStanding => ({ id, name: id, paint: "#000000", dist: 0, laps: 0, finished: false, finishMs: 0, bestLapMs: 0, gone: false, you: false, ...o });
  const order = simStandings([
    row("racing-far", { dist: 9000 }),
    row("left", { dist: 99999, gone: true }),
    row("slow-finish", { finished: true, finishMs: 300_000, dist: 7800 }),
    row("fast-finish", { finished: true, finishMs: 290_000, dist: 7800 }),
    row("racing-near", { dist: 8000 }),
  ]).map((r) => r.id);
  assert(JSON.stringify(order) === JSON.stringify(["fast-finish", "slow-finish", "racing-far", "racing-near", "left"]), `order: ${order.join(", ")}`);
}

// ── A real standing start: two cars from the grid, one lap, the finish time ──
{
  const pilot = createPilot(track, ND_MIATA, 0.9);
  const cars = [0, 1].map((slot) => {
    const sp = gridSpot(slot);
    return { ses: createGridSession(track, ND_MIATA, sp.back, sp.side), input: blankInput(), finishMs: 0 };
  });
  assert(cars.every((c) => c.ses.car.wheelsOff === 0), "grid cars start on the asphalt");
  assert(raceDistance(track, cars[0]!.ses.started, cars[0]!.ses.lap, cars[0]!.ses.car.hit.s) > raceDistance(track, cars[1]!.ses.started, cars[1]!.ses.lap, cars[1]!.ses.car.hit.s), "pole is ahead of second on the grid");
  for (let frame = 0; frame < 60 * 400 && cars.some((c) => !c.finishMs); frame += 1) {
    for (const c of cars) {
      if (c.finishMs) continue;
      pilotInput(pilot, c.ses, c.input);
      stepSession(c.ses, c.input);
      if (c.ses.lapDone && c.ses.lap - 1 >= 1) c.finishMs = c.ses.clockMs - c.ses.lapMs;
    }
  }
  for (const c of cars) {
    assert(c.finishMs > 0, "each car finishes a one-lap race");
    // Race time = the run to the line + one full lap.
    assert(c.finishMs > c.ses.lastLapMs && c.finishMs < c.ses.lastLapMs + 15_000, `race time is the run-up plus the lap (${c.finishMs} vs lap ${c.ses.lastLapMs})`);
  }
  assert(cars[0]!.finishMs < cars[1]!.finishMs, "with the same driver, pole finishes first");
}

console.log("verify-sim-online: ok");
