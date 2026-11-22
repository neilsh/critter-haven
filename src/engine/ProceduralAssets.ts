/**
 * OWNER: package D (textures, geometry, audio). Contract below is fixed; internals are yours.
 * Must not fetch any external file: textures come from CanvasTexture, sounds from Web Audio.
 */
import * as THREE from 'three';
import type { MaterialType } from '../types/blueprint';

export class ProceduralAssets {
  /** Rounded toy-block geometry, 2x2x2 world units minus a small gap. Shared; do not dispose per mesh. */
  getBlockGeometry(): THREE.BufferGeometry {
    return new THREE.BoxGeometry(1.96, 1.96, 1.96);
  }

  /**
   * A NEW material instance on every call (the physics X-ray tints each mesh's emissive separately).
   * Callers own and dispose the returned material. Textures may be shared and cached.
   */
  createMaterial(type: MaterialType): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: type === 'stone' ? 0x9aa0a8 : 0xc58b4c });
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
