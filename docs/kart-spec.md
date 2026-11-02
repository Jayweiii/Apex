# Apex Kart: spec (issue #48)

Status: **approved by Jason** (see issue #48). Replaces the drift-game plan in #44 and keeps #44's tire and drift physics. Lives at `/kart`; `/drive` is unchanged.

A pixel-art kart racer with drift handling, on levels loosely based on real tracks. The game is original: our own names, art and item set. tibo.dog is a reference for *feel only* (fast start, juicy feedback, quick choices, satisfying end screen). No auto-fire, no enemy swarms.

## Goals (from Jason)
1. Levels loosely based on real tracks: Thunderhill, Buttonwillow, Streets of Willow.
2. Cute pixel art.
3. Checkpoint gates every car must drive through, in order.
4. Out of bounds slows the car.
5. Items (kart-racer style).
6. Car customization where each part changes performance.
7. Progress saves to the account (Supabase).
8. Drifty, rear-steered handling: Pacejka tires with load transfer, as in #44.

## Feel principles (from the tibo.dog notes)
- **Fast start.** Moving within ~2 s of load or restart. No menu before the first race; any intro is skippable.
- **Juicy feedback.** Floating numbers on drift/gate/item, dust and tire puffs, a light pillar on gate-streak milestones, pickups that pull toward the car, smooth blending between track sections.
- **Quick choices.** Item and part choices are one tap, with NEW / LV n labels and one RECOMMENDED pick (phase 3).
- **Big moments.** Rivals enter with letterbox bars, a name card and a taunt (phase 5).
- **Strong end screen.** Contribution bars (drift, gates, items), fun stats (drifts, gates, off-track time), a flavor line, one-tap restart, Share button (share image in phase 4).
- **Light HUD.** Timer and lap at top, item slot at bottom, edge arrows to off-screen item boxes, a Build overlay with full stats (phase 3).

## Architecture
```
src/lib/kart/            pure TypeScript, no DOM: deterministic, unit-tested
  rng.ts                 seeded PRNG (mulberry32); the only source of randomness
  tire.ts                Pacejka magic formula, load-sensitive mu, friction ellipse
  car.ts                 4-wheel planar model: load transfer, RWD + LSD, handbrake
  track.ts               level geometry: centerline, width, gates, bounds queries
  race.ts                checkpoints, laps, out-of-bounds, items, drift score
  sim.ts                 fixed-step world: step(world, inputs), no allocation
  levels/*.ts            baked level data (centerline in local meters, gates, boxes)
src/components/kart/
  KartGame.tsx           shell: HUD, touch pads, keyboard, pause; React only for chrome
  renderer.ts            Canvas2D pixel renderer (low-res buffer, nearest-neighbour scale)
  sprites.ts             pixel art drawn in code, packed into one atlas at startup
  audio.ts               WebAudio chiptune + engine/squeal synth (phase 3)
src/app/kart/page.tsx    route
```
- **Deterministic sim.** Fixed step 1/120 s, inputs quantized per tick, seeded PRNG only. Same seed + input log gives a bit-identical result (replays, ghosts, server score checks in phase 4).
- **No allocation in the hot loop.** Preallocated state, ring buffers for particles and skid marks. Per-frame files use the `.hot.ts` suffix; a verify script rejects `new`, object/array literals and `.map`/`.filter` inside them.
- **Render decoupled from physics.** `requestAnimationFrame` runs accumulated ticks (cap 8 per frame), then draws once. Canvas2D into a ~240 px wide buffer, scaled with nearest-neighbour. Top-down heading-up camera that swings with yaw while drifting.
- **React only for chrome.** Per-frame HUD values are written to the DOM via refs, so React never re-renders at 60 Hz (the cause of the missed taps in #43).

## Physics (from #44)
- **Tire.** `F = D·sin(C·atan(B·x − E·(B·x − atan(B·x))))`; lateral from slip angle, longitudinal from slip ratio. Load-sensitive grip `mu = mu0·(1 − k·(Fz/Fz0 − 1))`. Combined slip via friction ellipse `(Fx/Fxmax)² + (Fy/Fymax)² ≤ 1`.
- **Loads.** Static 52/48 split plus longitudinal transfer `m·ax·h/L` and lateral transfer `m·ay·h/track`. The four loads always sum to `m·g` (tested).
- **Drivetrain.** RWD with limited-slip diff, so throttle breaks the rear loose. Lift-off and trail-brake oversteer fall out of load transfer; handbrake locks the rears.
- **Rear steer feel.** Steering input drives the rear axle slip/yaw bias so the tail swings around the nose; tuned by bot tests so a lap is completable without constant countersteer.
- **Controls.** Keyboard: WASD/arrows + Space handbrake. Touch: steer pads and gas/brake/drift buttons, each ≥ 44 pt, all working on a single tap.
- **Off track.** Grass mu ×0.45, drag ×8. Far outside, a wall keeps speed along the wall and loses 40%.

## Data model
Levels are static data: `{ id, name, basedOn, centerline: Float32Array (m), halfWidth, gates: {s}[], itemBoxes: {s, lane}[], spawn }`.

Thunderhill is baked from a simplified real GPS lap (public session `340f914a`, Thunderhill West, lap 11, 1:34.8), converted to local meters, resampled and smoothed.

Supabase tables (phase 4), RLS restricts rows to the owner:
- `kart_progress`: `user_id` (PK), `unlocked_levels`, `parts`, `loadout`, `coins`.
- `kart_runs`: `level_id`, `loadout`, `seed`, `input_log`, `lap_ms`, `drift_score`, `verified`.

A run reaches the leaderboard only after the server replays its `input_log` and gets the same result.

**Parts** (phase 3) change tuning only: tires (mu0, Pacejka B/C), engine (torque, top speed), body (mass, CG height), wing (rear downforce `k·v²`).

## Items (original)
- **Turbo**: 1.2 s extra drive torque.
- **Oil slick**: dropped behind the car; anything crossing it gets rear mu ×0.35 for 0.8 s.

Boxes respawn after 4 s; which item you get comes from the seeded RNG.

## Phases (one small PR each concern, per #34)
| Phase | PRs | Acceptance |
|---|---|---|
| **1. Playable slice** | (a) sim core + unit tests · (b) pixel renderer, Thunderhill level, touch/keyboard, `/kart` route · (c) Turbo + Oil slick, end screen | Drift a lap; gates driven in order; off-track slows; items work; 60 fps on a mid-range phone; no double taps |
| 2. Levels | Buttonwillow · Streets of Willow · level select · ghost replay | A bot lap validates each level's gates |
| 3. Garage and sound | Parts + loadout · Build overlay · chiptune per area · engine/squeal synth | Parts measurably change bot lap time |
| 4. Accounts | Tables + RLS · save/load · server replay check · leaderboard · share images | Replayed run time matches; RLS tested |
| 5. Polish | Headless difficulty bots · gzipped bundle budget in CI · rivals | `/kart` adds ≤ 120 KB gzipped |

Tests per PR: unit tests as `scripts/verify-kart-*.ts` (picked up by `npm test`), covering determinism (same seed + inputs ⇒ identical state hash), load-sum invariant, tire force limits, gate ordering, off-track drag, item effects, and the `.hot.ts` allocation lint.

## Verification on an iPhone-size screen
For every PR:
- Playwright iPhone 13 profile (390×844) taps Start, holds Gas and Steer, asserts time, distance and the next gate advance.
- The tap-trap probe from #43 finds no DOM change between touchend and click on any control.
- Canvas fills the viewport; every control ≥ 44 px.
- Frame time measured with CPU throttled 4×; most frames ≤ 16.7 ms.
