# Disaster Village Design

## Overview

Rename **Critter Haven** to **Disaster Village** and expand the game with a points-and-unlock shop, four unlockable tech blocks, four new disasters, and four new challenge levels.

## Decisions

### 1. Rename to Disaster Village

- Update page title in `index.html` and documentation in `README.md` to **Disaster Village**.
- Update level 10's display title (`Disaster Village`) and blurb while keeping `id: 'critter-haven'` and `PROGRESS_KEY = 'critter-haven:progress:v1'` for backward compatibility with existing saved progress.

### 2. Approach: Tech Blocks as Special `MaterialType`s (Approach A)

- Implement **Anchor Block**, **Steel**, **Shield Projector**, and **Laser** as entries in `MaterialType` (`'anchor' | 'steel' | 'shield' | 'laser'`).
- All unlockable blocks reuse the standard 8×8×8 grid, **Block** placement tool, Mirror, Undo, Erase, Paint, `BlueprintGraph` serialization, and instanced rendering pipeline, avoiding a separate gadget layer.
- Behavior metadata lives on `MaterialDef` (`cost`, `description`, `anchorMultiplier`, `special: 'shield' | 'laser'`).

### 3. Points & Unlock Shop

- **Earning points:** `100` points per best star earned on each challenge level, plus a `+50` point first-clear bonus when reaching `level.goalStars` (`POINTS_PER_STAR = 100`, `CLEAR_BONUS = 50`). Points are derived directly from `BestStars` minus spent unlock costs, preventing infinite farming on replays.
- **Persistence:** Unlocked material ids persist in `localStorage` under `disaster-village:shop:v1` (`SHOP_KEY`), always including `BASE_MATERIALS` (`wood`, `stone`, `bamboo`, `foam`).
- **Shop UI:** Top-center **Shop** button displaying available points opens a modal where players inspect descriptions/costs and unlock tech blocks. **BuildPanel** shows unlocked tech blocks in a dedicated row and greys out locked ones with a lock indicator.

### 4. Four Unlockable Tech Blocks

1. **Anchor (`150 pts`):** Heavy ground-gripping block with `3×` foundation anchor stress limit, steel-grade joints, and zero buoyancy.
2. **Steel (`250 pts`):** High-stiffness (`2.0×`), high-stress (`2.6×`) structural material for blocks and braces.
3. **Shield Projector (`350 pts`):** While intact and non-fallen during a disaster, projects a glowing translucent aura (`radius: 5.5` world units) that reinforces nearby joints (`1.8×` stiffness, `3.0×` stress break limit).
4. **Laser (`500 pts`):** While intact and non-fallen during a disaster, periodically targets and destroys the nearest active airborne projectile within range (`range: 18`, `cooldown: 0.45 s`), emitting a glowing beam effect and zap sound.

### 5. Four New Disasters (8 Total) & Four New Levels (14 Total)

Built on a unified, seeded projectile system in `PhysicsSim`:

- **`fire_tornado` (`Fire`):** Swirling vortex wind plus flying fireballs hurled inward.
- **`snow_storm` (`Snow`):** Blizzard wind plus falling snow/ice chunks.
- **`raid` (`Raid`):** Perimeter waves of raiders/cannonballs launched directly at village blocks.
- **`meteor` (`Meteor`):** Heavy high-speed flaming meteors falling from high altitude.

Four new challenge levels (`blizzard-barn`, `flame-vortex`, `bandit-raid`, `meteor-finale`) follow level 10 so players can earn points for and test all new disasters and tech blocks.
