import { describe, expect, it } from 'vitest';
import { BASE_MATERIALS, MATERIALS } from '../types/blueprint';
import { LEVELS } from './levels';
import {
  CLEAR_BONUS,
  POINTS_PER_STAR,
  PROGRESS_KEY,
  SHOP_KEY,
  computeAvailablePoints,
  computeSpentPoints,
  computeTotalPoints,
  computeUnlocked,
  loadBest,
  loadUnlockedMaterials,
  recordResult,
  saveBest,
  saveUnlockedMaterials,
  tryUnlockMaterial,
  type StorageLike,
} from './progress';

function fakeStorage(initial?: string, key = PROGRESS_KEY): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>(initial === undefined ? [] : [[key, initial]]);
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

const [first, second, third] = LEVELS;
if (!first || !second || !third) throw new Error('need at least three levels');

describe('computeUnlocked', () => {
  it('opens only the first level at the start', () => {
    expect(computeUnlocked(LEVELS, {})).toEqual([first.id]);
  });

  it('needs the goal stars to open the next level', () => {
    expect(computeUnlocked(LEVELS, { [first.id]: 0 })).toEqual([first.id]);
    expect(computeUnlocked(LEVELS, { [first.id]: first.goalStars })).toEqual([first.id, second.id]);
  });

  it('does not skip ahead over a level that is not beaten', () => {
    expect(computeUnlocked(LEVELS, { [third.id]: 3 })).toEqual([first.id]);
  });
});

describe('recordResult', () => {
  it('unlocks the next level once and keeps the best score', () => {
    const win = recordResult(LEVELS, {}, first.id, 3);
    expect(win).toMatchObject({ goalReached: true, newlyUnlocked: second.id, best: { [first.id]: 3 } });
    const again = recordResult(LEVELS, win.best, first.id, 1);
    expect(again.best[first.id]).toBe(3);
    expect(again.newlyUnlocked).toBeNull();
  });

  it('reports a miss without unlocking', () => {
    const miss = recordResult(LEVELS, {}, second.id, 0);
    expect(miss).toMatchObject({ goalReached: false, newlyUnlocked: null });
  });

  it('ignores unknown levels', () => {
    expect(recordResult(LEVELS, {}, 'nope', 3)).toEqual({
      best: {},
      goalReached: false,
      newlyUnlocked: null,
    });
  });
});

describe('persistence', () => {
  it('round-trips through storage', () => {
    const storage = fakeStorage();
    saveBest({ [first.id]: 2 }, storage);
    expect(loadBest(LEVELS, storage)).toEqual({ [first.id]: 2 });
  });

  it('survives corrupt, hostile or missing data', () => {
    expect(loadBest(LEVELS, fakeStorage('{not json'))).toEqual({});
    expect(loadBest(LEVELS, fakeStorage('[1,2]'))).toEqual({});
    expect(loadBest(LEVELS, fakeStorage('null'))).toEqual({});
    expect(
      loadBest(LEVELS, fakeStorage(JSON.stringify({ [first.id]: 9, ghost: 3, [second.id]: 2 }))),
    ).toEqual({
      [second.id]: 2,
    });
    expect(loadBest(LEVELS, null)).toEqual({});
  });

  it('does not throw when storage is blocked', () => {
    const blocked: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadBest(LEVELS, blocked)).toEqual({});
    expect(() => saveBest({}, blocked)).not.toThrow();
  });
});

describe('points and shop unlocks', () => {
  it('computes points per best star plus clear bonus', () => {
    expect(computeTotalPoints(LEVELS, {})).toBe(0);
    // first has goalStars=1, third has goalStars=2
    const best = { [first.id]: 3 as const, [third.id]: 1 as const };
    expect(computeTotalPoints(LEVELS, best)).toBe(3 * POINTS_PER_STAR + CLEAR_BONUS + 1 * POINTS_PER_STAR);
  });

  it('computes spent and available points without dropping below zero', () => {
    const best = { [first.id]: 2 as const }; // 2 * 100 + 50 = 250 pts
    expect(computeSpentPoints(BASE_MATERIALS)).toBe(0);
    expect(computeSpentPoints([...BASE_MATERIALS, 'anchor'])).toBe(MATERIALS.anchor.cost);
    expect(computeAvailablePoints(LEVELS, best, [...BASE_MATERIALS, 'anchor'])).toBe(
      250 - (MATERIALS.anchor.cost ?? 0),
    );
    expect(computeAvailablePoints(LEVELS, {}, [...BASE_MATERIALS, 'laser'])).toBe(0);
  });

  it('tryUnlockMaterial validates cost and ownership', () => {
    const best = { [first.id]: 2 as const }; // 250 pts
    // Laser costs 500 -> fails
    expect(tryUnlockMaterial(LEVELS, best, BASE_MATERIALS, 'laser').ok).toBe(false);
    // Anchor costs 150 -> succeeds
    const buyAnchor = tryUnlockMaterial(LEVELS, best, BASE_MATERIALS, 'anchor');
    expect(buyAnchor.ok).toBe(true);
    expect(buyAnchor.unlocked).toContain('anchor');
    // Buying anchor again -> fails
    expect(tryUnlockMaterial(LEVELS, best, buyAnchor.unlocked, 'anchor').ok).toBe(false);
    // Remaining 100 pts < Steel 250 -> fails
    expect(tryUnlockMaterial(LEVELS, best, buyAnchor.unlocked, 'steel').ok).toBe(false);
  });

  it('round-trips unlocked materials and handles corrupt storage', () => {
    const storage = fakeStorage();
    saveUnlockedMaterials([...BASE_MATERIALS, 'shield'], storage);
    expect(loadUnlockedMaterials(storage)).toEqual([...BASE_MATERIALS, 'shield']);
    expect(loadUnlockedMaterials(fakeStorage('{bad', SHOP_KEY))).toEqual(BASE_MATERIALS);
    expect(loadUnlockedMaterials(fakeStorage(JSON.stringify(['nope', 123, 'laser']), SHOP_KEY))).toEqual([
      ...BASE_MATERIALS,
      'laser',
    ]);
  });
});
