import type { DisasterType, GameMode, MaterialType, PresetName, ToolType } from './blueprint';

/** Everything the HUD renders. Written by the engine side, read by React. */
export interface UIState {
  tool: ToolType;
  material: MaterialType;
  mirrorX: boolean;
  disaster: DisasterType;
  mode: GameMode;
  /** Seconds left in the disaster countdown (8 when idle). */
  timeRemaining: number;
  muted: boolean;
  canUndo: boolean;
  azimuth: 0 | 90 | 180 | 270;
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
  setCameraAzimuth(deg: 0 | 90 | 180 | 270): void;
  setMuted(muted: boolean): void;
}
