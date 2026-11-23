import { describe, expect, it } from 'vitest';
import { LEVELS } from './levels';
import {
  PROGRESS_KEY,
  computeUnlocked,
  loadBest,
  recordResult,
  saveBest,
  type StorageLike,
} from './progress';

function fakeStorage(initial?: string): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>(initial === undefined ? [] : [[PROGRESS_KEY, initial]]);
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
