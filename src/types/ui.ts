import type { Azimuth, DisasterType, GameMode, MaterialType, PresetName, ToolType } from './blueprint';

/** Everything the HUD renders. Written by the engine side, read by React. */
export interface UIState {
  tool: ToolType;
  material: MaterialType;
  mirrorX: boolean;
  disaster: DisasterType;
  mode: GameMode;
  /** Seconds left in the disaster countdown (DISASTER_SECONDS when idle). */
  timeRemaining: number;
  /** Id of the first piece that broke in the current run, for the HUD and highlight. */
  firstBrokenId: string | null;
  muted: boolean;
  canUndo: boolean;
  azimuth: Azimuth;
}

/** Everything the HUD can ask the engine to do. Implemented by `Game`. */
export interface GameActions {
  setTool(t: ToolType): void;
  setMaterial(m: MaterialType): void;
  setMirrorX(on: boolean): void;
  setDisaster(d: DisasterType): void;
  loadPreset(p: PresetName): void;
  undo(): void;
  clearIsland(): void;
  /** Starts the selected disaster, or rewinds if one is running/finished. */
  toggleDisaster(): void;
  setCameraAzimuth(deg: Azimuth): void;
  setMuted(muted: boolean): void;
}
