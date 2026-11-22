import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameDebugApi } from '../types/blueprint';
import { installDebugApi } from './debug';

const fakeGame = {} as GameDebugApi;

function stubWindow(search: string) {
  const win: { location: { search: string }; __GAME_DEBUG__?: GameDebugApi } = { location: { search } };
  vi.stubGlobal('window', win);
  return win;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('installDebugApi', () => {
  it('publishes the game on window in dev and removes it on cleanup', () => {
    const win = stubWindow('');
    const cleanup = installDebugApi(fakeGame);
    expect(win.__GAME_DEBUG__).toBe(fakeGame);
    cleanup();
    expect('__GAME_DEBUG__' in win).toBe(false);
  });

  it('stays off in production builds without ?debug', () => {
    vi.stubEnv('DEV', false);
    const win = stubWindow('?foo=1');
    installDebugApi(fakeGame);
    expect(win.__GAME_DEBUG__).toBeUndefined();
  });

  it('turns on in production builds when the URL has ?debug', () => {
    vi.stubEnv('DEV', false);
    const win = stubWindow('?debug');
    installDebugApi(fakeGame);
    expect(win.__GAME_DEBUG__).toBe(fakeGame);
  });

  it('cleanup leaves a newer game in place', () => {
    const win = stubWindow('');
    const cleanupOld = installDebugApi(fakeGame);
    const newer = {} as GameDebugApi;
    installDebugApi(newer);
    cleanupOld();
    expect(win.__GAME_DEBUG__).toBe(newer);
  });

  it('does nothing when there is no window (SSR / Node)', () => {
    expect(() => installDebugApi(fakeGame)()).not.toThrow();
  });
});
