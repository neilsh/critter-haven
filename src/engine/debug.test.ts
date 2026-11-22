import { afterEach, describe, expect, it } from 'vitest';
import type { GameDebugApi } from '../types/blueprint';
import { installDebugApi } from './debug';

const fakeGame = {} as GameDebugApi;

function stubWindow(search: string) {
  (globalThis as { window?: unknown }).window = {
    location: { search },
    __GAME_DEBUG__: undefined,
  };
  return globalThis.window as { __GAME_DEBUG__?: GameDebugApi };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('installDebugApi', () => {
  it('publishes the game on window in dev and removes it on cleanup', () => {
    const win = stubWindow('');
    const cleanup = installDebugApi(fakeGame);
    expect(win.__GAME_DEBUG__).toBe(fakeGame);
    cleanup();
    expect(win.__GAME_DEBUG__).toBeUndefined();
  });

  it('does nothing when there is no window (SSR / Node)', () => {
    expect(() => installDebugApi(fakeGame)()).not.toThrow();
  });
});
