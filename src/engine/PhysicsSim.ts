/**
 * OWNER: package A (Rapier sim, disasters, X-ray, win state). Contract below is fixed; internals are yours.
 *
 * Rules from the spec: fixed 1/60 s accumulator with dt clamped to 0.05; joined bodies must have
 * contacts disabled; ground-level blocks get breakable anchors to the kinematic island body;
 * strain ratio > 1 removes the joint and records the FIRST broken id; survive 8 s with zero broken
 * joints to win. Initialise Rapier lazily on `start` (rapier3d-compat embeds its wasm, no fetch).
 *
 * Must be runnable headless in Node (Vitest) when given a `MeshRegistry` of plain PieceHandles, so the
 * tower-fails / house-survives calibration does not need a browser. Use a seeded RNG for gusts/hail.
 *
 * Lifecycle: start() -> mode 'simulating', isRunning() true. When the countdown reaches 0 the sim
 * stops stepping, isRunning() becomes false and mode becomes 'survived' (onSurvived fires) or
 * 'failed'; meshes stay where they ended up. stop() returns to mode 'build'. Calling start() while
 * running first stops the previous run.
 *
 * ---------------------------------------------------------------------------------------------
 * Model (package A internals):
 *  - Every block is a dynamic cuboid body. Face-adjacent blocks are linked by a 6-DOF spring joint
 *    at the shared face centre (contacts disabled between them). Ground-level blocks get the same
 *    kind of spring to the kinematic island body: the foundation anchor. Anchored blocks keep
 *    contact with the island so it carries their weight; their colliders touch it exactly, so there
 *    is no frame-1 overlap. Springs are Rapier generic-joint position motors, so they are solved
 *    implicitly and stay stable at any stiffness.
 *  - A strut is a 2-force truss member: a distance spring between the two corner points it joins.
 *    While intact its mesh follows its two end points; once it breaks it becomes a falling stick.
 *  - Stretch of a block link = anchor-point separation + relative rotation angle * half a cell.
 *    Stretch of a strut = |length - rest length|. Strain ratio = stretch / (maxStress * stretchUnit),
 *    using the weaker material of the two pieces.
 *  - Strength (gentle / medium / strong) scales every disaster's driving force by
 *    PHYSICS_TUNING.strength: quake amplitude, wind force, flood current, and hail rate and speed.
 *    Medium (x1) is the calibrated baseline. Material limits never change with strength.
 *  - Scoring: a block is standing while it still has at least one intact link (anchor, face link
 *    or strut) and its centre sits within `standing.tolerance` of where it started, measured relative
 *    to the (possibly shaking) island. So an intact chunk that lost its anchor but did not move still
 *    counts, while a block whose every joint broke is rubble even if it happens to lie in place. A
 *    strut is standing while it is unbroken and every block it hangs from is standing. Falling is
 *    sticky: a piece that fell stays fallen.
 *    standingRatio = standing pieces / all pieces (1 for an empty island). Stars: 3 with zero broken
 *    joints, else 2 at >= 80 % standing, 1 at >= 50 %, else 0 (see `starsFor`).
 *  - Hail stones are drawn as simple spheres under the effects root (see setEffectsRoot; Game
 *    passes the scene) and removed again on stop(). With no root, hail is simulated but not drawn.
 */
import type * as RapierModule from '@dimforge/rapier3d-compat';
import type { ImpulseJoint, ImpulseJointSet, JointAxis, RigidBody, World } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type {
  BlueprintGraph,
  BlockData,
  DisasterType,
  MaterialDef,
  ProjectileKind,
  Stars,
  Strength,
  StrutData,
  Telemetry,
  Vec3,
} from '../types/blueprint';
import {
  CELL_SIZE,
  DEFAULT_STRENGTH,
  DISASTER_SECONDS,
  ISLAND_SIZE,
  blocksAtCorner,
  cellToWorld,
  cornerToWorld,
  getMaterialDef,
  key,
} from '../types/blueprint';
import type { ModDisasterDef } from '../mods/mods';
import type { MeshRegistry } from './BuildController';
import type { PieceHandle } from './InstancedPieces';

type PhysicsTelemetry = Pick<
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

// ------------------------------------------------------------------ tuning

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

const T = PHYSICS_TUNING;
const WATER_HIDDEN = -2;

// ------------------------------------------------------------------ helpers

type Rapier = typeof RapierModule;
let rapierReady: Promise<Rapier> | null = null;
/**
 * Load and initialise Rapier once per process. The dynamic import keeps the ~2 MB module (its wasm
 * is embedded, nothing is fetched) out of the main bundle until the first disaster.
 */
export function loadRapier(): Promise<Rapier> {
  rapierReady ??= import('@dimforge/rapier3d-compat').then(async (rapier) => {
    await rapier.init();
    return rapier;
  });
  return rapierReady;
}

/** mulberry32: small deterministic PRNG returning [0, 1). */
export function makeRng(seed: number) {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
/** 0..1 disaster envelope: ramps in over the first 1.5 s and out over the last 1.5 s. */
const envelope = (t: number, duration = DISASTER_SECONDS) => smooth(t / 1.5) * smooth((duration - t) / 1.5);

const STRAIN_COLORS = [new THREE.Color(0x22c55e), new THREE.Color(0xfacc15), new THREE.Color(0xff6a00)];
const tmpColor = new THREE.Color();
/** Green (0) -> yellow (0.5) -> orange (1+). */
function strainColor(s: number, out: THREE.Color) {
  const x = clamp01(s) * 2;
  const i = Math.min(1, Math.floor(x));
  return out.copy(STRAIN_COLORS[i]).lerp(STRAIN_COLORS[i + 1], x - i);
}

/** Stress X-ray: emissive tint by strain ratio, per piece handle (drawn as a per-instance colour). */
function tint(piece: PieceHandle, strain: number) {
  piece.emissive.copy(strainColor(strain, tmpColor));
  piece.emissiveIntensity = 0.25 + 0.6 * clamp01(strain);
}

const tmpP1 = new THREE.Vector3();
const tmpP2 = new THREE.Vector3();
const tmpQ1 = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpWpQ = new THREE.Quaternion();
const tmpV1 = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpMid0 = new THREE.Vector3();
const tmpMid1 = new THREE.Vector3();
const tmpD0 = new THREE.Vector3();
const tmpD1 = new THREE.Vector3();
const tmpRot = new THREE.Quaternion();
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const UP_UNIT = new THREE.Vector3(0, 1, 0);

type RawJointSet = ImpulseJointSet['raw'];
type RawAxis = Parameters<RawJointSet['jointConfigureMotorPosition']>[1];
type RawMotorModel = Parameters<RawJointSet['jointConfigureMotorModel']>[2];
/**
 * The TS wrapper has no per-axis motor API for generic joints, but the raw joint set does. Its wasm
 * enums are not re-exported; their values are identical to the public JointAxis / MotorModel enums.
 */
function configureAxisSpring(
  R: Rapier,
  set: ImpulseJointSet,
  joint: ImpulseJoint,
  axis: JointAxis,
  target: number,
  stiffness: number,
  damping: number,
) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- identical wasm enum, see above
  const rawAxis = axis as unknown as RawAxis;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- identical wasm enum, see above
  const model = R.MotorModel.AccelerationBased as unknown as RawMotorModel;
  set.raw.jointConfigureMotorModel(joint.handle, rawAxis, model);
  set.raw.jointConfigureMotorPosition(joint.handle, rawAxis, target, stiffness, damping);
}

const isLinear = (R: Rapier, a: JointAxis) =>
  a === R.JointAxis.LinX || a === R.JointAxis.LinY || a === R.JointAxis.LinZ;

function createEmojiBallTexture(emoji: string, bgHex: string): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '72px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  ctx.fillText(emoji, 64, 64);
  ctx.fillText(emoji, 192, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeProjectileMat(
  emoji: string,
  bgHex: string,
  fallbackColor: number,
  opts: {
    roughness?: number;
    metalness?: number;
    emissive?: number;
    emissiveIntensity?: number;
    transparent?: boolean;
    opacity?: number;
  } = {},
): THREE.MeshStandardMaterial {
  const map = createEmojiBallTexture(emoji, bgHex);
  return new THREE.MeshStandardMaterial({
    color: map ? 0xffffff : fallbackColor,
    map,
    roughness: opts.roughness ?? 0.5,
    metalness: opts.metalness ?? 0,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
  });
}

// ------------------------------------------------------------------ public API

export class PhysicsSim {
  private run: SimRun | null = null;
  /** Bumped by start/stop so a slow Rapier init cannot resurrect a cancelled run. */
  private generation = 0;
  private effectsRoot: THREE.Object3D | null = null;

  constructor(private events: PhysicsEvents = {}) {}

  /** Build the Rapier world from the graph and begin the disaster. */
  async start(
    graph: BlueprintGraph,
    meshes: MeshRegistry,
    disaster: DisasterType,
    seed = 1,
    strength: Strength = DEFAULT_STRENGTH,
    options?: SimOptions,
  ): Promise<void> {
    this.stop();
    const gen = this.generation;
    const rapier = await loadRapier();
    if (gen !== this.generation) return; // stopped (or restarted) while Rapier was loading
    this.run = new SimRun(
      rapier,
      graph,
      meshes,
      disaster,
      seed,
      T.strength[strength],
      this.effectsRoot,
      () => this.events,
      options,
    );
  }

  /** Replace event handlers (Game wires these after construction). */
  setEvents(events: PhysicsEvents): void {
    this.events = events;
  }

  /**
   * Parent for meshes the sim creates itself (hail stones), in world space. Takes effect on the next
   * start(); headless runs can leave it unset.
   */
  setEffectsRoot(root: THREE.Object3D | null): void {
    this.effectsRoot = root;
  }

  /** Advance by a real frame delta (seconds); internally fixed-steps. */
  update(dtSeconds: number): void {
    this.run?.update(dtSeconds);
  }

  /** Destroy the Rapier world and reset the timer. The caller restores mesh transforms. */
  stop(): void {
    this.generation++;
    this.run?.dispose();
    this.run = null;
  }

  isRunning(): boolean {
    return this.run?.running ?? false;
  }

  getTelemetry(): PhysicsTelemetry {
    return (
      this.run?.telemetry() ?? {
        mode: 'build',
        timeRemaining: DISASTER_SECONDS,
        activeJoints: 0,
        brokenJoints: 0,
        firstBrokenId: null,
        waterLevel: WATER_HIDDEN,
        standingRatio: 1,
        stars: 0,
      }
    );
  }

  /** Highest strain ratio seen in the current run and the link it belongs to (calibration/tuning aid). */
  getPeakStrain(): { strain: number; id: string | null } {
    return this.run ? { strain: this.run.peakStrain, id: this.run.peakStrainId } : { strain: 0, id: null };
  }

  /** Live world centers of all blocks in the active simulation. */
  getBlockPositions(): Vec3[] {
    return this.run?.blockPositions() ?? [];
  }

  /** Evaluates disaster & debris hits against a First-Person player at `feet`. */
  checkPlayerDamage(feet: Vec3, dt: number): PlayerHitResult {
    return this.run?.checkPlayerDamage(feet, dt) ?? { damage: 0, cause: null, impact: false };
  }
}

// ------------------------------------------------------------------ internal records

interface BlockRec {
  data: BlockData;
  body: RigidBody;
  mesh: PieceHandle | undefined;
  /** Mesh pose relative to the body, captured at start (keeps us agnostic of mesh conventions). */
  meshOffsetPos: THREE.Vector3;
  meshOffsetQuat: THREE.Quaternion;
  mass: number;
  buoyancy: number;
  /** Open area per horizontal face +x, -x, +z, -z (1 = open, 0.25 = shielded by a neighbour). */
  exposure: [number, number, number, number];
  strain: number;
  /** Centre at start, for the standing check. */
  start: THREE.Vector3;
  /** Sticky: set once the block loses its last intact link or drifts too far. */
  fallen: boolean;
}

interface StrutEnd {
  body: RigidBody;
  local: THREE.Vector3;
  rec: BlockRec | null;
}

interface StrutRec {
  data: StrutData;
  mesh: PieceHandle | undefined;
  initA: THREE.Vector3;
  initB: THREE.Vector3;
  /** Mesh pose at start; after breaking, relative to the debris body instead. */
  meshPos: THREE.Vector3;
  meshQuat: THREE.Quaternion;
  endA: StrutEnd | null;
  endB: StrutEnd | null;
  debris: RigidBody | null;
  strain: number;
  /** Sticky: set once the strut breaks or either block it is attached to falls. */
  fallen: boolean;
}

interface Link {
  /** Id reported on break. */
  id: string;
  kind: 'face' | 'anchor' | 'strut';
  joint: ImpulseJoint | null;
  body1: RigidBody;
  body2: RigidBody;
  local1: THREE.Vector3;
  local2: THREE.Vector3;
  /** Rest length (struts only). */
  rest: number;
  /** Stretch (world units) at which the link breaks. */
  limit: number;
  blocks: BlockRec[];
  strut: StrutRec | null;
  strain: number;
  broken: boolean;
}

interface Projectile {
  kind: ProjectileKind;
  body: RigidBody;
  mesh: THREE.Mesh;
  radius: number;
  speed: number;
  horizSpeed: number;
  hp: number;
  landed: boolean;
  destroyed: boolean;
}

interface LaserEntry {
  rec: BlockRec;
  cooldown: number;
}

interface ShieldDome {
  rec: BlockRec;
  mesh: THREE.Mesh;
}

/** One disaster run: owns the Rapier world. Created only after Rapier is initialised. */
class SimRun {
  running = true;
  peakStrain = 0;
  peakStrainId: string | null = null;

  private readonly world: World;
  private readonly ground: RigidBody;
  private readonly blocks: BlockRec[] = [];
  private readonly struts: StrutRec[] = [];
  private readonly links: Link[] = [];
  private readonly shieldBlocks: BlockRec[] = [];
  private readonly shieldDomes: ShieldDome[] = [];
  private readonly lasers: LaserEntry[] = [];
  private projectiles: Projectile[] = [];
  private readonly projectileGeom = new THREE.SphereGeometry(1, 16, 12);
  private readonly projectileMats: Record<ProjectileKind, THREE.MeshStandardMaterial>;
  private readonly shieldGeom = new THREE.SphereGeometry(T.shield.radius, 20, 14);
  private readonly shieldMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  private readonly rng: () => number;
  private readonly quakePhase: number[];
  /** Wind / flood-current heading (radians) and how fast it swirls. */
  private flowAngle: number;
  private readonly flowSpin: number;
  private gust = 1;
  private gustTarget = 1;
  private gustTimer = 0;
  private spawnAccumulator = 0;
  private readonly spawnBox: { minX: number; maxX: number; minZ: number; maxZ: number; top: number };
  private readonly customMaterials?: ReadonlyMap<string, MaterialDef>;
  private readonly customDisaster?: ModDisasterDef;
  private readonly gravity: number;
  private readonly duration: number;

  private mode: Telemetry['mode'] = 'simulating';
  private time = 0;
  private accumulator = 0;
  private brokenCount = 0;
  private firstBrokenId: string | null = null;
  private waterLevel = WATER_HIDDEN;
  /** Set by breakLink: blocks whose last link broke must be marked loose at the next standing check. */
  private linksDirty = true;
  private standingRatio = 1;
  private playerInvuln = 0;

  constructor(
    private readonly R: Rapier,
    graph: BlueprintGraph,
    meshes: MeshRegistry,
    private readonly disaster: DisasterType,
    seed: number,
    /** Disaster force multiplier from the strength level. */
    private readonly power: number,
    private readonly effectsRoot: THREE.Object3D | null,
    private readonly events: () => PhysicsEvents,
    options?: SimOptions,
  ) {
    this.customMaterials = options?.customMaterials;
    this.customDisaster = options?.customDisaster;
    this.gravity = T.gravity * (options?.gravityMultiplier ?? 1);
    this.duration = options?.durationSeconds ?? DISASTER_SECONDS;
    const customColor = this.customDisaster?.color ?? 0x84cc16;
    const customHex = `#${customColor.toString(16).padStart(6, '0')}`;
    this.projectileMats = {
      hail: makeProjectileMat('🧊', '#dff3ff', 0xdff3ff, {
        roughness: 0.25,
        transparent: true,
        opacity: 0.92,
      }),
      snowball: makeProjectileMat('❄️', '#e8f6ff', 0xf8fcff, { roughness: 0.8 }),
      fireball: makeProjectileMat('🔥', '#ff6a00', 0xff6a00, {
        emissive: 0xff3d00,
        emissiveIntensity: 0.25,
        roughness: 0.4,
      }),
      raider: makeProjectileMat('💣', '#37474f', 0x37474f, { roughness: 0.45, metalness: 0.3 }),
      meteor: makeProjectileMat('☄️', '#4e342e', 0x4e342e, {
        emissive: 0xff5722,
        emissiveIntensity: 0.2,
        roughness: 0.7,
      }),
      custom: makeProjectileMat('💥', customHex, customColor, {
        emissive: customColor,
        emissiveIntensity: 0.2,
        roughness: 0.45,
      }),
    };

    const world = new this.R.World({ x: 0, y: -this.gravity, z: 0 });
    world.timestep = T.step;
    world.numSolverIterations = T.solverIterations;
    this.world = world;

    const half = ISLAND_SIZE / 2;
    this.ground = world.createRigidBody(this.R.RigidBodyDesc.kinematicPositionBased());
    world.createCollider(
      this.R.ColliderDesc.cuboid(half, 1, half).setTranslation(0, -1, 0).setFriction(1),
      this.ground,
    );

    const byCell = this.addBlocks(graph, meshes);
    for (const s of graph.struts) this.addStrut(graph, s, meshes, byCell);

    this.rng = makeRng(seed);
    this.quakePhase = Array.from({ length: 6 }, () => this.rng() * Math.PI * 2);
    this.flowAngle = this.rng() * Math.PI * 2;
    this.flowSpin = (this.rng() - 0.5) * 0.6;

    const ps = this.blocks.map((b) => b.body.translation());
    this.spawnBox = ps.length
      ? {
          minX: Math.min(...ps.map((p) => p.x)) - 1.5,
          maxX: Math.max(...ps.map((p) => p.x)) + 1.5,
          minZ: Math.min(...ps.map((p) => p.z)) - 1.5,
          maxZ: Math.max(...ps.map((p) => p.z)) + 1.5,
          top: Math.max(...ps.map((p) => p.y)) + 1,
        }
      : { minX: -4, maxX: 4, minZ: -4, maxZ: 4, top: 0 };

    if (disaster === 'flood' || this.customDisaster?.flood) {
      this.waterLevel = T.flood.start;
      this.events().onWaterLevel?.(this.waterLevel);
    }
    this.updateStanding();
    this.syncMeshes();
  }

  telemetry(): PhysicsTelemetry {
    return {
      mode: this.mode,
      timeRemaining: Math.max(0, this.duration - this.time),
      activeJoints: this.links.length - this.brokenCount,
      brokenJoints: this.brokenCount,
      firstBrokenId: this.firstBrokenId,
      waterLevel: this.waterLevel,
      standingRatio: this.standingRatio,
      stars: starsFor(this.brokenCount, this.standingRatio),
    };
  }

  blockPositions(): Vec3[] {
    return this.blocks.map((b) => {
      const p = b.body.translation();
      return [p.x, p.y, p.z];
    });
  }

  checkPlayerDamage(feet: Vec3, dt: number): PlayerHitResult {
    if (!this.running) return { damage: 0, cause: null, impact: false };
    const safeDt = Math.max(0, dt);
    this.playerInvuln = Math.max(0, this.playerInvuln - safeDt);
    const [px, py, pz] = feet;

    if (py < T.player.fallY) {
      return { damage: T.player.maxHp, cause: 'You fell off the island!', impact: true };
    }

    let damage = 0;
    let cause: string | null = null;
    let impact = false;

    if (this.waterLevel > py + 1.45) {
      damage += T.player.drownDps * safeDt;
      cause = 'Swept by the flood!';
    }

    if (this.playerInvuln <= 0) {
      let destroyedProj = false;
      for (const proj of this.projectiles) {
        if (proj.destroyed) continue;
        const v = proj.body.linvel();
        if (proj.landed && Math.hypot(v.x, v.y, v.z) < 3) continue;
        const pp = proj.body.translation();
        const clampedY = Math.max(
          py + T.player.radius,
          Math.min(py + T.player.height - T.player.radius, pp.y),
        );
        const d2 = (pp.x - px) ** 2 + (pp.y - clampedY) ** 2 + (pp.z - pz) ** 2;
        const hitDist = proj.radius + T.player.radius;
        if (d2 <= hitDist * hitDist) {
          proj.destroyed = true;
          destroyedProj = true;
          this.effectsRoot?.remove(proj.mesh);
          this.world.removeRigidBody(proj.body);
          damage += T.projectileDamage[proj.kind];
          cause = 'Hit by a falling hazard!';
          impact = true;
          this.playerInvuln = T.player.invulnSeconds;
          break;
        }
      }
      if (destroyedProj) this.compactProjectiles();

      if (!impact) {
        const half = CELL_SIZE / 2;
        for (const b of this.blocks) {
          const v = b.body.linvel();
          if (Math.hypot(v.x, v.y, v.z) < T.player.blockHitSpeed) continue;
          const bp = b.body.translation();
          if (
            Math.abs(bp.x - px) <= half + T.player.radius &&
            Math.abs(bp.z - pz) <= half + T.player.radius &&
            bp.y + half >= py + 0.15 &&
            bp.y - half <= py + T.player.height
          ) {
            damage += T.player.blockDamage;
            cause = 'Crushed by falling debris!';
            impact = true;
            this.playerInvuln = T.player.invulnSeconds;
            break;
          }
        }
      }
    }

    return { damage, cause, impact };
  }

  update(dtSeconds: number) {
    if (!this.running) return;
    this.accumulator += Math.min(Math.max(dtSeconds, 0), T.maxFrameDt);
    while (this.running && this.accumulator >= T.step - 1e-9) {
      this.accumulator -= T.step;
      this.stepOnce();
    }
    this.syncMeshes();
  }

  dispose() {
    this.running = false;
    for (const p of this.projectiles) this.effectsRoot?.remove(p.mesh);
    this.projectiles = [];
    for (const d of this.shieldDomes) this.effectsRoot?.remove(d.mesh);
    this.shieldDomes.length = 0;
    this.projectileGeom.dispose();
    for (const mat of Object.values(this.projectileMats)) {
      mat.map?.dispose();
      mat.dispose();
    }
    this.shieldGeom.dispose();
    this.shieldMat.dispose();
    this.world.free();
  }

  // ---------------------------------------------------------------- world construction

  private addBlocks(graph: BlueprintGraph, meshes: MeshRegistry) {
    const byCell = new Map<string, BlockRec>();
    const h = (CELL_SIZE / 2) * T.colliderScale;
    for (const b of graph.blocks) {
      const mat = getMaterialDef(b.material, this.customMaterials);
      const centre = new THREE.Vector3(...cellToWorld(b.cell));
      const body = this.world.createRigidBody(
        this.R.RigidBodyDesc.dynamic().setTranslation(centre.x, centre.y, centre.z).setCanSleep(false),
      );
      const col = this.world.createCollider(
        this.R.ColliderDesc.cuboid(h, CELL_SIZE / 2, h)
          .setDensity(mat.density)
          .setFriction(0.8),
        body,
      );
      const mesh = meshes.blocks.get(b.id);
      const rec: BlockRec = {
        data: b,
        body,
        mesh,
        meshOffsetPos: mesh ? mesh.position.clone().sub(centre) : new THREE.Vector3(),
        meshOffsetQuat: mesh ? mesh.quaternion.clone() : new THREE.Quaternion(),
        mass: col.mass(),
        buoyancy: mat.buoyancy,
        exposure: [1, 1, 1, 1],
        strain: 0,
        start: centre.clone(),
        fallen: false,
      };
      this.blocks.push(rec);
      byCell.set(key(b.cell), rec);
      if (mat.special === 'shield') {
        this.shieldBlocks.push(rec);
        if (this.effectsRoot) {
          const dome = new THREE.Mesh(this.shieldGeom, this.shieldMat);
          dome.position.copy(centre);
          this.effectsRoot.add(dome);
          this.shieldDomes.push({ rec, mesh: dome });
        }
      } else if (mat.special === 'laser') {
        this.lasers.push({ rec, cooldown: 0 });
      }
    }

    const at = (c: Vec3) => byCell.get(key(c));
    const shielded = (c: Vec3) => (at(c) ? 0.25 : 1);
    for (const rec of this.blocks) {
      const [cx, cy, cz] = rec.data.cell;
      rec.exposure = [
        shielded([cx + 1, cy, cz]),
        shielded([cx - 1, cy, cz]),
        shielded([cx, cy, cz + 1]),
        shielded([cx, cy, cz - 1]),
      ];
      for (const d of [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ] satisfies Vec3[]) {
        const other = at([cx + d[0], cy + d[1], cz + d[2]]);
        if (other) this.addBlockLink(rec, other, d);
      }
      if (cy === 0) this.addAnchor(rec);
    }
    return byCell;
  }

  /** 6-DOF spring joint; joint axes line up with world axes because every body starts unrotated. */
  private createSpring(
    b1: RigidBody,
    l1: THREE.Vector3,
    b2: RigidBody,
    l2: THREE.Vector3,
    stiffness: number,
    toGround: boolean,
  ) {
    // Locking LinX only to create the joint; the mask is cleared below so all six axes are springs.
    const data = this.R.JointData.generic(l1, l2, { x: 1, y: 0, z: 0 }, this.R.JointAxesMask.LinX);
    data.axesMask = this.R.JointAxesMask.LinX & this.R.JointAxesMask.LinY;
    const joint = this.world.createImpulseJoint(data, b1, b2, true);
    joint.setContactsEnabled(toGround);
    const A = this.R.JointAxis;
    const axes = [A.LinX, A.LinY, A.LinZ, A.AngX, A.AngY, A.AngZ];
    for (const axis of axes) {
      const k = (isLinear(this.R, axis) ? T.linkLinStiffness : T.linkAngStiffness) * stiffness;
      configureAxisSpring(
        this.R,
        this.world.impulseJoints,
        joint,
        axis,
        0,
        k,
        2 * T.linkDampingRatio * Math.sqrt(k),
      );
    }
    return joint;
  }

  private startsNearShield(blocks: BlockRec[]): boolean {
    if (this.shieldBlocks.length === 0) return false;
    const r2 = T.shield.radius * T.shield.radius;
    for (const s of this.shieldBlocks) {
      for (const b of blocks) {
        if (s.start.distanceToSquared(b.start) <= r2) return true;
      }
    }
    return false;
  }

  private addBlockLink(a: BlockRec, b: BlockRec, dir: Vec3) {
    const hc = CELL_SIZE / 2;
    const l1 = new THREE.Vector3(dir[0] * hc, dir[1] * hc, dir[2] * hc);
    const l2 = l1.clone().negate();
    const ma = getMaterialDef(a.data.material, this.customMaterials);
    const mb = getMaterialDef(b.data.material, this.customMaterials);
    const boost = this.startsNearShield([a, b]) ? T.shield.stiffnessMultiplier : 1;
    const joint = this.createSpring(
      a.body,
      l1,
      b.body,
      l2,
      Math.min(ma.stiffness, mb.stiffness) * boost,
      false,
    );
    this.links.push({
      // Report the weaker piece; on a tie the upper / later one (it is what comes loose).
      id: ma.maxStress < mb.maxStress ? a.data.id : b.data.id,
      kind: 'face',
      joint,
      body1: a.body,
      body2: b.body,
      local1: l1,
      local2: l2,
      rest: 0,
      limit: Math.min(ma.maxStress, mb.maxStress) * T.stretchUnit,
      blocks: [a, b],
      strut: null,
      strain: 0,
      broken: false,
    });
  }

  private addAnchor(rec: BlockRec) {
    const p = rec.body.translation();
    const l1 = new THREE.Vector3(p.x, p.y - CELL_SIZE / 2, p.z); // the island body sits at the origin
    const l2 = new THREE.Vector3(0, -CELL_SIZE / 2, 0);
    const mat = getMaterialDef(rec.data.material, this.customMaterials);
    const boost = this.startsNearShield([rec]) ? T.shield.stiffnessMultiplier : 1;
    const joint = this.createSpring(this.ground, l1, rec.body, l2, mat.stiffness * boost, true);
    this.links.push({
      id: rec.data.id,
      kind: 'anchor',
      joint,
      body1: this.ground,
      body2: rec.body,
      local1: l1,
      local2: l2,
      rest: 0,
      limit: mat.maxStress * T.stretchUnit * T.anchorStrength * (mat.anchorMultiplier ?? 1),
      blocks: [rec],
      strut: null,
      strain: 0,
      broken: false,
    });
  }

  private strutEnd(graph: BlueprintGraph, k: Vec3, byCell: Map<string, BlockRec>): StrutEnd | null {
    const w = new THREE.Vector3(...cornerToWorld(k));
    const owner = blocksAtCorner(graph, k)[0];
    const rec = owner ? byCell.get(key(owner.cell)) : undefined;
    if (rec) {
      const t = rec.body.translation();
      return { body: rec.body, local: w.sub(tmpV1.set(t.x, t.y, t.z)), rec };
    }
    if (k[1] === 0) return { body: this.ground, local: w, rec: null };
    return null;
  }

  private addStrut(graph: BlueprintGraph, s: StrutData, meshes: MeshRegistry, byCell: Map<string, BlockRec>) {
    const mesh = meshes.struts.get(s.id);
    const initA = new THREE.Vector3(...cornerToWorld(s.a));
    const initB = new THREE.Vector3(...cornerToWorld(s.b));
    const endA = this.strutEnd(graph, s.a, byCell);
    const endB = this.strutEnd(graph, s.b, byCell);
    const rec: StrutRec = {
      data: s,
      mesh,
      initA,
      initB,
      meshPos: mesh ? mesh.position.clone() : initA.clone().add(initB).multiplyScalar(0.5),
      meshQuat: mesh ? mesh.quaternion.clone() : new THREE.Quaternion(),
      endA,
      endB,
      debris: null,
      strain: 0,
      fallen: false,
    };
    this.struts.push(rec);
    // Both ends on one body (or an invalid end): the strut just rides along, it carries no load.
    if (!endA || !endB || endA.body === endB.body) return;

    const rest = initA.distanceTo(initB);
    const mat = getMaterialDef(s.material, this.customMaterials);
    const attached = [endA.rec, endB.rec].filter((r) => r !== null);
    const boost = this.startsNearShield(attached) ? T.shield.stiffnessMultiplier : 1;
    const k = T.strutStiffness * mat.stiffness * boost;
    const damping = 2 * T.strutDampingRatio * Math.sqrt(k);
    const joint = this.world.createImpulseJoint(
      this.R.JointData.spring(rest, k, damping, endA.local, endB.local),
      endA.body,
      endB.body,
      true,
    );
    joint.setContactsEnabled(false);
    // Same spring, but acceleration-based like the block links (mass-independent, stable).
    configureAxisSpring(this.R, this.world.impulseJoints, joint, this.R.JointAxis.LinX, rest, k, damping);
    this.links.push({
      id: s.id,
      kind: 'strut',
      joint,
      body1: endA.body,
      body2: endB.body,
      local1: endA.local,
      local2: endB.local,
      rest,
      limit: mat.maxStress * T.stretchUnit,
      blocks: attached,
      strut: rec,
      strain: 0,
      broken: false,
    });
  }

  // ---------------------------------------------------------------- disasters

  /** 0..1 strength for audio. */
  private intensity(): number {
    const env = envelope(this.time, this.duration);
    if (this.customDisaster) return env;
    if (this.disaster === 'hurricane') return env * clamp01(this.gust);
    if (this.disaster === 'fire_tornado') return env * clamp01(0.5 + 0.5 * this.gust);
    if (this.disaster === 'snow_storm') return env * clamp01(0.4 + 0.6 * this.gust);
    if (this.disaster === 'flood') return env * 0.7;
    return env;
  }

  /** Open area facing a flow along (dx, dz): the -x face meets a +x flow, and so on. */
  private static upstreamExposure(b: BlockRec, dx: number, dz: number) {
    const [px, nx, pz, nz] = b.exposure;
    return Math.max(0, -dx) * nx + Math.max(0, dx) * px + Math.max(0, -dz) * nz + Math.max(0, dz) * pz;
  }

  private applyDisaster() {
    if (this.customDisaster) return this.applyCustomDisaster(this.customDisaster);
    switch (this.disaster) {
      case 'earthquake':
        return this.applyQuake();
      case 'hurricane':
        return this.applyWind();
      case 'flood':
        return this.applyFlood();
      case 'hail':
        return this.applyHail();
      case 'fire_tornado':
        return this.applyFireTornado();
      case 'snow_storm':
        return this.applySnowStorm();
      case 'raid':
        return this.applyRaid();
      case 'meteor':
        return this.applyMeteor();
    }
  }

  private applyQuake(scale = 1) {
    const q = T.quake;
    const t = this.time;
    const env = envelope(t, this.duration);
    let dx = 0;
    let dz = 0;
    for (let i = 0; i < q.freqs.length; i++) {
      const w = 2 * Math.PI * q.freqs[i];
      dx += q.weights[i] * Math.sin(w * t + this.quakePhase[i]);
      dz += q.weights[i] * Math.sin(w * 1.13 * t + this.quakePhase[i + 3]);
    }
    const amp = q.amplitude * scale * this.power * env;
    this.ground.setNextKinematicTranslation({ x: amp * dx, y: 0, z: amp * q.zRatio * dz });
  }

  private applyWindForce(force: number, spinSpeed: number, reset = true): { wx: number; wz: number } {
    const w = T.wind;
    this.gustTimer -= T.step;
    if (this.gustTimer <= 0) {
      this.gustTimer = 0.4 + this.rng() * 0.8;
      this.gustTarget = w.gustMin + this.rng() * (1 - w.gustMin) * 1.3;
    }
    this.gust += (this.gustTarget - this.gust) * Math.min(1, T.step * 4);
    this.flowAngle += spinSpeed * T.step;
    const wx = Math.cos(this.flowAngle);
    const wz = Math.sin(this.flowAngle);
    const strength = force * this.power * envelope(this.time, this.duration) * this.gust;
    for (const b of this.blocks) {
      const height = 1 + w.heightGain * Math.max(0, b.body.translation().y);
      const f = strength * SimRun.upstreamExposure(b, wx, wz) * height;
      if (reset) b.body.resetForces(false);
      b.body.addForce({ x: wx * f, y: 0, z: wz * f }, true);
    }
    return { wx, wz };
  }

  private applyWind() {
    this.applyWindForce(T.wind.force, this.flowSpin);
  }

  private applyFlood(reset = true) {
    const f = T.flood;
    const env = envelope(this.time, this.duration);
    this.waterLevel = f.start + (f.peak - f.start) * smooth(this.time / f.riseSeconds);
    this.events().onWaterLevel?.(this.waterLevel);
    const cx = Math.cos(this.flowAngle);
    const cz = Math.sin(this.flowAngle);
    for (const b of this.blocks) {
      if (reset) b.body.resetForces(false);
      const p = b.body.translation();
      const sub = clamp01((this.waterLevel - (p.y - CELL_SIZE / 2)) / CELL_SIZE);
      if (sub <= 0) continue;
      const v = b.body.linvel();
      const drag = f.drag * sub * b.mass;
      // The current pushes upstream faces regardless of material, so heavy blocks resist it better.
      const push = f.current * this.power * env * sub * SimRun.upstreamExposure(b, cx, cz);
      b.body.addForce(
        {
          x: cx * push - v.x * drag,
          y: sub * b.mass * this.gravity * b.buoyancy - v.y * drag,
          z: cz * push - v.z * drag,
        },
        true,
      );
    }
  }

  private applyHail() {
    const h = T.hail;
    this.spawnAccumulator += h.perSecond * this.power * envelope(this.time, this.duration) * T.step;
    while (this.spawnAccumulator >= 1) {
      this.spawnAccumulator -= 1;
      this.spawnHail();
    }
    this.updateProjectiles();
  }

  private applyFireTornado() {
    const ft = T.fire_tornado;
    this.applyWindForce(ft.windForce, ft.swirlSpeed);
    this.spawnAccumulator += ft.perSecond * this.power * envelope(this.time, this.duration) * T.step;
    while (this.spawnAccumulator >= 1) {
      this.spawnAccumulator -= 1;
      const angle = this.flowAngle + (this.rng() - 0.5) * 2.2;
      const dist = 12 + this.rng() * 3;
      const sx = Math.cos(angle) * dist;
      const sz = Math.sin(angle) * dist;
      const sy = 2.5 + this.rng() * Math.max(6, this.spawnBox.top + 3);
      const r = ft.radiusMin + this.rng() * (ft.radiusMax - ft.radiusMin);
      this.spawnTargetedProjectile('fireball', sx, sy, sz, r, ft.density, ft.speed * Math.sqrt(this.power));
    }
    this.updateProjectiles();
  }

  private applySnowStorm() {
    const sn = T.snow_storm;
    const { wx, wz } = this.applyWindForce(sn.windForce, this.flowSpin);
    this.spawnAccumulator += sn.perSecond * this.power * envelope(this.time, this.duration) * T.step;
    while (this.spawnAccumulator >= 1) {
      this.spawnAccumulator -= 1;
      const b = this.spawnBox;
      const r = sn.radiusMin + this.rng() * (sn.radiusMax - sn.radiusMin);
      const x = b.minX + this.rng() * (b.maxX - b.minX) - wx * 2;
      const z = b.minZ + this.rng() * (b.maxZ - b.minZ) - wz * 2;
      const y = b.top + sn.height * (0.6 + 0.4 * this.rng());
      const speed = sn.speed * Math.sqrt(this.power);
      this.spawnProjectile('snowball', x, y, z, wx * 3.5, -speed, wz * 3.5, r, sn.density, speed, 0);
    }
    this.updateProjectiles();
  }

  private applyRaid() {
    const rd = T.raid;
    this.spawnAccumulator += rd.perSecond * this.power * envelope(this.time, this.duration) * T.step;
    while (this.spawnAccumulator >= 1) {
      this.spawnAccumulator -= 1;
      const angle = this.rng() * Math.PI * 2;
      const sx = Math.cos(angle) * rd.spawnRadius;
      const sz = Math.sin(angle) * rd.spawnRadius;
      const sy = 2 + this.rng() * Math.max(5, this.spawnBox.top + 2);
      const r = rd.radiusMin + this.rng() * (rd.radiusMax - rd.radiusMin);
      this.spawnTargetedProjectile('raider', sx, sy, sz, r, rd.density, rd.speed * Math.sqrt(this.power));
    }
    this.updateProjectiles();
  }

  private applyMeteor() {
    const mt = T.meteor;
    this.spawnAccumulator += mt.perSecond * this.power * envelope(this.time, this.duration) * T.step;
    while (this.spawnAccumulator >= 1) {
      this.spawnAccumulator -= 1;
      const b = this.spawnBox;
      const r = mt.radiusMin + this.rng() * (mt.radiusMax - mt.radiusMin);
      const x = b.minX + this.rng() * (b.maxX - b.minX);
      const z = b.minZ + this.rng() * (b.maxZ - b.minZ);
      const y = b.top + mt.height * (0.7 + 0.3 * this.rng());
      const speed = mt.speed * Math.sqrt(this.power);
      const vx = (this.rng() - 0.5) * 4;
      const vz = (this.rng() - 0.5) * 4;
      this.spawnProjectile('meteor', x, y, z, vx, -speed, vz, r, mt.density, speed, 0);
    }
    this.updateProjectiles();
  }

  private applyCustomDisaster(def: ModDisasterDef) {
    for (const b of this.blocks) b.body.resetForces(false);
    if (def.quake) this.applyQuake(def.quake);
    if (def.wind) this.applyWindForce(T.wind.force * def.wind, this.flowSpin, false);
    if (def.flood) this.applyFlood(false);
    if (def.projectiles) {
      const p = def.projectiles;
      const env = envelope(this.time, this.duration);
      this.spawnAccumulator += p.rate * this.power * env * T.step;
      while (this.spawnAccumulator >= 1) {
        this.spawnAccumulator -= 1;
        const speed = p.speed * Math.sqrt(this.power);
        if (p.mode === 'rain') {
          const b = this.spawnBox;
          const x = b.minX + this.rng() * (b.maxX - b.minX);
          const z = b.minZ + this.rng() * (b.maxZ - b.minZ);
          const y = b.top + 14 * (0.6 + 0.4 * this.rng());
          this.spawnProjectile('custom', x, y, z, 0, -speed, 0, p.radius, p.density, speed, 0);
        } else {
          const angle = this.rng() * Math.PI * 2;
          const sx = Math.cos(angle) * 14.5;
          const sz = Math.sin(angle) * 14.5;
          const sy = 2 + this.rng() * Math.max(5, this.spawnBox.top + 2);
          this.spawnTargetedProjectile('custom', sx, sy, sz, p.radius, p.density, speed);
        }
      }
      this.updateProjectiles();
    }
  }

  private spawnHail() {
    const h = T.hail;
    const b = this.spawnBox;
    const r = h.radiusMin + this.rng() * (h.radiusMax - h.radiusMin);
    const x = b.minX + this.rng() * (b.maxX - b.minX);
    const z = b.minZ + this.rng() * (b.maxZ - b.minZ);
    const y = b.top + h.height * (0.6 + 0.4 * this.rng());
    const speed = h.speed * Math.sqrt(this.power);
    this.spawnProjectile('hail', x, y, z, 0, -speed, 0, r, h.density, speed, 0);
  }

  private spawnTargetedProjectile(
    kind: ProjectileKind,
    sx: number,
    sy: number,
    sz: number,
    r: number,
    density: number,
    speed: number,
  ) {
    const b = this.spawnBox;
    let tx = (b.minX + b.maxX) * 0.5 + (this.rng() - 0.5) * 2;
    let ty = Math.max(1, b.top * 0.5);
    let tz = (b.minZ + b.maxZ) * 0.5 + (this.rng() - 0.5) * 2;
    if (this.blocks.length > 0) {
      const target = this.blocks[Math.floor(this.rng() * this.blocks.length)];
      if (target) {
        const tp = target.body.translation();
        tx = tp.x + (this.rng() - 0.5) * 1.2;
        ty = tp.y + (this.rng() - 0.5) * 0.8;
        tz = tp.z + (this.rng() - 0.5) * 1.2;
      }
    }
    const dx = tx - sx;
    const dy = ty - sy;
    const dz = tz - sz;
    const dist = Math.max(0.1, Math.hypot(dx, dy, dz));
    const flight = dist / speed;
    const vx = (dx / dist) * speed;
    const vz = (dz / dist) * speed;
    const vy = (dy / dist) * speed + 0.45 * this.gravity * flight;
    this.spawnProjectile(kind, sx, sy, sz, vx, vy, vz, r, density, speed, Math.hypot(vx, vz));
  }

  private spawnProjectile(
    kind: ProjectileKind,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    r: number,
    density: number,
    speed: number,
    horizSpeed: number,
  ) {
    const body = this.world.createRigidBody(
      this.R.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinvel(vx, vy, vz).setCcdEnabled(true),
    );
    this.world.createCollider(this.R.ColliderDesc.ball(r).setDensity(density).setRestitution(0.2), body);
    const mesh = new THREE.Mesh(this.projectileGeom, this.projectileMats[kind]);
    mesh.scale.setScalar(r);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    this.effectsRoot?.add(mesh);
    this.projectiles.push({
      kind,
      body,
      mesh,
      radius: r,
      speed,
      horizSpeed,
      hp: kind === 'meteor' ? 2 : 1,
      landed: false,
      destroyed: false,
    });
  }

  private compactProjectiles() {
    let write = 0;
    for (let i = 0; i < this.projectiles.length; i++) {
      const p = this.projectiles[i];
      if (p && !p.destroyed) this.projectiles[write++] = p;
    }
    this.projectiles.length = write;
  }

  private updateProjectiles() {
    // Report each projectile's first hit (its flight is suddenly slowed), and cull ones that fell off.
    const ev = this.events();
    let write = 0;
    for (let i = 0; i < this.projectiles.length; i++) {
      const s = this.projectiles[i];
      if (!s || s.destroyed) continue;
      const p = s.body.translation();
      const v = s.body.linvel();
      const hit =
        s.horizSpeed > 0.5
          ? Math.hypot(v.x, v.z) < s.horizSpeed * 0.65 || v.y > 1.5 || p.y <= s.radius + 0.15
          : v.y > -s.speed * 0.5;
      if (!s.landed && hit) {
        s.landed = true;
        ev.onProjectileImpact?.(s.kind, p.x, p.y - s.radius, p.z);
        if (s.kind === 'hail') ev.onHailImpact?.(p.x, p.y - s.radius, p.z);
      }
      if (p.y > -20) {
        this.projectiles[write++] = s;
      } else {
        this.effectsRoot?.remove(s.mesh);
        this.world.removeRigidBody(s.body);
      }
    }
    this.projectiles.length = write;
  }

  private updateLasers() {
    if (this.lasers.length === 0) return;
    const range2 = T.laser.range * T.laser.range;
    const ev = this.events();
    let destroyedAny = false;
    for (const laser of this.lasers) {
      laser.cooldown = Math.max(0, laser.cooldown - T.step);
      if (laser.rec.fallen || laser.cooldown > 0) continue;
      const lp = laser.rec.body.translation();
      let best: Projectile | null = null;
      let bestDist2 = range2;
      let bestPos: { x: number; y: number; z: number } | null = null;
      for (const proj of this.projectiles) {
        if (proj.destroyed || proj.landed) continue;
        const pp = proj.body.translation();
        const d2 = (pp.x - lp.x) ** 2 + (pp.y - lp.y) ** 2 + (pp.z - lp.z) ** 2;
        if (d2 <= bestDist2) {
          bestDist2 = d2;
          best = proj;
          bestPos = pp;
        }
      }
      if (best && bestPos) {
        best.hp -= 1;
        if (best.hp <= 0) {
          best.destroyed = true;
          destroyedAny = true;
          this.effectsRoot?.remove(best.mesh);
          this.world.removeRigidBody(best.body);
        } else {
          best.mesh.scale.multiplyScalar(0.82);
          const v = best.body.linvel();
          best.body.setLinvel({ x: v.x * 0.7, y: v.y * 0.7, z: v.z * 0.7 }, true);
        }
        laser.cooldown = T.laser.cooldown;
        ev.onLaserFire?.([lp.x, lp.y, lp.z], [bestPos.x, bestPos.y, bestPos.z]);
      }
    }
    if (destroyedAny) this.compactProjectiles();
  }

  // ---------------------------------------------------------------- stepping & strain

  private stepOnce() {
    this.time += T.step;
    this.applyDisaster();
    this.updateLasers();
    this.world.step();
    this.measureAndBreak();
    this.updateStanding();
    const ev = this.events();
    ev.onIntensity?.(this.disaster, this.intensity());

    if (this.time >= this.duration - 1e-9) {
      this.time = this.duration;
      this.running = false;
      this.mode = this.brokenCount === 0 ? 'survived' : 'failed';
      ev.onIntensity?.(this.disaster, 0);
      if (this.mode === 'survived') ev.onSurvived?.();
    }
  }

  private static worldPoint(body: RigidBody, local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const r = body.rotation();
    const t = body.translation();
    tmpWpQ.set(r.x, r.y, r.z, r.w);
    out.copy(local).applyQuaternion(tmpWpQ);
    out.x += t.x;
    out.y += t.y;
    out.z += t.z;
    return out;
  }

  private static linkStretch(l: Link): number {
    const p1 = SimRun.worldPoint(l.body1, l.local1, tmpP1);
    const p2 = SimRun.worldPoint(l.body2, l.local2, tmpP2);
    if (l.kind === 'strut') return Math.abs(p1.distanceTo(p2) - l.rest);
    // Every body starts unrotated, so the rest relative rotation is the identity.
    const r1 = l.body1.rotation();
    const r2 = l.body2.rotation();
    tmpQ1.set(r1.x, r1.y, r1.z, r1.w).invert();
    tmpQ2.set(r2.x, r2.y, r2.z, r2.w);
    tmpQ1.multiply(tmpQ2);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(tmpQ1.w)));
    return p1.distanceTo(p2) + angle * (CELL_SIZE / 2);
  }

  private isProtectedByShield(
    l: Link,
    shieldPositions: ReadonlyArray<{ x: number; y: number; z: number }>,
    r2: number,
  ): boolean {
    for (const sp of shieldPositions) {
      for (const b of l.blocks) {
        const bp = b.body.translation();
        const d2 = (sp.x - bp.x) ** 2 + (sp.y - bp.y) ** 2 + (sp.z - bp.z) ** 2;
        if (d2 <= r2) return true;
      }
    }
    return false;
  }

  private measureAndBreak() {
    for (const b of this.blocks) b.strain = 0;
    for (const s of this.struts) s.strain = 0;
    const activeShieldPos: Array<{ x: number; y: number; z: number }> = [];
    for (const s of this.shieldBlocks) {
      if (!s.fallen) activeShieldPos.push(s.body.translation());
    }
    const r2 = T.shield.radius * T.shield.radius;
    for (const l of this.links) {
      if (l.broken) continue;
      const limit =
        activeShieldPos.length > 0 && this.isProtectedByShield(l, activeShieldPos, r2)
          ? l.limit * T.shield.stressMultiplier
          : l.limit;
      l.strain = SimRun.linkStretch(l) / limit;
      if (l.strain > this.peakStrain) {
        this.peakStrain = l.strain;
        this.peakStrainId = l.id;
      }
      if (l.strain > 1) {
        this.breakLink(l);
        continue;
      }
      for (const b of l.blocks) b.strain = Math.max(b.strain, l.strain);
      if (l.strut) l.strut.strain = l.strain;
    }
  }

  private breakLink(l: Link) {
    l.broken = true;
    l.strain = 0;
    if (l.joint) this.world.removeImpulseJoint(l.joint, true);
    l.joint = null;
    this.brokenCount++;
    this.firstBrokenId ??= l.id;
    this.linksDirty = true;
    if (l.strut) this.makeDebris(l.strut);
    this.events().onJointBreak?.(l.id);
  }

  /** A broken strut becomes a free-falling stick. */
  private makeDebris(s: StrutRec) {
    this.strutEndsInto(s, tmpV1, tmpV2);
    SimRun.strutMeshPoseInto(s, tmpV1, tmpV2, tmpPos, tmpQuat);
    const mid = tmpV1.clone().add(tmpV2).multiplyScalar(0.5);
    const dir = tmpV2.clone().sub(tmpV1);
    const len = Math.max(0.4, dir.length());
    const rot = new THREE.Quaternion().setFromUnitVectors(UP_UNIT, dir.normalize());
    const body = this.world.createRigidBody(
      this.R.RigidBodyDesc.dynamic()
        .setTranslation(mid.x, mid.y, mid.z)
        .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w }),
    );
    this.world.createCollider(
      this.R.ColliderDesc.capsule(len / 2 - 0.15, 0.15).setDensity(
        getMaterialDef(s.data.material, this.customMaterials).density,
      ),
      body,
    );
    s.debris = body;
    // From now on the mesh pose is stored relative to the debris body.
    const inv = rot.clone().invert();
    s.meshPos = tmpPos.clone().sub(mid).applyQuaternion(inv);
    s.meshQuat = inv.multiply(tmpQuat);
  }

  private strutEndsInto(s: StrutRec, outA: THREE.Vector3, outB: THREE.Vector3): void {
    if (s.endA) SimRun.worldPoint(s.endA.body, s.endA.local, outA);
    else outA.copy(s.initA);
    if (s.endB) SimRun.worldPoint(s.endB.body, s.endB.local, outB);
    else outB.copy(s.initB);
  }

  /** Mesh pose that maps the blueprint segment initA-initB onto the current segment a-b. */
  private static strutMeshPoseInto(
    s: StrutRec,
    a: THREE.Vector3,
    b: THREE.Vector3,
    outPos: THREE.Vector3,
    outQuat: THREE.Quaternion,
  ): void {
    tmpD0.subVectors(s.initB, s.initA).normalize();
    tmpD1.subVectors(b, a).normalize();
    tmpRot.setFromUnitVectors(tmpD0, tmpD1);
    tmpMid0.addVectors(s.initA, s.initB).multiplyScalar(0.5);
    tmpMid1.addVectors(a, b).multiplyScalar(0.5);
    outPos.subVectors(s.meshPos, tmpMid0).applyQuaternion(tmpRot).add(tmpMid1);
    outQuat.multiplyQuaternions(tmpRot, s.meshQuat);
  }

  // ---------------------------------------------------------------- scoring

  /** Marks pieces that came loose or drifted away as fallen and refreshes standingRatio. */
  private updateStanding() {
    if (this.linksDirty) {
      this.linksDirty = false;
      const held = new Set<BlockRec>();
      for (const l of this.links) if (!l.broken) for (const b of l.blocks) held.add(b);
      for (const b of this.blocks) if (!held.has(b)) b.fallen = true;
    }
    const g = this.ground.translation();
    const tol2 = T.standing.tolerance ** 2;
    for (const b of this.blocks) {
      if (b.fallen) continue;
      const p = b.body.translation();
      const drift2 =
        (p.x - g.x - b.start.x) ** 2 + (p.y - g.y - b.start.y) ** 2 + (p.z - g.z - b.start.z) ** 2;
      if (drift2 > tol2) b.fallen = true;
    }
    for (const s of this.struts) {
      if (s.fallen) continue;
      if (s.debris || s.endA?.rec?.fallen || s.endB?.rec?.fallen) s.fallen = true;
    }
    const total = this.blocks.length + this.struts.length;
    let fallen = 0;
    for (const b of this.blocks) if (b.fallen) fallen++;
    for (const s of this.struts) if (s.fallen) fallen++;
    this.standingRatio = total === 0 ? 1 : (total - fallen) / total;
  }

  // ---------------------------------------------------------------- rendering sync

  private syncMeshes() {
    for (const b of this.blocks) {
      if (!b.mesh) continue;
      const r = b.body.rotation();
      const t = b.body.translation();
      tmpQ1.set(r.x, r.y, r.z, r.w);
      b.mesh.position.copy(b.meshOffsetPos).applyQuaternion(tmpQ1);
      b.mesh.position.x += t.x;
      b.mesh.position.y += t.y;
      b.mesh.position.z += t.z;
      b.mesh.quaternion.multiplyQuaternions(tmpQ1, b.meshOffsetQuat);
      tint(b.mesh, b.strain);
    }
    for (const s of this.struts) {
      if (!s.mesh) continue;
      if (s.debris) {
        const r = s.debris.rotation();
        const t = s.debris.translation();
        tmpQ1.set(r.x, r.y, r.z, r.w);
        s.mesh.position.copy(s.meshPos).applyQuaternion(tmpQ1);
        s.mesh.position.x += t.x;
        s.mesh.position.y += t.y;
        s.mesh.position.z += t.z;
        s.mesh.quaternion.multiplyQuaternions(tmpQ1, s.meshQuat);
      } else {
        this.strutEndsInto(s, tmpV1, tmpV2);
        SimRun.strutMeshPoseInto(s, tmpV1, tmpV2, s.mesh.position, s.mesh.quaternion);
      }
      tint(s.mesh, s.strain);
    }
    for (const p of this.projectiles) {
      const t = p.body.translation();
      const r = p.body.rotation();
      p.mesh.position.set(t.x, t.y, t.z);
      p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
    for (const d of this.shieldDomes) {
      d.mesh.visible = !d.rec.fallen;
      const t = d.rec.body.translation();
      d.mesh.position.set(t.x, t.y, t.z);
    }
  }
}
