import { useSyncExternalStore } from 'react';
import type { UIState } from '../types/ui';

type Listener = () => void;

/** Tiny subscribable store: the only bridge between the engine and React. */
class UIStore {
  private state: UIState = {
    tool: 'block',
    material: 'wood',
    mirrorX: false,
    disaster: 'earthquake',
    mode: 'build',
    timeRemaining: 8,
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
    return () => this.listeners.delete(l);
  };
}

export const uiStore = new UIStore();

export function useUIState(): UIState {
  return useSyncExternalStore(uiStore.subscribe, uiStore.getState);
}
