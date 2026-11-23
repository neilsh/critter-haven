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
import {
  DEFAULT_STRENGTH,
  DISASTER_SECONDS,
  cellToWorld,
  emptyGraph,
  isBuiltinDisaster,
  isBuiltinMaterial,
} from '../types/blueprint';
import { uiStore } from '../state/store';
import { modStore } from '../mods/modStore';
import { loadMods, parseImportedMod, saveMods, type GameMod } from '../mods/mods';
import { buildHeight, isMaterialAllowed } from '../levels/constraints';
import { levelStore } from '../levels/levelStore';
import { LEVELS, getLevel } from '../levels/levels';
import {
  computeAvailablePoints,
  computeUnlocked,
  loadBest,
  loadUnlockedMaterials,
  recordResult,
  saveBest,
  saveUnlockedMaterials,
  tryUnlockMaterial,
} from '../levels/progress';
import { BuildController } from './BuildController';
import { FirstPersonController } from './FirstPersonController';
import { PHYSICS_TUNING, PhysicsSim, type SimOptions } from './PhysicsSim';
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
  readonly firstPerson: FirstPersonController;
  readonly physics = new PhysicsSim();

  /** Incremented on every start/rewind so a slow async start cannot resurrect a cancelled run. */
  private runToken = 0;
  private currentRunDuration = DISASTER_SECONDS;
  private openModals = 0;
  private cleanups: Array<() => void> = [];

  constructor(container: HTMLElement) {
    this.scene = new SceneManager(container);
    this.build = new BuildController(this.scene, this.assets, this.audio);
    this.firstPerson = new FirstPersonController(this.scene.camera, this.scene.domElement);

    const mods = loadMods();
    modStore.setMods(mods);
    this.assets.setCustomMaterials(modStore.getState().active.blockMap);

    this.physics.setEffectsRoot(this.scene.scene);
    this.physics.setEvents({
      onJointBreak: (id) => {
        this.audio.playJointSnap();
        if (this.physics.getTelemetry().firstBrokenId === id) this.build.highlight(id);
      },
      onSurvived: () => this.audio.playVictory(),
      onIntensity: (disaster, intensity) => {
        const customD =
          uiStore.getState().levelId === null
            ? modStore.getState().active.disasterMap.get(disaster)
            : undefined;
        const customMeta = customD
          ? { color: customD.color, quake: Boolean(customD.quake), wind: Boolean(customD.wind) }
          : undefined;
        this.scene.setDisasterFx(disaster, intensity, customMeta);
        if (
          disaster === 'hurricane' ||
          disaster === 'fire_tornado' ||
          disaster === 'snow_storm' ||
          customD?.wind
        ) {
          this.audio.playWind(intensity);
        }
        if (disaster === 'earthquake' || disaster === 'meteor' || customD?.quake) {
          this.audio.playRumble(intensity);
        }
      },
      onWaterLevel: (y) => this.scene.setWaterLevel(y),
      onProjectileImpact: (kind, x, y, z) => this.scene.projectileImpact(kind, x, y, z),
      onLaserFire: (from, to) => {
        this.scene.laserBeam(from, to);
        this.audio.playLaserZap();
      },
    });

    const best = loadBest(LEVELS);
    const unlockedMaterials = loadUnlockedMaterials();
    levelStore.setState({ best });
    uiStore.setState({
      unlocked: computeUnlocked(LEVELS, best),
      unlockedMaterials,
      points: computeAvailablePoints(LEVELS, best, unlockedMaterials),
    });

    this.cleanups.push(
      this.scene.onFrame((dt) => this.tick(dt)),
      this.build.subscribe(() => {
        const g = this.build.getGraph();
        uiStore.setState({ canUndo: this.build.canUndo() });
        levelStore.setState({ blocksUsed: g.blocks.length, height: buildHeight(g) });
      }),
    );
  }

  private lastMode: Telemetry['mode'] = 'build';

  /** On the frame a level run finishes, records its stars and unlocks the next level. */
  private recordLevelResult(mode: Telemetry['mode'], stars: Telemetry['stars']) {
    const finished = mode === 'survived' || mode === 'failed';
    const justFinished = finished && this.lastMode === 'simulating';
    this.lastMode = mode;
    const levelId = uiStore.getState().levelId;
    if (!justFinished || !levelId) return;
    const out = recordResult(LEVELS, levelStore.getState().best, levelId, stars);
    saveBest(out.best);
    levelStore.setState({ best: out.best, justUnlocked: out.newlyUnlocked });
    const unlockedMaterials = uiStore.getState().unlockedMaterials;
    uiStore.setState({
      unlocked: computeUnlocked(LEVELS, out.best),
      points: computeAvailablePoints(LEVELS, out.best, unlockedMaterials),
    });
  }

  private currentBlockCenters(): Vec3[] {
    if (uiStore.getState().mode !== 'build') {
      const live = this.physics.getBlockPositions();
      if (live.length > 0 || this.build.getGraph().blocks.length === 0) return live;
    }
    return this.build.getGraph().blocks.map((b) => cellToWorld(b.cell));
  }

  private tick(dt: number) {
    if (this.physics.isRunning()) this.physics.update(dt);
    if (uiStore.getState().firstPerson) {
      const gravity =
        uiStore.getState().levelId === null
          ? PHYSICS_TUNING.gravity * modStore.getState().active.gravityMultiplier
          : PHYSICS_TUNING.gravity;
      const centers = this.currentBlockCenters();
      this.firstPerson.update(dt, centers, gravity);
      if (this.physics.isRunning()) {
        const hit = this.physics.checkPlayerDamage(this.firstPerson.getFeetPosition(), dt);
        if (hit.damage > 0) {
          const s0 = uiStore.getState();
          const nextHp = Math.max(0, s0.playerHp - hit.damage);
          if (nextHp <= 0) {
            this.audio.playKO();
            levelStore.setState({ notice: `${hit.cause ?? 'Knocked out!'} Restarting...` });
            uiStore.setState({ playerHp: s0.playerMaxHp, damageFlash: s0.damageFlash + 1 });
            this.rewind();
            this.firstPerson.spawn(this.currentBlockCenters());
            return;
          }
          uiStore.setState({
            playerHp: nextHp,
            ...(hit.impact ? { damageFlash: s0.damageFlash + 1 } : {}),
          });
          if (hit.impact) this.audio.playHit();
        }
      }
    }
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
    this.recordLevelResult(t.mode, t.stars);
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
    const elapsed = this.currentRunDuration - timeRemaining;
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
    if (isBuiltinMaterial(m)) {
      if (!uiStore.getState().unlockedMaterials.includes(m)) {
        levelStore.setState({ notice: 'Unlock this in the Shop first!' });
        return;
      }
      if (!isMaterialAllowed(this.build.getConstraints(), m)) {
        levelStore.setState({ notice: 'This level does not have that material.' });
        return;
      }
    } else if (uiStore.getState().levelId !== null || !modStore.getState().active.blockMap.has(m)) {
      levelStore.setState({ notice: 'Enable this mod in Free Build to use it.' });
      return;
    }
    levelStore.setState({ notice: null });
    this.build.setMaterial(m);
    uiStore.setState({ material: m });
  };
  private applyMods(next: GameMod[]) {
    saveMods(next);
    modStore.setMods(next);
    const { active } = modStore.getState();
    this.assets.setCustomMaterials(active.blockMap);
    this.build.refreshCustomMaterials();
    const { material, disaster } = uiStore.getState();
    if (!isBuiltinMaterial(material) && !active.blockMap.has(material)) {
      this.build.setMaterial('wood');
      uiStore.setState({ material: 'wood' });
    }
    if (!isBuiltinDisaster(disaster) && !active.disasterMap.has(disaster)) {
      uiStore.setState({ disaster: 'earthquake' });
    }
  }
  toggleMod: GameActions['toggleMod'] = (id) => {
    this.ensureBuildMode();
    const next: GameMod[] = [];
    for (const m of modStore.getState().mods) {
      next.push(m.id === id ? Object.assign({}, m, { enabled: !m.enabled }) : m);
    }
    this.applyMods(next);
  };
  saveMod: GameActions['saveMod'] = (mod) => {
    this.ensureBuildMode();
    const mods = modStore.getState().mods;
    const exists = mods.some((m) => m.id === mod.id);
    const clean: GameMod = { ...mod, builtIn: false };
    const next = exists ? mods.map((m) => (m.id === mod.id ? clean : m)) : [...mods, clean];
    this.applyMods(next);
  };
  deleteMod: GameActions['deleteMod'] = (id) => {
    this.ensureBuildMode();
    const next = modStore.getState().mods.filter((m) => m.builtIn || m.id !== id);
    this.applyMods(next);
  };
  importMod: GameActions['importMod'] = (json) => {
    this.ensureBuildMode();
    const mods = modStore.getState().mods;
    const parsed = parseImportedMod(json, new Set(mods.map((m) => m.id)));
    if (!parsed.ok) return parsed;
    this.applyMods([...mods, parsed.mod]);
    return { ok: true };
  };
  unlockMaterial: GameActions['unlockMaterial'] = (m) => {
    const best = levelStore.getState().best;
    const res = tryUnlockMaterial(LEVELS, best, uiStore.getState().unlockedMaterials, m);
    if (!res.ok) return false;
    saveUnlockedMaterials(res.unlocked);
    uiStore.setState({
      unlockedMaterials: res.unlocked,
      points: computeAvailablePoints(LEVELS, best, res.unlocked),
    });
    this.audio.resume();
    this.audio.playUnlock();
    return true;
  };
  setMirrorX: GameActions['setMirrorX'] = (on) => {
    this.build.setMirrorX(on);
    uiStore.setState({ mirrorX: on });
  };
  setDisaster: GameActions['setDisaster'] = (d) => {
    if (this.lockedByLevel()) return;
    uiStore.setState({ disaster: d });
  };
  setStrength: GameActions['setStrength'] = (s) => {
    if (this.lockedByLevel()) return;
    uiStore.setState({ strength: s });
  };

  /** Disaster and strength are fixed while a challenge level is active. */
  private lockedByLevel(): boolean {
    if (uiStore.getState().levelId === null) return false;
    levelStore.setState({ notice: 'This level has its own disaster. Leave the level to pick another.' });
    return true;
  }

  /** Starts a challenge level (fresh island, its limits, disaster and strength) or free build with null. */
  selectLevel: GameActions['selectLevel'] = (id) => {
    this.ensureBuildMode();
    const level = id ? getLevel(id) : undefined;
    if (level && !uiStore.getState().unlocked.includes(level.id)) return;
    levelStore.setState({ notice: null, justUnlocked: null });
    if (!level) {
      this.build.setConstraints(null);
      uiStore.setState({ levelId: null });
      return;
    }
    this.build.setConstraints(null);
    this.build.loadGraph(level.start?.() ?? emptyGraph());
    this.build.setConstraints(level.constraints ?? null);
    const allowed = level.constraints?.materials;
    const { material } = uiStore.getState();
    const first = allowed?.[0];
    if (first && !allowed.includes(material)) this.setMaterial(first);
    else if (!isBuiltinMaterial(material)) this.setMaterial('wood');
    uiStore.setState({ levelId: level.id, disaster: level.disaster, strength: level.strength });
  };
  loadPreset: GameActions['loadPreset'] = (p: PresetName) => {
    // Presets would bypass the level's block and material limits, so they are free-build only.
    if (uiStore.getState().levelId !== null) {
      levelStore.setState({ notice: 'Starter builds are for free build. Leave the level to use them.' });
      return;
    }
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
    const { mode, disaster, strength, levelId } = uiStore.getState();
    if (mode !== 'build') {
      this.rewind();
      return;
    }
    const level = levelId ? getLevel(levelId) : undefined;
    if (level?.minHeight && buildHeight(this.build.getGraph()) < level.minHeight) {
      levelStore.setState({ notice: `Build at least ${level.minHeight} blocks tall first!` });
      return;
    }
    levelStore.setState({ notice: null });
    if (level) void this.startDisaster(level.disaster, level.seed ?? 1, level.strength);
    else void this.startDisaster(disaster, 1, strength);
  };
  setCameraAzimuth: GameActions['setCameraAzimuth'] = (deg) => {
    if (uiStore.getState().firstPerson) this.setFirstPerson(false);
    this.scene.setAzimuth(deg);
    uiStore.setState({ azimuth: deg });
  };
  setFirstPerson: GameActions['setFirstPerson'] = (on) => {
    const prev = uiStore.getState().firstPerson;
    if (prev === on) return;
    if (on) {
      this.scene.setOrbitMode(false);
      this.build.setEnabled(false);
      this.firstPerson.spawn(this.currentBlockCenters());
      this.firstPerson.setEnabled(true);
      uiStore.setState({ firstPerson: true, playerHp: uiStore.getState().playerMaxHp });
    } else {
      this.firstPerson.setEnabled(false);
      this.scene.setOrbitMode(true);
      this.build.setEnabled(uiStore.getState().mode === 'build');
      uiStore.setState({ firstPerson: false, playerHp: uiStore.getState().playerMaxHp });
    }
  };
  setMuted: GameActions['setMuted'] = (muted) => {
    this.audio.setMuted(muted);
    uiStore.setState({ muted });
  };
  setModalOpen: GameActions['setModalOpen'] = (open) => {
    this.openModals = Math.max(0, this.openModals + (open ? 1 : -1));
    this.firstPerson.setInputPaused(this.openModals > 0);
  };

  // ------------------------------------------------------------ disaster lifecycle (also debug API)

  async startDisaster(type: DisasterType, seed = 1, strength: Strength = DEFAULT_STRENGTH): Promise<void> {
    this.ensureBuildMode();
    const token = ++this.runToken;
    uiStore.setState({ disaster: type, strength, playerHp: uiStore.getState().playerMaxHp });
    this.build.setEnabled(false);
    let options: SimOptions | undefined;
    if (uiStore.getState().levelId === null) {
      const active = modStore.getState().active;
      options = {
        customMaterials: active.blockMap,
        customDisaster: active.disasterMap.get(type),
        gravityMultiplier: active.gravityMultiplier,
        durationSeconds: active.durationSeconds,
      };
    }
    this.currentRunDuration = options?.durationSeconds ?? DISASTER_SECONDS;
    await this.physics.start(this.build.getGraph(), this.build.meshes, type, seed, strength, options);
    if (token !== this.runToken) this.physics.stop(); // rewound while Rapier was loading
  }

  rewind(): void {
    this.runToken++;
    this.physics.stop();
    this.build.resetMeshes();
    this.build.highlight(null);
    const fp = uiStore.getState().firstPerson;
    this.build.setEnabled(!fp);
    uiStore.setState({ playerHp: uiStore.getState().playerMaxHp });
    if (fp && this.firstPerson.getFeetPosition()[1] < -2) {
      this.firstPerson.spawn(this.currentBlockCenters());
    }
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
  advance(seconds: number): Telemetry {
    // Feed the sim in frame-sized slices through tick(), so standing samples and level results are
    // recorded exactly as during real frames. Fixed steps make the outcome independent of slicing.
    let left = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    while (left > 1e-9 && this.physics.isRunning()) {
      const dt = Math.min(left, PHYSICS_TUNING.maxFrameDt);
      this.tick(dt);
      left -= dt;
    }
    return this.getTelemetry();
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
    this.firstPerson.dispose();
    this.build.dispose();
    this.scene.dispose();
    this.assets.dispose();
    this.audio.dispose();
  }
}
