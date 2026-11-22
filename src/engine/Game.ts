/**
 * OWNER: integration (step 0 + final pass). Wires SceneManager, BuildController, PhysicsSim,
 * assets/audio and the UI store, and implements `GameActions` for the HUD.
 */
import type { DisasterType, MaterialType, PresetName, Telemetry, Vec3 } from '../types/blueprint';
import type { GameActions } from '../types/ui';
import { uiStore } from '../state/store';
import { BuildController } from './BuildController';
import { PhysicsSim } from './PhysicsSim';
import { AudioSynth, ProceduralAssets } from './ProceduralAssets';
import { SceneManager } from './SceneManager';

export class Game implements GameActions {
  readonly scene: SceneManager;
  readonly assets = new ProceduralAssets();
  readonly audio = new AudioSynth();
  readonly build: BuildController;
  readonly physics = new PhysicsSim();

  constructor(container: HTMLElement) {
    this.scene = new SceneManager(container);
    this.build = new BuildController(this.scene, this.assets, this.audio);
  }

  setTool: GameActions['setTool'] = (t) => {
    this.build.setTool(t);
    uiStore.setState({ tool: t });
  };
  setMaterial: GameActions['setMaterial'] = (m) => {
    this.build.setMaterial(m);
    uiStore.setState({ material: m });
  };
  setMirrorX: GameActions['setMirrorX'] = (on) => {
    this.build.setMirrorX(on);
    uiStore.setState({ mirrorX: on });
  };
  setDisaster: GameActions['setDisaster'] = (d) => uiStore.setState({ disaster: d });
  loadPreset: GameActions['loadPreset'] = (p: PresetName) => this.build.loadPreset(p);
  undo = () => this.build.undo();
  clearIsland = () => this.build.clear();
  toggleDisaster = () => {};
  setCameraAzimuth: GameActions['setCameraAzimuth'] = (deg) => {
    this.scene.setAzimuth(deg);
    uiStore.setState({ azimuth: deg });
  };
  setMuted: GameActions['setMuted'] = (muted) => {
    this.audio.setMuted(muted);
    uiStore.setState({ muted });
  };

  // Debug-API helpers (package F wires these to window.__GAME_DEBUG__)
  placeBlock(x: number, y: number, z: number, material: MaterialType) {
    this.build.placeBlock([x, y, z], material);
  }
  addStrut(a: Vec3, b: Vec3, material: MaterialType) {
    this.build.addStrut(a, b, material);
  }
  startDisaster(_type: DisasterType) {}
  rewind() {}
  getTelemetry(): Telemetry {
    const g = this.build.getGraph();
    return { ...this.physics.getTelemetry(), blockCount: g.blocks.length, strutCount: g.struts.length };
  }

  dispose() {
    this.build.dispose();
    this.scene.dispose();
    this.assets.dispose();
    this.audio.dispose();
  }
}
