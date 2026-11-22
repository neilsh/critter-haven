import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BuildController } from './BuildController';
import { AudioSynth, ProceduralAssets } from './ProceduralAssets';
import type { SceneManager } from './SceneManager';
import { ISLAND_SIZE, cornerToWorld, strutId } from '../types/blueprint';

function setup() {
  const dom = new EventTarget() as unknown as HTMLCanvasElement;
  (dom as any).getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
  const camera = new THREE.PerspectiveCamera(45, 800 / 600, 0.1, 200);
  camera.position.set(0, 25, 30);
  camera.lookAt(0, 3, 0);
  camera.updateMatrixWorld();
  const islandTop = new THREE.Mesh(new THREE.PlaneGeometry(ISLAND_SIZE, ISLAND_SIZE).rotateX(-Math.PI / 2));
  islandTop.updateMatrixWorld();
  let controls = true;
  const frame: Array<(dt: number) => void> = [];
  const scene = {
    scene: new THREE.Scene(),
    camera,
    buildRoot: new THREE.Group(),
    islandTop,
    domElement: dom,
    onFrame: (cb: (dt: number) => void) => (frame.push(cb), () => {}),
    setControlsEnabled: (e: boolean) => (controls = e),
  } as unknown as SceneManager;
  const bc = new BuildController(scene, new ProceduralAssets(), new AudioSynth());
  const fire = (type: string, x: number, y: number) => {
    const e = new Event(type) as any;
    e.clientX = x;
    e.clientY = y;
    e.button = 0;
    dom.dispatchEvent(e);
  };
  const screen = (p: [number, number, number]) => {
    const v = new THREE.Vector3(...p).project(camera);
    return [((v.x + 1) / 2) * 800, ((1 - v.y) / 2) * 600] as const;
  };
  return { bc, fire, screen, controls: () => controls, frame, scene };
}

describe('BuildController', () => {
  it('places, rejects, undoes and clears blocks', () => {
    const { bc } = setup();
    expect(bc.placeBlock([1, 0, 1], 'wood')).toBe(true);
    expect(bc.placeBlock([1, 0, 1], 'stone')).toBe(false);
    expect(bc.placeBlock([8, 0, 0], 'wood')).toBe(false);
    expect(bc.meshes.blocks.size).toBe(1);
    expect(bc.canUndo()).toBe(true);
    bc.clear();
    expect(bc.getGraph().blocks).toHaveLength(0);
    expect(bc.meshes.blocks.size).toBe(0);
    bc.undo();
    expect(bc.getGraph().blocks).toHaveLength(1);
    bc.undo();
    expect(bc.getGraph().blocks).toHaveLength(0);
    expect(bc.canUndo()).toBe(false);
  });

  it('validates struts and keeps the registry in sync', () => {
    const { bc } = setup();
    expect(bc.addStrut([0, 0, 0], [1, 2, 0], 'wood')).toBe(false); // top end unanchored
    bc.placeBlock([0, 0, 0], 'wood');
    bc.placeBlock([0, 1, 0], 'wood');
    expect(bc.addStrut([1, 0, 0], [0, 2, 0], 'bamboo')).toBe(true);
    expect(bc.addStrut([0, 2, 0], [1, 0, 0], 'bamboo')).toBe(false); // duplicate
    expect(bc.meshes.struts.has(strutId([1, 0, 0], [0, 2, 0]))).toBe(true);
    const m = bc.meshes.struts.get(strutId([1, 0, 0], [0, 2, 0]))!;
    expect(m.scale.y).toBeCloseTo(Math.hypot(2, 4));
  });

  it('listeners fire and resetMeshes restores transforms', () => {
    const { bc } = setup();
    let n = 0;
    bc.subscribe(() => n++);
    bc.placeBlock([2, 0, 2], 'stone');
    expect(n).toBe(1);
    const m = bc.meshes.blocks.get('b:2,0,2')!;
    m.position.y += 5;
    (m.material as THREE.MeshStandardMaterial).emissive.setHex(0xff0000);
    bc.resetMeshes();
    expect(m.position.y).toBe(1);
    expect((m.material as THREE.MeshStandardMaterial).emissive.getHex()).toBe(0);
  });

  it('loadPreset replaces the graph and clears history', () => {
    const { bc } = setup();
    bc.placeBlock([0, 0, 0], 'wood');
    bc.loadPreset('house');
    expect(bc.canUndo()).toBe(false);
    expect(bc.getGraph().blocks).toHaveLength(12);
    expect(bc.meshes.struts.size).toBe(8);
    bc.loadPreset('empty');
    expect(bc.meshes.blocks.size).toBe(0);
  });

  it('erasing a block drops struts that lose their anchor', () => {
    const { bc, fire, screen } = setup();
    bc.placeBlock([3, 0, 3], 'wood');
    bc.placeBlock([3, 1, 3], 'wood');
    bc.addStrut([4, 0, 3], [3, 2, 3], 'wood');
    bc.setTool('erase');
    const p = screen([-1, 3, -1]); // top block centre
    fire('pointerdown', p[0], p[1]);
    fire('pointerup', p[0], p[1]);
    expect(bc.getGraph().blocks.map((x) => x.id)).toEqual(['b:3,0,3']);
    expect(bc.getGraph().struts).toHaveLength(0);
  });

  it('pointer: click places a block with mirror, brace drag adds mirrored struts', () => {
    const { bc, fire, screen, controls } = setup();
    bc.setMirrorX(true);
    const [sx, sy] = screen([-6, 0, 0]); // island point, cell x=1,z=4
    fire('pointermove', sx, sy);
    fire('pointerdown', sx, sy);
    fire('pointerup', sx, sy);
    expect(bc.getGraph().blocks.map((b) => b.id).sort()).toEqual(['b:1,0,4', 'b:6,0,4']);

    bc.setTool('brace');
    const a = screen(cornerToWorld([1, 0, 4]));
    const b = screen(cornerToWorld([2, 1, 4]));
    fire('pointerdown', a[0], a[1]);
    expect(controls()).toBe(false);
    fire('pointermove', b[0], b[1]);
    fire('pointerup', b[0], b[1]);
    expect(controls()).toBe(true);
    expect(bc.getGraph().struts).toHaveLength(2);
    bc.undo();
    expect(bc.getGraph().struts).toHaveLength(0);
    expect(bc.getGraph().blocks).toHaveLength(2);
  });

  it('pointer erase and paint, disabled while simulating', () => {
    const { bc, fire, screen } = setup();
    bc.placeBlock([3, 0, 3], 'wood');
    const p = screen([-1, 1, -1]);
    bc.setTool('paint');
    bc.setMaterial('stone');
    bc.setEnabled(false);
    fire('pointerdown', p[0], p[1]);
    fire('pointerup', p[0], p[1]);
    expect(bc.getGraph().blocks[0].material).toBe('wood');
    bc.setEnabled(true);
    fire('pointerdown', p[0], p[1]);
    fire('pointerup', p[0], p[1]);
    expect(bc.getGraph().blocks[0].material).toBe('stone');
    bc.setTool('erase');
    fire('pointerdown', p[0], p[1]);
    fire('pointerup', p[0], p[1]);
    expect(bc.getGraph().blocks).toHaveLength(0);
  });
});
