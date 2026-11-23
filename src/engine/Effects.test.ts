import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DisasterEffects } from './Effects';

function setup(reducedMotion = false) {
  const root = new THREE.Group();
  const sky = { background: new THREE.Color('#9bdcff'), fog: new THREE.Fog('#c9ecff', 70, 150) };
  const fx = new DisasterEffects(root, sky, { reducedMotion });
  const meshes = root.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh);
  const visible = () => {
    const m = new THREE.Matrix4();
    const s = new THREE.Vector3();
    let n = 0;
    for (const mesh of meshes) {
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        s.setFromMatrixScale(m);
        if (s.x > 0) n++;
      }
    }
    return n;
  };
  const run = (disaster: Parameters<DisasterEffects['setDisaster']>[0], seconds: number, level = 1) => {
    for (let t = 0; t < seconds; t += 1 / 60) {
      fx.setDisaster(disaster, level);
      fx.update(1 / 60);
    }
  };
  return { fx, sky, meshes, visible, run };
}

describe('DisasterEffects', () => {
  it('uses one instanced mesh per effect', () => {
    expect(setup().meshes).toHaveLength(5);
  });

  it('shakes the camera in an earthquake, but not with reduced motion', () => {
    const a = setup();
    a.run('earthquake', 1);
    expect(a.fx.shakeOffset.length()).toBeGreaterThan(0);
    expect(a.visible()).toBeGreaterThan(0);
    const b = setup(true);
    b.run('earthquake', 1);
    expect(b.fx.shakeOffset.length()).toBe(0);
  });

  it('intensity 0 removes every effect and restores the sky at once', () => {
    const { fx, sky, visible, run } = setup();
    const bg = sky.background.clone();
    run('hurricane', 1);
    expect(visible()).toBeGreaterThan(0);
    expect(sky.background.equals(bg)).toBe(false);
    fx.setDisaster('hurricane', 0);
    fx.update(1 / 60);
    expect(visible()).toBe(0);
    expect(sky.background.equals(bg)).toBe(true);
  });

  it('stops by itself when the physics stops calling', () => {
    const { fx, visible, run } = setup();
    run('earthquake', 1);
    for (let t = 0; t < 4; t += 1 / 60) fx.update(1 / 60);
    expect(visible()).toBe(0);
    expect(fx.shakeOffset.length()).toBe(0);
  });

  it('hail puffs appear only where stones land', () => {
    const { fx, visible, run } = setup();
    run('hail', 0.5);
    expect(visible()).toBe(0);
    fx.hailImpact(2, 0, -3);
    fx.update(1 / 60);
    expect(visible()).toBe(4);
  });
});
