/** Level-only UI state that does not belong in the shared UIState contract. */
import { useSyncExternalStore } from 'react';
import type { BestStars } from './progress';

export interface LevelInfo {
  /** Blocks currently on the island. */
  blocksUsed: number;
  /** Layers tall the current build is. */
  height: number;
  /** Best stars earned per level id. */
  best: BestStars;
  /** Id of the level opened by the latest run, shown once as "Next level unlocked". */
  justUnlocked: string | null;
  /** Short kid-friendly hint about a refused action; null when there is nothing to say. */
  notice: string | null;
}

const initial: LevelInfo = { blocksUsed: 0, height: 0, best: {}, justUnlocked: null, notice: null };

class LevelStore {
  private state: LevelInfo = initial;
  private listeners = new Set<() => void>();

  getState = () => this.state;

  setState(patch: Partial<LevelInfo>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
}

export const levelStore = new LevelStore();

export function useLevelInfo(): LevelInfo {
  return useSyncExternalStore(levelStore.subscribe, levelStore.getState);
}
