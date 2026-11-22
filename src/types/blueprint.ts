/**
 * Pure, serializable blueprint data. No three.js, Rapier or React imports allowed here.
 *
 * Coordinate conventions (shared by every engine module):
 *  - A block occupies one integer "cell" (cx, cy, cz). Cells are CELL_SIZE (2) world units wide.
 *  - cx and cz run 0..GRID_CELLS-1 across the island; cy runs 0..MAX_HEIGHT_CELLS-1 upward.
 *  - The island is centred on the world origin, with its top surface at world y = 0.
 *  - Strut endpoints are integer "corner" lattice points (kx, ky, kz). A block at cell (cx, cy, cz)
 *    has its 8 corners at (cx..cx+1, cy..cy+1, cz..cz+1). Corner (0,0,0) is the island's -x/-z edge.
 *  - Spatial hash keys are the strings "x,y,z" (see `key`).
 */

export type Vec3 = [number, number, number];

export type MaterialType = 'wood' | 'stone' | 'bamboo' | 'foam';
export type DisasterType = 'earthquake' | 'hurricane' | 'flood' | 'hail';
export type ToolType = 'block' | 'brace' | 'paint' | 'erase';

export const CELL_SIZE = 2;
/** 16x16 world-unit build area = 8x8 cells. */
export const GRID_CELLS = 8;
export const MAX_HEIGHT_CELLS = 8;
export const ISLAND_SIZE = GRID_CELLS * CELL_SIZE;

export interface MaterialDef {
  id: MaterialType;
  label: string;
  /** Base colour (also used to paint the procedural texture). */
  color: number;
  /** Mass per unit volume, relative units. */
  density: number;
  /** Joint spring stiffness multiplier. */
  stiffness: number;
  /**
   * Break threshold. Strain ratio = joint stretch / (maxStress * STRAIN_UNIT).
   * Tuned by the physics package; the values here are starting points.
   */
  maxStress: number;
  /** 0 = sinks, 1 = neutrally buoyant, >1 floats. */
  buoyancy: number;
}

export const MATERIALS: Record<MaterialType, MaterialDef> = {
  wood: { id: 'wood', label: 'Wood', color: 0xc58b4c, density: 0.6, stiffness: 1.0, maxStress: 1.0, buoyancy: 1.3 },
  stone: { id: 'stone', label: 'Stone', color: 0x9aa0a8, density: 2.0, stiffness: 1.6, maxStress: 1.6, buoyancy: 0.0 },
  bamboo: { id: 'bamboo', label: 'Bamboo', color: 0x9ccc65, density: 0.45, stiffness: 0.7, maxStress: 1.3, buoyancy: 1.4 },
  foam: { id: 'foam', label: 'Foam', color: 0xf8bbd0, density: 0.15, stiffness: 0.3, maxStress: 0.5, buoyancy: 3.0 },
};

export const MATERIAL_ORDER: MaterialType[] = ['wood', 'stone', 'bamboo', 'foam'];
export const DISASTER_ORDER: DisasterType[] = ['earthquake', 'hurricane', 'flood', 'hail'];

export interface BlockData {
  /** Deterministic id: `b:cx,cy,cz` (see `blockId`). */
  id: string;
  cell: Vec3;
  material: MaterialType;
}

export interface StrutData {
  /** Deterministic id: `s:ax,ay,az-bx,by,bz` with endpoints sorted (see `strutId`). */
  id: string;
  a: Vec3;
  b: Vec3;
  material: MaterialType;
}

export interface BlueprintGraph {
  version: 1;
  blocks: BlockData[];
  struts: StrutData[];
}

export type PresetName = 'empty' | 'house' | 'tower';

// ---------------------------------------------------------------- helpers

export const key = (v: Vec3) => `${v[0]},${v[1]},${v[2]}`;
export const blockId = (cell: Vec3) => `b:${key(cell)}`;

export function strutId(a: Vec3, b: Vec3) {
  const [p, q] = key(a) <= key(b) ? [a, b] : [b, a];
  return `s:${key(p)}-${key(q)}`;
}

export const cellInBounds = (c: Vec3) =>
  c[0] >= 0 && c[0] < GRID_CELLS && c[2] >= 0 && c[2] < GRID_CELLS && c[1] >= 0 && c[1] < MAX_HEIGHT_CELLS;

export const cornerInBounds = (k: Vec3) =>
  k[0] >= 0 && k[0] <= GRID_CELLS && k[2] >= 0 && k[2] <= GRID_CELLS && k[1] >= 0 && k[1] <= MAX_HEIGHT_CELLS;

/** World-space centre of a cell. */
export function cellToWorld(c: Vec3): Vec3 {
  const half = ISLAND_SIZE / 2;
  return [c[0] * CELL_SIZE - half + CELL_SIZE / 2, c[1] * CELL_SIZE + CELL_SIZE / 2, c[2] * CELL_SIZE - half + CELL_SIZE / 2];
}

/** World-space position of a corner lattice point. */
export function cornerToWorld(k: Vec3): Vec3 {
  const half = ISLAND_SIZE / 2;
  return [k[0] * CELL_SIZE - half, k[1] * CELL_SIZE, k[2] * CELL_SIZE - half];
}

/** The 8 corner lattice points of a cell. */
export function cellCorners(c: Vec3): Vec3[] {
  const out: Vec3[] = [];
  for (const dx of [0, 1]) for (const dy of [0, 1]) for (const dz of [0, 1]) out.push([c[0] + dx, c[1] + dy, c[2] + dz]);
  return out;
}

export function emptyGraph(): BlueprintGraph {
  return { version: 1, blocks: [], struts: [] };
}

export const cloneGraph = (g: BlueprintGraph): BlueprintGraph => JSON.parse(JSON.stringify(g));

// ---------------------------------------------------------------- presets

function block(cx: number, cy: number, cz: number, material: MaterialType): BlockData {
  const cell: Vec3 = [cx, cy, cz];
  return { id: blockId(cell), cell, material };
}

function strut(a: Vec3, b: Vec3, material: MaterialType): StrutData {
  return { id: strutId(a, b), a, b, material };
}

/** Tall, narrow, unbraced 1x4x1 wood tower. Designed to fail in an earthquake. */
function towerPreset(): BlueprintGraph {
  return { version: 1, blocks: [0, 1, 2, 3].map((y) => block(3, y, 3, 'wood')), struts: [] };
}

/**
 * Compact 2x2x2 house: stone ground floor, wood upper floor, wood cap, and bamboo diagonal
 * cross-braces on all four walls. Designed to survive a standard earthquake.
 */
function housePreset(): BlueprintGraph {
  const blocks: BlockData[] = [];
  for (const x of [3, 4]) for (const z of [3, 4]) {
    blocks.push(block(x, 0, z, 'stone'));
    blocks.push(block(x, 1, z, 'wood'));
    blocks.push(block(x, 2, z, 'wood')); // capped top
  }
  const struts: StrutData[] = [];
  const [x0, x1, z0, z1, yTop] = [3, 5, 3, 5, 2];
  // z-facing walls
  for (const z of [z0, z1]) {
    struts.push(strut([x0, 0, z], [x1, yTop, z], 'bamboo'));
    struts.push(strut([x1, 0, z], [x0, yTop, z], 'bamboo'));
  }
  // x-facing walls
  for (const x of [x0, x1]) {
    struts.push(strut([x, 0, z0], [x, yTop, z1], 'bamboo'));
    struts.push(strut([x, 0, z1], [x, yTop, z0], 'bamboo'));
  }
  return { version: 1, blocks, struts };
}

export const PRESETS: Record<PresetName, () => BlueprintGraph> = {
  empty: emptyGraph,
  tower: towerPreset,
  house: housePreset,
};

// ---------------------------------------------------------------- telemetry & debug API

export type GameMode = 'build' | 'simulating' | 'survived';

export interface Telemetry {
  mode: GameMode;
  timeRemaining: number;
  blockCount: number;
  strutCount: number;
  activeJoints: number;
  brokenJoints: number;
  firstBrokenId: string | null;
  waterLevel: number;
}

export interface GameDebugApi {
  loadPreset(name: PresetName): void;
  placeBlock(x: number, y: number, z: number, material: MaterialType): void;
  addStrut(a: Vec3, b: Vec3, material: MaterialType): void;
  setCameraAzimuth(degrees: 0 | 90 | 180 | 270): void;
  startDisaster(type: DisasterType): void;
  rewind(): void;
  getTelemetry(): Telemetry;
}

declare global {
  interface Window {
    __GAME_DEBUG__?: GameDebugApi;
  }
}
