/** Pure helpers for challenge-level build limits. No three.js or React imports. */
import type { BlueprintGraph, BuildConstraints, MaterialType } from '../types/blueprint';

/** True when `c` allows building with `material` (no constraint or no material list means yes). */
export function isMaterialAllowed(c: BuildConstraints | null | undefined, material: MaterialType): boolean {
  return !c?.materials || c.materials.includes(material);
}

/** True when one more block may be added to a build that already has `blockCount` blocks. */
export function canAddBlock(c: BuildConstraints | null | undefined, blockCount: number): boolean {
  return c?.maxBlocks === undefined || blockCount < c.maxBlocks;
}

/** How many layers tall the build is (0 for an empty island). */
export function buildHeight(g: BlueprintGraph): number {
  return g.blocks.reduce((h, b) => Math.max(h, b.cell[1] + 1), 0);
}
