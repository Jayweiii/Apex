# Apex Kart: spec (issue #48)

This spec covers a pixel-art kart racer with drift handling, on levels loosely based on
real tracks. It replaces the drift-game plan in #44 and keeps #44's tire and drift physics.
It's an original game: genre mechanics (items, part tuning), but our own names, art and
music. It lives at **`/kart`**; `/drive` stays as it is.

## Goals (from Jason)

1. Levels loosely based on real tracks: Thunderhill, Buttonwillow, Streets of Willow.
2. Cute pixel art.
3. Checkpoint gates that every car must drive through, in order.
4. Going out of bounds slows the car down.
5. Items (kart-racer style).
6. Car customization, where each part changes performance.
7. Progress saves to the account (Supabase).
8. Drifty handling, steered from the rear: a Pacejka tire model with load transfer, as in #44.

## Architecture

```
src/lib/kart/            pure TypeScript, no DOM: deterministic and unit-tested
  rng.ts                 seeded PRNG (mulberry32); the only source of randomness
  tire.ts                Pacejka magic formula, load-sensitive mu, friction ellipse
  car.ts                 4-wheel planar model: load transfer, RWD + LSD, handbrake
  track.ts               level geometry: centerline, width, gates, bounds queries
  race.ts                checkpoints, laps, out-of-bounds, items, drift score
  sim.ts                 fixed-step world: step(world, inputs) with no allocation
  levels/*.ts            baked level data (centerline in local meters, gates, boxes)
src/components/kart/
  KartGame.tsx           shell: HUD, touch pads, keyboard, pause; React only for chrome
  renderer.ts            Canvas2D pixel renderer (low-res buffer, nearest-neighbour scale)
  sprites.ts             pixel art drawn in code, packed into one atlas at startup
  audio.ts               WebAudio chiptune and engine/squeal synth (phase 3)
src/app/kart/page.tsx    route
```

- **Deterministic sim.** The fixed timestep is 1/120 s, and inputs are quantized per tick.
  The game loop calls only `step(world, input)`, and the renderer only reads state. With a
  seeded PRNG, the same seed and input log give a bit-identical result. That's what makes
  replays, ghosts and server-side score checks possible later (phase 4).
- **No allocation in the hot loop.** The world, cars, particles and skid marks are
  preallocated, ring buffers are reused, and there are no closures per tick. Files whose
  code runs every frame use the `.hot.ts` suffix. A verify script rejects `new`, array or
  object literals and `.map`/`.filter` inside them.
- **Render decoupled from physics.** `requestAnimationFrame` runs the accumulated physics
  ticks (capped at 8 per frame, so the game slows down rather than spiralling), then draws
  once. Canvas2D renders into a buffer of about 240×(240·aspect) and scales up with
  `imageSmoothingEnabled = false`. The camera is top-down and follows the car with the
  car's heading pointing up, swinging with yaw while drifting.
- **React only for chrome.** The HUD values that change every frame are written to the DOM
  through refs, so React never re-renders at 60 Hz. (#43 found that per-frame React renders
  were what made taps get missed.)

## Physics (from #44)

- **Tire.** Pacejka magic formula, `F = D·sin(C·atan(B·x − E·(B·x − atan(B·x))))`, with
  lateral force from slip angle and longitudinal force from slip ratio. Grip is
  load-sensitive: `mu = mu0 · (1 − k·(Fz/Fz0 − 1))`. Combined slip uses a friction ellipse:
  `(Fx/Fx_max)² + (Fy/Fy_max)² ≤ 1`, scaled down when it would exceed it.
- **Loads.** Per wheel: static weight split (52/48 for the Miata-like default), plus
  longitudinal transfer `m·ax·h/L` and lateral transfer `m·ay·h/track`. The four loads
  always sum to `m·g`, which is tested.
- **Drivetrain.** Rear-wheel drive with a limited-slip diff (a torque bias ratio), so
  throttle breaks the rear loose. Lift-off and trail-brake oversteer come out of the load
  transfer. The handbrake locks the rears.
- **Controls.** Steer, throttle, brake and handbrake ("Drift"). Keyboard: WASD or arrows,
  plus Space. Touch: left/right steer pads and gas/brake/drift buttons, each at least 44pt,
  all working on a single tap.
- **Off track.** Outside the track's half-width: grass mu ×0.45 and rolling drag ×8. Far
  outside: a hard wall that keeps the car's speed along the wall but loses 40%.

## Data model

Level data is static and lives in code:

```ts
type KartLevel = { id: string; name: string; basedOn: string;
  centerline: Float32Array /* x,y in m, closed loop */; halfWidth: number;
  gates: { s: number }[] /* arc length along centerline */;
  itemBoxes: { s: number; lane: number }[]; spawn: { s: number } };
```

Supabase tables (phase 4), with RLS limiting rows to their owner:

```sql
create table kart_progress (
  user_id uuid primary key references auth.users,
  unlocked_levels text[] not null default '{thunderhill}',
  parts jsonb not null default '{}',      -- owned parts
  loadout jsonb not null default '{}',    -- equipped: body/engine/tires/wing
  coins int not null default 0, updated_at timestamptz default now());
create table kart_runs (
  id uuid primary key default gen_random_uuid(), user_id uuid references auth.users,
  level_id text not null, loadout jsonb not null, seed int not null,
  input_log bytea not null,               -- quantized per-tick inputs (replayable)
  lap_ms int not null, drift_score int not null, verified boolean default false,
  created_at timestamptz default now());
```

A run's time counts on a leaderboard only after the server replays its `input_log` and gets
the same result.

**Parts** (phase 3) change the car's tuning, never its rules: tires change mu0 and the
Pacejka B/C coefficients; the engine changes torque and top speed; the body changes mass and
centre-of-gravity height; the wing adds rear downforce `k·v²`.

## Items (original)

- **Turbo**: 1.2 s of extra drive torque.
- **Oil slick**: dropped behind the car. Anything that drives over it gets rear mu ×0.35 for
  0.8 s, which spins it into a drift.

Item boxes respawn after 4 s. Which item you get comes from the seeded RNG, weighted by race
position.

## Phases

Each phase is split into small PRs with one concern each (#34). Every PR has green CI and a
Vercel preview that's playable at 390×844 with touch.

| Phase | PRs | Acceptance |
|---|---|---|
| **1. Playable slice** (tonight) | Sim core (tire, car, track, race, deterministic step) with tests · Pixel renderer, Thunderhill level, touch/keyboard controls at `/kart` · Turbo and Oil slick | You can drift a lap of Thunderhill-ish, gates must be driven in order, off-track slows you, items work, 60 fps on a mid-range phone, no double taps |
| 2. Levels | Buttonwillow, Streets of Willow · level select · AI-free time trial with a ghost replay | Each level's gates are validated by a test lap from a bot |
| 3. Garage and sound | Parts and loadout UI · chiptune music per area · engine and squeal synth | Parts measurably change lap time in the bot tests |
| 4. Accounts | `kart_progress` and `kart_runs` tables · save and load · server replay check · leaderboard · share images | A replayed run's time matches; RLS is tested |
| 5. Polish | Headless bots tune difficulty · bundle budget in CI · rival bots | Gzipped size of `/kart` ≤ 120 KB beyond what the app already loads |

## Verification on an iPhone-size screen

For every PR:

- Playwright with the iPhone 13 profile (`hasTouch`, 390×844). The test taps Start, then
  holds Gas and Steer, and asserts that time, distance and the next gate advance.
- The tap-trap probe from #43 runs on every control. No DOM changes may happen between
  touchend and click.
- The canvas fills the viewport below the HUD, and every control is at least 44 px.
- Frame time is measured with the CPU throttled 4×; most frames must take 16.7 ms or less.
- The Vercel preview link goes on the PR.
