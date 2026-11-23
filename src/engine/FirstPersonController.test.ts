import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { EYE_HEIGHT, FirstPersonController, PLAYER_RADIUS } from './FirstPersonController';

function mockDom() {
  const captured = new Set<number>();
  const dom = Object.assign(new EventTarget(), {
    setPointerCapture: (id: number) => captured.add(id),
    releasePointerCapture: (id: number) => captured.delete(id),
    hasPointerCapture: (id: number) => captured.has(id),
  }) as unknown as HTMLElement;
  return { dom, captured };
}

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

  it('releases pointer capture on setEnabled(false) and dispose()', () => {
    const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    const { dom, captured } = mockDom();
    const fp = new FirstPersonController(cam, dom);
    fp.setEnabled(true);
    dom.dispatchEvent(
      Object.assign(new Event('pointerdown'), {
        button: 0,
        isPrimary: true,
        pointerId: 7,
        clientX: 10,
        clientY: 10,
      }),
    );
    expect(captured.has(7)).toBe(true);
    fp.setEnabled(false);
    expect(captured.size).toBe(0);

    fp.setEnabled(true);
    dom.dispatchEvent(
      Object.assign(new Event('pointerdown'), {
        button: 0,
        isPrimary: true,
        pointerId: 9,
        clientX: 10,
        clientY: 10,
      }),
    );
    expect(captured.has(9)).toBe(true);
    fp.dispose();
    expect(captured.size).toBe(0);
  });

  it('pauses keyboard and pointer input when setInputPaused(true) and resumes cleanly', () => {
    const winTarget = new EventTarget();
    vi.stubGlobal('window', winTarget);
    try {
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
      const { dom, captured } = mockDom();
      const fp = new FirstPersonController(cam, dom);
      fp.spawn([]);
      fp.setEnabled(true);
      fp.setKey('KeyW', true);
      dom.dispatchEvent(
        Object.assign(new Event('pointerdown'), {
          button: 0,
          isPrimary: true,
          pointerId: 4,
          clientX: 20,
          clientY: 20,
        }),
      );
      expect(captured.has(4)).toBe(true);

      fp.setInputPaused(true);
      expect(captured.size).toBe(0);

      const zPaused = fp.pos.z;
      const yawPaused = fp.yaw;
      winTarget.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyW' }));
      dom.dispatchEvent(
        Object.assign(new Event('pointerdown'), {
          button: 0,
          isPrimary: true,
          pointerId: 5,
          clientX: 20,
          clientY: 20,
        }),
      );
      dom.dispatchEvent(
        Object.assign(new Event('pointermove'), { isPrimary: true, pointerId: 5, clientX: 120, clientY: 20 }),
      );
      fp.update(1 / 60, []);
      expect(fp.pos.z).toBe(zPaused);
      expect(fp.yaw).toBe(yawPaused);
      expect(captured.size).toBe(0);

      fp.setInputPaused(false);
      winTarget.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyW' }));
      fp.update(1 / 60, []);
      expect(fp.pos.z).toBeLessThan(zPaused);
      fp.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
