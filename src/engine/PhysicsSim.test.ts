/**
 * Headless calibration for PhysicsSim: runs real Rapier in Node with plain three.js meshes.
 * If tuning changes, these tests define what "sensible" means for each disaster.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { BlueprintGraph, DisasterType, MaterialType, StrutData, Vec3 } from '../types/blueprint';
import { DISASTER_SECONDS, PRESETS, blockId, cellToWorld, cornerToWorld, strutId } from '../types/blueprint';
import type { MeshRegistry } from './BuildController';
import { PHYSICS_TUNING, PhysicsSim } from './PhysicsSim';

const SEEDS = [1, 2, 3, 4, 5];

function meshesFor(g: BlueprintGraph, parent = new THREE.Group()): MeshRegistry {
  const reg: MeshRegistry = { blocks: new Map(), struts: new Map() };
  for (const b of g.blocks) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial());
    m.position.set(...cellToWorld(b.cell));
    parent.add(m);
    reg.blocks.set(b.id, m);
  }
  for (const s of g.struts) {
    const a = new THREE.Vector3(...cornerToWorld(s.a));
    const b = new THREE.Vector3(...cornerToWorld(s.b));
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, a.distanceTo(b)),
      new THREE.MeshStandardMaterial(),
    );
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    parent.add(m);
    reg.struts.set(s.id, m);
  }
  return reg;
}

async function simulate(g: BlueprintGraph, disaster: DisasterType, seed = 1) {
  const sim = new PhysicsSim();
  const breaks: string[] = [];
  const water: number[] = [];
  let survived = 0;
  sim.setEvents({
    onJointBreak: (id) => breaks.push(id),
    onSurvived: () => survived++,
    onWaterLevel: (y) => water.push(y),
  });
  const meshes = meshesFor(g);
  await sim.start(g, meshes, disaster, seed);
  for (let f = 0; sim.isRunning() && f < 60 * (DISASTER_SECONDS + 1); f++) sim.update(1 / 60);
  return { sim, t: sim.getTelemetry(), peak: sim.getPeakStrain(), breaks, water, survived, meshes };
}

function strut(a: Vec3, b: Vec3, material: MaterialType = 'bamboo'): StrutData {
  return { id: strutId(a, b), a, b, material };
}

/** The tower preset with bamboo X-braces on all four faces of both 2-block halves. */
function bracedTower(): BlueprintGraph {
  const g = PRESETS.tower();
  for (const y of [0, 2]) {
    for (const z of [3, 4]) g.struts.push(strut([3, y, z], [4, y + 2, z]), strut([4, y, z], [3, y + 2, z]));
    for (const x of [3, 4]) g.struts.push(strut([x, y, 3], [x, y + 2, 4]), strut([x, y, 4], [x, y + 2, 3]));
  }
  return g;
}

describe('PhysicsSim lifecycle', () => {
  it('reports build telemetry before starting', () => {
    const sim = new PhysicsSim();
    expect(sim.isRunning()).toBe(false);
    expect(sim.getTelemetry()).toEqual({
      mode: 'build',
      timeRemaining: DISASTER_SECONDS,
      activeJoints: 0,
      brokenJoints: 0,
      firstBrokenId: null,
      waterLevel: -2,
    });
  });

  it('runs, counts joints, clamps frame time and returns to build on stop', async () => {
    const g = PRESETS.house();
    const sim = new PhysicsSim();
    await sim.start(g, meshesFor(g), 'earthquake');
    expect(sim.isRunning()).toBe(true);
    // 12 blocks: 20 face links + 4 anchors, plus 8 struts.
    expect(sim.getTelemetry()).toMatchObject({ mode: 'simulating', activeJoints: 32, brokenJoints: 0 });

    sim.update(1); // a 1 s hitch is clamped to 0.05 s = 3 fixed steps
    expect(sim.getTelemetry().timeRemaining).toBeCloseTo(DISASTER_SECONDS - 3 / 60, 5);

    sim.stop();
    expect(sim.isRunning()).toBe(false);
    expect(sim.getTelemetry().mode).toBe('build');
    expect(sim.getTelemetry().timeRemaining).toBe(DISASTER_SECONDS);
  });

  it('a stop() during Rapier start-up cancels that run', async () => {
    const g = PRESETS.tower();
    const sim = new PhysicsSim();
    const pending = sim.start(g, meshesFor(g), 'earthquake');
    sim.stop();
    await pending;
    expect(sim.isRunning()).toBe(false);
    expect(sim.getTelemetry().mode).toBe('build');
  });

  it('restarting replaces the previous run', async () => {
    const g = PRESETS.tower();
    const sim = new PhysicsSim();
    await sim.start(g, meshesFor(g), 'earthquake');
    for (let i = 0; i < 120; i++) sim.update(1 / 60);
    await sim.start(g, meshesFor(g), 'hurricane');
    expect(sim.getTelemetry()).toMatchObject({ mode: 'simulating', brokenJoints: 0 });
    expect(sim.getTelemetry().timeRemaining).toBe(DISASTER_SECONDS);
  });

  it('is deterministic for a given seed', async () => {
    const a = await simulate(PRESETS.tower(), 'hurricane', 7);
    const b = await simulate(PRESETS.tower(), 'hurricane', 7);
    expect(b.breaks).toEqual(a.breaks);
    expect(b.peak.strain).toBe(a.peak.strain);
    const pa = a.meshes.blocks.get(blockId([3, 3, 3]))?.position;
    const pb = b.meshes.blocks.get(blockId([3, 3, 3]))?.position;
    expect(pb?.toArray()).toEqual(pa?.toArray());
  });

  it('an empty island survives every disaster', async () => {
    const runs = await Promise.all(
      (['earthquake', 'hurricane', 'flood', 'hail'] as const).map((d) => simulate(PRESETS.empty(), d)),
    );
    expect(runs.map((r) => r.t.mode)).toEqual(['survived', 'survived', 'survived', 'survived']);
  });
});

describe('earthquake calibration', () => {
  it.each(SEEDS)('the unbraced tower fails (seed %i)', async (seed) => {
    const r = await simulate(PRESETS.tower(), 'earthquake', seed);
    expect(r.t.mode).toBe('failed');
    expect(r.t.brokenJoints).toBeGreaterThan(0);
    expect(r.t.firstBrokenId).toBe(r.breaks[0]);
    expect(r.t.firstBrokenId).toMatch(/^b:3,[0-3],3$/);
    expect(r.t.timeRemaining).toBe(0);
  });

  it.each(SEEDS)('the starter house survives with margin (seed %i)', async (seed) => {
    const r = await simulate(PRESETS.house(), 'earthquake', seed);
    expect(r.t.mode).toBe('survived');
    expect(r.t.brokenJoints).toBe(0);
    expect(r.survived).toBe(1);
    expect(r.peak.strain).toBeLessThan(0.6);
  });
});

describe('other disasters', () => {
  it.each(SEEDS)(
    'hurricane: tower fails, house survives, bracing saves the tower (seed %i)',
    async (seed) => {
      expect((await simulate(PRESETS.tower(), 'hurricane', seed)).t.mode).toBe('failed');
      expect((await simulate(PRESETS.house(), 'hurricane', seed)).t.mode).toBe('survived');
      expect((await simulate(bracedTower(), 'hurricane', seed)).t.mode).toBe('survived');
    },
  );

  it.each(SEEDS)('flood: tower is swept over, house and braced tower survive (seed %i)', async (seed) => {
    const tower = await simulate(PRESETS.tower(), 'flood', seed);
    expect(tower.t.mode).toBe('failed');
    const house = await simulate(PRESETS.house(), 'flood', seed);
    expect(house.t.mode).toBe('survived');
    expect((await simulate(bracedTower(), 'flood', seed)).t.mode).toBe('survived');
    // Water rises monotonically and is reported to the scene.
    expect(house.water.length).toBeGreaterThan(400);
    expect(house.water.at(-1)).toBeGreaterThan(3);
    expect(house.t.waterLevel).toBeCloseTo(house.water.at(-1) ?? 0, 5);
  });

  it('flood: loose foam floats up and loose stone stays down', async () => {
    const g: BlueprintGraph = {
      version: 1,
      // Floating blocks (cy = 1, no neighbours) are unanchored, so they settle on the island first.
      blocks: [
        { id: blockId([0, 1, 0]), cell: [0, 1, 0], material: 'foam' },
        { id: blockId([7, 1, 7]), cell: [7, 1, 7], material: 'stone' },
      ],
      struts: [],
    };
    const r = await simulate(g, 'flood');
    const foam = r.meshes.blocks.get(blockId([0, 1, 0]))?.position.y ?? 0;
    const stone = r.meshes.blocks.get(blockId([7, 1, 7]))?.position.y ?? 0;
    expect(foam).toBeGreaterThan(2.5);
    expect(stone).toBeLessThan(1.5);
  });

  it.each(SEEDS)('hail: house survives, hail stones appear and are cleaned up (seed %i)', async (seed) => {
    const g = PRESETS.house();
    const root = new THREE.Group();
    const meshes = meshesFor(g, root);
    const before = root.children.length;
    const sim = new PhysicsSim();
    await sim.start(g, meshes, 'hail', seed);
    let maxChildren = before;
    while (sim.isRunning()) {
      sim.update(1 / 60);
      maxChildren = Math.max(maxChildren, root.children.length);
    }
    expect(sim.getTelemetry().mode).toBe('survived');
    expect(maxChildren).toBeGreaterThan(before + 10);
    sim.stop();
    expect(root.children.length).toBe(before);
  });
});

describe('stress X-ray and meshes', () => {
  it('moves and tints meshes while shaking, and drops broken struts', async () => {
    const g = bracedTower();
    const meshes = meshesFor(g);
    const top = meshes.blocks.get(blockId([3, 3, 3]));
    const start = top?.position.clone();
    const sim = new PhysicsSim();
    await sim.start(g, meshes, 'earthquake');
    let maxEmissive = 0;
    while (sim.isRunning()) {
      sim.update(1 / 60);
      const mat = top?.material;
      if (mat instanceof THREE.MeshStandardMaterial) maxEmissive = Math.max(maxEmissive, mat.emissive.r);
    }
    expect(top?.position.distanceTo(start ?? new THREE.Vector3())).toBeGreaterThan(0.01);
    // Strain above ~0.5 turns the tint from green towards yellow/orange (red channel rises).
    expect(maxEmissive).toBeGreaterThan(0.3);
  });

  it('a strut that breaks falls as debris', async () => {
    // A single weak foam strut on the shaking wood tower, made extra floppy for this test.
    const g = PRESETS.tower();
    g.struts.push(strut([3, 0, 3], [4, 2, 3], 'foam'));
    const saved = PHYSICS_TUNING.strutStiffness;
    PHYSICS_TUNING.strutStiffness = 500;
    const r = await simulate(g, 'earthquake').finally(() => {
      PHYSICS_TUNING.strutStiffness = saved;
    });
    const id = g.struts[0].id;
    expect(r.breaks).toContain(id);
    // Its mesh no longer spans the wall (centre was at y = 2): it fell onto the island.
    expect(r.meshes.struts.get(id)?.position.y ?? 99).toBeLessThan(1);
  });
});
