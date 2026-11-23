# Disaster Village — Laser Balance & Mods Design

## Overview

Tune the **Laser** block so turret placement and multiple defenses matter, and add a Minecraft-style **Mods & Visual Mod Creator** system so players can toggle starter mod packs, build their own custom blocks/disasters/world rules, and export/import `.json` mods.

## Decisions

### 1. Laser Balance Nerf

- **Range:** Reduced from `18` to `11` world units (covers roughly half the island instead of the entire build area).
- **Fire rate:** Cooldown slowed from `0.45s` to `1.2s` between shots so swarms overwhelm a single laser and reward building multiple turrets plus shields.
- **Heavy Meteors (`2 HP`):** Meteors take `2` laser hits to destroy (first hit chips and slows the meteor; second hit vaporizes it). Smaller hazards (`hail`, `fireball`, `snowball`, `raider`, and modded `custom` projectiles) still take `1` hit.

### 2. Mod System (Approach A — Visual Mod Creator + Mod Packs)

- **Mod Schema (`GameMod`):** Each mod has an `id`, `name`, `description`, `builtIn` flag, `enabled` toggle, `blocks: ModBlockDef[]`, `disasters: ModDisasterDef[]`, and optional `rules: { gravityMultiplier, durationSeconds }`.
- **Three Built-In Starter Mods** (all OFF by default):
  1. **Moon Gravity (`moon-gravity`):** `0.35×` gravity + **Moon Rock** block.
  2. **Obsidian & Ice (`obsidian-ice`):** **Obsidian** block (`4.0×` max stress, heavy), **Ice** block (light, brittle), and **Acid Rain** disaster.
  3. **Chaos Pack (`chaos-pack`):** **Super Core** shield block, **Mega Storm** disaster (simultaneous quake, wind, and targeted fireballs), and `12s` disaster duration.
- **Visual Mod Creator & Sharing:** Inside the **Mods** modal (`ModsPanel`), players can toggle mods on/off, create or edit custom mods with custom blocks, disasters, and world rules, delete custom mods, and export/import `.json` mod files.
- **Scoping:** Active mod blocks, disasters, and world rules (`gravityMultiplier`, `durationSeconds`) apply in **Free Build** (`levelId === null`). Challenge levels keep their curated vanilla rules.
- **Persistence:** Saved in `localStorage` under `disaster-village:mods:v1` (`MODS_KEY`).
