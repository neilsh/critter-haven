import { describe, expect, it } from 'vitest';
import { DISASTER_ORDER } from '../types/blueprint';
import { SURVIVAL_WAVE_HEAL, getSurvivalWave } from './survival';

describe('getSurvivalWave', () => {
  it('clamps waves below 1 and invalid numbers to wave 1', () => {
    const w1 = getSurvivalWave(1);
    expect(getSurvivalWave(0)).toEqual(w1);
    expect(getSurvivalWave(-4)).toEqual(w1);
    expect(getSurvivalWave(Number.NaN)).toEqual(w1);
    expect(getSurvivalWave(1.9)).toEqual(w1);
  });

  it('cycles disasters through DISASTER_ORDER and escalates strength and points', () => {
    const expectedStrengths = [
      'gentle',
      'gentle',
      'medium',
      'medium',
      'medium',
      'strong',
      'strong',
      'strong',
      'strong',
      'strong',
    ];
    const expectedRewards = [25, 35, 45, 55, 65, 75, 85, 95, 100, 100];

    for (let wave = 1; wave <= 10; wave++) {
      const def = getSurvivalWave(wave);
      expect(def.wave).toBe(wave);
      expect(def.seed).toBe(wave);
      expect(def.healAmount).toBe(SURVIVAL_WAVE_HEAL);
      expect(def.disaster).toBe(DISASTER_ORDER[(wave - 1) % DISASTER_ORDER.length]);
      expect(def.strength).toBe(expectedStrengths[wave - 1]);
      expect(def.rewardPoints).toBe(expectedRewards[wave - 1]);
    }
  });
});
