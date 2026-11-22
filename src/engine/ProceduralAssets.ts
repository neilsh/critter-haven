/**
 * OWNER: package D (textures, geometry, audio). Contract below is fixed; internals are yours.
 * Must not fetch any external file: textures come from CanvasTexture, sounds from Web Audio.
 */
import * as THREE from 'three';
import type { MaterialType } from '../types/blueprint';
import { MATERIALS } from '../types/blueprint';

export class ProceduralAssets {
  /** Rounded toy-block geometry, 2x2x2 world units minus a small gap. Shared; do not dispose per mesh. */
  getBlockGeometry(): THREE.BufferGeometry {
    return new THREE.BoxGeometry(1.96, 1.96, 1.96);
  }

  /**
   * Strut geometry: radius ~0.15, length 1 along +Y, centred on the origin. Shared; callers scale
   * mesh.scale.y to the strut length and orient it between the two endpoints.
   */
  getStrutGeometry(): THREE.BufferGeometry {
    return new THREE.CylinderGeometry(0.15, 0.15, 1, 8);
  }

  /**
   * A NEW material instance on every call (the physics X-ray tints each mesh's emissive separately).
   * Callers own and dispose the returned material. Textures may be shared and cached.
   */
  createMaterial(type: MaterialType): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: MATERIALS[type].color });
  }

  dispose(): void {}
}

export class AudioSynth {
  private muted = false;

  /** Call from a user gesture; browsers keep the AudioContext suspended until then. */
  resume(): void {}
  setMuted(muted: boolean): void {
    this.muted = muted;
  }
  isMuted(): boolean {
    return this.muted;
  }
  playClack(): void {}
  playBraceStretch(): void {}
  playJointSnap(): void {}
  /** intensity 0..1 */
  playWind(_intensity: number): void {}
  /** intensity 0..1 */
  playRumble(_intensity: number): void {}
  playVictory(): void {}
  dispose(): void {}
}
