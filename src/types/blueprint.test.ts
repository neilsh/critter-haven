import { describe, expect, it } from 'vitest';
import { PRESETS, blockId, cellCorners, cellInBounds, cornerInBounds, strutId } from './blueprint';

describe('blueprint helpers', () => {
  it('builds deterministic ids independent of strut endpoint order', () => {
    expect(blockId([1, 2, 3])).toBe('b:1,2,3');
    expect(strutId([0, 0, 0], [2, 2, 0])).toBe(strutId([2, 2, 0], [0, 0, 0]));
  });

  it('gives each cell 8 corners', () => {
    expect(new Set(cellCorners([3, 0, 3]).map((c) => c.join())).size).toBe(8);
  });

  it('presets are valid, unique and in bounds', () => {
    for (const make of Object.values(PRESETS)) {
      const g = make();
      const ids = [...g.blocks.map((b) => b.id), ...g.struts.map((s) => s.id)];
      expect(new Set(ids).size).toBe(ids.length);
      expect(g.blocks.every((b) => cellInBounds(b.cell))).toBe(true);
      expect(g.struts.every((s) => cornerInBounds(s.a) && cornerInBounds(s.b))).toBe(true);
    }
  });

  it('tower is 1x4x1 unbraced and house is braced', () => {
    const tower = PRESETS.tower();
    expect(tower.blocks).toHaveLength(4);
    expect(tower.struts).toHaveLength(0);
    expect(PRESETS.house().struts).toHaveLength(8);
  });
});
