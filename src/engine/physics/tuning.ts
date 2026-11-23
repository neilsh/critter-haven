import * as THREE from 'three';
import type { ModDisasterDef } from '../../mods/mods';
import type {
  DisasterType,
  MaterialDef,
  ProjectileKind,
  Stars,
  Strength,
  Telemetry,
  Vec3,
} from '../../types/blueprint';
import { DISASTER_SECONDS } from '../../types/blueprint';
import type { PieceHandle } from '../InstancedPieces';

export type PhysicsTelemetry = Pick<
  Telemetry,
  | 'mode'
  | 'timeRemaining'
  | 'activeJoints'
  | 'brokenJoints'
  | 'firstBrokenId'
  | 'waterLevel'
  | 'standingRatio'
  | 'stars'
>;

export interface SimOptions {
  customMaterials?: ReadonlyMap<string, MaterialDef>;
  customDisaster?: ModDisasterDef;
  gravityMultiplier?: number;
  durationSeconds?: number;
}

export interface PhysicsEvents {
  /** id is the BlockData/StrutData id (or anchor-owning block id) whose joint broke. */
  onJointBreak?(id: string): void;
  onSurvived?(): void;
  /** For sound: 0..1 strength of the current disaster, called every step. */
  onIntensity?(disaster: DisasterType, intensity: number): void;
  onWaterLevel?(y: number): void;
  /** For visuals: a hail stone first hit something, at this world point (bottom of the stone). */
  onHailImpact?(x: number, y: number, z: number): void;
  /** For visuals: any disaster projectile first hit something. */
  onProjectileImpact?(kind: ProjectileKind, x: number, y: number, z: number): void;
  /** For visuals & audio: a Laser block vaporized a projectile in flight. */
  onLaserFire?(from: Vec3, to: Vec3): void;
}

/**
 * Calibrated by PhysicsSim.test.ts: the unbraced tower must fail and the starter house must survive
 * an earthquake, and the other disasters must behave sensibly. Re-run the tests after any change.
 */
export const PHYSICS_TUNING = {
  step: 1 / 60,
  maxFrameDt: 0.05,
  gravity: 9.81,
  solverIterations: 8,
  /** World units of stretch that a maxStress = 1 joint tolerates. */
  stretchUnit: 0.06,
  /** Foundation anchors are this much stronger than the block's own material. */
  anchorStrength: 1,
  /** Acceleration-based spring stiffness (1/s^2) of block links, times material stiffness. */
  linkLinStiffness: 100_000,
  linkAngStiffness: 3000,
  linkDampingRatio: 0.6,
  /** Acceleration-based stiffness of strut distance springs, times material stiffness. */
  strutStiffness: 100_000,
  strutDampingRatio: 0.6,
  /**
   * Block collider horizontal half extent as a fraction of half a cell (the gap stops edge-touching
   * neighbours colliding). Vertically colliders are full height so ground blocks rest exactly on the island.
   */
  colliderScale: 0.97,
  /** Island displacement: layered sines (world units, Hz), z gets a weaker copy. */
  quake: { amplitude: 0.22, freqs: [1.6, 2.7, 4.1], weights: [1, 0.45, 0.2], zRatio: 0.35 },
  /** Wind force per unit of open upwind face, grows with height; gusts vary between gustMin and ~1.3. */
  wind: { force: 12, gustMin: 0.45, heightGain: 0.35 },
  /** Water rises from start to peak; the current pushes upstream faces, buoyancy lifts by material. */
  flood: { start: -1, peak: 3.2, riseSeconds: 5.5, drag: 1.2, current: 420 },
  hail: { perSecond: 7, radiusMin: 0.3, radiusMax: 0.5, density: 2.4, speed: 14, height: 14 },
  fire_tornado: {
    windForce: 9.5,
    swirlSpeed: 1.8,
    perSecond: 4.5,
    radiusMin: 0.35,
    radiusMax: 0.52,
    density: 2.0,
    speed: 14,
  },
  snow_storm: {
    windForce: 8.0,
    perSecond: 6.0,
    radiusMin: 0.35,
    radiusMax: 0.55,
    density: 1.8,
    speed: 12,
    height: 14,
  },
  raid: { perSecond: 3.5, radiusMin: 0.38, radiusMax: 0.55, density: 2.4, speed: 17, spawnRadius: 15 },
  meteor: { perSecond: 2.0, radiusMin: 0.6, radiusMax: 0.85, density: 2.9, speed: 16, height: 18 },
  shield: { radius: 5.5, stressMultiplier: 3.0, stiffnessMultiplier: 1.8 },
  laser: { range: 11, cooldown: 1.2 },
  /** Disaster force multiplier per strength level (medium is the calibrated baseline). */
  strength: { gentle: 0.6, medium: 1, strong: 1.4 } satisfies Record<Strength, number>,
  /** A piece whose centre drifts further than this (world units, relative to the island) has fallen. */
  standing: { tolerance: 1 },
  player: {
    maxHp: 100,
    radius: 0.55,
    height: 1.75,
    invulnSeconds: 0.45,
    blockHitSpeed: 2.8,
    blockDamage: 20,
    drownDps: 25,
    fallY: -6,
  },
  projectileDamage: {
    hail: 15,
    snowball: 12,
    fireball: 25,
    raider: 28,
    meteor: 45,
    custom: 22,
  } satisfies Record<ProjectileKind, number>,
};

export const WATER_HIDDEN = -2;

export interface PlayerHitResult {
  damage: number;
  cause: string | null;
  impact: boolean;
}

/** Star rating: 3 with zero broken joints, otherwise by the fraction of pieces still standing. */
export function starsFor(brokenJoints: number, standingRatio: number): Stars {
  if (brokenJoints === 0) return 3;
  if (standingRatio >= 0.8) return 2;
  if (standingRatio >= 0.5) return 1;
  return 0;
}

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/** 0..1 disaster envelope: ramps in over the first 1.5 s and out over the last 1.5 s. */
export const envelope = (t: number, duration = DISASTER_SECONDS) =>
  smooth(t / 1.5) * smooth((duration - t) / 1.5);

const STRAIN_COLORS = [new THREE.Color(0x22c55e), new THREE.Color(0xfacc15), new THREE.Color(0xff6a00)];
const tmpColor = new THREE.Color();

/** Green (0) -> yellow (0.5) -> orange (1+). */
function strainColor(s: number, out: THREE.Color) {
  const x = clamp01(s) * 2;
  const i = Math.min(1, Math.floor(x));
  return out.copy(STRAIN_COLORS[i]).lerp(STRAIN_COLORS[i + 1], x - i);
}

/** Stress X-ray: emissive tint by strain ratio, per piece handle (drawn as a per-instance colour). */
export function tint(piece: PieceHandle, strain: number) {
  piece.emissive.copy(strainColor(strain, tmpColor));
  piece.emissiveIntensity = 0.25 + 0.6 * clamp01(strain);
}
