/**
 * First-person player & camera controller for walking inside the village on the island.
 * Headless-safe: works without a DOM/window in Vitest unit tests.
 */
import * as THREE from 'three';
import type { Vec3 } from '../types/blueprint';
import { CELL_SIZE, ISLAND_SIZE } from '../types/blueprint';

export const PLAYER_RADIUS = 0.45;
export const PLAYER_HEIGHT = 1.75;
export const EYE_HEIGHT = 1.55;
const MOVE_SPEED = 7.5;
const JUMP_SPEED = 8.2;
const ISLAND_HALF = ISLAND_SIZE / 2 + 1.0;
const HALF_BLOCK = CELL_SIZE / 2;
const LOOK_SENSITIVITY = 0.004;
const MAX_PITCH = Math.PI / 2 - 0.08;
const MAX_STEP_DT = 0.05;

const SPAWN_CANDIDATES: readonly Vec3[] = [
  [0, 0, 6.2],
  [6.2, 0, 0],
  [-6.2, 0, 0],
  [0, 0, -6.2],
  [6.5, 0, 6.5],
  [-6.5, 0, 6.5],
  [0, 0, 8.2],
];

function isTextInput(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export class FirstPersonController {
  readonly pos = new THREE.Vector3(0, 0, 6.2);
  vy = 0;
  yaw = 0;
  pitch = -0.08;
  grounded = true;

  private enabled = false;
  private readonly keys = new Set<string>();
  private dragPointerId: number | null = null;
  private lastPointer = { x: 0, y: 0 };
  private readonly cleanups: Array<() => void> = [];

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly dom: HTMLElement | null = null,
  ) {
    if (typeof window !== 'undefined') {
      const onKeyDown = (e: KeyboardEvent) => {
        if (!this.enabled || isTextInput(e.target)) return;
        if (
          e.code === 'Space' ||
          e.code === 'ArrowUp' ||
          e.code === 'ArrowDown' ||
          e.code === 'ArrowLeft' ||
          e.code === 'ArrowRight'
        ) {
          e.preventDefault();
        }
        this.keys.add(e.code);
      };
      const onKeyUp = (e: KeyboardEvent) => {
        this.keys.delete(e.code);
      };
      const onBlur = () => {
        this.keys.clear();
        this.dragPointerId = null;
      };
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', onBlur);
      this.cleanups.push(
        () => window.removeEventListener('keydown', onKeyDown),
        () => window.removeEventListener('keyup', onKeyUp),
        () => window.removeEventListener('blur', onBlur),
      );
    }

    if (dom && typeof dom.addEventListener === 'function') {
      const onPointerDown = (e: PointerEvent) => {
        if (!this.enabled || !e.isPrimary || e.button !== 0) return;
        this.dragPointerId = e.pointerId;
        this.lastPointer = { x: e.clientX, y: e.clientY };
        dom.setPointerCapture?.(e.pointerId);
      };
      const onPointerMove = (e: PointerEvent) => {
        if (!this.enabled || this.dragPointerId !== e.pointerId) return;
        const dx = e.clientX - this.lastPointer.x;
        const dy = e.clientY - this.lastPointer.y;
        this.lastPointer = { x: e.clientX, y: e.clientY };
        this.lookDelta(dx, dy);
      };
      const endDrag = (e: PointerEvent) => {
        if (this.dragPointerId !== e.pointerId) return;
        this.dragPointerId = null;
        if (dom.hasPointerCapture?.(e.pointerId)) dom.releasePointerCapture(e.pointerId);
      };
      dom.addEventListener('pointerdown', onPointerDown);
      dom.addEventListener('pointermove', onPointerMove);
      dom.addEventListener('pointerup', endDrag);
      dom.addEventListener('pointercancel', endDrag);
      this.cleanups.push(
        () => dom.removeEventListener('pointerdown', onPointerDown),
        () => dom.removeEventListener('pointermove', onPointerMove),
        () => dom.removeEventListener('pointerup', endDrag),
        () => dom.removeEventListener('pointercancel', endDrag),
      );
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) {
      this.keys.clear();
      this.dragPointerId = null;
    } else {
      this.syncCamera();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Programmatic key helper (useful for headless tests). */
  setKey(code: string, down: boolean): void {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }

  lookDelta(dx: number, dy: number): void {
    this.yaw -= dx * LOOK_SENSITIVITY;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - dy * LOOK_SENSITIVITY));
    if (this.enabled) this.syncCamera();
  }

  /** Places the player at a clear spot on the island facing the village center. */
  spawn(blocks: readonly Vec3[]): void {
    let chosen: Vec3 = SPAWN_CANDIDATES[SPAWN_CANDIDATES.length - 1] ?? [0, 0, 8.2];
    for (const c of SPAWN_CANDIDATES) {
      const blocked = blocks.some(
        ([bx, by, bz]) =>
          by - HALF_BLOCK < PLAYER_HEIGHT &&
          by + HALF_BLOCK > 0 &&
          Math.abs(c[0] - bx) < HALF_BLOCK + PLAYER_RADIUS &&
          Math.abs(c[2] - bz) < HALF_BLOCK + PLAYER_RADIUS,
      );
      if (!blocked) {
        chosen = c;
        break;
      }
    }
    this.pos.set(chosen[0], chosen[1], chosen[2]);
    this.vy = 0;
    this.grounded = true;
    this.yaw = Math.atan2(this.pos.x, this.pos.z);
    this.pitch = -0.08;
    this.syncCamera();
  }

  getFeetPosition(): Vec3 {
    return [this.pos.x, this.pos.y, this.pos.z];
  }

  update(dt: number, blockCenters: readonly Vec3[], gravity = 9.81): void {
    if (!this.enabled) return;
    const stepDt = Math.min(Math.max(dt, 0), MAX_STEP_DT);
    if (stepDt <= 0) {
      this.syncCamera();
      return;
    }

    const fwd =
      (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) -
      (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
    const strafe =
      (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
      (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);

    if (fwd !== 0 || strafe !== 0) {
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw);
      const rz = -Math.sin(this.yaw);
      let mx = fx * fwd + rx * strafe;
      let mz = fz * fwd + rz * strafe;
      const len = Math.hypot(mx, mz);
      if (len > 0) {
        mx /= len;
        mz /= len;
        this.pos.x += mx * MOVE_SPEED * stepDt;
        this.pos.z += mz * MOVE_SPEED * stepDt;
      }
    }

    // Horizontal AABB push-out against blocks overlapping the player's vertical span.
    for (const [bx, by, bz] of blockCenters) {
      if (this.pos.y + PLAYER_HEIGHT - 0.1 <= by - HALF_BLOCK || this.pos.y + 0.1 >= by + HALF_BLOCK) {
        continue;
      }
      const dx = this.pos.x - bx;
      const dz = this.pos.z - bz;
      const limit = HALF_BLOCK + PLAYER_RADIUS;
      const ox = limit - Math.abs(dx);
      const oz = limit - Math.abs(dz);
      if (ox > 0 && oz > 0) {
        if (ox < oz) this.pos.x += (dx >= 0 ? 1 : -1) * ox;
        else this.pos.z += (dz >= 0 ? 1 : -1) * oz;
      }
    }

    if (this.keys.has('Space') && this.grounded) {
      this.vy = JUMP_SPEED;
      this.grounded = false;
    }

    const prevY = this.pos.y;
    this.vy -= gravity * stepDt;
    this.pos.y += this.vy * stepDt;
    this.grounded = false;

    if (
      Math.abs(this.pos.x) <= ISLAND_HALF &&
      Math.abs(this.pos.z) <= ISLAND_HALF &&
      this.pos.y <= 0 &&
      prevY >= -0.35
    ) {
      this.pos.y = 0;
      this.vy = 0;
      this.grounded = true;
    }

    const footFootprint = HALF_BLOCK + PLAYER_RADIUS * 0.85;
    for (const [bx, by, bz] of blockCenters) {
      if (Math.abs(this.pos.x - bx) >= footFootprint || Math.abs(this.pos.z - bz) >= footFootprint) {
        continue;
      }
      const top = by + HALF_BLOCK;
      const bottom = by - HALF_BLOCK;
      if (this.vy <= 0 && prevY >= top - 0.35 && this.pos.y <= top) {
        this.pos.y = top;
        this.vy = 0;
        this.grounded = true;
      } else if (
        this.vy > 0 &&
        prevY + PLAYER_HEIGHT <= bottom + 0.35 &&
        this.pos.y + PLAYER_HEIGHT >= bottom
      ) {
        this.pos.y = bottom - PLAYER_HEIGHT;
        this.vy = 0;
      }
    }

    this.syncCamera();
  }

  syncCamera(): void {
    this.camera.position.set(this.pos.x, this.pos.y + EYE_HEIGHT, this.pos.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  dispose(): void {
    this.setEnabled(false);
    for (const off of this.cleanups) off();
    this.cleanups.length = 0;
    if (this.dom && this.dragPointerId !== null && this.dom.hasPointerCapture?.(this.dragPointerId)) {
      this.dom.releasePointerCapture(this.dragPointerId);
    }
  }
}
