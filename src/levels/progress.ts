/** Challenge-level progress: best stars per level, unlock rules and localStorage persistence. */
import type { Stars } from '../types/blueprint';
import type { Level } from './levels';

export type BestStars = Record<string, Stars>;

export const PROGRESS_KEY = 'critter-haven:progress:v1';

/** The slice of the Storage API we use, so tests can pass a fake. */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // blocked storage (private mode, sandboxed iframe)
  }
}

const toStars = (v: unknown): Stars | null => (v === 0 || v === 1 || v === 2 || v === 3 ? v : null);

/** Reads saved best stars. Unknown level ids and malformed values are dropped; failures give {}. */
export function loadBest(
  levels: readonly Level[],
  storage: StorageLike | null = defaultStorage(),
): BestStars {
  const best: BestStars = {};
  try {
    const raw = storage?.getItem(PROGRESS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (typeof parsed !== 'object' || parsed === null) return best;
    const saved = new Map(Object.entries(parsed));
    for (const level of levels) {
      const stars = toStars(saved.get(level.id));
      if (stars !== null && stars > 0) best[level.id] = stars;
    }
  } catch {
    // corrupt JSON or blocked storage: start fresh
  }
  return best;
}

export function saveBest(best: BestStars, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(PROGRESS_KEY, JSON.stringify(best));
  } catch {
    // quota or blocked storage: progress just will not persist
  }
}

/** The first level is always open; each later one opens when the one before reached its goal stars. */
export function computeUnlocked(levels: readonly Level[], best: BestStars): string[] {
  const out: string[] = [];
  for (const [i, level] of levels.entries()) {
    const prev = levels[i - 1];
    if (!prev || (best[prev.id] ?? 0) >= prev.goalStars) out.push(level.id);
    else break;
  }
  return out;
}

export interface ResultOutcome {
  best: BestStars;
  /** True when this run reached the level's goal stars. */
  goalReached: boolean;
  /** Id of the level this run opened for the first time, if any. */
  newlyUnlocked: string | null;
}

/** Folds a finished run into the best-stars table (never lowers a score). */
export function recordResult(
  levels: readonly Level[],
  best: BestStars,
  levelId: string,
  stars: Stars,
): ResultOutcome {
  const level = levels.find((l) => l.id === levelId);
  if (!level) return { best, goalReached: false, newlyUnlocked: null };
  const next: BestStars = { ...best };
  if (stars > (best[levelId] ?? 0)) next[levelId] = stars;
  const before = new Set(computeUnlocked(levels, best));
  const newlyUnlocked = computeUnlocked(levels, next).find((id) => !before.has(id)) ?? null;
  return { best: next, goalReached: stars >= level.goalStars, newlyUnlocked };
}
