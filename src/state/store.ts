import { useSyncExternalStore } from 'react';
import { BASE_MATERIALS, BASE_PRESETS, DEFAULT_STRENGTH, DISASTER_SECONDS } from '../types/blueprint';
import type { UIState } from '../types/ui';

type Listener = () => void;

/** Tiny subscribable store: the only bridge between the engine and React. */
class UIStore {
  private state: UIState = {
    playMode: 'creative',
    menuOpen: true,
    hasStarted: false,
    survivalWave: 1,
    survivalBestWave: 0,
    survivalOver: false,
    survivalFailReason: null,
    survivalLastReward: 0,
    tool: 'block',
    material: 'wood',
    mirrorX: false,
    disaster: 'earthquake',
    strength: DEFAULT_STRENGTH,
    mode: 'build',
    timeRemaining: DISASTER_SECONDS,
    standingRatio: 1,
    stars: 0,
    standingHistory: [],
    levelId: null,
    unlocked: [],
    points: 0,
    unlockedMaterials: [...BASE_MATERIALS],
    unlockedPresets: [...BASE_PRESETS],
    unlockedGear: [],
    equippedArmor: null,
    equippedWeapon: null,
    firstBrokenId: null,
    muted: false,
    canUndo: false,
    azimuth: 0,
    firstPerson: true,
    gamepadConnected: false,
    playerHp: 100,
    playerMaxHp: 100,
    damageFlash: 0,
  };
  private listeners = new Set<Listener>();

  getState = () => this.state;

  setState(patch: Partial<UIState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
}

export const uiStore = new UIStore();

export function useUIState(): UIState;
export function useUIState<T>(selector: (state: UIState) => T): T;
export function useUIState<T>(selector?: (state: UIState) => T): UIState | T {
  return useSyncExternalStore<UIState | T>(
    uiStore.subscribe,
    selector ? () => selector(uiStore.getState()) : uiStore.getState,
  );
}
