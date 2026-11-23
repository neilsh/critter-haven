import { describe, expect, it } from 'vitest';
import type { StorageLike } from '../levels/progress';
import {
  BUILTIN_MODS,
  MODS_KEY,
  exportModJson,
  loadMods,
  parseImportedMod,
  resolveActiveMods,
  sanitizeMod,
  saveMods,
  type GameMod,
} from './mods';

function fakeStorage(initial?: string): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>(initial === undefined ? [] : [[MODS_KEY, initial]]);
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe('mods system', () => {
  it('starts with built-in mods disabled and default world rules', () => {
    expect(BUILTIN_MODS.length).toBeGreaterThanOrEqual(3);
    expect(BUILTIN_MODS.every((m) => !m.enabled && m.builtIn)).toBe(true);
    const active = resolveActiveMods(BUILTIN_MODS);
    expect(active.activeCount).toBe(0);
    expect(active.blocks).toHaveLength(0);
    expect(active.disasters).toHaveLength(0);
    expect(active.gravityMultiplier).toBe(1);
    expect(active.durationSeconds).toBe(8);
  });

  it('resolves enabled blocks, disasters, gravity and duration across mods', () => {
    const toggled = BUILTIN_MODS.map((m) => ({ ...m, enabled: true }));
    const active = resolveActiveMods(toggled);
    expect(active.activeCount).toBe(BUILTIN_MODS.length);
    expect(active.blocks.map((b) => b.label)).toEqual(['Moon Rock', 'Obsidian', 'Ice', 'Super Core']);
    expect(active.disasters.map((d) => d.label)).toEqual(['Acid Rain', 'Mega Storm']);
    expect(active.blockMap.has('mod:obsidian-ice:obsidian')).toBe(true);
    expect(active.disasterMap.has('mod:chaos-pack:mega-storm')).toBe(true);
    expect(active.gravityMultiplier).toBeCloseTo(0.35);
    expect(active.durationSeconds).toBe(12);
  });

  it('persists built-in toggles and custom mods, surviving corrupt storage', () => {
    const storage = fakeStorage();
    const custom: GameMod = {
      id: 'custom:emerald',
      name: 'Emerald Pack',
      description: 'Shiny green blocks',
      enabled: true,
      blocks: [
        {
          id: 'custom:emerald:b',
          label: 'Emerald',
          color: 0x10b981,
          density: 1.5,
          stiffness: 1.8,
          maxStress: 3.0,
          buoyancy: 0.2,
        },
      ],
      disasters: [],
    };
    const mods = [...BUILTIN_MODS.map((m, i) => ({ ...m, enabled: i === 0 })), custom];
    saveMods(mods, storage);

    const loaded = loadMods(storage);
    expect(loaded[0]?.enabled).toBe(true);
    expect(loaded[1]?.enabled).toBe(false);
    expect(loaded.find((m) => m.id === 'custom:emerald')?.blocks[0]?.label).toBe('Emerald');

    expect(loadMods(fakeStorage('{bad json'))).toHaveLength(BUILTIN_MODS.length);
    expect(loadMods(fakeStorage('null'))).toHaveLength(BUILTIN_MODS.length);
  });

  it('exports and imports mod JSON with clamping and duplicate-id protection', () => {
    const custom: GameMod = {
      id: 'moon-gravity', // collides with built-in if imported raw
      name: 'Extreme Pack',
      description: 'Wild rules',
      enabled: true,
      blocks: [
        {
          id: 'b1',
          label: 'Ultra',
          color: 0xff00ff,
          density: 99,
          stiffness: 0.01,
          maxStress: 100,
          buoyancy: -5,
          special: 'shield',
        },
      ],
      disasters: [
        {
          id: 'd1',
          label: 'Swarm',
          color: 0x00ff00,
          quake: 5,
          projectiles: { mode: 'targeted', rate: 99, speed: 1, radius: 9, density: 0 },
        },
      ],
      rules: { gravityMultiplier: 99, durationSeconds: 999 },
    };

    const json = exportModJson(custom);
    const parsed = parseImportedMod(json, new Set(['custom:extreme-pack']));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('expected mod import to succeed');
    expect(parsed.mod.id).toBe('custom:extreme-pack-2');
    expect(parsed.mod.builtIn).toBe(false);
    expect(parsed.mod.blocks[0]).toMatchObject({
      density: 5,
      stiffness: 0.2,
      maxStress: 5,
      buoyancy: 0,
      special: 'shield',
    });
    expect(parsed.mod.disasters[0]?.projectiles).toMatchObject({
      mode: 'targeted',
      rate: 12,
      speed: 6,
      radius: 1.1,
      density: 0.5,
    });
    expect(parsed.mod.rules).toEqual({ gravityMultiplier: 2.5, durationSeconds: 20 });

    expect(parseImportedMod('{oops').ok).toBe(false);
    expect(parseImportedMod('{"blocks":[]}').ok).toBe(false);
    expect(sanitizeMod({ name: '   ' })).toBeNull();
  });
});
