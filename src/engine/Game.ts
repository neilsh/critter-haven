/**
 * OWNER: integration (step 0 + final pass). Wires SceneManager, BuildController, PhysicsSim,
 * assets/audio and the UI store, and implements `GameActions` for the HUD.
 *
 * Packages A-D should not edit this file; it already calls every contract method, so a package
 * works end to end as soon as its stub is filled in. Flow:
 *  - toggleDisaster: build mode -> startDisaster, otherwise -> rewind.
 *  - Each frame: physics.update(dt) while running, then telemetry is mirrored into the UI store.
 *  - Editing actions (preset, undo, clear) rewind first if a disaster is running or finished.
 */
import type {
  BlueprintGraph,
  DisasterType,
  GameDebugApi,
  MaterialType,
  PresetName,
  Strength,
  Telemetry,
  Vec3,
} from '../types/blueprint';
import type { GameActions } from '../types/ui';
import { DEFAULT_STRENGTH, DISASTER_SECONDS } from '../types/blueprint';
import { uiStore } from '../state/store';
import { getLevel } from '../levels/levels';
import { BuildController } from './BuildController';
import { PhysicsSim } from './PhysicsSim';
import { AudioSynth, ProceduralAssets } from './ProceduralAssets';
import { SceneManager } from './SceneManager';

/** Flood plane level when no flood is running (hidden below -1). */
const WATER_HIDDEN = -2;

/** Implements GameDebugApi too, so package F can expose `window.__GAME_DEBUG__ = game` directly. */
export class Game implements GameActions, GameDebugApi {
  readonly scene: SceneManager;
  readonly assets = new ProceduralAssets();
  readonly audio = new AudioSynth();
  readonly build: BuildController;
  readonly physics = new PhysicsSim();

  /** Incremented on every start/rewind so a slow async start cannot resurrect a cancelled run. */
  private runToken = 0;
  private cleanups: Array<() => void> = [];

  constructor(container: HTMLElement) {
    this.scene = new SceneManager(container);
    this.build = new BuildController(this.scene, this.assets, this.audio);

    this.physics.setEffectsRoot(this.scene.scene);
    this.physics.setEvents({
      onJointBreak: (id) => {
        this.audio.playJointSnap();
        if (this.physics.getTelemetry().firstBrokenId === id) this.build.highlight(id);
      },
      onSurvived: () => this.audio.playVictory(),
      onIntensity: (disaster, intensity) => {
        this.scene.setDisasterFx(disaster, intensity);
        if (disaster === 'hurricane') this.audio.playWind(intensity);
        else if (disaster === 'earthquake') this.audio.playRumble(intensity);
      },
      onWaterLevel: (y) => this.scene.setWaterLevel(y),
      onHailImpact: (x, y, z) => this.scene.hailImpact(x, y, z),
    });

    this.cleanups.push(
      this.scene.onFrame((dt) => this.tick(dt)),
      this.build.subscribe(() => uiStore.setState({ canUndo: this.build.canUndo() })),
    );
  }

  private tick(dt: number) {
    if (this.physics.isRunning()) this.physics.update(dt);
    const t = this.physics.getTelemetry();
    const s = uiStore.getState();
    if (
      s.mode !== t.mode ||
      s.timeRemaining !== t.timeRemaining ||
      s.firstBrokenId !== t.firstBrokenId ||
      s.standingRatio !== t.standingRatio ||
      s.stars !== t.stars
    ) {
      uiStore.setState({
        mode: t.mode,
        timeRemaining: t.timeRemaining,
        firstBrokenId: t.firstBrokenId,
        standingRatio: t.standingRatio,
        stars: t.stars,
      });
    }
    this.sampleStanding(t.mode, t.timeRemaining, t.standingRatio);
  }

  /** Elapsed run seconds at the last `standingHistory` sample (null before the first sample of a run). */
  private lastSampleElapsed: number | null = null;
  private static readonly SAMPLE_EVERY = 0.25;

  /** Appends standingRatio to `standingHistory` every 0.25 s of a run, plus once when it ends. */
  private sampleStanding(mode: Telemetry['mode'], timeRemaining: number, standingRatio: number) {
    const history = uiStore.getState().standingHistory;
    if (mode === 'build') {
      if (history.length > 0) uiStore.setState({ standingHistory: [] });
      this.lastSampleElapsed = null;
      return;
    }
    const elapsed = DISASTER_SECONDS - timeRemaining;
    const due =
      this.lastSampleElapsed === null || elapsed - this.lastSampleElapsed >= Game.SAMPLE_EVERY - 1e-9;
    const finalSample = mode !== 'simulating' && this.lastSampleElapsed !== elapsed;
    if (due || finalSample) {
      this.lastSampleElapsed = elapsed;
      uiStore.setState({ standingHistory: [...history, standingRatio] });
    }
  }

  private ensureBuildMode() {
    if (uiStore.getState().mode !== 'build' || this.physics.isRunning()) this.rewind();
  }

  // ------------------------------------------------------------ GameActions (HUD)

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
  setStrength: GameActions['setStrength'] = (s) => uiStore.setState({ strength: s });
  /** CONTRACT STUB: the level thread loads the level's build, constraints, disaster and strength. */
  selectLevel: GameActions['selectLevel'] = (id) => {
    this.ensureBuildMode();
    const level = id ? getLevel(id) : undefined;
    this.build.setConstraints(level?.constraints ?? null);
    uiStore.setState({ levelId: level ? level.id : null });
  };
  loadPreset: GameActions['loadPreset'] = (p: PresetName) => {
    this.ensureBuildMode();
    this.build.loadPreset(p);
  };
  undo = () => {
    this.ensureBuildMode();
    this.build.undo();
  };
  clearIsland = () => {
    this.ensureBuildMode();
    this.build.clear();
  };
  toggleDisaster = () => {
    this.audio.resume();
    const { mode, disaster, strength } = uiStore.getState();
    if (mode === 'build') void this.startDisaster(disaster, 1, strength);
    else this.rewind();
  };
  setCameraAzimuth: GameActions['setCameraAzimuth'] = (deg) => {
    this.scene.setAzimuth(deg);
    uiStore.setState({ azimuth: deg });
  };
  setMuted: GameActions['setMuted'] = (muted) => {
    this.audio.setMuted(muted);
    uiStore.setState({ muted });
  };

  // ------------------------------------------------------------ disaster lifecycle (also debug API)

  async startDisaster(type: DisasterType, seed = 1, strength: Strength = DEFAULT_STRENGTH): Promise<void> {
    this.ensureBuildMode();
    const token = ++this.runToken;
    uiStore.setState({ disaster: type, strength });
    this.build.setEnabled(false);
    await this.physics.start(this.build.getGraph(), this.build.meshes, type, seed, strength);
    if (token !== this.runToken) this.physics.stop(); // rewound while Rapier was loading
  }

  rewind(): void {
    this.runToken++;
    this.physics.stop();
    this.build.resetMeshes();
    this.build.highlight(null);
    this.build.setEnabled(true);
    this.scene.setWaterLevel(WATER_HIDDEN);
    this.audio.playWind(0);
    this.audio.playRumble(0);
    this.scene.setDisasterFx(uiStore.getState().disaster, 0);
    this.tick(0);
  }

  // ------------------------------------------------------------ debug-API helpers (package F wires these)

  placeBlock(x: number, y: number, z: number, material: MaterialType): boolean {
    this.ensureBuildMode();
    return this.build.placeBlock([x, y, z], material);
  }
  addStrut(a: Vec3, b: Vec3, material: MaterialType): boolean {
    this.ensureBuildMode();
    return this.build.addStrut(a, b, material);
  }
  getGraph(): BlueprintGraph {
    return this.build.getGraph();
  }
  getTelemetry(): Telemetry {
    const g = this.build.getGraph();
    return {
      ...this.physics.getTelemetry(),
      strength: uiStore.getState().strength,
      blockCount: g.blocks.length,
      strutCount: g.struts.length,
    };
  }

  dispose() {
    this.runToken++;
    this.physics.stop();
    this.cleanups.forEach((c) => c());
    this.build.dispose();
    this.scene.dispose();
    this.assets.dispose();
    this.audio.dispose();
  }
}
