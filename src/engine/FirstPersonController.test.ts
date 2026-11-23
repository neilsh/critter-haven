import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EYE_HEIGHT, FirstPersonController, PLAYER_RADIUS } from './FirstPersonController';

describe('FirstPersonController', () => {
  it('spawns in a clear spot facing the village center and syncs the camera', () => {
    const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    const fp = new FirstPersonController(cam);
    fp.spawn([[0, 1, 6]]); // blocks default [0, 0, 6.2]
    expect(fp.getFeetPosition()).not.toEqual([0, 0, 6.2]);
    expect(cam.position.y).toBeCloseTo(EYE_HEIGHT);
    fp.dispose();
  });

  it('walks with WASD, jumps with Space, and lands back on the island', () => {
    const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    const fp = new FirstPersonController(cam);
    fp.spawn([]);
    fp.setEnabled(true);
    const startZ = fp.pos.z;
    fp.setKey('KeyW', true);
    for (let i = 0; i < 10; i++) fp.update(1 / 60, []);
    expect(fp.pos.z).toBeLessThan(startZ - 0.5);
    expect(cam.position.z).toBeCloseTo(fp.pos.z);

    fp.setKey('KeyW', false);
    fp.setKey('Space', true);
    fp.update(1 / 60, []);
    fp.setKey('Space', false);
    expect(fp.pos.y).toBeGreaterThan(0);
    expect(fp.grounded).toBe(false);

    for (let i = 0; i < 120; i++) fp.update(1 / 60, []);
    expect(fp.pos.y).toBe(0);
    expect(fp.grounded).toBe(true);
    fp.dispose();
  });

  it('collides horizontally with blocks and clamps look pitch', () => {
    const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    const fp = new FirstPersonController(cam);
    fp.spawn([]);
    fp.setEnabled(true);
    fp.pos.set(0, 0, 2);
    fp.yaw = 0;
    fp.setKey('KeyW', true);
    for (let i = 0; i < 30; i++) fp.update(1 / 60, [[0, 1, 0]]);
    expect(fp.pos.z).toBeGreaterThanOrEqual(1 + PLAYER_RADIUS - 1e-4);

    fp.lookDelta(0, -10000);
    expect(fp.pitch).toBeLessThan(Math.PI / 2);
    fp.lookDelta(0, 20000);
    expect(fp.pitch).toBeGreaterThan(-Math.PI / 2);
    fp.dispose();
  });
});
