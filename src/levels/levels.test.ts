import { describe, expect, it } from 'vitest';
import { goalLines } from '../components/LevelPanel';
import { DISASTER_ORDER, cellInBounds } from '../types/blueprint';
import { buildHeight, canAddBlock, isMaterialAllowed } from './constraints';
import { LEVELS, getLevel } from './levels';

describe('LEVELS', () => {
  it('has about ten levels with unique ids and kid-friendly text', () => {
    expect(LEVELS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(LEVELS.map((l) => l.id)).size).toBe(LEVELS.length);
    for (const l of LEVELS) {
      expect(l.title.length).toBeGreaterThan(0);
      expect(l.blurb.length).toBeGreaterThan(10);
      expect(l.goalStars).toBeGreaterThanOrEqual(1);
      expect(getLevel(l.id)).toBe(l);
    }
    expect(getLevel('nope')).toBeUndefined();
  });

  it('ramps up: starts gentle and covers every disaster and strength', () => {
    expect(LEVELS[0]?.strength).toBe('gentle');
    expect(new Set(LEVELS.map((l) => l.disaster))).toEqual(new Set(DISASTER_ORDER));
    expect(new Set(LEVELS.map((l) => l.strength))).toEqual(new Set(['gentle', 'medium', 'strong']));
  });

  it('keeps every level achievable on paper', () => {
    for (const l of LEVELS) {
      const max = l.constraints?.maxBlocks ?? Infinity;
      const start = l.start?.() ?? { version: 1 as const, blocks: [], struts: [] };
      expect(start.blocks.every((b) => cellInBounds(b.cell))).toBe(true);
      expect(start.blocks.length).toBeLessThan(max);
      expect(start.blocks.every((b) => isMaterialAllowed(l.constraints, b.material))).toBe(true);
      expect(l.minHeight ?? 0).toBeLessThanOrEqual(max);
      expect(l.constraints?.materials?.length ?? 1).toBeGreaterThan(0);
    }
  });

  it('describes the goal in plain words', () => {
    const lookout = getLevel('squirrel-lookout');
    expect(lookout && goalLines(lookout)).toEqual([
      'Get 1 star',
      'Use up to 14 blocks',
      'Build 4 blocks tall',
    ]);
    const bamboo = getLevel('bamboo-bungalow');
    expect(bamboo && goalLines(bamboo)).toContain('Only Bamboo and Foam');
  });
});

describe('constraint helpers', () => {
  it('treats missing limits as unlimited', () => {
    expect(isMaterialAllowed(null, 'foam')).toBe(true);
    expect(isMaterialAllowed({}, 'foam')).toBe(true);
    expect(isMaterialAllowed({ materials: ['wood'] }, 'foam')).toBe(false);
    expect(canAddBlock(undefined, 999)).toBe(true);
    expect(canAddBlock({ maxBlocks: 3 }, 2)).toBe(true);
    expect(canAddBlock({ maxBlocks: 3 }, 3)).toBe(false);
  });

  it('measures build height in layers', () => {
    expect(buildHeight({ version: 1, blocks: [], struts: [] })).toBe(0);
    const tower = getLevel('wobbly-tower')?.start?.();
    expect(tower && buildHeight(tower)).toBe(4);
  });
});
