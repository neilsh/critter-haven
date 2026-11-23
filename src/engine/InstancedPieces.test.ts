import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { InstancedPieces, PieceHandle, patchInstanceEmissive } from './InstancedPieces';

const setup = () => {
  const root = new THREE.Group();
  const pieces = new InstancedPieces(root, new THREE.BoxGeometry(), () => new THREE.MeshStandardMaterial());
  return { root, pieces };
};

describe('InstancedPieces', () => {
  it('grows past its initial capacity and keeps every handle addressable', () => {
    const { root, pieces } = setup();
    const handles = Array.from({ length: 40 }, (_, i) => {
      const h = new PieceHandle();
      h.position.set(i, 0, 0);
      pieces.add(h, 'stone');
      return h;
    });
    pieces.flush();
    const [mesh] = root.children as THREE.InstancedMesh[];
    expect(root.children).toHaveLength(1);
    expect(mesh.count).toBe(40);
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(39, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).x).toBe(39);
    // Swap-remove keeps the rest in place.
    pieces.remove(handles[0]);
    pieces.flush();
    mesh.getMatrixAt(0, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).x).toBe(39);
    expect(pieces.handleAt({ object: mesh, instanceId: 0, distance: 0, point: new THREE.Vector3() })).toBe(
      handles[39],
    );
    pieces.dispose();
    expect(root.children).toHaveLength(0);
  });

  it('hides empty batches so they cost no draw call', () => {
    const { root, pieces } = setup();
    const h = new PieceHandle();
    pieces.add(h, 'wood');
    pieces.remove(h);
    expect(root.children[0].visible).toBe(false);
    expect(pieces.meshes()).toHaveLength(0);
  });

  it('routes the instance colour into emissive light, not the diffuse colour', () => {
    const mat = patchInstanceEmissive(new THREE.MeshStandardMaterial());
    const shader = {
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
      uniforms: {},
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    mat.onBeforeCompile(shader, undefined as never);
    expect(shader.fragmentShader).not.toContain('#include <color_fragment>');
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance += vColor.rgb;');
  });

  it('invalidates matching batches by recreating active materials and dropping empty ones', () => {
    const root = new THREE.Group();
    const created: THREE.MeshStandardMaterial[] = [];
    const pieces = new InstancedPieces(root, new THREE.BoxGeometry(), () => {
      const mat = new THREE.MeshStandardMaterial();
      created.push(mat);
      return mat;
    });
    const customHandle = new PieceHandle();
    const emptyCustomHandle = new PieceHandle();
    const builtinHandle = new PieceHandle();
    pieces.add(customHandle, 'mod:active');
    pieces.add(emptyCustomHandle, 'mod:empty');
    pieces.add(builtinHandle, 'wood');
    pieces.remove(emptyCustomHandle);

    const [activeMat, emptyMat, builtinMat] = created;
    let activeDisposed = 0;
    let emptyDisposed = 0;
    let builtinDisposed = 0;
    activeMat.dispose = () => {
      activeDisposed++;
    };
    emptyMat.dispose = () => {
      emptyDisposed++;
    };
    builtinMat.dispose = () => {
      builtinDisposed++;
    };

    pieces.invalidate((t) => t.startsWith('mod:'));

    expect(activeDisposed).toBe(1);
    expect(emptyDisposed).toBe(1);
    expect(builtinDisposed).toBe(0);
    expect(created).toHaveLength(4);
    expect(pieces.meshes().map((m) => m.name)).toEqual(['pieces:mod:active', 'pieces:wood']);
    const activeMesh = pieces.meshes().find((m) => m.name === 'pieces:mod:active')!;
    expect(activeMesh.material).toBe(created[3]);
    pieces.dispose();
  });
});
