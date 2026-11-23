/** Challenge-level progress: best stars per level, unlock rules, shop points and localStorage persistence. */
import type { BuiltinMaterialType, MaterialType, Stars } from '../types/blueprint';
import { BASE_MATERIALS, MATERIALS, MATERIAL_ORDER, isBuiltinMaterial } from '../types/blueprint';
import type { Level } from './levels';

export type BestStars = Record<string, Stars>;

export const PROGRESS_KEY = 'critter-haven:progress:v1';
export const SHOP_KEY = 'disaster-village:shop:v1';
export const POINTS_PER_STAR = 100;
export const CLEAR_BONUS = 50;

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

/** Total shop points earned across all levels based on best stars and first-clear goal bonuses. */
export function computeTotalPoints(levels: readonly Level[], best: BestStars): number {
  let total = 0;
  for (const level of levels) {
    const stars = best[level.id] ?? 0;
    if (stars <= 0) continue;
    total += stars * POINTS_PER_STAR;
    if (stars >= level.goalStars) total += CLEAR_BONUS;
  }
  return total;
}

/** Total points spent on unlocked tech blocks. */
export function computeSpentPoints(unlocked: readonly MaterialType[]): number {
  let spent = 0;
  for (const m of new Set(unlocked)) {
    if (isBuiltinMaterial(m)) spent += MATERIALS[m].cost ?? 0;
  }
  return spent;
}

/** Remaining points available to spend in the shop. */
export function computeAvailablePoints(
  levels: readonly Level[],
  best: BestStars,
  unlocked: readonly MaterialType[],
): number {
  return Math.max(0, computeTotalPoints(levels, best) - computeSpentPoints(unlocked));
}

function normalizeUnlocked(items: readonly MaterialType[]): BuiltinMaterialType[] {
  const set = new Set<string>(BASE_MATERIALS);
  for (const m of items) {
    if (isBuiltinMaterial(m)) set.add(m);
  }
  return MATERIAL_ORDER.filter((m) => set.has(m));
}

/** Reads unlocked materials from storage, always preserving base materials. */
export function loadUnlockedMaterials(storage: StorageLike | null = defaultStorage()): MaterialType[] {
  const set = new Set<BuiltinMaterialType>(BASE_MATERIALS);
  try {
    const raw = storage?.getItem(SHOP_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (typeof item === 'string' && isBuiltinMaterial(item)) {
          set.add(item);
        }
      }
    }
  } catch {
    // corrupt JSON or blocked storage: start with base materials
  }
  return MATERIAL_ORDER.filter((m) => set.has(m));
}

export function saveUnlockedMaterials(
  unlocked: readonly MaterialType[],
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    storage?.setItem(SHOP_KEY, JSON.stringify(normalizeUnlocked(unlocked)));
  } catch {
    // quota or blocked storage: shop unlocks just will not persist
  }
}

/** Attempts to unlock `material` using available points; returns `{ unlocked, ok }`. */
export function tryUnlockMaterial(
  levels: readonly Level[],
  best: BestStars,
  unlocked: readonly MaterialType[],
  material: MaterialType,
): { unlocked: MaterialType[]; ok: boolean } {
  const current = normalizeUnlocked(unlocked);
  if (!isBuiltinMaterial(material)) return { unlocked: current, ok: false };
  const cost = MATERIALS[material].cost;
  if (cost === undefined || current.includes(material)) {
    return { unlocked: current, ok: false };
  }
  const available = computeAvailablePoints(levels, best, current);
  if (available < cost) {
    return { unlocked: current, ok: false };
  }
  return { unlocked: normalizeUnlocked([...current, material]), ok: true };
}
