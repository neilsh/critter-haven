/**
 * OWNER: package C (build mode, tools, undo). Contract below is fixed; internals are yours.
 * Build mode renders directly from the BlueprintGraph with no physics. Every mesh gets its OWN
 * material instance from `assets.createMaterial` so the physics X-ray can tint meshes individually.
 * Graph changes must go through `commit`-style methods so undo history stays correct.
 */
import type * as THREE from 'three';
import type { BlueprintGraph, MaterialType, PresetName, ToolType, Vec3 } from '../types/blueprint';
import { emptyGraph } from '../types/blueprint';
import type { AudioSynth, ProceduralAssets } from './ProceduralAssets';
import type { SceneManager } from './SceneManager';

/**
 * Mesh lookup the physics sim uses to move/tint pieces. Keyed by BlockData.id / StrutData.id.
 * Meshes are direct children of `SceneManager.buildRoot`, so their position/quaternion are world
 * transforms. three.js core runs in Node, so headless tests can fill this with plain `new THREE.Mesh()`.
 */
export interface MeshRegistry {
  blocks: Map<string, THREE.Mesh>;
  struts: Map<string, THREE.Mesh>;
}

export class BuildController {
  readonly meshes: MeshRegistry = { blocks: new Map(), struts: new Map() };
  private graph: BlueprintGraph = emptyGraph();
  private listeners = new Set<() => void>();

  // oxlint-disable-next-line no-useless-constructor -- stub; package C implements this
  constructor(_scene: SceneManager, _assets: ProceduralAssets, _audio: AudioSynth) {}

  /** Current graph (treat as read-only). */
  getGraph(): BlueprintGraph {
    return this.graph;
  }

  /** Replace the graph (presets). Clears undo history. */
  loadPreset(_name: PresetName): void {}
  loadGraph(_g: BlueprintGraph): void {}

  /**
   * Programmatic edits (used by the debug API and tests). They ignore mirror mode, which applies only
   * to pointer tools, and return false when the edit is rejected (see validity rules in blueprint.ts).
   */
  placeBlock(_cell: Vec3, _material: MaterialType): boolean {
    return false;
  }
  addStrut(_a: Vec3, _b: Vec3, _material: MaterialType): boolean {
    return false;
  }

  setTool(_t: ToolType): void {}
  setMaterial(_m: MaterialType): void {}
  setMirrorX(_on: boolean): void {}
  undo(): void {}
  clear(): void {}
  canUndo(): boolean {
    return false;
  }

  /** Pointer tools are disabled while a disaster is running. */
  setEnabled(_enabled: boolean): void {}

  /** Snap every mesh back to its exact blueprint transform and clear tints (rewind). */
  resetMeshes(): void {}
  /** Pulsing red outline on the piece that broke first, or null to clear. */
  highlight(_id: string | null): void {}

  /** Called after any graph or mesh change. Returns unsubscribe. */
  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  dispose(): void {}
}
