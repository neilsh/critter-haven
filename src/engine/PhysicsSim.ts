/**
 * OWNER: package A (Rapier sim, disasters, X-ray, win state). Contract below is fixed; internals are yours.
 *
 * Rules from the spec: fixed 1/60 s accumulator with dt clamped to 0.05; joined bodies must have
 * contacts disabled; ground-level blocks get breakable anchors to the kinematic island body;
 * strain ratio > 1 removes the joint and records the FIRST broken id; survive 8 s with zero broken
 * joints to win. Initialise Rapier lazily on `start` (rapier3d-compat embeds its wasm, no fetch).
 *
 * Must be runnable headless in Node (Vitest) when given a `MeshRegistry` of plain objects, so the
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
  MATERIALS,
  blocksAtCorner,
  cellToWorld,
  cornerToWorld,
  key,
} from '../types/blueprint';
import type { MeshRegistry } from './BuildController';

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

export interface PhysicsEvents {
  /** id is the BlockData/StrutData id (or anchor-owning block id) whose joint broke. */
  onJointBreak?(id: string): void;
  onSurvived?(): void;
  /** For sound: 0..1 strength of the current disaster, called every step. */
  onIntensity?(disaster: DisasterType, intensity: number): void;
  onWaterLevel?(y: number): void;
  /** For visuals: a hail stone first hit something, at this world point (bottom of the stone). */
  onHailImpact?(x: number, y: number, z: number): void;
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
  /** Disaster force multiplier per strength level (medium is the calibrated baseline). */
  strength: { gentle: 0.6, medium: 1, strong: 1.4 } satisfies Record<Strength, number>,
  /** A piece whose centre drifts further than this (world units, relative to the island) has fallen. */
  standing: { tolerance: 1 },
};

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
const envelope = (t: number) => smooth(t / 1.5) * smooth((DISASTER_SECONDS - t) / 1.5);

const STRAIN_COLORS = [new THREE.Color(0x22c55e), new THREE.Color(0xfacc15), new THREE.Color(0xff6a00)];
const tmpColor = new THREE.Color();
/** Green (0) -> yellow (0.5) -> orange (1+). */
function strainColor(s: number, out: THREE.Color) {
  const x = clamp01(s) * 2;
  const i = Math.min(1, Math.floor(x));
  return out.copy(STRAIN_COLORS[i]).lerp(STRAIN_COLORS[i + 1], x - i);
}

/** Stress X-ray: emissive tint by strain ratio. Meshes own their material instance (BuildController contract). */
function tint(mesh: THREE.Mesh, strain: number) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) {
    if (
      m instanceof THREE.MeshStandardMaterial ||
      m instanceof THREE.MeshLambertMaterial ||
      m instanceof THREE.MeshPhongMaterial
    ) {
      m.emissive.copy(strainColor(strain, tmpColor));
      m.emissiveIntensity = 0.25 + 0.6 * clamp01(strain);
    }
  }
}

const v3 = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z);
const q4 = (q: { x: number; y: number; z: number; w: number }) => new THREE.Quaternion(q.x, q.y, q.z, q.w);

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
}

// ------------------------------------------------------------------ internal records

interface BlockRec {
  data: BlockData;
  body: RigidBody;
  mesh: THREE.Mesh | undefined;
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
  mesh: THREE.Mesh | undefined;
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

interface Hail {
  body: RigidBody;
  mesh: THREE.Mesh;
  radius: number;
  landed: boolean;
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
  private hail: Hail[] = [];
  private readonly hailGeom = new THREE.SphereGeometry(1, 12, 8);
  private readonly hailMat = new THREE.MeshStandardMaterial({
    color: 0xdff3ff,
    roughness: 0.25,
    transparent: true,
    opacity: 0.9,
  });

  private readonly rng: () => number;
  private readonly quakePhase: number[];
  /** Wind / flood-current heading (radians) and how fast it swirls. */
  private flowAngle: number;
  private readonly flowSpin: number;
  private gust = 1;
  private gustTarget = 1;
  private gustTimer = 0;
  private hailAccumulator = 0;
  private readonly spawnBox: { minX: number; maxX: number; minZ: number; maxZ: number; top: number };

  private mode: Telemetry['mode'] = 'simulating';
  private time = 0;
  private accumulator = 0;
  private brokenCount = 0;
  private firstBrokenId: string | null = null;
  private waterLevel = WATER_HIDDEN;
  /** Set by breakLink: blocks whose last link broke must be marked loose at the next standing check. */
  private linksDirty = true;
  private standingRatio = 1;

  constructor(
    private readonly R: Rapier,
    graph: BlueprintGraph,
    meshes: MeshRegistry,
    private readonly disaster: DisasterType,
    seed: number,
    /** Disaster force multiplier from the strength level. */
    private readonly power: number,
    private readonly hailRoot: THREE.Object3D | null,
    private readonly events: () => PhysicsEvents,
  ) {
    const world = new this.R.World({ x: 0, y: -T.gravity, z: 0 });
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

    if (disaster === 'flood') {
      this.waterLevel = T.flood.start;
      this.events().onWaterLevel?.(this.waterLevel);
    }
    this.updateStanding();
    this.syncMeshes();
  }

  telemetry(): PhysicsTelemetry {
    return {
      mode: this.mode,
      timeRemaining: Math.max(0, DISASTER_SECONDS - this.time),
      activeJoints: this.links.length - this.brokenCount,
      brokenJoints: this.brokenCount,
      firstBrokenId: this.firstBrokenId,
      waterLevel: this.waterLevel,
      standingRatio: this.standingRatio,
      stars: starsFor(this.brokenCount, this.standingRatio),
    };
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
    for (const h of this.hail) this.hailRoot?.remove(h.mesh);
    this.hail = [];
    this.hailGeom.dispose();
    this.hailMat.dispose();
    this.world.free();
  }

  // ---------------------------------------------------------------- world construction

  private addBlocks(graph: BlueprintGraph, meshes: MeshRegistry) {
    const byCell = new Map<string, BlockRec>();
    const h = (CELL_SIZE / 2) * T.colliderScale;
    for (const b of graph.blocks) {
      const mat = MATERIALS[b.material];
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

  private addBlockLink(a: BlockRec, b: BlockRec, dir: Vec3) {
    const hc = CELL_SIZE / 2;
    const l1 = new THREE.Vector3(dir[0] * hc, dir[1] * hc, dir[2] * hc);
    const l2 = l1.clone().negate();
    const ma = MATERIALS[a.data.material];
    const mb = MATERIALS[b.data.material];
    const joint = this.createSpring(a.body, l1, b.body, l2, Math.min(ma.stiffness, mb.stiffness), false);
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
    const mat = MATERIALS[rec.data.material];
    const joint = this.createSpring(this.ground, l1, rec.body, l2, mat.stiffness, true);
    this.links.push({
      id: rec.data.id,
      kind: 'anchor',
      joint,
      body1: this.ground,
      body2: rec.body,
      local1: l1,
      local2: l2,
      rest: 0,
      limit: mat.maxStress * T.stretchUnit * T.anchorStrength,
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
    if (rec) return { body: rec.body, local: w.sub(v3(rec.body.translation())), rec };
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
    const mat = MATERIALS[s.material];
    const k = T.strutStiffness * mat.stiffness;
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
      blocks: [endA.rec, endB.rec].filter((r) => r !== null),
      strut: rec,
      strain: 0,
      broken: false,
    });
  }

  // ---------------------------------------------------------------- disasters

  /** 0..1 strength for audio. */
  private intensity(): number {
    const env = envelope(this.time);
    if (this.disaster === 'hurricane') return env * clamp01(this.gust);
    if (this.disaster === 'flood') return env * 0.7;
    return env;
  }

  /** Open area facing a flow along (dx, dz): the -x face meets a +x flow, and so on. */
  private static upstreamExposure(b: BlockRec, dx: number, dz: number) {
    const [px, nx, pz, nz] = b.exposure;
    return Math.max(0, -dx) * nx + Math.max(0, dx) * px + Math.max(0, -dz) * nz + Math.max(0, dz) * pz;
  }

  private applyDisaster() {
    switch (this.disaster) {
      case 'earthquake':
        return this.applyQuake();
      case 'hurricane':
        return this.applyWind();
      case 'flood':
        return this.applyFlood();
      case 'hail':
        return this.applyHail();
    }
  }

  private applyQuake() {
    const q = T.quake;
    const t = this.time;
    const env = envelope(t);
    let dx = 0;
    let dz = 0;
    for (let i = 0; i < q.freqs.length; i++) {
      const w = 2 * Math.PI * q.freqs[i];
      dx += q.weights[i] * Math.sin(w * t + this.quakePhase[i]);
      dz += q.weights[i] * Math.sin(w * 1.13 * t + this.quakePhase[i + 3]);
    }
    const amp = q.amplitude * this.power * env;
    this.ground.setNextKinematicTranslation({ x: amp * dx, y: 0, z: amp * q.zRatio * dz });
  }

  private applyWind() {
    const w = T.wind;
    this.gustTimer -= T.step;
    if (this.gustTimer <= 0) {
      this.gustTimer = 0.4 + this.rng() * 0.8;
      this.gustTarget = w.gustMin + this.rng() * (1 - w.gustMin) * 1.3;
    }
    this.gust += (this.gustTarget - this.gust) * Math.min(1, T.step * 4);
    this.flowAngle += this.flowSpin * T.step;
    const wx = Math.cos(this.flowAngle);
    const wz = Math.sin(this.flowAngle);
    const strength = w.force * this.power * envelope(this.time) * this.gust;
    for (const b of this.blocks) {
      const height = 1 + w.heightGain * Math.max(0, b.body.translation().y);
      const f = strength * SimRun.upstreamExposure(b, wx, wz) * height;
      b.body.resetForces(false);
      b.body.addForce({ x: wx * f, y: 0, z: wz * f }, true);
    }
  }

  private applyFlood() {
    const f = T.flood;
    const env = envelope(this.time);
    this.waterLevel = f.start + (f.peak - f.start) * smooth(this.time / f.riseSeconds);
    this.events().onWaterLevel?.(this.waterLevel);
    const cx = Math.cos(this.flowAngle);
    const cz = Math.sin(this.flowAngle);
    for (const b of this.blocks) {
      b.body.resetForces(false);
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
          y: sub * b.mass * T.gravity * b.buoyancy - v.y * drag,
          z: cz * push - v.z * drag,
        },
        true,
      );
    }
  }

  private applyHail() {
    const h = T.hail;
    this.hailAccumulator += h.perSecond * this.power * envelope(this.time) * T.step;
    while (this.hailAccumulator >= 1) {
      this.hailAccumulator -= 1;
      this.spawnHail();
    }
    // Report each stone's first hit (its fall is suddenly slowed), and cull stones that fell off.
    const ev = this.events();
    this.hail = this.hail.filter((s) => {
      const p = s.body.translation();
      if (!s.landed && s.body.linvel().y > -h.speed * 0.5) {
        s.landed = true;
        ev.onHailImpact?.(p.x, p.y - s.radius, p.z);
      }
      if (p.y > -20) return true;
      this.hailRoot?.remove(s.mesh);
      this.world.removeRigidBody(s.body);
      return false;
    });
  }

  private spawnHail() {
    const h = T.hail;
    const b = this.spawnBox;
    const r = h.radiusMin + this.rng() * (h.radiusMax - h.radiusMin);
    const x = b.minX + this.rng() * (b.maxX - b.minX);
    const z = b.minZ + this.rng() * (b.maxZ - b.minZ);
    const y = b.top + h.height * (0.6 + 0.4 * this.rng());
    const body = this.world.createRigidBody(
      this.R.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setLinvel(0, -h.speed * Math.sqrt(this.power), 0)
        .setCcdEnabled(true),
    );
    this.world.createCollider(this.R.ColliderDesc.ball(r).setDensity(h.density).setRestitution(0.2), body);
    const mesh = new THREE.Mesh(this.hailGeom, this.hailMat);
    mesh.scale.setScalar(r);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    this.hailRoot?.add(mesh);
    this.hail.push({ body, mesh, radius: r, landed: false });
  }

  // ---------------------------------------------------------------- stepping & strain

  private stepOnce() {
    this.time += T.step;
    this.applyDisaster();
    this.world.step();
    this.measureAndBreak();
    this.updateStanding();
    const ev = this.events();
    ev.onIntensity?.(this.disaster, this.intensity());

    if (this.time >= DISASTER_SECONDS - 1e-9) {
      this.time = DISASTER_SECONDS;
      this.running = false;
      this.mode = this.brokenCount === 0 ? 'survived' : 'failed';
      ev.onIntensity?.(this.disaster, 0);
      if (this.mode === 'survived') ev.onSurvived?.();
    }
  }

  private static worldPoint(body: RigidBody, local: THREE.Vector3) {
    return local.clone().applyQuaternion(q4(body.rotation())).add(v3(body.translation()));
  }

  private static linkStretch(l: Link): number {
    const p1 = SimRun.worldPoint(l.body1, l.local1);
    const p2 = SimRun.worldPoint(l.body2, l.local2);
    if (l.kind === 'strut') return Math.abs(p1.distanceTo(p2) - l.rest);
    // Every body starts unrotated, so the rest relative rotation is the identity.
    const rel = q4(l.body1.rotation()).invert().multiply(q4(l.body2.rotation()));
    const angle = 2 * Math.acos(Math.min(1, Math.abs(rel.w)));
    return p1.distanceTo(p2) + angle * (CELL_SIZE / 2);
  }

  private measureAndBreak() {
    for (const b of this.blocks) b.strain = 0;
    for (const s of this.struts) s.strain = 0;
    for (const l of this.links) {
      if (l.broken) continue;
      l.strain = SimRun.linkStretch(l) / l.limit;
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
    const [a, b] = this.strutEnds(s);
    const meshPose = SimRun.strutMeshPose(s, a, b);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const dir = b.clone().sub(a);
    const len = Math.max(0.4, dir.length());
    const rot = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const body = this.world.createRigidBody(
      this.R.RigidBodyDesc.dynamic()
        .setTranslation(mid.x, mid.y, mid.z)
        .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w }),
    );
    this.world.createCollider(
      this.R.ColliderDesc.capsule(len / 2 - 0.15, 0.15).setDensity(MATERIALS[s.data.material].density),
      body,
    );
    s.debris = body;
    // From now on the mesh pose is stored relative to the debris body.
    const inv = rot.clone().invert();
    s.meshPos = meshPose.pos.sub(mid).applyQuaternion(inv);
    s.meshQuat = inv.multiply(meshPose.quat);
  }

  private strutEnds(s: StrutRec): [THREE.Vector3, THREE.Vector3] {
    const end = (e: StrutEnd | null, fallback: THREE.Vector3) =>
      e ? SimRun.worldPoint(e.body, e.local) : fallback.clone();
    return [end(s.endA, s.initA), end(s.endB, s.initB)];
  }

  /** Mesh pose that maps the blueprint segment initA-initB onto the current segment a-b. */
  private static strutMeshPose(s: StrutRec, a: THREE.Vector3, b: THREE.Vector3) {
    const d0 = s.initB.clone().sub(s.initA).normalize();
    const d1 = b.clone().sub(a).normalize();
    const rot = new THREE.Quaternion().setFromUnitVectors(d0, d1);
    const mid0 = s.initA.clone().add(s.initB).multiplyScalar(0.5);
    const mid1 = a.clone().add(b).multiplyScalar(0.5);
    const pos = s.meshPos.clone().sub(mid0).applyQuaternion(rot).add(mid1);
    return { pos, quat: rot.multiply(s.meshQuat) };
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
      const q = q4(b.body.rotation());
      b.mesh.position.copy(b.meshOffsetPos).applyQuaternion(q).add(v3(b.body.translation()));
      b.mesh.quaternion.copy(q).multiply(b.meshOffsetQuat);
      tint(b.mesh, b.strain);
    }
    for (const s of this.struts) {
      if (!s.mesh) continue;
      if (s.debris) {
        const q = q4(s.debris.rotation());
        s.mesh.position.copy(s.meshPos).applyQuaternion(q).add(v3(s.debris.translation()));
        s.mesh.quaternion.copy(q).multiply(s.meshQuat);
      } else {
        const [a, b] = this.strutEnds(s);
        const pose = SimRun.strutMeshPose(s, a, b);
        s.mesh.position.copy(pose.pos);
        s.mesh.quaternion.copy(pose.quat);
      }
      tint(s.mesh, s.strain);
    }
    for (const h of this.hail) {
      h.mesh.position.copy(v3(h.body.translation()));
      h.mesh.quaternion.copy(q4(h.body.rotation()));
    }
  }
}
