import { useSyncExternalStore } from 'react';
import { DEFAULT_STRENGTH, DISASTER_SECONDS } from '../types/blueprint';
import type { UIState } from '../types/ui';

type Listener = () => void;

/** Tiny subscribable store: the only bridge between the engine and React. */
class UIStore {
  private state: UIState = {
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
    firstBrokenId: null,
    muted: false,
    canUndo: false,
    azimuth: 0,
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

export function useUIState(): UIState {
  return useSyncExternalStore(uiStore.subscribe, uiStore.getState);
}
