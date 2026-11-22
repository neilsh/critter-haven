/**
 * OWNER: package B (renderer, island, lights, camera). Contract below is fixed; internals are yours.
 * Frame loop: SceneManager owns requestAnimationFrame and calls registered callbacks with the raw
 * frame delta in seconds. It must dispose all WebGL resources in `dispose()`.
 */
import * as THREE from 'three';
import type { Azimuth, Vec3 } from '../types/blueprint';
import { ISLAND_SIZE } from '../types/blueprint';

export class SceneManager {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  /** Parent group for blocks and struts, so everything can be cleared in one place. */
  readonly buildRoot = new THREE.Group();
  /** Flat top face of the island (y = 0). Raycast against this for placing on the ground. */
  readonly islandTop = new THREE.Mesh(
    new THREE.PlaneGeometry(ISLAND_SIZE, ISLAND_SIZE).rotateX(-Math.PI / 2),
  );
  readonly domElement: HTMLCanvasElement;

  constructor(container: HTMLElement) {
    this.domElement = document.createElement('canvas');
    container.appendChild(this.domElement);
    this.scene.add(this.buildRoot, this.islandTop);
  }

  /** Register a per-frame callback. Returns an unsubscribe function. */
  onFrame(_cb: (dtSeconds: number) => void): () => void {
    return () => {};
  }

  /** Smoothly tween the camera azimuth around the island centre (see `Azimuth` for directions). */
  setAzimuth(_degrees: Azimuth): void {}

  /** Enable/disable OrbitControls (disabled while the player drags a brace, for example). */
  setControlsEnabled(_enabled: boolean): void {}

  /** Level of the animated flood plane (world y). Hidden when below -1. */
  setWaterLevel(_y: number): void {}

  /** World position the ground-anchored kinematic body should be seeded from (island centre). */
  islandCenter(): Vec3 {
    return [0, 0, 0];
  }

  dispose(): void {
    this.domElement.remove();
  }
}
