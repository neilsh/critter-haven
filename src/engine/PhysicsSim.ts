/**
 * OWNER: package A (Rapier sim, disasters, X-ray, win state). Contract below is fixed; internals are yours.
 *
 * Rules from the spec: fixed 1/60 s accumulator with dt clamped to 0.05; joined bodies must have
 * contacts disabled; ground-level blocks get breakable anchors to the kinematic island body;
 * strain ratio > 1 removes the joint and records the FIRST broken id; survive 8 s with zero broken
 * joints to win. Initialise Rapier lazily on `start` (rapier3d-compat embeds its wasm, no fetch).
 *
 * Must be runnable headless in Node (Vitest) when given a `MeshRegistry` of plain objects, so the
 * tower-fails / house-survives calibration does not need a browser. Use a seeded RNG for gusts/hail.
 *
 * Lifecycle: start() -> mode 'simulating', isRunning() true. When the countdown reaches 0 the sim
 * stops stepping, isRunning() becomes false and mode becomes 'survived' (onSurvived fires) or
 * 'failed'; meshes stay where they ended up. stop() returns to mode 'build'. Calling start() while
 * running first stops the previous run.
 */
import type { BlueprintGraph, DisasterType, Telemetry } from '../types/blueprint';
import { DISASTER_SECONDS } from '../types/blueprint';
import type { MeshRegistry } from './BuildController';

export interface PhysicsEvents {
  /** id is the BlockData/StrutData id (or anchor-owning block id) whose joint broke. */
  onJointBreak?(id: string): void;
  onSurvived?(): void;
  /** For sound: 0..1 strength of the current disaster, called every step. */
  onIntensity?(disaster: DisasterType, intensity: number): void;
  onWaterLevel?(y: number): void;
}

export class PhysicsSim {
  constructor(private events: PhysicsEvents = {}) {}

  /** Build the Rapier world from the graph and begin the disaster. */
  async start(_graph: BlueprintGraph, _meshes: MeshRegistry, _disaster: DisasterType, _seed = 1): Promise<void> {
    void this.events;
  }

  /** Replace event handlers (Game wires these after construction). */
  setEvents(events: PhysicsEvents): void {
    this.events = events;
  }

  /** Advance by a real frame delta (seconds); internally fixed-steps. */
  update(_dtSeconds: number): void {}

  /** Destroy the Rapier world and reset the timer. The caller restores mesh transforms. */
  stop(): void {}

  isRunning(): boolean {
    return false;
  }

  getTelemetry(): Pick<Telemetry, 'mode' | 'timeRemaining' | 'activeJoints' | 'brokenJoints' | 'firstBrokenId' | 'waterLevel'> {
    return { mode: 'build', timeRemaining: DISASTER_SECONDS, activeJoints: 0, brokenJoints: 0, firstBrokenId: null, waterLevel: -2 };
  }
}
