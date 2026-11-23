/** Store for active and installed Minecraft-style mods. */
import { useSyncExternalStore } from 'react';
import { BUILTIN_MODS, cloneMod, resolveActiveMods, type GameMod, type ResolvedMods } from './mods';

export interface ModState {
  mods: GameMod[];
  active: ResolvedMods;
}

const initialMods = BUILTIN_MODS.map((m) => cloneMod(m));
const initial: ModState = {
  mods: initialMods,
  active: resolveActiveMods(initialMods),
};

class ModStore {
  private state: ModState = initial;
  private listeners = new Set<() => void>();

  getState = () => this.state;

  setMods(mods: GameMod[]) {
    this.state = { mods, active: resolveActiveMods(mods) };
    this.listeners.forEach((l) => l());
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
}

export const modStore = new ModStore();

export function useMods(): ModState {
  return useSyncExternalStore(modStore.subscribe, modStore.getState);
}
