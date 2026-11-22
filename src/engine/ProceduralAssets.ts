/**
 * OWNER: package D (textures, geometry, audio). Contract below is fixed; internals are yours.
 * Must not fetch any external file: textures come from CanvasTexture, sounds from Web Audio.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { MaterialType } from '../types/blueprint';
import { MATERIALS } from '../types/blueprint';

const BLOCK_SIZE = 1.96;
const BLOCK_RADIUS = 0.22;
const BLOCK_SEGMENTS = 4;
const STRUT_RADIUS = 0.15;
const TEXTURE_SIZE = 256;
const MASTER_VOLUME = 0.6;
/** One-shot sounds closer together than this are dropped, so a cascade of snaps stays a crackle. */
const MIN_ONE_SHOT_GAP = 0.04;

const ROUGHNESS: Record<MaterialType, number> = { wood: 0.7, stone: 0.9, bamboo: 0.5, foam: 0.85 };
const TEXTURE_SEEDS: Record<MaterialType, number> = { wood: 11, stone: 23, bamboo: 37, foam: 53 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Small deterministic PRNG so every texture looks identical on every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

type Painter = (g: CanvasRenderingContext2D, rnd: () => number, base: string) => void;

const PAINTERS: Record<MaterialType, Painter> = {
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
      g.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${(0.1 + rnd() * 0.2).toFixed(2)})` : `rgba(20,20,25,${(0.1 + rnd() * 0.25).toFixed(2)})`;
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
};

export class ProceduralAssets {
  private blockGeometry: THREE.BufferGeometry | null = null;
  private strutGeometry: THREE.BufferGeometry | null = null;
  private textures = new Map<MaterialType, THREE.CanvasTexture | null>();

  /** Rounded toy-block geometry, 2x2x2 world units minus a small gap. Shared; do not dispose per mesh. */
  getBlockGeometry(): THREE.BufferGeometry {
    if (!this.blockGeometry) this.blockGeometry = new RoundedBoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE, BLOCK_SEGMENTS, BLOCK_RADIUS);
    return this.blockGeometry;
  }

  /**
   * Strut geometry: radius ~0.15, length 1 along +Y, centred on the origin. Shared; callers scale
   * mesh.scale.y to the strut length and orient it between the two endpoints.
   */
  getStrutGeometry(): THREE.BufferGeometry {
    if (!this.strutGeometry) this.strutGeometry = new THREE.CylinderGeometry(STRUT_RADIUS, STRUT_RADIUS, 1, 12);
    return this.strutGeometry;
  }

  /**
   * A NEW material instance on every call (the physics X-ray tints each mesh's emissive separately).
   * Callers own and dispose the returned material. Textures may be shared and cached.
   */
  createMaterial(type: MaterialType): THREE.MeshStandardMaterial {
    const map = this.getTexture(type);
    return new THREE.MeshStandardMaterial({
      // With a painted map the hue lives in the texture, so the tint is white. Without a DOM
      // (e.g. Node tests) fall back to the flat material colour.
      color: map ? 0xffffff : MATERIALS[type].color,
      map,
      roughness: ROUGHNESS[type],
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
    PAINTERS[type](g, mulberry32(TEXTURE_SEEDS[type]), hex(MATERIALS[type].color));
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
  private rumble: { source: AudioBufferSourceNode; osc: OscillatorNode; filter: BiquadFilterNode; gain: GainNode } | null = null;

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

  private tone(type: OscillatorType, fromHz: number, toHz: number, duration: number, peak: number, delay = 0): void {
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
