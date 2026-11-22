/**
 * Apex Rush online contracts: lobby codes, the snapshot wire format, remote
 * kart smoothing, host hand-over, and the race engine with remote karts.
 * Pure, no network. Run with `npm test -- rush-online`.
 */
import { DEFAULT_LOOK, sanitizeLook, statsFor } from "../src/lib/rush/garage";
import { createKart, DT, type KartInput } from "../src/lib/rush/kart";
import { RUSH_LEVELS } from "../src/lib/rush/levels";
import {
  cleanName,
  CODE_LENGTH,
  decodeSnapshot,
  encodeSnapshot,
  INTERP_DELAY_MS,
  makeLobbyCode,
  MAX_EXTRAPOLATE_MS,
  normalizeLobbyCode,
  pickHost,
  RemoteKart,
  type LobbyPlayer,
} from "../src/lib/rush/net";
import { autopilot, createRace, stepRace } from "../src/lib/rush/race";
import { buildRushTrack } from "../src/lib/rush/track";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// ── Codes ──
{
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i += 1) {
    const c = makeLobbyCode(rand);
    assert(c.length === CODE_LENGTH && /^[A-Z2-9]+$/.test(c), `code ${c} is ${CODE_LENGTH} readable characters`);
    assert(!/[01OIL]/.test(c), `code ${c} has no look-alike characters`);
    assert(normalizeLobbyCode(c) === c, "a made code is accepted as typed");
    seen.add(c);
  }
  assert(seen.size > 1900, "codes rarely repeat");
  assert(normalizeLobbyCode(" k7q-x ") === "K7QX", "lower case, spaces and dashes are forgiven");
  assert(normalizeLobbyCode("K7Q") === null && normalizeLobbyCode("K7QXZ") === null, "wrong length is rejected");
  assert(normalizeLobbyCode("K0QX") === null, "characters outside the alphabet are rejected");
  assert(cleanName("  <script>Bob</script> ", "Racer") === "scriptBobscrip", "names keep letters and digits only, 14 max");
  assert(cleanName("   ", "Racer") === "Racer", "an empty name falls back");
  assert(sanitizeLook({ body: "rocket", paint: "red" }).body === DEFAULT_LOOK.body, "an unknown kart part falls back");
}

// ── Host ──
{
  const p = (id: string, joinedAt: number): LobbyPlayer => ({ id, name: id, joinedAt, look: DEFAULT_LOOK });
  assert(pickHost([p("b", 20), p("a", 10), p("c", 30)])!.id === "a", "the longest-present player hosts");
  assert(pickHost([p("b", 20), p("c", 30)])!.id === "b", "when the host leaves, the next oldest takes over");
  assert(pickHost([p("z", 5), p("y", 5)])!.id === "y", "ties are broken the same way on every device");
  assert(pickHost([]) === null, "no players, no host");
}

// ── Snapshots ──
{
  const k = createKart(3, statsFor(DEFAULT_LOOK));
  Object.assign(k, { x: 12.3456, y: -7.891, z: 1.5, heading: 1.23456, va: 1.2, v: 18.765, steer: -0.4, drifting: -1, chargeLevel: 2, boostT: 0.3, lap: 2, progress: 812.345, finished: true, finishMs: 61234.4, bestLapMs: 20111 });
  const wire = encodeSnapshot(k, 1234.6);
  assert(JSON.stringify(wire).length < 120, `a snapshot is small on the wire (${JSON.stringify(wire).length} bytes)`);
  const s = decodeSnapshot(JSON.parse(JSON.stringify(wire)));
  assert(s && Math.abs(s.x - 12.35) < 0.006 && s.drifting === -1 && s.chargeLevel === 2 && s.boosting && s.lap === 2 && s.finished && s.finishMs === 61234, "a snapshot survives the round trip");
  assert(decodeSnapshot([1, 2, 3]) === null && decodeSnapshot("x") === null && decodeSnapshot(wire.map((v, i) => (i === 3 ? Number.NaN : v))) === null, "malformed snapshots are dropped");
}

// ── Smoothing a remote kart ──
{
  const r = new RemoteKart();
  const out = createKart(1, statsFor(DEFAULT_LOOK));
  assert(!r.sample(0, out), "no snapshot yet: nothing to draw");
  // Sender clock runs 5000 ms behind ours; packets take 60 ms; 8 per second along +x at 20 m/s.
  const snap = (t: number) => decodeSnapshot([t, (t / 1000) * 20, 0, 0, 0, 0, 20, 0, 0, 0, 0, 1, 0, 0, 0, 0])!;
  for (let t = 0; t <= 1000; t += 125) r.push(snap(t), t + 5000 + 60);
  // Out of order and duplicate packets are ignored.
  r.push(snap(500), 9999);
  assert(r.latest!.t === 1000, "late packets do not rewind the kart");
  const now = 1000 + 5000 + 60;
  r.sample(now, out);
  const expected = ((1000 - INTERP_DELAY_MS) / 1000) * 20;
  assert(Math.abs(out.x - expected) < 0.05, `drawn a little in the past, between snapshots (x ${out.x.toFixed(2)} vs ${expected.toFixed(2)})`);
  // Packets stop: the kart carries on along its heading, then holds.
  r.sample(now + INTERP_DELAY_MS + 200, out);
  assert(Math.abs(out.x - (20 + 0.2 * 20)) < 0.1, "a late packet is bridged by moving on at the last speed");
  r.sample(now + 10_000, out);
  assert(Math.abs(out.x - (20 + (MAX_EXTRAPOLATE_MS / 1000) * 20)) < 0.1, "and the guess stops after a short while");
}

// ── Online race engine ──
const level = RUSH_LEVELS[0]!;
const track = buildRushTrack(level.data);
{
  const world = createRace(track, "gp", statsFor(DEFAULT_LOOK), { online: { count: 4, slot: 2 } });
  assert(world.karts.length === 4, "one kart per racer, no AI");
  assert(world.ai.every((a) => a === null), "nobody is driven by AI online");
  const me = world.karts[0]!;
  assert(me.id === 2 && !me.remote && world.karts.slice(1).every((k) => k.remote), "this device drives its own grid slot; the others are remote");
  assert(new Set(world.karts.map((k) => k.id)).size === 4, "every grid slot is on the grid once");

  // Remote karts are not stepped: they only move when snapshots say so.
  const other = world.karts[1]!;
  const ox = other.x;
  const input: KartInput = { steer: 0, throttle: 1, brake: 0, drift: false, useItem: false };
  for (let i = 0; i < 120; i += 1) stepRace(world, input);
  assert(other.x === ox, "a remote kart is not moved by this device's physics");
  assert(Math.hypot(me.x - world.karts[1]!.x, me.y - world.karts[1]!.y) > 0.1, "the local kart drives");

  // Places count everyone, from their reported progress.
  other.progress = me.progress + 50;
  stepRace(world, input);
  assert(other.place < me.place, "a remote kart ahead on the road is ahead in the standings");
  other.gone = true;
  stepRace(world, input);
  assert(other.place === world.karts.length, "a player who left drops to the back");
}
{
  // Bumping into a remote kart pushes only the local one.
  const world = createRace(track, "gp", statsFor(DEFAULT_LOOK), { online: { count: 2, slot: 0 } });
  const me = world.karts[0]!;
  const them = world.karts[1]!;
  them.x = me.x + 1;
  them.y = me.y;
  const tx = them.x;
  const idle: KartInput = { steer: 0, throttle: 0, brake: 0, drift: false, useItem: false };
  const before = Math.hypot(them.x - me.x, them.y - me.y);
  stepRace(world, idle);
  assert(them.x === tx, "the remote kart is left where its owner put it");
  assert(Math.hypot(them.x - me.x, them.y - me.y) > before, "the local kart is pushed clear");
}
{
  // A full online race with two devices simulated side by side, each seeing
  // the other only through snapshots: both finish and agree who won.
  const a = createRace(track, "gp", statsFor(DEFAULT_LOOK), { online: { count: 2, slot: 0 } });
  const b = createRace(track, "gp", statsFor({ ...DEFAULT_LOOK, body: "bubble" }), { online: { count: 2, slot: 1 } });
  const ra = new RemoteKart();
  const rb = new RemoteKart();
  const ia: KartInput = { steer: 0, throttle: 0, brake: 0, drift: false, useItem: false };
  const ib: KartInput = { ...ia };
  let ms = 0;
  for (let tick = 0; tick < 60 * 400 && !(a.karts[0]!.finished && b.karts[0]!.finished); tick += 1) {
    ms += DT * 1000;
    if (tick % 8 === 0) {
      rb.push(decodeSnapshot(encodeSnapshot(a.karts[0]!, ms))!, ms + 40); // a → b
      ra.push(decodeSnapshot(encodeSnapshot(b.karts[0]!, ms))!, ms + 40); // b → a
    }
    ra.sample(ms, a.karts[1]!);
    rb.sample(ms, b.karts[1]!);
    stepRace(a, autopilot(a, ia));
    stepRace(b, autopilot(b, ib));
  }
  assert(a.karts[0]!.finished && b.karts[0]!.finished, "both racers finish");
  // Let the last snapshots arrive.
  for (let i = 0; i < 20; i += 1) {
    ms += 50;
    rb.push(decodeSnapshot(encodeSnapshot(a.karts[0]!, ms))!, ms + 40);
    ra.push(decodeSnapshot(encodeSnapshot(b.karts[0]!, ms))!, ms + 40);
    ra.sample(ms + 1000, a.karts[1]!);
    rb.sample(ms + 1000, b.karts[1]!);
    stepRace(a, ia);
    stepRace(b, ib);
  }
  const aWon = a.karts[0]!.place === 1;
  const bWon = b.karts[0]!.place === 1;
  assert(aWon !== bWon, "exactly one winner");
  assert(a.karts[1]!.finished && b.karts[1]!.finished, "each device sees the other finish");
  assert(Math.abs(a.karts[1]!.finishMs - b.karts[0]!.finishMs) < 1, "finish times agree across devices");
}

console.log("verify-rush-online: ok");
