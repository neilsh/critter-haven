# Disaster Village — First-Person Mode & Health Design

## Overview

Add a toggleable **First-Person Mode** (`1st Person`) where the player stands on the island inside their village, takes health damage from disasters and falling debris, and automatically restarts the run back to full health if their HP reaches `0`.

## Decisions

### 1. Camera Toggle & Controls (Approach A)

- A **1st Person** toggle button in `CameraPanel` switches between the 3rd-person Orbit camera (for easy building) and First-Person walking/looking on the island.
- `FirstPersonController` handles `WASD` / Arrow keys to move, `Space` to jump, and canvas pointer drag-to-look, colliding cleanly against the island surface (`16×16` build area plus rim) and `2×2×2` block AABBs so players can walk into shelters and jump onto roofs without knocking over fragile blocks.
- When entering First-Person, `OrbitControls` and build placement are disabled and the player spawns at a clear spot near `(0, 0, 6.2)` facing the village center.

### 2. Health, Damage & Auto-Restart on 0 HP

- Player starts with `100 / 100 HP`.
- During an active disaster (`simulating` mode), `PhysicsSim.checkPlayerDamage(feet, dt)` checks hazards:
  - **Projectiles** (`🧊`, `❄️`, `🔥`, `💣`, `☄️`, mod projectiles): `12–45 HP` depending on hazard type; hitting the player consumes the projectile and triggers `0.45s` invulnerability frames.
  - **Falling/flying blocks** (`speed >= 2.8`): `20 HP` with `0.45s` invulnerability frames.
  - **Flood water** above head height: `25 HP/s` continuous drowning damage.
  - **Falling off the island** (`y < -6`): instant KO (`100 HP`).
- Taking impact damage triggers a red vignette flash in the HUD and hit sound (`AudioSynth.playHit()`).
- Reaching `0 HP` plays `AudioSynth.playKO()`, shows a `"<cause> Restarting..."` notice, restores `100 HP`, respawns the player on the island, and rewinds the run immediately.
