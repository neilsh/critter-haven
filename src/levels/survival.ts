import { DISASTER_ORDER, type BuiltinDisasterType, type Strength } from '../types/blueprint';

/** HP restored between cleared Survival waves (capped at max HP). */
export const SURVIVAL_WAVE_HEAL = 35;

export interface SurvivalWaveDef {
  wave: number;
  disaster: BuiltinDisasterType;
  strength: Strength;
  seed: number;
  rewardPoints: number;
  healAmount: number;
}

/** Deterministic escalating disaster schedule for Survival Mode waves. */
export function getSurvivalWave(wave: number): SurvivalWaveDef {
  const safe = Number.isFinite(wave) ? wave : 1;
  const w = Math.max(1, Math.floor(safe));
  const disaster = DISASTER_ORDER[(w - 1) % DISASTER_ORDER.length] ?? 'earthquake';
  const strength: Strength = w <= 2 ? 'gentle' : w <= 5 ? 'medium' : 'strong';
  const rewardPoints = 25 + Math.min(75, (w - 1) * 10);
  return {
    wave: w,
    disaster,
    strength,
    seed: w,
    rewardPoints,
    healAmount: SURVIVAL_WAVE_HEAL,
  };
}
