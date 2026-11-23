/**
 * Challenge level data. CONTRACT: a level is a disaster to survive, with optional build limits and
 * a star target. The level thread fills `LEVELS`; Game applies `constraints` via
 * `BuildController.setConstraints` and unlocks the next level when `goalStars` is reached.
 */
import type { BlueprintGraph, BuildConstraints, DisasterType, Stars, Strength } from '../types/blueprint';

export interface Level {
  id: string;
  title: string;
  /** One kid-friendly sentence shown in the level panel. */
  blurb: string;
  disaster: DisasterType;
  strength: Strength;
  seed?: number;
  constraints?: BuildConstraints;
  /** Optional starting build; omitted means an empty island. */
  start?: () => BlueprintGraph;
  /** Stars needed to unlock the next level. */
  goalStars: Stars;
}

export const LEVELS: readonly Level[] = [];

export function getLevel(id: string): Level | undefined {
  return LEVELS.find((l) => l.id === id);
}
