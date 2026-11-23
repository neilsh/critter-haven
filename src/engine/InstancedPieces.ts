/**
 * Instanced rendering for blocks and struts: one `THREE.InstancedMesh` per geometry + material type,
 * so a full island costs a handful of draw calls instead of one (plus one shadow pass) per piece.
 *
 * Game code never touches the instanced meshes. Each piece is a `PieceHandle`, a plain object with a
 * world pose and an emissive tint (the same fields a `THREE.Mesh` + `MeshStandardMaterial` pair had,
 * so the physics sim and its headless tests can drive it without a renderer). `flush()` copies every
 * handle into the instance buffers; BuildController calls it right before each render.
 *
 * Per-instance emissive: the stress X-ray and the first-broken highlight are written to the
 * InstancedMesh's `instanceColor`, and `patchInstanceEmissive` routes that colour into emissive light
 * instead of three's default diffuse multiply, so the painted textures keep their own colours.
 */
import * as THREE from 'three';
import type { MaterialType } from '../types/blueprint';

/** One block or strut as the renderer sees it. Pose is in `SceneManager.buildRoot` (world) space. */
export class PieceHandle {
  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  readonly scale = new THREE.Vector3(1, 1, 1);
  /** Emitted light is `emissive * emissiveIntensity`, as on a MeshStandardMaterial. */
  readonly emissive = new THREE.Color(0x000000);
  emissiveIntensity = 1;
}

const COLOR_FRAGMENT = '#include <color_fragment>';
const EMISSIVE_FRAGMENT = '#include <emissivemap_fragment>';

/**
 * Makes a material treat the per-instance colour as added emissive light rather than a diffuse tint.
 * Throws if three's shader chunks no longer have the hooks it relies on, so an upgrade fails loudly.
 */
export function patchInstanceEmissive<M extends THREE.MeshStandardMaterial>(material: M): M {
  material.onBeforeCompile = (shader) => {
    // The fragment stage only sees USE_COLOR (three defines it for instance colours); these
    // materials never use vertex colours, so there it always means the instance colour.
    if (!shader.fragmentShader.includes(COLOR_FRAGMENT) || !shader.fragmentShader.includes(EMISSIVE_FRAGMENT))
      throw new Error('InstancedPieces: three.js shader chunks changed; update patchInstanceEmissive');
    shader.fragmentShader = shader.fragmentShader
      .replace(COLOR_FRAGMENT, '')
      .replace(
        EMISSIVE_FRAGMENT,
        `${EMISSIVE_FRAGMENT}\n#ifdef USE_COLOR\n\ttotalEmissiveRadiance += vColor.rgb;\n#endif`,
      );
  };
  material.customProgramCacheKey = () => 'instance-emissive';
  return material;
}

interface Batch {
  mesh: THREE.InstancedMesh;
  material: THREE.MeshStandardMaterial;
  handles: PieceHandle[];
}

const MIN_CAPACITY = 16;
const tmpMatrix = new THREE.Matrix4();
const tmpColor = new THREE.Color();

/** All pieces of one geometry (blocks, or struts), batched by material type. */
export class InstancedPieces {
  private readonly batches = new Map<MaterialType, Batch>();
  private readonly slots = new Map<PieceHandle, { type: MaterialType; batch: Batch; index: number }>();

  constructor(
    private readonly root: THREE.Object3D,
    private readonly geometry: THREE.BufferGeometry,
    private readonly createMaterial: (type: MaterialType) => THREE.MeshStandardMaterial,
  ) {}

  add(handle: PieceHandle, type: MaterialType): void {
    if (this.slots.has(handle)) this.remove(handle);
    const batch = this.reserve(type);
    this.slots.set(handle, { type, batch, index: batch.handles.length });
    batch.handles.push(handle);
    this.syncCount(batch);
  }

  /** Swap-remove: the last instance of the batch takes the freed slot. */
  remove(handle: PieceHandle): void {
    const slot = this.slots.get(handle);
    if (!slot) return;
    this.slots.delete(handle);
    const { batch } = slot;
    const last = batch.handles.pop();
    const lastSlot = last && this.slots.get(last);
    if (last && lastSlot && last !== handle) {
      batch.handles[slot.index] = last;
      lastSlot.index = slot.index;
    }
    this.syncCount(batch);
  }

  /** Material type a handle is drawn with, or undefined when it is not in this set. */
  typeOf(handle: PieceHandle): MaterialType | undefined {
    return this.slots.get(handle)?.type;
  }

  /** The handle a raycast hit on one of `meshes()` belongs to. */
  handleAt(hit: THREE.Intersection): PieceHandle | null {
    if (hit.instanceId === undefined) return null;
    for (const b of this.batches.values())
      if (b.mesh === hit.object) return b.handles[hit.instanceId] ?? null;
    return null;
  }

  /** Instanced meshes that currently draw something (for raycasting). */
  meshes(): THREE.InstancedMesh[] {
    return [...this.batches.values()].filter((b) => b.handles.length > 0).map((b) => b.mesh);
  }

  /** Copy every handle's pose and tint into the instance buffers. */
  flush(): void {
    for (const { mesh, handles } of this.batches.values()) {
      if (!handles.length) continue;
      for (let i = 0; i < handles.length; i++) {
        const h = handles[i];
        mesh.setMatrixAt(i, tmpMatrix.compose(h.position, h.quaternion, h.scale));
        mesh.setColorAt(i, tmpColor.copy(h.emissive).multiplyScalar(h.emissiveIntensity));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      // Pieces move during a disaster: recompute bounds lazily for culling and raycasts.
      mesh.boundingSphere = null;
      mesh.boundingBox = null;
    }
  }

  dispose(): void {
    for (const { mesh, material } of this.batches.values()) {
      this.root.remove(mesh);
      material.dispose();
      mesh.dispose();
    }
    this.batches.clear();
    this.slots.clear();
  }

  /** Rebuilds or drops cached material batches matching `predicate` (e.g. after mod textures refresh). */
  invalidate(predicate: (type: MaterialType) => boolean): void {
    for (const [type, batch] of this.batches) {
      if (!predicate(type)) continue;
      if (batch.handles.length === 0) {
        this.root.remove(batch.mesh);
        batch.material.dispose();
        batch.mesh.dispose();
        this.batches.delete(type);
      } else {
        const nextMat = patchInstanceEmissive(this.createMaterial(type));
        batch.material.dispose();
        batch.material = nextMat;
        batch.mesh.material = nextMat;
      }
    }
  }

  /** The batch for `type`, grown so it has room for one more instance. */
  private reserve(type: MaterialType): Batch {
    let batch = this.batches.get(type);
    if (!batch) {
      const material = patchInstanceEmissive(this.createMaterial(type));
      batch = { mesh: this.createMesh(type, material, MIN_CAPACITY), material, handles: [] };
      this.batches.set(type, batch);
    } else if (batch.handles.length >= batch.mesh.instanceMatrix.count) {
      const old = batch.mesh;
      batch.mesh = this.createMesh(type, batch.material, old.instanceMatrix.count * 2);
      this.root.remove(old);
      old.dispose();
    }
    return batch;
  }

  private createMesh(
    type: MaterialType,
    material: THREE.MeshStandardMaterial,
    capacity: number,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Creating the colour buffer up front means the shader is compiled once, with instance colours on.
    mesh.setColorAt(0, tmpColor.setRGB(0, 0, 0));
    mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.visible = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `pieces:${type}`;
    this.root.add(mesh);
    return mesh;
  }

  private syncCount(batch: Batch): void {
    batch.mesh.count = batch.handles.length;
    // An empty batch would still cost a draw call per pass.
    batch.mesh.visible = batch.handles.length > 0;
  }
}
