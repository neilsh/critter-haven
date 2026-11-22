# Implementation plan

Engine code (three.js, Rapier, audio) is strictly decoupled from React. The only bridge is
`src/state/store.ts` (engine writes, React reads) and the `GameActions` interface (React calls engine).

## Conventions
Defined in `src/types/blueprint.ts`: blocks live on a 2-unit cell grid (8x8 cells = 16x16 world units),
struts connect integer corner lattice points, ids are deterministic (`b:x,y,z`, `s:a-b`).

## Work packages (file ownership)
| Pkg | Owns | Notes |
|---|---|---|
| 0 | scaffold, `types/*`, `state/store.ts`, `engine/Game.ts`, stubs | this PR |
| A | `engine/PhysicsSim.ts` (+ `*.test.ts`) | Rapier sim, 4 disasters, X-ray, win state, headless calibration tests |
| B | `engine/SceneManager.ts` | renderer, island, lighting, orbit + azimuth tween, disposal |
| C | `engine/BuildController.ts` | block/brace/paint/erase/mirror/undo/clear, ghost preview |
| D | `engine/ProceduralAssets.ts` | rounded blocks, canvas textures, Web Audio synth |
| E | `components/*`, `App.tsx` | Tailwind HUD, `data-testid` on every control |
| F | `engine/debug.ts`, `e2e/` | `window.__GAME_DEBUG__`, Playwright smoke test |

Each stub file's header comment states the fixed contract. Change a contract only via a PR that
updates the stub and every caller.

## Spec changes agreed
- Strain ratio is joint stretch divided by a per-material limit (Rapier exposes no joint force).
- Physics must run headless in Node so tower-fails / house-survives is a Vitest test.
- Seeded RNG for gusts and hail. Playwright for the browser smoke test.
- Critters are out of scope for v1.
