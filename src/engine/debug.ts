/**
 * OWNER: package F. Exposes the game to tests and the browser console as `window.__GAME_DEBUG__`.
 *
 * Only active in dev builds (`vite` dev server) or when the page URL has `?debug`, so the
 * production bundle does not publish a handle to the game. App calls `installDebugApi(game)`
 * once after constructing `Game` and runs the returned cleanup on unmount.
 *
 * Nothing here adds behaviour: `Game` already implements `GameDebugApi`, so this is a pointer.
 */
import type { GameDebugApi } from '../types/blueprint';

/** Publishes `game` on `window.__GAME_DEBUG__`. Returns a cleanup that removes it again. */
export function installDebugApi(game: GameDebugApi): () => void {
  if (typeof window === 'undefined') return () => {};
  const enabled = import.meta.env.DEV || new URLSearchParams(window.location.search).has('debug');
  if (!enabled) return () => {};
  window.__GAME_DEBUG__ = game;
  return () => {
    if (window.__GAME_DEBUG__ === game) delete window.__GAME_DEBUG__;
  };
}
