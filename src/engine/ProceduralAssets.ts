/**
 * OWNER: package D (textures, geometry, audio). Contract below is fixed; internals are yours.
 * Must not fetch any external file: textures come from CanvasTexture, sounds from Web Audio.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { BuiltinMaterialType, MaterialDef, MaterialType } from '../types/blueprint';
import { getMaterialDef, isBuiltinMaterial } from '../types/blueprint';
import { intToHex } from '../utils/color';
import { mulberry32 } from '../utils/rng';

const BLOCK_SIZE = 1.96;
const BLOCK_RADIUS = 0.22;
/** Rounded-edge segments; 2 looks the same as 4 at play zoom with ~3x fewer triangles (300 vs 972). */
const BLOCK_SEGMENTS = 2;
const STRUT_RADIUS = 0.15;
const TEXTURE_SIZE = 256;
const MASTER_VOLUME = 0.6;
/** One-shot sounds closer together than this are dropped, so a cascade of snaps stays a crackle. */
const MIN_ONE_SHOT_GAP = 0.04;

const ROUGHNESS: Record<BuiltinMaterialType, number> = {
  wood: 0.7,
  stone: 0.9,
  bamboo: 0.5,
  foam: 0.85,
  door: 0.65,
  rubber: 0.85,
  anchor: 0.45,
  pontoon: 0.55,
  steel: 0.35,
  carbon: 0.35,
  shield: 0.25,
  titanium: 0.25,
  laser: 0.3,
  magnet: 0.35,
  diamond: 0.15,
};
const TEXTURE_SEEDS: Record<BuiltinMaterialType, number> = {
  wood: 11,
  stone: 23,
  bamboo: 37,
  foam: 53,
  door: 251,
  rubber: 139,
  anchor: 71,
  pontoon: 157,
  steel: 89,
  carbon: 173,
  shield: 103,
  titanium: 191,
  laser: 127,
  magnet: 211,
  diamond: 233,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Painter = (g: CanvasRenderingContext2D, rnd: () => number, base: string) => void;

const PAINTERS: Record<BuiltinMaterialType, Painter> = {
  wood(g, rnd, base) {
    const S = TEXTURE_SIZE;
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 44; i++) {
      const y0 = rnd() * S;
      const amp = 2 + rnd() * 4;
      const freq = 0.01 + rnd() * 0.02;
      g.strokeStyle = rnd() < 0.5 ? 'rgba(60,30,10,0.18)' : 'rgba(255,230,180,0.12)';
      g.lineWidth = 1 + rnd() * 1.5;
      g.beginPath();
      for (let x = 0; x <= S; x += 8) {
        const y = y0 + Math.sin(x * freq + i) * amp;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.fillStyle = 'rgba(40,20,5,0.35)';
    g.fillRect(0, S / 2 - 1, S, 2);
  },
  stone(g, rnd, base) {
    const S = TEXTURE_SIZE;
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) {
      g.fillStyle =
        rnd() < 0.5
          ? `rgba(255,255,255,${(0.1 + rnd() * 0.2).toFixed(2)})`
          : `rgba(20,20,25,${(0.1 + rnd() * 0.25).toFixed(2)})`;
      g.beginPath();
      g.arc(rnd() * S, rnd() * S, 0.5 + rnd() * 2.5, 0, Math.PI * 2);
      g.fill();
    }
  },
  bamboo(g, rnd, base) {
    const S = TEXTURE_SIZE;
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    for (let x = 0; x < S; x += 6) {
      g.fillStyle = `rgba(30,60,20,${(0.04 + rnd() * 0.08).toFixed(2)})`;
      g.fillRect(x, 0, 1 + rnd() * 2, S);
    }
    for (let y = S / 4; y < S; y += S / 4) {
      g.fillStyle = 'rgba(40,70,25,0.55)';
      g.fillRect(0, y - 3, S, 5);
      g.fillStyle = 'rgba(255,255,220,0.25)';
      g.fillRect(0, y + 2, S, 1);
    }
  },
  foam(g, rnd, base) {
    const S = TEXTURE_SIZE;
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 70; i++) {
      const r = 3 + rnd() * 9;
      const x = rnd() * S;
      const y = rnd() * S;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fillStyle = `rgba(255,255,255,${(0.2 + rnd() * 0.25).toFixed(2)})`;
      g.fill();
      g.strokeStyle = 'rgba(120,60,80,0.08)';
      g.lineWidth = 1;
      g.stroke();
    }
  },
  anchor(g, _rnd, base) {
    const S = TEXTURE_SIZE;
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(255,255,255,0.16)';
    g.lineWidth = 6;
    g.strokeRect(10, 10, S - 20, S - 20);
    // Hazard stripes along the base to signal heavy ground grip.
    g.fillStyle = '#fbbf24';
    g.fillRect(0, S - 42, S, 42);
    g.fillStyle = '#1e293b';
    for (let x = -40; x < S + 40; x += 36) {
      g.beginPath();
      g.moveTo(x, S);
      g.lineTo(x + 18, S);
      g.lineTo(x + 38, S - 42);
      g.lineTo(x + 20, S - 42);
      g.closePath();
      g.fill();
    }
    for (const [rx, ry] of [
      [26, 26],
      [S - 26, 26],
      [26, S - 62],
      [S - 26, S - 62],
    ]) {
      g.beginPath();
      g.arc(rx, ry, 7, 0, Math.PI * 2);
      g.fillStyle = '#cbd5e1';
      g.fill();
    }
  },
  steel(g, rnd, base) {
    const S = TEXTURE_SIZE;
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 60; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.1)';
      g.fillRect(0, rnd() * S, S, 1 + rnd() * 2);
    }
    g.strokeStyle = 'rgba(15,23,42,0.35)';
    g.lineWidth = 4;
    g.strokeRect(6, 6, S - 12, S - 12);
    g.beginPath();
    g.moveTo(6, S / 2);
    g.lineTo(S - 6, S / 2);
    g.stroke();
    for (const [rx, ry] of [
      [22, 22],
      [S - 22, 22],
      [22, S - 22],
      [S - 22, S - 22],
    ]) {
      g.beginPath();
      g.arc(rx, ry, 5, 0, Math.PI * 2);
      g.fillStyle = 'rgba(241,245,249,0.7)';
      g.fill();
    }
  },
  shield(g, _rnd, base) {
    const S = TEXTURE_SIZE;
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(12,74,110,0.38)';
    g.fillRect(14, 14, S - 28, S - 28);
    g.strokeStyle = '#bae6fd';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(S / 2, S / 2, 62, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 4;
    g.beginPath();
    g.arc(S / 2, S / 2, 34, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#e0f2fe';
    g.beginPath();
    g.arc(S / 2, S / 2, 14, 0, Math.PI * 2);
    g.fill();
  },
  laser(g, _rnd, base) {
    const S = TEXTURE_SIZE;
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(69,10,10,0.45)';
    g.fillRect(16, 16, S - 32, S - 32);
    g.strokeStyle = '#fecaca';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(S / 2, 24);
    g.lineTo(S / 2, S - 24);
    g.moveTo(24, S / 2);
    g.lineTo(S - 24, S / 2);
    g.stroke();
    g.fillStyle = '#fef08a';
    g.beginPath();
    g.arc(S / 2, S / 2, 26, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(S / 2, S / 2, 12, 0, Math.PI * 2);
    g.fill();
  },
  rubber(g, _rnd, base) {
    const S = TEXTURE_SIZE;
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(62,39,35,0.28)';
    g.lineWidth = 10;
    for (let i = -S; i < S * 2; i += 32) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + S * 0.45, S);
      g.stroke();
    }
    g.strokeStyle = 'rgba(255,255,255,0.16)';
    g.lineWidth = 4;
    g.strokeRect(10, 10, S - 20, S - 20);
  },
  pontoon(g, _rnd, base) {
    const S = TEXTURE_SIZE;
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    g.fillStyle = '#f97316';
    g.fillRect(0, 32, S, 36);
    g.fillRect(0, S - 68, S, 36);
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.fillRect(0, 46, S, 8);
    g.fillRect(0, S - 54, S, 8);
    for (const [rx, ry] of [
      [28, 18],
      [S - 28, 18],
      [28, S / 2],
      [S - 28, S / 2],
      [28, S - 18],
      [S - 28, S - 18],
    ]) {
      g.beginPath();
      g.arc(rx, ry, 5, 0, Math.PI * 2);
      g.fillStyle = '#78350f';
      g.fill();
    }
  },
  carbon(g, _rnd, base) {
    const S = TEXTURE_SIZE;
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    const step = 16;
    for (let y = 0; y < S; y += step) {
      for (let x = 0; x < S; x += step) {
        const even = ((x + y) / step) % 2 === 0;
        g.fillStyle = even ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.3)';
        g.fillRect(x, y, step - 1, step - 1);
        g.fillStyle = 'rgba(255,255,255,0.08)';
        g.fillRect(x + 2, y + 2, step / 2, 2);
      }
    }
    g.strokeStyle = 'rgba(226,232,240,0.22)';
    g.lineWidth = 4;
    g.strokeRect(6, 6, S - 12, S - 12);
  },
  titanium(g, rnd, base) {
    const S = TEXTURE_SIZE;
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 90; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.14)' : 'rgba(51,65,85,0.08)';
      g.fillRect(0, rnd() * S, S, 1 + rnd());
    }
    g.fillStyle = 'rgba(255,255,255,0.2)';
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(S * 0.65, 0);
    g.lineTo(0, S * 0.65);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(30,41,59,0.28)';
    g.lineWidth = 4;
    g.strokeRect(8, 8, S - 16, S - 16);
    g.beginPath();
    g.moveTo(S / 2, 8);
    g.lineTo(S / 2, S - 8);
    g.stroke();
  },
  magnet(g, _rnd, base) {
    const S = TEXTURE_SIZE;
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(49,16,96,0.35)';
    g.fillRect(18, 18, S - 36, S - 36);
    // Red and blue magnet poles flanking a bright purple coil.
    g.fillStyle = '#ef4444';
    g.fillRect(28, 48, 36, S - 96);
    g.fillStyle = '#3b82f6';
    g.fillRect(S - 64, 48, 36, S - 96);
    g.strokeStyle = '#e9d5ff';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(S / 2, S / 2, 34, 0, Math.PI * 2);
    g.stroke();
    for (const [rx, ry] of [
      [24, 24],
      [S - 24, 24],
      [24, S - 24],
      [S - 24, S - 24],
    ]) {
      g.beginPath();
      g.arc(rx, ry, 6, 0, Math.PI * 2);
      g.fillStyle = '#e2e8f0';
      g.fill();
    }
  },
  diamond(g, _rnd, base) {
    const S = TEXTURE_SIZE;
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    const half = S / 2;
    const facets: Array<{ pts: Array<[number, number]>; fill: string }> = [
      {
        pts: [
          [0, 0],
          [half, 0],
          [half, half],
        ],
        fill: 'rgba(255,255,255,0.34)',
      },
      {
        pts: [
          [half, 0],
          [S, 0],
          [half, half],
        ],
        fill: 'rgba(255,255,255,0.16)',
      },
      {
        pts: [
          [0, 0],
          [half, half],
          [0, S],
        ],
        fill: 'rgba(14,116,144,0.18)',
      },
      {
        pts: [
          [S, 0],
          [S, S],
          [half, half],
        ],
        fill: 'rgba(21,94,117,0.28)',
      },
      {
        pts: [
          [0, S],
          [half, half],
          [S, S],
        ],
        fill: 'rgba(165,243,252,0.28)',
      },
    ];
    for (const f of facets) {
      g.fillStyle = f.fill;
      g.beginPath();
      g.moveTo(f.pts[0][0], f.pts[0][1]);
      for (let i = 1; i < f.pts.length; i++) g.lineTo(f.pts[i][0], f.pts[i][1]);
      g.closePath();
      g.fill();
    }
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 3;
    g.strokeRect(S * 0.25, S * 0.25, S * 0.5, S * 0.5);
    for (const [sx, sy] of [
      [S * 0.28, S * 0.28],
      [S * 0.72, S * 0.34],
      [S * 0.5, S * 0.5],
    ]) {
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(sx, sy, 6, 0, Math.PI * 2);
      g.fill();
    }
  },
  door(g, _rnd, base) {
    const S = TEXTURE_SIZE;
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    // Darker outer frame
    g.strokeStyle = 'rgba(55,30,12,0.55)';
    g.lineWidth = 14;
    g.strokeRect(7, 7, S - 14, S - 14);
    // Upper and lower recessed door panels
    g.fillStyle = 'rgba(55,30,12,0.22)';
    g.fillRect(36, 28, S - 72, S * 0.34);
    g.fillRect(36, S * 0.54, S - 72, S * 0.34);
    g.strokeStyle = 'rgba(255,235,205,0.22)';
    g.lineWidth = 3;
    g.strokeRect(36, 28, S - 72, S * 0.34);
    g.strokeRect(36, S * 0.54, S - 72, S * 0.34);
    // Golden brass doorknob on the right side
    g.fillStyle = '#fbbf24';
    g.beginPath();
    g.arc(S - 38, S * 0.52, 12, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#78350f';
    g.lineWidth = 2;
    g.stroke();
  },
};

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function paintCustomTexture(g: CanvasRenderingContext2D, def: MaterialDef) {
  const S = TEXTURE_SIZE;
  const rnd = mulberry32(hashString(def.id));
  g.fillStyle = intToHex(def.color);
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 120; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.1)';
    g.fillRect(rnd() * S, rnd() * S, 4 + rnd() * 14, 4 + rnd() * 14);
  }
  g.strokeStyle = 'rgba(255,255,255,0.22)';
  g.lineWidth = 8;
  g.strokeRect(8, 8, S - 16, S - 16);
  if (def.special === 'shield') {
    g.strokeStyle = '#e0f2fe';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(S / 2, S / 2, 54, 0, Math.PI * 2);
    g.stroke();
  } else if (def.special === 'laser') {
    g.strokeStyle = '#fef08a';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(S / 2, 28);
    g.lineTo(S / 2, S - 28);
    g.moveTo(28, S / 2);
    g.lineTo(S - 28, S / 2);
    g.stroke();
  } else if (def.anchorMultiplier && def.anchorMultiplier > 1) {
    g.fillStyle = '#fbbf24';
    g.fillRect(0, S - 32, S, 32);
  }
}

export class ProceduralAssets {
  private blockGeometry: THREE.BufferGeometry | null = null;
  private strutGeometry: THREE.BufferGeometry | null = null;
  private textures = new Map<MaterialType, THREE.CanvasTexture | null>();
  private customDefs = new Map<string, MaterialDef>();

  /** Registers active mod material definitions so custom blocks paint with their configured look. */
  setCustomMaterials(defs: ReadonlyMap<string, MaterialDef>): void {
    for (const [k, tex] of this.textures) {
      if (!isBuiltinMaterial(k)) {
        tex?.dispose();
        this.textures.delete(k);
      }
    }
    this.customDefs = new Map(defs);
  }

  /** Rounded toy-block geometry, 2x2x2 world units minus a small gap. Shared; do not dispose per mesh. */
  getBlockGeometry(): THREE.BufferGeometry {
    if (!this.blockGeometry)
      this.blockGeometry = new RoundedBoxGeometry(
        BLOCK_SIZE,
        BLOCK_SIZE,
        BLOCK_SIZE,
        BLOCK_SEGMENTS,
        BLOCK_RADIUS,
      );
    return this.blockGeometry;
  }

  /**
   * Strut geometry: radius ~0.15, length 1 along +Y, centred on the origin. Shared; callers scale
   * mesh.scale.y to the strut length and orient it between the two endpoints.
   */
  getStrutGeometry(): THREE.BufferGeometry {
    if (!this.strutGeometry)
      this.strutGeometry = new THREE.CylinderGeometry(STRUT_RADIUS, STRUT_RADIUS, 1, 12);
    return this.strutGeometry;
  }

  /**
   * A NEW material instance on every call; callers own and dispose it. Textures are shared and cached.
   * BuildController asks for one per material type and piece kind and draws every piece of that type
   * through it with instancing (per-piece X-ray tints are instance colours, see InstancedPieces).
   */
  createMaterial(type: MaterialType): THREE.MeshStandardMaterial {
    const map = this.getTexture(type);
    const def = getMaterialDef(type, this.customDefs);
    return new THREE.MeshStandardMaterial({
      // With a painted map the hue lives in the texture, so the tint is white. Without a DOM
      // (e.g. Node tests) fall back to the flat material colour.
      color: map ? 0xffffff : def.color,
      map,
      roughness: isBuiltinMaterial(type) ? ROUGHNESS[type] : 0.45,
    });
  }

  private getTexture(type: MaterialType): THREE.CanvasTexture | null {
    if (!this.textures.has(type)) this.textures.set(type, this.paintTexture(type));
    return this.textures.get(type) ?? null;
  }

  private paintTexture(type: MaterialType): THREE.CanvasTexture | null {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE_SIZE;
    canvas.height = TEXTURE_SIZE;
    const g = canvas.getContext('2d');
    if (!g) return null;
    const def = getMaterialDef(type, this.customDefs);
    if (isBuiltinMaterial(type)) {
      PAINTERS[type](g, mulberry32(TEXTURE_SEEDS[type]), intToHex(def.color));
    } else {
      paintCustomTexture(g, def);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    return tex;
  }

  dispose(): void {
    this.blockGeometry?.dispose();
    this.strutGeometry?.dispose();
    this.blockGeometry = null;
    this.strutGeometry = null;
    for (const tex of this.textures.values()) tex?.dispose();
    this.textures.clear();
  }
}

type Ready = { ctx: AudioContext; master: GainNode };

export class AudioSynth {
  private muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private wind: { source: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private lastOneShot = new Map<string, number>();
  private rumble: {
    source: AudioBufferSourceNode;
    osc: OscillatorNode;
    filter: BiquadFilterNode;
    gain: GainNode;
  } | null = null;

  /** Call from a user gesture; browsers keep the AudioContext suspended until then. */
  resume(): void {
    const ctx = this.getContext();
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, this.ctx.currentTime, 0.05);
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  playClack(): void {
    if (!this.allowOneShot('clack')) return;
    this.noiseHit('bandpass', 2200, 3, 0.05, 0.5);
    this.tone('sine', 900, 500, 0.03, 0.15);
  }

  playBraceStretch(): void {
    if (!this.allowOneShot('stretch')) return;
    this.tone('sawtooth', 180, 320, 0.3, 0.08);
    this.noiseHit('bandpass', 900, 1.5, 0.25, 0.12);
  }

  playJointSnap(): void {
    if (!this.allowOneShot('snap')) return;
    this.noiseHit('highpass', 2500, 1, 0.08, 0.7);
    this.tone('square', 320, 110, 0.12, 0.18);
  }

  /** intensity 0..1 */
  playWind(intensity: number): void {
    const v = clamp(intensity, 0, 1);
    // Loops follow the latest intensity even while muted (the master bus handles muting), so a
    // playWind(0) sent while muted still stops the loop and it does not come back on unmute.
    if (!this.wind && (v === 0 || this.muted)) return;
    const ready = this.bus();
    if (!ready) return;
    if (!this.wind) {
      const { ctx, master } = ready;
      const source = ctx.createBufferSource();
      source.buffer = this.noiseBuffer(ctx);
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 0.7;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(master);
      source.start();
      this.wind = { source, filter, gain };
    }
    const t = ready.ctx.currentTime;
    this.wind.gain.gain.setTargetAtTime(v * 0.35, t, 0.15);
    this.wind.filter.frequency.setTargetAtTime(300 + v * 1200, t, 0.2);
  }

  /** intensity 0..1 */
  playRumble(intensity: number): void {
    const v = clamp(intensity, 0, 1);
    // Loops follow the latest intensity even while muted (the master bus handles muting), so a
    // playRumble(0) sent while muted still stops the loop and it does not come back on unmute.
    if (!this.rumble && (v === 0 || this.muted)) return;
    const ready = this.bus();
    if (!ready) return;
    if (!this.rumble) {
      const { ctx, master } = ready;
      const source = ctx.createBufferSource();
      source.buffer = this.noiseBuffer(ctx);
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 0.5;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 40;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain);
      osc.connect(gain);
      gain.connect(master);
      source.start();
      osc.start();
      this.rumble = { source, osc, filter, gain };
    }
    const t = ready.ctx.currentTime;
    this.rumble.gain.gain.setTargetAtTime(v * 0.6, t, 0.2);
    this.rumble.filter.frequency.setTargetAtTime(80 + v * 120, t, 0.2);
    this.rumble.osc.frequency.setTargetAtTime(35 + v * 15, t, 0.2);
  }

  playVictory(): void {
    if (!this.allowOneShot('victory')) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => this.tone('triangle', f, f * 1.005, 0.5, 0.25, i * 0.13));
  }

  playLaserZap(): void {
    if (!this.allowOneShot('laser')) return;
    this.tone('sawtooth', 1400, 340, 0.09, 0.2);
    this.tone('sine', 2100, 620, 0.07, 0.12);
  }

  playUnlock(): void {
    if (!this.allowOneShot('unlock')) return;
    const notes = [587.33, 783.99, 1046.5];
    notes.forEach((f, i) => this.tone('triangle', f, f * 1.01, 0.25, 0.22, i * 0.08));
  }

  playHit(): void {
    if (!this.allowOneShot('hit')) return;
    this.noiseHit('lowpass', 750, 1.2, 0.12, 0.65);
    this.tone('sawtooth', 190, 75, 0.14, 0.25);
  }

  playKO(): void {
    if (!this.allowOneShot('ko')) return;
    const notes = [392, 311.13, 220];
    notes.forEach((f, i) => this.tone('sawtooth', f, f * 0.88, 0.24, 0.24, i * 0.1));
  }

  dispose(): void {
    for (const node of [this.wind, this.rumble]) {
      if (!node) continue;
      try {
        node.source.stop();
      } catch {
        // already stopped
      }
    }
    if (this.rumble) {
      try {
        this.rumble.osc.stop();
      } catch {
        // already stopped
      }
    }
    this.wind = null;
    this.rumble = null;
    this.master = null;
    this.noise = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }

  // ------------------------------------------------------------ internals

  private getContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === 'undefined') return null;
    const w = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : MASTER_VOLUME;
    master.connect(ctx.destination);
    this.ctx = ctx;
    this.master = master;
    return ctx;
  }

  /** Context and output bus for a one-shot, or null when there is no audio or the sound is muted. */
  private ready(): Ready | null {
    if (this.muted) return null;
    return this.bus();
  }

  /** Context and output bus regardless of mute, or null when there is no Web Audio. */
  private bus(): Ready | null {
    const ctx = this.getContext();
    if (!ctx || !this.master) return null;
    return { ctx, master: this.master };
  }

  private allowOneShot(key: string): boolean {
    const ctx = this.ctx;
    if (this.muted || !ctx) return !this.muted;
    const last = this.lastOneShot.get(key) ?? -Infinity;
    if (ctx.currentTime - last < MIN_ONE_SHOT_GAP) return false;
    this.lastOneShot.set(key, ctx.currentTime);
    return true;
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.noise) {
      const length = ctx.sampleRate * 2;
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buffer;
    }
    return this.noise;
  }

  private noiseHit(filter: BiquadFilterType, freq: number, q: number, duration: number, peak: number): void {
    const ready = this.ready();
    if (!ready) return;
    const { ctx, master } = ready;
    const t = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer(ctx);
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    source.connect(f).connect(g).connect(master);
    source.start(t);
    source.stop(t + duration + 0.02);
  }

  private tone(
    type: OscillatorType,
    fromHz: number,
    toHz: number,
    duration: number,
    peak: number,
    delay = 0,
  ): void {
    const ready = this.ready();
    if (!ready) return;
    const { ctx, master } = ready;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(fromHz, t);
    osc.frequency.exponentialRampToValueAtTime(toHz, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }
}
